import { EmbeddingTestIndex } from './embedding-test-index';
import { state, type ActiveLibraryOpenCancellation } from './main-state';
import { app, safeStorage, nativeImage, clipboard, shell } from 'electron';
import { createRequire } from 'node:module';
import { default as path } from 'node:path';
import { resolveInstalledEmbeddingLayout, inspectManagedEmbeddingInstall } from './embedding-install';
import { resolveHostMediaBinaries } from './media-binary-env';
import { EmbeddingHttpIndex } from './embedding-http-index';
import { parseEmbeddingServiceCatalog } from './embedding-service-registry';
import { readEmbeddingServices, readEmbeddingServiceKey, readEmbeddingBindings, readEmbeddingModels, loadAiConfig, getDecryptedApiKey, resolveSyncServerCredentials, readSyncServers, writeSyncServers, readSyncBindings, writeSyncBindings, writeEmbeddingModels, writeEmbeddingServices, embeddingServiceKeyPath, writeEmbeddingServiceKey, deleteEmbeddingServiceKey, writeEmbeddingBindings, getDecryptedProfileApiKey, saveAiConfig, saveAiConnectionProfile, activateAiConnectionProfile, deleteAiConnectionProfile } from './ai-settings-files';
import { parseEmbeddingModelCatalog } from './embedding-model-catalog';
import { resolveEffectiveEmbeddingSelection } from '../shared/embedding/library-binding';
import { type AutomationExecutionContext } from '../automation/command-gateway';
import { readPendingCleanupAsidePaths, writePendingCleanupAsidePaths } from './pending-cleanup-store';
import { RelinkPreviewStore } from './relink-preview-store';
import { type ImageSequenceImportOffer, type RendererResult, type WorkerResult } from '../shared/protocol/responses';
import { randomUUID } from 'node:crypto';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { type RendererRequest, type WorkerCommand, parseRendererRequest } from '../shared/protocol/requests';
import { clearNativeAssetDragCache, lastVisibleDragAssetIds, nativeAssetDragPrimer, sourcePathCache, clearArtifactPathCache, cancelArtifactPathBatches } from './asset-path-caches';
import { clearActiveRecentLibrary, readRecentLibraryEntries, removeRecentLibrary } from './recent-libraries';
import { recentLibraryPath, cleanupExternalSource, materializeSelectedExternalLibrary, rememberExternalSource, fallbackDirectoryForLibraryId, pendingImportSources } from './external-library-staging';
import { publishLifecycle } from './renderer-events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { executeLibraryMainCommand } from './commands/library';
import { selectDirectory, createNativeDialogHost, selectImportSources } from './main-dialogs';
import { executeFolderMainCommand } from './commands/folders';
import { executeAssetQueryMainCommand } from './commands/asset-query';
import { executeAssetIngestionMainCommand } from './commands/asset-ingestion';
import { executeLinkedFolderMainCommand } from './commands/linked-folders';
import { executeIgnoreMainCommand } from './commands/ignore';
import { executeTagMainCommand } from './commands/tags';
import { executeBrowseSessionMainCommand } from './commands/browse-session';
import { executeAssetMutationMainCommand } from './commands/asset-mutations';
import { executeLibraryTransferMainCommand } from './commands/library-transfer';
import { executeAiMainCommand } from './commands/ai';
import { executeMediaJobMainCommand } from './commands/media-jobs';
import { executeMediaPathMainCommand } from './commands/media-paths';
import { executeSyncMainCommand } from './commands/sync';
import { tryHandleLibraryOwnedRequest, tryBuildOpenRecentCommand } from './library-request/library';
import { refreshApplicationMenuRecentLibraries, rememberOpenedLibrary, notifyLibraryOpenedSideEffects } from './library-opened';
import { criticalRendererRequest, confirmCriticalRendererRequest } from './desktop-confirmations';
import { maybeBeginLibraryDeleteFromDisk, prepareLibraryLifecycle, maybeDelayE2eTrash, applyLibraryReplacementAfterWorker, applyExternalLibrarySourceCleanup, applyLibraryWorkerSideEffects, tryHandleRecoveryReport, mapBillfishInspectedDisplayName, applyLibraryRendererLifecycle, externalSourceRootFromCommand } from './library-request/lifecycle';
import { beginLibraryDeleteMediaFence, unblockLibraryMediaReads, endLibraryDeleteMediaFence } from './library-media-reads';
import { tryHandleIngestionOwnedRequest, tryBuildIngestionCommand, maybeProbeImportSequences, applyImportWorkerResult } from './library-request/ingestion';
import { tryHandleSyncOwnedRequest, bindingNeedsRunAfterManual, runSyncProbeWithRetry, applySyncWorkerBindings } from './library-request/sync';
import { tryHandleEmbeddingModelRequest } from './library-request/embedding-models';
import { EMBEDDING_INSTALL_PROGRESS_CHANNEL } from '../shared/protocol/channels';
import { tryHandleAiOwnedRequest } from './library-request/ai';
import { processAiQueue, enqueueAutoAnalyzeAfterImport } from './ai-queue';
import { tryHandlePreviewOwnedRequest } from './library-request/preview';
import { tryHandleRelinkOwnedRequest, maybeRememberRelinkPreview } from './library-request/relink';
import { readFilePathsFromClipboard, createFileClipboardDeps, writeFilePathsToClipboard } from './file-clipboard';
import { maybePrimeNativeDrag } from './library-request/native-drag';
import { tryHandleMediaShellWorkerResult } from './library-request/media-shell';
import { openPathWithOtherApplication, createOpenWithDeps, openPathWithProgram } from './open-with';
import { readOpenWithSettings, openWithSettingsFilePath } from './open-with-settings-store';
import { spawn } from 'node:child_process';
import { toRendererResult } from './library-request/renderer-result';
import { ExternalLibraryArchiveError } from './external-library-archive';
import { LibraryParentError } from '../worker/library/library-parent';
import { WorkerRequestTimeoutError } from './worker-client';
import { cleanupClipboardImage } from './desktop-ingestion';

/**
 * The renderer's library request channel: turns each request into a worker command, with library open/replace, pending cleanups, import sources, image-sequence offers and embedding search (split out of index.ts, P8).
 */
export function embeddingIndex(): EmbeddingTestIndex {
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

export function embeddingHttp(): EmbeddingHttpIndex {
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

export const manualSyncRuns = new Map<string, {
  count: number;
  serverId: string;
  directoryName?: string;
  savedBindingDuringRun: boolean;
}>();

export const VIEWER_TIMING_LOG = process.env.KEEL_VIEWER_TIMING_LOG === "1";

export const pluginAutomationContexts = new Map<string, AutomationExecutionContext>();

export function pendingLibraryCleanupPath(): string {
  return path.join(app.getPath("userData"), "pending-library-cleanup.json");
}

// Serpent-65d837: backoff schedule for asking the Worker to remove `.del-*`
// aside roots left behind by a disk deletion. Windows handles (Defender scan,
// Explorer, lingering `keel://` streams) usually close within seconds, so a
// few short retries resolve it without user action; anything still remaining
// stays persisted and is retried on the next app launch.
export const PENDING_CLEANUP_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * Fire-and-forget: tells the Worker to remove every persisted `.del-*` aside
 * root, drops the paths that succeeded from the store, and keeps retrying the
 * remaining ones with a bounded backoff. Callers: after a deletion reported a
 * pending aside, and after the Worker becomes ready at startup.
 */
export function retryPendingLibraryCleanups(): void {
  if (state.pendingCleanupRetryTimer) return;
  void runPendingLibraryCleanups(0);
}

export async function runPendingLibraryCleanups(round: number): Promise<void> {
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

// Keeps selected roots in Main. Renderer receives only an opaque, one-shot token.
export const pendingRelinkPreviews = new RelinkPreviewStore();

// Pending import libraryId (importId -> libraryId), for auto-analyze after import.
export const pendingImportLibraries = new Map<string, string>();

export type StoredImageSequenceOffer = ImageSequenceImportOffer;

export const pendingImageSequenceOffers = new Map<
  string,
  {
    offer: StoredImageSequenceOffer;
    expiresAt: number;
    nextSequenceIndex: number;
  }
>();

export function rememberImageSequenceOffer(
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

export function cancelled(): RendererResult {
  return { ok: false, error: createPublicError("CANCELLED") };
}

export function isLibraryOpenRequest(request: RendererRequest): boolean {
  return request.type === "library.create.request"
    || request.type === "library.open.request"
    || request.type === "library.open-recent.request"
    || request.type === "library.open-eagle.request"
    || request.type === "library.open-billfish.request";
}

export async function closeOpenLibrariesBeforeReplacement(): Promise<string[]> {
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

export async function reopenLibrariesAfterFailedReplacement(
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
export function syncDeviceId(): string {
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

export async function commandFor(
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

export function assertNever(value: never): never {
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
export function libraryRequestTraceEnabled(): boolean {
  return process.env.KEEL_E2E === "1"
    && process.env.KEEL_E2E_LIBRARY_TRACE === "1";
}

export async function handleLibraryRequest(
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
