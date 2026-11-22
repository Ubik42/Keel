import { type LinkedFolderRule } from "../../shared/asset-types";
import { deriveSyncCardStatus, isLocalSyncPending } from "../../shared/sync-card-status";
import { LibraryServiceError, buildFileName, buildFolderPath, buildMetadataText, buildSearchDescription, embeddedMetadataFromSearchText, gitignorePath, isMissingPathError, readGitignoreText, realDirectoryExists, serviceError, sha256FileAtPath, type DatabaseConnection, type LibraryService, type OpenLibrary } from "../library-service";
import { gitignoreMatchesPath, parseGitignore } from "../library/gitignore";
import { hasTable } from "../library/lenient-columns";
import { portablePathIdentity } from "../library/library-rules";
import { normalizeSearchText } from "../library/search-query";
import { sqliteAllInChunks } from "../library/sqlite-in";
import { parseManifest } from "./sync/manifest";
import { emptySyncAssetMetadata, hasSyncAiLayer, metadataContentHash, type SyncAssetMetadata } from "./sync/sync-metadata";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface SyncMethods {
  withSyncReplay<T>(fn: () => T): T;
  syncGitignore(...args: Parameters<typeof syncGitignore>): ReturnType<typeof syncGitignore>;
  syncLinkedGitignoreHiddenAssets(...args: Parameters<typeof syncLinkedGitignoreHiddenAssets>): ReturnType<typeof syncLinkedGitignoreHiddenAssets>;
  syncAssetSearchContent(...args: Parameters<typeof syncAssetSearchContent>): ReturnType<typeof syncAssetSearchContent>;
  ensureAssetSyncId(...args: Parameters<typeof ensureAssetSyncId>): ReturnType<typeof ensureAssetSyncId>;
  readAssetSyncId(...args: Parameters<typeof readAssetSyncId>): ReturnType<typeof readAssetSyncId>;
  assetRowBySyncId(...args: Parameters<typeof assetRowBySyncId>): ReturnType<typeof assetRowBySyncId>;
  syncSnapshot(...args: Parameters<typeof syncSnapshot>): ReturnType<typeof syncSnapshot>;
  importManagedFileForSync(...args: Parameters<typeof importManagedFileForSync>): ReturnType<typeof importManagedFileForSync>;
  bindSyncIdAndRelocate(...args: Parameters<typeof bindSyncIdAndRelocate>): ReturnType<typeof bindSyncIdAndRelocate>;
  applySyncContentUpdate(...args: Parameters<typeof applySyncContentUpdate>): ReturnType<typeof applySyncContentUpdate>;
  applySyncRelocate(...args: Parameters<typeof applySyncRelocate>): ReturnType<typeof applySyncRelocate>;
  pruneEmptyManagedFoldersAfterSyncRelocate(...args: Parameters<typeof pruneEmptyManagedFoldersAfterSyncRelocate>): ReturnType<typeof pruneEmptyManagedFoldersAfterSyncRelocate>;
  applySyncRecycle(...args: Parameters<typeof applySyncRecycle>): ReturnType<typeof applySyncRecycle>;
  applySyncConflictCopy(...args: Parameters<typeof applySyncConflictCopy>): ReturnType<typeof applySyncConflictCopy>;
  readSyncAssetMetadata(...args: Parameters<typeof readSyncAssetMetadata>): ReturnType<typeof readSyncAssetMetadata>;
  applySyncAssetMetadata(...args: Parameters<typeof applySyncAssetMetadata>): ReturnType<typeof applySyncAssetMetadata>;
  readSyncAssetMetadataMap(...args: Parameters<typeof readSyncAssetMetadataMap>): ReturnType<typeof readSyncAssetMetadataMap>;
  attachSyncAiLayer(...args: Parameters<typeof attachSyncAiLayer>): ReturnType<typeof attachSyncAiLayer>;
  readSyncAssetContent(...args: Parameters<typeof readSyncAssetContent>): ReturnType<typeof readSyncAssetContent>;
  readSyncManifestCache(...args: Parameters<typeof readSyncManifestCache>): ReturnType<typeof readSyncManifestCache>;
  beginSyncSession(...args: Parameters<typeof beginSyncSession>): ReturnType<typeof beginSyncSession>;
  finishSyncSession(...args: Parameters<typeof finishSyncSession>): ReturnType<typeof finishSyncSession>;
  listSyncCardStatuses(...args: Parameters<typeof listSyncCardStatuses>): ReturnType<typeof listSyncCardStatuses>;
  writeSyncManifestCache(...args: Parameters<typeof writeSyncManifestCache>): ReturnType<typeof writeSyncManifestCache>;
  syncTrashedFolderTombstones(...args: Parameters<typeof syncTrashedFolderTombstones>): ReturnType<typeof syncTrashedFolderTombstones>;
}

export function withSyncReplay<T>(this: LibraryService, fn: () => T): T {
  this.syncReplayDepth += 1;
  try {
    return fn();
  } finally {
    this.syncReplayDepth -= 1;
  }
}

export function syncGitignore(this: LibraryService, openLibrary: OpenLibrary, text = readGitignoreText(openLibrary.summary.libraryPath)): void {
  if (openLibrary.readOnly || (text === openLibrary.gitignoreText && openLibrary.gitignoreMaterialized)) return;
  // Libraries created before ignore actions became file-backed may still
  // have managed rows in explicit_ignored_paths.  Convert those rows before
  // clearing the legacy mirror so opening an old library never silently
  // reveals assets the user had hidden.
  const migratedText = !openLibrary.gitignoreMaterialized
    ? this.migrateLegacyManagedIgnoreRules(openLibrary, text)
    : text;
  if (migratedText !== text) {
    try {
      writeFileSync(gitignorePath(openLibrary.summary.libraryPath), migratedText, 'utf8');
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    this.noteClientFilesystemMutation();
  }
  const rules = parseGitignore(migratedText, openLibrary.summary.storageLayout === 'root' ? '' : 'Assets');
  // Keep discovery and the materialized table on the same rule snapshot.
  // Discovery can see a file before it has a database row, so it must not
  // rely on gitignore_ignored_paths alone.
  openLibrary.gitignoreMatcher = rules;
  // Serpent-verg review fix: libraries predating the ignore-rule tables
  // have no gitignore state to sync.
  if (
    !hasTable(openLibrary.connection, 'explicit_ignored_paths') ||
    !hasTable(openLibrary.connection, 'gitignore_ignored_paths')
  ) {
    return;
  }
  // An empty materialization still opens a write transaction. That
  // invalidates a network metadata snapshot and bumps browse_change_sequence
  // even when no ignore row changes, so skip it when there is nothing to write.
  if (!this.gitignoreMaterializationHasWork(openLibrary, rules)) {
    openLibrary.gitignoreText = migratedText;
    openLibrary.gitignoreMaterialized = true;
    return;
  }
  const transaction = openLibrary.connection.transaction(() => {
    // Managed ignore state is file-backed. Older versions also mirrored
    // managed rules into explicit_ignored_paths; clear those stale rows
    // before materializing the current .keelignore contents so removing
    // a rule immediately restores the affected assets.
    openLibrary.connection
      .prepare("DELETE FROM explicit_ignored_paths WHERE location_kind = 'managed'")
      .run();
    openLibrary.connection.prepare('DELETE FROM gitignore_ignored_paths').run();
    const insert = openLibrary.connection.prepare(
      'INSERT OR IGNORE INTO gitignore_ignored_paths(relative_path, path_kind) VALUES (?, ?)',
    );
    const folders = openLibrary.connection
      .prepare('SELECT relative_path FROM managed_folders')
      .all() as Array<{ relative_path: string }>;
    const assets = openLibrary.connection
      .prepare("SELECT relative_file_path FROM assets WHERE location_kind = 'managed' AND deleted_at IS NULL")
      .all() as Array<{ relative_file_path: string }>;
    for (const folder of folders) {
      if (gitignoreMatchesPath(rules, folder.relative_path, 'folder')) {
        insert.run(folder.relative_path, 'folder');
      }
    }
    for (const asset of assets) {
      if (gitignoreMatchesPath(rules, asset.relative_file_path, 'asset')) {
        insert.run(asset.relative_file_path, 'asset');
      }
    }
    this.syncLinkedGitignoreHiddenAssets(openLibrary);
  });
  transaction();
  openLibrary.gitignoreText = migratedText;
  openLibrary.gitignoreMaterialized = true;
  // Empty linked directories (for example `1Test/.111`) have no managed_folders
  // row and no asset to write into linked_ignored_assets. Without this, the
  // navigation summary cache keeps showing those folders after `.*/` or a
  // right-click ignore (Serpent-c6d907).
  this.invalidateNavigationSummary(openLibrary);
  this.rebindCurrentNetworkMetadataCache(openLibrary);
}

/**
* Serpent-c6d907: `.keelignore` is the single ignore file. Linked assets
* that match it are folded into `linked_ignored_assets` so browse/search SQL
* hides them the same way linked-folder default rules already do. Default
* `.git` / `node_modules` rules stay in `linked_folder_rules` and still win
* here; removing a gitignore rule must not un-hide those.
*/
export function syncLinkedGitignoreHiddenAssets(this: LibraryService, openLibrary: OpenLibrary): void {
  if (
    !hasTable(openLibrary.connection, 'linked_ignored_assets') ||
    !hasTable(openLibrary.connection, 'linked_folders')
  ) {
    return;
  }
  const now = new Date().toISOString();
  const hide = openLibrary.connection.prepare(
    'INSERT OR REPLACE INTO linked_ignored_assets(asset_id, ignored_at) VALUES (?, ?)',
  );
  const reveal = openLibrary.connection.prepare(
    'DELETE FROM linked_ignored_assets WHERE asset_id = ?',
  );
  const folders = openLibrary.connection
    .prepare('SELECT folder_id FROM linked_folders WHERE library_id = ?')
    .all(openLibrary.summary.libraryId) as Array<{ folder_id: string }>;
  const hasLinkedRules = hasTable(openLibrary.connection, 'linked_folder_rules');
  const loadRules = hasLinkedRules
    ? openLibrary.connection.prepare(
      `SELECT rule_id, action, target, pattern, enabled
         FROM linked_folder_rules WHERE folder_id = ? ORDER BY position`,
    )
    : null;
  for (const folder of folders) {
    const rules = loadRules
      ? (loadRules.all(folder.folder_id) as Array<{
        rule_id: string;
        action: 'include' | 'exclude';
        target: LinkedFolderRule['target'];
        pattern: string;
        enabled: number;
      }>).map((row) => ({
        ruleId: row.rule_id,
        action: row.action,
        target: row.target,
        pattern: row.pattern,
        enabled: row.enabled === 1,
      }))
      : [];
    const assets = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.relative_file_path,
              EXISTS(SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AS ignored
         FROM assets a
        WHERE a.linked_folder_id = ? AND a.location_kind = 'linked' AND a.deleted_at IS NULL`,
    ).all(folder.folder_id) as Array<{
      asset_id: string;
      relative_file_path: string;
      ignored: number;
    }>;
    for (const asset of assets) {
      const ignored = this.linkedPathIsIgnored(asset.relative_file_path, rules)
        || this.isExplicitlyIgnored(
          openLibrary,
          'linked',
          folder.folder_id,
          asset.relative_file_path,
          'asset',
        );
      if (ignored && asset.ignored === 0) hide.run(asset.asset_id, now);
      else if (!ignored && asset.ignored === 1) reveal.run(asset.asset_id);
    }
  }
}

// ── FTS5 Search Content Sync ───────────────────────────────────────

export function syncAssetSearchContent(this: LibraryService, connection: DatabaseConnection, assetId: string, embeddedMetadataText?: string, embeddedMetadataRevisionId?: string): void {
  const asset = connection
    .prepare(
      `SELECT a.relative_file_path, a.availability, a.current_revision_id, r.byte_size,
              m.description,
              (SELECT GROUP_CONCAT(value, '\n')
                 FROM ai_content
                WHERE asset_id = a.asset_id
                  AND field_name = 'description') AS ai_description,
              m.source_page_url, m.author
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        WHERE a.asset_id = ?`,
    )
    .get(assetId) as {
      relative_file_path: string;
      availability: string;
      current_revision_id: string | null;
      byte_size: number;
      description: string | null;
      ai_description: string | null;
      source_page_url: string | null;
      author: string | null;
    } | undefined;
  if (!asset) return;

  const existingSearchRow = connection
    .prepare('SELECT metadata_text FROM asset_search_index WHERE asset_id = ?')
    .get(assetId) as { metadata_text: string | null } | undefined;
  const effectiveRevisionId = embeddedMetadataRevisionId ?? asset.current_revision_id;
  const retainedEmbeddedMetadata = embeddedMetadataText === undefined
    ? embeddedMetadataFromSearchText(existingSearchRow?.metadata_text, asset.current_revision_id)
    : embeddedMetadataText;

  const tagRow = connection
    .prepare(
      `SELECT GROUP_CONCAT(all_tags.tag_name, ' ') AS tags
         FROM (
           SELECT t.name AS tag_name
             FROM human_asset_tags hat
             JOIN tags t ON t.tag_id = hat.tag_id
            WHERE hat.asset_id = ?
            UNION
           SELECT t.name AS tag_name
             FROM ai_asset_tags aat
             JOIN tags t ON t.tag_id = aat.tag_id
            WHERE aat.asset_id = ?
         ) AS all_tags`,
    )
    .get(assetId, assetId) as { tags: string | null } | undefined;

  connection
    .prepare(
      `INSERT INTO asset_search_index
         (asset_id, filename, tags, description, source_url, author, folder_path, metadata_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         filename = excluded.filename,
         tags = excluded.tags,
         description = excluded.description,
         source_url = excluded.source_url,
         author = excluded.author,
         folder_path = excluded.folder_path,
         metadata_text = excluded.metadata_text`,
    )
    .run(
      assetId,
      normalizeSearchText(buildFileName(asset.relative_file_path)),
      normalizeSearchText(tagRow?.tags ?? ''),
      normalizeSearchText(buildSearchDescription(asset.description, asset.ai_description)),
      normalizeSearchText(asset.source_page_url ?? ''),
      normalizeSearchText(asset.author ?? ''),
      normalizeSearchText(buildFolderPath(asset.relative_file_path)),
      normalizeSearchText(
        buildMetadataText({
        availability: asset.availability,
        byteSize: asset.byte_size,
        relativeFilePath: asset.relative_file_path,
        revisionId: effectiveRevisionId,
        embeddedMetadataText: retainedEmbeddedMetadata,
      }),
      ),
    );
}

// ── 资源库同步（Serpent-xffq）────────────────────────────────────────

/** 读取/生成资产的跨设备稳定身份（sync_id）。 */
export function ensureAssetSyncId(this: LibraryService, openLibrary: OpenLibrary, assetId: string): string {
  const row = openLibrary.connection
    .prepare('SELECT sync_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { sync_id: string | null } | undefined;
  if (row?.sync_id) return row.sync_id;
  const syncId = randomUUID();
  openLibrary.connection
    .prepare('UPDATE assets SET sync_id = ? WHERE asset_id = ?')
    .run(syncId, assetId);
  return syncId;
}

export function readAssetSyncId(this: LibraryService, openLibrary: OpenLibrary, assetId: string): string | null {
  const row = openLibrary.connection
    .prepare('SELECT sync_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { sync_id: string | null } | undefined;
  return row?.sync_id ?? null;
}

export function assetRowBySyncId(this: LibraryService, openLibrary: OpenLibrary, syncId: string) {
  return openLibrary.connection
    .prepare(
      `SELECT asset_id, relative_file_path, location_kind, linked_folder_id, current_revision_id
         FROM assets
        WHERE sync_id = ? AND deleted_at IS NULL`,
    )
    .get(syncId) as
    | {
        asset_id: string;
        relative_file_path: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        current_revision_id: string | null;
      }
    | undefined;
}

/**
* 计算当前库的同步快照：每个可用资产的 syncId、内容哈希与路径。
* 磁盘文件缺失但库内行仍在的 syncId 单独列出，供规划器从远端拉回，
* 而不是当成用户删除去写墓碑。
* 大库全量哈希耗时由调用方在后台执行；快照是 planSyncActions 的本地输入。
*/
export function syncSnapshot(this: LibraryService, libraryId: string): {
    library: { libraryId: string; displayName: string };
    assets: Array<{
      syncId: string;
      assetId: string;
      relativePath: string;
      contentHash: string;
      size: number;
      modifiedAt: string;
      metadata?: SyncAssetMetadata;
    }>;
    missingAssets: Array<{ syncId: string; relativePath: string }>;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const assets = this.listAssets({ libraryId, recursive: true }).filter(
    (asset) => asset.deletedAt === null,
  );
  const out: Array<{
    syncId: string;
    assetId: string;
    relativePath: string;
    contentHash: string;
    size: number;
    modifiedAt: string;
    metadata?: SyncAssetMetadata;
  }> = [];
  const missingAssets: Array<{ syncId: string; relativePath: string }> = [];
  for (const asset of assets) {
    let absolutePath: string | undefined;
    try {
      absolutePath = this.resolveAssetPath(libraryId, asset.assetId);
    } catch {
      const syncId = this.readAssetSyncId(openLibrary, asset.assetId);
      if (syncId) missingAssets.push({ syncId, relativePath: asset.relativeFilePath });
      continue;
    }
    if (asset.availability !== 'available' || !existsSync(absolutePath)) {
      const syncId = this.readAssetSyncId(openLibrary, asset.assetId);
      if (syncId) missingAssets.push({ syncId, relativePath: asset.relativeFilePath });
      continue;
    }
    out.push({
      syncId: this.ensureAssetSyncId(openLibrary, asset.assetId),
      assetId: asset.assetId,
      relativePath: asset.relativeFilePath,
      contentHash: sha256FileAtPath(absolutePath),
      size: asset.byteSize,
      modifiedAt: asset.modifiedAt,
    });
  }
  const metadataByAssetId = this.readSyncAssetMetadataMap(openLibrary, out.map((asset) => asset.assetId));
  for (const asset of out) {
    asset.metadata = metadataByAssetId.get(asset.assetId) ?? emptySyncAssetMetadata();
  }
  return {
    library: { libraryId, displayName: this.libraryDisplayName(libraryId) },
    assets: out,
    missingAssets,
  };
}

/**
* 把同步下载的字节导入为托管资产，并落在交换格式给出的相对路径上。
* 只按 basename 丢进根目录会让后接入设备看到扁平 assets/（真实 WebDAV 验收已复现）。
*/
export function importManagedFileForSync(this: LibraryService, openLibrary: OpenLibrary, libraryId: string, relativePath: string, body: Buffer): string {
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (
    normalized.length === 0
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
  }
  const destDir = path.posix.dirname(normalized);
  const basename = path.posix.basename(normalized);
  const targetFolderId = destDir === '.'
    ? undefined
    : this.ensureManagedFolderIdForRelativeDir(openLibrary, libraryId, destDir);
  const existingIds = new Set(
    (
      openLibrary.connection
        .prepare('SELECT asset_id FROM assets WHERE deleted_at IS NULL')
        .all() as Array<{ asset_id: string }>
    ).map((row) => row.asset_id),
  );
  const stageDir = mkdtempSync(path.join(tmpdir(), 'keel-sync-import-'));
  const stagePath = path.join(stageDir, basename);
  try {
    writeFileSync(stagePath, body);
    const prepared = this.prepareOrExecuteImport({
      libraryId,
      sourceKind: 'files',
      sourcePaths: [stagePath],
      ...(targetFolderId === undefined ? {} : { targetFolderId }),
    });
    this.finishImportWithoutUserDecision(prepared, {
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  } finally {
    rmSync(stageDir, { force: true, recursive: true });
  }
  const created = (
    openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path
           FROM assets
          WHERE deleted_at IS NULL`,
      )
      .all() as Array<{ asset_id: string; relative_file_path: string }>
  ).filter((row) => !existingIds.has(row.asset_id));
  const matched = created.find((row) =>
    portablePathIdentity(row.relative_file_path) === portablePathIdentity(normalized)
  ) ?? created.at(-1);
  if (!matched) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
  }
  return matched.asset_id;
}

export function bindSyncIdAndRelocate(this: LibraryService, libraryId: string, assetId: string, syncId: string, relativePath: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  openLibrary.connection
    .prepare('UPDATE assets SET sync_id = ? WHERE asset_id = ?')
    .run(syncId, assetId);
  const current = openLibrary.connection
    .prepare('SELECT relative_file_path FROM assets WHERE asset_id = ?')
    .get(assetId) as { relative_file_path: string } | undefined;
  if (
    current
    && portablePathIdentity(current.relative_file_path) !== portablePathIdentity(relativePath)
  ) {
    this.applySyncRelocate(libraryId, syncId, relativePath);
  }
}

/**
* 应用远端下载内容：本地无该 syncId 资产时导入为新资产并绑定 syncId；
* 已存在时覆盖文件并创建新 revision（external_change 管线，缩略图重建）。
* 返回本地 assetId。
*/
export function applySyncContentUpdate(this: LibraryService, libraryId: string, syncId: string, relativePath: string, body: Buffer): { assetId: string; created: boolean } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  this.assertLibraryWritable(openLibrary);
  const existing = this.assetRowBySyncId(openLibrary, syncId);
  if (!existing) {
    return this.withSyncReplay(() => {
      const assetId = this.importManagedFileForSync(openLibrary, libraryId, relativePath, body);
      this.bindSyncIdAndRelocate(libraryId, assetId, syncId, relativePath);
      return { assetId, created: true };
    });
  }

  // 已存在：覆盖文件 + 新 revision。
  return this.withSyncReplay(() => {
    const absolutePath = existing.location_kind === 'linked'
      ? this.linkedAssetPath(openLibrary, existing.linked_folder_id, existing.relative_file_path)
      : this.folderPath(openLibrary, existing.relative_file_path);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, body);
    const stat = statSync(absolutePath);
    const now = new Date().toISOString();
    const fingerprint = sha256FileAtPath(absolutePath);
    const revisionId = randomUUID();
    openLibrary.connection
      .prepare(
        `INSERT INTO revisions
           (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
            original_filename, origin, accepted_at, content_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?, ?)`,
      )
      .run(
        revisionId,
        existing.asset_id,
        existing.current_revision_id,
        stat.size,
        stat.mtime.toISOString(),
        path.posix.basename(existing.relative_file_path),
        now,
        fingerprint,
      );
    openLibrary.connection
      .prepare(
        `UPDATE assets
            SET current_revision_id = ?, availability = 'available', updated_at = ?
          WHERE asset_id = ?`,
      )
      .run(revisionId, now, existing.asset_id);
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ? AND invalidated_at IS NULL`,
      )
      .run(now, existing.current_revision_id);
    if (
      this.thumbnailEligible(libraryId, existing.relative_file_path)
      && !this.isExplicitlyIgnored(
        openLibrary,
        existing.location_kind,
        existing.linked_folder_id,
        existing.relative_file_path,
        'asset',
      )
    ) {
      openLibrary.connection
        .prepare(
          `INSERT OR IGNORE INTO jobs
             (job_id, library_id, asset_id, revision_id, kind, status, priority,
              progress, attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 300, 0.0, 0, ?, ?)`,
        )
        .run(randomUUID(), libraryId, existing.asset_id, revisionId, now, now);
    }
    this.syncAssetSearchContent(openLibrary.connection, existing.asset_id);
    this.emitClientAssetsChanged(libraryId, 1, true);
    return { assetId: existing.asset_id, created: false };
  });
}

/**
* 远端单侧改路径：按交换格式相对路径搬动托管资产（建缺失文件夹后走既有 managed-move）。
* 链接资产保持外部目录布局，此处为 no-op。
*/
export function applySyncRelocate(this: LibraryService, libraryId: string, syncId: string, relativePath: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  this.assertLibraryWritable(openLibrary);
  const existing = openLibrary.connection
    .prepare(
      `SELECT asset_id, relative_file_path, location_kind, managed_folder_id, availability
         FROM assets
        WHERE sync_id = ? AND deleted_at IS NULL`,
    )
    .get(syncId) as
    | {
        asset_id: string;
        relative_file_path: string;
        location_kind: 'managed' | 'linked';
        managed_folder_id: string | null;
        availability: 'available' | 'missing';
      }
    | undefined;
  if (!existing) return;
  if (existing.location_kind !== 'managed') return;
  if (existing.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (portablePathIdentity(existing.relative_file_path) === portablePathIdentity(relativePath)) return;
  this.withSyncReplay(() => {
    const destDir = path.posix.dirname(relativePath);
    const destinationFolderId = destDir === '.' ? null : this.ensureManagedFolderIdForRelativeDir(
      openLibrary,
      libraryId,
      destDir,
    );
    const operationId = randomUUID();
    if (this.managedMoveConflict(openLibrary, operationId, '0', relativePath, existing.asset_id)) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    this.applyManagedMoveOperation(openLibrary, operationId, {
      files: [{
        assetId: existing.asset_id,
        destinationConflict: null,
        destinationFolderId,
        destinationRelativePath: relativePath,
        restoreConflict: null,
        sourceFolderId: existing.managed_folder_id,
        sourceRelativePath: existing.relative_file_path,
      }],
      kind: 'managed-move',
      originalOperationId: null,
      version: 4,
    });
    this.pruneEmptyManagedFoldersAfterSyncRelocate(openLibrary, existing.managed_folder_id);
    this.noteClientFilesystemMutation();
    this.emitClientAssetsChanged(libraryId, 1, true);
  });
}

/**
* Sync replay only moves files (the exchange format is a file layout). After a
* relocate the source directory can remain as an empty managed_folders row on
* the receiving device. Walk the source folder and empty ancestors and remove
* them: no child folders, no managed assets, and rmdir of an empty disk dir.
* Folders that still have contents are left in place. Missing disk dirs still
* drop the index row so the sidebar cannot keep a phantom empty folder.
*/
export function pruneEmptyManagedFoldersAfterSyncRelocate(this: LibraryService, openLibrary: OpenLibrary, folderId: string | null): void {
  const childCount = openLibrary.connection.prepare(
    'SELECT COUNT(*) AS count FROM managed_folders WHERE parent_folder_id = ?',
  );
  const assetCount = openLibrary.connection.prepare(
    `SELECT COUNT(*) AS count FROM assets
       WHERE managed_folder_id = ? AND location_kind = 'managed'`,
  );
  const loadFolder = openLibrary.connection.prepare(
    'SELECT folder_id, parent_folder_id, relative_path FROM managed_folders WHERE folder_id = ?',
  );
  const remove = openLibrary.connection.prepare(
    'DELETE FROM managed_folders WHERE folder_id = ?',
  );

  let currentId: string | null = folderId;
  while (currentId) {
    const row = loadFolder.get(currentId) as
      | { folder_id: string; parent_folder_id: string | null; relative_path: string }
      | undefined;
    if (!row) break;
    const children = childCount.get(row.folder_id) as { count: number };
    const assets = assetCount.get(row.folder_id) as { count: number };
    if (children.count !== 0 || assets.count !== 0) break;

    const directoryPath = this.folderPath(openLibrary, row.relative_path);
    if (realDirectoryExists(directoryPath)) {
      try {
        rmdirSync(directoryPath);
      } catch (error) {
        if (!isMissingPathError(error)) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
          if (code === 'ENOTEMPTY' || code === 'EEXIST') break;
          throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
        }
      }
    }

    const parentId = row.parent_folder_id;
    if (remove.run(row.folder_id).changes !== 1) break;
    currentId = parentId;
  }
}

/** 远端墓碑传播：本地资产进回收站（已回收资产为幂等 no-op）。 */
export function applySyncRecycle(this: LibraryService, libraryId: string, syncId: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = this.assetRowBySyncId(openLibrary, syncId);
  if (!row) return;
  this.withSyncReplay(() => {
    this.trashAssets({ libraryId, assetIds: [row.asset_id] });
  });
}

/**
* 冲突败者副本落本地库：导入为独立资产（新 syncId，随后登记进 manifest，
* 双端一致后不再产生动作）。返回新 syncId 与内容指纹。
*/
export function applySyncConflictCopy(this: LibraryService, libraryId: string, relativePath: string, body: Buffer, conflictName: string): { syncId: string; contentHash: string; size: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  this.assertLibraryWritable(openLibrary);
  return this.withSyncReplay(() => {
    const assetId = this.importManagedFileForSync(openLibrary, libraryId, conflictName, body);
    const syncId = randomUUID();
    this.bindSyncIdAndRelocate(libraryId, assetId, syncId, conflictName);
    return {
      syncId,
      contentHash: sha256FileAtPath(this.resolveAssetPath(libraryId, assetId)),
      size: body.length,
    };
  });
}

export function readSyncAssetMetadata(this: LibraryService, libraryId: string, syncId: string): SyncAssetMetadata {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = this.assetRowBySyncId(openLibrary, syncId);
  if (!row) return emptySyncAssetMetadata();
  return this.readSyncAssetMetadataMap(openLibrary, [row.asset_id]).get(row.asset_id)
    ?? emptySyncAssetMetadata();
}

export function applySyncAssetMetadata(this: LibraryService, libraryId: string, syncId: string, metadata: SyncAssetMetadata): void {
  this.withSyncReplay(() => {
    const openLibrary = this.requireOpenLibrary(libraryId);
    this.assertLibraryWritable(openLibrary);
    const row = this.assetRowBySyncId(openLibrary, syncId);
    if (!row) return;
    const current = this.getAssetMetadata({ libraryId, assetId: row.asset_id });
    const currentHuman = current.tags.filter((tag) => tag.source === 'user');
    const desired = new Set(metadata.tags.map((tag) => tag.trim()).filter(Boolean));
    const toRemove = currentHuman.filter((tag) => !desired.has(tag.name));
    if (toRemove.length > 0) {
      this.removeTags({
        libraryId,
        assetIds: [row.asset_id],
        tagIds: toRemove.map((tag) => tag.id),
      });
    }
    for (const name of desired) {
      if (currentHuman.some((tag) => tag.name === name)) continue;
      const tag = this.findOrCreateTagByName(openLibrary, name);
      this.assignTags({ libraryId, assetIds: [row.asset_id], tagIds: [tag.tagId] });
    }
    this.setAssetMetadata({
      libraryId,
      assetId: row.asset_id,
      expectedVersion: current.entityVersion,
      description: metadata.description ?? '',
      rating: metadata.rating,
      favorite: metadata.favorite,
    });
    if (metadata.ai) {
      this.writeAiAnalysisResult({
        libraryId,
        assetId: row.asset_id,
        description: metadata.ai.description ?? undefined,
        tags: metadata.ai.tags,
        rating: metadata.ai.rating,
        modelId: metadata.ai.modelId || 'sync',
        modelVersion: metadata.ai.modelVersion || '1',
        enabledFields: { description: true, tags: true, rating: true },
      });
    }
  });
}

export function readSyncAssetMetadataMap(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): Map<string, SyncAssetMetadata> {
  const map = new Map<string, SyncAssetMetadata>();
  if (assetIds.length === 0) return map;
  for (const assetId of assetIds) {
    map.set(assetId, emptySyncAssetMetadata());
  }
  if (hasTable(openLibrary.connection, 'tags') && hasTable(openLibrary.connection, 'human_asset_tags')) {
    const tagRows = sqliteAllInChunks<string, { asset_id: string; name: string }>({
      connection: openLibrary.connection,
      values: assetIds,
      buildSql: (placeholders) =>
        `SELECT hat.asset_id, t.name
           FROM human_asset_tags hat
           JOIN tags t ON t.tag_id = hat.tag_id
          WHERE hat.asset_id IN (${placeholders})`,
    });
    for (const row of tagRows) {
      const current = map.get(row.asset_id) ?? emptySyncAssetMetadata();
      if (!current.tags.includes(row.name)) current.tags.push(row.name);
      map.set(row.asset_id, current);
    }
  }
  if (hasTable(openLibrary.connection, 'asset_metadata')) {
    const metaRows = sqliteAllInChunks<string, {
      asset_id: string;
      description: string | null;
      rating: number;
      favorite: number;
    }>({
      connection: openLibrary.connection,
      values: assetIds,
      buildSql: (placeholders) =>
        `SELECT asset_id, description, rating, favorite
           FROM asset_metadata
          WHERE asset_id IN (${placeholders})`,
    });
    for (const row of metaRows) {
      const current = map.get(row.asset_id) ?? emptySyncAssetMetadata();
      current.description = row.description?.trim() ? row.description.trim() : null;
      current.rating = row.rating;
      current.favorite = row.favorite !== 0;
      map.set(row.asset_id, current);
    }
  }
  this.attachSyncAiLayer(openLibrary, assetIds, map);
  return map;
}

export function attachSyncAiLayer(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[], map: Map<string, SyncAssetMetadata>): void {
  if (assetIds.length === 0) return;
  const aiTagsByAsset = new Map<string, string[]>();
  const modelByAsset = new Map<string, { modelId: string; modelVersion: string }>();
  if (hasTable(openLibrary.connection, 'tags') && hasTable(openLibrary.connection, 'ai_asset_tags')) {
    const aiTagRows = sqliteAllInChunks<string, {
      asset_id: string;
      name: string;
      model_id: string;
      model_version: string;
    }>({
      connection: openLibrary.connection,
      values: assetIds,
      buildSql: (placeholders) =>
        `SELECT aat.asset_id, t.name, aat.model_id, aat.model_version
           FROM ai_asset_tags aat
           JOIN tags t ON t.tag_id = aat.tag_id
          WHERE aat.asset_id IN (${placeholders})`,
    });
    for (const row of aiTagRows) {
      const tags = aiTagsByAsset.get(row.asset_id) ?? [];
      if (!tags.includes(row.name)) tags.push(row.name);
      aiTagsByAsset.set(row.asset_id, tags);
      if (!modelByAsset.has(row.asset_id)) {
        modelByAsset.set(row.asset_id, { modelId: row.model_id, modelVersion: row.model_version });
      }
    }
  }
  const descriptionByAsset = new Map<string, { value: string; generatedAt: string }>();
  const ratingByAsset = new Map<string, { value: number; generatedAt: string }>();
  if (hasTable(openLibrary.connection, 'ai_content')) {
    const contentRows = sqliteAllInChunks<string, {
      asset_id: string;
      field_name: string;
      value: string;
      model_id: string;
      model_version: string;
      generated_at: string;
    }>({
      connection: openLibrary.connection,
      values: assetIds,
      buildSql: (placeholders) =>
        `SELECT asset_id, field_name, value, model_id, model_version, generated_at
           FROM ai_content
          WHERE asset_id IN (${placeholders})
            AND field_name IN ('description', 'rating')`,
    });
    for (const row of contentRows) {
      const generatedAt = row.generated_at ?? '';
      if (row.field_name === 'description') {
        const current = descriptionByAsset.get(row.asset_id);
        if (!current || generatedAt >= current.generatedAt) {
          const trimmed = row.value.trim();
          if (trimmed) descriptionByAsset.set(row.asset_id, { value: trimmed, generatedAt });
        }
      }
      if (row.field_name === 'rating') {
        const score = Number.parseInt(row.value.trim(), 10);
        if (Number.isInteger(score) && score >= 1 && score <= 5) {
          const current = ratingByAsset.get(row.asset_id);
          if (!current || generatedAt >= current.generatedAt) {
            ratingByAsset.set(row.asset_id, { value: score, generatedAt });
          }
        }
      }
      if (row.model_id && !modelByAsset.has(row.asset_id)) {
        modelByAsset.set(row.asset_id, { modelId: row.model_id, modelVersion: row.model_version });
      }
    }
  }
  for (const assetId of assetIds) {
    const ai = {
      tags: [...(aiTagsByAsset.get(assetId) ?? [])].sort((left, right) => left.localeCompare(right)),
      description: descriptionByAsset.get(assetId)?.value ?? null,
      rating: ratingByAsset.get(assetId)?.value ?? null,
      modelId: modelByAsset.get(assetId)?.modelId ?? 'sync',
      modelVersion: modelByAsset.get(assetId)?.modelVersion ?? '1',
    };
    if (!hasSyncAiLayer(ai)) continue;
    const current = map.get(assetId) ?? emptySyncAssetMetadata();
    current.ai = ai;
    map.set(assetId, current);
  }
}

/** 按 syncId 读取本地资产内容（同步上传用）。 */
export function readSyncAssetContent(this: LibraryService, libraryId: string, syncId: string): Buffer | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = this.assetRowBySyncId(openLibrary, syncId);
  if (!row) return null;
  return readFileSync(this.resolveAssetPath(libraryId, row.asset_id));
}

/** 读取本地 manifest 缓存。 */
export function readSyncManifestCache(this: LibraryService, libraryId: string): string | null {    const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare('SELECT manifest_json FROM sync_manifest_cache WHERE library_id = ?')
    .get(libraryId) as { manifest_json: string } | undefined;
  return row?.manifest_json ?? null;
}

/** Serpent-xffq：开始一次同步会话（sync_sessions 记录，供 UI 查询状态）。 */
export function beginSyncSession(this: LibraryService, libraryId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // 内存级互斥：自动同步（Main 调度器）与手动同步不能同时在跑。
  // 内存锁随进程消亡自动释放，崩溃残留不会误锁。
  if (this.activeSyncSessions.has(libraryId)) {
    throw new LibraryServiceError('SYNC_IN_PROGRESS', {
      reason: 'FILE_BUSY',
    });
  }
  const sessionId = randomUUID();
  this.activeSyncSessions.set(libraryId, sessionId);
  openLibrary.connection
    .prepare(
      `INSERT INTO sync_sessions (session_id, library_id, status, phase, progress_total, progress_done, started_at)
       VALUES (?, ?, 'running', 'collect', 0, 0, ?)`,
    )
    .run(sessionId, libraryId, new Date().toISOString());
  return sessionId;
}

/** Serpent-xffq：结束同步会话。 */
export function finishSyncSession(this: LibraryService, libraryId: string, sessionId: string, status: 'done' | 'failed' | 'cancelled', errorMessage?: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (this.activeSyncSessions.get(libraryId) === sessionId) {
    this.activeSyncSessions.delete(libraryId);
  }
  openLibrary.connection
    .prepare(
      `UPDATE sync_sessions
          SET status = ?, phase = 'idle', finished_at = ?, error_message = ?
        WHERE session_id = ? AND library_id = ?`,
    )
    .run(status, new Date().toISOString(), errorMessage ?? null, sessionId, libraryId);
}

/**
* Visible-card sync badges (Serpent-871f34). Compares path/size/sidecar hash
* against the last local manifest cache. Does not hash file bytes or call WebDAV.
* Linked / missing / trashed assets are omitted. Synced assets are omitted.
*/
export function listSyncCardStatuses(this: LibraryService, libraryId: string, assetIds: readonly string[]): Array<{ assetId: string; status: 'pending' | 'conflict' }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (seen.has(assetId) || unique.length >= 300) continue;
    seen.add(assetId);
    unique.push(assetId);
  }
  if (unique.length === 0) return [];
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    sync_id: string | null;
    relative_file_path: string;
    byte_size: number;
    location_kind: 'managed' | 'linked';
    deleted_at: string | null;
    availability: string;
  }>({
    connection: openLibrary.connection,
    values: unique,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.sync_id, a.relative_file_path, r.byte_size, a.location_kind,
              a.deleted_at, a.availability
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.asset_id IN (${placeholders})`,
  });
  let cacheEntries: Record<string, { path: string; size: number; metadataHash?: string }> = {};
  const cachedJson = this.readSyncManifestCache(libraryId);
  if (cachedJson) {
    try {
      cacheEntries = parseManifest(cachedJson).entries;
    } catch {
      cacheEntries = {};
    }
  }
  const managedIds = rows
    .filter((row) => row.location_kind === 'managed' && row.deleted_at === null)
    .map((row) => row.asset_id);
  const metadataByAssetId = this.readSyncAssetMetadataMap(openLibrary, managedIds);
  const emptyHash = metadataContentHash(emptySyncAssetMetadata());
  const out: Array<{ assetId: string; status: 'pending' | 'conflict' }> = [];
  for (const row of rows) {
    const cacheEntry = row.sync_id ? cacheEntries[row.sync_id] : undefined;
    const metadata = metadataByAssetId.get(row.asset_id) ?? emptySyncAssetMetadata();
    const pending = isLocalSyncPending({
      hasCacheEntry: Boolean(cacheEntry),
      localPath: row.relative_file_path,
      ...(cacheEntry === undefined ? {} : { cachePath: cacheEntry.path, cacheSize: cacheEntry.size }),
      localSize: row.byte_size,
      localMetadataHash: metadataContentHash(metadata),
      ...(cacheEntry?.metadataHash === undefined ? {} : { cacheMetadataHash: cacheEntry.metadataHash }),
      emptyMetadataHash: emptyHash,
    });
    const status = deriveSyncCardStatus({
      eligible: row.location_kind === 'managed'
        && row.deleted_at === null
        && row.availability === 'available',
      pending,
      syncing: false,
      conflict: false,
    });
    if (status === 'pending' || status === 'conflict') {
      out.push({ assetId: row.asset_id, status });
    }
  }
  return out;
}

/** 写入本地 manifest 缓存（上次同步点）。 */
export function writeSyncManifestCache(this: LibraryService, libraryId: string, manifestJson: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  openLibrary.connection
    .prepare(
      `INSERT INTO sync_manifest_cache (library_id, manifest_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(library_id) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at`,
    )
    .run(libraryId, manifestJson, new Date().toISOString());
}

export function syncTrashedFolderTombstones(this: LibraryService, openLibrary: OpenLibrary): void {
  openLibrary.connection.transaction(() => {
    // Prefer tombstone bind (Serpent-whvm). Path prefix only when that
    // relative_path is unique among tombstones — otherwise same-name
    // folders would inflate each other's counts.
    openLibrary.connection
      .prepare(
        `UPDATE trashed_managed_folders
            SET trashed_asset_count = (
              SELECT COUNT(*)
                FROM assets
               WHERE deleted_at IS NOT NULL
                 AND (
                   trashed_from_tombstone_id = trashed_managed_folders.tombstone_id
                   OR (
                     trashed_from_tombstone_id IS NULL
                     AND trashed_from_folder_id = trashed_managed_folders.folder_id
                   )
                   OR (
                     trashed_from_tombstone_id IS NULL
                     AND trashed_from_folder_id IS NULL
                     AND (
                       SELECT COUNT(*)
                         FROM trashed_managed_folders AS peers
                        WHERE peers.relative_path =
                              trashed_managed_folders.relative_path
                     ) = 1
                     AND (
                       trashed_from_relative_path =
                         trashed_managed_folders.relative_path
                       OR trashed_from_relative_path LIKE
                            (trashed_managed_folders.relative_path || '/%')
                     )
                   )
                 )
                 AND NOT EXISTS (
                   SELECT 1
                     FROM asset_sequence_frames hidden_sequence_frame
                    WHERE hidden_sequence_frame.asset_id = assets.asset_id
                      AND hidden_sequence_frame.position > 0
                 )
            )`,
      )
      .run();
    openLibrary.connection
      .prepare(
        `DELETE FROM trashed_managed_folders WHERE trashed_asset_count = 0`,
      )
      .run();
  })();
}
