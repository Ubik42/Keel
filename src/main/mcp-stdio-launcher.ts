import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * `Keel.exe --mcp` (docs/进度.md, after PF): an MCP stdio server for clients
 * such as Claude Code. It forwards every message to the desktop's embedded
 * Streamable HTTP server, starting the desktop app in the background when it
 * is not running. The desktop stays the only process that writes libraries,
 * and approvals still appear in its window.
 */
export const MCP_LAUNCHER_FLAG = '--mcp';
/** Passed to the desktop app so it starts the MCP server even without auto-start. */
export const MCP_START_FLAG = '--start-mcp';
export const MCP_LAUNCHER_CONNECTION_FILE_NAME = 'mcp-launcher.json';
export const MCP_LAUNCHER_CREDENTIAL_LABEL = 'Keel stdio launcher';

const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

type LauncherConnection = { endpoint: string; token: string };

function readConnection(userDataPath: string): LauncherConnection | undefined {
  try {
    const value = JSON.parse(readFileSync(path.join(userDataPath, MCP_LAUNCHER_CONNECTION_FILE_NAME), 'utf8')) as Partial<LauncherConnection>;
    return typeof value.endpoint === 'string' && typeof value.token === 'string'
      ? { endpoint: value.endpoint, token: value.token }
      : undefined;
  } catch {
    return undefined;
  }
}

async function endpointAnswers(connection: LauncherConnection): Promise<boolean> {
  try {
    // An unauthenticated GET returns 401 from a live server; any HTTP answer means it is up.
    const response = await fetch(connection.endpoint, { method: 'GET', signal: AbortSignal.timeout(2_000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

function startDesktop(executablePath: string): void {
  const child = spawn(executablePath, [MCP_START_FLAG], { detached: true, stdio: 'ignore', env: process.env });
  child.on('error', () => undefined);
  child.unref();
}

async function waitForDesktop(userDataPath: string, executablePath: string): Promise<LauncherConnection> {
  const initial = readConnection(userDataPath);
  if (initial && await endpointAnswers(initial)) return initial;
  startDesktop(executablePath);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const connection = readConnection(userDataPath);
    if (connection && await endpointAnswers(connection)) return connection;
  }
  throw new Error('Keel did not start its MCP server. Enable MCP and auto-start under Settings → MCP.');
}

export async function runMcpStdioLauncher(input: {
  userDataPath: string;
  executablePath: string;
}): Promise<void> {
  const connection = await waitForDesktop(input.userDataPath, input.executablePath);
  const upstream = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
  });
  const downstream = new StdioServerTransport();
  let closed = false;
  const close = (code: number): void => {
    if (closed) return;
    closed = true;
    void upstream.close().catch(() => undefined);
    void downstream.close().catch(() => undefined);
    process.exit(code);
  };
  downstream.onmessage = (message) => {
    void upstream.send(message).catch((error: unknown) => {
      process.stderr.write(`keel-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  };
  upstream.onmessage = (message) => {
    void downstream.send(message);
  };
  downstream.onclose = () => close(0);
  upstream.onerror = (error) => process.stderr.write(`keel-mcp: ${error.message}\n`);
  await upstream.start();
  await downstream.start();
  process.stdin.on('end', () => close(0));
}
