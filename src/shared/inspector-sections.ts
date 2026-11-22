/**
 * Built-in Inspector sections in display order (asset selection). Plugin
 * sections name one of these in `after` to appear right after it; without
 * it they follow the tags, as before.
 */
export const INSPECTOR_SECTION_IDS = ['hero', 'status', 'tags', 'metadata', 'ai-status', 'technical'] as const;
export type InspectorSectionId = typeof INSPECTOR_SECTION_IDS[number];
export const DEFAULT_PLUGIN_INSPECTOR_PLACEMENT: InspectorSectionId = 'tags';
