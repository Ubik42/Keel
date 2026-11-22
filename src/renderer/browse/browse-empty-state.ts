import type { IconName } from "../common/Icons";

/** Which browse empty surface to show when the grid has zero assets. */
export type BrowseEmptyKind =
  | "search"
  | "trash"
  | "folder";

export type BrowseEmptyState = {
  kind: BrowseEmptyKind;
  titleKey: string;
  detailKey: string;
  showImportActions: boolean;
  icon: IconName;
};

export type ImportMenuItemCopy = {
  labelKey: string;
  /** Destination / semantics hint for `title` attribute. */
  titleKey: string;
};

export type ImportMenuCopy = {
  importFiles: ImportMenuItemCopy;
  importFolder: ImportMenuItemCopy;
  pasteImage: ImportMenuItemCopy;
  importLinkedFolder: ImportMenuItemCopy;
};

/**
 * Resolve empty-grid copy for the asset browse canvas.
 *
 * Priority: active search/discovery narrowing → trash → folder/library empty.
 * Only the folder path keeps import CTAs (CU-B6 / CU-B7 / CU-U5).
 */
export function resolveBrowseEmptyState(input: {
  showTrash: boolean;
  /** Non-empty search box and/or active discovery filters that narrow results. */
  hasActiveDiscovery: boolean;
  hasSelectedFolder: boolean;
}): BrowseEmptyState {
  if (input.hasActiveDiscovery) {
    return {
      kind: "search",
      titleKey: "empty.searchTitle",
      detailKey: "empty.searchBody",
      showImportActions: false,
      icon: "search",
    };
  }
  if (input.showTrash) {
    return {
      kind: "trash",
      titleKey: "empty.trashTitle",
      detailKey: "empty.trashBody",
      showImportActions: false,
      icon: "trash",
    };
  }
  return {
    kind: "folder",
    titleKey: input.hasSelectedFolder
      ? "empty.folderTitle"
      : "empty.folderBody",
    detailKey: "empty.folderDetail",
    showImportActions: true,
    icon: "upload",
  };
}

/** Library-menu import labels (CU-U5). */
export function resolveImportMenuCopy(): ImportMenuCopy {
  return {
    importFiles: {
      labelKey: "toolbar.importFiles",
      titleKey: "toolbar.importFiles",
    },
    importFolder: {
      labelKey: "toolbar.importFolder",
      titleKey: "toolbar.importFolder",
    },
    pasteImage: {
      labelKey: "toolbar.pasteImage",
      titleKey: "toolbar.pasteImage",
    },
    importLinkedFolder: {
      labelKey: "toolbar.importLinkedFolder",
      titleKey: "toolbar.importLinkedFolder",
    },
  };
}
