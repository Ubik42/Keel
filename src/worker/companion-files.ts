import path from 'node:path';

/**
 * Companion files (PF, docs/进度.md 3.6): a file in the same directory whose
 * name is the primary's name without extension plus a companion extension
 * (`photo.xmp` for `photo.CR3`), or the primary's full name plus a companion
 * extension (`photo.CR3.xmp`). Companions stay ordinary assets; this module
 * records which primary each one belongs to so browsing hides them and file
 * operations on the primary carry them along.
 */

/** Built-in companion extensions (lowercase, no dot). Plugins add more. */
export const BUILT_IN_COMPANION_EXTENSIONS: readonly string[] = ['xmp'];

/** Migration 65. */
export const ASSET_COMPANIONS_SQL = `
CREATE TABLE IF NOT EXISTS asset_companions (
  asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  primary_asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS asset_companions_primary ON asset_companions(primary_asset_id);
CREATE TABLE IF NOT EXISTS asset_companion_index_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  browse_sequence INTEGER NOT NULL,
  extensions TEXT NOT NULL
);
`;

export type CompanionCandidateRow = {
  asset_id: string;
  location_kind: string;
  linked_folder_id: string | null;
  relative_file_path: string;
};

export function normalizeCompanionExtensions(extensions: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const raw of extensions) {
    const value = raw.trim().replace(/^\./u, '').toLowerCase();
    if (/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(value)) result.add(value);
  }
  return [...result].sort();
}

function extensionOf(relativePath: string): string {
  return path.posix.extname(relativePath).slice(1).toLowerCase();
}

function locationKey(row: CompanionCandidateRow, directory: string): string {
  return `${row.location_kind}\u0000${row.linked_folder_id ?? ''}\u0000${directory.toLowerCase()}`;
}

/**
 * Pair each companion with its primary. `rows` are the live assets that share
 * a directory with at least one companion candidate. A full-name match
 * (`photo.CR3.xmp`) wins over a stem match (`photo.xmp`); ties pick the
 * lexically first primary so the result is stable.
 */
export function pairCompanions(
  rows: readonly CompanionCandidateRow[],
  extensions: readonly string[],
): Map<string, string> {
  const companionExts = new Set(extensions);
  const byDirectory = new Map<string, CompanionCandidateRow[]>();
  for (const row of rows) {
    const key = locationKey(row, path.posix.dirname(row.relative_file_path));
    const list = byDirectory.get(key);
    if (list) list.push(row);
    else byDirectory.set(key, [row]);
  }
  const pairs = new Map<string, string>();
  for (const siblings of byDirectory.values()) {
    const primaries = siblings
      .filter((row) => !companionExts.has(extensionOf(row.relative_file_path)))
      .sort((left, right) => left.relative_file_path.localeCompare(right.relative_file_path));
    if (primaries.length === 0) continue;
    for (const companion of siblings) {
      if (!companionExts.has(extensionOf(companion.relative_file_path))) continue;
      const base = path.posix.basename(companion.relative_file_path);
      const withoutExt = base.slice(0, base.length - path.posix.extname(base).length).toLowerCase();
      const fullMatch = primaries.find((primary) => path.posix.basename(primary.relative_file_path).toLowerCase() === withoutExt);
      const stemMatch = fullMatch ?? primaries.find((primary) => {
        const name = path.posix.basename(primary.relative_file_path);
        return name.slice(0, name.length - path.posix.extname(name).length).toLowerCase() === withoutExt;
      });
      if (stemMatch) pairs.set(companion.asset_id, stemMatch.asset_id);
    }
  }
  return pairs;
}

/**
 * New file name for a companion when its primary is renamed. Returns null
 * when the companion no longer matches the primary's old name.
 */
export function renamedCompanionName(
  companionName: string,
  oldPrimaryName: string,
  newPrimaryName: string,
): string | null {
  const companionExt = path.posix.extname(companionName);
  const companionBase = companionName.slice(0, companionName.length - companionExt.length);
  if (companionBase.toLowerCase() === oldPrimaryName.toLowerCase()) return `${newPrimaryName}${companionExt}`;
  const oldStem = oldPrimaryName.slice(0, oldPrimaryName.length - path.posix.extname(oldPrimaryName).length);
  const newStem = newPrimaryName.slice(0, newPrimaryName.length - path.posix.extname(newPrimaryName).length);
  if (companionBase.toLowerCase() === oldStem.toLowerCase()) return `${newStem}${companionExt}`;
  return null;
}
