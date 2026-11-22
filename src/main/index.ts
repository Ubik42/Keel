import "../shared/install-legacy-env";
import path from "node:path";
import { tmpdir } from "node:os";
import { copyLegacyUserData } from "./legacy-user-data";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
} from "node:fs";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  shell,
  nativeImage,
} from "electron";
import type { NativeImage } from "electron";

import {
  installApplicationMenu,
} from "./application-menu";
import { applyDevAppIcon, appIconImage } from "./app-icon";
import {
  startNativeAssetDrag,
} from "./native-asset-drag";
import {
  type SyncBindingRecord,
} from "./library-request/sync";
import {
  applyStartupLoginItem,
  readStartupPreferences,
} from './startup-preferences-store';
import {
  shouldHandleSecondaryLaunch,
} from '../shared/startup-preferences';

import {
  registerWindowControls,
} from "./window-controls";
import { sendToLiveWebContents } from "./web-contents-send";
import {
  bindRendererKeyboardFocusLogger,
  ensureRendererKeyboardFocus,
} from "./renderer-keyboard-focus";
import {
  createWindowsTray,
} from "./windows-tray";
import {
  ASSET_NATIVE_DRAG_CHANNEL,
  ASSET_NATIVE_DRAG_PRIME_CHANNEL,
  THUMBNAIL_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  SHELL_NOTIFY_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
  PLUGIN_INSTALL_PROGRESS_CHANNEL,
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
} from "../shared/protocol/channels";
import {
  createAutomationCommandGateway,
} from '../automation/command-gateway';
import {
  PLUGIN_UI_DIALOG_PATCH_CHANNEL,
  PLUGIN_UI_DIALOG_REQUEST_CHANNEL,
  PLUGIN_UI_DIALOG_RESULT_CHANNEL,
  PLUGIN_UI_WIDGET_EVENT_CHANNEL,
  pluginUiDialogResultPayloadSchema,
  pluginUiWidgetEventPayloadSchema,
} from '../shared/plugin-ui-dialog-bridge';
import { resolveHostMediaBinaries } from './media-binary-env';
import { AutomationLibraryWorkerAdapter } from './automation-worker-adapter';
import {
  createDesktopAutomationFilePlanApprovalHandler,
} from './automation-file-plan-approval';
import {
  AutomationExecutionJournal,
  AutomationLibraryContextError,
  createJsonFileAutomationExecutionStore,
  projectAutomationExecutionStatus,
} from './automation-execution-journal';
import { createJsonFileAutomationIdempotencyStore } from './automation-idempotency-store';
import { McpPermissionBroker } from './mcp-permission-broker';
import { McpPermissionPolicyStore } from './mcp-permission-policy-store';
import { McpOperationChallengeStore } from './mcp-operation-challenge';
import { CriticalConfirmationWindowManager } from './critical-confirmation-window';
import { RendererCriticalConfirmationBroker } from './critical-confirmation-prompt';
import { registerAutomationScriptIpc } from './automation-script-ipc';
import { AutomationScriptFileService } from './automation-script-file-service';
import {
  createJsonFileAutomationRecentScriptsStore,
} from './automation-recent-scripts-store';
import {
  PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
} from '../plugins/plugin-host-command-target';
import { createPluginPackageRequestHandler } from './plugin-package-ipc';
import {
  createPublicError,
  toPublicError,
} from "../shared/protocol/errors";
import {
  parseNativeAssetDragRequest,
} from "../shared/protocol/requests";
import {
  type RendererResult,
} from "../shared/protocol/responses";
import { LibraryWorkerClient } from "./worker-client";
import { performanceConsumerIdForWindow } from "../shared/performance-contract";
import { SyncAutoScheduler, type SyncBindingLike } from "./sync-auto-scheduler";
import { AppLogger } from "./app-logger";
import { chooseUniqueSessionLogPath, pruneSessionLogs } from "./session-log";
import {
  logRendererChildProcessGone,
} from "./renderer-diagnostics";
import {
  clearActiveRecentLibrary,
  recentLibraryAutoOpenEnabled,
  readActiveLibraryPath,
  removeRecentLibrary,
} from "./recent-libraries";
import { PreviewCache } from "./preview-cache";
import { renderDocumentThumbnail } from "./document-thumbnail-renderer";
import {
  createExtensionServer,
} from "./extension-server";
import {
  cleanupStaleClipboardImages,
} from "./desktop-ingestion";
import {
  legacyProtocolSchemes,
  keelProtocolSchemes,
} from "./keel-protocol-privileges";

// Headless E2E hosts may expose no hardware WebGL implementation. Opt those
// tests into Chromium's explicitly acknowledged software path; production
// keeps the platform's normal GPU selection and never silently downgrades it.
// KEEL_SOFTWARE_GL=1 is the same explicit opt-in for users on GPU-less
// hosts (Linux VMs / remote desktops without a usable GL driver), so the 3D
// viewer and model thumbnails can render via SwiftShader. Off by default.
import { state } from './main-state';

if (
  (process.env.KEEL_E2E === "1" &&
    process.env.KEEL_E2E_ENABLE_SWIFTSHADER === "1") ||
  process.env.KEEL_SOFTWARE_GL === "1"
) {
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
}

// A local fork may keep a stable profile separate from the installed release.
const forkUserDataPath = process.env.KEEL_USER_DATA_PATH;
if (forkUserDataPath && path.isAbsolute(forkUserDataPath)) {
  mkdirSync(forkUserDataPath, { recursive: true });
  app.setPath("userData", forkUserDataPath);
} else if (process.env.KEEL_E2E !== "1") {
  // P1: carry the default profile over from <appData>/Serpent once.
  const legacyUserData = copyLegacyUserData({
    appDataPath: app.getPath("appData"),
    userDataPath: app.getPath("userData"),
  });
  if (legacyUserData.status === "failed") {
    console.error("legacy-user-data.copy-failed", legacyUserData.reason);
  }
}

if (process.env.KEEL_E2E === "1") {
  const explicitUserDataPath = process.env.KEEL_E2E_USER_DATA_PATH;
  app.setPath(
    "userData",
    explicitUserDataPath && path.isAbsolute(explicitUserDataPath)
      ? explicitUserDataPath
      : path.join(tmpdir(), "keel-e2e-user-data", String(process.pid)),
  );
}

// Dev multi-instance (Serpent-i6xg): isolate userData so SingletonLock / prefs
// do not collide. Prefer `npm run start:multi`. Do not open the same library
// for writes from two GUIs — SQLite write coordination is CLI/desktop lease
// territory (ADR-0021), not dual-GUI.
const allowMultiInstance = process.env.KEEL_ALLOW_MULTI_INSTANCE === "1";
if (allowMultiInstance && process.env.KEEL_E2E !== "1") {
  app.setPath(
    "userData",
    path.join(app.getPath("userData"), "dev-instances", `pid-${process.pid}`),
  );
}

// Before app.ready: stream privilege is required for seekable <video>/<audio>
// over keel:// Range responses (Serpent-jh2).
protocol.registerSchemesAsPrivileged([...keelProtocolSchemes(), ...legacyProtocolSchemes()]);

// E2E（本地/CI）：虚拟化 runner 的 GPU 不可靠，白屏会让所有交互测试
// 超时（CI mac 上 69 个 E2E 全挂）。禁用硬件加速换取稳定渲染。
if (
  process.env.KEEL_E2E === "1" &&
  process.env.KEEL_E2E_ENABLE_SWIFTSHADER !== "1"
) {
  app.disableHardwareAcceleration();
}

app.enableSandbox();

const hasSingleInstanceLock = allowMultiInstance
  ? true
  : app.requestSingleInstanceLock();
const mainProcessSessionId = randomUUID();
function initializePreviewCache(): void {
  if (process.env.KEEL_PREVIEW_CACHE_DISABLED === "1") return;
  // E2E suites manipulate artifact files and rows directly; a mirror would
  // serve phantom bytes. Probes that verify the cache opt in explicitly.
  if (process.env.KEEL_E2E === "1" && process.env.KEEL_PREVIEW_CACHE_FORCE !== "1") {
    return;
  }
  const budgetBytes = Number(process.env.KEEL_PREVIEW_CACHE_BUDGET_BYTES ?? "");
  const cacheLogEnabled = process.env.KEEL_PREVIEW_CACHE_LOG === "1";
  state.previewCache = new PreviewCache({
    rootDir: path.join(app.getPath("userData"), "preview-cache"),
    budgetBytes: Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 2 * 1024 * 1024 * 1024,
    onEvent: cacheLogEnabled
      ? (event) => state.logger?.info("preview-cache", `${event.kind} ${event.libraryId} ${event.artifactId}${event.detail ? ` ${event.detail}` : ""}`)
      : undefined,
  });
  void state.previewCache.evictToBudget();
}
import { readSyncBindings, resolveSyncServerCredentials, writeSyncBindings } from './ai-settings-files';
import { cleanupAllExternalSources, recentLibraryPath, sweepOrphanExternalLibraryStagingOnStartup } from './external-library-staging';
import { nativeMenuRecentLibraries, readShortcutBindingsSnapshot, startupPreferencesPath } from './app-preference-files';
import { clearArtifactPathCache, clearNativeAssetDragCache, nativeAssetDragCache, nativeAssetDragPrimer, sourcePathCache } from './asset-path-caches';
import { confirmDesktopAutomationFilePlan, confirmDesktopAutomationWrite } from './desktop-confirmations';
import { scheduleLibraryChangeRules } from './rule-triggers';
import { aiQueueScheduler, enqueueAutoAnalyzeAfterImport, processAiQueue } from './ai-queue';
import { selectAutomationScriptToOpen, selectAutomationScriptToSave, selectPluginPackageForInstall } from './main-dialogs';
import { publishAiCleared, publishAiCompleted, publishAiProgress, publishAssetChange, publishLibraryChanged, publishLifecycle, publishProgress } from './renderer-events';
import { handleListFolders, handleSaveIntent, handleSaveUpload } from './extension-save';
import { notifyLibraryOpenedSideEffects, pluginThumbnailExtensionsFor, refreshApplicationMenuRecentLibraries, rememberOpenedLibrary, syncPluginCompanionExtensions } from './library-opened';
import { executeMcpLibraryContextCommand, normalizeMcpCommandInput } from './mcp-library-context';
import { createMainWindow, focusMainWindow, handleSecondInstance, launchedForMcp, startMcpForLauncher } from './main-window';
import { handleLibraryRequest, manualSyncRuns, pluginAutomationContexts, retryPendingLibraryCleanups, syncDeviceId } from './library-ipc';
import { registerShellIpc } from './shell-ipc';
import { registerRuleIpc } from './rule-ipc';
import { registerPreferenceIpc } from './preference-ipc';
import { registerKeelProtocol } from './keel-protocol';
import { registerMcpSettingsIpc } from './mcp-settings-ipc';
import { registerOffscreenRendering } from './offscreen-rendering';
import { setUpPluginHost } from './plugin-host-setup';

function releaseLoopbackListeners(): Promise<void> {
  if (state.loopbackRelease !== undefined) return state.loopbackRelease;
  try {
    state.extensionServer?.server.close();
  } catch (error) {
    state.logger?.error("extension-server", error);
  }
  state.extensionServer = undefined;
  const mcpClose = state.embeddedMcpServer?.close() ?? Promise.resolve();
  state.loopbackRelease = mcpClose.catch((error: unknown) => {
    state.logger?.error("automation.mcp.close", error);
  });
  return state.loopbackRelease;
}

async function startApplication(): Promise<void> {
  // Serpent-tluf: the macOS About panel is customized here (ready-late is
  // fine for it); app.setName lives at module top level so the application
  // menu's first item shows "Keel" from the very first frame.
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: "Keel",
      applicationVersion: app.getVersion(),
    });
  }
  // Windows: taskbar/start-pin grouping requires the AppUserModelID to match
  // the shortcuts created by the installer (WiX/Squirrel both set one). Without
  // this, the taskbar shows the default Electron icon and pinning breaks.
  if (process.platform === "win32") {
    app.setAppUserModelId("com.keel.app");
  }
  // Isolated E2E runs must not write the log into the real user profile
  // (~/Library/Logs/Serpent); pin it under the temp userData instead.
  if (process.env.KEEL_E2E === "1" && process.env.KEEL_E2E_USER_DATA_PATH) {
    app.setAppLogsPath(path.join(process.env.KEEL_E2E_USER_DATA_PATH, "logs"));
  } else {
    app.setAppLogsPath();
  }
  state.appLogPath = chooseUniqueSessionLogPath(app.getPath("logs"), new Date());
  state.logger = new AppLogger(state.appLogPath);
  bindRendererKeyboardFocusLogger(state.logger);
  void sweepOrphanExternalLibraryStagingOnStartup();
  // Serpent-wgmy: 会话日志最多保留最近 100 份，启动时清理最旧；
  // 清理失败不得阻断启动。
  try {
    pruneSessionLogs(app.getPath("logs"));
  } catch (error) {
    state.logger?.error("session-log.prune", error);
  }
  state.criticalConfirmationWindowManager = new CriticalConfirmationWindowManager({
    getParentWindow: () => state.mainWindow ?? null,
    createWindow: (options) => new BrowserWindow(options),
    ipcMain,
    preloadPath: path.join(__dirname, 'critical-confirmation.js'),
    logger: state.logger,
  });
  state.criticalConfirmationBroker = new RendererCriticalConfirmationBroker({
    getTarget: () => {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return null;
      const contents = state.mainWindow.webContents;
      return {
        id: contents.id,
        isDestroyed: () => contents.isDestroyed(),
        send: (channel, payload) => {
          contents.send(channel, payload);
        },
        once: (event, listener) => {
          contents.once(event, listener);
        },
        removeListener: (event, listener) => {
          contents.removeListener(event, listener);
        },
      };
    },
    ipcMain,
    logger: state.logger,
  });
  app.on("child-process-gone", (_event, details) => {
    logRendererChildProcessGone(state.logger, undefined, details);
  });
  applyDevAppIcon();
  const staleClipboardCount = cleanupStaleClipboardImages(app.getPath("temp"));
  if (staleClipboardCount > 0) {
    state.logger.info(
      "desktop-ingestion.clipboard-cleanup",
      "Removed stale clipboard staging directories.",
      {
        removedCount: staleClipboardCount,
      },
    );
  }
  state.workerClient = new LibraryWorkerClient(
    path.join(__dirname, "library_worker.js"),
    state.logger,
    {
      ...process.env,
      KEEL_LIBRARY_METADATA_CACHE_PATH: path.join(
        app.getPath('userData'),
        'library-metadata-cache',
      ),
      KEEL_SEMANTIC_LEGACY_CACHE_ROOT: app.getPath('userData'),
      KEEL_MAIN_PROCESS_SESSION_ID: mainProcessSessionId,
    },
  );
  await state.workerClient.start();
  state.workerClient.publishShowMissingLinkedFiles(state.showMissingLinkedFiles);
  // Serpent-65d837: remove any `.del-*` aside roots that could not be deleted
  // during a previous session (deferred-cleanup store, backoff loop).
  retryPendingLibraryCleanups();
  const activeWorkerClient = state.workerClient;
  let workerRecoveryEpoch = 0;
  state.workerClient.onRecovery((event) => {
    if (event.state === 'recovering') {
      workerRecoveryEpoch += 1;
      publishLifecycle({ type: 'worker.recovering' });
      return;
    }
    if (event.state === 'failed') {
      workerRecoveryEpoch += 1;
      publishLifecycle({ type: 'worker.failed' });
      return;
    }
    const recoveryEpoch = ++workerRecoveryEpoch;
    // Clear generation-bound caches and resend Worker configuration before
    // the client releases its request gate. Slow plugin/AI work follows below.
    for (const libraryId of event.failedLibraryIds) {
      sourcePathCache.clearLibrary(libraryId);
      clearArtifactPathCache(libraryId);
      clearNativeAssetDragCache(libraryId);
    }
    for (const library of event.libraries) {
      sourcePathCache.clearLibrary(library.libraryId);
      clearArtifactPathCache(library.libraryId);
      clearNativeAssetDragCache(library.libraryId);
      activeWorkerClient.publishPluginThumbnailExtensions(
        library.libraryId,
        pluginThumbnailExtensionsFor(library.libraryId),
      );
    }
    activeWorkerClient.publishShowMissingLinkedFiles(state.showMissingLinkedFiles);
    // Plugin activation and AI queue scheduling can call client.request(), so
    // run them after the gate is released while retaining the epoch guard.
    setTimeout(() => {
      void (async () => {
        if (recoveryEpoch !== workerRecoveryEpoch || !activeWorkerClient.available) return;
        for (const libraryId of event.failedLibraryIds) {
          state.pluginActivationCoordinator?.onLibraryClosed(libraryId);
          publishLifecycle({ type: 'library.closed', libraryId });
        }
        for (const library of event.libraries) {
          if (recoveryEpoch !== workerRecoveryEpoch || !activeWorkerClient.available) return;
          try {
            await notifyLibraryOpenedSideEffects({
              libraryId: library.libraryId,
              libraryDirectory: library.libraryPath,
            });
          } catch (error) {
            state.logger?.error('worker.recovery.library-side-effects', error, {
              libraryId: library.libraryId,
            });
          }
        }
        if (recoveryEpoch !== workerRecoveryEpoch || !activeWorkerClient.available) return;
        publishLifecycle({
          type: 'worker.recovered',
          libraryIds: event.libraries.map((library) => library.libraryId),
          failedLibraryIds: event.failedLibraryIds,
        });
      })().catch((error) => {
        state.logger?.error('worker.recovery.main-state', error);
        if (recoveryEpoch === workerRecoveryEpoch && activeWorkerClient.available) {
          publishLifecycle({
            type: 'worker.recovered',
            libraryIds: event.libraries.map((library) => library.libraryId),
            failedLibraryIds: event.failedLibraryIds,
          });
        }
      });
    }, 0);
  });
  // Slice E (Serpent-hnmg): Main owns the shared offscreen window that renders
  // model thumbnails. The worker enqueues model jobs and asks Main to render;
  // Main replies with PNG bytes (or a typed failure) that the worker persists
  // as the standard `thumbnail` artifact.
  registerOffscreenRendering();
  // Serpent-8ca259: HTML document thumbnails capture the source in a fresh
  // offscreen window in Main; the Worker persists the artifact bytes.
  state.workerClient.onDocumentThumbnailRenderRequest((request) =>
    renderDocumentThumbnail(request, state.logger!),
  );
  state.automationExecutionJournal = new AutomationExecutionJournal({
    store: createJsonFileAutomationExecutionStore(
      path.join(app.getPath('userData'), 'automation-executions.json'),
    ),
    logger: state.logger,
  });
  const automationIdempotencyStore = createJsonFileAutomationIdempotencyStore(
    path.join(app.getPath('userData'), 'automation-idempotency.json'),
  );
  state.mcpPermissionPolicyStore = new McpPermissionPolicyStore(app.getPath('userData'));
  state.mcpOperationChallengeStore = new McpOperationChallengeStore();
  state.mcpPermissionBroker = new McpPermissionBroker({
    policyStore: state.mcpPermissionPolicyStore,
    challengeStore: state.mcpOperationChallengeStore,
    audit: state.logger,
  });
  state.automationRecentScripts = createJsonFileAutomationRecentScriptsStore(
    path.join(app.getPath('userData'), 'automation-recent-scripts.json'),
  );
  const automationWorkerAdapter = new AutomationLibraryWorkerAdapter(state.workerClient, {
    onAiEnqueued: (libraryId) => processAiQueue(libraryId),
    onAiEnqueueError: (error, libraryId) => {
      state.logger?.error('automation.ai-queue.trigger-failed', error, { libraryId });
    },
  });
  state.automationScriptFiles = new AutomationScriptFileService({
    selectOpenScript: selectAutomationScriptToOpen,
    selectSaveScript: selectAutomationScriptToSave,
    recentScripts: state.automationRecentScripts,
  });
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
  const { pluginStorageStore, pluginSettingsStore, pluginMcpExposureStore } = await setUpPluginHost();
  registerMcpSettingsIpc();
  // Global user-scoped plugins have an application lifetime and must be set up
  // before recent-library restore, including when no library can be reopened.
  await state.pluginActivationCoordinator?.refreshGlobal();
  state.workerClient.onAssetsChanged(publishAssetChange);
  state.workerClient.onLibraryChanged(publishLibraryChanged);
  state.workerClient.onLibraryChanged(scheduleLibraryChangeRules);
  state.workerClient.onProgress(publishProgress);
  state.workerClient.onAiProgress(publishAiProgress);
  state.workerClient.onAiAnalysisCompleted(publishAiCompleted);
  state.workerClient.onAiContentCleared(publishAiCleared);
  // 视频 contact sheet / 模型缩略图就绪 = 自动分析的视觉输入边界；导入时
  // 入队可能与该媒体队列竞争，输入就绪时重入队该资产（worker 去重已排队/
  // 运行中/已分析）。8-09 WIP 恢复：worker 解析事件但此前 main 无消费者。
  state.workerClient.onAiInputReady((event) => {
    void enqueueAutoAnalyzeAfterImport(event.libraryId, [event.assetId]);
  });

  // Serpent-bfsb 后续：自动同步调度器。打开同步资源库后自动绑定并开启
  // （见 handleLibraryRequest 的 sync.open-remote-library.request 成功分支）；
  // 本地资产变更 5 秒防抖后自动同步；轮询间隔只用于检查云端。
  state.syncAutoScheduler = new SyncAutoScheduler({
    workerClient: state.workerClient,
    deviceId: () => syncDeviceId(),
    readBindings: () => readSyncBindings() as unknown as Record<string, SyncBindingLike>,
    writeBindings: (bindings) => writeSyncBindings(bindings as unknown as Record<string, SyncBindingRecord>),
    resolveCredentials: (serverId) => resolveSyncServerCredentials(serverId),
    isManualSyncActive: (libraryId) => manualSyncRuns.has(libraryId),
    logger: state.logger,
  });
  state.syncAutoScheduler.start();

  // Serpent-85a9b0：生产启动自动打开上次使用的资源库（记住上次打开的库与
  // 文件夹——库打开后 renderer 的 browser-session 会恢复上次浏览的文件夹）。
  // 打开失败（丢失/断开/不兼容）只记日志、回退 idle，不阻塞用户从切换器
  // 另选库；E2E 隔离重启测试由 recentLibraryAutoOpenEnabled 显式门控。
  const recentPath = recentLibraryAutoOpenEnabled()
    ? readActiveLibraryPath(recentLibraryPath(), (error) => {
        state.logger?.error("recent-library.read", error);
      })
    : null;
  if (recentPath) {
    const restored = await state.workerClient.request({
      type: "library.open",
      selectedLibraryPath: recentPath,
    });
    if (!restored.ok || restored.type !== "library.opened") {
      state.logger.info(
        "recent-library.unavailable",
        "The recent library could not be reopened.",
        {
          code: restored.ok ? "UNEXPECTED_RESULT" : restored.error.code,
          reason: restored.ok ? undefined : restored.error.reason,
        },
      );
    } else {
      // Startup restore bypasses handleLibraryRequest; still must activate plugins.
      // Await so contributions exist before the renderer shell lists menus/settings.
      await notifyLibraryOpenedSideEffects({
        libraryId: restored.library.libraryId,
        libraryDirectory: restored.library.libraryPath,
      });
      state.logger.info(
        "recent-library.restored",
        "Reopened the recent library and completed plugin activation request.",
        {
          libraryId: restored.library.libraryId,
        },
      );
    }
  }

  // Forward thumbnail events to the renderer
  state.workerClient.onThumbnailEvent((event) => {
    if (
      event.type === "asset.thumbnail.ready"
      || (event.type === "asset.thumbnail.batch-ready" && event.ready.length > 0)
    ) {
      // Cover-only video semantics skips a clip until its poster exists.
      // A ready cover is the cue to encode that clip; there is no frame-sampling fallback.
      state.embeddingTestIndex?.catchUp(event.libraryId);
    }
    if (
      event.type === "asset.thumbnail.ready" ||
      event.type === "asset.thumbnail.failed"
    ) {
      // Serpent-8ee170（第三轮纠偏）: a ready/failed thumbnail does not change a
      // source path, so it must not re-resolve drag descriptors. Re-priming on
      // every completion produced 304 background `media.get-asset-drag-infos`
      // requests in a pure browse profile; the first screen is warmed by the
      // browse response itself and anything else resolves on demand.
    }
    sendToLiveWebContents(state.mainWindow?.webContents, THUMBNAIL_CHANNEL, event);
  });

  // Register keel:// custom protocol for serving thumbnail/preview artifacts.
  // The renderer uses keel://preview/<libraryId>/<artifactId> URLs in <img> tags.
  // Main resolves the artifact path via Worker, reads the file, and returns bytes.
  registerKeelProtocol();
  ipcMain.handle(LIBRARY_REQUEST_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
    return handleLibraryRequest(input, {
      consumerId: performanceConsumerIdForWindow(event.sender.id),
    });
  });

  ipcMain.on(ASSET_NATIVE_DRAG_CHANNEL, (event, input: unknown) => {
    const dragWindow = state.mainWindow;
    if (
      !dragWindow ||
      dragWindow.isDestroyed() ||
      event.sender !== dragWindow.webContents
    ) {
      return;
    }
    try {
      const request = parseNativeAssetDragRequest(input);
      startNativeAssetDrag({
        cache: nativeAssetDragCache,
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        imageFactory: nativeImage,
        fallbackIcon: appIconImage,
        startDrag: ({ file, files, icon }) => {
          dragWindow.webContents.startDrag({
            file,
            files: [...files],
            icon: icon as NativeImage,
          });
        },
      });
    } catch (error) {
      state.logger?.info(
        "main.native-asset-drag",
        "Native asset drag was not started.",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  });

  ipcMain.on(ASSET_NATIVE_DRAG_PRIME_CHANNEL, (event, input: unknown) => {
    if (
      !state.mainWindow ||
      state.mainWindow.isDestroyed() ||
      event.sender !== state.mainWindow.webContents
    ) {
      return;
    }
    try {
      const request = parseNativeAssetDragRequest(input);
      void nativeAssetDragPrimer.primeImmediately(
        request.libraryId,
        request.assetIds,
        "upsert",
      );
    } catch (error) {
      state.logger?.info(
        "main.native-asset-drag",
        "Native asset drag was not primed.",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  });

  registerAutomationScriptIpc({
    ipcMain,
    isAuthorizedSender: (sender) => Boolean(state.mainWindow && sender === state.mainWindow.webContents),
    workerClient: () => state.workerClient,
    journal: () => state.automationExecutionJournal,
    gateway: () => state.automationCommandGateway,
    runtime: () => state.scriptRuntimeSupervisor,
    scriptFiles: () => state.automationScriptFiles,
    confirmDesktopWrite: confirmDesktopAutomationWrite,
    logger: () => state.logger,
    undoGroup: () => ({
      recover: async ({ libraryId, items }) => {
        let undoneCount = 0;
        let skippedCount = 0;
        for (const item of [...items].reverse()) {
          if (!item.reversible) throw new Error('This automation undo item is not reversible.');
          const result = item.kind === 'asset.move'
            ? await activeWorkerClient.request({
              type: 'asset.move-undo',
              libraryId,
              operationId: item.reference,
              conflictStrategy: 'error',
            })
            : item.kind === 'asset.trash'
              ? await activeWorkerClient.request({
                type: 'asset.trash-undo',
                libraryId,
                operationId: item.reference,
              })
              : undefined;
          if (!result) throw new Error(`Automation undo is not supported for ${item.kind}.`);
          if (!result.ok) throw new Error('Automation undo failed.');
          if (result.type === 'asset.move-undone') {
            undoneCount += result.undoneCount;
            skippedCount += result.skippedCount;
          } else if (result.type === 'asset.trash-undone') {
            undoneCount += result.restoredCount;
            skippedCount += result.skippedCount;
          } else {
            throw new Error('Automation undo returned an unexpected result.');
          }
        }
        return { undoneCount, skippedCount };
      },
    }),
  });

  const pluginPackageRequest = state.pluginPackageManager === undefined
    ? undefined
    : createPluginPackageRequestHandler({
      manager: state.pluginPackageManager,
      activationCoordinator: state.pluginActivationCoordinator,
      settingsStore: pluginSettingsStore,
      storageStore: pluginStorageStore,
      mcpExposureStore: pluginMcpExposureStore,
      searchProviders: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin search providers are unavailable.');
        }
        return state.pluginProviderScheduler.searchAssets(input);
      },
      mediaProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin media providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveMediaProvider(input);
      },
      metadataProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin metadata providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveMetadataProvider(input);
      },
      importProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin import providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveImportProvider(input);
      },
      exportProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin export providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveExportProvider(input);
      },
      aiProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin AI providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveAiProvider(input);
      },
      resolveLibraryDirectory: async (libraryId) => {
        const client = state.workerClient;
        if (client === undefined) return undefined;
        const result = await client.request({ type: 'library.list' });
        if (!result.ok || result.type !== 'library.list') return undefined;
        return result.libraries.find((library) => library.libraryId === libraryId)?.libraryPath;
      },
      chooseLocalPackage: selectPluginPackageForInstall,
      notifyInstallProgress: (event) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(PLUGIN_INSTALL_PROGRESS_CHANNEL, event);
        }
      },
      revealPackageDirectory: (absoluteDirectory) => {
        shell.showItemInFolder(absoluteDirectory);
      },
      afterMutation: async ({ requestType, libraryId, libraryDirectory }) => {
        const coordinator = state.pluginActivationCoordinator;
        if (coordinator === undefined) return;
        try {
          if (requestType === 'plugin-manager.resolve'
            || requestType === 'plugin-manager.safe-mode'
            || requestType === 'plugin-manager.install-local'
            || requestType === 'plugin-manager.install-github'
            || requestType === 'plugin-manager.uninstall'
            || requestType === 'plugin-manager.trust'
            || requestType === 'plugin-manager.reload') {
            // Enable/disable (especially user-scoped) and package lifecycle can
            // change contributions in every open library Host.
            await coordinator.refreshOpenLibraries();
          } else if (libraryId !== undefined && libraryDirectory !== undefined) {
            await coordinator.refreshLibrary({ libraryId, libraryDirectory });
          }
          await syncPluginCompanionExtensions();
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send(PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL, {
              libraryId: libraryId ?? null,
              requestType,
            });
          }
          state.embeddedMcpServer?.notifyToolsChanged();
        } catch (error) {
          state.logger?.error('plugin.activation.after-mutation', error, { requestType, libraryId });
        }
      },
      logger: state.logger,
    });
  ipcMain.handle(PLUGIN_MANAGER_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents || pluginPackageRequest === undefined) {
      state.logger?.info('plugin.ipc', 'Rejected plugin manager request.', {
        reason: pluginPackageRequest === undefined ? 'unavailable' : 'unauthorized-sender',
      });
      return { ok: false, code: 'operation-failed' };
    }
    return pluginPackageRequest(input);
  });

  registerPreferenceIpc();
  // PR: rule list, switch, order, run, history, files and the AI prompt.
  registerRuleIpc();
  registerShellIpc();

  // Install before the first window so macOS does not keep Electron's default
  // View→Zoom accelerators that steal Cmd+=/-/0 (Serpent-46i9).
  // Windows: hides menu bar for frameless shell (Serpent-znex).
  installApplicationMenu({
    locale: state.appLocale,
    recentLibraries: nativeMenuRecentLibraries(),
    shortcutBindings: readShortcutBindingsSnapshot(),
  });

  registerWindowControls({
    getMainWindow: () => state.mainWindow,
    logger: state.logger,
  });

  const startupPreferences = readStartupPreferences(startupPreferencesPath());
  if (startupPreferences.openAtLogin) {
    try {
      applyStartupLoginItem({
        platform: process.platform,
        packaged: app.isPackaged,
        e2e: process.env.KEEL_E2E === "1",
        preferences: startupPreferences,
        setLoginItemSettings: (settings) => {
          app.setLoginItemSettings({
            openAtLogin: settings.openAtLogin,
            ...(settings.args === undefined ? {} : { args: [...settings.args] }),
            ...(settings.enabled === undefined ? {} : { enabled: settings.enabled }),
          });
        },
      });
    } catch (error) {
      state.logger?.error("startup.login-item", error);
    }
  }

  await createMainWindow();
  try {
    await state.embeddedMcpServer?.initialize();
  } catch (error) {
    state.logger?.error('mcp.server.initialize', error);
  }
  if (launchedForMcp) await startMcpForLauncher();
  state.windowsTray = createWindowsTray({
    getMainWindow: () => state.mainWindow,
    onQuit: () => app.quit(),
    locale: state.appLocale,
  });

  state.extensionBrowseFoldersStorePath = path.join(
    app.getPath("userData"),
    "extension-recent-browse-folders.json",
  );

  // Start the browser-extension HTTP server on 127.0.0.1.
  try {
    state.extensionServer = await createExtensionServer({
      port: 19876,
      uploadStagingRoot: app.getPath("temp"),
      onListFolders: handleListFolders,
      onSaveIntent: handleSaveIntent,
      onSaveUpload: handleSaveUpload,
      onError: (err) => state.logger?.error("extension-server", err),
    });
    state.logger?.info(
      "extension-server",
      `Browser extension server started on port ${state.extensionServer.port}.`,
    );
  } catch (error) {
    state.logger?.error("extension-server", error);
    // Extension server failure is non-fatal; the app continues without it.
  }

  initializePreviewCache();

  state.startupComplete = true;
}

// Serpent-tluf: must run before app ready — the macOS application menu's
// first item always displays the application name, and a ready-late
// setName is too late for it (dev otherwise shows "Electron").
app.setName("Keel");

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", handleSecondInstance);

  app
    .whenReady()
    .then(startApplication)
    .catch((error: unknown) => {
      state.logger?.error("main.startup", error);
      dialog.showErrorBox(
        "Keel could not start",
        toPublicError(error).message,
      );
      app.quit();
    });

  app.on("activate", () => {
    if (!shouldHandleSecondaryLaunch({ applicationQuitting: state.applicationQuitting })) return;
    if (!state.startupComplete) return;
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    else focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    void state.embeddingTestIndex?.close().catch((error) => {
      state.logger?.error('embedding.local-index.close', error, { reason: 'application-quit' });
    });
    void state.embeddingHttpIndex?.close().catch((error) => {
      state.logger?.error('embedding.http-index.close', error, { reason: 'application-quit' });
    });
    void cleanupAllExternalSources();
    state.syncAutoScheduler?.stop();
    state.syncAutoScheduler = undefined;
    state.windowsTray?.destroy();
    state.windowsTray = undefined;
  });

  app.on("before-quit", (event) => {
    state.applicationQuitting = true;
    aiQueueScheduler.clearAll();
    state.criticalConfirmationWindowManager?.dispose();
    state.criticalConfirmationWindowManager = undefined;
    state.criticalConfirmationBroker?.dispose();
    state.criticalConfirmationBroker = undefined;
    if (state.quitAfterShutdown || (!state.workerClient && !state.embeddingTestIndex && !state.embeddingHttpIndex)) return;
    event.preventDefault();
    if (state.applicationShutdownPromise) return;

    // Slice E: fail in-flight model thumbnail renders and destroy the window.
    state.offscreenThumbnailRenderer?.dispose();
    state.offscreenThumbnailRenderer = undefined;

    state.pluginActivationCoordinator?.dispose('supervisor-shutdown');

    // Close loopback listeners before the worker drain so an update handoff
    // does not keep a port open while the installer starts the next process.
    const mcpClose = releaseLoopbackListeners();
    // Stop model processes before app.exit(), which bypasses will-quit.
    state.applicationShutdownPromise = (async (): Promise<void> => {
      const results = await Promise.allSettled([
        mcpClose,
        state.embeddingTestIndex?.close(),
        state.embeddingHttpIndex?.close(),
      ]);
      for (const [index, result] of results.entries()) {
        if (result.status !== "rejected") continue;
        const source = ["automation.mcp.close", "embedding.local-index.close", "embedding.http-index.close"][index]
          ?? "application.shutdown.close";
        state.logger?.error(source, result.reason, { reason: "application-quit" });
      }
      try {
        await state.workerClient?.shutdown();
      } catch (error) {
        state.logger?.error("library.worker.shutdown", error, { reason: "application-quit" });
      }
      state.quitAfterShutdown = true;
      // The first app.quit() is intentionally intercepted above while owned
      // processes and the Worker drain. app.exit() then completes that quit.
      app.exit(0);
    })();
    void state.applicationShutdownPromise.catch((error: unknown) => {
      state.logger?.error("application.shutdown", error);
      state.quitAfterShutdown = true;
      app.exit(0);
    });
  });
}
