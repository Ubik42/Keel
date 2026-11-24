import { queryFields } from '../stores/query-store';
import { saveTagTreePrefs, type TagTreePrefs } from './tag-tree-states';

/** Updates the tag tree states and presets and saves them. Queries reload from the store change. */
export function updateTagTreePrefs(update: (prefs: TagTreePrefs) => TagTreePrefs): void {
  const next = update(queryFields.get('tagTreePrefs'));
  queryFields.setterFor('tagTreePrefs')(next);
  saveTagTreePrefs(next);
}
