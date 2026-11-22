import { type AssetSummary, type FilterClause, type FolderBrowseEntry, type ManagedFolderSummary } from "../../shared/asset-types";
import { sanitizeEntityAppearance } from "../../shared/entity-appearance";
import { rollupDirectFolderCounts } from "../../shared/filtered-folder-counts";
import { isLibraryMetaDirName, libraryMetaDir } from "../../shared/library-meta-dir";
import { FOLDER_NAVIGATION_COVER_CAP, type LibraryNavigationSummary } from "../../shared/library-navigation";
import { isLibraryRootFolderId } from "../../shared/library-root-folder";
import { type LibraryStorageLayout } from "../../shared/library-storage-layout";
import { collectLinkedDirectoryPrefixes, directChildLinkedDirectories, encodeLinkedVirtualFolderId, linkedDirectoryName, parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { publicReasonFromError } from "../../shared/protocol/errors";
import { type InternalLibrarySummary } from "../../shared/protocol/responses";
import { LibraryServiceError, REGENERABLE_DIRECTORIES, SimulatedCrashError, UUID, closeIgnoringFailure, databasePath, directoryExists, isMissingPathError, isUnreadablePathError, migrateDatabase, openConfiguredDatabase, realDirectoryExists, realFileExists, removePathWithRetry, serviceError, sha256FileAtPath, singleDisplayArtifactJoin, type AssetRefreshResult, type ContentReplaceBatchOperationManifest, type DatabaseConnection, type DiscoveredSourceEntry, type LibraryService, type ManagedCopyOperationManifest, type ManagedFolderHistorySnapshot, type ManagedFolderRow, type ManagedMoveConflict, type ManagedMoveOperationManifest, type OpenLibrary, type OpenReconciliationTask, type OperationRow, type RefreshManagedAssetsDiscovery, verifyDatabase } from "../library-service";
import { buildCatalogAssetVisibilityPredicates } from "./catalog-read";
import { renamedCompanionName } from "./companion-files";
import { commitReplacingFolderCoverFiles, folderCoverAbsolutePath, folderCoverMimeType, folderCoverStoredExtension, installFolderCoverFile, listStaleFolderCoverFiles, removeFolderCoverFile } from "./folder-custom-cover";
import { columnsFor, hasTable } from "./lenient-columns";
import { LibraryInputError, isPortablePathEqualOrDescendant, normalizeAbsolutePath, normalizeAssetFileBaseName, normalizeFolderName, normalizeRelativeAssetPath, portablePathIdentity, portablePathSegmentIdentity } from "./library-rules";
import { managedStoragePath, writeStorageLayout } from "./library-storage-layout";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, type LibraryJobLease, type LibraryWriteLeaseHeartbeat } from "./library-write-coordinator";
import { type HistoryOperationReceipt, type HistorySource } from "./operation-history";
import { sqliteAllInChunks, withSqliteInPredicate } from "./sqlite-in";
import { removePathWithSyncRetry } from "./windows-fs-retry";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, utimesSync } from "node:fs";
import { lstat as lstatAsync } from "node:fs/promises";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface FolderMethods {
  removeOperation(...args: Parameters<typeof removeOperation>): ReturnType<typeof removeOperation>;
  moveConflictHoldingPath(...args: Parameters<typeof moveConflictHoldingPath>): ReturnType<typeof moveConflictHoldingPath>;
  recoverManagedMoveOperation(...args: Parameters<typeof recoverManagedMoveOperation>): ReturnType<typeof recoverManagedMoveOperation>;
  recoverManagedCopyOperation(...args: Parameters<typeof recoverManagedCopyOperation>): ReturnType<typeof recoverManagedCopyOperation>;
  recoverContentReplaceBatchOperation(...args: Parameters<typeof recoverContentReplaceBatchOperation>): ReturnType<typeof recoverContentReplaceBatchOperation>;
  recoverFileOperations(...args: Parameters<typeof recoverFileOperations>): ReturnType<typeof recoverFileOperations>;
  getManagedFolderHistorySnapshot(...args: Parameters<typeof getManagedFolderHistorySnapshot>): ReturnType<typeof getManagedFolderHistorySnapshot>;
  assertManagedFolderHistorySnapshots(...args: Parameters<typeof assertManagedFolderHistorySnapshots>): ReturnType<typeof assertManagedFolderHistorySnapshots>;
  applyManagedFolderCreateHistorySnapshot(...args: Parameters<typeof applyManagedFolderCreateHistorySnapshot>): ReturnType<typeof applyManagedFolderCreateHistorySnapshot>;
  recordManagedFolderSnapshotHistory(...args: Parameters<typeof recordManagedFolderSnapshotHistory>): ReturnType<typeof recordManagedFolderSnapshotHistory>;
  folderPath(...args: Parameters<typeof folderPath>): ReturnType<typeof folderPath>;
  folderPathAsync(...args: Parameters<typeof folderPathAsync>): ReturnType<typeof folderPathAsync>;
  targetFolder(...args: Parameters<typeof targetFolder>): ReturnType<typeof targetFolder>;
  createManagedFolder(...args: Parameters<typeof createManagedFolder>): ReturnType<typeof createManagedFolder>;
  renameManagedFolder(...args: Parameters<typeof renameManagedFolder>): ReturnType<typeof renameManagedFolder>;
  cloneManagedFolder(...args: Parameters<typeof cloneManagedFolder>): ReturnType<typeof cloneManagedFolder>;
  moveManagedFolders(...args: Parameters<typeof moveManagedFolders>): ReturnType<typeof moveManagedFolders>;
  availableSiblingFolderName(...args: Parameters<typeof availableSiblingFolderName>): ReturnType<typeof availableSiblingFolderName>;
  collectManagedFolderSubtree(...args: Parameters<typeof collectManagedFolderSubtree>): ReturnType<typeof collectManagedFolderSubtree>;
  removeManagedFolderRowsAndDirectory(...args: Parameters<typeof removeManagedFolderRowsAndDirectory>): ReturnType<typeof removeManagedFolderRowsAndDirectory>;
  removeManagedFolderRowsAndDirectoryAsync(...args: Parameters<typeof removeManagedFolderRowsAndDirectoryAsync>): ReturnType<typeof removeManagedFolderRowsAndDirectoryAsync>;
  listManagedFolders(...args: Parameters<typeof listManagedFolders>): ReturnType<typeof listManagedFolders>;
  setFolderCustomCovers(...args: Parameters<typeof setFolderCustomCovers>): ReturnType<typeof setFolderCustomCovers>;
  setFolderCustomCoverFromAsset(...args: Parameters<typeof setFolderCustomCoverFromAsset>): ReturnType<typeof setFolderCustomCoverFromAsset>;
  clearFolderCustomCovers(...args: Parameters<typeof clearFolderCustomCovers>): ReturnType<typeof clearFolderCustomCovers>;
  resolveFolderCustomCover(...args: Parameters<typeof resolveFolderCustomCover>): ReturnType<typeof resolveFolderCustomCover>;
  assertFolderCoverTarget(...args: Parameters<typeof assertFolderCoverTarget>): ReturnType<typeof assertFolderCoverTarget>;
  scheduleOrphanFolderCoverSweep(...args: Parameters<typeof scheduleOrphanFolderCoverSweep>): ReturnType<typeof scheduleOrphanFolderCoverSweep>;
  sweepOrphanFolderCovers(...args: Parameters<typeof sweepOrphanFolderCovers>): ReturnType<typeof sweepOrphanFolderCovers>;
  folderCoverIndexCacheKey(...args: Parameters<typeof folderCoverIndexCacheKey>): ReturnType<typeof folderCoverIndexCacheKey>;
  folderCustomCoverRows(...args: Parameters<typeof folderCustomCoverRows>): ReturnType<typeof folderCustomCoverRows>;
  coverIndexFromRows(...args: Parameters<typeof coverIndexFromRows>): ReturnType<typeof coverIndexFromRows>;
  loadFolderCustomCoverIndex(...args: Parameters<typeof loadFolderCustomCoverIndex>): ReturnType<typeof loadFolderCustomCoverIndex>;
  listFolderNavigationCovers(...args: Parameters<typeof listFolderNavigationCovers>): ReturnType<typeof listFolderNavigationCovers>;
  withCustomFolderCovers(...args: Parameters<typeof withCustomFolderCovers>): ReturnType<typeof withCustomFolderCovers>;
  folderIndexedByteSizes(...args: Parameters<typeof folderIndexedByteSizes>): ReturnType<typeof folderIndexedByteSizes>;
  managedFolderIndexedByteTotals(...args: Parameters<typeof managedFolderIndexedByteTotals>): ReturnType<typeof managedFolderIndexedByteTotals>;
  filteredFolderCounts(...args: Parameters<typeof filteredFolderCounts>): ReturnType<typeof filteredFolderCounts>;
  listFolderBrowseEntriesAsync(...args: Parameters<typeof listFolderBrowseEntriesAsync>): ReturnType<typeof listFolderBrowseEntriesAsync>;
  folderEntriesByRefsAsync(...args: Parameters<typeof folderEntriesByRefsAsync>): ReturnType<typeof folderEntriesByRefsAsync>;
  listFolderBrowseEntries(...args: Parameters<typeof listFolderBrowseEntries>): ReturnType<typeof listFolderBrowseEntries>;
  folderEntriesByRefs(...args: Parameters<typeof folderEntriesByRefs>): ReturnType<typeof folderEntriesByRefs>;
  managedFolderRecursiveAssetCounts(...args: Parameters<typeof managedFolderRecursiveAssetCounts>): ReturnType<typeof managedFolderRecursiveAssetCounts>;
  managedFolderCountMaps(...args: Parameters<typeof managedFolderCountMaps>): ReturnType<typeof managedFolderCountMaps>;
  populateChildFolderCovers(...args: Parameters<typeof populateChildFolderCovers>): ReturnType<typeof populateChildFolderCovers>;
  folderCoverCandidateAssetMap(...args: Parameters<typeof folderCoverCandidateAssetMap>): ReturnType<typeof folderCoverCandidateAssetMap>;
  populateChildFolderCandidateAssets(...args: Parameters<typeof populateChildFolderCandidateAssets>): ReturnType<typeof populateChildFolderCandidateAssets>;
  summarizeManagedFolderRow(...args: Parameters<typeof summarizeManagedFolderRow>): ReturnType<typeof summarizeManagedFolderRow>;
  summarizeManagedFolderRowRecursive(...args: Parameters<typeof summarizeManagedFolderRowRecursive>): ReturnType<typeof summarizeManagedFolderRowRecursive>;
  getAssetManagedFolderId(...args: Parameters<typeof getAssetManagedFolderId>): ReturnType<typeof getAssetManagedFolderId>;
  resolveFolderPath(...args: Parameters<typeof resolveFolderPath>): ReturnType<typeof resolveFolderPath>;
  ensureManagedFolderIdForRelativeDir(...args: Parameters<typeof ensureManagedFolderIdForRelativeDir>): ReturnType<typeof ensureManagedFolderIdForRelativeDir>;
  knownRecoveryFilePath(...args: Parameters<typeof knownRecoveryFilePath>): ReturnType<typeof knownRecoveryFilePath>;
  managedMoveSummaries(...args: Parameters<typeof managedMoveSummaries>): ReturnType<typeof managedMoveSummaries>;
  applyManagedMoveOperation(...args: Parameters<typeof applyManagedMoveOperation>): ReturnType<typeof applyManagedMoveOperation>;
  managedMoveConflict(...args: Parameters<typeof managedMoveConflict>): ReturnType<typeof managedMoveConflict>;
  availableMoveDestination(...args: Parameters<typeof availableMoveDestination>): ReturnType<typeof availableMoveDestination>;
  moveAssets(...args: Parameters<typeof moveAssets>): ReturnType<typeof moveAssets>;
  undoMoveAssets(...args: Parameters<typeof undoMoveAssets>): ReturnType<typeof undoMoveAssets>;
  renameAssetFile(...args: Parameters<typeof renameAssetFile>): ReturnType<typeof renameAssetFile>;
  renameAssetFiles(...args: Parameters<typeof renameAssetFiles>): ReturnType<typeof renameAssetFiles>;
  networkDiscoveryFingerprint(...args: Parameters<typeof networkDiscoveryFingerprint>): ReturnType<typeof networkDiscoveryFingerprint>;
  waitForStableWatcherDiscovery(...args: Parameters<typeof waitForStableWatcherDiscovery>): ReturnType<typeof waitForStableWatcherDiscovery>;
  collectManagedAssetDiscovery(...args: Parameters<typeof collectManagedAssetDiscovery>): ReturnType<typeof collectManagedAssetDiscovery>;
  collectManagedAssetDiscoveryAsync(...args: Parameters<typeof collectManagedAssetDiscoveryAsync>): ReturnType<typeof collectManagedAssetDiscoveryAsync>;
  applyDiscoveredAssetsInBatches(...args: Parameters<typeof applyDiscoveredAssetsInBatches>): ReturnType<typeof applyDiscoveredAssetsInBatches>;
  initializeExistingFolder(...args: Parameters<typeof initializeExistingFolder>): ReturnType<typeof initializeExistingFolder>;
  recoverOperationHistoryTransitions(...args: Parameters<typeof recoverOperationHistoryTransitions>): ReturnType<typeof recoverOperationHistoryTransitions>;
  isDatabaseRecoveryFailure(...args: Parameters<typeof isDatabaseRecoveryFailure>): ReturnType<typeof isDatabaseRecoveryFailure>;
  canAttemptDatabaseRecovery(...args: Parameters<typeof canAttemptDatabaseRecovery>): ReturnType<typeof canAttemptDatabaseRecovery>;
  attachRecoveryNotice(...args: Parameters<typeof attachRecoveryNotice>): ReturnType<typeof attachRecoveryNotice>;
  getRecoveryReportPath(...args: Parameters<typeof getRecoveryReportPath>): ReturnType<typeof getRecoveryReportPath>;
  renameLibrary(...args: Parameters<typeof renameLibrary>): ReturnType<typeof renameLibrary>;
  removeOwnedTransferPath(...args: Parameters<typeof removeOwnedTransferPath>): ReturnType<typeof removeOwnedTransferPath>;
}

export function removeOperation(this: LibraryService, operationPath: string): void {
  this.assertSafeOperationPath(operationPath);
  // Windows: a Defender scan of just-moved staged files (or any lingering
  // child handle) makes recursive rm throw EBUSY/EPERM/ENOTEMPTY for a
  // short moment; retry transient locks before reporting failure.
  removePathWithSyncRetry(operationPath);
  try {
    rmdirSync(path.dirname(operationPath));
  } catch {
    // A sibling operation may still exist; removing this operation is sufficient.
  }
}

export function moveConflictHoldingPath(this: LibraryService, openLibrary: OpenLibrary, conflict: ManagedMoveConflict): string {
  if (conflict.kind === 'managed') {
    if (!conflict.assetId || !conflict.trashFilename) throw new LibraryServiceError('LIBRARY_CORRUPT');
    return this.trashPath(openLibrary, conflict.assetId, conflict.trashFilename);
  }
  const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
  const operationPath = path.join(operationsRoot, conflict.operationId);
  this.assertSafeOperationPath(operationPath);
  return path.join(operationPath, 'backup', conflict.backupName);
}

export function recoverManagedMoveOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: ManagedMoveOperationManifest, operationPath: string): void {
  if (row.status === 'preparing') {
    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
    return;
  }

  for (const file of [...manifest.files].reverse()) {
    const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
    const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
    const sourceExists = realFileExists(sourcePath);
    const destinationExists = realFileExists(destinationPath);
    const restoreHoldingPath = file.restoreConflict
      ? this.moveConflictHoldingPath(openLibrary, file.restoreConflict)
      : null;
    const restoreHoldingExists = restoreHoldingPath ? realFileExists(restoreHoldingPath) : false;
    const assetWasMoved = destinationExists && (
      !sourceExists || (file.restoreConflict !== null && !restoreHoldingExists)
    );

    // A reverse/undo operation may have restored the asset that the original
    // replace displaced. Put it back in its durable holding location before
    // returning the moved asset to its source.
    if (assetWasMoved && file.restoreConflict) {
      const holdingPath = restoreHoldingPath!;
      if (realFileExists(sourcePath)) {
        if (realFileExists(holdingPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
        mkdirSync(path.dirname(holdingPath), { recursive: true });
        renameSync(sourcePath, holdingPath);
      }
    }

    if (assetWasMoved) {
      if (realFileExists(sourcePath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      renameSync(destinationPath, sourcePath);
    }

    if (file.destinationConflict && file.destinationConflict.sourceExists !== false) {
      const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
      if (realFileExists(holdingPath)) {
        if (realFileExists(destinationPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        renameSync(holdingPath, destinationPath);
      }
    }
  }

  this.removeOperation(operationPath);
  openLibrary.connection.prepare(
    "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
  ).run(new Date().toISOString(), row.operation_id);
}

export function recoverManagedCopyOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: ManagedCopyOperationManifest, operationPath: string): void {
  if (row.status === 'preparing') {
    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
    return;
  }

  // Incomplete copy: drop any destination files that were written before the
  // DB commit, then restore any replace-held conflict targets.
  for (const file of [...manifest.files].reverse()) {
    const newAsset = openLibrary.connection.prepare(
      'SELECT asset_id FROM assets WHERE asset_id = ?',
    ).get(file.newAssetId) as { asset_id: string } | undefined;
    if (newAsset) {
      openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(file.newAssetId);
    }
    const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
    if (realFileExists(destinationPath)) {
      rmSync(destinationPath, { force: true });
    }
    if (file.destinationConflict && file.destinationConflict.sourceExists !== false) {
      const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
      if (realFileExists(holdingPath) && !realFileExists(destinationPath)) {
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        renameSync(holdingPath, destinationPath);
      }
    }
  }

  this.removeOperation(operationPath);
  openLibrary.connection.prepare(
    "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
  ).run(new Date().toISOString(), row.operation_id);
}

export function recoverContentReplaceBatchOperation(this: LibraryService, openLibrary: OpenLibrary, row: OperationRow, manifest: ContentReplaceBatchOperationManifest, operationPath: string): void {
  if (row.status === 'preparing') {
    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
    return;
  }

  let recoveryPending = false;
  const restoreOriginalModifiedAt = (destinationPath: string, modifiedAt: string): void => {
    const timestamp = Date.parse(modifiedAt);
    if (!Number.isFinite(timestamp)) {
      recoveryPending = true;
      return;
    }
    try {
      const date = new Date(timestamp);
      utimesSync(destinationPath, date, date);
    } catch {
      recoveryPending = true;
    }
  };
  for (const file of [...manifest.files].reverse()) {
    let destinationPath: string;
    try {
      destinationPath = this.resolveAssetPath(openLibrary.summary.libraryId, file.assetId);
    } catch {
      destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
    }
    const backupPath = path.join(operationPath, 'backup', file.backupName);
    if (!realFileExists(backupPath)) continue;
    if (!realFileExists(destinationPath)) {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      renameSync(backupPath, destinationPath);
      restoreOriginalModifiedAt(destinationPath, file.originalModifiedAt);
      continue;
    }
    let destinationHash: string;
    try {
      destinationHash = sha256FileAtPath(destinationPath);
    } catch {
      recoveryPending = true;
      continue;
    }
    if (destinationHash !== file.sha256) {
      if (destinationHash === file.originalSha256) {
        rmSync(backupPath, { force: true });
        restoreOriginalModifiedAt(destinationPath, file.originalModifiedAt);
        continue;
      }
      // An external writer changed the destination after the interrupted
      // replace. Do not overwrite it during recovery; retain the journal so
      // the conflict is explainable and can be handled explicitly.
      recoveryPending = true;
      continue;
    }
    rmSync(destinationPath, { force: true });
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    renameSync(backupPath, destinationPath);
    restoreOriginalModifiedAt(destinationPath, file.originalModifiedAt);
  }
  if (recoveryPending) {
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'failed', error_code = 'CONTENT_REPLACE_RECOVERY_CONFLICT', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
    this.diagnose('asset.content-replace-batch.recovery-pending', new Error(
      'An interrupted batch encountered an external destination change.',
    ), {
      operationId: row.operation_id,
      libraryId: openLibrary.summary.libraryId,
    });
    return;
  }
  this.removeOperation(operationPath);
  openLibrary.connection.prepare(
    "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
  ).run(new Date().toISOString(), row.operation_id);
}

export function recoverFileOperations(this: LibraryService, openLibrary: OpenLibrary): void {
  const rows = openLibrary.connection
    .prepare(
      `SELECT operation_id, kind, status, manifest_json, error_code
         FROM file_operations
        ORDER BY created_at`,
    )
    .all() as OperationRow[];
  const operationsPath = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);

  const retainedOperationIds = new Set<string>();
  for (const row of rows) {
    if (!UUID.test(row.operation_id) || path.basename(row.operation_id) !== row.operation_id) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const operationPath = path.resolve(operationsPath, row.operation_id);
    const operationRelation = path.relative(operationsPath, operationPath);
    if (
      operationRelation === '' ||
      operationRelation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(operationRelation)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    if (row.status === 'committed') {
      const manifest = this.parseOperationManifest(row.manifest_json);
      if (
        ((manifest.version === 4 && manifest.kind === 'managed-move') ||
          (manifest.version === 5 && manifest.kind === 'managed-copy')) &&
        row.error_code !== 'UNDONE'
      ) {
        // The committed move/copy journal backs one-shot undo. Keep it until
        // an undo consumes it.
        retainedOperationIds.add(row.operation_id);
        continue;
      }
      this.removeOperation(operationPath);
      continue;
    }
    if (row.status === 'rolled_back') {
      this.removeOperation(operationPath);
      continue;
    }
    if (
      row.status === 'failed' &&
      row.error_code !== 'IMPORT_APPLY_FAILED' &&
      row.error_code !== 'RESTORE_APPLY_FAILED' &&
      row.error_code !== 'MOVE_APPLY_FAILED' &&
      row.error_code !== 'COPY_APPLY_FAILED' &&
      row.error_code !== 'CONTENT_REPLACE_APPLY_FAILED' &&
      row.error_code !== 'CONTENT_REPLACE_RECOVERY_CONFLICT' &&
      row.error_code !== 'FOLDER_TRASH_RECOVERY_REQUIRED'
    ) {
      this.removeOperation(operationPath);
      continue;
    }
    // Another Keel process is still applying under a live Job lease.
    // Do not roll back its filesystem or clear the operation directory.
    const JOB_LEASE_APPLYING_KINDS = new Set([
      'import',
      'managed-move',
      'managed-move-undo',
      'managed-copy',
      'restore',
      'content-replace-batch',
    ]);
    if (
      row.status === 'applying'
      && row.kind !== undefined
      && JOB_LEASE_APPLYING_KINDS.has(row.kind)
      && new LibraryWriteCoordinator(openLibrary.writeConnection, openLibrary.summary.libraryId)
        .hasLiveJobLease(row.operation_id)
    ) {
      retainedOperationIds.add(row.operation_id);
      continue;
    }
    this.assertSafeOperationPath(operationPath);
    const manifest = this.parseOperationManifest(row.manifest_json);
    if (manifest.version === 7) {
      this.recoverManagedFolderTrashOperation(openLibrary, row, manifest, operationPath);
      continue;
    }
    if (manifest.version === 2) {
      this.recoverLinkedTrashOperation(openLibrary, row, manifest);
      continue;
    }
    if (manifest.version === 3) {
      this.recoverRestoreOperation(openLibrary, row, manifest, operationPath);
      continue;
    }
    if (manifest.version === 4) {
      this.recoverManagedMoveOperation(openLibrary, row, manifest, operationPath);
      continue;
    }
    if (manifest.version === 5) {
      this.recoverManagedCopyOperation(openLibrary, row, manifest, operationPath);
      continue;
    }
    if (manifest.version === 6) {
      // A recovery conflict is intentionally retained across reopen. The
      // recovery helper may leave the operation directory in place so an
      // operator can resolve the external destination change explicitly;
      // do not let the generic orphan sweep erase that evidence later in
      // this same pass.
      if (row.status === 'failed' && row.error_code === 'CONTENT_REPLACE_RECOVERY_CONFLICT') {
        retainedOperationIds.add(row.operation_id);
      }
      this.recoverContentReplaceBatchOperation(openLibrary, row, manifest, operationPath);
      continue;
    }
    if (
      row.status === 'preparing' &&
      (manifest.phase === 'staging' || manifest.phase === 'prepared')
    ) {
      // Preparing never owns a destination: only staged copies are safe to remove.
      // A destination may have been created by another process after planning.
      this.removeOperation(operationPath);
      openLibrary.connection
        .prepare(
          "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
        )
        .run(new Date().toISOString(), row.operation_id);
      continue;
    }
    const findAppliedImportAsset =
      row.kind === 'import' && row.status === 'applying' && manifest.version === 1
        ? openLibrary.connection.prepare(
            `SELECT asset_id
               FROM assets
              WHERE location_kind = 'managed'
                AND path_identity = ?
                AND deleted_at IS NULL
              LIMIT 1`,
          )
        : undefined;
    let recoveredAppliedImportAsset = false;
    for (const file of [...manifest.files].reverse()) {
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      const backupPath = path.join(operationPath, 'backup', file.backupName);
      const stagedPath = path.join(operationPath, 'stage', file.stageName);
      let backupExists = false;
      try {
        const backup = lstatSync(backupPath);
        if (!backup.isFile() || backup.isSymbolicLink()) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        backupExists = true;
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (!isMissingPathError(error)) {
          throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
        }
      }
      if (backupExists) {
        this.failAt('recovery-restore');
        rmSync(destinationPath, { force: true, recursive: true });
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        renameSync(backupPath, destinationPath);
      } else if (
        findAppliedImportAsset?.get(portablePathIdentity(file.destinationRelativePath))
      ) {
        // The file was already registered before the process stopped. It is
        // durable application state, not an orphan left between rename and
        // INSERT; preserve it and let normal reconciliation repair a source
        // that is still missing on disk.
        recoveredAppliedImportAsset = true;
      } else if (!file.hadDestination && !existsSync(stagedPath) && existsSync(destinationPath)) {
        rmSync(destinationPath, { force: true, recursive: true });
      }
    }
    for (const directory of [...manifest.directories].reverse()) {
      if (directory.existed) continue;
      try {
        rmdirSync(this.folderPath(openLibrary, directory.relativePath));
      } catch {
        // A restored file or an external writer may still use the directory.
      }
    }
    this.removeOperation(operationPath);
    openLibrary.connection
      .prepare(
        `UPDATE file_operations
            SET status = ?, error_code = ?, updated_at = ?
          WHERE operation_id = ?`,
      )
      .run(
        recoveredAppliedImportAsset ? 'committed' : 'rolled_back',
        recoveredAppliedImportAsset
          ? 'PROCESS_INTERRUPTED_RECOVERED'
          : 'PROCESS_INTERRUPTED',
        new Date().toISOString(),
        row.operation_id,
      );
  }

  if (directoryExists(operationsPath)) {
    for (const child of readdirSync(operationsPath)) {
      if (retainedOperationIds.has(child)) continue;
      const orphanPath = path.join(operationsPath, child);
      if (child.startsWith('relink-')) {
        // Validate relink orphan paths separately — they use a relink-<uuid>
        // naming convention and carry a manifest.json, not stage/backup dirs.
        if (!UUID.test(child.slice('relink-'.length))) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        // Re-validate that the directory is a real directory (not a symlink)
        // directly under operations/ — same safety check as assertSafeOperationPath.
        try {
          const entry = lstatSync(orphanPath);
          if (!entry.isDirectory() || entry.isSymbolicLink()) {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
        } catch (error) {
          if (isMissingPathError(error)) continue;
          throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
        }
        const realRelation = path.relative(
          realpathSync(operationsPath),
          realpathSync(orphanPath),
        );
        if (realRelation !== path.basename(orphanPath)) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        if (this.recoverOrphanRelinkPlacement(openLibrary, orphanPath)) {
          continue;
        }
        rmSync(orphanPath, { force: true, recursive: true });
        continue;
      }
      this.assertSafeOperationPath(orphanPath);
      rmSync(orphanPath, { force: true, recursive: true });
    }
    try {
      rmdirSync(operationsPath);
    } catch {
      // A concurrent prepare may have created a new operation after the scan.
    }
  }
}

/** Stable folder rows used by create/delete and as preconditions for moves. */
export function getManagedFolderHistorySnapshot(this: LibraryService, input: {
    folderIds: readonly string[];
    libraryId: string;
    allowMissing?: boolean;
  }): ManagedFolderHistorySnapshot[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const roots = [...new Set(input.folderIds)];
  if (roots.length === 0) return [];
  const rows = openLibrary.connection
    .prepare(
      `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
         FROM managed_folders
        ORDER BY length(relative_path), relative_path`,
    )
    .all() as ManagedFolderRow[];
  const rootPaths = rows
    .filter((row) => roots.includes(row.folder_id))
    .map((row) => row.relative_path);
  if (rootPaths.length !== roots.length && !input.allowMissing) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  return rows
    .filter((row) => rootPaths.some((root) =>
      row.relative_path === root || row.relative_path.startsWith(`${root}/`)))
    .map((row) => ({
      folderId: row.folder_id,
      parentFolderId: row.parent_folder_id,
      name: row.name,
      relativePath: row.relative_path,
      pathIdentity: row.path_identity,
    }));
}

export function assertManagedFolderHistorySnapshots(this: LibraryService, value: unknown): ManagedFolderHistorySnapshot[] {
  if (!Array.isArray(value)) throw new LibraryServiceError('LIBRARY_CORRUPT');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const candidate = item as Partial<ManagedFolderHistorySnapshot>;
    if (
      typeof candidate.folderId !== 'string'
      || (candidate.parentFolderId !== null && typeof candidate.parentFolderId !== 'string')
      || typeof candidate.name !== 'string'
      || typeof candidate.relativePath !== 'string'
      || typeof candidate.pathIdentity !== 'string'
    ) throw new LibraryServiceError('LIBRARY_CORRUPT');
    return candidate as ManagedFolderHistorySnapshot;
  });
}

export function applyManagedFolderCreateHistorySnapshot(this: LibraryService, openLibrary: OpenLibrary, snapshot: ManagedFolderHistorySnapshot): void {
  const existing = openLibrary.connection
    .prepare('SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?')
    .get(snapshot.folderId) as ManagedFolderRow | undefined;
  if (existing) {
    if (
      existing.parent_folder_id !== snapshot.parentFolderId
      || existing.name !== snapshot.name
      || existing.relative_path !== snapshot.relativePath
      || existing.path_identity !== snapshot.pathIdentity
    ) throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
    return;
  }
  if (snapshot.parentFolderId !== null) {
    const parent = openLibrary.connection
      .prepare('SELECT folder_id FROM managed_folders WHERE folder_id = ?')
      .get(snapshot.parentFolderId);
    if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  const conflict = openLibrary.connection
    .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ?')
    .get(snapshot.pathIdentity)
    ?? openLibrary.connection
      .prepare("SELECT asset_id FROM assets WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL")
      .get(snapshot.pathIdentity);
  if (conflict || this.portableDiskDestination(openLibrary, snapshot.relativePath)) {
    throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
  }
  const directoryPath = this.folderPath(openLibrary, snapshot.relativePath);
  try {
    mkdirSync(directoryPath);
    openLibrary.connection.prepare(
      `INSERT INTO managed_folders
         (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshot.folderId,
      snapshot.parentFolderId,
      snapshot.name,
      snapshot.relativePath,
      snapshot.pathIdentity,
      new Date().toISOString(),
    );
  } catch (error) {
    try {
      if (directoryExists(directoryPath)) rmdirSync(directoryPath);
    } catch { /* preserve the primary failure */ }
    if (error instanceof LibraryServiceError) throw error;
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

export function recordManagedFolderSnapshotHistory(this: LibraryService, input: {
    after: readonly ManagedFolderHistorySnapshot[];
    before: readonly ManagedFolderHistorySnapshot[];
    commandId: string;
    libraryId: string;
    labelKey: string;
    affectedCount: number;
    source?: HistorySource;
    sourceReference?: string | null;
  }): HistoryOperationReceipt {
  return this.recordOperationHistory({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: input.commandId,
    labelKey: input.labelKey,
    labelArgs: { count: input.affectedCount },
    affectedCount: input.affectedCount,
    affectedEntities: input.after.map((item) => item.folderId),
    forwardRecipe: {
      kind: 'managed-folder-snapshot',
      version: 1,
      payload: { expected: input.before, restore: input.after },
    },
    inverseRecipe: {
      kind: 'managed-folder-snapshot',
      version: 1,
      payload: { expected: input.after, restore: input.before },
    },
  });
}

export function folderPath(this: LibraryService, openLibrary: OpenLibrary, relativePath: string): string {
  const assetsPath = this.assetsPath(openLibrary);
  const assetsStat = lstatSync(assetsPath);
  if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink()) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  const targetPath = path.resolve(assetsPath, ...relativePath.split('/'));
  const relation = path.relative(assetsPath, targetPath);
  if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  let cursor = assetsPath;
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

export async function folderPathAsync(this: LibraryService, openLibrary: OpenLibrary, relativePath: string): Promise<string> {
  const assetsPath = this.assetsPath(openLibrary);
  const assetsStat = await lstatAsync(assetsPath);
  if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink()) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  const targetPath = path.resolve(assetsPath, ...relativePath.split('/'));
  const relation = path.relative(assetsPath, targetPath);
  if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  let cursor = assetsPath;
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

export function targetFolder(this: LibraryService, openLibrary: OpenLibrary, folderId?: string): ManagedFolderRow | undefined {
  if (!folderId) return undefined;
  const folder = openLibrary.connection
    .prepare(
      'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
    )
    .get(folderId) as ManagedFolderRow | undefined;
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  return folder;
}

export function createManagedFolder(this: LibraryService, input: {
    libraryId: string;
    name: string;
    parentFolderId?: string;
  }): ManagedFolderSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  let name: string;
  try {
    name = normalizeFolderName(input.name);
  } catch (error) {
    throw serviceError(error, 'INVALID_FOLDER_NAME');
  }

  let parent: ManagedFolderRow | undefined;
  if (input.parentFolderId) {
    parent = openLibrary.connection
      .prepare(
        // Keel review: managed_folders lives inside the per-library DB —
        // there is no library_id column (the table is already library-scoped).
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      )
      .get(input.parentFolderId) as ManagedFolderRow | undefined;
    if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  const relativePath = parent ? path.posix.join(parent.relative_path, name) : name;
  const pathIdentity = portablePathIdentity(relativePath);
  const targetPath = this.folderPath(openLibrary, relativePath);
  const databaseConflict =
    openLibrary.connection
      .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ?')
      .get(pathIdentity) ??
    openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE path_identity = ?')
      .get(pathIdentity);
  if (databaseConflict || this.portableDiskDestination(openLibrary, relativePath)) {
    throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
  }

  const createdAt = new Date().toISOString();
  const folder: ManagedFolderSummary = {
    folderId: randomUUID(),
    parentFolderId: parent?.folder_id ?? null,
    name,
    relativePath,
    directAssetCount: 0,
    childFolderCount: 0,
    createdAt,
    // Every summary path reports appearance, so a single-row return and
    // listManagedFolders must not disagree (Serpent-df3049 follow-up).
    appearance: null,
  };
  try {
    mkdirSync(targetPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO managed_folders
           (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        folder.folderId,
        folder.parentFolderId,
        folder.name,
        folder.relativePath,
        pathIdentity,
        createdAt,
      );
    return folder;
  } catch (error) {
    try {
      if (directoryExists(targetPath)) rmdirSync(targetPath);
    } catch {
      // Preserve the primary operation failure; later reconciliation can index an empty directory.
    }
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
}

/**
* Renaming a managed folder renames the real directory and rewrites the
* recorded path of every row underneath it: the folder row itself, all
* descendant managed_folders rows, and every managed asset whose recorded
* path lives in the subtree — including missing and already-trashed rows,
* whose recorded paths must still follow the real directory so trash
* restore and reconciliation keep working.
*
* Crash-safety convention follows renameAssetFile: rename on disk first,
* then one DB transaction (path + FTS sync); on DB failure the disk rename
* is rolled back best-effort. Content is untouched, so no revision row is
* recorded.
*/
export function renameManagedFolder(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
    newName: string;
  }): ManagedFolderSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  let name: string;
  try {
    name = normalizeFolderName(input.newName);
  } catch (error) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME', {
      reason: 'NAME_NOT_SUPPORTED',
      cause: error,
    });
  }

  const row = openLibrary.connection
    .prepare(
      'SELECT folder_id, parent_folder_id, name, relative_path, path_identity, created_at, appearance_glyph_kind, appearance_glyph_value, appearance_color_id FROM managed_folders WHERE folder_id = ?',
    )
    .get(input.folderId) as ManagedFolderRow | undefined;
  if (!row) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  // Identical target (same spelling, same case): success no-op, nothing on
  // disk or in the DB is touched.
  if (name === row.name) {
    return this.summarizeManagedFolderRowRecursive(openLibrary, row);
  }

  const oldRelativePath = row.relative_path;
  const parentRelativePath = path.posix.dirname(oldRelativePath);
  const newRelativePath =
    parentRelativePath === '.' ? name : path.posix.join(parentRelativePath, name);
  const newIdentity = portablePathIdentity(newRelativePath);

  const sourcePath = this.folderPath(openLibrary, oldRelativePath);
  if (!realDirectoryExists(sourcePath)) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }

  // Conflicts are judged by portable (case-folded) identity so a case-only
  // match against a DIFFERENT entry is still a conflict on case-insensitive
  // volumes; the source directory's own entry is exempt, which is what
  // makes a pure case-change rename (a -> A) possible.
  const databaseConflict =
    openLibrary.connection
      .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ? AND folder_id != ?')
      .get(newIdentity, row.folder_id) ??
    openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
          WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
      )
      .get(newIdentity);
  if (databaseConflict) throw new LibraryServiceError('FOLDER_NAME_CONFLICT');

  const parentDirectoryPath = path.dirname(sourcePath);
  const targetSegmentIdentity = portablePathSegmentIdentity(name);
  let directoryEntries;
  try {
    directoryEntries = readdirSync(parentDirectoryPath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  for (const entry of directoryEntries) {
    if (entry.name === row.name) continue;
    if (portablePathSegmentIdentity(entry.name) === targetSegmentIdentity) {
      throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
    }
  }

  const destinationPath = path.join(parentDirectoryPath, name);
  const now = new Date().toISOString();
  let renamed = false;
  // A yielded scan may still hold source paths from before this rename.
  // Fence it before the disk/DB mutation so it cannot recreate old rows.
  this.cancelReconciliationForClientMutation(input.libraryId);
  try {
    renameSync(sourcePath, destinationPath);
    renamed = true;
    openLibrary.connection.transaction(() => {
      const changed = openLibrary.connection
        .prepare(
          `UPDATE managed_folders
              SET name = ?, relative_path = ?, path_identity = ?
            WHERE folder_id = ?`,
        )
        .run(name, newRelativePath, newIdentity, row.folder_id);
      if (changed.changes !== 1) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
      }

      // Descendants are matched by an exact path prefix via substr (never
      // LIKE, so folder names containing LIKE wildcards stay literal).
      // SQLite substr counts characters, not UTF-16 code units, hence the
      // spread length rather than String.length.
      const prefixLength = [...oldRelativePath].length + 1;
      const oldPrefix = `${oldRelativePath}/`;
      const descendantFolders = openLibrary.connection
        .prepare(
          `SELECT folder_id, relative_path FROM managed_folders
            WHERE substr(relative_path, 1, ?) = ?`,
        )
        .all(prefixLength, oldPrefix) as Array<{
          folder_id: string;
          relative_path: string;
        }>;
      const updateDescendant = openLibrary.connection.prepare(
        `UPDATE managed_folders
            SET relative_path = ?, path_identity = ?
          WHERE folder_id = ?`,
      );
      for (const descendant of descendantFolders) {
        const rewritten = newRelativePath + descendant.relative_path.slice(oldRelativePath.length);
        updateDescendant.run(rewritten, portablePathIdentity(rewritten), descendant.folder_id);
      }

      // Every managed asset recorded under the subtree follows the real
      // directory, regardless of availability or trash state; only live
      // assets need their search content re-tokenized.
      const subtreeAssets = openLibrary.connection
        .prepare(
          `SELECT asset_id, relative_file_path, deleted_at FROM assets
            WHERE location_kind = 'managed'
              AND substr(relative_file_path, 1, ?) = ?`,
        )
        .all(prefixLength, oldPrefix) as Array<{
          asset_id: string;
          relative_file_path: string;
          deleted_at: string | null;
        }>;
      const updateAsset = openLibrary.connection.prepare(
        `UPDATE assets
            SET relative_file_path = ?, path_identity = ?, updated_at = ?
          WHERE asset_id = ?`,
      );
      for (const asset of subtreeAssets) {
        const rewritten = newRelativePath + asset.relative_file_path.slice(oldRelativePath.length);
        updateAsset.run(rewritten, portablePathIdentity(rewritten), now, asset.asset_id);
        if (asset.deleted_at === null) {
          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        }
      }
    })();
  } catch (error) {
    if (renamed) {
      try {
        renameSync(destinationPath, sourcePath);
      } catch (rollbackError) {
        // The DB transaction did not commit; if the filesystem rollback also
        // failed the next refresh reconciles the moved directory back into
        // the library. Never mask the primary failure.
        this.diagnose('folder.rename.rollback', rollbackError, {
          libraryId: input.libraryId,
          folderId: row.folder_id,
        });
      }
    }
    if (isMissingPathError(error)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND', cause: error });
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  this.emitClientAssetsChanged(input.libraryId, 1, true);
  return this.summarizeManagedFolderRowRecursive(openLibrary, {
    ...row,
    name,
    relative_path: newRelativePath,
  });
}

/**
* Clone a managed folder as a sibling (REQ-MENU-005 / Serpent-vgp).
* Creates a new folder tree with fresh folder/asset identities; human
* metadata + tags are cloned via copyAssets. Linked folders are refused.
*/
export function cloneManagedFolder(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
  }): {
    folder: ManagedFolderSummary;
    clonedFolderCount: number;
    clonedAssetCount: number;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const { folder, descendantFolders, assetIds } =
    this.collectManagedFolderSubtree(openLibrary, input.folderId);

  const cloneName = this.availableSiblingFolderName(
    openLibrary,
    folder.parent_folder_id,
    folder.name,
  );
  const rootClone = this.createManagedFolder({
    libraryId: input.libraryId,
    name: cloneName,
    parentFolderId: folder.parent_folder_id ?? undefined,
  });

  const idMap = new Map<string, string>([[folder.folder_id, rootClone.folderId]]);
  // Create descendants shallow→deep so parents exist before children.
  const descendantsShallowFirst = [...descendantFolders].sort(
    (left, right) => left.relative_path.length - right.relative_path.length,
  );
  for (const descendant of descendantsShallowFirst) {
    const parentCloneId = descendant.parent_folder_id
      ? idMap.get(descendant.parent_folder_id)
      : undefined;
    if (!parentCloneId) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const created = this.createManagedFolder({
      libraryId: input.libraryId,
      name: descendant.name,
      parentFolderId: parentCloneId,
    });
    idMap.set(descendant.folder_id, created.folderId);
  }

  // Direct assets of each source folder → matching clone folder.
  let clonedAssetCount = 0;
  const foldersToCopy = [folder, ...descendantsShallowFirst];
  for (const sourceFolder of foldersToCopy) {
    const targetFolderId = idMap.get(sourceFolder.folder_id);
    if (!targetFolderId) continue;
    const directAssetIds = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
          WHERE location_kind = 'managed'
            AND deleted_at IS NULL
            AND availability = 'available'
            AND managed_folder_id = ?`,
      )
      .all(sourceFolder.folder_id) as Array<{ asset_id: string }>;
    if (directAssetIds.length === 0) continue;
    const copied = this.copyAssets({
      libraryId: input.libraryId,
      assetIds: directAssetIds.map((row) => row.asset_id),
      targetFolderId,
      conflictStrategy: 'keep-both',
    });
    clonedAssetCount += copied.copiedCount;
  }

  // assetIds was collected for the whole subtree; unused beyond validation.
  void assetIds;

  return {
    folder: this.summarizeManagedFolderRowRecursive(openLibrary, {
      folder_id: rootClone.folderId,
      parent_folder_id: rootClone.parentFolderId,
      name: rootClone.name,
      relative_path: rootClone.relativePath,
      path_identity: portablePathIdentity(rootClone.relativePath),
    }),
    clonedFolderCount: idMap.size,
    clonedAssetCount,
  };
}

/**
* Move managed folders under a new parent (REQ-MENU-005 / Serpent-vgp).
* Rejects moves into self/descendant. Nested selections are collapsed to
* outermost folders so a parent move does not double-move a child.
*/
export function moveManagedFolders(this: LibraryService, input: {
    libraryId: string;
    folderIds: string[];
    targetParentFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'skip';
  }): {
    movedCount: number;
    skippedCount: number;
    folders: ManagedFolderSummary[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.cancelReconciliationForClientMutation(input.libraryId);
  if (
    input.folderIds.length === 0 ||
    new Set(input.folderIds).size !== input.folderIds.length
  ) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const strategy = input.conflictStrategy ?? 'keep-both';
  const targetParent =
    input.targetParentFolderId === null
      ? null
      : (openLibrary.connection
          .prepare(
            'SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?',
          )
          .get(input.targetParentFolderId) as
          | { folder_id: string; relative_path: string }
          | undefined);
  if (input.targetParentFolderId !== null && !targetParent) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  const rows = sqliteAllInChunks<string, ManagedFolderRow>({
    connection: openLibrary.connection,
    values: input.folderIds,
    buildSql: (placeholders) =>
      `SELECT folder_id, parent_folder_id, name, relative_path, path_identity, created_at
         FROM managed_folders
        WHERE folder_id IN (${placeholders})`,
  });
  if (rows.length !== input.folderIds.length) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  // Drop folders that are descendants of another selected folder.
  const selected = rows.filter(
    (row) =>
      !rows.some(
        (other) =>
          other.folder_id !== row.folder_id &&
          (row.relative_path === other.relative_path ||
            row.relative_path.startsWith(`${other.relative_path}/`)),
      ),
  );

  let movedCount = 0;
  let skippedCount = 0;
  const moved: ManagedFolderSummary[] = [];

  for (const row of selected) {
    // Moving onto the current parent is a no-op skip.
    const currentParent = row.parent_folder_id;
    if (
      (currentParent === null && input.targetParentFolderId === null) ||
      currentParent === input.targetParentFolderId
    ) {
      skippedCount += 1;
      continue;
    }

    // Refuse move into self or descendant.
    if (input.targetParentFolderId !== null) {
      const targetRelative = targetParent!.relative_path;
      if (
        targetRelative === row.relative_path ||
        targetRelative.startsWith(`${row.relative_path}/`)
      ) {
        throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
      }
    }

    const destParentRelative = targetParent?.relative_path ?? '';
    let destName = row.name;
    let destRelative = destParentRelative
      ? path.posix.join(destParentRelative, destName)
      : destName;
    let destIdentity = portablePathIdentity(destRelative);

    const conflict =
      openLibrary.connection
        .prepare(
          'SELECT folder_id FROM managed_folders WHERE path_identity = ? AND folder_id != ?',
        )
        .get(destIdentity, row.folder_id) ??
      openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
        )
        .get(destIdentity);

    if (conflict) {
      if (strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      destName = this.availableSiblingFolderName(
        openLibrary,
        input.targetParentFolderId,
        row.name,
      );
      destRelative = destParentRelative
        ? path.posix.join(destParentRelative, destName)
        : destName;
      destIdentity = portablePathIdentity(destRelative);
    }

    const sourcePath = this.folderPath(openLibrary, row.relative_path);
    if (!realDirectoryExists(sourcePath)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', {
        reason: 'SOURCE_NOT_FOUND',
      });
    }
    if (this.portableDiskDestination(openLibrary, destRelative)) {
      if (strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      destName = this.availableSiblingFolderName(
        openLibrary,
        input.targetParentFolderId,
        row.name,
      );
      destRelative = destParentRelative
        ? path.posix.join(destParentRelative, destName)
        : destName;
      destIdentity = portablePathIdentity(destRelative);
    }
    const finalDestination = this.folderPath(openLibrary, destRelative);

    const oldRelativePath = row.relative_path;
    const now = new Date().toISOString();
    let renamed = false;
    try {
      renameSync(sourcePath, finalDestination);
      renamed = true;
      openLibrary.connection.transaction(() => {
        const changed = openLibrary.connection
          .prepare(
            `UPDATE managed_folders
                SET parent_folder_id = ?, name = ?, relative_path = ?, path_identity = ?
              WHERE folder_id = ?`,
          )
          .run(
            input.targetParentFolderId,
            destName,
            destRelative,
            destIdentity,
            row.folder_id,
          );
        if (changed.changes !== 1) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND', {
            reason: 'SOURCE_CHANGED',
          });
        }

        const prefixLength = [...oldRelativePath].length + 1;
        const oldPrefix = `${oldRelativePath}/`;
        const descendantFolders = openLibrary.connection
          .prepare(
            `SELECT folder_id, relative_path FROM managed_folders
              WHERE substr(relative_path, 1, ?) = ?`,
          )
          .all(prefixLength, oldPrefix) as Array<{
            folder_id: string;
            relative_path: string;
          }>;
        const updateDescendant = openLibrary.connection.prepare(
          `UPDATE managed_folders
              SET relative_path = ?, path_identity = ?
            WHERE folder_id = ?`,
        );
        for (const descendant of descendantFolders) {
          const rewritten =
            destRelative +
            descendant.relative_path.slice(oldRelativePath.length);
          updateDescendant.run(
            rewritten,
            portablePathIdentity(rewritten),
            descendant.folder_id,
          );
        }

        const subtreeAssets = openLibrary.connection
          .prepare(
            `SELECT asset_id, relative_file_path, deleted_at FROM assets
              WHERE location_kind = 'managed'
                AND substr(relative_file_path, 1, ?) = ?`,
          )
          .all(prefixLength, oldPrefix) as Array<{
            asset_id: string;
            relative_file_path: string;
            deleted_at: string | null;
          }>;
        // Also rewrite assets whose managed_folder_id is the moved root and
        // whose relative path equals the old folder path prefix for files
        // stored directly in the folder (path = folder/file).
        const updateAsset = openLibrary.connection.prepare(
          `UPDATE assets
              SET relative_file_path = ?, path_identity = ?, updated_at = ?
            WHERE asset_id = ?`,
        );
        for (const asset of subtreeAssets) {
          const rewritten =
            destRelative +
            asset.relative_file_path.slice(oldRelativePath.length);
          updateAsset.run(
            rewritten,
            portablePathIdentity(rewritten),
            now,
            asset.asset_id,
          );
          if (asset.deleted_at === null) {
            this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
          }
        }

        // Direct children whose path is exactly under the old folder but
        // matched via managed_folder_id when relative path uses the folder.
        // The substr prefix match already covers `oldRelativePath/` assets;
        // also cover the rare case of the folder path itself never holding
        // an asset file named equal to the folder.
      })();
    } catch (error) {
      if (renamed) {
        try {
          renameSync(finalDestination, sourcePath);
        } catch (rollbackError) {
          this.diagnose('folder.move.rollback', rollbackError, {
            libraryId: input.libraryId,
            folderId: row.folder_id,
          });
        }
      }
      if (isMissingPathError(error)) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', {
          reason: 'SOURCE_NOT_FOUND',
          cause: error,
        });
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    movedCount += 1;
    moved.push(
      this.summarizeManagedFolderRowRecursive(openLibrary, {
        ...row,
        parent_folder_id: input.targetParentFolderId,
        name: destName,
        relative_path: destRelative,
        path_identity: destIdentity,
      }),
    );
  }

  this.emitClientAssetsChanged(input.libraryId, movedCount, true);
  return { movedCount, skippedCount, folders: moved };
}

/** Sibling folder name that does not collide on disk or in the DB. */
export function availableSiblingFolderName(this: LibraryService, openLibrary: OpenLibrary, parentFolderId: string | null, baseName: string): string {
  const parentRelative =
    parentFolderId === null
      ? ''
      : (
          openLibrary.connection
            .prepare(
              'SELECT relative_path FROM managed_folders WHERE folder_id = ?',
            )
            .get(parentFolderId) as { relative_path: string } | undefined
        )?.relative_path;
  if (parentFolderId !== null && parentRelative === undefined) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  const candidates = [`${baseName} copy`];
  for (let index = 2; index < 10_000; index += 1) {
    candidates.push(`${baseName} copy ${index}`);
  }
  for (const candidate of candidates) {
    let name: string;
    try {
      name = normalizeFolderName(candidate);
    } catch {
      continue;
    }
    const relativePath = parentRelative
      ? path.posix.join(parentRelative, name)
      : name;
    const identity = portablePathIdentity(relativePath);
    const databaseConflict =
      openLibrary.connection
        .prepare(
          'SELECT folder_id FROM managed_folders WHERE path_identity = ?',
        )
        .get(identity) ??
      openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
        )
        .get(identity);
    if (databaseConflict) continue;
    if (this.portableDiskDestination(openLibrary, relativePath)) continue;
    return name;
  }
  throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
}

export function collectManagedFolderSubtree(this: LibraryService, openLibrary: OpenLibrary, folderId: string): {
    folder: ManagedFolderRow;
    descendantFolders: ManagedFolderRow[];
    assetIds: string[];
  } {
  const folder = openLibrary.connection
    .prepare(
      'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
    )
    .get(folderId) as ManagedFolderRow | undefined;
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  const descendantFolders = openLibrary.connection
    .prepare(
      `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
         FROM managed_folders
        ORDER BY length(relative_path) DESC`,
    )
    .all()
    .filter((row) => {
      const candidate = row as ManagedFolderRow;
      return candidate.folder_id !== folder.folder_id
        && isPortablePathEqualOrDescendant(candidate.relative_path, folder.relative_path);
    }) as ManagedFolderRow[];

  const folderIds = [folder.folder_id, ...descendantFolders.map((row) => row.folder_id)];
  const assetRows = withSqliteInPredicate(
    openLibrary.connection,
    'managed_folder_id',
    folderIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE location_kind = 'managed'
              AND deleted_at IS NULL
              AND ${sql}`,
        )
        .all(...params) as Array<{ asset_id: string }>,
  );

  return {
    folder,
    descendantFolders,
    assetIds: assetRows.map((row) => row.asset_id),
  };
}

export function removeManagedFolderRowsAndDirectory(this: LibraryService, openLibrary: OpenLibrary, folder: ManagedFolderRow, descendantFolders: ManagedFolderRow[]): number {
  const ordered = [...descendantFolders, folder];
  const directoryPath = this.folderPath(openLibrary, folder.relative_path);
  // Remove the filesystem tree before dropping its index rows. If Windows
  // still has a handle open, the operation must fail without leaving a
  // half-deleted database entry that can no longer be retried from the UI.
  try {
    if (existsSync(directoryPath)) {
      rmSync(directoryPath, {
        force: true,
        recursive: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  openLibrary.connection.transaction(() => {
    for (const row of ordered) {
      const result = openLibrary.connection
        .prepare('DELETE FROM managed_folders WHERE folder_id = ?')
        .run(row.folder_id);
      if (result.changes !== 1) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
      }
    }
  })();

  return ordered.length;
}

export async function removeManagedFolderRowsAndDirectoryAsync(this: LibraryService, openLibrary: OpenLibrary, folder: ManagedFolderRow, descendantFolders: ManagedFolderRow[]): Promise<number> {
  const ordered = [...descendantFolders, folder];
  const directoryPath = this.folderPath(openLibrary, folder.relative_path);
  try {
    await removePathWithRetry(directoryPath, true);
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  openLibrary.connection.transaction(() => {
    for (const row of ordered) {
      const result = openLibrary.connection
        .prepare('DELETE FROM managed_folders WHERE folder_id = ?')
        .run(row.folder_id);
      if (result.changes !== 1) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
      }
    }
  })();

  return ordered.length;
}

export function listManagedFolders(this: LibraryService, libraryId: string, showIgnored = false): ManagedFolderSummary[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = (openLibrary.connection
    .prepare(
      'SELECT folder_id, parent_folder_id, name, relative_path, path_identity, created_at, appearance_glyph_kind, appearance_glyph_value, appearance_color_id FROM managed_folders ORDER BY relative_path',
    )
    .all() as ManagedFolderRow[]).filter((row) =>
    showIgnored || !this.explicitFolderIgnored(openLibrary, 'managed', null, row.relative_path),
  );
  const counts = this.managedFolderCountMaps(openLibrary, undefined, showIgnored);
  // Serpent-toh: ManagedFolderSummary.directAssetCount is the displayed
  // badge count = all descendants (schema field name kept for compat).
  const recursive = this.managedFolderRecursiveAssetCounts(openLibrary, rows, showIgnored);
  return rows.map((row) => {
    const summary = this.summarizeManagedFolderRow(openLibrary, row, counts);
    return {
      ...summary,
      directAssetCount: recursive.get(row.folder_id) ?? summary.directAssetCount,
    };
  });
}

/**
* Copy a chosen image into the library and use it as the folder cover.
* Clearing removes that file and the folder goes back to its automatic cover.
*/
export function setFolderCustomCovers(this: LibraryService, input: {
    libraryId: string;
    folderIds: readonly string[];
    sourcePath: string;
  }): { folderIds: string[]; hasCustomCover: true } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const folderIds = [...new Set(input.folderIds)];
  if (folderIds.length === 0) throw new LibraryServiceError('INVALID_SELECTION');
  for (const folderId of folderIds) this.assertFolderCoverTarget(openLibrary, folderId);
  const now = new Date().toISOString();
  const libraryPath = openLibrary.summary.libraryPath;
  const previous = openLibrary.connection.prepare(
    `SELECT relative_name FROM folder_custom_covers
      WHERE library_id = ? AND folder_key = ?`,
  );
  const upsert = openLibrary.connection.prepare(
    `INSERT INTO folder_custom_covers
       (library_id, folder_key, relative_name, cover_asset_id, updated_at)
     VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT (library_id, folder_key) DO UPDATE SET
       relative_name = excluded.relative_name,
       cover_asset_id = NULL,
       updated_at = excluded.updated_at`,
  );
  const staged: Array<{ folderId: string; relativeName: string; previous: string | null }> = [];
  let committed = false;
  try {
    for (const folderId of folderIds) {
      const existing = previous.get(openLibrary.summary.libraryId, folderId) as
        | { relative_name: string }
        | undefined;
      let relativeName: string;
      try {
        relativeName = installFolderCoverFile({
          libraryPath,
          folderKey: folderId,
          sourcePath: input.sourcePath,
          previousRelativeName: existing?.relative_name,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (code === 'FOLDER_COVER_UNSUPPORTED' || code === 'FOLDER_COVER_NO_SPACE') {
          throw new LibraryServiceError(code);
        }
        throw error;
      }
      staged.push({
        folderId,
        relativeName,
        previous: existing?.relative_name ? existing.relative_name : null,
      });
    }
    commitReplacingFolderCoverFiles({
      libraryPath,
      stagedRelativeNames: staged.map((item) => item.relativeName),
      previousRelativeNames: staged.flatMap((item) => item.previous ? [item.previous] : []),
      commit: () => {
        openLibrary.connection.transaction(() => {
          for (const item of staged) {
            upsert.run(openLibrary.summary.libraryId, item.folderId, item.relativeName, now);
          }
        })();
      },
    });
    committed = true;
  } catch (error) {
    if (!committed) {
      for (const item of staged) {
        try {
          removeFolderCoverFile(libraryPath, item.relativeName);
        } catch {
          // The commit already failed. Leave the previous cover in place.
        }
      }
    }
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('LIBRARY_IO_ERROR', { cause: error });
  }
  this.invalidateNavigationSummary(openLibrary);
  this.emitClientAssetsChanged(input.libraryId, folderIds.length);
  return { folderIds, hasCustomCover: true };
}

/**
* Use an image already in the library as the folder cover.
* The asset id is the durable reference; the file is not copied again.
*/
export function setFolderCustomCoverFromAsset(this: LibraryService, input: {
    libraryId: string;
    folderIds: readonly string[];
    assetId: string;
  }): { folderIds: string[]; hasCustomCover: true } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const folderIds = [...new Set(input.folderIds)];
  if (folderIds.length === 0) throw new LibraryServiceError('INVALID_SELECTION');
  for (const folderId of folderIds) this.assertFolderCoverTarget(openLibrary, folderId);
  const asset = openLibrary.connection.prepare(
    `SELECT asset_id, relative_file_path, deleted_at
       FROM assets
      WHERE asset_id = ?`,
  ).get(input.assetId) as
    | { asset_id: string; relative_file_path: string; deleted_at: string | null }
    | undefined;
  if (!asset || asset.deleted_at) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (!folderCoverStoredExtension(asset.relative_file_path)) {
    throw new LibraryServiceError('FOLDER_COVER_UNSUPPORTED');
  }
  const now = new Date().toISOString();
  const previous = openLibrary.connection.prepare(
    `SELECT relative_name FROM folder_custom_covers
      WHERE library_id = ? AND folder_key = ?`,
  );
  const upsert = openLibrary.connection.prepare(
    `INSERT INTO folder_custom_covers
       (library_id, folder_key, relative_name, cover_asset_id, updated_at)
     VALUES (?, ?, '', ?, ?)
     ON CONFLICT (library_id, folder_key) DO UPDATE SET
       relative_name = '',
       cover_asset_id = excluded.cover_asset_id,
       updated_at = excluded.updated_at`,
  );
  const libraryPath = openLibrary.summary.libraryPath;
  const previousFiles: string[] = [];
  openLibrary.connection.transaction(() => {
    for (const folderId of folderIds) {
      const existing = previous.get(openLibrary.summary.libraryId, folderId) as
        | { relative_name: string }
        | undefined;
      if (existing?.relative_name) previousFiles.push(existing.relative_name);
      upsert.run(openLibrary.summary.libraryId, folderId, input.assetId, now);
    }
  })();
  for (const relativeName of previousFiles) {
    try {
      removeFolderCoverFile(libraryPath, relativeName);
    } catch {
      // The asset id is already committed. A later sweep can remove the file.
    }
  }
  this.invalidateNavigationSummary(openLibrary);
  this.emitClientAssetsChanged(input.libraryId, folderIds.length);
  return { folderIds, hasCustomCover: true };
}

export function clearFolderCustomCovers(this: LibraryService, input: {
    libraryId: string;
    folderIds: readonly string[];
  }): { folderIds: string[]; hasCustomCover: false } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const folderIds = [...new Set(input.folderIds)];
  const select = openLibrary.connection.prepare(
    `SELECT relative_name FROM folder_custom_covers
      WHERE library_id = ? AND folder_key = ?`,
  );
  const remove = openLibrary.connection.prepare(
    `DELETE FROM folder_custom_covers WHERE library_id = ? AND folder_key = ?`,
  );
  const libraryPath = openLibrary.summary.libraryPath;
  const previousFiles: string[] = [];
  openLibrary.connection.transaction(() => {
    for (const folderId of folderIds) {
      const row = select.get(openLibrary.summary.libraryId, folderId) as
        | { relative_name: string }
        | undefined;
      remove.run(openLibrary.summary.libraryId, folderId);
      if (row?.relative_name) previousFiles.push(row.relative_name);
    }
  })();
  for (const relativeName of previousFiles) {
    try {
      removeFolderCoverFile(libraryPath, relativeName);
    } catch {
      // The row is already gone. A later sweep can remove the file.
    }
  }
  this.invalidateNavigationSummary(openLibrary);
  this.emitClientAssetsChanged(input.libraryId, folderIds.length);
  return { folderIds, hasCustomCover: false };
}

export function resolveFolderCustomCover(this: LibraryService, input: {
    libraryId: string;
    folderId: string;
  }): { absolutePath: string; mimeType: string } | null {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection.prepare(
    `SELECT relative_name FROM folder_custom_covers
      WHERE library_id = ? AND folder_key = ?`,
  ).get(openLibrary.summary.libraryId, input.folderId) as
    | { relative_name: string }
    | undefined;
  if (!row?.relative_name) return null;
  return {
    absolutePath: folderCoverAbsolutePath(openLibrary.summary.libraryPath, row.relative_name),
    mimeType: folderCoverMimeType(row.relative_name),
  };
}

export function assertFolderCoverTarget(this: LibraryService, openLibrary: OpenLibrary, folderId: string): void {
  const managed = openLibrary.connection
    .prepare('SELECT 1 AS ok FROM managed_folders WHERE folder_id = ?')
    .get(folderId);
  if (managed) return;
  const linked = openLibrary.connection
    .prepare('SELECT 1 AS ok FROM linked_folders WHERE folder_id = ? AND library_id = ?')
    .get(folderId, openLibrary.summary.libraryId);
  if (linked) return;
  const virtual = parseLinkedVirtualFolderId(folderId);
  if (virtual) {
    const root = openLibrary.connection
      .prepare('SELECT 1 AS ok FROM linked_folders WHERE folder_id = ? AND library_id = ?')
      .get(virtual.linkedFolderId, openLibrary.summary.libraryId);
    if (root) return;
  }
  const trashed = openLibrary.connection
    .prepare('SELECT 1 AS ok FROM trashed_managed_folders WHERE folder_id = ?')
    .get(folderId);
  if (trashed) return;
  throw new LibraryServiceError('FOLDER_NOT_FOUND');
}

/**
* Orphan cover rows and unreferenced files are not needed to paint the
* sidebar. Run them after the navigation summary returns.
*/
export function scheduleOrphanFolderCoverSweep(this: LibraryService, openLibrary: OpenLibrary): void {
  if (this.folderCoverSweepScheduled.has(openLibrary)) return;
  this.folderCoverSweepScheduled.add(openLibrary);
  setImmediate(() => {
    try {
      this.sweepOrphanFolderCovers(openLibrary);
    } catch (error) {
      this.diagnose('folder-cover.sweep', error, {
        libraryId: openLibrary.summary.libraryId,
      });
    }
  });
}

export function sweepOrphanFolderCovers(this: LibraryService, openLibrary: OpenLibrary): void {
  if (!hasTable(openLibrary.connection, 'folder_custom_covers')) return;
  const assetColumn = columnsFor(openLibrary.connection, 'folder_custom_covers').has('cover_asset_id');
  const rows = openLibrary.connection.prepare(
    assetColumn
      ? `SELECT folder_key, relative_name, cover_asset_id
           FROM folder_custom_covers WHERE library_id = ?`
      : `SELECT folder_key, relative_name, NULL AS cover_asset_id
           FROM folder_custom_covers WHERE library_id = ?`,
  ).all(openLibrary.summary.libraryId) as Array<{
    folder_key: string;
    relative_name: string;
    cover_asset_id: string | null;
  }>;
  const remove = openLibrary.connection.prepare(
    `DELETE FROM folder_custom_covers WHERE library_id = ? AND folder_key = ?`,
  );
  const assetExists = openLibrary.connection.prepare(
    `SELECT 1 AS ok FROM assets WHERE asset_id = ?`,
  );
  let dropped = false;
  const referenced = new Set<string>();
  for (const row of rows) {
    let drop = false;
    try {
      this.assertFolderCoverTarget(openLibrary, row.folder_key);
    } catch (error) {
      if (!(error instanceof LibraryServiceError) || error.code !== 'FOLDER_NOT_FOUND') throw error;
      drop = true;
    }
    if (!drop && row.cover_asset_id && !assetExists.get(row.cover_asset_id)) drop = true;
    if (drop) {
      remove.run(openLibrary.summary.libraryId, row.folder_key);
      if (row.relative_name) removeFolderCoverFile(openLibrary.summary.libraryPath, row.relative_name);
      dropped = true;
      continue;
    }
    if (row.relative_name) referenced.add(row.relative_name);
  }
  const stale = listStaleFolderCoverFiles(openLibrary.summary.libraryPath, referenced);
  for (const relativeName of stale) {
    removeFolderCoverFile(openLibrary.summary.libraryPath, relativeName);
  }
  if (dropped || stale.length > 0) {
    openLibrary.folderCoverIndexCache = undefined;
    openLibrary.navigationSummaryCache = undefined;
  }
}

export function folderCoverIndexCacheKey(this: LibraryService, openLibrary: OpenLibrary): string {
  const libraryId = openLibrary.summary.libraryId;
  return `${this.getBrowseChangeSequence(libraryId)}\u0000${this.getChangeSequence(libraryId)}`;
}

export function folderCustomCoverRows(this: LibraryService, openLibrary: OpenLibrary, folderIds?: readonly string[]): Array<{
    folder_key: string;
    relative_name: string;
    updated_at: string;
    cover_asset_id: string | null;
    current_revision_id: string | null;
    deleted_at: string | null;
    relative_file_path: string | null;
    artifact_id: string | null;
  }> {
  if (!hasTable(openLibrary.connection, 'folder_custom_covers')) return [];
  const assetColumn = columnsFor(openLibrary.connection, 'folder_custom_covers').has('cover_asset_id');
  const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const artifactIdSelect = hasTable(openLibrary.connection, 'revision_artifacts')
    && ['artifact_id', 'revision_id', 'kind'].every((column) => artifactColumns.has(column))
    ? `(SELECT ra.artifact_id
         FROM revision_artifacts ra
        WHERE ra.revision_id = a.current_revision_id
          ${artifactColumns.has('invalidated_at') ? 'AND ra.invalidated_at IS NULL' : ''}
          ${artifactColumns.has('status') ? "AND ra.status = 'ready'" : ''}
          AND ra.kind = 'thumbnail'
        LIMIT 1)`
    : 'NULL';
  const select = assetColumn
    ? `SELECT c.folder_key AS folder_key,
              c.relative_name AS relative_name,
              c.updated_at AS updated_at,
              c.cover_asset_id AS cover_asset_id,
              a.current_revision_id AS current_revision_id,
              a.deleted_at AS deleted_at,
              a.relative_file_path AS relative_file_path,
              ${artifactIdSelect} AS artifact_id
         FROM folder_custom_covers c
         LEFT JOIN assets a ON a.asset_id = c.cover_asset_id
        WHERE c.library_id = ?`
    : `SELECT c.folder_key AS folder_key,
              c.relative_name AS relative_name,
              c.updated_at AS updated_at,
              NULL AS cover_asset_id,
              NULL AS current_revision_id,
              NULL AS deleted_at,
              NULL AS relative_file_path,
              NULL AS artifact_id
         FROM folder_custom_covers c
        WHERE c.library_id = ?`;
  const mapRow = (row: {
    folder_key: string;
    relative_name: string;
    updated_at: string;
    cover_asset_id: string | null;
    current_revision_id: string | null;
    deleted_at: string | null;
    relative_file_path: string | null;
    artifact_id: string | null;
  }) => row;
  if (!folderIds) {
    return (openLibrary.connection.prepare(
      `${select} ORDER BY c.updated_at DESC`,
    ).all(openLibrary.summary.libraryId) as Array<ReturnType<typeof mapRow>>).map(mapRow);
  }
  const ids = [...new Set(folderIds)];
  if (ids.length === 0) return [];
  return sqliteAllInChunks<string, ReturnType<typeof mapRow>>({
    connection: openLibrary.connection,
    values: ids,
    buildSql: (placeholders) =>
      `${select} AND c.folder_key IN (${placeholders}) ORDER BY c.updated_at DESC`,
    bind: (chunk) => [openLibrary.summary.libraryId, ...chunk],
  });
}

export function coverIndexFromRows(this: LibraryService, rows: ReturnType<LibraryService['folderCustomCoverRows']>): Map<string, {
    token: string;
    assetId?: string;
    artifactId?: string;
    revisionId?: string;
  }> {
  const index = new Map<string, {
    token: string;
    assetId?: string;
    artifactId?: string;
    revisionId?: string;
  }>();
  for (const row of rows) {
    if (row.cover_asset_id) {
      if (!row.current_revision_id || row.deleted_at) continue;
      if (!row.relative_file_path || !folderCoverStoredExtension(row.relative_file_path)) continue;
      const revisionId = row.current_revision_id;
      index.set(row.folder_key, {
        token: row.updated_at,
        assetId: row.cover_asset_id,
        ...(row.artifact_id ? { artifactId: row.artifact_id } : { revisionId }),
      });
      continue;
    }
    if (!row.relative_name) continue;
    index.set(row.folder_key, { token: row.updated_at });
  }
  return index;
}

export function loadFolderCustomCoverIndex(this: LibraryService, openLibrary: OpenLibrary, folderIds?: readonly string[]): Map<string, {
    token: string;
    assetId?: string;
    artifactId?: string;
    revisionId?: string;
  }> {
  const cacheKey = this.folderCoverIndexCacheKey(openLibrary);
  const cached = openLibrary.folderCoverIndexCache;
  if (cached?.key === cacheKey) {
    if (!folderIds) return cached.index;
    const scoped = new Map<string, {
      token: string;
      assetId?: string;
      artifactId?: string;
      revisionId?: string;
    }>();
    for (const folderId of folderIds) {
      const cover = cached.index.get(folderId);
      if (cover) scoped.set(folderId, cover);
    }
    return scoped;
  }
  if (folderIds) {
    return this.coverIndexFromRows(this.folderCustomCoverRows(openLibrary, folderIds));
  }
  const index = this.coverIndexFromRows(this.folderCustomCoverRows(openLibrary));
  openLibrary.folderCoverIndexCache = { key: cacheKey, index };
  return index;
}

export function listFolderNavigationCovers(this: LibraryService, openLibrary: OpenLibrary): LibraryNavigationSummary['folderCovers'] {
  const covers: NonNullable<LibraryNavigationSummary['folderCovers']> = [];
  for (const [folderId, cover] of this.loadFolderCustomCoverIndex(openLibrary)) {
    if (covers.length >= FOLDER_NAVIGATION_COVER_CAP) break;
    if (cover.assetId) {
      covers.push({
        folderId,
        assetId: cover.assetId,
        ...(cover.artifactId ? { artifactId: cover.artifactId } : {}),
        ...(cover.revisionId ? { revisionId: cover.revisionId } : {}),
      });
      continue;
    }
    if (cover.token.length > 0 && cover.token.length <= 64) {
      covers.push({ folderId, fileToken: cover.token });
    }
  }
  return covers;
}

export function withCustomFolderCovers(this: LibraryService, openLibrary: OpenLibrary, entries: FolderBrowseEntry[]): FolderBrowseEntry[] {
  if (entries.length === 0) return entries;
  const covers = this.loadFolderCustomCoverIndex(
    openLibrary,
    entries.map((entry) => entry.folderId),
  );
  if (covers.size === 0) return entries;
  return entries.map((entry) => {
    const cover = covers.get(entry.folderId);
    if (!cover) return entry;
    const token = cover.token.length <= 64 ? cover.token : cover.token.slice(0, 64);
    if (cover.assetId) {
      return {
        ...entry,
        hasCustomCover: true,
        customCoverToken: token,
        customCoverAssetId: cover.assetId,
        ...(cover.artifactId ? { customCoverArtifactId: cover.artifactId } : {}),
        ...(cover.revisionId
          ? { customCoverSourcePreview: { assetId: cover.assetId, revisionId: cover.revisionId } }
          : {}),
      };
    }
    return { ...entry, hasCustomCover: true, customCoverToken: token };
  });
}

/**
* Indexed byte total for folder inspector details. Sums stored revision
* sizes for the folder and its descendants. Linked folders use the catalog
* only — this never walks the source disk.
*/
export function folderIndexedByteSizes(this: LibraryService, input: {
    libraryId: string;
    refs: Array<{ locationKind: 'managed' | 'linked'; folderId: string }>;
  }): Array<{ folderId: string; byteSize: number }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const refs = input.refs.slice(0, 32);
  const sizes = new Map<string, number>();

  const managedIds = refs
    .filter((ref) => ref.locationKind === 'managed')
    .map((ref) => ref.folderId);
  if (managedIds.length > 0) {
    const rolled = this.managedFolderIndexedByteTotals(openLibrary);
    for (const folderId of managedIds) {
      sizes.set(folderId, rolled.get(folderId) ?? 0);
    }
  }

  const linkedIds = [...new Set(refs
    .filter((ref) => ref.locationKind === 'linked')
    .map((ref) => ref.folderId))];
  if (linkedIds.length > 0) {
    const filesByRoot = new Map<string, Array<{ path: string; byteSize: number }>>();
    for (const folderId of linkedIds) {
      const resolved = this.resolveLinkedFolderScope(openLibrary, folderId);
      if (!resolved) {
        sizes.set(folderId, 0);
        continue;
      }
      let files = filesByRoot.get(resolved.linkedFolderId);
      if (!files) {
        const rows = openLibrary.connection
          .prepare(
            `SELECT a.relative_file_path AS path, COALESCE(r.byte_size, 0) AS byte_size
               FROM assets a
               LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
              WHERE a.deleted_at IS NULL
                AND a.location_kind = 'linked'
                AND a.linked_folder_id = ?
                AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', false)}`,
          )
          .all(resolved.linkedFolderId) as Array<{ path: string; byte_size: number }>;
        files = rows.map((file) => ({ path: file.path, byteSize: Number(file.byte_size) || 0 }));
        filesByRoot.set(resolved.linkedFolderId, files);
      }
      const prefix = resolved.relativePath;
      const total = files.reduce((sum, file) => {
        if (prefix === '' || file.path === prefix || file.path.startsWith(`${prefix}/`)) {
          return sum + file.byteSize;
        }
        return sum;
      }, 0);
      sizes.set(folderId, total);
    }
  }

  return refs.map((ref) => ({
    folderId: ref.folderId,
    byteSize: sizes.get(ref.folderId) ?? 0,
  }));
}

export function managedFolderIndexedByteTotals(this: LibraryService, openLibrary: OpenLibrary): Map<string, number> {
  const folders = openLibrary.connection
    .prepare('SELECT folder_id, parent_folder_id FROM managed_folders')
    .all() as Array<{ folder_id: string; parent_folder_id: string | null }>;
  const totals = new Map(folders.map((folder) => [folder.folder_id, 0]));
  const direct = openLibrary.connection
    .prepare(
      `SELECT a.managed_folder_id AS folder_id, COALESCE(SUM(r.byte_size), 0) AS bytes
         FROM assets a
         LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.location_kind = 'managed'
          AND a.managed_folder_id IS NOT NULL
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', false)}
        GROUP BY a.managed_folder_id`,
    )
    .all() as Array<{ folder_id: string; bytes: number }>;
  for (const row of direct) {
    if (totals.has(row.folder_id)) totals.set(row.folder_id, Number(row.bytes) || 0);
  }
  const depth = new Map<string, number>();
  const byId = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const depthOf = (folderId: string): number => {
    const cached = depth.get(folderId);
    if (cached !== undefined) return cached;
    const parentId = byId.get(folderId)?.parent_folder_id;
    const value = parentId ? depthOf(parentId) + 1 : 0;
    depth.set(folderId, value);
    return value;
  };
  const deepestFirst = [...folders].sort(
    (left, right) => depthOf(right.folder_id) - depthOf(left.folder_id),
  );
  for (const folder of deepestFirst) {
    if (!folder.parent_folder_id) continue;
    totals.set(
      folder.parent_folder_id,
      (totals.get(folder.parent_folder_id) ?? 0) + (totals.get(folder.folder_id) ?? 0),
    );
  }
  return totals;
}

/**
* Recursive counts for the assets that match the current discovery filters.
* Folder ids match the sidebar: managed folder ids, linked roots, and
* linked virtual subdirectory ids. Folders with no matches are omitted.
*/
export function filteredFolderCounts(this: LibraryService, input: {
    libraryId: string;
    filters?: FilterClause[] | null;
    showIgnored?: boolean;
  }): {
    all: number;
    root: number;
    folders: Array<{ folderId: string; count: number }>;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const connection = openLibrary.connection;
  const filters = input.filters ?? [];
  const showIgnored = input.showIgnored === true;
  const artifactColumns = columnsFor(connection, 'revision_artifacts');
  const hasIgnoreTable = hasTable(connection, 'linked_ignored_assets');
  const hasAiContent = hasTable(connection, 'ai_content');
  const hasAiAssetTags = hasTable(connection, 'ai_asset_tags');
  const hasSequenceFrames = hasTable(connection, 'asset_sequence_frames');
  const filterFields = new Set(filters.map((filter) => filter.field));
  const { sql: filterWhere, params: filterParams } = this.buildFilterWhere(filters, {
    hasAiContent,
    hasAiAssetTags,
    hasTagHierarchy: hasTable(connection, 'tag_hierarchy'),
  });
  const needsDurationMeta =
    filterFields.has('width') ||
    filterFields.has('height') ||
    filterFields.has('duration_ms') ||
    filterFields.has('long_edge') ||
    filterFields.has('aspect_ratio');
  const needsPaletteMeta = filterFields.has('color');
  const needsTechnicalThumbnail =
    filterFields.has('width') ||
    filterFields.has('height') ||
    filterFields.has('long_edge') ||
    filterFields.has('aspect_ratio');
  const needsMetadata =
    filterFields.has('rating') ||
    filterFields.has('favorite') ||
    filterFields.has('source_url');
  const durationMetaJoin = needsDurationMeta
    ? `LEFT JOIN revision_artifacts duration_meta
         ON duration_meta.revision_id = a.current_revision_id
        AND duration_meta.kind = 'extracted_metadata'
        ${artifactColumns.has('status') ? "AND duration_meta.status = 'ready'" : ''}
        AND duration_meta.invalidated_at IS NULL`
    : '';
  const paletteMetaJoin = needsPaletteMeta
    ? `LEFT JOIN revision_artifacts palette_meta
         ON palette_meta.revision_id = a.current_revision_id
        AND palette_meta.kind = 'extracted_palette'
        ${artifactColumns.has('status') ? "AND palette_meta.status = 'ready'" : ''}
        AND palette_meta.invalidated_at IS NULL`
    : '';
  const technicalThumbnailJoin = needsTechnicalThumbnail
    ? singleDisplayArtifactJoin(
        'technical_thumbnail',
        artifactColumns.has('status') ? "AND chosen.status = 'ready'" : '',
      )
    : '';
  const from = `FROM assets a
       ${needsMetadata ? 'LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id' : ''}
       ${durationMetaJoin}
       ${paletteMetaJoin}
       ${technicalThumbnailJoin}`;
  const whereParts = buildCatalogAssetVisibilityPredicates({
    scopeKind: 'all',
    showIgnored,
    showMissingLinked: this._showMissingLinkedFiles,
    explicitIgnoreSql: this.explicitIgnoreSql(connection, 'a', showIgnored),
    hasLinkedIgnoredAssets: hasIgnoreTable,
    hasSequenceFrames,
    hasCompanions: this.ensureCompanionIndex(openLibrary),
  });
  const params: unknown[] = [];
  if (filterWhere.length > 0) {
    whereParts.push(filterWhere);
    params.push(...filterParams);
  }
  const rows = connection.prepare(
    `SELECT a.location_kind AS location_kind,
            a.managed_folder_id AS managed_folder_id,
            a.linked_folder_id AS linked_folder_id,
            a.relative_file_path AS relative_file_path
       ${from}
      WHERE ${whereParts.join(' AND ')}`,
  ).all(...params) as Array<{
    location_kind: 'managed' | 'linked';
    managed_folder_id: string | null;
    linked_folder_id: string | null;
    relative_file_path: string;
  }>;

  const direct = new Map<string, number>();
  const linkedPaths = new Map<string, string[]>();
  let root = 0;
  for (const row of rows) {
    if (row.location_kind === 'linked' && row.linked_folder_id) {
      const paths = linkedPaths.get(row.linked_folder_id) ?? [];
      paths.push(row.relative_file_path);
      linkedPaths.set(row.linked_folder_id, paths);
      continue;
    }
    if (row.managed_folder_id) {
      direct.set(row.managed_folder_id, (direct.get(row.managed_folder_id) ?? 0) + 1);
    } else {
      root += 1;
    }
  }

  const managedFolders = connection.prepare(
    'SELECT folder_id, parent_folder_id FROM managed_folders',
  ).all() as Array<{ folder_id: string; parent_folder_id: string | null }>;
  const rolled = rollupDirectFolderCounts(
    managedFolders.map((folder) => ({
      folderId: folder.folder_id,
      parentFolderId: folder.parent_folder_id,
    })),
    direct,
  );
  const folders: Array<{ folderId: string; count: number }> = [];
  for (const [folderId, count] of rolled) {
    if (count > 0) folders.push({ folderId, count });
  }
  for (const [linkedFolderId, paths] of linkedPaths) {
    const counts = this.countLinkedAssets(paths);
    for (const [relativePath, count] of counts) {
      if (count.recursive <= 0) continue;
      folders.push({
        folderId: relativePath === ''
          ? linkedFolderId
          : encodeLinkedVirtualFolderId(linkedFolderId, relativePath),
        count: count.recursive,
      });
    }
  }
  return { all: rows.length, root, folders };
}

/**
* Direct child folder cards for the browse canvas (REQ-FOLDER-001/002/003).
* Counts and covers are batched — never N+1 per card.
*/
export async function listFolderBrowseEntriesAsync(this: LibraryService, input: {
    libraryId: string; parentFolderId: string | null; showIgnored?: boolean;
  }): Promise<FolderBrowseEntry[]> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const scope = input.parentFolderId === null ? null : this.resolveLinkedFolderScope(openLibrary, input.parentFolderId);
  const prepared = scope ? await this.prepareLinkedAssetPaths(openLibrary, input.showIgnored === true,
    this.navigationReadCheckpoint(input.libraryId, openLibrary), [scope.linkedFolderId], false) : undefined;
  return this.listFolderBrowseEntries(input, prepared);
}

export async function folderEntriesByRefsAsync(this: LibraryService, input: {
    libraryId: string; refs: Array<{ locationKind: 'managed' | 'linked'; folderId: string }>;
  }): Promise<FolderBrowseEntry[]> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const roots = input.refs.filter((ref) => ref.locationKind === 'linked')
    .flatMap((ref) => this.resolveLinkedFolderScope(openLibrary, ref.folderId)?.linkedFolderId ?? []);
  const prepared = roots.length ? await this.prepareLinkedAssetPaths(openLibrary, false,
    this.navigationReadCheckpoint(input.libraryId, openLibrary), roots, false) : undefined;
  return this.folderEntriesByRefs(input, prepared);
}

export function listFolderBrowseEntries(this: LibraryService, input: {
    libraryId: string;
    parentFolderId: string | null;
    showIgnored?: boolean;
  }, preparedPaths?: ReadonlyMap<string, string[]>): FolderBrowseEntry[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.parentFolderId !== null) {
    const linkedEntries = this.listLinkedFolderBrowseEntries(openLibrary, input, preparedPaths);
    if (linkedEntries !== null) return linkedEntries;
    const parent = openLibrary.connection
      .prepare('SELECT folder_id FROM managed_folders WHERE folder_id = ?')
      .get(input.parentFolderId) as { folder_id: string } | undefined;
    if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  const children = (
    input.parentFolderId === null
      ? openLibrary.connection
          .prepare(
            `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
               FROM managed_folders
              WHERE parent_folder_id IS NULL
              ORDER BY name COLLATE NOCASE`,
          )
          .all()
      : openLibrary.connection
          .prepare(
            `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
               FROM managed_folders
              WHERE parent_folder_id = ?
              ORDER BY name COLLATE NOCASE`,
          )
          .all(input.parentFolderId)
  ) as ManagedFolderRow[];
  const visibleChildren = children.filter((row) =>
    input.showIgnored === true || !this.explicitFolderIgnored(openLibrary, 'managed', null, row.relative_path),
  );
  if (visibleChildren.length === 0) return [];

  const counts = this.managedFolderCountMaps(openLibrary, visibleChildren.map((row) => row.folder_id), input.showIgnored === true);
  const recursiveCounts = this.managedFolderRecursiveAssetCounts(
    openLibrary,
    visibleChildren,
    input.showIgnored === true,
  );
  const coverMap = this.folderCoverArtifactMap(
    openLibrary,
    visibleChildren.map((row) => row.folder_id),
    input.showIgnored === true,
  );
  // Serpent-d0nv: scheduling candidates are the top-3 direct assets by path
  // with NO ready-thumbnail requirement — the cover scene must enqueue the
  // folders that have no covers yet (the user-visible symptom).
  const coverCandidateMap = this.folderCoverCandidateAssetMap(
    openLibrary,
    visibleChildren.map((row) => row.folder_id),
    input.showIgnored === true,
  );

  return this.withSequenceFolderCovers(openLibrary, visibleChildren.map((row) => {
    const directAssetCount = counts.directAssetCounts.get(row.folder_id) ?? 0;
    return {
      folderId: row.folder_id,
      parentFolderId: row.parent_folder_id,
      locationKind: 'managed' as const,
      name: row.name,
      relativePath: row.relative_path,
      status: 'available' as const,
      directAssetCount,
      // Serpent-toh / REQ-FOLDER-003: display all descendant assets.
      recursiveAssetCount: recursiveCounts.get(row.folder_id) ?? directAssetCount,
      childFolderCount: counts.childFolderCounts.get(row.folder_id) ?? 0,
      coverArtifactIds: coverMap.get(row.folder_id) ?? [],
      // Serpent-d0nv: cover candidates as asset ids (cover scene scheduling
      // + progressive refresh on thumbnail.ready). Candidates do NOT require
      // a ready thumbnail — ungenerated assets get enqueued by the cover
      // scene; display covers stay ready-gated in coverArtifactIds.
      coverAssetIds: coverCandidateMap.get(row.folder_id) ?? [],
      linkedFolderId: null,
    };
  }));
}

/**
* Serpent-f74e48: real FolderBrowseEntry (counts + covers) for concrete
* folder refs matched by text search — so search-result folder cards reuse
* the exact asset-browser cards (preview images included). Accepts managed
* ids, linked-root ids and encoded linked virtual subdirectory ids.
*/
export function folderEntriesByRefs(this: LibraryService, input: {
    libraryId: string;
    refs: Array<{ locationKind: 'managed' | 'linked'; folderId: string }>;
  }, preparedPaths?: ReadonlyMap<string, string[]>): FolderBrowseEntry[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const results: FolderBrowseEntry[] = [];

  const managedIds = input.refs
    .filter((ref) => ref.locationKind === 'managed')
    .map((ref) => ref.folderId);
  if (managedIds.length > 0) {
    const rows = sqliteAllInChunks<string, ManagedFolderRow>({
      connection: openLibrary.connection,
      values: managedIds,
      buildSql: (placeholders) =>
        `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
           FROM managed_folders
          WHERE folder_id IN (${placeholders})`,
    });
    const rowById = new Map(rows.map((row) => [row.folder_id, row]));
    const visibleIds = rows
      .filter(
        (row) =>
          !this.explicitFolderIgnored(
            openLibrary,
            'managed',
            null,
            row.relative_path,
          ),
      )
      .map((row) => row.folder_id);
    const counts = this.managedFolderCountMaps(openLibrary, visibleIds, false);
    const recursiveCounts = this.managedFolderRecursiveAssetCounts(
      openLibrary,
      rows,
      false,
    );
    const coverMap = this.folderCoverArtifactMap(openLibrary, visibleIds, false);
    const coverCandidateMap = this.folderCoverCandidateAssetMap(
      openLibrary,
      visibleIds,
      false,
    );
    for (const folderId of managedIds) {
      const row = rowById.get(folderId);
      if (!row) continue;
      if (
        this.explicitFolderIgnored(
          openLibrary,
          'managed',
          null,
          row.relative_path,
        )
      ) {
        continue;
      }
      const directAssetCount = counts.directAssetCounts.get(folderId) ?? 0;
      results.push({
        folderId: row.folder_id,
        parentFolderId: row.parent_folder_id,
        locationKind: 'managed' as const,
        name: row.name,
        relativePath: row.relative_path,
        status: 'available' as const,
        directAssetCount,
        recursiveAssetCount:
          recursiveCounts.get(folderId) ?? directAssetCount,
        childFolderCount: counts.childFolderCounts.get(folderId) ?? 0,
        coverArtifactIds: coverMap.get(folderId) ?? [],
        coverAssetIds: coverCandidateMap.get(folderId) ?? [],
        linkedFolderId: null,
      });
    }
  }

  const linkedRefs = input.refs.filter(
    (ref) => ref.locationKind === 'linked',
  );
  for (const ref of linkedRefs) {
    const resolved = this.resolveLinkedFolderScope(openLibrary, ref.folderId);
    if (!resolved) continue;
    const paths = preparedPaths?.get(resolved.linkedFolderId) ?? this.listLinkedAssetRelativePaths(
      openLibrary,
      resolved.linkedFolderId,
      false,
    );
    const isRoot = resolved.relativePath === '';
    const assetCounts = this.countLinkedAssets(paths);
    const directoryCounts = assetCounts.get(resolved.relativePath);
    const directAssetCount = directoryCounts?.direct ?? 0;
    const recursiveAssetCount = directoryCounts?.recursive ?? 0;
    const prefixes = collectLinkedDirectoryPrefixes(paths);
    const directChildDirs = directChildLinkedDirectories(prefixes, resolved.relativePath);
    const pureChildDirs = directAssetCount === 0 && directChildDirs.length > 0 ? directChildDirs : [];
    const name = isRoot
      ? this.linkedFolderDisplayName(openLibrary, resolved.linkedFolderId)
      : linkedDirectoryName(resolved.relativePath);
    results.push({
      folderId: ref.folderId,
      parentFolderId: null,
      locationKind: 'linked' as const,
      name,
      relativePath: resolved.relativePath,
      status: resolved.status,
      directAssetCount,
      recursiveAssetCount,
      childFolderCount: 0,
      coverArtifactIds: this.linkedDirectoryCoverArtifactIds(
        openLibrary,
        resolved.linkedFolderId,
        resolved.relativePath,
        false,
        pureChildDirs,
      ),
      coverAssetIds: this.linkedDirectoryCoverCandidateAssetIds(
        openLibrary,
        resolved.linkedFolderId,
        resolved.relativePath,
        false,
        pureChildDirs,
      ),
      linkedFolderId: resolved.linkedFolderId,
    });
  }

  return this.withSequenceFolderCovers(openLibrary, results);
}

/**
* Count assets in each folder's full subtree (self + descendants by
* relative_path prefix). Serpent-toh / REQ-FOLDER-003.
*/
export function managedFolderRecursiveAssetCounts(this: LibraryService, openLibrary: OpenLibrary, folders: Array<{ folder_id: string; relative_path: string }>, showIgnored = false): Map<string, number> {
  const result = new Map<string, number>();
  if (folders.length === 0) return result;

  // Serpent-4bdd26 / 0032-E.3: serve the recursive totals from the memo
  // until a browse-visible write advances the narrow sequence. Thumbnail,
  // job and artifact progress must not evict this sidebar read model.
  const browseChangeSequence = this.getBrowseChangeSequence(openLibrary.summary.libraryId);
  const cacheKey = `${browseChangeSequence}\u0000${showIgnored ? 'ignored' : 'visible'}`;
  if (openLibrary.folderCountCache?.key === cacheKey) {
    const cached = openLibrary.folderCountCache.counts;
    for (const folder of folders) {
      result.set(folder.folder_id, cached.get(folder.folder_id) ?? 0);
    }
    return result;
  }

  const allFolders = (openLibrary.connection
    .prepare(
      'SELECT folder_id, parent_folder_id, relative_path FROM managed_folders',
    )
    .all() as Array<{
      folder_id: string;
      parent_folder_id: string | null;
      relative_path: string;
    }>).filter((folder) =>
      showIgnored || !this.explicitFolderIgnored(openLibrary, 'managed', null, folder.relative_path),
  );
  const { directAssetCounts } = this.managedFolderCountMaps(
    openLibrary,
    undefined,
    showIgnored,
  );
  const totals = new Map(
    allFolders.map((folder) => [
      folder.folder_id,
      directAssetCounts.get(folder.folder_id) ?? 0,
    ] as const),
  );

  // Aggregate each folder into its parent once, deepest first. The previous
  // implementation compared every folder path with every other path (O(F²))
  // on every sidebar/navigation load; the parent relation makes this O(F log
  // F) for the depth ordering plus O(F) aggregation.
  const deepestFirst = [...allFolders].sort(
    (left, right) =>
      right.relative_path.split('/').length - left.relative_path.split('/').length,
  );
  for (const folder of deepestFirst) {
    if (!folder.parent_folder_id) continue;
    const parentTotal = totals.get(folder.parent_folder_id);
    if (parentTotal === undefined) continue;
    totals.set(
      folder.parent_folder_id,
      parentTotal + (totals.get(folder.folder_id) ?? 0),
    );
  }
  openLibrary.folderCountCache = { key: cacheKey, counts: totals };
  for (const folder of folders) {
    result.set(folder.folder_id, totals.get(folder.folder_id) ?? 0);
  }
  return result;
}

export function managedFolderCountMaps(this: LibraryService, openLibrary: OpenLibrary, folderIds?: string[], showIgnored = false): {
    directAssetCounts: Map<string, number>;
    childFolderCounts: Map<string, number>;
  } {
  const directAssetCounts = new Map<string, number>();
  const childFolderCounts = new Map<string, number>();

  if (folderIds && folderIds.length === 0) {
    return { directAssetCounts, childFolderCounts };
  }

  if (folderIds) {
    // Serpent-verg review fix: the ignore/sequence-frame subqueries
    // reference tables older libraries do not have; conditions are only
    // added when the tables exist.
    const connection = openLibrary.connection;
    const hasIgnoreTable = hasTable(connection, 'linked_ignored_assets');
    const hasSequenceFrames = hasTable(connection, 'asset_sequence_frames');
    const hasExplicitIgnore = hasTable(connection, 'explicit_ignored_paths');
    const hasGitignore = hasTable(connection, 'gitignore_ignored_paths');
    const assetRows = withSqliteInPredicate(
      openLibrary.connection,
      'managed_folder_id',
      folderIds,
      (sql, params) =>
        openLibrary.connection
          .prepare(
            `SELECT managed_folder_id AS folder_id, COUNT(*) AS count
               FROM assets
              WHERE ${sql}
                AND deleted_at IS NULL
                ${hasIgnoreTable
                  ? 'AND NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = assets.asset_id)'
                  : ''}
                AND ${this.explicitIgnoreSql(connection, 'assets', showIgnored)}
                ${hasSequenceFrames
                  ? `AND NOT EXISTS (
                  SELECT 1
                    FROM asset_sequence_frames hidden_sequence_frame
                   WHERE hidden_sequence_frame.asset_id = assets.asset_id
                     AND hidden_sequence_frame.position > 0
                )`
                  : ''}
              GROUP BY managed_folder_id`,
          )
          .all(...params) as Array<{ folder_id: string; count: number }>,
    );
    for (const row of assetRows) directAssetCounts.set(row.folder_id, row.count);

    const folderIgnoreClauses = [
      hasExplicitIgnore
        ? `NOT EXISTS (
          SELECT 1 FROM explicit_ignored_paths ignored_folder
           WHERE ignored_folder.location_kind = 'managed'
             AND ignored_folder.linked_folder_id = ''
             AND ignored_folder.path_kind = 'folder'
             AND (mf.relative_path = ignored_folder.relative_path
               OR mf.relative_path LIKE ignored_folder.relative_path || '/%')
        )`
        : null,
      hasGitignore
        ? `NOT EXISTS (
          SELECT 1 FROM gitignore_ignored_paths ignored_git
           WHERE ignored_git.path_kind = 'folder'
             AND (mf.relative_path = ignored_git.relative_path
               OR mf.relative_path LIKE ignored_git.relative_path || '/%')
        )`
        : null,
    ].filter((sql): sql is string => sql !== null);
    const childRows = withSqliteInPredicate(
      openLibrary.connection,
      'parent_folder_id',
      folderIds,
      (sql, params) =>
        openLibrary.connection
          .prepare(
            `SELECT parent_folder_id AS folder_id, COUNT(*) AS count
               FROM managed_folders mf
              WHERE ${sql}
                AND ${
                  showIgnored || folderIgnoreClauses.length === 0
                    ? '1 = 1'
                    : folderIgnoreClauses.join(' AND ')
                }
              GROUP BY parent_folder_id`,
          )
          .all(...params) as Array<{ folder_id: string; count: number }>,
    );
    for (const row of childRows) childFolderCounts.set(row.folder_id, row.count);
    return { directAssetCounts, childFolderCounts };
  }

  // Serpent-verg review fix: guard the ignore/sequence-frame subqueries
  // (same table-existence rules as the folderIds variant above).
  const connection = openLibrary.connection;
  const hasIgnoreTable = hasTable(connection, 'linked_ignored_assets');
  const hasSequenceFrames = hasTable(connection, 'asset_sequence_frames');
  const hasExplicitIgnore = hasTable(connection, 'explicit_ignored_paths');
  const hasGitignore = hasTable(connection, 'gitignore_ignored_paths');
  const assetRows = openLibrary.connection
    .prepare(
      `SELECT managed_folder_id AS folder_id, COUNT(*) AS count
         FROM assets
        WHERE managed_folder_id IS NOT NULL
          AND deleted_at IS NULL
          ${hasIgnoreTable
            ? 'AND NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = assets.asset_id)'
            : ''}
          AND ${this.explicitIgnoreSql(connection, 'assets', showIgnored)}
          ${hasSequenceFrames
            ? `AND NOT EXISTS (
            SELECT 1
              FROM asset_sequence_frames hidden_sequence_frame
             WHERE hidden_sequence_frame.asset_id = assets.asset_id
               AND hidden_sequence_frame.position > 0
          )`
            : ''}
        GROUP BY managed_folder_id`,
    )
    .all() as Array<{ folder_id: string; count: number }>;
  for (const row of assetRows) directAssetCounts.set(row.folder_id, row.count);

  const folderIgnoreClauses = [
    hasExplicitIgnore
      ? `NOT EXISTS (
        SELECT 1 FROM explicit_ignored_paths ignored_folder
         WHERE ignored_folder.location_kind = 'managed'
           AND ignored_folder.linked_folder_id = ''
           AND ignored_folder.path_kind = 'folder'
           AND (mf.relative_path = ignored_folder.relative_path
             OR mf.relative_path LIKE ignored_folder.relative_path || '/%')
      )`
      : null,
    hasGitignore
      ? `NOT EXISTS (
        SELECT 1 FROM gitignore_ignored_paths ignored_git
         WHERE ignored_git.path_kind = 'folder'
           AND (mf.relative_path = ignored_git.relative_path
             OR mf.relative_path LIKE ignored_git.relative_path || '/%')
      )`
      : null,
  ].filter((sql): sql is string => sql !== null);
  const childRows = openLibrary.connection
    .prepare(
      `SELECT parent_folder_id AS folder_id, COUNT(*) AS count
         FROM managed_folders mf
        WHERE parent_folder_id IS NOT NULL
          AND ${
            showIgnored || folderIgnoreClauses.length === 0
              ? '1 = 1'
              : folderIgnoreClauses.join(' AND ')
          }
        GROUP BY parent_folder_id`,
    )
    .all() as Array<{ folder_id: string; count: number }>;
  for (const row of childRows) childFolderCounts.set(row.folder_id, row.count);
  return { directAssetCounts, childFolderCounts };
}

/**
* Serpent-9021d1: For pure folders (folders with directAssetCount === 0),
* pick up to 4 covers from their child folders in round-robin order so
* the folder card displays a 2x2 collage preview of its subfolder contents.
*/
export function populateChildFolderCovers(this: LibraryService, openLibrary: OpenLibrary, parentFolderIds: string[], covers: Map<string, string[]>, showIgnored = false): void {
  if (parentFolderIds.length === 0) return;

  const allFolders = (
    openLibrary.connection
      .prepare('SELECT folder_id, parent_folder_id, relative_path, name FROM managed_folders')
      .all() as ManagedFolderRow[]
  ).filter(
    (folder) => showIgnored || !this.explicitFolderIgnored(openLibrary, 'managed', null, folder.relative_path),
  );

  const parentToChildren = new Map<string, ManagedFolderRow[]>();
  for (const folder of allFolders) {
    if (folder.parent_folder_id) {
      const list = parentToChildren.get(folder.parent_folder_id) ?? [];
      list.push(folder);
      parentToChildren.set(folder.parent_folder_id, list);
    }
  }
  for (const list of parentToChildren.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const folderToDirectChild = new Map<string, { parentFolderId: string; childIndex: number }>();
  const allDescendantFolderIds: string[] = [];

  for (const parentId of parentFolderIds) {
    const directChildren = parentToChildren.get(parentId) ?? [];
    for (let i = 0; i < directChildren.length; i++) {
      const child = directChildren[i]!;
      const queue = [child.folder_id];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        if (!folderToDirectChild.has(currId)) {
          folderToDirectChild.set(currId, { parentFolderId: parentId, childIndex: i });
          allDescendantFolderIds.push(currId);
        }
        const subChildren = parentToChildren.get(currId);
        if (subChildren) {
          for (const sub of subChildren) {
            queue.push(sub.folder_id);
          }
        }
      }
    }
  }

  if (allDescendantFolderIds.length === 0) return;

  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.managed_folder_id',
    allDescendantFolderIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.managed_folder_id AS folder_id, ra.artifact_id AS artifact_id
             FROM assets a
             JOIN revision_artifacts ra
               ON ra.revision_id = a.current_revision_id
              AND ra.invalidated_at IS NULL
              AND ra.status = 'ready'
              AND ra.kind = CASE
                WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                  OR LOWER(a.relative_file_path) LIKE '%.webm'
                  OR LOWER(a.relative_file_path) LIKE '%.mov'
                  OR LOWER(a.relative_file_path) LIKE '%.avi'
                  OR LOWER(a.relative_file_path) LIKE '%.wmv'
                  OR LOWER(a.relative_file_path) LIKE '%.mkv'
                  OR LOWER(a.relative_file_path) LIKE '%.m4v'
                  OR LOWER(a.relative_file_path) LIKE '%.flv'
                THEN 'video_poster'
                ELSE 'thumbnail'
              END
            WHERE ${sql}
              AND a.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id
              )
              AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
            ORDER BY a.managed_folder_id, a.relative_file_path`,
        )
        .all(...params) as Array<{ folder_id: string; artifact_id: string }>,
  );

  const artifactsByParentAndChild = new Map<string, Map<number, string[]>>();
  for (const row of rows) {
    const match = folderToDirectChild.get(row.folder_id);
    if (!match) continue;
    let childMap = artifactsByParentAndChild.get(match.parentFolderId);
    if (!childMap) {
      childMap = new Map();
      artifactsByParentAndChild.set(match.parentFolderId, childMap);
    }
    const list = childMap.get(match.childIndex) ?? [];
    list.push(row.artifact_id);
    childMap.set(match.childIndex, list);
  }

  for (const parentId of parentFolderIds) {
    const directChildren = parentToChildren.get(parentId) ?? [];
    if (directChildren.length === 0) continue;
    const childMap = artifactsByParentAndChild.get(parentId);
    if (!childMap) continue;

    const picked: string[] = [];
    let round = 0;
    while (picked.length < 4) {
      let addedInRound = false;
      for (let c = 0; c < directChildren.length && picked.length < 4; c++) {
        const list = childMap.get(c);
        if (list && round < list.length) {
          picked.push(list[round]!);
          addedInRound = true;
        }
      }
      if (!addedInRound) break;
      round++;
    }
    if (picked.length > 0) {
      covers.set(parentId, picked);
    }
  }
}

/**
* Serpent-d0nv: cover scheduling candidates — the top-4 direct assets per
* folder by path, with NO ready-thumbnail requirement. The cover thumbnail
* scene (priority 400) schedules these asset ids so folders without covers
* generate their cover before the p50 path-alphabetical backfill; assets
* that already have a ready artifact are a no-op in enqueueThumbnailJobs.
*/
export function folderCoverCandidateAssetMap(this: LibraryService, openLibrary: OpenLibrary, folderIds: string[], showIgnored = false): Map<string, string[]> {
  const candidates = new Map<string, string[]>();
  if (folderIds.length === 0) return candidates;
  if (!hasTable(openLibrary.connection, 'linked_ignored_assets')) {
    return candidates;
  }
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.managed_folder_id',
    folderIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.managed_folder_id AS folder_id, a.asset_id AS asset_id
             FROM assets a
            WHERE ${sql}
              AND a.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id
              )
              AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
            ORDER BY a.managed_folder_id, a.relative_file_path`,
        )
        .all(...params) as Array<{ folder_id: string; asset_id: string }>,
  );

  for (const row of rows) {
    const existing = candidates.get(row.folder_id) ?? [];
    if (existing.length >= 3) continue;
    existing.push(row.asset_id);
    candidates.set(row.folder_id, existing);
  }

  // Serpent-9021d1: Candidate assets for pure folders' child folder covers
  // so thumbnail generation at `cover` scene schedules them proactively.
  const missingFolderIds = folderIds.filter((id) => (candidates.get(id)?.length ?? 0) === 0);
  if (missingFolderIds.length > 0) {
    this.populateChildFolderCandidateAssets(openLibrary, missingFolderIds, candidates, showIgnored);
  }

  return candidates;
}

/**
* Serpent-9021d1: For pure folders (folders with directAssetCount === 0),
* pick up to 4 candidate asset ids from their child folders in round-robin
* order so the cover thumbnail scene schedules them proactively.
*/
export function populateChildFolderCandidateAssets(this: LibraryService, openLibrary: OpenLibrary, parentFolderIds: string[], candidates: Map<string, string[]>, showIgnored = false): void {
  if (parentFolderIds.length === 0) return;

  const allFolders = (
    openLibrary.connection
      .prepare('SELECT folder_id, parent_folder_id, relative_path, name FROM managed_folders')
      .all() as ManagedFolderRow[]
  ).filter(
    (folder) => showIgnored || !this.explicitFolderIgnored(openLibrary, 'managed', null, folder.relative_path),
  );

  const parentToChildren = new Map<string, ManagedFolderRow[]>();
  for (const folder of allFolders) {
    if (folder.parent_folder_id) {
      const list = parentToChildren.get(folder.parent_folder_id) ?? [];
      list.push(folder);
      parentToChildren.set(folder.parent_folder_id, list);
    }
  }
  for (const list of parentToChildren.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const folderToDirectChild = new Map<string, { parentFolderId: string; childIndex: number }>();
  const allDescendantFolderIds: string[] = [];

  for (const parentId of parentFolderIds) {
    const directChildren = parentToChildren.get(parentId) ?? [];
    for (let i = 0; i < directChildren.length; i++) {
      const child = directChildren[i]!;
      const queue = [child.folder_id];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        if (!folderToDirectChild.has(currId)) {
          folderToDirectChild.set(currId, { parentFolderId: parentId, childIndex: i });
          allDescendantFolderIds.push(currId);
        }
        const subChildren = parentToChildren.get(currId);
        if (subChildren) {
          for (const sub of subChildren) {
            queue.push(sub.folder_id);
          }
        }
      }
    }
  }

  if (allDescendantFolderIds.length === 0) return;

  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.managed_folder_id',
    allDescendantFolderIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.managed_folder_id AS folder_id, a.asset_id AS asset_id
             FROM assets a
            WHERE ${sql}
              AND a.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id
              )
              AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
            ORDER BY a.managed_folder_id, a.relative_file_path`,
        )
        .all(...params) as Array<{ folder_id: string; asset_id: string }>,
  );

  const assetsByParentAndChild = new Map<string, Map<number, string[]>>();
  for (const row of rows) {
    const match = folderToDirectChild.get(row.folder_id);
    if (!match) continue;
    let childMap = assetsByParentAndChild.get(match.parentFolderId);
    if (!childMap) {
      childMap = new Map();
      assetsByParentAndChild.set(match.parentFolderId, childMap);
    }
    const list = childMap.get(match.childIndex) ?? [];
    list.push(row.asset_id);
    childMap.set(match.childIndex, list);
  }

  for (const parentId of parentFolderIds) {
    const directChildren = parentToChildren.get(parentId) ?? [];
    if (directChildren.length === 0) continue;
    const childMap = assetsByParentAndChild.get(parentId);
    if (!childMap) continue;

    const picked: string[] = [];
    let round = 0;
    while (picked.length < 4) {
      let addedInRound = false;
      for (let c = 0; c < directChildren.length && picked.length < 4; c++) {
        const list = childMap.get(c);
        if (list && round < list.length) {
          picked.push(list[round]!);
          addedInRound = true;
        }
      }
      if (!addedInRound) break;
      round++;
    }
    if (picked.length > 0) {
      candidates.set(parentId, picked);
    }
  }
}

export function summarizeManagedFolderRow(this: LibraryService, openLibrary: OpenLibrary, row: ManagedFolderRow, counts?: {
      directAssetCounts: Map<string, number>;
      childFolderCounts: Map<string, number>;
    }): ManagedFolderSummary {
  const resolved = counts ?? this.managedFolderCountMaps(openLibrary, [row.folder_id]);
  return {
    folderId: row.folder_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    relativePath: row.relative_path,
    directAssetCount: resolved.directAssetCounts.get(row.folder_id) ?? 0,
    childFolderCount: resolved.childFolderCounts.get(row.folder_id) ?? 0,
    createdAt: row.created_at,
    appearance: sanitizeEntityAppearance({
      glyphKind: row.appearance_glyph_kind,
      glyphValue: row.appearance_glyph_value,
      colorId: row.appearance_color_id,
    }),
  };
}

/**
* Serpent-toh: single-row returns (rename no-op / normal) must show the
* displayed recursive directAssetCount, matching listManagedFolders —
* otherwise the badge flickers from direct-only to recursive on refresh.
*/
export function summarizeManagedFolderRowRecursive(this: LibraryService, openLibrary: OpenLibrary, row: ManagedFolderRow): ManagedFolderSummary {
  const summary = this.summarizeManagedFolderRow(openLibrary, row);
  const recursive = this.managedFolderRecursiveAssetCounts(openLibrary, [
    row,
  ]);
  return {
    ...summary,
    directAssetCount:
      recursive.get(row.folder_id) ?? summary.directAssetCount,
  };
}

/** Managed folder id for an asset, if any (for AI tag weighting). */
export function getAssetManagedFolderId(this: LibraryService, libraryId: string, assetId: string): string | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT managed_folder_id FROM assets WHERE asset_id = ?`,
    )
    .get(assetId) as { managed_folder_id: string | null } | undefined;
  return row?.managed_folder_id ?? null;
}

/**
* Resolve the absolute path of a directory-tree folder (managed or linked)
* for Main-process shell/clipboard actions (REQ-MENU-006). The value never
* crosses to the Renderer (REQ-COMMAND-003).
*
* Managed folders resolve to the library Assets root + recorded relative
* path; linked folders resolve to their (canonicalized) root. A folder that
* is missing on disk — or a linked root that is offline or gone — fails
* with a typed FOLDER_NOT_FOUND instead of handing Main a dead path. The
* renderer disables these actions for offline linked folders, so the check
* here is the defensive boundary for stale state.
*/
export function resolveFolderPath(this: LibraryService, libraryId: string, folderId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // Serpent-316493: the folder panel's blank area is the library root — its
  // context menu resolves to the Assets directory that holds top-level files.
  if (isLibraryRootFolderId(folderId)) {
    const assetsPath = this.assetsPath(openLibrary);
    if (!directoryExists(assetsPath)) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    return assetsPath;
  }
  const managed = openLibrary.connection
    .prepare('SELECT relative_path FROM managed_folders WHERE folder_id = ?')
    .get(folderId) as { relative_path: string } | undefined;
  if (managed) {
    if (this.explicitFolderIgnored(openLibrary, 'managed', null, managed.relative_path)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    const targetPath = this.folderPath(openLibrary, managed.relative_path);
    if (!directoryExists(targetPath)) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    return targetPath;
  }
  const linkedScope = this.resolveLinkedFolderScope(openLibrary, folderId);
  if (!linkedScope) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (this.explicitFolderIgnored(
    openLibrary,
    'linked',
    linkedScope.linkedFolderId,
    linkedScope.relativePath,
  )) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  if (linkedScope.status === 'offline' || this.linkedRootIsGone(linkedScope.absoluteRootPath)) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  const targetPath = linkedScope.relativePath === ''
    ? linkedScope.absoluteRootPath
    : path.join(linkedScope.absoluteRootPath, ...linkedScope.relativePath.split('/'));
  try {
    return realpathSync(targetPath);
  } catch (error) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
  }
}

/** 按 posix 相对路径逐级确保托管文件夹存在，返回最内层 folder_id。 */
export function ensureManagedFolderIdForRelativeDir(this: LibraryService, openLibrary: OpenLibrary, libraryId: string, relativeDir: string): string {
  const segments = relativeDir.split('/').filter((part) => part.length > 0);
  let parentId: string | undefined;
  let acc = '';
  for (const segment of segments) {
    acc = acc === '' ? segment : `${acc}/${segment}`;
    const existing = openLibrary.connection
      .prepare(
        'SELECT folder_id FROM managed_folders WHERE path_identity = ?',
      )
      .get(portablePathIdentity(acc)) as { folder_id: string } | undefined;
    if (existing) {
      parentId = existing.folder_id;
      continue;
    }
    try {
      const created = this.createManagedFolder({
        libraryId,
        name: segment,
        ...(parentId === undefined ? {} : { parentFolderId: parentId }),
      });
      parentId = created.folderId;
    } catch (error) {
      if (!(error instanceof LibraryServiceError) || error.code !== 'FOLDER_ALREADY_EXISTS') throw error;
      const raced = openLibrary.connection
        .prepare(
          'SELECT folder_id FROM managed_folders WHERE path_identity = ?',
        )
        .get(portablePathIdentity(acc)) as { folder_id: string } | undefined;
      if (!raced) throw error;
      parentId = raced.folder_id;
    }
  }
  if (!parentId) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  return parentId;
}

// ── Trash & Relink (v7) ───────────────────────────────────────────

export function knownRecoveryFilePath(this: LibraryService, rootPath: string, relativeFilePath: string): string | undefined {
  let normalized: string;
  try {
    normalized = normalizeRelativeAssetPath(relativeFilePath);
  } catch {
    return undefined;
  }
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...normalized.split('/'));
  const relation = path.relative(root, target);
  if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    return undefined;
  }
  let cursor = root;
  const components = relation.split(path.sep).filter(Boolean);
  for (const [index, component] of components.entries()) {
    cursor = path.join(cursor, component);
    try {
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) return undefined;
      if (index === components.length - 1) {
        return entry.isFile() ? cursor : undefined;
      }
      if (!entry.isDirectory()) return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function managedMoveSummaries(this: LibraryService, openLibrary: OpenLibrary, assetIds: string[]): AssetSummary[] {
  return assetIds.flatMap((assetId) => {
    const row = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind,
              a.relative_file_path, a.current_revision_id, a.availability,
              r.byte_size, r.modified_at,
              COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
              a.deleted_at, a.trashed_from_relative_path
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        WHERE a.asset_id = ?`,
    ).get(assetId) as Parameters<LibraryService['assetSummaryFromRow']>[0] | undefined;
    return row ? [this.assetSummaryFromRow(row)] : [];
  });
}

export function applyManagedMoveOperation(this: LibraryService, openLibrary: OpenLibrary, operationId: string, manifest: ManagedMoveOperationManifest): void {
  const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
  const operationPath = path.join(operationsRoot, operationId);
  mkdirSync(path.join(operationPath, 'backup'), { recursive: true });
  this.assertSafeOperationPath(operationPath);
  const now = new Date().toISOString();
  openLibrary.connection.prepare(
    `INSERT INTO file_operations
       (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
     VALUES (?, ?, 'preparing', ?, NULL, ?, ?)`,
  ).run(operationId, manifest.kind, JSON.stringify(manifest), now, now);

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
    this.failAt('crash-move-before-filesystem');
    const applying = openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'",
    ).run(new Date().toISOString(), operationId);
    if (applying.changes !== 1) throw new LibraryServiceError('LIBRARY_CORRUPT');

    for (const file of manifest.files) {
      if (!file.destinationConflict || file.destinationConflict.sourceExists === false) continue;
      const destinationPath = this.folderPath(openLibrary, file.destinationConflict.relativePath);
      const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
      mkdirSync(path.dirname(holdingPath), { recursive: true });
      renameSync(destinationPath, holdingPath);
    }
    this.failAt('crash-move-after-conflict');

    for (const file of manifest.files) {
      const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      renameSync(sourcePath, destinationPath);
    }
    for (const file of manifest.files) {
      if (!file.restoreConflict || file.restoreConflict.sourceExists === false) continue;
      const holdingPath = this.moveConflictHoldingPath(openLibrary, file.restoreConflict);
      const restorePath = this.folderPath(openLibrary, file.sourceRelativePath);
      mkdirSync(path.dirname(restorePath), { recursive: true });
      renameSync(holdingPath, restorePath);
    }
    this.failAt('crash-move-after-filesystem');

    openLibrary.connection.transaction(() => {
      for (const file of manifest.files) {
        const conflict = file.destinationConflict;
        if (!conflict || conflict.kind !== 'managed' || !conflict.assetId || !conflict.trashFilename) continue;
        const trashRelativePath = `__trash__/${conflict.assetId}/${conflict.trashFilename}`;
        const changed = openLibrary.connection.prepare(
          `UPDATE assets SET relative_file_path = ?, managed_folder_id = NULL, path_identity = ?,
                  deleted_at = ?, trashed_from_relative_path = ?, trashed_from_folder_id = ?, updated_at = ?
            WHERE asset_id = ? AND deleted_at IS NULL`,
        ).run(trashRelativePath, portablePathIdentity(trashRelativePath), now,
          conflict.relativePath, conflict.managedFolderId, now, conflict.assetId);
        if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
        this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
      }
      for (const file of manifest.files) {
        const changed = openLibrary.connection.prepare(
          `UPDATE assets SET relative_file_path = ?, managed_folder_id = ?, path_identity = ?, updated_at = ?
            WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
        ).run(file.destinationRelativePath, file.destinationFolderId,
          portablePathIdentity(file.destinationRelativePath), now, file.assetId);
        if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
        this.syncAssetSearchContent(openLibrary.connection, file.assetId);
      }
      for (const file of manifest.files) {
        const conflict = file.restoreConflict;
        if (!conflict || conflict.kind !== 'managed' || !conflict.assetId) continue;
        const changed = openLibrary.connection.prepare(
          `UPDATE assets SET relative_file_path = ?, managed_folder_id = ?, path_identity = ?,
                  deleted_at = NULL, trashed_from_relative_path = NULL,
                  trashed_from_folder_id = NULL, updated_at = ?
            WHERE asset_id = ? AND deleted_at IS NOT NULL`,
        ).run(conflict.relativePath, conflict.managedFolderId,
          portablePathIdentity(conflict.relativePath), now, conflict.assetId);
        if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
        this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
      }
      if (manifest.originalOperationId) {
        const consumed = openLibrary.connection.prepare(
          `UPDATE file_operations SET error_code = 'UNDONE', updated_at = ?
            WHERE operation_id = ? AND kind = 'managed-move' AND status = 'committed' AND error_code IS NULL`,
        ).run(now, manifest.originalOperationId);
        if (consumed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
      }
      this.failAt('crash-move-before-db-commit');
      jobLease.assertCurrent();
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), operationId);
    })();
    this.failAt('crash-move-after-db-commit');

    if (manifest.kind === 'managed-move-undo') {
      this.removeOperation(operationPath);
      if (manifest.originalOperationId) this.removeOperation(path.join(operationsRoot, manifest.originalOperationId));
    }
  } catch (error) {
    if (error instanceof SimulatedCrashError) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    const row = openLibrary.connection.prepare(
      'SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?',
    ).get(operationId) as OperationRow | undefined;
    if (row?.status === 'committed') {
      this.diagnose('asset.move.post-commit', error, { operationId, libraryId: openLibrary.summary.libraryId });
      return;
    }
    if (row) {
      try {
        this.recoverManagedMoveOperation(openLibrary, row, manifest, operationPath);
      } catch (recoveryError) {
        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'failed', error_code = 'MOVE_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
        ).run(new Date().toISOString(), operationId);
        this.diagnose('asset.move.rollback', recoveryError, { operationId, libraryId: openLibrary.summary.libraryId });
      }
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  } finally {
    jobHeartbeat.stop();
    try {
      jobLease.release();
    } catch (releaseError) {
      this.diagnose('asset.move.lease-release', releaseError, {
        libraryId: openLibrary.summary.libraryId,
        operationId,
      });
    }
  }
}

export function managedMoveConflict(this: LibraryService, openLibrary: OpenLibrary, operationId: string, backupName: string, relativePath: string, excludedAssetId: string): ManagedMoveConflict | null {
  const identity = portablePathIdentity(relativePath);
  const active = openLibrary.connection.prepare(
    `SELECT asset_id, managed_folder_id, relative_file_path FROM assets
      WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL AND asset_id != ?`,
  ).get(identity, excludedAssetId) as {
    asset_id: string;
    managed_folder_id: string | null;
    relative_file_path: string;
  } | undefined;
  const disk = this.portableDiskDestination(openLibrary, relativePath);
  if (!active && !disk) return null;
  // Keep a metadata-only conflict when the DB row remains but its file has
  // disappeared. This lets keep-both/skip proceed and lets replace tombstone
  // the stale row without attempting an impossible filesystem rename.
  if (active && !disk) {
    return {
      assetId: active.asset_id,
      backupName,
      kind: 'managed',
      managedFolderId: active.managed_folder_id,
      operationId,
      relativePath,
      sourceExists: false,
      trashFilename: path.posix.basename(active.relative_file_path),
    };
  }
  if (disk && disk.size < 0) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'UNSUPPORTED_FILE_ENTRY' });
  if (active) {
    return {
      assetId: active.asset_id,
      backupName,
      kind: 'managed',
      managedFolderId: active.managed_folder_id,
      operationId,
      relativePath: disk!.actualRelativePath,
      trashFilename: path.posix.basename(active.relative_file_path),
    };
  }
  return {
    assetId: null,
    backupName,
    kind: 'untracked',
    managedFolderId: null,
    operationId,
    relativePath: disk!.actualRelativePath,
    trashFilename: null,
  };
}

export function availableMoveDestination(this: LibraryService, openLibrary: OpenLibrary, relativePath: string, planned: Set<string>): string {
  const parent = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath);
  const filename = path.posix.basename(relativePath);
  const extension = path.posix.extname(filename);
  const base = extension ? filename.slice(0, -extension.length) : filename;
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const name = `${base} (${index})${extension}`;
    const candidate = parent ? path.posix.join(parent, name) : name;
    const identity = portablePathIdentity(candidate);
    if (planned.has(identity)) continue;
    const dbConflict = openLibrary.connection.prepare(
      "SELECT asset_id FROM assets WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL",
    ).get(identity);
    if (!dbConflict && !this.portableDiskDestination(openLibrary, candidate)) return candidate;
  }
  throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
}

export function moveAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): { movedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  // PF: companion files (e.g. `.xmp`) move with their primary.
  input = { ...input, assetIds: this.withCompanionAssetIds(openLibrary, input.assetIds) };
  // 目标是链接文件夹（链接根或其虚拟子目录）：把 managed 资产复制进链接
  // 外部目录并注册为链接资产，再永久删除已复制的 managed 源——对用户而言
  // 等价于「移动到链接文件夹」，链接资产与 managed 资产同为目标（Serpent-f6f779）。
  const linkedTarget = input.targetFolderId === null
    ? null
    : this.linkedFolderRowForImport(openLibrary, input.targetFolderId);
  if (linkedTarget) {
    const managedSourceCount = sqliteAllInChunks<string, { count: number }>({
      connection: openLibrary.connection,
      values: input.assetIds,
      buildSql: (placeholders) =>
        `SELECT COUNT(*) AS count FROM assets
           WHERE asset_id IN (${placeholders})
             AND location_kind = 'managed' AND deleted_at IS NULL`,
    }).reduce((total, row) => total + row.count, 0);
    if (managedSourceCount !== input.assetIds.length) {
      // 链接资产移动到链接文件夹是另一场景，此处仅支持 managed → linked。
      throw new LibraryServiceError('INVALID_SELECTION');
    }
    const strategy = input.conflictStrategy ?? 'keep-both';
    const copy = this.copyAssetsToLinkedFolder({
      libraryId: input.libraryId,
      folderId: linkedTarget.folder_id,
      ...(linkedTarget.relative_path
        ? { relativePath: linkedTarget.relative_path }
        : {}),
      assetIds: input.assetIds,
      conflictStrategy: strategy,
    });
    // 只删除实际复制成功的源（skip 冲突的源保留在原位）。
    if (copy.copiedSourceAssetIds.length > 0) {
      this.deleteAssetsFromDisk({
        libraryId: input.libraryId,
        assetIds: copy.copiedSourceAssetIds,
      });
    }
    return {
      movedCount: copy.copiedCount,
      skippedCount: copy.skippedCount,
      operationId: null,
      assets: copy.assets,
    };
  }
  const targetFolder = input.targetFolderId === null ? undefined : this.targetFolder(openLibrary, input.targetFolderId);
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    relative_file_path: string;
    managed_folder_id: string | null;
    availability: 'available' | 'missing';
  }>({
    connection: openLibrary.connection,
    values: input.assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path, managed_folder_id, availability FROM assets
        WHERE asset_id IN (${placeholders})
          AND location_kind = 'managed' AND deleted_at IS NULL`,
  });
  const byId = new Map(rows.map((row) => [row.asset_id, row]));
  for (const assetId of input.assetIds) {
    const row = byId.get(assetId);
    if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (row.availability !== 'available') throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }

  const operationId = randomUUID();
  const selectedIds = new Set(input.assetIds);
  const planned = new Set<string>();
  const strategy = input.conflictStrategy ?? 'keep-both';
  const files: ManagedMoveOperationManifest['files'] = [];
  let skippedCount = 0;
  const targetPrefix = targetFolder?.relative_path ?? '';

  for (const assetId of input.assetIds) {
    const row = byId.get(assetId)!;
    if (!realFileExists(this.folderPath(openLibrary, row.relative_file_path))) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    const filename = path.posix.basename(row.relative_file_path);
    let destinationRelativePath = targetPrefix ? path.posix.join(targetPrefix, filename) : filename;
    let identity = portablePathIdentity(destinationRelativePath);
    if (identity === portablePathIdentity(row.relative_file_path)) {
      skippedCount += 1;
      planned.add(identity);
      continue;
    }
    let conflict = this.managedMoveConflict(openLibrary, operationId, String(files.length), destinationRelativePath, assetId);
    const selectedConflict = conflict?.assetId ? selectedIds.has(conflict.assetId) : false;
    const batchConflict = planned.has(identity) || selectedConflict;
    if (batchConflict || conflict) {
      if (strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      if (strategy === 'keep-both' || batchConflict) {
        destinationRelativePath = this.availableMoveDestination(openLibrary, destinationRelativePath, planned);
        identity = portablePathIdentity(destinationRelativePath);
        conflict = null;
      }
    }
    planned.add(identity);
    files.push({
      assetId,
      destinationConflict: strategy === 'replace' ? conflict : null,
      destinationFolderId: targetFolder?.folder_id ?? null,
      destinationRelativePath,
      restoreConflict: null,
      sourceFolderId: row.managed_folder_id,
      sourceRelativePath: row.relative_file_path,
    });
  }

  if (files.length === 0) return { movedCount: 0, skippedCount, operationId: null, assets: [] };
  const manifest: ManagedMoveOperationManifest = {
    files,
    kind: 'managed-move',
    originalOperationId: null,
    version: 4,
  };
  this.applyManagedMoveOperation(openLibrary, operationId, manifest);
  this.noteClientFilesystemMutation();
  this.emitClientAssetsChanged(input.libraryId, files.length, true);
  return { movedCount: files.length, skippedCount, operationId,
    assets: this.managedMoveSummaries(openLibrary, files.map((file) => file.assetId)) };
}

export function undoMoveAssets(this: LibraryService, input: {
    libraryId: string;
    operationId: string;
    conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip';
  }): { undoneCount: number; skippedCount: number; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const operation = openLibrary.connection.prepare(
    `SELECT operation_id, status, manifest_json, error_code FROM file_operations
      WHERE operation_id = ? AND kind = 'managed-move'`,
  ).get(input.operationId) as OperationRow | undefined;
  if (!operation || operation.status !== 'committed' || operation.error_code !== null) {
    throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
  }
  const original = this.parseOperationManifest(operation.manifest_json);
  if (original.version !== 4 || original.kind !== 'managed-move') throw new LibraryServiceError('LIBRARY_CORRUPT');
  const undoOperationId = randomUUID();
  const strategy = input.conflictStrategy ?? 'error';
  const planned = new Set<string>();
  const files: ManagedMoveOperationManifest['files'] = [];
  let skippedCount = 0;

  for (const originalFile of original.files) {
    const current = openLibrary.connection.prepare(
      `SELECT relative_file_path, managed_folder_id, availability FROM assets
        WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
    ).get(originalFile.assetId) as {
      relative_file_path: string;
      managed_folder_id: string | null;
      availability: 'available' | 'missing';
    } | undefined;
    if (!current || current.availability !== 'available' ||
      portablePathIdentity(current.relative_file_path) !== portablePathIdentity(originalFile.destinationRelativePath) ||
      !realFileExists(this.folderPath(openLibrary, current.relative_file_path))) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    if (originalFile.destinationConflict && originalFile.destinationConflict.sourceExists !== false &&
      !realFileExists(this.moveConflictHoldingPath(openLibrary, originalFile.destinationConflict))) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }

    let destinationRelativePath = originalFile.sourceRelativePath;
    let identity = portablePathIdentity(destinationRelativePath);
    let conflict = this.managedMoveConflict(openLibrary, undoOperationId, String(files.length), destinationRelativePath, originalFile.assetId);
    const hasConflict = planned.has(identity) || conflict !== null;
    if (hasConflict && strategy === 'error') throw new LibraryServiceError('ASSET_MOVE_CONFLICT');
    if (hasConflict && strategy === 'skip') {
      skippedCount += 1;
      continue;
    }
    if (hasConflict && strategy === 'keep-both') {
      destinationRelativePath = this.availableMoveDestination(openLibrary, destinationRelativePath, planned);
      identity = portablePathIdentity(destinationRelativePath);
      conflict = null;
    }
    planned.add(identity);
    files.push({
      assetId: originalFile.assetId,
      destinationConflict: strategy === 'replace' ? conflict : null,
      destinationFolderId: originalFile.sourceFolderId,
      destinationRelativePath,
      restoreConflict: originalFile.destinationConflict,
      sourceFolderId: current.managed_folder_id,
      sourceRelativePath: originalFile.destinationRelativePath,
    });
  }

  const manifest: ManagedMoveOperationManifest = {
    files,
    kind: 'managed-move-undo',
    originalOperationId: input.operationId,
    version: 4,
  };
  this.applyManagedMoveOperation(openLibrary, undoOperationId, manifest);
  this.noteClientFilesystemMutation();
  this.emitClientAssetsChanged(input.libraryId, files.length, true);
  return { undoneCount: files.length, skippedCount,
    assets: this.managedMoveSummaries(openLibrary, files.map((file) => file.assetId)) };
}

/**
* REQ-MENU-002 / REQ-LABEL-002: renaming an asset's display name IS renaming
* its real file, so this goes through file-operation semantics. The normal
* automation path still accepts a base name, while the desktop inline editor
* may provide the complete file name and intentionally change the extension.
* A changed extension invalidates the old derived media artifacts so the
* asset is reclassified from its new name.
*
* Crash-safety convention follows trashAssets for single-scope file moves:
* rename on disk first, then one DB transaction (path + FTS sync); on DB
* failure the disk rename is rolled back best-effort. Content is untouched,
* so — exactly like moveAssets/trashAssets — no revision row is recorded.
*/
export function renameAssetFile(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    newBaseName?: string;
    newFileName?: string;
  }): { asset: AssetSummary } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, [input.assetId]);
  if (
    (input.newBaseName === undefined && input.newFileName === undefined) ||
    (input.newBaseName !== undefined && input.newFileName !== undefined)
  ) {
    throw new LibraryServiceError('INVALID_ASSET_FILE_NAME', {
      reason: 'NAME_NOT_SUPPORTED',
    });
  }
  let requestedName: string;
  try {
    requestedName = normalizeAssetFileBaseName(
      input.newFileName ?? input.newBaseName!,
    );
  } catch (error) {
    throw new LibraryServiceError('INVALID_ASSET_FILE_NAME', {
      reason: 'NAME_NOT_SUPPORTED',
      cause: error,
    });
  }

  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path,
              current_revision_id, availability, deleted_at
         FROM assets
        WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  // Trashed, missing, and otherwise unavailable assets are rejected with the
  // same typed shape moveAssets uses for non-available sources.
  if (row.deleted_at !== null || row.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (row.location_kind === 'linked') {
    const linkedFolder = openLibrary.connection
      .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
      .get(row.linked_folder_id) as {
        absolute_root_path: string;
        status: 'available' | 'offline';
      } | undefined;
    if (
      !linkedFolder ||
      linkedFolder.status !== 'available' ||
      this.linkedRootIsGone(linkedFolder.absolute_root_path)
    ) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
  }

  const currentFileName = path.posix.basename(row.relative_file_path);
  const extension = path.posix.extname(currentFileName);
  const newFileName = input.newFileName === undefined
    ? `${requestedName}${extension}`
    : requestedName;
  // The filesystem limit applies to the whole component, not just the base.
  if (Buffer.byteLength(newFileName, 'utf8') > 255) {
    throw new LibraryServiceError('INVALID_ASSET_FILE_NAME', {
      reason: 'NAME_NOT_SUPPORTED',
      cause: new LibraryInputError(
        'INVALID_ASSET_FILE_NAME',
        'File name with its extension must not exceed 255 bytes.',
      ),
    });
  }
  const currentDirectory = path.posix.dirname(row.relative_file_path);
  const newRelativePath =
    currentDirectory === '.' ? newFileName : path.posix.join(currentDirectory, newFileName);

  // Identical target (same spelling, same case): success no-op, nothing on
  // disk or in the DB is touched.
  if (newFileName === currentFileName) {
    const [asset] = this.managedMoveSummaries(openLibrary, [row.asset_id]);
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
    return { asset };
  }

  const sourcePath = row.location_kind === 'managed'
    ? this.folderPath(openLibrary, row.relative_file_path)
    : this.linkedAssetPath(openLibrary, row.linked_folder_id, row.relative_file_path);
  if (!realFileExists(sourcePath)) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }

  // Conflicts are judged by portable (case-folded) identity so a case-only
  // match against a DIFFERENT file is still a conflict on case-insensitive
  // volumes; the source file's own directory entry is exempt, which is what
  // makes a pure case-change rename (a.png -> A.png) possible.
  const newIdentity = portablePathIdentity(newRelativePath);
  const dbConflict = row.location_kind === 'managed'
    ? openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed'
              AND deleted_at IS NULL AND asset_id != ?`,
        )
        .get(newIdentity, row.asset_id)
    : openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE linked_folder_id = ? AND path_identity = ? AND location_kind = 'linked'
              AND deleted_at IS NULL AND asset_id != ?`,
        )
        .get(row.linked_folder_id, newIdentity, row.asset_id);
  if (dbConflict) throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');

  const parentDirectoryPath = path.dirname(sourcePath);
  const targetSegmentIdentity = portablePathSegmentIdentity(newFileName);
  let directoryEntries;
  try {
    directoryEntries = readdirSync(parentDirectoryPath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  for (const entry of directoryEntries) {
    if (entry.name === currentFileName) continue;
    if (portablePathSegmentIdentity(entry.name) === targetSegmentIdentity) {
      throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');
    }
  }

  // PF: companions pair by name, so read them before the primary changes.
  const companionIds = this.companionAssetIds(openLibrary, [row.asset_id]);
  const destinationPath = path.join(parentDirectoryPath, newFileName);
  const now = new Date().toISOString();
  let renamed = false;
  this.noteClientFilesystemMutation();
  try {
    renameSync(sourcePath, destinationPath);
    renamed = true;
    openLibrary.connection.transaction(() => {
      const changed = openLibrary.connection
        .prepare(
          `UPDATE assets
              SET relative_file_path = ?, path_identity = ?, updated_at = ?
            WHERE asset_id = ? AND deleted_at IS NULL`,
        )
        .run(newRelativePath, newIdentity, now, row.asset_id);
      if (changed.changes !== 1) {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
      }
      this.syncAssetSearchContent(openLibrary.connection, row.asset_id);
      if (path.extname(currentFileName).toLowerCase() !== path.extname(newFileName).toLowerCase()) {
        openLibrary.connection
          .prepare(
            `UPDATE revision_artifacts
                SET invalidated_at = ?
              WHERE revision_id = ? AND invalidated_at IS NULL`,
          )
          .run(now, row.current_revision_id);
      }
    })();
  } catch (error) {
    if (renamed) {
      try {
        renameSync(destinationPath, sourcePath);
      } catch (rollbackError) {
        // The DB transaction did not commit; if the filesystem rollback also
        // failed the asset reconciles to 'missing' on the next refresh and
        // can be relinked. Never mask the primary failure.
        this.diagnose('asset.rename-file.rollback', rollbackError, {
          libraryId: input.libraryId,
          assetId: row.asset_id,
        });
      }
    }
    if (isMissingPathError(error)) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND', cause: error });
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  for (const companionId of companionIds) {
    const companion = openLibrary.connection
      .prepare('SELECT relative_file_path FROM assets WHERE asset_id = ? AND deleted_at IS NULL')
      .get(companionId) as { relative_file_path: string } | undefined;
    if (!companion) continue;
    const companionName = path.posix.basename(companion.relative_file_path);
    const companionNewName = renamedCompanionName(companionName, currentFileName, newFileName);
    if (companionNewName === null || companionNewName === companionName) continue;
    try {
      this.renameAssetFile({ libraryId: input.libraryId, assetId: companionId, newFileName: companionNewName });
    } catch (error) {
      // The primary rename stands; the companion keeps its old name.
      this.diagnose('asset.rename-file.companion', error, { libraryId: input.libraryId, assetId: companionId });
    }
  }

  const [asset] = this.managedMoveSummaries(openLibrary, [row.asset_id]);
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId: input.libraryId,
    changedCount: 1,
    missingCount: 0,
    source: 'client',
    nativeDragPathsChanged: true,
  });
  return { asset };
}

/**
* Batch convenience over the crash-safe single-file rename primitive.
* Every successful item has the same disk-first / DB-rollback protection as
* `renameAssetFile`; failures that are local to one item are returned for
* the script to inspect, while an infrastructure failure stops the batch so
* it cannot be mistaken for a normal name conflict.
*/
export function renameAssetFiles(this: LibraryService, input: {
    libraryId: string;
    items: Array<{ assetId: string; newBaseName: string }>;
  }): {
    renamedCount: number;
    skipped: Array<{
      assetId: string;
      reason: 'asset_not_found' | 'asset_unavailable' | 'name_conflict' | 'invalid_name';
    }>;
    assets: AssetSummary[];
  } {
  if (input.items.length === 0 || new Set(input.items.map((item) => item.assetId)).size !== input.items.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const assets: AssetSummary[] = [];
  const skipped: Array<{
    assetId: string;
    reason: 'asset_not_found' | 'asset_unavailable' | 'name_conflict' | 'invalid_name';
  }> = [];
  for (const item of input.items) {
    try {
      assets.push(this.renameAssetFile({
        libraryId: input.libraryId,
        assetId: item.assetId,
        newBaseName: item.newBaseName,
      }).asset);
    } catch (error) {
      if (!(error instanceof LibraryServiceError)) throw error;
      if (error.code === 'ASSET_FILE_NAME_CONFLICT') {
        skipped.push({ assetId: item.assetId, reason: 'name_conflict' });
        continue;
      }
      if (error.code === 'INVALID_ASSET_FILE_NAME') {
        skipped.push({ assetId: item.assetId, reason: 'invalid_name' });
        continue;
      }
      if (error.code === 'ASSET_NOT_FOUND') {
        skipped.push({
          assetId: item.assetId,
          reason: error.reason === 'SOURCE_NOT_FOUND' ? 'asset_unavailable' : 'asset_not_found',
        });
        continue;
      }
      throw error;
    }
  }
  return { renamedCount: assets.length, skipped, assets };
}

/**
* Build the network checkpoint from directory discovery metadata only. It
* deliberately excludes content hashes and database ids: a remote scan
* should detect name/size/mtime changes without reading file contents or
* being invalidated by an unrelated local job/artifact write.
*/
export function networkDiscoveryFingerprint(this: LibraryService, discovery: RefreshManagedAssetsDiscovery): string {
  const hash = createHash('sha1');
  const updateEntries = (
    scope: string,
    entries: readonly DiscoveredSourceEntry[],
  ): void => {
    hash.update(scope);
    hash.update('\u0000');
    for (const entry of [...entries].sort((left, right) => (
      portablePathIdentity(left.relativePath).localeCompare(
        portablePathIdentity(right.relativePath),
      )
    ))) {
      hash.update(portablePathIdentity(entry.relativePath));
      hash.update('\u0000');
      hash.update(String(entry.byteSize));
      hash.update('\u0000');
      hash.update(entry.modifiedAt);
      hash.update('\u0000');
    }
  };
  for (const [folderId, entries] of [...discovery.linkedEntriesByFolder].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    updateEntries(`linked:${folderId}`, entries);
  }
  updateEntries('managed', discovery.managedEntries);
  return hash.digest('hex');
}

/**
* Native watchers report the first write/rename edge, not a completed copy.
* Only changed/new entries pay the extra stat samples; a quiet large library
* therefore does not turn every watcher pass into a second full stat sweep.
* Entries that keep changing are left out of this pass and will be retried
* by the trailing coalesced event, never committed as partial revisions.
*/
export async function waitForStableWatcherDiscovery(this: LibraryService, task: OpenReconciliationTask, discovery: RefreshManagedAssetsDiscovery, existingAssets: ReadonlyArray<{
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      byte_size: number | null;
      modified_at: string | null;
    }>): Promise<void> {
  const stableWindowMs = this.watcherStableFileWindowMs();
  if (stableWindowMs <= 0) return;

  const existingByKey = new Map(
    existingAssets.map((asset) => [
      `${asset.location_kind}\u0000${asset.linked_folder_id ?? ''}\u0000${portablePathIdentity(asset.relative_file_path)}`,
      asset,
    ]),
  );
  type Candidate = {
    entry: DiscoveredSourceEntry;
    absolutePath: string;
    byteSize: number;
    modifiedAt: string;
  };
  const candidates: Candidate[] = [];
  const addCandidates = (
    entries: DiscoveredSourceEntry[],
    locationKind: 'managed' | 'linked',
    linkedFolderId: string | null,
  ): void => {
    for (const entry of entries) {
      const key = `${locationKind}\u0000${linkedFolderId ?? ''}\u0000${portablePathIdentity(entry.relativePath)}`;
      const existing = existingByKey.get(key);
      const unchanged = existing !== undefined
        && existing.byte_size === entry.byteSize
        && Math.abs(Date.parse(existing.modified_at ?? '') - Date.parse(entry.modifiedAt)) <= 1;
      if (unchanged) continue;
      candidates.push({
        entry,
        absolutePath: locationKind === 'linked'
          ? this.linkedAssetPath(task.openLibrary, linkedFolderId, entry.relativePath)
          : this.folderPath(task.openLibrary, entry.relativePath),
        byteSize: entry.byteSize,
        modifiedAt: entry.modifiedAt,
      });
    }
  };
  for (const [folderId, entries] of discovery.linkedEntriesByFolder) {
    addCandidates(entries, 'linked', folderId);
  }
  addCandidates(discovery.managedEntries, 'managed', null);
  if (candidates.length === 0) return;

  let pending = candidates;
  const dropped = new Set<DiscoveredSourceEntry>();
  for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
    await this.waitForWatcherStabilityWindow(task, stableWindowMs);
    const unstable: Candidate[] = [];
    for (let offset = 0; offset < pending.length; offset += 128) {
      this.assertReconciliationActive(task);
      const batch = pending.slice(offset, offset + 128);
      const samples = await Promise.all(batch.map(async (candidate) => {
        try {
          const stat = await lstatAsync(candidate.absolutePath);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            return { candidate, byteSize: null, modifiedAt: null };
          }
          return {
            candidate,
            byteSize: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        } catch {
          return { candidate, byteSize: null, modifiedAt: null };
        }
      }));
      for (const sample of samples) {
        if (!sample || sample.byteSize === null || sample.modifiedAt === null) {
          if (sample) dropped.add(sample.candidate.entry);
          continue;
        }
        const { candidate, byteSize, modifiedAt } = sample;
        if (byteSize !== candidate.byteSize || modifiedAt !== candidate.modifiedAt) {
          candidate.byteSize = byteSize;
          candidate.modifiedAt = modifiedAt;
          candidate.entry.byteSize = byteSize;
          candidate.entry.modifiedAt = modifiedAt;
          unstable.push(candidate);
        }
      }
      await this.yieldReconciliation(task);
    }
    pending = unstable;
  }
  for (const candidate of pending) dropped.add(candidate.entry);
  if (dropped.size === 0) return;

  discovery.managedEntries = discovery.managedEntries.filter((entry) => !dropped.has(entry));
  for (const [folderId, entries] of discovery.linkedEntriesByFolder) {
    discovery.linkedEntriesByFolder.set(
      folderId,
      entries.filter((entry) => !dropped.has(entry)),
    );
  }
  this.diagnose('asset-watcher.unstable-file', new Error('Watcher file did not reach a stable size window.'), {
    libraryId: task.libraryId,
    droppedCount: dropped.size,
  });
}

export function collectManagedAssetDiscovery(this: LibraryService, openLibrary: OpenLibrary): RefreshManagedAssetsDiscovery {
  this.reconcileLinkedFolderStatuses(openLibrary);
  const libraryId = openLibrary.summary.libraryId;
  const linkedEntriesByFolder = new Map<string, DiscoveredSourceEntry[]>();
  const linkedFolderRows = openLibrary.connection
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

  for (const folder of linkedFolderRows) {
    if (this.linkedRootIsGone(folder.absolute_root_path)) continue;
    const rules = this.getLinkedFolderRules({
      libraryId,
      folderId: folder.folder_id,
    });
    const directories: string[] = [];
    linkedEntriesByFolder.set(
      folder.folder_id,
      this.enumerateLinkedSources(
        folder.absolute_root_path,
        folder.folder_id,
        rules,
        (relativePath, pathKind) => this.isExplicitlyIgnored(
          openLibrary,
          'linked',
          folder.folder_id,
          relativePath,
          pathKind,
        ),
        undefined,
        (relativePath) => directories.push(relativePath),
      ),
    );
    this.linkedDirectoryIndex(openLibrary).replace(folder.folder_id, directories);
  }

  return {
    linkedEntriesByFolder,
    managedEntries: this.enumerateManagedSources(
      this.assetsPath(openLibrary),
      (relativePath, pathKind) => this.isExplicitlyIgnored(
        openLibrary,
        'managed',
        null,
        relativePath,
        pathKind,
      ),
    ),
  };
}

export async function collectManagedAssetDiscoveryAsync(this: LibraryService, task: OpenReconciliationTask, options?: { linkedFolderIds?: readonly string[] }): Promise<RefreshManagedAssetsDiscovery> {
  const openLibrary = this.openById.get(task.libraryId);
  if (!openLibrary) throw this.reconciliationAbortError();
  this.assertReconciliationActive(task);
  const linkedFolderIds = options?.linkedFolderIds === undefined
    ? undefined
    : [...new Set(options.linkedFolderIds)];
  const scopedLinkedFolderIds = linkedFolderIds?.length
    ? new Set(linkedFolderIds)
    : undefined;
  this.reconcileLinkedFolderStatuses(openLibrary, scopedLinkedFolderIds);
  const linkedEntriesByFolder = new Map<string, DiscoveredSourceEntry[]>();
  const existingLinkedAssetIdsByFolder = new Map<string, Map<string, string>>();
  const existingManagedAssetIdsByIdentity = new Map<string, string>();
  if (scopedLinkedFolderIds === undefined) {
    for (const row of openLibrary.connection
      .prepare("SELECT asset_id, path_identity FROM assets WHERE location_kind = 'managed'")
      .all() as Array<{ asset_id: string; path_identity: string }>) {
      existingManagedAssetIdsByIdentity.set(row.path_identity, row.asset_id);
    }
  }
  const scopedIds = scopedLinkedFolderIds === undefined
    ? undefined
    : [...scopedLinkedFolderIds];
  const linkedFolderRows = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        WHERE library_id = ?
          ${scopedIds === undefined
            ? ''
            : `AND folder_id IN (${scopedIds.map(() => '?').join(',')})`}`,
    )
    .all(task.libraryId, ...(scopedIds ?? [])) as Array<{
      folder_id: string;
      absolute_root_path: string;
      status: 'available' | 'offline';
    }>;

  for (const [linkedRootIndex, folder] of linkedFolderRows.entries()) {
    this.assertReconciliationActive(task);
    if (this.linkedRootIsGone(folder.absolute_root_path)) continue;
    const rules = this.getLinkedFolderRules({
      libraryId: task.libraryId,
      folderId: folder.folder_id,
    });
    const existingAssetIdsByIdentity = new Map<string, string>();
    for (const row of openLibrary.connection
      .prepare('SELECT asset_id, path_identity FROM assets WHERE linked_folder_id = ?')
      .all(folder.folder_id) as Array<{ asset_id: string; path_identity: string }>) {
      existingAssetIdsByIdentity.set(row.path_identity, row.asset_id);
    }
    existingLinkedAssetIdsByFolder.set(folder.folder_id, existingAssetIdsByIdentity);
    const linkedScanStartedAt = performance.now();
    const directoryIndex = this.linkedDirectoryIndex(openLibrary);
    const directoryVersion = directoryIndex.beginScan(folder.folder_id);
    const directories: string[] = [];
    const entries = await this.enumerateSourcesAsync({
      errorCode: 'INVALID_IMPORT_SOURCE',
      explicitlyIgnored: (relativePath, pathKind) => this.isExplicitlyIgnored(
        openLibrary,
        'linked',
        folder.folder_id,
        relativePath,
        pathKind,
      ) || (
        pathKind === 'asset'
        && this.linkedPathIsIgnored(relativePath, rules)
      ),
      isDirectoryIgnored: (relativePath) => (
        !rules.some((rule) => rule.enabled && rule.action === 'include')
        && this.linkedPathIsIgnored(
          path.posix.join(relativePath, '__serpent_probe__'),
          rules,
        )
      ),
      libraryId: task.libraryId,
      linkedFolderId: folder.folder_id,
      locationKind: 'linked',
      rootPath: folder.absolute_root_path,
      task,
      onDirectory: (relativePath) => directories.push(relativePath),
    });
    await directoryIndex.publish(folder.folder_id, directories, directoryVersion, () => this.yieldReconciliation(task));
    if (process.env.KEEL_REFRESH_STAGE_LOG === '1') {
      this.options.onDiagnostic?.({
        scope: 'open.refresh-managed-assets.source-scan',
        error: null,
        context: {
          libraryId: task.libraryId,
          generation: task.generation,
          reason: task.reason,
          locationKind: 'linked',
          linkedRootIndex,
          linkedRootCount: linkedFolderRows.length,
          scoped: scopedLinkedFolderIds !== undefined,
          entryCount: entries.length,
          durationMs: Math.round((performance.now() - linkedScanStartedAt) * 100) / 100,
        },
      });
    }
    for (const entry of entries) {
      entry.assetId = existingAssetIdsByIdentity.get(portablePathIdentity(entry.relativePath));
    }
    linkedEntriesByFolder.set(folder.folder_id, entries);
    await this.yieldReconciliation(task);
  }

  const managedScanStartedAt = performance.now();
  const managedEntries = scopedLinkedFolderIds === undefined
    ? await this.enumerateSourcesAsync({
        errorCode: 'IMPORT_APPLY_FAILED',
        explicitlyIgnored: (relativePath, pathKind) => this.isExplicitlyIgnored(
          openLibrary,
          'managed',
          null,
          relativePath,
          pathKind,
        ),
        libraryId: task.libraryId,
        locationKind: 'managed',
        rootPath: this.assetsPath(openLibrary),
        task,
      })
    : [];
  if (scopedLinkedFolderIds === undefined && process.env.KEEL_REFRESH_STAGE_LOG === '1') {
    this.options.onDiagnostic?.({
      scope: 'open.refresh-managed-assets.source-scan',
      error: null,
      context: {
        libraryId: task.libraryId,
        generation: task.generation,
        reason: task.reason,
        locationKind: 'managed',
        scoped: false,
        entryCount: managedEntries.length,
        durationMs: Math.round((performance.now() - managedScanStartedAt) * 100) / 100,
      },
    });
  }
  for (const entry of managedEntries) {
    entry.assetId = existingManagedAssetIdsByIdentity.get(portablePathIdentity(entry.relativePath));
  }
  return {
    linkedEntriesByFolder,
    managedEntries,
    ...(scopedLinkedFolderIds === undefined ? {} : { scopedLinkedFolderIds }),
    existingLinkedAssetIdsByFolder,
    existingManagedAssetIdsByIdentity,
  };
}

export async function applyDiscoveredAssetsInBatches(this: LibraryService, task: OpenReconciliationTask, discovery: RefreshManagedAssetsDiscovery): Promise<AssetRefreshResult> {
  const batchSize = this.openById.get(task.libraryId)?.summary.networkStorage ? 16 : 64;
  let changedCount = 0;
  let missingCount = 0;
  const apply = async (entries: DiscoveredSourceEntry[], linkedFolderId?: string): Promise<void> => {
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      this.assertReconciliationActive(task);
      const batch = entries.slice(offset, offset + batchSize);
      const batchDiscovery: RefreshManagedAssetsDiscovery = {
        linkedEntriesByFolder: linkedFolderId === undefined
          ? new Map()
          : new Map([[linkedFolderId, batch]]),
        managedEntries: linkedFolderId === undefined ? batch : [],
        existingLinkedAssetIdsByFolder: discovery.existingLinkedAssetIdsByFolder,
        existingManagedAssetIdsByIdentity: discovery.existingManagedAssetIdsByIdentity,
        movedLinkedAssetsReconciled: true,
      };
      const result = this.refreshManagedAssets(task.libraryId, {
        assetIds: batch.flatMap((entry) => entry.assetId ?? []),
        discovery: batchDiscovery,
      });
      changedCount += result.changedCount;
      missingCount += result.missingCount;
      await this.yieldReconciliation(task);
    }
  };
  for (const [folderId, entries] of discovery.linkedEntriesByFolder) {
    await apply(entries, folderId);
  }
  await apply(discovery.managedEntries);
  return { changedCount, missingCount };
}

export function initializeExistingFolder(this: LibraryService, input: {
    displayName: string;
    selectedParentPath: string;
    libraryId?: string;
    storageLayout?: LibraryStorageLayout;
  }): InternalLibrarySummary {
  if (input.storageLayout === 'assets') throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  const displayName = input.displayName.trim();
  if (!displayName || [...displayName].length > 255) throw new LibraryServiceError('INVALID_LIBRARY_NAME');
  let libraryPath: string;
  try {
    const selectedPath = normalizeAbsolutePath(input.selectedParentPath);
    const stat = lstatSync(selectedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    libraryPath = realpathSync(selectedPath);
    if (libraryPath.split(path.sep).some((segment) => isLibraryMetaDirName(segment))) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    accessSync(libraryPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }
  const metadataPath = libraryMetaDir(libraryPath);
  if (readdirSync(libraryPath).some((name) => isLibraryMetaDirName(name))) {
    throw new LibraryServiceError('LIBRARY_METADATA_EXISTS');
  }
  let connection: DatabaseConnection | undefined;
  let ownsMetadata = false;
  let initialized = false;
  try {
    // Exclusive reservation prevents a second initializer from touching this catalog.
    mkdirSync(metadataPath);
    ownsMetadata = true;
    for (const name of REGENERABLE_DIRECTORIES) mkdirSync(path.join(metadataPath, name));
    writeStorageLayout(libraryPath, 'root');
    connection = openConfiguredDatabase(databasePath(libraryPath), this.options.sqliteBusyTimeoutMsForTests);
    migrateDatabase(connection, true, this.options);
    connection.prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
      .run(input.libraryId ?? randomUUID(), displayName, new Date().toISOString());
    verifyDatabase(connection);
    connection.close();
    connection = undefined;
    initialized = true;
    // Opening starts the regular asynchronous root scan and directory watcher.
    return this.openLibrary(libraryPath);
  } catch (error) {
    closeIgnoringFailure(connection);
    if (ownsMetadata && !initialized) {
      try {
        // Only metadata created by this call is rolled back. Source files stay in place.
        removePathWithSyncRetry(metadataPath);
      } catch (cleanupError) {
        throw new LibraryServiceError('LIBRARY_CLEANUP_FAILED', { cause: cleanupError });
      }
    }
    if (!ownsMetadata && existsSync(metadataPath)) throw new LibraryServiceError('LIBRARY_METADATA_EXISTS');
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

/**
* A Worker can disappear after a recipe changed the filesystem but before
* the history attempt was finalized. The file-operation recovery pass owns
* those byte-level journals; this pass keeps the user-facing history honest
* by making an unfinished transition explicitly stale until a future
* conflict-resolution flow can inspect it.
*/
export function recoverOperationHistoryTransitions(this: LibraryService, openLibrary: OpenLibrary): void {
  const unfinished = openLibrary.connection.prepare(
    `SELECT attempt_id, history_entry_id
       FROM operation_history_attempts
      WHERE status IN ('preparing', 'applying')`,
  ).all() as Array<{ attempt_id: string; history_entry_id: string }>;
  const unfinishedGroups = openLibrary.connection.prepare(
    `SELECT history_entry_id
       FROM operation_history
      WHERE state = 'open'`,
  ).all() as Array<{ history_entry_id: string }>;
  if (unfinished.length === 0 && unfinishedGroups.length === 0) return;
  const now = new Date().toISOString();
  openLibrary.connection.transaction(() => {
    const markEntry = openLibrary.connection.prepare(
      `UPDATE operation_history
          SET state = 'stale', stale_code = 'WORKER_RESTART_DURING_TRANSITION', updated_at = ?
        WHERE history_entry_id = ? AND state IN ('undoing', 'redoing')`,
    );
    const markAttempt = openLibrary.connection.prepare(
      `UPDATE operation_history_attempts
          SET status = 'failed', error_code = 'WORKER_RESTART_DURING_TRANSITION', updated_at = ?
        WHERE attempt_id = ?`,
    );
    for (const attempt of unfinished) {
      markEntry.run(now, attempt.history_entry_id);
      markAttempt.run(now, attempt.attempt_id);
    }
    const markGroup = openLibrary.connection.prepare(
      `UPDATE operation_history
          SET state = 'stale', stale_code = 'WORKER_RESTART_DURING_GROUP', updated_at = ?
        WHERE history_entry_id = ? AND state = 'open'`,
    );
    for (const group of unfinishedGroups) markGroup.run(now, group.history_entry_id);
  })();
  this.diagnose('operation-history.recovered-stale-transition', new Error(
    'An unfinished history transition was marked stale after Worker restart.',
  ), {
    libraryId: openLibrary.summary.libraryId,
    attemptCount: unfinished.length,
    groupCount: unfinishedGroups.length,
  });
}

export function isDatabaseRecoveryFailure(this: LibraryService, error: unknown): boolean {
  return error instanceof LibraryServiceError &&
    (error.code === 'LIBRARY_CORRUPT' || error.code === 'NOT_A_LIBRARY');
}

export function canAttemptDatabaseRecovery(this: LibraryService, libraryPath: string): boolean {
  const keelPath = libraryMetaDir(libraryPath);
  const primaryPath = databasePath(libraryPath);
  // A symlink in the metadata boundary is a path-integrity violation, not
  // ordinary SQLite damage. Never rename or rescue through it; preserve the
  // existing NOT_A_LIBRARY rejection and avoid touching a victim target.
  try {
    if (lstatSync(keelPath).isSymbolicLink() || lstatSync(primaryPath).isSymbolicLink()) {
      return false;
    }
  } catch {
    // Missing metadata is recoverable when Assets and the metadata directory are present;
    // the ladder will decide whether a backup or Assets rescue is possible.
  }
  return realDirectoryExists(managedStoragePath(libraryPath)) &&
    realDirectoryExists(keelPath);
}

export function attachRecoveryNotice(this: LibraryService, summary: InternalLibrarySummary, recovery: NonNullable<InternalLibrarySummary['recovery']>): InternalLibrarySummary {
  const openLibrary = this.openById.get(summary.libraryId);
  if (!openLibrary) return { ...summary, recovery };
  openLibrary.summary = { ...openLibrary.summary, recovery };
  return openLibrary.summary;
}

/**
* Resolve the most recent recovery report for Main's shell action. The
* absolute path stays on the Worker→Main side; Renderer receives only the
* acknowledgement after Main reveals the report in the file manager.
*/
export function getRecoveryReportPath(this: LibraryService, libraryId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const attachedPath = openLibrary.summary.recovery?.reportPath;
  if (attachedPath && realFileExists(attachedPath)) return attachedPath;

  const reportDirectory = libraryMetaDir(openLibrary.summary.libraryPath, 'corrupt-backup',
  );
  const candidates = (() => {
    try {
      return readdirSync(reportDirectory)
        .filter((name) => /^recovery-report-[^/]+\.json$/u.test(name))
        .map((name) => path.join(reportDirectory, name))
        .filter((candidate) => realFileExists(candidate));
    } catch {
      return [];
    }
  })();
  const latest = candidates
    .map((candidate) => {
      try {
        return { candidate, modifiedAt: lstatSync(candidate).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { candidate: string; modifiedAt: number } => entry !== undefined)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (!latest) throw new LibraryServiceError('LIBRARY_NOT_FOUND');
  return latest.candidate;
}

export function renameLibrary(this: LibraryService, input: { libraryId: string; displayName: string }): InternalLibrarySummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const displayName = input.displayName.trim().normalize('NFC');
  if (!displayName || displayName.length > 255 || displayName.includes('/') || displayName.includes('\\')) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  openLibrary.connection.prepare('UPDATE library SET display_name = ? WHERE library_id = ?')
    .run(displayName, input.libraryId);
  openLibrary.summary = { ...openLibrary.summary, displayName };
  return { ...openLibrary.summary };
}

export function removeOwnedTransferPath(this: LibraryService, scope: string, targetPath: string, recursive: boolean): void {
  try {
    rmSync(targetPath, { force: true, recursive });
  } catch (error) {
    this.diagnose(scope, error, { targetPath });
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
      reason: publicReasonFromError(error),
      cause: error,
    });
  }
}
