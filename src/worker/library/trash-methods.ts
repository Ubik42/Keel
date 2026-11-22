import { type AssetSummary, type LinkedFolderSummary, type ManagedFolderSummary, type TrashedFolderSummary } from "../../shared/asset-types";
import { type AutomaticTask } from "../../shared/automatic-tasks";
import { sanitizeEntityAppearance } from "../../shared/entity-appearance";
import { inferRelinkBatchRoot } from "../../shared/infer-relink-batch-root";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { publicReasonFromError, type PublicErrorReason } from "../../shared/protocol/errors";
import { type DeleteProgressEvent } from "../../shared/protocol/responses";
import { LibraryService, LibraryServiceError, SimulatedCrashError, UUID, closeIgnoringFailure, createProgressThrottle, databasePath, defaultRemoveLinkedSourceFile, directoryBirthNs, isMissingPathError, isUnreadablePathError, openConfiguredDatabase, realDirectoryExists, realFileExists, removePathWithRetry, requiredDirectories, sameSourceSnapshot, serviceError, sha256DescriptorSync, sourceDeviceHint, sourceSnapshot, transferCheckpoint, type AssetSummaryRow, type BatchRelinkAssetRow, type BatchRelinkMatch, type DatabaseConnection, type LinkedTrashOperationManifest, type ManagedFolderHistorySnapshot, type ManagedFolderRow, type ManagedFolderTrashOperationManifest, type ManagedRelinkPlacedMarkerV1, type ManagedRelinkPlacementIdentity, type ManagedRelinkPlacementManifestV3, type OpenLibrary, type OperationHistoryGroupStepInput, type OperationManifest, type OperationRow, type RestoreOperationManifest, type TransferCancelState, type TrashSelectionResult, unsupportedSourceEntry } from "../library-service";
import { isPortablePathEqualOrDescendant, normalizeAbsolutePath, normalizeRelativeAssetPath, portablePathIdentity } from "./library-rules";
import { managedStoragePath } from "./library-storage-layout";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, type LibraryJobLease, type LibraryWriteLeaseHeartbeat } from "./library-write-coordinator";
import { type HistoryRecipe, type HistorySource } from "./operation-history";
import { pathIsWithin } from "./path-utils";
import { sqliteAllInChunks, sqliteRunInChunks, withSqliteInPredicate } from "./sqlite-in";
import { removeLibraryRootWithRetry, removePathWithSyncRetry, renamePathWithRetry } from "./windows-fs-retry";
import { randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, type BigIntStats, type Stats, utimesSync, writeSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface TrashMethods {
  restoreManagedAssetTimestamps(...args: Parameters<typeof restoreManagedAssetTimestamps>): ReturnType<typeof restoreManagedAssetTimestamps>;
  recoverLinkedTrashOperation(...args: Parameters<typeof recoverLinkedTrashOperation>): ReturnType<typeof recoverLinkedTrashOperation>;
  recoverRestoreOperation(...args: Parameters<typeof recoverRestoreOperation>): ReturnType<typeof recoverRestoreOperation>;
  recoverManagedFolderTrashOperation(...args: Parameters<typeof recoverManagedFolderTrashOperation>): ReturnType<typeof recoverManagedFolderTrashOperation>;
  applyManagedFolderDeleteHistorySnapshot(...args: Parameters<typeof applyManagedFolderDeleteHistorySnapshot>): ReturnType<typeof applyManagedFolderDeleteHistorySnapshot>;
  trashManagedFolder(...args: Parameters<typeof trashManagedFolder>): ReturnType<typeof trashManagedFolder>;
  trashManagedFolderAsync(...args: Parameters<typeof trashManagedFolderAsync>): ReturnType<typeof trashManagedFolderAsync>;
  trashSelectionAsync(...args: Parameters<typeof trashSelectionAsync>): ReturnType<typeof trashSelectionAsync>;
  deleteManagedFolderFromDisk(...args: Parameters<typeof deleteManagedFolderFromDisk>): ReturnType<typeof deleteManagedFolderFromDisk>;
  deleteManagedFolderFromDiskAsync(...args: Parameters<typeof deleteManagedFolderFromDiskAsync>): ReturnType<typeof deleteManagedFolderFromDiskAsync>;
  deleteEmptyManagedFolders(...args: Parameters<typeof deleteEmptyManagedFolders>): ReturnType<typeof deleteEmptyManagedFolders>;
  deleteLinkedFolderSubtree(...args: Parameters<typeof deleteLinkedFolderSubtree>): ReturnType<typeof deleteLinkedFolderSubtree>;
  deleteActiveManagedAssetsFromDisk(...args: Parameters<typeof deleteActiveManagedAssetsFromDisk>): ReturnType<typeof deleteActiveManagedAssetsFromDisk>;
  finalizeDiskDeletedAssetRows(...args: Parameters<typeof finalizeDiskDeletedAssetRows>): ReturnType<typeof finalizeDiskDeletedAssetRows>;
  deleteActiveManagedAssetsFromDiskAsync(...args: Parameters<typeof deleteActiveManagedAssetsFromDiskAsync>): ReturnType<typeof deleteActiveManagedAssetsFromDiskAsync>;
  deleteAssetsFromDiskAsync(...args: Parameters<typeof deleteAssetsFromDiskAsync>): ReturnType<typeof deleteAssetsFromDiskAsync>;
  deleteLinkedAssetsInBatches(...args: Parameters<typeof deleteLinkedAssetsInBatches>): ReturnType<typeof deleteLinkedAssetsInBatches>;
  deleteActiveManagedAssetsFromDiskWithProgress(...args: Parameters<typeof deleteActiveManagedAssetsFromDiskWithProgress>): ReturnType<typeof deleteActiveManagedAssetsFromDiskWithProgress>;
  relinkMissingFolderAsync(...args: Parameters<typeof relinkMissingFolderAsync>): ReturnType<typeof relinkMissingFolderAsync>;
  relinkMissingFolder(...args: Parameters<typeof relinkMissingFolder>): ReturnType<typeof relinkMissingFolder>;
  deleteAutomaticTask(...args: Parameters<typeof deleteAutomaticTask>): ReturnType<typeof deleteAutomaticTask>;
  deleteTag(...args: Parameters<typeof deleteTag>): ReturnType<typeof deleteTag>;
  deleteTags(...args: Parameters<typeof deleteTags>): ReturnType<typeof deleteTags>;
  setShowMissingLinkedFiles(...args: Parameters<typeof setShowMissingLinkedFiles>): ReturnType<typeof setShowMissingLinkedFiles>;
  trashPath(...args: Parameters<typeof trashPath>): ReturnType<typeof trashPath>;
  placeManagedRelinkFile(...args: Parameters<typeof placeManagedRelinkFile>): ReturnType<typeof placeManagedRelinkFile>;
  managedRelinkPlacementIdentity(...args: Parameters<typeof managedRelinkPlacementIdentity>): ReturnType<typeof managedRelinkPlacementIdentity>;
  writeManagedRelinkPlacementManifest(...args: Parameters<typeof writeManagedRelinkPlacementManifest>): ReturnType<typeof writeManagedRelinkPlacementManifest>;
  writeDurableRelinkJournalFile(...args: Parameters<typeof writeDurableRelinkJournalFile>): ReturnType<typeof writeDurableRelinkJournalFile>;
  cleanupManagedRelinkPlacement(...args: Parameters<typeof cleanupManagedRelinkPlacement>): ReturnType<typeof cleanupManagedRelinkPlacement>;
  recoverOrphanRelinkPlacement(...args: Parameters<typeof recoverOrphanRelinkPlacement>): ReturnType<typeof recoverOrphanRelinkPlacement>;
  isManagedRelinkPlacementIdentity(value: unknown): value is ManagedRelinkPlacementIdentity;
  matchesManagedRelinkPlacementIdentity(...args: Parameters<typeof matchesManagedRelinkPlacementIdentity>): ReturnType<typeof matchesManagedRelinkPlacementIdentity>;
  quarantineManagedRelinkPlacementForRemoval(...args: Parameters<typeof quarantineManagedRelinkPlacementForRemoval>): ReturnType<typeof quarantineManagedRelinkPlacementForRemoval>;
  trashAssets(...args: Parameters<typeof trashAssets>): ReturnType<typeof trashAssets>;
  trashSelection(...args: Parameters<typeof trashSelection>): ReturnType<typeof trashSelection>;
  restoreAssets(...args: Parameters<typeof restoreAssets>): ReturnType<typeof restoreAssets>;
  undoTrashAssets(...args: Parameters<typeof undoTrashAssets>): ReturnType<typeof undoTrashAssets>;
  restoreAssetsIfOriginalVacant(...args: Parameters<typeof restoreAssetsIfOriginalVacant>): ReturnType<typeof restoreAssetsIfOriginalVacant>;
  deleteAssetsFromDisk(...args: Parameters<typeof deleteAssetsFromDisk>): ReturnType<typeof deleteAssetsFromDisk>;
  deleteAssetsPermanent(...args: Parameters<typeof deleteAssetsPermanent>): ReturnType<typeof deleteAssetsPermanent>;
  restoreTrashedManagedFolder(...args: Parameters<typeof restoreTrashedManagedFolder>): ReturnType<typeof restoreTrashedManagedFolder>;
  purgeTrashedAssetsById(...args: Parameters<typeof purgeTrashedAssetsById>): ReturnType<typeof purgeTrashedAssetsById>;
  emptyTrash(...args: Parameters<typeof emptyTrash>): ReturnType<typeof emptyTrash>;
  purgeExpiredTrash(...args: Parameters<typeof purgeExpiredTrash>): ReturnType<typeof purgeExpiredTrash>;
  listTrashedFolders(...args: Parameters<typeof listTrashedFolders>): ReturnType<typeof listTrashedFolders>;
  listTrash(...args: Parameters<typeof listTrash>): ReturnType<typeof listTrash>;
  deleteLinkedAssets(...args: Parameters<typeof deleteLinkedAssets>): ReturnType<typeof deleteLinkedAssets>;
  relinkAsset(...args: Parameters<typeof relinkAsset>): ReturnType<typeof relinkAsset>;
  batchRelinkRows(...args: Parameters<typeof batchRelinkRows>): ReturnType<typeof batchRelinkRows>;
  indexRelinkCandidates(...args: Parameters<typeof indexRelinkCandidates>): ReturnType<typeof indexRelinkCandidates>;
  batchRelinkMatches(...args: Parameters<typeof batchRelinkMatches>): ReturnType<typeof batchRelinkMatches>;
  relinkBatchApply(...args: Parameters<typeof relinkBatchApply>): ReturnType<typeof relinkBatchApply>;
  restoreDatabaseBackup(...args: Parameters<typeof restoreDatabaseBackup>): ReturnType<typeof restoreDatabaseBackup>;
  emitDeleteProgress(...args: Parameters<typeof emitDeleteProgress>): ReturnType<typeof emitDeleteProgress>;
  cancelDiskDelete(...args: Parameters<typeof cancelDiskDelete>): ReturnType<typeof cancelDiskDelete>;
  deleteLibraryFromDisk(...args: Parameters<typeof deleteLibraryFromDisk>): ReturnType<typeof deleteLibraryFromDisk>;
  cleanupPendingDeletions(...args: Parameters<typeof cleanupPendingDeletions>): ReturnType<typeof cleanupPendingDeletions>;
}

/**
* Restore the source timestamps recorded by an exported library before it is
* opened on another platform. ZIP entries do not carry a timezone and the
* streaming extractor intentionally writes new files without trusting the
* archive timestamp. If we leave those files with the extraction time,
* `refreshManagedAssetsOnOpen` treats every asset as externally edited,
* invalidates its ready derived artifacts, and queues a new decode wave.
* That is especially visible when a macOS library is imported on Windows.
* Only same-size, non-symlink managed files are adjusted; a content mismatch
* remains an external change and is handled by the normal refresh path.
*/
export function restoreManagedAssetTimestamps(this: LibraryService, libraryPath: string): void {
  const dbPath = databasePath(libraryPath);
  let connection: DatabaseConnection | undefined;
  try {
    connection = openConfiguredDatabase(
      dbPath,
      this.options.sqliteBusyTimeoutMsForTests,
      { readonly: true },
    );
    const rows = connection
      .prepare(
        `SELECT a.relative_file_path, r.byte_size, r.modified_at
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.location_kind = 'managed'
            AND a.deleted_at IS NULL`,
      )
      .all() as Array<{
        relative_file_path: string;
        byte_size: number;
        modified_at: string;
      }>;
    const assetsRoot = managedStoragePath(libraryPath);
    for (const row of rows) {
      const targetPath = path.resolve(assetsRoot, ...row.relative_file_path.split('/'));
      if (!pathIsWithin(assetsRoot, targetPath)) continue;
      try {
        const stat = lstatSync(targetPath);
        const modifiedAt = Date.parse(row.modified_at);
        if (
          !stat.isFile()
          || stat.isSymbolicLink()
          || stat.size !== row.byte_size
          || !Number.isFinite(modifiedAt)
        ) {
          continue;
        }
        const timestamp = new Date(modifiedAt);
        utimesSync(targetPath, timestamp, timestamp);
      } catch (error) {
        // A single unreadable asset must not make an otherwise valid import
        // fail; refreshManagedAssetsOnOpen will report it as missing.
        this.diagnose('import.restore-asset-timestamp', error, {
          libraryPath,
          relativeFilePath: row.relative_file_path,
        });
      }
    }
  } catch (error) {
    // Timestamp restoration is a compatibility aid, not a validity gate.
    // The normal open/reconcile path remains authoritative if this fails.
    this.diagnose('import.restore-asset-timestamps', error, { libraryPath });
  } finally {
    closeIgnoringFailure(connection);
  }
}

export function recoverLinkedTrashOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: LinkedTrashOperationManifest): void {
  const assetIdsToDelete: string[] = [];
  let recoveryPending = false;
  const explicitlyTrashed = new Set(manifest.trashedAssetIds);
  for (const assetId of manifest.assetIds) {
    const asset = openLibrary.connection
      .prepare(
        `SELECT asset_id, linked_folder_id, relative_file_path
           FROM assets
          WHERE asset_id = ? AND location_kind = 'linked'`,
      )
      .get(assetId) as {
        asset_id: string;
        linked_folder_id: string;
        relative_file_path: string;
      } | undefined;
    if (!asset) continue;
    if (explicitlyTrashed.has(assetId)) {
      assetIdsToDelete.push(assetId);
      continue;
    }
    if (manifest.inFlightAssetId === assetId) {
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
        .get(asset.linked_folder_id) as {
          absolute_root_path: string;
          status: 'available' | 'offline';
        } | undefined;
      const linkedRootOnline = linkedFolder?.status === 'available' &&
        !this.linkedRootIsGone(linkedFolder.absolute_root_path);
      if (linkedRootOnline) {
        try {
          const sourcePath = this.linkedAssetPath(
            openLibrary,
            asset.linked_folder_id,
            asset.relative_file_path,
          );
          if (!existsSync(sourcePath)) assetIdsToDelete.push(assetId);
        } catch (error) {
          recoveryPending = true;
          this.diagnose('asset.delete-linked.recovery-inspect-source', error, {
            operationId: row.operation_id,
            libraryId: openLibrary.summary.libraryId,
            assetId,
          });
        }
      } else {
        recoveryPending = true;
      }
    }
  }

  openLibrary.connection.transaction(() => {
    for (const assetId of assetIdsToDelete) {
      openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(assetId);
    }
    openLibrary.connection
      .prepare(
        `UPDATE file_operations
            SET status = ?, error_code = ?, updated_at = ?
          WHERE operation_id = ?`,
      )
      .run(
        recoveryPending ? 'applying' : 'committed',
        recoveryPending ? 'SOURCE_TRASH_RECONCILIATION_REQUIRED' : 'PROCESS_INTERRUPTED_RECOVERED',
        new Date().toISOString(),
        row.operation_id,
      );
  })();

  if (recoveryPending) {
    this.diagnose(
      'asset.delete-linked.recovery-pending',
      new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
        reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
      }),
      {
        operationId: row.operation_id,
        libraryId: openLibrary.summary.libraryId,
        inFlightAssetId: manifest.inFlightAssetId,
      },
    );
  } else if (manifest.assetIds.length > assetIdsToDelete.length) {
    openLibrary.connection
      .prepare('UPDATE file_operations SET error_code = ? WHERE operation_id = ?')
      .run('PROCESS_INTERRUPTED_PARTIAL', row.operation_id);
  }
}

export function recoverRestoreOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: RestoreOperationManifest, operationPath: string): void {
  if (row.status === 'preparing') {
    this.removeOperation(operationPath);
    openLibrary.connection
      .prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
      )
      .run(new Date().toISOString(), row.operation_id);
    return;
  }

  const regularFileExists = (filePath: string): boolean => {
    try {
      const entry = lstatSync(filePath);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      return true;
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      if (isMissingPathError(error)) return false;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
  };

  for (const file of [...manifest.files].reverse()) {
    const sourcePath = this.trashPath(openLibrary, file.assetId, file.trashFilename);
    const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
    const backupPath = path.join(operationPath, 'backup', file.backupName);
    const backupDestinationPath = file.backupDestinationRelativePath === null
      ? null
      : this.folderPath(openLibrary, file.backupDestinationRelativePath);
    const sourceExists = regularFileExists(sourcePath);
    const destinationExists = regularFileExists(destinationPath);
    const backupExists = regularFileExists(backupPath);

    if (!sourceExists) {
      if (!destinationExists) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      renameSync(destinationPath, sourcePath);
    }

    if (backupExists) {
      if (backupDestinationPath === null || regularFileExists(backupDestinationPath)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      mkdirSync(path.dirname(backupDestinationPath), { recursive: true });
      renameSync(backupPath, backupDestinationPath);
    } else if (file.hadDestination && (!sourceExists || !destinationExists)) {
      // The destination was moved out of the way but its durable backup has
      // disappeared. Do not claim recovery or discard the restored source.
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  }

  this.removeOperation(operationPath);
  openLibrary.connection
    .prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    )
    .run(new Date().toISOString(), row.operation_id);
}

export function recoverManagedFolderTrashOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: ManagedFolderTrashOperationManifest, operationPath: string): void {
  const now = new Date().toISOString();
  const folderRows = [manifest.folder, ...manifest.descendants];
  const folderIds = folderRows.map((folder) => folder.folderId);

  if (row.status === 'preparing' && manifest.phase === 'prepared') {
    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(now, row.operation_id);
    return;
  }

  if (manifest.assetIds.length > 0 && manifest.assetOperationId) {
    const active = sqliteAllInChunks<string, { asset_id: string }>({
      connection: openLibrary.connection,
      values: manifest.assetIds,
      buildSql: (placeholders) =>
        `SELECT asset_id FROM assets WHERE asset_id IN (${placeholders})
          AND deleted_at IS NULL`,
    });
    if (active.length > 0) {
      this.trashAssets({
        libraryId: openLibrary.summary.libraryId,
        assetIds: active.map((asset) => asset.asset_id),
        allowExplicitlyIgnored: true,
        operationId: manifest.assetOperationId,
      });
    }
  }

  if (manifest.phase === 'prepared') {
    manifest.phase = 'assets-trashed';
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'applying', manifest_json = ?, updated_at = ? WHERE operation_id = ?",
    ).run(JSON.stringify(manifest), now, row.operation_id);
  }

  openLibrary.connection.transaction(() => {
    const insert = openLibrary.connection.prepare(
      `INSERT OR IGNORE INTO trashed_managed_folders
         (tombstone_id, folder_id, relative_path, name, parent_relative_path,
          trashed_at, trashed_asset_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const tombstone of manifest.tombstones) {
      insert.run(
        tombstone.tombstoneId,
        tombstone.folderId,
        tombstone.relativePath,
        tombstone.name,
        tombstone.parentRelativePath,
        manifest.trashedAt,
        tombstone.trashedAssetCount,
      );
      openLibrary.connection.prepare(
        `UPDATE assets SET trashed_from_tombstone_id = ?
          WHERE deleted_at IS NOT NULL AND trashed_from_folder_id = ?`,
      ).run(tombstone.tombstoneId, tombstone.folderId);
    }
  })();
  manifest.phase = 'tombstones-written';
  openLibrary.connection.prepare(
    'UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?',
  ).run(JSON.stringify(manifest), new Date().toISOString(), row.operation_id);

  const originalPath = this.folderPath(openLibrary, manifest.folder.relativePath);
  const stagedPath = path.join(operationPath, 'folder-tree');
  if (existsSync(originalPath) && existsSync(stagedPath)) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  if (!existsSync(stagedPath) && existsSync(originalPath)) {
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    renameSync(originalPath, stagedPath);
  }
  manifest.phase = 'filesystem-staged';
  openLibrary.connection.prepare(
    'UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?',
  ).run(JSON.stringify(manifest), new Date().toISOString(), row.operation_id);

  openLibrary.connection.transaction(() => {
    const remove = openLibrary.connection.prepare('DELETE FROM managed_folders WHERE folder_id = ?');
    for (const folderId of [...folderIds].reverse()) remove.run(folderId);
  })();
  manifest.phase = 'db-committed';
  openLibrary.connection.prepare(
    "UPDATE file_operations SET status = 'committed', manifest_json = ?, updated_at = ? WHERE operation_id = ?",
  ).run(JSON.stringify(manifest), new Date().toISOString(), row.operation_id);
  this.removeOperation(operationPath);
}

export function applyManagedFolderDeleteHistorySnapshot(this: LibraryService, openLibrary: OpenLibrary, snapshots: readonly ManagedFolderHistorySnapshot[]): void {
  if (snapshots.length === 0) return;
  // Create/delete recipes are only emitted for empty folders.  Keep this
  // guard here as a second line of defence against a corrupted recipe.
  const rootIds = snapshots
    .filter((snapshot) => !snapshots.some((candidate) =>
      candidate.folderId !== snapshot.folderId
      && candidate.relativePath.startsWith(`${snapshot.relativePath}/`)))
    .map((snapshot) => snapshot.folderId);
  this.deleteEmptyManagedFolders({
    libraryId: openLibrary.summary.libraryId,
    folderIds: rootIds,
  });
}

/**
* Clarification #7 / Serpent-ekj: trash a managed folder (empty or not).
* All active managed assets in the subtree move to the app trash; folder
* rows and the real Assets/ directory tree are then removed. Restoring
* assets falls back to the library root when the original folder is gone.
*/
export function trashManagedFolder(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    /** Batch trash reserves these ids before execution so an open history
     * group has complete inverse recipes even if the Worker is interrupted. */
    operationId?: string;
    tombstoneIds?: readonly string[];
  }): {
    trashedAssetCount: number;
    removedFolderCount: number;
    tombstoneIds: string[];
    rootTombstoneId: string;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const existingTombstones = openLibrary.connection.prepare(
    `SELECT tombstone_id, relative_path FROM trashed_managed_folders
      WHERE folder_id = ? ORDER BY length(relative_path) ASC`,
  ).all(input.folderId) as Array<{ tombstone_id: string; relative_path: string }>;
  if (existingTombstones.length > 0) {
    const root = existingTombstones[0]!;
    return {
      trashedAssetCount: 0,
      removedFolderCount: existingTombstones.length,
      tombstoneIds: existingTombstones.map((row) => row.tombstone_id),
      rootTombstoneId: root.tombstone_id,
    };
  }

  const { folder, descendantFolders, assetIds } = this.collectManagedFolderSubtree(openLibrary, input.folderId);
  const folderOperationId = randomUUID();
  const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
  const operationPath = path.join(operationsRoot, folderOperationId);
  const stagedTreePath = path.join(operationPath, 'folder-tree');
  const trashedAt = new Date().toISOString();
  const tombstoneFolders = [...descendantFolders, folder];
  const tombstoneIds = tombstoneFolders.map((row, index) => input.tombstoneIds?.[index] ?? randomUUID());
  if (tombstoneIds.length !== tombstoneFolders.length || tombstoneIds.some((id) => !UUID.test(id))) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const rootTombstoneId = tombstoneIds.at(-1);
  if (!rootTombstoneId) throw new LibraryServiceError('LIBRARY_CORRUPT');
  const assetOperationId = assetIds.length > 0 ? (input.operationId ?? randomUUID()) : null;
  const manifest: ManagedFolderTrashOperationManifest = {
    assetIds: [...assetIds],
    assetOperationId,
    folder: {
      folderId: folder.folder_id,
      name: folder.name,
      parentFolderId: folder.parent_folder_id,
      pathIdentity: portablePathIdentity(folder.relative_path),
      relativePath: folder.relative_path,
    },
    descendants: descendantFolders.map((row) => ({
      folderId: row.folder_id,
      name: row.name,
      parentFolderId: row.parent_folder_id,
      pathIdentity: portablePathIdentity(row.relative_path),
      relativePath: row.relative_path,
    })),
    kind: 'folder-trash',
    phase: 'prepared',
    tombstones: tombstoneFolders.map((row, index) => {
      const parentRelativePath = path.posix.dirname(row.relative_path);
      return {
        folderId: row.folder_id,
        name: row.name,
        parentRelativePath: parentRelativePath === '.' ? null : parentRelativePath,
        relativePath: row.relative_path,
        tombstoneId: tombstoneIds[index]!,
        trashedAssetCount: 0,
      };
    }),
    trashedAt,
    version: 7,
  };

  let tombstonesWritten = false;
  let folderTreeStaged = false;
  let folderRowsRemoved = false;
  try {
    mkdirSync(operationPath, { recursive: true });
    openLibrary.connection.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'folder-trash', 'preparing', ?, NULL, ?, ?)`,
    ).run(folderOperationId, JSON.stringify(manifest), trashedAt, trashedAt);
    this.failAt('crash-folder-trash-before-assets');

    let trashedAssetCount = 0;
    if (assetIds.length > 0) {
      const result = this.trashAssets({
        libraryId: input.libraryId,
        assetIds,
        allowExplicitlyIgnored: true,
        operationId: assetOperationId!,
      });
      trashedAssetCount = result.trashedCount;
    }
    for (const tombstone of manifest.tombstones) {
      const count = openLibrary.connection.prepare(
        `SELECT COUNT(*) AS count FROM assets
          WHERE deleted_at IS NOT NULL AND trashed_from_folder_id = ?`,
      ).get(tombstone.folderId) as { count: number };
      tombstone.trashedAssetCount = count.count;
    }
    manifest.phase = 'assets-trashed';
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'applying', manifest_json = ?, updated_at = ? WHERE operation_id = ?",
    ).run(JSON.stringify(manifest), new Date().toISOString(), folderOperationId);
    this.failAt('crash-folder-trash-after-assets');

    openLibrary.connection.transaction(() => {
      const insert = openLibrary.connection.prepare(
        `INSERT INTO trashed_managed_folders
           (tombstone_id, folder_id, relative_path, name, parent_relative_path,
            trashed_at, trashed_asset_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const tombstone of manifest.tombstones) {
        insert.run(
          tombstone.tombstoneId,
          tombstone.folderId,
          tombstone.relativePath,
          tombstone.name,
          tombstone.parentRelativePath,
          trashedAt,
          tombstone.trashedAssetCount,
        );
        // Bind before deleting managed_folders rows (FK would null folder_id).
        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET trashed_from_tombstone_id = ?
              WHERE deleted_at IS NOT NULL
                AND trashed_from_folder_id = ?`,
          )
          .run(tombstone.tombstoneId, tombstone.folderId);
      }
    })();
    tombstonesWritten = true;
    manifest.phase = 'tombstones-written';
    openLibrary.connection.prepare(
      'UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?',
    ).run(JSON.stringify(manifest), new Date().toISOString(), folderOperationId);
    this.failAt('crash-folder-trash-after-tombstones');

    const directoryPath = this.folderPath(openLibrary, folder.relative_path);
    if (existsSync(directoryPath)) {
      mkdirSync(path.dirname(stagedTreePath), { recursive: true });
      // Windows: the folder rename fails with EPERM/EBUSY while the folder
      // (or a child) is held open — Explorer, Defender scan, a player.
      // Retry transient locks briefly; a persistent lock falls through to
      // the typed error below, surfaced to the user as FILE_BUSY.
      renamePathWithRetry(directoryPath, stagedTreePath);
    }
    folderTreeStaged = true;
    manifest.phase = 'filesystem-staged';
    openLibrary.connection.prepare(
      'UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?',
    ).run(JSON.stringify(manifest), new Date().toISOString(), folderOperationId);
    this.failAt('crash-folder-trash-after-filesystem');

    openLibrary.connection.transaction(() => {
      const remove = openLibrary.connection.prepare('DELETE FROM managed_folders WHERE folder_id = ?');
      for (const row of [...descendantFolders, folder]) {
        if (remove.run(row.folder_id).changes !== 1) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
        }
      }
    })();
    folderRowsRemoved = true;
    manifest.phase = 'db-committed';
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'committed', manifest_json = ?, updated_at = ? WHERE operation_id = ?",
    ).run(JSON.stringify(manifest), new Date().toISOString(), folderOperationId);
    try {
      this.removeOperation(operationPath);
    } catch (cleanupError) {
      // The tombstones, asset trash and folder staging all committed — a
      // lingering handle on a staged file (Defender scan, Explorer) must
      // not turn a successful trash into a reported failure. A committed
      // operation directory is safe to retain; reopen recovery sweeps it.
      this.diagnose('folder.trash.committed-cleanup', cleanupError, {
        libraryId: input.libraryId,
        folderId: input.folderId,
        operationId: folderOperationId,
      });
    }
    const removedFolderCount = tombstoneFolders.length;
    return { trashedAssetCount, removedFolderCount, tombstoneIds, rootTombstoneId };
  } catch (error) {
    if (error instanceof SimulatedCrashError) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    if (folderRowsRemoved) {
      // SQLite has already committed the row removal. Do not attempt to
      // recreate asset paths from a missing managed folder; retain the
      // journal so the next open can finish the committed side safely.
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'failed', error_code = 'FOLDER_TRASH_RECOVERY_REQUIRED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), folderOperationId);
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
    let compensationFailed = false;
    try {
      if (folderTreeStaged && !folderRowsRemoved && existsSync(stagedTreePath)) {
        const originalPath = this.folderPath(openLibrary, folder.relative_path);
        if (!existsSync(originalPath)) renameSync(stagedTreePath, originalPath);
      }
      if (tombstonesWritten) {
        openLibrary.connection.transaction(() => {
          sqliteRunInChunks({
            connection: openLibrary.connection,
            values: tombstoneIds,
            buildSql: (placeholders) =>
              `DELETE FROM trashed_managed_folders WHERE tombstone_id IN (${placeholders})`,
          });
        })();
      }
      if (assetOperationId) {
        const operation = openLibrary.connection.prepare(
          'SELECT status, error_code FROM file_operations WHERE operation_id = ?',
        ).get(assetOperationId) as { status: string; error_code: string | null } | undefined;
        if (operation?.status === 'committed' && operation.error_code === null) {
          this.undoTrashAssets({
            libraryId: input.libraryId,
            operationId: assetOperationId,
            requireAll: true,
          });
        }
      }
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'FOLDER_TRASH_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), folderOperationId);
      this.removeOperation(operationPath);
    } catch (rollbackError) {
      compensationFailed = true;
      this.diagnose('folder.trash.rollback', rollbackError, {
        libraryId: input.libraryId,
        folderId: input.folderId,
        operationId: folderOperationId,
      });
    }
    if (compensationFailed) {
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'failed', error_code = 'FOLDER_TRASH_RECOVERY_REQUIRED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), folderOperationId);
    }
    /*
     * The journal is the source of truth if compensation itself fails. The
     * caller still receives the original typed error; reopen will retry the
     * folder operation rather than exposing a stale history entry.
     */
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

/**
* UI/Worker entry point. Folder trash is synchronous for the in-process
* service tests and history recipe executor, but the real Worker awaits
* media cancellation so Windows decoder handles are released before rename.
*/
export async function trashManagedFolderAsync(this: LibraryService, input: Parameters<LibraryService['trashManagedFolder']>[0]): Promise<ReturnType<LibraryService['trashManagedFolder']>> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const subtree = this.collectManagedFolderSubtree(openLibrary, input.folderId);
  await this.cancelMediaJobsForAssets(openLibrary, subtree.assetIds);
  return this.trashManagedFolder(input);
}

export async function trashSelectionAsync(this: LibraryService, input: Parameters<LibraryService['trashSelection']>[0]): Promise<ReturnType<LibraryService['trashSelection']>> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const assetIds = new Set(input.assetIds);
  for (const folderId of input.folderIds) {
    for (const assetId of this.collectManagedFolderSubtree(openLibrary, folderId).assetIds) assetIds.add(assetId);
  }
  await this.cancelMediaJobsForAssets(openLibrary, [...assetIds]);
  return this.trashSelection(input);
}

/**
* Clarification #7 / Serpent-ekj: permanently delete a managed folder and
* every active managed asset in its subtree from disk. Irreversible.
*/
export function deleteManagedFolderFromDisk(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
  }): { deletedAssetCount: number; removedFolderCount: number } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const { folder, descendantFolders, assetIds } =
    this.collectManagedFolderSubtree(openLibrary, input.folderId);

  let deletedAssetCount = 0;
  if (assetIds.length > 0) {
    deletedAssetCount = this.deleteActiveManagedAssetsFromDisk(
      openLibrary,
      assetIds,
    );
  }

  const removedFolderCount = this.removeManagedFolderRowsAndDirectory(
    openLibrary,
    folder,
    descendantFolders,
  );
  return { deletedAssetCount, removedFolderCount };
}

/**
* Hard-delete entry point used by the Worker request handler.  Media
* generators can still have a decoder process reading a managed source
* while the UI asks for deletion.  Cancel those jobs and wait for their
* finally blocks before touching the source paths; otherwise Windows can
* report the transient handle as a misleading permission failure.
*/
export async function deleteManagedFolderFromDiskAsync(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
  }): Promise<{ deletedAssetCount: number; removedFolderCount: number }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const { folder, descendantFolders, assetIds } =
    this.collectManagedFolderSubtree(openLibrary, input.folderId);
  await this.cancelMediaJobsForAssets(openLibrary, assetIds);
  const deletedAssetCount =
    assetIds.length === 0
      ? 0
      : await this.deleteActiveManagedAssetsFromDiskWithProgress(
          input.libraryId,
          openLibrary,
          assetIds,
        );
  const removedFolderCount = await this.removeManagedFolderRowsAndDirectoryAsync(
    openLibrary,
    folder,
    descendantFolders,
  );
  return { deletedAssetCount, removedFolderCount };
}

/**
* Delete only genuinely empty managed folders.  This intentionally does not
* recurse and does not enter the application trash: automation callers use
* it for cleanup after an import, so an asset row, child folder, or even an
* unmanaged file left on disk makes the whole request fail safely.
*/
export function deleteEmptyManagedFolders(this: LibraryService, input: {
    libraryId: string;
    folderIds: string[];
  }): { deletedFolderIds: string[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const folderIds = [...new Set(input.folderIds)];
  if (folderIds.length === 0) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const rows = sqliteAllInChunks<string, { folder_id: string; relative_path: string }>({
    connection: openLibrary.connection,
    values: folderIds,
    buildSql: (placeholders) =>
      // Keel review: managed_folders lives inside the per-library DB —
      // there is no library_id column (the table is already library-scoped).
      `SELECT folder_id, relative_path
         FROM managed_folders
        WHERE folder_id IN (${placeholders})`,
  });
  if (rows.length !== folderIds.length) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const childCount = openLibrary.connection.prepare(
    'SELECT COUNT(*) AS count FROM managed_folders WHERE parent_folder_id = ?',
  );
  const assetCount = openLibrary.connection.prepare(
    `SELECT COUNT(*) AS count FROM assets
       WHERE managed_folder_id = ? AND location_kind = 'managed'`,
  );

  // Phase 1: validate EVERY target (children / assets / directory present
  // and empty) before touching anything — a batch with one non-empty folder
  // is rejected wholesale, nothing is deleted.
  const targetPaths: Array<{ folderId: string; directoryPath: string }> = [];
  for (const row of rows) {
    const children = childCount.get(row.folder_id) as { count: number };
    const assets = assetCount.get(row.folder_id) as { count: number };
    const directoryPath = this.folderPath(openLibrary, row.relative_path);
    if (children.count !== 0 || assets.count !== 0 || !realDirectoryExists(directoryPath)) {
      throw new LibraryServiceError(
        !realDirectoryExists(directoryPath) ? 'FOLDER_NOT_FOUND' : 'FOLDER_NOT_EMPTY',
      );
    }
    targetPaths.push({ folderId: row.folder_id, directoryPath });
  }

  // Phase 2: delete. rmdir (not recursive rm) is the final guard against
  // files created by an external process after validation; each rmdir is
  // paired with its DB row delete so a mid-batch failure leaves removed
  // folders consistent on disk and in the DB (refresh reconciles the rest).
  const removed: Array<{ folderId: string; directoryPath: string }> = [];
  for (const target of targetPaths) {
    try {
      rmdirSync(target.directoryPath);
      removed.push(target);
    } catch (error) {
      for (const done of removed) {
        try {
          mkdirSync(done.directoryPath);
        } catch {
          // Disk restore is best-effort; the DB row is kept below.
        }
      }
      if (isMissingPathError(error)) throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        throw new LibraryServiceError('FOLDER_NOT_EMPTY', { cause: error });
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  try {
    openLibrary.connection.transaction(() => {
      const remove = openLibrary.connection.prepare(
        'DELETE FROM managed_folders WHERE folder_id = ?',
      );
      for (const folderId of folderIds) {
        if (remove.run(folderId).changes !== 1) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND');
        }
      }
    })();
  } catch (error) {
    // A database failure after rmdir leaves only empty directories absent;
    // refresh can reconcile the index. Preserve the primary typed error.
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  return { deletedFolderIds: folderIds };
}

/**
* Delete a linked folder path (2026-09-15 user decision: links never enter the
* OS recycle bin, and the library trash never owns linked bytes).
* - `deleteFromDisk: true`: permanently delete the source files of the whole
*   subtree (one unified progress stream), remove source leftovers that were
*   never indexed, then drop the index rows.
* - `deleteFromDisk: false`: remove only the link records; the external source
*   files are left untouched (same semantics as 「移除链接文件夹」).
* - `relativePath === ''` targets the linked folder root, which also removes
*   the `linked_folders` row; a child path keeps the root link in place.
*/
export async function deleteLinkedFolderSubtree(this: LibraryService, input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    deleteFromDisk: boolean;
  }): Promise<{ deletedAssetCount: number; failedCount: number }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.cancelReconciliationForClientMutation(input.libraryId);
  const isLinkedRoot = input.relativePath === '';
  let relativePath: string;
  if (isLinkedRoot) {
    relativePath = '';
  } else {
    try {
      relativePath = normalizeRelativeAssetPath(input.relativePath);
    } catch (error) {
      throw new LibraryServiceError('INVALID_FOLDER_NAME', { cause: error });
    }
  }

  const linked = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders WHERE folder_id = ? AND library_id = ?`,
    )
    .get(input.linkedFolderId, input.libraryId) as
    | {
        folder_id: string;
        absolute_root_path: string;
        status: 'available' | 'offline';
      }
    | undefined;
  if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const prefix = isLinkedRoot ? '' : `${relativePath}/`;
  const assetQuery = isLinkedRoot
    ? openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE linked_folder_id = ?
              AND location_kind = 'linked'
              AND deleted_at IS NULL`,
        )
        .all(input.linkedFolderId)
    : openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE linked_folder_id = ?
              AND location_kind = 'linked'
              AND deleted_at IS NULL
              AND (relative_file_path = ? OR substr(relative_file_path, 1, ?) = ?)`,
        )
        .all(
          input.linkedFolderId,
          relativePath,
          [...prefix].length,
          prefix,
        );
  const assetRows = assetQuery as Array<{ asset_id: string }>;

  const dirPath = isLinkedRoot
    ? linked.absolute_root_path
    : path.join(linked.absolute_root_path, ...relativePath.split('/'));

  if (input.deleteFromDisk) {
    // 2026-09-15 用户决定：链接文件夹的删除动作是「强制从硬盘删除」——永久删除源
    // 文件（不再送系统回收站），并带进度。整棵子树一次交给同一个例程，避免旧实现
    // 「每 20 个一批」造成 750 次独立操作与 750 段碎片进度。
    const ids = assetRows.map((row) => row.asset_id);
    const result = ids.length > 0
      ? await this.deleteLinkedAssetsInBatches({
          libraryId: input.libraryId,
          assetIds: ids,
        })
      : { deletedCount: 0, failedCount: 0 };
    if (linked.status === 'available' && existsSync(dirPath)) {
      try {
        // 未纳入索引的文件（其它类型或已被忽略）同样属于本次删除目标。
        rmSync(dirPath, { force: true, recursive: true });
      } catch (error) {
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      }
    }
    if (isLinkedRoot) {
      // 进度由上面的批量删除统一上报；这里只清链接记录，避免再冒出一条 0/0 的进度。
      await this.removeLinkedFolder(
        {
          libraryId: input.libraryId,
          folderId: input.linkedFolderId,
        },
        { progress: 'silent' },
      );
    } else {
      this.linkedDirectoryIndex(openLibrary).remove(input.linkedFolderId, relativePath);
    }
    return {
      deletedAssetCount: result.deletedCount,
      failedCount: result.failedCount,
    };
  }

  // 只删链接记录：不动源文件（与「移除链接文件夹」同语义）。旧的逐文件系统回收站
  // 分支已按 2026-09-15 用户决定移除——它会为每个文件 spawn 一次系统回收站 helper。
  if (isLinkedRoot) {
    const removed = await this.removeLinkedFolder({
      libraryId: input.libraryId,
      folderId: input.linkedFolderId,
    });
    return { deletedAssetCount: removed.removedAssetCount, failedCount: 0 };
  }
  const childIds = assetRows.map((row) => row.asset_id);
  const removeOperationId = randomUUID();
  const removeTotalFiles = childIds.length;
  const removeThrottle = createProgressThrottle();
  let removeProcessed = 0;
  this.emitDeleteProgress({
    operationId: removeOperationId,
    libraryId: input.libraryId,
    kind: 'linked-remove',
    phase: 'run',
    filesProcessed: 0,
    totalFiles: removeTotalFiles,
  });
  const removeAsset = openLibrary.connection.prepare(
    'DELETE FROM assets WHERE asset_id = ?',
  );
  for (let offset = 0; offset < childIds.length; offset += 500) {
    const chunk = childIds.slice(offset, offset + 500);
    openLibrary.connection.transaction(() => {
      for (const assetId of chunk) removeAsset.run(assetId);
    })();
    removeProcessed += chunk.length;
    if (removeThrottle.shouldEmit(removeProcessed === removeTotalFiles)) {
      this.emitDeleteProgress({
        operationId: removeOperationId,
        libraryId: input.libraryId,
        kind: 'linked-remove',
        phase: 'run',
        filesProcessed: removeProcessed,
        totalFiles: removeTotalFiles,
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  this.emitDeleteProgress({
    operationId: removeOperationId,
    libraryId: input.libraryId,
    kind: 'linked-remove',
    phase: 'complete',
    filesProcessed: removeTotalFiles,
    totalFiles: removeTotalFiles,
  });
  return { deletedAssetCount: childIds.length, failedCount: 0 };
}

export function deleteActiveManagedAssetsFromDisk(this: LibraryService, openLibrary: OpenLibrary, assetIds: string[], onFileDeleted?: (processed: number, total: number) => void): number {
  if (assetIds.length === 0) return 0;
  const rows = sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path FROM assets
        WHERE asset_id IN (${placeholders})
          AND location_kind = 'managed'
          AND deleted_at IS NULL`,
  });

  if (rows.length !== assetIds.length) {
    throw new LibraryServiceError('INVALID_STATE_TRANSITION');
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const filePath = this.folderPath(openLibrary, row.relative_file_path);
    try {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 100 });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
          reason:
            code === 'EBUSY' ? 'FILE_BUSY' : 'PERMISSION_DENIED',
          cause: error,
        });
      }
      if (!isMissingPathError(error)) {
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      }
    }
    onFileDeleted?.(index + 1, rows.length);
  }

  openLibrary.connection.transaction(() => {
    this.dissolveImageSequencesForAssets(openLibrary, assetIds);
    for (const row of rows) {
      openLibrary.connection
        .prepare('DELETE FROM assets WHERE asset_id = ?')
        .run(row.asset_id);
    }
  })();

  return rows.length;
}

export function finalizeDiskDeletedAssetRows(this: LibraryService, openLibrary: OpenLibrary, libraryId: string, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  openLibrary.connection.transaction(() => {
    this.dissolveImageSequencesForAssets(openLibrary, assetIds);
    for (const assetId of assetIds) {
      openLibrary.connection
        .prepare('DELETE FROM assets WHERE asset_id = ?')
        .run(assetId);
    }
  })();
  this.invalidateArtifactPathCache(libraryId);
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId,
    changedCount: assetIds.length,
    missingCount: 0,
    source: 'client',
    nativeDragPathsChanged: true,
  });
}

export async function deleteActiveManagedAssetsFromDiskAsync(this: LibraryService, openLibrary: OpenLibrary, libraryId: string, assetIds: string[], options?: {
      onFileDeleted?: (processed: number, total: number) => void;
      cancelState?: TransferCancelState;
    }): Promise<number> {
  if (assetIds.length === 0) return 0;
  const rows = sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path FROM assets
        WHERE asset_id IN (${placeholders})
          AND location_kind = 'managed'
          AND deleted_at IS NULL`,
  });

  if (rows.length !== assetIds.length) {
    throw new LibraryServiceError('INVALID_STATE_TRANSITION');
  }

  const deletedFromDiskIds: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (options?.cancelState?.cancelled) {
      this.finalizeDiskDeletedAssetRows(openLibrary, libraryId, deletedFromDiskIds);
      throw new LibraryServiceError('CANCELLED');
    }
    if (options?.cancelState) {
      await transferCheckpoint();
    }
    const row = rows[index]!;
    const filePath = this.folderPath(openLibrary, row.relative_file_path);
    try {
      await removePathWithRetry(filePath, false);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
          reason: code === 'EBUSY' ? 'FILE_BUSY' : 'PERMISSION_DENIED',
          cause: error,
        });
      }
      if (!isMissingPathError(error)) {
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      }
    }
    deletedFromDiskIds.push(row.asset_id);
    options?.onFileDeleted?.(index + 1, rows.length);
  }

  this.finalizeDiskDeletedAssetRows(
    openLibrary,
    libraryId,
    rows.map((row) => row.asset_id),
  );

  return rows.length;
}

/** Async hard-delete path used by direct disk-delete commands. */
export async function deleteAssetsFromDiskAsync(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<{ deletedCount: number }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const logicalCount = this.countLogicalAssetUnits(
    openLibrary,
    input.assetIds,
  );
  const assetIds = this.expandAssetIdsToSequenceMembers(openLibrary, input.assetIds);
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    location_kind: string;
    deleted_at: string | null;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, location_kind, deleted_at
         FROM assets
        WHERE asset_id IN (${placeholders})`,
  });
  if (rows.length !== assetIds.length) {
    for (const id of assetIds) {
      const row = rows.find((candidate) => candidate.asset_id === id);
      if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (row.deleted_at !== null) {
        throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
      }
    }
  }
  if (rows.some((row) => row.deleted_at !== null)) {
    throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
  }
  // 2026-09-15 用户决定：链接资产的唯一删除动作也是「强制从硬盘删除」。托管与链接
  // 在同一个命令里分流，各自的例程负责文件删除、产物/任务清理、索引行与进度。
  const managedAssetIds = rows
    .filter((row) => row.location_kind === 'managed')
    .map((row) => row.asset_id);
  const linkedAssetIds = rows
    .filter((row) => row.location_kind !== 'managed')
    .map((row) => row.asset_id);

  if (managedAssetIds.length > 0) {
    await this.cancelMediaJobsForAssets(openLibrary, managedAssetIds);
    await this.deleteActiveManagedAssetsFromDiskWithProgress(
      input.libraryId,
      openLibrary,
      managedAssetIds,
    );
  }
  if (linkedAssetIds.length > 0) {
    const linkedResult = await this.deleteLinkedAssetsInBatches({
      libraryId: input.libraryId,
      assetIds: linkedAssetIds,
    });
    if (linkedResult.failedCount > 0 && managedAssetIds.length === 0) {
      throw new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
        reason: linkedResult.failures[0]?.reason ?? 'SOURCE_TRASH_FAILED',
      });
    }
  }
  return { deletedCount: logicalCount };
}

/**
* 公开契约 `deleteLinkedAssets` 每批最多 20 个 id；链接文件夹子树与多选删除都可能涉及
* 上万个文件，因此在这里内部分批，并把所有批次合并成**同一个**进度流——否则界面会出现
* 数百段碎片进度。批间让出事件循环，避免长时间独占调度器。
*/
export async function deleteLinkedAssetsInBatches(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
  }): Promise<{
    deletedCount: number;
    failedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  }> {
  const operationId = randomUUID();
  const totalFiles = input.assetIds.length;
  const throttle = createProgressThrottle();
  let processed = 0;
  const emitRun = (force = false): void => {
    if (!throttle.shouldEmit(force || processed === totalFiles)) return;
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: 'run',
      cancelable: true,
      filesProcessed: processed,
      totalFiles,
    });
  };
  this.emitDeleteProgress({
    operationId,
    libraryId: input.libraryId,
    kind: 'disk',
    phase: 'run',
    cancelable: true,
    filesProcessed: 0,
    totalFiles,
  });

  const LINKED_DELETE_CHUNK_SIZE = 20;
  let deletedCount = 0;
  let failedCount = 0;
  const failures: Array<{ assetId: string; reason: PublicErrorReason }> = [];
  for (let offset = 0; offset < totalFiles; offset += LINKED_DELETE_CHUNK_SIZE) {
    const chunk = input.assetIds.slice(offset, offset + LINKED_DELETE_CHUNK_SIZE);
    const result = await this.deleteLinkedAssets({
      libraryId: input.libraryId,
      assetIds: chunk,
      deleteSourceFile: true,
      progress: {
        operationId,
        totalFiles,
        processedBefore: processed,
        onProcessed: (next) => {
          processed = next;
        },
      },
    });
    deletedCount += result.deletedCount;
    failedCount += result.failedCount;
    failures.push(...result.failures);
    emitRun();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  this.emitDeleteProgress({
    operationId,
    libraryId: input.libraryId,
    kind: 'disk',
    phase: failedCount > 0 ? 'failed' : 'complete',
    filesProcessed: processed,
    totalFiles,
  });
  return { deletedCount, failedCount, failures };
}

export async function deleteActiveManagedAssetsFromDiskWithProgress(this: LibraryService, libraryId: string, openLibrary: OpenLibrary, assetIds: string[]): Promise<number> {
  const operationId = randomUUID();
  const cancelState: TransferCancelState = { cancelled: false };
  this.activeDiskDeletes.set(operationId, cancelState);
  const diskThrottle = createProgressThrottle();
  let filesProcessed = 0;
  const emitRun = (processed: number, totalFiles: number) => {
    if (diskThrottle.shouldEmit(processed === totalFiles)) {
      this.emitDeleteProgress({
        operationId,
        libraryId,
        kind: 'disk',
        phase: 'run',
        cancelable: true,
        filesProcessed: processed,
        totalFiles,
      });
    }
  };
  this.emitDeleteProgress({
    operationId,
    libraryId,
    kind: 'disk',
    phase: 'run',
    cancelable: true,
    filesProcessed: 0,
    totalFiles: assetIds.length,
  });
  try {
    const deletedCount = await this.deleteActiveManagedAssetsFromDiskAsync(
      openLibrary,
      libraryId,
      assetIds,
      {
        cancelState,
        onFileDeleted: (processed, totalFiles) => {
          filesProcessed = processed;
          emitRun(processed, totalFiles);
        },
      },
    );
    this.emitDeleteProgress({
      operationId,
      libraryId,
      kind: 'disk',
      phase: 'complete',
      filesProcessed: assetIds.length,
      totalFiles: assetIds.length,
    });
    return deletedCount;
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
      this.emitDeleteProgress({
        operationId,
        libraryId,
        kind: 'disk',
        phase: 'cancelled',
        filesProcessed,
        totalFiles: assetIds.length,
      });
      throw error;
    }
    this.emitDeleteProgress({
      operationId,
      libraryId,
      kind: 'disk',
      phase: 'failed',
      filesProcessed,
      totalFiles: assetIds.length,
    });
    throw error;
  } finally {
    this.activeDiskDeletes.delete(operationId);
  }
}

export async function relinkMissingFolderAsync(this: LibraryService, input: {
    libraryId: string; folderId: string; newRootPath: string;
  }): Promise<LinkedFolderSummary> {
  const result = this.relinkMissingFolder(input);
  // Watcher registration does not deliver an initial event for existing directories.
  await this.runWatcherReconciliation(input.libraryId, 'watcher', 'linked-folder.relink', [input.folderId]);
  return result;
}

export function relinkMissingFolder(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    newRootPath: string;
  }): LinkedFolderSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  // The explicit relink is authoritative for the new root. Fence any
  // in-flight watcher/open snapshot before changing the path it describes.
  this.cancelReconciliationForClientMutation(input.libraryId);
  const folder = openLibrary.connection
    .prepare(
      `SELECT folder_id, display_name, created_at, appearance_glyph_kind,
              appearance_glyph_value, appearance_color_id
         FROM linked_folders WHERE folder_id = ?`,
    )
    .get(input.folderId) as
      | {
          folder_id: string;
          display_name: string;
          created_at: string;
          appearance_glyph_kind?: string | null;
          appearance_glyph_value?: string | null;
          appearance_color_id?: string | null;
        }
      | undefined;
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  let newRoot: string;
  try {
    newRoot = normalizeAbsolutePath(input.newRootPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }
  let rootStat: BigIntStats;
  try {
    rootStat = lstatSync(newRoot, { bigint: true });
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  if (rootStat.isSymbolicLink()) throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
  if (!rootStat.isDirectory()) throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');

  let canonicalNewRoot: string;
  try {
    canonicalNewRoot = realpathSync(newRoot);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  const newPathIdentity = canonicalNewRoot;
  const conflict = openLibrary.connection
    .prepare(
      'SELECT folder_id FROM linked_folders WHERE path_identity = ? AND folder_id != ?',
    )
    .get(newPathIdentity, input.folderId);
  if (conflict) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');

  const sourceDeviceHintValue = sourceDeviceHint(
    rootStat.dev,
    rootStat.ino,
    directoryBirthNs(rootStat),
  );
  const now = new Date().toISOString();

  let linkedAssetCount = 0;
  openLibrary.connection.transaction(() => {
    openLibrary.connection
      .prepare(
        `UPDATE linked_folders
            SET absolute_root_path = ?, source_device_hint = ?, status = 'available',
                path_identity = ?, updated_at = ?
          WHERE folder_id = ?`,
      )
      .run(canonicalNewRoot, sourceDeviceHintValue, newPathIdentity, now, input.folderId);
    this.linkedDirectoryIndex(openLibrary).replace(input.folderId, []);

    const assets = openLibrary.connection
      .prepare(
        'SELECT asset_id, relative_file_path, current_revision_id, availability FROM assets WHERE linked_folder_id = ?',
      )
      .all(input.folderId) as Array<{
        asset_id: string;
        relative_file_path: string;
        current_revision_id: string;
        availability: 'available' | 'missing';
      }>;
    linkedAssetCount = assets.length;
    for (const asset of assets) {
      const assetPath = path.join(canonicalNewRoot, ...asset.relative_file_path.split('/'));
      let fileStat;
      try {
        // Route through the same stat seam as refreshManagedAssets so tests
        // can inject non-missing-path faults (EACCES/EIO) deterministically.
        fileStat = this.options.assetLstat
          ? this.options.assetLstat(assetPath)
          : lstatSync(assetPath, { bigint: true });
      } catch (error) {
        if (!isMissingPathError(error)) {
          this.diagnose(
            'linked-folder.relink-skip-asset',
            new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error }),
            { folderId: input.folderId, relativePath: asset.relative_file_path },
          );
        }
        fileStat = undefined;
      }
      if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
        if (asset.availability === 'available') {
          openLibrary.connection
            .prepare("UPDATE assets SET availability = 'missing', updated_at = ? WHERE asset_id = ?")
            .run(now, asset.asset_id);
        }
        continue;
      }
      const revisionId = randomUUID();
      openLibrary.connection
        .prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?)`,
        )
        .run(
          revisionId,
          asset.asset_id,
          asset.current_revision_id,
          Number(fileStat.size),
          fileStat.mtime.toISOString(),
          path.posix.basename(asset.relative_file_path),
          now,
        );
      openLibrary.connection
        .prepare(
          "UPDATE assets SET current_revision_id = ?, availability = 'available', updated_at = ? WHERE asset_id = ?",
        )
        .run(revisionId, now, asset.asset_id);
    }
  })();
  this.reconcileLinkedWatchers(openLibrary);

  const countRow = openLibrary.connection
    .prepare(`SELECT COUNT(*) AS count FROM assets a
               WHERE a.linked_folder_id = ?
                 AND NOT EXISTS (
                   SELECT 1
                     FROM asset_sequence_frames hidden_sequence_frame
                    WHERE hidden_sequence_frame.asset_id = a.asset_id
                      AND hidden_sequence_frame.position > 0
                 )`)
    .get(input.folderId) as { count: number };
  if (linkedAssetCount > 0) this.emitClientAssetsChanged(input.libraryId, linkedAssetCount, true);
  return {
    folderId: input.folderId,
    displayName: folder.display_name,
    status: 'available',
    assetCount: countRow.count,
    absoluteRootPath: canonicalNewRoot,
    linkedFolderId: input.folderId,
    relativePath: '',
    parentFolderId: null,
    createdAt: folder.created_at,
    // Relinking keeps the custom look the user already chose.
    appearance: sanitizeEntityAppearance({
      glyphKind: folder.appearance_glyph_kind,
      glyphValue: folder.appearance_glyph_value,
      colorId: folder.appearance_color_id,
    }),
  };
}

export function deleteAutomaticTask(this: LibraryService, input: {
    libraryId: string;
    taskId: string;
  }): AutomaticTask[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  openLibrary.connection
    .prepare("DELETE FROM automatic_tasks WHERE task_id=?")
    .run(input.taskId);
  this.emitClientAssetsChanged(input.libraryId, 0);
  return this.listAutomaticTasks(input.libraryId);
}

export function deleteTag(this: LibraryService, input: { libraryId: string; tagId: string }): string {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const existing = openLibrary.connection
    .prepare('SELECT tag_id FROM tags WHERE tag_id = ? AND library_id = ?')
    .get(input.tagId, openLibrary.summary.libraryId);
  if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const affectedAssets = openLibrary.connection
    .prepare(
      `SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
       UNION
       SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?`,
    )
    .all(input.tagId, input.tagId) as Array<{ asset_id: string }>;

  openLibrary.connection.transaction(() => {
    openLibrary.connection
      .prepare('DELETE FROM tags WHERE tag_id = ?')
      .run(input.tagId);
    for (const { asset_id: assetId } of affectedAssets) {
      this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
  })();
  this.emitClientAssetsChanged(input.libraryId, affectedAssets.length);
  return input.tagId;
}

export function deleteTags(this: LibraryService, input: {
    libraryId: string;
    tagIds: string[];
  }): { deletedTagIds: string[] } {
  const uniqueTagIds = [...new Set(input.tagIds)];
  if (uniqueTagIds.length === 0) return { deletedTagIds: [] };

  this.requireOpenLibrary(input.libraryId);
  const deletedTagIds: string[] = [];
  for (const tagId of uniqueTagIds) {
    deletedTagIds.push(this.deleteTag({ libraryId: input.libraryId, tagId }));
  }
  return { deletedTagIds };
}

export function setShowMissingLinkedFiles(this: LibraryService, show: boolean): void {
  this._showMissingLinkedFiles = show;
}

export function trashPath(this: LibraryService, openLibrary: OpenLibrary, assetId: string, filename: string): string {
  return libraryMetaDir(openLibrary.summary.libraryPath, 'trash', assetId, filename);
}

export function placeManagedRelinkFile(this: LibraryService, openLibrary: OpenLibrary, sourcePath: string, destinationRelativePath: string): {
    destinationPath: string;
    operationPath: string;
    placedIdentity: ManagedRelinkPlacementIdentity;
    stat: Stats;
  } {
  const destinationPath = this.folderPath(openLibrary, destinationRelativePath);
  if (existsSync(destinationPath)) {
    throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');
  }

  let sourceStat: BigIntStats;
  try {
    sourceStat = lstatSync(sourcePath, { bigint: true });
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: sourceStat.isSymbolicLink()
        ? 'SYMBOLIC_LINK_NOT_ALLOWED'
        : 'UNSUPPORTED_FILE_ENTRY',
    });
  }

  const operationPath = libraryMetaDir(openLibrary.summary.libraryPath, 'operations',
    `relink-${randomUUID()}`,
  );
  const stagedPath = path.join(operationPath, 'replacement');
  let stagedIdentity: ManagedRelinkPlacementIdentity;
  try {
    mkdirSync(operationPath, { recursive: true });
    this.copySourceSnapshot({
      byteSize: Number(sourceStat.size),
      destinationRelativePath,
      sourcePath,
      sourceSnapshot: sourceSnapshot(sourceStat),
    }, stagedPath);
    stagedIdentity = this.managedRelinkPlacementIdentity(stagedPath);
    this.failAt('crash-relink-before-manifest-write');
    this.writeManagedRelinkPlacementManifest(operationPath, {
      version: 3,
      kind: 'managed-relink-placement',
      phase: 'staged',
      destinationRelativePath,
      stagedIdentity,
    });
    this.failAt('crash-relink-after-manifest-before-placement');
  } catch (error) {
    if (error instanceof SimulatedCrashError) throw error;
    rmSync(operationPath, { force: true, recursive: true });
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  let placed = false;
  try {
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    // Re-validate after creating a missing original directory hierarchy so a
    // symlink introduced between validation and placement cannot escape Assets/.
    if (this.folderPath(openLibrary, destinationRelativePath) !== destinationPath) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    if (existsSync(destinationPath)) {
      throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');
    }
    renameSync(stagedPath, destinationPath);
    placed = true;
    this.failAt('crash-relink-after-placement-before-manifest-update');
    const placedIdentity = this.managedRelinkPlacementIdentity(destinationPath);
    this.writeDurableRelinkJournalFile(operationPath, 'placed.json', {
      version: 1,
      kind: 'managed-relink-placement-complete',
      placedIdentity,
    } satisfies ManagedRelinkPlacedMarkerV1);
    return {
      destinationPath,
      operationPath,
      placedIdentity,
      stat: statSync(destinationPath),
    };
  } catch (error) {
    if (error instanceof SimulatedCrashError) throw error;
    if (placed) {
      // No durable placed marker means ownership is ambiguous. A concurrent
      // writer may already have replaced or modified the path, so preserve it.
      this.diagnose('asset.relink.placement-marker-failed', error, {
        destinationPath,
      });
    }
    rmSync(operationPath, { force: true, recursive: true });
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

export function managedRelinkPlacementIdentity(this: LibraryService, filePath: string): ManagedRelinkPlacementIdentity {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const descriptor = openSync(filePath, flags);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const pathEntry = lstatSync(filePath, { bigint: true });
    if (
      !before.isFile() || !pathEntry.isFile() || pathEntry.isSymbolicLink() ||
      !sameSourceSnapshot(sourceSnapshot(before), sourceSnapshot(pathEntry))
    ) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
        reason: pathEntry.isSymbolicLink() ? 'SYMBOLIC_LINK_NOT_ALLOWED' : 'SOURCE_CHANGED',
      });
    }
    const sha256 = sha256DescriptorSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameSourceSnapshot(sourceSnapshot(before), sourceSnapshot(after))) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' });
    }
    return {
      ctimeNs: String(after.ctimeNs),
      dev: String(after.dev),
      ino: String(after.ino),
      mtimeNs: String(after.mtimeNs),
      sha256,
      size: String(after.size),
    };
  } finally {
    closeSync(descriptor);
  }
}

export function writeManagedRelinkPlacementManifest(this: LibraryService, operationPath: string, manifest: ManagedRelinkPlacementManifestV3): void {
  this.writeDurableRelinkJournalFile(operationPath, 'manifest.json', manifest);
}

export function writeDurableRelinkJournalFile(this: LibraryService, operationPath: string, filename: 'manifest.json' | 'placed.json', value: ManagedRelinkPlacementManifestV3 | ManagedRelinkPlacedMarkerV1): void {
  const finalPath = path.join(operationPath, filename);
  const temporaryPath = path.join(operationPath, `${filename}.tmp`);
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    let written = 0;
    while (written < payload.length) {
      written += writeSync(descriptor, payload, written, payload.length - written);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // Both journal records are immutable and created exactly once. Renaming
    // onto an absent path avoids platform-specific replace semantics.
    renameSync(temporaryPath, finalPath);

    // Directory fsync makes both the manifest rename and the newly-created
    // relink operation directory durable on filesystems that support it.
    // Windows does not provide a portable directory fsync through Node.
    if (process.platform !== 'win32') {
      for (const directoryPath of [operationPath, path.dirname(operationPath)]) {
        let directoryDescriptor: number | undefined;
        try {
          directoryDescriptor = openSync(directoryPath, constants.O_RDONLY);
          fsyncSync(directoryDescriptor);
        } finally {
          if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
        }
      }
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function cleanupManagedRelinkPlacement(this: LibraryService, placement: {
      destinationPath: string;
      operationPath: string;
      placedIdentity: ManagedRelinkPlacementIdentity;
    }, removeDestination: boolean): void {
  let preserveOperation = false;
  if (removeDestination) {
    try {
      const removal = this.quarantineManagedRelinkPlacementForRemoval(
        placement.destinationPath,
        placement.operationPath,
        placement.placedIdentity,
      );
      preserveOperation = removal.preserveOperation;
      if (!removal.owned) {
        this.diagnose(
          'asset.relink.rollback-file-mismatch',
          new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
          { destinationPath: placement.destinationPath },
        );
      }
    } catch (error) {
      this.diagnose('asset.relink.rollback-file', error, {
        destinationPath: placement.destinationPath,
      });
    }
  }
  if (preserveOperation) return;
  try {
    rmSync(placement.operationPath, { force: true, recursive: true });
  } catch (error) {
    this.diagnose('asset.relink.cleanup-operation', error, {
      operationPath: placement.operationPath,
    });
  }
}

export function recoverOrphanRelinkPlacement(this: LibraryService, openLibrary: OpenLibrary, operationPath: string): boolean {
  const manifestPath = path.join(operationPath, 'manifest.json');
  if (!existsSync(manifestPath)) return false;
  let destinationRelativePath: string;
  let placedIdentity: ManagedRelinkPlacementIdentity | undefined;
  let manifestVersion: 1 | 2 | 3;
  let phase: 'legacy' | 'staged' | 'placed' = 'legacy';
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as { destinationRelativePath?: unknown }).destinationRelativePath !== 'string'
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const version = (parsed as { version?: unknown }).version;
    if (version !== 1 && version !== 2 && version !== 3) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    manifestVersion = version;
    const rawPath = (parsed as { destinationRelativePath: string }).destinationRelativePath;
    destinationRelativePath = normalizeRelativeAssetPath(rawPath);
    if (destinationRelativePath !== rawPath) throw new LibraryServiceError('LIBRARY_CORRUPT');
    if (version === 3) {
      const candidate = parsed as {
        kind?: unknown;
        phase?: unknown;
        stagedIdentity?: unknown;
      };
      if (
        candidate.kind !== 'managed-relink-placement' ||
        candidate.phase !== 'staged' ||
        !this.isManagedRelinkPlacementIdentity(candidate.stagedIdentity)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      phase = 'staged';
    }
  } catch (error) {
    // A malformed/partially-written relink manifest can never authorize a
    // destination deletion. Preserve all files and discard only the isolated
    // operation directory so one bad journal cannot prevent the library opening.
    this.diagnose('asset.relink.recovery-manifest-invalid', error, {
      libraryId: openLibrary.summary.libraryId,
      operationPath,
    });
    rmSync(operationPath, { force: true, recursive: true });
    return true;
  }

  if (manifestVersion === 3) {
    const placedMarkerPath = path.join(operationPath, 'placed.json');
    if (existsSync(placedMarkerPath)) {
      try {
        const marker = JSON.parse(readFileSync(placedMarkerPath, 'utf8')) as {
          kind?: unknown;
          placedIdentity?: unknown;
          version?: unknown;
        };
        if (
          marker.version !== 1 ||
          marker.kind !== 'managed-relink-placement-complete' ||
          !this.isManagedRelinkPlacementIdentity(marker.placedIdentity)
        ) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        placedIdentity = marker.placedIdentity;
        phase = 'placed';
      } catch (error) {
        // A missing or malformed completion marker means the rename cannot be
        // proven. Keep phase=staged so the destination is preserved.
        this.diagnose('asset.relink.recovery-marker-invalid', error, {
          libraryId: openLibrary.summary.libraryId,
          destinationRelativePath,
        });
      }
    }
  }

  const destinationPath = this.folderPath(openLibrary, destinationRelativePath);
  const destinationExists = existsSync(destinationPath);
  let ownsDestination = false;
  if (destinationExists && manifestVersion === 3 && phase === 'placed' && placedIdentity) {
    try {
      ownsDestination = this.matchesManagedRelinkPlacementIdentity(
        destinationPath,
        placedIdentity,
      );
    } catch (error) {
      this.diagnose('asset.relink.recovery-file-mismatch', error, {
        libraryId: openLibrary.summary.libraryId,
        destinationRelativePath,
      });
    }
    if (!ownsDestination) {
      this.diagnose(
        'asset.relink.recovery-file-mismatch',
        new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
        { libraryId: openLibrary.summary.libraryId, destinationRelativePath },
      );
    }
  } else if (destinationExists) {
    // v1/v2 journals and v3 staged journals do not carry durable post-rename
    // ownership. They may be leftovers from the historical rename->v2 crash
    // window, or another writer may have created the path. Preserve the file.
    this.diagnose(
      'asset.relink.recovery-ownership-unknown',
      new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
      {
        libraryId: openLibrary.summary.libraryId,
        destinationRelativePath,
        manifestVersion,
        phase,
      },
    );
  }

  const asset = openLibrary.connection
    .prepare(
      `SELECT availability FROM assets
        WHERE location_kind = 'managed' AND path_identity = ? AND deleted_at IS NULL`,
    )
    .get(portablePathIdentity(destinationRelativePath)) as { availability: 'available' | 'missing' } | undefined;
  const databaseCommitted = asset?.availability === 'available';
  let preserveOperation = false;
  if (destinationExists && ownsDestination && !databaseCommitted) {
    const removal = this.quarantineManagedRelinkPlacementForRemoval(
      destinationPath,
      operationPath,
      placedIdentity!,
    );
    ownsDestination = removal.owned;
    preserveOperation = removal.preserveOperation;
  }
  if (!preserveOperation) rmSync(operationPath, { force: true, recursive: true });
  if (destinationExists && !ownsDestination) {
    openLibrary.preservedRelinkPathIdentities.add(
      portablePathIdentity(destinationRelativePath),
    );
  }
  this.diagnose(
    databaseCommitted
      ? 'asset.relink.recovered-committed-placement'
      : ownsDestination
        ? 'asset.relink.recovered-orphan-placement'
        : 'asset.relink.recovered-preserved-placement',
    new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'IO_ERROR' }),
    { libraryId: openLibrary.summary.libraryId, destinationRelativePath },
  );
  return true;
}

export function isManagedRelinkPlacementIdentity(this: LibraryService, value: unknown): value is ManagedRelinkPlacementIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Partial<Record<keyof ManagedRelinkPlacementIdentity, unknown>>;
  const decimal = /^\d+$/;
  return (
    typeof identity.ctimeNs === 'string' && decimal.test(identity.ctimeNs) &&
    typeof identity.dev === 'string' && decimal.test(identity.dev) &&
    typeof identity.ino === 'string' && decimal.test(identity.ino) &&
    typeof identity.mtimeNs === 'string' && decimal.test(identity.mtimeNs) &&
    typeof identity.size === 'string' && decimal.test(identity.size) &&
    typeof identity.sha256 === 'string' && /^[a-f0-9]{64}$/.test(identity.sha256)
  );
}

export function matchesManagedRelinkPlacementIdentity(this: LibraryService, destinationPath: string, expected: ManagedRelinkPlacementIdentity): boolean {
  // Some network/removable filesystems report inode or device as zero. In that
  // case identity is ambiguous, so recovery must preserve rather than delete.
  if (expected.dev === '0' || expected.ino === '0') return false;
  const current = this.managedRelinkPlacementIdentity(destinationPath);
  return (
    current.ctimeNs === expected.ctimeNs &&
    current.dev === expected.dev &&
    current.ino === expected.ino &&
    current.mtimeNs === expected.mtimeNs &&
    current.size === expected.size &&
    current.sha256 === expected.sha256
  );
}

export function quarantineManagedRelinkPlacementForRemoval(this: LibraryService, destinationPath: string, operationPath: string, expected: ManagedRelinkPlacementIdentity): { owned: boolean; preserveOperation: boolean } {
  if (!this.matchesManagedRelinkPlacementIdentity(destinationPath, expected)) {
    return { owned: false, preserveOperation: false };
  }

  const candidatePath = path.join(operationPath, 'rollback-candidate');
  try {
    renameSync(destinationPath, candidatePath);
  } catch {
    // The path changed after verification or could not be moved. It remains in
    // place, so preserving it and cleaning the journal is safe.
    return { owned: false, preserveOperation: false };
  }

  const candidateOwned = (() => {
    try {
      const candidate = this.managedRelinkPlacementIdentity(candidatePath);
      // Moving into quarantine changes ctime on several filesystems. The stable
      // inode/device plus size, mtime and content hash prove this is the same
      // verified file; any path replacement races produce a different inode.
      return (
        candidate.dev === expected.dev &&
        candidate.ino === expected.ino &&
        candidate.mtimeNs === expected.mtimeNs &&
        candidate.size === expected.size &&
        candidate.sha256 === expected.sha256
      );
    } catch {
      return false;
    }
  })();
  if (candidateOwned) return { owned: true, preserveOperation: false };

  // A writer won the verification->rename race. Restore the moved file when
  // possible. If the original path was claimed again, retain the entire
  // operation under .keel/recovered so neither file is overwritten.
  if (!existsSync(destinationPath)) {
    try {
      renameSync(candidatePath, destinationPath);
      return { owned: false, preserveOperation: false };
    } catch {
      // Fall through to preserving the operation directory.
    }
  }
  const recoveredRoot = path.join(path.dirname(path.dirname(operationPath)), 'recovered');
  try {
    mkdirSync(recoveredRoot, { recursive: true });
    renameSync(operationPath, path.join(recoveredRoot, path.basename(operationPath)));
  } catch {
    // Leave the operation directory in place. The caller must not remove it.
  }
  return { owned: false, preserveOperation: true };
}

export function trashAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    /** Folder deletion intentionally includes assets hidden by ignore rules. */
    allowExplicitlyIgnored?: boolean;
    operationId?: string;
  }): { trashedCount: number; operationId: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  if (!input.allowExplicitlyIgnored) {
    this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  }
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const logicalCount = this.countLogicalAssetUnits(
    openLibrary,
    input.assetIds,
  );
  const assetIds = this.expandAssetIdsToSequenceMembers(
    openLibrary,
    input.assetIds,
  );
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }

  // Validate all assets are managed, active, and exist.
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    relative_file_path: string;
    managed_folder_id: string | null;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.relative_file_path, a.managed_folder_id
         FROM assets a
        WHERE a.asset_id IN (${placeholders})
          AND a.location_kind = 'managed'
          AND a.deleted_at IS NULL`,
  });

  const foundIds = new Set(rows.map((r) => r.asset_id));
  for (const id of assetIds) {
    if (!foundIds.has(id)) {
      const exists = openLibrary.connection
        .prepare('SELECT location_kind, deleted_at FROM assets WHERE asset_id = ?')
        .get(id) as { location_kind: string; deleted_at: string | null } | undefined;
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (exists.location_kind !== 'managed') throw new LibraryServiceError('ASSET_NOT_MANAGED');
      if (exists.deleted_at !== null) throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
    }
  }

  const movedEntries: Array<{
    assetId: string;
    originalPath: string;
    trashName: string;
  }> = [];
  const operationId = input.operationId ?? randomUUID();
  const totalDeleteFiles = rows.length;
  let deletedFilesProcessed = 0;
  const deleteThrottle = createProgressThrottle();
  this.emitDeleteProgress({
    operationId,
    libraryId: input.libraryId,
    kind: 'trash',
    phase: 'run',
    filesProcessed: 0,
    totalFiles: totalDeleteFiles,
  });

  try {
    // Phase 1: move files to trash when the source still exists on disk.
    // Already-missing managed assets are metadata-only trash rows.
    for (const row of rows) {
      const filename = path.posix.basename(row.relative_file_path);
      const sourcePath = this.folderPath(openLibrary, row.relative_file_path);
      let sourceExists = false;
      try {
        const sourceStat = lstatSync(sourcePath, { bigint: true });
        sourceExists = sourceStat.isFile() && !sourceStat.isSymbolicLink();
      } catch (error) {
        if (!isUnreadablePathError(error)) {
          throw new LibraryServiceError('LIBRARY_IO_ERROR', { reason: 'IO_ERROR', cause: error });
        }
      }
      if (!sourceExists) {
        deletedFilesProcessed += 1;
        continue;
      }

      const trashDir = libraryMetaDir(openLibrary.summary.libraryPath, 'trash', row.asset_id);
      mkdirSync(trashDir, { recursive: true });
      const trashFilePath = path.join(trashDir, filename);
      renameSync(sourcePath, trashFilePath);
      movedEntries.push({
        assetId: row.asset_id,
        originalPath: sourcePath,
        trashName: filename,
      });
      deletedFilesProcessed += 1;
      if (deleteThrottle.shouldEmit(deletedFilesProcessed === totalDeleteFiles)) {
        this.emitDeleteProgress({
          operationId,
          libraryId: input.libraryId,
          kind: 'trash',
          phase: 'run',
          filesProcessed: deletedFilesProcessed,
          totalFiles: totalDeleteFiles,
        });
      }
    }

    // Phase 2: write file_operations + update DB in a single transaction
    const now = new Date().toISOString();
    const trashRelativePrefix = '__trash__';

    openLibrary.connection.transaction(() => {
      // Keep sequence membership so trash lists one sequence card and restore
      // can bring the whole run back intact (Serpent-vijg).
      const manifest: OperationManifest = {
        version: 1,
        files: rows.map((row) => ({
          backupName: row.asset_id,
          destinationRelativePath: `${trashRelativePrefix}/${row.asset_id}/${path.posix.basename(row.relative_file_path)}`,
          hadDestination: false,
          stageName: row.asset_id,
        })),
        directories: [],
      };

      openLibrary.connection
        .prepare(
          `INSERT INTO file_operations
             (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
           VALUES (?, 'trash', 'committed', ?, NULL, ?, ?)`,
        )
        .run(operationId, JSON.stringify(manifest), now, now);

      for (const row of rows) {
        const filename = path.posix.basename(row.relative_file_path);
        const trashRelativePath = `${trashRelativePrefix}/${row.asset_id}/${filename}`;
        const trashPathIdentity = portablePathIdentity(trashRelativePath);

        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET relative_file_path = ?, managed_folder_id = NULL,
                    path_identity = ?, deleted_at = ?,
                    trashed_from_relative_path = ?, trashed_from_folder_id = ?,
                    updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            trashRelativePath,
            trashPathIdentity,
            now,
            row.relative_file_path,
            row.managed_folder_id,
            now,
            row.asset_id,
          );
        this.syncAssetSearchContent(openLibrary.connection, row.asset_id);
      }
    })();

    // Soft-delete is a library mutation, not only a local UI action. Emit
    // after the filesystem move and DB transaction both succeed so other
    // renderer windows, plugins, and automation refresh their trash count.
    this.emitClientAssetsChanged(input.libraryId, assetIds.length, true);

    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'trash',
      phase: 'complete',
      filesProcessed: totalDeleteFiles,
      totalFiles: totalDeleteFiles,
    });
    return { trashedCount: logicalCount, operationId };
  } catch (error) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'trash',
      phase: 'failed',
      filesProcessed: deletedFilesProcessed,
      totalFiles: totalDeleteFiles,
    });
    // Rollback filesystem: move trashed files back
    for (const entry of [...movedEntries].reverse()) {
      try {
        const trashDir = libraryMetaDir(openLibrary.summary.libraryPath, 'trash', entry.assetId);
        const trashFilePath = path.join(trashDir, entry.trashName);
        if (existsSync(trashFilePath)) {
          mkdirSync(path.dirname(entry.originalPath), { recursive: true });
          renameSync(trashFilePath, entry.originalPath);
        }
      } catch {
        // Best-effort rollback; the DB transaction was not committed.
      }
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

/**
* Desktop-only mixed trash batch. The Worker owns the selection snapshot,
* parent/child collapse, forward execution, compensation and one history
* entry; the Renderer never loops individual trash commands.
*/
export function trashSelection(this: LibraryService, input: {
    libraryId: string;
    assetIds: readonly string[];
    folderIds: readonly string[];
    source?: HistorySource;
    sourceReference?: string | null;
  }): TrashSelectionResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const assetIds = [...input.assetIds];
  const folderIds = [...input.folderIds];
  if (assetIds.length === 0 && folderIds.length === 0) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  if (
    new Set(assetIds).size !== assetIds.length
    || new Set(folderIds).size !== folderIds.length
    || assetIds.length > 10_000
    || folderIds.length > 10_000
  ) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }

  // Resolve and collapse folders before touching either the filesystem or
  // the history table. Selecting a parent and child is one logical target.
  const folderRows = folderIds.map((folderId) => {
    const row = openLibrary.connection.prepare(
      'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
    ).get(folderId) as ManagedFolderRow | undefined;
    if (!row) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (!realDirectoryExists(this.folderPath(openLibrary, row.relative_path))) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    return row;
  });
  const roots = folderRows.filter((row) => !folderRows.some((other) => (
    other.folder_id !== row.folder_id
    && isPortablePathEqualOrDescendant(row.relative_path, other.relative_path)
    && portablePathIdentity(row.relative_path) !== portablePathIdentity(other.relative_path)
  )));

  const subtreeAssetIds = new Set<string>();
  const folderPlans = roots.map((root) => {
    const subtree = this.collectManagedFolderSubtree(openLibrary, root.folder_id);
    for (const assetId of subtree.assetIds) subtreeAssetIds.add(assetId);
    const tombstoneFolders = [...subtree.descendantFolders, subtree.folder];
    const tombstoneIds = tombstoneFolders.map(() => randomUUID());
    const rootTombstoneId = tombstoneIds[tombstoneFolders.length - 1];
    if (!rootTombstoneId) throw new LibraryServiceError('LIBRARY_CORRUPT');
    return {
      folderId: root.folder_id,
      operationId: randomUUID(),
      tombstoneIds,
      rootTombstoneId,
    };
  });

  // An explicit asset inside a selected folder is already covered by that
  // folder step. Assets outside selected subtrees retain normal single-asset
  // trash validation, including ignore rules.
  const independentAssetIds = assetIds.filter((assetId) => !subtreeAssetIds.has(assetId));
  if (independentAssetIds.length > 0) {
    this.assertAssetsNotExplicitlyIgnored(openLibrary, independentAssetIds);
    const rows = withSqliteInPredicate(
      openLibrary.connection,
      'asset_id',
      independentAssetIds,
      (sql, params) =>
        openLibrary.connection.prepare(
          `SELECT asset_id, location_kind, deleted_at
             FROM assets
            WHERE ${sql}`,
        ).all(...params) as Array<{
          asset_id: string;
          location_kind: string;
          deleted_at: string | null;
        }>,
    );
    const rowById = new Map(rows.map((row) => [row.asset_id, row]));
    for (const assetId of independentAssetIds) {
      const row = rowById.get(assetId);
      if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (row.location_kind !== 'managed') {
        throw new LibraryServiceError('ASSET_NOT_MANAGED');
      }
      if (row.deleted_at !== null) {
        throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
      }
    }
  }

  type AssetPlan = { assetIds: string[]; operationId: string };
  type FolderPlan = (typeof folderPlans)[number];
  const assetPlans: AssetPlan[] = independentAssetIds.length === 0
    ? []
    : [{ assetIds: independentAssetIds, operationId: randomUUID() }];
  const historySteps: OperationHistoryGroupStepInput[] = [
    ...assetPlans.map((plan) => ({
      commandId: 'asset.trash',
      affectedEntities: plan.assetIds,
      forwardRecipe: {
        kind: 'asset-trash',
        version: 1,
        payload: { assetIds: plan.assetIds },
      } satisfies HistoryRecipe,
      inverseRecipe: {
        kind: 'asset-trash-undo',
        version: 1,
        payload: { operationId: plan.operationId },
      } satisfies HistoryRecipe,
    })),
    ...folderPlans.map((plan: FolderPlan) => ({
      commandId: 'folder.trash',
      affectedEntities: [plan.folderId],
      forwardRecipe: {
        kind: 'managed-folder-trash',
        version: 1,
        payload: { folderId: plan.folderId },
      } satisfies HistoryRecipe,
      inverseRecipe: {
        kind: 'managed-folder-restore',
        version: 1,
        payload: { tombstoneId: plan.rootTombstoneId },
      } satisfies HistoryRecipe,
    })),
  ];
  const affectedEntities = [...independentAssetIds, ...roots.map((row) => row.folder_id)];
  const history = this.recordOperationHistoryGroup({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: 'selection.trash',
    labelKey: 'history.selection.trash',
    labelArgs: { assets: 0, folders: roots.length },
    affectedCount: roots.length + independentAssetIds.length,
    affectedEntities,
    steps: historySteps,
    commit: false,
  });
  const completed: Array<
    | { kind: 'asset'; operationId: string }
    | { kind: 'folder'; tombstoneId: string }
  > = [];
  let trashedAssetCount = 0;
  let removedFolderCount = 0;
  try {
    for (const plan of assetPlans) {
      const result = this.trashAssets({
        libraryId: input.libraryId,
        assetIds: plan.assetIds,
        operationId: plan.operationId,
      });
      trashedAssetCount += result.trashedCount;
      completed.push({ kind: 'asset', operationId: result.operationId });
    }
    for (const plan of folderPlans) {
      const result = this.trashManagedFolder({
        libraryId: input.libraryId,
        folderId: plan.folderId,
        operationId: plan.operationId,
        tombstoneIds: plan.tombstoneIds,
      });
      trashedAssetCount += result.trashedAssetCount;
      removedFolderCount += result.removedFolderCount;
      completed.push({ kind: 'folder', tombstoneId: result.rootTombstoneId });
    }
    // Update the label only after the real logical counts are known. This is
    // a display projection; the recipes and entity set remain unchanged.
    openLibrary.connection.prepare(
      'UPDATE operation_history SET label_args_json = ?, affected_count = ?, updated_at = ? WHERE history_entry_id = ?',
    ).run(
      JSON.stringify({ assets: trashedAssetCount, folders: roots.length }),
      roots.length + trashedAssetCount,
      new Date().toISOString(),
      history.historyEntryId,
    );
    this.completeOperationHistoryGroup(input.libraryId, history.historyEntryId);
    return {
      historyEntryId: history.historyEntryId,
      removedFolderCount,
      trashedAssetCount,
      trashedFolderCount: roots.length,
    };
  } catch (error) {
    let compensationFailed = false;
    for (const step of [...completed].reverse()) {
      try {
        if (step.kind === 'asset') {
          this.undoTrashAssets({
            libraryId: input.libraryId,
            operationId: step.operationId,
            requireAll: true,
          });
        } else {
          this.restoreTrashedManagedFolder({
            libraryId: input.libraryId,
            tombstoneId: step.tombstoneId,
          });
        }
      } catch (rollbackError) {
        compensationFailed = true;
        this.diagnose('selection.trash.rollback', rollbackError, {
          libraryId: input.libraryId,
          historyEntryId: history.historyEntryId,
          stepKind: step.kind,
        });
      }
    }
    if (compensationFailed) {
      this.markOperationHistoryGroupStale(
        input.libraryId,
        history.historyEntryId,
        'BATCH_COMPENSATION_FAILED',
      );
    } else {
      this.discardOperationHistoryGroup(input.libraryId, history.historyEntryId);
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

export function restoreAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId?: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): { restoredCount: number; assets: AssetSummary[]; operationId: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const assetIds = this.expandAssetIdsToSequenceMembers(
    openLibrary,
    input.assetIds,
  );
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }

  // Validate all assets are trashed (deleted_at IS NOT NULL).
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    relative_file_path: string;
    deleted_at: string;
    trashed_from_relative_path: string;
    trashed_from_folder_id: string | null;
    trashed_from_tombstone_id: string | null;
    current_revision_id: string;
    byte_size: number;
    modified_at: string;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.relative_file_path, a.deleted_at,
              a.trashed_from_relative_path, a.trashed_from_folder_id,
              a.trashed_from_tombstone_id, a.current_revision_id,
              r.byte_size, r.modified_at
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.asset_id IN (${placeholders})
          AND a.deleted_at IS NOT NULL`,
  });

  const foundIds = new Set(rows.map((r) => r.asset_id));
  for (const id of assetIds) {
    if (!foundIds.has(id)) {
      const exists = openLibrary.connection
        .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
        .get(id);
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      throw new LibraryServiceError('ASSET_NOT_TRASHED');
    }
  }

  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  const orderedRows = assetIds.map((assetId) => rowById.get(assetId)!);

  // Resolve target folder
  const hasExplicitTarget = input.targetFolderId !== undefined;
  let targetFolder: ManagedFolderRow | undefined;
  if (typeof input.targetFolderId === 'string') {
    targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
  }
  const conflictStrategy = input.conflictStrategy ?? 'keep-both';

  type RestorePlan = {
    assetId: string;
    backupDestinationRelativePath: string | null;
    backupName: string;
    conflictingAssetId: string | null;
    destinationRelativePath: string;
    managedFolderId: string | null;
    trashFilename: string;
    trashFileMissing: boolean;
  };
  const plans: RestorePlan[] = [];
  const plannedDestinations = new Set<string>();

  try {
    // Planning is side-effect free. The complete plan is persisted before the
    // first source or conflicting destination is moved.
    for (const row of orderedRows) {
      const filename = path.posix.basename(row.trashed_from_relative_path);
      const trashFilePath = this.trashPath(openLibrary, row.asset_id, filename);
      let trashFileMissing = false;
      try {
        const trashEntry = lstatSync(trashFilePath);
        if (!trashEntry.isFile() || trashEntry.isSymbolicLink()) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
      } catch (error) {
        if (isMissingPathError(error)) {
          trashFileMissing = true;
        } else {
          throw error;
        }
      }

      // Determine target folder path
      let targetFolderPath = '';
      let resolvedFolderId: string | null = null;
      if (targetFolder) {
        targetFolderPath = targetFolder.relative_path;
        resolvedFolderId = targetFolder.folder_id;
      } else if (!hasExplicitTarget) {
        if (row.trashed_from_folder_id) {
          const origFolder = openLibrary.connection
            .prepare('SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?')
            .get(row.trashed_from_folder_id) as { folder_id: string; relative_path: string } | undefined;
          if (origFolder) {
            targetFolderPath = origFolder.relative_path;
            resolvedFolderId = origFolder.folder_id;
          }
        }
        if (resolvedFolderId === null && row.trashed_from_tombstone_id) {
          // Deleting a managed folder intentionally removes its row, so the
          // `trashed_from_folder_id` FK may be nulled.  The tombstone binding
          // is the durable identity chain for a folder-trash restore; use it
          // only after the folder rows have been recreated and verify the
          // target still exists before assigning the asset.
          const tombstoneFolder = openLibrary.connection
            .prepare(
              `SELECT f.folder_id, f.relative_path
                 FROM trashed_managed_folders t
                 JOIN managed_folders f ON f.folder_id = t.folder_id
                WHERE t.tombstone_id = ?`,
            )
            .get(row.trashed_from_tombstone_id) as { folder_id: string; relative_path: string } | undefined;
          if (tombstoneFolder) {
            targetFolderPath = tombstoneFolder.relative_path;
            resolvedFolderId = tombstoneFolder.folder_id;
          }
        }
      }

      let destRelativePath = targetFolderPath
        ? path.posix.join(targetFolderPath, filename)
        : filename;

      // Handle name conflicts
      const destIdentity = portablePathIdentity(destRelativePath);
      let activeConflict = openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed'
              AND deleted_at IS NULL AND asset_id != ?`,
        )
        .get(destIdentity, row.asset_id) as { asset_id: string } | undefined;

      let diskConflict = this.portableDiskDestination(openLibrary, destRelativePath);
      const conflictsWithRestoreBatch = plannedDestinations.has(destIdentity);
      if ((activeConflict || diskConflict || conflictsWithRestoreBatch) && conflictStrategy === 'skip') {
        continue;
      }

      let backupDestinationRelativePath: string | null = null;
      let conflictingAssetId: string | null = null;
      if (
        (activeConflict || diskConflict)
        && !conflictsWithRestoreBatch
        && conflictStrategy === 'replace'
        && (!diskConflict || diskConflict.size >= 0)
      ) {
        const actualRelativePath = diskConflict?.actualRelativePath ?? destRelativePath;
        if (diskConflict) {
          backupDestinationRelativePath = actualRelativePath;
        }
        conflictingAssetId = activeConflict?.asset_id ?? null;
        activeConflict = undefined;
        diskConflict = undefined;
      }

      if (activeConflict || diskConflict || conflictsWithRestoreBatch) {
        // Keep both is the default. A duplicate destination inside the same
        // restore batch also receives a suffix so the batch remains atomic.
        const extension = path.posix.extname(filename);
        const baseName = extension.length === 0 ? filename : filename.slice(0, -extension.length);
        for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
          const candidateName = `${baseName} (${index})${extension}`;
          destRelativePath = targetFolderPath
            ? path.posix.join(targetFolderPath, candidateName)
            : candidateName;
          const candidateIdentity = portablePathIdentity(destRelativePath);
          const candidateConflict = openLibrary.connection
            .prepare(
              `SELECT asset_id FROM assets
                WHERE path_identity = ? AND location_kind = 'managed'
                  AND deleted_at IS NULL AND asset_id != ?`,
            )
            .get(candidateIdentity, row.asset_id);
          if (
            !candidateConflict &&
            !plannedDestinations.has(candidateIdentity) &&
            this.portableDiskDestination(openLibrary, destRelativePath) === undefined
          ) {
            break;
          }
        }
      }

      plannedDestinations.add(portablePathIdentity(destRelativePath));
      plans.push({
        assetId: row.asset_id,
        backupDestinationRelativePath,
        backupName: String(plans.length),
        conflictingAssetId,
        destinationRelativePath: destRelativePath,
        managedFolderId: resolvedFolderId,
        trashFilename: filename,
        trashFileMissing,
      });
    }

    const operationId = randomUUID();
    const operationsPath = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    const operationPath = path.join(operationsPath, operationId);
    const backupPath = path.join(operationPath, 'backup');
    const manifest: RestoreOperationManifest = {
      version: 3,
      kind: 'restore',
      files: plans.map((plan) => ({
        assetId: plan.assetId,
        backupDestinationRelativePath: plan.backupDestinationRelativePath,
        backupName: plan.backupName,
        conflictingAssetId: plan.conflictingAssetId,
        destinationRelativePath: plan.destinationRelativePath,
        hadDestination: plan.backupDestinationRelativePath !== null,
        trashFilename: plan.trashFilename,
      })),
    };

    mkdirSync(backupPath, { recursive: true });
    this.assertSafeOperationPath(operationPath);
    const now = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `INSERT INTO file_operations
           (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
         VALUES (?, 'restore', 'preparing', ?, NULL, ?, ?)`,
      )
      .run(operationId, JSON.stringify(manifest), now, now);

    let jobLease: LibraryJobLease;
    try {
      jobLease = new LibraryWriteCoordinator(openLibrary.writeConnection, openLibrary.summary.libraryId)
        .claimJobOnce(operationId);
    } catch (error) {
      this.removeOperation(operationPath);
      if (error instanceof LibraryWriteCoordinatorError) {
        try {
          openLibrary.connection.prepare(
            `UPDATE file_operations
                SET status = 'failed', error_code = 'JOB_LEASE_BUSY', updated_at = ?
              WHERE operation_id = ? AND status = 'preparing'`,
          ).run(new Date().toISOString(), operationId);
        } catch {
          // Best-effort status update.
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
    const jobHeartbeat: LibraryWriteLeaseHeartbeat = jobLease.startHeartbeat();

    try {
      this.failAt('crash-restore-before-filesystem');
      const applying = openLibrary.connection
        .prepare(
          "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'",
        )
        .run(new Date().toISOString(), operationId);
      if (applying.changes !== 1) throw new Error('Restore operation is not preparing.');

      for (const plan of plans) {
        if (plan.backupDestinationRelativePath === null) continue;
        const destinationPath = this.folderPath(openLibrary, plan.backupDestinationRelativePath);
        renameSync(destinationPath, path.join(backupPath, plan.backupName));
      }
      this.failAt('crash-restore-after-backup');

      for (const plan of plans) {
        if (plan.trashFileMissing) continue;
        const sourcePath = this.trashPath(openLibrary, plan.assetId, plan.trashFilename);
        const destinationPath = this.folderPath(openLibrary, plan.destinationRelativePath);
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        renameSync(sourcePath, destinationPath);
      }
      this.failAt('crash-restore-after-filesystem');

      // The database mutation and committed marker share one SQLite commit.
      // Startup recovery therefore never has to guess whether DB state won.
      openLibrary.connection.transaction(() => {
        for (const plan of plans) {
          if (plan.conflictingAssetId) {
            openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(plan.conflictingAssetId);
          }
        }
        for (const plan of plans) {
          const pathIdentity = portablePathIdentity(plan.destinationRelativePath);
          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET relative_file_path = ?, managed_folder_id = ?,
                      path_identity = ?, deleted_at = NULL,
                      trashed_from_relative_path = NULL, trashed_from_folder_id = NULL,
                      trashed_from_tombstone_id = NULL,
                      availability = ?, updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(
              plan.destinationRelativePath,
              plan.managedFolderId,
              pathIdentity,
              plan.trashFileMissing ? 'missing' : 'available',
              now,
              plan.assetId,
            );
          this.syncAssetSearchContent(openLibrary.connection, plan.assetId);
        }
        this.failAt('crash-restore-before-db-commit');
        jobLease.assertCurrent();
        openLibrary.connection
          .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
          .run(new Date().toISOString(), operationId);
      })();
      this.failAt('crash-restore-after-db-commit');

      try {
        this.removeOperation(operationPath);
      } catch (error) {
        // The committed row makes cleanup retryable on the next open.
        this.diagnose('asset.restore.cleanup-operation', error, {
          libraryId: input.libraryId,
          operationId,
        });
      }
    } catch (error) {
      if (error instanceof SimulatedCrashError) {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      }

      const operation = openLibrary.connection
        .prepare('SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?')
        .get(operationId) as OperationRow | undefined;
      if (operation?.status === 'committed') {
        this.diagnose('asset.restore.post-commit', error, { libraryId: input.libraryId, operationId });
      } else if (operation) {
        try {
          this.recoverRestoreOperation(openLibrary, operation, manifest, operationPath);
        } catch (recoveryError) {
          openLibrary.connection
            .prepare(
              "UPDATE file_operations SET status = 'failed', error_code = 'RESTORE_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
            )
            .run(new Date().toISOString(), operationId);
          this.diagnose('asset.restore.rollback', recoveryError, {
            libraryId: input.libraryId,
            operationId,
          });
        }
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      } else {
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      }
    } finally {
      jobHeartbeat.stop();
      try {
        jobLease.release();
      } catch (releaseError) {
        this.diagnose('asset.restore.lease-release', releaseError, {
          libraryId: input.libraryId,
          operationId,
        });
      }
    }

    const restoredAssets: AssetSummary[] = [];
    for (const plan of plans) {
      const assetRow = openLibrary.connection
        .prepare(
          `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                  a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                  COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                  a.deleted_at, a.trashed_from_relative_path
             FROM assets a
             JOIN revisions r ON r.revision_id = a.current_revision_id
             LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
            WHERE a.asset_id = ?`,
        )
        .get(plan.assetId) as AssetSummaryRow & {
          deleted_at: string | null;
          trashed_from_relative_path: string | null;
        } | undefined;
      if (assetRow) restoredAssets.push(this.assetSummaryFromRow(assetRow));
    }

    // Restore changes the library-wide Trash count even when the caller is
    // browsing another scope. Sequence membership is already on the restored
    // rows; disk reconcile must not invent a new sequence.
    if (restoredAssets.length > 0) {
      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId: input.libraryId,
        changedCount: restoredAssets.length,
        missingCount: 0,
        source: 'client',
        nativeDragPathsChanged: true,
      });
    }

    return {
      // `skip` can remove every planned file (or only a subset of a
      // sequence). Report the logical units actually restored, never the
      // originally requested count.
      restoredCount: this.countLogicalAssetUnits(openLibrary, plans.map((plan) => plan.assetId)),
      assets: this.withImageSequenceSummaries(openLibrary, restoredAssets),
      operationId,
    };
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

export function undoTrashAssets(this: LibraryService, input: {
    libraryId: string;
    operationId: string;
    /** History replay must never acknowledge a partially restored batch. */
    requireAll?: boolean;
  }): {
    restoredCount: number;
    skippedCount: number;
    assets: AssetSummary[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const operation = openLibrary.connection.prepare(
    `SELECT operation_id, status, manifest_json, error_code FROM file_operations
      WHERE operation_id = ? AND kind = 'trash'`,
  ).get(input.operationId) as OperationRow | undefined;
  if (!operation || operation.status !== 'committed' || operation.error_code !== null) {
    throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(operation.manifest_json);
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
  if (
    typeof manifest !== 'object'
    || manifest === null
    || !Array.isArray((manifest as { files?: unknown }).files)
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const assetIds = (manifest as { files: unknown[] }).files.map((file) => (
    typeof file === 'object' && file !== null && typeof (file as { backupName?: unknown }).backupName === 'string'
      ? (file as { backupName: string }).backupName
      : null
  ));
  if (assetIds.some((assetId) => assetId === null) || assetIds.length === 0) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const restored = this.restoreAssetsIfOriginalVacant({
    libraryId: input.libraryId,
    assetIds: assetIds as string[],
    requireAll: input.requireAll === true,
  });
  if (restored.skippedCount === 0) {
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), input.operationId);
  }
  return {
    restoredCount: restored.restoredCount,
    skippedCount: restored.skippedCount,
    assets: restored.assets,
  };
}

/**
* Conservative recovery helper for Automation. Unlike the normal Restore
* UI, it never falls back to another folder, adds a suffix, or replaces a
* collision. Each selected asset must still have its original managed
* folder and its exact original path must be vacant at execution time.
*/
export function restoreAssetsIfOriginalVacant(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    /** Reject before mutation when any requested asset cannot be restored. */
    requireAll?: boolean;
  }): {
    restoredCount: number;
    skippedCount: number;
    skipped: Array<{
      assetId: string;
      reason: 'original_folder_missing' | 'name_conflict' | 'trash_file_missing';
    }>;
    assets: AssetSummary[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const assetIds = this.expandAssetIdsToSequenceMembers(openLibrary, input.assetIds);
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    relative_file_path: string;
    deleted_at: string;
    trashed_from_relative_path: string;
    trashed_from_folder_id: string | null;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path, deleted_at,
              trashed_from_relative_path, trashed_from_folder_id
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND deleted_at IS NOT NULL`,
  });
  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  for (const assetId of assetIds) {
    if (rowById.has(assetId)) continue;
    const existing = openLibrary.connection.prepare('SELECT asset_id FROM assets WHERE asset_id = ?').get(assetId);
    if (!existing) throw new LibraryServiceError('ASSET_NOT_FOUND');
    throw new LibraryServiceError('ASSET_NOT_TRASHED');
  }

  const accepted: string[] = [];
  const skipped: Array<{
    assetId: string;
    reason: 'original_folder_missing' | 'name_conflict' | 'trash_file_missing';
  }> = [];
  const plannedDestinations = new Set<string>();
  for (const assetId of assetIds) {
    const row = rowById.get(assetId)!;
    const originalDirectory = path.posix.dirname(row.trashed_from_relative_path);
    if (row.trashed_from_folder_id !== null) {
      const originalFolder = openLibrary.connection.prepare(
        'SELECT relative_path FROM managed_folders WHERE folder_id = ?',
      ).get(row.trashed_from_folder_id) as { relative_path: string } | undefined;
      if (!originalFolder || portablePathIdentity(originalFolder.relative_path) !== portablePathIdentity(originalDirectory)) {
        skipped.push({ assetId, reason: 'original_folder_missing' });
        continue;
      }
    } else if (originalDirectory !== '.') {
      // A non-root file with no surviving managed-folder mapping cannot be
      // restored to its actual original location safely.
      skipped.push({ assetId, reason: 'original_folder_missing' });
      continue;
    }

    const trashFilename = path.posix.basename(row.relative_file_path);
    const trashFilePath = this.trashPath(openLibrary, assetId, trashFilename);
    if (!realFileExists(trashFilePath)) {
      skipped.push({ assetId, reason: 'trash_file_missing' });
      continue;
    }

    const destinationIdentity = portablePathIdentity(row.trashed_from_relative_path);
    const activeConflict = openLibrary.connection.prepare(
      `SELECT asset_id FROM assets
        WHERE path_identity = ? AND location_kind = 'managed'
          AND deleted_at IS NULL AND asset_id != ?`,
    ).get(destinationIdentity, assetId);
    if (
      activeConflict
      || plannedDestinations.has(destinationIdentity)
      || this.portableDiskDestination(openLibrary, row.trashed_from_relative_path) !== undefined
    ) {
      skipped.push({ assetId, reason: 'name_conflict' });
      continue;
    }
    plannedDestinations.add(destinationIdentity);
    accepted.push(assetId);
  }

  if (accepted.length === 0) {
    if (input.requireAll && skipped.length > 0) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    return { restoredCount: 0, skippedCount: skipped.length, skipped, assets: [] };
  }
  if (input.requireAll && skipped.length > 0) {
    throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
  }
  const restored = this.restoreAssets({
    libraryId: input.libraryId,
    assetIds: accepted,
    conflictStrategy: 'skip',
  });
  return {
    restoredCount: restored.restoredCount,
    skippedCount: skipped.length,
    skipped,
    assets: restored.assets,
  };
}

/**
* Clarification #7 / Serpent-9zc: permanently delete active managed assets
* from disk (not via app trash). Irreversible; shares confirm preference
* with folder disk-delete.
*/
export function deleteAssetsFromDisk(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
  }): { deletedCount: number } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const logicalCount = this.countLogicalAssetUnits(
    openLibrary,
    input.assetIds,
  );
  const assetIds = this.expandAssetIdsToSequenceMembers(
    openLibrary,
    input.assetIds,
  );

  const rows = sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND location_kind = 'managed'
          AND deleted_at IS NULL`,
  });

  if (rows.length !== assetIds.length) {
    for (const id of assetIds) {
      const exists = openLibrary.connection
        .prepare(
          'SELECT asset_id, location_kind, deleted_at FROM assets WHERE asset_id = ?',
        )
        .get(id) as
        | { asset_id: string; location_kind: string; deleted_at: string | null }
        | undefined;
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (exists.location_kind !== 'managed') {
        throw new LibraryServiceError('ASSET_NOT_MANAGED');
      }
      if (exists.deleted_at !== null) {
        throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
      }
    }
  }

  const operationId = randomUUID();
  const diskThrottle = createProgressThrottle();
  let filesProcessed = 0;
  this.emitDeleteProgress({
    operationId,
    libraryId: input.libraryId,
    kind: 'disk',
    phase: 'run',
    filesProcessed: 0,
    totalFiles: assetIds.length,
  });
  try {
    this.deleteActiveManagedAssetsFromDisk(
      openLibrary,
      assetIds,
      (processed, totalFiles) => {
        filesProcessed = processed;
        if (diskThrottle.shouldEmit(processed === totalFiles)) {
          this.emitDeleteProgress({
            operationId,
            libraryId: input.libraryId,
            kind: 'disk',
            phase: 'run',
            filesProcessed: processed,
            totalFiles,
          });
        }
      },
    );
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: 'complete',
      filesProcessed: assetIds.length,
      totalFiles: assetIds.length,
    });
    return { deletedCount: logicalCount };
  } catch (error) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: 'failed',
      filesProcessed,
      totalFiles: assetIds.length,
    });
    throw error;
  }
}

export function deleteAssetsPermanent(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
  }): { deletedCount: number; skippedCount: number; skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const logicalInputCount = this.countLogicalAssetUnits(
    openLibrary,
    input.assetIds,
  );
  const assetIds = this.expandAssetIdsToSequenceMembers(
    openLibrary,
    input.assetIds,
  );

  const rows = sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND deleted_at IS NOT NULL`,
  });

  if (rows.length !== assetIds.length) {
    // Validate the complete batch before touching the filesystem. A mixed
    // active/trashed or unknown batch must never partially delete the valid
    // subset while silently ignoring the rest.
    for (const id of assetIds) {
      const exists = openLibrary.connection
        .prepare('SELECT asset_id, deleted_at FROM assets WHERE asset_id = ?')
        .get(id) as { asset_id: string; deleted_at: string | null } | undefined;
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (exists.deleted_at === null) {
        throw new LibraryServiceError('ASSET_NOT_TRASHED', { reason: 'PERMANENT_DELETE_NEEDS_TRASH' });
      }
    }
  }

  let deletedCount = 0;
  const skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> = [];
  const deletedAssetIds: string[] = [];
  const operationId = randomUUID();
  const permanentThrottle = createProgressThrottle();
  const emitPermanent = input.assetIds.length >= 2;
  if (emitPermanent) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'permanent',
      phase: 'run',
      filesProcessed: 0,
      totalFiles: rows.length,
    });
  }

  for (const row of rows) {
    // Remove trash directory
    const trashDir = libraryMetaDir(openLibrary.summary.libraryPath, 'trash', row.asset_id);
    let skipReason: PublicErrorReason | undefined;
    try {
      (this.options.removeTrashPath ?? ((trashPath: string) => {
        rmSync(trashPath, { force: true, recursive: true });
      }))(trashDir);
    } catch (error) {
      if (isMissingPathError(error)) {
        // Already gone, proceed with DB delete
      } else {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EBUSY') {
          skipReason = 'FILE_BUSY';
        } else if (code === 'EPERM' || code === 'EACCES') {
          skipReason = 'PERMISSION_DENIED';
        } else {
          throw error;
        }
      }
    }

    if (skipReason) {
      skippedReasons.push({ assetId: row.asset_id, reason: skipReason });
      this.diagnose(
        'asset.delete-permanent.skip',
        new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: skipReason }),
        { libraryId: input.libraryId, assetId: row.asset_id },
      );
    } else {
      deletedAssetIds.push(row.asset_id);
    }
    if (emitPermanent && permanentThrottle.shouldEmit(deletedAssetIds.length + skippedReasons.length === rows.length)) {
      this.emitDeleteProgress({
        operationId,
        libraryId: input.libraryId,
        kind: 'permanent',
        phase: 'run',
        filesProcessed: deletedAssetIds.length + skippedReasons.length,
        totalFiles: rows.length,
      });
    }
  }

  // Delete DB rows (cascades to revisions, metadata, tags, collections)
  const logicalDeletedCount =
    deletedAssetIds.length === 0
      ? 0
      : this.countLogicalAssetUnits(openLibrary, deletedAssetIds);
  if (deletedAssetIds.length > 0) {
    openLibrary.connection.transaction(() => {
      this.dissolveImageSequencesForAssets(openLibrary, deletedAssetIds);
      for (const assetId of deletedAssetIds) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(assetId);
      }
    })();
    deletedCount = logicalDeletedCount;
  }

  this.syncTrashedFolderTombstones(openLibrary);

  if (deletedAssetIds.length > 0) {
    // The cross-process change subscription is polled, but a local
    // permanent delete must stop serving the deleted asset immediately.
    this.invalidateArtifactPathCache(input.libraryId);
    this.options.onAssetsChanged?.({
      type: 'asset.changed',
      libraryId: input.libraryId,
      changedCount: deletedAssetIds.length,
      missingCount: 0,
      source: 'client',
      nativeDragPathsChanged: true,
    });
  }

  if (emitPermanent) {
    this.emitDeleteProgress({
      operationId,
      libraryId: input.libraryId,
      kind: 'permanent',
      phase: 'complete',
      filesProcessed: rows.length,
      totalFiles: rows.length,
    });
  }

  return {
    deletedCount,
    skippedCount: Math.max(0, logicalInputCount - deletedCount),
    skippedReasons,
  };
}

/**
* Recreate managed folder rows (and disk paths) from trash tombstones, then
* restore trashed assets that belonged to the subtree (Serpent-qufh).
*/
export function restoreTrashedManagedFolder(this: LibraryService, input: {
    libraryId: string;
    tombstoneId: string;
  }): {
    restoredFolderCount: number;
    restoredAssetCount: number;
    folders: ManagedFolderSummary[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const root = openLibrary.connection
    .prepare(
      `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
              trashed_at, trashed_asset_count
         FROM trashed_managed_folders
        WHERE tombstone_id = ?`,
    )
    .get(input.tombstoneId) as
    | {
        tombstone_id: string;
        folder_id: string;
        relative_path: string;
        name: string;
        parent_relative_path: string | null;
        trashed_at: string;
        trashed_asset_count: number;
      }
    | undefined;
  if (!root) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const tombstones = openLibrary.connection
    .prepare(
      `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
              trashed_at, trashed_asset_count
         FROM trashed_managed_folders
        WHERE trashed_at = ?
        ORDER BY length(relative_path) ASC`,
    )
    .all(root.trashed_at)
    .filter((row) => isPortablePathEqualOrDescendant(
      (row as { relative_path: string }).relative_path,
      root.relative_path,
    )) as Array<{
      tombstone_id: string;
      folder_id: string;
      relative_path: string;
      name: string;
      parent_relative_path: string | null;
      trashed_at: string;
      trashed_asset_count: number;
    }>;

  const folderIds = tombstones.map((row) => row.folder_id);
  const tombstoneIds = tombstones.map((row) => row.tombstone_id);

  // Serpent-gz4y / whvm: bind by tombstone id first so same-path tombstones
  // never steal each other's assets. folder_id is a secondary match for
  // rows that still retain the FK; path is a last-resort legacy fallback
  // only when that relative_path has a single competing tombstone.
  const restoreAssetIds: string[] = [];
  const seenRestoreAssetIds = new Set<string>();
  const rememberRestoreAssetId = (assetId: string) => {
    if (seenRestoreAssetIds.has(assetId)) return;
    seenRestoreAssetIds.add(assetId);
    restoreAssetIds.push(assetId);
  };

  if (tombstoneIds.length > 0) {
    const byTombstone = sqliteAllInChunks<string, { asset_id: string }>({
      connection: openLibrary.connection,
      values: tombstoneIds,
      buildSql: (placeholders) =>
        `SELECT asset_id FROM assets
          WHERE deleted_at IS NOT NULL
            AND trashed_from_tombstone_id IN (${placeholders})`,
    });
    for (const row of byTombstone) rememberRestoreAssetId(row.asset_id);
  }

  if (folderIds.length > 0) {
    const byFolderId = sqliteAllInChunks<string, { asset_id: string }>({
      connection: openLibrary.connection,
      values: folderIds,
      buildSql: (placeholders) =>
        `SELECT asset_id FROM assets
          WHERE deleted_at IS NOT NULL
            AND trashed_from_tombstone_id IS NULL
            AND trashed_from_folder_id IN (${placeholders})`,
    });
    for (const row of byFolderId) rememberRestoreAssetId(row.asset_id);
  }

  const ambiguousPaths = new Set<string>();
  const pathCounts = openLibrary.connection
    .prepare(
      `SELECT relative_path AS relative_path, COUNT(*) AS count
         FROM trashed_managed_folders
        GROUP BY relative_path
       HAVING COUNT(*) > 1`,
    )
    .all() as Array<{ relative_path: string; count: number }>;
  for (const row of pathCounts) ambiguousPaths.add(portablePathIdentity(row.relative_path));

  const tombstoneRelativePaths = tombstones.map((row) => row.relative_path);
  const trashedAssetRows = openLibrary.connection
    .prepare(
      `SELECT asset_id, trashed_from_relative_path, trashed_from_folder_id,
              trashed_from_tombstone_id
         FROM assets
        WHERE deleted_at IS NOT NULL
          AND trashed_from_tombstone_id IS NULL
          AND trashed_from_folder_id IS NULL`,
    )
    .all() as Array<{
      asset_id: string;
      trashed_from_relative_path: string | null;
      trashed_from_folder_id: string | null;
      trashed_from_tombstone_id: string | null;
    }>;
  for (const row of trashedAssetRows) {
    if (!row.trashed_from_relative_path) continue;
    const parentPath = path.posix.dirname(row.trashed_from_relative_path);
    const matchesSubtree = tombstoneRelativePaths.some((folderPath) => {
      if (ambiguousPaths.has(portablePathIdentity(folderPath))) return false;
      return isPortablePathEqualOrDescendant(parentPath, folderPath)
        || isPortablePathEqualOrDescendant(row.trashed_from_relative_path!, folderPath);
    });
    if (matchesSubtree) rememberRestoreAssetId(row.asset_id);
  }

  const expectedAssetCount = tombstones.reduce(
    (sum, row) => sum + row.trashed_asset_count,
    0,
  );
  if (expectedAssetCount > 0 && restoreAssetIds.length === 0) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', {
      reason: 'SOURCE_CHANGED',
    });
  }

  const restoredFolders: ManagedFolderSummary[] = [];
  const createdFolderRows: Array<{ folderId: string; relativePath: string }> = [];
  const now = new Date().toISOString();

  // Recreating the folder skeleton and restoring its assets are two separate
  // durable operations: restoreAssets owns the file-operation journal for
  // the asset bytes, while this method owns the tombstone-bound folder rows.
  // If the second phase fails, do not leave an apparently restored folder
  // containing assets that are still in Trash.  Only rows created by this
  // invocation may be compensated; pre-existing folders are never removed.
  const compensateCreatedFolderRows = (reason: unknown): void => {
    if (createdFolderRows.length === 0) return;

    const createdFolderIds = createdFolderRows.map((row) => row.folderId);
    const activeAssets = withSqliteInPredicate(
      openLibrary.connection,
      'managed_folder_id',
      createdFolderIds,
      (sql, params) =>
        openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
               WHERE deleted_at IS NULL
                 AND ${sql}`,
          )
          .all(...params) as Array<{ asset_id: string }>,
    );
    if (activeAssets.length > 0) {
      // A partially successful asset restore owns live bytes.  Preserving
      // the folder rows is safer than deleting their parents out from under
      // those assets; the tombstone remains available for a later retry.
      this.diagnose('folder.restore.compensation-preserved', reason, {
        libraryId: input.libraryId,
        tombstoneId: input.tombstoneId,
        activeAssetIds: activeAssets.map((row) => row.asset_id),
      });
      return;
    }

    try {
      openLibrary.connection.transaction(() => {
        for (const row of [...createdFolderRows].sort(
          (left, right) => right.relativePath.length - left.relativePath.length,
        )) {
          openLibrary.connection
            .prepare('DELETE FROM managed_folders WHERE folder_id = ?')
            .run(row.folderId);
        }
      })();
    } catch (error) {
      this.diagnose('folder.restore.compensation-db', error, {
        libraryId: input.libraryId,
        tombstoneId: input.tombstoneId,
        createdFolderIds,
      });
      return;
    }

    for (const row of [...createdFolderRows].sort(
      (left, right) => right.relativePath.length - left.relativePath.length,
    )) {
      try {
        rmdirSync(this.folderPath(openLibrary, row.relativePath));
      } catch (error) {
        // Never recursively remove a directory here: an external writer may
        // have placed unrelated files in it while the restore was running.
        this.diagnose('folder.restore.compensation-filesystem', error, {
          libraryId: input.libraryId,
          tombstoneId: input.tombstoneId,
          relativePath: row.relativePath,
        });
      }
    }
  };

  try {
    openLibrary.connection.transaction(() => {
      for (const row of tombstones) {
        const existing = openLibrary.connection
          .prepare(
            'SELECT folder_id FROM managed_folders WHERE folder_id = ?',
          )
          .get(row.folder_id) as { folder_id: string } | undefined;
        if (existing) {
          const inserted = openLibrary.connection
            .prepare(
              'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
            )
            .get(row.folder_id) as ManagedFolderRow;
          restoredFolders.push(
            this.summarizeManagedFolderRow(
              openLibrary,
              inserted,
              this.managedFolderCountMaps(openLibrary, [row.folder_id]),
            ),
          );
          continue;
        }

        let parentFolderId: string | null = null;
        if (row.parent_relative_path) {
          const parent = openLibrary.connection
            .prepare(
              'SELECT folder_id FROM managed_folders WHERE path_identity = ?',
            )
            .get(portablePathIdentity(row.parent_relative_path)) as { folder_id: string } | undefined;
          if (!parent) {
            throw new LibraryServiceError('FOLDER_NOT_FOUND', {
              reason: 'SOURCE_CHANGED',
            });
          }
          parentFolderId = parent.folder_id;
        }

        const targetPath = this.folderPath(openLibrary, row.relative_path);
        const pathIdentity = portablePathIdentity(row.relative_path);
        const conflict =
          openLibrary.connection
            .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ?')
            .get(pathIdentity) ??
          openLibrary.connection
            .prepare(
              'SELECT asset_id FROM assets WHERE path_identity = ? AND deleted_at IS NULL',
            )
            .get(pathIdentity) ??
          this.portableDiskDestination(openLibrary, row.relative_path);
        if (conflict) {
          throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
        }

        mkdirSync(targetPath, { recursive: true });
        openLibrary.connection
          .prepare(
            `INSERT INTO managed_folders
               (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.folder_id,
            parentFolderId,
            row.name,
            row.relative_path,
            pathIdentity,
            now,
          );
        createdFolderRows.push({
          folderId: row.folder_id,
          relativePath: row.relative_path,
        });
        const inserted = openLibrary.connection
          .prepare(
            'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
          )
          .get(row.folder_id) as ManagedFolderRow;
        restoredFolders.push(
          this.summarizeManagedFolderRow(
            openLibrary,
            inserted,
            this.managedFolderCountMaps(openLibrary, [row.folder_id]),
          ),
        );
      }
    })();
  } catch (error) {
    compensateCreatedFolderRows(error);
    if (error instanceof LibraryServiceError) throw error;
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  let restoredAssetCount = 0;
  try {
    if (restoreAssetIds.length > 0) {
      const result = this.restoreAssets({
        libraryId: input.libraryId,
        assetIds: restoreAssetIds,
      });
      restoredAssetCount = result.restoredCount;
    }
  } catch (error) {
    // Keep tombstones so the user can retry.  Newly-created folder rows are
    // compensated unless a partial asset restore left live bytes that need
    // their metadata preserved.
    compensateCreatedFolderRows(error);
    throw error instanceof LibraryServiceError
      ? error
      : serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  if (tombstones.length > 0) {
    sqliteRunInChunks({
      connection: openLibrary.connection,
      values: tombstones.map((row) => row.tombstone_id),
      buildSql: (placeholders) =>
        `DELETE FROM trashed_managed_folders
          WHERE tombstone_id IN (${placeholders})`,
    });
  }

  return {
    restoredFolderCount: tombstones.length,
    restoredAssetCount,
    folders: restoredFolders,
  };
}

/** Permanently delete trashed assets by id; shared by emptyTrash and purgeExpiredTrash. */
export function purgeTrashedAssetsById(this: LibraryService, libraryId: string, assetIds: string[], onPurged?: (processed: number, total: number) => void): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
  let purgedCount = 0;
  let skippedCount = 0;
  const failures: Array<{ assetId: string; reason: PublicErrorReason }> = [];

  for (let index = 0; index < assetIds.length; index += 1) {
    const result = this.deleteAssetsPermanent({ libraryId, assetIds: [assetIds[index]!] });
    purgedCount += result.deletedCount;
    skippedCount += result.skippedCount;
    failures.push(...result.skippedReasons);
    onPurged?.(index + 1, assetIds.length);
  }

  return { purgedCount, skippedCount, failures };
}

/** Permanently delete every item currently in Trash (user-initiated empty). */
export function emptyTrash(this: LibraryService, libraryId: string): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);

  const rows = openLibrary.connection
    .prepare(`SELECT asset_id FROM assets WHERE deleted_at IS NOT NULL`)
    .all() as Array<{ asset_id: string }>;

  const operationId = randomUUID();
  const emptyThrottle = createProgressThrottle();
  if (rows.length > 0) {
    this.emitDeleteProgress({
      operationId,
      libraryId,
      kind: 'permanent',
      phase: 'run',
      filesProcessed: 0,
      totalFiles: rows.length,
    });
  }

  let result: {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  };
  try {
    result = this.purgeTrashedAssetsById(
      libraryId,
      rows.map((row) => row.asset_id),
      (filesProcessed, totalFiles) => {
        if (emptyThrottle.shouldEmit(filesProcessed === totalFiles)) {
          this.emitDeleteProgress({
            operationId,
            libraryId,
            kind: 'permanent',
            phase: 'run',
            filesProcessed,
            totalFiles,
          });
        }
      },
    );
  } catch (error) {
    if (rows.length > 0) {
      this.emitDeleteProgress({
        operationId,
        libraryId,
        kind: 'permanent',
        phase: 'failed',
        filesProcessed: 0,
        totalFiles: rows.length,
      });
    }
    throw error;
  }

  if (rows.length > 0) {
    this.emitDeleteProgress({
      operationId,
      libraryId,
      kind: 'permanent',
      phase: 'complete',
      filesProcessed: rows.length,
      totalFiles: rows.length,
    });
  }

  // Serpent-b3kf: never wipe all tombstones when some assets remain in trash.
  if (result.skippedCount === 0) {
    openLibrary.connection.prepare('DELETE FROM trashed_managed_folders').run();
  } else {
    this.syncTrashedFolderTombstones(openLibrary);
  }

  return result;
}

export function purgeExpiredTrash(this: LibraryService, libraryId: string): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);

  const expiryDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = openLibrary.connection
    .prepare(
      `SELECT asset_id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    )
    .all(expiryDate) as Array<{ asset_id: string }>;

  if (rows.length === 0) return { purgedCount: 0, skippedCount: 0, failures: [] };

  const result = this.purgeTrashedAssetsById(
    libraryId,
    rows.map((row) => row.asset_id),
  );

  // Expiry cleanup is an irreversible mutation even though it is not
  // initiated from a visible command.  Add a barrier so an older user
  // operation cannot later be replayed across assets that no longer exist.
  if (result.purgedCount > 0) {
    this.recordOperationHistoryBarrier({
      libraryId,
      source: 'desktop',
      sourceReference: 'trash-expiration',
      commandId: 'trash.purge-expired',
      labelKey: 'history.trash.purge-expired',
      reason: 'expired-trash-purge',
      affectedCount: result.purgedCount,
      affectedEntities: rows.map((row) => row.asset_id),
    });
  }

  openLibrary.connection
    .prepare('DELETE FROM trashed_managed_folders WHERE trashed_at < ?')
    .run(expiryDate);

  return result;
}

export function listTrashedFolders(this: LibraryService, libraryId: string): TrashedFolderSummary[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection
    .prepare(
      `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
              trashed_at, trashed_asset_count
         FROM trashed_managed_folders
        ORDER BY trashed_at DESC, relative_path COLLATE NOCASE`,
    )
    .all() as Array<{
      tombstone_id: string;
      folder_id: string;
      relative_path: string;
      name: string;
      parent_relative_path: string | null;
      trashed_at: string;
      trashed_asset_count: number;
    }>;

  const coverMap = this.trashedFolderCoverArtifactMap(
    openLibrary,
    rows.map((row) => row.tombstone_id),
  );

  return rows.map((row) => ({
    tombstoneId: row.tombstone_id,
    folderId: row.folder_id,
    relativePath: row.relative_path,
    name: row.name,
    parentRelativePath: row.parent_relative_path,
    trashedAt: row.trashed_at,
    assetCount: row.trashed_asset_count,
    coverArtifactIds: coverMap.get(row.tombstone_id) ?? [],
  }));
}

export function listTrash(this: LibraryService, libraryId: string): AssetSummary[] {
  const openLibrary = this.requireOpenLibrary(libraryId);

  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
              a.current_revision_id, a.availability, r.byte_size, r.modified_at,
              COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
              a.deleted_at, a.trashed_from_relative_path, a.trashed_from_tombstone_id
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC`,
    )
    .all() as Array<AssetSummaryRow & {
      deleted_at: string | null;
      trashed_from_relative_path: string | null;
      trashed_from_tombstone_id: string | null;
    }>;

  // Expose the same thumbnail state as the trash search scope so every
  // trash listing path can render a preview for a trashed asset.
  const artifactMap = this.thumbnailArtifactMap(
    libraryId,
    rows.map((row) => row.asset_id),
  );
  const summaries = rows.map((row) => {
    const artifact = artifactMap.get(row.asset_id);
    const detectedMediaType = LibraryService.detectMediaType(row.relative_file_path);
    return this.assetSummaryFromRow({
      ...row,
      thumbnail_status: artifact?.status ?? null,
      thumbnail_artifact_id: artifact?.artifactId ?? null,
      artifact_width: artifact?.width ?? null,
      artifact_height: artifact?.height ?? null,
      artifact_duration_ms: artifact?.durationMs ?? null,
      media_type: LibraryService.toSummaryMediaType(detectedMediaType),
    });
  });
  return this.withImageSequenceSummaries(openLibrary, summaries);
}

export async function deleteLinkedAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    deleteSourceFile: boolean;
    /**
     * 内部调用（文件夹子树、从磁盘删除的链接项）：把多批删除合并到同一个进度流。
     * 公开契约仍是「每批最多 20 个 id」，由调用方分批并传入累计进度。
     */
    progress?: {
      operationId: string;
      totalFiles: number;
      /** 本批开始前已处理的文件数。 */
      processedBefore: number;
      /** 本批结束时回调累计处理数（用于统一进度与最终 complete 事件）。 */
      onProcessed: (processed: number) => void;
    };
  }): Promise<{
    deletedCount: number;
    failedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || input.assetIds.length > 20) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  if (new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }

  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.asset_id',
    input.assetIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.asset_id, a.linked_folder_id, a.relative_file_path
             FROM assets a
            WHERE ${sql}
              AND a.location_kind = 'linked'
              AND a.deleted_at IS NULL`,
        )
        .all(...params) as Array<{
          asset_id: string;
          linked_folder_id: string;
          relative_file_path: string;
        }>,
  );

  const foundIds = new Set(rows.map((r) => r.asset_id));
  for (const id of input.assetIds) {
    if (!foundIds.has(id)) {
      const exists = openLibrary.connection
        .prepare('SELECT location_kind, deleted_at FROM assets WHERE asset_id = ?')
        .get(id) as { location_kind: string; deleted_at: string | null } | undefined;
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (exists.deleted_at !== null) {
        throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
      }
      // A managed asset cannot be handled by the linked-asset delete path.
      throw new LibraryServiceError('INVALID_SELECTION');
    }
  }

  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  const orderedRows = input.assetIds.map((assetId) => rowById.get(assetId)!);

  if (!input.deleteSourceFile) {
    openLibrary.connection.transaction(() => {
      this.dissolveImageSequencesForAssets(openLibrary, input.assetIds);
      for (const row of orderedRows) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(row.asset_id);
      }
    })();
    return { deletedCount: orderedRows.length, failedCount: 0, failures: [] };
  }

  // 2026-09-15 用户决定：链接资产只有「强制从硬盘删除」——永久删除源文件，不再送
  // 系统回收站。旧实现对每个文件 spawn 一次系统回收站 helper（实测 126 ms/文件，
  // 1.5 万文件约 31 分钟），并在这段期间独占调度器。
  const removeSourceFile =
    this.options.removeLinkedSourceFile ?? defaultRemoveLinkedSourceFile;
  // 恢复日志（file_operations）每批一行、id 唯一；进度流可以由调用方跨批合并，
  // 两者必须解耦，否则第二批插入同一 operation_id 会撞主键。
  const journalOperationId = randomUUID();
  const progressOperationId = input.progress?.operationId ?? journalOperationId;
  const now = new Date().toISOString();
  const manifest: LinkedTrashOperationManifest = {
    version: 2,
    kind: 'linked-trash',
    assetIds: orderedRows.map((row) => row.asset_id),
    inFlightAssetId: null,
    trashedAssetIds: [],
  };
  const trashedRows: typeof orderedRows = [];
  const failures: Array<{ assetId: string; reason: PublicErrorReason }> = [];
  const totalFiles = input.progress?.totalFiles ?? orderedRows.length;
  const deleteThrottle = createProgressThrottle();
  let filesProcessed = input.progress?.processedBefore ?? 0;
  const emitRun = (force = false): void => {
    if (!deleteThrottle.shouldEmit(force || filesProcessed === totalFiles)) return;
    this.emitDeleteProgress({
      operationId: progressOperationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: 'run',
      cancelable: true,
      filesProcessed,
      totalFiles,
    });
  };
  if (input.progress === undefined) {
    this.emitDeleteProgress({
      operationId: progressOperationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: 'run',
      cancelable: true,
      filesProcessed: 0,
      totalFiles,
    });
  }

  openLibrary.connection
    .prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'delete-linked-source', 'applying', ?, NULL, ?, ?)`,
    )
    .run(journalOperationId, JSON.stringify(manifest), now, now);

  // 恢复日志按批落盘：旧实现每个文件写两次 manifest_json（1.5 万文件 ≈ 3 万次
  // SQLite 写）。删除本身是原子的（文件要么在、要么不在），所以最多 25 个文件的
  // 进度滞后不会破坏恢复语义——重放时已消失的文件按「已删除」处理即可。
  const JOURNAL_CHECKPOINT_EVERY = 25;
  const writeJournal = (force = false): void => {
    if (!force && filesProcessed % JOURNAL_CHECKPOINT_EVERY !== 0) return;
    openLibrary.connection
      .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
      .run(JSON.stringify(manifest), new Date().toISOString(), journalOperationId);
  };

  for (const row of orderedRows) {
    let sourcePath: string | undefined;
    let deleteAttempted = false;
    try {
      manifest.inFlightAssetId = row.asset_id;
      sourcePath = this.linkedAssetPath(
        openLibrary,
        row.linked_folder_id,
        row.relative_file_path,
      );
      const sourceEntry = lstatSync(sourcePath);
      if (sourceEntry.isSymbolicLink() || !sourceEntry.isFile()) {
        throw new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      deleteAttempted = true;
      await removeSourceFile(sourcePath);
      if (existsSync(sourcePath)) {
        throw new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
          reason: 'SOURCE_TRASH_FAILED',
        });
      }
      manifest.trashedAssetIds.push(row.asset_id);
      manifest.inFlightAssetId = null;
      filesProcessed += 1;
      writeJournal();
      emitRun();
    } catch (error) {
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
        .get(row.linked_folder_id) as {
          absolute_root_path: string;
          status: 'available' | 'offline';
        } | undefined;
      const linkedRootOnline = linkedFolder?.status === 'available' &&
        !this.linkedRootIsGone(linkedFolder.absolute_root_path);
      const sourceMissing = sourcePath !== undefined && isMissingPathError(error);
      if (sourceMissing && linkedRootOnline) {
        // A missing linked source has already been removed outside Keel;
        // there is nothing left to send to the system trash. The index row
        // is still safe to remove because the linked root itself is online,
        // so this is not an offline/uncertain-source case.
        manifest.trashedAssetIds.push(row.asset_id);
        manifest.inFlightAssetId = null;
        filesProcessed += 1;
        writeJournal(true);
        emitRun();
        trashedRows.push(row);
        continue;
      }
      const sourceGoneAfterDelete = deleteAttempted && sourcePath !== undefined && !existsSync(sourcePath);
      const sourceWasDeleted = manifest.trashedAssetIds.includes(row.asset_id) ||
        (sourceGoneAfterDelete && linkedRootOnline);
      const sourceStateUncertain = sourceGoneAfterDelete && !linkedRootOnline;
      if (sourceWasDeleted && !manifest.trashedAssetIds.includes(row.asset_id)) {
        manifest.trashedAssetIds.push(row.asset_id);
      }
      manifest.inFlightAssetId = sourceStateUncertain ? row.asset_id : null;
      filesProcessed += 1;
      try {
        writeJournal(true);
      } catch {
        // The applying journal remains authoritative. Recovery only infers a
        // deleted in-flight item while its linked root is confirmed online.
      }
      emitRun();
      if (sourceWasDeleted || sourceStateUncertain) {
        const failure = new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
          cause: error,
          reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
        });
        this.diagnose('asset.delete-linked.persist-delete-progress', failure, {
          operationId: progressOperationId,
          libraryId: input.libraryId,
          assetId: row.asset_id,
        });
        throw failure;
      }
      const failure = error instanceof LibraryServiceError
        && error.code === 'ASSET_SOURCE_TRASH_FAILED'
        ? error
        : new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
            cause: error,
            reason: publicReasonFromError(error) ?? 'SOURCE_TRASH_FAILED',
          });
      const reason = failure.reason ?? 'SOURCE_TRASH_FAILED';
      failures.push({ assetId: row.asset_id, reason });
      this.diagnose('asset.delete-linked.delete-source', failure, {
        operationId: progressOperationId,
        libraryId: input.libraryId,
        assetId: row.asset_id,
      });
      continue;
    }
    trashedRows.push(row);
  }

  writeJournal(true);
  emitRun(true);

  try {
    openLibrary.connection.transaction(() => {
      this.dissolveImageSequencesForAssets(
        openLibrary,
        trashedRows.map((row) => row.asset_id),
      );
      for (const row of trashedRows) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(row.asset_id);
      }
      openLibrary.connection
        .prepare(
          `UPDATE file_operations
              SET status = 'committed', manifest_json = ?, error_code = NULL, updated_at = ?
            WHERE operation_id = ?`,
        )
        .run(JSON.stringify(manifest), new Date().toISOString(), journalOperationId);
    })();
  } catch (error) {
    const failure = new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
      cause: error,
      reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
    });
    this.diagnose('asset.delete-linked.delete-records', failure, {
      operationId: journalOperationId,
      libraryId: input.libraryId,
      sourceTrashedAssetIds: trashedRows.map((row) => row.asset_id),
    });
    throw failure;
  }

  const deletedAssetIds = trashedRows.map((row) => row.asset_id);

  if (input.progress !== undefined) {
    // 分批调用时由调用方负责最终 complete/failed 事件。
    input.progress.onProcessed(filesProcessed);
  } else {
    this.emitDeleteProgress({
      operationId: progressOperationId,
      libraryId: input.libraryId,
      kind: 'disk',
      phase: failures.length > 0 ? 'failed' : 'complete',
      filesProcessed: deletedAssetIds.length,
      totalFiles,
    });
  }

  if (failures.length > 0) {
    this.diagnose(
      'asset.delete-linked.partial-failure',
      new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
        reason: failures[0]!.reason,
      }),
      {
        operationId: journalOperationId,
        libraryId: input.libraryId,
        succeededAssetIds: deletedAssetIds,
        failedAssetIds: failures.map(({ assetId }) => assetId),
      },
    );
  }

  return {
    deletedCount: deletedAssetIds.length,
    failedCount: failures.length,
    failures,
  };
}

export function relinkAsset(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    newAbsolutePath: string;
  }): { asset: AssetSummary; batchFollowUpRoot: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  // Validate asset is missing and not trashed
  const assetRow = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, managed_folder_id, linked_folder_id,
              relative_file_path, current_revision_id, availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      managed_folder_id: string | null;
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (assetRow.deleted_at !== null) throw new LibraryServiceError('ASSET_ALREADY_TRASHED');
  if (assetRow.availability !== 'missing') throw new LibraryServiceError('INVALID_STATE_TRANSITION');

  const batchFollowUpRoot = inferRelinkBatchRoot(
    assetRow.relative_file_path,
    input.newAbsolutePath,
  );

  // Validate new file
  let newPath: string;
  try {
    newPath = normalizeAbsolutePath(input.newAbsolutePath);
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  if (!realFileExists(newPath)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'UNSUPPORTED_FILE_ENTRY',
    });
  }

  // Reject if in managed space
  this.assertNotInManagedSpace(openLibrary, newPath);
  this.assertNoSymlinkEscape(newPath);

  let managedPlacement:
    | {
        destinationPath: string;
        operationPath: string;
        placedIdentity: ManagedRelinkPlacementIdentity;
        stat: Stats;
      }
    | undefined;
  let fileStat: Stats;
  try {
    fileStat = assetRow.location_kind === 'managed'
      ? (managedPlacement = this.placeManagedRelinkFile(
          openLibrary,
          newPath,
          assetRow.relative_file_path,
        )).stat
      : statSync(newPath);
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  const now = new Date().toISOString();
  let resolvedRelativePath = assetRow.relative_file_path;

  // For linked assets, verify the file is within the linked root
  if (assetRow.location_kind === 'linked') {
    if (!assetRow.linked_folder_id) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const linkedFolder = openLibrary.connection
      .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
      .get(assetRow.linked_folder_id) as { absolute_root_path: string } | undefined;
    if (!linkedFolder) throw new LibraryServiceError('LIBRARY_CORRUPT');
    let canonicalRoot: string;
    let canonicalNew: string;
    try {
      canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
      canonicalNew = realpathSync(newPath);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        cause: error,
        reason: 'SOURCE_NOT_FOUND',
      });
    }
    const relation = path.relative(canonicalRoot, canonicalNew);
    if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'NAME_NOT_SUPPORTED',
      });
    }
    resolvedRelativePath = normalizeRelativeAssetPath(relation.split(path.sep).join('/'));
  }
  const originalFilename = path.posix.basename(resolvedRelativePath);
  let contentFingerprint: string;
  try {
    contentFingerprint = this.computeContentFingerprint(
      managedPlacement?.destinationPath ?? newPath,
    );
  } catch (error) {
    if (managedPlacement) this.cleanupManagedRelinkPlacement(managedPlacement, true);
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  try {
    openLibrary.connection.transaction(() => {
      this.failAt('crash-relink-after-filesystem');
      const revisionId = randomUUID();
      openLibrary.connection
        .prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at, content_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, 'relink', ?, ?)`,
        )
        .run(
          revisionId,
          input.assetId,
          assetRow.current_revision_id ?? null,
          fileStat.size,
          fileStat.mtime.toISOString(),
          originalFilename,
          now,
          contentFingerprint,
        );

      openLibrary.connection
        .prepare(
          `UPDATE assets
              SET current_revision_id = ?, availability = 'available',
                  relative_file_path = ?, path_identity = ?, source_device = ?,
                  source_inode = ?, updated_at = ?
            WHERE asset_id = ?`,
        )
        .run(
          revisionId,
          resolvedRelativePath,
          portablePathIdentity(resolvedRelativePath),
          assetRow.location_kind === 'linked' ? String(fileStat.dev) : null,
          assetRow.location_kind === 'linked' ? String(fileStat.ino) : null,
          now,
          input.assetId,
        );

      if (assetRow.current_revision_id) {
        openLibrary.connection
          .prepare(
            `UPDATE revision_artifacts
                SET invalidated_at = ?
              WHERE revision_id = ? AND invalidated_at IS NULL`,
          )
          .run(now, assetRow.current_revision_id);
      }
      if (!this.isExplicitlyIgnored(
        openLibrary,
        assetRow.location_kind,
        assetRow.linked_folder_id,
        resolvedRelativePath,
        'asset',
      )) openLibrary.connection
        .prepare(
          `INSERT OR IGNORE INTO jobs
             (job_id, library_id, asset_id, revision_id, kind, status, priority,
              progress, attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
        )
        .run(randomUUID(), input.libraryId, input.assetId, revisionId, now, now);

      this.syncAssetSearchContent(openLibrary.connection, input.assetId);
      this.failAt('crash-relink-before-db-commit');
    })();
    this.failAt('crash-relink-after-db-commit');
  } catch (error) {
    if (managedPlacement && !(error instanceof SimulatedCrashError)) {
      this.cleanupManagedRelinkPlacement(managedPlacement, true);
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  if (managedPlacement) this.cleanupManagedRelinkPlacement(managedPlacement, false);

  // Fetch the updated asset
  const updated = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
              a.current_revision_id, a.availability, r.byte_size, r.modified_at,
              COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
              a.deleted_at, a.trashed_from_relative_path
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        WHERE a.asset_id = ?`,
    )
    .get(input.assetId) as AssetSummaryRow & {
      deleted_at: string | null;
      trashed_from_relative_path: string | null;
    } | undefined;
  if (!updated) throw new LibraryServiceError('ASSET_NOT_FOUND');

  this.emitClientAssetsChanged(input.libraryId, 1, true);
  return { asset: this.assetSummaryFromRow(updated), batchFollowUpRoot };
}

export function batchRelinkRows(this: LibraryService, openLibrary: OpenLibrary): BatchRelinkAssetRow[] {
  return openLibrary.connection
    .prepare(
      `SELECT assets.asset_id, assets.location_kind, assets.linked_folder_id,
              assets.managed_folder_id, assets.relative_file_path,
              assets.current_revision_id, r.content_fingerprint
         FROM assets
         LEFT JOIN revisions r ON r.revision_id = assets.current_revision_id
        WHERE assets.availability = 'missing' AND assets.deleted_at IS NULL
        ORDER BY assets.relative_file_path`,
    )
    .all() as BatchRelinkAssetRow[];
}

/**
* Index a user-selected recovery root by basename. This is deliberately
* built only for an explicit relink preview, never during library refresh,
* so a large library does not pay a recursive scan on open/import.
* Symlinked files and directories are ignored: recovery must not escape the
* selected root or bind one physical file through an alias.
*/
export function indexRelinkCandidates(this: LibraryService, newRoot: string): Map<string, string[]> {
  const candidates = new Map<string, string[]>();
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const candidatePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(candidatePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = lstatSync(candidatePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const canonicalPath = realpathSync(candidatePath);
        const name = path.basename(candidatePath).normalize('NFC');
        const existing = candidates.get(name) ?? [];
        if (!existing.includes(canonicalPath)) existing.push(canonicalPath);
        candidates.set(name, existing);
      } catch {
        // A file can disappear or become unreadable while the chooser is
        // open; leave it unmatched and let the next preview retry.
      }
    }
  };
  visit(newRoot);
  return candidates;
}

export function batchRelinkMatches(this: LibraryService, openLibrary: OpenLibrary, newRoot: string, rows: BatchRelinkAssetRow[]): Map<string, BatchRelinkMatch> {
  const proposed = new Map<string, BatchRelinkMatch & { candidateIdentity: string }>();
  const candidateUseCount = new Map<string, number>();
  let indexedCandidates: Map<string, string[]> | undefined;
  const fingerprintCache = new Map<string, string | null>();
  const fingerprintFor = (candidatePath: string): string | null => {
    if (fingerprintCache.has(candidatePath)) return fingerprintCache.get(candidatePath) ?? null;
    try {
      const fingerprint = this.computeContentFingerprint(candidatePath);
      fingerprintCache.set(candidatePath, fingerprint);
      return fingerprint;
    } catch {
      fingerprintCache.set(candidatePath, null);
      return null;
    }
  };

  for (const asset of rows) {
    const segments = asset.relative_file_path.split('/');
    let matchedPath: string | undefined;
    for (let n = Math.min(segments.length, 5); n >= 1; n -= 1) {
      const candidatePath = path.join(newRoot, ...segments.slice(-n));
      try {
        const entry = lstatSync(candidatePath);
        if (entry.isFile() && !entry.isSymbolicLink()) {
          matchedPath = realpathSync(candidatePath);
          break;
        }
      } catch {
        // Continue trying a shorter suffix.
      }
    }
    if (!matchedPath) {
      indexedCandidates ??= this.indexRelinkCandidates(newRoot);
      const basename = path.posix.basename(asset.relative_file_path).normalize('NFC');
      const sameNameCandidates = indexedCandidates.get(basename) ?? [];
      if (sameNameCandidates.length === 1) {
        // A unique same-name candidate is recoverable even when the folder
        // hierarchy changed. If there are several, use the stored content
        // fingerprint as the tie-breaker instead of guessing.
        matchedPath = sameNameCandidates[0];
      } else if (sameNameCandidates.length > 1 && asset.content_fingerprint) {
        const fingerprintMatches = sameNameCandidates.filter(
          (candidate) => fingerprintFor(candidate) === asset.content_fingerprint,
        );
        if (fingerprintMatches.length === 1) matchedPath = fingerprintMatches[0];
      }
    }
    if (!matchedPath) continue;

    let resolvedRelativePath = asset.relative_file_path;
    if (asset.location_kind === 'linked') {
      if (!asset.linked_folder_id) continue;
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
        .get(asset.linked_folder_id) as { absolute_root_path: string } | undefined;
      if (!linkedFolder) continue;
      try {
        const canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
        const relation = path.relative(canonicalRoot, matchedPath);
        if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
          continue;
        }
        resolvedRelativePath = normalizeRelativeAssetPath(relation.split(path.sep).join('/'));
      } catch {
        continue;
      }
      const identityConflict = openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE linked_folder_id = ? AND path_identity = ?
              AND deleted_at IS NULL AND asset_id != ?`,
        )
        .get(
          asset.linked_folder_id,
          portablePathIdentity(resolvedRelativePath),
          asset.asset_id,
        );
      if (identityConflict) continue;
    }

    const candidateIdentity = matchedPath.normalize('NFC');
    proposed.set(asset.asset_id, { matchedPath, resolvedRelativePath, candidateIdentity });
    candidateUseCount.set(candidateIdentity, (candidateUseCount.get(candidateIdentity) ?? 0) + 1);
  }

  const matches = new Map<string, BatchRelinkMatch>();
  for (const [assetId, match] of proposed) {
    // One physical candidate must never be rebound to multiple asset
    // identities merely because their final basenames are equal.
    if (candidateUseCount.get(match.candidateIdentity) !== 1) continue;
    matches.set(assetId, {
      matchedPath: match.matchedPath,
      resolvedRelativePath: match.resolvedRelativePath,
    });
  }
  return matches;
}

export function relinkBatchApply(this: LibraryService, input: {
    libraryId: string;
    newRootPath: string;
    keepMetadata: boolean;
  }): { restoredCount: number; unchangedMissingCount: number; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  let newRoot: string;
  try {
    newRoot = normalizeAbsolutePath(input.newRootPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  if (!realDirectoryExists(newRoot)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
  }
  this.assertNoSymlinkEscape(newRoot);

  const rows = this.batchRelinkRows(openLibrary);
  const matches = this.batchRelinkMatches(openLibrary, newRoot, rows);

  const now = new Date().toISOString();
  const operationId = randomUUID();
  let restoredCount = 0;
  const restoredAssets: AssetSummary[] = [];
  const managedPlacements: Array<{
    destinationPath: string;
    operationPath: string;
    placedIdentity: ManagedRelinkPlacementIdentity;
    stat: Stats;
  }> = [];

  try {
    openLibrary.connection.transaction(() => {
      const manifest: OperationManifest = {
        version: 1,
        files: [],
        directories: [],
      };
      openLibrary.connection
        .prepare(
          `INSERT INTO file_operations
             (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
           VALUES (?, 'relink-batch', 'committed', ?, NULL, ?, ?)`,
        )
        .run(operationId, JSON.stringify(manifest), now, now);

      for (const asset of rows) {
        const match = matches.get(asset.asset_id);
        if (!match) continue;
        const { matchedPath, resolvedRelativePath } = match;

        let fileStat: Stats;
        let placedPath = matchedPath;
        if (asset.location_kind === 'managed') {
          const placement = this.placeManagedRelinkFile(
            openLibrary,
            matchedPath,
            asset.relative_file_path,
          );
          managedPlacements.push(placement);
          fileStat = placement.stat;
          placedPath = placement.destinationPath;
        } else {
          fileStat = statSync(matchedPath);
        }
        const contentFingerprint = this.computeContentFingerprint(placedPath);
        if (restoredCount === 0) this.failAt('crash-relink-batch-after-first-place');
        const revisionId = randomUUID();
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at, content_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, 'relink', ?, ?)`,
          )
          .run(
            revisionId,
            asset.asset_id,
            asset.current_revision_id ?? null,
            fileStat.size,
            fileStat.mtime.toISOString(),
            path.posix.basename(resolvedRelativePath),
            now,
            contentFingerprint,
          );

        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET current_revision_id = ?, availability = 'available',
                    relative_file_path = ?, path_identity = ?, updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            revisionId,
            resolvedRelativePath,
            portablePathIdentity(resolvedRelativePath),
            now,
            asset.asset_id,
          );

        if (asset.current_revision_id) {
          openLibrary.connection
            .prepare(
              `UPDATE revision_artifacts
                  SET invalidated_at = ?
                WHERE revision_id = ? AND invalidated_at IS NULL`,
            )
            .run(now, asset.current_revision_id);
        }
        if (!this.isExplicitlyIgnored(
          openLibrary,
          asset.location_kind,
          asset.linked_folder_id,
          resolvedRelativePath,
          'asset',
        )) openLibrary.connection
          .prepare(
            `INSERT OR IGNORE INTO jobs
               (job_id, library_id, asset_id, revision_id, kind, status, priority,
                progress, attempt_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
          )
          .run(randomUUID(), input.libraryId, asset.asset_id, revisionId, now, now);

        if (!input.keepMetadata) {
          // Clear human metadata
          openLibrary.connection
            .prepare(
              `UPDATE asset_metadata
                  SET description = NULL, rating = 0, favorite = 0,
                      palette = NULL, source_page_url = NULL, author = NULL,
                      entity_version = entity_version + 1, updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(now, asset.asset_id);
          openLibrary.connection
            .prepare('DELETE FROM human_asset_tags WHERE asset_id = ?')
            .run(asset.asset_id);
          openLibrary.connection
            .prepare('DELETE FROM collection_assets WHERE asset_id = ?')
            .run(asset.asset_id);
          openLibrary.connection
            .prepare('DELETE FROM ai_asset_tags WHERE asset_id = ?')
            .run(asset.asset_id);
          openLibrary.connection
            .prepare('DELETE FROM ai_content WHERE asset_id = ?')
            .run(asset.asset_id);
        }

        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        restoredCount += 1;
      }
      this.failAt('crash-relink-before-db-commit');
    })();
    this.failAt('crash-relink-after-db-commit');
  } catch (error) {
    if (!(error instanceof SimulatedCrashError)) {
      for (const placement of managedPlacements) {
        this.cleanupManagedRelinkPlacement(placement, true);
      }
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  for (const placement of managedPlacements) {
    this.cleanupManagedRelinkPlacement(placement, false);
  }

  // Fetch restored assets
  if (restoredCount > 0) {
    const restoredAssetIds = rows
      .filter((r) => {
        // Re-check which ones succeeded (transaction committed)
        const updated = openLibrary.connection
          .prepare(
            "SELECT asset_id FROM assets WHERE asset_id = ? AND availability = 'available'",
          )
          .get(r.asset_id);
        return !!updated;
      })
      .map((r) => r.asset_id);

    for (const assetId of restoredAssetIds) {
      const updated = openLibrary.connection
        .prepare(
          `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                  a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                  COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                  a.deleted_at, a.trashed_from_relative_path
             FROM assets a
             JOIN revisions r ON r.revision_id = a.current_revision_id
             LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
            WHERE a.asset_id = ?`,
        )
        .get(assetId) as AssetSummaryRow & {
          deleted_at: string | null;
          trashed_from_relative_path: string | null;
        } | undefined;
      if (updated) {
        restoredAssets.push(this.assetSummaryFromRow(updated));
      }
    }
  }

  const unchangedMissingCount =
    rows.filter((r) => {
      const still = openLibrary.connection
        .prepare(
          "SELECT asset_id FROM assets WHERE asset_id = ? AND availability = 'missing'",
        )
        .get(r.asset_id);
      return !!still;
    }).length;

  if (restoredCount > 0) {
    const refreshed = this.refreshManagedAssets(input.libraryId, { includeAssets: true });
    const restoredIds = new Set(
      rows.filter((row) => matches.has(row.asset_id)).map((row) => row.asset_id),
    );
    restoredAssets.length = 0;
    for (const asset of refreshed.assets ?? []) {
      if (restoredIds.has(asset.assetId)) {
        restoredAssets.push(asset);
      }
    }
  }

  if (restoredCount > 0) this.emitClientAssetsChanged(input.libraryId, restoredCount, true);
  return { restoredCount, unchangedMissingCount, assets: restoredAssets };
}

export function restoreDatabaseBackup(this: LibraryService, libraryPath: string, backupPath: string): void {
  const keelPath = libraryMetaDir(libraryPath);
  const quarantinePath = path.join(
    keelPath,
    'corrupt-backup',
    `library.db.primary-${Date.now()}-${randomUUID()}.db`,
  );
  const primaryPath = databasePath(libraryPath);
  const restoreStagePath = path.join(
    keelPath,
    `.library.db.restore-${randomUUID()}.tmp`,
  );
  mkdirSync(path.dirname(quarantinePath), { recursive: true });
  try {
    if (existsSync(primaryPath)) {
      renameSync(primaryPath, quarantinePath);
    }
    rmSync(`${primaryPath}-wal`, { force: true });
    rmSync(`${primaryPath}-shm`, { force: true });
    copyFileSync(backupPath, restoreStagePath);
    renameSync(restoreStagePath, primaryPath);
  } catch (error) {
    try { rmSync(restoreStagePath, { force: true }); } catch { /* best effort */ }
    if (!existsSync(primaryPath) && existsSync(quarantinePath)) {
      try { renameSync(quarantinePath, primaryPath); } catch { /* best effort */ }
    }
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
}

export function emitDeleteProgress(this: LibraryService, event: Omit<DeleteProgressEvent, 'type'>): void {
  this.emitProgress({ type: 'delete.progress', ...event });
}

export function cancelDiskDelete(this: LibraryService, operationId: string): void {
  const state = this.activeDiskDeletes.get(operationId);
  if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
  state.cancelled = true;
  state.onCancel?.();
}

/**
* Serpent-9i8: close the open library, then permanently delete its root
* directory (Assets / metadata directory / managed content). Linked-folder *source*
* trees live outside the library root and are not touched.
*
* Serpent-dfgg: Windows cannot rm a tree while Chromium/ffmpeg/fs.watch still
* hold children. Callers must drainLibraryMedia first; this method then
* retries and will rename the root aside if a lingering lock remains.
*/
export function deleteLibraryFromDisk(this: LibraryService, libraryId: string): {
    libraryId: string;
    displayName: string;
    libraryPath: string;
    pendingAsidePath: string | null;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const { libraryPath, displayName } = openLibrary.summary;

  for (const directoryName of requiredDirectories(libraryPath)) {
    if (!realDirectoryExists(path.join(libraryPath, directoryName))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }
  }
  if (
    !realDirectoryExists(libraryMetaDir(libraryPath)) ||
    !realFileExists(databasePath(libraryPath))
  ) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }

  this.closeLibrary(libraryId);

  let pendingAsidePath: string | null;
  try {
    pendingAsidePath = removeLibraryRootWithRetry(libraryPath).asidePath;
  } catch (error) {
    this.diagnose('library.delete-from-disk', error, { libraryPath });
    // Serpent-qgm1: the library was closed before rm — if the deletion
    // fails the user must not be left with a half-open state. Reopen so the
    // library stays fully usable and the renderer can keep browsing.
    try {
      this.openLibrary(libraryPath);
    } catch (reopenError) {
      this.diagnose('library.reopen-after-delete-failure', reopenError, {
        libraryPath,
      });
      throw new LibraryServiceError('LIBRARY_NOT_FOUND', {
        cause: error,
      });
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
      reason: publicReasonFromError(error),
      cause: error,
    });
  }

  if (existsSync(libraryPath)) {
    try {
      this.openLibrary(libraryPath);
    } catch (reopenError) {
      this.diagnose('library.reopen-after-delete-failure', reopenError, {
        libraryPath,
      });
      throw new LibraryServiceError('LIBRARY_NOT_FOUND', {
        cause: reopenError,
      });
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
      reason: 'IO_ERROR',
    });
  }

  return { libraryId, displayName, libraryPath, pendingAsidePath };
}

/**
* Serpent-65d837: remove library roots that were renamed aside (`.del-*`)
* after a previous deletion could not fully remove them while a Windows
* handle was still open. Idempotent — missing paths are harmless because
* `removePathWithSyncRetry` uses `rmSync(..., { force: true })`. Returns the
* paths that were removed and the ones that still fail (caller re-queues).
*/
export function cleanupPendingDeletions(this: LibraryService, asidePaths: string[]): {
    cleanedPaths: string[];
    remainingPaths: string[];
  } {
  const cleanedPaths: string[] = [];
  const remainingPaths: string[] = [];
  for (const asidePath of asidePaths) {
    // Only ever touch paths owned by this feature: the suffix is generated
    // by removeLibraryRootWithRetry and must stay inside a library root.
    if (typeof asidePath !== 'string' || !asidePath.includes('.del-')) {
      remainingPaths.push(asidePath);
      continue;
    }
    try {
      removePathWithSyncRetry(asidePath);
      cleanedPaths.push(asidePath);
    } catch (error) {
      this.diagnose('library.cleanup-pending-deletions', error, { asidePath });
      remainingPaths.push(asidePath);
    }
  }
  return { cleanedPaths, remainingPaths };
}
