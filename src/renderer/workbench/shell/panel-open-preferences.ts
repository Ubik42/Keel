import { z } from 'zod';

/**
 * Whether the navigation and Inspector panes are open (P4). Saved on every
 * change, so a restart shows the panes as the user left them. Without a saved
 * value the window width decides, as before.
 */
export interface PanelOpenPreferences {
  readonly version: 1;
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
}

export const PANEL_OPEN_PREF_KEY = 'keel.shell-panels-open.v1';

const schema = z.object({ version: z.literal(1), leftOpen: z.boolean(), rightOpen: z.boolean() });

export function defaultPanelOpen(windowWidth: number): PanelOpenPreferences {
  return { version: 1, leftOpen: windowWidth > 800, rightOpen: windowWidth > 1020 };
}

export function loadPanelOpenPreferences(windowWidth: number, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): PanelOpenPreferences {
  try {
    const raw = storage?.getItem(PANEL_OPEN_PREF_KEY);
    if (raw) {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Unreadable storage falls back to the width rule.
  }
  return defaultPanelOpen(windowWidth);
}

export function savePanelOpenPreferences(prefs: PanelOpenPreferences, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(PANEL_OPEN_PREF_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or privacy mode: the panes still work for this session.
  }
}
