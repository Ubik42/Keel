import "../shared/install-legacy-env";
import path from "node:path";
import { tmpdir } from "node:os";
import { copyLegacyUserData } from "./legacy-user-data";
import { MCP_START_FLAG } from "./mcp-stdio-launcher";
import { RuleRunner } from "./rule-runner";
import { createRuleMcpTools } from "./rule-mcp-tools";
import { ruleAiPrompt, ruleIpcRequestSchema, type RuleIpcResult } from "../shared/rules";
import { spawn } from "node:child_process";
import { openWithSettingsFilePath, readOpenWithSettings, writeOpenWithSettings } from "./open-with-settings-store";
import { DEFAULT_OPEN_WITH_SETTINGS } from "../shared/open-with";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  screen,
  shell,
  nativeImage,
  utilityProcess,
} from "electron";
import type { NativeImage } from "electron";

import {
  installApplicationMenu,
  setApplicationMenuCommandChecked,
  setApplicationMenuCommandEnabled,
  setApplicationMenuCommandLabel,
} from "./application-menu";
import { applyDevAppIcon, appIconImage } from "./app-icon";
import { type SourcePathResolution } from "./source-path-cache";
import {
  startNativeAssetDrag,
} from "./native-asset-drag";
import {
  clearViewerVideoShortcutCapture,
  isViewerVideoShortcutContentsActive,
  setViewerVideoShortcutCaptureActive,
  viewerShortcutScopeForContents,
} from "./viewer-video-shortcut-capture";
import { forwardViewerVideoShortcut } from "./viewer-video-shortcut-forward";
import { forwardBrowseShortcut } from "./browse-shortcut-forward";
import {
  forwardApplicationShortcutToWindow,
  isWindowsApplicationShortcut,
  matchWindowsApplicationShortcut,
  setWindowsApplicationShortcutAcceleratorsEnabled,
  setWindowsBrowseShortcutAcceleratorsEnabled,
} from "./viewer-video-shortcut-menu";
import { matchBrowseKeyboardShortcut } from "../shared/browse-keyboard-shortcuts";
import { artifactProtocolMimeForExtension } from "../shared/media-formats";
import { executeLibraryMainCommand } from "./commands/library";
import { tryHandleLibraryOwnedRequest, tryBuildOpenRecentCommand } from "./library-request/library";
import {
  tryBuildIngestionCommand,
  maybeProbeImportSequences,
  tryHandleIngestionOwnedRequest,
  applyImportWorkerResult,
} from "./library-request/ingestion";
import {
  tryHandleSyncOwnedRequest,
  applySyncWorkerBindings,
  bindingNeedsRunAfterManual,
  runSyncProbeWithRetry,
  type SyncBindingRecord,
} from "./library-request/sync";
import { tryHandleAiOwnedRequest } from "./library-request/ai";
import { tryHandleEmbeddingModelRequest } from "./library-request/embedding-models";
import { EmbeddingTestIndex } from "./embedding-test-index";
import { EmbeddingHttpIndex } from "./embedding-http-index";
import {
  inspectManagedEmbeddingInstall,
  resolveInstalledEmbeddingLayout,
} from "./embedding-install";
import {
  parseEmbeddingServiceCatalog,
} from "./embedding-service-registry";
import { parseEmbeddingModelCatalog } from "./embedding-model-catalog";
import { resolveEffectiveEmbeddingSelection } from "../shared/embedding/library-binding";
import { tryHandlePreviewOwnedRequest } from "./library-request/preview";
import { tryHandleMediaShellWorkerResult } from "./library-request/media-shell";
import { maybePrimeNativeDrag } from "./library-request/native-drag";
import { toRendererResult } from "./library-request/renderer-result";
import { tryHandleRelinkOwnedRequest, maybeRememberRelinkPreview } from "./library-request/relink";
import {
  prepareLibraryLifecycle,
  applyLibraryWorkerSideEffects,
  applyExternalLibrarySourceCleanup,
  mapBillfishInspectedDisplayName,
  applyLibraryRendererLifecycle,
  tryHandleRecoveryReport,
  maybeBeginLibraryDeleteFromDisk,
  applyLibraryReplacementAfterWorker,
  maybeDelayE2eTrash,
  externalSourceRootFromCommand,
} from "./library-request/lifecycle";
import { executeFolderMainCommand } from "./commands/folders";
import { executeAssetIngestionMainCommand } from "./commands/asset-ingestion";
import { executeLinkedFolderMainCommand } from "./commands/linked-folders";
import { executeIgnoreMainCommand } from "./commands/ignore";
import { executeTagMainCommand } from "./commands/tags";
import { executeAssetQueryMainCommand } from "./commands/asset-query";
import { executeBrowseSessionMainCommand } from "./commands/browse-session";
import { executeAssetMutationMainCommand } from "./commands/asset-mutations";
import { executeLibraryTransferMainCommand } from "./commands/library-transfer";
import { executeAiMainCommand } from "./commands/ai";
import { executeMediaJobMainCommand } from "./commands/media-jobs";
import { executeSyncMainCommand } from "./commands/sync";
import { executeMediaPathMainCommand } from "./commands/media-paths";
import {
  ExternalLibraryArchiveError,
} from "./external-library-archive";
import {
  mapSystemLocaleToAppLocale,
  tryParseAppLocaleSync,
} from "../shared/native-dialog-i18n";
import {
  applyStartupLoginItem,
  readStartupPreferences,
} from './startup-preferences-store';
import {
  shouldHandleSecondaryLaunch,
  shouldShowMainWindowOnReady,
  type StartupPreferencesSnapshot,
} from '../shared/startup-preferences';
import {
  shortcutPlatformFromProcess,
} from '../shared/shortcut-bindings';
import type {
  ShortcutBindingsSetResult,
  ShortcutFileExportResult,
  ShortcutFileImportResult,
} from '../shared/shortcut-api';

import { popupEditContextMenu } from "./edit-context-menu";
import {
  createFileClipboardDeps,
  readFilePathsFromClipboard,
  writeFilePathsToClipboard,
} from "./file-clipboard";
import {
  createOpenWithDeps,
  openPathWithOtherApplication,
  openPathWithProgram,
} from "./open-with";
import {
  bindWindowMaximizedEvents,
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
  ACTIVE_CONTEXT_CHANNEL,
  APP_LOCALE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  STARTUP_PREFERENCES_GET_CHANNEL,
  STARTUP_PREFERENCES_SET_CHANNEL,
  OPEN_WITH_CHOOSE_PROGRAM_CHANNEL,
  RULE_RUN_RECORDED_CHANNEL,
  RULE_INVOKE_CHANNEL,
  OPEN_WITH_SETTINGS_GET_CHANNEL,
  OPEN_WITH_SETTINGS_SET_CHANNEL,
  SHORTCUT_BINDINGS_EXPORT_CHANNEL,
  SHORTCUT_BINDINGS_GET_CHANNEL,
  SHORTCUT_BINDINGS_IMPORT_CHANNEL,
  SHORTCUT_BINDINGS_SET_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  READ_APP_LOG_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  SHELL_NOTIFY_CHANNEL,
  COMMAND_COMPLETED_CHANNEL,
  APPLICATION_MENU_ITEM_STATE_CHANNEL,
  LINKED_MISSING_VISIBILITY_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
  NATIVE_EDIT_COMMAND_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
  PLUGIN_INSTALL_PROGRESS_CHANNEL,
  EMBEDDING_INSTALL_PROGRESS_CHANNEL,
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
  PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL,
  VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL,
  BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL,
  APPLICATION_SHORTCUTS_ENABLED_CHANNEL,
  OFFSCREEN_THUMBNAIL_FRAME_CHANNEL,
  MCP_SETTINGS_REQUEST_CHANNEL,
  MCP_SETTINGS_EVENT_CHANNEL,
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
import { PluginHostCommandError } from '../shared/plugin-host-command-error';
import {
  APP_ASSET_HOST,
  createAppAssetResponse,
} from './app-assets';
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
import { EmbeddedMcpServer, EmbeddedMcpServerError } from './embedded-mcp-server';
import { McpCredentialStoreError } from './mcp-client-credentials';
import { McpPermissionBroker } from './mcp-permission-broker';
import { McpPermissionPolicyStore } from './mcp-permission-policy-store';
import { McpOperationChallengeStore } from './mcp-operation-challenge';
import { CriticalConfirmationWindowManager } from './critical-confirmation-window';
import { RendererCriticalConfirmationBroker } from './critical-confirmation-prompt';
import {
  mcpSettingsRequestSchema,
  mcpSettingsResponseSchema,
  mcpSettingsSnapshotSchema,
  type McpSettingsRequest,
} from '../shared/mcp';
import { registerAutomationScriptIpc } from './automation-script-ipc';
import { AutomationScriptFileService } from './automation-script-file-service';
import {
  createJsonFileAutomationRecentScriptsStore,
} from './automation-recent-scripts-store';
import { ScriptRuntimeSupervisor } from './script-runtime-supervisor';
import { PluginRuntimeSupervisor, type PluginRuntimeHostCommandHandler, type PluginRuntimeInputCaptureStartHandler, type PluginRuntimeJobControlHandler, type PluginRuntimeJobEnqueueHandler, type PluginRuntimeJobProgressHandler, type PluginRuntimeStorageHandler } from './plugin-runtime-supervisor';
import { normalizeAutomationAssetSearchInput } from './normalize-automation-asset-search-input';
import { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';
import { PluginInputCaptureBroker } from '../shared/plugin-input-capture';
import {
  parsePluginInputCapturePublishPayload,
  parsePluginInputCaptureSystemModalPayload,
  type PluginInputCaptureSessionsPayload,
} from '../shared/plugin-input-capture-renderer';
import { PluginActivationCoordinator } from './plugin-activation-coordinator';
import { PluginJobScheduler } from './plugin-job-scheduler';
import { PluginProviderScheduler } from './plugin-provider-scheduler';
import { pluginTargetLibraryIdSchema } from '../plugins/plugin-commands';
import {
  PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
  pluginHostCommandRequiresBoundLibrary,
  resolvePluginHostCommandLibraryId,
} from '../plugins/plugin-host-command-target';
import { PluginStorageStore, PluginStorageStoreError } from './plugin-storage-store';
import { PluginSettingsStore } from './plugin-settings-store';
import { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
import { PluginMcpToolProvider } from './plugin-mcp-tool-provider';
import { automationCapabilitiesFromPluginPermissions } from '../plugins/plugin-permission-capabilities';
import { createContributionRegistry } from '../plugins/plugin-contributions';
import { createPluginProviderRegistry } from '../plugins/plugin-providers';
import { pluginJobOwnerCanRetry, pluginJobOwnerMatches } from '../plugins/plugin-jobs';
import { loadOrCreatePluginDeviceId } from './plugin-device-identity';
import { createPluginPackageRequestHandler } from './plugin-package-ipc';
import { PluginPackageManager } from './plugin-package-manager';
import { PLUGIN_API_VERSION } from '../plugins/plugin-manifest';
import {
  validatePluginCauseChain,
} from '../plugins/plugin-domain-events';
import type { AutomationExecutionContext } from '../automation/command-gateway';
import {
  AUTOMATION_API_VERSION,
} from '../automation/command-registry';
import {
  attachLinuxRoundedCorners,
  linuxRoundedWindowOptions,
  shouldUseLinuxRoundedCorners,
} from "./linux-window-corners";
import {
  shouldHideApplicationMenuBar,
  shouldUseFramelessTitleBar,
} from "../shared/window-controls";
import { matchViewerVideoLetterShortcut, viewerShortcutRepeatForward } from "../shared/viewer-video-shortcuts";
import {
  resolveOpenExternalUrlTarget,
  type OpenExternalUrlResult,
  type RevealAppLogResult,
} from "../shared/external-url";
import { parseReadAppLogRequest, type ReadAppLogResult } from "../shared/app-log";
import type { ShowEditContextMenuResult } from "../shared/edit-context-menu";
import {
  createPublicError,
  toPublicError,
} from "../shared/protocol/errors";
import {
  LibraryParentError,
} from "../worker/library/library-parent";
import {
  parseNativeAssetDragRequest,
  parseRendererRequest,
  tryParseActiveContext,
  type RendererRequest,
  type WorkerCommand,
} from "../shared/protocol/requests";
import {
  type RendererResult,
  type WorkerResult,
  type ImageSequenceImportOffer,
} from "../shared/protocol/responses";
import { LibraryWorkerClient, WorkerRequestTimeoutError } from "./worker-client";
import { performanceConsumerIdForWindow } from "../shared/performance-contract";
import { SyncAutoScheduler, type SyncBindingLike } from "./sync-auto-scheduler";
import { AppLogger } from "./app-logger";
import { loadRendererDevUrl } from "./dev-renderer-load";
import { chooseUniqueSessionLogPath, pruneSessionLogs } from "./session-log";
import {
  logRendererChildProcessGone,
  logRendererConsoleMessage,
  logRendererProcessGone,
  logRendererResponsive,
  logRendererUnresponsive,
} from "./renderer-diagnostics";
import { pickIsolatedWindowPlacement } from "./e2e-isolated-window";
import {
  clearActiveRecentLibrary,
  recentLibraryAutoOpenEnabled,
  readActiveLibraryPath,
  readRecentLibraryEntries,
  removeRecentLibrary,
} from "./recent-libraries";
import {
  readPendingCleanupAsidePaths,
  writePendingCleanupAsidePaths,
} from "./pending-cleanup-store";
import { resolvePendingImportFrame } from "./pending-import-frame";
import { createFontSamplePage, resolveFontSampleRequest } from "./font-sample-page";
import { createArtifactResponse } from "./artifact-response";
import { PreviewCache } from "./preview-cache";
import {
  bindLibraryMediaReadSignal,
  beginLibraryDeleteMediaFence,
  endLibraryDeleteMediaFence,
  isLibraryMediaReadBlocked,
  unblockLibraryMediaReads,
} from "./library-media-reads";
import {
  createOffscreenThumbnailRenderer,
  packagedRendererOutDir,
  resolveOffscreenPageUrl,
} from "./offscreen-thumbnail-renderer";
import { renderDocumentThumbnail } from "./document-thumbnail-renderer";
import {
  clearModelThumbnailSourceAuthorizations,
  registerModelThumbnailSourceAuthorizations,
  resolveModelThumbnailSourceAuthorization,
} from "./model-thumbnail-source-cache";
import {
  createExtensionServer,
} from "./extension-server";
import {
  recordExtensionBrowseFolder,
} from "./extension-recent-browse-folders";
import { RelinkPreviewStore } from "./relink-preview-store";
import {
  cleanupClipboardImage,
  cleanupStaleClipboardImages,
} from "./desktop-ingestion";
import {
  KEEL_PLUGIN_PROTOCOL_SCHEME,
  KEEL_PROTOCOL_SCHEME,
  handleProtocolWithLegacyAlias,
  legacyProtocolSchemes,
  keelProtocolSchemes,
} from "./keel-protocol-privileges";
import {
  parsePluginUiAssetRequestFromNavigation,
  rewritePluginUiHtmlAssetUrls,
  pluginUiMimeType,
} from "./plugin-ui-assets";

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

function embeddingIndex(): EmbeddingTestIndex {
  state.embeddingTestIndex ??= new EmbeddingTestIndex({
    configDirectories: [process.cwd(), app.getAppPath()],
    ...(process.platform === "win32"
      ? { koffiPath: createRequire(path.join(app.getAppPath(), "package.json")).resolve("koffi") }
      : {}),
    requestWorker: (command) => {
      if (!state.workerClient) return Promise.reject(new Error("Library Worker is unavailable."));
      return state.workerClient.request(command);
    },
    installedLayout: (modelId) => resolveInstalledEmbeddingLayout(
      inspectManagedEmbeddingInstall(app.getPath("userData")),
      modelId,
    ),
    resolveMediaBinaries: resolveHostMediaBinaries,
  });
  return state.embeddingTestIndex;
}

function embeddingHttp(): EmbeddingHttpIndex {
  state.embeddingHttpIndex ??= new EmbeddingHttpIndex({
    requestWorker: (command) => {
      if (!state.workerClient) return Promise.reject(new Error("Library Worker is unavailable."));
      return state.workerClient.request(command);
    },
    loadService: (id) => parseEmbeddingServiceCatalog(readEmbeddingServices()).services.find((service) => service.id === id) ?? null,
    readKey: readEmbeddingServiceKey,
    isLibraryEnabled: (libraryId, serviceId) => {
      const binding = readEmbeddingBindings()[libraryId];
      // Renderer selects the global default when the library inherits settings.
      // Main does not own that preference; an absent per-library binding must
      // therefore allow the already-routed service request.
      if (!binding) return true;
      const defaultModelId = parseEmbeddingModelCatalog(readEmbeddingModels()).defaultModelId ?? "";
      return resolveEffectiveEmbeddingSelection({
        globalEnabled: true,
        defaultModelId,
        libraryBinding: binding,
      }) === serviceId;
    },
  });
  return state.embeddingHttpIndex;
}
const manualSyncRuns = new Map<string, {
  count: number;
  serverId: string;
  directoryName?: string;
  savedBindingDuringRun: boolean;
}>();
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
const VIEWER_TIMING_LOG = process.env.KEEL_VIEWER_TIMING_LOG === "1";
const ruleMcpTools = createRuleMcpTools({ ruleRunner: () => state.ruleRunner, workerClient: () => state.workerClient });
const pluginAutomationContexts = new Map<string, AutomationExecutionContext>();

function buildPluginInputCaptureSessionsPayload(): PluginInputCaptureSessionsPayload {
  const sessions = state.pluginInputCaptureBroker?.activeSessions() ?? [];
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      scope: session.scope,
      ...(session.ownerViewId === undefined ? {} : { ownerViewId: session.ownerViewId }),
      keyboard: session.keyboard,
      pointer: session.pointer,
    })),
  };
}

function publishPluginInputCaptureSessionsToRenderer(): void {
  if (!state.mainWindow) return;
  state.mainWindow.webContents.send(
    PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
    buildPluginInputCaptureSessionsPayload(),
  );
}

function schedulePluginInputCaptureFlush(): void {
  if (state.pluginInputCaptureFlushTimer !== undefined) return;
  state.pluginInputCaptureFlushTimer = setTimeout(() => {
    state.pluginInputCaptureFlushTimer = undefined;
    state.pluginInputCaptureBroker?.flush();
  }, 0);
}

function pendingLibraryCleanupPath(): string {
  return path.join(app.getPath("userData"), "pending-library-cleanup.json");
}

// Serpent-65d837: backoff schedule for asking the Worker to remove `.del-*`
// aside roots left behind by a disk deletion. Windows handles (Defender scan,
// Explorer, lingering `keel://` streams) usually close within seconds, so a
// few short retries resolve it without user action; anything still remaining
// stays persisted and is retried on the next app launch.
const PENDING_CLEANUP_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * Fire-and-forget: tells the Worker to remove every persisted `.del-*` aside
 * root, drops the paths that succeeded from the store, and keeps retrying the
 * remaining ones with a bounded backoff. Callers: after a deletion reported a
 * pending aside, and after the Worker becomes ready at startup.
 */
function retryPendingLibraryCleanups(): void {
  if (state.pendingCleanupRetryTimer) return;
  void runPendingLibraryCleanups(0);
}

async function runPendingLibraryCleanups(round: number): Promise<void> {
  const pendingPath = pendingLibraryCleanupPath();
  const asidePaths = readPendingCleanupAsidePaths(pendingPath, (error) => {
    state.logger?.error("pending-library-cleanup.read", error);
  });
  if (asidePaths.length === 0) return;
  if (!state.workerClient) return;
  let cleanedPaths: string[];
  let remainingPaths: string[];
  try {
    const outcome = await state.workerClient.request({
      type: "system.cleanup-pending-deletions",
      asidePaths,
    });
    if (outcome.ok && outcome.type === "system.cleanup-pending-deletions") {
      cleanedPaths = outcome.cleanedPaths;
      remainingPaths = outcome.remainingPaths;
    } else {
      cleanedPaths = [];
      remainingPaths = asidePaths;
    }
  } catch (error) {
    cleanedPaths = [];
    remainingPaths = asidePaths;
    state.logger?.error(
      "pending-library-cleanup.run",
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  const stillPersisted = readPendingCleanupAsidePaths(pendingPath, (error) => {
    state.logger?.error("pending-library-cleanup.read", error);
  });
  const remainingSet = new Set(remainingPaths);
  const next = stillPersisted.filter((sidePath) => remainingSet.has(sidePath));
  if (next.length === 0) {
    writePendingCleanupAsidePaths(pendingPath, [], (error) => {
      state.logger?.error("pending-library-cleanup.write", error);
    });
    return;
  }
  writePendingCleanupAsidePaths(pendingPath, next, (error) => {
    state.logger?.error("pending-library-cleanup.write", error);
  });
  if (cleanedPaths.length > 0) {
    state.logger?.info("pending-library-cleanup.deferred", "Removed leftover library roots.", {
      cleanedCount: cleanedPaths.length,
    });
  }
  const delay = PENDING_CLEANUP_RETRY_DELAYS_MS[round];
  if (delay === undefined) {
    state.logger?.info("pending-library-cleanup.still-pending", "Pending cleanup will retry on next launch.", {
      remaining: next.length,
    });
    return;
  }
  state.pendingCleanupRetry = round + 1;
  state.pendingCleanupRetryTimer = setTimeout(() => {
    state.pendingCleanupRetryTimer = undefined;
    void runPendingLibraryCleanups(state.pendingCleanupRetry);
  }, delay);
}

function currentPluginCompatibilityPlatform():
  | { platform: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64' | 'ia32' }
  | undefined {
  const platform = process.platform;
  const arch = process.arch;
  if ((platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')
    || (arch !== 'arm64' && arch !== 'x64' && arch !== 'ia32')) {
    return undefined;
  }
  return { platform, arch };
}

// Keeps selected roots in Main. Renderer receives only an opaque, one-shot token.
const pendingRelinkPreviews = new RelinkPreviewStore();
import type { ActiveLibraryOpenCancellation } from "./main-state";
import { activateAiConnectionProfile, deleteAiConnectionProfile, deleteEmbeddingServiceKey, embeddingServiceKeyPath, getDecryptedApiKey, getDecryptedProfileApiKey, loadAiConfig, readEmbeddingBindings, readEmbeddingModels, readEmbeddingServiceKey, readEmbeddingServices, readSyncBindings, readSyncServers, resolveSyncServerCredentials, saveAiConfig, saveAiConnectionProfile, writeEmbeddingBindings, writeEmbeddingModels, writeEmbeddingServiceKey, writeEmbeddingServices, writeSyncBindings, writeSyncServers } from './ai-settings-files';
import { cleanupAllExternalSources, cleanupExternalSource, fallbackDirectoryForLibraryId, materializeSelectedExternalLibrary, pendingImportSources, recentLibraryPath, rememberExternalSource, sweepOrphanExternalLibraryStagingOnStartup } from './external-library-staging';
import { exportShortcutBindingsFile, importShortcutBindingsFile, nativeMenuRecentLibraries, readShortcutBindingsSnapshot, readStartupPreferencesSnapshot, startupPreferencesPath, storeShortcutBindings, storeStartupPreferences } from './app-preference-files';
import { artifactPathCache, cancelArtifactPathBatches, clearArtifactPathCache, clearNativeAssetDragCache, lastVisibleDragAssetIds, nativeAssetDragCache, nativeAssetDragPrimer, resolveArtifactPathBatched, sourcePathCache } from './asset-path-caches';
import { confirmCriticalRendererRequest, confirmDesktopAutomationFilePlan, confirmDesktopAutomationWrite, confirmEnableAllMcpPermissions, confirmRuleRun, criticalRendererRequest } from './desktop-confirmations';
import { runScheduledRules, scheduleLibraryChangeRules } from './rule-triggers';
import { aiQueueScheduler, enqueueAutoAnalyzeAfterImport, processAiQueue } from './ai-queue';
import { createNativeDialogHost, selectAutomationScriptToOpen, selectAutomationScriptToSave, selectDirectory, selectImportSources, selectPluginPackageForInstall } from './main-dialogs';
import { publishAiCleared, publishAiCompleted, publishAiProgress, publishAssetChange, publishLibraryChanged, publishLifecycle, publishProgress } from './renderer-events';
import { focusKeelWindow, focusedContexts, handleListFolders, handleSaveIntent, handleSaveUpload } from './extension-save';
import { notifyLibraryOpenedSideEffects, pluginThumbnailExtensionsFor, refreshApplicationMenuRecentLibraries, rememberOpenedLibrary, syncPluginCompanionExtensions, syncPluginThumbnailExtensions } from './library-opened';
import { executeMcpLibraryContextCommand, normalizeMcpCommandInput } from './mcp-library-context';

// Pending import libraryId (importId -> libraryId), for auto-analyze after import.
const pendingImportLibraries = new Map<string, string>();

type StoredImageSequenceOffer = ImageSequenceImportOffer;

const pendingImageSequenceOffers = new Map<
  string,
  {
    offer: StoredImageSequenceOffer;
    expiresAt: number;
    nextSequenceIndex: number;
  }
>();

function rememberImageSequenceOffer(
  offer: StoredImageSequenceOffer,
): StoredImageSequenceOffer {
  const offerId = randomUUID();
  pendingImageSequenceOffers.set(offerId, {
    offer,
    expiresAt: Date.now() + 10 * 60_000,
    nextSequenceIndex: 0,
  });
  for (const [id, entry] of pendingImageSequenceOffers) {
    if (entry.expiresAt <= Date.now()) pendingImageSequenceOffers.delete(id);
  }
  return {
    defaultFps: offer.defaultFps,
    libraryId: offer.libraryId,
    offerId,
    sequences: offer.sequences.map((sequence) => ({
      displayName: sequence.displayName,
      extension: sequence.extension,
      firstFrame: sequence.firstFrame,
      frameCount: sequence.frameCount,
      height: sequence.height,
      lastFrame: sequence.lastFrame,
      numberStyle: sequence.numberStyle,
      numericWidth: sequence.numericWidth,
      prefix: sequence.prefix,
      width: sequence.width,
    })),
    ...(offer.targetFolderId ? { targetFolderId: offer.targetFolderId } : {}),
  };
}

function focusMainWindow(): boolean {
  return focusKeelWindow(
    state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.id : undefined,
  );
}

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

/** Launched by `Keel.exe --mcp`: start the MCP server, stay in the background. */
const launchedForMcp = process.argv.includes(MCP_START_FLAG);

async function startMcpForLauncher(): Promise<void> {
  try {
    if (state.embeddedMcpServer?.snapshot().runtime.status !== "running") await state.embeddedMcpServer?.start();
  } catch (error) {
    state.logger?.error("mcp.server.launcher-start", error);
  }
}

function handleSecondInstance(_event: Electron.Event, argv: string[]): void {
  if (!shouldHandleSecondaryLaunch({ applicationQuitting: state.applicationQuitting })) return;
  if (argv.includes(MCP_START_FLAG)) {
    void startMcpForLauncher();
    return;
  }
  // A second launch while Vite is preparing its first module graph must not
  // reload the still-loading window and reset its mount deadline.
  focusMainWindow();
}

/**
 * Isolated-session placement for `KEEL_E2E_ISOLATED=1`: real E2E must keep
 * real `show()`/focus semantics (an earlier `showInactive` attempt broke
 * keyboard/focus tests and was reverted — see
 * docs/internal/development/2026-07-19-e2e-isolated-session-development-log.md), so
 * this only changes *where* the window appears, never how it is shown.
 * When a non-primary display exists, the window is placed fully within it;
 * on a single-display Mac there is no isolation available yet and the
 * window falls back to the primary display (logged, not silent).
 */
function resolveE2eIsolatedPlacement(
  defaultSize: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined {
  if (process.env.KEEL_E2E_ISOLATED !== "1") return undefined;

  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
  }));
  const primaryDisplayId = screen.getPrimaryDisplay().id;
  const placement = pickIsolatedWindowPlacement(
    displays,
    primaryDisplayId,
    defaultSize,
  );

  if (placement) {
    state.logger?.info(
      "e2e.isolated-window",
      "Placing the E2E window on a secondary display so it does not steal foreground focus.",
      { ...placement },
    );
    return placement;
  }

  state.logger?.info(
    "e2e.isolated-window",
    "KEEL_E2E_ISOLATED=1 was set but no secondary display was detected; " +
      "falling back to the primary display. The E2E window will steal " +
      "foreground focus on this machine (documented limitation of Serpent-a1b).",
    { displayCount: displays.length },
  );
  return undefined;
}

function attachRendererDiagnostics(window: BrowserWindow): void {
  window.webContents.on(
    "console-message",
    (details) => {
      logRendererConsoleMessage(
        state.logger,
        details.level,
        details.message,
        details.lineNumber,
        details.sourceId,
      );
    },
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    logRendererProcessGone(state.logger, window.id, details);
  });
  window.webContents.on("unresponsive", () => {
    logRendererUnresponsive(state.logger, window.id);
  });
  window.webContents.on("responsive", () => {
    logRendererResponsive(state.logger, window.id);
  });
}

async function createMainWindow(): Promise<void> {
  const defaultWidth = 1440;
  const defaultHeight = 900;
  const isolatedPlacement = resolveE2eIsolatedPlacement({
    width: defaultWidth,
    height: defaultHeight,
  });

  const devIcon = appIconImage();
  // Serpent-tluf: the macOS dock otherwise shows the default Electron icon
  // in dev builds (packaged apps ship the real .icns).
  if (process.platform === "darwin" && devIcon) {
    app.dock?.setIcon(devIcon);
  }

  const linuxRoundedCorners = shouldUseLinuxRoundedCorners();
  const window = new BrowserWindow({
    width: isolatedPlacement?.width ?? defaultWidth,
    height: isolatedPlacement?.height ?? defaultHeight,
    ...(isolatedPlacement
      ? { x: isolatedPlacement.x, y: isolatedPlacement.y }
      : {}),
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#111417",
    ...(devIcon ? { icon: devIcon } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 16 },
        }
      : shouldUseFramelessTitleBar(process.platform)
        ? {
            // Serpent-znex: hide system title bar; renderer draws caption buttons.
            titleBarStyle: "hidden" as const,
          }
        : {}),
    ...(linuxRoundedCorners ? linuxRoundedWindowOptions() : {}),
    webPreferences: {
      preload: path.join(__dirname, "index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The opt-in performance harness needs frames while remaining hidden.
      ...(process.env.KEEL_E2E === "1" && process.env.KEEL_E2E_PERF_OFFSCREEN === "1"
        ? { offscreen: true, backgroundThrottling: false }
        : {}),
    },
  });

  state.mainWindow = window;
  if (linuxRoundedCorners) attachLinuxRoundedCorners(window);
  const mainContentsId = window.webContents.id;
  // Keep renderer diagnostics active in both development and packaged builds.
  // A blank window in a packaged build must leave the same evidence as one
  // started from Vite; idle windows produce no log entries.
  attachRendererDiagnostics(window);
  const showMainWindowIfAllowed = (): void => {
    // E2E can keep its renderer fully loaded and automatable without putting
    // a test window over the user's desktop session. An update handoff stays
    // hidden so a second launch cannot flash a window.
    const e2eShowInactive = process.env.KEEL_E2E === "1"
      && process.env.KEEL_E2E_SHOW_INACTIVE === "1";
    if (shouldShowMainWindowOnReady({
      applicationQuitting: state.applicationQuitting,
      e2eHideWindow: process.env.KEEL_E2E === "1"
        && process.env.KEEL_E2E_HIDE_WINDOW === "1"
        && !e2eShowInactive,
    })) {
      if (window.isVisible()) return;
      if (launchedForMcp) {
        // Started by the MCP launcher: keep the window out of the way.
        window.showInactive();
        window.minimize();
      } else if (e2eShowInactive) window.showInactive();
      else window.show();
    }
  };
  window.on("ready-to-show", showMainWindowIfAllowed);
  // Cleanup while webContents/HWND still exist (`closed` is too late).
  window.on("close", () => {
    clearViewerVideoShortcutCapture(mainContentsId);
  });
  window.on("closed", () => {
    if (state.mainWindow === window) {
      focusedContexts.delete(window.id);
      state.mainWindow = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.on("will-download", (event, item) => {
    if (item.getURL().startsWith("keel-plugin:")) event.preventDefault();
  });
  // VIEWER-018: letter keys under CJK IME — Menu accelerators + IMM32 suspend
  // are primary on Windows; before-input remains a cross-platform fallback.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    const captureType = input.type === 'keyUp' ? 'keyup' : 'keydown';
    const captureResult = state.pluginInputCaptureBroker?.publish({
      target: { scope: 'application' },
      event: {
        type: captureType,
        timestamp: Date.now(),
        key: input.key,
        code: input.code,
        repeat: input.isAutoRepeat,
        altKey: input.alt,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
        isComposing: input.isComposing,
      },
    });
    if (captureResult === 'delivered' || captureResult === 'queued') {
      event.preventDefault();
      return;
    }
    if (shouldHideApplicationMenuBar(process.platform)) {
      const appAction = input.type === "keyDown"
        ? matchWindowsApplicationShortcut({
            key: input.key,
            code: input.code,
            keyCode: (input as { keyCode?: number }).keyCode,
            control: input.control,
            meta: input.meta,
            alt: input.alt,
            shift: input.shift,
            isAutoRepeat: input.isAutoRepeat,
          })
        : null;
      const repeatedAppAction = input.type === "keyDown" && input.isAutoRepeat
        ? isWindowsApplicationShortcut({
            key: input.key,
            code: input.code,
            keyCode: (input as { keyCode?: number }).keyCode,
            control: input.control,
            meta: input.meta,
            alt: input.alt,
            shift: input.shift,
          })
        : false;
      if (appAction || repeatedAppAction) {
        event.preventDefault();
        if (appAction) forwardApplicationShortcutToWindow(window, appAction);
        return;
      }
      const browseInput = {
        type: input.type,
        code: input.code,
        key: input.key,
        keyCode: (input as { keyCode?: number }).keyCode,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      };
      const browseAction = matchBrowseKeyboardShortcut(browseInput, {
        bindings: readShortcutBindingsSnapshot(),
        platform: shortcutPlatformFromProcess(process.platform),
      });
      if (browseAction) {
        if (browseAction === "copy-path") {
          event.preventDefault();
          forwardBrowseShortcut(window.webContents, browseAction, {
            key: input.key,
            code: input.code,
            ctrlKey: input.control,
            metaKey: input.meta,
            altKey: input.alt,
            shiftKey: input.shift,
          });
        } else {
          forwardBrowseShortcut(window.webContents, browseAction);
        }
      }
    }
    if (!isViewerVideoShortcutContentsActive(window.webContents.id)) {
      return;
    }
    const viewerScope = viewerShortcutScopeForContents(window.webContents.id);
    if (viewerScope === null) return;
    const viewerInput = {
      type: input.type,
      code: input.code,
      key: input.key,
      keyCode: (input as { keyCode?: number }).keyCode,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
      isAutoRepeat: input.isAutoRepeat,
    };
    const bindings = readShortcutBindingsSnapshot();
    const platform = shortcutPlatformFromProcess(process.platform);
    const action = matchViewerVideoLetterShortcut(
      viewerInput,
      bindings,
      platform,
      viewerScope,
    );
    const repeatedViewerAction = input.type === "keyDown" && input.isAutoRepeat
      ? matchViewerVideoLetterShortcut(
        { ...viewerInput, isAutoRepeat: false },
        bindings,
        platform,
        viewerScope,
      )
      : null;
    if (!action && !repeatedViewerAction) return;
    event.preventDefault();
    const forward = viewerShortcutRepeatForward(action, repeatedViewerAction);
    if (forward) {
      forwardViewerVideoShortcut(window.webContents, forward.action, {
        repeat: forward.repeat,
      });
    }
  });
  // Defense in depth (Serpent-46i9): even if a page-zoom accelerator sneaks
  // back into the menu, Chromium must not rescale the whole UI.
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  // Serpent-znex: keep caption maximize/restore glyph in sync on Windows.
  if (shouldUseFramelessTitleBar(process.platform)) {
    bindWindowMaximizedEvents(window);
  }
  // macOS three-finger swipe (requires Trackpad → Swipe between pages).
  // Event is on BrowserWindow, not webContents.
  window.on("swipe", (_event, direction) => {
    sendToLiveWebContents(window.webContents, SHELL_SWIPE_CHANNEL, direction);
  });

  const publishWindowFocus = () => {
    if (window.isDestroyed()) return;
    if (window.isFocused()) {
      state.lastExtensionTargetWindowId = window.id;
    }
    sendToLiveWebContents(window.webContents, WINDOW_FOCUS_CHANNEL, {
      focused: window.isFocused(),
    });
  };
  window.on("focus", publishWindowFocus);
  window.on("blur", () => {
    state.pluginInputCaptureBroker?.releaseForWindowBlur();
    publishWindowFocus();
  });
  window.once("ready-to-show", publishWindowFocus);
  window.webContents.once("did-finish-load", () => {
    publishPluginInputCaptureSessionsToRenderer();
    if (state.pendingPluginDeviceStateRecoveryNotice) {
      state.pendingPluginDeviceStateRecoveryNotice = false;
      window.webContents.send(SHELL_NOTIFY_CHANNEL, {
        severity: 'warning',
        mode: 'toast',
        message: '插件授权设置已重置，原设置已备份；如需使用插件，请重新授权。',
      });
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    let devModuleNetworkChanged = false;
    const devOrigin = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    const devSession = window.webContents.session;
    devSession.webRequest.onErrorOccurred(
      { urls: [`${devOrigin}/*`] },
      (details) => {
        if (details.webContentsId === window.webContents.id
          && details.resourceType === "script"
          && details.error === "net::ERR_NETWORK_CHANGED") {
          devModuleNetworkChanged = true;
        }
      },
    );
    window.once("closed", () => {
      devSession.webRequest.onErrorOccurred(null);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // aborted
      const detail = [
        `Failed to load renderer (${errorCode}): ${errorDescription}`,
        validatedURL ? `URL: ${validatedURL}` : null,
        "If the window is black after npm start, a Vite port conflict is likely.",
        "Use `npm start` (auto free port) or free the process on 5173.",
      ]
        .filter(Boolean)
        .join("\n");
      state.logger?.error("main.window.load", detail);
      dialog.showErrorBox("Keel renderer failed to load", detail);
    });
    try {
      await loadRendererDevUrl(window, MAIN_WINDOW_VITE_DEV_SERVER_URL, state.logger, {
        consumeNetworkChange: () => {
          const changed = devModuleNetworkChanged;
          devModuleNetworkChanged = false;
          return changed;
        },
        // A cold Vite module graph can leave a hidden BrowserWindow without a
        // first paint. Showing it after navigation lets Chromium schedule the
        // Renderer normally; the E2E hidden-window policy is still respected.
        onNavigated: () => {
          const visibleBefore = window.isVisible();
          showMainWindowIfAllowed();
          state.logger?.info("main.window.dev-navigation", "Renderer navigation completed.", {
            visibleBefore,
            visibleAfter: window.isVisible(),
          });
        },
      });
    } catch (error) {
      state.logger?.error("main.window.dev-load", error);
      dialog.showErrorBox(
        "Keel renderer failed to load",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

function cancelled(): RendererResult {
  return { ok: false, error: createPublicError("CANCELLED") };
}

function isLibraryOpenRequest(request: RendererRequest): boolean {
  return request.type === "library.create.request"
    || request.type === "library.open.request"
    || request.type === "library.open-recent.request"
    || request.type === "library.open-eagle.request"
    || request.type === "library.open-billfish.request";
}

async function closeOpenLibrariesBeforeReplacement(): Promise<string[]> {
  const previousPaths: string[] = [];
  if (!state.workerClient) return previousPaths;
  try {
    const listed = await state.workerClient.request({ type: "library.list" });
    if (!listed.ok || listed.type !== "library.list") return previousPaths;
    for (const library of listed.libraries) {
      previousPaths.push(library.libraryPath);
      try {
        const closed = await state.workerClient.request({
          type: "library.close",
          libraryId: library.libraryId,
        });
        if (!closed.ok || closed.type !== "library.closed") continue;
        clearNativeAssetDragCache(library.libraryId);
        clearActiveRecentLibrary(recentLibraryPath(), (error) => {
          state.logger?.error("recent-library.clear", error);
        });
        publishLifecycle({
          type: "library.closed",
          libraryId: library.libraryId,
        });
      } catch (error) {
        state.logger?.error("external-library-open.close-previous", error, {
          libraryId: library.libraryId,
        });
      }
    }
  } catch (error) {
    state.logger?.error("external-library-open.list-previous", error);
  }
  return previousPaths;
}

async function reopenLibrariesAfterFailedReplacement(
  libraryPaths: readonly string[],
): Promise<void> {
  if (!state.workerClient || libraryPaths.length === 0) return;
  for (const selectedLibraryPath of libraryPaths) {
    try {
      const opened = await state.workerClient.request({
        type: "library.open",
        selectedLibraryPath,
      });
      if (!opened.ok || opened.type !== "library.opened") continue;
      publishLifecycle({
        type: "library.opened",
        library: {
          libraryId: opened.library.libraryId,
          displayName: opened.library.displayName,
          storageLayout: opened.library.storageLayout,
          displayPath: opened.library.libraryPath,
        },
        source: "replacement-restore",
      });
    } catch (error) {
      state.logger?.error("external-library-open.restore-previous", error, {
        selectedLibraryPath,
      });
    }
  }
}

/** Serpent-xffq：每台设备的稳定同步身份（userData 持久化，非敏感）。 */
function syncDeviceId(): string {
  if (state.cachedSyncDeviceId) return state.cachedSyncDeviceId;
  const file = path.join(app.getPath('userData'), 'sync-device.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { deviceId?: string };
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.length > 0) {
      state.cachedSyncDeviceId = parsed.deviceId;
      return parsed.deviceId;
    }
  } catch {
    // 首次运行。
  }
  const deviceId = randomUUID();
  try {
    writeFileSync(file, JSON.stringify({ deviceId }), 'utf-8');
  } catch {
    // 写入失败仍返回本次进程内稳定 ID。
  }
  state.cachedSyncDeviceId = deviceId;
  return deviceId;
}

async function commandFor(
  request: RendererRequest,
  callbacks?: {
    onBillfishSourceSelected?: () => void;
  },
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "library.create.request":
    case "library.open.request":
    case "library.recovery-report.request":
    case "library.inspect-eagle.request":
    case "library.inspect-billfish.request":
    case "library.inspect-eagle.cancel.request":
    case "library.inspect-billfish.cancel.request":
    case "library.open-eagle.request":
    case "library.open-billfish.request":
    case "library.close.request":
    case "library.rename.request":
    case "library.delete-from-disk.request":
    case "library.list.request":
    case "history.status.request":
    case "history.undo.request":
    case "history.redo.request":
    case "library.list-recent.request":
    case "library.open-recent.request":
    case "library.forget-recent.request":
    case "library.open-cancel.request":
    case "library.choose-path.request": {
      return executeLibraryMainCommand(request, {
        selectDirectory,
        createNativeDialogHost,
        cleanupExternalSource,
        getPendingEagleOpenSourcePath: () => state.pendingEagleOpenSourcePath,
        setPendingEagleOpenSourcePath: (value) => { state.pendingEagleOpenSourcePath = value; },
        getPendingBillfishOpenSourcePath: () => state.pendingBillfishOpenSourcePath,
        setPendingBillfishOpenSourcePath: (value) => { state.pendingBillfishOpenSourcePath = value; },
        materializeSelectedExternalLibrary,
        rememberExternalSource,
      }, callbacks);
    }
    case "folder.create.request":
    case "folder.rename.request":
    case "appearance.set.request":
    case "folder.cover.set.request":
    case "folder.cover.clear.request":
    case "folder.cover.set-asset.request":
    case "folder.list.request":
    case "folder.browse-entries.request":
    case "folder.filtered-counts.request":
    case "folder.entries-request":
    case "folder.indexed-bytes.request":
    case "folder.trash.request":
    case "selection.trash.request":
    case "folder.delete-from-disk.request":
    case "linked-folder.remove.request":
    case "linked-folder.delete-subtree.request":
    case "linked-folder.create-directory.request":
    case "linked-folder.rename-directory.request":
    case "folder.open-in-file-manager.request":
    case "folder.open-with.request":
    case "folder.copy-path.request":
    case "folder.copy.request":
    case "folder.paste.request":
    case "folder.clone.request":
    case "folder.move.request": {
      return executeFolderMainCommand(request, { createNativeDialogHost });
    }
    case "asset.list.request": {
      return executeAssetQueryMainCommand(request);
    }
    case "asset.import-files.request":
    case "asset.import-folder.request":
    case "asset.import-eagle.request":
    case "asset.import-billfish.request":
    case "asset.import-drop.request":
    case "asset.resolve-dropped-paths.request":
    case "asset.import-sequence.confirm":
    case "asset.import-drop-invalid.report":
    case "asset.import-web.request":
    case "asset.import-web-invalid.report":
    case "asset.import-clipboard.request":
    case "asset.import.resolve":
    case "asset.import.skip-source-failure":
    case "asset.import.abandon":
    case "asset.refresh.request":
    case "asset.import-linked.request": {
      return executeAssetIngestionMainCommand(request, {
        selectImportSources,
        createNativeDialogHost,
        materializeSelectedExternalLibrary,
        rememberExternalSource,
        fallbackDirectoryForLibraryId,
        isUnpackagedE2e: () => !app.isPackaged && process.env.KEEL_E2E === "1",
      });
    }
    case "linked-folder.list.request":
    case "linked-folder.relink.request":
    case "linked-folder.rules.get.request":
    case "linked-folder.rules.set.request": {
      return executeLinkedFolderMainCommand(request, {
        createNativeDialogHost,
      });
    }
    case "ignore.list.request":
    case "ignore.gitignore.get.request":
    case "ignore.gitignore.preview.request":
    case "ignore.gitignore.set.request":
    case "ignore.set.request": {
      return executeIgnoreMainCommand(request);
    }
    case "linked-folder.assets.copy.request":
    case "linked-folder.convert.request": {
      return executeLinkedFolderMainCommand(request, {
        createNativeDialogHost,
      });
    }
    case 'automatic-task.layout.get.request':return {type:'automatic-task.layout.get',libraryId:request.libraryId};
    case 'automatic-task.layout.set.request':return {type:'automatic-task.layout.set',libraryId:request.libraryId,layout:request.layout};
    case 'automatic-task.list.request':return {type:'automatic-task.list',libraryId:request.libraryId};
    case 'automatic-task.set.request':return {type:'automatic-task.set',libraryId:request.libraryId,config:request.config};
    case 'automatic-task.delete.request':return {type:'automatic-task.delete',libraryId:request.libraryId,taskId:request.taskId};
    case 'automatic-task.run.request':return {type:'automatic-task.run',libraryId:request.libraryId,taskId:request.taskId};
    case "tag.list.request":
    case "tag.create.request":
    case "tag.rename.request":
    case "tag.delete.request":
    case "tag.delete-many.request":
    case "tag.merge.request":
    case "tag.cooccurrence.request":
    case "tag.assign.request":
    case "tag.remove.request": {
      return executeTagMainCommand(request);
    }
    case "asset.metadata.get.request":
    case "asset.extracted-metadata.get.request":
    case "asset.color-space.set.request":
    case "asset.metadata.set.request":
    case "asset.metadata.backfill.request":
    case "asset.rating.set.request":
    case "asset.search.request": {
      return executeAssetQueryMainCommand(request);
    }
    case "browse.session.open.request":
    case "browse.session.page.request":
    case "browse.session.ids.request":
    case "browse.session.close.request":
    case "library.navigation-summary.request":
    case "ai.search-plan.request": {
      return executeBrowseSessionMainCommand(request);
    }
    case "asset.trash.request":
    case "asset.sequence.create.request":
    case "asset.sequence.dissolve.request":
    case "asset.sequence.dissolve-batch.request":
    case "asset.sequence.set-fps.request":
    case "asset.restore.request":
    case "asset.restore-preview.request":
    case "asset.move.request":
    case "asset.move-undo.request":
    case "asset.copy.request":
    case "asset.copy-undo.request":
    case "asset.rename-file.request":
    case "asset.zip.list.request":
    case "asset.zip.read-entry.request":
    case "asset.text.read.request":
    case "asset.text.save.request":
    case "asset.delete-permanent.request":
    case "asset.delete-from-disk.request":
    case "trash.list.request":
    case "trash.list-folders.request":
    case "trash.restore-folder.request":
    case "trash.purge.request":
    case "asset.delete-linked.request":
    case "asset.relink.request":
    case "asset.relink-batch.preview-at-root.request":
    case "asset.relink-batch.request":
    case "asset.relink-batch.apply.request":
    case "asset.relink-batch.cancel.request": {
      return executeAssetMutationMainCommand(request, {
        createNativeDialogHost,
        consumeRelinkPreview: (libraryId, previewId) =>
          pendingRelinkPreviews.consume(libraryId, previewId),
      });
    }
    case "library.export.request":
    case "library.export.cancel.request":
    case "library.import.request":
    case "library.import-zip.request":
    case "library.import.cancel.request":
    case "asset.delete-cancel.request":
    case "library.import.copy.request":
    case "library.import.open-in-place.request": {
      return executeLibraryTransferMainCommand(request, {
        createNativeDialogHost,
        downloadsPath: () => app.getPath("downloads"),
        pendingImportSources,
      });
    }
    case "ai.config.get.request":
    case "ai.config.set.request":
    case "ai.profiles.save.request":
    case "ai.profiles.activate.request":
    case "ai.profiles.delete.request":
    case "ai.list-models.request":
    case "ai.test-connection.request":
    case "ai.clear-content.request": {
      return executeAiMainCommand(request, {
        loadAiConfig,
        getDecryptedApiKey,
      });
    }
    case "media.job-summary.request":
    case "media.set-audio-preview-preference.request":
    case "asset.rotate-image-content.request":
    case "media.list-jobs.request":
    case "plugin.list-jobs.request":
    case "media.pause-jobs.request":
    case "media.resume-jobs.request":
    case "media.cancel-jobs.request":
    case "media.retry-jobs.request": {
      return executeMediaJobMainCommand(request);
    }
    case "ai.pause-jobs.request":
    case "ai.resume-jobs.request":
    case "ai.cancel-jobs.request":
    case "ai.retry-jobs.request":
    case "ai.status.request":
    case "ai.pending-assets.request":
    case "asset.analyze.request":
    case "assets.analyze.request":
    case "ai.content.get.request": {
      return executeAiMainCommand(request, {
        loadAiConfig,
        getDecryptedApiKey,
      });
    }
    case "asset.thumbnail.request":
    case "asset.thumbnail.visible-window.request": {
      return executeMediaPathMainCommand(request);
    }
    case "sync.asset-card-status.request":
    case "sync.probe.request":
    case "sync.preview.request":
    case "sync.run.request":
    case "sync.list-remote-libraries.request":
    case "sync.open-remote-library.request": {
      return executeSyncMainCommand(request, {
        resolveSyncServerCredentials,
        syncDeviceId,
        createNativeDialogHost,
      });
    }
    case "model.resolve-companions.request":
    case "model.convert-fbx.request":
    case "asset.preview.request":
    case "asset.close-preview.request":
    case "asset.preview-error.report":
    case "asset.recovery-probe.request":
    case "asset.open-external.request":
    case "asset.open-with.request":
    case "asset.reveal-in-folder.request":
    case "asset.copy-file-path.request":
    case "asset.copy-files.request":
    case "asset.retry-artifact.request": {
      return executeMediaPathMainCommand(request);
    }
    case "sync.servers.list.request":
    case "sync.servers.upsert.request":
    case "sync.servers.delete.request":
    case "sync.library.binding.save.request":
    case "sync.library.binding.get.request": {
      return executeSyncMainCommand(request, {
        resolveSyncServerCredentials,
        syncDeviceId,
        createNativeDialogHost,
      });
    }
    case "embedding.models.list.request":
    case "embedding.models.upsert.request":
    case "embedding.models.delete.request":
    case "embedding.models.set-default.request":
    case "embedding.services.list.request":
    case "embedding.services.save.request":
    case "embedding.services.delete.request":
    case "embedding.services.probe.request":
    case "embedding.services.grant.request":
    case "embedding.binding.get.request":
    case "embedding.binding.save.request":
    case "embedding.install.status.request":
    case "embedding.install.start.request":
    case "embedding.install.delete.request":
    case "embedding.index.status.request":
    case "embedding.search.request":
    case "embedding.similar.request":
      return undefined;
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Renderer request: ${String(value)}`);
}

/**
 * Per-request Main-side trace for library lifecycle requests.
 *
 * A switch that stops printing Renderer stage markers, never reaches the
 * Worker and logs no error is otherwise unattributable: Main's own dispatch
 * point has to say whether the request was even handled. Opt-in per measurement
 * (KEEL_E2E_LIBRARY_TRACE=1) so ordinary E2E runs do not gain log volume.
 */
function libraryRequestTraceEnabled(): boolean {
  return process.env.KEEL_E2E === "1"
    && process.env.KEEL_E2E_LIBRARY_TRACE === "1";
}

async function handleLibraryRequest(
  input: unknown,
  options: { consumerId: string },
): Promise<RendererResult> {
  if (libraryRequestTraceEnabled()) {
    state.logger?.info("diag.library-request.enter", "Library request entered Main.", {
      requestType: (input as { type?: unknown } | null)?.type,
    });
  }
  let operation: "create" | "open" | "import" | "open-eagle" | "open-billfish" | undefined;
  let lifecyclePublished = false;
  let clipboardStageDirectory: string | undefined;
  let command: WorkerCommand | undefined;
  let retainExternalSource = false;
  let deleteFromDiskLibraryId: string | undefined;
  let relinkPreviewContext:
    | { libraryId: string; previewId: string }
    | undefined;
  let previousLibraryPaths: string[] = [];
  let openCancellation: ActiveLibraryOpenCancellation | undefined;
  let navigationTrace: {
    navigationId: string;
    rendererStartedAtEpochMs?: number;
    mainEnteredAt: number;
    workerReturnedAt?: number;
  } | undefined;
  const navigationTraceEnabled =
    process.env.KEEL_NAVIGATION_TRACE === "1" || libraryRequestTraceEnabled();
  const logNavigationStage = (
    stage: string,
    fields: Record<string, unknown> = {},
  ): void => {
    if (!navigationTraceEnabled || !navigationTrace) return;
    state.logger?.info("performance.navigation", "Browse navigation performance stage.", {
      navigationId: navigationTrace.navigationId,
      stage,
      ...fields,
    });
  };
  try {
    const request = parseRendererRequest(input);
    if (request.type === "asset.thumbnail.visible-window.request") {
      lastVisibleDragAssetIds.set(request.libraryId, [...request.assetIds]);
      nativeAssetDragPrimer.scheduleVisible(request.libraryId, request.assetIds);
    } else if (request.type === "browse.session.open.request"
      || request.type === "browse.session.page.request") {
      lastVisibleDragAssetIds.delete(request.libraryId);
      nativeAssetDragPrimer.cancelScheduledVisible(request.libraryId);
    }
    if (request.type === "browse.session.open.request" && request.navigationId) {
      navigationTrace = {
        navigationId: request.navigationId,
        ...(request.navigationStartedAtEpochMs === undefined
          ? {}
          : { rendererStartedAtEpochMs: request.navigationStartedAtEpochMs }),
        mainEnteredAt: performance.now(),
      };
      logNavigationStage("main-enter", {
        ...(navigationTrace.rendererStartedAtEpochMs === undefined
          ? {}
          : { rendererToMainMs: Math.max(0, Date.now() - navigationTrace.rendererStartedAtEpochMs) }),
      });
    }

    const libraryOwnedResult = await tryHandleLibraryOwnedRequest(request, {
      getActiveLibraryOpenCancellation: () => state.activeLibraryOpenCancellation,
      logInfo: (scope, message) => {
        state.logger?.info(scope, message);
      },
      logError: (scope, error) => {
        state.logger?.error(scope, error);
      },
      selectDirectory,
      recentLibraryPath,
      readRecentLibraryEntries,
      removeRecentLibrary,
      refreshApplicationMenuRecentLibraries,
      cleanupExternalSource,
      getPendingEagleOpenSourcePath: () => state.pendingEagleOpenSourcePath,
      setPendingEagleOpenSourcePath: (value) => { state.pendingEagleOpenSourcePath = value; },
      getPendingBillfishOpenSourcePath: () => state.pendingBillfishOpenSourcePath,
      setPendingBillfishOpenSourcePath: (value) => { state.pendingBillfishOpenSourcePath = value; },
    });
    if (libraryOwnedResult) return libraryOwnedResult;
    openCancellation = isLibraryOpenRequest(request)
      ? { cancelled: false }
      : undefined;
    if (openCancellation) state.activeLibraryOpenCancellation = openCancellation;

    if (criticalRendererRequest(request)) {
      state.logger?.info(
        'critical-confirmation.route',
        'Routing a renderer request through the critical confirmation window.',
        { requestType: request.type },
      );
      if (!(await confirmCriticalRendererRequest(request))) return cancelled();
    }

    const deleteFromDiskLibraryIdFromRequest = maybeBeginLibraryDeleteFromDisk(request, {
      beginFence: beginLibraryDeleteMediaFence,
      clearNativeAssetDragCache,
    });
    if (deleteFromDiskLibraryIdFromRequest) {
      deleteFromDiskLibraryId = deleteFromDiskLibraryIdFromRequest;
    }

    const ingestionOwnedResult = await tryHandleIngestionOwnedRequest(request, {
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
    });
    if (ingestionOwnedResult) return ingestionOwnedResult;

    // Serpent-xffq: 同步服务器与库绑定是 Main 本地配置（凭据经 safeStorage）。
    const syncOwnedResult = await tryHandleSyncOwnedRequest(request, {
      readSyncServers,
      writeSyncServers,
      readSyncBindings,
      writeSyncBindings,
      encryptPassword: (password) =>
        safeStorage.encryptString(password).toString("base64"),
      syncNow: (libraryId) => {
        const manual = manualSyncRuns.get(libraryId);
        if (manual) {
          const binding = readSyncBindings()[libraryId];
          // The in-flight manual run already covers this binding. A rebind to
          // another remote still needs one run after the manual one finishes.
          if (bindingNeedsRunAfterManual(binding, manual)) {
            state.syncAutoScheduler?.syncNow(libraryId);
          } else {
            manual.savedBindingDuringRun = true;
          }
          return;
        }
        state.syncAutoScheduler?.syncNow(libraryId);
      },
    });
    if (syncOwnedResult) return syncOwnedResult;

    const embeddingModelResult = await tryHandleEmbeddingModelRequest(request, {
      readCatalog: readEmbeddingModels,
      writeCatalog: writeEmbeddingModels,
      readServices: readEmbeddingServices,
      writeServices: writeEmbeddingServices,
      serviceCredentials: {
        has: (id) => existsSync(embeddingServiceKeyPath(id)),
        read: readEmbeddingServiceKey,
        write: writeEmbeddingServiceKey,
        delete: deleteEmbeddingServiceKey,
      },
      userDataPath: () => app.getPath("userData"),
      homePath: () => app.getPath("home"),
      readBindings: readEmbeddingBindings,
      writeBindings: writeEmbeddingBindings,
      embeddingIndex: embeddingIndex(),
      embeddingHttpIndex: embeddingHttp(),
      stopGemmaIndex: () => { void state.embeddingTestIndex?.close(); },
      stopHttpIndex: async () => { await state.embeddingHttpIndex?.close(); },
      onInstallProgress: (event) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(EMBEDDING_INSTALL_PROGRESS_CHANNEL, event);
        }
      },
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
    });
    if (embeddingModelResult) return embeddingModelResult;

    const aiOwnedResult = await tryHandleAiOwnedRequest(request, {
      loadAiConfig,
      getDecryptedApiKey,
      getDecryptedProfileApiKey,
      saveAiConfig,
      saveConnectionProfile: saveAiConnectionProfile,
      activateConnectionProfile: activateAiConnectionProfile,
      deleteConnectionProfile: deleteAiConnectionProfile,
      workerAvailable: () => state.workerClient?.available ?? false,
      requestWorker: (command) => {
        if (!state.workerClient) throw new Error("Library Worker is unavailable.");
        return state.workerClient.request(command);
      },
      processAiQueue,
      logInfo: (scope, message, context) => {
        state.logger?.info(scope, message, context);
      },
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
    });
    if (aiOwnedResult) return aiOwnedResult;

    const previewOwnedResult = await tryHandlePreviewOwnedRequest(request, {
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
    });
    if (previewOwnedResult) return previewOwnedResult;

    const relinkOwnedResult = await tryHandleRelinkOwnedRequest(request, {
      cancelRelinkPreview: (libraryId, previewId) => {
        pendingRelinkPreviews.cancel(libraryId, previewId);
      },
    });
    if (relinkOwnedResult) return relinkOwnedResult;

    const openRecent = tryBuildOpenRecentCommand(request, {
      getActiveLibraryOpenCancellation: () => state.activeLibraryOpenCancellation,
      logInfo: (scope, message) => {
        state.logger?.info(scope, message);
      },
      logError: (scope, error) => {
        state.logger?.error(scope, error);
      },
      selectDirectory,
      recentLibraryPath,
      readRecentLibraryEntries,
      removeRecentLibrary,
      refreshApplicationMenuRecentLibraries,
      cleanupExternalSource,
      getPendingEagleOpenSourcePath: () => state.pendingEagleOpenSourcePath,
      setPendingEagleOpenSourcePath: (value) => { state.pendingEagleOpenSourcePath = value; },
      getPendingBillfishOpenSourcePath: () => state.pendingBillfishOpenSourcePath,
      setPendingBillfishOpenSourcePath: (value) => { state.pendingBillfishOpenSourcePath = value; },
    });
    if (openRecent?.kind === "result") return openRecent.result;
    if (openRecent?.kind === "command") {
      command = openRecent.command;
    } else {
      const ingestion = await tryBuildIngestionCommand(request, {
        isUnpackagedE2e: () => !app.isPackaged && process.env.KEEL_E2E === "1",
        e2eEnv: (name) => process.env[name],
        workerAvailable: () => state.workerClient?.available ?? false,
        requestWorker: (workerCommand) => {
          if (!state.workerClient) throw new Error("Library Worker is unavailable.");
          return state.workerClient.request(workerCommand);
        },
        logInfo: (scope, message, context) => {
          state.logger?.info(scope, message, context);
        },
        logError: (scope, error, context) => {
          state.logger?.error(scope, error, context);
        },
        getPendingSequenceOffer: (offerId) => pendingImageSequenceOffers.get(offerId),
        deletePendingSequenceOffer: (offerId) => {
          pendingImageSequenceOffers.delete(offerId);
        },
        setPendingSequenceNextIndex: (offerId, nextSequenceIndex) => {
          const pending = pendingImageSequenceOffers.get(offerId);
          if (pending) pending.nextSequenceIndex = nextSequenceIndex;
        },
        tempPath: () => app.getPath("temp"),
        now: () => new Date(),
        createImageFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
        readFileBuffer: (filePath) => readFileSync(filePath),
        clipboardImageDeps: {
          readImage: () => clipboard.readImage(),
          readBuffer: (format) => clipboard.readBuffer(format),
          readHTML: () => clipboard.readHTML(),
          createFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
        },
        clipboardAvailableFormats: () => clipboard.availableFormats(),
        readClipboardFilePaths: () => readFilePathsFromClipboard(createFileClipboardDeps()),
      });
      if (ingestion?.kind === "result") return ingestion.result;
      if (ingestion?.kind === "command") {
        command = ingestion.command;
        clipboardStageDirectory = ingestion.clipboardStageDirectory;
      } else {
        command = await commandFor(
          request,
          request.type === "library.inspect-billfish.request"
            ? {
                onBillfishSourceSelected: () => {
                  operation = "open-billfish";
                  lifecyclePublished = true;
                  publishLifecycle({
                    type: "library.opening",
                    operation: "open-billfish",
                  });
                },
              }
            : undefined,
        );
      }
    }
    if (!command || openCancellation?.cancelled) return cancelled();
    const sequenceProbe = await maybeProbeImportSequences(request, command, {
      isUnpackagedE2e: () => !app.isPackaged && process.env.KEEL_E2E === "1",
      workerAvailable: () => state.workerClient?.available ?? false,
      requestWorker: (workerCommand) => {
        if (!state.workerClient) throw new Error("Library Worker is unavailable.");
        return state.workerClient.request(workerCommand);
      },
      rememberSequenceOffer: rememberImageSequenceOffer,
    });
    if (sequenceProbe?.kind === "result") return sequenceProbe.result;
    if (sequenceProbe?.kind === "command") command = sequenceProbe.command;
    relinkPreviewContext = maybeRememberRelinkPreview(
      request,
      command,
      (libraryId, newRootPath) => pendingRelinkPreviews.create(libraryId, newRootPath),
    );
    if (!state.workerClient) throw new Error("Library Worker is unavailable.");
    const lifecycle = await prepareLibraryLifecycle(command, {
      operation,
      lifecyclePublished,
    }, {
      closeOpenLibrariesBeforeReplacement,
      publishOpening: (nextOperation) => {
        publishLifecycle({ type: "library.opening", operation: nextOperation });
      },
    });
    if (lifecycle.kind === "result") return lifecycle.result;
    command = lifecycle.command;
    operation = lifecycle.operation;
    previousLibraryPaths = lifecycle.previousLibraryPaths;
    if (lifecycle.clearPendingEagle) state.pendingEagleOpenSourcePath = undefined;
    if (lifecycle.clearPendingBillfish) state.pendingBillfishOpenSourcePath = undefined;

    await maybeDelayE2eTrash(command, {
      isUnpackagedE2e: () => !app.isPackaged && process.env.KEEL_E2E === "1",
      env: (name) => process.env[name],
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });

    // 测试连接（sync.probe）：单次超时后自动重试，最大重试后给出提醒
    // （用户决定 2026-08-17；传输数据本身无墙钟超时）。
    const viewerRequest = command.type === "media.get-preview-artifact" ? command : undefined;
    const viewerWorkerStartedAt = VIEWER_TIMING_LOG && viewerRequest !== undefined
      ? performance.now()
      : 0;
    const navigationWorkerStartedAt = navigationTrace ? performance.now() : 0;
    const workerResult = command.type === "sync.probe"
      ? await runSyncProbeWithRetry(command, (probe) => {
        if (!state.workerClient) throw new Error("Library Worker is unavailable.");
        return state.workerClient.request(probe);
      })
      : await (async () => {
        const traceLibraryRequest = libraryRequestTraceEnabled();
        if (traceLibraryRequest) {
          state.logger?.info(
            "diag.library-request.dispatch",
            "Dispatching the library command to the Worker.",
            { workerCommand: command.type },
          );
        }
        const manualRequest = request.type === "sync.run.request" ? request : undefined;
        const manualLibraryId = manualRequest?.libraryId;
        if (manualLibraryId !== undefined) {
          const active = manualSyncRuns.get(manualLibraryId);
          manualSyncRuns.set(manualLibraryId, {
            count: (active?.count ?? 0) + 1,
            serverId: manualRequest!.serverId,
            directoryName: manualRequest!.directoryName,
            savedBindingDuringRun: active?.savedBindingDuringRun ?? false,
          });
        }
        let result: WorkerResult | undefined;
        try {
          if (!state.workerClient) throw new Error("Library Worker is unavailable.");
          result = await state.workerClient.request(command, { consumerId: options.consumerId });
        } finally {
          if (manualLibraryId !== undefined) {
            const active = manualSyncRuns.get(manualLibraryId);
            if (active && active.count > 1) {
              manualSyncRuns.set(manualLibraryId, { ...active, count: active.count - 1 });
            } else {
              manualSyncRuns.delete(manualLibraryId);
              state.syncAutoScheduler?.manualSyncFinished(
                manualLibraryId,
                Boolean(active?.savedBindingDuringRun && (!result || !result.ok)),
              );
            }
          }
        }
        if (traceLibraryRequest) {
          state.logger?.info(
            "diag.library-request.dispatched",
            "The Worker answered the library command.",
            { workerCommand: command.type, ok: result.ok, resultType: result.ok ? result.type : undefined },
          );
        }
        return result;
      })();
    if (navigationTrace) {
      navigationTrace.workerReturnedAt = performance.now();
      logNavigationStage("worker-returned", {
        workerRoundTripMs: Math.max(0, navigationTrace.workerReturnedAt - navigationWorkerStartedAt),
        mainElapsedMs: Math.max(0, navigationTrace.workerReturnedAt - navigationTrace.mainEnteredAt),
        ok: workerResult.ok,
        resultType: workerResult.ok ? workerResult.type : undefined,
      });
    }
    if (viewerWorkerStartedAt > 0) {
      state.logger?.info("viewer.preview-worker-timing", "Preview request resolved.", {
        libraryId: viewerRequest?.libraryId,
        assetId: viewerRequest?.assetId,
        workerMs: Math.round(performance.now() - viewerWorkerStartedAt),
        resultType: workerResult.ok ? workerResult.type : undefined,
        errorCode: workerResult.ok ? undefined : workerResult.error.code,
      });
    }
    const replacementOutcome = await applyLibraryReplacementAfterWorker(workerResult, {
      cancelled: Boolean(openCancellation?.cancelled),
      previousLibraryPaths,
      operation,
    }, {
      closeOpenedLibrary: async (libraryId) => {
        if (!state.workerClient) throw new Error("Library Worker is unavailable.");
        await state.workerClient.request({
          type: "library.close",
          libraryId,
        }, { consumerId: options.consumerId });
      },
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
      reopenLibrariesAfterFailedReplacement,
      publishLifecycle,
    });
    if (replacementOutcome) return replacementOutcome;

    const externalSource = await applyExternalLibrarySourceCleanup(command, workerResult, {
      cleanupExternalSource,
    });
    retainExternalSource = externalSource.retainExternalSource;

    maybePrimeNativeDrag(request, workerResult, {
      pendingImportLibraries,
      primeImmediately: (libraryId, assetIds, mode) => {
        void nativeAssetDragPrimer.primeImmediately(libraryId, assetIds, mode);
      },
    });

    if (!workerResult.ok && relinkPreviewContext) {
      pendingRelinkPreviews.cancel(
        relinkPreviewContext.libraryId,
        relinkPreviewContext.previewId,
      );
    }

    applyLibraryWorkerSideEffects(request, command, workerResult, {
      rememberOpenedLibrary,
      removeRecentLibrary,
      recentLibraryPath,
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
      setPendingEagleOpenSourcePath: (value) => {
        state.pendingEagleOpenSourcePath = value;
      },
      setPendingBillfishOpenSourcePath: (value) => {
        state.pendingBillfishOpenSourcePath = value;
      },
      purgePreviewLibrary: (libraryId) => {
        void state.previewCache?.purgeLibrary(libraryId);
      },
      pendingCleanupPath: pendingLibraryCleanupPath,
      readPendingCleanupAsidePaths,
      writePendingCleanupAsidePaths,
      retryPendingLibraryCleanups: () => {
        void retryPendingLibraryCleanups();
      },
      clearRelinkLibrary: (libraryId) => pendingRelinkPreviews.clearLibrary(libraryId),
      clearSourcePathLibrary: (libraryId) => sourcePathCache.clearLibrary(libraryId),
      clearArtifactPathCache,
      cancelArtifactPathBatches,
      clearPendingImportsForLibrary: (libraryId) => {
        for (const [importId, pendingLibraryId] of pendingImportLibraries) {
          if (pendingLibraryId !== libraryId) continue;
          pendingImportLibraries.delete(importId);
        }
      },
      processAiQueue: (libraryId) => {
        void processAiQueue(libraryId);
      },
      notifyLibraryOpened: (input) => {
        notifyLibraryOpenedSideEffects(input).catch((error) => {
          state.logger?.error("plugin.activation.library-opened", error, {
            libraryId: input.libraryId,
          });
        });
      },
      onLibraryClosed: (libraryId) => {
        state.pluginActivationCoordinator?.onLibraryClosed(libraryId);
        for (const [executionId, context] of pluginAutomationContexts) {
          if (context.libraryId === libraryId) {
            pluginAutomationContexts.delete(executionId);
          }
        }
      },
    });

    applySyncWorkerBindings(request, workerResult, {
      readSyncBindings,
      writeSyncBindings,
      now: () => new Date(),
    });

    const mediaShellResult = await tryHandleMediaShellWorkerResult(request, workerResult, {
      logInfo: (scope, message, context) => {
        state.logger?.info(scope, message, context);
      },
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
      openPath: (absolutePath) => shell.openPath(absolutePath),
      showItemInFolder: (absolutePath) => {
        shell.showItemInFolder(absolutePath);
      },
      writeClipboardText: (text) => {
        clipboard.writeText(text);
      },
      writeClipboardFilePaths: (absolutePaths) =>
        writeFilePathsToClipboard(absolutePaths, createFileClipboardDeps()),
      openWith: (absolutePath) =>
        openPathWithOtherApplication(
          absolutePath,
          createOpenWithDeps(state.appLocale, () => state.mainWindow ?? null),
        ),
      openWithProgram: (absolutePath, programId) => {
        const program = readOpenWithSettings(openWithSettingsFilePath(app.getPath("userData")))
          .programs.find((entry) => entry.programId === programId);
        return program ? openPathWithProgram(absolutePath, program.executablePath, spawn) : "failed";
      },
    });
    if (mediaShellResult) return mediaShellResult;

    const importPostProcess = await applyImportWorkerResult(request, workerResult, {
      pendingImportLibraries,
      logError: (scope, error, context) => {
        state.logger?.error(scope, error, context);
      },
      requestWorker: (workerCommand) => {
        if (!state.workerClient) throw new Error("Library Worker is unavailable.");
        return state.workerClient.request(workerCommand);
      },
      enqueueAutoAnalyzeAfterImport: (libraryId, assetIds, importedFolderId) => {
        void enqueueAutoAnalyzeAfterImport(libraryId, assetIds, importedFolderId);
      },
    });
    if (importPostProcess) return importPostProcess;

    const recoveryReport = tryHandleRecoveryReport(request, workerResult, {
      showItemInFolder: (absolutePath) => {
        shell.showItemInFolder(absolutePath);
      },
      logError: (scope, error) => {
        state.logger?.error(scope, error);
      },
    });
    if (recoveryReport) return recoveryReport;

    const rendererWorkerResult = mapBillfishInspectedDisplayName(command, workerResult);
    const result = toRendererResult(
      rendererWorkerResult,
      relinkPreviewContext?.previewId,
    );
    if (navigationTrace) {
      const responseReadyAt = performance.now();
      logNavigationStage("main-response-ready", {
        mainPostProcessMs: navigationTrace.workerReturnedAt === undefined
          ? 0
          : Math.max(0, responseReadyAt - navigationTrace.workerReturnedAt),
        mainTotalMs: Math.max(0, responseReadyAt - navigationTrace.mainEnteredAt),
        ok: result.ok,
        resultType: result.ok ? result.type : undefined,
      });
    }
    applyLibraryRendererLifecycle(command, result, workerResult, operation, {
      removeRecentLibrary,
      recentLibraryPath,
      logError: (scope, error) => {
        state.logger?.error(scope, error);
      },
      unblockLibraryMediaReads,
      publishLifecycle,
      clearNativeAssetDragCache,
      clearActiveRecentLibrary,
    });
    if (!result.ok) return result;
    logNavigationStage("main-return", {
      mainToIpcReturnMs: navigationTrace?.workerReturnedAt === undefined
        ? undefined
        : Math.max(0, performance.now() - navigationTrace.workerReturnedAt),
    });
    return result;
  } catch (error) {
    if (relinkPreviewContext) {
      pendingRelinkPreviews.cancel(
        relinkPreviewContext.libraryId,
        relinkPreviewContext.previewId,
      );
    }
    state.logger?.error("main.library-request", error);
    if (previousLibraryPaths.length > 0) {
      await reopenLibrariesAfterFailedReplacement(previousLibraryPaths);
    }
    const publicError = error instanceof ExternalLibraryArchiveError
      ? createPublicError(error.publicCode, error.reason)
        : error instanceof LibraryParentError
          ? createPublicError(error.code, error.reason)
        : error instanceof WorkerRequestTimeoutError
          ? createPublicError("INTERNAL_ERROR")
          : toPublicError(error);
    if (operation) {
      publishLifecycle({
        type: "library.open-failed",
        operation,
        error: publicError,
      });
    }
    return { ok: false, error: publicError };
  } finally {
    if (state.activeLibraryOpenCancellation === openCancellation) {
      state.activeLibraryOpenCancellation = undefined;
    }
    if (deleteFromDiskLibraryId) {
      endLibraryDeleteMediaFence(deleteFromDiskLibraryId);
    }
    if (!retainExternalSource) {
      await cleanupExternalSource(externalSourceRootFromCommand(command));
    }
    if (clipboardStageDirectory) {
      try {
        cleanupClipboardImage(clipboardStageDirectory);
      } catch (error) {
        state.logger?.error("desktop-ingestion.clipboard-cleanup", error);
      }
    }
  }
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
  state.offscreenThumbnailRenderer = createOffscreenThumbnailRenderer({
    createWindow: (options) => {
      const offscreenWindow = new BrowserWindow(options);
      offscreenWindow.webContents.on(
        "console-message",
        (_event, level, message, line, sourceId) => {
          logRendererConsoleMessage(state.logger, level, message, line, sourceId);
        },
      );
      offscreenWindow.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          state.logger?.error(
            "offscreen-thumbnail.page-load-failed",
            new Error(`${errorCode}: ${errorDescription}`),
            { errorCode, validatedURL, isMainFrame },
          );
        },
      );
      offscreenWindow.webContents.on("did-finish-load", () => {
        state.logger?.info(
          "offscreen-thumbnail.page-finished-load",
          "Offscreen renderer page finished loading.",
        );
        void offscreenWindow.webContents
          .executeJavaScript(
            "({ readyState: document.readyState, body: document.body.innerHTML, hasBridge: Boolean(window.offscreenThumbnail), debug: window.__keelOffscreenThumbnailDebug })",
          )
          .then((state) => {
            state.logger?.info(
              "offscreen-thumbnail.page-state",
              "Inspected offscreen renderer page state.",
              { state },
            );
          })
          .catch((error: unknown) => {
            state.logger?.error("offscreen-thumbnail.page-state", error);
          });
      });
      return offscreenWindow;
    },
    onFrameMessage: (listener) => {
      const onFrameMessage = (_event: Electron.IpcMainEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcMain.on(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
      return () =>
        ipcMain.removeListener(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
    },
    logger: {
      error: (scope, error, context) => state.logger?.error(scope, error, context),
      info: (scope, message, context) => state.logger?.info(scope, message, context),
    },
    pageUrl: resolveOffscreenPageUrl({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL ?? null,
      rendererOutDir: packagedRendererOutDir(),
    }),
    preloadPath: path.join(__dirname, "offscreen.js"),
  });
  state.workerClient.onModelThumbnailRenderRequest((request, sourceAuthorizations) => {
    const renderer = state.offscreenThumbnailRenderer;
    if (!renderer) {
      return Promise.resolve({
        status: "failed" as const,
        errorCode: "MODEL_WINDOW_FAILED",
        reason: "offscreen thumbnail renderer unavailable",
      });
    }
    registerModelThumbnailSourceAuthorizations(sourceAuthorizations);
    return renderer.renderModelThumbnail(request).finally(() => {
      clearModelThumbnailSourceAuthorizations(sourceAuthorizations);
    });
  });
  state.workerClient.onModelThumbnailRenderCancel((requestId) => {
    state.offscreenThumbnailRenderer?.cancelModelThumbnail(requestId);
  });
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
  state.scriptRuntimeSupervisor = new ScriptRuntimeSupervisor({
    modulePath: path.join(__dirname, 'script_runtime_utility.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Script Runtime',
      stdio: 'pipe',
    }),
    logger: state.logger,
  });
  state.ruleRunner = new RuleRunner({
    workerClient: () => state.workerClient,
    journal: () => state.automationExecutionJournal,
    gateway: () => state.automationCommandGateway,
    runtime: () => state.scriptRuntimeSupervisor,
    confirmDesktopWrite: confirmRuleRun,
    logger: () => state.logger,
    onRunRecorded: (libraryId, run) => {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
      state.mainWindow.webContents.send(RULE_RUN_RECORDED_CHANNEL, { libraryId, ruleId: run.ruleId, runId: run.runId });
    },
  });
  setInterval(() => { void runScheduledRules(); }, 60_000).unref?.();
  const executePluginHostCommand: PluginRuntimeHostCommandHandler = async (commandId, input, context) => {
    const gateway = state.automationCommandGateway;
    if (gateway === undefined) throw new Error('Automation Gateway is unavailable.');
    const cause = validatePluginCauseChain(context.causeChain);
    if (!cause.ok) {
      throw new Error(cause.message);
    }
    const resolvedTarget = resolvePluginHostCommandLibraryId({
      commandId,
      libraryId: context.libraryId,
      ...(context.targetLibraryId === undefined ? {} : { targetLibraryId: context.targetLibraryId }),
    });
    if (!resolvedTarget.ok) {
      throw new Error(resolvedTarget.message);
    }
    const activeInstance = state.pluginActivationCoordinator?.findActiveInstance(context.instanceId);
    if (activeInstance === undefined) {
      throw new Error('The plugin instance is no longer active.');
    }
    let boundLibraryId = resolvedTarget.libraryId;
    if (boundLibraryId !== null) {
      if (activeInstance.instanceScope === 'library'
        && activeInstance.activationLibraryId !== boundLibraryId) {
        throw new Error('A library-scoped plugin cannot target another library.');
      }
      const libraries = await state.workerClient?.request({ type: 'library.list' });
      const libraryIsOpen = libraries?.ok === true
        && libraries.type === 'library.list'
        && libraries.libraries.some((library) => library.libraryId === boundLibraryId);
      if (!libraryIsOpen) {
        if (pluginHostCommandRequiresBoundLibrary(commandId)) {
          throw new Error('The plugin command target library is not open.');
        }
        boundLibraryId = null;
      }
    }
    const executionId = context.targetLibraryId === undefined || boundLibraryId === null
      ? context.instanceId
      : `${context.instanceId}:${boundLibraryId}`;
    pluginAutomationContexts.set(executionId, {
      executionId,
      source: 'plugin',
      libraryId: boundLibraryId,
      grantedCapabilities: automationCapabilitiesFromPluginPermissions(context.permissions),
      pluginId: context.pluginId,
      pluginInstanceId: context.instanceId,
    });
    const commandInput = commandId === 'asset.search'
      ? normalizeAutomationAssetSearchInput(input)
      : input;
    if (commandInput === undefined) {
      throw new Error('Invalid search query.');
    }
    const result = await gateway.execute({
      apiVersion: AUTOMATION_API_VERSION,
      commandId,
      executionId,
      input: commandInput,
    });
    if (!result.ok) {
      // Serpent-8b5b.2: plugin host commands are never critical; a challenge
      // outcome is mapped defensively to a gateway failure.
      const failure = 'challenge' in result && result.challenge !== undefined
        ? { code: 'AUTOMATION_CHALLENGE_REQUIRED', message: 'Dangerous operation requires agent confirmation.' }
        : (result as { error: { code: string; message: string } }).error;
      state.logger?.error('plugin.host-command.gateway-failed', new Error(failure.message ?? failure.code), {
        instanceId: context.instanceId,
        pluginId: context.pluginId,
        commandId,
        errorCode: failure.code,
      });
      throw new PluginHostCommandError(failure.code, failure.message ?? failure.code);
    }
    return result.result;
  };
  const recordPluginRuntimeCrash = (crash: {
    instanceId: string;
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    packageHash: string;
    failureCode: string;
  }): void => {
    state.pluginInputCaptureBroker?.releaseForInstance(crash.instanceId, 'plugin-crashed');
    void state.pluginPackageManager?.recordRuntimeCrash({
      libraryId: crash.libraryId,
      libraryDirectory: crash.libraryDirectory,
      pluginId: crash.pluginId,
      packageHash: crash.packageHash,
      failureCode: crash.failureCode,
    }).catch((error) => {
      state.logger?.error('plugin.runtime.crash-record', error, crash);
    });
  };
  const pluginStorageStore = new PluginStorageStore(app.getPath('userData'));
  const pluginSettingsStore = new PluginSettingsStore(app.getPath('userData'));
  const pluginMcpExposureStore = new PluginMcpExposureStore(app.getPath('userData'));
  await pluginMcpExposureStore.load();
  const executePluginStorage: PluginRuntimeStorageHandler = async (input) => {
    try {
      return await pluginStorageStore.execute({
        operation: input.operation,
        scope: input.scope ?? 'library',
        pluginId: input.context.pluginId,
        libraryId: input.context.libraryId,
        libraryDirectory: input.context.libraryDirectory,
        permissions: input.context.permissions,
        ...(input.key === undefined ? {} : { key: input.key }),
        ...(input.value === undefined ? {} : { value: input.value }),
      });
    } catch (error) {
      if (error instanceof PluginStorageStoreError) throw error;
      throw error;
    }
  };
  const resolvePluginJobTargetLibrary = async (input: {
    instanceId: string;
    requestedTargetLibraryId?: string;
    ambientLibraryId: string;
  }): Promise<{ record: NonNullable<ReturnType<PluginActivationCoordinator['findActiveInstance']>>; libraryId: string }> => {
    const coordinator = state.pluginActivationCoordinator;
    const client = state.workerClient;
    if (coordinator === undefined || client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const record = coordinator.findActiveInstance(input.instanceId);
    if (record === undefined) {
      throw Object.assign(new Error('The plugin instance is no longer active.'), { code: 'INSTANCE_GONE' });
    }
    if (record.instanceScope === 'global' && input.requestedTargetLibraryId === undefined) {
      throw Object.assign(
        new Error('Global plugin jobs require an explicit open target library.'),
        { code: 'JOB_TARGET_REQUIRED' },
      );
    }
    const candidate = input.requestedTargetLibraryId ?? input.ambientLibraryId;
    const parsedTarget = pluginTargetLibraryIdSchema.safeParse(candidate);
    if (!parsedTarget.success) {
      throw Object.assign(new Error('The plugin job target library is invalid.'), { code: 'JOB_TARGET_INVALID' });
    }
    if (record.instanceScope === 'library' && record.activationLibraryId !== parsedTarget.data) {
      throw Object.assign(
        new Error('A library-scoped plugin cannot target another library.'),
        { code: 'JOB_TARGET_SCOPE_VIOLATION' },
      );
    }
    const libraries = await client.request({ type: 'library.list' });
    if (!libraries.ok || libraries.type !== 'library.list'
      || !libraries.libraries.some((library) => library.libraryId === parsedTarget.data)) {
      throw Object.assign(new Error('The plugin job target library is not open.'), { code: 'JOB_TARGET_NOT_OPEN' });
    }
    return { record, libraryId: parsedTarget.data };
  };
  const handlePluginJobEnqueue: PluginRuntimeJobEnqueueHandler = async (input) => {
    const client = state.workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const coordinator = state.pluginActivationCoordinator;
    if (coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const validated = coordinator.validateJobEnqueue({
      instanceId: input.instanceId,
      handlerId: input.handlerId,
      ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
    });
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), { code: validated.code });
    }
    const result = await client.request({
      type: 'plugin.jobs.enqueue',
      libraryId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
      pluginHandlerId: input.handlerId,
      payload: input.payload,
      recoveryStrategy: validated.recoveryStrategy,
    });
    if (!result.ok || result.type !== 'plugin.jobs.enqueued') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job enqueue returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_ENQUEUE_FAILED' : result.error.code },
      );
    }
    state.pluginJobScheduler?.tick(libraryId);
    return { jobId: result.job.jobId };
  };
  const handlePluginJobProgress: PluginRuntimeJobProgressHandler = async (input) => {
    const client = state.workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId: targetLibraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const result = await client.request({
      type: 'plugin.jobs.report-progress',
      libraryId: targetLibraryId,
      jobId: input.jobId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: targetLibraryId,
      ...input.progress,
    });
    if (!result.ok || result.type !== 'plugin.jobs.completed') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job progress returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_PROGRESS_FAILED' : result.error.code },
      );
    }
  };
  const handlePluginJobControl: PluginRuntimeJobControlHandler = async (input) => {
    const client = state.workerClient;
    const coordinator = state.pluginActivationCoordinator;
    if (client === undefined || coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const listed = await client.request({ type: 'plugin.jobs.list', libraryId });
    if (!listed.ok || listed.type !== 'plugin.jobs.listed') {
      throw Object.assign(new Error('The plugin job list could not be read.'), { code: 'JOB_LIST_FAILED' });
    }
    const job = listed.jobs.find((candidate) => candidate.jobId === input.jobId);
    const owner = {
      pluginId: record.pluginId,
      packageHash: record.packageHash,
      pluginInstanceId: record.instanceId,
      scope: record.instanceScope,
      libraryId,
    } as const;
    const ownsJob = job !== undefined && (input.action === 'retry'
      ? pluginJobOwnerCanRetry(job, owner)
      : pluginJobOwnerMatches(job, owner));
    if (!ownsJob) {
      throw Object.assign(new Error('The plugin does not own this job.'), { code: 'JOB_OWNERSHIP_MISMATCH' });
    }
    const capabilities = {
      handlerId: job.pluginHandlerId,
      resumable: job.recoveryStrategy === 'checkpoint',
      ...(job.checkpoint?.version === undefined ? { checkpointVersion: 'v1' } : { checkpointVersion: job.checkpoint.version }),
    } as const;
    const requestOwner = {
      ownerPluginId: record.pluginId,
      ownerPackageHash: record.packageHash,
      ownerPluginInstanceId: record.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
    } as const;
    let result: Awaited<ReturnType<typeof client.request>>;
    switch (input.action) {
      case 'cancel':
        result = await client.request({ type: 'plugin.jobs.cancel', libraryId, jobId: input.jobId, ...requestOwner, reason: input.reason });
        break;
      case 'pause':
        if (input.checkpoint === undefined) {
          throw Object.assign(new Error('Pausing a plugin job requires a checkpoint.'), { code: 'CHECKPOINT_REQUIRED' });
        }
        result = await client.request({
          type: 'plugin.jobs.pause', libraryId, jobId: input.jobId, ...requestOwner,
          capabilities,
          checkpoint: input.checkpoint,
        });
        break;
      case 'resume':
        result = await client.request({ type: 'plugin.jobs.resume', libraryId, jobId: input.jobId, ...requestOwner, capabilities });
        break;
      case 'retry':
        result = await client.request({ type: 'plugin.jobs.retry', libraryId, jobId: input.jobId, ...requestOwner, retryInput: input.retryInput });
        break;
    }
    if (!result.ok || !('job' in result)) {
      throw Object.assign(new Error(result.ok ? 'Plugin job control returned an unexpected result.' : result.error.reason), {
        code: result.ok ? 'JOB_CONTROL_FAILED' : result.error.code,
      });
    }
    if ((input.action === 'cancel' || input.action === 'pause') && result.job !== null) {
      if (record.mode === 'restricted') state.pluginRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
      else state.pluginTrustedRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
    }
    if (input.action === 'resume' || input.action === 'retry') state.pluginJobScheduler?.tick(libraryId);
    return { job: result.job };
  };
  const onPluginInstanceActivated = (input: { libraryId: string }): void => {
    state.pluginJobScheduler?.tick(input.libraryId);
  };
  const handlePluginInputCaptureStart: PluginRuntimeInputCaptureStartHandler = (input) => {
    if (state.pluginInputCaptureBroker === undefined) {
      return {
        ok: false,
        code: 'CAPTURE_UNAVAILABLE',
        message: 'Input capture is unavailable in this session.',
      };
    }
    return state.pluginInputCaptureBroker.start({
      ...input.options,
      instanceId: input.instanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      permissions: input.permissions,
    });
  };
  state.pluginInputCaptureBroker = new PluginInputCaptureBroker({
    onStart: () => {
      publishPluginInputCaptureSessionsToRenderer();
    },
    onEvent: (session, event) => {
      state.pluginRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
      state.pluginTrustedRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
    },
    onEnd: (session, reason) => {
      state.pluginRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      state.pluginTrustedRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      publishPluginInputCaptureSessionsToRenderer();
    },
  });
  state.pluginRuntimeSupervisor = new PluginRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_standard_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Plugin Standard Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      state.pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      state.pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      state.pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onCrash: recordPluginRuntimeCrash,
    onInstanceActivated: onPluginInstanceActivated,
    logger: state.logger,
  });
  state.pluginTrustedRuntimeSupervisor = new PluginTrustedRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_trusted_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Plugin Trusted Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      state.pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      state.pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      state.pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onInstanceActivated: onPluginInstanceActivated,
    onCrash: recordPluginRuntimeCrash,
    logger: state.logger,
  });
  const pluginCompatibility = currentPluginCompatibilityPlatform();
  const nodeAbi = Number(process.versions.modules);
  if (pluginCompatibility === undefined || !Number.isSafeInteger(nodeAbi) || nodeAbi <= 0) {
    state.logger.error('plugin.platform', new Error('This platform cannot run the plugin package manager.'), {
      platform: process.platform,
      arch: process.arch,
      nodeAbi: process.versions.modules,
    });
  } else {
    state.pluginPackageManager = new PluginPackageManager({
      userDataDirectory: app.getPath('userData'),
      deviceId: await loadOrCreatePluginDeviceId(app.getPath('userData')),
      keelVersion: app.getVersion(),
      pluginApiVersion: PLUGIN_API_VERSION,
      ...pluginCompatibility,
      nodeAbi,
      logger: state.logger,
      onDeviceStateRecovered: () => {
        state.pendingPluginDeviceStateRecoveryNotice = true;
      },
    });
    state.pluginActivationCoordinator = new PluginActivationCoordinator({
      packageManager: state.pluginPackageManager,
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      globalRuntimeContext: {
        libraryId: '__serpent_global_runtime__',
        libraryDirectory: app.getPath('userData'),
      },
      contributions: createContributionRegistry(),
      providers: createPluginProviderRegistry(),
      compatibility: {
        keelVersion: app.getVersion(),
        pluginApiVersion: PLUGIN_API_VERSION,
        ...pluginCompatibility,
        nodeAbi,
      },
      pausePluginJobs: async ({ libraryId, owners }) => {
        const client = state.workerClient;
        if (client === undefined) return;
        const result = await client.request({
          type: 'plugin.jobs.pause-owners',
          libraryId,
          owners,
          errorCode: 'PLUGIN_INSTANCE_INACTIVE',
          errorDetail: 'The plugin instance is no longer active.',
        });
        if (!result.ok) {
          throw new Error(result.error.reason);
        }
      },
      onInstanceActivated: ({ libraryId }) => {
        state.pluginJobScheduler?.tick(libraryId);
      },
      onContributionsRegistered: ({ libraryId }) => {
        void state.pluginProviderScheduler?.materializeLibrary(libraryId).catch((error) => {
          state.logger?.error('plugin.providers.materialize', error, { libraryId });
        });
        state.embeddedMcpServer?.notifyToolsChanged();
        void syncPluginThumbnailExtensions().catch((error) => {
          state.logger?.error('plugin.thumbnail-extensions', error, { libraryId });
        });
      },
      onProvidersChanged: () => {
        void syncPluginThumbnailExtensions().catch((error) => {
          state.logger?.error('plugin.thumbnail-extensions', error);
        });
      },
      logger: state.logger,
    });
    state.pluginMcpToolProvider = new PluginMcpToolProvider({
      activationCoordinator: state.pluginActivationCoordinator,
      exposureStore: pluginMcpExposureStore,
    });
    state.pluginJobScheduler = new PluginJobScheduler({
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = state.workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'plugin.jobs.claimed') {
          return { ok: true, type: result.type, job: result.job };
        }
        if (result.type === 'plugin.jobs.completed') {
          return { ok: true, type: result.type, job: result.job };
        }
        return { ok: false };
      },
      resolveInstances: (libraryId) => {
        const coordinator = state.pluginActivationCoordinator;
        if (coordinator === undefined) return [];
        const bindings = coordinator.listActiveInstances(libraryId);
        const standard = state.pluginRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        const trusted = state.pluginTrustedRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        return bindings.map((binding) => {
          const source = binding.mode === 'restricted'
            ? standard.find((item) => item.instanceId === binding.instanceId)
            : trusted.find((item) => item.instanceId === binding.instanceId);
          return {
            ...binding,
            activated: source?.activated ?? false,
          };
        });
      },
      logger: state.logger,
    });
    state.pluginProviderScheduler = new PluginProviderScheduler({
      coordinator: state.pluginActivationCoordinator,
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = state.workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'asset.list') {
          return { ok: true, type: result.type, assets: result.assets };
        }
        if (result.type === 'plugin.derived-fields.materialized') {
          return {
            ok: true,
            type: result.type,
            writtenCount: result.writtenCount,
            fieldKey: result.fieldKey,
          };
        }
        if (result.type === 'asset.search.result') {
          return {
            ok: true,
            type: result.type,
            items: result.items,
            total: result.total,
            offset: result.offset,
            snippets: result.snippets,
          };
        }
        return { ok: false };
      },
      logger: state.logger,
    });
    state.workerClient.onPluginMediaProviderRequest(async (input) => {
      const scheduler = state.pluginProviderScheduler;
      if (scheduler === undefined) {
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_UNAVAILABLE',
        };
      }
      try {
        return await scheduler.resolveMediaProvider(input);
      } catch (error) {
        state.logger?.error('plugin.media-provider.request', error, {
          libraryId: input.libraryId,
          assetId: input.assetId,
          kind: input.kind,
        });
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_FAILED',
        };
      }
    });
  }
  if (!state.automationExecutionJournal || !state.automationCommandGateway || !state.workerClient || !state.logger) {
    throw new Error('Embedded MCP server requires journal, gateway, worker, and logger.');
  }
  try {
    state.embeddedMcpServer = new EmbeddedMcpServer({
      userDataPath: app.getPath('userData'),
      journal: state.automationExecutionJournal,
      gateway: state.automationCommandGateway,
      workerClient: state.workerClient,
      logger: state.logger,
      getPluginTools: () => state.pluginMcpToolProvider,
      getHostTools: () => ruleMcpTools,
      permissionPolicyStore: state.mcpPermissionPolicyStore,
      permissionBroker: state.mcpPermissionBroker,
      // Serpent-fmbr: MCP operations speak through the SAME human-facing toasts
      // as manual operations — the renderer composes them from the structured
      // result. No separate "MCP client completed X" notification system.
      onCommandCompleted: ({ commandId, result }) => {
        if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
        state.mainWindow.webContents.send(COMMAND_COMPLETED_CHANNEL, { commandId, result });
      },
    });
    state.embeddedMcpServer.onSnapshot((snapshot) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        const validatedSnapshot = mcpSettingsSnapshotSchema.parse(snapshot);
        state.mainWindow.webContents.send(MCP_SETTINGS_EVENT_CHANNEL, validatedSnapshot);
      }
    });
  } catch (error) {
    // Keel review: an unrecoverable MCP construction failure (e.g. the
    // credential pepper ACL cannot be restricted on Windows) must disable the
    // MCP service, never the whole app — the settings IPC answers
    // MCP_SETTINGS_UNAVAILABLE while embeddedMcpServer stays undefined.
    state.embeddedMcpInitializationFailure = error instanceof McpCredentialStoreError ? error : undefined;
    state.logger?.error('mcp.embedded-server.construction-failed', error);
  }
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
  handleProtocolWithLegacyAlias(protocol, KEEL_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === APP_ASSET_HOST) {
        // Bundled app assets (e.g. .hdr environment maps) that the packaged
        // renderer cannot fetch via file:// (three r185 loaders use fetch).
        // Whitelist + receipt verification live in src/main/app-assets.ts.
        const response = createAppAssetResponse({
          route: url.pathname,
          appPath: app.getAppPath(),
          isPackaged: app.isPackaged,
        });
        if (!response) {
          state.logger?.info(
            "keel-protocol.app-asset-missing",
            "Rejected unknown or unverified app-asset route.",
            { route: url.pathname },
          );
          return new Response("App asset not found", { status: 404 });
        }
        return response;
      }
      if (url.hostname === "folder-cover") {
        const folderLibraryId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const folderId = url.searchParams.get("folder") ?? "";
        if (
          !folderLibraryId
          || !folderId
          || folderId.length > 4096
          || folderLibraryId.includes("..")
          || folderId.includes("\0")
        ) {
          return new Response("Invalid folder cover", { status: 400 });
        }
        if (isLibraryMediaReadBlocked(folderLibraryId)) {
          return new Response("Library unavailable", { status: 410 });
        }
        if (!state.workerClient) return new Response("Worker unavailable", { status: 503 });
        try {
          const resolved = await state.workerClient.request({
            type: "folder.cover.resolve",
            libraryId: folderLibraryId,
            folderId,
          });
          if (!resolved.ok || resolved.type !== "folder.cover.resolved") {
            return new Response("Folder cover not found", { status: 404 });
          }
          return await createArtifactResponse(
            resolved.absolutePath,
            resolved.mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: bindLibraryMediaReadSignal(folderLibraryId, request.signal),
              onStreamError: (error) =>
                state.logger?.error("keel-protocol.folder-cover-stream", error, {
                  libraryId: folderLibraryId,
                }),
            },
          );
        } catch (error) {
          state.logger?.error("keel-protocol.folder-cover-read", error, {
            libraryId: folderLibraryId,
          });
          return new Response("Folder cover unreadable", { status: 404 });
        }
      }
      if (
        url.hostname !== "preview" &&
        url.hostname !== "proxy" &&
        url.hostname !== "source" &&
        url.hostname !== "import-frame"
      ) {
        state.logger?.info(
          "keel-protocol.invalid-host",
          "Rejected unsupported artifact protocol host.",
        );
        return new Response("Invalid keel:// path", { status: 400 });
      }
      // Serpent-866c20：序列帧确认面板要在导入前预览候选帧。Renderer 只拿到
      // Main 自己发出的不透明 offerId 与帧号，真实路径由这里从候选清单解析——
      // 请求里永远不出现磁盘路径。
      if (url.hostname === "import-frame") {
        const frameParts = url.pathname.replace(/^\/+/, "").split("/");
        if (frameParts.length !== 3) {
          return new Response("Invalid frame path", { status: 400 });
        }
        const [rawOfferId, rawSequenceIndex, rawFrameNumber] = frameParts as [
          string,
          string,
          string,
        ];
        const sequenceIndex = Number(rawSequenceIndex);
        const frameNumber = Number(rawFrameNumber);
        if (
          !/^[A-Za-z0-9-]{1,64}$/.test(rawOfferId) ||
          !Number.isInteger(sequenceIndex) ||
          sequenceIndex < 0 ||
          !Number.isInteger(frameNumber) ||
          frameNumber < 0
        ) {
          return new Response("Invalid frame request", { status: 400 });
        }
        const pending = pendingImageSequenceOffers.get(rawOfferId);
        if (!pending || pending.expiresAt <= Date.now()) {
          return new Response("Import offer expired", { status: 404 });
        }
        const pendingFrame = resolvePendingImportFrame({
          sequences: pending.offer.sequences,
          sequenceIndex,
          frameNumber,
        });
        if (!pendingFrame) {
          return new Response("Frame not found", { status: 404 });
        }
        if (isLibraryMediaReadBlocked(pending.offer.libraryId)) {
          return new Response("Library unavailable", { status: 410 });
        }
        try {
          return await createArtifactResponse(
            pendingFrame.absolutePath,
            pendingFrame.mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: request.signal,
              onStreamError: (error) =>
                state.logger?.error("keel-protocol.import-frame-stream", error, {
                  sequenceIndex,
                  frameNumber,
                }),
            },
          );
        } catch (error) {
          state.logger?.error("keel-protocol.import-frame-read", error, {
            sequenceIndex,
            frameNumber,
          });
          return new Response("Frame unreadable", { status: 404 });
        }
      }
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      if (parts.length !== 2) {
        state.logger?.info(
          "keel-protocol.invalid-path",
          "Rejected malformed artifact protocol URL.",
        );
        return new Response("Invalid URL format", { status: 400 });
      }
      const libraryId = parts[0]!;
      const artifactId = parts[1]!;
      if (
        !libraryId ||
        !artifactId ||
        libraryId.includes("..") ||
        artifactId.includes("..")
      ) {
        state.logger?.info(
          "keel-protocol.invalid-identifiers",
          "Rejected malformed artifact identifiers.",
        );
        return new Response("Invalid identifiers", { status: 400 });
      }
      if (isLibraryMediaReadBlocked(libraryId)) {
        return new Response("Library unavailable", { status: 410 });
      }

      if (!state.workerClient) {
        state.logger?.error(
          "keel-protocol.worker-unavailable",
          new Error("Library Worker is unavailable."),
        );
        return new Response("Worker unavailable", { status: 503 });
      }

      if (url.hostname === "source") {
        const sourceWorkerClient = state.workerClient;
        if (!sourceWorkerClient) {
          return new Response("Worker unavailable", { status: 503 });
        }
        state.logger?.info(
          "keel-protocol.source-request",
          "Resolving a source asset request.",
          { libraryId, assetId: artifactId },
        );
        // Serpent-485aeb：字体卡片样张页。字体卡片的封面由 Main 的离屏捕获
        // 渲染成 512px 缩略图，因此这里按同一个 source URL + `sample=font`
        // 返回一张生成的 HTML 样张页；页面里的 @font-face 指向去掉该参数的
        // 原始 URL，与页面同源（同 scheme + 同 host），不需要给字体请求放开
        // CORS。样张文字随字体语言切换（`lang`/`family` 由 Worker 解析字体
        // 文件后带上），避免给纯拉丁字体套中文标签渲染成豆腐块。
        if (url.searchParams.get("sample") === "font") {
          const sample = resolveFontSampleRequest(url);
          return new Response(
            createFontSamplePage({
              fontUrl: sample.fontUrl,
              family: sample.family,
              language: sample.language,
            }),
            {
              headers: {
                "cache-control": "no-store",
                "content-type": "text/html; charset=utf-8",
                "x-content-type-options": "nosniff",
              },
            },
          );
        }
        const revisionId = url.searchParams.get("revision");
        if (!revisionId || !/^[A-Za-z0-9_-]{1,255}$/.test(revisionId)) {
          state.logger?.info(
            "keel-protocol.invalid-revision",
            "Rejected malformed source revision token.",
          );
          return new Response("Invalid revision", { status: 400 });
        }
        const authorizedSource = resolveModelThumbnailSourceAuthorization({
          libraryId,
          assetId: artifactId,
          revisionId,
        });
        if (authorizedSource) {
          try {
            if (isLibraryMediaReadBlocked(libraryId)) {
              return new Response("Library unavailable", { status: 410 });
            }
            return await createArtifactResponse(
              authorizedSource.absolutePath,
              authorizedSource.mimeType,
              {
                rangeHeader: request.headers.get("range"),
                signal: bindLibraryMediaReadSignal(libraryId, request.signal),
                onStreamError: (error) =>
                  state.logger?.error("keel-protocol.model-source-stream", error, {
                    libraryId,
                    assetId: artifactId,
                  }),
              },
            );
          } catch (error) {
            state.logger?.error("keel-protocol.model-source-read", error, {
              libraryId,
              assetId: artifactId,
            });
            return new Response("Source file missing", { status: 404 });
          }
        }
        const sourceStartedAt = performance.now();
        const sourceKey: SourcePathResolution = {
          libraryId,
          assetId: artifactId,
          revisionId,
          absolutePath: "",
          mimeType: "",
        };
        const sourceCacheHit = sourcePathCache.has(libraryId, artifactId, revisionId);
        let sourceResult: SourcePathResolution;
        try {
          sourceResult = await sourcePathCache.getOrResolve(sourceKey, async () => {
            const result = await sourceWorkerClient.request({
              type: "media.get-source-path",
              libraryId,
              assetId: artifactId,
              revisionId,
            });
            if (!result.ok || result.type !== "media.source-path") {
              throw new Error("Source not found");
            }
            return {
              libraryId,
              assetId: artifactId,
              revisionId,
              absolutePath: result.absolutePath,
              mimeType: result.mimeType,
            };
          });
        } catch (error) {
          sourcePathCache.delete(libraryId, artifactId, revisionId);
          state.logger?.info(
            "keel-protocol.source-stale",
            "Rejected missing or stale source token.",
            { libraryId, assetId: artifactId },
          );
          if (VIEWER_TIMING_LOG) {
            state.logger?.info("viewer.source-timing", "Source lookup failed.", {
              libraryId,
              assetId: artifactId,
              revisionId,
              cacheHit: sourceCacheHit,
              workerMs: Math.round(performance.now() - sourceStartedAt),
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return new Response("Source not found", { status: 404 });
        }
        if (isLibraryMediaReadBlocked(libraryId)) {
          return new Response("Library unavailable", { status: 410 });
        }
        try {
          const response = await createArtifactResponse(
            sourceResult.absolutePath,
            sourceResult.mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: bindLibraryMediaReadSignal(libraryId, request.signal),
              onStreamError: (error) =>
                state.logger?.error("keel-protocol.source-stream", error, {
                  libraryId,
                  assetId: artifactId,
                }),
            },
          );
          if (VIEWER_TIMING_LOG) {
            state.logger?.info("viewer.source-timing", "Source response ready.", {
              libraryId,
              assetId: artifactId,
              revisionId,
              cacheHit: sourceCacheHit,
              workerMs: Math.round(performance.now() - sourceStartedAt),
              status: response.status,
              range: request.headers.get("range") ?? undefined,
            });
          }
          return response;
        } catch (error) {
          sourcePathCache.delete(libraryId, artifactId, revisionId);
          state.logger?.error("keel-protocol.source-read", error, {
            libraryId,
            assetId: artifactId,
          });
          return new Response("Source file missing", { status: 404 });
        }
      }

      const absoluteArtifactPath = await resolveArtifactPathBatched(
        libraryId,
        artifactId,
        url.hostname,
      );
      const ext = path.extname(absoluteArtifactPath).toLowerCase();
      const mimeType = artifactProtocolMimeForExtension(ext);

      if (isLibraryMediaReadBlocked(libraryId)) {
        return new Response("Library unavailable", { status: 410 });
      }

      // Serpent-1e3d4f: image previews are mirrored into userData on first
      // serve; later sessions stream from the local mirror instead of the
      // (possibly remote) origin. Video proxies/posters stay uncached — they
      // are large and Range-streamed.
      const isCacheableImageMime = mimeType.startsWith("image/");
      const cachedMirror = isCacheableImageMime
        ? state.previewCache?.locateSync(libraryId, artifactId, ext)
        : null;
      if (cachedMirror) {
        try {
          return await createArtifactResponse(
            cachedMirror,
            mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: bindLibraryMediaReadSignal(libraryId, request.signal),
              onStreamError: (error) =>
                state.logger?.error("preview-cache.stream", error, {
                  libraryId,
                  artifactId,
                }),
            },
          );
        } catch {
          // Mirror unreadable (evicted mid-stream, permissions): fall through
          // to the origin and let store() refresh the mirror.
        }
      }

      try {
        const response = await createArtifactResponse(
          absoluteArtifactPath,
          mimeType,
          {
            rangeHeader: request.headers.get("range"),
            signal: bindLibraryMediaReadSignal(libraryId, request.signal),
            onStreamError: (error) =>
              state.logger?.error("keel-protocol.stream", error, {
                libraryId,
                artifactId,
              }),
          },
        );
        if (isCacheableImageMime && !request.headers.get("range")) {
          void state.previewCache?.store(libraryId, artifactId, absoluteArtifactPath, ext);
        }
        return response;
      } catch (error) {
        state.logger?.error("keel-protocol.read", error, {
          libraryId,
          artifactId,
        });
        // A watcher/library-change event may have invalidated the path after
        // the batch returned. Do not keep serving a stale artifact location
        // after the first failed read; the next request will ask the Worker
        // for the current path.
        artifactPathCache.invalidateArtifact(libraryId, artifactId, url.hostname);
        return new Response("Artifact file missing", { status: 404 });
      }
    } catch (error) {
      state.logger?.error("keel-protocol", error, { url: request.url });
      return new Response("Internal error", { status: 500 });
    }
  });

  handleProtocolWithLegacyAlias(protocol, KEEL_PLUGIN_PROTOCOL_SCHEME, async (request) => {
    const parsed = parsePluginUiAssetRequestFromNavigation(
      request.url,
      request.headers.get("referer") ?? request.headers.get("Referer"),
    );
    if (parsed === undefined) {
      return new Response("Invalid plugin UI URL", { status: 400 });
    }
    const resolved = state.pluginActivationCoordinator?.resolvePluginUiAsset(parsed);
    if (resolved === undefined) {
      state.logger?.info("plugin-ui.protocol-rejected", "Rejected an inactive or unallowlisted plugin UI asset.", {
        pluginId: parsed.pluginId,
        instanceId: parsed.instanceId,
        contributionId: parsed.contributionId,
      });
      return new Response("Plugin UI asset not found", { status: 404 });
    }
    try {
      let body: Buffer = await readFile(resolved.absolutePath);
      const contentType = pluginUiMimeType(parsed.relativePath);
      if (contentType.startsWith("text/html")) {
        body = Buffer.from(
          rewritePluginUiHtmlAssetUrls(body.toString("utf8"), request.url),
          "utf8",
        );
      }
      const pluginOrigin = `keel-plugin://${parsed.pluginId}`;
      return new Response(new Uint8Array(body), {
        headers: {
          "cache-control": "no-store",
          "content-security-policy": [
            "default-src 'none'",
            `script-src 'self' ${pluginOrigin}`,
            `style-src 'self' ${pluginOrigin} 'unsafe-inline'`,
            `img-src 'self' ${pluginOrigin} data:`,
            `font-src 'self' ${pluginOrigin}`,
            `media-src 'self' ${pluginOrigin} data:`,
            "connect-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-src 'none'",
          ].join("; "),
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      state.logger?.error("plugin-ui.protocol-read", error, {
        pluginId: parsed.pluginId,
        contributionId: parsed.contributionId,
        relativePath: parsed.relativePath,
      });
      return new Response("Plugin UI asset unavailable", { status: 404 });
    }
  });

  // 主进程事件循环滞后监控（KEEL_LAG_LOG=1）：Main 也是单线程。若 Main 被
  // 同步工作堵住，Renderer 的 IPC 会迟迟不返回，表现就是「切换资源库卡住」，
  // 而 Worker 日志里看不到任何异常。
  if (process.env.KEEL_LAG_LOG === "1") {
    let lagWindowStart = Date.now();
    const lagTimer = setInterval(() => {
      const now = Date.now();
      const driftMs = now - lagWindowStart - 1_000;
      lagWindowStart = now;
      if (driftMs >= 200) {
        state.logger?.info("main.eventLoop.lag", "Main event loop was blocked.", { driftMs });
      }
    }, 1_000);
    lagTimer.unref?.();
  }
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

  ipcMain.handle(STARTUP_PREFERENCES_GET_CHANNEL, (event): StartupPreferencesSnapshot => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return readStartupPreferencesSnapshot();
    }
    return readStartupPreferencesSnapshot();
  });

  ipcMain.handle(SHORTCUT_BINDINGS_GET_CHANNEL, (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return readShortcutBindingsSnapshot();
    }
    return readShortcutBindingsSnapshot();
  });

  ipcMain.handle(
    SHORTCUT_BINDINGS_EXPORT_CHANNEL,
    async (event): Promise<ShortcutFileExportResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        return { ok: false, error: "unauthorized-sender" };
      }
      return exportShortcutBindingsFile();
    },
  );

  ipcMain.handle(
    SHORTCUT_BINDINGS_IMPORT_CHANNEL,
    async (event): Promise<ShortcutFileImportResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        return { ok: false, error: "unauthorized-sender" };
      }
      return importShortcutBindingsFile();
    },
  );

  ipcMain.handle(
    SHORTCUT_BINDINGS_SET_CHANNEL,
    (event, input: unknown): ShortcutBindingsSetResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.shortcuts", "Rejected shortcut update.", {
          code: "unauthorized-sender",
        });
        return {
          ok: false,
          bindings: readShortcutBindingsSnapshot(),
          error: "unauthorized-sender",
        };
      }
      try {
        return storeShortcutBindings(input);
      } catch (error) {
        state.logger?.error("shortcuts.store", error);
        return {
          ok: false,
          bindings: readShortcutBindingsSnapshot(),
          error: "shortcut-save-failed",
        };
      }
    },
  );

  // PF: open-with settings. Only the main window may read or change them.
  ipcMain.handle(OPEN_WITH_SETTINGS_GET_CHANNEL, (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return DEFAULT_OPEN_WITH_SETTINGS;
    return readOpenWithSettings(openWithSettingsFilePath(app.getPath("userData")));
  });
  ipcMain.handle(OPEN_WITH_SETTINGS_SET_CHANNEL, (event, input: unknown) => {
    const filePath = openWithSettingsFilePath(app.getPath("userData"));
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return readOpenWithSettings(filePath);
    try {
      return writeOpenWithSettings(filePath, input);
    } catch (error) {
      state.logger?.error("open-with.settings", error);
      return readOpenWithSettings(filePath);
    }
  });
  // PR: rule list, switch, order, run, history, files and the AI prompt.
  ipcMain.handle(RULE_INVOKE_CHANNEL, async (event, input: unknown): Promise<RuleIpcResult> => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return { ok: false, message: "Unauthorized." };
    const parsed = ruleIpcRequestSchema.safeParse(input);
    if (!parsed.success || !state.workerClient || !state.ruleRunner) return { ok: false, message: "规则服务不可用。" };
    const request = parsed.data;
    const listResult = (response: Awaited<ReturnType<LibraryWorkerClient["request"]>>): RuleIpcResult =>
      response.ok && response.type === "rule.list.result"
        ? { ok: true, list: response.result }
        : { ok: false, message: response.ok ? "规则服务不可用。" : response.error.code };
    try {
      switch (request.action) {
        case "list":
          return listResult(await state.workerClient.request({ type: "rule.list", libraryId: request.libraryId }));
        case "set-enabled":
          return listResult(await state.workerClient.request({ type: "rule.set-enabled", libraryId: request.libraryId, ruleId: request.ruleId, enabled: request.enabled }));
        case "set-layout":
          return listResult(await state.workerClient.request({ type: "rule.layout.set", libraryId: request.libraryId, layout: request.layout }));
        case "delete":
          return listResult(await state.workerClient.request({ type: "rule.delete", libraryId: request.libraryId, ruleId: request.ruleId }));
        case "create": {
          const id = randomUUID();
          return listResult(await state.workerClient.request({
            type: "rule.save",
            libraryId: request.libraryId,
            manifest: {
              $schema: "../rule.schema.json",
              version: 1,
              id,
              name: request.name,
              purpose: "",
              trigger: { kind: "manual" },
              scope: { folderId: null, recursive: true },
              permissions: ["asset.search"],
              script: "rule.ts",
            },
            source: [
              "// 用 AI 编写这条规则：点规则详情中的“复制给 AI”。",
              "const page = await keel.assets.search({ query: null, scope: rule.scope, limit: 20 });",
              "return { count: page.total };",
              "",
            ].join("\n"),
          }));
        }
        case "run": {
          const run = await state.ruleRunner.run({
            libraryId: request.libraryId,
            ruleId: request.ruleId,
            reason: request.dryRun ? "dry-run" : "manual",
            interactive: true,
          });
          return run ? { ok: true, run } : { ok: false, message: "找不到这条规则。" };
        }
        case "history": {
          const response = await state.workerClient.request({ type: "rule.runs.list", libraryId: request.libraryId, ruleId: request.ruleId, limit: 50 });
          return response.ok && response.type === "rule.runs.result" ? { ok: true, runs: response.runs } : { ok: false, message: "无法读取运行历史。" };
        }
        case "reveal":
        case "copy-for-ai": {
          const response = await state.workerClient.request({ type: "rule.list", libraryId: request.libraryId });
          if (!response.ok || response.type !== "rule.list.result") return { ok: false, message: "规则服务不可用。" };
          const list = response.result;
          const rule = request.ruleId ? list.rules.find((r) => r.manifest.id === request.ruleId) ?? null : null;
          if (request.action === "reveal") {
            const target = rule ? path.join(list.rulesDirectory, rule.manifest.id) : list.rulesDirectory;
            const failure = await shell.openPath(target);
            return failure ? { ok: false, message: failure } : { ok: true };
          }
          clipboard.writeText(ruleAiPrompt({ rulesDirectory: list.rulesDirectory.replaceAll("\\", "/"), rule }));
          return { ok: true };
        }
      }
    } catch (error) {
      state.logger?.error("rule.ipc", error, { action: request.action });
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(OPEN_WITH_CHOOSE_PROGRAM_CHANNEL, async (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return null;
    const result = await dialog.showOpenDialog(state.mainWindow, {
      properties: ["openFile"],
      ...(process.platform === "win32"
        ? { filters: [{ name: "Programs", extensions: ["exe", "bat", "cmd"] }] }
        : {}),
    });
    const executablePath = result.canceled ? undefined : result.filePaths[0];
    if (!executablePath) return null;
    return { name: path.parse(executablePath).name, executablePath };
  });

  ipcMain.handle(STARTUP_PREFERENCES_SET_CHANNEL, (event, input: unknown): StartupPreferencesSnapshot => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.startup-preferences", "Rejected startup preference update.", {
        code: "unauthorized-sender",
      });
      return readStartupPreferencesSnapshot();
    }
    try {
      return storeStartupPreferences(input);
    } catch (error) {
      state.logger?.error("startup.login-item", error);
      return {
        ...readStartupPreferencesSnapshot(),
        registrationFailed: true,
      };
    }
  });

  // 渲染进程请求在系统浏览器打开外部链接（检查器「源链接」跳转）。
  // 发送者与 URL 双重校验，仅放行不含凭据的 HTTP(S)。失败回传公开错误码；日志不含 URL。
  ipcMain.handle(
    OPEN_EXTERNAL_URL_CHANNEL,
    async (event, input: unknown): Promise<OpenExternalUrlResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const resolved = resolveOpenExternalUrlTarget(input);
      if (!resolved.ok) {
        state.logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: resolved.code,
        });
        return resolved;
      }
      try {
        await shell.openExternal(resolved.url);
        return { ok: true };
      } catch (error) {
        state.logger?.error("ipc.open-external-url", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Reveal serpent.log in the file manager without exposing the path to Renderer.
  ipcMain.handle(
    REVEAL_APP_LOG_CHANNEL,
    (event): RevealAppLogResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.reveal-app-log", "Rejected reveal-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      if (!state.appLogPath || !existsSync(state.appLogPath)) {
        state.logger?.info("ipc.reveal-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        shell.showItemInFolder(state.appLogPath);
        return { ok: true };
      } catch (error) {
        state.logger?.error("ipc.reveal-app-log", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Read only the recent, already-redacted entries for the in-app diagnostics view.
  // The absolute log path remains Main-owned and never crosses the bridge.
  ipcMain.handle(
    READ_APP_LOG_CHANNEL,
    (event, input: unknown): ReadAppLogResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.read-app-log", "Rejected read-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const request = parseReadAppLogRequest(input);
      if (!request) {
        state.logger?.info("ipc.read-app-log", "Rejected malformed app-log filter.", {
          code: "malformed_request",
        });
        return { ok: false, code: "malformed_request" };
      }
      if (!state.appLogPath || !existsSync(state.appLogPath)) {
        state.logger?.info("ipc.read-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        return {
          ok: true,
          entries: state.logger?.readRecent(500, {
            redactPaths: true,
            automationCorrelationId: request.automationCorrelationId,
          }) ?? [],
          fileName: path.basename(state.appLogPath),
        };
      } catch (error) {
        state.logger?.error("ipc.read-app-log", error, { code: "read_failure" });
        return { ok: false, code: "read_failure" };
      }
    },
  );

  // 文本输入右键：仅授权主窗口弹出 role 编辑菜单；Renderer 只传坐标。
  ipcMain.handle(
    SHOW_EDIT_CONTEXT_MENU_CHANNEL,
    (event, input: unknown): ShowEditContextMenuResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const result = popupEditContextMenu(event.sender, input);
      if (!result.ok) {
        state.logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: result.code,
        });
      }
      return result;
    },
  );

  // Serpent-166q: text-field ⌘C fallback when Edit menu routes through renderer.
  ipcMain.handle(NATIVE_EDIT_COPY_CHANNEL, (event): void => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    event.sender.copy();
  });
  ipcMain.handle(NATIVE_EDIT_COMMAND_CHANNEL, (event, input: unknown): void => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    if (input === "paste") event.sender.paste();
    if (input === "select-all") event.sender.selectAll();
  });

  // Bootstrap dialog locale from OS before Renderer syncs (Serpent-bwb).
  state.appLocale = mapSystemLocaleToAppLocale(app.getLocale());

  ipcMain.on(APP_LOCALE_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.app-locale", "Rejected app-locale update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseAppLocaleSync(input);
    if (!parsed.ok) {
      state.logger?.info("ipc.app-locale", "Dropped malformed app-locale update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    state.appLocale = parsed.locale;
    installApplicationMenu({
      locale: state.appLocale,
      recentLibraries: nativeMenuRecentLibraries(),
      shortcutBindings: readShortcutBindingsSnapshot(),
    });
    state.windowsTray?.updateLocale(state.appLocale);
  });

  // Serpent-q0b1: the renderer syncs native menu item enabled-state (business
  // undo/redo availability). Only commands from the real window are accepted.
  ipcMain.handle(LINKED_MISSING_VISIBILITY_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    if (typeof input !== "boolean") return;
    state.showMissingLinkedFiles = input;
    state.workerClient?.publishShowMissingLinkedFiles(input);
    setApplicationMenuCommandChecked("library.show-missing-linked", input);
  });

  ipcMain.handle(APPLICATION_MENU_ITEM_STATE_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return;
    }
    const record = input as { command?: unknown; enabled?: unknown; label?: unknown } | null;
    if (record === null || typeof record !== "object") return;
    if (typeof record.command !== "string") return;
    if (typeof record.enabled === "boolean") {
      setApplicationMenuCommandEnabled(record.command, record.enabled);
    }
    if (typeof record.label === "string" && record.label.length > 0 && record.label.length <= 200) {
      setApplicationMenuCommandLabel(record.command, record.label);
    }
  });

  ipcMain.on(ACTIVE_CONTEXT_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.active-context", "Rejected active-context update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseActiveContext(input);
    if (!parsed.ok) {
      state.logger?.info("ipc.active-context", "Dropped malformed active-context update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId !== undefined) {
      focusedContexts.set(windowId, parsed.context);
      if (parsed.context.libraryId) {
        state.lastExtensionTargetWindowId = windowId;
      }
      if (
        state.extensionBrowseFoldersStorePath &&
        parsed.context.libraryId &&
        parsed.context.selectedFolderId
      ) {
        recordExtensionBrowseFolder(
          state.extensionBrowseFoldersStorePath,
          parsed.context.libraryId,
          parsed.context.selectedFolderId,
        );
      }
    }
  });

  ipcMain.on(BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL, (_event, input: unknown) => {
    const enabled =
      typeof input === "object" &&
      input !== null &&
      "enabled" in input &&
      Boolean((input as { enabled?: unknown }).enabled);
    setWindowsBrowseShortcutAcceleratorsEnabled(enabled);
  });

  ipcMain.on(APPLICATION_SHORTCUTS_ENABLED_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    const enabled =
      typeof input === "object" &&
      input !== null &&
      "enabled" in input &&
      Boolean((input as { enabled?: unknown }).enabled);
    setWindowsApplicationShortcutAcceleratorsEnabled(enabled);
  });

  ipcMain.on(VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL, (event, input: unknown) => {
    const scope = typeof input === "object" && input !== null && "scope" in input
      && (input as { scope?: unknown }).scope === "viewer.audio"
      ? "viewer.audio"
      : "viewer.video";
    const active =
      typeof input === "object" &&
      input !== null &&
      "active" in input &&
      Boolean((input as { active?: unknown }).active);
    setViewerVideoShortcutCaptureActive(
      event.sender,
      active,
      readShortcutBindingsSnapshot(),
      scope,
    );
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL, (event, payload: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info('ipc.plugin-input-capture', 'Rejected input capture event.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCapturePublishPayload(payload);
    if (parsed === null) return;
    const result = state.pluginInputCaptureBroker?.publish(parsed);
    if (result === 'queued') schedulePluginInputCaptureFlush();
    if (result === 'released') publishPluginInputCaptureSessionsToRenderer();
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL, (event, payload: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info('ipc.plugin-input-capture', 'Rejected system modal seam.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCaptureSystemModalPayload(payload);
    if (parsed === null) return;
    state.pluginInputCaptureBroker?.setSystemModalActive(parsed.active);
  });

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
