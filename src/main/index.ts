import "../shared/install-legacy-env";
import path from "node:path";
import { tmpdir } from "node:os";
import { copyLegacyUserData } from "./app/legacy-user-data";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
} from "node:fs";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  nativeImage,
} from "electron";
import type { NativeImage } from "electron";

import {
  installApplicationMenu,
} from "./window/application-menu";
import { applyDevAppIcon, appIconImage } from "./app/app-icon";
import {
  startNativeAssetDrag,
} from "./shell/native-asset-drag";
import {
  type SyncBindingRecord,
} from "./library-request/sync";
import {
  applyStartupLoginItem,
  readStartupPreferences,
} from './preferences/startup-preferences-store';
import {
  shouldHandleSecondaryLaunch,
} from '../shared/startup-preferences';

import {
  registerWindowControls,
} from "./window/window-controls";
import { sendToLiveWebContents } from "./window/web-contents-send";
import {
  bindRendererKeyboardFocusLogger,
} from "./window/renderer-keyboard-focus";
import {
  createWindowsTray,
} from "./window/windows-tray";
import {
  ASSET_NATIVE_DRAG_CHANNEL,
  ASSET_NATIVE_DRAG_PRIME_CHANNEL,
  THUMBNAIL_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
} from "../shared/protocol/channels";
import { AutomationLibraryWorkerAdapter } from './automation/automation-worker-adapter';
import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
} from './automation/automation-execution-journal';
import { createJsonFileAutomationIdempotencyStore } from './automation/automation-idempotency-store';
import { McpPermissionBroker } from './mcp/mcp-permission-broker';
import { McpPermissionPolicyStore } from './mcp/mcp-permission-policy-store';
import { McpOperationChallengeStore } from './mcp/mcp-operation-challenge';
import { CriticalConfirmationWindowManager } from './window/critical-confirmation-window';
import { RendererCriticalConfirmationBroker } from './window/critical-confirmation-prompt';
import { registerAutomationScriptIpc } from './automation/automation-script-ipc';
import { AutomationScriptFileService } from './automation/automation-script-file-service';
import {
  createJsonFileAutomationRecentScriptsStore,
} from './automation/automation-recent-scripts-store';
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
import { LibraryWorkerClient } from "./library/worker-client";
import { performanceConsumerIdForWindow } from "../shared/performance-contract";
import { SyncAutoScheduler, type SyncBindingLike } from "./library/sync-auto-scheduler";
import { AppLogger } from "./app/app-logger";
import { chooseUniqueSessionLogPath, pruneSessionLogs } from "./app/session-log";
import {
  logRendererChildProcessGone,
} from "./window/renderer-diagnostics";
import {
  recentLibraryAutoOpenEnabled,
  readActiveLibraryPath,
} from "./library/recent-libraries";
import { PreviewCache } from "./media/preview-cache";
import { renderDocumentThumbnail } from "./media/document-thumbnail-renderer";
import {
  createExtensionServer,
} from "./ingestion/extension-server";
import {
  cleanupStaleClipboardImages,
} from "./ingestion/desktop-ingestion";
import {
  legacyProtocolSchemes,
  keelProtocolSchemes,
} from "./library/keel-protocol-privileges";

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

// Dev multi-instance: isolate userData so SingletonLock / prefs
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
// over keel:// Range responses.
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
import { readSyncBindings, resolveSyncServerCredentials, writeSyncBindings } from './ai/ai-settings-files';
import { cleanupAllExternalSources, recentLibraryPath, sweepOrphanExternalLibraryStagingOnStartup } from './library/external-library-staging';
import { nativeMenuRecentLibraries, readShortcutBindingsSnapshot, startupPreferencesPath } from './preferences/app-preference-files';
import { clearArtifactPathCache, clearNativeAssetDragCache, nativeAssetDragCache, nativeAssetDragPrimer, sourcePathCache } from './media/asset-path-caches';
import { confirmDesktopAutomationWrite } from './window/desktop-confirmations';
import { scheduleLibraryChangeRules } from './automation/rule-triggers';
import { aiQueueScheduler, enqueueAutoAnalyzeAfterImport, processAiQueue } from './ai/ai-queue';
import { selectAutomationScriptToOpen, selectAutomationScriptToSave } from './window/main-dialogs';
import { publishAiCleared, publishAiCompleted, publishAiProgress, publishAssetChange, publishLibraryChanged, publishLifecycle, publishProgress } from './window/renderer-events';
import { handleListFolders, handleSaveIntent, handleSaveUpload } from './ingestion/extension-save';
import { notifyLibraryOpenedSideEffects, pluginThumbnailExtensionsFor } from './library/library-opened';
import { createMainWindow, focusMainWindow, handleSecondInstance, launchedForMcp, startMcpForLauncher } from './window/main-window';
import { handleLibraryRequest, manualSyncRuns, retryPendingLibraryCleanups, syncDeviceId } from './library/library-ipc';
import { registerShellIpc } from './shell/shell-ipc';
import { registerRuleIpc } from './automation/rule-ipc';
import { registerPreferenceIpc } from './preferences/preference-ipc';
import { registerKeelProtocol } from './library/keel-protocol';
import { registerMcpSettingsIpc } from './mcp/mcp-settings-ipc';
import { registerOffscreenRendering } from './media/offscreen-rendering';
import { setUpPluginHost } from './plugins/plugin-host-setup';
import { setUpAutomationGateway } from './automation/automation-gateway-setup';
import { setUpPluginPackageRequests } from './plugins/plugin-package-setup';

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
  // the macOS About panel is customized here (ready-late is
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
  // 会话日志最多保留最近 100 份，启动时清理最旧；
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
  // remove any `.del-*` aside roots that could not be deleted
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
  // Slice E: Main owns the shared offscreen window that renders
  // model thumbnails. The worker enqueues model jobs and asks Main to render;
  // Main replies with PNG bytes (or a typed failure) that the worker persists
  // as the standard `thumbnail` artifact.
  registerOffscreenRendering();
  // HTML document thumbnails capture the source in a fresh
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
  setUpAutomationGateway({ automationWorkerAdapter, automationIdempotencyStore, activeWorkerClient });
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

  // 后续：自动同步调度器。打开同步资源库后自动绑定并开启
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

  // 生产启动自动打开上次使用的资源库（记住上次打开的库与
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
      // 第三轮纠偏：a ready/failed thumbnail does not change a
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

  const { pluginPackageRequest } = setUpPluginPackageRequests({ pluginSettingsStore, pluginStorageStore, pluginMcpExposureStore });
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
  // View→Zoom accelerators that steal Cmd+=/-/0.
  // Windows: hides menu bar for frameless shell.
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

// must run before app ready — the macOS application menu's
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
