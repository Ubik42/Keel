import { existsSync, lstatSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Library metadata location (P1 rename). New libraries use `.keel` and
 * `.keelignore`; libraries written before the rename use `.serpent` and
 * `.serpentignore`. Every path into the metadata directory goes through
 * `libraryMetaDir` so code never spells the directory name.
 */
export const LIBRARY_META_DIR_NAME = '.keel';
export const LEGACY_LIBRARY_META_DIR_NAME = '.serpent';
export const LIBRARY_IGNORE_FILE_NAME = '.keelignore';
export const LEGACY_LIBRARY_IGNORE_FILE_NAME = '.serpentignore';
/** Prefix for temporary files Keel writes next to user files. */
export const LIBRARY_TEMP_PREFIX = '.keel-';
export const LEGACY_LIBRARY_TEMP_PREFIX = '.serpent-';
export const LIBRARY_MIGRATION_RECORD = 'migration.json';

const META_DIR_NAMES = new Set([LIBRARY_META_DIR_NAME, LEGACY_LIBRARY_META_DIR_NAME]);
const IGNORE_FILE_NAMES = new Set([
  LIBRARY_IGNORE_FILE_NAME,
  `${LIBRARY_IGNORE_FILE_NAME}.json`,
  LEGACY_LIBRARY_IGNORE_FILE_NAME,
  `${LEGACY_LIBRARY_IGNORE_FILE_NAME}.json`,
]);

/** Both metadata directory names stay reserved for scans, moves and imports. */
export function isLibraryMetaDirName(name: string): boolean {
  return META_DIR_NAMES.has(name.toLowerCase());
}

export function isLibraryIgnoreFileName(name: string): boolean {
  return IGNORE_FILE_NAMES.has(name.toLowerCase());
}

export function isLibraryTempFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(LIBRARY_TEMP_PREFIX) || lower.startsWith(LEGACY_LIBRARY_TEMP_PREFIX);
}

export const LIBRARY_META_DIR_NAMES: readonly string[] = [...META_DIR_NAMES];
export const LIBRARY_IGNORE_FILE_NAMES: readonly string[] = [...IGNORE_FILE_NAMES];

const resolvedMetaDirNames = new Map<string, string>();

function cacheKey(libraryRoot: string): string {
  return path.resolve(libraryRoot).toLowerCase();
}

function isDirectory(target: string): boolean {
  try {
    return lstatSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Directory name in use for this library: `.keel` when present, otherwise an
 * existing legacy `.serpent` (migration failed or not run yet), otherwise
 * `.keel` for a new library.
 */
export function libraryMetaDirName(libraryRoot: string): string {
  const key = cacheKey(libraryRoot);
  const cached = resolvedMetaDirNames.get(key);
  if (cached !== undefined) return cached;
  if (isDirectory(path.join(libraryRoot, LIBRARY_META_DIR_NAME))) {
    // Only the final name is cached. Main and the Worker resolve separately,
    // so a cached legacy name could outlive a migration in the other process.
    resolvedMetaDirNames.set(key, LIBRARY_META_DIR_NAME);
    return LIBRARY_META_DIR_NAME;
  }
  if (isDirectory(path.join(libraryRoot, LEGACY_LIBRARY_META_DIR_NAME))) return LEGACY_LIBRARY_META_DIR_NAME;
  return LIBRARY_META_DIR_NAME;
}

export function libraryMetaDir(libraryRoot: string, ...segments: string[]): string {
  return path.join(libraryRoot, libraryMetaDirName(libraryRoot), ...segments);
}

/** Ignore file in use: `.keelignore`, else an existing `.serpentignore`. */
export function libraryIgnoreFile(libraryRoot: string): string {
  const current = path.join(libraryRoot, LIBRARY_IGNORE_FILE_NAME);
  if (existsSync(current)) return current;
  const legacy = path.join(libraryRoot, LEGACY_LIBRARY_IGNORE_FILE_NAME);
  return existsSync(legacy) ? legacy : current;
}

/** Forget cached resolution, e.g. after a library folder was deleted or moved. */
export function forgetLibraryMetaDir(libraryRoot: string): void {
  resolvedMetaDirNames.delete(cacheKey(libraryRoot));
}

export type LibraryMetaDirMigration =
  | { status: 'none' | 'current' }
  | { status: 'migrated' }
  | { status: 'both'; reason: 'legacy-directory-kept' }
  | { status: 'failed'; reason: string };

/**
 * Run before the library database opens. Renames `.serpent` to `.keel` (and
 * `.serpentignore` to `.keelignore`) on the same volume. On failure the library
 * opens from the legacy directory and the next open tries again.
 */
export function migrateLibraryMetaDir(
  libraryRoot: string,
  appVersion: string,
): LibraryMetaDirMigration {
  const current = path.join(libraryRoot, LIBRARY_META_DIR_NAME);
  const legacy = path.join(libraryRoot, LEGACY_LIBRARY_META_DIR_NAME);
  const hasCurrent = isDirectory(current);
  const hasLegacy = isDirectory(legacy);
  forgetLibraryMetaDir(libraryRoot);
  if (hasCurrent) {
    migrateIgnoreFile(libraryRoot);
    return hasLegacy ? { status: 'both', reason: 'legacy-directory-kept' } : { status: 'current' };
  }
  if (!hasLegacy) return { status: 'none' };
  try {
    renameSync(legacy, current);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    return { status: 'failed', reason: code };
  }
  forgetLibraryMetaDir(libraryRoot);
  try {
    writeFileSync(path.join(current, LIBRARY_MIGRATION_RECORD), `${JSON.stringify({
      from: LEGACY_LIBRARY_META_DIR_NAME,
      to: LIBRARY_META_DIR_NAME,
      migratedAt: new Date().toISOString(),
      appVersion,
    }, null, 2)}\n`);
  } catch {
    // The rename is the migration; the record is diagnostic only.
  }
  migrateIgnoreFile(libraryRoot);
  return { status: 'migrated' };
}

function migrateIgnoreFile(libraryRoot: string): void {
  for (const suffix of ['', '.json']) {
    const legacy = path.join(libraryRoot, `${LEGACY_LIBRARY_IGNORE_FILE_NAME}${suffix}`);
    const current = path.join(libraryRoot, `${LIBRARY_IGNORE_FILE_NAME}${suffix}`);
    if (!existsSync(legacy) || existsSync(current)) continue;
    try {
      renameSync(legacy, current);
    } catch {
      // libraryIgnoreFile keeps reading the legacy name until a later open.
    }
  }
}
