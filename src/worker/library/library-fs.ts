import { normalizeRelativeAssetPath, copyNameForIndex } from './library-rules';
import { rm as rmAsync } from 'node:fs/promises';
import { LibraryServiceError, isMissingPathError } from './library-errors';
import { default as path } from 'node:path';
import { statSync, lstatSync, constants, copyFileSync, type Dirent, readdirSync, mkdirSync, utimesSync, type BigIntStats, type Stats, readSync, openSync, closeSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { type PublicErrorReason } from '../../shared/protocol/errors';
import { libraryMetaDir, libraryIgnoreFile } from '../../shared/library-meta-dir';

/**
 * File-system helpers of the Library Service: retrying deletes, exclusive copies, cancellable tree copies, source snapshots and hashes, library paths.
 */
export const DATABASE_BACKUP_DIRECTORY = 'backups';

export interface SourceSnapshot {
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
}

export function normalizeWatcherRelativePath(filename: string | Buffer | null): string | undefined {
  if (filename === null) return undefined;
  const value = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename;
  if (value.length === 0 || value.includes('\0') || value.trim() !== value) return undefined;
  try {
    return normalizeRelativeAssetPath(value);
  } catch {
    // Recursive fs.watch filenames are advisory. Any ambiguous or unsafe
    // value must fall back to the linked-root reconciliation, never widen the
    // targeted path or skip a source that may have changed.
    return undefined;
  }
}

export function sourceIdentityKey(device: string | null | undefined, inode: string | null | undefined): string | undefined {
  if (
    !device
    || !inode
    || device === '0'
    || inode === '0'
    || device === 'undefined'
    || inode === 'undefined'
    || device === 'null'
    || inode === 'null'
  ) return undefined;
  return `${device}\u0000${inode}`;
}

export const DISK_DELETE_RETRY_LIMIT = 12;

export const DISK_DELETE_RETRY_DELAY_MS = 125;

export function isRetryableDiskDeleteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES';
}

/**
 * Windows keeps delete-pending files unavailable until the last decoder or
 * Chromium stream closes.  `fs.rm`'s built-in retry is only applied to
 * recursive removals, so asset-file deletes need an asynchronous retry loop
 * of their own.  Waiting asynchronously lets abort handlers and stream close
 * events actually run between attempts.
 */
export async function removePathWithRetry(
  targetPath: string,
  recursive: boolean,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rmAsync(targetPath, { force: true, recursive, maxRetries: 0 });
      return;
    } catch (error) {
      if (!isRetryableDiskDeleteError(error) || attempt >= DISK_DELETE_RETRY_LIMIT) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, DISK_DELETE_RETRY_DELAY_MS * (attempt + 1));
      });
    }
  }
}

export const FS_NAME_COMPONENT_LIMIT = 255;

/**
 * NTFS caps each path component at 255 UTF-16 code units (JS string length);
 * POSIX filesystems cap it at 255 bytes. Past the limit every create/rename
 * fails — POSIX with ENAMETOOLONG, Windows with ENOENT
 * (ERROR_FILENAME_EXCED_RANGE), which would otherwise be misreported as
 * SOURCE_NOT_FOUND. Validate deterministically before placement so both
 * platforms surface the same PATH_LIMIT_EXCEEDED reason.
 */
export function assertNameWithinFsLimit(relativePath: string): void {
  for (const component of relativePath.split('/')) {
    if (
      component.length > FS_NAME_COMPONENT_LIMIT ||
      Buffer.byteLength(component, 'utf8') > FS_NAME_COMPONENT_LIMIT
    ) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'PATH_LIMIT_EXCEEDED' });
    }
  }
}

/**
 * Existence probes in availability reconciliation must also accept EPERM as
 * "not there" on Windows: a tree in delete-pending state (removed while a
 * handle is still open) answers lstat/readdir with EPERM
 * (STATUS_DELETE_PENDING) until the last handle closes, whereas POSIX
 * reports ENOENT. Genuine permission/IO failures surface as EACCES/EIO and
 * must keep propagating instead of silently flipping availability, so the
 * tolerance is EPERM-only and win32-only.
 */
export function isUnreadablePathError(error: unknown): boolean {
  return (
    isMissingPathError(error) ||
    (process.platform === 'win32' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EPERM')
  );
}

export function hasErrorCode(error: unknown, code: string): boolean {
  let current = error;
  const visited = new Set<unknown>();
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

export function copyNameCandidates(fileName: string, index: number): string[] {
  const extension = path.posix.extname(fileName);
  const baseName = extension.length === 0 ? fileName : fileName.slice(0, -extension.length);
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(baseName)]
    .map((part) => part.segment);
  const suffix = ` (${index})`;
  const candidates = [copyNameForIndex(fileName, index)];
  for (let length = graphemes.length - 1; length >= 0; length -= 1) {
    candidates.push(`${graphemes.slice(0, length).join('')}${suffix}${extension}`);
  }
  return [...new Set(candidates)];
}

export function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

export function realDirectoryExists(directoryPath: string): boolean {
  try {
    const entry = lstatSync(directoryPath);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

export function realFileExists(filePath: string): boolean {
  try {
    const entry = lstatSync(filePath);
    return entry.isFile() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

export function copyFileExclusive(sourcePath: string, destinationPath: string): void {
  // Windows CopyFile does not clone; trying COPYFILE_FICLONE first just fails
  // and retries. APFS/XFS can clone, so keep the fallback there.
  const cloneFlag = process.platform === 'win32' || typeof constants.COPYFILE_FICLONE !== 'number'
    ? 0
    : constants.COPYFILE_FICLONE;
  if (cloneFlag === 0) {
    copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    return;
  }
  try {
    copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL | cloneFlag);
  } catch {
    copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  }
}

export interface TransferCancelState {
  cancelled: boolean;
  /** abandon = roll back this import; stop = keep files already staged. */
  mode?: 'abandon' | 'stop';
  onCancel?: () => void;
  /** Keep maintenance snapshots inside the same small event-loop slice budget. */
  backupPageBatch?: number;
}

export interface ActiveImportTransfer {
  importId: string;
  sourceKey: string;
  destinationKey: string;
}

/**
 * Give the UtilityProcess message loop a chance to receive a cancellation
 * command. Transfer code uses this at file/entry boundaries, matching the
 * cancellation granularity promised by the protocol.
 *
 * Use a zero-delay timer, not setImmediate: setImmediate can keep running in
 * the same check phase and starve parentPort messages (the same reason
 * navigationCheckpoint uses setTimeout).
 *
 * On Windows the timer floor is about 15ms. Yielding once per file therefore
 * turns a 20,000-file transfer into more than ten minutes of waits. Yield
 * the timer only after a short slice of real work so Worker IPC still runs,
 * without paying that floor on every entry.
 */
export const transferYieldSliceMs = 50;

export let nextTransferYieldAt = 0;

export function transferCheckpoint(): Promise<void> {
  const now = Date.now();
  // Inside a slice, still yield one macrotask with setImmediate (no timer
  // floor) so in-process cancel requests run between files.
  if (now < nextTransferYieldAt) return new Promise((resolve) => setImmediate(resolve));
  nextTransferYieldAt = now + transferYieldSliceMs;
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createProgressThrottle(minIntervalMs = 250): {
  shouldEmit(force?: boolean): boolean;
} {
  let lastAt = 0;
  return {
    shouldEmit(force = false) {
      const now = Date.now();
      if (!force && now - lastAt < minIntervalMs) return false;
      lastAt = now;
      return true;
    },
  };
}

/**
 * Unlike file-transfer checkpoints, navigation hydration must let the
 * UtilityProcess message-poll phase run before starting its next synchronous
 * SQLite slice. A zero-delay timer moves the continuation to the next event
 * loop turn; setImmediate can continue in the same check phase and starve a
 * browse/page message that arrived while the sidebar pass was yielding.
 */
export function navigationCheckpoint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Resolves once the stream's 'close' event fires. Destroying a stream only
 * schedules the file-descriptor release; on Windows the file stays locked
 * (and undeletable) until 'close', unlike POSIX where unlinking an open file
 * is allowed. Await this before deleting a stream's target on any platform.
 */
export function waitForStreamClose(stream: {
  readonly closed: boolean;
  once(event: string, listener: () => void): unknown;
}): Promise<void> {
  if (stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
  });
}

export function readLibraryTreeChildren(directoryPath: string): Dirent[] {
  let children;
  try {
    children = readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  }
  for (const child of children) {
    if (child.isSymbolicLink()) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { reason: 'SYMBOLIC_LINK_NOT_ALLOWED' });
    }
  }
  return children;
}

export async function copyDirRecursiveCancellable(
  sourcePath: string,
  destPath: string,
  cancelState: TransferCancelState,
  onFileCopied?: (byteSize: number) => void,
): Promise<void> {
  mkdirSync(destPath, { recursive: true });
  const children = readLibraryTreeChildren(sourcePath);
  for (const child of children) {
    await transferCheckpoint();
    if (cancelState.cancelled) return;
    const childSource = path.join(sourcePath, child.name);
    const childDest = path.join(destPath, child.name);
    if (child.isDirectory()) {
      await copyDirRecursiveCancellable(childSource, childDest, cancelState, onFileCopied);
    } else if (child.isFile()) {
      copyFileSync(childSource, childDest);
      // Keep the source mtime across a library copy. The first open compares
      // this value with the revision recorded in library.db; preserving it
      // avoids treating every copied asset as externally edited while still
      // allowing a genuinely changed source file to be reconciled normally.
      const sourceStat = statSync(childSource);
      utimesSync(childDest, sourceStat.atime, sourceStat.mtime);
      onFileCopied?.(sourceStat.size);
    }
  }
}

export function measureCopyTree(sourcePath: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (directoryPath: string): void => {
    for (const child of readLibraryTreeChildren(directoryPath)) {
      const childPath = path.join(directoryPath, child.name);
      if (child.isDirectory()) {
        visit(childPath);
      } else if (child.isFile()) {
        fileCount += 1;
        totalBytes += statSync(childPath).size;
      }
    }
  };
  visit(sourcePath);
  return { fileCount, totalBytes };
}

export function assertTreeContainsNoSymlinks(rootPath: string): void {
  const visit = (directoryPath: string): void => {
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }
    for (const child of children) {
      const childPath = path.join(directoryPath, child.name);
      let entry;
      try {
        entry = lstatSync(childPath);
      } catch (error) {
        throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
      }
      if (entry.isSymbolicLink()) {
        throw new LibraryServiceError('NOT_A_LIBRARY', {
          reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
        });
      }
      if (entry.isDirectory()) visit(childPath);
    }
  };
  visit(rootPath);
}

export function sourceSnapshot(stat: BigIntStats): SourceSnapshot {
  return {
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mtimeNs: stat.mtimeNs,
    size: stat.size,
  };
}

/**
 * A numeric filesystem device id is only meaningful on one host. Include the
 * host and root inode identity in the persisted hint so a same-path mount on
 * another computer, or a replaced root on the same volume, cannot silently
 * pass the NAS safety check. Numeric hints from older libraries remain
 * accepted as a backwards-compatible fallback.
 */
export function sourceHostDeviceHint(device: number | bigint | string): string {
  return `v2:${createHash('sha256')
    .update(`${hostname()}\u0000${String(device)}`, 'utf8')
    .digest('hex')}`;
}

export function sourceDeviceHint(
  device: number | bigint | string,
  inode: number | bigint | string = 'unknown',
  birthNs: bigint | null = null,
): string {
  // v3 binds directory birth time as well as device/inode. On ext4 and tmpfs,
  // rm+mkdir at the same path can reuse the inode number; birth time still
  // changes, while adding or removing children does not. v2 stays the legacy
  // inode hint for libraries linked before birth time was recorded.
  if (birthNs !== null && birthNs > 0n) {
    return `v3:${createHash('sha256')
      .update(
        `${hostname()}\u0000${String(device)}\u0000${String(inode)}\u0000${birthNs.toString()}`,
        'utf8',
      )
      .digest('hex')}`;
  }
  return `v2:${createHash('sha256')
    .update(`${hostname()}\u0000${String(device)}\u0000${String(inode)}`, 'utf8')
    .digest('hex')}`;
}

export function directoryBirthNs(stat: Stats | BigIntStats): bigint | null {
  // Nanosecond birth time exists only on the bigint stat. Number stats omit it,
  // and a zero birth time (procfs, some network mounts) is not an identity.
  if (!('birthtimeNs' in stat)) return null;
  const raw = stat.birthtimeNs;
  if (typeof raw === 'bigint') return raw > 0n ? raw : null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return BigInt(Math.trunc(raw));
  }
  return null;
}

export function sameSourceSnapshot(left: SourceSnapshot, right: SourceSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export function sha256DescriptorSync(descriptor: number): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

export function sha256FileAtPath(filePath: string): string {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const descriptor = openSync(filePath, flags);
  try {
    return sha256DescriptorSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Import staging already reads every byte once for duplicate detection. Keep
 * the recovery fingerprint in that same pass instead of adding another full
 * read per asset to large-library imports.
 */
export function sha256AndContentFingerprintFileAtPath(filePath: string): {
  sha256: string;
  contentFingerprint: string;
} {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const descriptor = openSync(filePath, flags);
  const sha256 = createHash('sha256');
  const contentFingerprint = createHash('sha1');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      sha256.update(chunk);
      contentFingerprint.update(chunk);
      position += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    sha256: sha256.digest('hex'),
    contentFingerprint: contentFingerprint.digest('hex'),
  };
}

export function sourceChanged(cause?: unknown): LibraryServiceError {
  return new LibraryServiceError('INVALID_IMPORT_SOURCE', {
    cause,
    reason: 'SOURCE_CHANGED',
  });
}

export function unsupportedSourceEntry(reason: PublicErrorReason, cause?: unknown): LibraryServiceError {
  return new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause, reason });
}

export function databasePath(libraryPath: string): string {
  return libraryMetaDir(libraryPath, 'library.db');
}

export function databaseBackupPath(libraryPath: string, slot: 1 | 2): string {
  return libraryMetaDir(libraryPath, DATABASE_BACKUP_DIRECTORY,
    `library.db.${slot}`,
  );
}

export function databaseBackupTemporaryPath(libraryPath: string): string {
  return libraryMetaDir(libraryPath, DATABASE_BACKUP_DIRECTORY,
    `.library.db.${randomUUID()}.tmp`,
  );
}

export function gitignorePath(libraryPath: string): string {
  return libraryIgnoreFile(libraryPath);
}

export function legacyGitignorePath(libraryPath: string): string {
  return path.join(libraryPath, '.gitignore');
}

export function existingIgnoreConfigPath(libraryPath: string): string | null {
  const currentPath = gitignorePath(libraryPath);
  if (realFileExists(currentPath)) return currentPath;
  const legacyPath = legacyGitignorePath(libraryPath);
  return realFileExists(legacyPath) ? legacyPath : null;
}

export function readGitignoreText(libraryPath: string): string {
  const currentPath = gitignorePath(libraryPath);
  try {
    return readFileSync(currentPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    try {
      return readFileSync(legacyGitignorePath(libraryPath), 'utf8');
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: legacyError });
    }
  }
}
