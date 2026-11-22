import { default as path } from 'node:path';
import { app } from 'electron';
import { readExternalLibraryStagingRoots, writeExternalLibraryStagingRoots } from './external-library-staging-store';
import { state } from './main-state';
import { type MaterializedExternalLibrarySource, materializeExternalLibrarySource, sweepOrphanExternalLibraryStaging } from './external-library-archive';
import { tmpdir } from 'node:os';
import { readRecentLibraryEntries, readActiveLibraryPath } from './recent-libraries';

/**
 * Staging copies of external libraries (Eagle, Billfish, ZIP) and the import sources selected for them (split out of index.ts, P8).
 */
export function recentLibraryPath(): string {
  return path.join(app.getPath("userData"), "recent-library.json");
}

// Pending import source path (importId -> sourceFolderPath), remembered after validation.
export const pendingImportSources = new Map<string, string>();

// Archive-backed external libraries are extracted into Main-owned temporary
// directories. The Worker only receives the extracted root; these callbacks
// ensure the archive contents do not remain on disk after the operation.
export const externalSourceCleanups = new Map<string, () => Promise<void>>();

export const liveExternalLibraryStagingRoots = new Set<string>();

export function externalLibraryStagingStorePath(): string {
  return path.join(app.getPath("userData"), "external-library-staging.json");
}

export function persistExternalLibraryStagingRoot(root: string): void {
  const storePath = externalLibraryStagingStorePath();
  const current = readExternalLibraryStagingRoots(storePath, (error) => {
    state.logger?.error("external-library.staging-store.read", error);
  });
  writeExternalLibraryStagingRoots(storePath, [...current, root], (error) => {
    state.logger?.error("external-library.staging-store.write", error);
  });
}

export function forgetExternalLibraryStagingRoot(root: string): void {
  const storePath = externalLibraryStagingStorePath();
  const current = readExternalLibraryStagingRoots(storePath, (error) => {
    state.logger?.error("external-library.staging-store.read", error);
  });
  writeExternalLibraryStagingRoots(
    storePath,
    current.filter((value) => value !== root),
    (error) => {
      state.logger?.error("external-library.staging-store.write", error);
    },
  );
}

export function rememberExternalSource(materialized: MaterializedExternalLibrarySource): string {
  externalSourceCleanups.set(materialized.sourceRootPath, materialized.cleanup);
  return materialized.sourceRootPath;
}

export async function cleanupExternalSource(sourceRootPath: string | undefined): Promise<void> {
  if (!sourceRootPath) return;
  const cleanup = externalSourceCleanups.get(sourceRootPath);
  if (!cleanup) return;
  try {
    await cleanup();
    externalSourceCleanups.delete(sourceRootPath);
  } catch (error) {
    state.logger?.error("external-library.archive-cleanup", error);
  }
}

export async function cleanupAllExternalSources(): Promise<void> {
  const sourceRoots = [...externalSourceCleanups.keys()];
  await Promise.all(sourceRoots.map((sourceRootPath) => cleanupExternalSource(sourceRootPath)));
}

export async function materializeSelectedExternalLibrary(input: {
  readonly sourcePath: string;
  readonly kind: "eagle" | "billfish";
  readonly fallbackDirectory?: string;
}): Promise<MaterializedExternalLibrarySource> {
  return materializeExternalLibrarySource({
    sourcePath: input.sourcePath,
    kind: input.kind,
    preferredTempDirectory: tmpdir(),
    fallbackTempDirectory: input.fallbackDirectory,
    registerStagingRoot: (root) => {
      liveExternalLibraryStagingRoots.add(root);
      persistExternalLibraryStagingRoot(root);
    },
    unregisterStagingRoot: (root) => {
      liveExternalLibraryStagingRoots.delete(root);
      forgetExternalLibraryStagingRoot(root);
    },
  });
}

export function fallbackDirectoryForLibraryId(libraryId: string): string | undefined {
  const entries = readRecentLibraryEntries(recentLibraryPath(), (error) => {
    state.logger?.error("recent-library.read", error);
  });
  const match = entries.find((entry) => entry.libraryId === libraryId);
  if (match?.path) return path.dirname(path.resolve(match.path));
  const active = readActiveLibraryPath(recentLibraryPath(), (error) => {
    state.logger?.error("recent-library.read", error);
  });
  return active ? path.dirname(path.resolve(active)) : undefined;
}

export async function sweepOrphanExternalLibraryStagingOnStartup(): Promise<void> {
  const storePath = externalLibraryStagingStorePath();
  const registered = readExternalLibraryStagingRoots(storePath, (error) => {
    state.logger?.error("external-library.staging-store.read", error);
  });
  try {
    const result = await sweepOrphanExternalLibraryStaging({
      registeredRoots: registered,
      searchParents: [tmpdir()],
      liveRoots: liveExternalLibraryStagingRoots,
    });
    writeExternalLibraryStagingRoots(storePath, result.remaining, (error) => {
      state.logger?.error("external-library.staging-store.write", error);
    });
    if (result.removed.length > 0) {
      state.logger?.info("external-library.staging-sweep", "Removed leftover extract directories.", {
        removedCount: result.removed.length,
      });
    }
    if (result.failed.length > 0) {
      state.logger?.error(
        "external-library.staging-sweep",
        new Error("Could not remove leftover extract directories."),
        { failedCount: result.failed.length },
      );
    }
  } catch (error) {
    state.logger?.error("external-library.staging-sweep", error);
  }
}
