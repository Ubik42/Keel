import type { FilterClause, TagSummary } from '../../shared/asset-types';

/**
 * Tag tree filter states (left sidebar). The user sets include or exclude on
 * a tag; its descendants take the same state at query time unless they have
 * their own state. Descendants are never written here.
 */
export type TagTreeState = 'include' | 'exclude';
export type TagTreeStates = Readonly<Record<string, TagTreeState>>;

export interface TagTreePreset {
  id: string;
  name: string;
  states: TagTreeStates;
}

export interface TagTreePrefs {
  version: 1;
  statesByLibrary: Readonly<Record<string, TagTreeStates>>;
  presetsByLibrary: Readonly<Record<string, readonly TagTreePreset[]>>;
}

const STORAGE_KEY = 'keel.tag-tree-states.v1';
const EMPTY_STATES: TagTreeStates = Object.freeze({});
const EMPTY_PRESETS: readonly TagTreePreset[] = Object.freeze([]);

export function emptyTagTreePrefs(): TagTreePrefs {
  return { version: 1, statesByLibrary: {}, presetsByLibrary: {} };
}

function isState(value: unknown): value is TagTreeState {
  return value === 'include' || value === 'exclude';
}

function parseStates(value: unknown): TagTreeStates {
  if (!value || typeof value !== 'object') return EMPTY_STATES;
  const states: Record<string, TagTreeState> = {};
  for (const [tagId, state] of Object.entries(value)) if (isState(state)) states[tagId] = state;
  return states;
}

export function loadTagTreePrefs(storage: Storage | undefined = globalThis.localStorage): TagTreePrefs {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<TagTreePrefs> | null;
    if (!parsed || parsed.version !== 1) return emptyTagTreePrefs();
    const statesByLibrary: Record<string, TagTreeStates> = {};
    for (const [libraryId, states] of Object.entries(parsed.statesByLibrary ?? {})) statesByLibrary[libraryId] = parseStates(states);
    const presetsByLibrary: Record<string, TagTreePreset[]> = {};
    for (const [libraryId, presets] of Object.entries(parsed.presetsByLibrary ?? {})) {
      if (!Array.isArray(presets)) continue;
      presetsByLibrary[libraryId] = presets
        .filter((preset): preset is TagTreePreset => Boolean(preset) && typeof preset.id === 'string' && typeof preset.name === 'string')
        .map((preset) => ({ id: preset.id, name: preset.name, states: parseStates(preset.states) }));
    }
    return { version: 1, statesByLibrary, presetsByLibrary };
  } catch {
    return emptyTagTreePrefs();
  }
}

export function saveTagTreePrefs(prefs: TagTreePrefs, storage: Storage | undefined = globalThis.localStorage): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* Storage may be unavailable. */ }
}

export function tagTreeStatesFor(prefs: TagTreePrefs, libraryId: string | null | undefined): TagTreeStates {
  return libraryId ? prefs.statesByLibrary[libraryId] ?? EMPTY_STATES : EMPTY_STATES;
}

export function tagTreePresetsFor(prefs: TagTreePrefs, libraryId: string | null | undefined): readonly TagTreePreset[] {
  return libraryId ? prefs.presetsByLibrary[libraryId] ?? EMPTY_PRESETS : EMPTY_PRESETS;
}

export function withTagTreeStates(prefs: TagTreePrefs, libraryId: string, states: TagTreeStates): TagTreePrefs {
  const statesByLibrary = { ...prefs.statesByLibrary };
  if (Object.keys(states).length === 0) delete statesByLibrary[libraryId];
  else statesByLibrary[libraryId] = states;
  return { ...prefs, statesByLibrary };
}

/** Sets or clears (state null) one tag's explicit state. */
export function withTagTreeState(prefs: TagTreePrefs, libraryId: string, tagId: string, state: TagTreeState | null): TagTreePrefs {
  const states: Record<string, TagTreeState> = { ...tagTreeStatesFor(prefs, libraryId) };
  if (state) states[tagId] = state;
  else delete states[tagId];
  return withTagTreeStates(prefs, libraryId, states);
}

/** Saves the states as a preset. A preset with the same name is replaced. */
export function withTagTreePresetSaved(prefs: TagTreePrefs, libraryId: string, name: string, states: TagTreeStates, id: string): TagTreePrefs {
  const trimmed = name.trim();
  const others = tagTreePresetsFor(prefs, libraryId).filter((preset) => preset.name !== trimmed);
  return {
    ...prefs,
    presetsByLibrary: { ...prefs.presetsByLibrary, [libraryId]: [...others, { id, name: trimmed, states: { ...states } }] },
  };
}

export function withTagTreePresetDeleted(prefs: TagTreePrefs, libraryId: string, presetId: string): TagTreePrefs {
  return {
    ...prefs,
    presetsByLibrary: {
      ...prefs.presetsByLibrary,
      [libraryId]: tagTreePresetsFor(prefs, libraryId).filter((preset) => preset.id !== presetId),
    },
  };
}

export function sameTagTreeStates(left: TagTreeStates, right: TagTreeStates): boolean {
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => left[key] === right[key]);
}

/** Only states of tags that still exist. */
export function liveTagTreeStates(states: TagTreeStates, tags: readonly TagSummary[]): TagTreeStates {
  const ids = new Set(tags.map((tag) => tag.tagId));
  const live: Record<string, TagTreeState> = {};
  for (const [tagId, state] of Object.entries(states)) if (ids.has(tagId)) live[tagId] = state;
  return live;
}

/**
 * The state a tag shows in the tree: its own, or else the nearest ancestor's
 * (inherited). Display only; the Worker resolves the same rule for queries.
 */
export function effectiveTagTreeState(
  tagId: string,
  states: TagTreeStates,
  parentById: ReadonlyMap<string, string | null | undefined>,
): { state: TagTreeState; inherited: boolean } | null {
  const own = states[tagId];
  if (own) return { state: own, inherited: false };
  const seen = new Set<string>([tagId]);
  let parent = parentById.get(tagId);
  while (parent && !seen.has(parent)) {
    const state = states[parent];
    if (state) return { state, inherited: true };
    seen.add(parent);
    parent = parentById.get(parent);
  }
  return null;
}

export function tagTreeStatesClause(states: TagTreeStates, tags: readonly TagSummary[], includeAi: boolean): FilterClause | null {
  const live = liveTagTreeStates(states, tags);
  const entries = Object.entries(live).map(([tagId, state]) => ({ tagId, state }));
  if (entries.length === 0) return null;
  return { field: 'tag_states', exclude: false, states: entries, includeAi };
}
