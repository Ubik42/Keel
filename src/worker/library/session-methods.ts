import { type AutomaticTaskConfig } from "../../shared/automatic-tasks";
import { libraryMetaDir, migrateLibraryMetaDir, type LibraryMetaDirMigration } from "../../shared/library-meta-dir";
import { type LibraryStorageLayout } from "../../shared/library-storage-layout";
import { type InternalLibrarySummary } from "../../shared/protocol/responses";
import { randomTagAppearance } from "../../shared/tag-appearance";
import { ensureWindowsLibraryIcon } from "./windows-library-icon";
import { DATABASE_BACKUP_INTERVAL_MS, Database, LibraryServiceError, NETWORK_METADATA_SNAPSHOT_TABLES, REGENERABLE_DIRECTORIES, SUPPORTED_SCHEMA_VERSION, backfillDominantSaturation, backfillTrashedFromTombstoneIds, closeIgnoringFailure, countRecoverableAssetFiles, createDirectoryLayout, databaseBackupPath, databaseBackupTemporaryPath, databasePath, directoryExists, migrateDatabase, openConfiguredDatabase, readGitignoreText, readLibraryIdentity, realDirectoryExists, realFileExists, requiredDirectories, schemaVersion, schemaVersionProbe, serviceError, type DatabaseConnection, type LibraryRow, type LibraryService, type NetworkMetadataSourceState, type OpenLibrary, verifyDatabase, verifyMigrationHistory, verifyOpenableSchema } from "../library-service";
import { parseGitignore } from "./gitignore";
import { hasTable } from "./lenient-columns";
import { normalizeAbsolutePath, targetLibraryPath } from "./library-rules";
import { managedStoragePath, readStorageLayout, writeStorageLayout } from "./library-storage-layout";
import { LibraryWriteCoordinator, type AcquireLibraryWriteLeaseOptions, type LibraryWriteLease } from "./library-write-coordinator";
import { createNetworkReadThroughConnection, networkMetadataCacheKey, networkMetadataSourceFingerprint, type NetworkMetadataCacheDatabase, type NetworkMetadataCacheEvent, type NetworkMetadataCacheManifest, type NetworkReadThroughConnection } from "./network-metadata-cache";
import { classifyLibraryStorage, type LibraryStorageKind } from "./network-storage";
import { interruptUnfinishedPluginJobs } from "./plugin-job-repository";
import { MAX_MIGRATION_ATTEMPTS, clearMigrationFailure, readMigrationFailure, recordMigrationFailure } from "./schema-failure";
import { removePathWithSyncRetry, renamePathWithRetry } from "./windows-fs-retry";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface SessionMethods {
  createDatabaseBackupForOpenLibrary(...args: Parameters<typeof createDatabaseBackupForOpenLibrary>): ReturnType<typeof createDatabaseBackupForOpenLibrary>;
  isLibraryOpen(...args: Parameters<typeof isLibraryOpen>): ReturnType<typeof isLibraryOpen>;
  hasOpenLibrary(...args: Parameters<typeof hasOpenLibrary>): ReturnType<typeof hasOpenLibrary>;
  requireOpenLibrary(...args: Parameters<typeof requireOpenLibrary>): ReturnType<typeof requireOpenLibrary>;
  sqlitePrimaryIsOpen(...args: Parameters<typeof sqlitePrimaryIsOpen>): ReturnType<typeof sqlitePrimaryIsOpen>;
  findLibraryIdOwningSqliteConnection(...args: Parameters<typeof findLibraryIdOwningSqliteConnection>): ReturnType<typeof findLibraryIdOwningSqliteConnection>;
  evictDeadOpenLibrary(...args: Parameters<typeof evictDeadOpenLibrary>): ReturnType<typeof evictDeadOpenLibrary>;
  assertLibraryWritable(...args: Parameters<typeof assertLibraryWritable>): ReturnType<typeof assertLibraryWritable>;
  acquireWriteLease(...args: Parameters<typeof acquireWriteLease>): ReturnType<typeof acquireWriteLease>;
  migrateLegacyGroups(...args: Parameters<typeof migrateLegacyGroups>): ReturnType<typeof migrateLegacyGroups>;
  emitNetworkMetadataCacheEvent(...args: Parameters<typeof emitNetworkMetadataCacheEvent>): ReturnType<typeof emitNetworkMetadataCacheEvent>;
  networkMetadataSourceState(...args: Parameters<typeof networkMetadataSourceState>): ReturnType<typeof networkMetadataSourceState>;
  validateNetworkMetadataSnapshot(...args: Parameters<typeof validateNetworkMetadataSnapshot>): ReturnType<typeof validateNetworkMetadataSnapshot>;
  createNetworkMetadataReadThrough(...args: Parameters<typeof createNetworkMetadataReadThrough>): ReturnType<typeof createNetworkMetadataReadThrough>;
  rebindCurrentNetworkMetadataCache(...args: Parameters<typeof rebindCurrentNetworkMetadataCache>): ReturnType<typeof rebindCurrentNetworkMetadataCache>;
  openCachedNetworkMetadataSnapshot(...args: Parameters<typeof openCachedNetworkMetadataSnapshot>): ReturnType<typeof openCachedNetworkMetadataSnapshot>;
  scheduleDeferredOpenMaintenance(...args: Parameters<typeof scheduleDeferredOpenMaintenance>): ReturnType<typeof scheduleDeferredOpenMaintenance>;
  cancelDeferredOpenMaintenance(...args: Parameters<typeof cancelDeferredOpenMaintenance>): ReturnType<typeof cancelDeferredOpenMaintenance>;
  createLibrary(...args: Parameters<typeof createLibrary>): ReturnType<typeof createLibrary>;
  openLibrary(...args: Parameters<typeof openLibrary>): ReturnType<typeof openLibrary>;
  rescueLibraryFromAssets(...args: Parameters<typeof rescueLibraryFromAssets>): ReturnType<typeof rescueLibraryFromAssets>;
  adoptWritableOpenLibrary(...args: Parameters<typeof adoptWritableOpenLibrary>): ReturnType<typeof adoptWritableOpenLibrary>;
  openLibraryPrimary(...args: Parameters<typeof openLibraryPrimary>): ReturnType<typeof openLibraryPrimary>;
  openLibraryReadOnly(...args: Parameters<typeof openLibraryReadOnly>): ReturnType<typeof openLibraryReadOnly>;
  closeLibraryAsync(...args: Parameters<typeof closeLibraryAsync>): ReturnType<typeof closeLibraryAsync>;
  closeLibrary(...args: Parameters<typeof closeLibrary>): ReturnType<typeof closeLibrary>;
  checkpointAndCloseConnection(...args: Parameters<typeof checkpointAndCloseConnection>): ReturnType<typeof checkpointAndCloseConnection>;
  closeAllAsync(...args: Parameters<typeof closeAllAsync>): ReturnType<typeof closeAllAsync>;
  closeAll(...args: Parameters<typeof closeAll>): ReturnType<typeof closeAll>;
}

/**
* Write one verified online snapshot and rotate it into the two-slot local
* safety net. The temp file is never considered a backup and is removed on
* every failure, so a half-written snapshot cannot replace a good slot.
*/
export async function createDatabaseBackupForOpenLibrary(this: LibraryService, openLibrary: OpenLibrary, reason: 'open' | 'close' | 'destructive' | 'periodic', force = false): Promise<boolean> {
  if (openLibrary.readOnly) return false;
  const existing = this.databaseBackupInFlight.get(openLibrary.summary.libraryId);
  if (existing) {
    if (!force) return existing;
    // A maintenance snapshot may have started before the destructive
    // command acquired its writer lease. Wait for it, then take a fresh
    // snapshot under that lease; joining the old task would be stale.
    await existing;
    return this.createDatabaseBackupForOpenLibrary(openLibrary, reason, force);
  }

  const backup1 = databaseBackupPath(openLibrary.summary.libraryPath, 1);
  if (!force && realFileExists(backup1)) {
    try {
      const age = this.databaseBackupNow() - statSync(backup1).mtimeMs;
      if (age >= 0 && age < DATABASE_BACKUP_INTERVAL_MS) return false;
    } catch {
      // A disappearing or unreadable slot is handled by a fresh snapshot.
    }
  }

  const task = (async () => {
    const backupDirectory = path.dirname(backup1);
    const temporaryPath = databaseBackupTemporaryPath(openLibrary.summary.libraryPath);
    try {
      mkdirSync(backupDirectory, { recursive: true });
      await this.createConsistentDatabaseSnapshot(
        openLibrary.connection,
        temporaryPath,
        {
          cancelled: false,
          // Open/periodic snapshots are maintenance work. Keep each native
          // backup transfer below the event-loop budget. Destructive
          // commands must finish a verified snapshot before mutating disk;
          // use bounded 2 MiB batches to avoid thousands of 100-page turns
          // on a large library while still yielding between transfers.
          ...(reason === 'open' || reason === 'periodic'
            ? { backupPageBatch: 1 }
            : reason === 'destructive'
              ? { backupPageBatch: 512 }
              : {}),
        },
      );

      const backup2 = databaseBackupPath(openLibrary.summary.libraryPath, 2);
      if (existsSync(backup2)) rmSync(backup2, { force: true });
      if (existsSync(backup1)) renameSync(backup1, backup2);
      renameSync(temporaryPath, backup1);
      return true;
    } catch (error) {
      try { rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
      this.diagnose('library.backup.failed', error, {
        libraryId: openLibrary.summary.libraryId,
        libraryPath: openLibrary.summary.libraryPath,
        reason,
      });
      return false;
    }
  })();
  this.databaseBackupInFlight.set(openLibrary.summary.libraryId, task);
  try {
    return await task;
  } finally {
    if (this.databaseBackupInFlight.get(openLibrary.summary.libraryId) === task) {
      this.databaseBackupInFlight.delete(openLibrary.summary.libraryId);
    }
  }
}

/** Cheap liveness check for callers that must not open or mutate state. */
export function isLibraryOpen(this: LibraryService, libraryId: string): boolean {
  try {
    this.requireOpenLibrary(libraryId);
    return true;
  } catch {
    return false;
  }
}

/** Serpent-2cc492: open-state probe for the worker-runtime startup gate. */
export function hasOpenLibrary(this: LibraryService, libraryId: string): boolean {
  return this.openById.has(libraryId);
}

export function requireOpenLibrary(this: LibraryService, libraryId: string): OpenLibrary {
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');
  if (!this.sqlitePrimaryIsOpen(openLibrary)) {
    this.evictDeadOpenLibrary(libraryId, openLibrary);
    throw new LibraryServiceError('LIBRARY_NOT_OPEN');
  }
  this.syncGitignore(openLibrary);
  return openLibrary;
}

/**
* `openById` membership must mean the better-sqlite3 primary is still open.
* Network libraries wrap that primary in two adapters; checking the wrapper
* object's own `open` flag is not enough because the wrapper does not
* forward it.
*/
export function sqlitePrimaryIsOpen(this: LibraryService, openLibrary: OpenLibrary): boolean {
  const primary = openLibrary.networkMetadataCache?.readThrough.primaryConnection
    ?? openLibrary.connection;
  return (primary as { open?: boolean }).open !== false;
}

export function findLibraryIdOwningSqliteConnection(this: LibraryService, connection: DatabaseConnection | undefined): string | undefined {
  if (!connection) return undefined;
  for (const [libraryId, openLibrary] of this.openById) {
    if (openLibrary.connection === connection || openLibrary.writeConnection === connection) {
      return libraryId;
    }
    if (openLibrary.networkMetadataCache?.readThrough.primaryConnection === connection) {
      return libraryId;
    }
  }
  return undefined;
}

/**
* Drop a handle whose SQLite primary is already closed. Do not run cancelJobs
* or checkpoint — those need a live connection and would throw TypeError.
*/
export function evictDeadOpenLibrary(this: LibraryService, libraryId: string, openLibrary: OpenLibrary): void {
  this.cancelDeferredOpenMaintenance(libraryId);
  this.cancelOpenBackgroundReconciliation(libraryId);
  const backupTimer = this.databaseBackupTimers.get(libraryId);
  if (backupTimer) {
    clearTimeout(backupTimer);
    this.databaseBackupTimers.delete(libraryId);
  }
  try { this.stopAssetWatcher(libraryId); } catch { /* handle is already unusable */ }
  try { this.stopLinkedWatchers(libraryId); } catch { /* handle is already unusable */ }
  try { openLibrary.changeSubscription.stop(); } catch { /* handle is already unusable */ }
  this.openById.delete(libraryId);
  this.openIdByPath.delete(openLibrary.summary.libraryPath);
  this.invalidateArtifactPathCache(libraryId);
  this.artifactDescriptorCache.invalidateLibrary(libraryId);
  this.browseSessionStore.invalidateLibrary(libraryId);
  this.dropPreparedStatementCache(libraryId);
  this.clearTextAssetPreviewCache(libraryId);
  this.autoRepairAttemptedByLibrary.delete(libraryId);
  this.autoRepairProbeFailedAtByLibrary.delete(libraryId);
  this.autoAnalysisSuppressedAssetIds.delete(libraryId);
  this.interactiveIdleUntilByLibrary.delete(libraryId);
  this.diagnose(
    'library.handle.evicted-closed-primary',
    new LibraryServiceError('LIBRARY_NOT_OPEN'),
    { libraryId },
  );
}

/**
* Reject mutations before they can touch the filesystem. Inspection-only
* handles (openLibraryReadOnly) still set readOnly; Desktop open paths
* never do. File operations happen before their metadata transaction, so
* relying on SQLite to reject the later write could leave disk and DB
* inconsistent.
*/
export function assertLibraryWritable(this: LibraryService, openLibrary: OpenLibrary): void {
  if (openLibrary.readOnly) throw new LibraryServiceError('LIBRARY_READ_ONLY');
}

/**
* Acquire the durable, per-library writer lease used by Desktop, scripts and
* MCP. Callers must release the returned handle in a `finally` block.
* Read-only operations intentionally do not take this lease.
*/
export function acquireWriteLease(this: LibraryService, libraryId: string, options?: AcquireLibraryWriteLeaseOptions): Promise<LibraryWriteLease> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return new LibraryWriteCoordinator(openLibrary.writeConnection, libraryId).acquire(options);
}

/** One-time additive migration; original group records remain for compatibility. */
export function migrateLegacyGroups(this: LibraryService, openLibrary: OpenLibrary): void {
  const db = openLibrary.connection;
  if (openLibrary.readOnly || !hasTable(db, "legacy_group_migrations"))
    return;
  const libraryId = openLibrary.summary.libraryId;
  const migrate = (kind: string, id: string, name: string): string => {
    const old = db
      .prepare(
        "SELECT tag_id FROM legacy_group_migrations WHERE kind=? AND legacy_id=?",
      )
      .get(kind, id) as { tag_id: string } | undefined;
    if (old) return old.tag_id;
    let label = name;
    if (
      db
        .prepare("SELECT 1 FROM tags WHERE library_id=? AND name=?")
        .get(libraryId, label)
    )
      label = `${name}（${kind === "collection" ? "旧合集" : "旧智能合集"} ${id.slice(0, 8)}）`;
    const tagId = randomUUID();
    db.prepare(
      "INSERT INTO tags(tag_id,library_id,name,created_at) VALUES(?,?,?,?)",
    ).run(tagId, libraryId, label, new Date().toISOString());
    this.setTagAppearance(openLibrary, tagId, randomTagAppearance());
    db.prepare(
      "INSERT INTO legacy_group_migrations(kind,legacy_id,tag_id) VALUES(?,?,?)",
    ).run(kind, id, tagId);
    return tagId;
  };
  db.transaction(() => {
    const groups = db
      .prepare(
        "SELECT collection_id,parent_id,name FROM collections WHERE library_id=?",
      )
      .all(libraryId) as {
      collection_id: string;
      parent_id: string | null;
      name: string;
    }[];
    const newlyMigrated = groups.filter(
      (g) =>
        !db
          .prepare(
            "SELECT 1 FROM legacy_group_migrations WHERE kind='collection' AND legacy_id=?",
          )
          .get(g.collection_id),
    );
    const mapped = new Map(
      groups.map((g) => [
        g.collection_id,
        migrate("collection", g.collection_id, g.name),
      ]),
    );
    for (const g of newlyMigrated) {
      const tagId = mapped.get(g.collection_id)!;
      if (g.parent_id && mapped.has(g.parent_id))
        this.setTagParent(openLibrary, tagId, mapped.get(g.parent_id)!);
      const members = db
        .prepare(
          "SELECT asset_id FROM collection_assets WHERE collection_id=?",
        )
        .all(g.collection_id) as { asset_id: string }[];
      for (const member of members) {
        db.prepare(
          "INSERT OR IGNORE INTO human_asset_tags(asset_id,tag_id) VALUES(?,?)",
        ).run(member.asset_id, tagId);
        this.syncAssetSearchContent(db, member.asset_id);
      }
    }
    const smart = db
      .prepare(
        "SELECT collection_id,name,query_definition_json FROM smart_collections WHERE library_id=?",
      )
      .all(libraryId) as {
      collection_id: string;
      name: string;
      query_definition_json: string;
    }[];
    for (const g of smart) {
      if (
        db
          .prepare(
            "SELECT 1 FROM legacy_group_migrations WHERE kind='smart' AND legacy_id=?",
          )
          .get(g.collection_id)
      )
        continue;
      const tagId = migrate("smart", g.collection_id, g.name);
      const taskId = randomUUID();
      const config: AutomaticTaskConfig = {
        taskId,
        name: g.name,
        enabled: false,
        trigger: "library-change",
        queryDefinitionJson: g.query_definition_json,
        recursive: true,
        action: { type: "add-tags", tagIds: [tagId] },
      };
      db.prepare(
        "INSERT INTO automatic_tasks(task_id,config_json) VALUES(?,?)",
      ).run(taskId, JSON.stringify(config));
      db.prepare(
        "UPDATE legacy_group_migrations SET task_id=? WHERE kind='smart' AND legacy_id=?",
      ).run(taskId, g.collection_id);
    }
  })();
}

export function emitNetworkMetadataCacheEvent(this: LibraryService, event: NetworkMetadataCacheEvent): void {
  try {
    this.options.onNetworkMetadataCacheEvent?.(event);
  } catch (error) {
    // Diagnostics must never make an otherwise usable network library fail
    // to open or close.
    this.diagnose('network-metadata-cache.event', error, {
      libraryId: event.libraryId,
      eventType: event.type,
    });
  }
}

export function networkMetadataSourceState(this: LibraryService, connection: DatabaseConnection, libraryId: string, sourceDatabasePath: string): NetworkMetadataSourceState | undefined {
  try {
    const testOverride = this.options.networkMetadataSourceStateForTests;
    if (testOverride) return testOverride({ libraryId, sourceDatabasePath });
    const sourceFingerprint = networkMetadataSourceFingerprint(sourceDatabasePath);
    if (!sourceFingerprint) return undefined;
    // The broad library sequence also advances for jobs and artifact status.
    // Those volatile rows are deliberately routed to the remote primary and
    // must not invalidate a catalog snapshot while media work is running.
    return {
      schemaVersion: schemaVersion(connection),
      sourceChangeSequence: this.networkMetadataBrowseChangeSequence(connection, libraryId),
      sourceFingerprint,
    };
  } catch (error) {
    this.diagnose('network-metadata-cache.source-state', error, { libraryId });
    return undefined;
  }
}

export function validateNetworkMetadataSnapshot(this: LibraryService, connection: DatabaseConnection, libraryId: string, expectedSchemaVersion: number): void {
  if (schemaVersion(connection) !== expectedSchemaVersion) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const library = readLibraryIdentity(connection, { skipQuickCheck: true });
  if (library.library_id !== libraryId) throw new LibraryServiceError('LIBRARY_CORRUPT');
  verifyMigrationHistory(connection, expectedSchemaVersion);
}

export function createNetworkMetadataReadThrough(this: LibraryService, input: {
    connection: DatabaseConnection;
    canonicalPath: string;
    libraryId: string;
    startServices: boolean;
    primarySchemaVersion: number;
    expectedSourceChangeSequence?: number;
  }): {
    connection: DatabaseConnection;
    writeConnection: DatabaseConnection;
    state?: OpenLibrary['networkMetadataCache'];
  } {
  if (!input.startServices) {
    return { connection: input.connection, writeConnection: input.connection };
  }
  const sourceDatabasePath = databasePath(input.canonicalPath);
  const cacheKey = networkMetadataCacheKey(input.canonicalPath);
  if (input.primarySchemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return { connection: input.connection, writeConnection: input.connection };
  }

  let loaded;
  try {
    // Cache-first: opening and validating the local snapshot must not wait
    // for a remote stat or cursor round trip. The background reconciliation
    // validates the manifest cursor/fingerprint and replaces it if stale.
    const openReadonly = (snapshotPath: string): DatabaseConnection => openConfiguredDatabase(
      snapshotPath,
      this.options.sqliteBusyTimeoutMsForTests,
      { readonly: true },
    );
    const validateConnection = (connection: NetworkMetadataCacheDatabase): void => {
      this.validateNetworkMetadataSnapshot(
        connection as DatabaseConnection,
        input.libraryId,
        input.primarySchemaVersion,
      );
    };
    const validate = (
      connection: NetworkMetadataCacheDatabase,
      manifest: NetworkMetadataCacheManifest,
    ): void => {
      if (
        manifest.libraryId !== input.libraryId
        || manifest.schemaVersion !== input.primarySchemaVersion
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      validateConnection(connection);
    };
    loaded = input.expectedSourceChangeSequence === undefined
      ? this.networkMetadataCache.loadLatest({
          cacheKey,
          openReadonly,
          validate,
        })
      : this.networkMetadataCache.load({
          cacheKey,
          libraryId: input.libraryId,
          schemaVersion: input.primarySchemaVersion,
          sourceChangeSequence: input.expectedSourceChangeSequence,
          openReadonly,
          validate: validateConnection,
        });
  } catch (error) {
    this.diagnose('network-metadata-cache.load', error, { libraryId: input.libraryId });
  }

  const readThrough = createNetworkReadThroughConnection(
    input.connection,
    loaded?.connection,
    { allowedSnapshotTables: NETWORK_METADATA_SNAPSHOT_TABLES },
  ) as NetworkReadThroughConnection;
  const writeThrough = createNetworkReadThroughConnection(
    input.connection,
    undefined,
    {
      allowSnapshotReads: false,
      ownsPrimary: false,
      onPrimaryMutation: () => readThrough.invalidateReadConnection(),
    },
  );
  this.emitNetworkMetadataCacheEvent({
    type: loaded ? 'hit' : 'miss',
    libraryId: input.libraryId,
    sourceChangeSequence: loaded?.manifest.sourceChangeSequence,
    ...(loaded
      ? { reason: 'awaiting-remote-validation' }
      : { reason: 'no-verified-snapshot' }),
  });
  return {
    connection: readThrough as unknown as DatabaseConnection,
    writeConnection: writeThrough as unknown as DatabaseConnection,
    state: {
      cacheKey,
      databasePath: sourceDatabasePath,
      schemaVersion: input.primarySchemaVersion,
      readThrough,
      writeThrough,
      ...(loaded ? { observedSourceFingerprint: loaded.manifest.sourceFingerprint } : {}),
      observedSourceChangeSequence: loaded?.manifest.sourceChangeSequence,
      ...(loaded ? { manifest: loaded.manifest } : {}),
    },
  };
}

export function rebindCurrentNetworkMetadataCache(this: LibraryService, openLibrary: OpenLibrary): void {
  const state = openLibrary.networkMetadataCache;
  // A cache that has never been created is intentionally built by the
  // cancellable background owner, not synchronously from every first read.
  if (!state || state.manifest === undefined || state.readThrough.readCacheActive) return;
  let primarySchemaVersion: number;
  let expectedSourceChangeSequence: number;
  try {
    primarySchemaVersion = schemaVersion(state.readThrough.primaryConnection as DatabaseConnection);
    expectedSourceChangeSequence = this.networkMetadataBrowseChangeSequence(
      state.readThrough.primaryConnection as DatabaseConnection,
      openLibrary.summary.libraryId,
    );
  } catch {
    return;
  }
  const rebound = this.createNetworkMetadataReadThrough({
    connection: state.readThrough.primaryConnection as DatabaseConnection,
    canonicalPath: openLibrary.summary.libraryPath,
    libraryId: openLibrary.summary.libraryId,
    startServices: true,
    primarySchemaVersion,
    expectedSourceChangeSequence,
  });
  if (rebound.state?.readThrough.readCacheActive) {
    state.readThrough.release();
    state.writeThrough.release();
    openLibrary.connection = rebound.connection;
    openLibrary.writeConnection = rebound.writeConnection;
    openLibrary.networkMetadataCache = rebound.state;
    return;
  }
  // Do not retry the same stale manifest on every metadata read. The next
  // open/network reconciliation will create a fresh snapshot from the
  // current remote source state.
  state.manifest = undefined;
}

/**
* Degraded open for a network library whose mount is currently unavailable.
* The cache is deliberately exposed as read-only: it can serve catalog
* metadata, but it must never manufacture a writable remote source or imply
* that file previews/imports can succeed while the mount is gone.
*/
export function openCachedNetworkMetadataSnapshot(this: LibraryService, selectedLibraryPath: string): InternalLibrarySummary | undefined {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeAbsolutePath(selectedLibraryPath);
  } catch {
    return undefined;
  }
  const cacheKey = networkMetadataCacheKey(normalizedPath);
  let loaded;
  try {
    loaded = this.networkMetadataCache.loadLatest({
      cacheKey,
      openReadonly: (snapshotPath) => openConfiguredDatabase(
        snapshotPath,
        this.options.sqliteBusyTimeoutMsForTests,
        { readonly: true },
      ),
      validate: (connection, manifest) => {
        if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        this.validateNetworkMetadataSnapshot(
          connection as DatabaseConnection,
          manifest.libraryId,
          manifest.schemaVersion,
        );
      },
    });
  } catch (error) {
    this.diagnose('network-metadata-cache.offline-load', error, { cacheKey });
    return undefined;
  }
  if (!loaded) return undefined;

  try {
    const library = readLibraryIdentity(loaded.connection, { skipQuickCheck: true });
    if (this.openById.has(library.library_id)) {
      loaded.connection.close();
      return this.openById.get(library.library_id)!.summary;
    }
    const summary: InternalLibrarySummary = {
      libraryId: library.library_id,
      displayName: library.display_name,
      libraryPath: normalizedPath,
      storageLayout: readStorageLayout(normalizedPath),
      readOnly: true,
      networkStorage: true,
      libraryVersion: loaded.manifest.schemaVersion,
      supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION,
    };
    this.openById.set(library.library_id, {
      connection: loaded.connection as DatabaseConnection,
      writeConnection: loaded.connection as DatabaseConnection,
      summary,
      readOnly: true,
      changeSubscription: { lastSequence: 0, stop() {} },
      preservedRelinkPathIdentities: new Set(),
      gitignoreText: '',
      gitignoreMatcher: parseGitignore(''),
      gitignoreMaterialized: false,
    });
    this.openIdByPath.set(normalizedPath, library.library_id);
    this.emitNetworkMetadataCacheEvent({
      type: 'offline',
      libraryId: library.library_id,
      sourceChangeSequence: loaded.manifest.sourceChangeSequence,
      reason: 'cached-snapshot-opened',
    });
    return summary;
  } catch (error) {
    closeIgnoringFailure(loaded.connection as DatabaseConnection);
    this.diagnose('network-metadata-cache.offline-open', error, { cacheKey });
    return undefined;
  }
}

export function scheduleDeferredOpenMaintenance(this: LibraryService, openLibrary: OpenLibrary, generation: number): void {
  const libraryId = openLibrary.summary.libraryId;
  const previous = this.deferredOpenMaintenanceByLibrary.get(libraryId);
  if (previous) clearTimeout(previous);

  const run = (): void => {
    this.deferredOpenMaintenanceByLibrary.delete(libraryId);
    if (
      this.openById.get(libraryId) !== openLibrary
      || this.reconciliationOwner.generation(libraryId) !== generation
    ) return;
    const remainingMs = (this.interactiveIdleUntilByLibrary.get(libraryId) ?? 0) - Date.now();
    if (remainingMs > 0) {
      const timer = setTimeout(run, Math.min(Math.max(remainingMs, 250), 1_000));
      timer.unref?.();
      this.deferredOpenMaintenanceByLibrary.set(libraryId, timer);
      return;
    }
    void (async () => {
      try {
        // Both operations are intentionally outside the open-reconciliation
        // promise. They remain owned by this Worker/library handle, but the
        // native backup transfer and its unavoidable synchronous quick_check
        // cannot delay the first viewer completion.
        await this.createDatabaseBackupForOpenLibrary(openLibrary, 'open');
        if (
          this.openById.get(libraryId) !== openLibrary
          || this.reconciliationOwner.generation(libraryId) !== generation
        ) return;
        readLibraryIdentity(openLibrary.connection);
      } catch (error) {
        this.diagnose('open.background-integrity-check', error, { libraryId, generation });
      }
    })();
  };

  const timer = setTimeout(run, 1_000);
  timer.unref?.();
  this.deferredOpenMaintenanceByLibrary.set(libraryId, timer);
}

export function cancelDeferredOpenMaintenance(this: LibraryService, libraryId: string): void {
  const timer = this.deferredOpenMaintenanceByLibrary.get(libraryId);
  if (timer) clearTimeout(timer);
  this.deferredOpenMaintenanceByLibrary.delete(libraryId);
}

export function createLibrary(this: LibraryService, input: {
    displayName: string;
    selectedParentPath: string;
    /** 内部用于「从同步远端恢复库身份」：默认随机生成。 */
    libraryId?: string;
    storageLayout?: LibraryStorageLayout;
    useExistingFolder?: boolean;
  }): InternalLibrarySummary {
  if (input.useExistingFolder) return this.initializeExistingFolder(input);
  let finalPath: string;
  try {
    finalPath = targetLibraryPath(input.selectedParentPath, input.displayName);
  } catch (error) {
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }

  const displayName = path.basename(finalPath);
  const parentPath = path.dirname(finalPath);
  try {
    if (!directoryExists(parentPath)) throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    accessSync(parentPath, constants.W_OK);
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  if (existsSync(finalPath)) throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');

  const partialPath = path.join(parentPath, `.keel-create-${randomUUID()}.partial`);
  let connection: DatabaseConnection | undefined;
  let renamed = false;

  try {
    mkdirSync(partialPath);
    const layout = input.storageLayout ?? 'root';
    createDirectoryLayout(partialPath, layout);
    writeStorageLayout(partialPath, layout);
    connection = openConfiguredDatabase(
      databasePath(partialPath),
      this.options.sqliteBusyTimeoutMsForTests,
    );
    migrateDatabase(connection, true, this.options);
    connection
      .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
      .run(input.libraryId ?? randomUUID(), displayName, new Date().toISOString());
    verifyDatabase(connection);
    connection.close();
    connection = undefined;

    const verificationConnection = openConfiguredDatabase(
      databasePath(partialPath),
      this.options.sqliteBusyTimeoutMsForTests,
    );
    try {
      verifyDatabase(verificationConnection);
    } finally {
      verificationConnection.close();
    }

    renamePathWithRetry(partialPath, finalPath);
    renamed = true;
    return this.openLibrary(finalPath);
  } catch (error) {
    closeIgnoringFailure(connection);
    const cleanupPath = renamed ? finalPath : partialPath;
    try {
      if (existsSync(cleanupPath)) {
        if (renamed) renamePathWithRetry(finalPath, partialPath);
        removePathWithSyncRetry(partialPath);
      }
    } catch (cleanupError) {
      throw new LibraryServiceError('LIBRARY_CLEANUP_FAILED', { cause: cleanupError });
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
}

/**
* Open a library through the corruption recovery ladder. The normal path is
* intentionally kept separate so a failed recovery attempt cannot recurse
* through this method and accidentally consume another backup slot.
*/
export function openLibrary(this: LibraryService, selectedLibraryPath: string, options?: { replaceExisting?: boolean }): InternalLibrarySummary {
  let canonicalPath: string | undefined;
  let normalizedPath: string | undefined;
  try {
    const selectedPath = normalizeAbsolutePath(selectedLibraryPath);
    normalizedPath = selectedPath;
    if (existsSync(selectedPath) && directoryExists(selectedPath)) {
      canonicalPath = realpathSync(selectedPath);
    }
  } catch {
    // The primary open path below owns the public validation error.
  }

  // P1: rename `.keel` to `.keel` before any database handle exists. A
  // library already open in this Worker keeps its current directory.
  let metaDirMigration: LibraryMetaDirMigration | undefined;
  if (canonicalPath !== undefined && !this.openIdByPath.has(canonicalPath)) {
    metaDirMigration = migrateLibraryMetaDir(canonicalPath, `schema-${SUPPORTED_SCHEMA_VERSION}`);
    if (metaDirMigration.status === 'failed' || metaDirMigration.status === 'both') {
      this.diagnose('library.meta-dir-migration', new Error(metaDirMigration.reason), {
        libraryPath: canonicalPath,
        status: metaDirMigration.status,
      });
    }
  }
  const withMigrationNotice = (summary: InternalLibrarySummary): InternalLibrarySummary => {
    if (metaDirMigration?.status !== 'failed' && metaDirMigration?.status !== 'both') return summary;
    const notice = {
      metaDirMigration: metaDirMigration.status,
      ...(metaDirMigration.status === 'failed' ? { metaDirMigrationReason: metaDirMigration.reason } : {}),
    };
    const openLibrary = this.openById.get(summary.libraryId);
    if (!openLibrary) return { ...summary, ...notice };
    openLibrary.summary = { ...openLibrary.summary, ...notice };
    return openLibrary.summary;
  };

  // A network mount can disappear between sessions. If the selected path or
  // its primary DB is unavailable, prefer the last verified local snapshot
  // over returning a misleading generic NOT_A_LIBRARY error. The helper only
  // reads this user-scoped derived cache and returns a read-only summary.
  if (
    normalizedPath !== undefined
    && (!existsSync(normalizedPath) || !realFileExists(databasePath(normalizedPath)))
  ) {
    const cached = this.openCachedNetworkMetadataSnapshot(normalizedPath);
    if (cached) return cached;
  }

  try {
    return withMigrationNotice(this.openLibraryPrimary(selectedLibraryPath, options));
  } catch (error) {
    if (
      normalizedPath !== undefined
      && (!existsSync(normalizedPath) || !realFileExists(databasePath(normalizedPath)))
    ) {
      const cached = this.openCachedNetworkMetadataSnapshot(normalizedPath);
      if (cached) return cached;
    }
    if (!canonicalPath || !this.isDatabaseRecoveryFailure(error)) throw error;
    if (!this.canAttemptDatabaseRecovery(canonicalPath)) throw error;
    // Do not turn a valid database's journal/migration/operation error into
    // a destructive rescue. The ladder is only for a failed SQLite file
    // (or a missing primary with a usable backup).
    if (!this.primaryDatabaseIsDamaged(canonicalPath)) throw error;

    const primaryFailure = error;
    for (const slot of [1, 2] as const) {
      const backupPath = databaseBackupPath(canonicalPath, slot);
      if (!this.validateDatabaseBackup(backupPath, canonicalPath, slot)) continue;
      try {
        this.restoreDatabaseBackup(canonicalPath, backupPath);
        const summary = this.openLibraryPrimary(canonicalPath);
        return this.attachRecoveryNotice(summary, {
          mode: slot === 1 ? 'backup-1' : 'backup-2',
        });
      } catch (recoveryError) {
        this.diagnose('library.recovery.backup-open', recoveryError, {
          libraryPath: canonicalPath,
          backupPath,
          slot,
        });
      }
    }

    try {
      const rescue = this.rescueLibraryFromAssets(canonicalPath, primaryFailure);
      const summary = this.openLibraryPrimary(canonicalPath);
      return this.attachRecoveryNotice(summary, {
        mode: 'rescue',
        ...(rescue.reportPath ? { reportPath: rescue.reportPath } : {}),
        recoveredAssetCount: rescue.recoveredAssetCount,
        metadataRecovered: false,
        metadataLosses: ['tags', 'ratings', 'descriptions', 'source-links'],
      });
    } catch (rescueError) {
      this.diagnose('library.recovery.rescue', rescueError, {
        libraryPath: canonicalPath,
      });
      throw primaryFailure;
    }
  }
}

export function rescueLibraryFromAssets(this: LibraryService, libraryPath: string, primaryFailure: unknown): { reportPath?: string; recoveredAssetCount: number } {
  const keelPath = libraryMetaDir(libraryPath);
  const primaryPath = databasePath(libraryPath);
  const quarantineDirectory = path.join(keelPath, 'corrupt-backup');
  const quarantinePath = path.join(
    quarantineDirectory,
    `library.db.primary-${Date.now()}-${randomUUID()}.db`,
  );
  mkdirSync(quarantineDirectory, { recursive: true });
  const primaryExisted = existsSync(primaryPath);
  if (primaryExisted) renameSync(primaryPath, quarantinePath);
  rmSync(`${primaryPath}-wal`, { force: true });
  rmSync(`${primaryPath}-shm`, { force: true });

  let connection: DatabaseConnection | undefined;
  try {
    this.options.beforeLibraryRescueForTests?.();
    connection = openConfiguredDatabase(
      primaryPath,
      this.options.sqliteBusyTimeoutMsForTests,
    );
    migrateDatabase(connection, true, this.options);
    connection
      .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
      .run(
        randomUUID(),
        path.basename(libraryPath).slice(0, 255) || 'Recovered Library',
        new Date().toISOString(),
      );
    verifyDatabase(connection);
    connection.close();
    connection = undefined;
  } catch (error) {
    closeIgnoringFailure(connection);
    try { rmSync(primaryPath, { force: true }); } catch { /* best effort */ }
    try { rmSync(`${primaryPath}-wal`, { force: true }); } catch { /* best effort */ }
    try { rmSync(`${primaryPath}-shm`, { force: true }); } catch { /* best effort */ }
    if (primaryExisted && existsSync(quarantinePath) && !existsSync(primaryPath)) {
      try { renameSync(quarantinePath, primaryPath); } catch { /* best effort */ }
    }
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }

  const reportPath = path.join(
    quarantineDirectory,
    `recovery-report-${Date.now()}-${randomUUID()}.json`,
  );
  const recoveredAssetCount = countRecoverableAssetFiles(managedStoragePath(libraryPath));
  try {
    writeFileSync(reportPath, JSON.stringify({
      version: 1,
      mode: 'rescue',
      libraryPath,
      recoveredFrom: readStorageLayout(libraryPath) === 'root' ? '.' : 'Assets',
      recoveredAssetCount,
      metadataRecovered: false,
      metadataLosses: ['tags', 'ratings', 'descriptions', 'source-links'],
      primaryFailure: primaryFailure instanceof Error ? primaryFailure.message : String(primaryFailure),
      createdAt: new Date().toISOString(),
    }, null, 2));
    return { reportPath, recoveredAssetCount };
  } catch (error) {
    this.diagnose('library.recovery.report', error, { libraryPath });
    return { recoveredAssetCount };
  }
}

/**
* Register a writable open handle. Desktop never offers a read-only library:
* too-new schemas stay writable, stuck migrations stay writable at the last
* good version, and physical damage goes through backup/rescue instead.
*/
export function adoptWritableOpenLibrary(this: LibraryService, input: {
    connection: DatabaseConnection;
    library: LibraryRow;
    canonicalPath: string;
    keelPath: string;
    networkStorage?: boolean;
    storageKind?: LibraryStorageKind;
    libraryVersion?: number;
    supportedSchemaVersion?: number;
    migrationStuck?: boolean;
    startServices: boolean;
    replaceExisting?: boolean;
  }): InternalLibrarySummary {
  const existingSummary = this.reuseOrRejectDuplicateCatalog({
    libraryId: input.library.library_id,
    canonicalPath: input.canonicalPath,
    connection: input.connection,
    replaceExisting: input.replaceExisting,
  });
  if (existingSummary) return existingSummary;
  try {
    for (const directoryName of REGENERABLE_DIRECTORIES) {
      mkdirSync(path.join(input.keelPath, directoryName), { recursive: true });
    }
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  // A NAS library can be moved between computers, but an absolute linked
  // folder path cannot. Do not silently open a catalog whose linked source
  // points at computer A while this process is running on computer B; the
  // resulting empty/offline view looks like data loss and is hard to recover
  // from. Local libraries retain their existing offline/relink semantics.
  this.assertNetworkLinkedFoldersAvailable(
    input.connection,
    input.networkStorage === true,
  );
  backfillDominantSaturation(
    input.connection,
    libraryMetaDir(input.canonicalPath, 'artifacts'),
  );

  const networkReadThrough = input.networkStorage
    ? this.createNetworkMetadataReadThrough({
        connection: input.connection,
        canonicalPath: input.canonicalPath,
        libraryId: input.library.library_id,
        startServices: input.startServices,
        primarySchemaVersion: input.libraryVersion ?? SUPPORTED_SCHEMA_VERSION,
      })
    : { connection: input.connection, writeConnection: input.connection };
  const exposedConnection = networkReadThrough.connection;
  const writeConnection = networkReadThrough.writeConnection;
  const activeNetworkMetadataCache = networkReadThrough.state;
  const registeredOpenLibrary: { value?: OpenLibrary } = {};
  const initialGitignoreText = input.startServices
    ? (() => {
        try {
          // Prime the in-memory value so the first requireOpenLibrary does
          // not rewrite identical ignore rows and advance browse cursor.
          return readGitignoreText(input.canonicalPath);
        } catch {
          // Preserve the old retry-on-first-use behavior for a transient
          // filesystem read failure without blocking the open response.
          return '\u0000';
        }
      })()
    : '';

  const summary: InternalLibrarySummary = {
    libraryId: input.library.library_id,
    displayName: input.library.display_name,
    libraryPath: input.canonicalPath,
    storageLayout: readStorageLayout(input.canonicalPath),
    readOnly: false,
    ...(input.networkStorage ? { networkStorage: true } : {}),
    storageKind: input.storageKind ?? 'unknown',
    ...(input.libraryVersion === undefined ? {} : { libraryVersion: input.libraryVersion }),
    ...(input.supportedSchemaVersion === undefined
      ? {}
      : { supportedSchemaVersion: input.supportedSchemaVersion }),
    ...(input.migrationStuck ? { migrationStuck: true } : {}),
  };
  const changeSubscription = input.startServices
    ? new LibraryWriteCoordinator(input.connection, summary.libraryId)
      .subscribeToChangeSequence({
        onChange: (changeSequence) => {
          const currentOpenLibrary = registeredOpenLibrary.value;
          const networkCache = currentOpenLibrary?.networkMetadataCache;
          let browseSequenceChanged = false;
          if (networkCache) {
            try {
              const browseSequence = this.networkMetadataBrowseChangeSequence(
                input.connection,
                summary.libraryId,
              );
              browseSequenceChanged = browseSequence !== networkCache.observedSourceChangeSequence;
              if (browseSequenceChanged) {
                networkCache.observedSourceChangeSequence = browseSequence;
                networkCache.readThrough.invalidateReadConnection();
              }
            } catch (error) {
              // The broad subscription is still useful for ordinary library
              // change notifications. A temporary read failure must not
              // blank a verified catalog snapshot; the background validator
              // owns the offline/degraded decision.
              this.diagnose('network-metadata-cache.browse-sequence', error, {
                libraryId: summary.libraryId,
              });
            }
          }
          if (browseSequenceChanged && networkCache?.manifest) {
            this.emitNetworkMetadataCacheEvent({
              type: 'invalidated',
              libraryId: summary.libraryId,
              sourceChangeSequence: changeSequence,
              reason: 'remote-change-sequence',
            });
          }
          this.invalidateArtifactPathCache(summary.libraryId);
          this.options.onLibraryChanged?.({
            type: 'library.changed',
            libraryId: summary.libraryId,
            changeSequence,
          });
        },
      })
    : { lastSequence: 0, stop: () => {} };
  const openLibrary: OpenLibrary = {
    connection: exposedConnection,
    writeConnection,
    summary,
    readOnly: false,
    changeSubscription,
    preservedRelinkPathIdentities: new Set(),
    gitignoreText: initialGitignoreText,
    gitignoreMatcher: parseGitignore(initialGitignoreText === '\u0000' ? '' : initialGitignoreText, summary.storageLayout === 'root' ? '' : 'Assets'),
    gitignoreMaterialized: false,
    ...(activeNetworkMetadataCache ? { networkMetadataCache: activeNetworkMetadataCache } : {}),
  };
  registeredOpenLibrary.value = openLibrary;
  this.openById.set(summary.libraryId, openLibrary);
  this.openIdByPath.set(input.canonicalPath, summary.libraryId);
  if (!input.networkStorage) {
    try { ensureWindowsLibraryIcon(input.canonicalPath); }
    catch (error) { this.diagnose('library.folder-icon', error, { libraryPath: input.canonicalPath }); }
  }
  if (!input.startServices) return summary;
  const adoptStageLog = process.env.KEEL_OPEN_STAGE_LOG === '1';
  let adoptMark = adoptStageLog ? performance.now() : 0;
  const markAdoptStage = (label: string): void => {
    if (!adoptStageLog) return;
    const now = performance.now();
    console.error(JSON.stringify({
      scope: 'open.stage',
      stage: label,
      durationMs: Math.round((now - adoptMark) * 100) / 100,
    }));
    adoptMark = now;
  };

  this.armDatabaseBackupTimer(openLibrary);
  this.reconcileLinkedFolderStatuses(openLibrary);
  markAdoptStage('linked-statuses');
  this.recoverFileOperations(openLibrary);
  markAdoptStage('recover-file-ops');
  this.recoverOperationHistoryTransitions(openLibrary);
  markAdoptStage('recover-history');
  this.recoverInterruptedAiJobs(openLibrary);
  markAdoptStage('recover-ai');
  this.recoverInterruptedThumbnailJobs(openLibrary);
  // Serpent-4bdd26: retireLegacyGifProxyJobs moved to the background
  // reconciliation — its GIF LIKE subquery scans all assets (~180ms on SMB)
  // and only cancels doomed legacy transcodes, which can wait seconds.
  interruptUnfinishedPluginJobs(
    openLibrary.writeConnection,
    openLibrary.summary.libraryId,
    this.applicationSessionId,
  );
  markAdoptStage('recovery-jobs');
  // Serpent-4bdd26: reconcileDefaultIgnoredAssets moved to the background
  // reconciliation — its full active-asset scan costs ~2.8s on SMB even
  // through the covering index (one round trip per index page), and the
  // rows it removes are always-ignored junk files whose delayed cleanup is
  // invisible to the user.
  this.startAssetWatcher(openLibrary);
  markAdoptStage('asset-watcher');
  this.reconcileLinkedWatchers(openLibrary);
  markAdoptStage('watchers');
  // Startup recovery contains a few idempotent metadata transactions. They
  // intentionally run against the remote truth, so rebind the verified
  // snapshot after that synchronous phase if the semantic change sequence
  // is still unchanged. This preserves immediate second-open cache hits
  // without allowing a startup write to serve stale rows.
  if (activeNetworkMetadataCache && !activeNetworkMetadataCache.readThrough.readCacheActive) {
    let expectedSourceChangeSequence: number | undefined;
    try {
      expectedSourceChangeSequence = this.networkMetadataBrowseChangeSequence(
        input.connection,
        summary.libraryId,
      );
    } catch {
      // The background validator will keep the primary path authoritative if
      // the remote cursor cannot be read during this lifecycle boundary.
    }
    if (expectedSourceChangeSequence !== undefined) {
      const rebound = this.createNetworkMetadataReadThrough({
        connection: input.connection,
        canonicalPath: input.canonicalPath,
        libraryId: summary.libraryId,
        startServices: true,
        primarySchemaVersion: input.libraryVersion ?? SUPPORTED_SCHEMA_VERSION,
        expectedSourceChangeSequence,
      });
      if (rebound.state?.readThrough.readCacheActive) {
        activeNetworkMetadataCache.readThrough.release();
        activeNetworkMetadataCache.writeThrough.release();
        openLibrary.connection = rebound.connection;
        openLibrary.writeConnection = rebound.writeConnection;
        openLibrary.networkMetadataCache = rebound.state;
      }
    }
  }
  // Serpent-tumv (LIB-018, deferred open maintenance): the disk-heavy reconciliation
  // steps moved out of the synchronous open path and run in the background
  // (runOpenBackgroundReconciliation). Opening a large library used to
  // block on a full artifact-file lstat sweep + expired-trash purge + a
  // whole Assets-directory rescan before the first frame rendered.
  // Serpent-4bdd26：startup 缩略图入队（limit:50 + repairFailed + retryFailed，
  // 实测 ~230ms 全库扫描）已由 Worker 的 deferStartupThumbnailScene 在
  // 首个真实视口后以相同参数调度——同步路径重复执行只拖慢 library.open 响应，
  // 不改变最终队列状态。
  return summary;
}

export function openLibraryPrimary(this: LibraryService, selectedLibraryPath: string, options?: { replaceExisting?: boolean }): InternalLibrarySummary {
  // Serpent-4bdd26：开库阶段计时（KEEL_OPEN_STAGE_LOG=1），用于大库打开
  // 的归因。生产默认关闭。
  const openStageLog = process.env.KEEL_OPEN_STAGE_LOG === '1';
  let stageMark = openStageLog ? performance.now() : 0;
  const markStage = (label: string): void => {
    if (!openStageLog) return;
    const now = performance.now();
    console.error(JSON.stringify({
      scope: 'open.stage',
      stage: label,
      durationMs: Math.round((now - stageMark) * 100) / 100,
    }));
    stageMark = now;
  };
  let selectedPath: string;
  try {
    selectedPath = normalizeAbsolutePath(selectedLibraryPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }

  if (!existsSync(selectedPath)) throw new LibraryServiceError('LIBRARY_NOT_FOUND');
  if (!directoryExists(selectedPath)) throw new LibraryServiceError('NOT_A_LIBRARY');

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(selectedPath);
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_FOUND');
  }
  markStage('path-resolution');
  const alreadyOpenId = this.openIdByPath.get(canonicalPath);
  if (alreadyOpenId) {
    const existing = this.openById.get(alreadyOpenId);
    if (existing && this.sqlitePrimaryIsOpen(existing)) return existing.summary;
    if (existing) this.evictDeadOpenLibrary(alreadyOpenId, existing);
  }

  for (const directoryName of requiredDirectories(canonicalPath)) {
    if (!realDirectoryExists(path.join(canonicalPath, directoryName))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }
  }
  const keelPath = libraryMetaDir(canonicalPath);
  if (!realDirectoryExists(keelPath) || !realFileExists(databasePath(canonicalPath))) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }
  const storageKind = this.options.storageKindOverrideForTests
    ?? classifyLibraryStorage(canonicalPath);
  const networkStorage = storageKind === 'network';
  markStage('storage-classification');

  // Identity check before a second writable SQLite connection. Opening and
  // migrating a catalog that this Worker already holds is undefined on
  // rollback-journal NAS volumes and is how a live primary can be closed
  // while openById still points at the wrapper.
  if (this.openById.size > 0) {
    const probedCatalogId = this.probeCatalogIdentity(canonicalPath);
    if (probedCatalogId) {
      const existing = this.openById.get(probedCatalogId);
      if (existing && this.sqlitePrimaryIsOpen(existing)) {
        if (existing.summary.libraryPath === canonicalPath) return existing.summary;
        if (options?.replaceExisting !== true) {
          throw new LibraryServiceError('LIBRARY_ALREADY_OPEN');
        }
        this.closeLibrary(existing.summary.libraryId);
      } else if (existing) {
        this.evictDeadOpenLibrary(probedCatalogId, existing);
      }
    }
  }

  let connection: DatabaseConnection | undefined;
  let migrationAttempted = false;
  try {
    // Too-new schemas and stuck migrations stay writable. Schema bumps must
    // never lock a user out; a failed migration must not turn the library
    // into a read-only trap. Physical damage is repaired by the open ladder
    // (backup, then Assets rescue) instead of a read-only connection.
    const probedVersion = schemaVersionProbe(databasePath(canonicalPath));
    const migrationFailure = probedVersion === null
      ? null
      : readMigrationFailure(canonicalPath);
    // The stuck latch only holds while the failure was recorded by this
    // build's supported schema version. After an upgrade the migration is
    // retried, so a newer build can recover a library the old build could
    // not migrate (0031 §2.2 失败可恢复).
    const migrationStuck = probedVersion !== null &&
      migrationFailure !== null &&
      migrationFailure.fromVersion === probedVersion &&
      migrationFailure.attempts >= MAX_MIGRATION_ATTEMPTS &&
      (migrationFailure.supportedSchemaVersion ?? SUPPORTED_SCHEMA_VERSION) ===
        SUPPORTED_SCHEMA_VERSION;
    if (probedVersion !== null &&
      (probedVersion > SUPPORTED_SCHEMA_VERSION || migrationStuck)) {
      if (migrationStuck) {
        this.diagnose('library.migration-stuck', new Error(migrationFailure.error), {
          libraryPath: canonicalPath,
          fromVersion: migrationFailure.fromVersion,
          attempts: migrationFailure.attempts,
        });
      }
      connection = openConfiguredDatabase(
        databasePath(canonicalPath),
        this.options.sqliteBusyTimeoutMsForTests,
        {
          storageKind,
          ...(this.options.onDbStatement === undefined ? {} : { trace: this.options.onDbStatement }),
        },
      );
      const library = verifyOpenableSchema(connection);
      return this.adoptWritableOpenLibrary({
        connection,
        library,
        canonicalPath,
        keelPath,
        networkStorage,
        libraryVersion: probedVersion,
        supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION,
        migrationStuck,
        // A stuck library is still on an older schema; skip current-schema
        // watchers/jobs. A newer schema already contains today's tables.
        startServices: !migrationStuck,
        replaceExisting: options?.replaceExisting,
      });
    }
    connection = openConfiguredDatabase(
      databasePath(canonicalPath),
      this.options.sqliteBusyTimeoutMsForTests,
      {
        storageKind,
        ...(this.options.onDbStatement === undefined ? {} : { trace: this.options.onDbStatement }),
      },
    );
    migrationAttempted = true;
    migrateDatabase(connection, false, this.options);
    markStage('migrate');
    // A successful migration clears the failure record so the retry
    // counter never leaks into later sessions.
    clearMigrationFailure(canonicalPath);
    markStage('clear-failure');
    backfillTrashedFromTombstoneIds(connection);
    markStage('tombstone-backfill');
    // Serpent-4bdd26: the full quick_check moved to the background
    // reconciliation — it scans every B-tree and dominated this path.
    const library = verifyDatabase(connection, { skipQuickCheck: true });
    markStage('verify');
    const summary = this.adoptWritableOpenLibrary({
      connection,
      library,
      canonicalPath,
      keelPath,
      networkStorage,
      storageKind,
      startServices: true,
      replaceExisting: options?.replaceExisting,
    });
    markStage('adopt-services');
    return summary;
  } catch (error) {
    // A rolled-back migration failure is recorded so the next open retries
    // (up to MAX_MIGRATION_ATTEMPTS) and then opens writable at the last
    // good version instead of failing forever. verifyMigrationHistory
    // failures stay LIBRARY_CORRUPT and are never recorded (damaged
    // history is not retryable; the recovery ladder repairs it).
    if (
      migrationAttempted &&
      !(error instanceof LibraryServiceError &&
        (error.code === 'LIBRARY_CORRUPT'
          || error.code === 'LINKED_FOLDER_UNAVAILABLE'
          || error.code === 'LIBRARY_ALREADY_OPEN'))
    ) {
      try {
        recordMigrationFailure(
          canonicalPath,
          schemaVersion(connection!),
          // The migration target is always the current build's supported
          // schema (0031 §2.2 records fromVersion/toVersion).
          SUPPORTED_SCHEMA_VERSION,
          error instanceof LibraryServiceError ? error.code : 'LIBRARY_MIGRATION_FAILED',
          undefined,
          SUPPORTED_SCHEMA_VERSION,
        );
      } catch {
        // The primary failure remains more useful than a record failure.
      }
    }
    const registeredId = this.findLibraryIdOwningSqliteConnection(connection);
    if (registeredId) {
      const registered = this.openById.get(registeredId);
      try {
        this.closeLibrary(registeredId);
      } catch {
        if (registered) this.evictDeadOpenLibrary(registeredId, registered);
      }
    } else {
      closeIgnoringFailure(connection);
    }
    throw serviceError(error, 'LIBRARY_CORRUPT');
  }
}

/**
* Opens a current-schema library without migrations, recovery, filesystem
* reconciliation, watchers, or background job scheduling. Inspection and
* CLI clients may use this; Desktop never presents a read-only library.
*/
export function openLibraryReadOnly(this: LibraryService, selectedLibraryPath: string): InternalLibrarySummary {
  let selectedPath: string;
  try {
    selectedPath = normalizeAbsolutePath(selectedLibraryPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }

  if (!existsSync(selectedPath)) throw new LibraryServiceError('LIBRARY_NOT_FOUND');
  if (!directoryExists(selectedPath)) throw new LibraryServiceError('NOT_A_LIBRARY');

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(selectedPath);
  } catch (error) {
    throw serviceError(error, 'LIBRARY_NOT_FOUND');
  }
  const alreadyOpenId = this.openIdByPath.get(canonicalPath);
  if (alreadyOpenId) return this.openById.get(alreadyOpenId)!.summary;

  for (const directoryName of requiredDirectories(canonicalPath)) {
    if (!realDirectoryExists(path.join(canonicalPath, directoryName))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }
  }
  const keelPath = libraryMetaDir(canonicalPath);
  const filename = databasePath(canonicalPath);
  if (!realDirectoryExists(keelPath) || !realFileExists(filename)) {
    throw new LibraryServiceError('NOT_A_LIBRARY');
  }
  const networkStorage = (
    this.options.storageKindOverrideForTests
    ?? classifyLibraryStorage(canonicalPath)
  ) === 'network';

  let connection: DatabaseConnection | undefined;
  try {
    connection = new Database(filename, { readonly: true, fileMustExist: true });
    connection.pragma('foreign_keys = ON');
    connection.pragma('trusted_schema = ON');
    connection.pragma('query_only = ON');
    const library = verifyDatabase(connection);
    const existingSummary = this.reuseOrRejectDuplicateCatalog({
      libraryId: library.library_id,
      canonicalPath,
      connection,
    });
    if (existingSummary) return existingSummary;

    const summary: InternalLibrarySummary = {
      libraryId: library.library_id,
      displayName: library.display_name,
      libraryPath: canonicalPath,
      storageLayout: readStorageLayout(canonicalPath),
      ...(networkStorage ? { networkStorage: true } : {}),
    };
    this.openById.set(summary.libraryId, {
      connection,
      writeConnection: connection,
      summary,
      readOnly: true,
      changeSubscription: { lastSequence: 0, stop() {} },
      preservedRelinkPathIdentities: new Set(),
      gitignoreText: '',
      gitignoreMatcher: parseGitignore(''),
      gitignoreMaterialized: false,
    });
    this.openIdByPath.set(canonicalPath, summary.libraryId);
    return summary;
  } catch (error) {
    closeIgnoringFailure(connection);
    if (error instanceof LibraryServiceError) throw error;
    throw error;
  }
}

/**
* Worker shutdown/close path: finish the first close-time snapshot before
* releasing SQLite. The synchronous close method remains for legacy unit
* seams and does not wait on asynchronous backup I/O.
*/
export async function closeLibraryAsync(this: LibraryService, libraryId: string): Promise<void> {
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');
  const closeStartedAt = performance.now();
  const markPhase = (phase: string, from: number): void => {
    // Closing on a network library blocked a library switch behind the loading
    // overlay for minutes with no log output at all. A close that cannot
    // explain itself is undebuggable, so keep the phase timings behind an
    // explicit switch instead of logging on every close.
    if (process.env.KEEL_CLOSE_TRACE !== '1') return;
    process.stderr.write(
      `[library.close.phase] ${JSON.stringify({
        libraryId,
        networkStorage: openLibrary.summary.networkStorage === true,
        phase,
        ms: Math.round(performance.now() - from),
        totalMs: Math.round(performance.now() - closeStartedAt),
      })}\n`,
    );
  };
  this.cancelDeferredOpenMaintenance(libraryId);
  const reconciliation = this.reconciliationOwner.current(libraryId);
  this.cancelOpenBackgroundReconciliation(libraryId);
  if (reconciliation) {
    const reconciliationStartedAt = performance.now();
    await reconciliation.promise;
    markPhase('reconciliation', reconciliationStartedAt);
  }
  // Abort and settle every media job before the backup and final SQLite
  // close. The job finally block releases its database lease and may still
  // publish durable state after the decoder has been stopped.
  const drainStartedAt = performance.now();
  await this.drainLibraryMedia(libraryId);
  markPhase('drainMedia', drainStartedAt);
  if (!openLibrary.readOnly) {
    const backupStartedAt = performance.now();
    await this.createDatabaseBackupForOpenLibrary(openLibrary, 'close');
    markPhase('backup', backupStartedAt);
  }
  const closeStartedAtInner = performance.now();
  this.closeLibrary(libraryId);
  markPhase('releaseHandle', closeStartedAtInner);
  markPhase('total', closeStartedAt);
}

export function closeLibrary(this: LibraryService, libraryId: string): void {
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');
  this.cancelDeferredOpenMaintenance(libraryId);
  this.cancelOpenBackgroundReconciliation(libraryId);

  const backupTimer = this.databaseBackupTimers.get(libraryId);
  if (backupTimer) {
    clearTimeout(backupTimer);
    this.databaseBackupTimers.delete(libraryId);
  }

  if (openLibrary.readOnly) {
    // Serpent-033e: a read-only (newer-schema) library never queued jobs,
    // started watchers, or held pending imports — every close-time write
    // below would fail with SQLITE_READONLY. Just release the handle.
    openLibrary.changeSubscription.stop();
    openLibrary.connection.close();
    this.openById.delete(libraryId);
    this.openIdByPath.delete(openLibrary.summary.libraryPath);
    this.invalidateArtifactPathCache(libraryId);
    this.artifactDescriptorCache.invalidateLibrary(libraryId);
    this.browseSessionStore.invalidateLibrary(libraryId);
    this.dropPreparedStatementCache(libraryId);
    this.clearTextAssetPreviewCache(libraryId);
    this.autoRepairAttemptedByLibrary.delete(libraryId);
    this.autoRepairProbeFailedAtByLibrary.delete(libraryId);
    this.autoAnalysisSuppressedAssetIds.delete(libraryId);
    this.interactiveIdleUntilByLibrary.delete(libraryId);
    return;
  }

  // A deliberate close is not a crash recovery boundary. Persist queued,
  // paused, and running AI work as cancelled before the connection closes so
  // reopening the library cannot silently resume uploads the user stopped.
  this.cancelJobs(libraryId);
  this.abortActiveMediaJobs(libraryId);
  this.stopAssetWatcher(libraryId);
  this.stopLinkedWatchers(libraryId);
  for (const [importId, pending] of this.pendingImports) {
    if (pending.libraryId === libraryId) {
      this.pendingImports.delete(importId);
      this.cancelImportExpiry(pending);
      this.updateImportOperation(pending, 'rolled_back', 'LIBRARY_CLOSED');
      this.removeOperation(pending.operationPath);
    }
  }
  openLibrary.changeSubscription.stop();
  this.checkpointAndCloseConnection(openLibrary, libraryId);
  this.openById.delete(libraryId);
  this.openIdByPath.delete(openLibrary.summary.libraryPath);
  this.invalidateArtifactPathCache(libraryId);
  this.artifactDescriptorCache.invalidateLibrary(libraryId);
  this.browseSessionStore.invalidateLibrary(libraryId);
  this.dropPreparedStatementCache(libraryId);
  this.clearTextAssetPreviewCache(libraryId);
  for (const [key, historyEntryId] of this.openOperationHistoryGroups) {
    if (!key.startsWith(`${libraryId}\u0000`)) continue;
    this.openOperationHistoryGroups.delete(key);
    this.openOperationHistoryGroupRules.delete(historyEntryId);
  }
  this.autoRepairAttemptedByLibrary.delete(libraryId);
  this.autoRepairProbeFailedAtByLibrary.delete(libraryId);
  this.autoAnalysisSuppressedAssetIds.delete(libraryId);
  this.interactiveIdleUntilByLibrary.delete(libraryId);
}

export function checkpointAndCloseConnection(this: LibraryService, openLibrary: OpenLibrary, libraryId: string): void {
  try {
    openLibrary.connection.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    this.diagnose('library.wal-checkpoint', error, { libraryId });
  }
  openLibrary.connection.close();
}

/**
* Drain active media jobs before closing SQLite handles during Worker
* shutdown. The old synchronous closeAll() could close a connection while
* an ffmpeg promise was still unwinding, leaving the child detached.
*/
export async function closeAllAsync(this: LibraryService, timeoutMs = 500): Promise<void> {
  const activeJobs = [...this.activeMediaJobs.values()];
  for (const active of activeJobs) active.controller.abort();
  await Promise.race([
    Promise.allSettled(activeJobs.map((active) => active.settled)).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  for (const libraryId of [...this.openById.keys()]) {
    await this.closeLibraryAsync(libraryId);
  }
}

export function closeAll(this: LibraryService): void {
  for (const libraryId of [...this.openById.keys()]) this.closeLibrary(libraryId);
}
