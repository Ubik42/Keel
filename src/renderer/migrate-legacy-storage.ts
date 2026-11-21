// Side-effect import: must be the first import of the renderer entry so no
// preference module reads localStorage before the keys move.

/** P1 rename: move `serpent.*` localStorage keys to `keel.*` once. */
export function migrateLegacyStorageKeys(storage: Storage): number {
  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith('serpent.')) legacyKeys.push(key);
  }
  for (const key of legacyKeys) {
    const value = storage.getItem(key);
    const current = `keel.${key.slice('serpent.'.length)}`;
    if (value !== null && storage.getItem(current) === null) storage.setItem(current, value);
    storage.removeItem(key);
  }
  return legacyKeys.length;
}

try {
  migrateLegacyStorageKeys(window.localStorage);
} catch {
  // Storage can be unavailable (private profile, quota); preferences fall back to defaults.
}
