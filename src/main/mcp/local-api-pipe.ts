import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Socket } from 'node:net';

/**
 * Local API (docs/manual/mcp/local-api.md): the MCP tools over a named pipe
 * (Windows) or a Unix domain socket, for scripts on this machine. No network
 * stack and no port; web pages cannot open a pipe.
 */
export function localApiPipePath(userDataPath: string, platform: NodeJS.Platform = process.platform): string {
  const digest = createHash('sha256').update(path.resolve(userDataPath).toLowerCase()).digest('hex').slice(0, 16);
  return platform === 'win32'
    ? `\\\\.\\pipe\\keel-api-${digest}`
    : path.join(os.tmpdir(), `keel-api-${digest}.sock`);
}

const MAX_HANDSHAKE_BYTES = 4096;

/**
 * Reads the first line `{"token":"…"}` from a new connection. Bytes after it
 * are pushed back so the MCP transport reads them; the socket stays paused.
 */
export function readLocalApiHandshake(socket: Socket, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const finish = (error: Error | undefined, token?: string): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (error) reject(error);
      else resolve(token!);
    };
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if (newline === -1) {
        if (buffered.length > MAX_HANDSHAKE_BYTES) finish(new Error('Handshake too large.'));
        return;
      }
      socket.pause();
      const rest = buffered.subarray(newline + 1);
      if (rest.length > 0) socket.unshift(rest);
      try {
        const parsed = JSON.parse(buffered.subarray(0, newline).toString('utf8')) as { token?: unknown };
        if (typeof parsed.token !== 'string' || parsed.token.length === 0) throw new Error('Missing token.');
        finish(undefined, parsed.token);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error('Connection closed before the handshake.'));
    const timer = setTimeout(() => finish(new Error('Handshake timed out.')), timeoutMs);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}
