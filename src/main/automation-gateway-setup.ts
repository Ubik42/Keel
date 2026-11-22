import type { AutomationIdempotencyStore } from './automation-idempotency-store';
import type { AutomationLibraryWorkerAdapter } from './automation-worker-adapter';
import type { LibraryWorkerClient } from './worker-client';
import { ipcMain, clipboard } from 'electron';
import { PLUGIN_UI_DIALOG_RESULT_CHANNEL, pluginUiDialogResultPayloadSchema, PLUGIN_UI_WIDGET_EVENT_CHANNEL, pluginUiWidgetEventPayloadSchema, PLUGIN_UI_DIALOG_REQUEST_CHANNEL, PLUGIN_UI_DIALOG_PATCH_CHANNEL } from '../shared/plugin-ui-dialog-bridge';
import { state } from './main-state';
import { createAutomationCommandGateway } from '../automation/command-gateway';
import { pluginAutomationContexts } from './library-ipc';
import { resolveHostMediaBinaries } from './media-binary-env';
import { PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID } from '../plugins/plugin-host-command-target';
import { ensureRendererKeyboardFocus } from './renderer-keyboard-focus';
import { SHELL_NOTIFY_CHANNEL } from '../shared/protocol/channels';
import { createDesktopAutomationFilePlanApprovalHandler } from './automation-file-plan-approval';
import { confirmDesktopAutomationFilePlan } from './desktop-confirmations';
import { executeMcpLibraryContextCommand, normalizeMcpCommandInput } from './mcp-library-context';
import { enqueueAutoAnalyzeAfterImport } from './ai-queue';
import { rememberOpenedLibrary, notifyLibraryOpenedSideEffects, refreshApplicationMenuRecentLibraries } from './library-opened';
import { publishLifecycle } from './renderer-events';
import { clearActiveRecentLibrary, removeRecentLibrary } from './recent-libraries';
import { recentLibraryPath } from './external-library-staging';
import { AutomationLibraryContextError, projectAutomationExecutionStatus } from './automation-execution-journal';

/**
 * The automation command gateway used by scripts, rules and MCP, with plugin UI dialogs it can open (split out of startApplication, P8).
 */
export function setUpAutomationGateway({ automationWorkerAdapter, automationIdempotencyStore, activeWorkerClient }: {
  automationWorkerAdapter: AutomationLibraryWorkerAdapter;
  automationIdempotencyStore: AutomationIdempotencyStore;
  activeWorkerClient: LibraryWorkerClient;
}) {
  const pendingPluginUiDialogs = new Map<string, {
    resolve: (result: unknown | null) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
    pluginInstanceId: string;
    sessionId?: string;
  }>();
  const pendingPluginUiDialogsBySession = new Map<string, string>();
  let pluginUiDialogRequestSeq = 0;
  // Preload uses ipcRenderer.send (same as widget events). handle() only
  // receives invoke(), so submit/cancel never resolved the plugin command.
  ipcMain.on(PLUGIN_UI_DIALOG_RESULT_CHANNEL, (_event, input: unknown) => {
    const parsed = pluginUiDialogResultPayloadSchema.safeParse(input);
    if (!parsed.success) return;
    const pending = pendingPluginUiDialogs.get(parsed.data.requestId);
    if (pending === undefined) return;
    pending.resolve(parsed.data.result);
  });
  ipcMain.on(PLUGIN_UI_WIDGET_EVENT_CHANNEL, (_event, input: unknown) => {
    const parsed = pluginUiWidgetEventPayloadSchema.safeParse(input);
    if (!parsed.success) return;
    const requestId = pendingPluginUiDialogsBySession.get(parsed.data.sessionId);
    if (requestId === undefined) return;
    const pending = pendingPluginUiDialogs.get(requestId);
    if (pending === undefined) return;
    const event = {
      type: parsed.data.type,
      nodeId: parsed.data.nodeId,
      value: parsed.data.value,
    };
    state.pluginRuntimeSupervisor?.deliverWidgetEvent(
      pending.pluginInstanceId,
      parsed.data.sessionId,
      event,
    );
    state.pluginTrustedRuntimeSupervisor?.deliverWidgetEvent(
      pending.pluginInstanceId,
      parsed.data.sessionId,
      event,
    );
  });
  state.automationCommandGateway = createAutomationCommandGateway(
    automationWorkerAdapter,
    {
      resolve: (executionId) => {
        const pluginContext = pluginAutomationContexts.get(executionId);
        if (pluginContext !== undefined) return pluginContext;
        return state.automationExecutionJournal?.resolve(executionId);
      },
    },
    {
      auditSink: state.automationExecutionJournal,
      auditLogger: state.logger,
      idempotencyStore: automationIdempotencyStore,
      externalEffectHandler: {
        apply: ({ commandId, workerResult }) => {
          // The only current external automation effect is intentionally
          // consumed in Main: scripts receive the copied count, never an
          // absolute asset path or an Electron clipboard handle.
          if (commandId !== 'asset.paths.copy'
            || !workerResult.ok
            || workerResult.type !== 'media.asset-paths') {
            throw new Error(`Unexpected automation external effect: ${commandId}`);
          }
          clipboard.writeText(workerResult.absolutePaths.join('\n'));
        },
      },
      mediaBinariesHandler: {
        get: () => {
          const binaries = resolveHostMediaBinaries();
          if (binaries === undefined) {
            throw new Error('MEDIA_BINARIES_NOT_FOUND');
          }
          return binaries;
        },
      },
      uiDialogHandler: {
        open: (input, context) => new Promise((resolve, reject) => {
          const window = state.mainWindow;
          if (!window || window.isDestroyed()) {
            reject(new Error('DIALOG_WINDOW_UNAVAILABLE'));
            return;
          }
          pluginUiDialogRequestSeq += 1;
          const requestId = `plugin-ui-dialog-${pluginUiDialogRequestSeq}`;
          const pluginInstanceId = context.pluginInstanceId ?? '';
          const sessionId = 'sessionId' in input ? input.sessionId : undefined;
          const onWindowClosed = () => {
            const pending = pendingPluginUiDialogs.get(requestId);
            if (pending !== undefined) {
              pendingPluginUiDialogs.delete(requestId);
              if (pending.sessionId !== undefined) {
                pendingPluginUiDialogsBySession.delete(pending.sessionId);
              }
              pending.reject(new Error('DIALOG_WINDOW_UNAVAILABLE'));
            }
          };
          pendingPluginUiDialogs.set(requestId, {
            resolve: (result) => {
              pendingPluginUiDialogs.delete(requestId);
              if (sessionId !== undefined) pendingPluginUiDialogsBySession.delete(sessionId);
              window.removeListener('closed', onWindowClosed);
              resolve(result);
            },
            reject: (error) => {
              pendingPluginUiDialogs.delete(requestId);
              if (sessionId !== undefined) pendingPluginUiDialogsBySession.delete(sessionId);
              window.removeListener('closed', onWindowClosed);
              reject(error);
            },
            cleanup: () => window.removeListener('closed', onWindowClosed),
            pluginInstanceId,
            ...(sessionId === undefined ? {} : { sessionId }),
          });
          if (sessionId !== undefined) pendingPluginUiDialogsBySession.set(sessionId, requestId);
          window.once('closed', onWindowClosed);
          if ('tree' in input) {
            window.webContents.send(PLUGIN_UI_DIALOG_REQUEST_CHANNEL, {
              requestId,
              pluginId: context.pluginId ?? '',
              pluginInstanceId,
              libraryId: context.libraryId ?? PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
              sessionId: input.sessionId,
              title: input.title,
              ...(input.submitLabel === undefined ? {} : { submitLabel: input.submitLabel }),
              tree: input.tree,
            });
            ensureRendererKeyboardFocus(window, {
              reattachHwnd: true,
              reason: "plugin-ui-dialog.widget",
            });
            return;
          }
          window.webContents.send(PLUGIN_UI_DIALOG_REQUEST_CHANNEL, {
            requestId,
            pluginId: context.pluginId ?? '',
            pluginInstanceId,
            dialogId: input.dialogId,
            libraryId: context.libraryId ?? PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
            payload: input.payload ?? null,
          });
          ensureRendererKeyboardFocus(window, {
            reattachHwnd: true,
            reason: "plugin-ui-dialog.iframe",
          });
        }),
        patch: (input) => {
          const requestId = pendingPluginUiDialogsBySession.get(input.sessionId);
          if (requestId === undefined) {
            throw new Error('DIALOG_SESSION_NOT_FOUND');
          }
          const window = state.mainWindow;
          if (!window || window.isDestroyed()) {
            throw new Error('DIALOG_WINDOW_UNAVAILABLE');
          }
          window.webContents.send(PLUGIN_UI_DIALOG_PATCH_CHANNEL, {
            requestId,
            tree: input.tree,
          });
        },
      },
      uiNotifyHandler: {
        notify: (input) => {
          if (!state.mainWindow || state.mainWindow.isDestroyed()) {
            throw new Error('The Keel window is not available to show a notification.');
          }
          // Keel review: ui.notify is strictly non-blocking (toast only);
          // the dialog mode was removed from the registry input schema.
          state.mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
            severity: input.severity,
            mode: 'toast',
            message: input.message.trim().slice(0, 500),
            ...(typeof input.title === 'string' && input.title.trim().length > 0
              ? { title: input.title.trim().slice(0, 120) }
              : {}),
          });
        },
      },
      filePlanApprovalHandler: createDesktopAutomationFilePlanApprovalHandler({
        workerClient: automationWorkerAdapter,
        audit: { info: (scope, message, context) => state.logger?.info(scope, message, context) },
        confirm: confirmDesktopAutomationFilePlan,
        runWillHooks: async ({ commandId, libraryId, commandInput, planSummary }) => {
          if (commandId !== 'asset.trash' || state.pluginActivationCoordinator === undefined) {
            return { warnings: [] };
          }
          const input = commandInput as { assetIds?: readonly string[] };
          const result = await state.pluginActivationCoordinator.runWillHooks({
            event: 'asset.trash',
            libraryId,
            summary: {
              operation: planSummary.operation,
              targetCount: planSummary.targetCount,
              executableCount: planSummary.executableCount,
              blockedCount: planSummary.blockedCount,
              assetIds: Array.isArray(input.assetIds) ? [...input.assetIds] : [],
            },
          });
          return { warnings: result.warnings };
        },
      }),
      permissionBroker: state.mcpPermissionBroker,
      // Plugin executions are library-scoped Host calls, not Automation
      // Executions owned by the journal. They still use the Gateway for
      // domain access, but must not enter the journal's active-context CAS;
      // doing so rejects every plugin command because no journal record exists
      // for the plugin instance execution id.
      contextBarrier: {
        beginCommand: (executionId, contextRevision) => {
          if (pluginAutomationContexts.has(executionId)) {
            return { release: () => undefined };
          }
          return state.automationExecutionJournal!.beginCommand(executionId, contextRevision);
        },
      },
      libraryContextHandler: {
        execute: executeMcpLibraryContextCommand,
      },
      // Serpent-ihpx: automation imports (MCP/scripts) are no different from
      // human imports — the same automatic AI analysis side effect fires here,
      // converging on the exact function the desktop import IPC uses.
      onImportCompleted: ({ libraryId, importedAssetIds }) => {
        if (importedAssetIds.length === 0) return;
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
            severity: 'info',
            mode: 'toast',
            message: `已导入 ${importedAssetIds.length} 项资源`,
          });
        }
        void enqueueAutoAnalyzeAfterImport(libraryId, importedAssetIds);
      },
      historyEntryHandler: {
        onCommitted: ({ executionId, historyEntryId }) => {
          // The Worker owns the executable history.  Main keeps only the
          // path-free receipt so the script compatibility route can undo all
          // mutations made by one execution without maintaining a second
          // inverse-operation journal.
          state.automationExecutionJournal?.appendHistoryEntry(executionId, historyEntryId);
        },
      },
      mcpInputNormalizer: normalizeMcpCommandInput,
      libraryBindingHandler: {
        onLibraryCreated: async ({ source, library }) => {
          rememberOpenedLibrary(library.libraryPath, library.displayName, library.libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId: library.libraryId,
            libraryDirectory: library.libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId: library.libraryId,
              displayName: library.displayName,
              storageLayout: library.storageLayout,
              displayPath: library.libraryPath,
            },
          });
        },
        onLibraryClosed: async ({ source, libraryId }) => {
          state.pluginActivationCoordinator?.onLibraryClosed(libraryId);
          for (const [executionId, context] of pluginAutomationContexts) {
            if (context.libraryId === libraryId) pluginAutomationContexts.delete(executionId);
          }
          clearActiveRecentLibrary(recentLibraryPath(), (error) => {
            state.logger?.error('recent-library.clear', error);
          });
          publishLifecycle({
            type: 'library.closed',
            libraryId,
            ...(source === 'mcp' ? { source } : {}),
          });
        },
        onLibraryRenamed: async ({ source, library }) => {
          rememberOpenedLibrary(library.libraryPath, library.displayName, library.libraryId);
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId: library.libraryId,
              displayName: library.displayName,
              storageLayout: library.storageLayout,
              displayPath: library.libraryPath,
            },
          });
        },
        onLibraryDeleted: async ({ source, libraryId, displayName, libraryPath }) => {
          state.pluginActivationCoordinator?.onLibraryClosed(libraryId);
          for (const [executionId, context] of pluginAutomationContexts) {
            if (context.libraryId === libraryId) pluginAutomationContexts.delete(executionId);
          }
          removeRecentLibrary(recentLibraryPath(), libraryPath, (error) => {
            state.logger?.error('recent-library.remove', error);
          });
          refreshApplicationMenuRecentLibraries();
          publishLifecycle({
            type: 'library.closed',
            libraryId,
            ...(source === 'mcp' ? { source } : {}),
          });
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
              severity: 'info',
              mode: 'toast',
              message: `已删除资源库“${displayName}”`,
            });
          }
        },
        onLibraryImported: async ({ source, libraryId, displayName, libraryPath }) => {
          rememberOpenedLibrary(libraryPath, displayName, libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId,
            libraryDirectory: libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId,
              displayName,
              displayPath: libraryPath,
            },
          });
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
              severity: 'info',
              mode: 'toast',
              message: `资源库“${displayName}”已导入`,
            });
          }
        },
        transitionLibraryContext: async ({ executionId, source, libraryId, displayName, expectedRevision, authorizationSource }) => {
          const libraries = await activeWorkerClient.request({ type: 'library.list' });
          if (!libraries.ok || libraries.type !== 'library.list') {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
          }
          const boundLibrary = libraries.libraries.find((library) => library.libraryId === libraryId);
          if (!boundLibrary) {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
          }
          const bound = state.automationExecutionJournal?.authorizeLibrary(executionId, libraryId);
          const transitioned = state.automationExecutionJournal?.transitionLibraryContext({
            executionId,
            libraryId,
            ...(displayName === undefined ? {} : { displayName }),
            expectedRevision,
            authorizationSource,
          });
          if (transitioned === undefined || transitioned.libraryId !== libraryId) {
            throw new Error('The automation execution could not bind the created library.');
          }
          if (bound === undefined) {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_CONTEXT_CONFLICT');
          }
          rememberOpenedLibrary(boundLibrary.libraryPath, boundLibrary.displayName, boundLibrary.libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId: boundLibrary.libraryId,
            libraryDirectory: boundLibrary.libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId: boundLibrary.libraryId,
              displayName: boundLibrary.displayName,
              storageLayout: boundLibrary.storageLayout,
              displayPath: boundLibrary.libraryPath,
            },
          });
        },
      },
      undoGroupHandler: {
        create: ({ executionId, libraryId }) => {
          if (!state.automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = state.automationExecutionJournal.createUndoGroup({ executionId, libraryId });
          return { undoGroupId: group.undoGroupId };
        },
        append: ({ undoGroupId, item }) => {
          if (!state.automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = state.automationExecutionJournal.appendUndoGroupItems(undoGroupId, [item]);
          if (!group) {
            throw new Error(`Undo group ${undoGroupId} was not found while appending recovery items.`);
          }
        },
        complete: ({ undoGroupId, status, failureReason }) => {
          if (!state.automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = state.automationExecutionJournal.completeUndoGroup(undoGroupId, { status, failureReason });
          if (!group) {
            throw new Error(`Undo group ${undoGroupId} was not found while completing the group.`);
          }
        },
      },
      executionStatusHandler: {
        getStatus: (executionId) => {
          const record = state.automationExecutionJournal?.get(executionId);
          if (!record) return undefined;
          return {
            projection: projectAutomationExecutionStatus(record),
            source: record.source,
          };
        },
      },
    },
  );
}
