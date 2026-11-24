import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-tag "include child tags" preference
//
// Browsing a parent tag includes its child tags by default. Tags the user
// switched to "this tag only" are remembered across restarts, keyed by
// library id + tag id. Only those tags are stored (absence means included).
// ---------------------------------------------------------------------------

export interface TagDescendantsPreferences {
  readonly version: 1;
  readonly excludedByLibrary: Readonly<
    Record<string, Readonly<Record<string, true>>>
  >;
}

export interface TagDescendantsPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TAG_DESCENDANTS_PREF_KEY = 'keel.tag-descendants.v1';

export const DEFAULT_TAG_DESCENDANTS_PREFERENCES: TagDescendantsPreferences = {
  version: 1,
  excludedByLibrary: {},
};

const schema = z.object({
  version: z.literal(1),
  excludedByLibrary: z.record(z.string(), z.record(z.string(), z.literal(true))),
});

function resolveStorage(
  storage?: TagDescendantsPreferencesStorage,
): TagDescendantsPreferencesStorage | null {
  if (storage) return storage;
  return (globalThis as { localStorage?: TagDescendantsPreferencesStorage })
    .localStorage ?? null;
}

export function loadTagDescendantsPreferences(
  storage?: TagDescendantsPreferencesStorage,
): TagDescendantsPreferences {
  const s = resolveStorage(storage);
  const raw = s?.getItem(TAG_DESCENDANTS_PREF_KEY) ?? null;
  if (raw === null) return DEFAULT_TAG_DESCENDANTS_PREFERENCES;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : DEFAULT_TAG_DESCENDANTS_PREFERENCES;
  } catch {
    return DEFAULT_TAG_DESCENDANTS_PREFERENCES;
  }
}

export function isTagDescendantsIncluded(
  prefs: TagDescendantsPreferences,
  libraryId: string,
  tagId: string,
): boolean {
  return prefs.excludedByLibrary[libraryId]?.[tagId] !== true;
}

/** Returns new preferences with `tagId` set to include or exclude child tags. */
export function withTagDescendantsIncluded(
  prefs: TagDescendantsPreferences,
  libraryId: string,
  tagId: string,
  included: boolean,
): TagDescendantsPreferences {
  const libraryMap = { ...(prefs.excludedByLibrary[libraryId] ?? {}) };
  if (included) delete libraryMap[tagId];
  else libraryMap[tagId] = true;
  const excludedByLibrary = { ...prefs.excludedByLibrary };
  if (Object.keys(libraryMap).length === 0) delete excludedByLibrary[libraryId];
  else excludedByLibrary[libraryId] = libraryMap;
  return { version: 1, excludedByLibrary };
}

export function saveTagDescendantsPreferences(
  prefs: TagDescendantsPreferences,
  storage?: TagDescendantsPreferencesStorage,
): void {
  resolveStorage(storage)?.setItem(TAG_DESCENDANTS_PREF_KEY, JSON.stringify(prefs));
}
