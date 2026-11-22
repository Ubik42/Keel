import { type RendererLifecycleEvent, parseRendererLifecycleEvent, type AssetChangeEvent, parseAssetChangeEvent, type LibraryChangedEvent, parseLibraryChangedEvent, type ExtensionSaveCompletedEvent, parseExtensionSaveCompletedEvent, type ProgressEvent, type AiProgressEvent, parseAiProgressEvent, type AiAnalysisCompletedEvent, parseAiAnalysisCompletedEvent, type AiContentClearedEvent, parseAiContentClearedEvent } from '../../shared/protocol/responses';
import { state } from '../main-state';
import { LIBRARY_LIFECYCLE_CHANNEL, ASSET_CHANGE_CHANNEL, LIBRARY_CHANGED_CHANNEL, EXTENSION_SAVE_COMPLETED_CHANNEL, PROGRESS_CHANNEL, AI_PROGRESS_CHANNEL, AI_COMPLETED_CHANNEL, AI_CLEARED_CHANNEL } from '../../shared/protocol/channels';
import { sourcePathCache, evictArtifactPathCache, lastVisibleDragAssetIds, clearNativeAssetDragCache, nativeAssetDragPrimer } from '../media/asset-path-caches';
import { createPluginDomainEvent } from '../../plugins/plugin-domain-events';
import { BrowserWindow } from 'electron';

/**
 * Events sent from Main to the renderer: library lifecycle and changes, progress, AI results (split out of index.ts, P8).
 */
export function publishLifecycle(event: RendererLifecycleEvent): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(
    LIBRARY_LIFECYCLE_CHANNEL,
    parseRendererLifecycleEvent(event),
  );
}

export function publishAssetChange(event: AssetChangeEvent): void {
  const parsed = parseAssetChangeEvent(event);
  // Asset changes can invalidate a cached source path (delete, relink, move,
  // or replacement). Artifact-only library changes use the separate
  // library.changed channel and do not evict the viewer's hot path.
  sourcePathCache.clearLibrary(parsed.libraryId);
  evictArtifactPathCache(parsed.libraryId);
  if (parsed.nativeDragPathsChanged === true || parsed.source === "watcher") {
    const visibleDragIds = lastVisibleDragAssetIds.get(parsed.libraryId);
    clearNativeAssetDragCache(parsed.libraryId);
    if (visibleDragIds) {
      lastVisibleDragAssetIds.set(parsed.libraryId, visibleDragIds);
      nativeAssetDragPrimer.scheduleVisible(parsed.libraryId, visibleDragIds);
    }
  }
  state.embeddingTestIndex?.catchUp(parsed.libraryId);
  state.embeddingHttpIndex?.catchUp(parsed.libraryId);
  state.pluginActivationCoordinator?.fanOutDomainEvent(createPluginDomainEvent({
    kind: 'asset.changed',
    libraryId: parsed.libraryId,
    summary: {
      changedCount: parsed.changedCount,
      missingCount: parsed.missingCount,
      ...(parsed.source === undefined ? {} : { source: parsed.source }),
    },
  }));
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(
    ASSET_CHANGE_CHANNEL,
    parsed,
  );
}

export function publishLibraryChanged(event: LibraryChangedEvent): void {
  const parsed = parseLibraryChangedEvent(event);
  // `library.changed` is also emitted for immutable derived-artifact writes.
  // Advancing the Main-side path-cache generation here races a thumbnail
  // response that is already resolving: the path lookup returns a valid new
  // artifact, but the generation check rejects it as stale. The Renderer then
  // sees a transient protocol failure and permanently replaces the image with
  // its broken-file fallback. Asset/source mutations use asset.changed and
  // explicitly clear this cache; close/reopen paths clear it as well.
  state.pluginActivationCoordinator?.fanOutDomainEvent(createPluginDomainEvent({
    kind: 'library.changed',
    libraryId: parsed.libraryId,
    summary: {
      changeSequence: parsed.changeSequence,
    },
  }));
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(
    LIBRARY_CHANGED_CHANNEL,
    parsed,
  );
}

export function publishExtensionSaveCompleted(
  windowId: number | null,
  event: ExtensionSaveCompletedEvent,
): void {
  const target =
    windowId === null
      ? state.mainWindow
      : BrowserWindow.getAllWindows().find((window) => window.id === windowId);
  if (!target || target.isDestroyed()) return;
  target.webContents.send(
    EXTENSION_SAVE_COMPLETED_CHANNEL,
    parseExtensionSaveCompletedEvent(event),
  );
}

export function publishProgress(event: ProgressEvent): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(PROGRESS_CHANNEL, event);
}

export function publishAiProgress(event: AiProgressEvent): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(AI_PROGRESS_CHANNEL, parseAiProgressEvent(event));
}

export function publishAiCompleted(event: AiAnalysisCompletedEvent): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(
    AI_COMPLETED_CHANNEL,
    parseAiAnalysisCompletedEvent(event),
  );
}

export function publishAiCleared(event: AiContentClearedEvent): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send(
    AI_CLEARED_CHANNEL,
    parseAiContentClearedEvent(event),
  );
}
