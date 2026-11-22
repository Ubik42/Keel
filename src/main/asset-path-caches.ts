import { ArtifactPathCache } from './artifact-path-cache';
import { state } from './main-state';
import { NativeAssetDragCache } from './native-asset-drag';
import { NativeAssetDragPrimeScheduler } from './native-asset-drag-prime';
import { ASSET_NATIVE_DRAG_READINESS_CHANNEL } from '../shared/protocol/channels';
import { SourcePathCache } from './source-path-cache';

/**
 * Caches of resolved artifact and source paths, and native drag priming (split out of index.ts, P8).
 */
export type ArtifactPathBatchWaiter = {
  artifactId: string;
  generation: number;
  resolve: (absolutePath: string) => void;
  reject: (error: Error) => void;
};

export const artifactPathBatches = new Map<string, ArtifactPathBatchWaiter[]>();

export const artifactPathCache = new ArtifactPathCache(4_096);

export function clearArtifactPathCache(libraryId?: string): void {
  if (libraryId === undefined) {
    artifactPathCache.clear();
    return;
  }
  artifactPathCache.clearLibrary(libraryId);
}

export function evictArtifactPathCache(libraryId: string): void {
  // An async path batch may have started before this asset change. Fence its
  // completion as well as evicting existing entries, or stale paths reappear.
  artifactPathCache.clearLibrary(libraryId);
}

export function cancelArtifactPathBatches(libraryId: string): void {
  const prefix = `${libraryId}\u0000`;
  const error = new Error('Library closed before artifact path resolution completed.');
  for (const [key, waiters] of artifactPathBatches) {
    if (!key.startsWith(prefix)) continue;
    artifactPathBatches.delete(key);
    for (const waiter of waiters) waiter.reject(error);
  }
}

export function resolveArtifactPathBatched(
  libraryId: string,
  artifactId: string,
  usage: "preview" | "proxy",
): Promise<string> {
  const generation = artifactPathCache.generation(libraryId);
  const cached = artifactPathCache.get(libraryId, artifactId, usage, generation);
  if (cached !== undefined) {
    // A lookup hit is also a use: keep hot viewport artifacts at the MRU end
    // of the bounded cache instead of evicting them after unrelated pages.
    return Promise.resolve(cached);
  }
  // Keep requests from different library generations in separate batches. A
  // reopen can happen while the 2ms coalescing window is still pending.
  const key = `${libraryId}\u0000${usage}\u0000${generation}`;
  return new Promise<string>((resolve, reject) => {
    const batch = artifactPathBatches.get(key) ?? [];
    batch.push({ artifactId, generation, resolve, reject });
    artifactPathBatches.set(key, batch);
    if (batch.length > 1) return;
    setTimeout(() => {
      const pending = artifactPathBatches.get(key) ?? [];
      artifactPathBatches.delete(key);
      const client = state.workerClient;
      if (!client) {
        const error = new Error("Library Worker is unavailable.");
        for (const waiter of pending) waiter.reject(error);
        return;
      }
      void (async () => {
        for (let index = 0; index < pending.length; index += 500) {
          const chunk = pending.slice(index, index + 500);
          const requestGeneration = chunk[0]?.generation ?? generation;
          try {
            const result = await client.request({
              type: "media.get-artifact-paths",
              libraryId,
              artifactIds: chunk.map((waiter) => waiter.artifactId),
              usage,
            });
            if (!result.ok || result.type !== "media.artifact-paths") {
              throw new Error("Artifact path batch lookup failed.");
            }
            const paths = new Map(
              result.entries.map((entry) => [entry.artifactId, entry.absolutePath]),
            );
            for (const waiter of chunk) {
              const absolutePath = paths.get(waiter.artifactId);
              if (
                absolutePath &&
                artifactPathCache.generation(libraryId) === requestGeneration
              ) {
                artifactPathCache.set(
                  libraryId,
                  waiter.artifactId,
                  usage,
                  absolutePath,
                  requestGeneration,
                );
                waiter.resolve(absolutePath);
              } else if (absolutePath) {
                waiter.reject(new Error("Artifact path resolution became stale."));
              } else {
                artifactPathCache.invalidateArtifact(libraryId, waiter.artifactId, usage);
                waiter.reject(new Error("Artifact was absent from path batch."));
              }
            }
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            for (const waiter of chunk) waiter.reject(failure);
          }
        }
      })();
    }, 2);
  });
}

export const nativeAssetDragCache = new NativeAssetDragCache();

export const lastVisibleDragAssetIds = new Map<string, string[]>();

/**
 * Serpent-8ee170: every media completion enqueues here instead of issuing its
 * own Worker request, so a 2,000-job wave cannot become 2,000 background
 * requests competing with the queue that produced them.
 */
export const nativeAssetDragPrimer = new NativeAssetDragPrimeScheduler({
  fetchEntries: async (libraryId, assetIds) => {
    if (!state.workerClient) return null;
    try {
      const result = await state.workerClient.request({
        type: "media.get-asset-drag-infos",
        libraryId,
        assetIds: [...assetIds],
      });
      return result.ok && result.type === "media.asset-drag-infos" ? result.entries : null;
    } catch (error) {
      state.logger?.info("main.native-asset-drag-cache", "Could not preheat native drag entries.", {
        libraryId,
        assetCount: assetIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
  applyEntries: (libraryId, entries, mode) => {
    if (mode === "replace") {
      nativeAssetDragCache.replace(libraryId, entries as Parameters<NativeAssetDragCache["replace"]>[1]);
    } else {
      nativeAssetDragCache.upsert(libraryId, entries as Parameters<NativeAssetDragCache["upsert"]>[1]);
    }
    const dragWindow = state.mainWindow;
    if (dragWindow && !dragWindow.isDestroyed()) {
      if (mode === "replace") {
        dragWindow.webContents.send(ASSET_NATIVE_DRAG_READINESS_CHANNEL, {
          type: "clear", libraryId,
        });
      }
      dragWindow.webContents.send(ASSET_NATIVE_DRAG_READINESS_CHANNEL, {
        type: "ready", libraryId,
        assetIds: (entries as Parameters<NativeAssetDragCache["upsert"]>[1])
          .map((entry) => entry.assetId),
      });
    }
  },
});

export function clearNativeAssetDragCache(libraryId: string): void {
  lastVisibleDragAssetIds.delete(libraryId);
  nativeAssetDragCache.clear(libraryId);
  nativeAssetDragPrimer.invalidate(libraryId);
  const dragWindow = state.mainWindow;
  if (dragWindow && !dragWindow.isDestroyed()) {
    dragWindow.webContents.send(ASSET_NATIVE_DRAG_READINESS_CHANNEL, {
      type: "clear", libraryId,
    });
  }
}

export const sourcePathCache = new SourcePathCache();
