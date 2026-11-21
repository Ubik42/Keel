import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Regenerable Chromium caches and per-session files; everything else is copied. */
const SKIPPED_ENTRIES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'grshadercache',
  'shadercache',
  'blob_storage',
  'crashpad',
  'logs',
  'preview-cache',
  'singletonlock',
  'singletoncookie',
  'singletonsocket',
  'lockfile',
  'dev-instances',
]);

/** Chromium may create cache folders before this runs; those do not count. */
function hasOwnUserData(userDataPath: string): boolean {
  if (!existsSync(userDataPath)) return false;
  return readdirSync(userDataPath).some((name) => !SKIPPED_ENTRIES.has(name.toLowerCase()));
}

export type LegacyUserDataMigration =
  | { status: 'skipped' }
  | { status: 'copied'; from: string; entries: number }
  | { status: 'failed'; from: string; reason: string };

/**
 * P1 rename: the default profile moved from `<appData>/Serpent` to
 * `<appData>/Keel`. On the first start without a Keel profile, copy the old
 * settings, recent libraries, shortcuts, plugin data and local storage. The
 * old directory stays untouched so the previous build still works.
 */
export function copyLegacyUserData(input: {
  appDataPath: string;
  userDataPath: string;
  legacyName?: string;
}): LegacyUserDataMigration {
  const legacyPath = path.join(input.appDataPath, input.legacyName ?? 'Serpent');
  if (path.resolve(legacyPath).toLowerCase() === path.resolve(input.userDataPath).toLowerCase()) {
    return { status: 'skipped' };
  }
  if (!existsSync(legacyPath) || hasOwnUserData(input.userDataPath)) return { status: 'skipped' };
  try {
    mkdirSync(input.userDataPath, { recursive: true });
    let entries = 0;
    for (const entry of readdirSync(legacyPath, { withFileTypes: true })) {
      if (SKIPPED_ENTRIES.has(entry.name.toLowerCase())) continue;
      cpSync(path.join(legacyPath, entry.name), path.join(input.userDataPath, entry.name), {
        recursive: true,
        errorOnExist: false,
        force: false,
        verbatimSymlinks: true,
      });
      entries += 1;
    }
    writeFileSync(path.join(input.userDataPath, 'migrated-from-serpent.json'), `${JSON.stringify({
      from: legacyPath,
      migratedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return { status: 'copied', from: legacyPath, entries };
  } catch (error) {
    return { status: 'failed', from: legacyPath, reason: error instanceof Error ? error.message : String(error) };
  }
}
