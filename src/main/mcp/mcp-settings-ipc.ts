import { ipcMain, clipboard } from 'electron';
import { MCP_SETTINGS_REQUEST_CHANNEL } from '../../shared/protocol/channels';
import { state } from '../main-state';
import { mcpSettingsResponseSchema, mcpSettingsRequestSchema, type McpSettingsRequest } from '../../shared/mcp';
import { confirmEnableAllMcpPermissions } from '../window/desktop-confirmations';
import { EmbeddedMcpServerError } from './embedded-mcp-server';

/**
 * IPC for the MCP settings page: server start/stop, port, credentials and permissions (split out of startApplication, P8).
 */
export function registerMcpSettingsIpc() {
  ipcMain.handle(MCP_SETTINGS_REQUEST_CHANNEL, async (event, input: unknown) => {
    const server = state.embeddedMcpServer;
    const response = (value: unknown) => mcpSettingsResponseSchema.parse(value);
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info('mcp.settings', 'Rejected MCP settings request.', { code: 'unauthorized_sender' });
      return response({ ok: false, code: 'unauthorized_sender', message: 'The MCP settings request sender is not authorized.' });
    }
    if (!server) {
      const failure = state.embeddedMcpInitializationFailure;
      state.logger?.info('mcp.settings', 'MCP service is unavailable after initialization failed.', {
        code: failure?.code ?? 'MCP_SETTINGS_UNAVAILABLE',
        ...(failure?.systemCode === undefined ? {} : { systemCode: failure.systemCode }),
      });
      return response({
        ok: false,
        code: failure?.code ?? 'MCP_SETTINGS_UNAVAILABLE',
        message: failure?.message ?? 'MCP settings are unavailable.',
        ...(failure === undefined ? {} : {
          details: {
            filePath: failure.filePath,
            ...(failure.systemCode === undefined ? {} : { systemCode: failure.systemCode }),
            ...(failure.recoveryCode === undefined ? {} : { recoveryCode: failure.recoveryCode }),
          },
        }),
      });
    }
    const parsed = mcpSettingsRequestSchema.safeParse(input);
    if (!parsed.success) {
      return response({ ok: false, code: 'MCP_INVALID_REQUEST', message: 'The MCP settings request is invalid.', snapshot: server.snapshot() });
    }
    const request: McpSettingsRequest = parsed.data;
    try {
      if (request.type === 'get') return response({ ok: true, snapshot: server.snapshot() });
      if (request.type === 'set-auto-start') return response({ ok: true, snapshot: await server.setAutoStart(request.enabled) });
      if (request.type === 'set-access-mode') {
        if (request.mode === 'full-access') {
          const credential = server.snapshot().credentials.find(
            (candidate) => candidate.credentialId === request.credentialId,
          );
          if (credential === undefined || credential.revokedAt !== null) {
            return response({
              ok: false,
              code: 'MCP_CLIENT_UNAUTHORIZED',
              message: 'The MCP client credential is unavailable.',
              snapshot: server.snapshot(),
            });
          }
          if (!(await confirmEnableAllMcpPermissions(credential.label))) {
            return response({
              ok: false,
              code: 'MCP_PERMISSION_CONFIRMATION_CANCELLED',
              message: 'The permission change was cancelled.',
              snapshot: server.snapshot(),
            });
          }
        }
        return response({ ok: true, snapshot: await server.setAccessMode(request.credentialId, request.mode) });
      }
      if (request.type === 'set-port') return response({ ok: true, snapshot: await server.setPort(request.port) });
      if (request.type === 'start') return response({ ok: true, snapshot: await server.start() });
      if (request.type === 'stop') return response({ ok: true, snapshot: await server.stop() });
      if (request.type === 'enable') return response({ ok: true, snapshot: await server.setEnabled(request.enabled) });
      if (request.type === 'revoke-credential') {
        return response({ ok: true, snapshot: await server.revokeCredential(request.credentialId) });
      }
      if (request.type === 'rename-credential') {
        return response({ ok: true, snapshot: server.renameCredential(request.credentialId, request.label) });
      }
      if (request.type === 'copy-agent-connection') {
        const copied = await server.copyAgentConnection(request.credentialId, request.format);
        clipboard.writeText(copied.connectionText);
        return response({
          ok: true,
          copied: true,
          credentialId: copied.credentialId,
          snapshot: copied.snapshot,
        });
      }
      const config = await server.createClientConfig(request.input.format, request.input.label);
      clipboard.writeText(config.connectionText);
      return response({ ok: true, copied: true, credentialId: config.credentialId, snapshot: config.snapshot });
    } catch (error) {
      const code = error instanceof EmbeddedMcpServerError ? error.code : 'MCP_SERVER_START_FAILED';
      state.logger?.error('mcp.settings', error, { code });
      return response({
        ok: false,
        code,
        message: error instanceof EmbeddedMcpServerError ? error.message : 'The MCP operation failed.',
        snapshot: server.snapshot(),
      });
    }
  });
}
