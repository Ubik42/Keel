import { readStorageLayout } from './library/library-storage-layout';
import { LibraryServiceError } from './library/library-errors';
import { type LibraryStorageKind, classifyLibraryStorage } from './library/network-storage';
import type { DatabaseConnection, Statement } from './library/database';
import { Database } from './library/database';
import { normalizeSearchText, tokenizeForFts, type SearchClause } from './library/search-query';
import { type LibraryStorageLayout } from '../shared/library-storage-layout';
import { mkdirSync, readFileSync } from 'node:fs';
import { default as path } from 'node:path';
import { libraryMetaDir } from '../shared/library-meta-dir';
import type { MigrationRow, PortablePathRow, LibraryServiceOptions, LibraryRow } from './library-service-types';
import { MIGRATIONS, WRITE_COORDINATION_SCHEMA_CHECKSUM, JOB_LEASE_SCHEMA_CHECKSUM, THUMBNAIL_QUEUE_INDEX_SCHEMA_CHECKSUM, PLUGIN_BACKGROUND_JOBS_SCHEMA_CHECKSUM, PLUGIN_DERIVED_FIELDS_SCHEMA_CHECKSUM, EXPLICIT_IGNORES_SCHEMA_SQL, EXTENSION_IGNORES_SCHEMA_SQL, GITIGNORE_SCHEMA_SQL, PLUGIN_JOB_INTERRUPTED_SCHEMA_SQL, MODEL_ARTIFACT_KIND_SCHEMA_SQL, RAW_VIEWER_ARTIFACT_SCHEMA_SQL, ARTIFACT_IDENTITY_SCHEMA_SQL, ensureContentFingerprintColumn, ensureLinkedFolderParentSchema, OPERATION_HISTORY_SCHEMA_SQL, OPERATION_HISTORY_REDO_STACK_SCHEMA_SQL, SUPPORTED_SCHEMA_VERSION, SYNC_SCHEMA_CHECKSUM, AUTO_ANALYSIS_SUPPRESSION_SCHEMA_CHECKSUM, AUTO_ANALYSIS_SUPPRESSION_SCHEMA_SQL, ensureSyncSchema, PLUGIN_DERIVED_FIELDS_SCHEMA_SQL, TABLE_REBUILD_MIGRATION_VERSIONS, ensureLinkedSourceIdentitySchema, ensureAssetNormalizedExtensionSchema, ensureEntityAppearanceSchema, ensureFolderCustomCoverAssetSchema, PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL } from './library/schema-sql';
import { columnsFor, hasTable, invalidateColumnProbe } from './library/lenient-columns';
import { portablePathIdentity } from './library/library-rules';
import { type CatalogSearchGroup as SearchGroup, normalizedCatalogSearchGroups, hasPositiveCatalogSearchClause, catalogFtsCanNarrowSearchGroups, buildCatalogContextualSearchWhere } from './library/catalog-read';
import { type SearchExpressionNode } from '../shared/asset-types';
import { dominantColorMetrics } from './media/palette-extractor';

/**
 * Opening, migrating, backfilling and verifying a library database.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function requiredDirectories(libraryPath: string): string[] {
  try {
    return readStorageLayout(libraryPath) === 'root' ? [] : ['Assets'];
  } catch (cause) {
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause });
  }
}

export const REGENERABLE_DIRECTORIES = ['previews', 'revisions', 'trash', 'artifacts'] as const;

export function isSqliteIoError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && error.code.startsWith('SQLITE_IOERR');
}

export function openConfiguredDatabase(
  filename: string,
  busyTimeoutMs = 5_000,
  options: {
    readonly?: boolean;
    /** Test seam; production classifies the database path before opening it. */
    storageKind?: LibraryStorageKind;
    /**
     * Test-only seam: per-statement trace used to assert DB
     * write counts in queue-throughput benchmarks. better-sqlite3's `verbose`
     * callback receives the SQL of every executed statement on this
     * connection; production callers never pass it.
     */
    trace?: (sql: string) => void;
  } = {},
): DatabaseConnection {
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
    throw new Error('SQLite busy timeout must be an integer between 0 and 60000 milliseconds.');
  }
  // schemaVersionProbe and backup validation open a SQLite
  // read-only connection so those checks cannot mutate the file. Desktop
  // never uses this flag for a user-facing library handle. journal_mode /
  // synchronous are write PRAGMAs and must be skipped here.
  const storageKind = options.readonly
    ? 'unknown'
    : (options.storageKind ?? classifyLibraryStorage(filename));
  let connection: DatabaseConnection | undefined;
  try {
    connection = options.readonly
      ? new Database(filename, { readonly: true, ...(options.trace ? { verbose: options.trace } : {}) })
      : new Database(filename, options.trace ? { verbose: options.trace } : {});
    if (!connection.function) throw new Error('SQLite search normalization is unavailable.');
    connection.function('serpent_normalize_search_text', { deterministic: true }, normalizeSearchText);
    connection.pragma('foreign_keys = ON');
    connection.pragma('trusted_schema = ON');
    // A second Keel process may be finishing a short SQLite transaction
    // while the durable lease is being acquired. Let SQLite wait briefly for
    // that kernel-level lock instead of turning normal contention into an
    // opaque SQLITE_BUSY/INTERNAL_ERROR before our public LIBRARY_BUSY path.
    connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
    if (options.readonly) {
      if (
        connection.pragma('foreign_keys', { simple: true }) !== 1 ||
        connection.pragma('busy_timeout', { simple: true }) !== busyTimeoutMs
      ) {
        throw new Error('Required SQLite safety pragmas could not be enabled.');
      }
      return connection;
    }
    // SQLite WAL relies on -wal/-shm sidecars and shared-memory locking. NAS
    // implementations vary in how faithfully SMB/NFS emulate those
    // semantics, while rollback journaling only needs ordinary file locks.
    // Keep confirmed local/removable volumes on WAL; confirmed network and
    // unknown volumes use the safer, slower rollback journal required by
    // ADR-0014/0019.
    const expectedJournalMode = storageKind === 'local' ? 'wal' : 'delete';
    const journalMode = connection.pragma(
      `journal_mode = ${storageKind === 'local' ? 'WAL' : 'DELETE'}`,
      { simple: true },
    );
    connection.pragma('synchronous = FULL');
    // a 20k-asset library database is ~60MB; the SQLite
    // default page cache (~2MB) cannot hold its hot indexes, so every cold
    // browse re-reads index pages over the network (measured ~0.9s per COUNT
    // on gigabit SMB vs <10ms warm). A 64MB cache is read-only working set —
    // it does not change durability semantics, and local libraries benefit
    // the same way once their databases outgrow the default.
    connection.pragma('cache_size = -65536');
    if (
      journalMode !== expectedJournalMode ||
      connection.pragma('foreign_keys', { simple: true }) !== 1 ||
      connection.pragma('synchronous', { simple: true }) !== 2 ||
      connection.pragma('busy_timeout', { simple: true }) !== busyTimeoutMs
    ) {
      throw new Error('Required SQLite safety pragmas could not be enabled.');
    }
    return connection;
  } catch (error) {
    closeIgnoringFailure(connection);
    if (storageKind === 'network' && isSqliteIoError(error)) {
      throw new LibraryServiceError('LIBRARY_NETWORK_SHARE', { cause: error });
    }
    throw error;
  }
}

export function createDirectoryLayout(libraryPath: string, layout: LibraryStorageLayout): void {
  if (layout === 'assets') mkdirSync(path.join(libraryPath, 'Assets'));
  const keelPath = libraryMetaDir(libraryPath);
  mkdirSync(keelPath);
  for (const directoryName of REGENERABLE_DIRECTORIES) {
    mkdirSync(path.join(keelPath, directoryName));
  }
}

export function schemaVersion(connection: DatabaseConnection): number {
  const version = connection.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  return version;
}

/**
 * probe the library's schema version without running
 * any migration or WAL pragma. Returns the version number, or null when the
 * file cannot be probed (the normal open path reports real errors itself).
 */
export function schemaVersionProbe(filename: string): number | null {
  let connection: DatabaseConnection | undefined;
  try {
    connection = openConfiguredDatabase(filename, 5_000, { readonly: true });
    return schemaVersion(connection);
  } catch {
    return null;
  } finally {
    if (connection) closeIgnoringFailure(connection);
  }
}

export function verifyMigrationHistory(connection: DatabaseConnection, version: number): void {
  try {
    const migrations = connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all() as MigrationRow[];
    const expected = MIGRATIONS.slice(0, version);
    if (
      migrations.length !== expected.length ||
      expected.some(
        (migration, index) =>
          migrations[index]?.version !== migration.version ||
          migrations[index]?.checksum !== migration.checksum,
      )
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  } catch (error) {
    // A missing history table is structural database damage, not a transient
    // migration failure. Preserve the corruption classification so the open
    // recovery ladder can try verified backups before Assets rescue.
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
  }
}

export function hasSchemaObject(connection: DatabaseConnection, name: string): boolean {
  return connection.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE name = ? LIMIT 1",
  ).get(name) !== undefined;
}

/**
 * The scripting/plugin branch used v24-v28 for plugin runtime tables before
 * the ingestion branch claimed v24-v26 for ignore rules. Libraries created by
 * that branch are valid and contain the complete plugin schema, but their
 * history cannot be checked against the merged linear sequence. Recognize
 * that exact old history so it can be normalized once without weakening the
 * normal checksum validation for any other database.
 */
export function hasLegacyPluginMigrationHistory(
  connection: DatabaseConnection,
  version: number,
): boolean {
  if (version !== 28) return false;
  if (!hasSchemaObject(connection, 'schema_migrations')) return false;
  const history = connection
    .prepare('SELECT version, checksum FROM schema_migrations WHERE version >= 24 ORDER BY version')
    .all() as MigrationRow[];
  const legacyChecksums = [
    WRITE_COORDINATION_SCHEMA_CHECKSUM,
    JOB_LEASE_SCHEMA_CHECKSUM,
    THUMBNAIL_QUEUE_INDEX_SCHEMA_CHECKSUM,
    PLUGIN_BACKGROUND_JOBS_SCHEMA_CHECKSUM,
    PLUGIN_DERIVED_FIELDS_SCHEMA_CHECKSUM,
  ];
  return (
    history.length === legacyChecksums.length &&
    history.every((row, index) =>
      row.version === 24 + index && row.checksum === legacyChecksums[index],
    ) &&
    hasSchemaObject(connection, 'library_write_leases') &&
    hasSchemaObject(connection, 'library_job_leases') &&
    hasSchemaObject(connection, 'plugin_derived_fields') &&
    !hasSchemaObject(connection, 'explicit_ignored_paths') &&
    !hasSchemaObject(connection, 'gitignore_ignored_paths')
  );
}

/**
 * Normalize the old plugin-first history into the current canonical history.
 * The plugin tables already exist under their old migrations, so apply the
 * three ingestion schemas and the v32 Plugin Job schema before applying the
 * canonical v33-v36 schemas that the old branch never had. Only after every
 * missing object exists may the history rows be rewritten to canonical
 * checksums. The caller already owns the migration transaction for v23+
 * databases.
 */
export function migrateLegacyPluginMigrationHistory(connection: DatabaseConnection): void {
  connection.exec(EXPLICIT_IGNORES_SCHEMA_SQL);
  connection.exec(EXTENSION_IGNORES_SCHEMA_SQL);
  connection.exec(GITIGNORE_SCHEMA_SQL);
  connection.exec(PLUGIN_JOB_INTERRUPTED_SCHEMA_SQL);
  // The legacy branch stopped at its plugin-derived-fields v28. It therefore
  // has neither model artifacts, content fingerprints, operation history nor
  // the durable redo stack. Reuse the canonical migration bodies here instead
  // of only rewriting schema_migrations (which would make the DB claim
  // v36 while still physically missing these tables, columns and indexes).
  const revisionArtifactsSql = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'revision_artifacts'")
    .get() as { sql?: string } | undefined;
  if (!revisionArtifactsSql?.sql?.includes("'model_glb'")) {
    connection.exec(MODEL_ARTIFACT_KIND_SCHEMA_SQL);
  }
  const currentRevisionArtifactsSql = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'revision_artifacts'")
    .get() as { sql?: string } | undefined;
  if (!currentRevisionArtifactsSql?.sql?.includes("'viewer_image'")) {
    connection.exec(RAW_VIEWER_ARTIFACT_SCHEMA_SQL);
  }
  const identityRevisionArtifactsSql = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'revision_artifacts'")
    .get() as { sql?: string } | undefined;
  if (!identityRevisionArtifactsSql?.sql?.includes('artifact_key')) {
    connection.exec(ARTIFACT_IDENTITY_SCHEMA_SQL);
  }
  ensureContentFingerprintColumn(connection);
  ensureLinkedFolderParentSchema(connection);
  const historyObjects = [
    'operation_history',
    'operation_history_steps',
    'operation_history_attempts',
    'library_change_on_operation_history_insert',
    'library_change_on_operation_history_update',
    'library_change_on_operation_history_delete',
  ];
  if (!historyObjects.every((name) => hasSchemaObject(connection, name))) {
    if (hasSchemaObject(connection, 'operation_history')
      || hasSchemaObject(connection, 'operation_history_steps')
      || hasSchemaObject(connection, 'operation_history_attempts')) {
      throw new Error('The legacy library contains an incomplete operation history schema.');
    }
    connection.exec(OPERATION_HISTORY_SCHEMA_SQL);
  }
  if (!columnsFor(connection, 'operation_history').has('redo_sequence')) {
    connection.exec(OPERATION_HISTORY_REDO_STACK_SCHEMA_SQL);
  }
  connection.prepare('DELETE FROM schema_migrations WHERE version >= 24').run();
  const insert = connection.prepare(
    'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
  );
  for (const migration of MIGRATIONS.slice(23)) {
    insert.run(migration.version, migration.checksum, new Date().toISOString());
  }
  connection.pragma(`user_version = ${SUPPORTED_SCHEMA_VERSION}`);
}

export function hasCanonicalMigrationHistoryThrough(
  connection: DatabaseConnection,
  throughVersion: number,
): boolean {
  if (!hasSchemaObject(connection, 'schema_migrations')) return false;
  const migrations = connection
    .prepare(
      'SELECT version, checksum FROM schema_migrations WHERE version <= ? ORDER BY version',
    )
    .all(throughVersion) as MigrationRow[];
  const expected = MIGRATIONS.slice(0, throughVersion);
  return (
    migrations.length === expected.length &&
    expected.every(
      (migration, index) =>
        migrations[index]?.version === migration.version &&
        migrations[index]?.checksum === migration.checksum,
    )
  );
}

/**
 * The WebDAV sync line registered SYNC_SCHEMA as v37 before the merge that
 * assigned AUTO_ANALYSIS_SUPPRESSION to v37 and SYNC to v38. Real libraries
 * opened on that fork (e.g. an image test library) contain both physical schemas but
 * carry swapped checksums. Recognize only that exact history so a healthy
 * database is not sent down the damage-recovery ladder as LIBRARY_CORRUPT.
 */
export function hasForkedSyncAutoAnalysisMigrationHistory(
  connection: DatabaseConnection,
  version: number,
): boolean {
  if (version !== 37 && version !== 38) return false;
  if (!hasSchemaObject(connection, 'schema_migrations')) return false;
  if (!hasCanonicalMigrationHistoryThrough(connection, 36)) return false;
  if (!columnsFor(connection, 'assets').has('sync_id')) return false;
  if (!hasSchemaObject(connection, 'sync_manifest_cache')) return false;

  const v37 = connection
    .prepare('SELECT checksum FROM schema_migrations WHERE version = 37')
    .get() as { checksum: string } | undefined;
  if (v37?.checksum !== SYNC_SCHEMA_CHECKSUM) return false;

  const v38 = connection
    .prepare('SELECT checksum FROM schema_migrations WHERE version = 38')
    .get() as { checksum: string } | undefined;

  if (version === 37) return v38 === undefined;

  return (
    v38?.checksum === AUTO_ANALYSIS_SUPPRESSION_SCHEMA_CHECKSUM &&
    hasSchemaObject(connection, 'asset_auto_analysis_suppression')
  );
}

/**
 * Canonicalize the sync-first v37/v38 fork without changing tables. Both
 * schemas are additive; once the objects exist, only schema_migrations (and
 * user_version when the fork stopped at v37) needs rewriting. The caller
 * already owns the v23+ migration transaction.
 */
export function migrateForkedSyncAutoAnalysisMigrationHistory(
  connection: DatabaseConnection,
): void {
  if (!hasSchemaObject(connection, 'asset_auto_analysis_suppression')) {
    connection.exec(AUTO_ANALYSIS_SUPPRESSION_SCHEMA_SQL);
  }
  ensureSyncSchema(connection);
  connection
    .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 37')
    .run(AUTO_ANALYSIS_SUPPRESSION_SCHEMA_CHECKSUM);
  const hasV38 = connection
    .prepare('SELECT 1 AS present FROM schema_migrations WHERE version = 38 LIMIT 1')
    .get() !== undefined;
  if (hasV38) {
    connection
      .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 38')
      .run(SYNC_SCHEMA_CHECKSUM);
  } else {
    connection
      .prepare(
        'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
      )
      .run(38, SYNC_SCHEMA_CHECKSUM, new Date().toISOString());
  }
  if (schemaVersion(connection) < 38) {
    connection.pragma('user_version = 38');
  }
}

/**
 * Migration v20 helper: ADD COLUMN is not idempotent under simulated
 * downgrade fixtures that leave the column in place. Apply only if missing;
 * checksum still records the canonical SQL text.
 */
export function ensureTrashTombstoneAssetBindSchema(
  connection: DatabaseConnection,
): void {
  const columns = connection.pragma('table_info(assets)') as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'trashed_from_tombstone_id')) {
    connection.exec(
      'ALTER TABLE assets ADD COLUMN trashed_from_tombstone_id TEXT',
    );
  }
  connection.exec(`
    CREATE INDEX IF NOT EXISTS assets_trashed_tombstone_idx
      ON assets(trashed_from_tombstone_id)
      WHERE deleted_at IS NOT NULL AND trashed_from_tombstone_id IS NOT NULL
  `);
}

/**
 * Bind legacy trashed assets (FK already nulled) to surviving tombstones.
 * Prefer folder_id; else unique path; else closest trashed_at among same path.
 */
export function backfillTrashedFromTombstoneIds(
  connection: DatabaseConnection,
): void {
  // lenient open (0031 §1): libraries older than the
  // trash-tombstone columns/table must still open; the backfill only applies
  // when the structure it reads exists.
  const assetColumns = columnsFor(connection, 'assets');
  if (
    !hasTable(connection, 'trashed_managed_folders') ||
    !['deleted_at', 'trashed_from_folder_id', 'trashed_from_tombstone_id', 'trashed_from_relative_path']
      .every((column) => assetColumns.has(column))
  ) {
    return;
  }
  // count candidates through the v42 partial index first —
  // a pure read. On SMB every UPDATE pays ~200ms of journal-file round trips
  // even when zero rows match, and the common case is an empty trash.
  const candidateCount = connection
    .prepare(
      `SELECT COUNT(*) AS count FROM assets
        WHERE deleted_at IS NOT NULL
          AND trashed_from_tombstone_id IS NULL
          AND trashed_from_folder_id IS NOT NULL`,
    )
    .get() as { count: number };
  if (candidateCount.count === 0) return;

  connection
    .prepare(
      `UPDATE assets
          SET trashed_from_tombstone_id = (
            SELECT t.tombstone_id
              FROM trashed_managed_folders t
             WHERE t.folder_id = assets.trashed_from_folder_id
             LIMIT 1
          )
        WHERE deleted_at IS NOT NULL
          AND trashed_from_tombstone_id IS NULL
          AND trashed_from_folder_id IS NOT NULL`,
    )
    .run();

  const tombstones = connection
    .prepare(
      `SELECT tombstone_id, relative_path, trashed_at
         FROM trashed_managed_folders`,
    )
    .all() as Array<{
    tombstone_id: string;
    relative_path: string;
    trashed_at: string;
  }>;
  if (tombstones.length === 0) return;

  const byPath = new Map<string, typeof tombstones>();
  for (const tombstone of tombstones) {
    const list = byPath.get(tombstone.relative_path) ?? [];
    list.push(tombstone);
    byPath.set(tombstone.relative_path, list);
  }

  const unbound = connection
    .prepare(
      `SELECT asset_id, trashed_from_relative_path, deleted_at
         FROM assets
        WHERE deleted_at IS NOT NULL
          AND trashed_from_tombstone_id IS NULL
          AND trashed_from_relative_path IS NOT NULL`,
    )
    .all() as Array<{
    asset_id: string;
    trashed_from_relative_path: string;
    deleted_at: string;
  }>;

  const update = connection.prepare(
    `UPDATE assets
        SET trashed_from_tombstone_id = ?
      WHERE asset_id = ?`,
  );

  for (const asset of unbound) {
    const parentPath = path.posix.dirname(asset.trashed_from_relative_path);
    if (!parentPath || parentPath === '.') continue;
    const candidates = byPath.get(parentPath);
    if (!candidates || candidates.length === 0) continue;
    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      const deletedMs = Date.parse(asset.deleted_at);
      chosen = candidates.reduce((best, candidate) => {
        const bestDelta = Math.abs(Date.parse(best.trashed_at) - deletedMs);
        const nextDelta = Math.abs(Date.parse(candidate.trashed_at) - deletedMs);
        return nextDelta < bestDelta ? candidate : best;
      });
    }
    update.run(chosen.tombstone_id, asset.asset_id);
  }
}

export function backfillPortablePathIdentities(connection: DatabaseConnection): void {
  const folderRows = connection
    .prepare('SELECT folder_id AS id, relative_path FROM managed_folders ORDER BY folder_id')
    .all() as PortablePathRow[];
  const assetRows = connection
    .prepare('SELECT asset_id AS id, relative_file_path AS relative_path FROM assets ORDER BY asset_id')
    .all() as PortablePathRow[];
  const allIdentities = new Map<string, { kind: 'asset' | 'folder'; path: string }>();

  const backfill = (
    rows: PortablePathRow[],
    kind: 'asset' | 'folder',
    statement: Statement,
  ): void => {
    for (const row of rows) {
      const identity = portablePathIdentity(row.relative_path);
      const existing = allIdentities.get(identity);
      if (existing && (existing.kind !== kind || existing.path !== row.relative_path)) {
        throw new Error('Existing paths are not portable-identity unique.');
      }
      allIdentities.set(identity, { kind, path: row.relative_path });
      statement.run(identity, row.id);
    }
  };

  backfill(
    folderRows,
    'folder',
    connection.prepare('UPDATE managed_folders SET path_identity = ? WHERE folder_id = ?'),
  );
  backfill(
    assetRows,
    'asset',
    connection.prepare('UPDATE assets SET path_identity = ? WHERE asset_id = ?'),
  );
}

export function buildFileName(relativeFilePath: string): string {
  return path.posix.basename(relativeFilePath);
}

export function buildFolderPath(relativeFilePath: string): string {
  return path.posix.dirname(relativeFilePath) === '.' ? '' : path.posix.dirname(relativeFilePath);
}

export function byteSizeLabel(byteSize: number): string {
  if (byteSize < 1_000_000) return 'small';
  if (byteSize < 10_000_000) return 'medium';
  if (byteSize < 100_000_000) return 'large';
  return 'xlarge';
}

export const EMBEDDED_METADATA_MARKER = '__serpent_embedded_metadata__';

export function buildMetadataText(input: {
  availability: string;
  byteSize: number;
  relativeFilePath: string;
  revisionId?: string | null;
  embeddedMetadataText?: string;
}): string {
  const extension = path.posix.extname(input.relativeFilePath).toLowerCase();
  const parts: string[] = [];
  if (extension.length > 0) parts.push(extension);
  parts.push(byteSizeLabel(input.byteSize));
  parts.push(input.availability);
  const embedded = input.embeddedMetadataText?.trim();
  if (embedded && input.revisionId) {
    parts.push(`${EMBEDDED_METADATA_MARKER}=${input.revisionId}`, embedded);
  }
  return parts.join(' ');
}

export function embeddedMetadataFromSearchText(
  metadataText: string | null | undefined,
  revisionId: string | null | undefined,
): string {
  if (!metadataText || !revisionId) return '';
  const marker = `${EMBEDDED_METADATA_MARKER}=${revisionId}`;
  const markerIndex = metadataText.indexOf(marker);
  if (markerIndex < 0) return '';
  return metadataText.slice(markerIndex + marker.length).trim();
}

/** Both content layers are searchable; neither changes what the UI displays. */
export function buildSearchDescription(
  humanDescription: string | null,
  aiDescription: string | null,
): string {
  return [humanDescription, aiDescription]
    .filter((description): description is string => Boolean(description?.trim()))
    .join('\n');
}

export function backfillAssetSearchContent(connection: DatabaseConnection): void {
  const assets = connection
    .prepare(
      `SELECT a.asset_id, a.relative_file_path, a.availability,
              r.byte_size, m.label, m.description, m.source_page_url
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        ORDER BY a.asset_id`,
    )
    .all() as Array<{
      asset_id: string;
      relative_file_path: string;
      availability: string;
      byte_size: number;
      label: string | null;
      description: string | null;
      source_page_url: string | null;
    }>;

  const tagRows = connection
    .prepare(
      `SELECT hat.asset_id, GROUP_CONCAT(t.name, ' ') AS tags
         FROM human_asset_tags hat
         JOIN tags t ON t.tag_id = hat.tag_id
        GROUP BY hat.asset_id`,
    )
    .all() as Array<{ asset_id: string; tags: string | null }>;
  const tagsByAsset = new Map<string, string>();
  for (const row of tagRows) {
    tagsByAsset.set(row.asset_id, row.tags ?? '');
  }

  const insert = connection.prepare(
    `INSERT OR IGNORE INTO asset_search_index
       (asset_id, label, filename, tags, description, source_url, folder_path, metadata_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const asset of assets) {
    insert.run(
      asset.asset_id,
      tokenizeForFts(asset.label ?? ''),
      tokenizeForFts(buildFileName(asset.relative_file_path)),
      tokenizeForFts(tagsByAsset.get(asset.asset_id) ?? ''),
      tokenizeForFts(asset.description ?? ''),
      tokenizeForFts(asset.source_page_url ?? ''),
      tokenizeForFts(buildFolderPath(asset.relative_file_path)),
      tokenizeForFts(
        buildMetadataText({
          availability: asset.availability,
          byteSize: asset.byte_size,
          relativeFilePath: asset.relative_file_path,
        }),
      ),
    );
  }
}

/** Rebuild v18's raw normalized index from the canonical asset tables. */
export function backfillContextualSearchContent(connection: DatabaseConnection): void {
  const assets = connection
    .prepare(
      `SELECT a.asset_id, a.relative_file_path, a.availability, r.byte_size,
              m.description, ai.description AS ai_description,
              m.source_page_url, m.author
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
         LEFT JOIN (
           SELECT asset_id, GROUP_CONCAT(value, '\n') AS description
             FROM ai_content
            WHERE field_name = 'description'
            GROUP BY asset_id
         ) ai ON ai.asset_id = a.asset_id
        ORDER BY a.asset_id`,
    )
    .all() as Array<{
      asset_id: string;
      relative_file_path: string;
      availability: string;
      byte_size: number;
      description: string | null;
      ai_description: string | null;
      source_page_url: string | null;
      author: string | null;
    }>;
  const tagRows = connection
    .prepare(
      `SELECT asset_id, GROUP_CONCAT(tag_name, ' ') AS tags
         FROM (
           SELECT hat.asset_id, t.name AS tag_name
             FROM human_asset_tags hat JOIN tags t ON t.tag_id = hat.tag_id
           UNION
           SELECT aat.asset_id, t.name AS tag_name
             FROM ai_asset_tags aat JOIN tags t ON t.tag_id = aat.tag_id
         )
        GROUP BY asset_id`,
    )
    .all() as Array<{ asset_id: string; tags: string | null }>;
  const tagsByAsset = new Map(tagRows.map((row) => [row.asset_id, row.tags ?? '']));
  const insert = connection.prepare(
    `INSERT INTO asset_search_index
       (asset_id, filename, tags, description, source_url, author, folder_path, metadata_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const asset of assets) {
    insert.run(
      asset.asset_id,
      normalizeSearchText(buildFileName(asset.relative_file_path)),
      normalizeSearchText(tagsByAsset.get(asset.asset_id) ?? ''),
      normalizeSearchText(buildSearchDescription(asset.description, asset.ai_description)),
      normalizeSearchText(asset.source_page_url ?? ''),
      normalizeSearchText(asset.author ?? ''),
      normalizeSearchText(buildFolderPath(asset.relative_file_path)),
      normalizeSearchText(
        buildMetadataText({
          availability: asset.availability,
          byteSize: asset.byte_size,
          relativeFilePath: asset.relative_file_path,
        }),
      ),
    );
  }
}

/**
 * The v31 plugin field migration predates the test downgrade fixtures and
 * intentionally keeps its historical checksum. Those fixtures can retain
 * this table while rewinding user_version, so replay the same schema with
 * IF NOT EXISTS semantics without changing the checksum recorded for v31.
 */
export function ensurePluginDerivedFieldsSchema(connection: DatabaseConnection): void {
  connection.exec(
    PLUGIN_DERIVED_FIELDS_SCHEMA_SQL
      .replace('CREATE TABLE plugin_derived_fields', 'CREATE TABLE IF NOT EXISTS plugin_derived_fields')
      .replace('CREATE INDEX plugin_derived_fields_lookup', 'CREATE INDEX IF NOT EXISTS plugin_derived_fields_lookup'),
  );
}

export function normalizedSearchGroups(query: {
  clauses: SearchClause[];
  groups?: SearchGroup[];
  expression?: { version: 1; root: SearchExpressionNode | null };
}): SearchGroup[] {
  return normalizedCatalogSearchGroups(query);
}

export function expressionHasPositiveText(root: SearchExpressionNode): boolean {
  const visit = (node: SearchExpressionNode, negated: boolean): boolean => {
    if (node.kind === 'NOT') return visit(node.child, !negated);
    if (node.kind === 'TERM') return !negated && node.match === 'contains';
    return node.children.some((child) => visit(child, negated));
  };
  return visit(root, false);
}

export function expressionUsesSearchIndex(root: SearchExpressionNode): boolean {
  if (root.kind === 'TERM') return root.match === 'contains';
  if (root.kind === 'NOT') return expressionUsesSearchIndex(root.child);
  return root.children.some(expressionUsesSearchIndex);
}

export function hasPositiveSearchClause(groups: SearchGroup[]): boolean {
  return hasPositiveCatalogSearchClause(groups);
}

export function ftsCanNarrowSearchGroups(groups: SearchGroup[]): boolean {
  return catalogFtsCanNarrowSearchGroups(groups);
}

export function buildContextualSearchWhere(
  groups: SearchGroup[],
  assetOnly = false,
): {
  sql: string;
  params: string[];
} {
  return buildCatalogContextualSearchWhere(groups, assetOnly);
}

/**
 * Schema v24 is the first migration opened routinely by two independent
 * Keel processes: an existing library can be opened by Desktop while a
 * future MCP host connects to the same database.  Serialize the v23 -> v24
 * boundary with SQLite's writer mutex, then re-read the version *inside* the
 * transaction.  The second opener therefore observes the committed v24
 * history instead of both trying to create the coordination tables/triggers.
 *
 * Older migrations rebuild tables while temporarily changing `foreign_keys`.
 * SQLite forbids that PRAGMA inside a transaction, so they intentionally keep
 * their established per-migration transaction model below.  Every released
 * v0.1 library is v23 before this change, which is the upgrade boundary that
 * needs cross-process protection now.
 */
/**
 * migrateDatabase refuses to rewrite a newer schema. Desktop
 * still opens that library writable; create/import validation treats the
 * same signal as LIBRARY_VERSION_TOO_NEW.
 */
export interface SchemaTooNewSignal {
  readonly libraryVersion: number;
}

/**
 * Fill dominant_saturation for palettes extracted before v56. Greyscale
 * sources stored hue=0; without saturation, a red filter would match them.
 */
export function backfillDominantSaturation(
  connection: DatabaseConnection,
  artifactsDir: string,
): void {
  const columns = columnsFor(connection, 'revision_artifacts');
  if (
    !['artifact_id', 'file_path', 'kind', 'status', 'invalidated_at', 'dominant_saturation']
      .every((column) => columns.has(column))
  ) {
    return;
  }
  const rows = connection.prepare(
    `SELECT artifact_id, file_path, dominant_hue, dominant_lightness
       FROM revision_artifacts
      WHERE kind = 'extracted_palette'
        AND status = 'ready'
        AND invalidated_at IS NULL
        AND dominant_saturation IS NULL`,
  ).all() as Array<{
    artifact_id: string;
    file_path: string;
    dominant_hue: number | null;
    dominant_lightness: number | null;
  }>;
  if (rows.length === 0) return;
  const update = connection.prepare(
    `UPDATE revision_artifacts
        SET dominant_saturation = ?, dominant_hue = ?, dominant_lightness = ?
      WHERE artifact_id = ?`,
  );
  const apply = connection.transaction(() => {
    for (const row of rows) {
      let saturation = 0;
      let hue = row.dominant_hue;
      let lightness = row.dominant_lightness;
      try {
        const parsed = JSON.parse(
          readFileSync(path.join(artifactsDir, row.file_path), 'utf8'),
        ) as Array<{ hex?: string }>;
        const hex = parsed[0]?.hex;
        if (typeof hex === 'string') {
          const metrics = dominantColorMetrics(hex);
          saturation = metrics.saturation;
          hue = metrics.hue;
          lightness = metrics.lightness;
        }
      } catch {
        saturation = 0;
      }
      update.run(saturation, hue, lightness, row.artifact_id);
    }
  });
  apply();
}

export function migrateDatabase(
  connection: DatabaseConnection,
  allowFresh: boolean,
  options?: Pick<
    LibraryServiceOptions,
    'afterSchemaMigrationTransactionBegin' | 'beforeSchemaMigrationTransaction'
  >,
): SchemaTooNewSignal | null {
  const versionBeforeMigration = schemaVersion(connection);
  if (versionBeforeMigration > SUPPORTED_SCHEMA_VERSION) {
    return { libraryVersion: versionBeforeMigration };
  }
  if (versionBeforeMigration >= 23 && versionBeforeMigration <= SUPPORTED_SCHEMA_VERSION) {
    options?.beforeSchemaMigrationTransaction?.();
    try {
      connection.transaction(() => {
        options?.afterSchemaMigrationTransactionBegin?.();
        migrateDatabaseUnserialized(connection, allowFresh);
      }).immediate();
    } catch (error) {
      // Keep the public failure distinct from damaged migration history. The
      // open path records this as a retryable migration failure; only an
      // explicit LIBRARY_CORRUPT is eligible for the database recovery ladder.
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('LIBRARY_MIGRATION_FAILED', { cause: error });
    }
    return null;
  }
  migrateDatabaseUnserialized(connection, allowFresh);
  return null;
}

export function migrateDatabaseUnserialized(connection: DatabaseConnection, allowFresh: boolean): void {
  let currentVersion = schemaVersion(connection);
  if (hasLegacyPluginMigrationHistory(connection, currentVersion)) {
    migrateLegacyPluginMigrationHistory(connection);
    verifyMigrationHistory(connection, SUPPORTED_SCHEMA_VERSION);
    // the migration mutated the schema; the lenient-read
    // column cache must be rebuilt from the new structure.
    invalidateColumnProbe(connection);
    return;
  }
  if (hasForkedSyncAutoAnalysisMigrationHistory(connection, currentVersion)) {
    migrateForkedSyncAutoAnalysisMigrationHistory(connection);
    currentVersion = schemaVersion(connection);
  }
  if (currentVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_VERSION_TOO_NEW');
  }
  if (currentVersion === 0 && !allowFresh) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  if (currentVersion > 0) verifyMigrationHistory(connection, currentVersion);

  for (const migration of MIGRATIONS.slice(currentVersion)) {
    // The v4 migration rebuilds the assets table: SQLite cannot relax a CHECK
    // constraint or replace a column UNIQUE without a table rebuild. DROP TABLE
    // with foreign_keys = ON performs an implicit DELETE of every row, which
    // would cascade through revisions.asset_id ON DELETE CASCADE and orphan
    // every asset. PRAGMA foreign_keys cannot change inside a transaction, so
    // toggle it around the v4 transaction and run foreign_key_check before
    // re-enabling. asset_ids are preserved across the rebuild, so the check
    // passes and revisions remain attached.
    //
    // The v6 migration rebuilds the smart_collections table. While no other
    // table references smart_collections via FK, the table itself has an
    // outgoing FK to library(library_id). Disabling FK prevents DROP TABLE
    // from blocking and guarantees the rebuild is clean.
    //
    // (discipline audit): the full set of in-place table
    // rebuilds — every one creates a replacement table, copies, drops the
    // old and renames. The FK guard is kept in lockstep so a future FK on
    // any rebuilt table cannot silently break the DROP phase. (v15 dropped
    // the old asset_search table without rebuilding — a historical
    // pre-discipline exception, intentionally not in this set.)
    const rebuildsTable = TABLE_REBUILD_MIGRATION_VERSIONS.has(migration.version);
    if (rebuildsTable) connection.pragma('foreign_keys = OFF');
    try {
      connection.transaction(() => {
        if (migration.version === 20) {
          // Idempotent: downgrade fixtures may already have the column.
          ensureTrashTombstoneAssetBindSchema(connection);
          backfillTrashedFromTombstoneIds(connection);
        } else if (migration.version === 31) {
          ensurePluginDerivedFieldsSchema(connection);
        } else if (migration.version === 34) {
          ensureContentFingerprintColumn(connection);
        } else if (migration.version === 38) {
          ensureSyncSchema(connection);
        } else if (migration.version === 48) {
          ensureLinkedSourceIdentitySchema(connection);
        } else if (migration.version === 49) {
          ensureLinkedFolderParentSchema(connection);
        } else if (migration.version === 54) {
          ensureAssetNormalizedExtensionSchema(connection);
        } else if (migration.version === 55) {
          ensureEntityAppearanceSchema(connection);
        } else if (migration.version === 58) {
          ensureFolderCustomCoverAssetSchema(connection);
        } else {
          connection.exec(migration.sql);
        }
        if (migration.version === 3) {
          backfillPortablePathIdentities(connection);
          connection.exec(PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL);
        }
        if (migration.version === 6) {
          backfillAssetSearchContent(connection);
          connection.exec("INSERT INTO asset_search(asset_search) VALUES('rebuild')");
        }
        if (migration.version === 18 || migration.version === 19) {
          backfillContextualSearchContent(connection);
        }
        if (rebuildsTable) {
          const foreignKeyViolations = connection.pragma('foreign_key_check');
          if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
            throw new Error(
              `Migration ${migration.version} would leave ${foreignKeyViolations.length} foreign-key violation(s).`,
            );
          }
        }
        connection
          .prepare(
            'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
          )
          .run(migration.version, migration.checksum, new Date().toISOString());
        connection.pragma(`user_version = ${migration.version}`);
      })();
    } catch (error) {
      if (rebuildsTable) {
        try {
          connection.pragma('foreign_keys = ON');
        } catch {
          // The primary migration failure remains more useful than a re-enable failure.
        }
      }
      // (0031 §2.2): a rolled-back migration failure is
      // retryable and diagnosed via .keel/migration-failed.json; the
      // open path records it. verifyMigrationHistory failures above/below
      // keep LIBRARY_CORRUPT (damaged history is never retried).
      throw new LibraryServiceError('LIBRARY_MIGRATION_FAILED', { cause: error });
    }
    if (rebuildsTable) connection.pragma('foreign_keys = ON');
  }

  verifyMigrationHistory(connection, SUPPORTED_SCHEMA_VERSION);
  // migrations may have mutated the schema; the lenient-read
  // column cache must be rebuilt from the new structure.
  invalidateColumnProbe(connection);
}

export function readLibraryIdentity(
  connection: DatabaseConnection,
  options: { skipQuickCheck?: boolean } = {},
): LibraryRow {
  if (!options.skipQuickCheck) {
    const check = connection.pragma('quick_check(1)');
    if (
      !Array.isArray(check) ||
      check.length !== 1 ||
      typeof check[0] !== 'object' ||
      check[0] === null ||
      !('quick_check' in check[0]) ||
      check[0].quick_check !== 'ok'
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  }

  const libraryRows = connection
    .prepare('SELECT library_id, display_name FROM library ORDER BY library_id LIMIT 2')
    .all() as LibraryRow[];
  const library = libraryRows[0];
  if (
    libraryRows.length !== 1 ||
    !library ||
    typeof library.library_id !== 'string' ||
    library.library_id.length === 0 ||
    typeof library.display_name !== 'string' ||
    library.display_name.length === 0
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

  return library;
}

export function verifyDatabase(
  connection: DatabaseConnection,
  options: { skipQuickCheck?: boolean } = {},
): LibraryRow {
  const version = schemaVersion(connection);
  if (version > SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_VERSION_TOO_NEW');
  }
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  verifyMigrationHistory(connection, version);
  // quick_check scans every B-tree (~270ms on a 60MB/20k
  // library) and dominated the synchronous open. The open hot path defers it
  // to the background reconciliation; create/recovery paths keep the full
  // check because their inputs are untrusted by construction.
  return readLibraryIdentity(connection, options);
}

/** PRAGMA quick_check gate shared by the deferred verification path. */
/**
 * Open a library that we cannot (or should not) migrate right now, but that
 * is still physically usable. Newer-than-supported schemas keep the canonical
 * prefix and extra additive rows; a stuck migration keeps the last rolled-back
 * version. Both stay writable — Keel does not offer a read-only library.
 */
export function verifyOpenableSchema(connection: DatabaseConnection): LibraryRow {
  const version = schemaVersion(connection);
  if (version <= 0) throw new LibraryServiceError('LIBRARY_CORRUPT');
  if (version > SUPPORTED_SCHEMA_VERSION) {
    try {
      if (!hasCanonicalMigrationHistoryThrough(connection, SUPPORTED_SCHEMA_VERSION)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
  } else {
    verifyMigrationHistory(connection, version);
  }
  return readLibraryIdentity(connection);
}

export function closeIgnoringFailure(connection: DatabaseConnection | undefined): void {
  try {
    connection?.close();
  } catch {
    // The primary error remains more useful than a secondary close failure.
  }
}
