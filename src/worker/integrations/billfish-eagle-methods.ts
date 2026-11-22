import { type AssetSummary } from "../../shared/asset-types";
import { isImportSourceFailurePlan } from "../../shared/import-outcome";
import { directImageMimeForExtension } from "../../shared/media-formats";
import { type BillfishImportResult, type EagleImportResult, type ImportCompletion, type ImportConflictPlan, type ImportProgressEvent, type InternalLibrarySummary } from "../../shared/protocol/responses";
import { randomTagAppearance } from "../../shared/tag-appearance";
import { LibraryService, LibraryServiceError, copyFileExclusive, serviceError, sourceSnapshot, transferCheckpoint, type EagleCopiedThumbnail, type EagleImportedMetadata, type ImportSourceEntry, type OpenLibrary, type TransferCancelState } from "../library-service";
import { hasTable } from "../library/lenient-columns";
import { LibraryParentError, resolveWritableLibraryParent } from "../library/library-parent";
import { normalizeAbsolutePath, normalizeAssetFileBaseName, normalizeRelativeAssetPath } from "../library/library-rules";
import { pathIsWithin } from "../library/path-utils";
import { BillfishLibraryReadError, readBillfishLibrary, type BillfishAssetCandidate } from "./billfish-library";
import { EagleLibraryReadError, readEagleAssetCandidate, readEagleLibraryRoot, sumEagleLibrarySourceBytes, type EagleAssetCandidate, type EagleFolderNode } from "./eagle-library";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface BillfishEagleMethods {
  persistEagleImportedMetadata(...args: Parameters<typeof persistEagleImportedMetadata>): ReturnType<typeof persistEagleImportedMetadata>;
  ensureEagleFolderTags(...args: Parameters<typeof ensureEagleFolderTags>): ReturnType<typeof ensureEagleFolderTags>;
  ensureEagleTags(...args: Parameters<typeof ensureEagleTags>): ReturnType<typeof ensureEagleTags>;
  eagleImportEntry(...args: Parameters<typeof eagleImportEntry>): ReturnType<typeof eagleImportEntry>;
  ensureBillfishTags(...args: Parameters<typeof ensureBillfishTags>): ReturnType<typeof ensureBillfishTags>;
  billfishImportEntry(...args: Parameters<typeof billfishImportEntry>): ReturnType<typeof billfishImportEntry>;
  wrapEagleImportStageError(...args: Parameters<typeof wrapEagleImportStageError>): ReturnType<typeof wrapEagleImportStageError>;
  copyEagleThumbnailFile(...args: Parameters<typeof copyEagleThumbnailFile>): ReturnType<typeof copyEagleThumbnailFile>;
  insertCopiedEagleThumbnail(...args: Parameters<typeof insertCopiedEagleThumbnail>): ReturnType<typeof insertCopiedEagleThumbnail>;
  persistEagleThumbnailArtifact(...args: Parameters<typeof persistEagleThumbnailArtifact>): ReturnType<typeof persistEagleThumbnailArtifact>;
  importEagleLibrary(...args: Parameters<typeof importEagleLibrary>): ReturnType<typeof importEagleLibrary>;
  inspectEagleLibrary(...args: Parameters<typeof inspectEagleLibrary>): ReturnType<typeof inspectEagleLibrary>;
  openEagleLibrary(...args: Parameters<typeof openEagleLibrary>): ReturnType<typeof openEagleLibrary>;
  importBillfishLibrary(...args: Parameters<typeof importBillfishLibrary>): ReturnType<typeof importBillfishLibrary>;
  inspectBillfishLibrary(...args: Parameters<typeof inspectBillfishLibrary>): ReturnType<typeof inspectBillfishLibrary>;
  openBillfishLibrary(...args: Parameters<typeof openBillfishLibrary>): ReturnType<typeof openBillfishLibrary>;
}

export function persistEagleImportedMetadata(this: LibraryService, openLibrary: OpenLibrary, assetId: string, metadata: EagleImportedMetadata, now: string): void {
  openLibrary.connection
    .prepare(
      `INSERT INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, entity_version, updated_at)
       VALUES (?, ?, ?, 0, NULL, ?, 1, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         description = excluded.description,
         rating = excluded.rating,
         favorite = excluded.favorite,
         source_page_url = excluded.source_page_url,
         entity_version = asset_metadata.entity_version + 1,
         updated_at = excluded.updated_at`,
    )
    .run(
      assetId,
      metadata.description,
      metadata.rating,
      metadata.sourcePageUrl,
      now,
    );

  const insertTag = openLibrary.connection.prepare(
    'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
  );
  for (const tagId of metadata.tagIds) insertTag.run(assetId, tagId);

  // Search FTS is rebuilt once after the asset row commits; doing it here
  // doubled the GROUP_CONCAT + FTS write on every Eagle/Billfish item.
}

/**
* Eagle folders become hierarchical tags. A same-named tag under the same
* parent is reused; when the name is already taken elsewhere, the tag gets
* a stable suffix from the Eagle folder id so a re-import finds it again.
* Tag names never contain the folder path.
*/
export function ensureEagleFolderTags(this: LibraryService, openLibrary: OpenLibrary, folders: readonly EagleFolderNode[]): Map<string, string> {
  const tagIdsByFolder = new Map<string, string>();
  const db = openLibrary.connection;
  const libraryId = openLibrary.summary.libraryId;
  const hasHierarchy = hasTable(db, 'tag_hierarchy');
  const hasAppearance = hasTable(db, 'tag_appearance');
  const findByName = db.prepare(
    'SELECT tag_id FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
  );
  const parentOf = (tagId: string): string | null => {
    if (!hasHierarchy) return null;
    const row = db.prepare('SELECT parent_tag_id FROM tag_hierarchy WHERE tag_id = ?')
      .get(tagId) as { parent_tag_id: string | null } | undefined;
    return row?.parent_tag_id ?? null;
  };
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const folder of folders) {
      const parentTagId = folder.parentFolderId === null
        ? null
        : (tagIdsByFolder.get(folder.parentFolderId) ?? null);
      const baseName = folder.name.trim() || folder.folderId;
      const candidates = [baseName, `${baseName}（Eagle ${folder.folderId.slice(0, 8)}）`];
      let tagId: string | undefined;
      for (const name of candidates) {
        const existing = findByName.get(libraryId, name) as { tag_id: string } | undefined;
        if (!existing) {
          const createdId = randomUUID();
          db.prepare('INSERT INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)')
            .run(createdId, libraryId, name, now);
          if (hasAppearance) this.setTagAppearance(openLibrary, createdId, randomTagAppearance());
          if (hasHierarchy && parentTagId !== null) this.setTagParent(openLibrary, createdId, parentTagId);
          tagId = createdId;
          break;
        }
        if (parentOf(existing.tag_id) === parentTagId) {
          tagId = existing.tag_id;
          break;
        }
      }
      if (tagId) tagIdsByFolder.set(folder.folderId, tagId);
    }
  })();
  return tagIdsByFolder;
}

export function ensureEagleTags(this: LibraryService, openLibrary: OpenLibrary, items: readonly EagleAssetCandidate[], tagIdsByName: Map<string, string>): void {
  const names = new Set(items.flatMap((item) => item.tags));
  const now = new Date().toISOString();
  openLibrary.connection.transaction(() => {
    for (const name of names) {
      if (tagIdsByName.has(name)) continue;
      const existing = openLibrary.connection
        .prepare(
          'SELECT tag_id FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
        )
        .get(openLibrary.summary.libraryId, name) as { tag_id: string } | undefined;
      if (existing) {
        tagIdsByName.set(name, existing.tag_id);
        continue;
      }
      const tagId = randomUUID();
      openLibrary.connection
        .prepare(
          'INSERT OR IGNORE INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(tagId, openLibrary.summary.libraryId, name, now);
      const inserted = openLibrary.connection
        .prepare(
          'SELECT tag_id FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
        )
        .get(openLibrary.summary.libraryId, name) as { tag_id: string } | undefined;
      if (inserted) {
        tagIdsByName.set(name, inserted.tag_id);
        if (inserted.tag_id === tagId && hasTable(openLibrary.connection, 'tag_appearance')) this.setTagAppearance(openLibrary, tagId, randomTagAppearance());
      }
    }
  })();
}

export function eagleImportEntry(this: LibraryService, sourceRootPath: string, item: EagleAssetCandidate, folderTagIdsByFolder: ReadonlyMap<string, string>, tagIdsByName: ReadonlyMap<string, string>): ImportSourceEntry | null {
  try {
    const resolvedSourcePath = path.resolve(item.sourcePath);
    if (!pathIsWithin(sourceRootPath, resolvedSourcePath)) {
      throw new EagleLibraryReadError('Eagle source escaped its library root.');
    }
    const sourceStat = lstatSync(resolvedSourcePath, { bigint: true });
    if (
      sourceStat.isSymbolicLink()
      || !sourceStat.isFile()
      || sourceStat.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new EagleLibraryReadError('Eagle source is no longer a regular file.');
    }
    const fileName = normalizeAssetFileBaseName(path.basename(item.sourcePath));
    const destinationRelativePath = normalizeRelativeAssetPath(fileName);
    const tagIds = [...new Set(
      [
        ...item.tags.map((tag) => tagIdsByName.get(tag)),
        ...item.folderIds.map((folderId) => folderTagIdsByFolder.get(folderId)),
      ].filter((tagId): tagId is string => tagId !== undefined),
    )];
    return {
      byteSize: Number(sourceStat.size),
      destinationRelativePath,
      eagleMetadata: {
        description: item.description,
        rating: item.rating,
        sourceModifiedAtMs: item.sourceModifiedAtMs,
        sourcePageUrl: item.sourcePageUrl,
        sourceRootPath,
        tagIds,
        thumbnailPath: item.thumbnailPath ? path.resolve(item.thumbnailPath) : null,
        ...(item.width && item.height
          ? { width: item.width, height: item.height }
          : {}),
      },
      sourceSnapshot: sourceSnapshot(sourceStat),
      sourcePath: resolvedSourcePath,
    };
  } catch (error) {
    this.diagnose('eagle-import.item-skipped', error, { itemId: item.itemId });
    return null;
  }
}

export function ensureBillfishTags(this: LibraryService, openLibrary: OpenLibrary, items: readonly BillfishAssetCandidate[], tagIdsByName: Map<string, string>): void {
  const names = new Set(items.flatMap((item) => item.metadata?.tags ?? []));
  const now = new Date().toISOString();
  openLibrary.connection.transaction(() => {
    for (const name of names) {
      if (tagIdsByName.has(name)) continue;
      const existing = openLibrary.connection
        .prepare(
          'SELECT tag_id FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
        )
        .get(openLibrary.summary.libraryId, name) as { tag_id: string } | undefined;
      if (existing) {
        tagIdsByName.set(name, existing.tag_id);
        continue;
      }
      const tagId = randomUUID();
      openLibrary.connection
        .prepare(
          'INSERT OR IGNORE INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(tagId, openLibrary.summary.libraryId, name, now);
      const inserted = openLibrary.connection
        .prepare(
          'SELECT tag_id FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
        )
        .get(openLibrary.summary.libraryId, name) as { tag_id: string } | undefined;
      if (inserted) {
        tagIdsByName.set(name, inserted.tag_id);
        if (inserted.tag_id === tagId && hasTable(openLibrary.connection, 'tag_appearance')) this.setTagAppearance(openLibrary, tagId, randomTagAppearance());
      }
    }
  })();
}

export function billfishImportEntry(this: LibraryService, sourceRootPath: string, item: BillfishAssetCandidate, tagIdsByName: ReadonlyMap<string, string>): ImportSourceEntry | null {
  try {
    const resolvedSourcePath = path.resolve(item.sourcePath);
    if (!pathIsWithin(sourceRootPath, resolvedSourcePath)) {
      throw new BillfishLibraryReadError('Billfish source escaped its library root.');
    }
    const sourceStat = lstatSync(resolvedSourcePath, { bigint: true });
    if (
      sourceStat.isSymbolicLink()
      || !sourceStat.isFile()
      || sourceStat.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new BillfishLibraryReadError('Billfish source is no longer a regular file.');
    }
    const destinationRelativePath = normalizeRelativeAssetPath(item.relativePath);
    const metadata = item.metadata;
    const tagIds = [...new Set(
      (metadata?.tags ?? [])
        .map((tag) => tagIdsByName.get(tag))
        .filter((tagId): tagId is string => tagId !== undefined),
    )];
    return {
      byteSize: Number(sourceStat.size),
      destinationRelativePath,
      eagleMetadata: metadata
        ? {
            description: metadata.description,
            rating: metadata.rating,
            sourceModifiedAtMs: item.sourceModifiedAtMs,
            sourcePageUrl: metadata.sourcePageUrl,
            sourceRootPath,
            tagIds,
            thumbnailPath: metadata.thumbnailPath ? path.resolve(metadata.thumbnailPath) : null,
            thumbnailGeneratorVersion: 'billfish-thumbnail@1',
          }
        : undefined,
      sourceSnapshot: sourceSnapshot(sourceStat),
      sourcePath: resolvedSourcePath,
    };
  } catch (error) {
    this.diagnose('billfish-import.item-skipped', error, {
      relativePath: item.relativePath,
    });
    return null;
  }
}

export function wrapEagleImportStageError(this: LibraryService, error: unknown, reason: 'IMPORT_COPY_FAILED' | 'IMPORT_REGISTER_FAILED'): LibraryServiceError {
  if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
    return error;
  }
  if (error instanceof LibraryServiceError && error.reason) {
    return new LibraryServiceError('IMPORT_APPLY_FAILED', {
      cause: error,
      reason: error.reason,
    });
  }
  return new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error, reason });
}

/**
* Eagle already stores a bounded still preview beside every normal item.
* Keep that preview as Keel's ready card artifact; importing a video
* must not decode the full source merely to make the first screen visible.
*/
export function copyEagleThumbnailFile(this: LibraryService, openLibrary: OpenLibrary, destinationRelativePath: string, metadata: EagleImportedMetadata): EagleCopiedThumbnail | undefined {
  if (!metadata.thumbnailPath) return undefined;
  const canonicalRoot = path.resolve(metadata.sourceRootPath);
  const resolvedThumbnailPath = path.resolve(metadata.thumbnailPath);
  if (!pathIsWithin(canonicalRoot, resolvedThumbnailPath)) {
    throw new EagleLibraryReadError('Eagle thumbnail escaped its library root.');
  }
  const thumbnailStat = lstatSync(resolvedThumbnailPath, { bigint: true });
  if (
    thumbnailStat.isSymbolicLink()
    || !thumbnailStat.isFile()
    || thumbnailStat.size <= 0n
    || thumbnailStat.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new EagleLibraryReadError('Eagle thumbnail is not a supported regular file.');
  }
  const extension = path.extname(resolvedThumbnailPath).toLowerCase();
  const mimeType = directImageMimeForExtension(extension);
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new EagleLibraryReadError('Eagle thumbnail format is not supported.');
  }
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}${extension || '.png'}`;
  const artifactsDir = this.artifactsDir(openLibrary);
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  if (!this.artifactsDirReady.has(openLibrary)) {
    mkdirSync(artifactsDir, { recursive: true });
    this.artifactsDirReady.add(openLibrary);
  }
  copyFileExclusive(resolvedThumbnailPath, artifactAbsPath);
  // Do not decode or trust the source metadata here. Copy-first must publish
  // the card without blocking the import, while the low-priority job below
  // performs a bounded pixel validation before it can retire this legacy
  // generator marker. This also keeps a truncated file from becoming a
  // permanently "verified" artifact merely because its header was readable.
  return {
    artifactAbsPath,
    artifactId,
    artifactKind: LibraryService.detectMediaType(destinationRelativePath) === 'video'
      ? 'video_poster'
      : 'thumbnail',
    artifactRelPath,
    byteSize: Number(thumbnailStat.size),
    generatorVersion: metadata.thumbnailGeneratorVersion ?? 'eagle-thumbnail@1',
    height: metadata.height ?? null,
    mimeType,
    width: metadata.width ?? null,
  };
}

export function insertCopiedEagleThumbnail(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string, copied: EagleCopiedThumbnail): void {
  const now = new Date().toISOString();
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE revision_id = ? AND kind = ? AND invalidated_at IS NULL`,
    )
    .run(now, revisionId, copied.artifactKind);
  openLibrary.connection
    .prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    )
    .run(
      copied.artifactId,
      revisionId,
      copied.artifactKind,
      copied.mimeType,
      copied.byteSize,
      copied.artifactRelPath,
      copied.width,
      copied.height,
      copied.generatorVersion,
      now,
    );
  // Every copied preview is verified in the background, including a small
  // one. Header dimensions and metadata are not sufficient to prove that
  // the compressed pixel stream is readable.
  this.enqueueImportedThumbnailNormalizationJob(openLibrary, assetId, revisionId);
}

export function persistEagleThumbnailArtifact(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string, destinationRelativePath: string, metadata: EagleImportedMetadata): void {
  let artifactAbsPath: string | undefined;
  try {
    const copied = this.copyEagleThumbnailFile(
      openLibrary,
      destinationRelativePath,
      metadata,
    );
    if (!copied) return;
    artifactAbsPath = copied.artifactAbsPath;
    openLibrary.connection.transaction(() => {
      this.insertCopiedEagleThumbnail(openLibrary, assetId, revisionId, copied);
    })();
  } catch (error) {
    if (artifactAbsPath) rmSync(artifactAbsPath, { force: true });
    this.diagnose('eagle-import.thumbnail-skipped', error, {
      assetId,
      reason: 'EAGLE_THUMBNAIL_FAILED',
    });
  }
}

export async function importEagleLibrary(this: LibraryService, input: {
    libraryId: string;
    sourceRootPath: string;
  }): Promise<EagleImportResult> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const importId = randomUUID();
  const cancelState: TransferCancelState = { cancelled: false };
  this.activeImports.set(importId, cancelState);
  let totalFiles = 0;
  let totalBytes = 0;
  let filesProcessed = 0;
  let bytesProcessed = 0;
  const emitEagleProgress = (
    phase: ImportProgressEvent['phase'],
    processedFiles = filesProcessed,
    processedBytes = bytesProcessed,
  ): void => {
    this.emitProgress({
      type: 'import.progress',
      importId,
      phase,
      cancelable: true,
      filesProcessed: processedFiles,
      totalFiles,
      bytesProcessed: processedBytes,
      totalBytes,
    });
  };
  const throwIfCancelled = (): void => {
    if (!cancelState.cancelled) return;
    emitEagleProgress('cancelled');
    throw new LibraryServiceError('CANCELLED');
  };

  emitEagleProgress('validate', 0, 0);
  let root: ReturnType<typeof readEagleLibraryRoot>;
  try {
    root = readEagleLibraryRoot(input.sourceRootPath);
  } catch (error) {
    emitEagleProgress('failed');
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'EAGLE_METADATA_UNREADABLE',
    });
  }

  totalFiles = root.infoDirectoryNames.length;
  emitEagleProgress('validate', 0, 0);
  try {
    throwIfCancelled();
    const folderTagIdsByFolder = this.ensureEagleFolderTags(openLibrary, root.folders);
    emitEagleProgress('validate', 0, 0);
    await transferCheckpoint();
    throwIfCancelled();
    const imagesPath = root.imagesPath;
    if (!imagesPath || root.infoDirectoryNames.length === 0) {
      emitEagleProgress('complete', 0, 0);
      return {
        sourceDisplayName: root.displayName,
        fileCount: 0,
        importedCount: 0,
        assetCount: 0,
        skippedCount: 0,
        replacedCount: 0,
        tagCount: new Set(folderTagIdsByFolder.values()).size,
        invalidItemCount: 0,
        assets: [],
      };
    }
    const sizeScanBatch = 256;
    for (let offset = 0; offset < root.infoDirectoryNames.length; offset += sizeScanBatch) {
      throwIfCancelled();
      const slice = root.infoDirectoryNames.slice(offset, offset + sizeScanBatch);
      totalBytes += sumEagleLibrarySourceBytes(imagesPath, slice);
      emitEagleProgress('validate', Math.min(totalFiles, offset + slice.length), 0);
      await transferCheckpoint();
    }
    emitEagleProgress('validate', 0, 0);
    let importedCount = 0;
    let skippedCount = 0;
    let replacedCount = 0;
    let invalidItemCount = 0;
    const sampleAssets: AssetSummary[] = [];
    const tagIdsByName = new Map<string, string>();
    const batchSize = 128;
    const destinationIndex = this.managedDestinationIndex(openLibrary);
    let lastCopyProgressAt = 0;
    const emitCopyProgress = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastCopyProgressAt < 250) return;
      lastCopyProgressAt = now;
      emitEagleProgress('copy');
    };

    for (let offset = 0; offset < root.infoDirectoryNames.length; offset += batchSize) {
      throwIfCancelled();
      const infoNames = root.infoDirectoryNames.slice(offset, offset + batchSize);
      emitEagleProgress('validate', offset, bytesProcessed);
      const items: EagleAssetCandidate[] = [];
      for (const infoDirectoryName of infoNames) {
        const result = readEagleAssetCandidate(imagesPath, infoDirectoryName);
        if ('item' in result) {
          items.push(result.item);
          continue;
        }
        skippedCount += 1;
        if (result.invalid) invalidItemCount += 1;
      }
      this.ensureEagleTags(openLibrary, items, tagIdsByName);
      const batch: ImportSourceEntry[] = [];
      for (const item of items) {
        const entry = this.eagleImportEntry(
          root.sourceRootPath,
          item,
          folderTagIdsByFolder,
          tagIdsByName,
        );
        if (entry) batch.push(entry);
        else {
          skippedCount += 1;
          invalidItemCount += 1;
        }
      }
      const batchBytesBefore = bytesProcessed;
      let batchBytesCopied = 0;
      if (batch.length > 0) {
        let plan;
        try {
          plan = this.prepareImport({
            libraryId: input.libraryId,
            sourceKind: 'files',
            sourcePaths: batch.map((entry) => entry.sourcePath),
            sourceEntries: batch,
            sourceDirectories: [],
            createImageSequence: false,
            dedupeSameNameByContent: true,
            skipLibraryDuplicateScan: true,
            skipContentHash: true,
            destinationIndex,
            onStagedEntry: (batchProcessed, stagedBytes) => {
              throwIfCancelled();
              batchBytesCopied += stagedBytes;
              filesProcessed = offset + batchProcessed;
              bytesProcessed = batchBytesBefore + batchBytesCopied;
              emitCopyProgress();
            },
            suppressAssetChangeEvents: true,
          });
        } catch (error) {
          throw this.wrapEagleImportStageError(error, 'IMPORT_COPY_FAILED');
        }
        let completion;
        try {
          completion = this.resolveImport({
            importId: plan.importId,
            suspectedDuplicate: 'skip',
            nameConflict: 'keep-both',
          });
        } catch (error) {
          throw this.wrapEagleImportStageError(error, 'IMPORT_REGISTER_FAILED');
        }
        importedCount += completion.importedCount;
        skippedCount += completion.skippedCount;
        replacedCount += completion.replacedCount;
        this.suppressAutoAnalysisForAssets(
          input.libraryId,
          completion.assets.map((asset) => asset.assetId),
        );
        if (sampleAssets.length < 300) {
          sampleAssets.push(...completion.assets.slice(0, 300 - sampleAssets.length));
        }
        if (completion.importedCount + completion.replacedCount > 0) {
          this.options.onAssetsChanged?.({
            type: 'asset.changed',
            libraryId: input.libraryId,
            changedCount: completion.importedCount + completion.replacedCount,
            missingCount: 0,
            source: 'client',
            nativeDragPathsChanged: true,
          });
        }
      }
      filesProcessed = Math.min(totalFiles, offset + infoNames.length);
      bytesProcessed = Math.min(totalBytes, batchBytesBefore + items.reduce((total, item) => total + item.byteSize, 0));
      emitCopyProgress(true);
      await transferCheckpoint();
      throwIfCancelled();
    }
    emitEagleProgress('complete', totalFiles, totalBytes);
    return {
      sourceDisplayName: root.displayName,
      fileCount: root.infoDirectoryNames.length,
      importedCount,
      assetCount: importedCount,
      skippedCount,
      replacedCount,
      tagCount: new Set([...tagIdsByName.values(), ...folderTagIdsByFolder.values()]).size,
      invalidItemCount,
      assets: sampleAssets,
    };
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'CANCELLED') throw error;
    emitEagleProgress('failed');
    throw error;
  } finally {
    this.activeImports.delete(importId);
  }
}

/**
* Read Eagle root metadata and return the default Keel display name.
* Main keeps the source path; Renderer only receives this name for the
* rename panel that precedes choosing a save location.
*/
export function inspectEagleLibrary(this: LibraryService, sourceRootPath: string): { displayName: string } {
  let root: ReturnType<typeof readEagleLibraryRoot>;
  try {
    root = readEagleLibraryRoot(sourceRootPath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'EAGLE_METADATA_UNREADABLE',
    });
  }
  const displayName = root.displayName.trim() || path.basename(root.sourceRootPath);
  return { displayName };
}

/**
* Convert an Eagle library into a new Keel library at a user-chosen
* parent directory and open the converted result. The Eagle directory is
* never modified; this is the implementation behind the library-name
* menu's "Open Eagle library" action. Main inspects the source, the user
* confirms a display name, then Main collects the Keel save location
* before this command runs. After that destination is chosen, Main closes
* any previously open library before conversion starts.
*/
export async function openEagleLibrary(this: LibraryService, input: {
    sourceRootPath: string;
    selectedParentPath: string;
    displayName: string;
  }): Promise<InternalLibrarySummary> {
  let root: ReturnType<typeof readEagleLibraryRoot>;
  try {
    root = readEagleLibraryRoot(input.sourceRootPath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'EAGLE_METADATA_UNREADABLE',
    });
  }

  let sourceRoot: string;
  let parentPath: string;
  try {
    sourceRoot = realpathSync(normalizeAbsolutePath(input.sourceRootPath));
    parentPath = resolveWritableLibraryParent({
      selectedParentPath: input.selectedParentPath,
      sourceRootPath: sourceRoot,
      createIfMissing: true,
    });
  } catch (error) {
    if (error instanceof LibraryParentError) {
      throw new LibraryServiceError(error.code, { reason: error.reason, cause: error });
    }
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }

  const displayName = input.displayName.trim() || root.displayName.trim() || path.basename(sourceRoot);
  let created: InternalLibrarySummary | undefined;
  try {
    created = this.createLibrary({
      displayName,
      selectedParentPath: parentPath,
    });
    await this.importEagleLibrary({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });
    return created;
  } catch (error) {
    if (created) {
      try {
        this.closeLibrary(created.libraryId);
      } catch {
        // Best-effort close before removing a conversion that did not finish.
      }
      try {
        rmSync(created.libraryPath, { force: true, recursive: true });
      } catch (cleanupError) {
        this.diagnose('eagle-open.cleanup', cleanupError, {
          libraryPath: created.libraryPath,
        });
      }
    }
    throw error;
  }
}

export async function importBillfishLibrary(this: LibraryService, input: {
    libraryId: string;
    sourceRootPath: string;
  }): Promise<BillfishImportResult> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const importId = randomUUID();
  const cancelState: TransferCancelState = { cancelled: false };
  this.activeImports.set(importId, cancelState);
  let totalFiles = 0;
  let totalBytes = 0;
  let filesProcessed = 0;
  let bytesProcessed = 0;
  const emitBillfishProgress = (
    phase: ImportProgressEvent['phase'],
    processedFiles = filesProcessed,
    processedBytes = bytesProcessed,
  ): void => {
    this.emitProgress({
      type: 'import.progress',
      importId,
      phase,
      cancelable: true,
      filesProcessed: processedFiles,
      totalFiles,
      bytesProcessed: processedBytes,
      totalBytes,
    });
  };
  const throwIfCancelled = (): void => {
    if (!cancelState.cancelled) return;
    emitBillfishProgress('cancelled');
    throw new LibraryServiceError('CANCELLED');
  };

  emitBillfishProgress('validate', 0, 0);
  let root: ReturnType<typeof readBillfishLibrary>;
  try {
    root = readBillfishLibrary(input.sourceRootPath);
  } catch (error) {
    emitBillfishProgress('failed');
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'BILLFISH_METADATA_UNREADABLE',
    });
  }

  totalFiles = root.items.length;
  totalBytes = root.items.reduce((total, item) => total + item.byteSize, 0);
  const tagIdsByName = new Map<string, string>();
  let importedCount = 0;
  let skippedCount = root.skippedCount;
  let replacedCount = 0;
  let invalidItemCount = root.skippedCount;
  let metadataCount = 0;
  const sampleAssets: AssetSummary[] = [];
  const batchSize = 128;
  const destinationIndex = this.managedDestinationIndex(openLibrary);
  let lastCopyProgressAt = 0;
  const emitCopyProgress = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastCopyProgressAt < 250) return;
    lastCopyProgressAt = now;
    emitBillfishProgress('copy');
  };

  try {
    for (let offset = 0; offset < root.items.length; offset += batchSize) {
      throwIfCancelled();
      const items = root.items.slice(offset, offset + batchSize);
      emitBillfishProgress('validate', offset, bytesProcessed);
      this.ensureBillfishTags(openLibrary, items, tagIdsByName);
      const batch: ImportSourceEntry[] = [];
      for (const item of items) {
        const entry = this.billfishImportEntry(root.sourceRootPath, item, tagIdsByName);
        if (entry) {
          batch.push(entry);
          if (item.metadata) metadataCount += 1;
        } else {
          skippedCount += 1;
          invalidItemCount += 1;
        }
      }
      const batchBytesBefore = bytesProcessed;
      let batchBytesCopied = 0;
      if (batch.length > 0) {
        let plan: ImportConflictPlan;
        try {
          const prepared = this.prepareImport({
            libraryId: input.libraryId,
            sourceKind: 'files',
            sourcePaths: batch.map((entry) => entry.sourcePath),
            sourceEntries: batch,
            sourceDirectories: root.directories,
            createImageSequence: false,
            dedupeSameNameByContent: true,
            skipLibraryDuplicateScan: true,
            skipContentHash: true,
            destinationIndex,
            onStagedEntry: (batchProcessed, stagedBytes) => {
              throwIfCancelled();
              batchBytesCopied += stagedBytes;
              filesProcessed = offset + batchProcessed;
              bytesProcessed = batchBytesBefore + batchBytesCopied;
              emitCopyProgress();
            },
            suppressAssetChangeEvents: true,
          });
          if (isImportSourceFailurePlan(prepared)) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
          }
          plan = prepared;
        } catch (error) {
          throw this.wrapEagleImportStageError(error, 'IMPORT_COPY_FAILED');
        }
        let completion: ImportCompletion;
        try {
          completion = this.resolveImport({
            importId: plan.importId,
            suspectedDuplicate: 'skip',
            nameConflict: 'keep-both',
          });
        } catch (error) {
          throw this.wrapEagleImportStageError(error, 'IMPORT_REGISTER_FAILED');
        }
        importedCount += completion.importedCount;
        skippedCount += completion.skippedCount;
        replacedCount += completion.replacedCount;
        this.suppressAutoAnalysisForAssets(
          input.libraryId,
          completion.assets.map((asset) => asset.assetId),
        );
        if (sampleAssets.length < 300) {
          sampleAssets.push(...completion.assets.slice(0, 300 - sampleAssets.length));
        }
        if (completion.importedCount + completion.replacedCount > 0) {
          this.options.onAssetsChanged?.({
            type: 'asset.changed',
            libraryId: input.libraryId,
            changedCount: completion.importedCount + completion.replacedCount,
            missingCount: 0,
            source: 'client',
            nativeDragPathsChanged: true,
          });
        }
      }
      filesProcessed = Math.min(totalFiles, offset + items.length);
      bytesProcessed = Math.min(
        totalBytes,
        batchBytesBefore + items.reduce((total, item) => total + item.byteSize, 0),
      );
      emitCopyProgress(true);
      await transferCheckpoint();
      throwIfCancelled();
    }
    emitBillfishProgress('complete', totalFiles, totalBytes);
    return {
      sourceDisplayName: root.displayName,
      fileCount: root.items.length,
      importedCount,
      assetCount: importedCount,
      skippedCount,
      replacedCount,
      tagCount: tagIdsByName.size,
      invalidItemCount,
      metadataCount,
      assets: sampleAssets,
    };
  } catch (error) {
    if (error instanceof LibraryServiceError && error.code === 'CANCELLED') throw error;
    emitBillfishProgress('failed');
    throw error;
  } finally {
    this.activeImports.delete(importId);
  }
}

export function inspectBillfishLibrary(this: LibraryService, sourceRootPath: string, sourceDisplayName?: string): { displayName: string } {
  let root: ReturnType<typeof readBillfishLibrary>;
  try {
    root = readBillfishLibrary(sourceRootPath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'BILLFISH_METADATA_UNREADABLE',
    });
  }
  const rootDisplayName = root.displayName.trim();
  const extractedRootName = path.basename(root.sourceRootPath).trim();
  // `readBillfishLibrary` falls back to the extracted directory name when
  // the pack has no displayName metadata. That name is generated by Main
  // (`keel-external-library-*`) and must never leak into the new-library
  // form; use the original .BillfishPack stem in that case.
  const displayName =
    sourceDisplayName?.trim() && rootDisplayName === extractedRootName
      ? sourceDisplayName.trim()
      : rootDisplayName || sourceDisplayName?.trim() || extractedRootName;
  return { displayName };
}

export async function openBillfishLibrary(this: LibraryService, input: {
    sourceRootPath: string;
    selectedParentPath: string;
    displayName: string;
  }): Promise<InternalLibrarySummary> {
  let root: ReturnType<typeof readBillfishLibrary>;
  try {
    root = readBillfishLibrary(input.sourceRootPath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      cause: error,
      reason: 'BILLFISH_METADATA_UNREADABLE',
    });
  }

  let sourceRoot: string;
  let parentPath: string;
  try {
    sourceRoot = realpathSync(normalizeAbsolutePath(input.sourceRootPath));
    parentPath = resolveWritableLibraryParent({
      selectedParentPath: input.selectedParentPath,
      sourceRootPath: sourceRoot,
      createIfMissing: true,
    });
  } catch (error) {
    if (error instanceof LibraryParentError) {
      throw new LibraryServiceError(error.code, { reason: error.reason, cause: error });
    }
    throw serviceError(error, 'INVALID_LIBRARY_PATH');
  }

  const displayName = input.displayName.trim() || root.displayName.trim() || path.basename(sourceRoot);
  let created: InternalLibrarySummary | undefined;
  try {
    created = this.createLibrary({
      displayName,
      selectedParentPath: parentPath,
    });
    await this.importBillfishLibrary({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });
    return created;
  } catch (error) {
    if (created) {
      try {
        this.closeLibrary(created.libraryId);
      } catch {
        // Best-effort close before removing a conversion that did not finish.
      }
      try {
        rmSync(created.libraryPath, { force: true, recursive: true });
      } catch (cleanupError) {
        this.diagnose('billfish-open.cleanup', cleanupError, {
          libraryPath: created.libraryPath,
        });
      }
    }
    throw error;
  }
}
