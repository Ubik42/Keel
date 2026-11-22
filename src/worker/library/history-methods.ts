import { type AssetMetadataResult, type AssetSummary } from "../../shared/asset-types";
import { CONTENT_REPLACE_BATCH_MAX_ITEMS } from "../../shared/content-replace";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { LibraryServiceError, OPERATION_HISTORY_MAX_AUDIT_ENTRIES, OPERATION_HISTORY_MAX_RECIPE_BYTES, OPERATION_HISTORY_STALE_RETENTION_MS, SimulatedCrashError, UUID, isMissingPathError, realDirectoryExists, realFileExists, serviceError, type AssetMetadataHistorySnapshot, type ContentReplaceBatchOperationManifest, type LibraryService, type LinkedTrashOperationManifest, type ManagedCopyOperationManifest, type ManagedFolderHistorySnapshot, type ManagedFolderTrashOperationManifest, type ManagedMoveOperationManifest, type OpenLibrary, type OperationHistoryGroupStepInput, type OperationHistoryRow, type OperationHistoryStepRow, type OperationHistoryTransitionResult, type OperationManifest, type OperationRow, type PersistedOperationManifest, type RecordOperationHistoryInput, type RestoreOperationManifest } from "../library-service";
import { portablePathIdentity } from "./library-rules";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, type LibraryJobLease, type LibraryWriteLeaseHeartbeat } from "./library-write-coordinator";
import { HistoryTransitionError, OperationHistoryStateMachine, historyRecipeSchema, type HistoryDirection, type HistoryEntryState, type HistoryOperationReceipt, type HistoryPolicy, type HistoryRecipe, type HistorySource, type HistoryStackEntry, type HistoryStatus } from "./operation-history";
import { assertRegisteredHistoryRecipe, assertRegisteredHistoryRecipePair } from "./operation-history-recipes";
import { randomUUID } from "node:crypto";
import { constants, copyFileSync, lstatSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface HistoryMethods {
  assertSafeOperationsRoot(...args: Parameters<typeof assertSafeOperationsRoot>): ReturnType<typeof assertSafeOperationsRoot>;
  assertSafeOperationPath(...args: Parameters<typeof assertSafeOperationPath>): ReturnType<typeof assertSafeOperationPath>;
  parseOperationManifest(...args: Parameters<typeof parseOperationManifest>): ReturnType<typeof parseOperationManifest>;
  operationHistoryEntries(...args: Parameters<typeof operationHistoryEntries>): ReturnType<typeof operationHistoryEntries>;
  getOperationHistoryStatus(...args: Parameters<typeof getOperationHistoryStatus>): ReturnType<typeof getOperationHistoryStatus>;
  pruneOperationHistory(...args: Parameters<typeof pruneOperationHistory>): ReturnType<typeof pruneOperationHistory>;
  recordOperationHistory(...args: Parameters<typeof recordOperationHistory>): ReturnType<typeof recordOperationHistory>;
  operationHistoryGroupKey(...args: Parameters<typeof operationHistoryGroupKey>): ReturnType<typeof operationHistoryGroupKey>;
  beginOperationHistoryGroup(...args: Parameters<typeof beginOperationHistoryGroup>): ReturnType<typeof beginOperationHistoryGroup>;
  appendOperationHistoryGroupStep(...args: Parameters<typeof appendOperationHistoryGroupStep>): ReturnType<typeof appendOperationHistoryGroupStep>;
  recordOperationHistoryGroup(...args: Parameters<typeof recordOperationHistoryGroup>): ReturnType<typeof recordOperationHistoryGroup>;
  completeOperationHistoryGroup(...args: Parameters<typeof completeOperationHistoryGroup>): ReturnType<typeof completeOperationHistoryGroup>;
  discardOperationHistoryGroup(...args: Parameters<typeof discardOperationHistoryGroup>): ReturnType<typeof discardOperationHistoryGroup>;
  markOperationHistoryGroupStale(...args: Parameters<typeof markOperationHistoryGroupStale>): ReturnType<typeof markOperationHistoryGroupStale>;
  recordOperationHistoryBarrier(...args: Parameters<typeof recordOperationHistoryBarrier>): ReturnType<typeof recordOperationHistoryBarrier>;
  metadataHistorySnapshot(...args: Parameters<typeof metadataHistorySnapshot>): ReturnType<typeof metadataHistorySnapshot>;
  assertMetadataHistorySnapshot(...args: Parameters<typeof assertMetadataHistorySnapshot>): ReturnType<typeof assertMetadataHistorySnapshot>;
  metadataHistoryMatches(...args: Parameters<typeof metadataHistoryMatches>): ReturnType<typeof metadataHistoryMatches>;
  applyAssetMetadataHistorySnapshot(...args: Parameters<typeof applyAssetMetadataHistorySnapshot>): ReturnType<typeof applyAssetMetadataHistorySnapshot>;
  recordAssetMetadataHistory(...args: Parameters<typeof recordAssetMetadataHistory>): ReturnType<typeof recordAssetMetadataHistory>;
  recordAssetMetadataBatchHistory(...args: Parameters<typeof recordAssetMetadataBatchHistory>): ReturnType<typeof recordAssetMetadataBatchHistory>;
  assertHistoryRelations(...args: Parameters<typeof assertHistoryRelations>): ReturnType<typeof assertHistoryRelations>;
  historyRecipeFromRow(...args: Parameters<typeof historyRecipeFromRow>): ReturnType<typeof historyRecipeFromRow>;
  historyTransitionErrorCode(...args: Parameters<typeof historyTransitionErrorCode>): ReturnType<typeof historyTransitionErrorCode>;
  historyCounterpartRecipe(...args: Parameters<typeof historyCounterpartRecipe>): ReturnType<typeof historyCounterpartRecipe>;
  withHistoryReplay<T>(operation: () => T): T;
  executeHistoryRecipe(...args: Parameters<typeof executeHistoryRecipe>): ReturnType<typeof executeHistoryRecipe>;
  transitionOperationHistory(...args: Parameters<typeof transitionOperationHistory>): ReturnType<typeof transitionOperationHistory>;
  transitionOperationHistoryWithLease(...args: Parameters<typeof transitionOperationHistoryWithLease>): ReturnType<typeof transitionOperationHistoryWithLease>;
  undoOperationHistory(...args: Parameters<typeof undoOperationHistory>): ReturnType<typeof undoOperationHistory>;
  redoOperationHistory(...args: Parameters<typeof redoOperationHistory>): ReturnType<typeof redoOperationHistory>;
  validateAutomationFileOperationPlan(...args: Parameters<typeof validateAutomationFileOperationPlan>): ReturnType<typeof validateAutomationFileOperationPlan>;
  undoCopyAssets(...args: Parameters<typeof undoCopyAssets>): ReturnType<typeof undoCopyAssets>;
  applyManagedCopyOperation(...args: Parameters<typeof applyManagedCopyOperation>): ReturnType<typeof applyManagedCopyOperation>;
}

export function assertSafeOperationsRoot(this: LibraryService, libraryPath: string): string {
  const keelPath = libraryMetaDir(libraryPath);
  if (!realDirectoryExists(keelPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
  const operationsPath = path.join(keelPath, 'operations');
  let operationsEntry;
  try {
    operationsEntry = lstatSync(operationsPath);
  } catch (error) {
    if (isMissingPathError(error)) return operationsPath;
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
  if (!operationsEntry.isDirectory() || operationsEntry.isSymbolicLink()) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const relation = path.relative(realpathSync(keelPath), realpathSync(operationsPath));
  if (relation !== 'operations') throw new LibraryServiceError('LIBRARY_CORRUPT');
  return operationsPath;
}

export function assertSafeOperationPath(this: LibraryService, operationPath: string): void {
  const operationsPath = this.assertSafeOperationsRoot(
    path.dirname(path.dirname(path.dirname(operationPath))),
  );
  const relation = path.relative(operationsPath, operationPath);
  const basename = path.basename(operationPath);
  const uuidCandidate = basename;
  if (
    !UUID.test(uuidCandidate) ||
    relation !== basename ||
    path.isAbsolute(relation)
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  let operationEntry;
  try {
    operationEntry = lstatSync(operationPath);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
  if (!operationEntry.isDirectory() || operationEntry.isSymbolicLink()) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const realRelation = path.relative(realpathSync(operationsPath), realpathSync(operationPath));
  if (realRelation !== path.basename(operationPath)) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  for (const childName of ['stage', 'backup']) {
    const childPath = path.join(operationPath, childName);
    try {
      const child = lstatSync(childPath);
      if (!child.isDirectory() || child.isSymbolicLink()) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      if (!isMissingPathError(error)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
      }
    }
  }
}

export function parseOperationManifest(this: LibraryService, serialized: string): PersistedOperationManifest {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value)
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  if (value.version === 2) {
    const candidate = value as Record<string, unknown>;
    const assetIds = candidate.assetIds;
    const trashedAssetIds = candidate.trashedAssetIds;
    if (
      candidate.kind !== 'linked-trash' ||
      !Array.isArray(assetIds) ||
      !assetIds.every((assetId) => typeof assetId === 'string' && UUID.test(assetId)) ||
      new Set(assetIds).size !== assetIds.length ||
      !Array.isArray(trashedAssetIds) ||
      !trashedAssetIds.every((assetId) => typeof assetId === 'string' && UUID.test(assetId)) ||
      new Set(trashedAssetIds).size !== trashedAssetIds.length ||
      trashedAssetIds.some((assetId) => !assetIds.includes(assetId)) ||
      !('inFlightAssetId' in candidate) ||
      (candidate.inFlightAssetId !== null && (
        typeof candidate.inFlightAssetId !== 'string' ||
        !assetIds.includes(candidate.inFlightAssetId)
      ))
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    return value as unknown as LinkedTrashOperationManifest;
  }
  if (value.version === 3) {
    const candidate = value as Record<string, unknown>;
    if (candidate.kind !== 'restore' || !Array.isArray(candidate.files)) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const assetIds = new Set<string>();
    const backupNames = new Set<string>();
    const destinationIdentities = new Set<string>();
    for (const file of candidate.files) {
      if (typeof file !== 'object' || file === null) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const entry = file as Record<string, unknown>;
      const relativePaths = [entry.destinationRelativePath];
      if (entry.backupDestinationRelativePath !== null) {
        relativePaths.push(entry.backupDestinationRelativePath);
      }
      if (
        typeof entry.assetId !== 'string' || !UUID.test(entry.assetId) ||
        assetIds.has(entry.assetId) ||
        typeof entry.destinationRelativePath !== 'string' ||
        typeof entry.backupName !== 'string' ||
        entry.backupName.length === 0 ||
        backupNames.has(entry.backupName) ||
        path.posix.basename(entry.backupName) !== entry.backupName ||
        path.win32.basename(entry.backupName) !== entry.backupName ||
        typeof entry.trashFilename !== 'string' ||
        entry.trashFilename.length === 0 ||
        path.posix.basename(entry.trashFilename) !== entry.trashFilename ||
        path.win32.basename(entry.trashFilename) !== entry.trashFilename ||
        typeof entry.hadDestination !== 'boolean' ||
        (entry.backupDestinationRelativePath !== null &&
          typeof entry.backupDestinationRelativePath !== 'string') ||
        entry.hadDestination !== (entry.backupDestinationRelativePath !== null) ||
        (entry.conflictingAssetId !== null &&
          (typeof entry.conflictingAssetId !== 'string' || !UUID.test(entry.conflictingAssetId))) ||
        relativePaths.some((relativePath) =>
          typeof relativePath !== 'string' ||
          relativePath.length === 0 ||
          relativePath.includes('\\') ||
          path.posix.isAbsolute(relativePath) ||
          path.posix.normalize(relativePath) !== relativePath ||
          relativePath.split('/').some((segment) => segment === '.' || segment === '..')
        )
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
      if (destinationIdentities.has(destinationIdentity)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      assetIds.add(entry.assetId);
      backupNames.add(entry.backupName);
      destinationIdentities.add(destinationIdentity);
    }
    return value as unknown as RestoreOperationManifest;
  }
  if (value.version === 5) {
    const candidate = value as Record<string, unknown>;
    if (
      (candidate.kind !== 'managed-copy' && candidate.kind !== 'managed-copy-undo') ||
      !Array.isArray(candidate.files) ||
      (candidate.originalOperationId !== null &&
        (typeof candidate.originalOperationId !== 'string' || !UUID.test(candidate.originalOperationId))) ||
      (candidate.kind === 'managed-copy' && candidate.originalOperationId !== null) ||
      (candidate.kind === 'managed-copy-undo' && candidate.originalOperationId === null)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const newAssetIds = new Set<string>();
    const destinationIdentities = new Set<string>();
    const validRelativePath = (relativePath: unknown): relativePath is string =>
      typeof relativePath === 'string' && relativePath.length > 0 &&
      !relativePath.includes('\\') && !path.posix.isAbsolute(relativePath) &&
      path.posix.normalize(relativePath) === relativePath &&
      !relativePath.split('/').some((segment) => segment === '.' || segment === '..');
    const validConflict = (conflict: unknown): boolean => {
      if (conflict === null) return true;
      if (typeof conflict !== 'object') return false;
      const entry = conflict as Record<string, unknown>;
      return (entry.kind === 'managed' || entry.kind === 'untracked') &&
        validRelativePath(entry.relativePath) &&
        typeof entry.backupName === 'string' && entry.backupName.length > 0 &&
        path.posix.basename(entry.backupName) === entry.backupName &&
        path.win32.basename(entry.backupName) === entry.backupName &&
        (entry.assetId === null || (typeof entry.assetId === 'string' && UUID.test(entry.assetId))) &&
        (entry.managedFolderId === null || (typeof entry.managedFolderId === 'string' && UUID.test(entry.managedFolderId))) &&
        typeof entry.operationId === 'string' && UUID.test(entry.operationId) &&
        (entry.trashFilename === null || (
          typeof entry.trashFilename === 'string' && entry.trashFilename.length > 0 &&
          path.posix.basename(entry.trashFilename) === entry.trashFilename &&
          path.win32.basename(entry.trashFilename) === entry.trashFilename
        )) &&
        (entry.sourceExists === undefined || typeof entry.sourceExists === 'boolean') &&
        (entry.kind !== 'managed' || (entry.assetId !== null && entry.trashFilename !== null));
    };
    for (const file of candidate.files) {
      if (typeof file !== 'object' || file === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
      const entry = file as Record<string, unknown>;
      if (
        typeof entry.sourceAssetId !== 'string' || !UUID.test(entry.sourceAssetId) ||
        typeof entry.newAssetId !== 'string' || !UUID.test(entry.newAssetId) ||
        newAssetIds.has(entry.newAssetId) ||
        !validRelativePath(entry.sourceRelativePath) || !validRelativePath(entry.destinationRelativePath) ||
        (entry.destinationFolderId !== null &&
          (typeof entry.destinationFolderId !== 'string' || !UUID.test(entry.destinationFolderId))) ||
        !validConflict(entry.destinationConflict)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
      if (destinationIdentities.has(destinationIdentity)) throw new LibraryServiceError('LIBRARY_CORRUPT');
      newAssetIds.add(entry.newAssetId);
      destinationIdentities.add(destinationIdentity);
    }
    return value as unknown as ManagedCopyOperationManifest;
  }
  if (value.version === 6) {
    const candidate = value as Record<string, unknown>;
    if (
      candidate.kind !== 'content-replace-batch' ||
      !Array.isArray(candidate.files) ||
      candidate.files.length === 0 ||
      candidate.files.length > CONTENT_REPLACE_BATCH_MAX_ITEMS
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const assetIds = new Set<string>();
    const destinationIdentities = new Set<string>();
    const validRelativePath = (relativePath: unknown): relativePath is string =>
      typeof relativePath === 'string' && relativePath.length > 0 &&
      !relativePath.includes('\\') && !path.posix.isAbsolute(relativePath) &&
      path.posix.normalize(relativePath) === relativePath &&
      !relativePath.split('/').some((segment) => segment === '.' || segment === '..');
    for (const file of candidate.files) {
      if (typeof file !== 'object' || file === null) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const entry = file as Record<string, unknown>;
      if (
        typeof entry.assetId !== 'string' || !UUID.test(entry.assetId) || assetIds.has(entry.assetId) ||
        !validRelativePath(entry.destinationRelativePath) ||
        typeof entry.backupName !== 'string' || path.posix.basename(entry.backupName) !== entry.backupName ||
        path.win32.basename(entry.backupName) !== entry.backupName ||
        typeof entry.stageName !== 'string' || path.posix.basename(entry.stageName) !== entry.stageName ||
        path.win32.basename(entry.stageName) !== entry.stageName ||
        typeof entry.newRevisionId !== 'string' || !UUID.test(entry.newRevisionId) ||
        typeof entry.originalModifiedAt !== 'string' || !Number.isFinite(Date.parse(entry.originalModifiedAt)) ||
        typeof entry.originalSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.originalSha256) ||
        typeof entry.previousRevisionId !== 'string' || !UUID.test(entry.previousRevisionId) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
      if (destinationIdentities.has(destinationIdentity)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      assetIds.add(entry.assetId);
      destinationIdentities.add(destinationIdentity);
    }
    return value as unknown as ContentReplaceBatchOperationManifest;
  }
  if (value.version === 7) {
    const candidate = value as Record<string, unknown>;
    const validId = (entry: unknown): entry is string => typeof entry === 'string' && UUID.test(entry);
    const validRelativePath = (entry: unknown): entry is string =>
      typeof entry === 'string'
      && entry.length > 0
      && !entry.includes('\\')
      && !path.posix.isAbsolute(entry)
      && path.posix.normalize(entry) === entry
      && !entry.split('/').some((segment) => segment === '.' || segment === '..');
    const validFolder = (entry: unknown): boolean => {
      if (typeof entry !== 'object' || entry === null) return false;
      const folder = entry as Record<string, unknown>;
      return validId(folder.folderId)
        && typeof folder.name === 'string'
        && (folder.parentFolderId === null || validId(folder.parentFolderId))
        && validRelativePath(folder.relativePath)
        && folder.pathIdentity === portablePathIdentity(folder.relativePath);
    };
    const validTombstone = (entry: unknown): boolean => {
      if (typeof entry !== 'object' || entry === null) return false;
      const tombstone = entry as Record<string, unknown>;
      return validId(tombstone.tombstoneId)
        && validId(tombstone.folderId)
        && validRelativePath(tombstone.relativePath)
        && (tombstone.parentRelativePath === null || validRelativePath(tombstone.parentRelativePath))
        && typeof tombstone.name === 'string'
        && Number.isInteger(tombstone.trashedAssetCount)
        && (tombstone.trashedAssetCount as number) >= 0;
    };
    if (
      candidate.kind !== 'folder-trash'
      || !Array.isArray(candidate.assetIds)
      || !candidate.assetIds.every(validId)
      || new Set(candidate.assetIds).size !== candidate.assetIds.length
      || (candidate.assetOperationId !== null && !validId(candidate.assetOperationId))
      || !validFolder(candidate.folder)
      || !Array.isArray(candidate.descendants)
      || !candidate.descendants.every(validFolder)
      || !Array.isArray(candidate.tombstones)
      || !candidate.tombstones.every(validTombstone)
      || typeof candidate.trashedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.trashedAt))
      || !['prepared', 'assets-trashed', 'tombstones-written', 'filesystem-staged', 'db-committed'].includes(String(candidate.phase))
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    return value as unknown as ManagedFolderTrashOperationManifest;
  }
  if (value.version === 4) {
    const candidate = value as Record<string, unknown>;
    if (
      (candidate.kind !== 'managed-move' && candidate.kind !== 'managed-move-undo') ||
      !Array.isArray(candidate.files) ||
      (candidate.originalOperationId !== null &&
        (typeof candidate.originalOperationId !== 'string' || !UUID.test(candidate.originalOperationId))) ||
      (candidate.kind === 'managed-move' && candidate.originalOperationId !== null) ||
      (candidate.kind === 'managed-move-undo' && candidate.originalOperationId === null)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const assetIds = new Set<string>();
    const destinationIdentities = new Set<string>();
    const validRelativePath = (relativePath: unknown): relativePath is string =>
      typeof relativePath === 'string' && relativePath.length > 0 &&
      !relativePath.includes('\\') && !path.posix.isAbsolute(relativePath) &&
      path.posix.normalize(relativePath) === relativePath &&
      !relativePath.split('/').some((segment) => segment === '.' || segment === '..');
    const validConflict = (conflict: unknown): boolean => {
      if (conflict === null) return true;
      if (typeof conflict !== 'object') return false;
      const entry = conflict as Record<string, unknown>;
      return (entry.kind === 'managed' || entry.kind === 'untracked') &&
        validRelativePath(entry.relativePath) &&
        typeof entry.backupName === 'string' && entry.backupName.length > 0 &&
        path.posix.basename(entry.backupName) === entry.backupName &&
        path.win32.basename(entry.backupName) === entry.backupName &&
        (entry.assetId === null || (typeof entry.assetId === 'string' && UUID.test(entry.assetId))) &&
        (entry.managedFolderId === null || (typeof entry.managedFolderId === 'string' && UUID.test(entry.managedFolderId))) &&
        typeof entry.operationId === 'string' && UUID.test(entry.operationId) &&
        (entry.trashFilename === null || (
          typeof entry.trashFilename === 'string' && entry.trashFilename.length > 0 &&
          path.posix.basename(entry.trashFilename) === entry.trashFilename &&
          path.win32.basename(entry.trashFilename) === entry.trashFilename
        )) &&
        (entry.sourceExists === undefined || typeof entry.sourceExists === 'boolean') &&
        (entry.kind !== 'managed' || (entry.assetId !== null && entry.trashFilename !== null));
    };
    for (const file of candidate.files) {
      if (typeof file !== 'object' || file === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
      const entry = file as Record<string, unknown>;
      if (
        typeof entry.assetId !== 'string' || !UUID.test(entry.assetId) || assetIds.has(entry.assetId) ||
        !validRelativePath(entry.sourceRelativePath) || !validRelativePath(entry.destinationRelativePath) ||
        (entry.sourceFolderId !== null && (typeof entry.sourceFolderId !== 'string' || !UUID.test(entry.sourceFolderId))) ||
        (entry.destinationFolderId !== null && (typeof entry.destinationFolderId !== 'string' || !UUID.test(entry.destinationFolderId))) ||
        !validConflict(entry.destinationConflict) || !validConflict(entry.restoreConflict)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
      if (destinationIdentities.has(destinationIdentity)) throw new LibraryServiceError('LIBRARY_CORRUPT');
      assetIds.add(entry.assetId);
      destinationIdentities.add(destinationIdentity);
    }
    return value as unknown as ManagedMoveOperationManifest;
  }
  if (
    value.version !== 1 ||
    !('files' in value) ||
    !Array.isArray(value.files) ||
    !('directories' in value) ||
    !Array.isArray(value.directories)
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  for (const file of value.files) {
    if (
      typeof file !== 'object' ||
      file === null ||
      !('destinationRelativePath' in file) ||
      typeof file.destinationRelativePath !== 'string' ||
      !('stageName' in file) ||
      typeof file.stageName !== 'string' ||
      path.basename(file.stageName) !== file.stageName ||
      !('backupName' in file) ||
      typeof file.backupName !== 'string' ||
      path.basename(file.backupName) !== file.backupName ||
      !('hadDestination' in file) ||
      typeof file.hadDestination !== 'boolean'
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  }
  for (const directory of value.directories) {
    if (
      typeof directory !== 'object' ||
      directory === null ||
      !('relativePath' in directory) ||
      typeof directory.relativePath !== 'string' ||
      !('existed' in directory) ||
      typeof directory.existed !== 'boolean'
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  }
  return value as unknown as OperationManifest;
}

export function operationHistoryEntries(this: LibraryService, openLibrary: OpenLibrary): HistoryStackEntry[] {
  const rows = openLibrary.connection
    .prepare(
      `SELECT history_entry_id, source, source_reference, label_key,
              label_args_json, policy, state, stale_code, affected_count,
              applied_sequence, redo_sequence, created_at, updated_at
         FROM operation_history
        ORDER BY applied_sequence`,
    )
    .all() as OperationHistoryRow[];
  return rows.map((row) => {
    let labelArgs: Record<string, string | number>;
    try {
      const parsed: unknown = JSON.parse(row.label_args_json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('History label arguments must be an object.');
      }
      labelArgs = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) =>
          typeof value === 'string' || typeof value === 'number',
        ),
      ) as Record<string, string | number>;
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    return {
      historyEntryId: row.history_entry_id,
      source: row.source,
      sourceReference: row.source_reference,
      labelKey: row.label_key,
      labelArgs,
      policy: row.policy,
      state: row.state,
      staleCode: row.stale_code,
      affectedCount: row.affected_count,
      appliedSequence: row.applied_sequence,
      redoSequence: row.redo_sequence,
    } satisfies HistoryStackEntry;
  });
}

export function getOperationHistoryStatus(this: LibraryService, libraryId: string): HistoryStatus {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return new OperationHistoryStateMachine(this.operationHistoryEntries(openLibrary)).status(libraryId);
}

/**
* Retain the active linear stack, but discard audit rows that are no longer
* reachable after a newer barrier or have been stale past the retention
* window.  Current applied/undone entries and in-flight attempts are never
* eligible; large snapshot operations have a separate admission limit.
*/
export function pruneOperationHistory(this: LibraryService, openLibrary: OpenLibrary): void {
  const rows = openLibrary.connection.prepare(
    `SELECT history_entry_id, policy, state, applied_sequence, updated_at
       FROM operation_history
      ORDER BY applied_sequence`,
  ).all() as Array<{
    history_entry_id: string;
    policy: HistoryPolicy;
    state: HistoryEntryState;
    applied_sequence: number;
    updated_at: string;
  }>;
  if (rows.length <= OPERATION_HISTORY_MAX_AUDIT_ENTRIES) {
    const cutoff = Date.now() - OPERATION_HISTORY_STALE_RETENTION_MS;
    if (!rows.some((row) => row.state === 'stale' && Date.parse(row.updated_at) < cutoff)) return;
  }
  const latestBarrierSequence = rows
    .filter((row) => row.policy === 'barrier' && row.state === 'applied')
    .at(-1)?.applied_sequence ?? -Infinity;
  const cutoff = Date.now() - OPERATION_HISTORY_STALE_RETENTION_MS;
  const deletable = rows.filter((row) =>
    (row.policy === 'barrier' && row.applied_sequence < latestBarrierSequence)
    || (row.state === 'stale' && Date.parse(row.updated_at) < cutoff),
  );
  const excess = Math.max(0, rows.length - OPERATION_HISTORY_MAX_AUDIT_ENTRIES);
  const candidates = deletable
    .slice(0, Math.max(excess, deletable.length > 0 ? 1 : 0));
  if (candidates.length === 0) return;
  openLibrary.connection.transaction(() => {
    const remove = openLibrary.connection.prepare(
      'DELETE FROM operation_history WHERE history_entry_id = ?',
    );
    for (const row of candidates) remove.run(row.history_entry_id);
  })();
}

/**
* Persist a semantic mutation as one history group. Callers provide only
* versioned recipe payloads; arbitrary SQL, filesystem paths and functions
* are intentionally not accepted by this boundary.
*/
export function recordOperationHistory(this: LibraryService, input: RecordOperationHistoryInput): HistoryOperationReceipt {
  const source = input.source ?? 'desktop';
  const groupKey = input.sourceReference === null || input.sourceReference === undefined
    ? undefined
    : this.operationHistoryGroupKey(input.libraryId, source, input.sourceReference);
  const historyEntryId = groupKey === undefined ? undefined : this.openOperationHistoryGroups.get(groupKey);
  if (historyEntryId !== undefined) {
    return this.appendOperationHistoryGroupStep({
      historyEntryId,
      input: { ...input, source },
    });
  }
  return this.recordOperationHistoryGroup({
    ...input,
    source,
    steps: [{
      commandId: input.commandId,
      forwardRecipe: input.forwardRecipe,
      inverseRecipe: input.inverseRecipe,
      affectedEntities: input.affectedEntities,
    }],
  });
}

export function operationHistoryGroupKey(this: LibraryService, libraryId: string, source: HistorySource, sourceReference: string): string {
  return `${libraryId}\u0000${source}\u0000${sourceReference}`;
}

/**
* Begin an automation-owned group before its first mutation is dispatched.
* The durable row is materialized by appendOperationHistoryGroupStep(), not
* here. A group that performs no mutation therefore leaves no empty history
* entry and does not advance the file-operation plan fence.
*/
export function beginOperationHistoryGroup(this: LibraryService, input: {
    libraryId: string;
    source: HistorySource;
    sourceReference: string;
  }): HistoryOperationReceipt {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const key = this.operationHistoryGroupKey(input.libraryId, input.source, input.sourceReference);
  const existingId = this.openOperationHistoryGroups.get(key);
  if (existingId !== undefined) {
    const existing = openLibrary.connection.prepare(
      "SELECT history_entry_id FROM operation_history WHERE history_entry_id = ? AND state = 'open'",
    ).get(existingId) as { history_entry_id: string } | undefined;
    if (existing !== undefined) {
      return { historyEntryId: existing.history_entry_id, undoable: false, redoable: false, policy: 'reversible' };
    }
    // A freshly-begun group is intentionally not present in the table yet.
    // Reuse that reservation instead of creating a second in-memory group.
    return { historyEntryId: existingId, undoable: false, redoable: false, policy: 'reversible' };
  }
  const historyEntryId = randomUUID();
  this.openOperationHistoryGroups.set(key, historyEntryId);
  return { historyEntryId, undoable: false, redoable: false, policy: 'reversible' };
}

export function appendOperationHistoryGroupStep(this: LibraryService, input: {
    historyEntryId: string;
    input: RecordOperationHistoryInput;
  }): HistoryOperationReceipt {
  const openLibrary = this.requireOpenLibrary(input.input.libraryId);
  const forward = historyRecipeSchema.parse(input.input.forwardRecipe);
  const inverse = historyRecipeSchema.parse(input.input.inverseRecipe);
  try {
    assertRegisteredHistoryRecipePair(forward, inverse);
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
  const updatedAt = new Date().toISOString();
  const affectedEntities = input.input.affectedEntities ?? [];
  openLibrary.connection.transaction(() => {
    const row = openLibrary.connection.prepare(
      "SELECT source, source_reference, state FROM operation_history WHERE history_entry_id = ?",
    ).get(input.historyEntryId) as { source: HistorySource; source_reference: string | null; state: HistoryEntryState } | undefined;
    const expectedSource = input.input.source ?? 'desktop';
    const expectedSourceReference = input.input.sourceReference ?? null;
    if (row !== undefined && (row.state !== 'open'
      || row.source !== expectedSource
      || row.source_reference !== expectedSourceReference)) {
      throw new LibraryServiceError('HISTORY_ENTRY_NOT_FOUND');
    }
    if (row === undefined) {
      // This is the first real step of a reserved execution group. Only now
      // does history metadata become durable and advance the library change
      // sequence; the file plan was checked before this mutation is
      // recorded.
      const appliedSequence = ((openLibrary.connection
        .prepare('SELECT COALESCE(MAX(applied_sequence), 0) AS sequence FROM operation_history')
        .get() as { sequence: number }).sequence) + 1;
      openLibrary.connection.prepare("DELETE FROM operation_history WHERE state = 'undone'").run();
      openLibrary.connection.prepare(
        `INSERT INTO operation_history
           (history_entry_id, source, source_reference, label_key, label_args_json,
            policy, state, applied_sequence, redo_sequence, stale_code,
            affected_count, created_at, updated_at)
         VALUES (?, ?, ?, 'history.automation.script', ?, 'reversible', 'open', ?, 0, NULL, 0, ?, ?)`,
      ).run(
        input.historyEntryId,
        expectedSource,
        expectedSourceReference,
        JSON.stringify({ commands: 0 }),
        appliedSequence,
        updatedAt,
        updatedAt,
      );
    }
    const step = openLibrary.connection.prepare(
      `SELECT COALESCE(MAX(ordinal), -1) AS ordinal
         FROM operation_history_steps
        WHERE history_entry_id = ?`,
    ).get(input.historyEntryId) as { ordinal: number };
    openLibrary.connection.prepare(
      `INSERT INTO operation_history_steps
         (history_step_id, history_entry_id, ordinal, command_id, recipe_kind,
          recipe_version, forward_payload_json, inverse_payload_json,
          affected_entities_json, current_direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'forward')`,
    ).run(
      randomUUID(),
      input.historyEntryId,
      step.ordinal + 1,
      input.input.commandId,
      forward.kind,
      forward.version,
      JSON.stringify(forward),
      JSON.stringify(inverse),
      JSON.stringify(affectedEntities),
    );
    openLibrary.connection.prepare(
      `UPDATE operation_history
          SET affected_count = affected_count + ?,
              label_args_json = ?, updated_at = ?
        WHERE history_entry_id = ?`,
    ).run(
      input.input.affectedCount,
      JSON.stringify({ commands: step.ordinal + 2 }),
      updatedAt,
      input.historyEntryId,
    );
  })();
  return {
    historyEntryId: input.historyEntryId,
    undoable: false,
    redoable: false,
    policy: 'reversible',
  };
}

/**
* Persist one user intent with one or more ordered Worker-owned steps.
* `open` is written before a caller starts an external filesystem phase;
* callers must complete or discard it after the phase.  A Worker restart
* marks an unfinished group stale, so an interrupted batch is never exposed
* as a successful undo target.
*/
export function recordOperationHistoryGroup(this: LibraryService, input: Omit<RecordOperationHistoryInput, 'forwardRecipe' | 'inverseRecipe'> & {
    commit?: boolean;
    steps: readonly OperationHistoryGroupStepInput[];
  }): HistoryOperationReceipt {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (this.historyReplayDepth > 0) {
    return {
      historyEntryId: input.sourceReference ?? 'history-replay',
      undoable: false,
      redoable: false,
      policy: input.policy ?? 'reversible',
    };
  }
  if (input.steps.length === 0) throw new LibraryServiceError('LIBRARY_CORRUPT');
  if (!Number.isSafeInteger(input.affectedCount) || input.affectedCount < 0) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const steps = input.steps.map((step) => {
    const forward = historyRecipeSchema.parse(step.forwardRecipe);
    const inverse = historyRecipeSchema.parse(step.inverseRecipe);
    try {
      assertRegisteredHistoryRecipePair(forward, inverse);
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    return {
      ...step,
      forward,
      inverse,
      affectedEntities: step.affectedEntities ?? [],
    };
  });
  const historyEntryId = randomUUID();
  const now = new Date().toISOString();
  const appliedSequence = ((openLibrary.connection
    .prepare('SELECT COALESCE(MAX(applied_sequence), 0) AS sequence FROM operation_history')
    .get() as { sequence: number }).sequence) + 1;
  const policy = input.policy ?? 'reversible';
  const source = input.source ?? 'desktop';
  const labelArgs = input.labelArgs ?? {};
  const affectedEntities = input.affectedEntities ?? [];
  const labelArgsJson = JSON.stringify(labelArgs);
  const affectedEntitiesJson = JSON.stringify(affectedEntities);
  const serializedSteps = steps.map((step) => ({
    forwardJson: JSON.stringify(step.forward),
    inverseJson: JSON.stringify(step.inverse),
    affectedEntitiesJson: JSON.stringify(step.affectedEntities),
  }));
  const historyBytes = serializedSteps.reduce((total, step) => total
    + Buffer.byteLength(step.forwardJson, 'utf8')
    + Buffer.byteLength(step.inverseJson, 'utf8')
    + Buffer.byteLength(step.affectedEntitiesJson, 'utf8'), 0);
  if (
    historyBytes > OPERATION_HISTORY_MAX_RECIPE_BYTES
    || Buffer.byteLength(labelArgsJson, 'utf8') + Buffer.byteLength(affectedEntitiesJson, 'utf8') > OPERATION_HISTORY_MAX_RECIPE_BYTES
  ) {
    throw new LibraryServiceError('HISTORY_TOO_LARGE');
  }
  openLibrary.connection.transaction(() => {
    // A new forward mutation starts a new branch after undo. Keeping the
    // branch out of the table also prevents it from being mistaken for a
    // redo target after restart.
    openLibrary.connection.prepare("DELETE FROM operation_history WHERE state = 'undone'").run();
    openLibrary.connection.prepare(
      `INSERT INTO operation_history
         (history_entry_id, source, source_reference, label_key, label_args_json,
          policy, state, applied_sequence, redo_sequence, stale_code,
          affected_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 0, NULL, ?, ?, ?)`,
    ).run(
      historyEntryId,
      source,
      input.sourceReference ?? null,
      input.labelKey,
      labelArgsJson,
      policy,
      appliedSequence,
      input.affectedCount,
      now,
      now,
    );
    const insertStep = openLibrary.connection.prepare(
      `INSERT INTO operation_history_steps
         (history_step_id, history_entry_id, ordinal, command_id, recipe_kind,
          recipe_version, forward_payload_json, inverse_payload_json,
          affected_entities_json, current_direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'forward')`,
    );
    steps.forEach((step, ordinal) => {
      const serialized = serializedSteps[ordinal]!;
      insertStep.run(
        randomUUID(),
        historyEntryId,
        ordinal,
        step.commandId,
        step.forward.kind,
        step.forward.version,
        // Persist the complete versioned recipe, not only its payload. Undo
        // and redo both validate the kind/version against the Worker-owned
        // registry before executing it.
        serialized.forwardJson,
        serialized.inverseJson,
        serialized.affectedEntitiesJson,
      );
    });
  })();
  if (input.commit !== false) this.completeOperationHistoryGroup(input.libraryId, historyEntryId);
  try {
    this.pruneOperationHistory(openLibrary);
  } catch (error) {
    // Retention is best-effort housekeeping; it must not turn a committed
    // user mutation into an apparent failure.
    this.diagnose('operation-history.retention', error, {
      libraryId: input.libraryId,
    });
  }
  const status = this.getOperationHistoryStatus(input.libraryId);
  return {
    historyEntryId,
    undoable: status.undoTop?.historyEntryId === historyEntryId,
    redoable: false,
    policy,
  };
}

export function completeOperationHistoryGroup(this: LibraryService, libraryId: string, historyEntryId: string): HistoryOperationReceipt {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const stepCount = (openLibrary.connection.prepare(
    'SELECT COUNT(*) AS count FROM operation_history_steps WHERE history_entry_id = ?',
  ).get(historyEntryId) as { count: number }).count;
  if (stepCount === 0) {
    this.discardOperationHistoryGroup(libraryId, historyEntryId);
    return { historyEntryId, undoable: false, redoable: false, policy: 'reversible' };
  }
  const updatedAt = new Date().toISOString();
  const result = openLibrary.connection.prepare(
    "UPDATE operation_history SET state = 'applied', updated_at = ?, stale_code = NULL WHERE history_entry_id = ? AND state = 'open'",
  ).run(updatedAt, historyEntryId);
  if (result.changes === 0) throw new LibraryServiceError('HISTORY_ENTRY_NOT_FOUND');
  for (const [key, id] of this.openOperationHistoryGroups) {
    if (id === historyEntryId) this.openOperationHistoryGroups.delete(key);
  }
  const status = this.getOperationHistoryStatus(libraryId);
  return {
    historyEntryId,
    undoable: status.undoTop?.historyEntryId === historyEntryId,
    redoable: false,
    policy: 'reversible',
  };
}

export function discardOperationHistoryGroup(this: LibraryService, libraryId: string, historyEntryId: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  openLibrary.connection.prepare(
    "DELETE FROM operation_history WHERE history_entry_id = ? AND state = 'open'",
  ).run(historyEntryId);
  for (const [key, id] of this.openOperationHistoryGroups) {
    if (id === historyEntryId) this.openOperationHistoryGroups.delete(key);
  }
}

export function markOperationHistoryGroupStale(this: LibraryService, libraryId: string, historyEntryId: string, staleCode: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  openLibrary.connection.prepare(
    "UPDATE operation_history SET state = 'stale', stale_code = ?, updated_at = ? WHERE history_entry_id = ? AND state = 'open'",
  ).run(staleCode, new Date().toISOString(), historyEntryId);
}

export function recordOperationHistoryBarrier(this: LibraryService, input: {
    affectedCount: number;
    affectedEntities?: readonly string[];
    commandId: string;
    libraryId: string;
    labelKey: string;
    reason: string;
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
    affectedEntities: input.affectedEntities,
    policy: 'barrier',
    forwardRecipe: {
      kind: 'history-barrier',
      version: 1,
      payload: { reason: input.reason },
    },
    inverseRecipe: {
      kind: 'history-barrier',
      version: 1,
      payload: { reason: input.reason },
    },
  });
}

export function metadataHistorySnapshot(this: LibraryService, metadata: AssetMetadataResult): AssetMetadataHistorySnapshot {
  return {
    assetId: metadata.assetId,
    description: metadata.description,
    rating: metadata.rating,
    favorite: metadata.favorite,
    palette: metadata.palette,
    sourcePageUrl: metadata.sourcePageUrl,
    author: metadata.author,
    entityVersion: metadata.entityVersion,
    updatedAt: metadata.updatedAt,
  };
}

export function assertMetadataHistorySnapshot(this: LibraryService, value: unknown): AssetMetadataHistorySnapshot {
  if (typeof value !== 'object' || value === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
  const candidate = value as Partial<AssetMetadataHistorySnapshot>;
  if (
    typeof candidate.assetId !== 'string'
    || (candidate.description !== null && typeof candidate.description !== 'string')
    || typeof candidate.rating !== 'number'
    || typeof candidate.favorite !== 'boolean'
    || (candidate.palette !== null && typeof candidate.palette !== 'string')
    || (candidate.sourcePageUrl !== null && typeof candidate.sourcePageUrl !== 'string')
    || (candidate.author !== null && typeof candidate.author !== 'string')
    || !Number.isInteger(candidate.entityVersion)
    || typeof candidate.updatedAt !== 'string'
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  return candidate as AssetMetadataHistorySnapshot;
}

export function metadataHistoryMatches(this: LibraryService, current: AssetMetadataResult, expected: AssetMetadataHistorySnapshot): boolean {
  const snapshot = this.metadataHistorySnapshot(current);
  return snapshot.assetId === expected.assetId
    && snapshot.description === expected.description
    && snapshot.rating === expected.rating
    && snapshot.favorite === expected.favorite
    && snapshot.palette === expected.palette
    && snapshot.sourcePageUrl === expected.sourcePageUrl
    && snapshot.author === expected.author
    && snapshot.entityVersion === expected.entityVersion;
}

export function applyAssetMetadataHistorySnapshot(this: LibraryService, openLibrary: OpenLibrary, expected: AssetMetadataHistorySnapshot, restore: AssetMetadataHistorySnapshot): void {
  const current = this.getAssetMetadata({
    libraryId: openLibrary.summary.libraryId,
    assetId: expected.assetId,
  });
  if (!this.metadataHistoryMatches(current, expected)) {
    throw new LibraryServiceError('VERSION_CONFLICT', {
      currentEntityVersion: current.entityVersion,
    });
  }
  const now = new Date().toISOString();
  if (restore.entityVersion === 0) {
    openLibrary.connection.prepare('DELETE FROM asset_metadata WHERE asset_id = ?').run(restore.assetId);
  } else {
    openLibrary.connection.prepare(
      `INSERT INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, author, entity_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         description = excluded.description,
         rating = excluded.rating,
         favorite = excluded.favorite,
         palette = excluded.palette,
         source_page_url = excluded.source_page_url,
         author = excluded.author,
         entity_version = excluded.entity_version,
         updated_at = excluded.updated_at`,
    ).run(
      restore.assetId,
      restore.description,
      restore.rating,
      restore.favorite ? 1 : 0,
      restore.palette,
      restore.sourcePageUrl,
      restore.author,
      restore.entityVersion,
      // The operation itself is the new write; preserve the logical
      // snapshot version but refresh its wall-clock timestamp.
      now,
    );
  }
  this.syncAssetSearchContent(openLibrary.connection, restore.assetId);
}

export function recordAssetMetadataHistory(this: LibraryService, input: {
    after: AssetMetadataResult;
    before: AssetMetadataResult;
    libraryId: string;
    source?: HistorySource;
    sourceReference?: string | null;
  }): HistoryOperationReceipt {
  const before = this.metadataHistorySnapshot(input.before);
  const after = this.metadataHistorySnapshot(input.after);
  return this.recordOperationHistory({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: 'asset.metadata.set',
    labelKey: 'history.asset.metadata.set',
    labelArgs: { count: 1 },
    affectedCount: 1,
    affectedEntities: [after.assetId],
    forwardRecipe: {
      kind: 'asset-metadata-snapshot',
      version: 1,
      payload: { assetId: after.assetId, expected: before, restore: after },
    },
    inverseRecipe: {
      kind: 'asset-metadata-snapshot',
      version: 1,
      payload: { assetId: after.assetId, expected: after, restore: before },
    },
  });
}

export function recordAssetMetadataBatchHistory(this: LibraryService, input: {
    after: AssetMetadataResult[];
    before: AssetMetadataResult[];
    libraryId: string;
    source?: HistorySource;
    sourceReference?: string | null;
  }): HistoryOperationReceipt | null {
  if (input.after.length === 0) return null;
  const before = input.before.map((item) => this.metadataHistorySnapshot(item));
  const after = input.after.map((item) => this.metadataHistorySnapshot(item));
  const recipe = (expected: AssetMetadataHistorySnapshot[], restore: AssetMetadataHistorySnapshot[]): HistoryRecipe => ({
    kind: 'asset-metadata-batch-snapshot',
    version: 1,
    payload: { expected, restore },
  });
  return this.recordOperationHistory({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: 'asset.metadata.set-many',
    labelKey: 'history.asset.metadata.set-many',
    labelArgs: { count: after.length },
    affectedCount: after.length,
    affectedEntities: after.map((item) => item.assetId),
    forwardRecipe: recipe(before, after),
    inverseRecipe: recipe(after, before),
  });
}

export function assertHistoryRelations(this: LibraryService, value: unknown): Array<{ assetId: string; tagId: string }> {
  if (!Array.isArray(value)) throw new LibraryServiceError('LIBRARY_CORRUPT');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const relation = item as { assetId?: unknown; tagId?: unknown };
    if (typeof relation.assetId !== 'string' || typeof relation.tagId !== 'string') {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    return { assetId: relation.assetId, tagId: relation.tagId };
  });
}

export function historyRecipeFromRow(this: LibraryService, row: OperationHistoryStepRow, direction: HistoryDirection): HistoryRecipe {
  try {
    const parsed: unknown = JSON.parse(
      direction === 'undo' ? row.inverse_payload_json : row.forward_payload_json,
    );
    const recipe = historyRecipeSchema.parse(parsed);
    assertRegisteredHistoryRecipe(recipe);
    return recipe;
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
}

export function historyTransitionErrorCode(this: LibraryService, error: unknown): string | null {
  if (error instanceof LibraryServiceError) {
    return error.code === 'ASSET_MOVE_CONFLICT'
      || error.code === 'FOLDER_NAME_CONFLICT'
      || error.code === 'ASSET_NOT_FOUND'
      || error.code === 'VERSION_CONFLICT'
      ? error.code
      : null;
  }
  return null;
}

/**
* File/folder transitions allocate a fresh durable journal/tombstone id on
* every replay.  Persist the newly allocated counterpart on the opposite
* side of the step; otherwise a second undo after redo would point at a
* consumed operation from the original forward commit.
*/
export function historyCounterpartRecipe(this: LibraryService, recipe: HistoryRecipe, operationId: string, direction: HistoryDirection): HistoryRecipe | null {
  // A fresh file-operation/tombstone identifier is only a counterpart for
  // the direction that just executed.  In particular, undoing an
  // asset-restore runs `asset-trash`; that new trash operation must not
  // replace the original `asset-restore` forward recipe.  The original
  // asset IDs are enough to find the newly-created tombstone on redo.
  if (direction === 'undo') {
    return recipe.kind === 'managed-folder-trash'
      ? { kind: 'managed-folder-restore', version: 1, payload: { tombstoneId: operationId } }
      : null;
  }

  const kind = recipe.kind === 'managed-asset-move' || recipe.kind === 'managed-asset-move-undo'
    ? 'managed-asset-move-undo'
    : recipe.kind === 'managed-asset-copy' || recipe.kind === 'managed-asset-copy-undo'
      ? 'managed-asset-copy-undo'
      : recipe.kind === 'asset-trash' || recipe.kind === 'asset-trash-undo'
        ? 'asset-trash-undo'
        : recipe.kind === 'managed-folder-trash' || recipe.kind === 'managed-folder-restore'
          ? 'managed-folder-restore'
          : null;
  return kind === null
    ? null
    : { kind, version: 1, payload: kind === 'managed-folder-restore'
      ? { tombstoneId: operationId }
      : { operationId } };
}

export function withHistoryReplay<T>(this: LibraryService, operation: () => T): T {
  this.historyReplayDepth += 1;
  try {
    return operation();
  } finally {
    this.historyReplayDepth -= 1;
  }
}

export function executeHistoryRecipe(this: LibraryService, openLibrary: OpenLibrary, recipe: HistoryRecipe): { affectedCount: number; operationId?: string } {
  const payload = recipe.payload;
  switch (recipe.kind) {
    case 'managed-asset-move': {
      const result = this.withHistoryReplay(() => this.moveAssets({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
        targetFolderId: payload.targetFolderId as string | null,
        conflictStrategy: payload.conflictStrategy as 'keep-both' | 'replace' | 'skip' | undefined,
      }));
      return { affectedCount: result.movedCount, operationId: result.operationId ?? undefined };
    }
    case 'managed-asset-move-undo': {
      const result = this.withHistoryReplay(() => this.undoMoveAssets({
        libraryId: openLibrary.summary.libraryId,
        operationId: payload.operationId as string,
        conflictStrategy: payload.conflictStrategy as 'error' | 'keep-both' | 'replace' | 'skip' | undefined,
      }));
      return { affectedCount: result.undoneCount };
    }
    case 'managed-asset-copy': {
      const result = this.withHistoryReplay(() => this.copyAssets({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
        outputAssetIds: Array.isArray(payload.outputAssetIds)
          ? payload.outputAssetIds as Array<{ sourceAssetId: string; newAssetId: string }>
          : undefined,
        targetFolderId: payload.targetFolderId as string | null,
        conflictStrategy: payload.conflictStrategy as 'keep-both' | 'replace' | 'skip' | undefined,
      }));
      return { affectedCount: result.copiedCount, operationId: result.operationId ?? undefined };
    }
    case 'managed-asset-copy-undo': {
      const result = this.withHistoryReplay(() => this.undoCopyAssets({
        libraryId: openLibrary.summary.libraryId,
        operationId: payload.operationId as string,
        conflictStrategy: payload.conflictStrategy as 'error' | 'keep-both' | 'replace' | 'skip' | undefined,
      }));
      return { affectedCount: result.undoneCount };
    }
    case 'asset-trash': {
      const result = this.withHistoryReplay(() => this.trashAssets({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
      }));
      return { affectedCount: result.trashedCount, operationId: result.operationId ?? undefined };
    }
    case 'asset-trash-undo': {
      const result = this.withHistoryReplay(() => this.undoTrashAssets({
        libraryId: openLibrary.summary.libraryId,
        operationId: payload.operationId as string,
        requireAll: true,
      }));
      return { affectedCount: result.restoredCount };
    }
    case 'asset-restore': {
      if (!Array.isArray(payload.assetIds) || payload.assetIds.some((assetId) => typeof assetId !== 'string')) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const result = this.withHistoryReplay(() => this.restoreAssets({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
        targetFolderId: typeof payload.targetFolderId === 'string' || payload.targetFolderId === null
          ? payload.targetFolderId
          : undefined,
        conflictStrategy: payload.conflictStrategy === 'keep-both'
          || payload.conflictStrategy === 'replace'
          || payload.conflictStrategy === 'skip'
          ? payload.conflictStrategy
          : undefined,
      }));
      return { affectedCount: result.restoredCount, operationId: result.operationId };
    }
    case 'asset-rename': {
      if (Array.isArray(payload.items)) {
        let renamedCount = 0;
        for (const item of payload.items) {
          if (typeof item !== 'object' || item === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
          const candidate = item as { assetId?: unknown; newBaseName?: unknown };
          if (typeof candidate.assetId !== 'string' || typeof candidate.newBaseName !== 'string') {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
          const assetId = candidate.assetId;
          const newBaseName = candidate.newBaseName;
          if (typeof (item as { expectedBaseName?: unknown }).expectedBaseName === 'string'
            && this.getAssetFileBaseName({
              libraryId: openLibrary.summary.libraryId,
              assetId,
            }) !== (item as { expectedBaseName: string }).expectedBaseName) {
            throw new LibraryServiceError('VERSION_CONFLICT');
          }
          this.withHistoryReplay(() => this.renameAssetFile({
            libraryId: openLibrary.summary.libraryId,
            assetId,
            newBaseName,
          }));
          renamedCount += 1;
        }
        return { affectedCount: renamedCount };
      }
      if (typeof payload.assetId !== 'string'
        || (typeof payload.newBaseName !== 'string'
          && typeof payload.newFileName !== 'string')) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const assetId = payload.assetId;
      const result = typeof payload.newFileName === 'string'
        ? (() => {
          const newFileName = payload.newFileName as string;
          if (typeof payload.expectedFileName === 'string'
            && this.getAssetFileName({
              libraryId: openLibrary.summary.libraryId,
              assetId,
            }) !== payload.expectedFileName) {
            throw new LibraryServiceError('VERSION_CONFLICT');
          }
          return this.withHistoryReplay(() => this.renameAssetFile({
            libraryId: openLibrary.summary.libraryId,
            assetId,
            newFileName,
          }));
        })()
        : (() => {
          const newBaseName = payload.newBaseName as string;
          if (typeof payload.expectedBaseName === 'string'
            && this.getAssetFileBaseName({
              libraryId: openLibrary.summary.libraryId,
              assetId,
            }) !== payload.expectedBaseName) {
            throw new LibraryServiceError('VERSION_CONFLICT');
          }
          return this.withHistoryReplay(() => this.renameAssetFile({
            libraryId: openLibrary.summary.libraryId,
            assetId,
            newBaseName,
          }));
        })();
      return { affectedCount: result.asset ? 1 : 0 };
    }
    case 'asset-metadata-snapshot': {
      const expected = this.assertMetadataHistorySnapshot(payload.expected);
      const restore = this.assertMetadataHistorySnapshot(payload.restore);
      this.applyAssetMetadataHistorySnapshot(openLibrary, expected, restore);
      return { affectedCount: 1 };
    }
    case 'asset-metadata-batch-snapshot': {
      if (!Array.isArray(payload.expected) || !Array.isArray(payload.restore)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const expected = payload.expected.map((item) => this.assertMetadataHistorySnapshot(item));
      const restore = payload.restore.map((item) => this.assertMetadataHistorySnapshot(item));
      if (expected.length !== restore.length) throw new LibraryServiceError('LIBRARY_CORRUPT');
      for (let index = 0; index < expected.length; index += 1) {
        this.applyAssetMetadataHistorySnapshot(openLibrary, expected[index]!, restore[index]!);
      }
      return { affectedCount: expected.length };
    }
    case 'tag-assign': {
      const result = this.withHistoryReplay(() => this.assignTags({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
        tagIds: payload.tagIds as string[],
      }));
      return { affectedCount: result.assignedCount };
    }
    case 'tag-remove': {
      const result = this.withHistoryReplay(() => this.removeTags({
        libraryId: openLibrary.summary.libraryId,
        assetIds: payload.assetIds as string[],
        tagIds: payload.tagIds as string[],
      }));
      return { affectedCount: result.removedCount };
    }
    case 'tag-relations-add': {
      const relations = this.assertHistoryRelations(payload.relations);
      this.applyTagRelations(openLibrary, relations, 'add', typeof payload.expectedPresent === 'boolean' ? payload.expectedPresent : undefined);
      return { affectedCount: relations.length };
    }
    case 'tag-relations-remove': {
      const relations = this.assertHistoryRelations(payload.relations);
      this.applyTagRelations(openLibrary, relations, 'remove', typeof payload.expectedPresent === 'boolean' ? payload.expectedPresent : undefined);
      return { affectedCount: relations.length };
    }
    case 'managed-folder-snapshot': {
      const expected = this.assertManagedFolderHistorySnapshots(payload.expected);
      const restore = this.assertManagedFolderHistorySnapshots(payload.restore);
      const current = this.getManagedFolderHistorySnapshot({
        libraryId: openLibrary.summary.libraryId,
        folderIds: [...new Set([...expected, ...restore].map((item) => item.folderId))],
        allowMissing: true,
      });
      const normalize = (items: readonly ManagedFolderHistorySnapshot[]) => items
        .map((item) => JSON.stringify(item)).sort();
      if (JSON.stringify(normalize(current)) !== JSON.stringify(normalize(expected))) {
        throw new LibraryServiceError('VERSION_CONFLICT');
      }
      const expectedIds = new Set(expected.map((item) => item.folderId));
      const restoreIds = new Set(restore.map((item) => item.folderId));
      for (const item of expected
        .filter((candidate) => !restoreIds.has(candidate.folderId))
        .sort((left, right) => right.relativePath.length - left.relativePath.length)) {
        this.applyManagedFolderDeleteHistorySnapshot(openLibrary, [item]);
      }
      for (const item of restore
        .filter((candidate) => !expectedIds.has(candidate.folderId))
        .sort((left, right) => left.relativePath.length - right.relativePath.length)) {
        this.applyManagedFolderCreateHistorySnapshot(openLibrary, item);
      }
      return { affectedCount: restore.length };
    }
    case 'managed-folder-rename': {
      if (typeof payload.folderId !== 'string' || typeof payload.newName !== 'string') {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const folderId = payload.folderId;
      const newName = payload.newName;
      if (typeof payload.expectedName === 'string') {
        const current = this.getManagedFolderHistorySnapshot({
          libraryId: openLibrary.summary.libraryId,
          folderIds: [folderId],
        }).find((item) => item.folderId === folderId);
        if (!current || current.name !== payload.expectedName) {
          throw new LibraryServiceError('VERSION_CONFLICT');
        }
      }
      const folder = this.withHistoryReplay(() => this.renameManagedFolder({
        libraryId: openLibrary.summary.libraryId,
        folderId,
        newName,
      }));
      return { affectedCount: folder.folderId ? 1 : 0 };
    }
    case 'managed-folder-move': {
      if (!Array.isArray(payload.moves)) throw new LibraryServiceError('LIBRARY_CORRUPT');
      let movedCount = 0;
      for (const item of payload.moves) {
        if (typeof item !== 'object' || item === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
        const move = item as {
          folderId?: unknown;
          expectedName?: unknown;
          expectedParentFolderId?: unknown;
          targetParentFolderId?: unknown;
          targetName?: unknown;
        };
        if (
          typeof move.folderId !== 'string'
          || (move.targetParentFolderId !== null && typeof move.targetParentFolderId !== 'string')
          || typeof move.targetName !== 'string'
        ) throw new LibraryServiceError('LIBRARY_CORRUPT');
        const folderId = move.folderId;
        const targetName = move.targetName;
        if (typeof move.expectedName === 'string' || move.expectedParentFolderId === null || typeof move.expectedParentFolderId === 'string') {
          const current = this.getManagedFolderHistorySnapshot({
            libraryId: openLibrary.summary.libraryId,
            folderIds: [folderId],
          }).find((item) => item.folderId === folderId);
          if (!current
            || (typeof move.expectedName === 'string' && current.name !== move.expectedName)
            || ((move.expectedParentFolderId === null || typeof move.expectedParentFolderId === 'string')
              && current.parentFolderId !== move.expectedParentFolderId)) {
            throw new LibraryServiceError('VERSION_CONFLICT');
          }
        }
        const result = this.withHistoryReplay(() => this.moveManagedFolders({
          libraryId: openLibrary.summary.libraryId,
          folderIds: [folderId],
          targetParentFolderId: move.targetParentFolderId as string | null,
          conflictStrategy: 'skip',
        }));
        if (result.movedCount === 0) throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
        const moved = result.folders[0];
        if (!moved) throw new LibraryServiceError('FOLDER_NOT_FOUND');
        if (moved.name !== move.targetName) {
          this.withHistoryReplay(() => this.renameManagedFolder({
            libraryId: openLibrary.summary.libraryId,
            folderId,
            newName: targetName,
          }));
        }
        movedCount += 1;
      }
      return { affectedCount: movedCount };
    }
    case 'managed-folder-trash': {
      if (typeof payload.folderId !== 'string') throw new LibraryServiceError('LIBRARY_CORRUPT');
      const folderId = payload.folderId;
      const result = this.withHistoryReplay(() => this.trashManagedFolder({
        libraryId: openLibrary.summary.libraryId,
        folderId,
      }));
      return {
        affectedCount: result.removedFolderCount,
        operationId: result.rootTombstoneId,
      };
    }
    case 'managed-folder-restore': {
      if (typeof payload.tombstoneId !== 'string') throw new LibraryServiceError('LIBRARY_CORRUPT');
      const tombstoneId = payload.tombstoneId;
      const result = this.withHistoryReplay(() => this.restoreTrashedManagedFolder({
        libraryId: openLibrary.summary.libraryId,
        tombstoneId,
      }));
      return { affectedCount: result.restoredFolderCount };
    }
    case 'tag-snapshot': {
      const expected = this.assertTagHistorySnapshots(payload.expected);
      const restore = this.assertTagHistorySnapshots(payload.restore);
      this.applyTagHistorySnapshot(openLibrary, expected, restore);
      return { affectedCount: restore.length };
    }
    case 'history-barrier':
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    default:
      throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
}

export function transitionOperationHistory(this: LibraryService, libraryId: string, direction: HistoryDirection, expectedHistoryEntryId: string): OperationHistoryTransitionResult {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const entries = this.operationHistoryEntries(openLibrary);
  if (entries.some((entry) => entry.state === 'undoing' || entry.state === 'redoing')) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  }
  const machine = new OperationHistoryStateMachine(entries);
  if (machine.isCompleted(direction, expectedHistoryEntryId)) {
    return {
      historyEntryId: expectedHistoryEntryId,
      direction,
      affectedCount: 0,
      status: this.getOperationHistoryStatus(libraryId),
    };
  }
  const started = machine.begin(direction, expectedHistoryEntryId);
  const now = new Date().toISOString();
  const attemptId = randomUUID();
  const steps = openLibrary.connection.prepare(
    `SELECT history_step_id, history_entry_id, ordinal, command_id, recipe_kind,
            recipe_version, forward_payload_json, inverse_payload_json,
            affected_entities_json, current_direction
       FROM operation_history_steps
      WHERE history_entry_id = ?
      ORDER BY ordinal`,
  ).all(expectedHistoryEntryId) as OperationHistoryStepRow[];
  if (steps.length === 0) throw new LibraryServiceError('LIBRARY_CORRUPT');
  openLibrary.connection.transaction(() => {
    openLibrary.connection.prepare(
      `INSERT INTO operation_history_attempts
         (attempt_id, history_entry_id, direction, status, next_step_ordinal,
          error_code, created_at, updated_at)
       VALUES (?, ?, ?, 'preparing', 0, NULL, ?, ?)`,
    ).run(attemptId, expectedHistoryEntryId, direction, now, now);
    openLibrary.connection.prepare(
      'UPDATE operation_history SET state = ?, updated_at = ? WHERE history_entry_id = ?',
    ).run(started.state, now, expectedHistoryEntryId);
    openLibrary.connection.prepare(
      "UPDATE operation_history_attempts SET status = 'applying', updated_at = ? WHERE attempt_id = ?",
    ).run(now, attemptId);
  })();

  try {
    const orderedSteps = direction === 'undo' ? [...steps].reverse() : steps;
    let affectedCount = 0;
    for (const [index, step] of orderedSteps.entries()) {
      const recipe = this.historyRecipeFromRow(step, direction);
      const executed = this.executeHistoryRecipe(openLibrary, recipe);
      affectedCount += executed.affectedCount;
      const counterpart = executed.operationId
        ? this.historyCounterpartRecipe(recipe, executed.operationId, direction)
        : null;
      const nowForStep = new Date().toISOString();
      openLibrary.connection.transaction(() => {
        if (counterpart) {
          const column = direction === 'undo' ? 'forward_payload_json' : 'inverse_payload_json';
          openLibrary.connection.prepare(
            `UPDATE operation_history_steps
                SET ${column} = ?, current_direction = ?
              WHERE history_step_id = ?`,
          ).run(
            JSON.stringify(counterpart),
            direction === 'undo' ? 'inverse' : 'forward',
            step.history_step_id,
          );
        } else {
          openLibrary.connection.prepare(
            'UPDATE operation_history_steps SET current_direction = ? WHERE history_step_id = ?',
          ).run(direction === 'undo' ? 'inverse' : 'forward', step.history_step_id);
        }
        openLibrary.connection.prepare(
          'UPDATE operation_history_attempts SET next_step_ordinal = ?, updated_at = ? WHERE attempt_id = ?',
        ).run(index + 1, nowForStep, attemptId);
      })();
    }
    const stableState = direction === 'undo' ? 'undone' : 'applied';
    const updatedAt = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      const redoSequence = direction === 'undo'
        ? ((openLibrary.connection
          .prepare('SELECT COALESCE(MAX(redo_sequence), 0) AS sequence FROM operation_history')
          .get() as { sequence: number }).sequence + 1)
        : 0;
      openLibrary.connection.prepare(
        `UPDATE operation_history
            SET state = ?, redo_sequence = ?, updated_at = ?, stale_code = NULL
          WHERE history_entry_id = ?`,
      ).run(stableState, redoSequence, updatedAt, expectedHistoryEntryId);
      openLibrary.connection.prepare(
        "UPDATE operation_history_attempts SET status = 'committed', next_step_ordinal = ?, updated_at = ? WHERE attempt_id = ?",
      ).run(steps.length, updatedAt, attemptId);
    })();
    return {
        historyEntryId: expectedHistoryEntryId,
        direction,
        affectedCount,
        status: this.getOperationHistoryStatus(libraryId),
      };
  } catch (error) {
    // A recipe can touch both SQLite and the managed file tree.  Without a
    // durable compensation pass we cannot prove that an unexpected error
    // left every step untouched, so never advertise the entry as safely
    // reversible again.  Known precondition conflicts retain their precise
    // code; unknown failures are conservatively surfaced as stale.
    const staleCode = this.historyTransitionErrorCode(error) ?? 'HISTORY_TRANSITION_FAILED';
    const failedState = 'stale';
    const updatedAt = new Date().toISOString();
    try {
        openLibrary.connection.transaction(() => {
          openLibrary.connection.prepare(
            `UPDATE operation_history
                SET state = ?, redo_sequence = 0, stale_code = ?, updated_at = ?
              WHERE history_entry_id = ?`,
          ).run(failedState, staleCode, updatedAt, expectedHistoryEntryId);
        openLibrary.connection.prepare(
          "UPDATE operation_history_attempts SET status = 'failed', error_code = ?, updated_at = ? WHERE attempt_id = ?",
        ).run(staleCode ?? 'HISTORY_TRANSITION_FAILED', updatedAt, attemptId);
      })();
    } catch (recoveryError) {
      this.diagnose('operation-history.transition-finalize', recoveryError, {
        libraryId,
        historyEntryId: expectedHistoryEntryId,
        direction,
      });
    }
    if (error instanceof HistoryTransitionError) throw error;
    throw new HistoryTransitionError(
      'The history entry became stale while Keel was applying the transition.',
      'HISTORY_STALE',
    );
  }
}

export async function transitionOperationHistoryWithLease(this: LibraryService, input: { libraryId: string; expectedHistoryEntryId: string }, direction: HistoryDirection): Promise<OperationHistoryTransitionResult> {
  const lease = await this.acquireWriteLease(input.libraryId);
  try {
    return this.transitionOperationHistory(input.libraryId, direction, input.expectedHistoryEntryId);
  } finally {
    try {
      lease.release();
    } catch (error) {
      this.diagnose('operation-history.lease-release', error, {
        libraryId: input.libraryId,
        direction,
      });
    }
  }
}

export function undoOperationHistory(this: LibraryService, input: { libraryId: string; expectedHistoryEntryId: string }): Promise<OperationHistoryTransitionResult> {
  return this.transitionOperationHistoryWithLease(input, 'undo');
}

export function redoOperationHistory(this: LibraryService, input: { libraryId: string; expectedHistoryEntryId: string }): Promise<OperationHistoryTransitionResult> {
  return this.transitionOperationHistoryWithLease(input, 'redo');
}

export function validateAutomationFileOperationPlan(this: LibraryService, input: {
    libraryId: string;
    operation: 'trash' | 'replace-content' | 'move' | 'rename-file' | 'rename-files' | 'restore-if-original-vacant';
    assetIds: string[];
    newBaseName?: string;
    newFileName?: string;
    renameItems?: Array<{ assetId: string; newBaseName: string }>;
    targetFolderId?: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
    expectedChangeSequence: number;
    planHash: string;
    assetStates: Array<{ assetId: string; stateToken: string }>;
  }): void {
  const assetStateIds = input.assetStates.map((state) => state.assetId);
  if (input.assetIds.length === 0
    || input.assetIds.some((assetId) => assetId.length === 0)
    || new Set(input.assetIds).size !== input.assetIds.length
    || input.assetStates.length !== input.assetIds.length
    || new Set(assetStateIds).size !== assetStateIds.length
    || assetStateIds.some((assetId) => !input.assetIds.includes(assetId))) {
    throw new LibraryServiceError('AUTOMATION_FILE_PLAN_INVALID');
  }
  const plan = this.previewAutomationFileOperation({
    libraryId: input.libraryId,
    operation: input.operation,
    assetIds: input.assetIds,
    ...(input.newBaseName === undefined ? {} : { newBaseName: input.newBaseName }),
    ...(input.newFileName === undefined ? {} : { newFileName: input.newFileName }),
    ...(input.renameItems === undefined ? {} : { renameItems: input.renameItems }),
    ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
    ...(input.conflictStrategy === undefined ? {} : { conflictStrategy: input.conflictStrategy }),
  });
  if (plan.changeSequence !== input.expectedChangeSequence
    || plan.planHash !== input.planHash
    || plan.assetStates.some((state, index) => (
      state.assetId !== input.assetStates[index]?.assetId
      || state.stateToken !== input.assetStates[index]?.stateToken
    ))) {
    throw new LibraryServiceError('VERSION_CONFLICT', {
      currentEntityVersion: plan.changeSequence,
    });
  }
}

export function undoCopyAssets(this: LibraryService, input: {
    libraryId: string;
    operationId: string;
    conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip';
  }): { undoneCount: number; skippedCount: number; assets: AssetSummary[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const operation = openLibrary.connection.prepare(
    `SELECT operation_id, status, manifest_json, error_code FROM file_operations
      WHERE operation_id = ? AND kind = 'managed-copy'`,
  ).get(input.operationId) as OperationRow | undefined;
  if (!operation || operation.status !== 'committed' || operation.error_code !== null) {
    throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
  }
  const original = this.parseOperationManifest(operation.manifest_json);
  if (original.version !== 5 || original.kind !== 'managed-copy') {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const strategy = input.conflictStrategy ?? 'error';
  const toDelete: string[] = [];
  let skippedCount = 0;

  for (const file of original.files) {
    const current = openLibrary.connection.prepare(
      `SELECT relative_file_path, availability FROM assets
        WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
    ).get(file.newAssetId) as {
      relative_file_path: string;
      availability: 'available' | 'missing';
    } | undefined;
    const pathMatches = current
      && portablePathIdentity(current.relative_file_path)
        === portablePathIdentity(file.destinationRelativePath);
    if (!current || current.availability !== 'available' || !pathMatches) {
      if (strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    if (!realFileExists(this.folderPath(openLibrary, current.relative_file_path))) {
      if (strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    toDelete.push(file.newAssetId);
  }

  if (toDelete.length === 0) {
    return { undoneCount: 0, skippedCount, assets: [] };
  }

  const summaries = this.managedMoveSummaries(openLibrary, toDelete);
  this.deleteActiveManagedAssetsFromDisk(openLibrary, toDelete);
  const now = new Date().toISOString();
  const consumed = openLibrary.connection.prepare(
    `UPDATE file_operations SET error_code = 'UNDONE', updated_at = ?
      WHERE operation_id = ? AND kind = 'managed-copy' AND status = 'committed' AND error_code IS NULL`,
  ).run(now, input.operationId);
  if (consumed.changes !== 1) {
    throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
  }
  const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
  this.removeOperation(path.join(operationsRoot, input.operationId));
  return { undoneCount: toDelete.length, skippedCount, assets: summaries };
}

export function applyManagedCopyOperation(this: LibraryService, openLibrary: OpenLibrary, operationId: string, manifest: ManagedCopyOperationManifest): void {
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
    this.failAt('crash-copy-before-filesystem');
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
    this.failAt('crash-copy-after-conflict');

    for (const file of manifest.files) {
      const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    }
    this.failAt('crash-copy-after-filesystem');

    openLibrary.connection.transaction(() => {
      for (const file of manifest.files) {
        const conflict = file.destinationConflict;
        if (!conflict || conflict.kind !== 'managed' || !conflict.assetId || !conflict.trashFilename) {
          continue;
        }
        const trashRelativePath = `__trash__/${conflict.assetId}/${conflict.trashFilename}`;
        const changed = openLibrary.connection.prepare(
          `UPDATE assets SET relative_file_path = ?, managed_folder_id = NULL, path_identity = ?,
                  deleted_at = ?, trashed_from_relative_path = ?, trashed_from_folder_id = ?, updated_at = ?
            WHERE asset_id = ? AND deleted_at IS NULL`,
        ).run(
          trashRelativePath,
          portablePathIdentity(trashRelativePath),
          now,
          conflict.relativePath,
          conflict.managedFolderId,
          now,
          conflict.assetId,
        );
        if (changed.changes !== 1) {
          throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
        }
        this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
      }

      for (const file of manifest.files) {
        const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
        const fileStat = lstatSync(destinationPath, { bigint: true });
        const fileByteSize = Number(fileStat.size);
        if (!Number.isSafeInteger(fileByteSize)) {
          throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
        const fileModifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
        const revisionId = randomUUID();
        const pathIdentity = portablePathIdentity(file.destinationRelativePath);
        openLibrary.connection.prepare(
          `INSERT INTO assets
             (asset_id, location_kind, managed_folder_id, relative_file_path,
              path_identity, current_revision_id, availability, created_at, updated_at)
           VALUES (?, 'managed', ?, ?, ?, NULL, 'available', ?, ?)`,
        ).run(
          file.newAssetId,
          file.destinationFolderId,
          file.destinationRelativePath,
          pathIdentity,
          now,
          now,
        );
        openLibrary.connection.prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at)
           VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
        ).run(
          revisionId,
          file.newAssetId,
          fileByteSize,
          fileModifiedAt,
          path.posix.basename(file.destinationRelativePath),
          now,
        );
        openLibrary.connection.prepare(
          `UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?`,
        ).run(revisionId, now, file.newAssetId);

        const metadata = openLibrary.connection.prepare(
          `SELECT description, rating, favorite, palette, source_page_url, author
             FROM asset_metadata WHERE asset_id = ?`,
        ).get(file.sourceAssetId) as {
          description: string | null;
          rating: number;
          favorite: number;
          palette: string | null;
          source_page_url: string | null;
          author: string | null;
        } | undefined;
        if (metadata) {
          openLibrary.connection.prepare(
            `INSERT INTO asset_metadata
               (asset_id, description, rating, favorite, palette,
                source_page_url, author, entity_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          ).run(
            file.newAssetId,
            metadata.description,
            metadata.rating,
            metadata.favorite,
            metadata.palette,
            metadata.source_page_url,
            metadata.author,
            now,
          );
        }

        const tags = openLibrary.connection.prepare(
          'SELECT tag_id FROM human_asset_tags WHERE asset_id = ?',
        ).all(file.sourceAssetId) as Array<{ tag_id: string }>;
        const insertTag = openLibrary.connection.prepare(
          'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
        );
        for (const tag of tags) {
          insertTag.run(file.newAssetId, tag.tag_id);
        }

        this.syncAssetSearchContent(openLibrary.connection, file.newAssetId);
      }

      this.failAt('crash-copy-before-db-commit');
      jobLease.assertCurrent();
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), operationId);
    })();
    this.failAt('crash-copy-after-db-commit');
  } catch (error) {
    if (error instanceof SimulatedCrashError) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    const row = openLibrary.connection.prepare(
      'SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?',
    ).get(operationId) as OperationRow | undefined;
    if (row?.status === 'committed') {
      this.diagnose('asset.copy.post-commit', error, {
        operationId,
        libraryId: openLibrary.summary.libraryId,
      });
      return;
    }
    if (row) {
      try {
        this.recoverManagedCopyOperation(openLibrary, row, manifest, operationPath);
      } catch (recoveryError) {
        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'failed', error_code = 'COPY_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
        ).run(new Date().toISOString(), operationId);
        this.diagnose('asset.copy.rollback', recoveryError, {
          operationId,
          libraryId: openLibrary.summary.libraryId,
        });
      }
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  } finally {
    jobHeartbeat.stop();
    try {
      jobLease.release();
    } catch (releaseError) {
      this.diagnose('asset.copy.lease-release', releaseError, {
        libraryId: openLibrary.summary.libraryId,
        operationId,
      });
    }
  }
}
