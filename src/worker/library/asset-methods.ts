import { type AssetMetadataResult, type AssetSummary } from "../../shared/asset-types";
import { audioMimeForExtension } from "../../shared/audio-media";
import { CONTENT_REPLACE_BATCH_MAX_ITEMS } from "../../shared/content-replace";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { directImageMimeForExtension, imageMimeForExtension, videoMimeForExtension } from "../../shared/media-formats";
import { assetAuthorSchema, sourcePageUrlSchema } from "../../shared/protocol/requests";
import { type TagOperationSkip } from "../../shared/protocol/responses";
import { decodeTextBytes } from "../../shared/text-encoding";
import { TEXT_SAVE_MAX_BYTES, TEXT_VIEWER_MAX_BYTES, countTextLines, textMimeForExtension } from "../../shared/text-media";
import { defaultPinnedHttpTransport, type PinnedHttpTransport } from "./secure-http-download";
import { DOWNLOAD_TIMEOUT_MS, LibraryService, LibraryServiceError, MAX_DOWNLOAD_BYTES, MAX_DOWNLOAD_REDIRECTS, SimulatedCrashError, UUID, assertNameWithinFsLimit, cleanFilename, extensionForContentType, filenameFromUrl, parseContentDispositionFilename, realFileExists, sanitizedUrlDiagnosticError, sanitizedUrlForDiagnostic, serviceError, sha256FileAtPath, type AssetsChangedEvent, type ContentReplaceBatchOperationManifest, type DatabaseConnection, type ManagedCopyOperationManifest, type OpenLibrary, type OperationRow, type Statement } from "../library-service";
import { RemoteMediaMagicProbe, filenameMatchesRemoteContentType, normalizeRemoteContentType, remoteMediaValidationFailure } from "./remote-media-validation";
import { catalogAssetSummaryFromRow, type CatalogAssetSummaryRow } from "./catalog-read";
import { columnsFor, hasTable, selectColumns } from "./lenient-columns";
import { normalizeAbsolutePath, portablePathIdentity, portablePathSegmentIdentity } from "./library-rules";
import { managedStoragePath } from "./library-storage-layout";
import { LibraryWriteCoordinator } from "./library-write-coordinator";
import { sqliteAllInChunks, sqliteInPlaceholders, withSqliteInPredicate } from "./sqlite-in";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, createWriteStream, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, type BigIntStats, type Stats, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface AssetMethods {
  suppressAutoAnalysisForAssets(...args: Parameters<typeof suppressAutoAnalysisForAssets>): ReturnType<typeof suppressAutoAnalysisForAssets>;
  shouldAutoAnalyzeAsset(...args: Parameters<typeof shouldAutoAnalyzeAsset>): ReturnType<typeof shouldAutoAnalyzeAsset>;
  emitClientAssetsChanged(...args: Parameters<typeof emitClientAssetsChanged>): ReturnType<typeof emitClientAssetsChanged>;
  emitAssetsChanged(...args: Parameters<typeof emitAssetsChanged>): ReturnType<typeof emitAssetsChanged>;
  automationAssetStateToken(...args: Parameters<typeof automationAssetStateToken>): ReturnType<typeof automationAssetStateToken>;
  assetsPath(...args: Parameters<typeof assetsPath>): ReturnType<typeof assetsPath>;
  companionAssetIds(...args: Parameters<typeof companionAssetIds>): ReturnType<typeof companionAssetIds>;
  withCompanionAssetIds(...args: Parameters<typeof withCompanionAssetIds>): ReturnType<typeof withCompanionAssetIds>;
  partitionKnownAssetIds(...args: Parameters<typeof partitionKnownAssetIds>): ReturnType<typeof partitionKnownAssetIds>;
  getAssetMetadata(...args: Parameters<typeof getAssetMetadata>): ReturnType<typeof getAssetMetadata>;
  setAssetMetadata(...args: Parameters<typeof setAssetMetadata>): ReturnType<typeof setAssetMetadata>;
  setAssetsMetadata(...args: Parameters<typeof setAssetsMetadata>): ReturnType<typeof setAssetsMetadata>;
  backfillAssetMetadata(...args: Parameters<typeof backfillAssetMetadata>): ReturnType<typeof backfillAssetMetadata>;
  setAssetsRating(...args: Parameters<typeof setAssetsRating>): ReturnType<typeof setAssetsRating>;
  resolveAssetFilePath(...args: Parameters<typeof resolveAssetFilePath>): ReturnType<typeof resolveAssetFilePath>;
  getAssetDisplayName(...args: Parameters<typeof getAssetDisplayName>): ReturnType<typeof getAssetDisplayName>;
  resolveAssetPath(...args: Parameters<typeof resolveAssetPath>): ReturnType<typeof resolveAssetPath>;
  resolveAssetIdsByAbsolutePaths(...args: Parameters<typeof resolveAssetIdsByAbsolutePaths>): ReturnType<typeof resolveAssetIdsByAbsolutePaths>;
  isModelAsset(...args: Parameters<typeof isModelAsset>): ReturnType<typeof isModelAsset>;
  resolveAssetDragInfos(...args: Parameters<typeof resolveAssetDragInfos>): ReturnType<typeof resolveAssetDragInfos>;
  assetSummaryFromRow(...args: Parameters<typeof assetSummaryFromRow>): ReturnType<typeof assetSummaryFromRow>;
  copyAssets(...args: Parameters<typeof copyAssets>): ReturnType<typeof copyAssets>;
  readTextAsset(...args: Parameters<typeof readTextAsset>): ReturnType<typeof readTextAsset>;
  saveTextAsset(...args: Parameters<typeof saveTextAsset>): ReturnType<typeof saveTextAsset>;
  replaceManagedAssetContent(...args: Parameters<typeof replaceManagedAssetContent>): ReturnType<typeof replaceManagedAssetContent>;
  replaceManagedAssetContentBatch(...args: Parameters<typeof replaceManagedAssetContentBatch>): ReturnType<typeof replaceManagedAssetContentBatch>;
  readManagedAssetContent(...args: Parameters<typeof readManagedAssetContent>): ReturnType<typeof readManagedAssetContent>;
  getAssetFileBaseName(...args: Parameters<typeof getAssetFileBaseName>): ReturnType<typeof getAssetFileBaseName>;
  getAssetFileName(...args: Parameters<typeof getAssetFileName>): ReturnType<typeof getAssetFileName>;
  findActiveManagedAssetByContent(...args: Parameters<typeof findActiveManagedAssetByContent>): ReturnType<typeof findActiveManagedAssetByContent>;
  findActiveManagedAssetAtPath(...args: Parameters<typeof findActiveManagedAssetAtPath>): ReturnType<typeof findActiveManagedAssetAtPath>;
  findActiveManagedAssetIdByContent(...args: Parameters<typeof findActiveManagedAssetIdByContent>): ReturnType<typeof findActiveManagedAssetIdByContent>;
  saveAssetFromUrl(...args: Parameters<typeof saveAssetFromUrl>): ReturnType<typeof saveAssetFromUrl>;
  saveAssetFromFile(...args: Parameters<typeof saveAssetFromFile>): ReturnType<typeof saveAssetFromFile>;
}

/**
* Mark imported assets as preview-only. This is deliberately kept in the
* Worker rather than sent through Main so a large Eagle import does not
* materialize thousands of asset ids in the renderer process.
*/
export function suppressAutoAnalysisForAssets(this: LibraryService, libraryId: string, assetIds: readonly string[]): void {
  if (assetIds.length === 0) return;
  const openLibrary = this.requireOpenLibrary(libraryId);
  const uniqueAssetIds = [...new Set(assetIds)];
  const now = new Date().toISOString();
  const insert = openLibrary.connection.prepare(
    `INSERT OR IGNORE INTO asset_auto_analysis_suppression
       (asset_id, reason, created_at)
     VALUES (?, 'external-library-import', ?)`,
  );
  openLibrary.connection.transaction(() => {
    for (const assetId of uniqueAssetIds) insert.run(assetId, now);
  })();
  const suppressed = this.autoAnalysisSuppressedAssetIds.get(libraryId) ?? new Set<string>();
  for (const assetId of uniqueAssetIds) suppressed.add(assetId);
  this.autoAnalysisSuppressedAssetIds.set(libraryId, suppressed);
}

/** Used by the media queue at the visual-input boundary. */
export function shouldAutoAnalyzeAsset(this: LibraryService, libraryId: string, assetId: string): boolean {
  const cached = this.autoAnalysisSuppressedAssetIds.get(libraryId);
  if (cached?.has(assetId)) return false;
  const openLibrary = this.requireOpenLibrary(libraryId);
  const suppressed = openLibrary.connection
    .prepare('SELECT 1 FROM asset_auto_analysis_suppression WHERE asset_id = ? LIMIT 1')
    .get(assetId);
  if (suppressed !== undefined) {
    const next = cached ?? new Set<string>();
    next.add(assetId);
    this.autoAnalysisSuppressedAssetIds.set(libraryId, next);
    return false;
  }
  return true;
}

export function emitClientAssetsChanged(this: LibraryService, libraryId: string, changedCount: number, nativeDragPathsChanged = false): void {
  this.emitAssetsChanged(libraryId, changedCount, 'client', nativeDragPathsChanged);
}

/**
* 用户手势发 `client`；同步回放中的 `client` 改成 `sync`，让 Renderer
* 刷新文件夹树/画布，同时让自动同步调度器忽略，避免回放死循环。
*/
export function emitAssetsChanged(this: LibraryService, libraryId: string, changedCount: number, source: NonNullable<AssetsChangedEvent['source']>, nativeDragPathsChanged = false): void {
  if (changedCount <= 0) return;
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId,
    changedCount,
    missingCount: 0,
    source: this.syncReplayDepth > 0 && source === 'client' ? 'sync' : source,
    ...(nativeDragPathsChanged ? { nativeDragPathsChanged: true } : {}),
  });
}

export function automationAssetStateToken(this: LibraryService, row: {
    asset_id: string;
    current_revision_id: string;
    relative_file_path: string;
    deleted_at: string | null;
    availability: 'available' | 'missing';
    location_kind: 'managed' | 'linked';
  }): string {
  return createHash('sha256').update(JSON.stringify([
    row.asset_id,
    row.current_revision_id,
    row.relative_file_path,
    row.deleted_at,
    row.availability,
    row.location_kind,
  ]), 'utf8').digest('hex');
}

export function assetsPath(this: LibraryService, openLibrary: OpenLibrary): string {
  return managedStoragePath(openLibrary.summary.libraryPath, openLibrary.summary.storageLayout ?? 'assets');
}

/** Companion asset ids for the given primaries, including trashed ones. */
export function companionAssetIds(this: LibraryService, openLibrary: OpenLibrary, primaryAssetIds: readonly string[]): string[] {
  if (primaryAssetIds.length === 0 || !hasTable(openLibrary.connection, 'asset_companions')) return [];
  this.ensureCompanionIndex(openLibrary);
  return sqliteAllInChunks<string, { asset_id: string }>({
    connection: openLibrary.connection,
    values: [...primaryAssetIds],
    buildSql: (placeholders) =>
      `SELECT asset_id FROM asset_companions WHERE primary_asset_id IN (${placeholders}) ORDER BY asset_id`,
  }).map((row) => row.asset_id);
}

/** Selection plus the companions of every selected primary, without duplicates. */
export function withCompanionAssetIds(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): string[] {
  const companions = this.companionAssetIds(openLibrary, assetIds);
  if (companions.length === 0) return [...assetIds];
  const result = [...assetIds];
  const seen = new Set(assetIds);
  for (const id of companions) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
* Splits the requested asset ids into the ones that exist in this library
* and per-id skip entries for the rest, so batch tag operations can apply
* to the eligible subset instead of failing wholesale (REQ-MENU-007).
*/
export function partitionKnownAssetIds(this: LibraryService, connection: DatabaseConnection, assetIds: string[]): { eligibleAssetIds: string[]; skipped: TagOperationSkip[] } {
  const requestedAssetIds = [...new Set(assetIds)];
  const assetRows = sqliteAllInChunks<string, { asset_id: string }>({
    connection,
    values: requestedAssetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id FROM assets WHERE asset_id IN (${placeholders})`,
  });
  const knownAssetIds = new Set(assetRows.map((row) => row.asset_id));
  const eligibleAssetIds: string[] = [];
  const skipped: TagOperationSkip[] = [];
  for (const assetId of requestedAssetIds) {
    if (knownAssetIds.has(assetId)) {
      eligibleAssetIds.push(assetId);
    } else {
      skipped.push({ assetId, reason: 'asset_not_found' });
    }
  }
  return { eligibleAssetIds, skipped };
}

export function getAssetMetadata(this: LibraryService, input: { libraryId: string; assetId: string }): AssetMetadataResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  const assetRow = openLibrary.connection
    .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
    .get(input.assetId) as { asset_id: string } | undefined;
  if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

  // Serpent-verg.2 — lenient read (0031 §1): libraries predating
  // asset_metadata (or missing individual metadata columns) degrade to the
  // empty-metadata shape instead of failing.
  const connection = openLibrary.connection;
  const present = hasTable(connection, 'asset_metadata')
    ? selectColumns(connection, 'asset_metadata', [
        'asset_id',
        'description',
        'rating',
        'favorite',
        'palette',
        'source_page_url',
        'author',
        'entity_version',
        'updated_at',
      ])
    : [];
  const row = present.length === 0
    ? undefined
    : connection
        .prepare(
          `SELECT ${present.join(', ')}
             FROM asset_metadata
            WHERE asset_id = ?`,
        )
        .get(input.assetId) as {
          asset_id?: string;
          description?: string | null;
          rating?: number;
          favorite?: number;
          palette?: string | null;
          source_page_url?: string | null;
          author?: string | null;
          entity_version?: number;
          updated_at?: string;
        } | undefined;

  if (!row) {
    return {
      assetId: input.assetId,
      description: null,
      rating: 0,
      favorite: false,
      palette: null,
      ...this.resolvedPaletteFields(openLibrary, input.assetId),
      sourcePageUrl: null,
      author: null,
      tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
      companions: this.companionSummaries(openLibrary, input.assetId),
      entityVersion: 0,
      updatedAt: new Date(0).toISOString(),
    };
  }

  return {
    assetId: row.asset_id ?? input.assetId,
    description: row.description ?? null,
    rating: row.rating ?? 0,
    favorite: row.favorite !== undefined && row.favorite !== 0,
    palette: row.palette ?? null,
    ...this.resolvedPaletteFields(openLibrary, input.assetId),
    sourcePageUrl: row.source_page_url ?? null,
    author: row.author ?? null,
    entityVersion: row.entity_version ?? 0,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
    tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
    companions: this.companionSummaries(openLibrary, input.assetId),
  };
}

export function setAssetMetadata(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    expectedVersion: number;
    description?: string;
    rating?: number;
    favorite?: boolean;
    palette?: string[];
    sourcePageUrl?: string;
    author?: string;
  }): AssetMetadataResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, [input.assetId]);

  // Validate the asset exists.
  const assetRow = openLibrary.connection
    .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
    .get(input.assetId) as { asset_id: string } | undefined;
  if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

  // Renderer validation is not a trust boundary. Direct Worker clients must
  // obey the same metadata contract and receive a metadata-specific error.
  if (
    input.description !== undefined && input.description.length > 10_000 ||
    input.rating !== undefined &&
      (!Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5)
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  // Serpent-7pg: ignore palette writes; column retained for older libraries.
  if (input.palette !== undefined) {
    // no-op: manual palette entry removed from product surface
  }

  // Source-page URLs are either the exact empty-string clear operation or a
  // credential-free HTTP(S) URL.
  if (
    input.sourcePageUrl !== undefined &&
    !sourcePageUrlSchema.safeParse(input.sourcePageUrl).success
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  // Author mirrors sourcePageUrl's clear-with-empty-string contract, without
  // the URL-shape constraint (Serpent-7x0).
  if (
    input.author !== undefined &&
    !assetAuthorSchema.safeParse(input.author).success
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  const now = new Date().toISOString();

  // Read current state.
  const existing = openLibrary.connection
    .prepare(
      'SELECT entity_version, rating, favorite, description, palette, source_page_url, author, updated_at FROM asset_metadata WHERE asset_id = ?',
    )
    .get(input.assetId) as {
      entity_version: number;
      rating: number;
      favorite: number;
      description: string | null;
      palette: string | null;
      source_page_url: string | null;
      author: string | null;
      updated_at: string;
    } | undefined;

  if (existing) {
    // Row exists: optimistic lock update.
    const newDescription =
      input.description !== undefined
        ? (input.description.trim() === '' ? null : input.description.trim())
        : existing.description;
    const newRating = input.rating ?? existing.rating;
    const newFavorite = input.favorite !== undefined ? (input.favorite ? 1 : 0) : existing.favorite;
    const newPalette = existing.palette;
    const newSourcePageUrl =
      input.sourcePageUrl !== undefined
        ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
        : existing.source_page_url;
    const newAuthor =
      input.author !== undefined
        ? (input.author.trim() === '' ? null : input.author.trim())
        : existing.author;

    const unchanged =
      newDescription === existing.description &&
      newRating === existing.rating &&
      newFavorite === existing.favorite &&
      newPalette === existing.palette &&
      newSourcePageUrl === existing.source_page_url &&
      newAuthor === existing.author;
    if (unchanged) {
      // A repeated blur/click of the same inspector fields must not consume
      // another optimistic-lock version. A stale expectedVersion is still a
      // conflict, even when the payload happens to match the current row.
      if (existing.entity_version !== input.expectedVersion) {
        throw new LibraryServiceError('VERSION_CONFLICT', {
          currentEntityVersion: existing.entity_version,
        });
      }
      return {
        assetId: input.assetId,
        description: existing.description,
        rating: existing.rating,
        favorite: existing.favorite !== 0,
        palette: existing.palette,
        ...this.resolvedPaletteFields(openLibrary, input.assetId),
        sourcePageUrl: existing.source_page_url,
        author: existing.author,
        tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
        entityVersion: existing.entity_version,
        updatedAt: existing.updated_at,
      };
    }

    const result = openLibrary.connection
      .prepare(
        `UPDATE asset_metadata
            SET description = ?, rating = ?, favorite = ?,
                palette = ?, source_page_url = ?, author = ?,
                entity_version = entity_version + 1, updated_at = ?
          WHERE asset_id = ? AND entity_version = ?`,
      )
      .run(
        newDescription,
        newRating,
        newFavorite,
        newPalette,
        newSourcePageUrl,
        newAuthor,
        now,
        input.assetId,
        input.expectedVersion,
      );

    if (result.changes === 0) {
      // Version mismatch: return conflict with current version.
      const current = openLibrary.connection
        .prepare('SELECT entity_version FROM asset_metadata WHERE asset_id = ?')
        .get(input.assetId) as { entity_version: number };
      throw new LibraryServiceError('VERSION_CONFLICT', {
        currentEntityVersion: current.entity_version,
      });
    }

    // Fetch back the updated row.
    const updated = openLibrary.connection
      .prepare(
        `SELECT asset_id, description, rating, favorite, palette,
                source_page_url, author, entity_version, updated_at
           FROM asset_metadata WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        description: string | null;
        rating: number;
        favorite: number;
        palette: string | null;
        source_page_url: string | null;
        author: string | null;
        entity_version: number;
        updated_at: string;
      };

    this.syncAssetSearchContent(openLibrary.connection, input.assetId);

    return {
      assetId: updated.asset_id,
      description: updated.description,
      rating: updated.rating,
      favorite: updated.favorite !== 0,
      palette: updated.palette,
      ...this.resolvedPaletteFields(openLibrary, input.assetId),
      sourcePageUrl: updated.source_page_url,
      author: updated.author,
      tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
      entityVersion: updated.entity_version,
      updatedAt: updated.updated_at,
    };
  }

  // No existing row: INSERT. expectedVersion must be 0 for a fresh row.
  if (input.expectedVersion !== 0) {
    throw new LibraryServiceError('VERSION_CONFLICT', { currentEntityVersion: 0 });
  }

  const newDescription =
    input.description !== undefined
      ? (input.description.trim() === '' ? null : input.description.trim())
      : null;
  const newRating = input.rating ?? 0;
  const newFavorite = input.favorite !== undefined && input.favorite ? 1 : 0;
  const newPalette = null;
  const newSourcePageUrl =
    input.sourcePageUrl !== undefined
      ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
      : null;
  const newAuthor =
    input.author !== undefined
      ? (input.author.trim() === '' ? null : input.author.trim())
      : null;
  const newEntityVersion = 1;

  openLibrary.connection
    .prepare(
      `INSERT INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, author, entity_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.assetId,
      newDescription,
      newRating,
      newFavorite,
      newPalette,
      newSourcePageUrl,
      newAuthor,
      newEntityVersion,
      now,
    );
  this.syncAssetSearchContent(openLibrary.connection, input.assetId);

  this.emitClientAssetsChanged(input.libraryId, 1);
  return {
    assetId: input.assetId,
    description: newDescription,
    rating: newRating,
    favorite: newFavorite !== 0,
    palette: newPalette,
    ...this.resolvedPaletteFields(openLibrary, input.assetId),
    sourcePageUrl: newSourcePageUrl,
    author: newAuthor,
    tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
    entityVersion: newEntityVersion,
    updatedAt: now,
  };
}

/**
* Apply optimistic-lock metadata updates as one bounded write. The whole
* batch is atomic: a stale entity version or invalid asset rolls back every
* item, so an agent never has to guess which subset was committed.
*/
export function setAssetsMetadata(this: LibraryService, input: {
    libraryId: string;
    items: Array<{
      assetId: string;
      expectedVersion: number;
      description?: string;
      rating?: number;
      favorite?: boolean;
      palette?: string[];
      sourcePageUrl?: string;
      author?: string;
    }>;
  }): AssetMetadataResult[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.items.length === 0 || new Set(input.items.map((item) => item.assetId)).size !== input.items.length) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  // Keep the transaction boundary owned by runBoundedWrite. Calling the
  // single-item implementation here reuses all validation and version
  // conflict semantics without introducing a second mutation path.
  return input.items.map((item) => this.setAssetMetadata({
    libraryId: openLibrary.summary.libraryId,
    ...item,
  }));
}

export function backfillAssetMetadata(this: LibraryService, libraryId: string): { backfilledCount: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const now = new Date().toISOString();

  const result = openLibrary.connection
    .prepare(
      `INSERT OR IGNORE INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, author, entity_version, updated_at)
       SELECT asset_id, NULL, 0, 0, NULL, NULL, NULL, 1, ?
         FROM assets a
        WHERE NOT EXISTS (
          SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.asset_id
        )`,
    )
    .run(now);

  return { backfilledCount: result.changes };
}

/**
* Batch rating write (REQ-MENU-007). Rating is last-write-wins: unlike
* setAssetMetadata there is no optimistic version check, and only the
* rating column is written — description, favorite, palette, source URL,
* entity_version, and updated_at of existing rows are left untouched so a
* batch rating never invalidates a renderer's cached expectedVersion or
* overwrites concurrent field edits. Assets without a metadata row yet get
* one with schema defaults plus the requested rating. Unknown asset ids
* are skipped per-item, mirroring the batch tag operations.
*/
export function setAssetsRating(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    rating: number;
  }): { updatedCount: number; skipped: TagOperationSkip[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  // Renderer validation is not a trust boundary. Direct Worker clients must
  // obey the same rating contract and receive a metadata-specific error.
  if (!Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
    openLibrary.connection,
    input.assetIds,
  );
  if (eligibleAssetIds.length === 0) return { updatedCount: 0, skipped };

  const now = new Date().toISOString();
  const upsertStmt = openLibrary.connection.prepare(
    `INSERT INTO asset_metadata
       (asset_id, description, rating, favorite, palette,
        source_page_url, author, entity_version, updated_at)
     VALUES (?, NULL, ?, 0, NULL, NULL, NULL, 1, ?)
     ON CONFLICT(asset_id) DO UPDATE SET rating = excluded.rating`,
  );
  openLibrary.connection.transaction(() => {
    for (const assetId of eligibleAssetIds) {
      upsertStmt.run(assetId, input.rating, now);
    }
  })();
  // Rating is not part of the FTS content (see syncAssetSearchContent), so
  // no search-index sync is required here.
  this.emitClientAssetsChanged(input.libraryId, eligibleAssetIds.length);
  return { updatedCount: eligibleAssetIds.length, skipped };
}

// ── AI Analysis ────────────────────────────────────────────────────

/** Return the absolute filesystem path, MIME type, and whether this is a video asset. */
export function resolveAssetFilePath(this: LibraryService, libraryId: string, assetId: string): {
    filePath: string;
    mime: string;
    isVideo: boolean;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);

  const asset = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.location_kind, a.linked_folder_id,
              a.managed_folder_id, a.relative_file_path
         FROM assets a
        WHERE a.asset_id = ?`,
    )
    .get(assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      managed_folder_id: string | null;
      relative_file_path: string;
  } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (this.isExplicitlyIgnored(
    openLibrary,
    asset.location_kind,
    asset.linked_folder_id,
    asset.relative_file_path,
    'asset',
  )) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }

  let filePath: string;
  if (asset.location_kind === 'managed') {
    filePath = this.folderPath(openLibrary, asset.relative_file_path);
  } else {
    filePath = this.linkedAssetPath(
      openLibrary,
      asset.linked_folder_id,
      asset.relative_file_path,
    );
  }

  const ext = path.extname(asset.relative_file_path).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.opus': 'audio/ogg',
  };
  const mime = imageMimeForExtension(ext)
    ?? videoMimeForExtension(ext)
    ?? mimeMap[ext]
    ?? 'application/octet-stream';
  const isVideo = mime.startsWith('video/');

  return { filePath, mime, isVideo };
}

/** Display name shown in the UI (basename of the library-relative path). */
export function getAssetDisplayName(this: LibraryService, libraryId: string, assetId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare(`SELECT relative_file_path FROM assets WHERE asset_id = ?`)
    .get(assetId) as { relative_file_path: string } | undefined;
  if (!row?.relative_file_path) return 'asset';
  return path.posix.basename(row.relative_file_path);
}

export function resolveAssetPath(this: LibraryService, libraryId: string, assetId: string): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.managed_folder_id,
              a.relative_file_path
         FROM assets a WHERE a.asset_id = ?`,
    )
    .get(assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      managed_folder_id: string | null;
      relative_file_path: string;
    } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (this.isExplicitlyIgnored(
    openLibrary,
    asset.location_kind,
    asset.linked_folder_id,
    asset.relative_file_path,
    'asset',
  )) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  if (asset.location_kind === 'managed') {
    return this.folderPath(openLibrary, asset.relative_file_path);
  }
  return this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path);
}

/**
* Resolve files from an OS-native drag back to current asset ids. The
* absolute paths are consumed only in Worker; Renderer receives ids only.
* Matching both managed and linked roots keeps native drags usable for
* folder moves, tag drops, and trash drops.
*/
export function resolveAssetIdsByAbsolutePaths(this: LibraryService, libraryId: string, sourcePaths: readonly string[]): string[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const rows = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path
         FROM assets
        WHERE deleted_at IS NULL`,
    )
    .all() as Array<{
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
    }>;
  const linkedRoots = new Map(
    (
      openLibrary.connection
        .prepare(
          `SELECT folder_id, absolute_root_path
             FROM linked_folders
            WHERE library_id = ? AND status = 'available'`,
        )
        .all(libraryId) as Array<{
        folder_id: string;
        absolute_root_path: string;
      }>
    ).map((row) => [row.folder_id, row.absolute_root_path] as const),
  );
  const root = this.assetsPath(openLibrary);
  const key = (input: string): string => {
    const normalized = normalizeAbsolutePath(input);
    if (process.platform !== 'win32') return normalized;
    return normalized
      .split(path.sep)
      .map((segment) => portablePathSegmentIdentity(segment))
      .join('/');
  };
  const byPath = new Map<string, string>();
  for (const row of rows) {
    const base = row.location_kind === 'managed'
      ? root
      : row.linked_folder_id
        ? linkedRoots.get(row.linked_folder_id)
        : undefined;
    if (!base) continue;
    byPath.set(key(path.join(base, ...row.relative_file_path.split('/'))), row.asset_id);
  }
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    let assetId: string | undefined;
    try {
      assetId = byPath.get(key(sourcePath));
    } catch {
      continue;
    }
    if (assetId && !seen.has(assetId)) {
      seen.add(assetId);
      resolved.push(assetId);
    }
  }
  return resolved;
}

/** Media-type lookup for a single asset (used by the direct thumbnail path). */
export function isModelAsset(this: LibraryService, libraryId: string, assetId: string): boolean {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare('SELECT relative_file_path FROM assets WHERE asset_id = ?')
    .get(assetId) as { relative_file_path: string } | undefined;
  return (
    row !== undefined
    && LibraryService.detectMediaType(row.relative_file_path) === 'model'
  );
}

/**
* Batched native-drag priming entries (Serpent-v4jf).
*
* The legacy per-asset loop cost 3-4 point queries per asset (resolveAssetPath,
* getThumbnailArtifact, getArtifactAbsolutePath plus their internal lookups);
* priming a 50k-item browse result stalled the Worker event loop with ~150k+
* queries while Main awaited the primer before forwarding the browse response.
* This resolves the same semantics in 500-id chunks: one assets query per
* chunk (with the standard explicit-ignore filter), one ready
* thumbnail/video_poster query per chunk (video_poster preferred, matching
* getThumbnailArtifact), then per-entry filesystem checks that keep the
* exact safety boundary of the single-entry resolvers. Missing entries are
* skipped like the legacy loop; hard failures still throw.
*/
export async function resolveAssetDragInfos(this: LibraryService, libraryId: string, assetIds: readonly string[]): Promise<Array<{
    assetId: string;
    absolutePath: string;
    thumbnailAbsolutePath?: string;
  }>> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length === 0) return [];
  const connection = openLibrary.connection;
  const batchSize = 500;

  const assetRows: Array<{
    asset_id: string;
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_file_path: string;
    current_revision_id: string | null;
  }> = [];
  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const placeholders = sqliteInPlaceholders(batch);
    assetRows.push(
      ...(connection
        .prepare(
          `SELECT a.asset_id, a.location_kind, a.linked_folder_id,
                  a.relative_file_path, a.current_revision_id
             FROM assets a
            WHERE a.asset_id IN (${placeholders})
              AND ${this.explicitIgnoreSql(connection, 'a', false)}`,
        )
        .all(...batch) as typeof assetRows),
    );
  }

  // Lenient read: libraries predating revision_artifacts.status/kind have no
  // served thumbnails to resolve (the single-entry path would fail the same
  // columns); degrade to source-path-only entries instead of throwing.
  const artifactColumns = columnsFor(connection, 'revision_artifacts');
  const canResolveThumbnails =
    artifactColumns.has('status') && artifactColumns.has('kind');
  const thumbnailByRevision = new Map<
    string,
    { filePath: string }
  >();
  if (canResolveThumbnails) {
    const revisionIds = [
      ...new Set(
        assetRows
          .map((row) => row.current_revision_id)
          .filter((id): id is string => id !== null && id.length > 0),
      ),
    ];
    for (let i = 0; i < revisionIds.length; i += batchSize) {
      const batch = revisionIds.slice(i, i + batchSize);
      const placeholders = sqliteInPlaceholders(batch);
      const rows = connection
        .prepare(
          `SELECT revision_id, file_path
             FROM revision_artifacts
            WHERE revision_id IN (${placeholders})
              AND kind IN ('thumbnail', 'video_poster')
              AND status = 'ready'
              AND invalidated_at IS NULL
            ORDER BY revision_id, CASE kind WHEN 'video_poster' THEN 0 ELSE 1 END`,
        )
        .all(...batch) as Array<{ revision_id: string; file_path: string }>;
      for (const row of rows) {
        if (!thumbnailByRevision.has(row.revision_id)) {
          thumbnailByRevision.set(row.revision_id, { filePath: row.file_path });
        }
      }
    }
  }

  const entries: Array<{
    assetId: string;
    absolutePath: string;
    thumbnailAbsolutePath?: string;
  } | null> = Array.from({ length: assetRows.length }, () => null);
  const failures: unknown[] = [];
  let nextIndex = 0;
  // The SQL reads are short, but synchronous path validation across a drag
  // primer's page can hold the only Worker event loop for over a second.
  // Preserve each containment check while letting interactive requests run
  // between bounded filesystem operations.
  await Promise.all(Array.from({ length: Math.min(8, assetRows.length) }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= assetRows.length) return;
      const row = assetRows[index]!;
      let absolutePath: string;
      try {
        absolutePath =
          row.location_kind === 'managed'
            ? await this.folderPathAsync(openLibrary, row.relative_file_path)
            : await this.linkedAssetPathAsync(
                openLibrary,
                row.linked_folder_id,
                row.relative_file_path,
              );
      } catch (error) {
        if (
          error instanceof LibraryServiceError &&
          error.code === 'ASSET_NOT_FOUND'
        ) {
          continue;
        }
        failures.push(error);
        continue;
      }
      const thumbnail =
        row.current_revision_id === null
          ? undefined
          : thumbnailByRevision.get(row.current_revision_id);
      let thumbnailAbsolutePath: string | undefined;
      if (thumbnail) {
        try {
          thumbnailAbsolutePath = await this.artifactFilePathFromRootAsync(
            await this.artifactRootPathAsync(openLibrary), thumbnail.filePath,
          );
        } catch (error) {
          if (
            !(error instanceof LibraryServiceError) ||
            error.code !== 'ASSET_NOT_FOUND'
          ) {
            failures.push(error);
            continue;
          }
        }
      }
      entries[index] = {
        assetId: row.asset_id,
        absolutePath,
        ...(thumbnailAbsolutePath === undefined
          ? {}
          : { thumbnailAbsolutePath }),
      };
    }
  }));
  if (failures.length > 0) throw failures[0];
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function assetSummaryFromRow(this: LibraryService, row: CatalogAssetSummaryRow): AssetSummary {
  return catalogAssetSummaryFromRow(row);
}

/**
* Duplicate managed assets into a target folder (Option/Alt drag copy).
* Creates new asset identities; clones human metadata + tags; does not clone
* AI content, collections, or thumbnail binaries (regenerated via jobs).
*/
export function copyAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
    /** Internal history replay mapping; ordinary callers leave this unset. */
    outputAssetIds?: ReadonlyArray<{ sourceAssetId: string; newAssetId: string }>;
  }): {
    copiedCount: number;
    skippedCount: number;
    operationId: string | null;
    assets: AssetSummary[];
    outputAssetIdsBySource: Array<{ sourceAssetId: string; newAssetId: string }>;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  this.assertAssetsNotExplicitlyIgnored(openLibrary, input.assetIds);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  // 目标是链接文件夹（链接根或其虚拟子目录）：与 moveAssets 的链接分支对称，
  // 复制进链接外部目录并注册为链接资产（copyAssetsToLinkedFolder 支持 managed
  // 与 linked 源，Serpent-f6f779）。此分支需先于 linked 源分支判定，否则
  // 链接目标会落到 copyLinkedAssetsToManagedFolder 上。
  const copyLinkedTarget = input.targetFolderId === null
    ? null
    : this.linkedFolderRowForImport(openLibrary, input.targetFolderId);
  if (copyLinkedTarget) {
    const copied = this.copyAssetsToLinkedFolder({
      libraryId: input.libraryId,
      folderId: copyLinkedTarget.folder_id,
      ...(copyLinkedTarget.relative_path
        ? { relativePath: copyLinkedTarget.relative_path }
        : {}),
      assetIds: input.assetIds,
      conflictStrategy: input.conflictStrategy ?? 'keep-both',
    });
    return {
      copiedCount: copied.copiedCount,
      skippedCount: copied.skippedCount,
      operationId: null,
      assets: copied.assets,
      outputAssetIdsBySource: [],
    };
  }
  const locationRows = sqliteAllInChunks<string, { asset_id: string; location_kind: 'managed' | 'linked' }>({
    connection: openLibrary.connection,
    values: input.assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, location_kind
         FROM assets
        WHERE asset_id IN (${placeholders})
          AND deleted_at IS NULL`,
  });
  if (locationRows.some((row) => row.location_kind === 'linked')) {
    if (
      locationRows.length !== input.assetIds.length ||
      locationRows.some((row) => row.location_kind !== 'linked')
    ) {
      throw new LibraryServiceError('INVALID_SELECTION');
    }
    const linkedCopy = this.copyLinkedAssetsToManagedFolder({
      libraryId: input.libraryId,
      assetIds: input.assetIds,
      targetFolderId: input.targetFolderId,
    });
    return {
      ...linkedCopy,
      operationId: null,
      outputAssetIdsBySource: [],
    };
  }
  const targetFolder = input.targetFolderId === null
    ? undefined
    : this.targetFolder(openLibrary, input.targetFolderId);
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
    if (row.availability !== 'available') {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
  }

  const operationId = randomUUID();
  const selectedIds = new Set(input.assetIds);
  const outputAssetIds = new Map<string, string>();
  for (const mapping of input.outputAssetIds ?? []) {
    if (
      !UUID.test(mapping.sourceAssetId)
      || !UUID.test(mapping.newAssetId)
      || !selectedIds.has(mapping.sourceAssetId)
      || outputAssetIds.has(mapping.sourceAssetId)
      || [...outputAssetIds.values()].includes(mapping.newAssetId)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    outputAssetIds.set(mapping.sourceAssetId, mapping.newAssetId);
  }
  if (outputAssetIds.size > 0) {
    const outputIds = [...outputAssetIds.values()];
    const existingOutputIds = withSqliteInPredicate(
      openLibrary.connection,
      'asset_id',
      outputIds,
      (sql, params) =>
        openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
               WHERE ${sql}`,
          )
          .all(...params) as Array<{ asset_id: string }>,
    );
    if (existingOutputIds.length > 0) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
  }
  const planned = new Set<string>();
  const strategy = input.conflictStrategy ?? 'keep-both';
  const files: ManagedCopyOperationManifest['files'] = [];
  let skippedCount = 0;
  const targetPrefix = targetFolder?.relative_path ?? '';

  for (const assetId of input.assetIds) {
    const row = byId.get(assetId)!;
    if (!realFileExists(this.folderPath(openLibrary, row.relative_file_path))) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    const filename = path.posix.basename(row.relative_file_path);
    let destinationRelativePath = targetPrefix
      ? path.posix.join(targetPrefix, filename)
      : filename;
    let identity = portablePathIdentity(destinationRelativePath);
    // Same-folder / same-path always needs a keep-both style rename.
    const sameAsSource = identity === portablePathIdentity(row.relative_file_path);
    let conflict = sameAsSource
      ? null
      : this.managedMoveConflict(
          openLibrary,
          operationId,
          String(files.length),
          destinationRelativePath,
          assetId,
        );
    const selectedConflict = conflict?.assetId ? selectedIds.has(conflict.assetId) : false;
    const batchConflict = planned.has(identity) || selectedConflict || sameAsSource;
    if (batchConflict || conflict) {
      if (strategy === 'skip' && !sameAsSource) {
        skippedCount += 1;
        continue;
      }
      if (strategy === 'keep-both' || batchConflict || sameAsSource) {
        destinationRelativePath = this.availableMoveDestination(
          openLibrary,
          destinationRelativePath,
          planned,
        );
        identity = portablePathIdentity(destinationRelativePath);
        conflict = null;
      }
    }
    planned.add(identity);
    files.push({
      sourceAssetId: assetId,
      newAssetId: outputAssetIds.get(assetId) ?? randomUUID(),
      destinationConflict: strategy === 'replace' && !sameAsSource ? conflict : null,
      destinationFolderId: targetFolder?.folder_id ?? null,
      destinationRelativePath,
      sourceRelativePath: row.relative_file_path,
    });
  }

  if (files.length === 0) {
    return { copiedCount: 0, skippedCount, operationId: null, assets: [], outputAssetIdsBySource: [] };
  }
  const manifest: ManagedCopyOperationManifest = {
    files,
    kind: 'managed-copy',
    originalOperationId: null,
    version: 5,
  };
  this.applyManagedCopyOperation(openLibrary, operationId, manifest);
  this.noteClientFilesystemMutation();
  return {
    copiedCount: files.length,
    skippedCount,
    operationId,
    assets: this.managedMoveSummaries(
      openLibrary,
      files.map((file) => file.newAssetId),
    ),
    outputAssetIdsBySource: files.map((file) => ({
      sourceAssetId: file.sourceAssetId,
      newAssetId: file.newAssetId,
    })),
  };
}

export function readTextAsset(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    maxBytes?: number;
  }): {
    assetId: string;
    revisionId: string;
    content: string;
    truncated: boolean;
    byteSize: number;
    lineCount: number;
    editable: boolean;
    mimeType: string;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, relative_file_path, current_revision_id,
              availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  const isTrashed = row.deleted_at !== null;
  if (!row.current_revision_id) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (!isTrashed && row.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (LibraryService.detectMediaType(row.relative_file_path) !== 'text') {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }

  const absolutePath = isTrashed
    ? this.trashPath(
        openLibrary,
        row.asset_id,
        path.posix.basename(row.relative_file_path),
      )
    : this.resolveAssetPath(input.libraryId, input.assetId);
  const maxBytes = Math.min(
    Math.max(1, input.maxBytes ?? TEXT_VIEWER_MAX_BYTES),
    TEXT_VIEWER_MAX_BYTES,
  );
  const cacheKey = this.textAssetPreviewCacheKey(
    input.libraryId,
    input.assetId,
    row.current_revision_id,
    maxBytes,
  );
  const cached = this.readCachedTextAssetPreview(cacheKey);
  if (cached) return cached;
  let buffer: Buffer;
  try {
    const fd = openSync(absolutePath, 'r');
    try {
      const stat = fstatSync(fd);
      const toRead = Math.min(Number(stat.size), maxBytes + 1);
      buffer = Buffer.alloc(toRead);
      const bytesRead = readSync(fd, buffer, 0, toRead, 0);
      buffer = buffer.subarray(0, bytesRead);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', {
      reason: 'SOURCE_NOT_FOUND',
      cause: error,
    });
  }

  const truncated = buffer.length > maxBytes;
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
  const decoded = decodeTextBytes(slice);
  if (
    decoded.binary
    || (
      slice.includes(0)
      && decoded.encoding !== 'utf-16le'
      && decoded.encoding !== 'utf-16be'
    )
  ) {
    throw new LibraryServiceError('ASSET_CONTENT_INVALID');
  }
  const content = decoded.text;
  const extension = path.extname(row.relative_file_path).toLowerCase();
  const value = {
    assetId: row.asset_id,
    revisionId: row.current_revision_id,
    content,
    truncated,
    byteSize: truncated ? maxBytes : buffer.length,
    lineCount: countTextLines(content),
    editable: !isTrashed,
    mimeType: textMimeForExtension(extension) ?? 'text/plain',
  };
  this.cacheTextAssetPreview(cacheKey, value);
  return value;
}

/**
* Save UTF-8 text back to the asset source. Managed files stay inside the
* library. Linked files are written to their source path. Trashed assets
* are rejected.
*/
export function saveTextAsset(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    content: string;
    expectedRevisionId?: string;
    createRevision?: boolean;
  }): {
    asset: AssetSummary;
    revisionId: string;
    byteSize: number;
    lineCount: number;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (Buffer.byteLength(input.content, 'utf8') > TEXT_SAVE_MAX_BYTES) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, relative_file_path, current_revision_id,
              availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row || row.deleted_at || row.availability !== 'available' || !row.current_revision_id) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (LibraryService.detectMediaType(row.relative_file_path) !== 'text') {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }
  if (
    input.expectedRevisionId &&
    input.expectedRevisionId !== row.current_revision_id
  ) {
    throw new LibraryServiceError('VERSION_CONFLICT');
  }

  const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
  const dir = path.dirname(absolutePath);
  const tmpPath = path.join(dir, `.keel-text-edit-${randomUUID()}.tmp`);
  const payload = Buffer.from(input.content, 'utf8');
  this.noteClientFilesystemMutation();
  try {
    writeFileSync(tmpPath, payload);
    const fd = openSync(tmpPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, absolutePath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup.
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }

  // Persist the filesystem mtime/size so a subsequent watcher refresh does not
  // invent an `external_change` revision and break the next expectedRevisionId.
  let fileStat: Stats | BigIntStats;
  try {
    fileStat = this.options.assetLstat
      ? this.options.assetLstat(absolutePath)
      : lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  const storedByteSize = Number(fileStat.size);
  if (!Number.isSafeInteger(storedByteSize)) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  }
  const modifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
  const now = new Date().toISOString();
  const previousRevisionId = row.current_revision_id;
  const createRevision = input.createRevision === true;
  const revisionId = createRevision ? randomUUID() : previousRevisionId;
  openLibrary.connection.transaction(() => {
    if (createRevision) {
      openLibrary.connection
        .prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, 'replace', ?)`,
        )
        .run(
          revisionId,
          input.assetId,
          previousRevisionId,
          storedByteSize,
          modifiedAt,
          path.posix.basename(row.relative_file_path),
          now,
        );
      openLibrary.connection
        .prepare(
          `UPDATE assets
              SET current_revision_id = ?, updated_at = ?
            WHERE asset_id = ?`,
        )
        .run(revisionId, now, input.assetId);
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ?
              AND invalidated_at IS NULL`,
        )
        .run(now, previousRevisionId);
    } else {
      openLibrary.connection
        .prepare(
          `UPDATE revisions
              SET byte_size = ?, modified_at = ?
            WHERE revision_id = ?`,
        )
        .run(storedByteSize, modifiedAt, revisionId);
      openLibrary.connection
        .prepare(`UPDATE assets SET updated_at = ? WHERE asset_id = ?`)
        .run(now, input.assetId);
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ?
              AND invalidated_at IS NULL`,
        )
        .run(now, revisionId);
    }
    this.syncAssetSearchContent(openLibrary.connection, input.assetId);
  })();

  const [asset] = this.managedMoveSummaries(openLibrary, [input.assetId]);
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  this.invalidateTextAssetPreviewCache(input.libraryId, input.assetId);
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId: input.libraryId,
    changedCount: 1,
    missingCount: 0,
    source: 'text-save',
    nativeDragPathsChanged: true,
  });
  return {
    asset,
    revisionId,
    byteSize: storedByteSize,
    lineCount: countTextLines(input.content),
  };
}

/**
* Replace the bytes of an available managed asset without changing its
* asset identity or filename. The previous revision remains only as a
* database record; its derived artifacts are invalidated and the new
* revision is always marked as a client replacement.
*/
export function replaceManagedAssetContent(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    dataBase64: string;
    expectedRevisionId?: string;
  }): {
    assetId: string;
    revisionId: string;
    byteSize: number;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  if (
    input.dataBase64.length === 0
    || input.dataBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.dataBase64)
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  const payload = Buffer.from(input.dataBase64, 'base64');

  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path, current_revision_id,
              availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (row.deleted_at !== null || row.availability !== 'available' || !row.current_revision_id) {
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
  if (
    input.expectedRevisionId !== undefined
    && input.expectedRevisionId !== row.current_revision_id
  ) {
    throw new LibraryServiceError('VERSION_CONFLICT');
  }

  const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
  const dir = path.dirname(absolutePath);
  const tmpPath = path.join(dir, `.keel-content-replace-${randomUUID()}.tmp`);
  this.noteClientFilesystemMutation();
  try {
    writeFileSync(tmpPath, payload);
    const fd = openSync(tmpPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, absolutePath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup.
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }

  let fileStat: Stats | BigIntStats;
  try {
    fileStat = this.options.assetLstat
      ? this.options.assetLstat(absolutePath)
      : lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  const storedByteSize = Number(fileStat.size);
  if (!Number.isSafeInteger(storedByteSize)) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  }
  const modifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
  const now = new Date().toISOString();
  const revisionId = randomUUID();
  openLibrary.connection.transaction(() => {
    openLibrary.connection
      .prepare(
        `INSERT INTO revisions
           (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
            original_filename, origin, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'replace', ?)`,
      )
      .run(
        revisionId,
        input.assetId,
        row.current_revision_id,
        storedByteSize,
        modifiedAt,
        path.posix.basename(row.relative_file_path),
        now,
      );
    openLibrary.connection
      .prepare(
        `UPDATE assets
            SET current_revision_id = ?, updated_at = ?
          WHERE asset_id = ?`,
      )
      .run(revisionId, now, input.assetId);
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ?
            AND invalidated_at IS NULL`,
      )
      .run(now, row.current_revision_id);
    this.syncAssetSearchContent(openLibrary.connection, input.assetId);
  })();

  if (this.thumbnailEligible(input.libraryId, row.relative_file_path)) {
    this.enqueueThumbnailJobs(input.libraryId, {
      assetIds: [input.assetId],
      priority: 300,
      repairFailed: true,
    });
  }
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId: input.libraryId,
    changedCount: 1,
    missingCount: 0,
    source: 'content-replace',
    nativeDragPathsChanged: true,
  });
  return {
    assetId: input.assetId,
    revisionId,
    byteSize: storedByteSize,
  };
}

/**
* Replace several managed assets under one change-sequence fence. Every
* expected revision and every staged source is validated before the first
* destination is touched. The v6 file_operations manifest is a recovery
* journal, not a claim of cross-file filesystem atomicity.
*/
export function replaceManagedAssetContentBatch(this: LibraryService, input: {
    libraryId: string;
    items: Array<{
      assetId: string;
      expectedRevisionId: string;
      dataBase64?: string;
      stagingToken?: string;
    }>;
    automationPlan?: {
      planHash: string;
      expectedChangeSequence: number;
      assetStates: Array<{ assetId: string; stateToken: string }>;
    };
  }): {
    operationId: string;
    items: Array<{ assetId: string; revisionId: string; byteSize: number }>;
  } {
  if (
    input.items.length === 0 ||
    input.items.length > CONTENT_REPLACE_BATCH_MAX_ITEMS ||
    new Set(input.items.map((item) => item.assetId)).size !== input.items.length ||
    input.items.some((item) => (
      (item.dataBase64 === undefined) === (item.stagingToken === undefined)
    ))
  ) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  if (input.automationPlan !== undefined) {
    this.validateAutomationFileOperationPlan({
      libraryId: input.libraryId,
      operation: 'replace-content',
      assetIds: input.items.map((item) => item.assetId),
      planHash: input.automationPlan.planHash,
      expectedChangeSequence: input.automationPlan.expectedChangeSequence,
      assetStates: input.automationPlan.assetStates,
    });
  }
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const itemIds = input.items.map((item) => item.assetId);
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'assets.asset_id',
    itemIds,
    (sql, params) =>
      openLibrary.connection.prepare(
        `SELECT assets.asset_id, assets.location_kind, assets.linked_folder_id, assets.relative_file_path, assets.current_revision_id,
                revisions.modified_at AS current_modified_at,
                availability, deleted_at
           FROM assets
           LEFT JOIN revisions ON revisions.revision_id = assets.current_revision_id
          WHERE ${sql}`,
      ).all(...params) as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
        deleted_at: string | null;
        current_modified_at: string | null;
      }>,
  );
  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  for (const item of input.items) {
    const row = rowById.get(item.assetId);
    if (
      !row ||
      row.deleted_at !== null ||
      row.availability !== 'available' ||
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
    if (row.current_revision_id !== item.expectedRevisionId) {
      throw new LibraryServiceError('VERSION_CONFLICT');
    }
  }

  const operationId = randomUUID();
  const operationPath = path.join(
    this.assertSafeOperationsRoot(openLibrary.summary.libraryPath),
    operationId,
  );
  const stagePath = path.join(operationPath, 'stage');
  const backupPath = path.join(operationPath, 'backup');
  const manifest: ContentReplaceBatchOperationManifest = {
    kind: 'content-replace-batch',
    version: 6,
    files: [],
  };
  const resultItems: Array<{ assetId: string; revisionId: string; byteSize: number }> = [];
  mkdirSync(stagePath, { recursive: true });
  mkdirSync(backupPath, { recursive: true });
  try {
    for (const [index, item] of input.items.entries()) {
      const row = rowById.get(item.assetId)!;
      const stageName = `${index}.stage`;
      const stageFilePath = path.join(stagePath, stageName);
      if (item.dataBase64 !== undefined) {
        if (
          item.dataBase64.length === 0 ||
          item.dataBase64.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/u.test(item.dataBase64)
        ) {
          throw new LibraryServiceError('INVALID_ASSET_METADATA');
        }
        const payload = Buffer.from(item.dataBase64, 'base64');
        if (payload.length === 0) {
          throw new LibraryServiceError('INVALID_ASSET_METADATA');
        }
        writeFileSync(stageFilePath, payload, { mode: 0o600 });
      } else {
        const stagingToken = item.stagingToken!;
        if (!UUID.test(stagingToken)) throw new LibraryServiceError('INVALID_ASSET_METADATA');
        const stagingRoot = libraryMetaDir(openLibrary.summary.libraryPath, 'content-staging');
        const stagedPath = path.join(stagingRoot, `${stagingToken}.bin`);
        const metadataPath = path.join(stagingRoot, `${stagingToken}.json`);
        let metadata: unknown;
        let stagedByteSize: number | undefined;
        try {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as unknown;
          const entry = lstatSync(stagedPath);
          if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid staged content.');
          const byteSize = Number(entry.size);
          if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
            throw new Error('Invalid staged content length.');
          }
          stagedByteSize = byteSize;
        } catch (error) {
          throw new LibraryServiceError('INVALID_ASSET_METADATA', { cause: error });
        }
        if (
          typeof metadata !== 'object' ||
          metadata === null ||
          !('assetId' in metadata) ||
          metadata.assetId !== item.assetId ||
          !('byteSize' in metadata) ||
          typeof metadata.byteSize !== 'number' ||
          !Number.isSafeInteger(metadata.byteSize) ||
          metadata.byteSize <= 0 ||
          !('complete' in metadata) ||
          metadata.complete !== true
        ) {
          throw new LibraryServiceError('INVALID_ASSET_METADATA');
        }
        if (stagedByteSize !== metadata.byteSize) {
          throw new LibraryServiceError('INVALID_ASSET_METADATA');
        }
        copyFileSync(stagedPath, stageFilePath);
      }
      const stat = lstatSync(stageFilePath);
      const byteSize = Number(stat.size);
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
        throw new LibraryServiceError('INVALID_ASSET_METADATA');
      }
      const revisionId = randomUUID();
      manifest.files.push({
        assetId: item.assetId,
        backupName: `${index}.backup`,
        destinationRelativePath: row.relative_file_path,
        newRevisionId: revisionId,
        originalModifiedAt: row.current_modified_at ?? (() => {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        })(),
        originalSha256: sha256FileAtPath(this.resolveAssetPath(input.libraryId, item.assetId)),
        previousRevisionId: row.current_revision_id!,
        sha256: sha256FileAtPath(stageFilePath),
        stageName,
      });
      resultItems.push({ assetId: item.assetId, revisionId, byteSize });
    }

    const now = new Date().toISOString();
    openLibrary.connection.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'content-replace-batch', 'preparing', ?, NULL, ?, ?)`,
    ).run(operationId, JSON.stringify(manifest), now, now);
    const jobLease = new LibraryWriteCoordinator(openLibrary.writeConnection, input.libraryId)
      .claimJobOnce(operationId);
    const jobHeartbeat = jobLease.startHeartbeat();
    try {
      openLibrary.connection.prepare(
        `UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'`,
      ).run(new Date().toISOString(), operationId);
      for (const file of manifest.files) {
        const destinationPath = this.resolveAssetPath(input.libraryId, file.assetId);
        this.options.beforeContentReplaceBatchBackup?.({
          assetId: file.assetId,
          libraryId: input.libraryId,
        });
        if (sha256FileAtPath(destinationPath) !== file.originalSha256) {
          throw new LibraryServiceError('VERSION_CONFLICT', { reason: 'SOURCE_CHANGED' });
        }
        copyFileSync(destinationPath, path.join(backupPath, file.backupName));
      }
      this.failAt('crash-content-replace-batch-after-backup');
      for (const file of manifest.files) {
        const destinationPath = this.resolveAssetPath(input.libraryId, file.assetId);
        if (sha256FileAtPath(destinationPath) !== file.originalSha256) {
          throw new LibraryServiceError('VERSION_CONFLICT', { reason: 'SOURCE_CHANGED' });
        }
        const temporaryPath = path.join(
          path.dirname(destinationPath),
          `.keel-content-replace-batch-${operationId}-${file.assetId}.tmp`,
        );
        copyFileSync(path.join(stagePath, file.stageName), temporaryPath);
        const descriptor = openSync(temporaryPath, 'r+');
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        this.noteClientFilesystemMutation();
        renameSync(temporaryPath, destinationPath);
        this.failAt('crash-content-replace-batch-after-first-file');
      }
      this.failAt('crash-content-replace-batch-before-db-commit');
      const committedAt = new Date().toISOString();
      openLibrary.connection.transaction(() => {
        for (const file of manifest.files) {
          const destinationPath = this.resolveAssetPath(input.libraryId, file.assetId);
          const fileStat = lstatSync(destinationPath, { bigint: true });
          const storedByteSize = Number(fileStat.size);
          if (!Number.isSafeInteger(storedByteSize)) {
            throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
          }
          openLibrary.connection.prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at)
             VALUES (?, ?, ?, ?, ?, ?, 'replace', ?)`,
          ).run(
            file.newRevisionId,
            file.assetId,
            file.previousRevisionId,
            storedByteSize,
            new Date(Number(fileStat.mtimeMs)).toISOString(),
            path.posix.basename(file.destinationRelativePath),
            committedAt,
          );
          const changed = openLibrary.connection.prepare(
            `UPDATE assets SET current_revision_id = ?, updated_at = ?
               WHERE asset_id = ? AND current_revision_id = ?`,
          ).run(file.newRevisionId, committedAt, file.assetId, file.previousRevisionId);
          if (changed.changes !== 1) {
            throw new LibraryServiceError('VERSION_CONFLICT');
          }
          openLibrary.connection.prepare(
            `UPDATE revision_artifacts SET invalidated_at = ?
               WHERE revision_id = ? AND invalidated_at IS NULL`,
          ).run(committedAt, file.previousRevisionId);
          this.syncAssetSearchContent(openLibrary.connection, file.assetId);
        }
        jobLease.assertCurrent();
        openLibrary.connection.prepare(
          `UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?`,
        ).run(committedAt, operationId);
      })();
      this.failAt('crash-content-replace-batch-after-db-commit');
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error;
      const row = openLibrary.connection.prepare(
        `SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?`,
      ).get(operationId) as OperationRow | undefined;
      if (row?.status === 'committed') {
        this.diagnose('asset.content-replace-batch.post-commit', error, {
          operationId,
          libraryId: input.libraryId,
        });
      } else if (row) {
        try {
          this.recoverContentReplaceBatchOperation(openLibrary, row, manifest, operationPath);
        } catch (recoveryError) {
          openLibrary.connection.prepare(
            `UPDATE file_operations SET status = 'failed', error_code = 'CONTENT_REPLACE_APPLY_FAILED', updated_at = ? WHERE operation_id = ?`,
          ).run(new Date().toISOString(), operationId);
          this.diagnose('asset.content-replace-batch.rollback', recoveryError, {
            operationId,
            libraryId: input.libraryId,
          });
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    } finally {
      jobHeartbeat.stop();
      try {
        jobLease.release();
      } catch (releaseError) {
        this.diagnose('asset.content-replace-batch.lease-release', releaseError, {
          operationId,
          libraryId: input.libraryId,
        });
      }
    }
  } catch (error) {
    if (error instanceof SimulatedCrashError) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    const operationRow = openLibrary.connection.prepare(
      'SELECT status, error_code FROM file_operations WHERE operation_id = ?',
    ).get(operationId) as { status: string; error_code: string | null } | undefined;
    // A recovery conflict deliberately retains the journal so the external
    // destination change remains explainable and can be resolved explicitly.
    if (operationRow?.status !== 'failed' || operationRow.error_code !== 'CONTENT_REPLACE_RECOVERY_CONFLICT') {
      this.removeOperation(operationPath);
    }
    throw error;
  }

  this.removeOperation(operationPath);
  const stagingRoot = libraryMetaDir(openLibrary.summary.libraryPath, 'content-staging');
  for (const item of input.items) {
    if (item.stagingToken === undefined) continue;
    rmSync(path.join(stagingRoot, `${item.stagingToken}.bin`), { force: true });
    rmSync(path.join(stagingRoot, `${item.stagingToken}.json`), { force: true });
  }
  this.enqueueThumbnailJobs(input.libraryId, {
    assetIds: resultItems.map((item) => item.assetId),
    priority: 300,
    repairFailed: true,
  });
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId: input.libraryId,
    changedCount: resultItems.length,
    missingCount: 0,
    source: 'content-replace',
    nativeDragPathsChanged: true,
  });
  return { operationId, items: resultItems };
}

/**
* Read a bounded prefix of an available managed asset. The absolute source
* path remains inside the Worker and only opaque revision/content metadata
* crosses the automation boundary.
*/
export function readManagedAssetContent(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    maxBytes?: number;
    offsetBytes?: number;
  }): {
    assetId: string;
    revisionId: string;
    byteSize: number;
    dataBase64: string;
    truncated: boolean;
    mimeType: string | null;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, relative_file_path, current_revision_id,
              availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (row.deleted_at !== null || row.availability !== 'available' || !row.current_revision_id) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  const offsetBytes = input.offsetBytes ?? 0;
  if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  const limitBytes = input.maxBytes;
  if (limitBytes !== undefined && (!Number.isSafeInteger(limitBytes) || limitBytes <= 0)) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }

  const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
  const extension = path.extname(row.relative_file_path).toLowerCase();
  const mimeType = directImageMimeForExtension(extension)
    ?? videoMimeForExtension(extension)
    ?? audioMimeForExtension(extension)
    ?? textMimeForExtension(extension);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(absolutePath, 'r');
    const stats = fstatSync(descriptor);
    const byteSize = Number(stats.size);
    if (!Number.isSafeInteger(byteSize)) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
    }
    const readStart = Math.min(offsetBytes, byteSize);
    const bytesToRead = limitBytes === undefined
      ? byteSize - readStart
      : Math.min(limitBytes, byteSize - readStart);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    let filled = 0;
    while (filled < bytesToRead) {
      const count = readSync(descriptor, buffer, filled, bytesToRead - filled, readStart + filled);
      if (count === 0) break;
      filled += count;
    }
    const payload = filled === buffer.length ? buffer : buffer.subarray(0, filled);
    return {
      assetId: row.asset_id,
      revisionId: row.current_revision_id,
      byteSize,
      dataBase64: payload.toString('base64'),
      truncated: readStart + payload.length < byteSize,
      mimeType,
    };
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND', cause: error });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Worker-only precondition value for the reversible file-name recipe. */
export function getAssetFileBaseName(this: LibraryService, input: { libraryId: string; assetId: string }): string {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection.prepare(
    'SELECT relative_file_path FROM assets WHERE asset_id = ?',
  ).get(input.assetId) as { relative_file_path: string } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  const fileName = path.posix.basename(row.relative_file_path);
  const extension = path.posix.extname(fileName);
  return extension.length === 0 ? fileName : fileName.slice(0, -extension.length);
}

/** Worker-only precondition value for complete-file-name rename history. */
export function getAssetFileName(this: LibraryService, input: { libraryId: string; assetId: string }): string {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection.prepare(
    'SELECT relative_file_path FROM assets WHERE asset_id = ?',
  ).get(input.assetId) as { relative_file_path: string } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  return path.posix.basename(row.relative_file_path);
}

export function findActiveManagedAssetByContent(this: LibraryService, openLibrary: OpenLibrary, byteSize: number, sha256: string, contentHashCache: Map<string, string>, contentFingerprint?: string): {
    assetId: string;
    displayName: string;
    thumbnailArtifactId: string | null;
  } | null {
  const selectSameSize = `
    SELECT a.asset_id, a.relative_file_path,
           ra.artifact_id AS thumbnail_artifact_id,
           ra.status AS thumbnail_status
      FROM revisions AS r INDEXED BY revisions_size_fingerprint_idx
      JOIN assets a
        ON a.asset_id = r.asset_id
       AND a.current_revision_id = r.revision_id
     LEFT JOIN revision_artifacts ra
        ON ra.revision_id = r.revision_id
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
       AND ra.invalidated_at IS NULL
     WHERE a.deleted_at IS NULL
       AND a.location_kind = 'managed'
       AND r.byte_size = ?`;
  type MatchedAssetRow = {
    asset_id: string;
    relative_file_path: string;
    thumbnail_artifact_id: string | null;
    thumbnail_status: string | null;
  };
  const toMatch = (row: MatchedAssetRow) => ({
    assetId: row.asset_id,
    displayName: path.posix.basename(row.relative_file_path),
    thumbnailArtifactId:
      row.thumbnail_status === 'ready' ? row.thumbnail_artifact_id : null,
  });

  // Revisions already store a SHA-1 of file bytes. Matching that avoids
  // hashing every same-size library file for each imported item.
  if (contentFingerprint) {
    const fingerprinted = this.prepareCached<Statement>(
      openLibrary,
      `${selectSameSize} AND r.content_fingerprint = ?`,
    )
      .get(byteSize, contentFingerprint) as MatchedAssetRow | undefined;
    if (fingerprinted) return toMatch(fingerprinted);
  }

  const rows = this.prepareCached<Statement>(
    openLibrary,
    contentFingerprint
      ? `${selectSameSize} AND r.content_fingerprint IS NULL`
      : selectSameSize,
  )
    .all(byteSize) as MatchedAssetRow[];

  for (const row of rows) {
    const absolutePath = this.folderPath(openLibrary, row.relative_file_path);
    let fileHash = contentHashCache.get(absolutePath);
    if (fileHash === undefined) {
      try {
        fileHash = sha256FileAtPath(absolutePath);
        contentHashCache.set(absolutePath, fileHash);
      } catch {
        continue;
      }
    }
    if (fileHash === sha256) return toMatch(row);
  }
  return null;
}

/**
* Serpent-793k: find the managed asset occupying a destination path (a
* name-conflict collision target) so the conflict UI can show its real
* display name and thumbnail. Path matching is case-insensitive (Windows).
*/
export function findActiveManagedAssetAtPath(this: LibraryService, openLibrary: OpenLibrary, relativeFilePath: string): {
    assetId: string;
    displayName: string;
    thumbnailArtifactId: string | null;
  } | null {
  const row = this.prepareCached<Statement>(
    openLibrary,
    `SELECT a.asset_id, a.relative_file_path,
              ra.artifact_id AS thumbnail_artifact_id,
              ra.status AS thumbnail_status
         FROM assets a
         LEFT JOIN revision_artifacts ra
           ON ra.revision_id = a.current_revision_id
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
          AND ra.invalidated_at IS NULL
        WHERE a.deleted_at IS NULL
          AND a.location_kind = 'managed'
          AND a.current_revision_id IS NOT NULL
          AND a.path_identity = ?`,
  ).get(portablePathIdentity(relativeFilePath)) as {
    asset_id: string;
    relative_file_path: string;
    thumbnail_artifact_id: string | null;
    thumbnail_status: string | null;
  } | undefined;
  if (!row) return null;
  return {
    assetId: row.asset_id,
    displayName: path.posix.basename(row.relative_file_path),
    thumbnailArtifactId:
      row.thumbnail_status === 'ready' ? row.thumbnail_artifact_id : null,
  };
}

export function findActiveManagedAssetIdByContent(this: LibraryService, openLibrary: OpenLibrary, byteSize: number, sha256: string, contentHashCache: Map<string, string>, contentFingerprint?: string): string | null {
  return (
    this.findActiveManagedAssetByContent(
      openLibrary,
      byteSize,
      sha256,
      contentHashCache,
      contentFingerprint,
    )?.assetId ?? null
  );
}

export async function saveAssetFromUrl(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourcePageUrl?: string;
    mediaUrl: string;
    mediaType?: string;
  }): Promise<{ asset: AssetSummary }> {
  // Validate HTTP scheme on mediaUrl (already Zod-validated but defense in depth).
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.mediaUrl);
  } catch {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
  }

  const downloadDirectory = path.join(
    tmpdir(),
    `keel-extension-download-${randomUUID()}`,
  );
  const downloadedFilePath = path.join(downloadDirectory, 'download');
  let downloadTimer: ReturnType<typeof setTimeout> | undefined;
  let response: Awaited<ReturnType<PinnedHttpTransport>> | undefined;
  let importDelegated = false;
  try {
    mkdirSync(downloadDirectory, { recursive: true });

    // Download the media URL. The deadline covers DNS, redirects, headers,
    // and the complete response body rather than only the initial fetch.
    const controller = new AbortController();
    downloadTimer = setTimeout(() => controller.abort(new Error('Download timed out.')), DOWNLOAD_TIMEOUT_MS);

    let finalUrl = parsedUrl;
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        const resolvedAddress = await this.resolvePublicDownloadTarget(finalUrl);
        response = await (this.options.pinnedHttpTransport ?? defaultPinnedHttpTransport)({
          address: resolvedAddress.address,
          family: resolvedAddress.family,
          url: finalUrl,
          signal: controller.signal,
          headers: { 'User-Agent': 'Keel/1.0' },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        response.cancel();
        if (redirectCount >= MAX_DOWNLOAD_REDIRECTS) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
        }
        finalUrl = new URL(location, finalUrl);
        if ((finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') ||
            finalUrl.username || finalUrl.password) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
      }
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
    }

    if (!response) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
    }

    // Validate HTTP status.
    if (response.status < 200 || response.status >= 300) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'IO_ERROR',
        cause: new Error(`HTTP ${response.status}`),
      });
    }

    // Validate Content-Type.
    const contentType = normalizeRemoteContentType(response.headers.get('content-type'));
    const contentTypeFailure = remoteMediaValidationFailure(contentType);
    if (contentTypeFailure) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: contentTypeFailure,
        cause: new Error(contentTypeFailure === 'MIME_TYPE_MISSING'
          ? 'The response did not declare Content-Type.'
          : `Unsupported Content-Type: ${contentType}`),
      });
    }

    const declaredLengthText = response.headers.get('content-length');
    if (declaredLengthText !== null) {
      const declaredLength = Number(declaredLengthText);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
          cause: new Error('Invalid or oversized Content-Length.'),
        });
      }
    }

    // Determine filename.
    let filename: string;
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const cdFilename = parseContentDispositionFilename(contentDisposition);
      if (cdFilename) {
        filename = cleanFilename(cdFilename);
      } else {
        filename = filenameFromUrl(finalUrl.href, contentType);
      }
    } else {
      filename = filenameFromUrl(finalUrl.href, contentType);
    }

    // Ensure filename has a reasonable extension that matches content-type.
    const fileExt = path.posix.extname(filename).toLowerCase();
    if (fileExt === '' || fileExt === '.') {
      const ctExt = extensionForContentType(contentType);
      if (ctExt) filename = `${filename}${ctExt}`;
    } else if (!filenameMatchesRemoteContentType(filename, contentType)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'MIME_EXTENSION_MISMATCH',
        cause: new Error(`Filename extension ${fileExt} does not match ${contentType}.`),
      });
    }

    // Stream directly to the stage file with a running size limit.
    const stageFilePath = downloadedFilePath;
    if (!response.body) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
    }
    const writer = createWriteStream(stageFilePath, { flags: 'wx' });
    let writerFailure: Error | undefined;
    writer.on('error', (error) => { writerFailure = error; });
    const waitForWriter = (event: 'drain' | 'finish'): Promise<void> =>
      new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => {
          writer.removeListener(event, onReady);
          writer.removeListener('error', onError);
        };
        writer.once(event, onReady);
        writer.once('error', onError);
      });
    let totalBytes = 0;
    const magicProbe = new RemoteMediaMagicProbe();
    let magicValidated = false;
    try {
      for await (const value of response.body) {
        if (writerFailure) throw writerFailure;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_DOWNLOAD_BYTES) {
          response.cancel();
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
            cause: new Error('File exceeds 500 MB limit.'),
          });
        }
        magicProbe.add(value);
        if (!magicValidated && magicProbe.canValidate(contentType)) {
          if (!magicProbe.matches(contentType)) {
            response.cancel();
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'MAGIC_BYTES_MISMATCH',
              cause: new Error(`File signature does not match ${contentType}.`),
            });
          }
          magicValidated = true;
        }
        if (!writer.write(Buffer.from(value))) {
          await waitForWriter('drain');
        }
      }
      if (!magicValidated && !magicProbe.matches(contentType)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'MAGIC_BYTES_MISMATCH',
          cause: new Error(`File signature does not match ${contentType}.`),
        });
      }
      writer.end();
      if (writerFailure) throw writerFailure;
      await waitForWriter('finish');
      if (writerFailure) throw writerFailure;
    } finally {
      try { response.cancel(); } catch { /* Already released. */ }
      if (!writer.closed) writer.destroy();
      if (downloadTimer) clearTimeout(downloadTimer);
      downloadTimer = undefined;
    }
    // The network-specific trust boundary ends here. The downloaded bytes
    // now enter the exact same extension/import kernel as browser uploads and
    // ordinary file imports, including staging, conflict planning, journaling,
    // metadata, leases, rollback and recovery.
    importDelegated = true;
    return await this.saveAssetFromFile({
      libraryId: input.libraryId,
      ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
      ...(input.sourcePageUrl === undefined ? {} : { sourcePageUrl: input.sourcePageUrl }),
      mediaUrl: input.mediaUrl,
      stagedFilePath: stageFilePath,
      contentType,
      filename,
    });
  } catch (error) {
    if (downloadTimer) clearTimeout(downloadTimer);
    try { response?.cancel(); } catch { /* Best effort socket cleanup. */ }
    if (!importDelegated) {
      this.diagnose('extension-save.failed', sanitizedUrlDiagnosticError(error), {
        libraryId: input.libraryId,
        targetHost: parsedUrl.hostname,
        ...(input.sourcePageUrl
          ? { sourcePageUrl: sanitizedUrlForDiagnostic(input.sourcePageUrl) }
          : {}),
        mediaUrl: sanitizedUrlForDiagnostic(input.mediaUrl),
      });
    }
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  } finally {
    rmSync(downloadDirectory, { recursive: true, force: true });
  }
}

/**
* Import media already fetched by the browser extension (Serpent-1jyi).
* Main stages the bytes under a temp directory; Worker copies into the
* library operation stage and reuses the URL-import commit path.
*/
export async function saveAssetFromFile(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourcePageUrl?: string;
    mediaUrl?: string;
    stagedFilePath: string;
    contentType: string;
    filename: string;
  }): Promise<{ asset: AssetSummary }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  let stagedAbsolute: string;
  try {
    stagedAbsolute = realpathSync(input.stagedFilePath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
  }
  let stagedStat: Stats;
  try {
    stagedStat = lstatSync(stagedAbsolute);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
  }
  if (!stagedStat.isFile() || stagedStat.isSymbolicLink()) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'UNSUPPORTED_FILE_ENTRY' });
  }
  if (stagedStat.size <= 0 || stagedStat.size > MAX_DOWNLOAD_BYTES) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'UNSUPPORTED_FILE_ENTRY',
      cause: new Error('Invalid or oversized staged file.'),
    });
  }

  const contentType = normalizeRemoteContentType(input.contentType);
  const contentTypeFailure = remoteMediaValidationFailure(contentType);
  if (contentTypeFailure) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: contentTypeFailure,
      cause: new Error(
        contentTypeFailure === 'MIME_TYPE_MISSING'
          ? 'The upload did not declare Content-Type.'
          : `Unsupported Content-Type: ${contentType}`,
      ),
    });
  }

  let filename = cleanFilename(input.filename);
  const fileExt = path.posix.extname(filename).toLowerCase();
  if (fileExt === '' || fileExt === '.') {
    const ctExt = extensionForContentType(contentType);
    if (ctExt) filename = `${filename}${ctExt}`;
  } else if (!filenameMatchesRemoteContentType(filename, contentType)) {
    const ctExt = extensionForContentType(contentType);
    if (!ctExt) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'MIME_EXTENSION_MISMATCH',
        cause: new Error(`Filename extension ${fileExt} does not match ${contentType}.`),
      });
    }
    // Browser uploads often carry CDN URL extensions that disagree with the
    // declared Content-Type; magic-byte validation below is authoritative.
    filename = `${path.posix.basename(filename, fileExt)}${ctExt}`;
  }

  const magicProbe = new RemoteMediaMagicProbe();
  const probeFd = openSync(stagedAbsolute, 'r');
  try {
    const probeBuf = Buffer.alloc(32);
    const bytesRead = readSync(probeFd, probeBuf, 0, 32, 0);
    magicProbe.add(probeBuf.subarray(0, bytesRead));
  } finally {
    closeSync(probeFd);
  }
  if (!magicProbe.matches(contentType)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'MAGIC_BYTES_MISMATCH',
      cause: new Error(`File signature does not match ${contentType}.`),
    });
  }

  // The browser upload has already passed the extension-specific trust
  // boundary above. From this point on, give it the same source shape as a
  // normal file import so destination naming, duplicate decisions, the
  // operation journal, leases, rollback and metadata all share one kernel.
  // Remote filenames are the only input that can exceed the filesystem
  // component limit (local sources are already bounded by the filesystem
  // itself); assert before copying so both platforms surface the same
  // PATH_LIMIT_EXCEEDED instead of an OS error misread as a missing source.
  assertNameWithinFsLimit(filename);
  const sourceDirectory = path.join(tmpdir(), `keel-extension-import-${randomUUID()}`);
  const sourcePath = path.join(sourceDirectory, filename);
  try {
    mkdirSync(sourceDirectory, { recursive: true });
    copyFileSync(stagedAbsolute, sourcePath);

    const prepared = this.prepareOrExecuteImport({
      libraryId: input.libraryId,
      ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
      sourceKind: 'files',
      sourcePaths: [sourcePath],
      ...(input.sourcePageUrl === undefined ? {} : { sourcePageUrl: input.sourcePageUrl }),
    });
    const completion = this.finishImportWithoutUserDecision(prepared, {
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    const asset = completion.assets[0];
    if (asset !== undefined) return { asset };

    // A library-level duplicate is intentionally skipped by the extension,
    // matching the ordinary import default. Return the retained asset just
    // as the old extension path did, without creating a second record.
    const existingAssetId = this.findActiveManagedAssetIdByContent(
      openLibrary,
      stagedStat.size,
      sha256FileAtPath(sourcePath),
      new Map(),
    );
    if (existingAssetId !== null) {
      const existing = this.listAssets({
        libraryId: input.libraryId,
        recursive: true,
      }).find((candidate) => candidate.assetId === existingAssetId);
      if (existing !== undefined) return { asset: existing };
    }
    throw new LibraryServiceError('IMPORT_APPLY_FAILED');
  } catch (error) {
    this.diagnose('extension-save-file.failed', sanitizedUrlDiagnosticError(error), {
      libraryId: input.libraryId,
      ...(input.sourcePageUrl
        ? { sourcePageUrl: sanitizedUrlForDiagnostic(input.sourcePageUrl) }
        : {}),
      ...(input.mediaUrl ? { mediaUrl: sanitizedUrlForDiagnostic(input.mediaUrl) } : {}),
      contentType,
    });
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  } finally {
    rmSync(sourceDirectory, { recursive: true, force: true });
  }
}
