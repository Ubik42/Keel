import { type LinkedFolderRule } from '../../shared/asset-types';
import { LIBRARY_META_DIR_NAMES, LIBRARY_IGNORE_FILE_NAMES } from '../../shared/library-meta-dir';
import { readdirSync } from 'node:fs';
import { default as path } from 'node:path';

/**
 * Default linked-folder rules and the files and folders a library always ignores.
 */
export const DEFAULT_LINKED_FOLDER_RULES: ReadonlyArray<Omit<LinkedFolderRule, 'ruleId'>> = [
  ...['.git', 'node_modules', '.svn', '.hg', '__pycache__'].map((pattern) => ({
    action: 'exclude' as const, target: 'folder' as const, pattern, enabled: true,
  })),
  ...['.DS_Store', 'Thumbs.db', 'desktop.ini'].map((pattern) => ({
    action: 'exclude' as const, target: 'filename' as const, pattern, enabled: true,
  })),
];

export const DEFAULT_IGNORED_ASSET_DIRECTORIES = new Set([
  ...LIBRARY_META_DIR_NAMES,
  '.bf',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  'node_modules',
]);

export const DEFAULT_IGNORED_ASSET_FILES = new Set([
  ...LIBRARY_META_DIR_NAMES,
  ...LIBRARY_IGNORE_FILE_NAMES,
  '.ds_store',
  'desktop.ini',
  'thumbs.db',
]);

export const ALWAYS_IGNORED_ASSET_FILES = new Set([
  ...LIBRARY_IGNORE_FILE_NAMES,
  '.ds_store',
  'desktop.ini',
  'thumbs.db',
]);

export function isDefaultIgnoredAssetEntry(name: string, kind: 'directory' | 'file'): boolean {
  const normalized = name.toLocaleLowerCase('en-US');
  if (kind === 'directory') return DEFAULT_IGNORED_ASSET_DIRECTORIES.has(normalized);
  if ((normalized.startsWith('.keel-text-edit-') || normalized.startsWith('.serpent-text-edit-')) && normalized.endsWith('.tmp')) {
    return true;
  }
  return DEFAULT_IGNORED_ASSET_FILES.has(normalized) || normalized.startsWith('._');
}

export function isAlwaysIgnoredAssetPath(relativePath: string): boolean {
  const filename = relativePath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  if (!filename) return false;
  const normalized = filename.toLocaleLowerCase('en-US');
  return ALWAYS_IGNORED_ASSET_FILES.has(normalized) || normalized.startsWith('._');
}

/**
 * Rescue happens only after the normal database and verified backups failed,
 * so counting the physical source files here is both useful for the report
 * and outside the large-library open/import hot path. Symlinks and Keel's
 * filesystem noise are excluded to match the managed-source reconciler.
 */
export function countRecoverableAssetFiles(assetsRoot: string): number {
  let count = 0;
  const visit = (directory: string, relativeDirectory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && isDefaultIgnoredAssetEntry(entry.name, 'directory')) continue;
      const relativePath = relativeDirectory === ''
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && !isAlwaysIgnoredAssetPath(relativePath)) {
        count += 1;
      }
    }
  };
  visit(assetsRoot, '');
  return count;
}
