import { sanitizeAiDescription } from "../../shared/ai-analysis-settings";
import { type AssetSummary } from "../../shared/asset-types";
import { IMAGE_EXTENSIONS, MODEL_EXTENSIONS, VIDEO_EXTENSIONS } from "../../shared/media-formats";
import { randomTagAppearance } from "../../shared/tag-appearance";
import { DISPLAY_PREVIEW_KIND_SQL, LibraryService, LibraryServiceError, buildFileName, type OpenLibrary } from "../library-service";
import { hasTable, selectColumns } from "../library/lenient-columns";
import { sqliteInPlaceholders, withSqliteInPredicate } from "../library/sqlite-in";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface AiMethods {
  listTagNamesForAiPrompt(...args: Parameters<typeof listTagNamesForAiPrompt>): ReturnType<typeof listTagNamesForAiPrompt>;
  writeAiAnalysisResult(...args: Parameters<typeof writeAiAnalysisResult>): ReturnType<typeof writeAiAnalysisResult>;
  getAiContent(...args: Parameters<typeof getAiContent>): ReturnType<typeof getAiContent>;
  listAiTagNames(...args: Parameters<typeof listAiTagNames>): ReturnType<typeof listAiTagNames>;
  getAiTagModelVersion(...args: Parameters<typeof getAiTagModelVersion>): ReturnType<typeof getAiTagModelVersion>;
  clearAiContent(...args: Parameters<typeof clearAiContent>): ReturnType<typeof clearAiContent>;
  pendingAiAssets(...args: Parameters<typeof pendingAiAssets>): ReturnType<typeof pendingAiAssets>;
  enqueueAiAnalysisJobs(...args: Parameters<typeof enqueueAiAnalysisJobs>): ReturnType<typeof enqueueAiAnalysisJobs>;
  claimNextAiJob(...args: Parameters<typeof claimNextAiJob>): ReturnType<typeof claimNextAiJob>;
  completeAiJob(...args: Parameters<typeof completeAiJob>): ReturnType<typeof completeAiJob>;
  getAiJobState(...args: Parameters<typeof getAiJobState>): ReturnType<typeof getAiJobState>;
  failAiJob(...args: Parameters<typeof failAiJob>): ReturnType<typeof failAiJob>;
  recoverInterruptedAiJobs(...args: Parameters<typeof recoverInterruptedAiJobs>): ReturnType<typeof recoverInterruptedAiJobs>;
  getAiJobStatus(...args: Parameters<typeof getAiJobStatus>): ReturnType<typeof getAiJobStatus>;
  getSemanticAssetSources(...args: Parameters<typeof getSemanticAssetSources>): ReturnType<typeof getSemanticAssetSources>;
}

/**
* F8: up to 100 tag names for the analysis prompt.
* Prefer tags used on assets in `folderId` (that folder only, no children),
* then tags by library-wide usage count.
*/
export function listTagNamesForAiPrompt(this: LibraryService, libraryId: string, folderId: string | null | undefined, limit = 100): string[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const capped = Math.min(100, Math.max(1, limit));
  const conn = openLibrary.connection;
  const libId = openLibrary.summary.libraryId;

  const usageRows = conn
    .prepare(
      `SELECT t.name AS name, COUNT(*) AS usage_count
         FROM tags t
         LEFT JOIN human_asset_tags hat ON hat.tag_id = t.tag_id
         LEFT JOIN ai_asset_tags aat ON aat.tag_id = t.tag_id
        WHERE t.library_id = ?
        GROUP BY t.tag_id
        ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC`,
    )
    .all(libId) as Array<{ name: string; usage_count: number }>;

  if (!folderId) {
    return usageRows.slice(0, capped).map((row) => row.name);
  }

  const folderRows = conn
    .prepare(
      `SELECT t.name AS name, COUNT(*) AS usage_count
         FROM tags t
         INNER JOIN (
           SELECT hat.tag_id AS tag_id FROM human_asset_tags hat
             INNER JOIN assets a ON a.asset_id = hat.asset_id
            WHERE a.managed_folder_id = ?
           UNION ALL
           SELECT aat.tag_id AS tag_id FROM ai_asset_tags aat
             INNER JOIN assets a ON a.asset_id = aat.asset_id
            WHERE a.managed_folder_id = ?
         ) uses ON uses.tag_id = t.tag_id
        WHERE t.library_id = ?
        GROUP BY t.tag_id
        ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC`,
    )
    .all(folderId, folderId, libId) as Array<{ name: string }>;

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of folderRows) {
    if (seen.has(row.name.toLowerCase())) continue;
    seen.add(row.name.toLowerCase());
    ordered.push(row.name);
    if (ordered.length >= capped) return ordered;
  }
  for (const row of usageRows) {
    if (seen.has(row.name.toLowerCase())) continue;
    seen.add(row.name.toLowerCase());
    ordered.push(row.name);
    if (ordered.length >= capped) break;
  }
  return ordered;
}

/**
* Atomically write AI-generated content for an asset.
* For tags: find-or-create by NOCASE name, then INSERT OR IGNORE into ai_asset_tags.
* For description/rating: DELETE old row(s) + INSERT new row in ai_content
*   (one row per (asset_id, field_name)). Never writes human asset_metadata.rating.
* After writing, sync the asset's FTS search content.
*/
export function writeAiAnalysisResult(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    description?: string;
    tags?: string[];
    /** Aesthetic score 1–5 as string or number; AI layer only. */
    rating?: number | string | null;
    modelId: string;
    modelVersion: string;
    guardJobId?: string;
    enabledFields: {
      description: boolean;
      tags: boolean;
      rating: boolean;
    };
  }): { tagsWritten: string[]; fieldsWritten: string[]; committed: boolean } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const now = new Date().toISOString();
  const tagsWritten: string[] = [];
  const fieldsWritten: string[] = [];

  const revisionRow = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(input.assetId) as { current_revision_id: string | null } | undefined;
  const revisionId = revisionRow?.current_revision_id ?? null;

  const committed = openLibrary.connection.transaction(() => {
    if (input.guardJobId) {
      const job = openLibrary.connection.prepare(
        "SELECT status FROM jobs WHERE library_id = ? AND job_id = ? AND status = 'running'",
      ).get(openLibrary.summary.libraryId, input.guardJobId);
      if (!job) return false;
    }
    // A successful analysis replaces the complete enabled AI layer. Clear
    // old tags even when the provider returns an empty list so stale model
    // output cannot survive a re-analysis.
    if (input.enabledFields.tags) {
      openLibrary.connection
        .prepare('DELETE FROM ai_asset_tags WHERE asset_id = ?')
        .run(input.assetId);
    }
    if (input.enabledFields.tags && input.tags && input.tags.length > 0) {
      const findTag = openLibrary.connection.prepare(
        'SELECT tag_id, name FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE',
      );
      const insertTag = openLibrary.connection.prepare(
        'INSERT OR IGNORE INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
      );
      const insertAiTag = openLibrary.connection.prepare(
        `INSERT OR IGNORE INTO ai_asset_tags
           (asset_id, tag_id, revision_id, model_id, model_version)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const tagName of input.tags) {
        const trimmed = tagName.trim();
        if (trimmed.length === 0) continue;

        let tag = findTag.get(openLibrary.summary.libraryId, trimmed) as
          | { tag_id: string; name: string }
          | undefined;
        if (!tag) {
          const tagId = randomUUID();
          insertTag.run(tagId, openLibrary.summary.libraryId, trimmed, now);
          if (hasTable(openLibrary.connection, 'tag_appearance')) this.setTagAppearance(openLibrary, tagId, randomTagAppearance());
          tag = { tag_id: tagId, name: trimmed };
        }

        insertAiTag.run(
          input.assetId,
          tag.tag_id,
          revisionId,
          input.modelId,
          input.modelVersion,
        );
        tagsWritten.push(trimmed);
      }
    }

    // Description / rating: DELETE old row(s) + INSERT when enabled.
    const deleteOld = openLibrary.connection.prepare(
      'DELETE FROM ai_content WHERE asset_id = ? AND field_name = ?',
    );
    const insertContent = openLibrary.connection.prepare(
      `INSERT INTO ai_content
         (ai_content_id, asset_id, revision_id, field_name, value,
          model_id, model_version, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const writeField = (fieldName: string, value: string): void => {
      insertContent.run(
        randomUUID(),
        input.assetId,
        revisionId,
        fieldName,
        value,
        input.modelId,
        input.modelVersion,
        now,
      );
      fieldsWritten.push(fieldName);
    };

    if (input.enabledFields.description) {
      deleteOld.run(input.assetId, 'description');
    }
    if (input.enabledFields.rating) {
      deleteOld.run(input.assetId, 'rating');
    }

    if (
      input.enabledFields.description &&
      input.description !== undefined
    ) {
      const cleaned = sanitizeAiDescription(input.description);
      if (cleaned.length > 0) {
        writeField('description', cleaned);
      }
    }

    if (input.enabledFields.rating && input.rating != null) {
      const score =
        typeof input.rating === 'number'
          ? input.rating
          : Number.parseInt(String(input.rating).trim(), 10);
      if (Number.isInteger(score) && score >= 1 && score <= 5) {
        writeField('rating', String(score));
      }
    }
    return true;
  })();

  if (committed) {
    this.syncAssetSearchContent(openLibrary.connection, input.assetId);
    this.emitClientAssetsChanged(input.libraryId, 1);
  }

  return { tagsWritten, fieldsWritten, committed };
}

/** Retrieve current AI content rows for an asset. */
export function getAiContent(this: LibraryService, libraryId: string, assetId: string): Array<{
    fieldName: string;
    value: string;
    modelId: string;
    modelVersion: string;
    generatedAt: string;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // Serpent-verg.2 — lenient read (0031 §1): libraries predating ai_content
  // have no AI content; the whitelisted columns fill with empty strings.
  const connection = openLibrary.connection;
  const present = hasTable(connection, 'ai_content')
    ? selectColumns(connection, 'ai_content', [
        'field_name',
        'value',
        'model_id',
        'model_version',
        'generated_at',
      ])
    : [];
  const rows = present.length === 0
    ? []
    : connection
        .prepare(
          `SELECT ${present.join(', ')}
             FROM ai_content
            WHERE asset_id = ?
            ORDER BY ${present.includes('field_name') ? 'field_name' : 'rowid'}`,
        )
        .all(assetId) as Array<{
          field_name?: string;
          value?: string;
          model_id?: string;
          model_version?: string;
          generated_at?: string;
        }>;
  return rows.map((r) => ({
    fieldName: r.field_name ?? '',
    value: r.value ?? '',
    modelId: r.model_id ?? '',
    modelVersion: r.model_version ?? '',
    generatedAt: r.generated_at ?? '',
  }));
}

/** AI-layer tag names for an asset (ordered by name). */
export function listAiTagNames(this: LibraryService, libraryId: string, assetId: string): string[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection
    .prepare(
      `SELECT t.name AS name
         FROM ai_asset_tags aat
         JOIN tags t ON t.tag_id = aat.tag_id
        WHERE aat.asset_id = ?
        ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(assetId) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** Latest model_version stamped on AI tags for this asset, if any. */
export function getAiTagModelVersion(this: LibraryService, libraryId: string, assetId: string): string | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT model_version
         FROM ai_asset_tags
        WHERE asset_id = ?
        ORDER BY rowid DESC
        LIMIT 1`,
    )
    .get(assetId) as { model_version: string } | undefined;
  return row?.model_version ?? null;
}

/**
* Clear AI content for a scope of assets. Only deletes rows from
* `ai_content` and `ai_asset_tags`; never touches human content,
* human_asset_tags, or Tag entities. After clearing, re-syncs FTS.
*/
export function clearAiContent(this: LibraryService, input: {
    libraryId: string;
    scope: {
      kind: 'asset' | 'selection' | 'folder' | 'library';
      assetIds?: string[];
      folderId?: string;
    };
    confirm: boolean;
    /** Omit to clear every AI layer; otherwise only the listed layers. */
    fields?: Array<'description' | 'rating' | 'tags'>;
  }): { clearedCount: number; affectedAssetIds: string[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  // Batch operations require confirmation.
  if (
    (input.scope.kind === 'library' || input.scope.kind === 'folder') &&
    !input.confirm
  ) {
    throw new LibraryServiceError('CONFIRMATION_REQUIRED');
  }

  const conn = openLibrary.connection;

  // Gather target asset IDs based on scope.
  let targetAssetIds: string[];
  switch (input.scope.kind) {
    case 'asset':
    case 'selection':
      targetAssetIds = input.scope.assetIds ?? [];
      break;
    case 'folder': {
      if (!input.scope.folderId) {
        throw new LibraryServiceError('INVALID_SELECTION');
      }
      // Recursive: get all assets under this folder (assets.managed_folder_id).
      const folderRows = conn
        .prepare(
          `WITH RECURSIVE subfolders AS (
             SELECT folder_id FROM managed_folders WHERE folder_id = ?
             UNION ALL
             SELECT mf.folder_id
               FROM managed_folders mf
               JOIN subfolders sf ON mf.parent_folder_id = sf.folder_id
           )
           SELECT a.asset_id
             FROM assets a
            WHERE a.managed_folder_id IN (SELECT folder_id FROM subfolders)`,
        )
        .all(input.scope.folderId) as Array<{ asset_id: string }>;
      targetAssetIds = folderRows.map((r) => r.asset_id);
      break;
    }
    case 'library': {
      const allRows = conn
        .prepare('SELECT asset_id FROM assets')
        .all() as Array<{ asset_id: string }>;
      targetAssetIds = allRows.map((r) => r.asset_id);
      break;
    }
    default:
      throw new LibraryServiceError('INTERNAL_ERROR');
  }

  if (targetAssetIds.length === 0) {
    return { clearedCount: 0, affectedAssetIds: [] };
  }

  const clearAll = !input.fields || input.fields.length === 0;
  const clearDescription = clearAll || input.fields!.includes('description');
  const clearRating = clearAll || input.fields!.includes('rating');
  const clearTags = clearAll || input.fields!.includes('tags');

  const deleteAiField = conn.prepare(
    'DELETE FROM ai_content WHERE asset_id = ? AND field_name = ?',
  );
  const deleteAllAiContent = conn.prepare(
    'DELETE FROM ai_content WHERE asset_id = ?',
  );
  const deleteAiTags = conn.prepare(
    'DELETE FROM ai_asset_tags WHERE asset_id = ?',
  );

  conn.transaction(() => {
    for (const assetId of targetAssetIds) {
      if (clearAll) {
        deleteAllAiContent.run(assetId);
      } else {
        if (clearDescription) deleteAiField.run(assetId, 'description');
        if (clearRating) deleteAiField.run(assetId, 'rating');
      }
      if (clearTags) deleteAiTags.run(assetId);
      this.syncAssetSearchContent(conn, assetId);
    }
  })();

  this.emitClientAssetsChanged(input.libraryId, targetAssetIds.length);
  return { clearedCount: targetAssetIds.length, affectedAssetIds: targetAssetIds };
}

/**
* 返回给定资产里没有任何 AI 生成数据的（ai_content 无记录）——供
* 「AI分析未分析项」菜单计数与批量跳过（运行时判断，不动数据库字段）。
*/
export function pendingAiAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
  }): string[] {
  const conn = this.requireOpenLibrary(input.libraryId).connection;
  if (input.assetIds.length === 0) return [];
  return withSqliteInPredicate(
    conn,
    'asset_id',
    input.assetIds,
    (sql, params) =>
      conn
        .prepare(
          `SELECT asset_id FROM assets
            WHERE ${sql}
              AND NOT EXISTS (
                SELECT 1 FROM ai_content
                 WHERE ai_content.asset_id = assets.asset_id
              )`,
        )
        .all(...params) as Array<{ asset_id: string }>,
  ).map((r) => r.asset_id);
}

/** Enqueue image jobs and video jobs whose contact sheet is ready. */
export function enqueueAiAnalysisJobs(this: LibraryService, input: {
    libraryId: string;
    assetIds?: string[];
    folderId?: string;
    resumePaused?: boolean;
    forceExisting?: boolean;
  }): {
    enqueued: number;
    jobIds: string[];
    alreadyPendingJobIds: string[];
    skippedAssetIds: string[];
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const conn = openLibrary.connection;
  const now = new Date().toISOString();
  const libId = openLibrary.summary.libraryId;

  // Determine target asset IDs.
  let targetAssetIds: string[];
  if (input.assetIds && input.assetIds.length > 0) {
    targetAssetIds = input.assetIds;
  } else if (input.folderId) {
    const folderRows = conn
      .prepare(
        `WITH RECURSIVE subfolders AS (
           SELECT folder_id FROM managed_folders WHERE folder_id = ?
           UNION ALL
           SELECT mf.folder_id
             FROM managed_folders mf
             JOIN subfolders sf ON mf.parent_folder_id = sf.folder_id
         )
         SELECT a.asset_id
           FROM assets a
          WHERE a.managed_folder_id IN (SELECT folder_id FROM subfolders)
             OR a.linked_folder_id = ?`,
      )
      .all(input.folderId, input.folderId) as Array<{ asset_id: string }>;
    targetAssetIds = folderRows.map((r) => r.asset_id);
  } else {
    // All library assets (single-library database, so no library_id filter needed).
    const allRows = conn
      .prepare('SELECT asset_id FROM assets')
      .all() as Array<{ asset_id: string }>;
    targetAssetIds = allRows.map((r) => r.asset_id);
  }

  const insertJob = conn.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status,
        priority, progress, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, 0.0, 0, ?, ?)`,
  );
  const getRevision = conn.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  );
  const resumePausedJob = conn.prepare(
    `UPDATE jobs
        SET status = 'queued', updated_at = ?
      WHERE job_id = ? AND status = 'paused'`,
  );

  // Product format registry, shared with thumbnail dispatch. Importing a
  // file is intentionally broader than this set; this gate only decides
  // whether AI can obtain a decoded visual derivative.
  const imageExts = new Set<string>(IMAGE_EXTENSIONS);
  const videoExts = new Set<string>(VIDEO_EXTENSIONS);
  const modelExts = new Set<string>(MODEL_EXTENSIONS);

  let enqueued = 0;
  const jobIds: string[] = [];
  const alreadyPendingJobIds: string[] = [];
  const skippedAssetIds: string[] = [];
  conn.transaction(() => {
    for (const assetId of targetAssetIds) {
      const row = conn
        .prepare(
          `SELECT relative_file_path, location_kind, linked_folder_id FROM assets
           WHERE asset_id = ?`,
        )
        .get(assetId) as {
          relative_file_path: string;
          location_kind: string;
          linked_folder_id: string | null;
        } | undefined;
      if (!row) {
        skippedAssetIds.push(assetId);
        continue;
      }

      // Ignored assets must never appear in the task queue. Keep this gate
      // before format/dedup checks so explicit AI requests cannot briefly
      // expose a queued row that is only cancelled after claim.
      if (this.isExplicitlyIgnored(
        openLibrary,
        row.location_kind as 'managed' | 'linked',
        row.linked_folder_id,
        row.relative_file_path,
        'asset',
      )) {
        skippedAssetIds.push(assetId);
        continue;
      }

      const ext = path.extname(row.relative_file_path).toLowerCase();
      const isImage = imageExts.has(ext);
      const isVideo = videoExts.has(ext);
      const isModel = modelExts.has(ext);
      if (!isImage && !isVideo && !isModel) {
        skippedAssetIds.push(assetId);
        continue;
      }
      // Serpent-140fe2: videos no longer require a pre-existing contact
      // sheet here. The analysis lane materializes it lazily via
      // ensureVideoContactSheet when the job executes, so converted
      // libraries whose sheets never existed can finally be analysed.

      // Check if there's already a pending/running AI job for this asset.
      const existingJob = conn
        .prepare(
          "SELECT job_id, status FROM jobs WHERE asset_id = ? AND kind IN ('ai.image.analysis', 'ai.video.analysis') AND status IN ('queued', 'running', 'paused') LIMIT 1",
        )
        .get(assetId) as { job_id: string; status: 'queued' | 'running' | 'paused' } | undefined;
      if (existingJob) {
        if (existingJob.status === 'paused' && input.resumePaused) {
          resumePausedJob.run(now, existingJob.job_id);
        }
        alreadyPendingJobIds.push(existingJob.job_id);
        continue;
      }

      // Automatic reconciliation and the explicit “unanalysed only” path
      // skip assets that already have AI content. Manual analysis passes
      // forceExisting so a user can deliberately replace an old result.
      if (!input.forceExisting) {
        const hasAiContent = conn
          .prepare('SELECT 1 FROM ai_content WHERE asset_id = ? LIMIT 1')
          .get(assetId);
        if (hasAiContent) {
          skippedAssetIds.push(assetId);
          continue;
        }
      }

      const jobId = randomUUID();
      const revisionRow = getRevision.get(assetId) as
        | { current_revision_id: string | null }
        | undefined;
      const revisionId = revisionRow?.current_revision_id ?? null;

      insertJob.run(
        jobId,
        libId,
        assetId,
        revisionId,
        isVideo ? 'ai.video.analysis' : 'ai.image.analysis',
        now,
        now,
      );
      enqueued++;
      jobIds.push(jobId);
    }
  })();

  return { enqueued, jobIds, alreadyPendingJobIds, skippedAssetIds };
}

export function claimNextAiJob(this: LibraryService, libraryId: string, excludedJobIds: string[] = []): {
    jobId: string;
    assetId: string;
    kind: 'ai.image.analysis' | 'ai.video.analysis';
    attemptCount: number;
  } | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const conn = openLibrary.connection;
  const libId = openLibrary.summary.libraryId;
  return conn.transaction(() => {
    const row = excludedJobIds.length === 0
      ? conn.prepare(
        `SELECT job_id, asset_id, kind, attempt_count FROM jobs
          WHERE library_id = ? AND kind IN ('ai.image.analysis', 'ai.video.analysis')
            AND status = 'queued'
          ORDER BY priority DESC, created_at ASC, job_id ASC LIMIT 1`,
      ).get(libId) as { job_id: string; asset_id: string; kind: 'ai.image.analysis' | 'ai.video.analysis'; attempt_count: number } | undefined
      : withSqliteInPredicate(
        conn,
        'job_id',
        excludedJobIds,
        (sql, params) =>
          conn.prepare(
            `SELECT job_id, asset_id, kind, attempt_count FROM jobs
              WHERE library_id = ? AND kind IN ('ai.image.analysis', 'ai.video.analysis')
                AND status = 'queued'
                AND NOT (${sql})
              ORDER BY priority DESC, created_at ASC, job_id ASC LIMIT 1`,
          ).get(libId, ...params) as { job_id: string; asset_id: string; kind: 'ai.image.analysis' | 'ai.video.analysis'; attempt_count: number } | undefined,
      );
    if (!row) return null;
    const attemptCount = row.attempt_count + 1;
    const result = conn.prepare(
      `UPDATE jobs SET status = 'running', attempt_count = ?, progress = 0.0,
        error_code = NULL, error_detail = NULL, updated_at = ?
        WHERE job_id = ? AND library_id = ? AND status = 'queued'`,
    ).run(attemptCount, new Date().toISOString(), row.job_id, libId);
    if (result.changes !== 1) return null;
    return { jobId: row.job_id, assetId: row.asset_id, kind: row.kind, attemptCount };
  })();
}

export function completeAiJob(this: LibraryService, libraryId: string, jobId: string): void {
  const openLibrary = this.requireOpenLibrary(libraryId);
  openLibrary.connection.prepare(
    `UPDATE jobs SET status = 'succeeded', progress = 1.0, error_code = NULL,
      error_detail = NULL, updated_at = ?
      WHERE library_id = ? AND job_id = ? AND status = 'running'
        AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
  ).run(new Date().toISOString(), openLibrary.summary.libraryId, jobId);
}

export function getAiJobState(this: LibraryService, libraryId: string, jobId: string): string | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection.prepare(
    `SELECT status FROM jobs WHERE library_id = ? AND job_id = ?
      AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
  ).get(openLibrary.summary.libraryId, jobId) as { status: string } | undefined;
  return row?.status ?? null;
}

export function failAiJob(this: LibraryService, libraryId: string, jobId: string, failure: {
      errorCode: string;
      retryable: boolean;
      maxAttempts?: number;
      /** Redacted user/developer-facing detail (Serpent-iokf). */
      errorDetail?: string | null;
    }): { status: 'queued' | 'failed' } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const conn = openLibrary.connection;
  const libId = openLibrary.summary.libraryId;
  const row = conn.prepare(
    `SELECT attempt_count FROM jobs WHERE library_id = ? AND job_id = ?
      AND status = 'running' AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
  ).get(libId, jobId) as { attempt_count: number } | undefined;
  if (!row) return { status: 'failed' };
  const status = failure.retryable && row.attempt_count < (failure.maxAttempts ?? 3) ? 'queued' : 'failed';
  const detail =
    typeof failure.errorDetail === 'string' && failure.errorDetail.trim()
      ? failure.errorDetail.trim().slice(0, 500)
      : null;
  conn.prepare(
    `UPDATE jobs SET status = ?, progress = 0.0, error_code = ?, error_detail = ?,
      updated_at = ? WHERE library_id = ? AND job_id = ? AND status = 'running'`,
  ).run(status, failure.errorCode, detail, new Date().toISOString(), libId, jobId);
  return { status };
}

export function recoverInterruptedAiJobs(this: LibraryService, openLibrary: OpenLibrary): void {
  const nowMs = Date.now();
  openLibrary.connection.prepare(
    `UPDATE jobs SET status = 'queued', progress = 0.0,
      error_code = 'PROCESS_INTERRUPTED', error_detail = NULL, updated_at = ?
      WHERE library_id = ? AND status = 'running'
        AND kind IN ('ai.image.analysis', 'ai.video.analysis')
        AND NOT EXISTS (
          SELECT 1 FROM library_job_leases
           WHERE library_job_leases.library_id = jobs.library_id
             AND library_job_leases.job_id = jobs.job_id
             AND library_job_leases.expires_at_ms > ?
        )`,
  ).run(new Date().toISOString(), openLibrary.summary.libraryId, nowMs);
}

/** List all AI jobs for a library with counts by status. */
export function getAiJobStatus(this: LibraryService, libraryId: string, jobIds?: string[]): {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    paused: number;
    cancelled: number;
    jobs: Array<{
      jobId: string;
      assetId: string;
      assetName: string | null;
      kind: 'ai.image.analysis' | 'ai.video.analysis';
      status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
      errorCode: string | null;
      errorDetail: string | null;
      updatedAt: string;
    }>;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const conn = openLibrary.connection;
  const libId = openLibrary.summary.libraryId;

  type AiJobRow = {
    job_id: string;
    asset_id: string;
    asset_name: string | null;
    kind: 'ai.image.analysis' | 'ai.video.analysis';
    status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
    error_code: string | null;
    error_detail: string | null;
    updated_at: string;
  };
  const statusMap: Record<string, number> = {};
  let jobs: AiJobRow[];

  if (jobIds && jobIds.length > 0) {
    // SQLite binds only a limited number of values per statement. Chunking
    // keeps large user selections exact instead of silently truncating them.
    const requestedJobIds = [...new Set(jobIds)];
    const rows: AiJobRow[] = [];
    for (let index = 0; index < requestedJobIds.length; index += 900) {
      const chunk = requestedJobIds.slice(index, index + 900);
      rows.push(...conn
        .prepare(
          `SELECT j.job_id, j.asset_id, a.relative_file_path AS asset_name, j.kind, j.status,
                  j.error_code, j.error_detail, j.updated_at
             FROM jobs j
             LEFT JOIN assets a ON a.asset_id = j.asset_id
            WHERE j.library_id = ?
              AND j.kind IN ('ai.image.analysis', 'ai.video.analysis')
              AND j.job_id IN (${sqliteInPlaceholders(chunk)})`,
        )
        .all(libId, ...chunk) as AiJobRow[]);
    }
    jobs = rows;
    for (const job of jobs) statusMap[job.status] = (statusMap[job.status] ?? 0) + 1;
  } else {
    const counts = conn
      .prepare(
        `SELECT status, COUNT(*) as cnt
           FROM jobs j
           LEFT JOIN assets a ON a.asset_id = j.asset_id
          WHERE j.library_id = ?
            AND j.kind IN ('ai.image.analysis', 'ai.video.analysis')
            AND (j.error_code IS NULL OR j.error_code <> 'ASSET_IGNORED')
            AND (j.asset_id IS NULL OR ${this.explicitIgnoreSql(conn, 'a')})
          GROUP BY status`,
      )
      .all(libId) as Array<{ status: string; cnt: number }>;
    for (const count of counts) statusMap[count.status] = count.cnt;
    jobs = conn
      .prepare(
        `SELECT j.job_id, j.asset_id, a.relative_file_path AS asset_name, j.kind, j.status,
                j.error_code, j.error_detail, j.updated_at
           FROM jobs j
           LEFT JOIN assets a ON a.asset_id = j.asset_id
          WHERE j.library_id = ?
            AND j.kind IN ('ai.image.analysis', 'ai.video.analysis')
            AND (j.error_code IS NULL OR j.error_code <> 'ASSET_IGNORED')
            AND (j.asset_id IS NULL OR ${this.explicitIgnoreSql(conn, 'a')})
          ORDER BY j.created_at DESC
          LIMIT 200`,
      )
      .all(libId) as AiJobRow[];
  }

  return {
    queued: statusMap['queued'] ?? 0,
    running: statusMap['running'] ?? 0,
    succeeded: statusMap['succeeded'] ?? 0,
    failed: statusMap['failed'] ?? 0,
    paused: statusMap['paused'] ?? 0,
    cancelled: statusMap['cancelled'] ?? 0,
    jobs: jobs.map((j) => ({
      jobId: j.job_id,
      assetId: j.asset_id,
      assetName: j.asset_name ? buildFileName(j.asset_name) : null,
      kind: j.kind,
      status: j.status,
      errorCode: j.error_code,
      errorDetail: j.error_detail,
      updatedAt: j.updated_at,
    })),
  };
}

/**
* Narrow Worker-only projection for semantic revision checks. It avoids
* materializing complete AssetSummary objects (metadata, layout and folder
* adornments) when the vector index only needs source identity.
*/
export function getSemanticAssetSources(this: LibraryService, libraryId: string, assetIds: readonly string[]): Array<{
    assetId: string;
    currentRevisionId: string;
    relativeFilePath: string;
    displayName: string;
    mediaType: AssetSummary['mediaType'];
    availability: AssetSummary['availability'];
    deletedAt: string | null;
    thumbnailStatus: 'ready' | null;
    thumbnailArtifactId: string | null;
    sequence: boolean;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const ids = [...new Set(assetIds.filter((assetId) => assetId.length > 0))];
  if (ids.length === 0) return [];
  const hasFrames = hasTable(openLibrary.connection, 'asset_sequence_frames');
  const hasSequences = hasTable(openLibrary.connection, 'asset_sequences');
  const sequenceSql = hasFrames && hasSequences
    ? `EXISTS (SELECT 1 FROM asset_sequence_frames sf WHERE sf.asset_id = a.asset_id)
       OR EXISTS (SELECT 1 FROM asset_sequences ss WHERE ss.primary_asset_id = a.asset_id)`
    : '0';
  const rows = withSqliteInPredicate(openLibrary.connection, 'a.asset_id', ids, (predicate, parameters) =>
    openLibrary.connection.prepare(`
      SELECT a.asset_id, a.current_revision_id, a.relative_file_path, a.availability, a.deleted_at,
             (${sequenceSql}) AS is_sequence,
             (SELECT chosen.artifact_id FROM revision_artifacts chosen
               WHERE chosen.revision_id = a.current_revision_id
                 AND chosen.kind = ${DISPLAY_PREVIEW_KIND_SQL}
                 AND chosen.status = 'ready' AND chosen.invalidated_at IS NULL
               ORDER BY CASE chosen.mime_type WHEN 'image/jpeg' THEN 0 WHEN 'image/webp' THEN 1
                 WHEN 'image/png' THEN 2 ELSE 3 END, chosen.rowid DESC LIMIT 1) AS thumbnail_artifact_id
        FROM assets a WHERE ${predicate}
    `).all(...parameters) as Array<{
      asset_id: string; current_revision_id: string; relative_file_path: string;
      availability: 'available' | 'missing'; deleted_at: string | null;
      is_sequence: number;
      thumbnail_artifact_id: string | null;
    }>);
  return rows.map((row) => ({
    assetId: row.asset_id,
    currentRevisionId: row.current_revision_id,
    relativeFilePath: row.relative_file_path,
    displayName: path.posix.basename(row.relative_file_path),
    mediaType: LibraryService.toSummaryMediaType(LibraryService.detectMediaType(row.relative_file_path)),
    availability: row.availability,
    deletedAt: row.deleted_at,
    thumbnailStatus: row.thumbnail_artifact_id ? 'ready' : null,
    thumbnailArtifactId: row.thumbnail_artifact_id,
    sequence: row.is_sequence !== 0,
  }));
}
