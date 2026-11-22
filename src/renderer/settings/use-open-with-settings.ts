import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  DEFAULT_OPEN_WITH_SETTINGS,
  type OpenWithSettings,
} from "../../shared/open-with";

type OpenWithBridge = {
  get(): Promise<OpenWithSettings>;
  set(settings: OpenWithSettings): Promise<OpenWithSettings>;
  chooseProgram(): Promise<{ name: string; executablePath: string } | null>;
};

export function openWithBridge(): OpenWithBridge | undefined {
  return (window as Window & { keel?: { openWith?: OpenWithBridge } }).keel?.openWith;
}

let current: OpenWithSettings = DEFAULT_OPEN_WITH_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: OpenWithSettings): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** PF: open-with settings shared by App (double-click, menus) and the settings page. */
export function useOpenWithSettings(): {
  settings: OpenWithSettings;
  save: (next: OpenWithSettings) => Promise<void>;
} {
  const settings = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void openWithBridge()?.get().then(publish).catch(() => undefined);
  }, []);
  const save = useCallback(async (next: OpenWithSettings) => {
    const bridge = openWithBridge();
    publish(bridge ? await bridge.set(next) : next);
  }, []);
  return { settings, save };
}
