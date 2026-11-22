import type { RuleRunner } from "./automation/rule-runner";
import type { BrowserWindow } from "electron";
import type { EmbeddingTestIndex } from "./embedding/embedding-test-index";
import type { EmbeddingHttpIndex } from "./embedding/embedding-http-index";
import type { AppLocale } from "../shared/native-dialog-i18n";
import type { WindowsTrayController } from "./window/windows-tray";
import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationExecutionJournal } from './automation/automation-execution-journal';
import type { EmbeddedMcpServer } from './mcp/embedded-mcp-server';
import type { McpCredentialStoreError } from './mcp/mcp-client-credentials';
import type { McpPermissionBroker } from './mcp/mcp-permission-broker';
import type { McpPermissionPolicyStore } from './mcp/mcp-permission-policy-store';
import type { McpOperationChallengeStore } from './mcp/mcp-operation-challenge';
import type { CriticalConfirmationWindowManager } from './window/critical-confirmation-window';
import type { RendererCriticalConfirmationBroker } from './window/critical-confirmation-prompt';
import type { AutomationScriptFileService } from './automation/automation-script-file-service';
import type { AutomationRecentScriptsStore } from './automation/automation-recent-scripts-store';
import type { ScriptRuntimeSupervisor } from './automation/script-runtime-supervisor';
import type { PluginRuntimeSupervisor } from './plugins/plugin-runtime-supervisor';
import type { PluginTrustedRuntimeSupervisor } from './plugins/plugin-trusted-runtime-supervisor';
import type { PluginInputCaptureBroker } from '../shared/plugin-input-capture';
import type { PluginActivationCoordinator } from './plugins/plugin-activation-coordinator';
import type { PluginJobScheduler } from './plugins/plugin-job-scheduler';
import type { PluginProviderScheduler } from './plugins/plugin-provider-scheduler';
import type { PluginMcpToolProvider } from './plugins/plugin-mcp-tool-provider';
import type { PluginPackageManager } from './plugins/plugin-package-manager';
import type { LibraryWorkerClient } from "./library/worker-client";
import type { SyncAutoScheduler } from "./library/sync-auto-scheduler";
import type { AppLogger } from "./app/app-logger";
import type { PreviewCache } from "./media/preview-cache";
import type { OffscreenThumbnailRenderer } from "./media/offscreen-thumbnail-renderer";
import type { ExtensionServer } from "./ingestion/extension-server";
export type ActiveLibraryOpenCancellation = { cancelled: boolean };

/**
 * Mutable state of the main process (P8). Kept in one object so the code
 * split out of index.ts reads and replaces the same services and windows.
 */
export interface MainState {
  mainWindow: BrowserWindow | undefined;
  appLocale: AppLocale;
  workerClient: LibraryWorkerClient | undefined;
  embeddingTestIndex: EmbeddingTestIndex | undefined;
  embeddingHttpIndex: EmbeddingHttpIndex | undefined;
  syncAutoScheduler: SyncAutoScheduler | undefined;
  previewCache: PreviewCache | undefined;
  offscreenThumbnailRenderer: OffscreenThumbnailRenderer | undefined;
  quitAfterShutdown: boolean;
  applicationQuitting: boolean;
  applicationShutdownPromise: Promise<void> | null;
  startupComplete: boolean;
  logger: AppLogger | undefined;
  appLogPath: string | undefined;
  automationExecutionJournal: AutomationExecutionJournal | undefined;
  embeddedMcpServer: EmbeddedMcpServer | undefined;
  embeddedMcpInitializationFailure: McpCredentialStoreError | undefined;
  automationCommandGateway: AutomationCommandGateway | undefined;
  mcpPermissionPolicyStore: McpPermissionPolicyStore | undefined;
  mcpOperationChallengeStore: McpOperationChallengeStore | undefined;
  mcpPermissionBroker: McpPermissionBroker | undefined;
  criticalConfirmationWindowManager: CriticalConfirmationWindowManager | undefined;
  criticalConfirmationBroker: RendererCriticalConfirmationBroker | undefined;
  scriptRuntimeSupervisor: ScriptRuntimeSupervisor | undefined;
  ruleRunner: RuleRunner | undefined;
  pluginRuntimeSupervisor: PluginRuntimeSupervisor | undefined;
  pluginTrustedRuntimeSupervisor: PluginTrustedRuntimeSupervisor | undefined;
  pluginInputCaptureBroker: PluginInputCaptureBroker | undefined;
  pluginInputCaptureFlushTimer: NodeJS.Timeout | undefined;
  pluginActivationCoordinator: PluginActivationCoordinator | undefined;
  pluginJobScheduler: PluginJobScheduler | undefined;
  pluginProviderScheduler: PluginProviderScheduler | undefined;
  automationScriptFiles: AutomationScriptFileService | undefined;
  automationRecentScripts: AutomationRecentScriptsStore | undefined;
  pluginPackageManager: PluginPackageManager | undefined;
  pluginMcpToolProvider: PluginMcpToolProvider | undefined;
  windowsTray: WindowsTrayController | undefined;
  pendingCleanupRetry: number;
  pendingCleanupRetryTimer: NodeJS.Timeout | undefined;
  extensionServer: ExtensionServer | undefined;
  extensionBrowseFoldersStorePath: string | undefined;
  lastExtensionTargetWindowId: number | undefined;
  pendingEagleOpenSourcePath: string | undefined;
  pendingBillfishOpenSourcePath: string | undefined;
  activeLibraryOpenCancellation: ActiveLibraryOpenCancellation | undefined;
  pendingPluginDeviceStateRecoveryNotice: boolean;
  loopbackRelease: Promise<void> | undefined;
  showMissingLinkedFiles: boolean;
  cachedSyncDeviceId: string | undefined;
  e2eAutomationFilePlanConfirmationCount: number;
}

export const state: MainState = {
  mainWindow: undefined,
  appLocale: "en",
  workerClient: undefined,
  embeddingTestIndex: undefined,
  embeddingHttpIndex: undefined,
  syncAutoScheduler: undefined,
  previewCache: undefined,
  offscreenThumbnailRenderer: undefined,
  quitAfterShutdown: false,
  applicationQuitting: false,
  applicationShutdownPromise: null,
  startupComplete: false,
  logger: undefined,
  appLogPath: undefined,
  automationExecutionJournal: undefined,
  embeddedMcpServer: undefined,
  embeddedMcpInitializationFailure: undefined,
  automationCommandGateway: undefined,
  mcpPermissionPolicyStore: undefined,
  mcpOperationChallengeStore: undefined,
  mcpPermissionBroker: undefined,
  criticalConfirmationWindowManager: undefined,
  criticalConfirmationBroker: undefined,
  scriptRuntimeSupervisor: undefined,
  ruleRunner: undefined,
  pluginRuntimeSupervisor: undefined,
  pluginTrustedRuntimeSupervisor: undefined,
  pluginInputCaptureBroker: undefined,
  pluginInputCaptureFlushTimer: undefined,
  pluginActivationCoordinator: undefined,
  pluginJobScheduler: undefined,
  pluginProviderScheduler: undefined,
  automationScriptFiles: undefined,
  automationRecentScripts: undefined,
  pluginPackageManager: undefined,
  pluginMcpToolProvider: undefined,
  windowsTray: undefined,
  pendingCleanupRetry: 0,
  pendingCleanupRetryTimer: undefined,
  extensionServer: undefined,
  extensionBrowseFoldersStorePath: undefined,
  lastExtensionTargetWindowId: undefined,
  pendingEagleOpenSourcePath: undefined,
  pendingBillfishOpenSourcePath: undefined,
  activeLibraryOpenCancellation: undefined,
  pendingPluginDeviceStateRecoveryNotice: false,
  loopbackRelease: undefined,
  showMissingLinkedFiles: true,
  cachedSyncDeviceId: undefined,
  e2eAutomationFilePlanConfirmationCount: 0,
};
