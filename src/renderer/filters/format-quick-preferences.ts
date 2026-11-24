import { FORMAT_FILTER_GROUPS, FORMAT_TEXT_TOKEN, OTHER_FORMAT_EXTENSIONS } from "./format-filter-presets";

/**
 * Which format choices the filter row shows outside the 格式 panel. A key is
 * `group:<labelKey>` for a format group, or a format token (extension or
 * `text`). Edited in the 格式 panel; stored per user.
 */
export const MISC_GROUP_LABEL_KEY = "filter.formatGroupMisc";
export const MISC_FORMAT_TOKENS: readonly string[] = [...OTHER_FORMAT_EXTENSIONS, FORMAT_TEXT_TOKEN];

const STORAGE_KEY = "keel.format-quick.v1";

export const DEFAULT_FORMAT_QUICK_KEYS: readonly string[] = [
  ...FORMAT_FILTER_GROUPS.map((group) => groupKey(group.labelKey)),
  FORMAT_TEXT_TOKEN,
  "jpg", "png", "gif", "webp", "svg", "psd", "exr", "dng",
  "mp4", "mov", "mkv", "webm", "mp3", "wav", "flac",
  "pdf", "glb", "fbx", "obj", "ttf",
];

export function groupKey(labelKey: string): string {
  return `group:${labelKey}`;
}

export interface FormatQuickChip {
  key: string;
  /** i18n key for groups and `text`; the extension itself otherwise. */
  labelKey: string | null;
  label: string;
  tokens: readonly string[];
  group: boolean;
}

/** Every choice that can be shown outside, in the panel's order. */
export function allFormatQuickChips(): FormatQuickChip[] {
  const groups: FormatQuickChip[] = [
    ...FORMAT_FILTER_GROUPS.map((group) => ({ key: groupKey(group.labelKey), labelKey: group.labelKey, label: "", tokens: group.extensions, group: true })),
    { key: groupKey(MISC_GROUP_LABEL_KEY), labelKey: MISC_GROUP_LABEL_KEY, label: "", tokens: MISC_FORMAT_TOKENS, group: true },
    { key: FORMAT_TEXT_TOKEN, labelKey: "filter.formatText", label: "", tokens: [FORMAT_TEXT_TOKEN], group: true },
  ];
  const seen = new Set<string>();
  const extensions: FormatQuickChip[] = [];
  for (const ext of [...FORMAT_FILTER_GROUPS.flatMap((group) => group.extensions), ...OTHER_FORMAT_EXTENSIONS]) {
    if (seen.has(ext)) continue;
    seen.add(ext);
    extensions.push({ key: ext, labelKey: null, label: ext, tokens: [ext], group: false });
  }
  return [...groups, ...extensions];
}

export function loadFormatQuickKeys(storage: Storage | undefined = globalThis.localStorage): readonly string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as { version?: number; keys?: unknown } | null;
    if (parsed?.version === 1 && Array.isArray(parsed.keys)) return parsed.keys.filter((key): key is string => typeof key === "string");
  } catch { /* Fall back to the defaults. */ }
  return DEFAULT_FORMAT_QUICK_KEYS;
}

export function saveFormatQuickKeys(keys: readonly string[], storage: Storage | undefined = globalThis.localStorage): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, keys })); } catch { /* Storage may be unavailable. */ }
}

export function toggleFormatQuickKey(keys: readonly string[], key: string): readonly string[] {
  return keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key];
}
