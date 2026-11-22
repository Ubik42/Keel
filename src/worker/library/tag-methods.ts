import { type TagCooccurrenceGraph, type TagSummary } from "../../shared/asset-types";
import { CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES } from "../../shared/content-replace";
import { parseWritableAppearance, sanitizeEntityAppearance, type EntityAppearance } from "../../shared/entity-appearance";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { type TagOperationSkip } from "../../shared/protocol/responses";
import { randomTagAppearance } from "../../shared/tag-appearance";
import { LibraryServiceError, UUID, isMissingPathError, serviceError, type DatabaseConnection, type LibraryService, type OpenLibrary, type TagHistorySnapshot } from "../library-service";
import { columnsFor, hasTable } from "./lenient-columns";
import { type HistoryOperationReceipt, type HistoryRecipe, type HistorySource } from "./operation-history";
import { SQLITE_IN_BIND_LIMIT, sqliteAllInChunks, sqliteInChunks, sqliteInPlaceholders, sqliteRunInChunks, withSqliteInPredicate } from "./sqlite-in";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface TagMethods {
  getHumanTagRelations(...args: Parameters<typeof getHumanTagRelations>): ReturnType<typeof getHumanTagRelations>;
  applyTagRelations(...args: Parameters<typeof applyTagRelations>): ReturnType<typeof applyTagRelations>;
  recordTagRelationsHistory(...args: Parameters<typeof recordTagRelationsHistory>): ReturnType<typeof recordTagRelationsHistory>;
  getTagHistorySnapshot(...args: Parameters<typeof getTagHistorySnapshot>): ReturnType<typeof getTagHistorySnapshot>;
  assertTagHistorySnapshots(...args: Parameters<typeof assertTagHistorySnapshots>): ReturnType<typeof assertTagHistorySnapshots>;
  applyTagHistorySnapshot(...args: Parameters<typeof applyTagHistorySnapshot>): ReturnType<typeof applyTagHistorySnapshot>;
  recordTagSnapshotHistory(...args: Parameters<typeof recordTagSnapshotHistory>): ReturnType<typeof recordTagSnapshotHistory>;
  createTag(...args: Parameters<typeof createTag>): ReturnType<typeof createTag>;
  listTags(...args: Parameters<typeof listTags>): ReturnType<typeof listTags>;
  getTagAppearance(...args: Parameters<typeof getTagAppearance>): ReturnType<typeof getTagAppearance>;
  setTagAppearance(...args: Parameters<typeof setTagAppearance>): ReturnType<typeof setTagAppearance>;
  setTagParent(...args: Parameters<typeof setTagParent>): ReturnType<typeof setTagParent>;
  renameTag(...args: Parameters<typeof renameTag>): ReturnType<typeof renameTag>;
  mergeTags(...args: Parameters<typeof mergeTags>): ReturnType<typeof mergeTags>;
  getTagCooccurrenceGraph(...args: Parameters<typeof getTagCooccurrenceGraph>): ReturnType<typeof getTagCooccurrenceGraph>;
  assignTags(...args: Parameters<typeof assignTags>): ReturnType<typeof assignTags>;
  removeTags(...args: Parameters<typeof removeTags>): ReturnType<typeof removeTags>;
  fetchAssetTags(...args: Parameters<typeof fetchAssetTags>): ReturnType<typeof fetchAssetTags>;
  listTagNames(...args: Parameters<typeof listTagNames>): ReturnType<typeof listTagNames>;
  findOrCreateTagByName(...args: Parameters<typeof findOrCreateTagByName>): ReturnType<typeof findOrCreateTagByName>;
  stageManagedAssetContent(...args: Parameters<typeof stageManagedAssetContent>): ReturnType<typeof stageManagedAssetContent>;
}

export function getHumanTagRelations(this: LibraryService, input: {
    assetIds: readonly string[];
    libraryId: string;
    tagIds: readonly string[];
  }): Array<{ assetId: string; tagId: string }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.assetIds.length === 0 || input.tagIds.length === 0) return [];
  const rows: Array<{ asset_id: string; tag_id: string }> = [];
  // Two IN predicates share one SQLite statement, so split each side below
  // half the single-IN budget instead of multiplying the bind count.
  const relationChunkLimit = Math.floor((SQLITE_IN_BIND_LIMIT - 4) / 2);
  for (const assetChunk of sqliteInChunks([...new Set(input.assetIds)], relationChunkLimit)) {
    for (const tagChunk of sqliteInChunks([...new Set(input.tagIds)], relationChunkLimit)) {
      rows.push(...sqliteAllInChunks<string, { asset_id: string; tag_id: string }>({
        connection: openLibrary.connection,
        values: assetChunk,
        buildSql: (assetPlaceholders) =>
          `SELECT hat.asset_id, hat.tag_id
             FROM human_asset_tags hat
             JOIN tags t ON t.tag_id = hat.tag_id
            WHERE hat.asset_id IN (${assetPlaceholders})
              AND hat.tag_id IN (${sqliteInPlaceholders(tagChunk)})
              AND t.library_id = ?`,
        bind: (chunk) => [...chunk, ...tagChunk, input.libraryId],
      }));
    }
  }
  return rows.map((row) => ({ assetId: row.asset_id, tagId: row.tag_id }));
}

export function applyTagRelations(this: LibraryService, openLibrary: OpenLibrary, relations: readonly { assetId: string; tagId: string }[], direction: 'add' | 'remove', expectedPresent?: boolean): void {
  if (expectedPresent !== undefined) {
    const current = this.getHumanTagRelations({
      libraryId: openLibrary.summary.libraryId,
      assetIds: [...new Set(relations.map((relation) => relation.assetId))],
      tagIds: [...new Set(relations.map((relation) => relation.tagId))],
    });
    const currentKeys = new Set(current.map((relation) => `${relation.assetId}\u0000${relation.tagId}`));
    const mismatched = relations.some((relation) =>
      currentKeys.has(`${relation.assetId}\u0000${relation.tagId}`) !== expectedPresent,
    );
    if (mismatched) throw new LibraryServiceError('VERSION_CONFLICT');
  }
  const statement = direction === 'add'
    ? openLibrary.connection.prepare('INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)')
    : openLibrary.connection.prepare('DELETE FROM human_asset_tags WHERE asset_id = ? AND tag_id = ?');
  openLibrary.connection.transaction(() => {
    for (const relation of relations) statement.run(relation.assetId, relation.tagId);
  })();
  for (const assetId of new Set(relations.map((relation) => relation.assetId))) {
    this.syncAssetSearchContent(openLibrary.connection, assetId);
  }
}

export function recordTagRelationsHistory(this: LibraryService, input: {
    assetIds: readonly string[];
    changedRelations: readonly { assetId: string; tagId: string }[];
    direction: 'add' | 'remove';
    libraryId: string;
    source?: HistorySource;
    sourceReference?: string | null;
  }): HistoryOperationReceipt | null {
  if (input.changedRelations.length === 0) return null;
  const forwardKind = input.direction === 'add' ? 'tag-relations-add' : 'tag-relations-remove';
  const inverseKind = input.direction === 'add' ? 'tag-relations-remove' : 'tag-relations-add';
  return this.recordOperationHistory({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: input.direction === 'add' ? 'tag.assign' : 'tag.remove',
    labelKey: input.direction === 'add' ? 'history.tag.assign' : 'history.tag.remove',
    labelArgs: { count: input.changedRelations.length },
    affectedCount: input.changedRelations.length,
    affectedEntities: input.assetIds,
    forwardRecipe: {
      kind: forwardKind,
      version: 1,
      payload: { relations: input.changedRelations, expectedPresent: input.direction === 'remove' },
    },
    inverseRecipe: {
      kind: inverseKind,
      version: 1,
      payload: { relations: input.changedRelations, expectedPresent: input.direction === 'add' },
    },
  });
}

export function getTagHistorySnapshot(this: LibraryService, input: {
    tagIds: readonly string[];
    libraryId: string;
    allowMissing?: boolean;
  }): TagHistorySnapshot[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const ids = [...new Set(input.tagIds)];
  if (ids.length === 0) return [];
  const rows = sqliteAllInChunks<string, { tag_id: string; library_id: string; name: string }>({
    connection: openLibrary.connection,
    values: ids,
    buildSql: (placeholders) =>
      `SELECT tag_id, library_id, name FROM tags
        WHERE library_id = ? AND tag_id IN (${placeholders})`,
    bind: (chunk) => [input.libraryId, ...chunk],
  });
  if (rows.length !== ids.length && !input.allowMissing) throw new LibraryServiceError('FOLDER_NOT_FOUND');
  const relations = sqliteAllInChunks<string, { asset_id: string; tag_id: string }>({
    connection: openLibrary.connection,
    values: ids,
    buildSql: (placeholders) =>
      `SELECT asset_id, tag_id FROM human_asset_tags
        WHERE tag_id IN (${placeholders})`,
  });
  const hierarchy = hasTable(openLibrary.connection, 'tag_hierarchy')
    ? openLibrary.connection.prepare('SELECT tag_id, parent_tag_id FROM tag_hierarchy WHERE parent_tag_id IS NOT NULL').all() as Array<{ tag_id: string; parent_tag_id: string }>
    : [];
  return rows.map((row) => ({
    tagId: row.tag_id,
    libraryId: row.library_id,
    name: row.name,
    ...(this.getTagAppearance(openLibrary, row.tag_id) ? { appearance: this.getTagAppearance(openLibrary, row.tag_id) } : {}),
    ...(hierarchy.some((link) => link.tag_id === row.tag_id || link.parent_tag_id === row.tag_id) ? {
      hierarchy: { parentTagId: hierarchy.find((link) => link.tag_id === row.tag_id)?.parent_tag_id ?? null,
        childTagIds: hierarchy.filter((link) => link.parent_tag_id === row.tag_id).map((link) => link.tag_id).sort() },
    } : {}),
    humanRelations: relations
      .filter((relation) => relation.tag_id === row.tag_id)
      .map((relation) => ({ assetId: relation.asset_id, tagId: relation.tag_id })),
  }));
}

export function assertTagHistorySnapshots(this: LibraryService, value: unknown): TagHistorySnapshot[] {
  if (!Array.isArray(value)) throw new LibraryServiceError('LIBRARY_CORRUPT');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const candidate = item as Partial<TagHistorySnapshot>;
    if (
      typeof candidate.tagId !== 'string'
      || typeof candidate.libraryId !== 'string'
      || typeof candidate.name !== 'string'
      || !Array.isArray(candidate.humanRelations)
    ) throw new LibraryServiceError('LIBRARY_CORRUPT');
    return {
      tagId: candidate.tagId,
      libraryId: candidate.libraryId,
      name: candidate.name,
      ...(candidate.appearance !== undefined ? { appearance: candidate.appearance } : {}),
      ...(candidate.hierarchy ? { hierarchy: candidate.hierarchy } : {}),
      humanRelations: this.assertHistoryRelations(candidate.humanRelations),
    };
  });
}

export function applyTagHistorySnapshot(this: LibraryService, openLibrary: OpenLibrary, expected: readonly TagHistorySnapshot[], restore: readonly TagHistorySnapshot[]): void {
  const ids = [...new Set([...expected, ...restore].map((item) => item.tagId))];
  const current = ids.length === 0 ? [] : this.getTagHistorySnapshot({
    libraryId: openLibrary.summary.libraryId,
    tagIds: ids,
    allowMissing: true,
  });
  const normalized = (items: readonly TagHistorySnapshot[]) => items
    .map((item) => JSON.stringify({ ...item, humanRelations: [...item.humanRelations].sort((a, b) => `${a.assetId}:${a.tagId}`.localeCompare(`${b.assetId}:${b.tagId}`)) }))
    .sort();
  if (JSON.stringify(normalized(current)) !== JSON.stringify(normalized(expected))) {
    throw new LibraryServiceError('VERSION_CONFLICT');
  }
  const restoreIds = new Set(restore.map((item) => item.tagId));
  openLibrary.connection.transaction(() => {
    for (const item of current) {
      if (!restoreIds.has(item.tagId)) {
        openLibrary.connection.prepare('DELETE FROM tags WHERE tag_id = ? AND library_id = ?')
          .run(item.tagId, openLibrary.summary.libraryId);
      }
    }
    for (const item of restore) {
      openLibrary.connection.prepare(
        `INSERT INTO tags (tag_id, library_id, name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tag_id) DO UPDATE SET library_id = excluded.library_id, name = excluded.name`,
      ).run(item.tagId, item.libraryId, item.name, new Date().toISOString());
      openLibrary.connection.prepare('DELETE FROM human_asset_tags WHERE tag_id = ?').run(item.tagId);
      const insertRelation = openLibrary.connection.prepare(
        'INSERT INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
      );
      for (const relation of item.humanRelations) insertRelation.run(relation.assetId, relation.tagId);
    }
    for (const item of restore) this.setTagAppearance(openLibrary, item.tagId, item.appearance ?? null);
    if (hasTable(openLibrary.connection, 'tag_hierarchy')) {
      for (const item of restore) this.setTagParent(openLibrary, item.tagId, item.hierarchy?.parentTagId ?? null);
      for (const item of restore) {
        for (const childId of item.hierarchy?.childTagIds ?? []) this.setTagParent(openLibrary, childId, item.tagId);
      }
    }
  })();
  for (const item of [...expected, ...restore]) {
    for (const relation of item.humanRelations) this.syncAssetSearchContent(openLibrary.connection, relation.assetId);
  }
}

export function recordTagSnapshotHistory(this: LibraryService, input: {
    after: readonly TagHistorySnapshot[];
    before: readonly TagHistorySnapshot[];
    commandId: string;
    libraryId: string;
    labelKey: string;
    affectedCount: number;
    source?: HistorySource;
    sourceReference?: string | null;
  }): HistoryOperationReceipt {
  const recipe = (expected: readonly TagHistorySnapshot[], restore: readonly TagHistorySnapshot[]): HistoryRecipe => ({
    kind: 'tag-snapshot',
    version: 1,
    payload: { expected, restore },
  });
  return this.recordOperationHistory({
    libraryId: input.libraryId,
    source: input.source,
    sourceReference: input.sourceReference,
    commandId: input.commandId,
    labelKey: input.labelKey,
    labelArgs: { count: input.affectedCount },
    affectedCount: input.affectedCount,
    affectedEntities: input.after.map((item) => item.tagId),
    forwardRecipe: recipe(input.before, input.after),
    inverseRecipe: recipe(input.after, input.before),
  });
}

// ── Tags ──────────────────────────────────────────────────────────

export function createTag(this: LibraryService, input: { libraryId: string; name: string; parentTagId?: string | null; appearance?: EntityAppearance | null }): TagSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

  const tagId = randomUUID();
  const now = new Date().toISOString();
  try {
    openLibrary.connection.transaction(() => {
      openLibrary.connection.prepare('INSERT INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(tagId, openLibrary.summary.libraryId, trimmed, now);
      if (input.parentTagId != null) this.setTagParent(openLibrary, tagId, input.parentTagId);
      if (hasTable(openLibrary.connection, 'tag_appearance') || input.appearance !== undefined) this.setTagAppearance(openLibrary, tagId, input.appearance === undefined ? randomTagAppearance() : input.appearance);
    })();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }
  return { tagId, name: trimmed, assetCount: 0, ...(input.parentTagId ? { parentTagId: input.parentTagId } : {}), ...(this.getTagAppearance(openLibrary, tagId) ? { appearance: this.getTagAppearance(openLibrary, tagId)! } : {}) };
}

export function listTags(this: LibraryService, libraryId: string): TagSummary[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // lenient read (0031 §1): libraries predating the tag
  // tables degrade to an empty tag list; missing asset-tag join tables
  // just drop that side of the count; a missing created_at sorts by name.
  const connection = openLibrary.connection;
  if (!hasTable(connection, 'tags')) return [];
  const tagColumns = columnsFor(connection, 'tags');
  const hasCreatedAt = tagColumns.has('created_at');
  const tagUseSubqueries = [
    hasTable(connection, 'human_asset_tags')
      ? 'SELECT asset_id, tag_id FROM human_asset_tags'
      : null,
    hasTable(connection, 'ai_asset_tags')
      ? 'SELECT asset_id, tag_id FROM ai_asset_tags'
      : null,
  ].filter((sql): sql is string => sql !== null);
  const usedJoin = tagUseSubqueries.length > 0
    ? `LEFT JOIN (${tagUseSubqueries.join(' UNION ')}) used ON used.tag_id = t.tag_id`
    : '';
  const groupBy = hasCreatedAt
    ? 'GROUP BY t.tag_id, t.name, t.created_at'
    : 'GROUP BY t.tag_id, t.name';
  const orderBy = hasCreatedAt ? 'ORDER BY t.created_at DESC, t.name' : 'ORDER BY t.name';
  const rows = connection
    .prepare(
      `SELECT t.tag_id, t.name,
              COUNT(used.asset_id) AS asset_count
         FROM tags t
         ${usedJoin}
        WHERE t.library_id = ?
        ${groupBy}
        ${orderBy}`,
    )
    .all(openLibrary.summary.libraryId) as Array<{
      tag_id: string;
      name: string;
      asset_count: number;
    }>;
  const appearances = new Map<string, EntityAppearance>();
  if (hasTable(connection, 'tag_appearance')) {
    const stored = connection.prepare('SELECT tag_id, appearance_json FROM tag_appearance').all() as Array<{ tag_id: string; appearance_json: string }>;
    for (const item of stored) { try { const appearance = sanitizeEntityAppearance(JSON.parse(item.appearance_json)); if (appearance) appearances.set(item.tag_id, appearance); } catch { /* Ignore malformed appearance metadata. */ } }
  }
  const tags: TagSummary[] = rows.map((row) => ({ tagId: row.tag_id, name: row.name, assetCount: row.asset_count,
    ...(appearances.has(row.tag_id) ? { appearance: appearances.get(row.tag_id)! } : {}) }));
  if (!hasTable(connection, 'tag_hierarchy')) return tags;
  const links = connection.prepare('SELECT tag_id, parent_tag_id FROM tag_hierarchy WHERE parent_tag_id IS NOT NULL')
    .all() as Array<{ tag_id: string; parent_tag_id: string }>;
  if (links.length === 0) return tags;
  const parents = new Map(links.map((link) => [link.tag_id, link.parent_tag_id]));
  const counts = tagUseSubqueries.length === 0 ? [] : connection.prepare(`
    WITH RECURSIVE descendants(root, id) AS (
      SELECT tag_id, tag_id FROM tags WHERE library_id = ?
      UNION
      SELECT d.root, h.tag_id FROM descendants d JOIN tag_hierarchy h ON h.parent_tag_id = d.id
    )
    SELECT d.root, COUNT(DISTINCT used.asset_id) AS count FROM descendants d
    LEFT JOIN (${tagUseSubqueries.join(' UNION ')}) used ON used.tag_id = d.id GROUP BY d.root
  `).all(libraryId) as Array<{ root: string; count: number }>;
  const subtreeCounts = new Map(counts.map((row) => [row.root, row.count]));
  return tags.map((tag) => ({ ...tag, ...(parents.has(tag.tagId) ? { parentTagId: parents.get(tag.tagId)! } : {}),
    subtreeAssetCount: subtreeCounts.get(tag.tagId) ?? 0 }));
}

export function getTagAppearance(this: LibraryService, openLibrary: OpenLibrary, tagId: string): EntityAppearance | null {
  if (!hasTable(openLibrary.connection, 'tag_appearance')) return null;
  const row = openLibrary.connection.prepare('SELECT appearance_json FROM tag_appearance WHERE tag_id = ?').get(tagId) as { appearance_json: string } | undefined;
  try { return row ? sanitizeEntityAppearance(JSON.parse(row.appearance_json)) : null; } catch { return null; }
}

export function setTagAppearance(this: LibraryService, openLibrary: OpenLibrary, tagId: string, value: EntityAppearance | null): void {
  const parsed = parseWritableAppearance(value);
  if (!parsed.ok) throw new LibraryServiceError('INVALID_APPEARANCE');
  if (!hasTable(openLibrary.connection, 'tag_appearance')) {
    if (parsed.appearance) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
    return;
  }
  if (parsed.appearance) openLibrary.connection.prepare('INSERT INTO tag_appearance(tag_id, appearance_json) VALUES (?, ?) ON CONFLICT(tag_id) DO UPDATE SET appearance_json = excluded.appearance_json').run(tagId, JSON.stringify(parsed.appearance));
  else openLibrary.connection.prepare('DELETE FROM tag_appearance WHERE tag_id = ?').run(tagId);
}

export function setTagParent(this: LibraryService, openLibrary: OpenLibrary, tagId: string, parentTagId: string | null): void {
  if (!hasTable(openLibrary.connection, 'tag_hierarchy')) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  if (parentTagId !== null) {
    const parent = openLibrary.connection.prepare('SELECT tag_id FROM tags WHERE tag_id = ? AND library_id = ?')
      .get(parentTagId, openLibrary.summary.libraryId);
    if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    const seen = new Set<string>([tagId]);
    let cursor: string | null = parentTagId;
    while (cursor !== null) {
      if (seen.has(cursor)) throw new LibraryServiceError('TAG_HIERARCHY_CYCLE');
      seen.add(cursor);
      const row = openLibrary.connection.prepare('SELECT parent_tag_id FROM tag_hierarchy WHERE tag_id = ?')
        .get(cursor) as { parent_tag_id: string | null } | undefined;
      cursor = row?.parent_tag_id ?? null;
    }
    openLibrary.connection.prepare('INSERT INTO tag_hierarchy(tag_id, parent_tag_id) VALUES (?, ?) ON CONFLICT(tag_id) DO UPDATE SET parent_tag_id = excluded.parent_tag_id')
      .run(tagId, parentTagId);
  } else openLibrary.connection.prepare('DELETE FROM tag_hierarchy WHERE tag_id = ?').run(tagId);
}

export function renameTag(this: LibraryService, input: { libraryId: string; tagId: string; name: string; parentTagId?: string | null; appearance?: EntityAppearance | null }): TagSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

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

  try {
    openLibrary.connection.transaction(() => {
      if (input.parentTagId !== undefined) this.setTagParent(openLibrary, input.tagId, input.parentTagId);
      if (input.appearance !== undefined) this.setTagAppearance(openLibrary, input.tagId, input.appearance);
      openLibrary.connection
        .prepare('UPDATE tags SET name = ? WHERE tag_id = ?')
        .run(trimmed, input.tagId);
      for (const { asset_id: assetId } of affectedAssets) {
        this.syncAssetSearchContent(openLibrary.connection, assetId);
      }
    })();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
    }
    throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
  }

  this.emitClientAssetsChanged(input.libraryId, affectedAssets.length);
  const countRow = openLibrary.connection
    .prepare(
      `SELECT COUNT(*) AS count
         FROM (
           SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
           UNION
           SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?
         )`,
    )
    .get(input.tagId, input.tagId) as { count: number };
  const parent = hasTable(openLibrary.connection, 'tag_hierarchy')
    ? openLibrary.connection.prepare('SELECT parent_tag_id FROM tag_hierarchy WHERE tag_id = ?').get(input.tagId) as { parent_tag_id: string | null } | undefined
    : undefined;
  return { tagId: input.tagId, name: trimmed, assetCount: countRow.count, ...(parent?.parent_tag_id ? { parentTagId: parent.parent_tag_id } : {}), ...(this.getTagAppearance(openLibrary, input.tagId) ? { appearance: this.getTagAppearance(openLibrary, input.tagId) } : {}) };
}

/**
* Merge multiple tags into a newly named tag (REQ-TAG-012b).
* All human/AI links from source tags move to the new tag; sources are removed.
*/
export function mergeTags(this: LibraryService, input: {
    libraryId: string;
    sourceTagIds: string[];
    name: string;
  }): TagSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

  const sourceTagIds = [...new Set(input.sourceTagIds)];
  if (sourceTagIds.length < 2) {
    throw new LibraryServiceError('INVALID_FOLDER_NAME');
  }

  const tagRows = withSqliteInPredicate(
    openLibrary.connection,
    'tag_id',
    sourceTagIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT tag_id FROM tags WHERE ${sql} AND library_id = ?`,
        )
        .all(...params, openLibrary.summary.libraryId) as Array<{
        tag_id: string;
      }>,
  );
  if (tagRows.length !== sourceTagIds.length) {
    throw new LibraryServiceError('FOLDER_NOT_FOUND');
  }

  const newTagId = randomUUID();
  const now = new Date().toISOString();
  const affectedAssets = withSqliteInPredicate(
    openLibrary.connection,
    'tag_id',
    sourceTagIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT DISTINCT asset_id FROM (
             SELECT asset_id FROM human_asset_tags WHERE ${sql}
             UNION
             SELECT asset_id FROM ai_asset_tags WHERE ${sql}
           )`,
        )
        .all(...params, ...params) as Array<{ asset_id: string }>,
  );

  try {
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          'INSERT INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(newTagId, openLibrary.summary.libraryId, trimmed, now);
      if (hasTable(openLibrary.connection, 'tag_appearance')) this.setTagAppearance(openLibrary, newTagId, randomTagAppearance());

      const insertHuman = openLibrary.connection.prepare(
        'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
      );
      for (const { asset_id: assetId } of affectedAssets) {
        insertHuman.run(assetId, newTagId);
      }

      sqliteRunInChunks({
        connection: openLibrary.connection,
        values: sourceTagIds,
        buildSql: (placeholders) =>
          `DELETE FROM human_asset_tags WHERE tag_id IN (${placeholders})`,
      });
      sqliteRunInChunks({
        connection: openLibrary.connection,
        values: sourceTagIds,
        buildSql: (placeholders) =>
          `DELETE FROM ai_asset_tags WHERE tag_id IN (${placeholders})`,
      });
      sqliteRunInChunks({
        connection: openLibrary.connection,
        values: sourceTagIds,
        buildSql: (placeholders) =>
          `DELETE FROM tags WHERE tag_id IN (${placeholders})`,
      });

      for (const { asset_id: assetId } of affectedAssets) {
        this.syncAssetSearchContent(openLibrary.connection, assetId);
      }
    })();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }

  this.emitClientAssetsChanged(input.libraryId, affectedAssets.length);
  const countRow = openLibrary.connection
    .prepare(
      `SELECT COUNT(*) AS count
         FROM (
           SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
           UNION
           SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?
         )`,
    )
    .get(newTagId, newTagId) as { count: number };
  return { tagId: newTagId, name: trimmed, assetCount: countRow.count };
}

/**
* Tag co-occurrence graph for the management graph view.
* Limits node/edge counts for large libraries; edges are undirected (a < b).
*/
export function getTagCooccurrenceGraph(this: LibraryService, input: {
    libraryId: string;
    minWeight?: number;
    maxNodes?: number;
    maxEdges?: number;
  }): TagCooccurrenceGraph {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const minWeight = Math.max(1, input.minWeight ?? 1);
  const maxNodes = Math.min(Math.max(1, input.maxNodes ?? 200), 500);
  const maxEdges = Math.min(Math.max(1, input.maxEdges ?? 500), 2_000);

  const totalTags = openLibrary.connection
    .prepare('SELECT COUNT(*) AS count FROM tags WHERE library_id = ?')
    .get(openLibrary.summary.libraryId) as { count: number };

  const nodeRows = openLibrary.connection
    .prepare(
      `SELECT t.tag_id, t.name,
              COUNT(DISTINCT used.asset_id) AS asset_count
         FROM tags t
         LEFT JOIN (
           SELECT asset_id, tag_id FROM human_asset_tags
           UNION
           SELECT asset_id, tag_id FROM ai_asset_tags
         ) used ON used.tag_id = t.tag_id
        WHERE t.library_id = ?
        GROUP BY t.tag_id, t.name
        ORDER BY asset_count DESC, t.name COLLATE NOCASE
        LIMIT ?`,
    )
    .all(openLibrary.summary.libraryId, maxNodes) as Array<{
    tag_id: string;
    name: string;
    asset_count: number;
  }>;

  const nodes = nodeRows.map((row) => ({
    tagId: row.tag_id,
    name: row.name,
    assetCount: row.asset_count,
  }));

  if (nodes.length < 2) {
    return { nodes, edges: [], truncated: totalTags.count > nodes.length };
  }

  const nodeIds = nodes.map((node) => node.tagId);
  const useTable = nodeIds.length * 2 > SQLITE_IN_BIND_LIMIT;
  const edgeRows = withSqliteInPredicate(
    openLibrary.connection,
    'u1.tag_id',
    nodeIds,
    (leftSql, leftParams) =>
      withSqliteInPredicate(
        openLibrary.connection,
        'u2.tag_id',
        nodeIds,
        (rightSql, rightParams) =>
          openLibrary.connection
            .prepare(
              `WITH tag_usage AS (
                 SELECT DISTINCT asset_id, tag_id FROM human_asset_tags
                 UNION
                 SELECT DISTINCT asset_id, tag_id FROM ai_asset_tags
               )
               SELECT u1.tag_id AS tag_a, u2.tag_id AS tag_b,
                      COUNT(DISTINCT u1.asset_id) AS weight
                 FROM tag_usage u1
                 JOIN tag_usage u2
                   ON u1.asset_id = u2.asset_id
                  AND u1.tag_id < u2.tag_id
                WHERE ${leftSql}
                  AND ${rightSql}
                GROUP BY u1.tag_id, u2.tag_id
               HAVING weight >= ?
                ORDER BY weight DESC
                LIMIT ?`,
            )
            .all(...leftParams, ...rightParams, minWeight, maxEdges) as Array<{
            tag_a: string;
            tag_b: string;
            weight: number;
          }>,
        { forceTable: useTable },
      ),
    { forceTable: useTable },
  );

  const edges = edgeRows.map((row) => ({
    sourceTagId: row.tag_a,
    targetTagId: row.tag_b,
    weight: row.weight,
  }));

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.sourceTagId);
    connectedIds.add(edge.targetTagId);
  }
  const visibleNodes =
    edges.length === 0
      ? nodes
      : nodes.filter((node) => connectedIds.has(node.tagId));

  return {
    nodes: visibleNodes,
    edges,
    truncated:
      totalTags.count > maxNodes || edgeRows.length >= maxEdges,
  };
}

export function assignTags(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { assignedCount: number; skipped: TagOperationSkip[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);

  const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
    openLibrary.connection,
    input.assetIds,
  );

  const tagRows = sqliteAllInChunks<string, { tag_id: string }>({
    connection: openLibrary.connection,
    values: input.tagIds,
    buildSql: (placeholders) =>
      `SELECT tag_id FROM tags WHERE tag_id IN (${placeholders}) AND library_id = ?`,
    bind: (chunk) => [...chunk, openLibrary.summary.libraryId],
  });
  if (tagRows.length !== input.tagIds.length) throw new LibraryServiceError('FOLDER_NOT_FOUND');

  let assignedCount = 0;
  const insertStmt = openLibrary.connection.prepare(
    'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
  );
  openLibrary.connection.transaction(() => {
    for (const assetId of eligibleAssetIds) {
      for (const tagId of input.tagIds) {
        const result = insertStmt.run(assetId, tagId);
        assignedCount += result.changes;
      }
    }
  })();
  for (const assetId of eligibleAssetIds) {
    this.syncAssetSearchContent(openLibrary.connection, assetId);
  }
  this.emitClientAssetsChanged(input.libraryId, assignedCount);
  return { assignedCount, skipped };
}

export function removeTags(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { removedCount: number; skipped: TagOperationSkip[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);

  const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
    openLibrary.connection,
    input.assetIds,
  );
  if (eligibleAssetIds.length === 0) return { removedCount: 0, skipped };

  let removedCount = 0;
  const relationChunkLimit = Math.floor((SQLITE_IN_BIND_LIMIT - 4) / 2);
  for (const assetChunk of sqliteInChunks(eligibleAssetIds, relationChunkLimit)) {
    for (const tagChunk of sqliteInChunks(input.tagIds, relationChunkLimit)) {
      const bind = (chunk: readonly string[]) => [
        ...chunk,
        ...tagChunk,
      ];
      // removing a chip must also clear AI-authored tag links.
      removedCount += sqliteRunInChunks({
        connection: openLibrary.connection,
        values: assetChunk,
        buildSql: (placeholders) =>
          `DELETE FROM human_asset_tags
             WHERE asset_id IN (${placeholders})
               AND tag_id IN (${sqliteInPlaceholders(tagChunk)})`,
        bind,
      });
      removedCount += sqliteRunInChunks({
        connection: openLibrary.connection,
        values: assetChunk,
        buildSql: (placeholders) =>
          `DELETE FROM ai_asset_tags
             WHERE asset_id IN (${placeholders})
               AND tag_id IN (${sqliteInPlaceholders(tagChunk)})`,
        bind,
      });
    }
  }
  for (const assetId of eligibleAssetIds) {
    if (removedCount > 0) this.syncAssetSearchContent(openLibrary.connection, assetId);
  }
  this.emitClientAssetsChanged(input.libraryId, removedCount);
  return { removedCount, skipped };
}

/** Return tags assigned to an asset from both human and AI sources. */
export function fetchAssetTags(this: LibraryService, connection: DatabaseConnection, assetId: string): Array<{ id: string; name: string; source: 'user' | 'ai' }> {
  const rows = connection
    .prepare(
      `WITH assigned_tags AS (
         SELECT t.tag_id, t.name, 1 AS is_user
           FROM tags t
           JOIN human_asset_tags hat ON hat.tag_id = t.tag_id
          WHERE hat.asset_id = ?
         UNION ALL
         SELECT t.tag_id, t.name, 0 AS is_user
           FROM tags t
           JOIN ai_asset_tags aat ON aat.tag_id = t.tag_id
          WHERE aat.asset_id = ?
       )
       SELECT tag_id, name,
              CASE WHEN MAX(is_user) = 1 THEN 'user' ELSE 'ai' END AS source
         FROM assigned_tags
        GROUP BY tag_id, name
        ORDER BY name COLLATE NOCASE`,
    )
    .all(assetId, assetId) as Array<{
      tag_id: string;
      name: string;
      source: 'user' | 'ai';
    }>;
  return rows.map((r) => ({ id: r.tag_id, name: r.name, source: r.source }));
}

/** List all tag names in a library for AI tag-reuse hinting. */
export function listTagNames(this: LibraryService, libraryId: string): string[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection
    .prepare('SELECT name FROM tags WHERE library_id = ? ORDER BY name')
    .all(openLibrary.summary.libraryId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function findOrCreateTagByName(this: LibraryService, openLibrary: OpenLibrary, name: string): TagSummary {
  const existing = openLibrary.connection
    .prepare('SELECT tag_id, name FROM tags WHERE library_id = ? AND name = ?')
    .get(openLibrary.summary.libraryId, name) as { tag_id: string; name: string } | undefined;
  if (existing) {
    return { tagId: existing.tag_id, name: existing.name, assetCount: 0 };
  }
  try {
    return this.createTag({ libraryId: openLibrary.summary.libraryId, name });
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'FOLDER_ALREADY_EXISTS') {
      const retry = openLibrary.connection
        .prepare('SELECT tag_id, name FROM tags WHERE library_id = ? AND name = ?')
        .get(openLibrary.summary.libraryId, name) as { tag_id: string; name: string } | undefined;
      if (retry) return { tagId: retry.tag_id, name: retry.name, assetCount: 0 };
    }
    throw error;
  }
}

/**
* Append one bounded chunk to a Worker-owned content staging entry. The
* token is opaque to callers and never resolves to a filesystem path.
*/
export function stageManagedAssetContent(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    stagingToken?: string;
    dataBase64: string;
    complete: boolean;
  }): {
    assetId: string;
    stagingToken: string;
    byteSize: number;
    complete: boolean;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (
    input.dataBase64.length === 0
    || input.dataBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.dataBase64)
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  const payload = Buffer.from(input.dataBase64, 'base64');
  if (payload.length === 0 || payload.length > CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  const row = openLibrary.connection
    .prepare(`SELECT asset_id, location_kind, linked_folder_id, availability, deleted_at, current_revision_id
         FROM assets WHERE asset_id = ?`)
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
      current_revision_id: string | null;
    } | undefined;
  if (
    !row ||
    row.availability !== 'available' ||
    row.deleted_at !== null ||
    row.current_revision_id === null
  ) {
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

  const stagingToken = input.stagingToken ?? randomUUID();
  if (!UUID.test(stagingToken)) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  const stagingRoot = libraryMetaDir(openLibrary.summary.libraryPath, 'content-staging');
  mkdirSync(stagingRoot, { recursive: true });
  const stagedPath = path.join(stagingRoot, `${stagingToken}.bin`);
  const metadataPath = path.join(stagingRoot, `${stagingToken}.json`);
  let metadata: { assetId: string; byteSize: number; complete: boolean } | undefined;
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('assetId' in parsed) ||
      typeof parsed.assetId !== 'string' ||
      !('byteSize' in parsed) ||
      typeof parsed.byteSize !== 'number' ||
      !Number.isSafeInteger(parsed.byteSize) ||
      !('complete' in parsed) ||
      typeof parsed.complete !== 'boolean'
    ) {
      throw new Error('Invalid content staging metadata.');
    }
    metadata = {
      assetId: parsed.assetId,
      byteSize: parsed.byteSize,
      complete: parsed.complete,
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
  }
  if (metadata !== undefined && metadata.assetId !== input.assetId) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  if (metadata?.complete === true) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  let existingByteSize = metadata?.byteSize ?? 0;
  let stagedByteSize: number | undefined;
  try {
    const entry = lstatSync(stagedPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const byteSize = Number(entry.size);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    stagedByteSize = byteSize;
    if (metadata === undefined) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    if (!isMissingPathError(error)) throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    if (metadata !== undefined) throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  if (metadata !== undefined && stagedByteSize !== metadata.byteSize) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const descriptor = openSync(stagedPath, 'a', 0o600);
  try {
    writeSync(descriptor, payload);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  existingByteSize += payload.length;
  const nextMetadata = JSON.stringify({
    assetId: input.assetId,
    byteSize: existingByteSize,
    complete: input.complete,
  });
  const metadataTempPath = `${metadataPath}.tmp-${randomUUID()}`;
  try {
    writeFileSync(metadataTempPath, nextMetadata, { encoding: 'utf8', mode: 0o600 });
    renameSync(metadataTempPath, metadataPath);
  } catch (error) {
    rmSync(metadataTempPath, { force: true });
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  return {
    assetId: input.assetId,
    stagingToken,
    byteSize: existingByteSize,
    complete: input.complete,
  };
}
