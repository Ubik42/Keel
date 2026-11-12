import {
  ENTITY_APPEARANCE_COLOR_IDS,
  ENTITY_APPEARANCE_ICON_IDS,
  type EntityAppearance,
} from './entity-appearance';

export function randomTagAppearance(random: () => number = Math.random): EntityAppearance {
  const iconIndex = Math.min(ENTITY_APPEARANCE_ICON_IDS.length - 1, Math.floor(random() * ENTITY_APPEARANCE_ICON_IDS.length));
  const colorIndex = Math.min(ENTITY_APPEARANCE_COLOR_IDS.length - 1, Math.floor(random() * ENTITY_APPEARANCE_COLOR_IDS.length));
  return {
    glyphKind: 'icon',
    glyphValue: ENTITY_APPEARANCE_ICON_IDS[iconIndex]!,
    colorId: ENTITY_APPEARANCE_COLOR_IDS[colorIndex]!,
  };
}
