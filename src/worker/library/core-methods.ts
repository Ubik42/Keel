import { type PluginProviderFieldType } from "../../plugins/plugin-providers";
import { smartCollectionQueryDefinitionSchema } from "../../shared/asset-types";
import { automaticTaskConfigSchema, automaticTaskLayoutSchema, type AutomaticTask, type AutomaticTaskConfig, type AutomaticTaskLayout } from "../../shared/automatic-tasks";
import { parseWritableAppearance, type EntityAppearance, type EntityAppearanceTarget } from "../../shared/entity-appearance";
import { isLibraryMetaDirName } from "../../shared/library-meta-dir";
import { parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { isSqliteEngineUnavailableError } from "../../shared/protocol/errors";
import { type DeleteProgressEvent, type ExportProgressEvent, type ImportCompletion, type ImportConflictPlan, type ImportProgressEvent, type ImportSourceFailurePlan, type InternalLibrarySummary } from "../../shared/protocol/responses";
import { type ResolvedAddress } from "./secure-http-download";
import type { LibraryService} from "../library-service";
import { DATABASE_BACKUP_INTERVAL_MS, LibraryServiceError, MEDIA_COMPONENT_PROBE_RETRY_MS, OIIO_VERSION, SimulatedCrashError, closeIgnoringFailure, copyFileExclusive, databasePath, hasErrorCode, isDefaultIgnoredAssetEntry, isMissingPathError, isUnreadablePathError, openConfiguredDatabase, prohibitedIpAddress, realFileExists, requireSharp, runSharpDecoder, sameSourceSnapshot, sourceChanged, sourceSnapshot, type DatabaseConnection, type DiscoveredSourceEntry, type ExistingDestination, type ImportFailurePoint, type ImportSourceEntry, type MediaAutoRepairComponent, type ModelThumbnailRenderOutcome, type ModelThumbnailRendererInput, type OpenLibrary, type OpenReconciliationTask, type TransferCancelState, unsupportedSourceEntry, verifyOpenableSchema } from "../library-service";
import { BUILT_IN_COMPANION_EXTENSIONS, normalizeCompanionExtensions, pairCompanions, type CompanionCandidateRow } from "./companion-files";
import type { ImportDestinationDirectoryCache } from "./import-destination-directory-cache";
import { ImportSourceFailurePause } from "./import-source-failure";
import { columnsFor, hasTable } from "./lenient-columns";
import { normalizeRelativeAssetPath, portablePathSegmentIdentity } from "./library-rules";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, isSQLiteWriteContention, type AcquireLibraryWriteLeaseOptions } from "./library-write-coordinator";
import { materializePluginDerivedFields as materializePluginDerivedFieldRows } from "./plugin-derived-field-repository";
import { sqliteAllInChunks } from "./sqlite-in";
import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, readdirSync, realpathSync, rmSync, type BigIntStats, type Stats, writeSync } from "node:fs";
import { lstat as lstatAsync, open as openFileAsync, opendir as opendirAsync } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface CoreMethods {
  noteInteractiveActivity(...args: Parameters<typeof noteInteractiveActivity>): ReturnType<typeof noteInteractiveActivity>;
  noteClientFilesystemMutation(...args: Parameters<typeof noteClientFilesystemMutation>): ReturnType<typeof noteClientFilesystemMutation>;
  createConsistentDatabaseSnapshot(...args: Parameters<typeof createConsistentDatabaseSnapshot>): ReturnType<typeof createConsistentDatabaseSnapshot>;
  databaseBackupNow(...args: Parameters<typeof databaseBackupNow>): ReturnType<typeof databaseBackupNow>;
  armDatabaseBackupTimer(...args: Parameters<typeof armDatabaseBackupTimer>): ReturnType<typeof armDatabaseBackupTimer>;
  createDatabaseBackup(...args: Parameters<typeof createDatabaseBackup>): ReturnType<typeof createDatabaseBackup>;
  diagnose(...args: Parameters<typeof diagnose>): ReturnType<typeof diagnose>;
  reportDiagnostic(...args: Parameters<typeof reportDiagnostic>): ReturnType<typeof reportDiagnostic>;
  failAt(...args: Parameters<typeof failAt>): ReturnType<typeof failAt>;
  continueAfterSourceFailure(...args: Parameters<typeof continueAfterSourceFailure>): ReturnType<typeof continueAfterSourceFailure>;
  continueAfterSourceFailureCancellable(...args: Parameters<typeof continueAfterSourceFailureCancellable>): ReturnType<typeof continueAfterSourceFailureCancellable>;
  sqliteConnectionIsRegisteredPrimary(...args: Parameters<typeof sqliteConnectionIsRegisteredPrimary>): ReturnType<typeof sqliteConnectionIsRegisteredPrimary>;
  prepareCached<T>(openLibrary: OpenLibrary, sql: string): T;
  dropPreparedStatementCache(...args: Parameters<typeof dropPreparedStatementCache>): ReturnType<typeof dropPreparedStatementCache>;
  runBoundedWrite<T>(libraryId: string, operation: () => T, options?: AcquireLibraryWriteLeaseOptions): Promise<T>;
  portableDiskDestination(...args: Parameters<typeof portableDiskDestination>): ReturnType<typeof portableDiskDestination>;
  managedDestinationIndex(...args: Parameters<typeof managedDestinationIndex>): ReturnType<typeof managedDestinationIndex>;
  copySourceSnapshot(...args: Parameters<typeof copySourceSnapshot>): ReturnType<typeof copySourceSnapshot>;
  setEntityAppearance(...args: Parameters<typeof setEntityAppearance>): ReturnType<typeof setEntityAppearance>;
  catalogTableHasRows(...args: Parameters<typeof catalogTableHasRows>): ReturnType<typeof catalogTableHasRows>;
  setCompanionExtensions(...args: Parameters<typeof setCompanionExtensions>): ReturnType<typeof setCompanionExtensions>;
  ensureCompanionIndex(...args: Parameters<typeof ensureCompanionIndex>): ReturnType<typeof ensureCompanionIndex>;
  getAutomaticTaskLayout(...args: Parameters<typeof getAutomaticTaskLayout>): ReturnType<typeof getAutomaticTaskLayout>;
  setAutomaticTaskLayout(...args: Parameters<typeof setAutomaticTaskLayout>): ReturnType<typeof setAutomaticTaskLayout>;
  setAutomaticTask(...args: Parameters<typeof setAutomaticTask>): ReturnType<typeof setAutomaticTask>;
  runAutomaticTasks(...args: Parameters<typeof runAutomaticTasks>): ReturnType<typeof runAutomaticTasks>;
  companionSummaries(...args: Parameters<typeof companionSummaries>): ReturnType<typeof companionSummaries>;
  hasHumanDescription(...args: Parameters<typeof hasHumanDescription>): ReturnType<typeof hasHumanDescription>;
  materializePluginDerivedFields(...args: Parameters<typeof materializePluginDerivedFields>): ReturnType<typeof materializePluginDerivedFields>;
  renderModelViewsSheet(...args: Parameters<typeof renderModelViewsSheet>): ReturnType<typeof renderModelViewsSheet>;
  libraryDisplayName(...args: Parameters<typeof libraryDisplayName>): ReturnType<typeof libraryDisplayName>;
  ensureOiiOViewerImage(...args: Parameters<typeof ensureOiiOViewerImage>): ReturnType<typeof ensureOiiOViewerImage>;
  availableAutoRepairComponents(...args: Parameters<typeof availableAutoRepairComponents>): ReturnType<typeof availableAutoRepairComponents>;
  assertNotInManagedSpace(...args: Parameters<typeof assertNotInManagedSpace>): ReturnType<typeof assertNotInManagedSpace>;
  assertNoSymlinkEscape(...args: Parameters<typeof assertNoSymlinkEscape>): ReturnType<typeof assertNoSymlinkEscape>;
  enumerateManagedSources(...args: Parameters<typeof enumerateManagedSources>): ReturnType<typeof enumerateManagedSources>;
  computeContentFingerprint(...args: Parameters<typeof computeContentFingerprint>): ReturnType<typeof computeContentFingerprint>;
  computeContentFingerprintAsync(...args: Parameters<typeof computeContentFingerprintAsync>): ReturnType<typeof computeContentFingerprintAsync>;
  enumerateSourcesAsync(...args: Parameters<typeof enumerateSourcesAsync>): ReturnType<typeof enumerateSourcesAsync>;
  primaryDatabaseIsDamaged(...args: Parameters<typeof primaryDatabaseIsDamaged>): ReturnType<typeof primaryDatabaseIsDamaged>;
  validateDatabaseBackup(...args: Parameters<typeof validateDatabaseBackup>): ReturnType<typeof validateDatabaseBackup>;
  reuseOrRejectDuplicateCatalog(...args: Parameters<typeof reuseOrRejectDuplicateCatalog>): ReturnType<typeof reuseOrRejectDuplicateCatalog>;
  resolvePublicDownloadTarget(...args: Parameters<typeof resolvePublicDownloadTarget>): ReturnType<typeof resolvePublicDownloadTarget>;
  emitProgress(...args: Parameters<typeof emitProgress>): ReturnType<typeof emitProgress>;
  transferPathKey(...args: Parameters<typeof transferPathKey>): ReturnType<typeof transferPathKey>;
  transferInProgress(...args: Parameters<typeof transferInProgress>): ReturnType<typeof transferInProgress>;
}

export function noteInteractiveActivity(this: LibraryService, libraryId: string, idleMs = 1_000): void {
  this.interactiveIdleUntilByLibrary.set(
    libraryId,
    Math.max(
      this.interactiveIdleUntilByLibrary.get(libraryId) ?? 0,
      Date.now() + idleMs,
    ),
  );
}

export function noteClientFilesystemMutation(this: LibraryService): void {
  const debounceMs = this.options.debounceMs ?? 250;
  this.suppressWatcherNotifyUntilMs = Math.max(
    this.suppressWatcherNotifyUntilMs,
    this.watchNotifyNow() + debounceMs * 6,
  );
}

export async function createConsistentDatabaseSnapshot(this: LibraryService, connection: DatabaseConnection, destinationPath: string, cancelState: TransferCancelState): Promise<void> {
  try {
    await connection.backup(destinationPath, {
      progress: () => {
        if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');
        return cancelState.backupPageBatch ?? 100;
      },
    });
  } catch (error) {
    try { rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }

  let verifyConnection: DatabaseConnection | undefined;
  try {
    verifyConnection = openConfiguredDatabase(destinationPath);
    const result = verifyConnection.pragma('quick_check(1)', { simple: true });
    if (result !== 'ok') throw new LibraryServiceError('LIBRARY_CORRUPT');
  } catch (error) {
    try { rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  } finally {
    closeIgnoringFailure(verifyConnection);
  }
}

export function databaseBackupNow(this: LibraryService): number {
  return this.options.databaseBackupClock?.now() ?? Date.now();
}

export function armDatabaseBackupTimer(this: LibraryService, openLibrary: OpenLibrary): void {
  const libraryId = openLibrary.summary.libraryId;
  const oldTimer = this.databaseBackupTimers.get(libraryId);
  if (oldTimer) clearTimeout(oldTimer);
  const timer = setTimeout(() => {
    this.databaseBackupTimers.delete(libraryId);
    const current = this.openById.get(libraryId);
    if (!current || current.readOnly) return;
    void this.createDatabaseBackupForOpenLibrary(current, 'periodic', true)
      .finally(() => this.armDatabaseBackupTimer(current));
  }, DATABASE_BACKUP_INTERVAL_MS);
  // A backup timer must never keep a headless Worker alive on its own.
  timer.unref?.();
  this.databaseBackupTimers.set(libraryId, timer);
}

/** Explicit test/maintenance hook for a verified backup of an open library. */
export async function createDatabaseBackup(this: LibraryService, libraryId: string): Promise<boolean> {
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');
  return this.createDatabaseBackupForOpenLibrary(openLibrary, 'destructive', true);
}

export function diagnose(this: LibraryService, scope: string, error: unknown, context?: Record<string, unknown>): void {
  try {
    this.options.onDiagnostic?.({ scope, error, context });
  } catch {
    // Diagnostics are strictly best effort and must never replace the primary failure.
  }
}

export function reportDiagnostic(this: LibraryService, scope: string, error: unknown, context?: Record<string, unknown>): void {
  this.diagnose(scope, error, context);
}

export function failAt(this: LibraryService, point: ImportFailurePoint): void {
  const configured = this.options.failAt;
  if (configured !== point && (!Array.isArray(configured) || !configured.includes(point))) return;
  if (this.options.terminateProcessAt === point) {
    // The option is only wired from KEEL_E2E in the UtilityProcess. A
    // synchronous exit is intentional here: the preceding failpoint is
    // placed after the durable manifest and filesystem placement, so the
    // next process must exercise the real recovery path instead of the
    // in-process rollback catch below.
    process.exit(86);
  }
  if (point.startsWith('crash-')) throw new SimulatedCrashError(`Injected crash: ${point}`);
  throw new Error(`Injected import failure: ${point}`);
}

export function continueAfterSourceFailure(this: LibraryService, input: {
    importId: string;
    applyToRest: boolean;
    yieldTransferCheckpoints?: boolean;
  }): ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan {
  const pending = this.pendingImports.get(input.importId);
  if (!pending?.awaitingSourceFailureDecision || !pending.prepareInput || !pending.stagePath) {
    throw new LibraryServiceError('IMPORT_NOT_FOUND');
  }
  pending.awaitingSourceFailureDecision = false;
  if (input.applyToRest) pending.skipRemainingSourceFailures = true;
  const openLibrary = this.requireOpenLibrary(pending.libraryId);
  const remaining = pending.unstagedEntries ?? [];
  const alreadyStaged = pending.entries;
  const skipped = pending.skippedSources ?? [];
  const skipContentHash = pending.skipContentHash === true;
  const trackProgress = this.activeImports.has(input.importId);
  const finishStaged = (newlyStaged: ImportSourceEntry[]): ImportConflictPlan | ImportCompletion => {
    const stagedEntries = [...alreadyStaged, ...newlyStaged];
    pending.entries = stagedEntries;
    pending.unstagedEntries = [];
    pending.skippedSources = skipped;
    const conflictPlan = this.completePreparedImport({
      input: pending.prepareInput!,
      openLibrary,
      importId: input.importId,
      operationPath: pending.operationPath,
      directories: pending.directories,
      stagedEntries,
      skipContentHash,
      destinationIndex: pending.destinationIndex,
      preparingManifest: pending.preparingManifest ?? {
        version: 1,
        files: [],
        directories: pending.directories.map((relativePath) => ({
          existed: false,
          relativePath,
        })),
      },
      skippedSources: skipped,
    });
    if (conflictPlan.suspectedDuplicateCount !== 0 || conflictPlan.nameConflictCount !== 0) {
      return conflictPlan;
    }
    return this.resolveImport({
      importId: input.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
  };
  const parkPause = (error: ImportSourceFailurePause): ImportSourceFailurePlan => {
    return this.parkPendingImportSourceFailure({
      importId: input.importId,
      input: pending.prepareInput!,
      directories: pending.directories,
      stagedEntries: [...alreadyStaged, ...(error.stagedEntries as ImportSourceEntry[])],
      remainingEntries: error.remainingEntries as ImportSourceEntry[],
      skipped: error.skipped,
      failed: error.failed,
      operationPath: pending.operationPath,
      stagePath: pending.stagePath!,
      skipContentHash,
      destinationIndex: pending.destinationIndex,
      preparingManifest: pending.preparingManifest,
    });
  };
  if (remaining.length === 0) return finishStaged([]);
  try {
    const stagedResult = this.stageImportSourceEntries({
      openLibrary,
      entries: remaining,
      stagePath: pending.stagePath,
      skipContentHash,
      importId: trackProgress ? input.importId : undefined,
      totalFiles: remaining.length + alreadyStaged.length,
      totalBytes:
        remaining.reduce((total, entry) => total + entry.byteSize, 0)
        + alreadyStaged.reduce((total, entry) => total + entry.byteSize, 0),
      cancelState: this.activeImports.get(input.importId),
      yieldCheckpoints: input.yieldTransferCheckpoints === true,
      skipRemainingSourceFailures: pending.skipRemainingSourceFailures === true,
      stageNameOffset: alreadyStaged.length,
      skipped,
    });
    if (typeof (stagedResult as Promise<ImportSourceEntry[]>).then === 'function') {
      return (stagedResult as Promise<ImportSourceEntry[]>).then(
        (resolved) => finishStaged(resolved),
        (error: unknown) => {
          if (error instanceof ImportSourceFailurePause) return parkPause(error);
          this.pendingImports.delete(input.importId);
          this.cancelImportExpiry(pending);
          this.failPreparedImport(error, {
            importId: input.importId,
            operationPath: pending.operationPath,
            openLibrary,
            trackProgress,
          });
        },
      ) as unknown as ImportConflictPlan;
    }
    return finishStaged(stagedResult as ImportSourceEntry[]);
  } catch (error) {
    if (error instanceof ImportSourceFailurePause) return parkPause(error);
    this.pendingImports.delete(input.importId);
    this.cancelImportExpiry(pending);
    this.failPreparedImport(error, {
      importId: input.importId,
      operationPath: pending.operationPath,
      openLibrary,
      trackProgress,
    });
  }
}

export async function continueAfterSourceFailureCancellable(this: LibraryService, input: {
    importId: string;
    applyToRest: boolean;
  }): Promise<ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan> {
  if (!this.activeImports.has(input.importId)) {
    this.activeImports.set(input.importId, { cancelled: false });
  }
  try {
    return await Promise.resolve(this.continueAfterSourceFailure({
      ...input,
      yieldTransferCheckpoints: true,
    }));
  } catch (error) {
    this.activeImports.delete(input.importId);
    throw error;
  }
}

export function sqliteConnectionIsRegisteredPrimary(this: LibraryService, connection: DatabaseConnection | undefined): boolean {
  if (!connection) return false;
  for (const openLibrary of this.openById.values()) {
    if (openLibrary.connection === connection || openLibrary.writeConnection === connection) {
      return true;
    }
    const primary = openLibrary.networkMetadataCache?.readThrough.primaryConnection;
    if (primary === connection) return true;
  }
  return false;
}

/**
* Serpent-4bdd26: prepared statement memoized per (library, SQL text).
* Statements live as long as the connection; the cache entry is dropped
* when the library closes. Use only for hot per-row queries — one-off
* DDL/DML stays on plain `.prepare()`.
*/
export function prepareCached<T>(this: LibraryService, openLibrary: OpenLibrary, sql: string): T {
  const key = `${openLibrary.summary.libraryId}\u0000${sql}`;
  let statement = this.preparedStatementCache.get(key);
  if (statement === undefined) {
    statement = openLibrary.connection.prepare(sql);
    this.preparedStatementCache.set(key, statement);
  }
  return statement as T;
}

export function dropPreparedStatementCache(this: LibraryService, libraryId: string): void {
  const prefix = `${libraryId}\u0000`;
  for (const key of this.preparedStatementCache.keys()) {
    if (key.startsWith(prefix)) this.preparedStatementCache.delete(key);
  }
}

/**
* Execute a synchronous, metadata-only command inside a real SQLite
* `BEGIN IMMEDIATE` transaction and an observable per-library lease.
*
* The transaction is the fencing boundary: while it is open no second
* database connection can replace the lease and then interleave a write if
* this operation outlives its nominal lease duration. File/network/media
* work must never use this helper; those paths need their own recoverable
* job phases.
*/
export async function runBoundedWrite<T>(this: LibraryService, libraryId: string, operation: () => T, options?: AcquireLibraryWriteLeaseOptions): Promise<T> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const coordinator = new LibraryWriteCoordinator(openLibrary.writeConnection, libraryId);
  const lease = await coordinator.acquire(options);
  try {
    this.options.beforeBoundedWriteTransaction?.(libraryId);
    const transaction = openLibrary.connection.transaction(() => {
      // Acquisition happens before BEGIN IMMEDIATE so the caller can wait
      // until its configurable timeout for a live owner to finish. Renew
      // again inside SQLite's writer mutex to prove this owner is still
      // current and to keep the lease alive for the fenced mutation.
      lease.renew();
      return operation();
    });
    return transaction.immediate();
  } catch (error) {
    if (isSQLiteWriteContention(error)) {
      throw new LibraryWriteCoordinatorError(
        'Another Keel session is updating this library.',
        'timed-out',
      );
    }
    throw error;
  } finally {
    // Release after COMMIT/ROLLBACK. Releasing inside the transaction would
    // make the persisted lease invisible before the database write lock is
    // released, reopening a small cross-process race at the boundary.
    try {
      lease.release();
    } catch (error) {
      // Never let best-effort cleanup replace the operation's public
      // outcome. If a non-cooperating legacy writer grabbed SQLite between
      // COMMIT/ROLLBACK and this DELETE, the persisted expiry remains the
      // crash-recovery fallback; record the precise cause for diagnostics.
      this.diagnose('write-lease.release', error, { libraryId });
    }
  }
}

export function portableDiskDestination(this: LibraryService, openLibrary: OpenLibrary, relativePath: string, directoryCache?: ImportDestinationDirectoryCache, options: { validateMissingSegments?: boolean; snapshotFile?: boolean } = {}): ExistingDestination | undefined {
  const normalized = normalizeRelativeAssetPath(relativePath);
  const segments = normalized.split('/');
  let cursor = this.assetsPath(openLibrary);
  const actualSegments: string[] = [];

  for (const [index, segment] of segments.entries()) {
    const segmentIdentity = portablePathSegmentIdentity(segment);
    let matches;
    try {
      matches = directoryCache
        ? directoryCache.matches(cursor, segmentIdentity)
        : readdirSync(cursor, { withFileTypes: true }).filter(
            (entry) => portablePathSegmentIdentity(entry.name) === segmentIdentity,
          );
    } catch (error) {
      if (isMissingPathError(error)) return undefined;
      throw error;
    }
    if (matches.length > 1) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
        reason: 'NAME_NOT_SUPPORTED',
      });
    }
    const match = matches[0];
    if (!match) {
      if (options.validateMissingSegments === false) return undefined;
      // Let the target filesystem, rather than a guessed constant, decide
      // whether this absent component is a valid candidate name.
      const candidatePath = path.join(cursor, segment);
      try {
        (this.options.destinationLstat ?? lstatSync)(candidatePath);
      } catch (error) {
        if (isMissingPathError(error)) return undefined;
        throw error;
      }
      throw new LibraryServiceError('IMPORT_APPLY_FAILED');
    }
    if (match.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    actualSegments.push(match.name);
    if (index < segments.length - 1) {
      if (!match.isDirectory()) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
      cursor = path.join(cursor, match.name);
      continue;
    }
    let size = -1;
    let fileVersion: ExistingDestination['fileVersion'];
    if (match.isFile() && options.snapshotFile !== false) {
      const stat = lstatSync(path.join(cursor, match.name));
      size = stat.size;
      fileVersion = {
        ctimeMs: stat.ctimeMs,
        dev: stat.dev,
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
      };
    }
    return {
      actualRelativePath: actualSegments.join('/'),
      size,
      ...(fileVersion ? { fileVersion } : {}),
    };
  }
  return undefined;
}

/**
* SQLite path_identity lookup for bulk Eagle/Billfish conversion.
* `portableDiskDestination` readdirs Assets for every file; that becomes
* the dominant cost long before payload copy on a 20k-item library.
*/
export function managedDestinationIndex(this: LibraryService, openLibrary: OpenLibrary): Map<string, ExistingDestination> {
  const assetColumns = columnsFor(openLibrary.connection, 'assets');
  const filters = ["a.location_kind = 'managed'"];
  if (assetColumns.has('deleted_at')) filters.push('a.deleted_at IS NULL');
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.path_identity AS path_identity,
              a.relative_file_path AS relative_file_path,
              r.byte_size AS byte_size
         FROM assets a
         LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE ${filters.join(' AND ')}`,
    )
    .all() as Array<{
      path_identity: string;
      relative_file_path: string;
      byte_size: number | null;
    }>;
  const index = new Map<string, ExistingDestination>();
  for (const row of rows) {
    index.set(row.path_identity, {
      actualRelativePath: row.relative_file_path,
      size: row.byte_size ?? -1,
    });
  }
  return index;
}

export function copySourceSnapshot(this: LibraryService, entry: ImportSourceEntry, stagedPath: string, options?: { bulk?: boolean }): number {
  this.options.beforeSourceSnapshotOpen?.(entry.sourcePath);
  if (options?.bulk === true) {
    // Eagle/Billfish conversion already lstat'd the source when building the
    // entry. A second lstat+snapshot compare before every copyFile is 20k
    // extra metadata ops on the 2w baseline; copyFileExclusive fails if the
    // path disappeared or is not a regular file.
    copyFileExclusive(entry.sourcePath, stagedPath);
    const byteSize = entry.byteSize;
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw sourceChanged();
    }
    return byteSize;
  }
  const sourceFlags =
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  let sourceFd: number | undefined;
  let stageFd: number | undefined;
  try {
    try {
      sourceFd = openSync(entry.sourcePath, sourceFlags);
    } catch (error) {
      if (hasErrorCode(error, 'ELOOP')) {
        throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED', error);
      }
      throw error;
    }

    const openedStat = fstatSync(sourceFd, { bigint: true });
    let pathStat: BigIntStats;
    try {
      pathStat = lstatSync(entry.sourcePath, { bigint: true });
    } catch (error) {
      throw sourceChanged(error);
    }
    if (pathStat.isSymbolicLink()) {
      throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
    }
    if (!pathStat.isFile() || !openedStat.isFile()) {
      throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');
    }
    const openedSnapshot = sourceSnapshot(openedStat);
    if (
      !sameSourceSnapshot(entry.sourceSnapshot, openedSnapshot) ||
      !sameSourceSnapshot(sourceSnapshot(pathStat), openedSnapshot)
    ) {
      throw sourceChanged();
    }

    stageFd = openSync(
      stagedPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      Number(openedStat.mode & 0o777n),
    );
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytesRead = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += writeSync(stageFd, buffer, written, bytesRead - written);
      }
    }
    fsyncSync(stageFd);
    this.options.afterSourceSnapshotCopy?.(entry.sourcePath);

    const finalSourceStat = fstatSync(sourceFd, { bigint: true });
    if (!sameSourceSnapshot(openedSnapshot, sourceSnapshot(finalSourceStat))) {
      throw sourceChanged();
    }
    const stagedStat = fstatSync(stageFd, { bigint: true });
    if (stagedStat.size !== openedSnapshot.size) throw sourceChanged();
    const byteSize = Number(stagedStat.size);
    if (!Number.isSafeInteger(byteSize)) {
      throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');
    }
    return byteSize;
  } finally {
    if (stageFd !== undefined) closeSync(stageFd);
    if (sourceFd !== undefined) closeSync(sourceFd);
  }
}

/**
* Store a catalog appearance on a folder row. This is library
* metadata only — it must not rename or move anything on disk.
*/
export function setEntityAppearance(this: LibraryService, input: {
    libraryId: string;
    target: EntityAppearanceTarget;
    appearance: {
      glyphKind: 'emoji' | 'icon' | null;
      glyphValue: string | null;
      colorId: string | null;
    } | null;
  }): { target: EntityAppearanceTarget; appearance: EntityAppearance | null } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const parsed = parseWritableAppearance(input.appearance);
  if (!parsed.ok) throw new LibraryServiceError('INVALID_APPEARANCE');
  const appearance = parsed.appearance;
  const glyphKind = appearance?.glyphKind ?? null;
  const glyphValue = appearance?.glyphValue ?? null;
  const colorId = appearance?.colorId ?? null;
  const now = new Date().toISOString();

  let changed = 0;
  switch (input.target.kind) {
    case 'managed-folder':
      changed = openLibrary.connection
        .prepare(
          `UPDATE managed_folders
              SET appearance_glyph_kind = ?, appearance_glyph_value = ?, appearance_color_id = ?
            WHERE folder_id = ?`,
        )
        .run(glyphKind, glyphValue, colorId, input.target.id).changes;
      break;
    case 'linked-folder':
      if (parseLinkedVirtualFolderId(input.target.id)) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND');
      }
      changed = openLibrary.connection
        .prepare(
          `UPDATE linked_folders
              SET appearance_glyph_kind = ?, appearance_glyph_value = ?, appearance_color_id = ?, updated_at = ?
            WHERE folder_id = ? AND library_id = ?`,
        )
        .run(
          glyphKind,
          glyphValue,
          colorId,
          now,
          input.target.id,
          openLibrary.summary.libraryId,
        ).changes;
      break;
  }

  if (changed === 0) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  return { target: input.target, appearance };
}

export function catalogTableHasRows(this: LibraryService, connection: DatabaseConnection, table: 'explicit_ignored_paths' | 'gitignore_ignored_paths' | 'linked_ignored_assets' | 'asset_sequence_frames' | 'asset_companions'): boolean {
  return hasTable(connection, table) && connection.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined;
}

/** PF: extensions treated as companions (built-in plus plugin-declared). */
export function setCompanionExtensions(this: LibraryService, extensions: Iterable<string>): void {
  this._companionExtensions = normalizeCompanionExtensions([...BUILT_IN_COMPANION_EXTENSIONS, ...extensions]);
}

export function ensureCompanionIndex(this: LibraryService, openLibrary: OpenLibrary): boolean {
  const connection = openLibrary.connection;
  if (!hasTable(connection, 'asset_companions') || !hasTable(connection, 'browse_change_sequence')) return false;
  const extensions = normalizeCompanionExtensions(this._companionExtensions);
  const sequenceRow = connection.prepare('SELECT sequence FROM browse_change_sequence WHERE library_id = ?')
    .get(openLibrary.summary.libraryId) as { sequence: number } | undefined;
  const sequence = sequenceRow?.sequence ?? 0;
  // The marker lives in memory: a write that changes nothing would still
  // drop a network metadata snapshot and advance browse_change_sequence.
  const state = this._companionIndexState.get(openLibrary);
  const extensionKey = extensions.join(',');
  if (openLibrary.readOnly || (state && state.sequence === sequence && state.extensionKey === extensionKey)) {
    return state?.hasRows ?? this.catalogTableHasRows(connection, 'asset_companions');
  }
  const candidates = extensions.length === 0
    ? []
    : connection.prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path FROM assets
        WHERE deleted_at IS NULL AND normalized_extension IN (${extensions.map(() => '?').join(',')})`,
    ).all(...extensions.map((extension) => `.${extension}`)) as CompanionCandidateRow[];
  const rows: CompanionCandidateRow[] = [];
  const seenDirectories = new Set<string>();
  const siblingsQuery = connection.prepare(
    `SELECT asset_id, location_kind, linked_folder_id, relative_file_path FROM assets
      WHERE deleted_at IS NULL AND location_kind = ? AND linked_folder_id IS ?
        AND relative_file_path LIKE ? ESCAPE '\\' AND relative_file_path NOT LIKE ? ESCAPE '\\'`,
  );
  for (const candidate of candidates) {
    const directory = path.posix.dirname(candidate.relative_file_path);
    const key = `${candidate.location_kind}|${candidate.linked_folder_id ?? ''}|${directory.toLowerCase()}`;
    if (seenDirectories.has(key)) continue;
    seenDirectories.add(key);
    const prefix = directory === '.' ? '' : `${directory.replace(/[\\%_]/gu, (match) => `\\${match}`)}/`;
    rows.push(...siblingsQuery.all(candidate.location_kind, candidate.linked_folder_id, `${prefix}%`, `${prefix}%/%`) as CompanionCandidateRow[]);
  }
  const pairs = pairCompanions(rows, extensions);
  // Relations of trashed companions stay so that restore brings them back.
  const stored = connection.prepare(
    `SELECT companion.asset_id, companion.primary_asset_id FROM asset_companions companion
      LEFT JOIN assets a ON a.asset_id = companion.asset_id
      WHERE a.asset_id IS NULL OR a.deleted_at IS NULL`,
  ).all() as Array<{ asset_id: string; primary_asset_id: string }>;
  const unchanged = stored.length === pairs.size
    && stored.every((row) => pairs.get(row.asset_id) === row.primary_asset_id);
  if (!unchanged) {
    connection.transaction(() => {
      connection.prepare(
        `DELETE FROM asset_companions
          WHERE asset_id IN (SELECT asset_id FROM assets WHERE deleted_at IS NULL)
             OR asset_id NOT IN (SELECT asset_id FROM assets)`,
      ).run();
      const insert = connection.prepare('INSERT OR REPLACE INTO asset_companions (asset_id, primary_asset_id) VALUES (?, ?)');
      for (const [assetId, primaryId] of pairs) insert.run(assetId, primaryId);
    })();
  }
  const afterSequence = unchanged
    ? sequence
    : Number((connection.prepare('SELECT sequence FROM browse_change_sequence WHERE library_id = ?')
      .get(openLibrary.summary.libraryId) as { sequence: number } | undefined)?.sequence ?? 0);
  const hasRows = pairs.size > 0 || this.catalogTableHasRows(connection, 'asset_companions');
  this._companionIndexState.set(openLibrary, { sequence: afterSequence, extensionKey, hasRows });
  return hasRows;
}

export function getAutomaticTaskLayout(this: LibraryService, libraryId: string): AutomaticTaskLayout {
  const { connection: db } = this.requireOpenLibrary(libraryId);
  if (!hasTable(db, "automatic_tasks"))
    return { groups: [], ungroupedTaskIds: [] };
  const stored = hasTable(db, "automatic_task_layout")
    ? (db
        .prepare("SELECT layout_json FROM automatic_task_layout WHERE id=1")
        .get() as { layout_json: string } | undefined)
    : undefined;
  const layout = stored
    ? automaticTaskLayoutSchema.parse(JSON.parse(stored.layout_json))
    : { groups: [], ungroupedTaskIds: [] };
  const ids = new Set(
    (
      db
        .prepare("SELECT task_id FROM automatic_tasks ORDER BY rowid")
        .all() as { task_id: string }[]
    ).map((r) => r.task_id),
  );
  const placed = new Set<string>();
  const keep = (values: string[]) =>
    values.filter((id) => {
      if (!ids.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
  const groups = layout.groups.map((g) => ({
    ...g,
    taskIds: keep(g.taskIds),
  }));
  const ungroupedTaskIds = keep(layout.ungroupedTaskIds);
  for (const id of ids) if (!placed.has(id)) ungroupedTaskIds.push(id);
  return { groups, ungroupedTaskIds };
}

export function setAutomaticTaskLayout(this: LibraryService, input: {
    libraryId: string;
    layout: AutomaticTaskLayout;
  }): AutomaticTaskLayout {
  const library = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(library);
  const layout = automaticTaskLayoutSchema.parse(input.layout);
  const ids = [
    ...layout.ungroupedTaskIds,
    ...layout.groups.flatMap((g) => g.taskIds),
  ];
  for (const id of ids)
    if (
      !library.connection
        .prepare("SELECT 1 FROM automatic_tasks WHERE task_id=?")
        .get(id)
    )
      throw new LibraryServiceError("VERSION_CONFLICT");
  library.connection
    .prepare(
      "INSERT INTO automatic_task_layout(id,layout_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET layout_json=excluded.layout_json",
    )
    .run(JSON.stringify(layout));
  return this.getAutomaticTaskLayout(input.libraryId);
}

export function setAutomaticTask(this: LibraryService, input: {
    libraryId: string;
    config: AutomaticTaskConfig;
  }): AutomaticTask[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const config = automaticTaskConfigSchema.parse(input.config);
  const definition = smartCollectionQueryDefinitionSchema.parse(
    JSON.parse(config.queryDefinitionJson),
  );
  if (!(
    definition.filters?.length ||
    definition.search?.clauses?.length ||
    definition.search?.expression?.root
  ))
    throw new LibraryServiceError("INVALID_SELECTION");
  for (const tagId of config.action.tagIds)
    if (
      !openLibrary.connection
        .prepare("SELECT 1 FROM tags WHERE tag_id=? AND library_id=?")
        .get(tagId, input.libraryId)
    )
      throw new LibraryServiceError("FOLDER_NOT_FOUND");
  const taskId = config.taskId ?? randomUUID();
  openLibrary.connection
    .prepare(
      `INSERT INTO automatic_tasks(task_id,config_json) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET config_json=excluded.config_json,last_sequence=-1,last_error=NULL`,
    )
    .run(
      taskId,
      JSON.stringify({
        ...config,
        taskId,
        queryDefinitionJson: JSON.stringify(definition),
      }),
    );
  this.emitClientAssetsChanged(input.libraryId, 0);
  return this.listAutomaticTasks(input.libraryId);
}

/** Background rules use the same query and tag mutation kernels as interactive actions. */
export async function runAutomaticTasks(this: LibraryService, libraryId: string, taskId?: string, force = false, admissionYield?: () => Promise<void>): Promise<void> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (
    openLibrary.readOnly ||
    !hasTable(openLibrary.connection, "automatic_tasks")
  )
    return;
  if (this.runningAutomaticTasks.has(libraryId)) {
    if (force) throw new LibraryServiceError("VERSION_CONFLICT");
    return;
  }
  this.runningAutomaticTasks.add(libraryId);
  try {
    const convertedToRule = hasTable(openLibrary.connection, "legacy_group_migrations")
      ? openLibrary.connection.prepare("SELECT 1 FROM legacy_group_migrations WHERE kind='task-rule' AND legacy_id=?")
      : null;
    for (const task of this.listAutomaticTasks(libraryId)) {
      if (taskId && task.taskId !== taskId) continue;
      // PR: a task converted into a rule runs as that rule only.
      if (convertedToRule?.get(task.taskId)) continue;
      if (!force && (!task.enabled || task.trigger !== "library-change"))
        continue;
      const db = openLibrary.connection;
      const stored = db
        .prepare(
          "SELECT config_json,last_sequence FROM automatic_tasks WHERE task_id=?",
        )
        .get(task.taskId) as
        { config_json: string; last_sequence: number } | undefined;
      if (
        !stored ||
        (!force && stored.last_sequence === this.getChangeSequence(libraryId))
      )
        continue;
      const stillCurrent = () =>
        this.openById.get(libraryId) === openLibrary &&
        (
          db
            .prepare(
              "SELECT config_json FROM automatic_tasks WHERE task_id=?",
            )
            .get(task.taskId) as { config_json: string } | undefined
        )?.config_json === stored.config_json;
      let added = 0;
      try {
        const definition = smartCollectionQueryDefinitionSchema.parse(
          JSON.parse(task.queryDefinitionJson),
        );
        for (const id of task.action.tagIds)
          if (!db.prepare("SELECT 1 FROM tags WHERE tag_id=?").get(id))
            throw Error("目标标签已删除，请重新选择。");
        const ids: string[] = [];
        for (let offset = 0; ; offset += 200) {
          if (!stillCurrent()) break;
          const page = this.searchAssets({
            libraryId,
            query: definition.search ?? null,
            filters: definition.filters,
            sort: definition.sort,
            scope: task.folderId
              ? {
                  kind: "folder",
                  folderId: task.folderId,
                  recursive: task.recursive,
                }
              : null,
            idsOnly: true,
            idsPage: true,
            limit: 200,
            offset,
          });
          const batch = page.assetIds ?? [];
          ids.push(...batch);
          if (offset + batch.length >= page.total || !batch.length) break;
          await new Promise<void>((resolve) => setImmediate(resolve));
          await admissionYield?.();
        }
        for (let offset = 0; offset < ids.length; offset += 64) {
          if (!stillCurrent()) break;
          added += this.assignTags({
            libraryId,
            assetIds: ids.slice(offset, offset + 64),
            tagIds: task.action.tagIds,
          }).assignedCount;
          await new Promise<void>((resolve) => setImmediate(resolve));
          await admissionYield?.();
        }
        if (stillCurrent())
          db.prepare(
            "UPDATE automatic_tasks SET last_run_at=?,last_added=?,last_error=NULL,last_sequence=? WHERE task_id=?",
          ).run(
            new Date().toISOString(),
            added,
            this.getChangeSequence(libraryId),
            task.taskId,
          );
      } catch (error) {
        if (stillCurrent())
          db.prepare(
            "UPDATE automatic_tasks SET last_run_at=?,last_added=?,last_error=? WHERE task_id=?",
          ).run(
            new Date().toISOString(),
            added,
            error instanceof Error ? error.message : String(error),
            task.taskId,
          );
      }
    }
  } finally {
    this.runningAutomaticTasks.delete(libraryId);
  }
}

export function companionSummaries(this: LibraryService, openLibrary: OpenLibrary, assetId: string): Array<{ assetId: string; fileName: string }> {
  const ids = this.companionAssetIds(openLibrary, [assetId]);
  if (ids.length === 0) return [];
  return sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: ids,
    buildSql: (placeholders) =>
      `SELECT asset_id, relative_file_path FROM assets
        WHERE asset_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY relative_file_path`,
  }).slice(0, 64).map((row) => ({ assetId: row.asset_id, fileName: path.posix.basename(row.relative_file_path) }));
}

/** True when the asset has a non-empty human description. */
export function hasHumanDescription(this: LibraryService, libraryId: string, assetId: string): boolean {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT description FROM asset_metadata WHERE asset_id = ?`,
    )
    .get(assetId) as { description: string | null } | undefined;
  return Boolean(row?.description?.trim());
}

export function materializePluginDerivedFields(this: LibraryService, input: {
    libraryId: string;
    pluginId: string;
    packageHash: string;
    fieldId: string;
    fieldType: PluginProviderFieldType;
    values: ReadonlyArray<{ assetId: string; value: string | number | boolean | null }>;
  }): { writtenCount: number; fieldKey: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  return materializePluginDerivedFieldRows(openLibrary.connection, {
    ...input,
    libraryId: openLibrary.summary.libraryId,
  });
}

/**
* Render the AI four-view sheet for a model asset: four camera views
* (斜45°/正视/侧视/俯视) rendered offscreen, tiled into a 1×4 strip
* (≤2048 wide) and returned as PNG bytes. Not persisted — each analysis
* re-renders so no schema migration is needed for the sheet kind.
*/
export async function renderModelViewsSheet(this: LibraryService, input: { libraryId: string; assetId: string }, signal: AbortSignal, options: {
      modelAiViewsRenderer?: (
        input: ModelThumbnailRendererInput,
      ) => Promise<ModelThumbnailRenderOutcome>;
    } = {}): Promise<{ pngBytes: Uint8Array; mime: string }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const renderer = options.modelAiViewsRenderer ?? this.modelAiViewsRenderer;
  const asset = openLibrary.connection
    .prepare(
      'SELECT relative_file_path, current_revision_id FROM assets WHERE asset_id = ?',
    )
    .get(input.assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
    } | undefined;
  if (!asset || !renderer) {
    throw new LibraryServiceError('AI_ANALYSIS_FAILED', { reason: 'THUMBNAIL_REQUIRED' });
  }
  const views: ReadonlyArray<readonly [number, number, number]> = [
    [0.6708203932499369, 0.5031153024374527, 0.6708203932499369], // 斜45°
    [0, 0, 1],   // 正视
    [1, 0, 0],   // 侧视
    [0, 1, 0],   // 俯视
  ];
  const outcome = await renderer({
    libraryId: input.libraryId,
    assetId: input.assetId,
    revisionId: asset.current_revision_id ?? '',
    relativeFilePath: asset.relative_file_path,
    byteSize: null,
    signal,
    views,
  });
  if (outcome.status === 'failed' || !('frames' in outcome)) {
    throw new LibraryServiceError('AI_ANALYSIS_FAILED', { reason: 'THUMBNAIL_REQUIRED' });
  }
  const frames = outcome.frames;
  // 1×4 strip, left to right: 斜45°/正视/侧视/俯视 (each frame ≤512 wide).
  const tiledResult = await runSharpDecoder(signal, undefined, async () => {
    const sharp = this.options.sharpFn ?? requireSharp();
    return sharp(
      Buffer.concat(frames.map((frame) => Buffer.from(frame.pngBytes))),
    ).composite(
      frames.map((frame, index) => ({
        input: Buffer.from(frame.pngBytes),
        left: index * frame.width,
        top: 0,
      })),
    ).png!().toBuffer!();
  }, {
    sourceByteSize: frames.reduce((total, frame) => total + frame.pngBytes.byteLength, 0),
    width: frames.reduce((total, frame) => total + frame.width, 0),
    height: 512,
  });
  return { pngBytes: tiledResult as Buffer, mime: 'image/png' };
}

export function libraryDisplayName(this: LibraryService, libraryId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare('SELECT display_name FROM library WHERE library_id = ?')
    .get(libraryId) as { display_name: string } | undefined;
  return row?.display_name ?? '';
}

/**
* OIIO-backed cards use a small thumbnail, but the viewer needs a decoded
* image at the source dimensions. Keep this derivative separate and make
* the request single-flight; a viewer opening twice must not race two OIIO
* writers against the same revision_artifacts unique index.
*/
export async function ensureOiiOViewerImage(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, options: { inputColorSpace?: string; subimage?: number } = {}): Promise<void> {
  const subimage = Number.isSafeInteger(options.subimage) && (options.subimage ?? 0) >= 0
    ? options.subimage ?? 0
    : 0;
  const colorSpace = options.inputColorSpace?.trim() || 'auto';
  const key = `${input.libraryId}:${input.assetId}:${revisionId}:${colorSpace}:${subimage}`;
  const expected = `oiio@${OIIO_VERSION};viewer-full;`;
  const existing = this.getCurrentArtifact(input.libraryId, input.assetId, 'viewer_image');
  if (
    existing?.status === 'ready'
    && existing.generatorVersion.includes(expected)
    && existing.generatorVersion.includes(`colorspace=${colorSpace}`)
    && existing.generatorVersion.includes(`subimage=${subimage}`)
  ) {
    return;
  }
  if (existing) {
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE artifact_id = ? AND invalidated_at IS NULL`,
      )
      .run(new Date().toISOString(), existing.artifactId);
  }
  const running = this.oiioViewerImageInFlight.get(key);
  if (running) {
    await running;
    return;
  }
  const task = this.generateOiiOThumbnail(
    input,
    openLibrary,
    assetPath,
    revisionId,
    {
      artifactKind: 'viewer_image',
      inputColorSpace: options.inputColorSpace,
      subimage,
    },
  ).then(() => undefined).catch(() => undefined);
  this.oiioViewerImageInFlight.set(key, task);
  try {
    await task;
  } finally {
    this.oiioViewerImageInFlight.delete(key);
  }
}

/**
* Find component-related failures that are eligible for one automatic
* repair wave. Other failures (corrupt input, unsupported codecs, missing
* source files, and so on) remain terminal until the user explicitly retries.
*/
export function availableAutoRepairComponents(this: LibraryService, openLibrary: OpenLibrary): Set<MediaAutoRepairComponent> {
  // Serpent-verg.2 — lenient open: libraries predating the artifact status
  // columns have no component failures to repair.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return new Set();
  }
  const rows = openLibrary.connection
    .prepare(
      `SELECT DISTINCT ra.error_code
         FROM revision_artifacts ra
         JOIN assets a ON a.current_revision_id = ra.revision_id
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND ra.kind IN ('thumbnail', 'video_poster', 'audio_proxy')
          AND ra.status = 'failed'
          AND ra.invalidated_at IS NULL
          AND ra.error_code IN ('FFMPEG_REQUIRED', 'OIIO_REQUIRED')`,
    )
    .all() as Array<{ error_code: string }>;
  if (rows.length === 0) return new Set();

  const needed = new Set<MediaAutoRepairComponent>();
  for (const row of rows) {
    if (row.error_code === 'FFMPEG_REQUIRED') needed.add('ffmpeg');
    if (row.error_code === 'OIIO_REQUIRED') needed.add('oiio');
  }
  const attempted = this.autoRepairAttemptedByLibrary.get(
    openLibrary.summary.libraryId,
  ) ?? new Set<MediaAutoRepairComponent>();
  const failedProbes = this.autoRepairProbeFailedAtByLibrary.get(
    openLibrary.summary.libraryId,
  ) ?? new Map<MediaAutoRepairComponent, number>();
  const now = Date.now();
  const available = new Set<MediaAutoRepairComponent>();
  for (const component of needed) {
    if (attempted.has(component)) continue;
    const failedAt = failedProbes.get(component);
    if (failedAt !== undefined && now - failedAt < MEDIA_COMPONENT_PROBE_RETRY_MS) {
      continue;
    }
    if (this.mediaComponentAvailable(component)) {
      failedProbes.delete(component);
      available.add(component);
    } else {
      failedProbes.set(component, now);
    }
  }
  if (failedProbes.size > 0) {
    this.autoRepairProbeFailedAtByLibrary.set(
      openLibrary.summary.libraryId,
      failedProbes,
    );
  }
  return available;
}

export function assertNotInManagedSpace(this: LibraryService, openLibrary: OpenLibrary, absolutePath: string): void {
  const assetsPath = this.assetsPath(openLibrary);
  const relation = path.relative(assetsPath, absolutePath);
  if (relation === '' || (!relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation))) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'NAME_NOT_SUPPORTED',
    });
  }
}

export function assertNoSymlinkEscape(this: LibraryService, absolutePath: string): void {
  const filePath = absolutePath;
  try {
    const lstat = lstatSync(filePath);
    if (lstat.isSymbolicLink()) throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
    });
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    if (isMissingPathError(error)) return;
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
  const directory = path.dirname(absolutePath);
  try {
    const resolved = realpathSync(directory);
    const dirName = path.basename(directory);
    let current = resolved;
    for (const component of dirName.split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try {
        if (lstatSync(current).isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          });
        }
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (isMissingPathError(error)) break;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
  }
}

export function enumerateManagedSources(this: LibraryService, assetsRootPath: string, explicitlyIgnored?: (relativePath: string, pathKind: 'asset' | 'folder') => boolean): Array<{
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
  const visit = (directoryPath: string, relativeDirectory: string): void => {
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
    }
    for (const child of children) {
      const childRelative =
        relativeDirectory === ''
          ? child.name
          : path.posix.join(relativeDirectory, child.name);
      if (child.isSymbolicLink()) {
        this.diagnose(
          'managed-asset.symlink-skipped',
          new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          }),
          { assetsRootPath, relativePath: childRelative },
        );
        continue;
      }
      if (child.isDirectory()) {
        if (isDefaultIgnoredAssetEntry(child.name, 'directory')) continue;
        if (explicitlyIgnored?.(childRelative, 'folder')) continue;
        visit(path.join(directoryPath, child.name), childRelative);
        continue;
      }
      if (!child.isFile()) continue;
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
        // ENOENT/ENOTDIR mean the entry vanished between readdir and stat;
        // skip it here so the comparison loop records it as missing instead
        // of aborting the whole refresh (same classification as the loop's
        // own fallback stat). EACCES/EIO and friends still propagate.
        if (isUnreadablePathError(error)) continue;
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
      }
      if (stat.isSymbolicLink()) {
        this.diagnose(
          'managed-asset.symlink-skipped',
          new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          }),
          { assetsRootPath, relativePath: childRelative },
        );
        continue;
      }
      if (!stat.isFile()) continue;
      if (isDefaultIgnoredAssetEntry(child.name, 'file')) continue;
      let normalized: string;
      try {
        normalized = normalizeRelativeAssetPath(childRelative);
      } catch (error) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
      }
      const byteSize = Number(stat.size);
      if (!Number.isSafeInteger(byteSize)) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      if (explicitlyIgnored?.(normalized, 'asset')) continue;
      entries.push({
        relativePath: normalized,
        byteSize,
        modifiedAt: new Date(Number(stat.mtimeMs)).toISOString(),
        originalFilename: child.name,
        sourceDevice: String(stat.dev),
        sourceInode: String(stat.ino),
      });
    }
  };
  visit(assetsRootPath, '');
  return entries;
}

/**
* Content fingerprint of a file (SHA-1 of the full bytes). Used by
* refreshManagedAssets to tell a real edit from a portable-library copy
* (zip extraction rewrites every mtime but not the bytes). Sync by design:
* it only runs when an mtime mismatch is already detected, so normal
* refreshes never pay for it.
*/
export function computeContentFingerprint(this: LibraryService, filePath: string): string {
  const hash = createHash('sha1');
  const descriptor = openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let bytesRead = 0;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

/**
* Compute a reconciliation fingerprint without retaining the source in
* memory. The async iterator also gives the Worker event loop a scheduling
* boundary between read chunks; callers must invoke this before entering
* the short SQLite commit transaction.
*/
export async function computeContentFingerprintAsync(this: LibraryService, filePath: string, signal?: AbortSignal, buffer?: Buffer, yieldTurn?: () => Promise<void>): Promise<string> {
  if (signal?.aborted) throw this.reconciliationAbortError();
  if (this.options.contentFingerprintAsync) {
    const fingerprint = await this.options.contentFingerprintAsync(filePath, signal);
    if (signal?.aborted) throw this.reconciliationAbortError();
    return fingerprint;
  }

  const hash = createHash('sha1');
  const file = await openFileAsync(filePath, 'r');
  const readBuffer = buffer ?? Buffer.allocUnsafe(1 << 20);
  let position = 0;
  let sliceStartedAt = performance.now();
  try {
    while (true) {
      if (signal?.aborted) throw this.reconciliationAbortError();
      const result = await file.read(readBuffer, 0, readBuffer.length, position);
      if (result.bytesRead === 0) break;
      hash.update(readBuffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
      if (yieldTurn && performance.now() - sliceStartedAt >= 6) {
        // FileHandle reads can resolve from the OS cache in a tight chain of
        // microtasks. Yield inside a large file as well as between files, so
        // one 8K/RAW source cannot monopolize the Worker past the maintenance
        // slice budget.
        await yieldTurn();
        sliceStartedAt = performance.now();
      }
    }
  } finally {
    await file.close();
  }
  if (signal?.aborted) throw this.reconciliationAbortError();
  return hash.digest('hex');
}

export async function enumerateSourcesAsync(this: LibraryService, input: {
    errorCode: 'IMPORT_APPLY_FAILED' | 'INVALID_IMPORT_SOURCE';
    explicitlyIgnored: (relativePath: string, pathKind: 'asset' | 'folder') => boolean;
    isDirectoryIgnored?: (relativePath: string) => boolean;
    libraryId: string;
    linkedFolderId?: string;
    locationKind: 'managed' | 'linked';
    rootPath: string;
    task: OpenReconciliationTask;
    onDirectory?: (relativePath: string) => void;
  }): Promise<DiscoveredSourceEntry[]> {
  const entries: DiscoveredSourceEntry[] = [];
  const pendingDirectories: Array<{ absolutePath: string; relativePath: string; assetsHidden: boolean }> = [
    { absolutePath: input.rootPath, relativePath: '', assetsHidden: false },
  ];
  let sliceStartedAt = performance.now();

  while (pendingDirectories.length > 0) {
    this.assertReconciliationActive(input.task);
    const directory = pendingDirectories.pop()!;
    let handle;
    try {
      handle = await (this.options.sourceDirectoryOpener ?? opendirAsync)(directory.absolutePath);
    } catch (error) {
      throw new LibraryServiceError(input.errorCode, { cause: error });
    }

    try {
      let entriesRead = 0;
      for (;;) {
        const child = await handle.read();
        if (child === null) break;
        entriesRead += 1;
        this.assertReconciliationActive(input.task);
        const relativePath = directory.relativePath === ''
          ? child.name
          : path.posix.join(directory.relativePath, child.name);
        const absolutePath = path.join(directory.absolutePath, child.name);
        if (child.isSymbolicLink()) {
          this.diagnose(
            input.locationKind === 'managed'
              ? 'managed-asset.symlink-skipped'
              : 'linked-folder.symlink-skipped',
            new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
            }),
            {
              libraryId: input.libraryId,
              ...(input.linkedFolderId ? { linkedFolderId: input.linkedFolderId } : {}),
              relativePath,
            },
          );
        } else if (child.isDirectory()) {
          if (
            !(isLibraryMetaDirName(child.name) || child.name.toLowerCase() === '.bf')
            &&
            !(input.locationKind === 'managed' && isDefaultIgnoredAssetEntry(child.name, 'directory'))
            && !input.isDirectoryIgnored?.(relativePath)
          ) {
            const assetsHidden = directory.assetsHidden || input.explicitlyIgnored(relativePath, 'folder');
            if (!assetsHidden || input.onDirectory) {
              input.onDirectory?.(normalizeRelativeAssetPath(relativePath));
              pendingDirectories.push({ absolutePath, relativePath, assetsHidden });
            }
          }
        } else if (
          child.isFile() && !directory.assetsHidden
          && !isDefaultIgnoredAssetEntry(child.name, 'file')
        ) {
          let stat: Stats | BigIntStats;
          try {
            // Keep the existing synchronous stat seam for deterministic tests;
            // production uses the promise API so a slow volume cannot block the
            // Worker event loop during open reconciliation.
            stat = this.options.assetLstat
              ? this.options.assetLstat(absolutePath)
              : await lstatAsync(absolutePath, { bigint: true });
          } catch (error) {
            if (isUnreadablePathError(error)) continue;
            throw new LibraryServiceError(input.errorCode, { cause: error });
          }
          if (!stat.isSymbolicLink() && stat.isFile()) {
            let normalized: string;
            try {
              normalized = normalizeRelativeAssetPath(relativePath);
            } catch (error) {
              throw new LibraryServiceError(input.errorCode, { cause: error });
            }
            if (
              !(input.locationKind === 'managed'
                && isDefaultIgnoredAssetEntry(child.name, 'file'))
              && !input.explicitlyIgnored(normalized, 'asset')
            ) {
              const byteSize = Number(stat.size);
              if (!Number.isSafeInteger(byteSize)) {
                throw new LibraryServiceError(input.errorCode, {
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
            }
          }
        }

        if (entriesRead % 64 === 0 || performance.now() - sliceStartedAt >= 6) {
          await this.yieldReconciliation(input.task);
          sliceStartedAt = performance.now();
        }
      }
    } finally {
      await handle.close();
    }
  }
  return entries;
}

export function primaryDatabaseIsDamaged(this: LibraryService, libraryPath: string): boolean {
  const filename = databasePath(libraryPath);
  if (!realFileExists(filename)) return true;
  let connection: DatabaseConnection | undefined;
  try {
    connection = openConfiguredDatabase(
      filename,
      this.options.sqliteBusyTimeoutMsForTests,
      { readonly: true },
    );
    if (connection.pragma('quick_check(1)', { simple: true }) !== 'ok') return true;
    try {
      // Accept older, current, and newer-than-supported schemas. Exact
      // current-schema matching belongs to migrate/verifyDatabase, not the
      // destructive restore ladder. A newer library with a canonical prefix
      // is openable writable; treating it as damage caused Assets rescue to
      // replace a healthy too-new primary after backups were also rejected
      // as LIBRARY_VERSION_TOO_NEW.
      verifyOpenableSchema(connection);
      return false;
    } catch {
      // A structurally readable but incomplete database is still a damaged
      // primary for the recovery ladder. Valid operation/migration failures
      // are excluded before this probe reaches here.
      return true;
    }
  } catch (error) {
    // A missing/broken SQLite native module is an app install failure.
    // It must not quarantine the user's primary or walk the rescue ladder.
    if (isSqliteEngineUnavailableError(error)) return false;
    return true;
  } finally {
    closeIgnoringFailure(connection);
  }
}

export function validateDatabaseBackup(this: LibraryService, backupPath: string, libraryPath: string, slot: 1 | 2): boolean {
  if (!realFileExists(backupPath)) return false;
  let connection: DatabaseConnection | undefined;
  try {
    connection = openConfiguredDatabase(
      backupPath,
      this.options.sqliteBusyTimeoutMsForTests,
      { readonly: true },
    );
    // Too-new backups are still usable Keel databases. Rejecting them as
    // invalid used to skip both slots and fall through to empty Assets rescue.
    verifyOpenableSchema(connection);
    return true;
  } catch (error) {
    this.diagnose('library.recovery.backup-invalid', error, {
      libraryPath,
      backupPath,
      slot,
    });
    return false;
  } finally {
    closeIgnoringFailure(connection);
  }
}

/**
* Same catalog identity can appear under more than one filesystem path.
* That is not damage. Same canonical path stays a silent reuse; a different
* path must prompt, unless the user confirmed replacing the current handle.
*/
export function reuseOrRejectDuplicateCatalog(this: LibraryService, input: {
    libraryId: string;
    canonicalPath: string;
    connection: DatabaseConnection;
    replaceExisting?: boolean;
  }): InternalLibrarySummary | undefined {
  const existingOpen = this.openById.get(input.libraryId);
  if (!existingOpen) return undefined;
  if (existingOpen.summary.libraryPath === input.canonicalPath) {
    if (!this.sqliteConnectionIsRegisteredPrimary(input.connection)) {
      closeIgnoringFailure(input.connection);
    }
    this.openIdByPath.set(input.canonicalPath, existingOpen.summary.libraryId);
    return existingOpen.summary;
  }
  if (input.replaceExisting !== true) {
    if (!this.sqliteConnectionIsRegisteredPrimary(input.connection)) {
      closeIgnoringFailure(input.connection);
    }
    throw new LibraryServiceError('LIBRARY_ALREADY_OPEN');
  }
  // Keep the already-opened connection for the chosen path. Release the
  // current handle first so this catalog is not registered twice.
  this.closeLibrary(input.libraryId);
  return undefined;
}

export async function resolvePublicDownloadTarget(this: LibraryService, url: URL): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(hostname) !== 0) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    const resolver = this.options.dnsLookup ?? (async (name: string) =>
      dnsLookup(name, { all: true, verbatim: true }));
    try {
      addresses = await resolver(hostname);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
    }
  }
  if (addresses.length === 0 || addresses.some(({ address, family }) =>
    prohibitedIpAddress(address) || isIP(address) !== family)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
  }
  return addresses[0]!;
}

export function emitProgress(this: LibraryService, event: ExportProgressEvent | ImportProgressEvent | DeleteProgressEvent): void {
  const stamped =
    event.type === 'import.progress'
      ? {
          ...event,
          sequence: this.nextImportProgressSequence(event.importId, event.phase),
        }
      : event;
  try {
    this.options.onProgress?.(stamped);
  } catch {
    // Progress is best effort and must never throw back into an operation.
  }
}

export function transferPathKey(this: LibraryService, candidatePath: string): string {
  let existingAncestor = path.resolve(candidatePath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      existingAncestor = path.join(realpathSync(existingAncestor), ...missingSegments.reverse());
      break;
    } catch {
      const parentPath = path.dirname(existingAncestor);
      if (parentPath === existingAncestor) {
        existingAncestor = path.resolve(candidatePath);
        break;
      }
      missingSegments.push(path.basename(existingAncestor));
      existingAncestor = parentPath;
    }
  }
  const normalized = path.normalize(existingAncestor).normalize('NFC');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function transferInProgress(this: LibraryService, scope: string, context: Record<string, unknown>): never {
  const error = new LibraryServiceError('TRANSFER_IN_PROGRESS', {
    reason: 'TRANSFER_IN_PROGRESS',
  });
  this.diagnose(scope, error, context);
  throw error;
}
