/**
 * Persist browse scope + selection across app restarts (localStorage).
 * Extracted from App.tsx for Serpent-uye — pure read/write/build helpers.
 */

import {
  resolveSessionStorage,
  type SessionStorage,
} from "./session-storage";

export type StoredBrowserSession = {
  version: 1;
  scope:
    | { kind: "all" | "root" | "trash" }
    | {
        kind: "folder" | "tag";
        id: string;
        name?: string;
      };
  selectedAssetId: string;
  selectedAssetName: string;
};

export type BrowserSessionStorage = SessionStorage;

export type BrowseStateForSession = {
  showTrash: boolean;
  activeTagId: string | null;
  activeTagName: string | undefined;
  assetScope: "all" | "root" | string;
  selectedAssetId: string;
  selectedAssetName: string;
};

const SCOPED_KINDS = new Set(["folder", "tag"]);

export function browserSessionKey(libraryId: string): string {
  return `serpent.browser-session.v1.${libraryId}`;
}

export function readBrowserSession(
  libraryId: string,
  storage?: BrowserSessionStorage,
): StoredBrowserSession | null {
  const store = resolveSessionStorage(storage);
  if (!store) return null;
  try {
    const value = JSON.parse(
      store.getItem(browserSessionKey(libraryId)) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<StoredBrowserSession>;
    if (
      session.version !== 1 ||
      typeof session.selectedAssetId !== "string" ||
      typeof session.selectedAssetName !== "string" ||
      !session.scope ||
      typeof session.scope !== "object" ||
      ![
        "all",
        "root",
        "trash",
        "folder",
        "tag",
      ].includes(session.scope.kind)
    ) {
      return null;
    }
    if (
      SCOPED_KINDS.has(session.scope.kind) &&
      !("id" in session.scope && typeof session.scope.id === "string")
    ) {
      return null;
    }
    return session as StoredBrowserSession;
  } catch {
    return null;
  }
}

export function writeBrowserSession(
  libraryId: string,
  session: StoredBrowserSession,
  storage?: BrowserSessionStorage,
): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  store.setItem(browserSessionKey(libraryId), JSON.stringify(session));
}

/** Build the payload App persists whenever the selected asset changes. */
export function buildBrowserSessionFromBrowseState(
  state: BrowseStateForSession,
): StoredBrowserSession {
  const scope: StoredBrowserSession["scope"] = state.showTrash
    ? { kind: "trash" }
    : state.activeTagId
      ? {
          kind: "tag",
          id: state.activeTagId,
          name: state.activeTagName,
        }
      : state.assetScope === "all" || state.assetScope === "root"
        ? { kind: state.assetScope }
        : { kind: "folder", id: state.assetScope };

  return {
    version: 1,
    scope,
    selectedAssetId: state.selectedAssetId,
    selectedAssetName: state.selectedAssetName,
  };
}
