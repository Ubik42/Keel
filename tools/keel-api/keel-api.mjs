#!/usr/bin/env node
// Keel local API client (docs/manual/mcp/local-api.md).
//
// Talks to the running Keel desktop over a named pipe (Windows) or a Unix
// domain socket. No network, no dependencies: copy this file anywhere.
//
//   import { connectKeel } from './keel-api.mjs';
//   const keel = await connectKeel();
//   const [library] = await keel.call('keel_library_list_open');
//   await keel.close();
//
// Command line:
//   node keel-api.mjs tools                       list tools
//   node keel-api.mjs call <tool> ['<json>']      one call, JSON result on stdout
//   node keel-api.mjs batch [file.jsonl]          one {"tool","args"} per line
//                                                 (stdin when no file), results as JSONL

import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CONNECTION_FILE = 'mcp-launcher.json';
const PROTOCOL_VERSION = '2025-06-18';
/** Matches the desktop's per-connection command limit (maxConcurrentCommands). */
const MAX_IN_FLIGHT = 4;

export class KeelApiError extends Error {
  constructor(code, message, detail) {
    super(message ?? code);
    this.name = 'KeelApiError';
    this.code = code;
    this.detail = detail;
  }
}

/** Profile folders to try, in order. */
export function candidateProfiles(env = process.env) {
  const list = [];
  if (env.KEEL_USER_DATA_PATH) list.push(env.KEEL_USER_DATA_PATH);
  // The development profile when this file sits in the Keel repository.
  const here = path.dirname(fileURLToPath(import.meta.url));
  list.push(path.resolve(here, '..', '..', '.local-profile'));
  if (process.platform === 'win32') {
    list.push(path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Keel'));
  } else if (process.platform === 'darwin') {
    list.push(path.join(os.homedir(), 'Library', 'Application Support', 'Keel'));
  } else {
    list.push(path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Keel'));
  }
  return list;
}

function readConnection(profile) {
  const file = path.join(profile, CONNECTION_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value.pipe === 'string' && typeof value.token === 'string'
      ? { pipe: value.pipe, token: value.token }
      : undefined;
  } catch {
    return undefined;
  }
}

function openSocket(pipe) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipe);
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

class KeelClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #closed = false;
  #inFlight = 0;
  #waiting = [];

  constructor(socket, lines) {
    this.#socket = socket;
    lines.on('line', (line) => this.#onLine(line));
    socket.on('close', () => {
      this.#closed = true;
      for (const { reject } of this.#pending.values()) {
        reject(new KeelApiError('KEEL_API_CLOSED', 'Keel closed the connection.'));
      }
      this.#pending.clear();
    });
  }

  #onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || !this.#pending.has(message.id)) return;
    const { resolve, reject } = this.#pending.get(message.id);
    this.#pending.delete(message.id);
    if (message.error) reject(new KeelApiError('KEEL_API_PROTOCOL', message.error.message, message.error));
    else resolve(message.result);
  }

  request(method, params) {
    if (this.#closed) return Promise.reject(new KeelApiError('KEEL_API_CLOSED', 'The connection is closed.'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  }

  notify(method, params) {
    this.#socket.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  /** All tools with their input schemas. */
  async tools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request('tools/list', cursor === undefined ? {} : { cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  }

  /**
   * Calls one tool and returns Keel's full answer: `{ ok, result,
   * historyEntryId?, undoGroupId?, libraryChangeSequence? }`. Failures throw
   * KeelApiError with Keel's error code. Several calls may run at once.
   */
  async callRaw(tool, args = {}) {
    // Keel runs at most MAX_IN_FLIGHT commands per connection; queue the rest.
    while (this.#inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => this.#waiting.push(resolve));
    this.#inFlight += 1;
    let answer;
    try {
      answer = await this.request('tools/call', { name: tool, arguments: args });
    } finally {
      this.#inFlight -= 1;
      this.#waiting.shift()?.();
    }
    const payload = answer.structuredContent ?? parseText(answer.content);
    if (answer.isError || payload?.ok === false) {
      const code = payload?.code ?? 'KEEL_API_TOOL_FAILED';
      throw new KeelApiError(code, payload?.message ?? code, payload);
    }
    return payload;
  }

  /** Calls one tool and returns only its result. */
  async call(tool, args = {}) {
    return (await this.callRaw(tool, args))?.result;
  }

  async close() {
    if (this.#closed) return;
    await new Promise((resolve) => {
      this.#socket.once('close', resolve);
      this.#socket.end();
    });
  }
}

function parseText(content) {
  const text = Array.isArray(content) ? content.find((part) => part.type === 'text')?.text : undefined;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Connects to the running Keel. `options.profile` picks a user-data folder. */
export async function connectKeel(options = {}) {
  const profiles = options.profile ? [options.profile] : candidateProfiles();
  let lastError;
  for (const profile of profiles) {
    const connection = readConnection(profile);
    if (!connection) continue;
    let socket;
    try {
      socket = await openSocket(connection.pipe);
    } catch (error) {
      lastError = error;
      continue;
    }
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    socket.write(`${JSON.stringify({ token: connection.token })}\n`);
    const handshake = await new Promise((resolve, reject) => {
      lines.once('line', (line) => {
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      });
      socket.once('close', () => reject(new KeelApiError('KEEL_API_CLOSED', 'Keel closed the connection.')));
    });
    if (!handshake.ok) {
      socket.destroy();
      throw new KeelApiError(handshake.code ?? 'KEEL_API_REJECTED', 'Keel rejected the connection.');
    }
    const client = new KeelClient(socket, lines);
    await client.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: options.clientName ?? 'keel-api', version: '1' },
    });
    client.notify('notifications/initialized');
    return client;
  }
  throw new KeelApiError(
    'KEEL_API_UNAVAILABLE',
    'Keel is not running, or its MCP/API service is off (Settings → MCP).',
    lastError,
  );
}

// ---------------------------------------------------------------- CLI

async function runBatch(keel, input, concurrency) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const running = new Set();
  let index = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const current = index++;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ index: current, ok: false, code: 'KEEL_API_BAD_LINE' })}\n`);
      continue;
    }
    const task = keel.call(request.tool, request.args ?? {})
      .then((result) => ({ index: current, ok: true, result }))
      .catch((error) => ({ index: current, ok: false, code: error.code, message: error.message }))
      .then((outcome) => {
        process.stdout.write(`${JSON.stringify(outcome)}\n`);
        running.delete(task);
      });
    running.add(task);
    if (running.size >= concurrency) await Promise.race(running);
  }
  await Promise.all(running);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`用法：
  node keel-api.mjs tools                    列出全部工具
  node keel-api.mjs call <工具> ['<JSON>']   调用一次，结果以 JSON 输出
  node keel-api.mjs batch [文件.jsonl]       每行 {"tool":"…","args":{…}}，结果按行输出

环境变量：KEEL_USER_DATA_PATH 指定 Keel 的用户数据目录；KEEL_API_CONCURRENCY 批量并发数（默认 4）。
`);
    return;
  }
  const keel = await connectKeel();
  try {
    if (command === 'tools') {
      for (const tool of await keel.tools()) {
        process.stdout.write(`${tool.name}\t${(tool.description ?? '').split('\n')[0]}\n`);
      }
    } else if (command === 'call') {
      const [tool, json] = rest;
      if (!tool) throw new KeelApiError('KEEL_API_USAGE', 'call 需要工具名。');
      const result = await keel.call(tool, json ? JSON.parse(json) : {});
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (command === 'batch') {
      const { createReadStream } = await import('node:fs');
      const input = rest[0] ? createReadStream(rest[0]) : process.stdin;
      const concurrency = Math.max(1, Number(process.env.KEEL_API_CONCURRENCY) || 4);
      await runBatch(keel, input, concurrency);
    } else {
      throw new KeelApiError('KEEL_API_USAGE', `未知命令：${command}`);
    }
  } finally {
    await keel.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`keel-api: ${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  });
}
