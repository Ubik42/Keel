import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutomationCommandGateway } from '../../../src/automation/command-gateway';
import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
} from '../../../src/main/automation/automation-execution-journal';
import { EmbeddedMcpServer } from '../../../src/main/mcp/embedded-mcp-server';
import { localApiPipePath } from '../../../src/main/mcp/local-api-pipe';
import { McpSettingsStore } from '../../../src/main/mcp/mcp-settings-store';
import { connectKeel } from '../../../tools/keel-api/keel-api.mjs';

const roots: string[] = [];
const logger = { info: () => undefined, error: () => undefined };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function startServer() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'keel-local-api-'));
  roots.push(userDataPath);
  const settings = new McpSettingsStore(userDataPath);
  settings.setPreferences({ enabled: true, port: await freePort() });
  const gateway: AutomationCommandGateway = {
    execute: vi.fn(async (envelope: unknown) => ({
      ok: true as const,
      apiVersion: 1 as const,
      commandId: (envelope as { commandId: 'library.list-open' }).commandId,
      executionId: (envelope as { executionId: string }).executionId,
      result: { libraries: [], activeLibraryId: null, contextRevision: 0 },
    })),
    completeExecutionHistoryGroup: vi.fn(async () => true),
  };
  const server = new EmbeddedMcpServer({
    userDataPath,
    settingsStore: settings,
    journal: new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(userDataPath, 'executions.json')),
      logger,
    }),
    gateway,
    workerClient: {
      request: vi.fn(async () => ({ ok: true, type: 'library.list', libraries: [] })),
      onLibraryChanged: vi.fn(() => () => undefined),
    },
    logger,
    getPluginTools: () => undefined,
  });
  await server.start();
  return { server, gateway, userDataPath };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local API pipe', () => {
  it('serves the MCP tools over the pipe named in the launcher file', async () => {
    const { server, gateway, userDataPath } = await startServer();
    const connection = JSON.parse(readFileSync(path.join(userDataPath, 'mcp-launcher.json'), 'utf8')) as { pipe: string };
    expect(connection.pipe).toBe(localApiPipePath(userDataPath));

    const keel = await connectKeel({ profile: userDataPath });
    const tools = await keel.tools();
    expect(tools.some((tool) => tool.name === 'keel_library_list_open')).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => keel.call<{ libraries: unknown[] }>('keel_library_list_open')),
    );
    expect(results.every((result) => Array.isArray(result.libraries))).toBe(true);
    expect(gateway.execute).toHaveBeenCalledTimes(20);
    expect(server.snapshot().runtime).toMatchObject({ activeSessionCount: 1 });
    await keel.close();
    await vi.waitFor(() => expect(server.snapshot().runtime).toMatchObject({ activeSessionCount: 0 }));
    await server.close();
  });

  it('rejects a wrong token and stops the pipe with the server', async () => {
    const { server, userDataPath } = await startServer();
    const file = path.join(userDataPath, 'mcp-launcher.json');
    const connection = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    writeFileSync(file, JSON.stringify({ ...connection, token: 'wrong' }));
    await expect(connectKeel({ profile: userDataPath })).rejects.toMatchObject({ code: 'MCP_CLIENT_UNAUTHORIZED' });
    writeFileSync(file, JSON.stringify(connection));
    await server.stop();
    await expect(connectKeel({ profile: userDataPath })).rejects.toMatchObject({ code: 'KEEL_API_UNAVAILABLE' });
    await server.close();
  });
});
