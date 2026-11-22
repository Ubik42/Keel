import { type AssetSummary, type FolderBrowseEntry, type IgnoredPath, type LinkedFolderDirectoryMutation, type LinkedFolderRule, type LinkedFolderSummary } from "../../shared/asset-types";
import { sanitizeEntityAppearance } from "../../shared/entity-appearance";
import { isLibraryMetaDirName } from "../../shared/library-meta-dir";
import { type LibraryStorageLayout } from "../../shared/library-storage-layout";
import { collectLinkedDirectoryPrefixes, countLinkedDirectoryAssets, directChildLinkedDirectories, encodeLinkedVirtualFolderId, linkedDirectoryName, parentLinkedRelativePath, parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { publicReasonFromError, type PublicErrorReason } from "../../shared/protocol/errors";
import { DEFAULT_ASSET_OBSERVER_FACTORY, LibraryServiceError, SimulatedCrashError, copyNameCandidates, createProgressThrottle, directoryBirthNs, gitignorePath, isAlwaysIgnoredAssetPath, isDefaultIgnoredAssetEntry, isMissingPathError, isUnreadablePathError, normalizeWatcherRelativePath, realDirectoryExists, realFileExists, serviceError, sourceDeviceHint, sourceHostDeviceHint, sourceIdentityKey, type AssetObserverEvent, type DatabaseConnection, type DiscoveredSourceEntry, type LibraryService, type LinkedWatcherChanges, type OpenLibrary, type OpenReconciliationTask, type OperationManifest, type RefreshManagedAssetsDiscovery } from "../library-service";
import { buildCatalogExplicitIgnoreSql } from "./catalog-read";
import type { parseGitignore } from "./gitignore";
import { gitignoreMatchesPath } from "./gitignore";
import { hasTable } from "./lenient-columns";
import { normalizeFolderName, normalizeRelativeAssetPath, portablePathIdentity, portablePathSegmentIdentity } from "./library-rules";
import { collectLinkedAssetPaths } from "./linked-asset-path-projection";
import { LinkedDirectoryIndex } from "./linked-directory-index";
import { linkedDirectoryIgnored } from "./linked-directory-visibility";
import { compileLinkedFolderRules } from "./linked-folder-rule-matcher";
import { pathIsWithin } from "./path-utils";
import { sqliteAllInChunks, sqliteInPlaceholders } from "./sqlite-in";
import { renamePathWithRetry } from "./windows-fs-retry";
import { randomUUID } from "node:crypto";
import { accessSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, type BigIntStats, type Stats, writeFileSync } from "node:fs";
import { lstat as lstatAsync, realpath as realpathAsync } from "node:fs/promises";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface LinkedMethods {
  linkedDirectoryIndex(...args: Parameters<typeof linkedDirectoryIndex>): ReturnType<typeof linkedDirectoryIndex>;
  countLinkedAssets(...args: Parameters<typeof countLinkedAssets>): ReturnType<typeof countLinkedAssets>;
  linkedFolderIgnored(...args: Parameters<typeof linkedFolderIgnored>): ReturnType<typeof linkedFolderIgnored>;
  refreshLinkedWatcherFileChanges(...args: Parameters<typeof refreshLinkedWatcherFileChanges>): ReturnType<typeof refreshLinkedWatcherFileChanges>;
  reconcileMovedLinkedAssets(...args: Parameters<typeof reconcileMovedLinkedAssets>): ReturnType<typeof reconcileMovedLinkedAssets>;
  linkedWatchKey(...args: Parameters<typeof linkedWatchKey>): ReturnType<typeof linkedWatchKey>;
  startLinkedWatcher(...args: Parameters<typeof startLinkedWatcher>): ReturnType<typeof startLinkedWatcher>;
  scheduleLinkedRefresh(...args: Parameters<typeof scheduleLinkedRefresh>): ReturnType<typeof scheduleLinkedRefresh>;
  stopLinkedWatcher(...args: Parameters<typeof stopLinkedWatcher>): ReturnType<typeof stopLinkedWatcher>;
  reconcileLinkedWatchers(...args: Parameters<typeof reconcileLinkedWatchers>): ReturnType<typeof reconcileLinkedWatchers>;
  stopLinkedWatchers(...args: Parameters<typeof stopLinkedWatchers>): ReturnType<typeof stopLinkedWatchers>;
  gitignoreMaterializationHasWork(...args: Parameters<typeof gitignoreMaterializationHasWork>): ReturnType<typeof gitignoreMaterializationHasWork>;
  migrateLegacyManagedIgnoreRules(...args: Parameters<typeof migrateLegacyManagedIgnoreRules>): ReturnType<typeof migrateLegacyManagedIgnoreRules>;
  reconcileLinkedWatchersForLibrary(...args: Parameters<typeof reconcileLinkedWatchersForLibrary>): ReturnType<typeof reconcileLinkedWatchersForLibrary>;
  linkedRootAvailability(...args: Parameters<typeof linkedRootAvailability>): ReturnType<typeof linkedRootAvailability>;
  linkedRootIsGone(...args: Parameters<typeof linkedRootIsGone>): ReturnType<typeof linkedRootIsGone>;
  linkedAssetPath(...args: Parameters<typeof linkedAssetPath>): ReturnType<typeof linkedAssetPath>;
  linkedAssetPathAsync(...args: Parameters<typeof linkedAssetPathAsync>): ReturnType<typeof linkedAssetPathAsync>;
  removeLinkedFolder(...args: Parameters<typeof removeLinkedFolder>): ReturnType<typeof removeLinkedFolder>;
  resolveLinkedDirectoryMutationTarget(...args: Parameters<typeof resolveLinkedDirectoryMutationTarget>): ReturnType<typeof resolveLinkedDirectoryMutationTarget>;
  linkedDirectoryMutationSummary(...args: Parameters<typeof linkedDirectoryMutationSummary>): ReturnType<typeof linkedDirectoryMutationSummary>;
  assertLinkedDirectorySiblingAvailable(...args: Parameters<typeof assertLinkedDirectorySiblingAvailable>): ReturnType<typeof assertLinkedDirectorySiblingAvailable>;
  createLinkedFolderDirectory(...args: Parameters<typeof createLinkedFolderDirectory>): ReturnType<typeof createLinkedFolderDirectory>;
  renameLinkedFolderDirectory(...args: Parameters<typeof renameLinkedFolderDirectory>): ReturnType<typeof renameLinkedFolderDirectory>;
  linkedFolderDisplayName(...args: Parameters<typeof linkedFolderDisplayName>): ReturnType<typeof linkedFolderDisplayName>;
  listLinkedFolderBrowseEntries(...args: Parameters<typeof listLinkedFolderBrowseEntries>): ReturnType<typeof listLinkedFolderBrowseEntries>;
  resolveLinkedFolderScope(...args: Parameters<typeof resolveLinkedFolderScope>): ReturnType<typeof resolveLinkedFolderScope>;
  linkedAssetPathKey(...args: Parameters<typeof linkedAssetPathKey>): ReturnType<typeof linkedAssetPathKey>;
  prepareLinkedAssetPaths(...args: Parameters<typeof prepareLinkedAssetPaths>): ReturnType<typeof prepareLinkedAssetPaths>;
  listLinkedAssetRelativePaths(...args: Parameters<typeof listLinkedAssetRelativePaths>): ReturnType<typeof listLinkedAssetRelativePaths>;
  readLinkedAssetPaths(...args: Parameters<typeof readLinkedAssetPaths>): ReturnType<typeof readLinkedAssetPaths>;
  linkedDirectoryCoverCandidateAssetIds(...args: Parameters<typeof linkedDirectoryCoverCandidateAssetIds>): ReturnType<typeof linkedDirectoryCoverCandidateAssetIds>;
  indexedLinkedDirectoryPrefixes(...args: Parameters<typeof indexedLinkedDirectoryPrefixes>): ReturnType<typeof indexedLinkedDirectoryPrefixes>;
  listLinkedFoldersAsync(...args: Parameters<typeof listLinkedFoldersAsync>): ReturnType<typeof listLinkedFoldersAsync>;
  listLinkedFolders(...args: Parameters<typeof listLinkedFolders>): ReturnType<typeof listLinkedFolders>;
  getLinkedFolderRules(...args: Parameters<typeof getLinkedFolderRules>): ReturnType<typeof getLinkedFolderRules>;
  setLinkedFolderRules(...args: Parameters<typeof setLinkedFolderRules>): ReturnType<typeof setLinkedFolderRules>;
  copyAssetsToLinkedFolder(...args: Parameters<typeof copyAssetsToLinkedFolder>): ReturnType<typeof copyAssetsToLinkedFolder>;
  copyLinkedAssetsToManagedFolder(...args: Parameters<typeof copyLinkedAssetsToManagedFolder>): ReturnType<typeof copyLinkedAssetsToManagedFolder>;
  convertLinkedFolderToManaged(...args: Parameters<typeof convertLinkedFolderToManaged>): ReturnType<typeof convertLinkedFolderToManaged>;
  filterIgnoredAssetIds(...args: Parameters<typeof filterIgnoredAssetIds>): ReturnType<typeof filterIgnoredAssetIds>;
  normalizeLinkedFolderRule(...args: Parameters<typeof normalizeLinkedFolderRule>): ReturnType<typeof normalizeLinkedFolderRule>;
  normalizeExplicitIgnorePath(...args: Parameters<typeof normalizeExplicitIgnorePath>): ReturnType<typeof normalizeExplicitIgnorePath>;
  explicitIgnoreSql(...args: Parameters<typeof explicitIgnoreSql>): ReturnType<typeof explicitIgnoreSql>;
  explicitFolderIgnored(...args: Parameters<typeof explicitFolderIgnored>): ReturnType<typeof explicitFolderIgnored>;
  isExplicitlyIgnored(...args: Parameters<typeof isExplicitlyIgnored>): ReturnType<typeof isExplicitlyIgnored>;
  assertAssetsNotExplicitlyIgnored(...args: Parameters<typeof assertAssetsNotExplicitlyIgnored>): ReturnType<typeof assertAssetsNotExplicitlyIgnored>;
  getGitignore(...args: Parameters<typeof getGitignore>): ReturnType<typeof getGitignore>;
  setGitignore(...args: Parameters<typeof setGitignore>): ReturnType<typeof setGitignore>;
  updateGitignoreRule(...args: Parameters<typeof updateGitignoreRule>): ReturnType<typeof updateGitignoreRule>;
  ignoreGitignoreRule(...args: Parameters<typeof ignoreGitignoreRule>): ReturnType<typeof ignoreGitignoreRule>;
  managedGitignoreRule(...args: Parameters<typeof managedGitignoreRule>): ReturnType<typeof managedGitignoreRule>;
  listIgnoredPaths(...args: Parameters<typeof listIgnoredPaths>): ReturnType<typeof listIgnoredPaths>;
  setIgnore(...args: Parameters<typeof setIgnore>): ReturnType<typeof setIgnore>;
  linkedPathIsIgnored(...args: Parameters<typeof linkedPathIsIgnored>): ReturnType<typeof linkedPathIsIgnored>;
  enumerateLinkedSources(...args: Parameters<typeof enumerateLinkedSources>): ReturnType<typeof enumerateLinkedSources>;
  registerWrittenLinkedAssets(...args: Parameters<typeof registerWrittenLinkedAssets>): ReturnType<typeof registerWrittenLinkedAssets>;
  reconcileLinkedFolderStatuses(...args: Parameters<typeof reconcileLinkedFolderStatuses>): ReturnType<typeof reconcileLinkedFolderStatuses>;
  reconcileDefaultIgnoredAssets(...args: Parameters<typeof reconcileDefaultIgnoredAssets>): ReturnType<typeof reconcileDefaultIgnoredAssets>;
  assertNetworkLinkedFoldersAvailable(...args: Parameters<typeof assertNetworkLinkedFoldersAvailable>): ReturnType<typeof assertNetworkLinkedFoldersAvailable>;
}

export function linkedDirectoryIndex(this: LibraryService, openLibrary: OpenLibrary): LinkedDirectoryIndex {
  let index = this.linkedDirectoryIndexes.get(openLibrary);
  if (!index) {
    index = new LinkedDirectoryIndex(() => openLibrary.connection);
    this.linkedDirectoryIndexes.set(openLibrary, index);
  }
  return index;
}

export function countLinkedAssets(this: LibraryService, paths: string[]): ReturnType<typeof countLinkedDirectoryAssets> {
  let counts = this.linkedAssetCounts.get(paths);
  if (!counts) {
    counts = countLinkedDirectoryAssets(paths);
    this.linkedAssetCounts.set(paths, counts);
  }
  return counts;
}

export function linkedFolderIgnored(this: LibraryService, openLibrary: OpenLibrary, rootId: string): (relativePath: string) => boolean {
  const rows = hasTable(openLibrary.connection, 'explicit_ignored_paths')
    ? openLibrary.connection.prepare(`
        SELECT relative_path FROM explicit_ignored_paths
         WHERE location_kind = 'linked' AND linked_folder_id = ? AND path_kind = 'folder'
      `).all(rootId) as Array<{ relative_path: string }>
    : [];
  return linkedDirectoryIgnored(rows.map((row) => row.relative_path), (relativePath) =>
    gitignoreMatchesPath(openLibrary.gitignoreMatcher, relativePath, 'folder', 'linked'),
  );
}

export async function refreshLinkedWatcherFileChanges(this: LibraryService, task: OpenReconciliationTask, pathsByFolder: Map<string, Set<string>>): Promise<{
    changedCount: number;
    inspectedPathCount: number;
    missingCount: number;
  } | null> {
  const openLibrary = task.openLibrary;
  const linkedEntriesByFolder = new Map<string, DiscoveredSourceEntry[]>();
  const existingLinkedAssetIdsByFolder = new Map<string, Map<string, string>>();
  const existingAssets: Array<{
    asset_id: string;
    location_kind: 'linked';
    linked_folder_id: string;
    relative_file_path: string;
    byte_size: number | null;
    modified_at: string | null;
  }> = [];
  const missingAssetIds: string[] = [];
  let inspectedPathCount = 0;

  if (pathsByFolder.size === 0) return null;
  for (const [folderId, relativePaths] of pathsByFolder) {
    this.assertReconciliationActive(task);
    this.reconcileLinkedFolderStatuses(openLibrary, new Set([folderId]));
    const folder = openLibrary.connection
      .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE library_id = ? AND folder_id = ?')
      .get(task.libraryId, folderId) as {
        absolute_root_path: string;
        status: 'available' | 'offline';
      } | undefined;
    if (!folder || folder.status !== 'available' || this.linkedRootIsGone(folder.absolute_root_path)) {
      return null;
    }
    const rules = this.getLinkedFolderRules({ libraryId: task.libraryId, folderId });
    const entries: DiscoveredSourceEntry[] = [];
    const existingByIdentity = new Map<string, string>();

    for (const relativePath of relativePaths) {
      this.assertReconciliationActive(task);
      let normalizedPath: string;
      try {
        normalizedPath = normalizeRelativeAssetPath(relativePath);
      } catch {
        return null;
      }
      const absolutePath = path.resolve(folder.absolute_root_path, ...normalizedPath.split('/'));
      if (!pathIsWithin(folder.absolute_root_path, absolutePath)) return null;
      const pathIdentity = portablePathIdentity(normalizedPath);
      const existing = openLibrary.connection
        .prepare(
          `SELECT a.asset_id, a.relative_file_path, r.byte_size, r.modified_at
             FROM assets a
             LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
            WHERE a.deleted_at IS NULL
              AND a.location_kind = 'linked'
              AND a.linked_folder_id = ?
              AND a.path_identity = ?
            LIMIT 1`,
        )
        .get(folderId, pathIdentity) as {
          asset_id: string;
          relative_file_path: string;
          byte_size: number | null;
          modified_at: string | null;
        } | undefined;

      let stat: Stats | BigIntStats;
      try {
        stat = await lstatAsync(absolutePath, { bigint: true });
      } catch (error) {
        if (!isMissingPathError(error)) return null;
        if (existing) missingAssetIds.push(existing.asset_id);
        inspectedPathCount += 1;
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isFile() || !existing) return null;
      if (
        this.isExplicitlyIgnored(openLibrary, 'linked', folderId, normalizedPath, 'asset')
        || this.linkedPathIsIgnored(normalizedPath, rules)
      ) {
        // Ignore-rule changes and newly ignored sources need the ordinary
        // snapshot path so availability is reconciled with the same rules as
        // a complete linked-root pass.
        return null;
      }

      const byteSize = Number(stat.size);
      if (!Number.isSafeInteger(byteSize)) return null;
      const entry: DiscoveredSourceEntry = {
        relativePath: normalizedPath,
        byteSize,
        modifiedAt: new Date(Number(stat.mtimeMs)).toISOString(),
        originalFilename: path.posix.basename(normalizedPath),
        sourceDevice: String(stat.dev),
        sourceInode: String(stat.ino),
        assetId: existing.asset_id,
      };
      entries.push(entry);
      existingByIdentity.set(pathIdentity, existing.asset_id);
      existingAssets.push({
        asset_id: existing.asset_id,
        location_kind: 'linked',
        linked_folder_id: folderId,
        relative_file_path: existing.relative_file_path,
        byte_size: existing.byte_size,
        modified_at: existing.modified_at,
      });
      inspectedPathCount += 1;
    }

    if (entries.length > 0) linkedEntriesByFolder.set(folderId, entries);
    if (existingByIdentity.size > 0) {
      existingLinkedAssetIdsByFolder.set(folderId, existingByIdentity);
    }
    await this.yieldReconciliation(task);
  }

  let changedCount = 0;
  let missingCount = 0;
  const missingBatchSize = openLibrary.summary.networkStorage ? 16 : 64;
  for (let offset = 0; offset < missingAssetIds.length; offset += missingBatchSize) {
    this.assertReconciliationActive(task);
    const result = this.refreshManagedAssets(task.libraryId, {
      assetIds: missingAssetIds.slice(offset, offset + missingBatchSize),
      discoverSources: false,
    });
    changedCount += result.changedCount;
    missingCount += result.missingCount;
    await this.yieldReconciliation(task);
  }

  if (linkedEntriesByFolder.size > 0) {
    const discovery: RefreshManagedAssetsDiscovery = {
      linkedEntriesByFolder,
      managedEntries: [],
      scopedLinkedFolderIds: new Set(pathsByFolder.keys()),
      existingLinkedAssetIdsByFolder,
      existingManagedAssetIdsByIdentity: new Map(),
      movedLinkedAssetsReconciled: true,
    };
    await this.waitForStableWatcherDiscovery(task, discovery, existingAssets);
    await this.prepareOpenReconciliationFingerprints(task, discovery, existingAssets);
    const result = await this.applyDiscoveredAssetsInBatches(task, discovery);
    changedCount += result.changedCount;
    missingCount += result.missingCount;
  }

  return { changedCount, inspectedPathCount, missingCount };
}

/**
* Relative paths identify catalog locations, not linked source files. A
* same-volume move keeps the source device/inode, so claim an unclaimed new
* path for the old asset before stale rows are marked missing. Ambiguous or
* unavailable identities are deliberately left as missing + new: guessing
* would silently attach the wrong file to the user's metadata.
*/
export function reconcileMovedLinkedAssets(this: LibraryService, openLibrary: OpenLibrary, discovery: RefreshManagedAssetsDiscovery, linkedFolderIds = discovery.scopedLinkedFolderIds): void {
  if (discovery.movedLinkedAssetsReconciled) return;
  const scopedLinkedFolderIds = linkedFolderIds?.size
    ? [...linkedFolderIds]
    : undefined;
  const rows = openLibrary.connection
    .prepare(
      `SELECT asset_id, linked_folder_id, source_device, source_inode
         FROM assets
        WHERE location_kind = 'linked' AND deleted_at IS NULL
          ${scopedLinkedFolderIds === undefined
            ? ''
            : `AND linked_folder_id IN (${scopedLinkedFolderIds.map(() => '?').join(',')})`}`,
    )
    .all(...(scopedLinkedFolderIds ?? [])) as Array<{
      asset_id: string;
      linked_folder_id: string;
      source_device: string | null;
      source_inode: string | null;
    }>;
  const sourceAssetByIdentity = new Map<string, string | null>();
  for (const row of rows) {
    const sourceIdentity = sourceIdentityKey(row.source_device, row.source_inode);
    const identity = sourceIdentity === undefined
      ? undefined
      : `${row.linked_folder_id}\u0000${sourceIdentity}`;
    if (!identity) continue;
    if (!sourceAssetByIdentity.has(identity)) {
      sourceAssetByIdentity.set(identity, row.asset_id);
    } else {
      // Duplicate identities are not safe to reconcile automatically. This
      // can happen on filesystems that report a zero/unstable inode; keep
      // the key explicitly ambiguous instead of letting insertion order win.
      sourceAssetByIdentity.set(identity, null);
    }
  }

  for (const [folderId, entries] of discovery.linkedEntriesByFolder) {
    const existingByPath = discovery.existingLinkedAssetIdsByFolder?.get(folderId)
      ?? new Map(
        (openLibrary.connection
          .prepare('SELECT asset_id, path_identity FROM assets WHERE linked_folder_id = ?')
          .all(folderId) as Array<{ asset_id: string; path_identity: string }>)
          .map((row) => [row.path_identity, row.asset_id] as const),
      );
    discovery.existingLinkedAssetIdsByFolder ??= new Map();
    discovery.existingLinkedAssetIdsByFolder.set(folderId, existingByPath);
    const claimedAssetIds = new Set(
      entries.flatMap((entry) => entry.assetId === undefined ? [] : [entry.assetId]),
    );
    for (const entry of entries) {
      if (entry.assetId !== undefined) continue;
      const sourceIdentity = sourceIdentityKey(entry.sourceDevice, entry.sourceInode);
      const identity = sourceIdentity === undefined
        ? undefined
        : `${folderId}\u0000${sourceIdentity}`;
      if (!identity) continue;
      const assetId = sourceAssetByIdentity.get(identity);
      if (assetId === undefined || assetId === null || claimedAssetIds.has(assetId)) continue;
      const pathIdentity = portablePathIdentity(entry.relativePath);
      if (existingByPath.has(pathIdentity)) continue;
      entry.assetId = assetId;
      existingByPath.set(pathIdentity, assetId);
      claimedAssetIds.add(assetId);
      this.diagnose('linked-folder.sync.asset-moved', 'External file moved within the linked root; asset reconciled to new path', {
        libraryId: openLibrary.summary.libraryId,
        assetId,
        linkedFolderId: folderId,
        newRelativePath: entry.relativePath,
      });
    }
  }
  discovery.movedLinkedAssetsReconciled = true;
}

export function linkedWatchKey(this: LibraryService, libraryId: string, folderId: string): string {
  return `${libraryId}:${folderId}`;
}

export function startLinkedWatcher(this: LibraryService, openLibrary: OpenLibrary, folder: { folder_id: string; absolute_root_path: string }): void {
  const libraryId = openLibrary.summary.libraryId;
  if (!this.watchRefreshByLibrary.has(libraryId)) {
    this.watchRefreshByLibrary.set(libraryId, { dirty: false, reason: 'watcher' });
  }
  const key = this.linkedWatchKey(libraryId, folder.folder_id);
  const existing = this.linkedWatchByKey.get(key);
  if (existing?.rootPath === folder.absolute_root_path) return;
  if (existing) this.stopLinkedWatcher(libraryId, folder.folder_id);
  if (this.linkedRootIsGone(folder.absolute_root_path)) return;

  const observerFactory = this.options.observerFactory ?? DEFAULT_ASSET_OBSERVER_FACTORY;
  try {
    const observer = observerFactory(
      folder.absolute_root_path,
      (event) => this.scheduleLinkedRefresh(libraryId, folder.folder_id, event),
      (error) => this.diagnose('linked-watcher.error', error, {
        libraryId,
        linkedFolderId: folder.folder_id,
        rootPath: folder.absolute_root_path,
      }),
    );
    this.linkedWatchByKey.set(key, {
      folderId: folder.folder_id,
      libraryId,
      observer,
      rootPath: folder.absolute_root_path,
    });
  } catch (error) {
    this.diagnose('linked-watcher.start', error, {
      libraryId,
      linkedFolderId: folder.folder_id,
      rootPath: folder.absolute_root_path,
    });
  }
}

export function scheduleLinkedRefresh(this: LibraryService, libraryId: string, folderId: string, event?: AssetObserverEvent): void {
  const key = this.linkedWatchKey(libraryId, folderId);
  const linkedWatch = this.linkedWatchByKey.get(key);
  if (!linkedWatch || !this.openById.has(libraryId)) return;
  const relativePath = event?.eventType === 'change'
    ? normalizeWatcherRelativePath(event.filename ?? null)
    : undefined;
  const linkedChanges: LinkedWatcherChanges = relativePath === undefined
    ? { kind: 'scope' }
    : {
        kind: 'files',
        pathsByFolder: new Map([[folderId, new Set([relativePath])]]),
      };
  this.scheduleWatcherRefresh(libraryId, {
    scope: 'linked-watcher.schedule',
    libraryId,
    linkedFolderId: folderId,
  }, 'watcher', linkedChanges);
}

export function stopLinkedWatcher(this: LibraryService, libraryId: string, folderId: string): void {
  const key = this.linkedWatchKey(libraryId, folderId);
  const linkedWatch = this.linkedWatchByKey.get(key);
  if (!linkedWatch) return;
  this.linkedWatchByKey.delete(key);
  try {
    linkedWatch.observer.close();
  } catch (error) {
    this.diagnose('linked-watcher.close', error, { libraryId, linkedFolderId: folderId });
  }
}

export function reconcileLinkedWatchers(this: LibraryService, openLibrary: OpenLibrary): void {
  const libraryId = openLibrary.summary.libraryId;
  const folders = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        WHERE library_id = ?`,
    )
    .all(libraryId) as Array<{
      folder_id: string;
      absolute_root_path: string;
      status: 'available' | 'offline';
    }>;
  const desired = new Map(
    folders
      .filter((folder) => folder.status === 'available' && !this.linkedRootIsGone(folder.absolute_root_path))
      .map((folder) => [this.linkedWatchKey(libraryId, folder.folder_id), folder]),
  );

  for (const [key, linkedWatch] of this.linkedWatchByKey) {
    if (linkedWatch.libraryId !== libraryId) continue;
    const folder = desired.get(key);
    if (!folder || folder.absolute_root_path !== linkedWatch.rootPath) {
      this.stopLinkedWatcher(libraryId, linkedWatch.folderId);
    }
  }
  for (const folder of desired.values()) this.startLinkedWatcher(openLibrary, folder);
}

export function stopLinkedWatchers(this: LibraryService, libraryId: string): void {
  for (const linkedWatch of [...this.linkedWatchByKey.values()]) {
    if (linkedWatch.libraryId === libraryId) {
      this.stopLinkedWatcher(libraryId, linkedWatch.folderId);
    }
  }
}

/**
* True when materializing .keelignore would delete or insert a row.
* Reads only: a no-op write transaction drops the network metadata snapshot
* and advances browse_change_sequence.
*/
export function gitignoreMaterializationHasWork(this: LibraryService, openLibrary: OpenLibrary, rules: ReturnType<typeof parseGitignore>): boolean {
  const managedExplicitCount = Number((openLibrary.connection.prepare(
    "SELECT COUNT(*) AS count FROM explicit_ignored_paths WHERE location_kind = 'managed'",
  ).get() as { count: number } | undefined)?.count ?? 0);
  const gitignoreCount = Number((openLibrary.connection.prepare(
    'SELECT COUNT(*) AS count FROM gitignore_ignored_paths',
  ).get() as { count: number } | undefined)?.count ?? 0);
  const linkedFolderCount = hasTable(openLibrary.connection, 'linked_folders')
    ? Number((openLibrary.connection.prepare(
        'SELECT COUNT(*) AS count FROM linked_folders WHERE library_id = ?',
      ).get(openLibrary.summary.libraryId) as { count: number } | undefined)?.count ?? 0)
    : 0;
  if (managedExplicitCount > 0 || gitignoreCount > 0 || linkedFolderCount > 0) return true;
  const folders = openLibrary.connection.prepare(
    'SELECT relative_path FROM managed_folders',
  ).all() as Array<{ relative_path: string }>;
  const assets = openLibrary.connection.prepare(
    "SELECT relative_file_path FROM assets WHERE location_kind = 'managed' AND deleted_at IS NULL",
  ).all() as Array<{ relative_file_path: string }>;
  return folders.some((folder) => gitignoreMatchesPath(rules, folder.relative_path, 'folder'))
    || assets.some((asset) => gitignoreMatchesPath(rules, asset.relative_file_path, 'asset'));
}

export function migrateLegacyManagedIgnoreRules(this: LibraryService, openLibrary: OpenLibrary, text: string): string {
  if (!hasTable(openLibrary.connection, 'explicit_ignored_paths')) return text;
  const legacyRows = openLibrary.connection
    .prepare(
      `SELECT relative_path, path_kind
         FROM explicit_ignored_paths
        WHERE location_kind = 'managed' AND linked_folder_id = ''
          AND path_kind IN ('asset', 'folder', 'extension')
        ORDER BY ignored_at, relative_path, path_kind`,
    )
    .all() as Array<{
      relative_path: string;
      path_kind: 'asset' | 'folder' | 'extension';
    }>;
  if (legacyRows.length === 0) return text;

  const lines = text.split(/\r?\n/u);
  const existing = new Set(lines.map((line) => line.trimEnd()));
  let changed = false;
  for (const row of legacyRows) {
    let rule: string | undefined;
    try {
      rule = this.managedGitignoreRule(row.relative_path, row.path_kind, openLibrary.summary.storageLayout);
    } catch {
      // A malformed legacy row must not prevent the rest of the library
      // from opening; valid rows are still promoted to the config file.
      continue;
    }
    if (rule === undefined || existing.has(rule)) continue;
    while (lines.at(-1) === '') lines.pop();
    lines.push(rule);
    existing.add(rule);
    changed = true;
  }
  return changed ? `${lines.join('\n')}\n` : text;
}

export function reconcileLinkedWatchersForLibrary(this: LibraryService, libraryId: string): void {
  this.reconcileLinkedWatchers(this.requireOpenLibrary(libraryId));
}

export function linkedRootAvailability(this: LibraryService, absoluteRootPath: string): | {
        available: true;
        deviceHint: string;
        legacyInodeHint: string;
        legacyHostDeviceHint?: string;
        legacyDeviceHint?: string;
      }
    | { available: false; reason: PublicErrorReason } {
  const lstat = this.options.linkedRootLstat
    ?? ((rootPath: string) => lstatSync(rootPath, { bigint: true }));
  const access = this.options.linkedRootAccess ?? ((rootPath: string) => {
    accessSync(rootPath, constants.R_OK | constants.X_OK);
  });
  try {
    const entry = lstat(absoluteRootPath);
    if (entry.isSymbolicLink()) {
      return { available: false, reason: 'SYMBOLIC_LINK_NOT_ALLOWED' };
    }
    if (!entry.isDirectory()) {
      return { available: false, reason: 'UNSUPPORTED_FILE_ENTRY' };
    }
    // Windows delete-pending: a just-removed tree can leave a directory
    // entry that lstat still sees but that rejects every access with EPERM
    // until the last open handle closes. POSIX reports ENOENT at the lstat
    // above, so only Windows needs this second check — without it the
    // refresh falls through to enumeration and crashes on the EPERM.
    access(absoluteRootPath);
    const device =
      typeof entry.dev === 'number' || typeof entry.dev === 'bigint'
        ? entry.dev
        : 'unknown';
    const inode =
      typeof entry.ino === 'number' || typeof entry.ino === 'bigint'
        ? entry.ino
        : 'unknown';
    const birthNs = directoryBirthNs(entry);
    return {
      available: true,
      deviceHint: sourceDeviceHint(device, inode, birthNs),
      legacyInodeHint: sourceDeviceHint(device, inode),
      ...(device === 'unknown'
        ? {}
        : { legacyHostDeviceHint: sourceHostDeviceHint(device) }),
      ...(device === 'unknown' ? {} : { legacyDeviceHint: String(device) }),
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { available: false, reason: 'LINKED_FOLDER_NOT_FOUND' };
    }
    if (code === 'EIO') {
      return { available: false, reason: 'IO_ERROR' };
    }
    if (
      code === 'ENODEV' || code === 'ESTALE' || code === 'ECONNRESET' ||
      code === 'ENETUNREACH' || code === 'EHOSTUNREACH'
    ) {
      return {
        available: false,
        reason: 'LINKED_FOLDER_NETWORK_DISCONNECTED',
      };
    }
    return {
      available: false,
      reason: publicReasonFromError(error) ?? 'IO_ERROR',
    };
  }
}

export function linkedRootIsGone(this: LibraryService, absoluteRootPath: string): boolean {
  return !this.linkedRootAvailability(absoluteRootPath).available;
}

export function linkedAssetPath(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string | null, relativeFilePath: string): string {
  if (!linkedFolderId) throw new LibraryServiceError('LIBRARY_CORRUPT');
  const folder = openLibrary.connection
    .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
    .get(linkedFolderId) as { absolute_root_path: string } | undefined;
  if (!folder) throw new LibraryServiceError('LIBRARY_CORRUPT');
  // If the root is gone, replaced, or replaced by a symlink, return a path that
  // will stat as missing so the asset reconciles to 'missing' rather than
  // aborting the refresh. A later slice flips the whole folder to 'offline'.
  let rootPath: string;
  try {
    const rootEntry = lstatSync(folder.absolute_root_path);
    if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
      return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
    }
    rootPath = realpathSync(folder.absolute_root_path);
  } catch {
    return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
  }
  const targetPath = path.resolve(rootPath, ...relativeFilePath.split('/'));
  const relation = path.relative(rootPath, targetPath);
  if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  let cursor = rootPath;
  for (const component of relation.split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      if (isUnreadablePathError(error)) break;
      throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
    }
  }
  return targetPath;
}

export async function linkedAssetPathAsync(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string | null, relativeFilePath: string): Promise<string> {
  if (!linkedFolderId) throw new LibraryServiceError('LIBRARY_CORRUPT');
  const folder = openLibrary.connection
    .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
    .get(linkedFolderId) as { absolute_root_path: string } | undefined;
  if (!folder) throw new LibraryServiceError('LIBRARY_CORRUPT');

  let rootPath: string;
  try {
    const rootEntry = await lstatAsync(folder.absolute_root_path);
    if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
      return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
    }
    rootPath = await realpathAsync(folder.absolute_root_path);
  } catch {
    return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
  }
  const targetPath = path.resolve(rootPath, ...relativeFilePath.split('/'));
  const relation = path.relative(rootPath, targetPath);
  if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  let cursor = rootPath;
  for (const component of relation.split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      if ((await lstatAsync(cursor)).isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      if (isUnreadablePathError(error)) break;
      throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
    }
  }
  return targetPath;
}

/**
* Clarification #7（2026-09-15 修订）：移除链接文件夹 = 只删除链接记录，源文件从不改动。
* 链接子树删完后需要清掉链接记录时，由调用方传 `progress: 'silent'`，避免在同一个操作里
* 再发一条空进度流（否则界面会看到一条 0/0 的终态进度）。
*/
export async function removeLinkedFolder(this: LibraryService, input: {
      libraryId: string;
      folderId: string;
    }, options: { progress?: 'emit' | 'silent' } = {}): Promise<{ removedAssetCount: number }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.cancelReconciliationForClientMutation(input.libraryId);
  const linked = openLibrary.connection
    .prepare(
      'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
    )
    .get(input.folderId, input.libraryId) as { folder_id: string } | undefined;
  if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const assetRows = openLibrary.connection
    .prepare(
      `SELECT asset_id FROM assets
        WHERE linked_folder_id = ? AND location_kind = 'linked' AND deleted_at IS NULL`,
    )
    .all(input.folderId) as Array<{ asset_id: string }>;

  // 2026-09-15：索引行的删除分批进行，批间让出事件循环。旧实现在单个事务里逐行
  // DELETE——1.5 万条记录会长时间独占 mutation 车道，且界面没有任何进度反馈。
  const operationId = randomUUID();
  const totalFiles = assetRows.length;
  const removeThrottle = createProgressThrottle();
  const silent = options.progress === 'silent';
  let processed = 0;
  const emitRun = (force = false): void => {
    if (silent) return;
    if (!removeThrottle.shouldEmit(force || processed === totalFiles)) return;
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'linked-remove',
      phase: 'run',
      filesProcessed: processed,
      totalFiles,
    });
  };
  if (!silent) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'linked-remove',
      phase: 'run',
      filesProcessed: 0,
      totalFiles,
    });
  }

  const REMOVE_CHUNK_SIZE = 500;
  const removeAsset = openLibrary.connection.prepare(
    'DELETE FROM assets WHERE asset_id = ?',
  );
  for (let offset = 0; offset < assetRows.length; offset += REMOVE_CHUNK_SIZE) {
    const chunk = assetRows.slice(offset, offset + REMOVE_CHUNK_SIZE);
    openLibrary.connection.transaction(() => {
      for (const row of chunk) removeAsset.run(row.asset_id);
    })();
    processed += chunk.length;
    emitRun();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  openLibrary.connection.transaction(() => {
    openLibrary.connection
      .prepare('DELETE FROM explicit_ignored_paths WHERE linked_folder_id = ?')
      .run(input.folderId);
    const removed = openLibrary.connection
      .prepare('DELETE FROM linked_folders WHERE folder_id = ?')
      .run(input.folderId);
    if (removed.changes !== 1) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
  })();

  this.linkedDirectoryIndex(openLibrary).forget(input.folderId);
  this.linkedAssetPaths.get(openLibrary)?.delete(`${input.folderId}:true`);
  this.linkedAssetPaths.get(openLibrary)?.delete(`${input.folderId}:false`);
  this.stopLinkedWatcher(input.libraryId, input.folderId);
  if (!silent) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'linked-remove',
      phase: 'complete',
      filesProcessed: totalFiles,
      totalFiles,
    });
  }
  return { removedAssetCount: assetRows.length };
}

/**
* Resolve a linked root/virtual directory without exposing its filesystem
* path to the renderer.  The relative path is validated at this boundary so
* every linked-directory mutation is confined to the imported root.
*/
export function resolveLinkedDirectoryMutationTarget(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, relativePath: string): {
    linkedFolderId: string;
    relativePath: string;
    absoluteRootPath: string;
    absolutePath: string;
    status: 'available' | 'offline';
  } {
  let normalizedPath: string;
  try {
    normalizedPath = relativePath === ''
      ? ''
      : normalizeRelativeAssetPath(relativePath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
  }
  const linked = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    )
    .get(linkedFolderId, openLibrary.summary.libraryId) as
    | {
        folder_id: string;
        absolute_root_path: string;
        status: 'available' | 'offline';
      }
    | undefined;
  if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (linked.status !== 'available' || this.linkedRootIsGone(linked.absolute_root_path)) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  // Use the same component-by-component symlink guard as linkedAssetPath.
  // A probe is intentionally not required to exist; missing final probe
  // components stop validation after all real parent components are checked.
  const probe = normalizedPath === ''
    ? '.keel-folder-probe'
    : `${normalizedPath}/.keel-folder-probe`;
  this.linkedAssetPath(openLibrary, linked.folder_id, probe);
  const absolutePath = normalizedPath === ''
    ? linked.absolute_root_path
    : path.join(linked.absolute_root_path, ...normalizedPath.split('/'));
  if (!realDirectoryExists(absolutePath)) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  return {
    linkedFolderId: linked.folder_id,
    relativePath: normalizedPath,
    absoluteRootPath: linked.absolute_root_path,
    absolutePath,
    status: linked.status,
  };
}

export function linkedDirectoryMutationSummary(this: LibraryService, input: {
      linkedFolderId: string;
      relativePath: string;
      name: string;
      status: 'available' | 'offline';
    }): LinkedFolderDirectoryMutation {
  const parentRelativePath = parentLinkedRelativePath(input.relativePath);
  return {
    folderId: encodeLinkedVirtualFolderId(input.linkedFolderId, input.relativePath),
    linkedFolderId: input.linkedFolderId,
    parentFolderId: parentRelativePath === null || parentRelativePath === ''
      ? input.relativePath === '' ? null : input.linkedFolderId
      : encodeLinkedVirtualFolderId(input.linkedFolderId, parentRelativePath),
    name: input.name,
    relativePath: input.relativePath,
    status: input.status,
  };
}

export function assertLinkedDirectorySiblingAvailable(this: LibraryService, parentPath: string, name: string, sourceName?: string): string {
  let entries;
  try {
    entries = readdirSync(parentPath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
  }
  const targetIdentity = portablePathSegmentIdentity(name);
  for (const entry of entries) {
    if (sourceName !== undefined && entry.name === sourceName) continue;
    if (portablePathSegmentIdentity(entry.name) === targetIdentity) {
      throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
    }
  }
  return path.join(parentPath, name);
}

/** Create an actual directory inside a linked root or virtual child. */
export function createLinkedFolderDirectory(this: LibraryService, input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    name: string;
  }): LinkedFolderDirectoryMutation {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  let name: string;
  try {
    name = normalizeFolderName(input.name);
  } catch (error) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
  }
  const parent = this.resolveLinkedDirectoryMutationTarget(
    openLibrary,
    input.linkedFolderId,
    input.relativePath,
  );
  const targetPath = this.assertLinkedDirectorySiblingAvailable(parent.absolutePath, name);
  this.cancelReconciliationForClientMutation(input.libraryId);
  try {
    mkdirSync(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  const relativePath = parent.relativePath === ''
    ? name
    : path.posix.join(parent.relativePath, name);
  this.linkedDirectoryIndex(openLibrary).add(parent.linkedFolderId, relativePath);
  this.noteClientFilesystemMutation();
  return this.linkedDirectoryMutationSummary({
    linkedFolderId: parent.linkedFolderId,
    relativePath,
    name,
    status: parent.status,
  });
}

/** Rename a linked root or a physical virtual-child directory in place. */
export function renameLinkedFolderDirectory(this: LibraryService, input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    newName: string;
  }): LinkedFolderDirectoryMutation {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  let name: string;
  try {
    name = normalizeFolderName(input.newName);
  } catch (error) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
  }
  const target = this.resolveLinkedDirectoryMutationTarget(
    openLibrary,
    input.linkedFolderId,
    input.relativePath,
  );
  const sourceName = path.basename(target.absolutePath);
  const parentPath = path.dirname(target.absolutePath);
  const destinationPath = this.assertLinkedDirectorySiblingAvailable(
    parentPath,
    name,
    sourceName,
  );
  if (destinationPath === target.absolutePath) {
    return this.linkedDirectoryMutationSummary({
      linkedFolderId: target.linkedFolderId,
      relativePath: target.relativePath,
      name,
      status: target.status,
    });
  }

  this.cancelReconciliationForClientMutation(input.libraryId);
  let renamed = false;
  try {
    renamePathWithRetry(target.absolutePath, destinationPath);
    renamed = true;
    const now = new Date().toISOString();
    if (target.relativePath === '') {
      let canonicalDestination: string;
      try {
        canonicalDestination = realpathSync(destinationPath);
      } catch (error) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
      }
      openLibrary.connection.transaction(() => {
        const changed = openLibrary.connection
          .prepare(
            `UPDATE linked_folders
                SET display_name = ?, absolute_root_path = ?, path_identity = ?, updated_at = ?
              WHERE folder_id = ? AND library_id = ?`,
          )
          .run(name, canonicalDestination, canonicalDestination, now, target.linkedFolderId, input.libraryId);
        if (changed.changes !== 1) throw new LibraryServiceError('FOLDER_NOT_FOUND');
      })();
      this.stopLinkedWatcher(input.libraryId, target.linkedFolderId);
      this.reconcileLinkedWatchers(openLibrary);
      this.noteClientFilesystemMutation();
      const assetCount = openLibrary.connection
        .prepare('SELECT COUNT(*) AS count FROM assets WHERE linked_folder_id = ?')
        .get(target.linkedFolderId) as { count: number };
      if (assetCount.count > 0) this.emitClientAssetsChanged(input.libraryId, assetCount.count, true);
      return this.linkedDirectoryMutationSummary({
        linkedFolderId: target.linkedFolderId,
        relativePath: '',
        name,
        status: target.status,
      });
    }

    const oldPrefix = `${target.relativePath}/`;
    const newParent = parentLinkedRelativePath(target.relativePath) ?? '';
    const newRelativePath = newParent === ''
      ? name
      : path.posix.join(newParent, name);
    const prefixLength = [...oldPrefix].length;
    const linkedAssets = openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path
           FROM assets
          WHERE linked_folder_id = ? AND location_kind = 'linked'
            AND (relative_file_path = ? OR substr(relative_file_path, 1, ?) = ?)`,
      )
      .all(target.linkedFolderId, target.relativePath, prefixLength, oldPrefix) as Array<{
        asset_id: string;
        relative_file_path: string;
      }>;
    const ignoredPaths = hasTable(openLibrary.connection, 'explicit_ignored_paths')
      ? openLibrary.connection
        .prepare(
          `SELECT location_kind, linked_folder_id, relative_path, path_kind, ignored_at
             FROM explicit_ignored_paths
            WHERE location_kind = 'linked' AND linked_folder_id = ?
              AND path_kind IN ('asset', 'folder')
              AND (relative_path = ? OR substr(relative_path, 1, ?) = ?)`,
        )
        .all(target.linkedFolderId, target.relativePath, prefixLength, oldPrefix) as Array<{
          location_kind: 'linked';
          linked_folder_id: string;
          relative_path: string;
          path_kind: 'asset' | 'folder';
          ignored_at: string;
        }>
      : [];
    openLibrary.connection.transaction(() => {
      const updateAsset = openLibrary.connection.prepare(
        `UPDATE assets
            SET relative_file_path = ?, path_identity = ?, updated_at = ?
          WHERE asset_id = ?`,
      );
      for (const asset of linkedAssets) {
        const rewritten = asset.relative_file_path === target.relativePath
          ? newRelativePath
          : newRelativePath + asset.relative_file_path.slice(target.relativePath.length);
        updateAsset.run(rewritten, portablePathIdentity(rewritten), now, asset.asset_id);
        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
      }
      if (ignoredPaths.length > 0) {
        const remove = openLibrary.connection.prepare(
          `DELETE FROM explicit_ignored_paths
            WHERE location_kind = ? AND linked_folder_id = ?
              AND relative_path = ? AND path_kind = ?`,
        );
        const insert = openLibrary.connection.prepare(
          `INSERT OR REPLACE INTO explicit_ignored_paths
            (location_kind, linked_folder_id, relative_path, path_kind, ignored_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const ignored of ignoredPaths) {
          const rewritten = ignored.relative_path === target.relativePath
            ? newRelativePath
            : newRelativePath + ignored.relative_path.slice(target.relativePath.length);
          remove.run(ignored.location_kind, ignored.linked_folder_id, ignored.relative_path, ignored.path_kind);
          insert.run(ignored.location_kind, ignored.linked_folder_id, rewritten, ignored.path_kind, ignored.ignored_at);
        }
      }
      this.linkedDirectoryIndex(openLibrary).rename(target.linkedFolderId, target.relativePath, newRelativePath);
      this.linkedDirectoryIndex(openLibrary).add(target.linkedFolderId, newRelativePath);
    })();
    this.noteClientFilesystemMutation();
    if (linkedAssets.length > 0) this.emitClientAssetsChanged(input.libraryId, linkedAssets.length, true);
    return this.linkedDirectoryMutationSummary({
      linkedFolderId: target.linkedFolderId,
      relativePath: newRelativePath,
      name,
      status: target.status,
    });
  } catch (error) {
    if (renamed) {
      try {
        renamePathWithRetry(destinationPath, target.absolutePath);
      } catch (rollbackError) {
        this.diagnose('linked-folder.rename.rollback', rollbackError, {
          libraryId: input.libraryId,
          linkedFolderId: input.linkedFolderId,
          relativePath: input.relativePath,
        });
      }
    }
    if (isMissingPathError(error)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
    }
    if (error instanceof LibraryServiceError) throw error;
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

export function linkedFolderDisplayName(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string): string {
  const row = openLibrary.connection
    .prepare(
      `SELECT display_name FROM linked_folders WHERE folder_id = ?`,
    )
    .get(linkedFolderId) as { display_name: string } | undefined;
  return row?.display_name ?? 'Linked';
}

/**
* Serpent-a9vh: virtual child folders for a linked root or linked subdir.
* Returns null when `parentFolderId` is not a linked scope.
*/
export function listLinkedFolderBrowseEntries(this: LibraryService, openLibrary: OpenLibrary, input: { parentFolderId: string | null; showIgnored?: boolean }, preparedPaths?: ReadonlyMap<string, string[]>): FolderBrowseEntry[] | null {
  if (input.parentFolderId === null) return null;
  const resolved = this.resolveLinkedFolderScope(openLibrary, input.parentFolderId);
  if (!resolved) return null;

  const paths = preparedPaths?.get(resolved.linkedFolderId) ?? this.listLinkedAssetRelativePaths(
    openLibrary,
    resolved.linkedFolderId,
    input.showIgnored === true,
  );
  const assetCounts = this.countLinkedAssets(paths);
  const assetPrefixes = [...assetCounts.keys()].filter((prefix) => prefix !== '');
  const rules = this.getLinkedFolderRules({ libraryId: openLibrary.summary.libraryId, folderId: resolved.linkedFolderId });
  const diskChildren = (parent: string) => this.indexedLinkedDirectoryPrefixes(openLibrary,
    resolved.linkedFolderId, rules, input.showIgnored === true, parent);
  const folderIgnored = this.linkedFolderIgnored(openLibrary, resolved.linkedFolderId);
  const children = [...new Set([...directChildLinkedDirectories(assetPrefixes, resolved.relativePath),
    ...diskChildren(resolved.relativePath)])].sort()
    .filter((relativePath) => input.showIgnored === true || !folderIgnored(relativePath));
  if (children.length === 0) return [];
  const diskGrandchildren = this.linkedDirectoryIndex(openLibrary).childrenByParent(resolved.linkedFolderId, children);
  const childDirectories = new Map(children.map((relativePath) => [relativePath,
    [...new Set([...directChildLinkedDirectories(assetPrefixes, relativePath), ...(diskGrandchildren.get(relativePath) ?? []).filter((path) => !this.linkedPathIsIgnored(`${path}/__serpent_probe__`, rules)
      && (input.showIgnored === true || !folderIgnored(path)))])],
  ]));

  return this.withSequenceFolderCovers(openLibrary, children.map((relativePath) => {
    const folderId = encodeLinkedVirtualFolderId(resolved.linkedFolderId, relativePath);
    const directoryAssetCounts = assetCounts.get(relativePath);
    const directAssetCount = directoryAssetCounts?.direct ?? 0;
    const recursiveAssetCount = directoryAssetCounts?.recursive ?? 0;
    const directChildDirs = childDirectories.get(relativePath) ?? [];
    const childFolderCount = directChildDirs.length;
    const pureChildDirs = directAssetCount === 0 && childFolderCount > 0 ? directChildDirs : [];
    return {
      folderId,
      parentFolderId: input.parentFolderId,
      locationKind: 'linked' as const,
      name: linkedDirectoryName(relativePath),
      relativePath,
      status: resolved.status,
      directAssetCount,
      recursiveAssetCount,
      childFolderCount,
      coverArtifactIds: this.linkedDirectoryCoverArtifactIds(
        openLibrary,
        resolved.linkedFolderId,
        relativePath,
        input.showIgnored === true,
        pureChildDirs,
      ),
      // Serpent-d0nv: cover candidates as asset ids (cover scene scheduling
      // + progressive refresh on thumbnail.ready). Candidates do NOT require
      // a ready thumbnail — ungenerated assets get enqueued by the cover
      // scene; display covers stay ready-gated in coverArtifactIds.
      coverAssetIds: this.linkedDirectoryCoverCandidateAssetIds(
        openLibrary,
        resolved.linkedFolderId,
        relativePath,
        input.showIgnored === true,
        pureChildDirs,
      ),
      linkedFolderId: resolved.linkedFolderId,
    };
  }));
}

export function resolveLinkedFolderScope(this: LibraryService, openLibrary: OpenLibrary, folderId: string): {
    linkedFolderId: string;
    relativePath: string;
    status: 'available' | 'offline';
    absoluteRootPath: string;
  } | null {
  const virtual = parseLinkedVirtualFolderId(folderId);
  const linkedFolderId = virtual?.linkedFolderId ?? folderId;
  const row = openLibrary.connection
    .prepare(
      `SELECT folder_id, status, absolute_root_path
         FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    )
    .get(linkedFolderId, openLibrary.summary.libraryId) as
    | {
        folder_id: string;
        status: 'available' | 'offline';
        absolute_root_path: string;
      }
    | undefined;
  if (!row) return null;
  if (virtual && virtual.relativePath === '') return null;
  return {
    linkedFolderId: row.folder_id,
    relativePath: virtual?.relativePath ?? '',
    status: row.status,
    absoluteRootPath: row.absolute_root_path,
  };
}

export function linkedAssetPathKey(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, showIgnored: boolean): string {
  const membershipVersion = this.linkedDirectoryIndex(openLibrary).membershipVersion(linkedFolderId)
    ?? this.getBrowseChangeSequence(openLibrary.summary.libraryId);
  return `${membershipVersion}:${showIgnored}:${this._showMissingLinkedFiles}`;
}

export async function prepareLinkedAssetPaths(this: LibraryService, openLibrary: OpenLibrary, showIgnored: boolean, checkpoint: () => Promise<void>, rootIds?: readonly string[], prepareDirectories = true): Promise<Map<string, string[]>> {
  const prepared = new Map<string, string[]>();
  let roots = this.linkedAssetPaths.get(openLibrary);
  if (!roots) {
    roots = new Map();
    this.linkedAssetPaths.set(openLibrary, roots);
  }
  const rows = rootIds ? [...new Set(rootIds)].map((folder_id) => ({ folder_id }))
    : openLibrary.connection.prepare('SELECT folder_id FROM linked_folders').all() as Array<{ folder_id: string }>;
  for (const row of rows) {
    if (!rootIds && !showIgnored && this.linkedFolderIgnored(openLibrary, row.folder_id)('')) continue;
    if (prepareDirectories) await this.linkedDirectoryIndex(openLibrary).prepare(row.folder_id, checkpoint);
    const key = this.linkedAssetPathKey(openLibrary, row.folder_id, showIgnored);
    const rootKey = `${row.folder_id}:${showIgnored}`;
    const cached = roots.get(rootKey);
    if (cached?.key === key) {
      prepared.set(row.folder_id, cached.paths);
      continue;
    }
    const projection = await collectLinkedAssetPaths(
      (after, limit) => this.readLinkedAssetPaths(openLibrary, row.folder_id, showIgnored, { after, limit }),
      checkpoint,
    );
    prepared.set(row.folder_id, projection.paths);
    this.linkedAssetCounts.set(projection.paths, projection.counts);
    if (this.linkedAssetPathKey(openLibrary, row.folder_id, showIgnored) === key) {
      roots.set(rootKey, { key, paths: projection.paths });
    }
  }
  return prepared;
}

export function listLinkedAssetRelativePaths(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, showIgnored: boolean): string[] {
  const key = this.linkedAssetPathKey(openLibrary, linkedFolderId, showIgnored);
  let roots = this.linkedAssetPaths.get(openLibrary);
  if (!roots) {
    roots = new Map();
    this.linkedAssetPaths.set(openLibrary, roots);
  }
  const rootKey = `${linkedFolderId}:${showIgnored}`;
  const cached = roots.get(rootKey);
  if (cached?.key === key) return cached.paths;
  const paths = this.readLinkedAssetPaths(openLibrary, linkedFolderId, showIgnored);
  roots.set(rootKey, { key, paths });
  return paths;
}

export function readLinkedAssetPaths(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, showIgnored: boolean, page?: { after: string | null; limit: number }): string[] {
  const connection = openLibrary.connection;
  const hasIgnoreTable = this.catalogTableHasRows(connection, 'linked_ignored_assets');
  const hasSequenceFrames = this.catalogTableHasRows(connection, 'asset_sequence_frames');
  const hasExplicitIgnores = this.catalogTableHasRows(connection, 'explicit_ignored_paths')
    || this.catalogTableHasRows(connection, 'gitignore_ignored_paths');
  const rows = connection
    .prepare(
      `SELECT a.relative_file_path
         FROM assets a
        WHERE a.linked_folder_id = ?
          ${page?.after === null || page === undefined ? '' : 'AND a.relative_file_path > ?'}
          AND a.location_kind = 'linked'
          AND a.deleted_at IS NULL
          ${this._showMissingLinkedFiles ? '' : "AND a.availability <> 'missing'"}
          ${hasIgnoreTable
            ? 'AND NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)'
            : ''}
          AND ${hasExplicitIgnores ? this.explicitIgnoreSql(connection, 'a', showIgnored) : '1 = 1'}
          ${hasSequenceFrames
            ? `AND NOT EXISTS (
            SELECT 1
              FROM asset_sequence_frames hidden_sequence_frame
             WHERE hidden_sequence_frame.asset_id = a.asset_id
               AND hidden_sequence_frame.position > 0
          )`
            : ''}
          ${page === undefined ? '' : 'ORDER BY a.relative_file_path LIMIT ?'}`,
    )
    .all(linkedFolderId, ...(page?.after === null || page === undefined ? [] : [page.after]), ...(page === undefined ? [] : [page.limit])) as Array<{ relative_file_path: string }>;
  return rows.map((row) => row.relative_file_path);
}

/**
* Serpent-d0nv: linked-directory cover scheduling candidates — the top-4
* direct linked assets by path, with NO ready-thumbnail requirement (see
* folderCoverCandidateAssetMap).
*/
export function linkedDirectoryCoverCandidateAssetIds(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, relativePath: string, showIgnored: boolean, childDirs: string[] = []): string[] {
  const prefix = relativePath === '' ? '' : `${relativePath}/`;
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.relative_file_path
         FROM assets a
        WHERE a.linked_folder_id = ?
          AND a.location_kind = 'linked'
          AND a.deleted_at IS NULL
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
          AND (
            ? = ''
            OR a.relative_file_path = ?
            OR (? != '' AND substr(a.relative_file_path, 1, ?) = ?)
          )
        ORDER BY a.relative_file_path`,
    )
    .all(
      linkedFolderId,
      relativePath,
      relativePath,
      prefix,
      [...prefix].length,
      prefix,
    ) as Array<{ asset_id: string; relative_file_path: string }>;

  const scopedRows = relativePath === '' && childDirs.length === 0
    ? rows.filter((row) => !row.relative_file_path.includes('/'))
    : rows;

  if (childDirs.length === 0) {
    return scopedRows.slice(0, 3).map((row) => row.asset_id);
  }

  // Serpent-9021d1: Pure linked folder — round-robin across direct child directories
  const childPrefixes = childDirs.map((d) => (d === '' ? '' : `${d}/`));
  const byChild: string[][] = childDirs.map(() => []);
  for (const row of rows) {
    for (let i = 0; i < childDirs.length; i++) {
      const cPrefix = childPrefixes[i]!;
      if (row.relative_file_path === childDirs[i] || row.relative_file_path.startsWith(cPrefix)) {
        byChild[i]!.push(row.asset_id);
        break;
      }
    }
  }

  const picked: string[] = [];
  let round = 0;
  while (picked.length < 4) {
    let addedInRound = false;
    for (let c = 0; c < childDirs.length && picked.length < 4; c++) {
      const list = byChild[c];
      if (list && round < list.length) {
        picked.push(list[round]!);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }
  return picked;
}

/**
* Linked subfolders are virtual rows.  Asset-derived prefixes cover normal
* populated folders, but an empty directory created from Keel must also
* remain visible after refresh/reopen, so include real directories from the
* linked root as well.  Symlinks and ignored directories are never followed.
*/
export function indexedLinkedDirectoryPrefixes(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, rules: LinkedFolderRule[], includeGitignoreHidden = false, parent?: string): string[] {
  const folderIgnored = this.linkedFolderIgnored(openLibrary, linkedFolderId);
  const index = this.linkedDirectoryIndex(openLibrary);
  const paths = parent === undefined ? index.paths(linkedFolderId) : index.children(linkedFolderId, parent);
  return paths.filter((relativePath) =>
    !this.linkedPathIsIgnored(`${relativePath}/__serpent_probe__`, rules)
    && (includeGitignoreHidden || !folderIgnored(relativePath)),
  );
}

export async function listLinkedFoldersAsync(this: LibraryService, libraryId: string): Promise<LinkedFolderSummary[]> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const paths = await this.prepareLinkedAssetPaths(openLibrary, false,
    this.navigationReadCheckpoint(libraryId, openLibrary));
  return this.listLinkedFolders(libraryId, paths);
}

export function listLinkedFolders(this: LibraryService, libraryId: string, preparedPaths?: ReadonlyMap<string, string[]>): LinkedFolderSummary[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection
    .prepare(
      `SELECT folder_id, display_name, status, absolute_root_path, parent_folder_id,
              created_at, appearance_glyph_kind, appearance_glyph_value, appearance_color_id
         FROM linked_folders WHERE library_id = ? ORDER BY display_name`,
    )
    .all(libraryId) as Array<{
      folder_id: string;
      display_name: string;
      status: 'available' | 'offline';
      absolute_root_path: string;
      parent_folder_id: string | null;
      created_at: string;
      appearance_glyph_kind?: string | null;
      appearance_glyph_value?: string | null;
      appearance_color_id?: string | null;
    }>;
  return rows
    .filter((row) => !this.explicitFolderIgnored(openLibrary, 'linked', row.folder_id, ''))
    .flatMap((row) => {
      const paths = preparedPaths?.get(row.folder_id)
        ?? this.listLinkedAssetRelativePaths(openLibrary, row.folder_id, false);
      const assetCounts = this.countLinkedAssets(paths);
      const assetPrefixes = [...assetCounts.keys()].filter((prefix) => prefix !== '');
      const diskPrefixes = this.indexedLinkedDirectoryPrefixes(
          openLibrary,
          row.folder_id,
          this.getLinkedFolderRules({ libraryId, folderId: row.folder_id }),
        );
      const prefixes = [...new Set([...assetPrefixes, ...diskPrefixes])].sort();
      const folderIgnored = this.linkedFolderIgnored(openLibrary, row.folder_id);
      const root: LinkedFolderSummary = {
        folderId: row.folder_id,
        displayName: row.display_name,
        status: row.status,
        assetCount: paths.length,
        absoluteRootPath: row.absolute_root_path,
        linkedFolderId: row.folder_id,
        relativePath: '',
        // Serpent-316493: a linked root may hang under a managed folder.
        parentFolderId: row.parent_folder_id ?? null,
        createdAt: row.created_at,
        appearance: sanitizeEntityAppearance({
          glyphKind: row.appearance_glyph_kind,
          glyphValue: row.appearance_glyph_value,
          colorId: row.appearance_color_id,
        }),
      };
      const children = prefixes
        .filter((prefix) => !folderIgnored(prefix))
        .map((relativePath) => {
          const parentPath = parentLinkedRelativePath(relativePath);
          return {
            folderId: encodeLinkedVirtualFolderId(row.folder_id, relativePath),
            displayName: linkedDirectoryName(relativePath),
            status: row.status,
            assetCount: assetCounts.get(relativePath)?.recursive ?? 0,
            absoluteRootPath: row.absolute_root_path,
            linkedFolderId: row.folder_id,
            relativePath,
            parentFolderId:
              parentPath === null || parentPath === ''
                ? row.folder_id
                : encodeLinkedVirtualFolderId(row.folder_id, parentPath),
          };
        });
      return [root, ...children];
    });
}

export function getLinkedFolderRules(this: LibraryService, input: { libraryId: string; folderId: string }): LinkedFolderRule[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const folder = openLibrary.connection
    .prepare('SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?')
    .get(input.folderId, input.libraryId);
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  return (openLibrary.connection.prepare(
    `SELECT rule_id, action, target, pattern, enabled
       FROM linked_folder_rules WHERE folder_id = ? ORDER BY position`,
  ).all(input.folderId) as Array<{
    rule_id: string; action: 'include' | 'exclude'; target: LinkedFolderRule['target']; pattern: string; enabled: number;
  }>).map((row) => ({
    ruleId: row.rule_id,
    action: row.action,
    target: row.target,
    pattern: row.pattern,
    enabled: row.enabled === 1,
  }));
}

export function setLinkedFolderRules(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    rules: LinkedFolderRule[];
  }): { rules: LinkedFolderRule[]; hiddenCount: number; restoredCount: number } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const folder = openLibrary.connection.prepare(
    'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
  ).get(input.folderId, input.libraryId);
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (input.rules.length > 200 || new Set(input.rules.map((rule) => rule.ruleId)).size !== input.rules.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const rules = input.rules.map((rule) => this.normalizeLinkedFolderRule(rule));
  let hiddenCount = 0;
  let restoredCount = 0;
  const now = new Date().toISOString();
  openLibrary.connection.transaction(() => {
    openLibrary.connection.prepare('DELETE FROM linked_folder_rules WHERE folder_id = ?').run(input.folderId);
    const insertRule = openLibrary.connection.prepare(
      `INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    rules.forEach((rule, position) => insertRule.run(
      rule.ruleId, input.folderId, position, rule.action, rule.target, rule.pattern, rule.enabled ? 1 : 0,
    ));
    const assets = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.relative_file_path,
              EXISTS(SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AS ignored
         FROM assets a WHERE a.linked_folder_id = ?`,
    ).all(input.folderId) as Array<{ asset_id: string; relative_file_path: string; ignored: number }>;
    for (const asset of assets) {
      const ignored = this.linkedPathIsIgnored(asset.relative_file_path, rules)
        || this.isExplicitlyIgnored(
          openLibrary,
          'linked',
          input.folderId,
          asset.relative_file_path,
          'asset',
        );
      if (ignored && asset.ignored === 0) {
        openLibrary.connection.prepare(
          'INSERT OR REPLACE INTO linked_ignored_assets(asset_id, ignored_at) VALUES (?, ?)',
        ).run(asset.asset_id, now);
        hiddenCount += 1;
      } else if (!ignored && asset.ignored === 1) {
        openLibrary.connection.prepare('DELETE FROM linked_ignored_assets WHERE asset_id = ?').run(asset.asset_id);
        restoredCount += 1;
      }
    }
  })();
  this.refreshManagedAssets(input.libraryId);
  return { rules: this.getLinkedFolderRules(input), hiddenCount, restoredCount };
}

export function copyAssetsToLinkedFolder(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    relativePath?: string;
    assetIds: string[];
    conflictStrategy: 'keep-both' | 'replace' | 'skip';
  }): {
    copiedCount: number;
    skippedCount: number;
    assets: AssetSummary[];
    /** 本次实际复制成功的源资产 id（skip 冲突时不包含被跳过的），供 moveAssets 移动后清理源。 */
    copiedSourceAssetIds: string[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  const folder = openLibrary.connection.prepare(
    `SELECT absolute_root_path, status FROM linked_folders
      WHERE folder_id = ? AND library_id = ?`,
  ).get(input.folderId, input.libraryId) as { absolute_root_path: string; status: string } | undefined;
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (folder.status !== 'available' || !realDirectoryExists(folder.absolute_root_path)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
  }
  const target = this.resolveLinkedDirectoryMutationTarget(
    openLibrary,
    input.folderId,
    input.relativePath ?? '',
  );
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_file_path: string;
  }>({
    connection: openLibrary.connection,
    values: input.assetIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.relative_file_path
         FROM assets a
        WHERE a.asset_id IN (${placeholders})
          AND a.deleted_at IS NULL AND a.availability = 'available'`,
  });
  if (rows.length !== input.assetIds.length) throw new LibraryServiceError('ASSET_NOT_FOUND');
  const copiedPaths: string[] = [];
  const copiedSourceAssetIds: string[] = [];
  const backups: Array<{ destination: string; backup: string }> = [];
  const operationId = randomUUID();
  const operationPath = path.join(this.assertSafeOperationsRoot(openLibrary.summary.libraryPath), operationId);
  const backupPath = path.join(operationPath, 'backup');
  let skippedCount = 0;
  try {
    mkdirSync(backupPath, { recursive: true });
    const occupied = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const sourcePath = row.location_kind === 'managed'
        ? this.folderPath(openLibrary, row.relative_file_path)
        : this.linkedAssetPath(
          openLibrary,
          row.linked_folder_id,
          row.relative_file_path,
        );
      const sourceEntry = lstatSync(sourcePath);
      if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'UNSUPPORTED_FILE_ENTRY' });
      }
      const originalName = path.posix.basename(row.relative_file_path);
      let relativeDestination = target.relativePath === ''
        ? normalizeRelativeAssetPath(originalName)
        : normalizeRelativeAssetPath(path.posix.join(target.relativePath, originalName));
      let destination = path.join(folder.absolute_root_path, ...relativeDestination.split('/'));
      const destinationExists = (): boolean => occupied.has(portablePathIdentity(relativeDestination)) || existsSync(destination);
      if (destinationExists()) {
        if (input.conflictStrategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        if (input.conflictStrategy === 'keep-both') {
          let found = false;
          for (let suffix = 2; suffix < 10_000 && !found; suffix += 1) {
            for (const candidate of copyNameCandidates(originalName, suffix)) {
              relativeDestination = target.relativePath === ''
                ? normalizeRelativeAssetPath(candidate)
                : normalizeRelativeAssetPath(path.posix.join(target.relativePath, candidate));
              destination = path.join(folder.absolute_root_path, ...relativeDestination.split('/'));
              if (!destinationExists()) { found = true; break; }
            }
          }
          if (!found) throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'NAME_NOT_SUPPORTED' });
        } else {
          const destinationEntry = lstatSync(destination);
          if (!destinationEntry.isFile() || destinationEntry.isSymbolicLink()) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'UNSUPPORTED_FILE_ENTRY' });
          }
          const backup = path.join(backupPath, String(index));
          renameSync(destination, backup);
          backups.push({ destination, backup });
        }
      }
      copyFileSync(sourcePath, destination, constants.COPYFILE_EXCL);
      copiedPaths.push(relativeDestination);
      copiedSourceAssetIds.push(row.asset_id);
      occupied.add(portablePathIdentity(relativeDestination));
    }
    rmSync(operationPath, { recursive: true, force: true });
  } catch (error) {
    for (const relativePath of copiedPaths.reverse()) {
      rmSync(path.join(folder.absolute_root_path, ...relativePath.split('/')), { force: true });
    }
    for (const backup of backups.reverse()) {
      if (existsSync(backup.backup)) renameSync(backup.backup, backup.destination);
    }
    rmSync(operationPath, { recursive: true, force: true });
    this.diagnose('linked-folder.copy-assets', error, {
      libraryId: input.libraryId, linkedFolderId: input.folderId, requestedCount: input.assetIds.length,
    });
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }
  // 只注册本次复制的文件，避免 refreshManagedAssets 全量枚举导致的复制缓慢。
  this.registerWrittenLinkedAssets(
    openLibrary,
    input.folderId,
    folder.absolute_root_path,
    copiedPaths,
  );
  const copiedIdentities = new Set(copiedPaths.map(portablePathIdentity));
  const assets = this.listAssets({ libraryId: input.libraryId, folderId: input.folderId, recursive: true })
    .filter((asset) => copiedIdentities.has(portablePathIdentity(asset.relativeFilePath)));
  return {
    copiedCount: copiedPaths.length,
    skippedCount,
    assets,
    copiedSourceAssetIds,
  };
}

/**
* Copy assets that live in an external linked folder into the managed
* library. Linked sources are intentionally copied (never removed from the
* user's external directory); this is the symmetric counterpart to
* copyAssetsToLinkedFolder and lets linked assets participate in ordinary
* folder drag-and-drop.
*/
export function copyLinkedAssetsToManagedFolder(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId: string | null;
  }): { copiedCount: number; skippedCount: number; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    linked_folder_id: string | null;
    relative_file_path: string;
    availability: 'available' | 'missing';
  }>({
    connection: openLibrary.connection,
    values: input.assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, linked_folder_id, relative_file_path, availability
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND location_kind = 'linked' AND deleted_at IS NULL`,
  });
  if (rows.length !== input.assetIds.length) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  const sourcePaths = rows.map((row) => {
    if (row.availability !== 'available') {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    const sourcePath = this.linkedAssetPath(
      openLibrary,
      row.linked_folder_id,
      row.relative_file_path,
    );
    if (!realFileExists(sourcePath)) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    return sourcePath;
  });
  // A linked asset is already indexed in this library. This operation is an
  // explicit copy, so the source's content hash must not be treated as a
  // library duplicate and silently skipped.
  const prepared = this.prepareImport({
    libraryId: input.libraryId,
    targetFolderId: input.targetFolderId ?? undefined,
    sourceKind: 'files',
    sourcePaths,
    skipLibraryDuplicateScan: true,
  });
  const completion = this.finishImportWithoutUserDecision(prepared, {
    suspectedDuplicate: 'skip',
    nameConflict: 'keep-both',
  });
  return {
    copiedCount: completion.importedCount + completion.replacedCount,
    skippedCount: completion.skippedCount,
    assets: completion.assets,
  };
}

export function convertLinkedFolderToManaged(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    targetFolderId?: string;
  }): { managedFolderId: string; convertedCount: number; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const linked = openLibrary.connection.prepare(
    `SELECT display_name, absolute_root_path, status FROM linked_folders
      WHERE folder_id = ? AND library_id = ?`,
  ).get(input.folderId, input.libraryId) as {
    display_name: string; absolute_root_path: string; status: 'available' | 'offline';
  } | undefined;
  if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (linked.status !== 'available' || !realDirectoryExists(linked.absolute_root_path)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
  }
  const parent = input.targetFolderId
    ? openLibrary.connection.prepare(
        'SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?',
      ).get(input.targetFolderId) as { folder_id: string; relative_path: string } | undefined
    : undefined;
  if (input.targetFolderId && !parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  let folderName = normalizeFolderName(linked.display_name);
  let targetPrefix = parent ? path.posix.join(parent.relative_path, folderName) : folderName;
  for (let suffix = 2; this.portableDiskDestination(openLibrary, targetPrefix) || openLibrary.connection.prepare(
    'SELECT 1 FROM managed_folders WHERE path_identity = ?',
  ).get(portablePathIdentity(targetPrefix)); suffix += 1) {
    folderName = normalizeFolderName(copyNameCandidates(linked.display_name, suffix)[0]!);
    targetPrefix = parent ? path.posix.join(parent.relative_path, folderName) : folderName;
    if (suffix > 9_999) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
  }

  const rules = this.getLinkedFolderRules({ libraryId: input.libraryId, folderId: input.folderId });
    const entries = this.enumerateLinkedSources(
      linked.absolute_root_path,
      input.folderId,
      rules,
      (relativePath, pathKind) => this.isExplicitlyIgnored(
        openLibrary,
        'linked',
        input.folderId,
        relativePath,
        pathKind,
      ),
    );
  const linkedAssets = openLibrary.connection.prepare(
    `SELECT a.asset_id, a.relative_file_path,
            EXISTS(SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AS ignored
       FROM assets a WHERE a.linked_folder_id = ?`,
  ).all(input.folderId) as Array<{ asset_id: string; relative_file_path: string; ignored: number }>;
  const operationId = randomUUID();
  const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
  const operationPath = path.join(operationsRoot, operationId);
  const stagePath = path.join(operationPath, 'stage');
  const directorySet = new Set<string>([targetPrefix]);
  for (const entry of entries) {
    let cursor = path.posix.dirname(path.posix.join(targetPrefix, entry.relativePath));
    while (cursor !== '.' && cursor !== path.posix.dirname(cursor)) {
      directorySet.add(cursor);
      if (cursor === targetPrefix) break;
      cursor = path.posix.dirname(cursor);
    }
  }
  const directories = [...directorySet].sort((a, b) => a.split('/').length - b.split('/').length);
  const manifest: OperationManifest = {
    version: 1,
    phase: 'prepared',
    directories: directories.map((relativePath) => ({ relativePath, existed: false })),
    files: entries.map((entry, index) => ({
      stageName: String(index), backupName: String(index), hadDestination: false,
      destinationRelativePath: path.posix.join(targetPrefix, entry.relativePath),
    })),
  };
  const now = new Date().toISOString();
  try {
    openLibrary.connection.prepare(
      `INSERT INTO file_operations(operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'import', 'preparing', ?, NULL, ?, ?)`,
    ).run(operationId, JSON.stringify(manifest), now, now);
    mkdirSync(stagePath, { recursive: true });
    entries.forEach((entry, index) => {
      const sourcePath = this.linkedAssetPath(openLibrary, input.folderId, entry.relativePath);
      copyFileSync(sourcePath, path.join(stagePath, String(index)), constants.COPYFILE_EXCL);
    });
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), operationId);
    for (const directory of directories) mkdirSync(this.folderPath(openLibrary, directory));
    entries.forEach((entry, index) => {
      renameSync(
        path.join(stagePath, String(index)),
        this.folderPath(openLibrary, path.posix.join(targetPrefix, entry.relativePath)),
      );
    });
    this.failAt('crash-linked-convert-after-filesystem');
    const managedFolderId = randomUUID();
    const convertedAt = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      openLibrary.connection.prepare(
        `INSERT INTO managed_folders(folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        managedFolderId, parent?.folder_id ?? null, folderName, targetPrefix,
        portablePathIdentity(targetPrefix), convertedAt,
      );
      const updateAsset = openLibrary.connection.prepare(
        `UPDATE assets SET location_kind = 'managed', managed_folder_id = ?, linked_folder_id = NULL,
                relative_file_path = ?, path_identity = ?, availability = ?, updated_at = ?
          WHERE asset_id = ?`,
      );
      for (const asset of linkedAssets) {
        const managedPath = path.posix.join(targetPrefix, asset.relative_file_path);
        const copied = !asset.ignored && entries.some((entry) =>
          portablePathIdentity(entry.relativePath) === portablePathIdentity(asset.relative_file_path));
        updateAsset.run(
          managedFolderId, managedPath, portablePathIdentity(managedPath), copied ? 'available' : 'missing',
          convertedAt, asset.asset_id,
        );
        openLibrary.connection.prepare('DELETE FROM linked_ignored_assets WHERE asset_id = ?').run(asset.asset_id);
        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
      }
      openLibrary.connection.prepare("DELETE FROM explicit_ignored_paths WHERE linked_folder_id = ?").run(input.folderId);
      openLibrary.connection.prepare('DELETE FROM linked_folders WHERE folder_id = ?').run(input.folderId);
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
      ).run(convertedAt, operationId);
    })();
    this.stopLinkedWatcher(input.libraryId, input.folderId);
    try {
      this.removeOperation(operationPath);
    } catch (cleanupError) {
      // The database and destination bytes committed atomically. A committed
      // operation directory is safe to retain; normal reopen recovery removes it.
      this.diagnose('linked-folder.convert.committed-cleanup', cleanupError, {
        libraryId: input.libraryId, folderId: input.folderId, operationId,
      });
    }
    const assetIds = new Set(linkedAssets.map((asset) => asset.asset_id));
    const assets = this.listAssets({ libraryId: input.libraryId, folderId: managedFolderId, recursive: true })
      .filter((asset) => assetIds.has(asset.assetId));
    if (linkedAssets.length > 0) this.emitClientAssetsChanged(input.libraryId, linkedAssets.length, true);
    return { managedFolderId, convertedCount: entries.length, assets };
  } catch (error) {
    if (error instanceof SimulatedCrashError) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
    }
    try {
      for (const entry of [...entries].reverse()) {
        rmSync(this.folderPath(openLibrary, path.posix.join(targetPrefix, entry.relativePath)), { force: true });
      }
      for (const directory of [...directories].reverse()) {
        try { rmdirSync(this.folderPath(openLibrary, directory)); } catch { /* external writer or non-empty */ }
      }
      this.removeOperation(operationPath);
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'IMPORT_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), operationId);
    } catch (rollbackError) {
      this.diagnose('linked-folder.convert.rollback', rollbackError, { libraryId: input.libraryId, folderId: input.folderId });
    }
    this.diagnose('linked-folder.convert', error, { libraryId: input.libraryId, folderId: input.folderId });
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }
}

/**
* Serpent-4bc4ac: drop asset ids the user explicitly ignored so scheduling
* and visible-window reporting never touch them (v6m3: ignored = not
* indexed, not operated on).
*/
export function filterIgnoredAssetIds(this: LibraryService, libraryId: string, assetIds: readonly string[]): string[] {
  if (assetIds.length === 0) return [];
  const openLibrary = this.requireOpenLibrary(libraryId);
  // Visible-window reports and bounded queue fills call this with many ids.
  // The old per-id asset lookup followed by a per-id ignore-rule lookup made
  // one report perform dozens of SQLite turns, even though the result is a
  // simple membership filter. Keep the original caller order (and duplicate
  // ids) while doing the rule evaluation in one bounded query per chunk.
  const uniqueAssetIds = [...new Set(assetIds)];
  const keptAssetIds = new Set<string>();
  const chunkSize = 500;
  const ignoreSql = this.explicitIgnoreSql(openLibrary.connection, 'a');
  for (let offset = 0; offset < uniqueAssetIds.length; offset += chunkSize) {
    const chunk = uniqueAssetIds.slice(offset, offset + chunkSize);
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id
           FROM assets a
          WHERE a.asset_id IN (${sqliteInPlaceholders(chunk)})
            AND ${ignoreSql}`,
      )
      .all(...chunk) as Array<{ asset_id: string }>;
    for (const row of rows) keptAssetIds.add(row.asset_id);
  }
  return assetIds.filter((assetId) => keptAssetIds.has(assetId));
}

export function normalizeLinkedFolderRule(this: LibraryService, rule: LinkedFolderRule): LinkedFolderRule {
  const pattern = rule.pattern.trim().normalize('NFC');
  if (pattern.length === 0 || pattern.length > 512 || pattern.includes('\0')) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME');
  }
  if (rule.target === 'path') {
    if (pattern === '**') return { ...rule, pattern };
    try {
      return { ...rule, pattern: normalizeRelativeAssetPath(pattern) };
    } catch (error) {
      throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
    }
  }
  if (pattern.includes('/') || pattern.includes('\\') || pattern === '.' || pattern === '..') {
    throw new LibraryServiceError('INVALID_FOLDER_NAME');
  }
  const normalizedPattern = rule.target === 'extension'
    ? pattern.replace(/^\.+/u, '').toLowerCase()
    : pattern;
  if (normalizedPattern.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');
  return { ...rule, pattern: normalizedPattern };
}

export function normalizeExplicitIgnorePath(this: LibraryService, relativePath: string, allowRoot = false): string {
  const trimmed = relativePath.trim().normalize('NFC').replaceAll('\\', '/');
  if (allowRoot && trimmed === '') return '';
  try {
    return normalizeRelativeAssetPath(trimmed);
  } catch (error) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
  }
}

export function explicitIgnoreSql(this: LibraryService, connection: DatabaseConnection, alias = 'a', showIgnored = false): string {
  if (showIgnored) {
    return buildCatalogExplicitIgnoreSql({
      alias,
      showIgnored,
      hasExplicitIgnorePaths: false,
      hasGitignoreIgnoredPaths: false,
    });
  }
  // Serpent-verg.2 — lenient read (0031 §1): libraries predating the
  // ignore-rule tables have no ignored paths to exclude; skip the
  // subqueries instead of failing on the missing tables.
  return buildCatalogExplicitIgnoreSql({
    alias,
    showIgnored,
    hasExplicitIgnorePaths: hasTable(connection, 'explicit_ignored_paths'),
    hasGitignoreIgnoredPaths: hasTable(connection, 'gitignore_ignored_paths'),
  });
}

export function explicitFolderIgnored(this: LibraryService, openLibrary: OpenLibrary, locationKind: 'managed' | 'linked', linkedFolderId: string | null, relativePath: string): boolean {
  if (gitignoreMatchesPath(openLibrary.gitignoreMatcher, relativePath, 'folder', locationKind)) {
    return true;
  }
  // Serpent-verg review fix: libraries predating the ignore-rule table
  // have no explicit ignores.
  if (!hasTable(openLibrary.connection, 'explicit_ignored_paths')) return false;
  const normalized = this.normalizeExplicitIgnorePath(relativePath, locationKind === 'linked');
  const row = openLibrary.connection.prepare(
    `SELECT 1 FROM explicit_ignored_paths
      WHERE location_kind = ?
        AND linked_folder_id = ?
        AND path_kind = 'folder'
        AND (
          relative_path = ''
          OR ? = relative_path
          OR ? LIKE relative_path || '/%'
        )
     UNION ALL
     SELECT 1 FROM gitignore_ignored_paths
      WHERE ? = 'managed'
        AND path_kind = 'folder'
        AND (
          relative_path = ?
          OR ? LIKE relative_path || '/%'
        )
      LIMIT 1`,
  ).get(locationKind, linkedFolderId ?? '', normalized, normalized, locationKind, normalized, normalized);
  return row !== undefined;
}

export function isExplicitlyIgnored(this: LibraryService, openLibrary: OpenLibrary, locationKind: 'managed' | 'linked', linkedFolderId: string | null, relativePath: string, pathKind: 'asset' | 'folder'): boolean {
  if (pathKind === 'folder') {
    return this.explicitFolderIgnored(openLibrary, locationKind, linkedFolderId, relativePath);
  }
  if (gitignoreMatchesPath(openLibrary.gitignoreMatcher, relativePath, 'asset', locationKind)) {
    return true;
  }
  const normalized = this.normalizeExplicitIgnorePath(
    relativePath,
    false,
  );
  // Serpent-4bdd26: this runs once per enumerated file on every refresh;
  // a per-call .prepare() recompiled the 4-way UNION each time (measured
  // ~410ms of pure compile time per 20k files vs 54ms cached).
  const row = this.prepareCached<{ get(...parameters: unknown[]): unknown }>(
    openLibrary,
    `SELECT 1 FROM explicit_ignored_paths
      WHERE location_kind = ?
        AND linked_folder_id = ?
        AND path_kind = 'folder'
        AND (
          relative_path = ''
          OR ? = relative_path
          OR ? LIKE relative_path || '/%'
        )
      UNION ALL
     SELECT 1 FROM explicit_ignored_paths
      WHERE location_kind = ?
        AND linked_folder_id = ?
        AND path_kind = 'asset'
        AND relative_path = ?
      UNION ALL
     SELECT 1 FROM explicit_ignored_paths
      WHERE location_kind = ?
        AND linked_folder_id = ?
        AND path_kind = 'extension'
        AND LOWER(?) LIKE '%.' || LOWER(relative_path)
     UNION ALL
     SELECT 1 FROM gitignore_ignored_paths
      WHERE ? = 'managed'
        AND path_kind = 'asset'
        AND relative_path = ?
      LIMIT 1`,
  ).get(
    locationKind,
    linkedFolderId ?? '',
    normalized,
    normalized,
    locationKind,
    linkedFolderId ?? '',
    normalized,
    locationKind,
    linkedFolderId ?? '',
    normalized,
    locationKind,
    normalized,
  );
  if (!row) return false;
  return true;
}

export function assertAssetsNotExplicitlyIgnored(this: LibraryService, openLibrary: OpenLibrary, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_file_path: string;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND deleted_at IS NULL`,
  });
  for (const row of rows) {
    if (this.isExplicitlyIgnored(openLibrary, row.location_kind, row.linked_folder_id, row.relative_file_path, 'asset')) {
      throw new LibraryServiceError('ASSET_NOT_FOUND');
    }
  }
}

export function getGitignore(this: LibraryService, libraryId: string): { content: string } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return { content: openLibrary.gitignoreText };
}

export function setGitignore(this: LibraryService, input: { libraryId: string; content: string }): { content: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (openLibrary.readOnly || input.content.length > 1_000_000 || input.content.includes('\0')) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  }
  try {
    writeFileSync(gitignorePath(openLibrary.summary.libraryPath), input.content, 'utf8');
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  this.noteClientFilesystemMutation();
  this.syncGitignore(openLibrary, input.content);
  return { content: input.content };
}

export function updateGitignoreRule(this: LibraryService, openLibrary: OpenLibrary, positive: string, ignored: boolean): void {
  if (positive.length === 0) return;
  const negative = `!${positive}`;
  const lines = openLibrary.gitignoreText.split(/\r?\n/u);
  const filtered = lines.filter((line) => {
    // Keep comments and blank separators intact.  Only remove the exact
    // generated positive/negative rule (plus harmless trailing spaces), so
    // repeated context-menu actions never accumulate duplicates or erase
    // the user's formatting.
    const comparable = line.trimEnd();
    return comparable !== positive && comparable !== negative;
  });
  while (filtered.at(-1) === '') filtered.pop();
  filtered.push(ignored ? positive : negative);
  const next = `${filtered.join('\n')}\n`;
  if (next === openLibrary.gitignoreText) return;
  try {
    writeFileSync(gitignorePath(openLibrary.summary.libraryPath), next, 'utf8');
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  this.noteClientFilesystemMutation();
  this.syncGitignore(openLibrary, next);
}

export function ignoreGitignoreRule(this: LibraryService, locationKind: 'managed' | 'linked', relativePath: string, pathKind: 'asset' | 'folder' | 'extension', layout: LibraryStorageLayout = 'assets'): string | undefined {
  const normalized = pathKind === 'extension'
    ? relativePath.trim().replace(/^\.+/u, '').toLowerCase()
    : this.normalizeExplicitIgnorePath(relativePath, false);
  if (!normalized) return undefined;
  if (pathKind === 'extension') return `*.${normalized}`;
  const suffix = pathKind === 'folder' ? '/' : '';
  return locationKind === 'managed' && layout === 'assets'
    ? `Assets/${normalized}${suffix}`
    : `${normalized}${suffix}`;
}

export function managedGitignoreRule(this: LibraryService, relativePath: string, pathKind: 'asset' | 'folder' | 'extension', layout: LibraryStorageLayout = 'assets'): string | undefined {
  return this.ignoreGitignoreRule('managed', relativePath, pathKind, layout);
}

export function listIgnoredPaths(this: LibraryService, libraryId: string): IgnoredPath[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection.prepare(
    `SELECT e.location_kind, NULLIF(e.linked_folder_id, '') AS linked_folder_id,
            e.relative_path, e.path_kind, e.ignored_at,
            CASE
              WHEN e.relative_path = '' THEN COALESCE(l.display_name, 'Assets')
              ELSE e.relative_path
            END AS display_name
       FROM explicit_ignored_paths e
       LEFT JOIN linked_folders l ON l.folder_id = e.linked_folder_id
      ORDER BY e.location_kind, e.relative_path, e.path_kind`,
  ).all() as Array<{
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_path: string;
    path_kind: 'asset' | 'folder' | 'extension';
    ignored_at: string;
    display_name: string;
  }>;
  // Managed rules are stored in .keelignore. The materialized table is
  // used by browse/search hot paths, but can lag behind a newly discovered
  // file; evaluate the current matcher here so Settings always shows the
  // actual files and folders currently affected by the rules.
  const ignoredAt = new Date().toISOString();
  if (hasTable(openLibrary.connection, 'managed_folders')) {
    const managedFolders = openLibrary.connection.prepare(
      `SELECT relative_path FROM managed_folders ORDER BY relative_path`,
    ).all() as Array<{ relative_path: string }>;
    for (const folder of managedFolders) {
      if (!gitignoreMatchesPath(openLibrary.gitignoreMatcher, folder.relative_path, 'folder')) {
        continue;
      }
      rows.push({
        location_kind: 'managed',
        linked_folder_id: null,
        relative_path: folder.relative_path,
        path_kind: 'folder',
        ignored_at: ignoredAt,
        display_name: folder.relative_path,
      });
    }
  }
  if (hasTable(openLibrary.connection, 'assets')) {
    const managedAssets = openLibrary.connection.prepare(
      `SELECT relative_file_path AS relative_path
         FROM assets
        WHERE location_kind = 'managed' AND deleted_at IS NULL
        ORDER BY relative_file_path`,
    ).all() as Array<{ relative_path: string }>;
    for (const asset of managedAssets) {
      if (!gitignoreMatchesPath(openLibrary.gitignoreMatcher, asset.relative_path, 'asset')) {
        continue;
      }
      rows.push({
        location_kind: 'managed',
        linked_folder_id: null,
        relative_path: asset.relative_path,
        path_kind: 'asset',
        ignored_at: ignoredAt,
        display_name: asset.relative_path,
      });
    }
    const linkedAssets = openLibrary.connection.prepare(
      `SELECT linked_folder_id, relative_file_path AS relative_path
         FROM assets
        WHERE location_kind = 'linked' AND deleted_at IS NULL AND linked_folder_id IS NOT NULL
        ORDER BY linked_folder_id, relative_file_path`,
    ).all() as Array<{ linked_folder_id: string; relative_path: string }>;
    const linkedPathsByFolder = new Map<string, string[]>();
    for (const asset of linkedAssets) {
      const paths = linkedPathsByFolder.get(asset.linked_folder_id);
      if (paths) paths.push(asset.relative_path);
      else linkedPathsByFolder.set(asset.linked_folder_id, [asset.relative_path]);
      if (gitignoreMatchesPath(openLibrary.gitignoreMatcher, asset.relative_path, 'asset', 'linked')) {
        rows.push({
          location_kind: 'linked',
          linked_folder_id: asset.linked_folder_id,
          relative_path: asset.relative_path,
          path_kind: 'asset',
          ignored_at: ignoredAt,
          display_name: asset.relative_path,
        });
      }
    }
    for (const [linkedFolderId, paths] of linkedPathsByFolder) {
      for (const prefix of collectLinkedDirectoryPrefixes(paths)) {
        if (!gitignoreMatchesPath(openLibrary.gitignoreMatcher, prefix, 'folder', 'linked')) {
          continue;
        }
        rows.push({
          location_kind: 'linked',
          linked_folder_id: linkedFolderId,
          relative_path: prefix,
          path_kind: 'folder',
          ignored_at: ignoredAt,
          display_name: prefix,
        });
      }
    }
  }
  return rows
    .sort((a, b) =>
      a.location_kind.localeCompare(b.location_kind) ||
      a.relative_path.localeCompare(b.relative_path) ||
      a.path_kind.localeCompare(b.path_kind),
    )
    .map((row) => ({
      locationKind: row.location_kind,
      linkedFolderId: row.linked_folder_id,
      relativePath: row.relative_path,
      pathKind: row.path_kind,
      displayName: row.display_name,
      ignoredAt: row.ignored_at,
    }));
}

export function setIgnore(this: LibraryService, input: {
    libraryId: string;
    locationKind: 'managed' | 'linked';
    linkedFolderId?: string | null;
    relativePath: string;
    pathKind: 'asset' | 'folder' | 'extension';
    ignored: boolean;
  }): { ignored: boolean; path: IgnoredPath } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const linkedFolderId = input.locationKind === 'linked' ? input.linkedFolderId ?? null : null;
  const relativePath = input.pathKind === 'extension'
    ? input.relativePath.trim().replace(/^\.+/u, '').toLowerCase()
    : this.normalizeExplicitIgnorePath(
      input.relativePath,
      input.locationKind === 'linked' && input.pathKind === 'folder',
    );
  if (input.pathKind === 'extension' && (relativePath.length === 0 || relativePath.includes('/') || relativePath.includes('\\'))) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME');
  }
  if (input.locationKind === 'linked' && !linkedFolderId) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  if (input.pathKind === 'asset') {
    const row = openLibrary.connection.prepare(
      `SELECT asset_id FROM assets
        WHERE location_kind = ?
          AND linked_folder_id IS ?
          AND relative_file_path = ?
          AND deleted_at IS NULL`,
    ).get(input.locationKind, linkedFolderId, relativePath);
    if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  } else if (input.pathKind === 'extension') {
    if (input.locationKind === 'linked' && !linkedFolderId) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
  } else if (input.locationKind === 'managed') {
    const row = openLibrary.connection.prepare(
      'SELECT folder_id FROM managed_folders WHERE relative_path = ?',
    ).get(relativePath);
    if (!row) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  } else {
    const row = openLibrary.connection.prepare(
      'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
    ).get(linkedFolderId, input.libraryId);
    if (!row) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  if (input.locationKind === 'managed' || !(input.pathKind === 'folder' && relativePath === '')) {
    // File-backed ignore: one .keelignore for managed and linked trees.
    // An empty linked-root path still uses explicit_ignored_paths because
    // there is no relative path to write into the ignore file.
    const rule = this.ignoreGitignoreRule(input.locationKind, relativePath, input.pathKind, openLibrary.summary.storageLayout);
    if (rule !== undefined) this.updateGitignoreRule(openLibrary, rule, input.ignored);
    if (input.locationKind === 'linked' && !input.ignored) {
      openLibrary.connection.prepare(
        `DELETE FROM explicit_ignored_paths
          WHERE location_kind = ? AND linked_folder_id = ? AND relative_path = ? AND path_kind = ?`,
      ).run(input.locationKind, linkedFolderId ?? '', relativePath, input.pathKind);
    }
    return {
      ignored: input.ignored,
      path: {
        locationKind: input.locationKind,
        linkedFolderId: input.locationKind === 'linked' ? linkedFolderId : null,
        relativePath,
        pathKind: input.pathKind,
        displayName: relativePath || 'Assets',
        ignoredAt: new Date().toISOString(),
      },
    };
  }
  const sourceFolderId = linkedFolderId ?? '';
  const write = openLibrary.connection.prepare(
    `INSERT OR REPLACE INTO explicit_ignored_paths
      (location_kind, linked_folder_id, relative_path, path_kind, ignored_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const remove = openLibrary.connection.prepare(
    `DELETE FROM explicit_ignored_paths
      WHERE location_kind = ? AND linked_folder_id = ? AND relative_path = ? AND path_kind = ?`,
  );
  if (input.ignored) {
    write.run(input.locationKind, sourceFolderId, relativePath, input.pathKind, new Date().toISOString());
  } else {
    remove.run(input.locationKind, sourceFolderId, relativePath, input.pathKind);
  }
  const pathRow = openLibrary.connection.prepare(
    `SELECT e.location_kind, NULLIF(e.linked_folder_id, '') AS linked_folder_id,
            e.relative_path, e.path_kind, e.ignored_at,
            CASE WHEN e.relative_path = '' THEN COALESCE(l.display_name, 'Assets')
                 ELSE e.relative_path END AS display_name
       FROM explicit_ignored_paths e
       LEFT JOIN linked_folders l ON l.folder_id = e.linked_folder_id
      WHERE e.location_kind = ? AND e.linked_folder_id = ?
        AND e.relative_path = ? AND e.path_kind = ?`,
  ).get(input.locationKind, sourceFolderId, relativePath, input.pathKind) as {
    location_kind: 'managed' | 'linked'; linked_folder_id: string | null;
    relative_path: string; path_kind: 'asset' | 'folder' | 'extension'; ignored_at: string; display_name: string;
  } | undefined;
  return {
    ignored: input.ignored,
    path: pathRow ? {
      locationKind: pathRow.location_kind,
      linkedFolderId: pathRow.linked_folder_id,
      relativePath: pathRow.relative_path,
      pathKind: pathRow.path_kind,
      displayName: pathRow.display_name,
      ignoredAt: pathRow.ignored_at,
    } : {
      locationKind: input.locationKind,
      linkedFolderId,
      relativePath,
      pathKind: input.pathKind,
      displayName: relativePath || 'Assets',
      ignoredAt: new Date().toISOString(),
    },
  };
}

export function linkedPathIsIgnored(this: LibraryService, relativePath: string, rules: LinkedFolderRule[]): boolean {
  // Older scans could index files inside a stray metadata directory of a
  // copied library. Such paths are reserved, so they count as ignored.
  if (relativePath.replaceAll('\\', '/').split('/').some((segment) => isLibraryMetaDirName(segment))) return true;
  const normalizedPath = normalizeRelativeAssetPath(relativePath);
  if (isAlwaysIgnoredAssetPath(normalizedPath)) return true;
  let matches = this.linkedRuleMatchers.get(rules);
  if (!matches) {
    matches = compileLinkedFolderRules(rules.filter((rule) => rule.enabled).map((rule) => this.normalizeLinkedFolderRule(rule)));
    this.linkedRuleMatchers.set(rules, matches);
  }
  return matches(normalizedPath);
}

export function enumerateLinkedSources(this: LibraryService, rootPath: string, linkedFolderId?: string, suppliedRules?: LinkedFolderRule[], explicitlyIgnored?: (relativePath: string, pathKind: 'asset' | 'folder') => boolean, onDiscovered?: (foundCount: number, entryBytes: number) => void, onDirectory?: (relativePath: string) => void): Array<{
    relativePath: string;
    byteSize: number;
    modifiedAt: string;
    originalFilename: string;
    sourceDevice: string;
    sourceInode: string;
  }> {
  const entries: Array<{
    relativePath: string;
    byteSize: number;
    modifiedAt: string;
    originalFilename: string;
    sourceDevice: string;
    sourceInode: string;
  }> = [];
  const rules = suppliedRules ?? (linkedFolderId
    ? this.getLinkedFolderRules({
        libraryId: [...this.openById.values()].find((open) => open.connection.prepare(
          'SELECT folder_id FROM linked_folders WHERE folder_id = ?',
        ).get(linkedFolderId))?.summary.libraryId ?? '',
        folderId: linkedFolderId,
      })
    : []);
  const visit = (directoryPath: string, relativeDirectory: string, assetsHidden = false): void => {
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    for (const child of children) {
      if (child.isDirectory() && (isLibraryMetaDirName(child.name) || child.name.toLowerCase() === '.bf')) continue;
      if (child.isFile() && isDefaultIgnoredAssetEntry(child.name, 'file')) continue;
      const childRelative =
        relativeDirectory === ''
          ? child.name
          : path.posix.join(relativeDirectory, child.name);
      // Symlinks are neither followed nor registered; this prevents a linked
      // root from pulling in bytes outside itself via a hostile link.
      if (child.isSymbolicLink()) {
        this.diagnose(
          'linked-folder.symlink-skipped',
          new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          }),
          { linkedFolderId, rootPath, relativePath: childRelative },
        );
        continue;
      }
      if (child.isDirectory()) {
        const canPrune = !rules.some((rule) => rule.enabled && rule.action === 'include')
          && this.linkedPathIsIgnored(path.posix.join(childRelative, '__serpent_probe__'), rules);
        if (canPrune) continue;
        const hidden = assetsHidden || explicitlyIgnored?.(childRelative, 'folder') === true;
        if (hidden && !onDirectory) continue;
        onDirectory?.(normalizeRelativeAssetPath(childRelative));
        visit(path.join(directoryPath, child.name), childRelative, hidden);
        continue;
      }
      if (!child.isFile() || assetsHidden) continue;
      const childPath = path.join(directoryPath, child.name);
      let stat: BigIntStats | Stats;
      try {
        // Serpent-4bdd26: honor the assetLstat test seam so injected stat
        // failures surface during enumeration, before the comparison loop
        // can shortcut via the snapshot.
        stat = this.options.assetLstat
          ? this.options.assetLstat(childPath)
          : lstatSync(childPath, { bigint: true });
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (stat.isSymbolicLink()) {
        this.diagnose(
          'linked-folder.symlink-skipped',
          new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          }),
          { linkedFolderId, rootPath, relativePath: childRelative },
        );
        continue;
      }
      if (!stat.isFile()) continue;
      let normalized: string;
      try {
        normalized = normalizeRelativeAssetPath(childRelative);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (this.linkedPathIsIgnored(normalized, rules) || explicitlyIgnored?.(normalized, 'asset')) continue;
      const byteSize = Number(stat.size);
      if (!Number.isSafeInteger(byteSize)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      entries.push({
        relativePath: normalized,
        byteSize,
        modifiedAt: stat.mtime.toISOString(),
        originalFilename: child.name,
        sourceDevice: String(stat.dev),
        sourceInode: String(stat.ino),
      });
      onDiscovered?.(entries.length, byteSize);
    }
  };
  visit(rootPath, '');
  return entries;
}

/**
* 直接把新写入链接目录的文件注册为链接资产，替代全库 refreshManagedAssets。
* 写入路径（importPathsIntoLinkedFolder / copyAssetsToLinkedFolder）原先调用
* refreshManagedAssets(libraryId) 全量枚举所有链接文件夹来注册新增文件——链接
* 文件夹大时导入明显变慢。这里按 importFolderAsLinked 的注册模式（INSERT
* assets + revisions）只登记本次写入的文件；content_fingerprint 留待后续
* 自然 reconciliation 计算，与 importFolderAsLinked 初始索引行为一致。
*/
export function registerWrittenLinkedAssets(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, absoluteRootPath: string, writtenRelativePaths: readonly string[]): void {
  if (writtenRelativePaths.length === 0) return;
  const now = new Date().toISOString();
  const insertAsset = openLibrary.connection.prepare(
    `INSERT INTO assets
       (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
        path_identity, current_revision_id, availability, source_device, source_inode,
        created_at, updated_at)
     VALUES (?, 'linked', NULL, ?, ?, ?, NULL, 'available', ?, ?, ?, ?)`,
  );
  const insertRevision = openLibrary.connection.prepare(
    `INSERT INTO revisions
       (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
        original_filename, origin, accepted_at)
     VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
  );
  const setCurrentRevision = openLibrary.connection.prepare(
    'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
  );
  // transaction() 返回可调用包装，必须立即调用（与 importFolderAsLinked 一致）。
  openLibrary.connection.transaction(() => {
    for (const relativePath of writtenRelativePaths) {
      const absolute = path.join(absoluteRootPath, ...relativePath.split('/'));
      let stat: Stats;
      try {
        stat = lstatSync(absolute);
      } catch {
        continue; // 文件已消失，留给后续 reconciliation 处理
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const assetId = randomUUID();
      const revisionId = randomUUID();
      const pathIdentity = portablePathIdentity(relativePath);
      insertAsset.run(
        assetId,
        linkedFolderId,
        relativePath,
        pathIdentity,
        String(stat.dev),
        String(stat.ino),
        now,
        now,
      );
      insertRevision.run(
        revisionId,
        assetId,
        stat.size,
        stat.mtime.toISOString(),
        path.posix.basename(relativePath),
        now,
      );
      setCurrentRevision.run(revisionId, now, assetId);
      this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
  })();
}

/** Reconcile linked folder statuses: a folder whose root is gone flips to
* offline; a folder whose root came back (e.g. a remounted volume) flips
* to available. Must run before file-operation recovery so linked-trash
* recovery can inspect in-flight sources against the current root state. */
export function reconcileLinkedFolderStatuses(this: LibraryService, openLibrary: OpenLibrary, linkedFolderIds?: ReadonlySet<string>): void {
  const scopedIds = linkedFolderIds?.size ? [...linkedFolderIds] : undefined;
  const linkedFolders = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        ${scopedIds === undefined
          ? ''
          : `WHERE folder_id IN (${scopedIds.map(() => '?').join(',')})`}`,
    )
    .all(...(scopedIds ?? [])) as Array<{
      folder_id: string;
      absolute_root_path: string;
      status: 'available' | 'offline';
    }>;
  const folderNow = new Date().toISOString();
  for (const folder of linkedFolders) {
    const rootGone = this.linkedRootIsGone(folder.absolute_root_path);
    if (rootGone && folder.status === 'available') {
      openLibrary.connection
        .prepare("UPDATE linked_folders SET status = 'offline', updated_at = ? WHERE folder_id = ?")
        .run(folderNow, folder.folder_id);
      this.diagnose('linked-folder.sync.status-changed', 'Linked folder went offline (root path unavailable)', {
        libraryId: openLibrary.summary.libraryId,
        folderId: folder.folder_id,
        rootPath: folder.absolute_root_path,
        previousStatus: 'available',
        newStatus: 'offline',
      });
    } else if (!rootGone && folder.status === 'offline') {
      openLibrary.connection
        .prepare("UPDATE linked_folders SET status = 'available', updated_at = ? WHERE folder_id = ?")
        .run(folderNow, folder.folder_id);
      this.diagnose('linked-folder.sync.status-changed', 'Linked folder restored (root path available again)', {
        libraryId: openLibrary.summary.libraryId,
        folderId: folder.folder_id,
        rootPath: folder.absolute_root_path,
        previousStatus: 'offline',
        newStatus: 'available',
      });
    }
  }
}

export async function reconcileDefaultIgnoredAssets(this: LibraryService, openLibrary: OpenLibrary, task: OpenReconciliationTask): Promise<void> {
  // Keep this cleanup bounded twice: the SQL predicate narrows the scan to
  // the exact default-junk filename shapes, and the cursor limits each
  // result/transaction to a short page. The previous implementation loaded
  // every visible asset before filtering in JS, which made a harmless
  // `.DS_Store` cleanup compete with viewer requests on NAS libraries.
  const defaultIgnoredSql = `(
    LOWER(a.relative_file_path) LIKE '%.ds_store'
    OR LOWER(a.relative_file_path) IN ('desktop.ini', 'thumbs.db')
    OR LOWER(a.relative_file_path) LIKE '%/desktop.ini'
    OR LOWER(a.relative_file_path) LIKE '%/thumbs.db'
    OR LOWER(a.relative_file_path) LIKE '._%'
    OR LOWER(a.relative_file_path) LIKE '%/._%'
  )`;
  let lastAssetId = '';
  for (;;) {
    this.assertReconciliationActive(task);
    const rows = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.relative_file_path
         FROM assets a
        WHERE a.deleted_at IS NULL
          AND a.asset_id > ?
          AND ${defaultIgnoredSql}
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
        ORDER BY a.asset_id
        LIMIT 128`,
    ).all(lastAssetId) as Array<{ asset_id: string; relative_file_path: string }>;
    if (rows.length === 0) return;
    lastAssetId = rows.at(-1)!.asset_id;
    const ignoredIds = rows
      .filter((row) => isAlwaysIgnoredAssetPath(row.relative_file_path))
      .map((row) => row.asset_id);
    if (ignoredIds.length > 0) {
      openLibrary.connection.transaction(() => {
        const remove = openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?');
        for (const assetId of ignoredIds) remove.run(assetId);
      })();
    }
    await this.yieldReconciliation(task);
  }
}

export function assertNetworkLinkedFoldersAvailable(this: LibraryService, connection: DatabaseConnection, networkStorage: boolean): void {
  if (!networkStorage) return;
  const linkedFolders = connection
    .prepare('SELECT absolute_root_path, source_device_hint FROM linked_folders')
    .all() as Array<{ absolute_root_path: string; source_device_hint: string | null }>;
  for (const folder of linkedFolders) {
    const availability = this.linkedRootAvailability(folder.absolute_root_path);
    if (!availability.available) {
      throw new LibraryServiceError('LINKED_FOLDER_UNAVAILABLE', {
        reason: availability.reason,
      });
    }
    // `source_device_hint` is not the catalog identity key. It is a safety
    // signal for the case where another computer has a different volume at
    // the same path used by the original computer.
    // A missing hint is deliberately fail-closed. Older libraries may not
    // have recorded the originating host/volume, and accepting the current
    // path in that case could silently scan another computer's local folder.
    const storedDeviceHint = folder.source_device_hint?.trim();
    if (!storedDeviceHint) {
      throw new LibraryServiceError('LINKED_FOLDER_UNAVAILABLE');
    }
    // v3 hints include directory birth time, so an inode reused by
    // rm+mkdir on ext4/tmpfs no longer matches. Older v2 / numeric hints
    // stay accepted for the same device and inode.
    const hintMatches = storedDeviceHint.startsWith('v3:')
      ? storedDeviceHint === availability.deviceHint
      : storedDeviceHint === availability.deviceHint
        || storedDeviceHint === availability.legacyInodeHint
        || storedDeviceHint === availability.legacyHostDeviceHint
        || storedDeviceHint === availability.legacyDeviceHint;
    if (!hintMatches) {
      throw new LibraryServiceError('LINKED_FOLDER_UNAVAILABLE', {
        reason: 'LINKED_FOLDER_FOREIGN_DEVICE',
      });
    }
  }
}
