import { type AssetSummary, type BrowseLayoutEntry, type FilterClause, type SearchExpressionNode, type SearchQuery, type SearchScope, type SortDefinition } from "../../shared/asset-types";
import { automaticTaskConfigSchema, type AutomaticTask } from "../../shared/automatic-tasks";
import { BROWSE_SCOPE_MAX_ASSETS } from "../../shared/browse-scope";
import { type LibraryNavigationSummary } from "../../shared/library-navigation";
import { linkedAssetIsDirectChild, linkedAssetIsUnderDirectory } from "../../shared/linked-folder-tree";
import { type InternalLibrarySummary } from "../../shared/protocol/responses";
import { LibraryService, LibraryServiceError, buildContextualSearchWhere, expressionHasPositiveText, expressionUsesSearchIndex, ftsCanNarrowSearchGroups, hasPositiveSearchClause, navigationCheckpoint, normalizedSearchGroups, singleDisplayArtifactJoin, type AssetSummaryRow, type ManagedFolderRow, type OpenLibrary, type OpenReconciliationTask } from "../library-service";
import { browseQueryFingerprint, browseSessionIndexComplete, browseSessionPageUsesSnapshot, type BrowseSessionLookup, type BrowseSessionSnapshot } from "./browse-session-store";
import { buildCatalogAssetVisibilityPredicates, buildCatalogExpressionFtsCandidate, buildCatalogExpressionWhere, buildCatalogFilterWhere, buildCatalogFolderScopeClause, buildCatalogFtsQuery, buildCatalogSortOrder, catalogBrowseLayoutEntryFromRow, catalogExpressionRankGroups, countCatalogNavigationAssets, isDefaultCatalogBrowseIndexRequest, type CatalogSearchGroup as SearchGroup } from "./catalog-read";
import { columnsFor, degradedDefaults, hasTable, missingColumns, qualify } from "./lenient-columns";
import { NavigationReadMetrics } from "./navigation-read-metrics";
import { queryPluginDerivedFields as queryPluginDerivedFieldRows } from "./plugin-derived-field-repository";
import { type SearchClause } from "./search-query";
import { SingleFlightRead } from "./single-flight-read";
import { sqliteAllInChunks, withSqliteInPredicate } from "./sqlite-in";

/** LibraryService methods defined in this module (PL). */
export interface QueryMethods {
  invalidateNavigationSummary(...args: Parameters<typeof invalidateNavigationSummary>): ReturnType<typeof invalidateNavigationSummary>;
  countNavigationAssets(...args: Parameters<typeof countNavigationAssets>): ReturnType<typeof countNavigationAssets>;
  getLibraryNavigationSummary(...args: Parameters<typeof getLibraryNavigationSummary>): ReturnType<typeof getLibraryNavigationSummary>;
  getLibraryNavigationSummaryAsync(...args: Parameters<typeof getLibraryNavigationSummaryAsync>): ReturnType<typeof getLibraryNavigationSummaryAsync>;
  navigationReadCheckpoint(...args: Parameters<typeof navigationReadCheckpoint>): ReturnType<typeof navigationReadCheckpoint>;
  buildLibraryNavigationSummaryAsync(...args: Parameters<typeof buildLibraryNavigationSummaryAsync>): ReturnType<typeof buildLibraryNavigationSummaryAsync>;
  listAssets(...args: Parameters<typeof listAssets>): ReturnType<typeof listAssets>;
  listAssetSummariesByIds(...args: Parameters<typeof listAssetSummariesByIds>): ReturnType<typeof listAssetSummariesByIds>;
  listAutomaticTasks(...args: Parameters<typeof listAutomaticTasks>): ReturnType<typeof listAutomaticTasks>;
  queryPluginDerivedFields(...args: Parameters<typeof queryPluginDerivedFields>): ReturnType<typeof queryPluginDerivedFields>;
  warmBrowseIndexCache(...args: Parameters<typeof warmBrowseIndexCache>): ReturnType<typeof warmBrowseIndexCache>;
  isDefaultBrowseIndexRequest(...args: Parameters<typeof isDefaultBrowseIndexRequest>): ReturnType<typeof isDefaultBrowseIndexRequest>;
  buildFilterWhere(...args: Parameters<typeof buildFilterWhere>): ReturnType<typeof buildFilterWhere>;
  createBrowseSession(...args: Parameters<typeof createBrowseSession>): ReturnType<typeof createBrowseSession>;
  readBrowseSessionPage(...args: Parameters<typeof readBrowseSessionPage>): ReturnType<typeof readBrowseSessionPage>;
  readBrowseSessionGeometry(...args: Parameters<typeof readBrowseSessionGeometry>): ReturnType<typeof readBrowseSessionGeometry>;
  readBrowseSessionAssetIds(...args: Parameters<typeof readBrowseSessionAssetIds>): ReturnType<typeof readBrowseSessionAssetIds>;
  closeBrowseSession(...args: Parameters<typeof closeBrowseSession>): ReturnType<typeof closeBrowseSession>;
  searchAssets(...args: Parameters<typeof searchAssets>): ReturnType<typeof searchAssets>;
  countLogicalAssetUnits(...args: Parameters<typeof countLogicalAssetUnits>): ReturnType<typeof countLogicalAssetUnits>;
  listOpenLibraryIds(...args: Parameters<typeof listOpenLibraryIds>): ReturnType<typeof listOpenLibraryIds>;
  listLibraries(...args: Parameters<typeof listLibraries>): ReturnType<typeof listLibraries>;
}

export function invalidateNavigationSummary(this: LibraryService, openLibrary: OpenLibrary): void {
  openLibrary.navigationSummaryCache = undefined;
  openLibrary.folderCoverIndexCache = undefined;
  if (!hasTable(openLibrary.connection, 'browse_change_sequence')) return;
  openLibrary.connection.prepare(
    'UPDATE browse_change_sequence SET sequence = sequence + 1 WHERE library_id = ?',
  ).run(openLibrary.summary.libraryId);
}

/**
* Navigation badges only need a count. Keep them on a narrow COUNT query
* instead of routing through searchAssets, which also builds a first page,
* joins display metadata, and performs sequence/artifact enrichment. The
* predicates intentionally mirror searchAssets' default browse/trash scope
* so the progressive sidebar does not drift from the canvas visibility.
*/
export function countNavigationAssets(this: LibraryService, input: {
    libraryId: string;
    scope: 'all' | 'root' | 'trash';
    showIgnored: boolean;
  }): number {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const connection = openLibrary.connection;
  const hasExplicitIgnores = this.catalogTableHasRows(connection, 'explicit_ignored_paths')
    || this.catalogTableHasRows(connection, 'gitignore_ignored_paths');
  return countCatalogNavigationAssets(connection, {
    scope: input.scope,
    showIgnored: input.showIgnored,
    showMissingLinked: this._showMissingLinkedFiles,
    explicitIgnoreSql: hasExplicitIgnores ? this.explicitIgnoreSql(connection, 'a', input.showIgnored) : '1 = 1',
    hasLinkedIgnoredAssets: this.catalogTableHasRows(connection, 'linked_ignored_assets'),
    hasSequenceFrames: this.catalogTableHasRows(connection, 'asset_sequence_frames'),
    hasCompanions: this.ensureCompanionIndex(openLibrary),
  });
}

/**
* Build the complete navigation read model in one Worker turn. Individual
* list methods remain public for mutation dialogs, but the main browse path
* uses this cached aggregate so it does not enqueue one IPC and one COUNT
* chain per sidebar section.
*/
export function getLibraryNavigationSummary(this: LibraryService, input: {
    libraryId: string;
    showIgnored?: boolean;
    includeTrashedFolders?: boolean;
  }): LibraryNavigationSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.scheduleOrphanFolderCoverSweep(openLibrary);
  const showIgnored = input.showIgnored === true;
  const includeTrashedFolders = input.includeTrashedFolders === true;
  const changeSequence = this.getChangeSequence(input.libraryId);
  const browseChangeSequence = this.getBrowseChangeSequence(input.libraryId);
  const key = `${browseChangeSequence}\u0000${showIgnored ? 'ignored' : 'visible'}\u0000${includeTrashedFolders ? 'trash-folders' : 'no-trash-folders'}\u0000${this._showMissingLinkedFiles ? 'missing-linked' : 'hide-missing-linked'}`;
  const cached = openLibrary.navigationSummaryCache;
  if (cached?.key === key) {
    // The summary contents are governed by the narrow browse sequence. Keep
    // the public broad sequence current for automation/write fencing without
    // re-running every sidebar COUNT after a thumbnail/job write.
    return cached.value.changeSequence === changeSequence
      ? cached.value
      : { ...cached.value, changeSequence };
  }

  const summary: LibraryNavigationSummary = {
    libraryId: input.libraryId,
    changeSequence,
    allAssetCount: this.countNavigationAssets({
      libraryId: input.libraryId,
      scope: 'all',
      showIgnored,
    }),
    rootAssetCount: this.countNavigationAssets({
      libraryId: input.libraryId,
      scope: 'root',
      showIgnored,
    }),
    trashedAssetCount: this.countNavigationAssets({
      libraryId: input.libraryId,
      scope: 'trash',
      showIgnored,
    }),
    folders: this.listManagedFolders(input.libraryId, showIgnored),
    linkedFolders: this.listLinkedFolders(input.libraryId),
    tags: this.listTags(input.libraryId),
    trashedFolders: includeTrashedFolders
      ? this.listTrashedFolders(input.libraryId)
      : [],
    folderCovers: this.listFolderNavigationCovers(openLibrary),
  };
  if (
    this.getBrowseChangeSequence(input.libraryId) === browseChangeSequence
  ) {
    openLibrary.navigationSummaryCache = { key, value: summary };
  }
  return summary;
}

/**
* Progressive counterpart used by the Worker request path. Navigation is a
* read model, but its cold construction contains several independent COUNT
* and recursive-list queries. Yield after each pass so the scheduler can
* run a browse page or visible-media request between them. The synchronous
* method above remains for in-process callers and tests that need a single
* coherent turn.
*/
export async function getLibraryNavigationSummaryAsync(this: LibraryService, input: {
    libraryId: string;
    showIgnored?: boolean;
    includeTrashedFolders?: boolean;
  }): Promise<LibraryNavigationSummary> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  let builds = this.navigationBuilds.get(openLibrary);
  if (!builds) {
    builds = new SingleFlightRead<LibraryNavigationSummary>();
    this.navigationBuilds.set(openLibrary, builds);
  }
  const key = `${this.getBrowseChangeSequence(input.libraryId)}:${input.showIgnored === true}:${input.includeTrashedFolders === true}:${this._showMissingLinkedFiles}`;
  return builds.run(key, () => this.buildLibraryNavigationSummaryAsync(input, openLibrary));
}

export function navigationReadCheckpoint(this: LibraryService, libraryId: string, expectedLibrary: OpenLibrary): () => Promise<void> {
  let nextYieldAt = performance.now() + 6;
  let nextPollAt = 0;
  const checkpoint = async (): Promise<void> => {
    // Windows timers can cost a full tick. Yield by work slice rather than
    // paying that floor after every sub-millisecond catalog query.
    if (performance.now() >= nextYieldAt) {
      if (performance.now() >= nextPollAt) {
        await navigationCheckpoint();
        nextPollAt = performance.now() + 50;
      } else {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      nextYieldAt = performance.now() + 6;
    }
    if (this.openById.get(libraryId) !== expectedLibrary) throw this.reconciliationAbortError();
  };
  return checkpoint;
}

export async function buildLibraryNavigationSummaryAsync(this: LibraryService, input: {
    libraryId: string;
    showIgnored?: boolean;
    includeTrashedFolders?: boolean;
  }, expectedLibrary: OpenLibrary): Promise<LibraryNavigationSummary> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (openLibrary !== expectedLibrary) throw this.reconciliationAbortError();
  const checkpoint = this.navigationReadCheckpoint(input.libraryId, expectedLibrary);
  this.scheduleOrphanFolderCoverSweep(openLibrary);
  const showIgnored = input.showIgnored === true;
  const includeTrashedFolders = input.includeTrashedFolders === true;
  const changeSequence = this.getChangeSequence(input.libraryId);
  const browseChangeSequence = this.getBrowseChangeSequence(input.libraryId);
  const key = `${browseChangeSequence}\u0000${showIgnored ? 'ignored' : 'visible'}\u0000${includeTrashedFolders ? 'trash-folders' : 'no-trash-folders'}\u0000${this._showMissingLinkedFiles ? 'missing-linked' : 'hide-missing-linked'}`;
  const cached = openLibrary.navigationSummaryCache;
  if (cached?.key === key) {
    return cached.value.changeSequence === changeSequence
      ? cached.value
      : { ...cached.value, changeSequence };
  }

  const metrics = new NavigationReadMetrics();
  const allAssetCount = metrics.measure('all-count', () => this.countNavigationAssets({
    libraryId: input.libraryId,
    scope: 'all',
    showIgnored,
  }));
  await checkpoint();
  const rootAssetCount = metrics.measure('root-count', () => this.countNavigationAssets({
    libraryId: input.libraryId,
    scope: 'root',
    showIgnored,
  }));
  await checkpoint();
  const trashedAssetCount = metrics.measure('trash-count', () => this.countNavigationAssets({
    libraryId: input.libraryId,
    scope: 'trash',
    showIgnored,
  }));
  await checkpoint();
  const folders = metrics.measure('managed-folders', () => this.listManagedFolders(input.libraryId, showIgnored));
  await checkpoint();
  const preparedLinkedPaths = await metrics.measureAsync('linked-asset-projection', () => this.prepareLinkedAssetPaths(openLibrary, false, checkpoint));
  const linkedFolders = metrics.measure('linked-folders', () => this.listLinkedFolders(input.libraryId, preparedLinkedPaths));
  await checkpoint();
  const tags = metrics.measure('tags', () => this.listTags(input.libraryId));
  await checkpoint();
  const trashedFolders = includeTrashedFolders
    ? this.listTrashedFolders(input.libraryId)
    : [];

  const summary: LibraryNavigationSummary = {
    libraryId: input.libraryId,
    changeSequence,
    allAssetCount,
    rootAssetCount,
    trashedAssetCount,
    folders,
    linkedFolders,
    tags,
    trashedFolders,
    folderCovers: this.listFolderNavigationCovers(openLibrary),
  };
  if (
    this.getBrowseChangeSequence(input.libraryId) === browseChangeSequence
  ) {
    openLibrary.navigationSummaryCache = { key, value: summary };
  }
  const timing = metrics.result();
  if (timing.durationMs >= 250 || process.env.KEEL_REFRESH_STAGE_LOG === '1') {
    this.diagnose('navigation.summary', null, { libraryId: input.libraryId, ...timing });
  }
  return summary;
}

export function listAssets(this: LibraryService, input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
    showIgnored?: boolean;
    assetIds?: readonly string[];
  }): AssetSummary[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const idList = [...new Set((input.assetIds ?? []).filter((id) => id.length > 0))];
  const byIds = idList.length > 0;
  const managedFolder = input.folderId
    ? openLibrary.connection
        .prepare(
          'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
        )
        .get(input.folderId) as ManagedFolderRow | undefined
    : undefined;
  const linkedScope = input.folderId && !managedFolder
    ? this.resolveLinkedFolderScope(openLibrary, input.folderId)
    : null;
  if (!byIds && input.folderId && !managedFolder && !linkedScope) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }
  // Serpent-verg.2 — lenient read (0031 §1): display/derived columns added
  // after the earliest supported schema are whitelisted per table; columns
  // missing on an older library are omitted from the query and filled with
  // degraded defaults instead of failing. Core identity columns below are
  // hard-required (every supported schema has them).
  const connection = openLibrary.connection;
  const assetColumns = columnsFor(connection, 'assets');
  const revisionColumns = columnsFor(connection, 'revisions');
  const artifactColumns = columnsFor(connection, 'revision_artifacts');
  const metadataColumns = columnsFor(connection, 'asset_metadata');
  const selectList = [
    'a.asset_id',
    'a.managed_folder_id',
    'a.linked_folder_id',
    'a.location_kind',
    'a.relative_file_path',
    "CASE WHEN r.revision_id IS NULL THEN 'corrupt:' || a.asset_id ELSE a.current_revision_id END AS current_revision_id",
    "CASE WHEN r.revision_id IS NULL THEN 'missing' ELSE a.availability END AS availability",
    'a.deleted_at',
    ...qualify('a', assetColumns, ['trashed_from_relative_path']),
    ...(revisionColumns.has('byte_size') ? ['COALESCE(r.byte_size, 0) AS byte_size'] : []),
    ...(revisionColumns.has('modified_at')
      ? ["COALESCE(r.modified_at, '1970-01-01T00:00:00.000Z') AS modified_at"]
      : []),
    // Rating/favorite fall back to 0 when the metadata row is absent;
    // when the column itself is missing on an older library the row is
    // filled with 0 below instead of failing.
    ...(metadataColumns.has('rating') ? ['COALESCE(m.rating, 0) AS rating'] : []),
    ...(metadataColumns.has('favorite') ? ['COALESCE(m.favorite, 0) AS favorite'] : []),
    ...(artifactColumns.has('status') ? ['ra.status AS thumbnail_status'] : []),
    ...(artifactColumns.has('artifact_id') ? ['ra.artifact_id AS thumbnail_artifact_id'] : []),
    ...(artifactColumns.has('width')
      ? ['COALESCE(ra.width, video_meta.width) AS artifact_width']
      : []),
    ...(artifactColumns.has('height')
      ? ['COALESCE(ra.height, video_meta.height) AS artifact_height']
      : []),
    ...(artifactColumns.has('duration_ms')
      ? ['video_meta.duration_ms AS artifact_duration_ms']
      : []),
  ].join(',\n');
  const listAssetSql = (idPredicateSql: string): string =>
    `SELECT ${selectList}
       FROM assets a
       LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
       LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
       ${singleDisplayArtifactJoin(
          'ra',
          artifactColumns.has('status')
            ? "AND chosen.status IN ('ready', 'pending', 'generating', 'failed')"
            : '',
        )}
       LEFT JOIN revision_artifacts video_meta
         ON video_meta.revision_id = a.current_revision_id
        AND video_meta.kind = 'extracted_metadata'
        ${artifactColumns.has('status') ? "AND video_meta.status = 'ready'" : ''}
        AND video_meta.invalidated_at IS NULL
      WHERE ${hasTable(connection, 'linked_ignored_assets')
        ? 'NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AND '
        : ''}${this.explicitIgnoreSql(connection, 'a', input.showIgnored === true)} AND ${idPredicateSql}
      ORDER BY a.relative_file_path`;
  type ListAssetRow = AssetSummaryRow & {
    deleted_at: string | null;
    trashed_from_relative_path: string | null;
    thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
    thumbnail_artifact_id: string | null;
    artifact_width: number | null;
    artifact_height: number | null;
    artifact_duration_ms: number | null;
  };
  const rows = byIds
    ? withSqliteInPredicate(connection, 'a.asset_id', idList, (sql, params) =>
      connection.prepare(listAssetSql(sql)).all(...params) as ListAssetRow[])
    : connection.prepare(listAssetSql('1')).all() as ListAssetRow[];

  // Serpent-verg.2 — fill degraded defaults for whitelisted columns that
  // an older library does not have (0031 §1.1): the feature degrades
  // (size/metadata/thumbnail not shown) instead of the query failing.
  // Column-name defaults come from the shared registry; the thumbnail row
  // aliases (thumbnail_status/artifact_*) are keyed by result-field name
  // and stay explicit here.
  const degradedFill: Record<string, unknown> = {
    ...degradedDefaults('assets', missingColumns(connection, 'assets', ['trashed_from_relative_path'])),
    ...degradedDefaults('revisions', missingColumns(connection, 'revisions', ['byte_size', 'modified_at'])),
    ...degradedDefaults('asset_metadata', missingColumns(connection, 'asset_metadata', ['rating', 'favorite'])),
    ...(!artifactColumns.has('status') ? { thumbnail_status: null } : {}),
    ...(!artifactColumns.has('artifact_id') ? { thumbnail_artifact_id: null } : {}),
    ...(!artifactColumns.has('width') ? { artifact_width: null } : {}),
    ...(!artifactColumns.has('height') ? { artifact_height: null } : {}),
    ...(!artifactColumns.has('duration_ms') ? { artifact_duration_ms: null } : {}),
  };

  const assets = rows
    .map((row) => ({ ...degradedFill, ...row }))
    .filter((row) => {
      if (byIds) return true;
      if (managedFolder) {
        if (!input.recursive) return row.managed_folder_id === managedFolder.folder_id;
        return (
          row.relative_file_path.startsWith(`${managedFolder.relative_path}/`) ||
          row.managed_folder_id === managedFolder.folder_id
        );
      }
      if (linkedScope) {
        if (row.linked_folder_id !== linkedScope.linkedFolderId) return false;
        if (!input.recursive) {
          return linkedAssetIsDirectChild(row.relative_file_path, linkedScope.relativePath);
        }
        if (linkedScope.relativePath === '') return true;
        return linkedAssetIsUnderDirectory(row.relative_file_path, linkedScope.relativePath);
      }
      return input.recursive || row.managed_folder_id === null;
    })
    .map((row) => this.assetSummaryFromRow({
      ...row,
      thumbnail_status: row.thumbnail_status === 'ready' ? 'ready'
        : row.thumbnail_status === 'failed' ? 'failed'
        : row.thumbnail_status === 'pending' || row.thumbnail_status === 'generating' ? 'pending'
        : null,
      thumbnail_artifact_id: row.thumbnail_status === 'ready' ? row.thumbnail_artifact_id : null,
      media_type: (() => {
        return LibraryService.toSummaryMediaType(
          LibraryService.detectMediaType(row.relative_file_path),
        );
      })(),
    }));
  return this.withImageSequenceSummaries(openLibrary, assets);
}

/**
* Resolve a large affected-id set through listAssets, which now chunks IN
* binds instead of silently truncating after 200 IDs.
*/
export function listAssetSummariesByIds(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): AssetSummary[] {
  const uniqueIds = [...new Set(assetIds.filter((assetId) => assetId.length > 0))];
  if (uniqueIds.length === 0) return [];
  return this.listAssets({
    libraryId: openLibrary.summary.libraryId,
    recursive: true,
    assetIds: uniqueIds,
  }).sort((left, right) =>
    left.relativeFilePath.localeCompare(right.relativeFilePath),
  );
}

export function listAutomaticTasks(this: LibraryService, libraryId: string): AutomaticTask[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (!hasTable(openLibrary.connection, "automatic_tasks")) return [];
  this.migrateLegacyGroups(openLibrary);
  const rows = openLibrary.connection
    .prepare("SELECT * FROM automatic_tasks ORDER BY rowid")
    .all() as {
    task_id: string;
    config_json: string;
    last_run_at: string | null;
    last_added: number;
    last_error: string | null;
  }[];
  const tasks = rows.map((row) => ({
    ...automaticTaskConfigSchema.parse(JSON.parse(row.config_json)),
    taskId: row.task_id,
    lastRunAt: row.last_run_at,
    lastAdded: row.last_added,
    lastError: row.last_error,
  }));
  const layout = this.getAutomaticTaskLayout(libraryId);
  const ordered = [
    ...layout.groups.flatMap((g) => g.taskIds),
    ...layout.ungroupedTaskIds,
  ];
  const positions = new Map(ordered.map((id, index) => [id, index]));
  return tasks.sort(
    (a, b) => (positions.get(a.taskId) ?? 0) - (positions.get(b.taskId) ?? 0),
  );
}

export function queryPluginDerivedFields(this: LibraryService, input: {
    libraryId: string;
    pluginId: string;
    packageHash: string;
    fieldId: string;
    operator: 'equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
    value: string | number | boolean | null;
    limit?: number;
    offset?: number;
  }): { assetIds: string[]; total: number } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  return queryPluginDerivedFieldRows(openLibrary.connection, {
    ...input,
    libraryId: openLibrary.summary.libraryId,
  });
}

/**
* Serpent-4bdd26: pull the hot browse/sort index pages into the SQLite page
* cache after open. On SMB/NAS each cold page is a network round trip —
* without warm-up the user's first sort-by-date or deep pagination pays
* seconds of latency that a background scan can absorb invisibly.
* Read-only and yielded between passes; correctness-neutral.
*/
export async function warmBrowseIndexCache(this: LibraryService, openLibrary: OpenLibrary, task: OpenReconciliationTask): Promise<void> {
  // Ignored linked folders are intentionally outside the browse surface and
  // can contain most of a library. Warming their index pages after open only
  // competes with the first viewer/source requests, especially on SMB.
  const visibleAssetSql = this.explicitIgnoreSql(openLibrary.connection, 'a');
  const queries = [
    `SELECT r.modified_at FROM assets a
       JOIN revisions r ON r.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL
        AND ${visibleAssetSql}
      ORDER BY r.modified_at DESC
      LIMIT 512`,
    `SELECT ra.artifact_id FROM assets a
       JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL
        AND ${visibleAssetSql}
      ORDER BY ra.artifact_id
      LIMIT 512`,
  ];
  for (const sql of queries) {
    try {
      this.assertReconciliationActive(task);
      // Single narrow column: materializing it is cheap, and reading every
      // hot page is enough to make the first sort/view query predictable;
      // scanning every row here was itself a startup regression on NAS.
      openLibrary.connection.prepare(sql).all();
      await this.yieldReconciliation(task);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // Warm-up is best-effort; any failure just skips the pass.
    }
  }
}

export function isDefaultBrowseIndexRequest(this: LibraryService, input: {
    query?: { clauses: SearchClause[]; groups?: SearchGroup[]; expression?: { version: 1; root: SearchExpressionNode | null } } | null;
    filters?: FilterClause[] | null;
    scope?: SearchScope | null;
    sort?: SortDefinition | null;
    scopeMode?: boolean | null;
    idsOnly?: boolean | null;
    showIgnored?: boolean;
  }): boolean {
  return this._showMissingLinkedFiles && isDefaultCatalogBrowseIndexRequest(input);
}

export function buildFilterWhere(this: LibraryService, filters: FilterClause[], options: { hasAiContent: boolean; hasAiAssetTags: boolean; hasTagHierarchy?: boolean } = {
      hasAiContent: true,
      hasAiAssetTags: true,
    }): { sql: string; params: unknown[] } {
  return buildCatalogFilterWhere(filters, options);
}

export function createBrowseSession(this: LibraryService, input: {
    libraryId: string;
    libraryGeneration: number;
    query: SearchQuery | null;
    filters?: FilterClause[] | null;
    scope?: SearchScope | null;
    sort?: SortDefinition | null;
    limit?: number | null;
    showIgnored?: boolean;
  }): {
    session: BrowseSessionSnapshot;
    items: AssetSummary[];
    total: number;
    offset: number;
    snippets?: Array<{ assetId: string; text: string }>;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const definition = {
    query: input.query,
    filters: input.filters ?? null,
    scope: input.scope ?? null,
    sort: input.sort ?? null,
    showIgnored: input.showIgnored === true,
    showMissingLinked: this._showMissingLinkedFiles,
  };
  // PERF2-04 / Serpent-52eed4: paint the bounded first window before enumerating
  // every id. Full-scope idsOnly on a network library occupied the only
  // interactive slot for seconds, so folder clicks looked dead until it finished.
  const page = this.searchAssets({
    libraryId: input.libraryId,
    query: definition.query,
    filters: definition.filters,
    scope: definition.scope,
    sort: definition.sort,
    showIgnored: definition.showIgnored,
    limit: input.limit ?? 100,
    offset: 0,
  });
  const changeSequence = this.getBrowseChangeSequence(input.libraryId);
  const cachedBrowse = openLibrary.browseIndexCache;
  const firstPageIds = page.items.map((item) => item.assetId);
  const cachedIds = cachedBrowse !== undefined
    && cachedBrowse.browseChangeSequence === changeSequence
    && this.isDefaultBrowseIndexRequest({
      query: definition.query,
      filters: definition.filters,
      scope: definition.scope,
      sort: definition.sort,
      showIgnored: definition.showIgnored,
    })
    && cachedBrowse.assetIds.length === page.total
    ? cachedBrowse.assetIds
    : undefined;
  const session = this.browseSessionStore.create({
    libraryId: input.libraryId,
    libraryGeneration: input.libraryGeneration,
    changeSequence,
    queryFingerprint: browseQueryFingerprint(definition),
    query: definition.query,
    filters: definition.filters,
    scope: definition.scope,
    sort: definition.sort,
    showIgnored: definition.showIgnored,
    declaredTotal: page.total,
    assetIds: cachedIds ?? firstPageIds,
  });
  return {
    session,
    items: page.items,
    total: page.total,
    offset: 0,
    ...(page.snippets ? { snippets: page.snippets } : {}),
  };
}

export function readBrowseSessionPage(this: LibraryService, input: {
    libraryId: string;
    libraryGeneration: number;
    sessionId: string;
    limit?: number | null;
    offset?: number | null;
  }): | ({ status: 'ready'; session: BrowseSessionSnapshot }
      & Pick<ReturnType<LibraryService['searchAssets']>, 'items' | 'total' | 'offset' | 'snippets'>)
    | Extract<BrowseSessionLookup, { status: 'missing' | 'stale' }> {
  const lookup = this.browseSessionStore.lookup({
    libraryId: input.libraryId,
    sessionId: input.sessionId,
    libraryGeneration: input.libraryGeneration,
    changeSequence: this.getBrowseChangeSequence(input.libraryId),
  });
  if (lookup.status !== 'ready') return lookup;
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const session = lookup.session;
  const useSnapshot = browseSessionPageUsesSnapshot(session, offset, limit);
  const page = this.searchAssets({
    libraryId: input.libraryId,
    query: session.query,
    ...(useSnapshot
      ? { sessionAssetIds: session.assetIds }
      : {
          filters: session.filters ? [...session.filters] : null,
          scope: session.scope,
        }),
    sort: session.sort,
    showIgnored: session.showIgnored,
    limit,
    offset,
  });
  return {
    status: 'ready',
    session,
    items: page.items,
    total: session.declaredTotal,
    offset,
    ...(page.snippets ? { snippets: page.snippets } : {}),
  };
}

/**
* Bounded geometry-block read for one BrowseSession window.
*
* CANVAS-038: the Renderer no longer requests geometry blocks — a scope now
* commits its complete compact index once (`asset.search` with `layoutOnly`),
* because streaming 128-row blocks rewrote heights and identities mid-scroll.
* The `browse.session.geometry` protocol message, its schemas and the Main /
* preload forwarding were deleted with it, so **nothing in production reaches
* this method**.
*
* It is retained deliberately as the measurement seam for the 20k worker
* baseline (`browseSessionGeometryMs` in `tests/worker/large-library-performance.test.ts`,
* recorded in the CANVAS-038 design log) rather than deleted together with the
* baseline it produces. Do not re-wire it into a render path without also
* restoring the identity guarantees that the one-shot index provides.
*/
export function readBrowseSessionGeometry(this: LibraryService, input: {
    libraryId: string;
    libraryGeneration: number;
    sessionId: string;
    startIndex?: number | null;
    limit?: number | null;
  }): | {
        status: 'ready';
        session: BrowseSessionSnapshot;
        startIndex: number;
        entries: Array<{
          index: number;
          assetId: string;
          width: number | null;
          height: number | null;
          previewArtifactId?: string | null;
        }>;
      }
    | Extract<BrowseSessionLookup, { status: 'missing' | 'stale' }> {
  const lookup = this.browseSessionStore.lookup({
    libraryId: input.libraryId,
    sessionId: input.sessionId,
    libraryGeneration: input.libraryGeneration,
    changeSequence: this.getBrowseChangeSequence(input.libraryId),
  });
  if (lookup.status !== 'ready') return lookup;

  const session = lookup.session;
  const startIndex = Math.min(
    session.declaredTotal,
    Math.max(0, input.startIndex ?? 0),
  );
  const limit = Math.min(500, Math.max(1, input.limit ?? 128));
  const useSnapshot = browseSessionPageUsesSnapshot(session, startIndex, limit);
  if (!useSnapshot) {
    const page = this.searchAssets({
      libraryId: input.libraryId,
      query: session.query,
      filters: session.filters ? [...session.filters] : null,
      scope: session.scope,
      sort: session.sort,
      showIgnored: session.showIgnored,
      limit,
      offset: startIndex,
    });
    return {
      status: 'ready',
      session,
      startIndex,
      entries: page.items.map((item, index) => ({
        index: startIndex + index,
        assetId: item.assetId,
        width: item.width,
        height: item.height,
        ...(item.thumbnailArtifactId !== undefined
          ? { previewArtifactId: item.thumbnailArtifactId }
          : {}),
      })),
    };
  }
  const page = this.searchAssets({
    libraryId: input.libraryId,
    query: null,
    sessionAssetIds: session.assetIds,
    layoutOnly: true,
    limit,
    offset: startIndex,
  });
  const entries = (page.layout ?? []).map((entry, index) => ({
    index: startIndex + index,
    assetId: entry.assetId,
    width: entry.width,
    height: entry.height,
    ...(entry.previewArtifactId !== undefined
      ? { previewArtifactId: entry.previewArtifactId }
      : {}),
    ...(entry.previewKind !== undefined
      ? { previewKind: entry.previewKind }
      : {}),
    ...(entry.previewRevisionId !== undefined
      ? { previewRevisionId: entry.previewRevisionId }
      : {}),
  }));
  return {
    status: 'ready',
    session,
    startIndex,
    entries,
  };
}

export function readBrowseSessionAssetIds(this: LibraryService, input: {
    libraryId: string;
    libraryGeneration: number;
    sessionId: string;
  }): | { status: 'ready'; session: BrowseSessionSnapshot; assetIds: string[] }
    | Extract<BrowseSessionLookup, { status: 'missing' | 'stale' }> {
  const lookup = this.browseSessionStore.lookup({
    libraryId: input.libraryId,
    sessionId: input.sessionId,
    libraryGeneration: input.libraryGeneration,
    changeSequence: this.getBrowseChangeSequence(input.libraryId),
  });
  if (lookup.status !== 'ready') return lookup;
  if (browseSessionIndexComplete(lookup.session)) {
    return {
      status: 'ready',
      session: lookup.session,
      assetIds: [...lookup.session.assetIds],
    };
  }
  const completed = this.searchAssets({
    libraryId: input.libraryId,
    query: lookup.session.query,
    filters: lookup.session.filters ? [...lookup.session.filters] : null,
    scope: lookup.session.scope,
    sort: lookup.session.sort,
    showIgnored: lookup.session.showIgnored,
    idsOnly: true,
    limit: null,
    offset: 0,
  });
  const session = this.browseSessionStore.replaceAssetIds(
    input.libraryId,
    input.sessionId,
    completed.assetIds ?? [],
  ) ?? lookup.session;
  return {
    status: 'ready',
    session,
    assetIds: [...session.assetIds],
  };
}

export function closeBrowseSession(this: LibraryService, input: { libraryId: string; sessionId: string }): void {
  this.requireOpenLibrary(input.libraryId);
  this.browseSessionStore.close(input.libraryId, input.sessionId);
}

export function searchAssets(this: LibraryService, input: {
    libraryId: string;
    query?: { clauses: SearchClause[]; groups?: SearchGroup[]; expression?: { version: 1; root: SearchExpressionNode | null } } | null;
    filters?: FilterClause[] | null;
    scope?: SearchScope | null;
    sort?: SortDefinition | null;
    limit?: number | null;
    offset?: number | null;
    /** Serpent-6w7n: fetch entire browse scope (lightweight rows, capped). */
    scopeMode?: boolean | null;
    /**
     * Serpent-ws4k: fetch only asset ids for the whole scope (select-all /
     * invert). Skips the thumbnail/sequence enrichment and returns `items: []`
     * plus `assetIds` (capped at the browse-scope cap like scopeMode).
     */
    idsOnly?: boolean | null;
    /** Worker-internal bounded page mode; ordinary idsOnly remains full-scope. */
    idsPage?: boolean | null;
    /** Compact full-scope real-asset geometry for virtualized layout. */
    layoutOnly?: boolean | null;
    /** Worker-internal ordered snapshot source for BrowseSession pages. */
    sessionAssetIds?: readonly string[];
    showIgnored?: boolean;
  }): {
    items: AssetSummary[];
    total: number;
    offset: number;
    snippets?: Array<{ assetId: string; text: string }>;
    assetIds?: string[];
    layout?: BrowseLayoutEntry[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const connection = openLibrary.connection;
  // Serpent-verg.2 — lenient read (0031 §1): display/derived columns and
  // auxiliary tables added after the earliest supported schema are
  // whitelisted; missing ones degrade the query instead of failing.
  const assetColumns = columnsFor(connection, 'assets');
  const revisionColumns = columnsFor(connection, 'revisions');
  const metadataColumns = columnsFor(connection, 'asset_metadata');
  const artifactColumns = columnsFor(connection, 'revision_artifacts');
  const hasIgnoreTable = hasTable(connection, 'linked_ignored_assets');
  const hasAiContent = hasTable(connection, 'ai_content');
  const hasAiAssetTags = hasTable(connection, 'ai_asset_tags');
  const hasSequenceFrames = hasTable(connection, 'asset_sequence_frames');
  const hasSearchIndex = hasTable(connection, 'asset_search_index');
  const hasSearchFts = hasTable(connection, 'asset_search');
  const scopeMode = input.scopeMode === true;
  const idsOnly = input.idsOnly === true;
  const idsPage = idsOnly && input.idsPage === true;
  const layoutOnly = input.layoutOnly === true;
  const sessionAssetIds = input.sessionAssetIds === undefined
    ? undefined
    : [...new Set(input.sessionAssetIds)];
  const sessionMode = sessionAssetIds !== undefined;
  const defaultBrowseIndexRequest = !sessionMode && this.isDefaultBrowseIndexRequest(input);
  const browseIndexSequenceBefore = defaultBrowseIndexRequest
    ? this.getBrowseChangeSequence(input.libraryId)
    : undefined;
  const browseIndexCache = openLibrary.browseIndexCache;
  let cachedBrowseAssetIds: string[] | undefined;
  if (
    !layoutOnly
    && defaultBrowseIndexRequest
    && browseIndexCache !== undefined
    && browseIndexCache.browseChangeSequence === browseIndexSequenceBefore
  ) {
    cachedBrowseAssetIds = browseIndexCache.assetIds;
  }
  const limit = sessionMode
    ? Math.min(500, Math.max(1, input.limit ?? 100))
    : idsPage
      ? Math.min(BROWSE_SCOPE_MAX_ASSETS, Math.max(1, input.limit ?? BROWSE_SCOPE_MAX_ASSETS))
      : scopeMode || idsOnly || layoutOnly
        ? BROWSE_SCOPE_MAX_ASSETS
        : (input.limit ?? 50);
  const offset = sessionMode
    ? Math.max(0, input.offset ?? 0)
    : idsPage
      ? Math.max(0, input.offset ?? 0)
      : scopeMode || idsOnly || layoutOnly ? 0 : (input.offset ?? 0);

  const searchGroups = input.query ? normalizedSearchGroups(input.query) : [];
  const searchExpression = input.query?.expression?.root ?? null;
  const hasQuery = searchGroups.length > 0 || searchExpression !== null;
  const hasPositiveQuery = searchExpression
    ? expressionHasPositiveText(searchExpression)
    : hasPositiveSearchClause(searchGroups);
  // Serpent-verg.2 — lenient read: the trigram FTS path requires the FTS
  // tables to exist; older libraries fall back to the contextual substring
  // search instead of referencing a missing MATCH table.
  const expressionFtsCandidate = searchExpression
    ? buildCatalogExpressionFtsCandidate(searchExpression)
    : null;
  const useTrigramIndex = hasQuery && hasSearchIndex && hasSearchFts
    && (ftsCanNarrowSearchGroups(searchGroups) || expressionFtsCandidate !== null);
  const fts5Query = useTrigramIndex
    ? expressionFtsCandidate ?? buildCatalogFtsQuery(searchGroups)
    : null;
  const legacySearchWhere = hasQuery && searchGroups.length > 0
    ? buildContextualSearchWhere(searchGroups, !hasSearchIndex)
    : { sql: '', params: [] };
  const expressionSearchWhere = searchExpression
    ? buildCatalogExpressionWhere(searchExpression, { assetOnly: !hasSearchIndex, includeAiTags: hasAiAssetTags })
    : { sql: '', params: [] };
  const contextualSearchWhere = [legacySearchWhere.sql, expressionSearchWhere.sql].filter(Boolean).join(' AND ');
  const contextualSearchParams = [...legacySearchWhere.params, ...expressionSearchWhere.params];
  const { sql: filterWhere, params: filterParams } = this.buildFilterWhere(
    input.filters ?? [],
    { hasAiContent, hasAiAssetTags, hasTagHierarchy: hasTable(connection, 'tag_hierarchy') },
  );

  const { sql: orderBy, params: orderParams } = buildCatalogSortOrder({
    hasPositiveQuery,
    searchGroups: searchExpression
      ? [...searchGroups, ...catalogExpressionRankGroups(searchExpression)]
      : searchGroups,
    hasSearchIndex,
    sort: input.sort,
    revisionColumns,
    metadataColumns,
    artifactColumns,
    hasAiContent,
    sessionMode,
    trashScope: input.scope?.kind === 'trash',
  });

  // Keep the ordinary browse/count path narrow. These artifact joins used
  // to run for every browse and search request even though they are only
  // needed by technical filters or technical sorts. On a large library the
  // COUNT query and the data query therefore both scanned the artifact
  // table before the renderer even asked for thumbnail rows.
  const filterFields = new Set((input.filters ?? []).map((filter) => filter.field));
  const needsDurationMeta =
    filterFields.has('width') ||
    filterFields.has('height') ||
    filterFields.has('duration_ms') ||
    filterFields.has('long_edge') ||
    filterFields.has('aspect_ratio') ||
    input.sort?.field === 'duration' ||
    input.sort?.field === 'long_edge';
  const needsPaletteMeta =
    filterFields.has('color') || input.sort?.field === 'color';
  const needsTechnicalThumbnail =
    filterFields.has('width') ||
    filterFields.has('height') ||
    filterFields.has('long_edge') ||
    filterFields.has('aspect_ratio') ||
    input.sort?.field === 'long_edge';
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
  const needsSearchIndex = searchGroups.length > 0 || (searchExpression !== null && expressionUsesSearchIndex(searchExpression));
  const searchJoins = needsSearchIndex && hasSearchIndex
    ? `JOIN asset_search_index sc ON a.asset_id = sc.asset_id
       ${useTrigramIndex && hasSearchFts ? 'JOIN asset_search s ON sc.rowid = s.rowid' : ''}`
    : '';
  const hasLayoutDimensions =
    artifactColumns.has('width') && artifactColumns.has('height');
  const layoutArtifactJoins = layoutOnly && hasLayoutDimensions
    ? `LEFT JOIN revision_artifacts layout_metadata
         ON layout_metadata.revision_id = a.current_revision_id
        AND layout_metadata.kind = 'extracted_metadata'
        ${artifactColumns.has('status') ? "AND layout_metadata.status = 'ready'" : ''}
        AND layout_metadata.invalidated_at IS NULL
       ${singleDisplayArtifactJoin(
          'layout_preview',
          artifactColumns.has('status') ? "AND chosen.status = 'ready'" : '',
        )}`
    : '';
  const dataFrom = `FROM assets a
       LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
       LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
       ${durationMetaJoin}
       ${paletteMetaJoin}
       ${technicalThumbnailJoin}
       ${layoutArtifactJoins}
       ${searchJoins}`;
  // COUNT only retains joins referenced by the WHERE clause. Revisions are
  // display-only, while metadata is needed only for rating/favourite/URL
  // filters; this makes the sidebar count materially cheaper than the data
  // page without changing the result set.
  const needsMetadataForFilter =
    filterFields.has('rating') ||
    filterFields.has('favorite') ||
    filterFields.has('source_url');
  const countFrom = `FROM assets a
       ${needsMetadataForFilter ? 'LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id' : ''}
       ${durationMetaJoin}
       ${paletteMetaJoin}
       ${technicalThumbnailJoin}
       ${searchJoins}`;

  // WHERE clause.
  const whereParts: string[] = [];
  const allParams: unknown[] = [];

  if (hasQuery) {
    if (useTrigramIndex) {
      whereParts.push('asset_search MATCH ?');
      allParams.push(fts5Query!);
    }
    whereParts.push(contextualSearchWhere);
    allParams.push(...contextualSearchParams);
  }

  if (sessionMode) {
    const pageAssetIds = sessionAssetIds.slice(offset, offset + limit);
    whereParts.push(
      pageAssetIds.length === 0
        ? '1 = 0'
        : `a.asset_id IN (${pageAssetIds.map(() => '?').join(',')})`,
    );
    allParams.push(...pageAssetIds);
  } else {
    whereParts.push(...buildCatalogAssetVisibilityPredicates({
      scopeKind: input.scope?.kind === 'trash' ? 'trash' : 'all',
      showIgnored: input.showIgnored === true,
      showMissingLinked: this._showMissingLinkedFiles,
      explicitIgnoreSql: this.explicitIgnoreSql(connection, 'a', input.showIgnored === true),
      hasLinkedIgnoredAssets: hasIgnoreTable,
      hasSequenceFrames,
      hasCompanions: this.ensureCompanionIndex(openLibrary),
    }));

    if (filterWhere.length > 0) {
      whereParts.push(filterWhere);
      allParams.push(...filterParams);
    }

  if (input.scope?.kind === 'folder') {
    const folderScope = buildCatalogFolderScopeClause(connection, {
      libraryId: openLibrary.summary.libraryId,
      scope: input.scope,
    });
    if (folderScope.status === 'missing') {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    whereParts.push(folderScope.sql);
    allParams.push(...folderScope.params);
  }
  }

  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  // Columns for data query. Display/derived columns are whitelisted per
  // table (Serpent-verg.2): missing columns on older libraries are omitted
  // here and filled with degraded defaults on the result rows.
  const dataColumns = [
    'a.asset_id',
    'a.location_kind',
    'a.managed_folder_id',
    'a.linked_folder_id',
    'a.relative_file_path',
    "CASE WHEN r.revision_id IS NULL THEN 'corrupt:' || a.asset_id ELSE a.current_revision_id END AS current_revision_id",
    "CASE WHEN r.revision_id IS NULL THEN 'missing' ELSE a.availability END AS availability",
    'a.deleted_at',
    ...(revisionColumns.has('byte_size')
      ? ['COALESCE(r.byte_size, 0) AS byte_size']
      : ['0 AS byte_size']),
    ...(revisionColumns.has('modified_at')
      ? ["COALESCE(r.modified_at, '1970-01-01T00:00:00.000Z') AS modified_at"]
      : ["'1970-01-01T00:00:00.000Z' AS modified_at"]),
    ...(metadataColumns.has('rating') ? ['COALESCE(m.rating, 0) AS rating'] : []),
    ...(metadataColumns.has('favorite') ? ['COALESCE(m.favorite, 0) AS favorite'] : []),
    ...qualify('a', assetColumns, ['trashed_from_relative_path', 'trashed_from_tombstone_id']),
    ...(useTrigramIndex && hasSearchFts
      ? ["snippet(asset_search, -1, '<b>', '</b>', '...', 32) AS snippet_text"]
      : []),
  ].join(',\n');

  // Total count query.
  const total = sessionMode
    ? sessionAssetIds.length
    : cachedBrowseAssetIds !== undefined
    ? cachedBrowseAssetIds.length
    : (() => {
        const countSql = `SELECT COUNT(*) AS total ${countFrom} ${whereClause}`;
        const countRow = connection
          .prepare(countSql)
          .get(...allParams) as {
          total: number;
        };
        return countRow.total;
      })();

  // Data query. ids-only mode (Serpent-ws4k) fetches just the stable id
  // column so select-all/invert can cover the whole scope without shipping
  // AssetSummary rows over three process hops.
  const layoutColumns = hasLayoutDimensions
    ? `a.asset_id,
       a.current_revision_id AS layout_revision_id,
       a.availability AS layout_availability,
       a.deleted_at AS layout_deleted_at,
       a.relative_file_path,
       r.byte_size AS layout_byte_size,
       r.modified_at AS layout_modified_at,
       m.rating AS layout_rating,
       CASE
         WHEN layout_metadata.width > 0 AND layout_metadata.height > 0 THEN layout_metadata.width
         ELSE layout_preview.width
       END AS layout_width,
       CASE
         WHEN layout_metadata.width > 0 AND layout_metadata.height > 0 THEN layout_metadata.height
         ELSE layout_preview.height
       END AS layout_height,
       layout_preview.artifact_id AS layout_preview_artifact_id`
    : `a.asset_id, a.current_revision_id AS layout_revision_id, a.availability AS layout_availability, a.deleted_at AS layout_deleted_at, a.relative_file_path, r.byte_size AS layout_byte_size, r.modified_at AS layout_modified_at, m.rating AS layout_rating, NULL AS layout_width, NULL AS layout_height, NULL AS layout_preview_artifact_id`;
  const dataColumnsForFetch = idsOnly
    ? 'a.asset_id'
    : layoutOnly
      ? layoutColumns
      : dataColumns;
  const cachedPageAssetIds = sessionMode
    ? undefined
    : cachedBrowseAssetIds?.slice(offset, offset + limit);
  const cachedPageWhereClause = cachedPageAssetIds === undefined
    ? whereClause
    : cachedPageAssetIds.length === 0
      ? ''
      : `${whereClause}${whereClause.length > 0 ? ' AND ' : 'WHERE '}a.asset_id IN (${cachedPageAssetIds.map(() => '?').join(',')})`;
  const dataSql = cachedPageAssetIds === undefined
    ? `SELECT ${dataColumnsForFetch} ${dataFrom} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    : cachedPageAssetIds.length === 0
      ? ''
      : `SELECT ${dataColumnsForFetch} ${dataFrom} ${cachedPageWhereClause}`;
  let rows = dataSql === ''
    ? []
    : connection
      .prepare(dataSql)
      .all(
        ...allParams,
        ...(cachedPageAssetIds ?? []),
        ...(cachedPageAssetIds === undefined
          ? [
              ...orderParams,
              sessionMode ? Math.min(limit, Math.max(0, sessionAssetIds.length - offset)) : limit,
              sessionMode ? 0 : offset,
            ]
          : []),
      ) as Array<{
    asset_id: string;
    location_kind: 'managed' | 'linked';
      managed_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string;
      availability: 'available' | 'missing';
      byte_size: number;
      modified_at: string;
      rating: number;
      favorite: number;
      deleted_at?: string | null;
      trashed_from_relative_path?: string | null;
      trashed_from_tombstone_id?: string | null;
      snippet_text?: string;
      layout_width?: number | null;
      layout_height?: number | null;
      layout_preview_artifact_id?: string | null;
      layout_revision_id?: string | null;
      layout_byte_size?: number | null;
      layout_availability?: 'available' | 'missing' | null;
      layout_deleted_at?: string | null;
    layout_modified_at?: string | null;
    layout_rating?: number | null;
    }>;

  const orderedPageAssetIds = sessionMode
    ? sessionAssetIds.slice(offset, offset + limit)
    : cachedPageAssetIds;
  if (orderedPageAssetIds !== undefined && rows.length > 1) {
    const rowById = new Map(rows.map((row) => [row.asset_id, row] as const));
    rows = orderedPageAssetIds.flatMap((assetId) => {
      const row = rowById.get(assetId);
      return row === undefined ? [] : [row];
    });
  }

  if (idsOnly) {
    return {
      items: [],
      total,
      offset,
      assetIds: rows.map((row) => row.asset_id),
    };
  }

  if (layoutOnly) {
    // Serpent-4bdd26: per-row conditional spreads allocate a throwaway
    // object each; direct assignment measured ~2x faster over 20k rows.
    const layout = new Array<object>(rows.length);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const mediaType = LibraryService.toSummaryMediaType(
        LibraryService.detectMediaType(row.relative_file_path),
      );
      layout[index] = catalogBrowseLayoutEntryFromRow(row, mediaType);
    }
    if (defaultBrowseIndexRequest) {
      const browseIndexSequenceAfter = this.getBrowseChangeSequence(input.libraryId);
      // layoutOnly is capped at BROWSE_SCOPE_MAX_ASSETS. Only memoize it as
      // a reusable ordered index when it covers the complete visible scope;
      // otherwise a library above the cap would report the truncated length
      // as its total and deep pages beyond the cap would disappear.
      if (browseIndexSequenceAfter === browseIndexSequenceBefore && rows.length === total) {
        openLibrary.browseIndexCache = {
          browseChangeSequence: browseIndexSequenceAfter,
          assetIds: rows.map((row) => row.asset_id),
        };
      } else {
        // A concurrent writer changed the scope while the full layout was
        // being read. Do not turn a mixed snapshot into a reusable index.
        openLibrary.browseIndexCache = undefined;
      }
    }
    return {
      items: [],
      total,
      offset: 0,
      layout: layout as BrowseLayoutEntry[],
    };
  }

  // Serpent-verg.2 — fill degraded defaults for whitelisted columns that
  // an older library does not have (0031 §1.1); defaults come from the
  // shared registry.
  const degradedFill: Record<string, unknown> = {
    ...degradedDefaults('assets', missingColumns(connection, 'assets', ['trashed_from_relative_path', 'trashed_from_tombstone_id'])),
    ...degradedDefaults('revisions', missingColumns(connection, 'revisions', ['byte_size', 'modified_at'])),
    ...degradedDefaults('asset_metadata', missingColumns(connection, 'asset_metadata', ['rating', 'favorite'])),
  };

  const artifactMap = this.thumbnailArtifactMap(
    input.libraryId,
    rows.map((row) => row.asset_id),
  );
  const items = this.withImageSequenceSummaries(
    openLibrary,
    rows
      .map((row) => ({ ...degradedFill, ...row }) as typeof row)
      .map((row) => {
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
  }));

  const snippets: Array<{ assetId: string; text: string }> | undefined =
    useTrigramIndex
      ? rows
          .filter((r) => r.snippet_text && r.snippet_text.length > 0)
          .map((r) => ({ assetId: r.asset_id, text: r.snippet_text! }))
      : undefined;

  return { items, total, offset, snippets };
}

/**
* Visible unit count for toasts/badges: one sequence group counts as 1,
* regardless of how many member frames were expanded for the mutation.
*/
export function countLogicalAssetUnits(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): number {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length === 0) return 0;
  const memberships = sqliteAllInChunks<
    string,
    { asset_id: string; sequence_id: string }
  >({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, sequence_id
         FROM asset_sequence_frames
        WHERE asset_id IN (${placeholders})`,
  });
  const inSequence = new Set(memberships.map((row) => row.asset_id));
  const sequences = new Set(memberships.map((row) => row.sequence_id));
  const standalone = uniqueIds.filter((id) => !inSequence.has(id)).length;
  return sequences.size + standalone;
}

/**
* Ids of the libraries this Worker currently has open.
*
* `library.open` needs these to stop the outgoing library's automatic work
* before opening its replacement: a switch arrives as `library.open` with no
* preceding `library.close` (library.open-recent.request dispatches open
* directly), so without this the outgoing library's media churn kept the single
* Worker busy and the open command starved behind it.
*/
export function listOpenLibraryIds(this: LibraryService): string[] {
  return [...this.openById.keys()];
}

export function listLibraries(this: LibraryService): InternalLibrarySummary[] {
  return [...this.openById.values()].map(({ summary }) => ({ ...summary }));
}
