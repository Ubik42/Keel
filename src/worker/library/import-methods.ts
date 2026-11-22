import { type AssetSummary, type LinkedFolderRule, type LinkedFolderSummary } from "../../shared/asset-types";
import { DEFAULT_IMAGE_SEQUENCE_FPS, detectImageSequences } from "../../shared/image-sequence";
import { isImportConflictPlan, isImportSourceFailurePlan } from "../../shared/import-outcome";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { type NameConflictDecision, type SuspectedDuplicateDecision } from "../../shared/protocol/requests";
import { type ImportCompletion, type ImportConflictPlan, type ImportProgressEvent, type ImportSourceFailurePlan } from "../../shared/protocol/responses";
import { DEFAULT_IMPORT_EXPIRY_CLOCK, DEFAULT_LINKED_FOLDER_RULES, FINALIZED_IMPORT_RETENTION_MS, LibraryServiceError, SimulatedCrashError, assertNameWithinFsLimit, assertTreeContainsNoSymlinks, buildFileName, buildFolderPath, buildMetadataText, closeIgnoringFailure, copyDirRecursiveCancellable, copyNameCandidates, createProgressThrottle, databasePath, directoryBirthNs, hasErrorCode, isDefaultIgnoredAssetEntry, isMissingPathError, measureCopyTree, openConfiguredDatabase, realDirectoryExists, realFileExists, sameDestinationSnapshot, sameSourceSnapshot, serviceError, sha256AndContentFingerprintFileAtPath, sha256FileAtPath, sourceChanged, sourceDeviceHint, sourceSnapshot, transferCheckpoint, type ActiveImportTransfer, type DatabaseConnection, type EagleCopiedThumbnail, type EagleImportedMetadata, type ExistingAssetRow, type ExistingDestination, type ImportAction, type ImportSourceEntry, type LibraryService, type ManagedFolderRow, type OpenLibrary, type OperationManifest, type PendingImport, type Statement, type TransferCancelState, unsupportedSourceEntry } from "../library-service";
import { ImportDestinationDirectoryCache } from "./import-destination-directory-cache";
import { ImportSourceFailurePause, isSkippableImportSourceFailure, skippedImportSourceFromError, toImportSourceFailurePlan, type SkippedImportSource } from "./import-source-failure";
import { normalizeAbsolutePath, normalizeFolderName, normalizeRelativeAssetPath, portablePathIdentity } from "./library-rules";
import { managedStoragePath } from "./library-storage-layout";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, type LibraryJobLease, type LibraryWriteLeaseHeartbeat } from "./library-write-coordinator";
import { pathIsWithin } from "./path-utils";
import { normalizeSearchText } from "./search-query";
import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, type BigIntStats, utimesSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface ImportMethods {
  cancelImportExpiry(...args: Parameters<typeof cancelImportExpiry>): ReturnType<typeof cancelImportExpiry>;
  pruneFinalizedImportIds(...args: Parameters<typeof pruneFinalizedImportIds>): ReturnType<typeof pruneFinalizedImportIds>;
  rememberFinalizedImport(...args: Parameters<typeof rememberFinalizedImport>): ReturnType<typeof rememberFinalizedImport>;
  isFinalizedImport(...args: Parameters<typeof isFinalizedImport>): ReturnType<typeof isFinalizedImport>;
  updateImportOperation(...args: Parameters<typeof updateImportOperation>): ReturnType<typeof updateImportOperation>;
  scheduleImportExpiry(...args: Parameters<typeof scheduleImportExpiry>): ReturnType<typeof scheduleImportExpiry>;
  parkPendingImportSourceFailure(...args: Parameters<typeof parkPendingImportSourceFailure>): ReturnType<typeof parkPendingImportSourceFailure>;
  finishImportWithoutUserDecision(...args: Parameters<typeof finishImportWithoutUserDecision>): ReturnType<typeof finishImportWithoutUserDecision>;
  lookupImportDestination(...args: Parameters<typeof lookupImportDestination>): ReturnType<typeof lookupImportDestination>;
  enumerateImportSources(...args: Parameters<typeof enumerateImportSources>): ReturnType<typeof enumerateImportSources>;
  importFolderAsLinked(...args: Parameters<typeof importFolderAsLinked>): ReturnType<typeof importFolderAsLinked>;
  importPathsIntoLinkedFolder(...args: Parameters<typeof importPathsIntoLinkedFolder>): ReturnType<typeof importPathsIntoLinkedFolder>;
  linkedFolderRowForImport(...args: Parameters<typeof linkedFolderRowForImport>): ReturnType<typeof linkedFolderRowForImport>;
  classifyImportEntryConflict(...args: Parameters<typeof classifyImportEntryConflict>): ReturnType<typeof classifyImportEntryConflict>;
  validateAutomationImportPlan(...args: Parameters<typeof validateAutomationImportPlan>): ReturnType<typeof validateAutomationImportPlan>;
  prepareImport(...args: Parameters<typeof prepareImport>): ReturnType<typeof prepareImport>;
  failPreparedImport(...args: Parameters<typeof failPreparedImport>): ReturnType<typeof failPreparedImport>;
  completePreparedImport(...args: Parameters<typeof completePreparedImport>): ReturnType<typeof completePreparedImport>;
  prepareOrExecuteImport(...args: Parameters<typeof prepareOrExecuteImport>): ReturnType<typeof prepareOrExecuteImport>;
  prepareOrExecuteImportCancellable(...args: Parameters<typeof prepareOrExecuteImportCancellable>): ReturnType<typeof prepareOrExecuteImportCancellable>;
  resolveImportCancellable(...args: Parameters<typeof resolveImportCancellable>): ReturnType<typeof resolveImportCancellable>;
  abandonImport(...args: Parameters<typeof abandonImport>): ReturnType<typeof abandonImport>;
  resolveImport(...args: Parameters<typeof resolveImport>): ReturnType<typeof resolveImport>;
  emitManagedImportProgress(...args: Parameters<typeof emitManagedImportProgress>): ReturnType<typeof emitManagedImportProgress>;
  emitLinkedFolderImportProgress(...args: Parameters<typeof emitLinkedFolderImportProgress>): ReturnType<typeof emitLinkedFolderImportProgress>;
  stageOneImportSourceEntry(...args: Parameters<typeof stageOneImportSourceEntry>): ReturnType<typeof stageOneImportSourceEntry>;
  stageImportSourceEntries(...args: Parameters<typeof stageImportSourceEntries>): ReturnType<typeof stageImportSourceEntries>;
  acquireImportTransfer(...args: Parameters<typeof acquireImportTransfer>): ReturnType<typeof acquireImportTransfer>;
  releaseImportTransfer(...args: Parameters<typeof releaseImportTransfer>): ReturnType<typeof releaseImportTransfer>;
  importLibraryFromFolder(...args: Parameters<typeof importLibraryFromFolder>): ReturnType<typeof importLibraryFromFolder>;
  cancelImport(...args: Parameters<typeof cancelImport>): ReturnType<typeof cancelImport>;
  validateImportSource(...args: Parameters<typeof validateImportSource>): ReturnType<typeof validateImportSource>;
}

export function cancelImportExpiry(this: LibraryService, pending: PendingImport): void {
  if (pending.expiryHandle === undefined) return;
  try {
    (this.options.importClock ?? DEFAULT_IMPORT_EXPIRY_CLOCK).cancel(pending.expiryHandle);
  } catch {
    // Token consumption and cleanup remain authoritative if timer cancellation fails.
  }
  pending.expiryHandle = undefined;
}

export function pruneFinalizedImportIds(this: LibraryService, now = Date.now()): void {
  for (const [importId, finalizedAt] of this.finalizedImportIds) {
    if (now - finalizedAt > FINALIZED_IMPORT_RETENTION_MS) {
      this.finalizedImportIds.delete(importId);
    }
  }
}

export function rememberFinalizedImport(this: LibraryService, importId: string): void {
  const now = Date.now();
  this.pruneFinalizedImportIds(now);
  this.finalizedImportIds.set(importId, now);
}

export function isFinalizedImport(this: LibraryService, importId: string): boolean {
  const finalizedAt = this.finalizedImportIds.get(importId);
  if (finalizedAt === undefined) return false;
  if (Date.now() - finalizedAt > FINALIZED_IMPORT_RETENTION_MS) {
    this.finalizedImportIds.delete(importId);
    return false;
  }
  return true;
}

export function updateImportOperation(this: LibraryService, pending: PendingImport, status: 'failed' | 'rolled_back', errorCode: string): void {
  const openLibrary = this.openById.get(pending.libraryId);
  if (!openLibrary) return;
  try {
    openLibrary.connection
      .prepare('UPDATE file_operations SET status = ?, error_code = ?, updated_at = ? WHERE operation_id = ?')
      .run(status, errorCode, new Date().toISOString(), path.basename(pending.operationPath));
  } catch {
    // Recovery can audit and finish a still-preparing row on the next open.
  }
}

export function scheduleImportExpiry(this: LibraryService, _importId: string, pending: PendingImport): void {
  // §5.5: parked conflict / source-failure / sequence decisions stay until
  // resolve, abandon, or closeLibrary. Do not silently discard staging
  // while the user is still looking at a dialog.
  this.cancelImportExpiry(pending);
}

export function parkPendingImportSourceFailure(this: LibraryService, input: {
    importId: string;
    input: Parameters<LibraryService['prepareImport']>[0];
    directories: string[];
    stagedEntries: ImportSourceEntry[];
    remainingEntries: ImportSourceEntry[];
    skipped: SkippedImportSource[];
    failed: SkippedImportSource[];
    operationPath: string;
    stagePath: string;
    skipContentHash: boolean;
    destinationIndex?: Map<string, ExistingDestination>;
    preparingManifest?: OperationManifest;
  }): ImportSourceFailurePlan {
  if (input.stagedEntries.length === 0 && input.remainingEntries.length === 0) {
    this.removeOperation(input.operationPath);
    const first = input.failed[0] ?? input.skipped[0];
    throw new LibraryServiceError(
      'INVALID_IMPORT_SOURCE',
      first?.reason === undefined ? undefined : { reason: first.reason },
    );
  }
  const existing = this.pendingImports.get(input.importId);
  if (existing) this.cancelImportExpiry(existing);
  const pending: PendingImport = {
    directories: input.directories,
    entries: input.stagedEntries,
    libraryId: input.input.libraryId,
    operationPath: input.operationPath,
    unstagedEntries: input.remainingEntries,
    skippedSources: input.skipped,
    awaitingSourceFailureDecision: true,
    stagePath: input.stagePath,
    prepareInput: input.input,
    skipContentHash: input.skipContentHash,
    ...(input.destinationIndex ? { destinationIndex: input.destinationIndex } : {}),
    ...(input.input.createImageSequence !== undefined
      ? { createImageSequence: input.input.createImageSequence }
      : {}),
    ...(input.input.imageSequenceFps !== undefined
      ? { imageSequenceFps: input.input.imageSequenceFps }
      : {}),
    ...(input.input.suppressAssetChangeEvents === true
      ? { suppressAssetChangeEvents: true }
      : {}),
    ...(input.input.dedupeSameNameByContent === true
      ? { dedupeSameNameByContent: true }
      : {}),
    ...(input.input.skipLibraryDuplicateScan === true
      ? { skipLibraryDuplicateScan: true }
      : {}),
    ...(input.preparingManifest ? { preparingManifest: input.preparingManifest } : {}),
  };
  this.pendingImports.set(input.importId, pending);
  this.scheduleImportExpiry(input.importId, pending);
  return toImportSourceFailurePlan({
    importId: input.importId,
    failed: input.failed,
    remainingCount: input.remainingEntries.length + input.stagedEntries.length,
  });
}

export function finishImportWithoutUserDecision(this: LibraryService, prepared: ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan, decisions: {
      suspectedDuplicate: SuspectedDuplicateDecision;
      nameConflict: NameConflictDecision;
    }): ImportCompletion {
  let current: ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan = prepared;
  if (isImportSourceFailurePlan(current)) {
    current = this.continueAfterSourceFailure({
      importId: current.importId,
      applyToRest: true,
    });
  }
  if (isImportSourceFailurePlan(current)) {
    this.abandonImport(current.importId);
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
  }
  if (isImportConflictPlan(current)) {
    return this.resolveImport({
      importId: current.importId,
      suspectedDuplicate: decisions.suspectedDuplicate,
      nameConflict: decisions.nameConflict,
    });
  }
  return current;
}

export function lookupImportDestination(this: LibraryService, openLibrary: OpenLibrary, relativePath: string, index: Map<string, ExistingDestination> | undefined, directoryCache?: ImportDestinationDirectoryCache, options: { validateMissingSegments?: boolean } = {}): ExistingDestination | undefined {
  if (index) {
    const indexedDestination = index.get(portablePathIdentity(relativePath));
    if (indexedDestination !== undefined) return indexedDestination;
  }
  return this.portableDiskDestination(
    openLibrary,
    relativePath,
    directoryCache,
    options,
  );
}

export function enumerateImportSources(this: LibraryService, input: {
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    targetPrefix: string;
    expandImageSequences?: boolean;
    sourcePageUrl?: string;
  }): { directories: string[]; entries: ImportSourceEntry[]; skipped: SkippedImportSource[] } {
  const directories = new Set<string>();
  const pathsByIdentity = new Map<string, { kind: 'directory' | 'file'; path: string }>();
  const entries: ImportSourceEntry[] = [];
  const skipped: SkippedImportSource[] = [];
  const recordSkippable = (error: unknown, sourcePath: string): void => {
    if (!isSkippableImportSourceFailure(error)) throw error;
    skipped.push(skippedImportSourceFromError(error, sourcePath));
  };
  const assertSupportedSourceSegment = (segment: string): void => {
    if (path.sep === '/' && segment.includes('\\')) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'NAME_NOT_SUPPORTED',
      });
    }
  };
  const registerPortablePath = (
    relativePath: string,
    kind: 'directory' | 'file',
  ): void => {
    const identity = portablePathIdentity(relativePath);
    const existing = pathsByIdentity.get(identity);
    if (
      existing &&
      (existing.kind !== kind || (kind === 'directory' && existing.path !== relativePath))
    ) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'NAME_NOT_SUPPORTED',
      });
    }
    pathsByIdentity.set(identity, { kind, path: relativePath });
  };
  const addFile = (sourcePath: string, relativePath: string): void => {
    if (isDefaultIgnoredAssetEntry(path.basename(sourcePath), 'file')) return;
    let sourceStat: BigIntStats;
    try {
      sourceStat = lstatSync(sourcePath, { bigint: true });
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: sourceStat.isSymbolicLink()
          ? 'SYMBOLIC_LINK_NOT_ALLOWED'
          : 'UNSUPPORTED_FILE_ENTRY',
      });
    }
    let normalized: string;
    try {
      normalized = normalizeRelativeAssetPath(relativePath);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    assertSupportedSourceSegment(path.basename(sourcePath));
    registerPortablePath(normalized, 'file');
    const byteSize = Number(sourceStat.size);
    if (!Number.isSafeInteger(byteSize)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'UNSUPPORTED_FILE_ENTRY',
      });
    }
    entries.push({
      byteSize,
      destinationRelativePath: normalized,
      ...(input.sourcePageUrl === undefined ? {} : { sourcePageUrl: input.sourcePageUrl }),
      sourceSnapshot: sourceSnapshot(sourceStat),
      sourcePath,
    });
  };

  const visitDirectory = (directoryPath: string, relativeDirectory: string): void => {
    let directoryStat: BigIntStats;
    try {
      directoryStat = lstatSync(directoryPath, { bigint: true });
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: directoryStat.isSymbolicLink()
          ? 'SYMBOLIC_LINK_NOT_ALLOWED'
          : 'UNSUPPORTED_FILE_ENTRY',
      });
    }
    let normalizedDirectory: string;
    try {
      normalizedDirectory = normalizeRelativeAssetPath(relativeDirectory);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    assertSupportedSourceSegment(path.basename(directoryPath));
    registerPortablePath(normalizedDirectory, 'directory');
    directories.add(normalizedDirectory);
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    // Node does not expose openat(2)/directory-handle-relative traversal, so a
    // hostile writer can still replace an ancestor between individual calls.
    // Revalidate every directory at access time and every child again before
    // opening it; no imported bytes are accepted from a pathname-only read.
    let directoryAfterRead: BigIntStats;
    try {
      directoryAfterRead = lstatSync(directoryPath, { bigint: true });
    } catch (error) {
      throw sourceChanged(error);
    }
    if (directoryAfterRead.isSymbolicLink()) {
      throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
    }
    if (
      !directoryAfterRead.isDirectory() ||
      !sameSourceSnapshot(sourceSnapshot(directoryStat), sourceSnapshot(directoryAfterRead))
    ) {
      throw sourceChanged();
    }
    for (const child of children) {
      const childKind = child.isDirectory() ? 'directory' : 'file';
      if (isDefaultIgnoredAssetEntry(child.name, childKind)) continue;
      const childSourcePath = path.join(directoryPath, child.name);
      const childRelativePath = path.posix.join(relativeDirectory, child.name);
      try {
        assertSupportedSourceSegment(child.name);
        if (child.isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          });
        }
        if (child.isDirectory()) visitDirectory(childSourcePath, childRelativePath);
        else if (child.isFile()) addFile(childSourcePath, childRelativePath);
        else {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
      } catch (error) {
        recordSkippable(error, childSourcePath);
      }
    }
  };

  if (input.sourceKind === 'files') {
    // Native Explorer drops can contain any mix of files and directories.
    // Keep the single-directory path above for the traditional folder
    // import, but treat every multi-source selection as a set of roots here.
    // Sequence expansion is applied only to explicitly selected files;
    // recursively walking a selected directory already discovers its files.
    const selectedFiles: string[] = [];
    const selectedDirectories: string[] = [];
    for (const rawSourcePath of input.sourcePaths) {
      let sourcePath: string;
      try {
        sourcePath = normalizeAbsolutePath(rawSourcePath);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      let sourceStat: BigIntStats;
      try {
        sourceStat = lstatSync(sourcePath, { bigint: true });
      } catch (error) {
        recordSkippable(new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error }), sourcePath);
        continue;
      }
      if (sourceStat.isSymbolicLink()) {
        recordSkippable(new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
        }), sourcePath);
        continue;
      }
      if (sourceStat.isDirectory()) selectedDirectories.push(sourcePath);
      else if (sourceStat.isFile()) selectedFiles.push(sourcePath);
      else {
        recordSkippable(new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        }), sourcePath);
      }
    }
    const filePaths = input.expandImageSequences
      ? this.expandImageSequenceSourcePaths(selectedFiles)
      : selectedFiles;
    for (const sourcePath of filePaths) {
      try {
        addFile(sourcePath, path.posix.join(input.targetPrefix, path.basename(sourcePath)));
      } catch (error) {
        recordSkippable(error, sourcePath);
      }
    }
    for (const sourcePath of selectedDirectories) {
      if (sourcePath === path.parse(sourcePath).root) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'ROOT_NOT_ALLOWED',
        });
      }
      visitDirectory(
        sourcePath,
        path.posix.join(input.targetPrefix, path.basename(sourcePath)),
      );
    }
  } else {
    if (input.sourcePaths.length !== 1) throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
    let sourcePath: string;
    try {
      sourcePath = normalizeAbsolutePath(input.sourcePaths[0]!);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    // walking a filesystem root would import the whole disk
    // (the folder branch recurses); reject '/' and 'C:\' explicitly.
    if (sourcePath === path.parse(sourcePath).root) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'ROOT_NOT_ALLOWED',
      });
    }
    visitDirectory(
      sourcePath,
      path.posix.join(input.targetPrefix, path.basename(sourcePath)),
    );
  }

  if (entries.length === 0 && skipped.length > 0) {
    const first = skipped[0]!;
    throw new LibraryServiceError(
      'INVALID_IMPORT_SOURCE',
      first.reason === undefined ? undefined : { reason: first.reason },
    );
  }
  if (entries.length === 0 && directories.size === 0) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
  }
  return { directories: [...directories].sort(), entries, skipped };
}

export function importFolderAsLinked(this: LibraryService, input: {
    libraryId: string;
    sourceRootPath: string;
    displayName?: string;
    /** managed folder to hang the linked root under. */
    parentFolderId?: string | null;
    /**
     * Worker RPC passes false so watcher setup runs after the command returns.
     * In-process tests keep the default and still see watchers immediately.
     */
    reconcileWatchers?: boolean;
    initialRules?: LinkedFolderRule[];
  }): LinkedFolderSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  let sourceRoot: string;
  try {
    sourceRoot = normalizeAbsolutePath(input.sourceRootPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  // the parent must be an active managed folder of this
  // library. Linked ids never match, so "link under a linked folder" is
  // rejected here rather than silently accepted.
  const parentFolderId = input.parentFolderId ?? null;
  if (parentFolderId !== null) {
    // managed_folders has no library_id column: the library is the database
    // file itself.
    const parent = openLibrary.connection
      .prepare('SELECT folder_id FROM managed_folders WHERE folder_id = ?')
      .get(parentFolderId);
    if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  let rootStat: BigIntStats;
  try {
    rootStat = lstatSync(sourceRoot, { bigint: true });
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  if (rootStat.isSymbolicLink()) throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
  if (!rootStat.isDirectory()) throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');

  const displayName = input.displayName ?? path.basename(sourceRoot);
  let normalizedName: string;
  try {
    normalizedName = normalizeFolderName(displayName);
  } catch (error) {
    throw serviceError(error, 'INVALID_FOLDER_NAME');
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(sourceRoot);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  // realpath is the linked-folder identity: it canonicalizes case-insensitive
  // equivalents on APFS/NTFS and resolves any trailing-slash variants, which
  // is sufficient to prevent linking the same physical root twice. portable
  // path identity (NFC + casefold per segment) is not used here because the
  // helper rejects absolute paths; the linked root is device-specific anyway.
  const pathIdentity = canonicalRoot;

  // rejection rules: the library's own tree is managed by
  // Keel, and a folder already covered by a linked root would be indexed
  // twice. Both are reported with a specific reason so the UI can explain.
  let canonicalLibraryPath = openLibrary.summary.libraryPath;
  try {
    canonicalLibraryPath = realpathSync(canonicalLibraryPath);
  } catch {
    // Unresolvable library path: fall back to the configured one.
  }
  if (pathIsWithin(canonicalLibraryPath, canonicalRoot)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'LINKED_SOURCE_INSIDE_LIBRARY',
    });
  }
  const linkedRoots = openLibrary.connection
    .prepare('SELECT absolute_root_path FROM linked_folders WHERE library_id = ?')
    .all(input.libraryId) as Array<{ absolute_root_path: string }>;
  for (const linkedRoot of linkedRoots) {
    if (!pathIsWithin(linkedRoot.absolute_root_path, canonicalRoot)) continue;
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason:
        linkedRoot.absolute_root_path === canonicalRoot
          ? 'LINKED_SOURCE_ALREADY_LINKED'
          : 'LINKED_SOURCE_INSIDE_LINKED_FOLDER',
    });
  }

  const existing = openLibrary.connection
    .prepare('SELECT folder_id FROM linked_folders WHERE path_identity = ?')
    .get(pathIdentity);
  if (existing) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'LINKED_SOURCE_ALREADY_LINKED',
    });
  }

  const folderId = randomUUID();
  const importId = randomUUID();
  if (input.initialRules && (input.initialRules.length > 200 || new Set(input.initialRules.map((rule) => rule.ruleId)).size !== input.initialRules.length)) throw new LibraryServiceError('INVALID_SELECTION');
  const defaultRules = input.initialRules
    ? input.initialRules.map((rule) => this.normalizeLinkedFolderRule(rule))
    : DEFAULT_LINKED_FOLDER_RULES.map((rule) => ({ ...rule, ruleId: randomUUID() }));
  let lastProgressAt = 0;
  const emitLinkedProgress = (
    phase: ImportProgressEvent['phase'],
    filesProcessed: number,
    totalFiles: number,
    bytesProcessed: number,
    totalBytes: number,
    force = false,
  ): void => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 200) return;
    lastProgressAt = now;
    this.emitLinkedFolderImportProgress(
      importId,
      phase,
      filesProcessed,
      totalFiles,
      bytesProcessed,
      totalBytes,
    );
  };

  try {
    emitLinkedProgress('validate', 0, 0, 0, 0, true);
    let scannedBytes = 0;
    const directories: string[] = [];
    const entries = this.enumerateLinkedSources(
      canonicalRoot,
      folderId,
      defaultRules,
      (relativePath, pathKind) => this.isExplicitlyIgnored(
        openLibrary,
        'linked',
        folderId,
        relativePath,
        pathKind,
      ),
      (foundCount, entryBytes) => {
        scannedBytes += entryBytes;
        emitLinkedProgress('validate', foundCount, 0, scannedBytes, 0);
      },
      (relativePath) => directories.push(relativePath),
    );
    const totalBytes = scannedBytes;
    emitLinkedProgress('copy', 0, entries.length, 0, totalBytes, true);
    const now = new Date().toISOString();
    const sourceDeviceHintValue = sourceDeviceHint(
      rootStat.dev,
      rootStat.ino,
      directoryBirthNs(rootStat),
    );
    const importedAssetIds: string[] = [];

    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `INSERT INTO linked_folders
           (folder_id, library_id, display_name, absolute_root_path, source_device_hint,
            status, path_identity, parent_folder_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)`,
        )
        .run(
          folderId,
          openLibrary.summary.libraryId,
          normalizedName,
          canonicalRoot,
          sourceDeviceHintValue,
          pathIdentity,
          parentFolderId,
          now,
          now,
        );
      const insertRule = openLibrary.connection.prepare(
        `INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      defaultRules.forEach((rule, position) => insertRule.run(
        rule.ruleId, folderId, position, rule.action, rule.target, rule.pattern, 1,
      ));
      const insertAsset = openLibrary.connection.prepare(
        `INSERT INTO assets
         (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
          path_identity, current_revision_id, availability, source_device, source_inode,
          created_at, updated_at)
       VALUES (?, 'linked', NULL, ?, ?, ?, ?, 'available', ?, ?, ?, ?)`,
      );
      const insertRevision = openLibrary.connection.prepare(
        `INSERT INTO revisions
         (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
          original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
      );
      // These assets have just been created and cannot have tags, metadata,
      // or a prior search row. Build their initial FTS content from the
      // import snapshot instead of rereading four tables for every file.
      const insertInitialSearch = openLibrary.connection.prepare(
        `INSERT INTO asset_search_index
         (asset_id, filename, tags, description, source_url, author, folder_path, metadata_text)
         VALUES (?, ?, '', '', '', '', ?, ?)`,
      );
      let filesProcessed = 0;
      let bytesProcessed = 0;
      for (const entry of entries) {
        const assetId = randomUUID();
        const revisionId = randomUUID();
        const assetPathIdentity = portablePathIdentity(entry.relativePath);
        insertAsset.run(
          assetId,
          folderId,
          entry.relativePath,
          assetPathIdentity,
          revisionId,
          entry.sourceDevice,
          entry.sourceInode,
          now,
          now,
        );
        insertRevision.run(
          revisionId,
          assetId,
          entry.byteSize,
          entry.modifiedAt,
          entry.originalFilename,
          now,
        );
        insertInitialSearch.run(
          assetId,
          normalizeSearchText(buildFileName(entry.relativePath)),
          normalizeSearchText(buildFolderPath(entry.relativePath)),
          normalizeSearchText(buildMetadataText({
            availability: 'available',
            byteSize: entry.byteSize,
            relativeFilePath: entry.relativePath,
          })),
        );
        importedAssetIds.push(assetId);
        filesProcessed += 1;
        bytesProcessed += entry.byteSize;
        emitLinkedProgress(
          'copy',
          filesProcessed,
          entries.length,
          bytesProcessed,
          totalBytes,
          filesProcessed === entries.length,
        );
      }
      this.linkedDirectoryIndex(openLibrary).replace(folderId, directories);
    })();
    // GitHub #45: emit complete as soon as catalog rows are committed so
    // the renderer can drop “正在导入”. Header probes still run next for
    // masonry, but a late copy event cannot resurrect the overlay.
    emitLinkedProgress(
      'complete',
      entries.length,
      entries.length,
      totalBytes,
      totalBytes,
      true,
    );
    // A linked folder is the disk directory itself. Numbered frames stay as
    // separate files, and content that already exists elsewhere in the
    // library is still listed. Copy import is the path that asks about
    // sequences and content duplicates.
    // Header probes stay on the visible-window / dimension-backfill lanes.
    // Watcher reconcile is optional here so the Worker RPC can return as soon
    // as the catalog is committed (GitHub #45): overlay and later commands
    // do not wait on fs.watch setup.
    if (input.reconcileWatchers !== false) {
      this.reconcileLinkedWatchers(openLibrary);
    }

    return {
      folderId,
      displayName: normalizedName,
      status: 'available',
      assetCount: entries.length,
      absoluteRootPath: canonicalRoot,
      linkedFolderId: folderId,
      relativePath: '',
      // echo the requested parent (null = library root).
      parentFolderId,
      createdAt: now,
      // New linked root: default look, matching listLinkedFolders.
      appearance: null,
    };
  } catch (error) {
    emitLinkedProgress('failed', 0, 0, 0, 0, true);
    throw error;
  }
}

/**
* Copy external paths into a linked folder root and register via refresh
* (LINK-005). Returns an ImportCompletion-shaped result when
* called from prepareOrExecuteImport; prepareImport routes linked targets
* here via a zero-conflict plan + immediate resolve is not used — instead
* prepareOrExecuteImport short-circuits.
*/
export function importPathsIntoLinkedFolder(this: LibraryService, input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    expandImageSequences?: boolean;
    imageSequenceFps?: number;
  }): ImportCompletion {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const folder = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    )
    .get(input.linkedFolderId, input.libraryId) as
    | { folder_id: string; absolute_root_path: string; status: string }
    | undefined;
  if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  if (folder.status !== 'available' || !realDirectoryExists(folder.absolute_root_path)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'SOURCE_NOT_FOUND',
    });
  }

  let targetPrefix = '';
  if (input.relativePath !== undefined && input.relativePath !== '') {
    const target = this.resolveLinkedDirectoryMutationTarget(
      openLibrary,
      input.linkedFolderId,
      input.relativePath,
    );
    targetPrefix = target.relativePath;
  }

  const { entries } = this.enumerateImportSources({
    sourceKind: input.sourceKind,
    sourcePaths: input.sourcePaths,
    targetPrefix,
    expandImageSequences: input.expandImageSequences === true,
  });
  if (entries.length === 0) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
  }

  const occupied = new Set<string>();
  const written: string[] = [];
  try {
    for (const entry of entries) {
      const originalRelative = normalizeRelativeAssetPath(
        entry.destinationRelativePath,
      );
      const originalName = path.posix.basename(originalRelative);
      const parentRelative = path.posix.dirname(originalRelative);
      let relativeDestination = originalRelative;
      let destination = path.join(
        folder.absolute_root_path,
        ...relativeDestination.split('/'),
      );
      const destinationExists = (): boolean =>
        occupied.has(portablePathIdentity(relativeDestination)) ||
        existsSync(destination);
      if (destinationExists()) {
        let found = false;
        for (let suffix = 2; suffix < 10_000 && !found; suffix += 1) {
          for (const candidate of copyNameCandidates(originalName, suffix)) {
            relativeDestination = normalizeRelativeAssetPath(
              parentRelative === '.'
                ? candidate
                : path.posix.join(parentRelative, candidate),
            );
            destination = path.join(
              folder.absolute_root_path,
              ...relativeDestination.split('/'),
            );
            if (!destinationExists()) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
            reason: 'NAME_NOT_SUPPORTED',
          });
        }
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(entry.sourcePath, destination, constants.COPYFILE_EXCL);
      written.push(relativeDestination);
      occupied.add(portablePathIdentity(relativeDestination));
    }
  } catch (error) {
    for (const relativePath of written.reverse()) {
      rmSync(
        path.join(folder.absolute_root_path, ...relativePath.split('/')),
        { force: true },
      );
    }
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }

  // 只注册本次写入的文件，避免 refreshManagedAssets 全量枚举所有链接文件夹
  // 导致的导入缓慢。
  this.registerWrittenLinkedAssets(
    openLibrary,
    input.linkedFolderId,
    folder.absolute_root_path,
    written,
  );
  const identities = new Set(written.map(portablePathIdentity));
  const assets = this.listAssets({
    libraryId: input.libraryId,
    folderId: input.linkedFolderId,
    recursive: true,
  }).filter((asset) =>
    identities.has(portablePathIdentity(asset.relativeFilePath)),
  );
  return {
    importedCount: assets.length,
    fileCount: assets.length,
    assetCount: assets.length,
    skippedCount: Math.max(0, entries.length - assets.length),
    replacedCount: 0,
    assets,
  };
}

export function linkedFolderRowForImport(this: LibraryService, openLibrary: OpenLibrary, folderId: string | undefined): { folder_id: string; absolute_root_path: string; status: string; relative_path: string } | null {
  if (!folderId) return null;
  const virtual = parseLinkedVirtualFolderId(folderId);
  const rootId = virtual?.linkedFolderId ?? folderId;
  const row = openLibrary.connection
    .prepare(
      `SELECT folder_id, absolute_root_path, status
         FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    )
    .get(rootId, openLibrary.summary.libraryId) as
    | { folder_id: string; absolute_root_path: string; status: string }
    | undefined;
  return row ? { ...row, relative_path: virtual?.relativePath ?? '' } : null;
}

export function classifyImportEntryConflict(this: LibraryService, input: {
    openLibrary: OpenLibrary;
    entry: ImportSourceEntry;
    entrySha256: string;
    existingSize: number | undefined;
    existingAbsolutePath: string | undefined;
    contentHashCache: Map<string, string>;
    seenContentHashes: Set<string>;
    ignoreBatchContentHash?: boolean;
    skipLibraryDuplicateScan?: boolean;
  }): 'none' | 'suspected-duplicate' | 'name-conflict' {
  const {
    openLibrary,
    entry,
    entrySha256,
    existingSize,
    contentHashCache,
    seenContentHashes,
    ignoreBatchContentHash = false,
    skipLibraryDuplicateScan = false,
  } = input;

  // Path collision always wins (IMPORT-007): same destination
  // basename is a name conflict even when the bytes also match. Content
  // duplicate is reserved for free destination names with matching content.
  if (existingSize !== undefined) {
    return 'name-conflict';
  }

  if (!ignoreBatchContentHash && seenContentHashes.has(entrySha256)) {
    return 'suspected-duplicate';
  }

  if (
    !skipLibraryDuplicateScan &&
    !ignoreBatchContentHash &&
    this.findActiveManagedAssetIdByContent(
      openLibrary,
      entry.byteSize,
      entrySha256,
      contentHashCache,
      entry.contentFingerprint,
    ) !== null
  ) {
    return 'suspected-duplicate';
  }

  return 'none';
}

export function validateAutomationImportPlan(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    expandImageSequences?: boolean;
    imageSequenceFps?: number;
    automationPlan?: {
      planHash: string;
      expectedChangeSequence: number;
      sourceStates: Array<{ sourcePath: string; stateToken: string }>;
    };
  }): void {
  if (input.automationPlan === undefined) return;
  const plan = this.previewAutomationImport(input);
  if (
    plan.changeSequence !== input.automationPlan.expectedChangeSequence
    || plan.planHash !== input.automationPlan.planHash
  ) {
    throw new LibraryServiceError('VERSION_CONFLICT', {
      currentEntityVersion: plan.changeSequence,
    });
  }
  const expected = new Map(input.automationPlan.sourceStates.map((state) => [
    state.sourcePath,
    state.stateToken,
  ]));
  if (
    expected.size !== plan.sourceStates.length
    || plan.sourceStates.some((state) => expected.get(state.sourcePath) !== state.stateToken)
  ) {
    throw new LibraryServiceError('VERSION_CONFLICT', {
      currentEntityVersion: plan.changeSequence,
    });
  }
}

export function prepareImport(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    expandImageSequences?: boolean;
    imageSequenceFps?: number;
    createImageSequence?: boolean;
    sourcePageUrl?: string;
    /** Internal adapter for importers whose logical path differs from disk. */
    sourceEntries?: ImportSourceEntry[];
    sourceDirectories?: string[];
    dedupeSameNameByContent?: boolean;
    /** Avoid hashing every existing same-size asset for external bulk imports. */
    skipLibraryDuplicateScan?: boolean;
    /** Skip SHA-256/fingerprint of staged bytes; used for Eagle/Billfish conversion. */
    skipContentHash?: boolean;
    /** Optional progress callback for a caller-owned bulk import. */
    onStagedEntry?: (processedCount: number, bytesProcessed: number) => void;
    suppressAssetChangeEvents?: boolean;
    /** Shared destination identity map for multi-batch Eagle/Billfish conversion. */
    destinationIndex?: Map<string, ExistingDestination>;
    /** When set, emit import.progress and honor cancelImport(importId). */
    transferCancel?: TransferCancelState;
    /** Yield so a cancel command can run while files are staged. */
    yieldTransferCheckpoints?: boolean;
  }): ImportConflictPlan | ImportSourceFailurePlan {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (this.linkedFolderRowForImport(openLibrary, input.targetFolderId)) {
    // Linked imports skip the managed staging pipeline; callers should use
    // prepareOrExecuteImport. Surface a clear error if prepareImport is used alone.
    throw new LibraryServiceError('AUTOMATION_FILE_PLAN_INVALID');
  }
  const targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
  const enumerated = input.sourceEntries
    ? {
        directories: input.sourceDirectories ?? [],
        entries: input.sourceEntries,
        skipped: [] as SkippedImportSource[],
      }
    : this.enumerateImportSources({
        sourceKind: input.sourceKind,
        sourcePaths: input.sourcePaths,
        targetPrefix: targetFolder?.relative_path ?? '',
        expandImageSequences: input.expandImageSequences === true,
        ...(input.sourcePageUrl === undefined ? {} : { sourcePageUrl: input.sourcePageUrl }),
      });
  const { directories, entries } = enumerated;
  const importId = randomUUID();
  const operationPath = libraryMetaDir(openLibrary.summary.libraryPath, 'operations',
    importId,
  );
  const stagePath = path.join(operationPath, 'stage');
  const skipContentHash = input.skipContentHash === true;
  const destinationIndex = skipContentHash
    ? (input.destinationIndex ?? this.managedDestinationIndex(openLibrary))
    : undefined;
  const manifestDirectoryCache = new ImportDestinationDirectoryCache();
  let preparingManifest: OperationManifest;
  try {
    preparingManifest = {
      version: 1,
      phase: 'staging',
      files: entries.map((entry, index) => ({
        backupName: String(index),
        destinationRelativePath: entry.destinationRelativePath,
        hadDestination:
          this.lookupImportDestination(
            openLibrary,
            entry.destinationRelativePath,
            destinationIndex,
            manifestDirectoryCache,
            { validateMissingSegments: !skipContentHash },
          ) !== undefined,
        stageName: String(index),
      })),
      directories: directories.map((relativePath) => ({
        existed: skipContentHash
          ? existsSync(this.folderPath(openLibrary, relativePath))
          : this.portableDiskDestination(openLibrary, relativePath, manifestDirectoryCache) !== undefined,
        relativePath,
      })),
    };
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }
  try {
    const now = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `INSERT INTO file_operations
           (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
         VALUES (?, 'import', 'preparing', ?, NULL, ?, ?)`,
      )
      .run(importId, JSON.stringify(preparingManifest), now, now);
  } catch (error) {
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }
  const cancelState = input.transferCancel;
  if (cancelState) {
    this.activeImports.set(importId, cancelState);
  }
  const trackProgress = cancelState !== undefined && input.onStagedEntry === undefined;
  const totalImportFiles = entries.length;
  const totalImportBytes = entries.reduce((total, entry) => total + entry.byteSize, 0);
  if (trackProgress) {
    this.emitManagedImportProgress(importId, 'validate', 0, totalImportFiles, 0, totalImportBytes);
  }
  let stagedEntries: ImportSourceEntry[];
  try {
    mkdirSync(stagePath, { recursive: true });
    if (enumerated.skipped.length > 0 && skipContentHash !== true) {
      return this.parkPendingImportSourceFailure({
        importId,
        input,
        directories,
        stagedEntries: [],
        remainingEntries: entries,
        skipped: enumerated.skipped,
        failed: enumerated.skipped,
        operationPath,
        stagePath,
        skipContentHash,
        destinationIndex,
        preparingManifest,
      });
    }
    const stagedResult = this.stageImportSourceEntries({
      openLibrary,
      entries,
      stagePath,
      skipContentHash,
      onStagedEntry: input.onStagedEntry,
      importId: trackProgress ? importId : undefined,
      totalFiles: totalImportFiles,
      totalBytes: totalImportBytes,
      cancelState,
      yieldCheckpoints: input.yieldTransferCheckpoints === true,
      skipRemainingSourceFailures: skipContentHash,
      skipped: [...enumerated.skipped],
    });
    if (typeof (stagedResult as Promise<ImportSourceEntry[]>).then === 'function') {
      return (stagedResult as Promise<ImportSourceEntry[]>).then((resolved) => {
        return this.completePreparedImport({
          input,
          openLibrary,
          importId,
          operationPath,
          directories,
          stagedEntries: resolved,
          skipContentHash,
          destinationIndex,
          preparingManifest,
        });
      }).catch((error: unknown) => {
        if (error instanceof ImportSourceFailurePause) {
          return this.parkPendingImportSourceFailure({
            importId,
            input,
            directories,
            stagedEntries: error.stagedEntries as ImportSourceEntry[],
            remainingEntries: error.remainingEntries as ImportSourceEntry[],
            skipped: error.skipped,
            failed: error.failed,
            operationPath,
            stagePath,
            skipContentHash,
            destinationIndex,
            preparingManifest,
          });
        }
        this.failPreparedImport(error, {
          importId,
          operationPath,
          openLibrary,
          trackProgress,
        });
      }) as unknown as ImportConflictPlan;
    }
    stagedEntries = stagedResult as ImportSourceEntry[];
  } catch (error) {
    if (error instanceof ImportSourceFailurePause) {
      return this.parkPendingImportSourceFailure({
        importId,
        input,
        directories,
        stagedEntries: error.stagedEntries as ImportSourceEntry[],
        remainingEntries: error.remainingEntries as ImportSourceEntry[],
        skipped: error.skipped,
        failed: error.failed,
        operationPath,
        stagePath,
        skipContentHash,
        destinationIndex,
        preparingManifest,
      });
    }
    this.failPreparedImport(error, {
      importId,
      operationPath,
      openLibrary,
      trackProgress,
    });
  }
  return this.completePreparedImport({
    input,
    openLibrary,
    importId,
    operationPath,
    directories,
    stagedEntries,
    skipContentHash,
    destinationIndex,
    preparingManifest,
  });
}

export function failPreparedImport(this: LibraryService, error: unknown, context: {
      importId: string;
      operationPath: string;
      openLibrary: OpenLibrary;
      trackProgress: boolean;
    }): never {
  if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
    this.removeOperation(context.operationPath);
    try {
      context.openLibrary.connection
        .prepare("UPDATE file_operations SET status = 'failed', error_code = 'CANCELLED', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), context.importId);
    } catch {
      // Best-effort bookkeeping; the cancelled error is the one callers see.
    }
    this.activeImports.delete(context.importId);
    if (context.trackProgress) {
      this.emitManagedImportProgress(context.importId, 'cancelled', 0, 0, 0, 0);
    }
    throw error;
  }
  if (error instanceof SimulatedCrashError) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  this.removeOperation(context.operationPath);
  try {
    context.openLibrary.connection
      .prepare("UPDATE file_operations SET status = 'failed', error_code = 'PREPARE_FAILED', updated_at = ? WHERE operation_id = ?")
      .run(new Date().toISOString(), context.importId);
  } catch {
    // Best-effort bookkeeping.
  }
  this.activeImports.delete(context.importId);
  if (context.trackProgress) {
    this.emitManagedImportProgress(context.importId, 'failed', 0, 0, 0, 0);
  }
  throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
}

export function completePreparedImport(this: LibraryService, context: {
    input: Parameters<LibraryService['prepareImport']>[0];
    openLibrary: OpenLibrary;
    importId: string;
    operationPath: string;
    directories: string[];
    stagedEntries: ImportSourceEntry[];
    skipContentHash: boolean;
    destinationIndex: Map<string, ExistingDestination> | undefined;
    preparingManifest: OperationManifest;
    skippedSources?: SkippedImportSource[];
  }): ImportConflictPlan {
  const {
    input,
    openLibrary,
    importId,
    operationPath,
    directories,
    stagedEntries,
    skipContentHash,
    destinationIndex,
    preparingManifest,
  } = context;
  const seenDestinations = new Map<string, number>();
  // Staging may take a long time. Do not reuse the initial manifest's disk
  // view; this snapshot belongs only to post-stage classification.
  const destinationDirectoryCache = new ImportDestinationDirectoryCache();
  const contentHashCache = new Map<string, string>();
  const seenContentHashes = new Set<string>();
  // Intra-batch identical bytes are common in particle/VFX sequences (clear frames).
  // Treat those as distinct assets when destination basenames form a numbered run.
  const sequenceBatchPaths = new Set<string>();
  if (!skipContentHash) {
    for (const candidate of detectImageSequences(
      stagedEntries.map((entry) => entry.destinationRelativePath),
    )) {
      for (const frame of candidate.frames) sequenceBatchPaths.add(frame.value);
    }
  }
  let suspectedDuplicateCount = 0;
  let libraryDuplicateCount = 0;
  let nameConflictCount = 0;
  const examples: ImportConflictPlan['examples'] = [];

  try {
    for (const entry of stagedEntries) {
      const entrySha256 = skipContentHash
        ? `bulk:${portablePathIdentity(entry.destinationRelativePath)}`
        : (entry.sha256 ?? sha256FileAtPath(entry.sourcePath));
      const identity = portablePathIdentity(entry.destinationRelativePath);
      let existingSize = seenDestinations.get(identity);
      let existingAbsolutePath: string | undefined;
      if (existingSize === undefined) {
        const destination = this.lookupImportDestination(
          openLibrary,
          entry.destinationRelativePath,
          destinationIndex,
          destinationDirectoryCache,
          { validateMissingSegments: !skipContentHash },
        );
        existingSize = destination?.size;
        if (destination && destination.size !== -1) {
          existingAbsolutePath = this.folderPath(openLibrary, destination.actualRelativePath);
        }
      }
      const conflictKind = this.classifyImportEntryConflict({
        openLibrary,
        entry,
        entrySha256,
        existingSize,
        existingAbsolutePath,
        contentHashCache,
        seenContentHashes,
        ignoreBatchContentHash: sequenceBatchPaths.has(entry.destinationRelativePath),
        skipLibraryDuplicateScan: input.skipLibraryDuplicateScan,
      });

      if (conflictKind === 'suspected-duplicate') {
        suspectedDuplicateCount += 1;
        const isLibraryScope = existingSize === undefined;
        if (isLibraryScope) libraryDuplicateCount += 1;
        if (examples.length < 8) {
          const matched = input.skipLibraryDuplicateScan
            ? null
            : this.findActiveManagedAssetByContent(
                openLibrary,
                entry.byteSize,
                entrySha256,
                contentHashCache,
                entry.contentFingerprint,
              );
          examples.push({
            displayName: path.posix.basename(entry.destinationRelativePath),
            kind: isLibraryScope ? 'library-duplicate' : 'suspected-duplicate',
            ...(matched
              ? {
                  existingDisplayName: matched.displayName,
                  existingAssetId: matched.assetId,
                  ...(matched.thumbnailArtifactId
                    ? {
                        existingThumbnailArtifactId:
                          matched.thumbnailArtifactId,
                      }
                    : {}),
                }
              : {}),
          });
        }
        continue;
      }
      if (conflictKind === 'name-conflict') {
        nameConflictCount += 1;
        if (examples.length < 8) {
          // surface the colliding (already-existing) asset's
          // display name + thumbnail in the name-conflict dialog, matching
          // what content duplicates already show.
          const destination = this.lookupImportDestination(
            openLibrary,
            entry.destinationRelativePath,
            destinationIndex,
            destinationDirectoryCache,
            { validateMissingSegments: !skipContentHash },
          );
          const existing =
            destination && destination.size !== -1
              ? this.findActiveManagedAssetAtPath(
                  openLibrary,
                  destination.actualRelativePath,
                )
              : null;
          examples.push({
            displayName: path.posix.basename(entry.destinationRelativePath),
            kind: 'name-conflict',
            ...(existing
              ? {
                  existingDisplayName: existing.displayName,
                  existingAssetId: existing.assetId,
                  ...(existing.thumbnailArtifactId
                    ? {
                        existingThumbnailArtifactId:
                          existing.thumbnailArtifactId,
                      }
                    : {}),
                }
              : {}),
          });
        }
        continue;
      }

      seenContentHashes.add(entrySha256);
      seenDestinations.set(identity, entry.byteSize);
    }
  } catch (error) {
    this.removeOperation(operationPath);
    openLibrary.connection
      .prepare("UPDATE file_operations SET status = 'failed', error_code = 'PREPARE_FAILED', updated_at = ? WHERE operation_id = ?")
      .run(new Date().toISOString(), importId);
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  const preparedManifest: OperationManifest = {
    version: 1,
    phase: 'prepared',
    files: stagedEntries.map((entry, index) => ({
      backupName: String(index),
      destinationRelativePath: entry.destinationRelativePath,
      hadDestination:
        this.lookupImportDestination(
          openLibrary,
          entry.destinationRelativePath,
          destinationIndex,
          destinationDirectoryCache,
          { validateMissingSegments: !skipContentHash },
        ) !== undefined,
      stageName: String(index),
    })),
    directories: preparingManifest.directories,
  };
  openLibrary.connection
    .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
    .run(JSON.stringify(preparedManifest), new Date().toISOString(), importId);
  const pending: PendingImport = {
    directories,
    entries: stagedEntries,
    libraryId: input.libraryId,
    operationPath,
    ...(context.skippedSources && context.skippedSources.length > 0
      ? { skippedSources: context.skippedSources }
      : {}),
    ...(input.createImageSequence !== undefined
      ? { createImageSequence: input.createImageSequence }
      : {}),
    ...(input.imageSequenceFps !== undefined
      ? { imageSequenceFps: input.imageSequenceFps }
      : {}),
    ...(input.suppressAssetChangeEvents === true
      ? { suppressAssetChangeEvents: true }
      : {}),
    ...(input.dedupeSameNameByContent === true
      ? { dedupeSameNameByContent: true }
      : {}),
    ...(input.skipLibraryDuplicateScan === true
      ? { skipLibraryDuplicateScan: true }
      : {}),
    ...(skipContentHash ? { skipContentHash: true } : {}),
    ...(destinationIndex ? { destinationIndex } : {}),
    contentHashCache,
  };
  this.pendingImports.set(importId, pending);
  this.scheduleImportExpiry(importId, pending);
  const plan: ImportConflictPlan = {
    importId,
    fileCount: stagedEntries.length,
    totalBytes: stagedEntries.reduce((total, entry) => total + entry.byteSize, 0),
    suspectedDuplicateCount,
    libraryDuplicateCount,
    nameConflictCount,
    examples,
  };
  return plan;
}

export function prepareOrExecuteImport(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    expandImageSequences?: boolean;
    imageSequenceFps?: number;
    createImageSequence?: boolean;
    sourcePageUrl?: string;
    automationPlan?: {
      planHash: string;
      expectedChangeSequence: number;
      sourceStates: Array<{ sourcePath: string; stateToken: string }>;
    };
  }): ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan {
  if (input.automationPlan !== undefined) {
    this.validateAutomationImportPlan(input);
  }
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const linked = this.linkedFolderRowForImport(
    openLibrary,
    input.targetFolderId,
  );
  if (linked) {
    return this.importPathsIntoLinkedFolder({
      libraryId: input.libraryId,
      linkedFolderId: linked.folder_id,
      relativePath: linked.relative_path,
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      expandImageSequences: input.expandImageSequences === true,
      imageSequenceFps: input.imageSequenceFps,
    });
  }
  const plan = this.prepareImport(input);
  if (isImportSourceFailurePlan(plan)) return plan;
  // An MCP/Desktop automation plan has already been shown to the user and
  // fenced against the readonly preview above.  Resolve the staged batch
  // with the same safe defaults as the normal no-conflict path so a
  // confirmed import cannot stop at an unreachable conflict token:
  // content duplicates are skipped and name collisions keep both files.
  if (input.automationPlan !== undefined) {
    return this.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
  }
  if (plan.suspectedDuplicateCount !== 0 || plan.nameConflictCount !== 0) return plan;
  return this.resolveImport({
    importId: plan.importId,
    suspectedDuplicate: 'skip',
    nameConflict: 'keep-both',
  });
}

export async function prepareOrExecuteImportCancellable(this: LibraryService, input: Parameters<LibraryService['prepareOrExecuteImport']>[0]): Promise<ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan> {
  if (input.automationPlan !== undefined) {
    this.validateAutomationImportPlan(input);
  }
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const linked = this.linkedFolderRowForImport(
    openLibrary,
    input.targetFolderId,
  );
  if (linked) {
    return this.importPathsIntoLinkedFolder({
      libraryId: input.libraryId,
      linkedFolderId: linked.folder_id,
      relativePath: linked.relative_path,
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      expandImageSequences: input.expandImageSequences === true,
      imageSequenceFps: input.imageSequenceFps,
    });
  }
  const cancelState: TransferCancelState = { cancelled: false };
  const plan = await Promise.resolve(
    this.prepareImport({
      ...input,
      transferCancel: cancelState,
      yieldTransferCheckpoints: true,
    }),
  );
  if (isImportSourceFailurePlan(plan)) return plan;
  if (cancelState.mode === 'stop') {
    cancelState.cancelled = false;
  }
  const finish = (completion: ImportCompletion): ImportCompletion => {
    this.emitManagedImportProgress(
      plan.importId,
      'complete',
      plan.fileCount,
      plan.fileCount,
      plan.totalBytes,
      plan.totalBytes,
    );
    this.activeImports.delete(plan.importId);
    return completion;
  };
  try {
    if (input.automationPlan !== undefined) {
      return finish(this.resolveImport({
        importId: plan.importId,
        suspectedDuplicate: 'skip',
        nameConflict: 'keep-both',
      }));
    }
    if (plan.suspectedDuplicateCount !== 0 || plan.nameConflictCount !== 0) {
      return plan;
    }
    return finish(this.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    }));
  } catch (error) {
    this.activeImports.delete(plan.importId);
    throw error;
  }
}

export async function resolveImportCancellable(this: LibraryService, input: Parameters<LibraryService['resolveImport']>[0]): Promise<ImportCompletion> {
  if (!this.activeImports.has(input.importId)) {
    this.activeImports.set(input.importId, { cancelled: false });
  }
  try {
    const completion = this.resolveImport(input);
    this.emitManagedImportProgress(
      input.importId,
      'complete',
      completion.importedCount + completion.replacedCount + completion.skippedCount,
      completion.importedCount + completion.replacedCount + completion.skippedCount,
      0,
      0,
    );
    return completion;
  } catch (error) {
    this.activeImports.delete(input.importId);
    throw error;
  } finally {
    this.activeImports.delete(input.importId);
  }
}

export function abandonImport(this: LibraryService, importId: string): string {
  const pending = this.pendingImports.get(importId);
  if (!pending) {
    if (this.isFinalizedImport(importId)) return importId;
    throw new LibraryServiceError('IMPORT_NOT_FOUND');
  }
  this.pendingImports.delete(importId);
  this.cancelImportExpiry(pending);
  this.updateImportOperation(pending, 'rolled_back', 'IMPORT_ABANDONED');
  this.removeOperation(pending.operationPath);
  return importId;
}

export function resolveImport(this: LibraryService, input: {
    importId: string;
    suspectedDuplicate: SuspectedDuplicateDecision;
    nameConflict: NameConflictDecision;
  }): ImportCompletion {
  const pending = this.pendingImports.get(input.importId);
  if (!pending) throw new LibraryServiceError('IMPORT_NOT_FOUND');
  if (pending.awaitingSourceFailureDecision) {
    throw new LibraryServiceError('IMPORT_AWAITING_DECISION');
  }
  this.pendingImports.delete(input.importId);
  this.cancelImportExpiry(pending);
  if (
    !['skip', 'merge', 'create-copy'].includes(input.suspectedDuplicate) ||
    !['keep-both', 'replace', 'skip'].includes(input.nameConflict)
  ) {
    this.updateImportOperation(pending, 'rolled_back', 'INVALID_IMPORT_DECISION');
    this.removeOperation(pending.operationPath);
    throw new LibraryServiceError('INVALID_IMPORT_DECISION');
  }

  const openLibrary = this.requireOpenLibrary(pending.libraryId);
  const destinationDirectoryCache = new ImportDestinationDirectoryCache();
  const directoryByIdentity = new Map<string, string>();
  let resolvedDirectories: string[];
  try {
    resolvedDirectories = [...pending.directories]
      .sort((left, right) => left.split('/').length - right.split('/').length)
      .map((relativeDirectory) => {
      const parent = path.posix.dirname(relativeDirectory);
      const resolvedParent =
        parent === '.' ? '.' : (directoryByIdentity.get(portablePathIdentity(parent)) ?? parent);
      const candidate =
        resolvedParent === '.'
          ? path.posix.basename(relativeDirectory)
          : path.posix.join(resolvedParent, path.posix.basename(relativeDirectory));
      const existing = this.portableDiskDestination(
        openLibrary,
        candidate,
        destinationDirectoryCache,
      );
      if (existing && existing.size !== -1) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
      const resolved = existing?.actualRelativePath ?? candidate;
      directoryByIdentity.set(portablePathIdentity(relativeDirectory), resolved);
        return resolved;
      });
  } catch (error) {
    this.removeOperation(pending.operationPath);
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }
  const occupied = new Map<string, ExistingDestination>();
  const actionIndexByIdentity = new Map<string, number>();
  const actions: ImportAction[] = [];
  const mergedAssetIds = new Set<string>();
  let skippedCount = 0;

  const destination = (relativePath: string): ExistingDestination | undefined => {
    const identity = portablePathIdentity(relativePath);
    return occupied.get(identity)
      ?? this.lookupImportDestination(
        openLibrary,
        relativePath,
        pending.destinationIndex,
        destinationDirectoryCache,
        { validateMissingSegments: !pending.skipContentHash },
      );
  };
  const copyPath = (relativePath: string): string => {
    const directory = path.posix.dirname(relativePath);
    const fileName = path.posix.basename(relativePath);
    for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
      let allCandidatesExceededNameLimit = true;
      let finalNameLimitError: unknown;
      for (const candidateName of copyNameCandidates(fileName, index)) {
        const candidate =
          directory === '.' ? candidateName : path.posix.join(directory, candidateName);
        try {
          const existing = destination(candidate);
          allCandidatesExceededNameLimit = false;
          if (existing === undefined) return candidate;
          break;
        } catch (error) {
          if (hasErrorCode(error, 'ENAMETOOLONG')) {
            finalNameLimitError = error;
            continue;
          }
          throw error;
        }
      }
      if (allCandidatesExceededNameLimit) throw finalNameLimitError;
    }
    throw new LibraryServiceError('IMPORT_APPLY_FAILED');
  };

  try {
    const contentHashCache = pending.contentHashCache ?? new Map<string, string>();
    const seenContentHashes = new Set<string>();
    const occupiedContentHashes = new Map<string, string>();
    const sequenceBatchPaths = new Set<string>();
    if (!pending.skipContentHash) {
      for (const candidate of detectImageSequences(
        pending.entries.map((entry) => entry.destinationRelativePath),
      )) {
        for (const frame of candidate.frames) sequenceBatchPaths.add(frame.value);
      }
    }
    for (const entry of pending.entries) {
      const entrySha256 = pending.skipContentHash
        ? `bulk:${portablePathIdentity(entry.destinationRelativePath)}`
        : (entry.sha256 ?? sha256FileAtPath(entry.sourcePath));
      const requestedDirectory = path.posix.dirname(entry.destinationRelativePath);
      const resolvedDirectory =
        requestedDirectory === '.'
          ? '.'
          : (directoryByIdentity.get(portablePathIdentity(requestedDirectory)) ??
            requestedDirectory);
      const requestedDestination =
        resolvedDirectory === '.'
          ? path.posix.basename(entry.destinationRelativePath)
          : path.posix.join(resolvedDirectory, path.posix.basename(entry.destinationRelativePath));
      const existingDestination = destination(requestedDestination);
      const existingSize = existingDestination?.size;
      const existingAbsolutePath =
        existingDestination && existingDestination.size !== -1
          ? this.folderPath(openLibrary, existingDestination.actualRelativePath)
          : undefined;
      let classified = this.classifyImportEntryConflict({
        openLibrary,
        entry,
        entrySha256,
        existingSize,
        existingAbsolutePath,
        contentHashCache,
        seenContentHashes,
        ignoreBatchContentHash: sequenceBatchPaths.has(entry.destinationRelativePath),
        skipLibraryDuplicateScan: pending.skipLibraryDuplicateScan,
      });
      if (
        !pending.skipContentHash
        && pending.dedupeSameNameByContent
        && classified === 'name-conflict'
        && existingAbsolutePath !== undefined
      ) {
        const occupiedHash = occupiedContentHashes.get(
          portablePathIdentity(existingDestination?.actualRelativePath ?? requestedDestination),
        );
        let existingHash = occupiedHash ?? contentHashCache.get(existingAbsolutePath);
        if (existingHash === undefined) {
          try {
            existingHash = sha256FileAtPath(existingAbsolutePath);
            contentHashCache.set(existingAbsolutePath, existingHash);
          } catch {
            existingHash = undefined;
          }
        }
        if (existingHash === entrySha256) classified = 'suspected-duplicate';
      }
      const conflictKind =
        classified === 'none' ? undefined : classified;
      let destinationRelativePath =
        existingDestination?.actualRelativePath ?? requestedDestination;
      let isReplacement = false;
      if (conflictKind === 'suspected-duplicate') {
        if (input.suspectedDuplicate === 'skip') {
          skippedCount += 1;
          continue;
        }
        if (input.suspectedDuplicate === 'create-copy') {
          // Path-level duplicate: destination occupied → auto-number.
          // Library-level duplicate with a free destination basename: keep the
          // requested name; only renumber when the path is taken.
          const requestedIdentity = portablePathIdentity(requestedDestination);
          const destinationFree =
            existingDestination === undefined &&
            !occupied.has(requestedIdentity);
          destinationRelativePath = destinationFree
            ? requestedDestination
            : copyPath(requestedDestination);
        } else {
          const retainedAssetId = existingDestination
            ? (
                this.prepareCached<Statement>(
                  openLibrary,
                  `SELECT asset_id FROM assets
                    WHERE path_identity = ?
                      AND location_kind = 'managed'
                      AND deleted_at IS NULL`,
                ).get(portablePathIdentity(destinationRelativePath)) as
                  | { asset_id: string }
                  | undefined
              )?.asset_id
            : this.findActiveManagedAssetIdByContent(
                openLibrary,
                entry.byteSize,
                entrySha256,
                contentHashCache,
                entry.contentFingerprint,
              );
          if (retainedAssetId) mergedAssetIds.add(retainedAssetId);
          else skippedCount += 1;
          continue;
        }
      } else if (conflictKind === 'name-conflict') {
        if (input.nameConflict === 'skip') {
          skippedCount += 1;
          continue;
        }
        if (input.nameConflict === 'keep-both') {
          destinationRelativePath = copyPath(requestedDestination);
        } else {
          if (existingSize === -1) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED');
          }
          isReplacement = true;
          const identity = portablePathIdentity(destinationRelativePath);
          const earlierActionIndex = actionIndexByIdentity.get(identity);
          if (earlierActionIndex !== undefined) {
            const earlierAction = actions[earlierActionIndex]!;
            actions[earlierActionIndex] = { ...earlierAction, entry };
            occupied.set(identity, {
              actualRelativePath: destinationRelativePath,
              size: entry.byteSize,
            });
            continue;
          }
        }
      }

      const pathIdentity = portablePathIdentity(destinationRelativePath);
      const existingAsset = this.prepareCached<Statement>(
        openLibrary,
        `SELECT asset_id, current_revision_id
           FROM assets
          WHERE path_identity = ?
            AND location_kind = 'managed'
            AND deleted_at IS NULL`,
      ).get(pathIdentity) as ExistingAssetRow | undefined;
      const expectedDestination = pending.skipContentHash
        ? undefined
        : this.portableDiskDestination(
            openLibrary,
            destinationRelativePath,
            destinationDirectoryCache,
          );
      occupied.set(pathIdentity, {
        actualRelativePath: destinationRelativePath,
        size: entry.byteSize,
      });
      pending.destinationIndex?.set(pathIdentity, {
        actualRelativePath: destinationRelativePath,
        size: entry.byteSize,
      });
      actionIndexByIdentity.set(pathIdentity, actions.length);
      actions.push({
        destinationRelativePath,
        entry,
        existingAsset,
        expectedDestination,
        isReplacement,
      });
      occupiedContentHashes.set(pathIdentity, entrySha256);
      seenContentHashes.add(entrySha256);
    }
  } catch (error) {
    this.removeOperation(pending.operationPath);
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }

  const operationId = input.importId;
  const operationPath = pending.operationPath;
  const backupPath = path.join(operationPath, 'backup');
  const stagedPaths = actions.map((action) => action.entry.sourcePath);
  const placedPaths: string[] = [];
  const backups: Array<{ backupPath: string; destinationPath: string }> = [];
  const createdDirectories: string[] = [];
  const directoryPaths = new Set(resolvedDirectories);
  for (const action of actions) {
    const directory = path.posix.dirname(action.destinationRelativePath);
    if (directory !== '.') directoryPaths.add(directory);
  }
  for (const directory of [...directoryPaths]) {
    let current = directory;
    while (current !== '.') {
      directoryPaths.add(current);
      current = path.posix.dirname(current);
    }
  }
  const sortedDirectories = [...directoryPaths].sort(
    (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
  );
  // Fail fast on over-limit names before any filesystem side effects (see
  // assertNameWithinFsLimit for why this cannot rely on OS error codes).
  for (const action of actions) {
    assertNameWithinFsLimit(action.destinationRelativePath);
  }
  const manifest: OperationManifest = {
    version: 1,
    files: actions.map((action, index) => ({
      backupName: String(index),
      destinationRelativePath: action.destinationRelativePath,
      hadDestination: pending.skipContentHash
        ? false
        : existsSync(this.folderPath(openLibrary, action.destinationRelativePath)),
      stageName: path.basename(action.entry.sourcePath),
    })),
    directories: sortedDirectories.map((relativePath) => ({
      existed: pending.skipContentHash
        ? false
        : existsSync(this.folderPath(openLibrary, relativePath)),
      relativePath,
    })),
  };

  let jobLease: LibraryJobLease;
  try {
    jobLease = new LibraryWriteCoordinator(openLibrary.writeConnection, pending.libraryId)
      .claimJobOnce(operationId);
  } catch (error) {
    this.removeOperation(operationPath);
    if (error instanceof LibraryWriteCoordinatorError) {
      try {
        openLibrary.connection
          .prepare(
            `UPDATE file_operations
                SET status = 'failed', error_code = 'JOB_LEASE_BUSY', updated_at = ?
              WHERE operation_id = ? AND status = 'preparing'`,
          )
          .run(new Date().toISOString(), operationId);
      } catch {
        // Best-effort status update; the caller still receives IMPORT_APPLY_FAILED.
      }
    }
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }
  const jobHeartbeat: LibraryWriteLeaseHeartbeat = jobLease.startHeartbeat();

  try {
    const now = new Date().toISOString();
    const updated = openLibrary.connection
      .prepare(
        `UPDATE file_operations
            SET status = 'applying', manifest_json = ?, error_code = NULL, updated_at = ?
          WHERE operation_id = ? AND status = 'preparing'`,
      )
      .run(JSON.stringify(manifest), now, operationId);
    if (updated.changes !== 1) throw new Error('Pending operation is not preparing.');
  } catch (error) {
    jobHeartbeat.stop();
    try {
      jobLease.release();
    } catch (releaseError) {
      this.diagnose('import-apply.lease-release', releaseError, {
        libraryId: pending.libraryId,
        operationId,
      });
    }
    this.removeOperation(operationPath);
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  }

  const rollbackFiles = (): boolean => {
    let succeeded = true;
    for (const destinationPath of [...placedPaths].reverse()) {
      try {
        rmSync(destinationPath, { force: true, recursive: true });
      } catch {
        succeeded = false;
      }
    }
    for (const backup of [...backups].reverse()) {
      try {
        if (existsSync(backup.backupPath)) {
          this.failAt('rollback-restore');
          renameSync(backup.backupPath, backup.destinationPath);
        }
      } catch {
        succeeded = false;
      }
    }
    for (const directoryPath of [...createdDirectories].reverse()) {
      try {
        rmdirSync(directoryPath);
      } catch {
        succeeded = false;
      }
    }
    if (succeeded) this.removeOperation(operationPath);
    return succeeded;
  };

  const affectedAssetIds: string[] = [];
  let importedCount = 0;
  let replacedCount = 0;
  let committed = false;
  let destinationGuardFailed = false;

  const completeCommittedImport = (): ImportCompletion => {
    const affected = [...new Set([...affectedAssetIds, ...mergedAssetIds])];
    let assetCount = new Set(affectedAssetIds).size;
    try {
      assetCount = this.countLogicalAssetUnits(openLibrary, affectedAssetIds);
    } catch (error) {
      this.diagnose('import-apply.post-commit-count', error, {
        libraryId: pending.libraryId,
        operationId,
        affectedCount: affectedAssetIds.length,
      });
    }

    let assets: AssetSummary[] = [];
    try {
      this.failAt('committed-result-list');
      if (pending.skipContentHash) {
        this.suppressAutoAnalysisForAssets(pending.libraryId, affectedAssetIds);
      } else {
        assets = this.listAssetSummariesByIds(openLibrary, affected);
      }
    } catch (error) {
      this.diagnose('import-apply.post-commit-result', error, {
        libraryId: pending.libraryId,
        operationId,
        affectedCount: affected.length,
      });
    }

    return {
      importedCount,
      fileCount: importedCount,
      assetCount,
      skippedCount,
      replacedCount,
      assets,
    };
  };

  try {
    mkdirSync(backupPath, { recursive: true });
    this.failAt('after-stage');

    for (const relativeDirectory of sortedDirectories) {
      const directoryPath = this.folderPath(openLibrary, relativeDirectory);
      if (!existsSync(directoryPath)) {
        mkdirSync(directoryPath);
        createdDirectories.push(directoryPath);
      } else if (!lstatSync(directoryPath).isDirectory()) {
        throw new Error('An imported directory conflicts with a file.');
      }
    }

    // Directory creation and durable operation bookkeeping happen after
    // classification. Take one final filesystem snapshot immediately
    // before touching destinations so a file created while the user was
    // deciding cannot be silently overwritten.
    try {
      this.options.beforeImportDestinationApply?.();
      const applicationDirectoryCache = new ImportDestinationDirectoryCache();
      for (const action of actions) {
        const currentDestination = this.portableDiskDestination(
          openLibrary,
          action.destinationRelativePath,
          applicationDirectoryCache,
          pending.skipContentHash
            ? { validateMissingSegments: false, snapshotFile: false }
            : undefined,
        );
        if (pending.skipContentHash) {
          // Bulk import actions are always keep-both placements; any physical
          // occupant absent from the identity index is an unapproved target.
          if (currentDestination !== undefined) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED');
          }
          continue;
        }
        if (
          !sameDestinationSnapshot(action.expectedDestination, currentDestination)
          || (currentDestination !== undefined && !action.isReplacement)
        ) {
          throw new LibraryServiceError('IMPORT_APPLY_FAILED');
        }
      }
    } catch (error) {
      destinationGuardFailed = true;
      throw error;
    }

    actions.forEach((action, index) => {
      if (pending.skipContentHash) return;
      const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
      if (existsSync(destinationPath)) {
        const existingBackupPath = path.join(backupPath, String(index));
        renameSync(destinationPath, existingBackupPath);
        backups.push({ backupPath: existingBackupPath, destinationPath });
      }
    });
    this.failAt('after-backup');
    this.failAt('crash-after-backup');
    actions.forEach((action, index) => {
      const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
      renameSync(stagedPaths[index]!, destinationPath);
      const sourceModifiedAtMs = action.entry.eagleMetadata?.sourceModifiedAtMs;
      if (sourceModifiedAtMs !== undefined && Number.isFinite(sourceModifiedAtMs)) {
        try {
          const timestamp = new Date(sourceModifiedAtMs);
          if (Number.isFinite(timestamp.getTime())) utimesSync(destinationPath, timestamp, timestamp);
        } catch (error) {
          // Eagle's timestamp is advisory. A filesystem that cannot restore
          // it must not turn an otherwise valid byte import into a rollback.
          this.diagnose('eagle-import.restore-mtime', error, {
            relativeFilePath: action.destinationRelativePath,
          });
        }
      }
      placedPaths.push(destinationPath);
      if (index === 0) this.failAt('after-first-place');
    });
    this.failAt('after-place');
    this.failAt('crash-after-place');

    // commit folders first, then each asset in its own
    // transaction so the canvas can refresh as items become durable.
    // failAt('before-db-commit') still fires before the first asset commit
    // (import-planning rollback tests). After ≥1 asset commits, later
    // failures keep those assets and return a partial completion.
    const now = new Date().toISOString();
    const folderRows = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity, created_at, appearance_glyph_kind, appearance_glyph_value, appearance_color_id FROM managed_folders ORDER BY relative_path',
      )
      .all() as ManagedFolderRow[];
    const foldersByPath = new Map(folderRows.map((folder) => [folder.path_identity, folder]));
    openLibrary.connection.transaction(() => {
      for (const relativeDirectory of sortedDirectories) {
        const directoryIdentity = portablePathIdentity(relativeDirectory);
        if (foldersByPath.has(directoryIdentity)) continue;
        const parentPath = path.posix.dirname(relativeDirectory);
        const parentIdentity = parentPath === '.' ? undefined : portablePathIdentity(parentPath);
        const folder: ManagedFolderRow = {
          folder_id: randomUUID(),
          parent_folder_id:
            parentIdentity === undefined
              ? null
              : (foldersByPath.get(parentIdentity)?.folder_id ?? null),
          name: path.posix.basename(relativeDirectory),
          relative_path: relativeDirectory,
          path_identity: directoryIdentity,
        };
        if (parentPath !== '.' && folder.parent_folder_id === null) {
          throw new Error('Imported folder parent is missing.');
        }
        openLibrary.connection
          .prepare(
            `INSERT INTO managed_folders
               (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            folder.folder_id,
            folder.parent_folder_id,
            folder.name,
            folder.relative_path,
            folder.path_identity,
            now,
          );
        foldersByPath.set(directoryIdentity, folder);
      }
    })();

    const deferredThumbnails: Array<{
      assetId: string;
      copied?: EagleCopiedThumbnail;
      destinationRelativePath: string;
      metadata: EagleImportedMetadata;
      revisionId: string;
    }> = [];
    const bulkCommit = pending.skipContentHash === true;
    const commitImportedAssets = (): void => {
    for (const action of actions) {
      this.failAt('before-db-commit');
      let committedAssetId: string | null = null;
      let committedRevisionId: string | null = null;
      openLibrary.connection.transaction(() => {
        const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
        let fileByteSize: number;
        let fileModifiedAt: string;
        if (bulkCommit) {
          fileByteSize = action.entry.byteSize;
          if (!Number.isSafeInteger(fileByteSize) || fileByteSize < 0) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
            });
          }
          const sourceModifiedAtMs = action.entry.eagleMetadata?.sourceModifiedAtMs;
          fileModifiedAt =
            sourceModifiedAtMs !== undefined && Number.isFinite(sourceModifiedAtMs)
              ? new Date(sourceModifiedAtMs).toISOString()
              : now;
        } else {
          // Persist the exact same millisecond representation used by watcher
          // refreshes. Mixing Stats.mtime (Date) with BigIntStats.mtimeMs can
          // manufacture a phantom external revision for freshly imported files
          // on filesystems that retain sub-millisecond timestamps.
          const fileStat = lstatSync(destinationPath, { bigint: true });
          fileByteSize = Number(fileStat.size);
          if (!Number.isSafeInteger(fileByteSize)) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
            });
          }
          fileModifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
        }
        const directory = path.posix.dirname(action.destinationRelativePath);
        const managedFolderId =
          directory === '.'
            ? null
            : (foldersByPath.get(portablePathIdentity(directory))?.folder_id ?? null);
        const assetId = action.existingAsset?.asset_id ?? randomUUID();
        const revisionId = randomUUID();
        const pathIdentity = portablePathIdentity(action.destinationRelativePath);
        if (!action.existingAsset) {
          openLibrary.connection
            .prepare(
              `INSERT INTO assets
               (asset_id, location_kind, managed_folder_id, relative_file_path,
                  path_identity, current_revision_id, availability, created_at, updated_at)
               VALUES (?, 'managed', ?, ?, ?, NULL, 'available', ?, ?)`,
            )
            .run(
              assetId,
              managedFolderId,
              action.destinationRelativePath,
              pathIdentity,
              now,
              now,
            );
          importedCount += 1;
          if (action.isReplacement) replacedCount += 1;
        } else {
          replacedCount += 1;
        }
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at, content_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            revisionId,
            assetId,
            action.existingAsset?.current_revision_id ?? null,
            fileByteSize,
            fileModifiedAt,
            path.posix.basename(action.entry.destinationRelativePath),
            action.existingAsset ? 'replace' : 'import',
            now,
            action.entry.contentFingerprint
              ?? (pending.skipContentHash
                ? null
                : this.computeContentFingerprint(destinationPath)),
          );
        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET managed_folder_id = ?, relative_file_path = ?, path_identity = ?,
                    current_revision_id = ?, availability = 'available', updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            managedFolderId,
            action.destinationRelativePath,
            pathIdentity,
            revisionId,
            now,
            assetId,
          );
        const eagleSize =
          action.entry.eagleMetadata?.width && action.entry.eagleMetadata.height
            ? {
                width: action.entry.eagleMetadata.width,
                height: action.entry.eagleMetadata.height,
              }
            : null;
        if (eagleSize) {
          this.persistExtractedImageDimensions(openLibrary, revisionId, eagleSize);
        } else if (!pending.skipContentHash) {
          this.persistSourceImageDimensions(openLibrary, revisionId, {
            relative_file_path: action.destinationRelativePath,
            location_kind: 'managed',
            linked_folder_id: null,
          });
        }
        if (action.entry.eagleMetadata) {
          this.persistEagleImportedMetadata(
            openLibrary,
            assetId,
            action.entry.eagleMetadata,
            now,
          );
        }
        if (action.entry.sourcePageUrl !== undefined) {
          const sourcePageUrl = action.entry.sourcePageUrl.trim();
          if (sourcePageUrl === '') {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED');
          }
          openLibrary.connection
            .prepare(
              `INSERT INTO asset_metadata
                 (asset_id, description, rating, favorite, palette,
                  source_page_url, entity_version, updated_at)
               VALUES (?, NULL, 0, 0, NULL, ?, 1, ?)
               ON CONFLICT(asset_id) DO UPDATE SET
                 source_page_url = excluded.source_page_url,
                 entity_version = asset_metadata.entity_version + 1,
                 updated_at = excluded.updated_at`,
            )
            .run(assetId, sourcePageUrl, now);
          this.failAt('after-import-metadata');
        }
        this.syncAssetSearchContent(openLibrary.connection, assetId);
        committedAssetId = assetId;
        committedRevisionId = revisionId;
      })();
      if (committedAssetId) {
        affectedAssetIds.push(committedAssetId);
        if (action.entry.eagleMetadata && committedRevisionId) {
          if (bulkCommit) {
            deferredThumbnails.push({
              assetId: committedAssetId,
              copied: action.entry.copiedThumbnail,
              destinationRelativePath: action.destinationRelativePath,
              metadata: action.entry.eagleMetadata,
              revisionId: committedRevisionId,
            });
          } else {
            this.persistEagleThumbnailArtifact(
              openLibrary,
              committedAssetId,
              committedRevisionId,
              action.destinationRelativePath,
              action.entry.eagleMetadata,
            );
          }
        }
        if (!bulkCommit) this.noteClientFilesystemMutation();
        if (!pending.suppressAssetChangeEvents) {
          this.emitClientAssetsChanged(pending.libraryId, 1, true);
        }
      }
    }
    };

    if (bulkCommit) {
      openLibrary.connection.transaction(commitImportedAssets)();
      this.noteClientFilesystemMutation();
      const copiedThumbs: Array<{
        assetId: string;
        copied: EagleCopiedThumbnail;
        revisionId: string;
      }> = [];
      for (const item of deferredThumbnails) {
        try {
          const copied = item.copied ?? this.copyEagleThumbnailFile(
            openLibrary,
            item.destinationRelativePath,
            item.metadata,
          );
          if (copied) copiedThumbs.push({
            assetId: item.assetId,
            copied,
            revisionId: item.revisionId,
          });
        } catch (error) {
          this.diagnose('eagle-import.thumbnail-skipped', error, {
            assetId: item.assetId,
            reason: 'EAGLE_THUMBNAIL_FAILED',
          });
        }
      }
      if (copiedThumbs.length > 0) {
        try {
          openLibrary.connection.transaction(() => {
            for (const item of copiedThumbs) {
              this.insertCopiedEagleThumbnail(
                openLibrary,
                item.assetId,
                item.revisionId,
                item.copied,
              );
            }
          })();
        } catch (error) {
          for (const item of copiedThumbs) {
            rmSync(item.copied.artifactAbsPath, { force: true });
          }
          this.diagnose('eagle-import.thumbnail-skipped', error, {
            reason: 'EAGLE_THUMBNAIL_BATCH_FAILED',
            count: copiedThumbs.length,
          });
        }
      }
    } else {
      commitImportedAssets();
    }

    jobLease.assertCurrent();
    openLibrary.connection
      .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
      .run(new Date().toISOString(), operationId);
    committed = true;
    this.rememberFinalizedImport(input.importId);
    if (pending.createImageSequence !== false) {
      try {
        this.createDetectedImageSequences(
          openLibrary,
          affectedAssetIds,
          pending.imageSequenceFps ?? DEFAULT_IMAGE_SEQUENCE_FPS,
        );
      } catch (error) {
        this.diagnose('import-apply.post-commit-sequences', error, {
          libraryId: pending.libraryId,
          operationId,
          affectedCount: affectedAssetIds.length,
        });
      }
    }

    // The SQLite commit is the point of no return. Cleanup is recoverable from the
    // committed operation row and must never enter the pre-commit rollback path.
    try {
      this.failAt('committed-cleanup');
      this.removeOperation(operationPath);
    } catch {
      // recoverFileOperations removes committed operation data on the next open.
    }
    return completeCommittedImport();
  } catch (error) {
    if (committed) {
      return completeCommittedImport();
    }
    if (affectedAssetIds.length > 0) {
      // Partial durable import: keep committed rows/files and finish the op.
      try {
        openLibrary.connection
          .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
          .run(new Date().toISOString(), operationId);
        this.removeOperation(operationPath);
      } catch {
        // Recovery can finalize a stale applying row on the next open.
      }
      this.rememberFinalizedImport(input.importId);
      if (pending.createImageSequence !== false) {
        try {
          this.createDetectedImageSequences(
            openLibrary,
            affectedAssetIds,
            pending.imageSequenceFps ?? DEFAULT_IMAGE_SEQUENCE_FPS,
          );
        } catch (postCommitError) {
          this.diagnose('import-apply.partial-post-commit-sequences', postCommitError, {
            libraryId: pending.libraryId,
            operationId,
            affectedCount: affectedAssetIds.length,
          });
        }
      }
      return completeCommittedImport();
    }
    if (error instanceof SimulatedCrashError) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
    }
    const untouchedGuardFailure = destinationGuardFailed
      && backups.length === 0
      && placedPaths.length === 0;
    const rolledBack = untouchedGuardFailure
      ? (() => {
          let succeeded = true;
          for (const directoryPath of [...createdDirectories].reverse()) {
            try {
              rmdirSync(directoryPath);
            } catch (cleanupError) {
              if (
                isMissingPathError(cleanupError)
                || hasErrorCode(cleanupError, 'ENOTEMPTY')
                || hasErrorCode(cleanupError, 'EEXIST')
              ) {
                // The guard may have found a newly-created external file in
                // this directory. Preserve that occupied directory.
                continue;
              }
              succeeded = false;
              this.diagnose('import-apply.preflight-directory-cleanup', cleanupError, {
                libraryId: pending.libraryId,
                operationId,
              });
            }
          }
          try {
            this.removeOperation(operationPath);
          } catch (cleanupError) {
            succeeded = false;
            this.diagnose('import-apply.preflight-operation-cleanup', cleanupError, {
              libraryId: pending.libraryId,
              operationId,
            });
          }
          return succeeded;
        })()
      : rollbackFiles();
    try {
      openLibrary.connection
        .prepare(
          `UPDATE file_operations
              SET status = ?, error_code = 'IMPORT_APPLY_FAILED', updated_at = ?
            WHERE operation_id = ?`,
        )
        .run(rolledBack ? 'rolled_back' : 'failed', new Date().toISOString(), operationId);
    } catch {
      // The filesystem rollback is authoritative; recovery can retry a stale applying row.
    }
    throw serviceError(error, 'IMPORT_APPLY_FAILED');
  } finally {
    jobHeartbeat.stop();
    try {
      jobLease.release();
    } catch (releaseError) {
      this.diagnose('import-apply.lease-release', releaseError, {
        libraryId: pending.libraryId,
        operationId,
      });
    }
  }
}

export function emitManagedImportProgress(this: LibraryService, importId: string, phase: ImportProgressEvent['phase'], filesProcessed: number, totalFiles: number, bytesProcessed: number, totalBytes: number): void {
  this.emitProgress({
    type: 'import.progress',
    importId,
    phase,
    cancelable: true,
    filesProcessed,
    totalFiles,
    bytesProcessed,
    totalBytes,
  });
}

export function emitLinkedFolderImportProgress(this: LibraryService, importId: string, phase: ImportProgressEvent['phase'], filesProcessed: number, totalFiles: number, bytesProcessed: number, totalBytes: number): void {
  this.emitProgress({
    type: 'import.progress',
    importId,
    phase,
    cancelable: false,
    copiesFiles: false,
    filesProcessed,
    totalFiles,
    bytesProcessed,
    totalBytes,
  });
}

export function stageOneImportSourceEntry(this: LibraryService, input: {
    openLibrary: OpenLibrary;
    entry: ImportSourceEntry;
    stagedPath: string;
    skipContentHash: boolean;
  }): ImportSourceEntry {
  const byteSize = this.copySourceSnapshot(
    input.entry,
    input.stagedPath,
    input.skipContentHash ? { bulk: true } : undefined,
  );
  if (input.skipContentHash) {
    const staged: ImportSourceEntry = {
      ...input.entry,
      byteSize,
      sourcePath: input.stagedPath,
    };
    if (input.entry.eagleMetadata?.thumbnailPath) {
      try {
        const copied = this.copyEagleThumbnailFile(
          input.openLibrary,
          input.entry.destinationRelativePath,
          input.entry.eagleMetadata,
        );
        if (copied) staged.copiedThumbnail = copied;
      } catch (error) {
        this.diagnose('eagle-import.thumbnail-skipped', error, {
          reason: 'EAGLE_THUMBNAIL_FAILED',
        });
      }
    }
    return staged;
  }
  const hashes = sha256AndContentFingerprintFileAtPath(input.stagedPath);
  return {
    ...input.entry,
    byteSize,
    sha256: hashes.sha256,
    contentFingerprint: hashes.contentFingerprint,
    sourcePath: input.stagedPath,
  };
}

export function stageImportSourceEntries(this: LibraryService, input: {
    openLibrary: OpenLibrary;
    entries: ImportSourceEntry[];
    stagePath: string;
    skipContentHash: boolean;
    onStagedEntry?: (processedCount: number, bytesProcessed: number) => void;
    importId?: string;
    totalFiles: number;
    totalBytes: number;
    cancelState?: TransferCancelState;
    yieldCheckpoints?: boolean;
    skipRemainingSourceFailures?: boolean;
    stageNameOffset?: number;
    skipped?: SkippedImportSource[];
  }): ImportSourceEntry[] | Promise<ImportSourceEntry[]> {
  const stagedEntries: ImportSourceEntry[] = [];
  const skipped = input.skipped ?? [];
  const throttle = createProgressThrottle();
  let bytesProcessed = 0;
  const stageNameOffset = input.stageNameOffset ?? 0;
  const stageIndex = (index: number): void => {
    if (input.cancelState?.cancelled) {
      if (input.cancelState.mode === 'stop') return;
      if (input.importId) {
        this.emitManagedImportProgress(
          input.importId,
          'cancelled',
          index,
          input.totalFiles,
          bytesProcessed,
          input.totalBytes,
        );
      }
      throw new LibraryServiceError('CANCELLED');
    }
    const entry = input.entries[index]!;
    const stagedPath = path.join(
      input.stagePath,
      String(stageNameOffset + stagedEntries.length),
    );
    try {
      const staged = this.stageOneImportSourceEntry({
        openLibrary: input.openLibrary,
        entry,
        stagedPath,
        skipContentHash: input.skipContentHash,
      });
      stagedEntries.push(staged);
      bytesProcessed += staged.byteSize;
      input.onStagedEntry?.(index + 1, staged.byteSize);
    } catch (error) {
      if (!isSkippableImportSourceFailure(error)) throw error;
      const skippedEntry = skippedImportSourceFromError(error, entry.sourcePath);
      skipped.push(skippedEntry);
      if (!input.skipRemainingSourceFailures) {
        throw new ImportSourceFailurePause(
          [skippedEntry],
          stagedEntries,
          input.entries.slice(index + 1),
          skipped,
        );
      }
    }
    if (index === 0) this.failAt('crash-during-prepare-stage');
    if (
      input.importId
      && throttle.shouldEmit(index === input.entries.length - 1)
    ) {
      this.emitManagedImportProgress(
        input.importId,
        'copy',
        index + 1,
        input.totalFiles,
        bytesProcessed,
        input.totalBytes,
      );
    }
  };
  if (input.yieldCheckpoints) {
    return (async () => {
      if (input.importId) {
        this.emitManagedImportProgress(
          input.importId,
          'copy',
          0,
          input.totalFiles,
          0,
          input.totalBytes,
        );
      }
      for (let index = 0; index < input.entries.length; index += 1) {
        await transferCheckpoint();
        if (input.cancelState?.cancelled && input.cancelState.mode === 'stop') {
          break;
        }
        stageIndex(index);
      }
      if (
        input.cancelState?.cancelled
        && input.cancelState.mode === 'stop'
        && stagedEntries.length === 0
      ) {
        if (input.importId) {
          this.emitManagedImportProgress(
            input.importId,
            'cancelled',
            0,
            input.totalFiles,
            0,
            input.totalBytes,
          );
        }
        throw new LibraryServiceError('CANCELLED');
      }
      return stagedEntries;
    })();
  }
  for (let index = 0; index < input.entries.length; index += 1) {
    if (input.cancelState?.cancelled && input.cancelState.mode === 'stop') {
      break;
    }
    stageIndex(index);
  }
  if (
    input.cancelState?.cancelled
    && input.cancelState.mode === 'stop'
    && stagedEntries.length === 0
  ) {
    if (input.importId) {
      this.emitManagedImportProgress(
        input.importId,
        'cancelled',
        0,
        input.totalFiles,
        0,
        input.totalBytes,
      );
    }
    throw new LibraryServiceError('CANCELLED');
  }
  return stagedEntries;
}

export function acquireImportTransfer(this: LibraryService, importId: string, sourcePath: string, destinationPath: string, cancelState: TransferCancelState): ActiveImportTransfer {
  const sourceKey = this.transferPathKey(sourcePath);
  const destinationKey = this.transferPathKey(destinationPath);
  const activeSourceImportId = this.activeImportBySource.get(sourceKey);
  const activeDestinationImportId = this.activeImportByDestination.get(destinationKey);
  if (activeSourceImportId || activeDestinationImportId) {
    this.transferInProgress('transfer.import.in-progress', {
      requestedImportId: importId,
      activeImportId: activeSourceImportId ?? activeDestinationImportId,
      sourcePath,
      destinationPath,
      sourceConflict: Boolean(activeSourceImportId),
      destinationConflict: Boolean(activeDestinationImportId),
    });
  }
  this.activeImportBySource.set(sourceKey, importId);
  this.activeImportByDestination.set(destinationKey, importId);
  this.activeImports.set(importId, cancelState);
  return { importId, sourceKey, destinationKey };
}

export function releaseImportTransfer(this: LibraryService, transfer: ActiveImportTransfer): void {
  this.activeImports.delete(transfer.importId);
  if (this.activeImportBySource.get(transfer.sourceKey) === transfer.importId) {
    this.activeImportBySource.delete(transfer.sourceKey);
  }
  if (this.activeImportByDestination.get(transfer.destinationKey) === transfer.importId) {
    this.activeImportByDestination.delete(transfer.destinationKey);
  }
}

export async function importLibraryFromFolder(this: LibraryService, input: {
    sourceFolderPath: string;
    copyToParentPath?: string;
  }): Promise<{
    importId: string;
    libraryId: string;
    displayName: string;
    libraryPath: string;
  }> {
  const importId = randomUUID();
  const cancelState: TransferCancelState = { cancelled: false };
  const importDestinationPath = input.copyToParentPath
    ? path.join(input.copyToParentPath, path.basename(input.sourceFolderPath))
    : input.sourceFolderPath;
  const importTransfer = this.acquireImportTransfer(
    importId,
    input.sourceFolderPath,
    importDestinationPath,
    cancelState,
  );
  let ownedDestinationPath: string | undefined;
  let completed = false;

  try {
    // Phase 1: validate source.
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'validate', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    await transferCheckpoint();
    if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

    // Validate sourceFolderPath is a readable directory (not a symlink).
    let sourceStat;
    try {
      sourceStat = lstatSync(input.sourceFolderPath);
    } catch (error) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    // Validate Assets/ exists (real directory, not symlink).
    const assetsPath = managedStoragePath(input.sourceFolderPath);
    if (!realDirectoryExists(assetsPath)) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    // Validate .keel/library.db exists (real file, not symlink).
    const dbPath = libraryMetaDir(input.sourceFolderPath, 'library.db');
    if (!realFileExists(dbPath)) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    assertTreeContainsNoSymlinks(input.sourceFolderPath);

    let libraryPath: string;

    if (input.copyToParentPath) {
      // Phase 2: copy.
      const copyStats = measureCopyTree(input.sourceFolderPath);
      let copiedFiles = 0;
      let copiedBytes = 0;
      const copyProgressThrottle = createProgressThrottle();
      const emitCopyProgress = (force = false): void => {
        if (!copyProgressThrottle.shouldEmit(force)) return;
        this.emitProgress({
          type: 'import.progress', importId,
          phase: 'copy', cancelable: true,
          filesProcessed: copiedFiles, totalFiles: copyStats.fileCount,
          bytesProcessed: copiedBytes, totalBytes: copyStats.totalBytes,
        });
      };
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'copy', cancelable: true,
        filesProcessed: 0, totalFiles: copyStats.fileCount,
        bytesProcessed: 0, totalBytes: copyStats.totalBytes,
      });

      const baseName = path.basename(input.sourceFolderPath);
      libraryPath = path.join(input.copyToParentPath, baseName);

      if (existsSync(libraryPath)) {
        throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
      }
      try {
        mkdirSync(libraryPath);
        ownedDestinationPath = libraryPath;
      } catch (error) {
        if (hasErrorCode(error, 'EEXIST')) {
          throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS', { cause: error });
        }
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      }

      if (cancelState.cancelled) {
        this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
        throw new LibraryServiceError('CANCELLED');
      }

      try {
        await copyDirRecursiveCancellable(
          input.sourceFolderPath,
          libraryPath,
          cancelState,
          (byteSize) => {
            copiedFiles += 1;
            copiedBytes += byteSize;
            emitCopyProgress();
          },
        );
        emitCopyProgress(true);
      } catch (error) {
        // Clean up incomplete copy.
        this.removeOwnedTransferPath('import.copy.failure.cleanup', libraryPath, true);
        if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
          this.emitProgress({
            type: 'import.progress', importId, phase: 'cancelled', cancelable: false,
            filesProcessed: copiedFiles, totalFiles: copyStats.fileCount,
            bytesProcessed: copiedBytes, totalBytes: copyStats.totalBytes,
          });
        }
        throw error;
      }

      if (cancelState.cancelled) {
        this.removeOwnedTransferPath('import.copy.cancel.cleanup', libraryPath, true);
        this.emitProgress({
          type: 'import.progress', importId, phase: 'cancelled', cancelable: false,
          filesProcessed: copiedFiles, totalFiles: copyStats.fileCount,
          bytesProcessed: copiedBytes, totalBytes: copyStats.totalBytes,
        });
        throw new LibraryServiceError('CANCELLED');
      }

    } else {
      // Open in place.
      libraryPath = input.sourceFolderPath;
    }

    // A copied library is a transactional transfer, not an opportunity to
    // rescue a source that changed halfway through the copy. Reject an
    // incomplete destination before openLibrary's general Assets rescue
    // ladder can turn the partial copy into a successful new library.
    if (input.copyToParentPath && !realFileExists(databasePath(libraryPath))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    // Phase 3: open.
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'open', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });

    const summary = this.openLibrary(libraryPath);

    // Phase 4: complete.
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'complete', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });

    completed = true;
    return {
      importId,
      libraryId: summary.libraryId,
      displayName: summary.displayName,
      libraryPath: summary.libraryPath,
    };
  } catch (error) {
    if (cancelState.cancelled) {
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
    } else {
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'failed', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
    }
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  } finally {
    if (ownedDestinationPath && !completed) {
      this.removeOwnedTransferPath('import.failure.cleanup-destination', ownedDestinationPath, true);
    }
    this.releaseImportTransfer(importTransfer);
  }
}

export function cancelImport(this: LibraryService, importId: string, mode: 'abandon' | 'stop' = 'abandon'): void {
  const state = this.activeImports.get(importId);
  if (state) {
    if (state.mode === 'abandon' && mode === 'stop') {
      state.onCancel?.();
      return;
    }
    state.mode = mode;
    state.cancelled = true;
    state.onCancel?.();
    return;
  }
  // After prepare returns a conflict/sequence decision, the import lives in
  // pendingImports. Overlay "取消导入" must abandon rather than throw
  // IMPORT_NOT_FOUND and leave the UI deadlocked.
  if (this.pendingImports.has(importId)) {
    this.abandonImport(importId);
    this.emitProgress({
      type: 'import.progress',
      importId,
      phase: 'cancelled',
      cancelable: false,
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    return;
  }
  if (this.isFinalizedImport(importId)) {
    this.emitProgress({
      type: 'import.progress',
      importId,
      phase: 'complete',
      cancelable: false,
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    return;
  }
  throw new LibraryServiceError('IMPORT_NOT_FOUND');
}

export function validateImportSource(this: LibraryService, sourceFolderPath: string): {
    libraryId: string;
    displayName: string;
  } {
  // Validate sourceFolderPath is a readable directory (not a symlink).
  let sourceStat;
  try {
    sourceStat = lstatSync(sourceFolderPath);
  } catch (error) {
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }

  // Validate Assets/ exists (real directory, not symlink).
  const assetsPath = managedStoragePath(sourceFolderPath);
  if (!realDirectoryExists(assetsPath)) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }

  // Validate .keel/library.db exists (real file, not symlink).
  const dbPath = libraryMetaDir(sourceFolderPath, 'library.db');
  if (!realFileExists(dbPath)) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }

  assertTreeContainsNoSymlinks(sourceFolderPath);

  // Open a read-only connection to read the library identity.
  let connection: DatabaseConnection | undefined;
  try {
    connection = openConfiguredDatabase(dbPath);
    const library = connection
      .prepare('SELECT library_id, display_name FROM library ORDER BY library_id LIMIT 2')
      .all() as Array<{ library_id: string; display_name: string }>;
    if (library.length !== 1 || !library[0]?.library_id || !library[0]?.display_name) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    return {
      libraryId: library[0].library_id,
      displayName: library[0].display_name,
    };
  } finally {
    closeIgnoringFailure(connection);
  }
}
