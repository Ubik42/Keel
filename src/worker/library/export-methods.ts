import { LIBRARY_META_DIR_NAMES, isLibraryIgnoreFileName, isLibraryMetaDirName, libraryMetaDir } from "../../shared/library-meta-dir";
import { LibraryService, LibraryServiceError, assertTreeContainsNoSymlinks, cleanFilename, directoryExists, existingIgnoreConfigPath, hasErrorCode, realDirectoryExists, transferCheckpoint, type TransferCancelState, waitForStreamClose } from "../library-service";
import { pathIsWithin } from "./path-utils";
import { ZipImportStreamError, extractZipStream, type ZipArchiveManifest, zipBombProtectionLimits } from "./zip-import-stream";
import { randomUUID } from "node:crypto";
import { closeSync, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface ExportMethods {
  zipAssetAbsolutePath(...args: Parameters<typeof zipAssetAbsolutePath>): ReturnType<typeof zipAssetAbsolutePath>;
  acquireExportTransfer(...args: Parameters<typeof acquireExportTransfer>): ReturnType<typeof acquireExportTransfer>;
  releaseExportTransfer(...args: Parameters<typeof releaseExportTransfer>): ReturnType<typeof releaseExportTransfer>;
  mapZipImportError(...args: Parameters<typeof mapZipImportError>): ReturnType<typeof mapZipImportError>;
  exportLibraryToFolder(...args: Parameters<typeof exportLibraryToFolder>): ReturnType<typeof exportLibraryToFolder>;
  cancelExport(...args: Parameters<typeof cancelExport>): ReturnType<typeof cancelExport>;
  exportLibraryToZip(...args: Parameters<typeof exportLibraryToZip>): ReturnType<typeof exportLibraryToZip>;
  importLibraryFromZip(...args: Parameters<typeof importLibraryFromZip>): ReturnType<typeof importLibraryFromZip>;
}

export function zipAssetAbsolutePath(this: LibraryService, input: { libraryId: string; assetId: string }): {
    absolutePath: string;
    revisionId: string;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, relative_file_path, current_revision_id,
              availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      asset_id: string;
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
  if (!row?.current_revision_id) {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  const isTrashed = row.deleted_at !== null;
  if (!isTrashed && row.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (path.extname(row.relative_file_path).toLowerCase() !== '.zip') {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }
  const absolutePath = isTrashed
    ? this.trashPath(
        openLibrary,
        row.asset_id,
        path.posix.basename(row.relative_file_path),
      )
    : this.resolveAssetPath(input.libraryId, input.assetId);
  return { absolutePath, revisionId: row.current_revision_id };
}

export function acquireExportTransfer(this: LibraryService, libraryId: string, exportId: string, cancelState: TransferCancelState): void {
  const activeExportId = this.activeExportByLibraryId.get(libraryId);
  if (activeExportId) {
    this.transferInProgress('transfer.export.in-progress', {
      libraryId,
      activeExportId,
      requestedExportId: exportId,
    });
  }
  this.activeExportByLibraryId.set(libraryId, exportId);
  this.activeExports.set(exportId, cancelState);
}

export function releaseExportTransfer(this: LibraryService, libraryId: string, exportId: string): void {
  this.activeExports.delete(exportId);
  if (this.activeExportByLibraryId.get(libraryId) === exportId) {
    this.activeExportByLibraryId.delete(libraryId);
  }
}

export function mapZipImportError(this: LibraryService, error: ZipImportStreamError): LibraryServiceError {
  switch (error.code) {
    case 'CANCELLED':
      return new LibraryServiceError('CANCELLED', { cause: error });
    case 'ZIP_TOO_LARGE':
      return new LibraryServiceError('ZIP_TOO_LARGE', {
        cause: error,
        reason: 'ZIP_TOO_LARGE',
      });
    case 'PATH_ESCAPE':
      return new LibraryServiceError('NOT_A_LIBRARY', {
        cause: error,
        reason: 'PATH_ESCAPE',
      });
    case 'SYMBOLIC_LINK_NOT_ALLOWED':
      return new LibraryServiceError('NOT_A_LIBRARY', {
        cause: error,
        reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
      });
    case 'DESTINATION_EXISTS':
    case 'INVALID_ZIP':
    case 'IO_ERROR':
      return new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  }
}

export async function exportLibraryToFolder(this: LibraryService, input: {
    libraryId: string;
    destinationPath: string;
    includeLinkedContent: boolean;
  }): Promise<{
    exportId: string;
    fileCount: number;
    totalBytes: number;
    excludedPreviewCount: number;
    includedLinkedContent: boolean;
    durationMs: number;
  }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const exportId = randomUUID();

  // The destination is owned by this operation only if it did not exist and
  // this call created it. Never merge into a user-owned directory.
  if (existsSync(input.destinationPath)) {
    throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
  }
  let canonicalDest: string;
  let canonicalLib: string;
  try {
    const canonicalParent = realpathSync(path.dirname(input.destinationPath));
    canonicalDest = path.join(canonicalParent, path.basename(input.destinationPath));
    canonicalLib = realpathSync(openLibrary.summary.libraryPath);
  } catch (error) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
  }
  if (pathIsWithin(canonicalLib, canonicalDest)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }

  const cancelState: TransferCancelState = { cancelled: false };
  this.acquireExportTransfer(input.libraryId, exportId, cancelState);
  const startedAt = Date.now();
  let destinationOwned = false;

  try {
    mkdirSync(canonicalDest);
    destinationOwned = true;

    const libPath = openLibrary.summary.libraryPath;

    // Phase 1: snapshot-db
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    await transferCheckpoint();
    if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

    const tempDbPath = path.join(canonicalDest, `.keel-export-${exportId}.db`);
    // Online Backup yields between page batches, allowing the live library to
    // continue serving reads and writes while SQLite maintains a consistent
    // snapshot for the exported database.
    await this.createConsistentDatabaseSnapshot(openLibrary.writeConnection, tempDbPath, cancelState);

    let semanticBackupPath: string | null = null;
    if (this.options.backupSemanticIndex) {
      semanticBackupPath = libraryMetaDir(canonicalDest, 'semantic', 'index.sqlite');
      mkdirSync(path.dirname(semanticBackupPath), { recursive: true });
      const copied = await this.options.backupSemanticIndex({
        libraryId: input.libraryId,
        libraryPath: openLibrary.summary.libraryPath,
        storageKind: openLibrary.summary.storageKind ?? 'unknown',
        destinationPath: semanticBackupPath,
      });
      if (!copied) {
        rmSync(libraryMetaDir(canonicalDest), { recursive: true, force: true });
        semanticBackupPath = null;
      }
    }

    // Phase 2: enumerate
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'enumerate', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });

    interface ExportEntry {
      sourcePath: string;
      relativePath: string;
      byteSize: number;
    }
    const entries: ExportEntry[] = [];
    let excludedPreviewCount = 0;
    if (semanticBackupPath) {
      const semanticStat = statSync(semanticBackupPath);
      entries.push({ sourcePath: semanticBackupPath, relativePath: '.keel/semantic/index.sqlite',
        byteSize: semanticStat.size });
    }

    const walkDir = async (dirPath: string, relPrefix: string): Promise<void> => {
      if (cancelState.cancelled) return;
      let children;
      try {
        children = readdirSync(dirPath, { withFileTypes: true });
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      for (const child of children) {
        await transferCheckpoint();
        if (cancelState.cancelled) return;
        const childPath = path.join(dirPath, child.name);
        const childRel = relPrefix ? path.posix.join(relPrefix, child.name) : child.name;

        if (child.isSymbolicLink()) continue; // Never follow symlinks in export.

        if (child.isDirectory()) {
          // Exclude generated sidecar trees; the semantic DB is added from
          // a verified SQLite backup snapshot above, never copied live.
          if (childRel === '.keel/previews' || childRel === '.keel/operations'
            || childRel === '.keel/semantic') {
            if (childRel === '.keel/previews') {
              // Count preview files for excludedPreviewCount.
              try {
                excludedPreviewCount = countFilesRecursive(childPath);
              } catch {
                // Best effort count.
              }
            }
            continue;
          }
          await walkDir(childPath, childRel);
        } else if (child.isFile()) {
          // Exclude AI temp files.
          const lowerName = child.name.toLowerCase();
          if (
            lowerName.endsWith('.tmp') ||
            lowerName.includes('.wave-tmp.') ||
            lowerName.includes('-tmp.') ||
            (lowerName.startsWith('.') && (
              lowerName.includes('temp') || lowerName.includes('cache') ||
              lowerName.startsWith('.ds_store') || lowerName === 'thumbs.db'
            ))
          ) {
            continue;
          }
          // Exclude WAL/SHM files for the temp backup (just in case).
          if (childPath === `${tempDbPath}-wal` || childPath === `${tempDbPath}-shm`) continue;

          const stat = lstatSync(childPath);
          if (stat.isSymbolicLink()) continue;
          entries.push({
            sourcePath: childPath,
            relativePath: childRel,
            byteSize: stat.size,
          });
        }
      }
    };

    function countFilesRecursive(dirPath: string): number {
      let count = 0;
      try {
        for (const child of readdirSync(dirPath, { withFileTypes: true })) {
          if (child.isSymbolicLink()) continue;
          const childPath = path.join(dirPath, child.name);
          if (child.isDirectory()) {
            count += countFilesRecursive(childPath);
          } else if (child.isFile()) {
            count += 1;
          }
        }
      } catch {
        // Best effort.
      }
      return count;
    }

    // Preserve the selected storage layout in folder and ZIP exports.
    if (openLibrary.summary.storageLayout === 'root') {
      for (const child of readdirSync(libPath, { withFileTypes: true })) {
        if (isLibraryMetaDirName(child.name) || isLibraryIgnoreFileName(child.name)) continue;
        if (child.isSymbolicLink()) continue;
        const sourcePath = path.join(libPath, child.name);
        if (child.isDirectory()) await walkDir(sourcePath, child.name);
        else if (child.isFile()) entries.push({ sourcePath, relativePath: child.name, byteSize: lstatSync(sourcePath).size });
      }
    } else {
      await walkDir(this.assetsPath(openLibrary), 'Assets');
    }
    const layoutMarker = libraryMetaDir(libPath, 'storage-layout.json');
    if (existsSync(layoutMarker)) {
      entries.push({ sourcePath: layoutMarker, relativePath: '.keel/storage-layout.json', byteSize: statSync(layoutMarker).size });
    }

    // Keep the library-scoped ignore source of truth with folder exports.
    const gitignoreFile = existingIgnoreConfigPath(libPath);
    if (gitignoreFile) {
      const ignoreStat = statSync(gitignoreFile);
      entries.push({ sourcePath: gitignoreFile, relativePath: path.basename(gitignoreFile), byteSize: ignoreStat.size });
    }

    // Walk .keel/revisions/.
    const revisionsDir = libraryMetaDir(libPath, 'revisions');
    if (directoryExists(revisionsDir)) {
      await walkDir(revisionsDir, '.keel/revisions');
    }

    // Walk .keel/trash/.
    const trashDir = libraryMetaDir(libPath, 'trash');
    if (directoryExists(trashDir)) {
      await walkDir(trashDir, '.keel/trash');
    }

    // Serpent-pxd: include ready thumbnails/proxies so import does not show
    // broken images while DB still says status=ready. Legacy `.keel/previews`
    // remains excluded (regenerable / unused by current protocol).
    const artifactsDir = libraryMetaDir(libPath, 'artifacts');
    if (directoryExists(artifactsDir)) {
      await walkDir(artifactsDir, '.keel/artifacts');
    }

    // Include .keel/library.db (snapshot).
    const snapStat = statSync(tempDbPath);
    entries.push({
      sourcePath: tempDbPath,
      relativePath: '.keel/library.db',
      byteSize: snapStat.size,
    });

    // Optionally include linked folder source content in the same manifest as
    // managed files so progress, cancellation, and summaries stay accurate.
    // A short stable id suffix prevents two equally named linked roots from
    // being merged in the exported backup.
    let includedLinkedContent = false;
    if (input.includeLinkedContent) {
      const linkedFolders = openLibrary.connection
        .prepare('SELECT folder_id, display_name, absolute_root_path, status FROM linked_folders WHERE library_id = ?')
        .all(openLibrary.summary.libraryId) as Array<{
          folder_id: string;
          display_name: string;
          absolute_root_path: string;
          status: 'available' | 'offline';
        }>;
      if (linkedFolders.length > 0) {
        includedLinkedContent = true;
        for (const lf of linkedFolders) {
          if (cancelState.cancelled) break;
          if (lf.status !== 'available' || !realDirectoryExists(lf.absolute_root_path)) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'SOURCE_NOT_FOUND',
            });
          }
          const exportName = `${cleanFilename(lf.display_name)}-${lf.folder_id.slice(0, 8)}`;
          await walkDir(lf.absolute_root_path, `_linked/${exportName}`);
        }
      }
    }

    const managedAssetMtimes = new Map<string, Date>(
      (openLibrary.connection
        .prepare(
          `SELECT a.relative_file_path, r.modified_at
             FROM assets a
             JOIN revisions r ON r.revision_id = a.current_revision_id
            WHERE a.location_kind = 'managed'
              AND a.deleted_at IS NULL`,
        )
        .all() as Array<{ relative_file_path: string; modified_at: string }>)
        .map((row) => [row.relative_file_path, new Date(row.modified_at)]),
    );
    const totalFiles = entries.length;
    let totalBytes = 0;
    for (const entry of entries) {
      totalBytes += entry.byteSize;
    }

    // Phase 3: copy
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'copy', filesProcessed: 0, totalFiles,
      bytesProcessed: 0, totalBytes,
    });

    let filesProcessed = 0;
    let bytesProcessed = 0;
    let lastEmitTime = Date.now();
    const BATCH_SIZE = 50;
    const THROTTLE_MS = 200;

    for (const entry of entries) {
      await transferCheckpoint();
      if (cancelState.cancelled) break;
      const destPath = path.join(canonicalDest, ...entry.relativePath.split('/'));
      mkdirSync(path.dirname(destPath), { recursive: true });
      copyFileSync(entry.sourcePath, destPath);
      // Preserve managed-asset timestamps so reopening an exported library
      // does not mistake the copy for an external revision and invalidate
      // the ready artifact rows from the consistent DB snapshot.
      const sourceStat = statSync(entry.sourcePath);
      const managedRelativePath = openLibrary.summary.storageLayout === 'root'
        ? entry.relativePath
        : entry.relativePath.startsWith('Assets/')
          ? entry.relativePath.slice('Assets/'.length)
          : undefined;
      utimesSync(
        destPath,
        sourceStat.atime,
        (managedRelativePath === undefined
          ? undefined
          : managedAssetMtimes.get(managedRelativePath)) ?? sourceStat.mtime,
      );
      filesProcessed += 1;
      bytesProcessed += entry.byteSize;

      if (
        filesProcessed % BATCH_SIZE === 0 ||
        Date.now() - lastEmitTime >= THROTTLE_MS
      ) {
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'copy', filesProcessed, totalFiles,
          bytesProcessed, totalBytes,
        });
        lastEmitTime = Date.now();
      }
    }

    // Remove the temp DB snapshot.
    rmSync(tempDbPath, { force: true });

    if (cancelState.cancelled) {
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'cancelled', filesProcessed, totalFiles,
        bytesProcessed, totalBytes,
      });
      // Clean up the destination.
      this.removeOwnedTransferPath('export.cancel.cleanup-destination', canonicalDest, true);
      throw new LibraryServiceError('CANCELLED');
    }

    // Phase 4: complete
    const durationMs = Date.now() - startedAt;
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'complete', filesProcessed, totalFiles,
      bytesProcessed, totalBytes,
    });

    return {
      exportId,
      fileCount: totalFiles,
      totalBytes,
      excludedPreviewCount,
      includedLinkedContent,
      durationMs,
    };
  } catch (error) {
    if (cancelState.cancelled) {
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
    }
    if (destinationOwned) {
      this.removeOwnedTransferPath('export.failure.cleanup-destination', canonicalDest, true);
    }
    throw error;
  } finally {
    this.releaseExportTransfer(input.libraryId, exportId);
  }
}

export function cancelExport(this: LibraryService, exportId: string): void {
  const state = this.activeExports.get(exportId);
  if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
  state.cancelled = true;
  state.onCancel?.();
}

export async function exportLibraryToZip(this: LibraryService, input: {
    libraryId: string;
    destinationPath: string;
    includeLinkedContent: boolean;
  }): Promise<{
    exportId: string;
    fileCount: number;
    totalBytes: number;
    excludedPreviewCount: number;
    includedLinkedContent: boolean;
    durationMs: number;
  }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const exportId = randomUUID();

  // Ensure the destination file does not exist yet (prevent accidental overwrite).
  if (existsSync(input.destinationPath)) {
    throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
  }

  // Reject destination inside the library.
  const libPath = openLibrary.summary.libraryPath;
  let canonicalLib: string;
  try {
    canonicalLib = realpathSync(libPath);
  } catch {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  const destDir = path.dirname(input.destinationPath);
  let canonicalDestDir: string;
  try {
    canonicalDestDir = realpathSync(destDir);
  } catch {
    canonicalDestDir = destDir;
  }
  if (pathIsWithin(canonicalLib, canonicalDestDir)) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }

  const cancelState: TransferCancelState = { cancelled: false };
  this.acquireExportTransfer(input.libraryId, exportId, cancelState);
  const startedAt = Date.now();

  const tempDir = path.join(path.dirname(input.destinationPath), `.keel-zip-export-${exportId}`);
  let tempDbPath: string | undefined;
  let tempDirOwned = false;
  let destinationOwned = false;
  let output: ReturnType<typeof createWriteStream> | undefined;
  let archive: {
    pipe(output: ReturnType<typeof createWriteStream>): void;
    file(path: string, options: { name: string }): void;
    finalize(): void;
    abort(): void;
    on(event: string, listener: (err: Error) => void): void;
  } | undefined;

  function countFilesRecursive(dirPath: string): number {
    let count = 0;
    try {
      for (const child of readdirSync(dirPath, { withFileTypes: true })) {
        if (child.isSymbolicLink()) continue;
        const childPath = path.join(dirPath, child.name);
        if (child.isDirectory()) {
          count += countFilesRecursive(childPath);
        } else if (child.isFile()) {
          count += 1;
        }
      }
    } catch {
      // Best effort.
    }
    return count;
  }

  try {
    mkdirSync(tempDir);
    tempDirOwned = true;

    // Phase 1: snapshot-db
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    await transferCheckpoint();
    if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

    tempDbPath = path.join(tempDir, `library-${exportId}.db`);
    await this.createConsistentDatabaseSnapshot(openLibrary.writeConnection, tempDbPath, cancelState);

    let semanticBackupPath: string | null = null;
    if (this.options.backupSemanticIndex) {
      semanticBackupPath = libraryMetaDir(tempDir, 'semantic', 'index.sqlite');
      mkdirSync(path.dirname(semanticBackupPath), { recursive: true });
      const copied = await this.options.backupSemanticIndex({
        libraryId: input.libraryId,
        libraryPath: openLibrary.summary.libraryPath,
        storageKind: openLibrary.summary.storageKind ?? 'unknown',
        destinationPath: semanticBackupPath,
      });
      if (!copied) {
        rmSync(libraryMetaDir(tempDir), { recursive: true, force: true });
        semanticBackupPath = null;
      }
    }

    // Phase 2: enumerate
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'enumerate', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });

    interface ZipEntry {
      sourcePath: string;
      relativePath: string;
      byteSize: number;
    }
    const entries: ZipEntry[] = [];
    let excludedPreviewCount = 0;
    if (semanticBackupPath) {
      const semanticStat = statSync(semanticBackupPath);
      entries.push({ sourcePath: semanticBackupPath, relativePath: '.keel/semantic/index.sqlite',
        byteSize: semanticStat.size });
    }

    const walkDir = async (dirPath: string, relPrefix: string): Promise<void> => {
      if (cancelState.cancelled) return;
      let children;
      try {
        children = readdirSync(dirPath, { withFileTypes: true });
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      for (const child of children) {
        await transferCheckpoint();
        if (cancelState.cancelled) return;
        const childPath = path.join(dirPath, child.name);
        const childRel = relPrefix ? path.posix.join(relPrefix, child.name) : child.name;

        if (child.isSymbolicLink()) continue;

        if (child.isDirectory()) {
          if (childRel === '.keel/previews' || childRel === '.keel/operations'
            || childRel === '.keel/semantic') {
            if (childRel === '.keel/previews') {
              try {
                excludedPreviewCount += countFilesRecursive(childPath);
              } catch {
                // Best effort.
              }
            }
            continue;
          }
          await walkDir(childPath, childRel);
        } else if (child.isFile()) {
          const lowerName = child.name.toLowerCase();
          if (
            lowerName.endsWith('.tmp') ||
            lowerName.includes('.wave-tmp.') ||
            lowerName.includes('-tmp.') ||
            (lowerName.startsWith('.') && (
              lowerName.includes('temp') || lowerName.includes('cache') ||
              lowerName.startsWith('.ds_store') || lowerName === 'thumbs.db'
            ))
          ) {
            continue;
          }
          const stat = lstatSync(childPath);
          if (stat.isSymbolicLink()) continue;
          entries.push({
            sourcePath: childPath,
            relativePath: childRel,
            byteSize: stat.size,
          });
        }
      }
    };

    // Preserve the selected storage layout in folder and ZIP exports.
    if (openLibrary.summary.storageLayout === 'root') {
      for (const child of readdirSync(libPath, { withFileTypes: true })) {
        if (isLibraryMetaDirName(child.name) || isLibraryIgnoreFileName(child.name)) continue;
        if (child.isSymbolicLink()) continue;
        const sourcePath = path.join(libPath, child.name);
        if (child.isDirectory()) await walkDir(sourcePath, child.name);
        else if (child.isFile()) entries.push({ sourcePath, relativePath: child.name, byteSize: lstatSync(sourcePath).size });
      }
    } else {
      await walkDir(this.assetsPath(openLibrary), 'Assets');
    }
    const layoutMarker = libraryMetaDir(libPath, 'storage-layout.json');
    if (existsSync(layoutMarker)) {
      entries.push({ sourcePath: layoutMarker, relativePath: '.keel/storage-layout.json', byteSize: statSync(layoutMarker).size });
    }

    const gitignoreFile = existingIgnoreConfigPath(libPath);
    if (gitignoreFile) {
      const ignoreStat = statSync(gitignoreFile);
      entries.push({ sourcePath: gitignoreFile, relativePath: path.basename(gitignoreFile), byteSize: ignoreStat.size });
    }

    // Walk .keel/revisions/.
    const revisionsDir = libraryMetaDir(libPath, 'revisions');
    if (directoryExists(revisionsDir)) {
      await walkDir(revisionsDir, '.keel/revisions');
    }

    // Walk .keel/trash/.
    const trashDir = libraryMetaDir(libPath, 'trash');
    if (directoryExists(trashDir)) {
      await walkDir(trashDir, '.keel/trash');
    }

    // Serpent-pxd: same artifacts contract as folder export.
    const artifactsDir = libraryMetaDir(libPath, 'artifacts');
    if (directoryExists(artifactsDir)) {
      await walkDir(artifactsDir, '.keel/artifacts');
    }

    // Add .keel/library.db (snapshot).
    const snapStat = statSync(tempDbPath);
    entries.push({
      sourcePath: tempDbPath,
      relativePath: '.keel/library.db',
      byteSize: snapStat.size,
    });

    // ZIP exports follow the same linked-content contract as folder exports.
    // Linked sources remain supplemental backup material under _linked/; the
    // database retains its original roots so unavailable roots reopen offline.
    let includedLinkedContent = false;
    if (input.includeLinkedContent) {
      const linkedFolders = openLibrary.connection
        .prepare('SELECT folder_id, display_name, absolute_root_path, status FROM linked_folders WHERE library_id = ?')
        .all(openLibrary.summary.libraryId) as Array<{
          folder_id: string;
          display_name: string;
          absolute_root_path: string;
          status: 'available' | 'offline';
        }>;
      if (linkedFolders.length > 0) {
        includedLinkedContent = true;
        for (const linkedFolder of linkedFolders) {
          if (cancelState.cancelled) break;
          if (linkedFolder.status !== 'available' || !realDirectoryExists(linkedFolder.absolute_root_path)) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
          }
          const exportName = `${cleanFilename(linkedFolder.display_name)}-${linkedFolder.folder_id.slice(0, 8)}`;
          await walkDir(linkedFolder.absolute_root_path, `_linked/${exportName}`);
        }
      }
    }

    const totalFiles = entries.length;
    let totalBytes = 0;
    for (const entry of entries) {
      totalBytes += entry.byteSize;
    }

    // ZIP pre-check: reject if total size > 4 GiB or entry count > 65534.
    if (totalBytes > LibraryService.ZIP_MAX_BYTES || totalFiles > LibraryService.ZIP_MAX_ENTRIES) {
      throw new LibraryServiceError('ZIP_TOO_LARGE', { reason: 'ZIP_TOO_LARGE' });
    }

    // Phase 3: compress
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'compress', filesProcessed: 0, totalFiles,
      bytesProcessed: 0, totalBytes,
    });

    // Dynamically import archiver (CJS module).
    // archiver v8 exports named classes; ZipArchive is the ZIP-specific one.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const archiverModule = require('archiver') as {
      ZipArchive: new (options?: Record<string, unknown>) => NonNullable<typeof archive>;
    };

    const destZipPath = input.destinationPath;
    // Ensure parent directory exists.
    mkdirSync(path.dirname(destZipPath), { recursive: true });

    // Reserve the final path atomically. From this point onward cleanup may
    // remove it because this operation demonstrably owns it.
    try {
      const destinationHandle = openSync(destZipPath, 'wx');
      closeSync(destinationHandle);
      destinationOwned = true;
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS', { cause: error });
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    output = createWriteStream(destZipPath);
    archive = new archiverModule.ZipArchive({ zlib: { level: 6 }, forceZip64: false });

    let archiverError: Error | undefined;
    archive.on('error', (err: Error) => {
      archiverError = err;
    });
    archive.on('warning', (err: Error) => {
      // Missing or unreadable source entries make the export incomplete and
      // therefore must fail rather than producing a silently truncated ZIP.
      archiverError = err;
    });

    // Pipe archive data to the destination file.
    archive.pipe(output);

    let filesProcessed = 0;
    let bytesProcessed = 0;
    let lastEmitTime = Date.now();
    const BATCH_SIZE = 50;
    const THROTTLE_MS = 200;

    for (const entry of entries) {
      await transferCheckpoint();
      if (cancelState.cancelled) break;
      if (archiverError) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: archiverError });

      archive.file(entry.sourcePath, { name: entry.relativePath });

      filesProcessed += 1;
      bytesProcessed += entry.byteSize;

      if (
        filesProcessed % BATCH_SIZE === 0 ||
        Date.now() - lastEmitTime >= THROTTLE_MS
      ) {
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'compress', filesProcessed, totalFiles,
          bytesProcessed, totalBytes,
        });
        lastEmitTime = Date.now();
      }
    }

    if (cancelState.cancelled) {
      // Destroy streams, then wait for the destination handle to close
      // before deleting the file: the release is asynchronous, and on
      // Windows an immediate rm hits EPERM and masks CANCELLED with
      // LIBRARY_NOT_WRITABLE (POSIX unlinks open files, hiding this).
      const outputClosed = waitForStreamClose(output);
      archive.abort();
      output.destroy();
      await outputClosed;
      // Remove the temp db and temp dir.
      this.removeOwnedTransferPath('export.zip.cancel.cleanup-temp', tempDir, true);
      tempDirOwned = false;
      // Remove the destination file.
      this.removeOwnedTransferPath('export.zip.cancel.cleanup-destination', destZipPath, false);
      destinationOwned = false;
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'cancelled', filesProcessed, totalFiles,
        bytesProcessed, totalBytes,
      });
      throw new LibraryServiceError('CANCELLED');
    }

    // Finalize the archive (wait for the output stream to finish).
    const finalArchive = archive;
    const finalOutput = output;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        cancelState.onCancel = undefined;
        operation();
      };
      cancelState.onCancel = () => {
        finalArchive.abort();
        finalOutput.destroy();
      };
      finalOutput.on('close', () => {
        if (cancelState.cancelled) settle(() => reject(new LibraryServiceError('CANCELLED')));
      });
      finalOutput.on('finish', () => {
        if (archiverError) {
          settle(() => reject(new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: archiverError })));
          return;
        }
        settle(resolve);
      });
      finalOutput.on('error', (err: Error) => {
        if (cancelState.cancelled) {
          settle(() => reject(new LibraryServiceError('CANCELLED', { cause: err })));
          return;
        }
        settle(() => reject(new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: err })));
      });
      void finalArchive.finalize();
    });

    // Clean up temp dir.
    this.removeOwnedTransferPath('export.zip.complete.cleanup-temp', tempDir, true);
    tempDirOwned = false;

    // Final progress.
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'compress', filesProcessed, totalFiles,
      bytesProcessed, totalBytes,
    });

    // Phase 4: complete
    const durationMs = Date.now() - startedAt;
    this.emitProgress({
      type: 'export.progress', exportId,
      libraryId: input.libraryId,
      phase: 'complete', filesProcessed, totalFiles,
      bytesProcessed, totalBytes,
    });

    return {
      exportId,
      fileCount: totalFiles,
      totalBytes,
      excludedPreviewCount,
      includedLinkedContent,
      durationMs,
    };
  } catch (error) {
    if (cancelState.cancelled) {
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
    }
    // The compress loop can fail while archiver still holds the destination
    // and the snapshot. Windows will not remove those paths, or their parent,
    // until the handles close.
    if (output) {
      const outputClosed = waitForStreamClose(output);
      try { archive?.abort(); } catch { /* the export is already failing */ }
      output.destroy();
      await outputClosed;
    }
    if (destinationOwned) {
      this.removeOwnedTransferPath('export.zip.failure.cleanup-destination', input.destinationPath, false);
    }
    if (tempDirOwned) {
      this.removeOwnedTransferPath('export.zip.failure.cleanup-temp', tempDir, true);
    }
    throw error;
  } finally {
    this.releaseExportTransfer(input.libraryId, exportId);
  }
}

// ── ZIP import ───────────────────────────────────────────────────────────

export async function importLibraryFromZip(this: LibraryService, input: {
    sourceZipPath: string;
    destinationParentPath: string;
  }): Promise<{
    importId: string;
    libraryId: string;
    displayName: string;
    libraryPath: string;
  }> {
  const importId = randomUUID();
  const cancelState: TransferCancelState = { cancelled: false };
  const baseName = path.basename(input.sourceZipPath, path.extname(input.sourceZipPath));
  const extractPath = path.join(input.destinationParentPath, baseName);
  const importTransfer = this.acquireImportTransfer(
    importId,
    input.sourceZipPath,
    extractPath,
    cancelState,
  );
  let ownedExtractPath: string | undefined;
  let completed = false;
  let totalEntries = 0;
  let totalUncompressedBytes = 0;
  let extractedBytes = 0;
  let manifestValidationError: LibraryServiceError | undefined;

  try {
    if (existsSync(extractPath)) {
      throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
    }
    // Phase 1: validate
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'validate', filesProcessed: 0, totalFiles: 0,
      bytesProcessed: 0, totalBytes: 0,
    });
    await transferCheckpoint();
    if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

    // Phase 2: extract
    try {
      mkdirSync(extractPath);
      ownedExtractPath = extractPath;
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

    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'extract', filesProcessed: 0, totalFiles: totalEntries,
      bytesProcessed: 0, totalBytes: 0,
    });

    const abortController = new AbortController();
    cancelState.onCancel = () => abortController.abort();
    try {
      await extractZipStream({
        sourceZipPath: input.sourceZipPath,
        destinationRoot: extractPath,
        signal: abortController.signal,
        limits: zipBombProtectionLimits(),
        validateManifest: (manifest: ZipArchiveManifest) => {
          const hasAssetFiles = manifest.entries.some(
            (entry) => !entry.isDirectory && entry.name.startsWith('Assets/'),
          );
          const hasDatabase = manifest.entries.some(
            (entry) => !entry.isDirectory && LIBRARY_META_DIR_NAMES.some((dir) => entry.name === `${dir}/library.db`),
          );
          if (!hasDatabase || (!hasAssetFiles && !manifest.entries.some((entry) => LIBRARY_META_DIR_NAMES.some((dir) => entry.name === `${dir}/storage-layout.json`)))) {
            manifestValidationError = new LibraryServiceError('NOT_A_LIBRARY', {
              reason: 'NOT_A_LIBRARY',
            });
            throw new ZipImportStreamError('INVALID_ZIP');
          }
        },
        onProgress: (progress) => {
          totalEntries = progress.totalEntries;
          totalUncompressedBytes = progress.totalBytes;
          extractedBytes = progress.bytesProcessed;
          this.emitProgress({
            type: 'import.progress', importId,
            phase: 'extract', filesProcessed: progress.entriesProcessed,
            totalFiles: progress.totalEntries,
            bytesProcessed: progress.bytesProcessed,
            totalBytes: progress.totalBytes,
          });
        },
      });
    } finally {
      cancelState.onCancel = undefined;
    }

    if (cancelState.cancelled) {
      this.removeOwnedTransferPath('import.zip.cancel.cleanup-destination', extractPath, true);
      this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: totalEntries, bytesProcessed: 0, totalBytes: 0 });
      throw new LibraryServiceError('CANCELLED');
    }

    // Phase 3: verify
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'verify', filesProcessed: 0, totalFiles: totalEntries,
      bytesProcessed: 0, totalBytes: 0,
    });

    // Validate the extracted folder is a valid library.
    // Canonicalize the extract path so symlink checks compare against
    // the real path (important on macOS where /var -> /private/var).
    let canonicalExtractPath: string;
    try {
      canonicalExtractPath = realpathSync(extractPath);
    } catch {
      canonicalExtractPath = extractPath;
    }
    assertTreeContainsNoSymlinks(canonicalExtractPath);
    this.validateImportSource(canonicalExtractPath);

    // ZIP timestamps have no timezone; use the revision timestamps stored in
    // the database instead of trusting the archive metadata. This keeps a
    // macOS export's ready thumbnails valid after a Windows import.
    this.restoreManagedAssetTimestamps(canonicalExtractPath);

    // Phase 4: open
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'open', filesProcessed: 0, totalFiles: totalEntries,
      bytesProcessed: 0, totalBytes: 0,
    });

    const summary = this.openLibrary(canonicalExtractPath);

    // Phase 5: complete
    this.emitProgress({
      type: 'import.progress', importId,
      phase: 'complete', filesProcessed: totalEntries, totalFiles: totalEntries,
      bytesProcessed: extractedBytes, totalBytes: totalUncompressedBytes,
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
    }
    if (ownedExtractPath && !completed) {
      this.removeOwnedTransferPath('import.zip.failure.cleanup-destination', ownedExtractPath, true);
    }
    if (error instanceof LibraryServiceError) throw error;
    if (manifestValidationError) throw manifestValidationError;
    if (error instanceof ZipImportStreamError) throw this.mapZipImportError(error);
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  } finally {
    cancelState.onCancel = undefined;
    this.releaseImportTransfer(importTransfer);
  }
}
