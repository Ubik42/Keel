// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NavigationSidebar,
  NavigationSidebarActionsProvider,
  type NavigationSidebarActions,
  type NavigationSidebarProps,
} from "../../src/renderer/NavigationSidebar";
import { MANAGED_FOLDERS_DRAG_TYPE } from "../../src/renderer/workbench/tree/folder-drag-drop";
import { LocaleProvider } from "../../src/renderer/i18n";
import { browseFields } from "../../src/renderer/stores/browse-store";
import { navigationFields, type NavigationState } from "../../src/renderer/stores/navigation-store";
import { queryFields } from "../../src/renderer/stores/query-store";
import { selectionFields } from "../../src/renderer/stores/selection-store";
import { sessionFields, type SessionState } from "../../src/renderer/stores/session-store";
import { NAV_TREE_PREF_KEY } from "../../src/renderer/nav-tree-preferences";

function createDragTransfer(
  types: string[],
  files: File[] = [],
  effectAllowed: DataTransfer['effectAllowed'] = 'all',
): DataTransfer {
  return {
    types,
    dropEffect: "none",
    effectAllowed,
    files,
    getData: () => "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function createFolderDragTransfer(folderIds: string[]): DataTransfer {
  return {
    types: [MANAGED_FOLDERS_DRAG_TYPE],
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    getData: (type: string) =>
      type === MANAGED_FOLDERS_DRAG_TYPE ? JSON.stringify(folderIds) : "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function dispatchDragEvent(
  element: Element,
  type: "dragenter" | "dragover" | "dragstart",
  dataTransfer: DataTransfer,
  clientY = 0,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  element.dispatchEvent(event);
  return event;
}

/** happy-dom reports a zero-size row; custom-order drops need a real band. */
function setRowRect(element: Element, top = 100, height = 22): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  });
}

function dispatchDropEvent(
  element: Element,
  dataTransfer: DataTransfer,
): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
  return event;
}

/** Props that NavigationSidebar now reads from stores (P3). */
type NavigationStoreProps = {
  library?: SessionState["library"];
  assetScope?: NavigationState["assetScope"];
  showTrash?: boolean;
  showTagManagement?: boolean;
  activePluginSidebarViewId?: string | null;
  activeTagId?: string | null;
  showIgnoredItems?: boolean;
  showMissingLinkedFiles?: boolean;
  allAssetCount?: number;
  rootAssetCount?: number;
  trashedAssetCount?: number;
  folders?: NavigationState["folders"];
  linkedFolders?: NavigationState["linkedFolders"];
  selectedFolderIds?: string[];
  onConvertLinkedDialog?: unknown;
};
type SidebarProps = NavigationSidebarProps & NavigationSidebarActions;
type NavigationOverrides = Partial<SidebarProps> & NavigationStoreProps;

/** The sidebar with its operations provided the way App provides them. */
function sidebar(props: SidebarProps): ReturnType<typeof createElement> {
  return createElement(NavigationSidebarActionsProvider, { value: props }, createElement(NavigationSidebar, props));
}

const STORE_PROPS: Record<keyof NavigationStoreProps, (value: never) => void> = {
  library: sessionFields.setterFor("library"),
  assetScope: navigationFields.setterFor("assetScope"),
  showTrash: navigationFields.setterFor("showTrash"),
  showTagManagement: navigationFields.setterFor("showTagManagement"),
  activePluginSidebarViewId: navigationFields.setterFor("activePluginSidebarViewId"),
  activeTagId: navigationFields.setterFor("activeTagId"),
  showIgnoredItems: queryFields.setterFor("showIgnoredItems"),
  showMissingLinkedFiles: queryFields.setterFor("showMissingLinkedFiles"),
  allAssetCount: browseFields.setterFor("allAssetCount"),
  rootAssetCount: browseFields.setterFor("rootAssetCount"),
  trashedAssetCount: browseFields.setterFor("trashedAssetCount"),
  folders: navigationFields.setterFor("folders"),
  linkedFolders: navigationFields.setterFor("linkedFolders"),
  selectedFolderIds: selectionFields.setterFor("selectedFolderIds"),
  onConvertLinkedDialog: () => undefined,
};

function createNavigationProps(
  overrides: NavigationOverrides = {},
): SidebarProps {
  const merged: Record<string, unknown> = { ...navigationDefaults(), ...overrides };
  for (const [key, set] of Object.entries(STORE_PROPS)) {
    if (key in merged) {
      set(merged[key] as never);
      delete merged[key];
    }
  }
  return merged as unknown as SidebarProps;
}

function navigationDefaults(): NavigationOverrides {
  const noop = vi.fn();
  return {
    library: {
      libraryId: "library-1",
      displayName: "Demo",
      displayPath: "/temporary/demo",
    },
    assetScope: "root",
    showTrash: false,
    showTagManagement: false,
    activeTagId: null,
    showIgnoredItems: false,
    onToggleShowIgnoredItems: noop,
    allAssetCount: 7,
    rootAssetCount: 2,
    trashedAssetCount: 0,
    folders: [],
    linkedFolders: [],
    onChooseAllAssets: noop,
    onEnterTrash: noop,
    onEnterTagManagement: noop,
    onChooseFolder: noop,
    onExternalDragOver: noop,
    onExternalDrop: noop,
    onAssetsDroppedOnFolder: noop,
    onFoldersDroppedOnFolder: noop,
    selectedFolderIds: [],
    onToggleFolderSelection: noop,
    onAssetsDroppedOnTrash: noop,
    onFoldersDroppedOnTrash: noop,
    onImportFolderAsLinked: noop,
    onRelinkFolder: noop,
    onConvertLinkedDialog: noop,
    onAddFolder: noop,
    inlineFolderEdit: null,
    onInlineFolderEditChange: noop,
    onInlineFolderEditCommit: noop,
    onInlineFolderEditCancel: noop,
    onOpenContextMenu: noop,
    onImportDroppedFiles: noop,
    onCopyManagedToLinked: noop,
  };
}

describe("NavigationSidebar virtual library root", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    localStorage.removeItem(NAV_TREE_PREF_KEY);
  });

  it("renders one selectable root row with its direct-asset count", async () => {
    const onChooseFolder = vi.fn();
    const props = createNavigationProps({ onChooseFolder });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const rows = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")];
    const rootRows = rows.filter((row) => (row.textContent ?? "").includes("Library root"));
    expect(rootRows).toHaveLength(1);
    expect(rootRows[0]?.classList.contains("is-active")).toBe(true);
    expect(rootRows[0]?.textContent).toContain("2");

    await act(async () => rootRows[0]?.click());
    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  it("expands ancestors and focuses a folder revealed from a workspace tab", async () => {
    const parent = {
      folderId: "folder-parent",
      parentFolderId: null,
      name: "Parent",
      relativePath: "Parent",
      directAssetCount: 0,
      childFolderCount: 1,
    };
    const child = {
      folderId: "folder-child",
      parentFolderId: parent.folderId,
      name: "Child",
      relativePath: "Parent/Child",
      directAssetCount: 0,
      childFolderCount: 0,
    };
    localStorage.setItem(NAV_TREE_PREF_KEY, JSON.stringify({
      version: 1,
      collapsedFolderIds: [parent.folderId],
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(
        LocaleProvider,
        null,
        sidebar(createNavigationProps({
          folders: [parent, child],
          revealTarget: { kind: "folder", id: child.folderId, requestId: 1 },
        })),
      ));
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    });

    const childRow = container.querySelector<HTMLButtonElement>(
      `[data-nav-folder-id="${child.folderId}"]`,
    );
    expect(childRow).not.toBeNull();
    expect(document.activeElement).toBe(childRow);

    const parentRow = container.querySelector<HTMLButtonElement>(
      `[data-nav-folder-id="${parent.folderId}"]`,
    );
    const collapseParent =
      parentRow?.parentElement?.querySelector<HTMLButtonElement>(".nav-disclosure");
    await act(async () => {
      collapseParent?.click();
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    });
    expect(container.querySelector(
      `[data-nav-folder-id="${child.folderId}"]`,
    )).toBeNull();
  });

  it("keeps nested folder rows aligned with long labels and counts", async () => {
    const onChooseFolder = vi.fn();
    const parentFolderName = "A very long parent folder name that must stay on one row";
    const childFolderName = "A deeply nested child folder with a long display name";
    const parentFolderId = "folder-parent";
    const childFolderId = "folder-child";
    const props = createNavigationProps({
      folders: [
        {
          folderId: parentFolderId,
          parentFolderId: null,
          name: parentFolderName,
          relativePath: "parent",
          directAssetCount: 3,
          childFolderCount: 1,
        },
        {
          folderId: childFolderId,
          parentFolderId: parentFolderId,
          name: childFolderName,
          relativePath: "parent/child",
          directAssetCount: 5,
          childFolderCount: 0,
        },
      ],
      onChooseFolder,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const folderRows = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[data-nav-folder-kind="managed"]',
      ),
    ];
    expect(folderRows).toHaveLength(2);
    const parentFolderRow = folderRows.find(
      (row) => row.dataset.navFolderId === parentFolderId,
    );
    const childFolderRow = folderRows.find(
      (row) => row.dataset.navFolderId === childFolderId,
    );
    expect(parentFolderRow?.querySelector(".nav-row-label")?.textContent).toBe(
      parentFolderName,
    );
    expect(childFolderRow?.querySelector(".nav-row-label")?.textContent).toBe(
      childFolderName,
    );
    expect(parentFolderRow?.getAttribute("data-hover-tip")).toBe(parentFolderName);
    expect(childFolderRow?.getAttribute("data-hover-tip")).toBe(childFolderName);
    expect(parentFolderRow?.style.paddingLeft).toBe("7px");
    expect(childFolderRow?.style.paddingLeft).toBe("7px");
    // Root-level folders start at depth 0 so they line up with the fixed root
    // rows; each nested level adds 14px (Keel: sidebar alignment fix).
    expect(parentFolderRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft).toBe(
      "0px",
    );
    expect(childFolderRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft).toBe(
      "14px",
    );
    expect(
      parentFolderRow?.closest(".nav-tree-row")?.querySelector(".nav-disclosure"),
    ).not.toBeNull();
    expect(
      childFolderRow?.closest(".nav-tree-row")?.querySelector(".nav-disclosure-spacer"),
    ).not.toBeNull();
    expect(parentFolderRow?.querySelector(".nav-count")?.textContent).toBe("3");
    expect(childFolderRow?.querySelector(".nav-count")?.textContent).toBe("5");


    await act(async () => childFolderRow?.click());
    expect(onChooseFolder).toHaveBeenCalledWith(childFolderId);
  });

  it("reserves one trailing grid column for the asset count", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.nav-row\s*\{[\s\S]*?grid-template-columns:\s*17px minmax\(0, 1fr\) auto;/,
    );
    expect(styles).not.toContain(".nav-child-count");
  });

  it("routes only an active in-app native File drop to the trash", async () => {
    const files = [new File(["fixture"], "fixture.png", { type: "image/png" })];
    const onResolveManagedAssetDrop = vi.fn(async () => ["asset-1"]);
    const onAssetsDroppedOnTrash = vi.fn();
    const props = createNavigationProps({
      isInternalAssetDrag: () => true,
      onResolveManagedAssetDrop,
      onAssetsDroppedOnTrash,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const trashRow = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")]
      .find((row) => /Trash|回收站/u.test(row.textContent ?? ""));
    expect(trashRow).toBeDefined();

    let dropEvent: Event | undefined;
    await act(async () => {
      dropEvent = dispatchDropEvent(trashRow!, createDragTransfer(["Files"], files));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dropEvent?.defaultPrevented).toBe(true);
    expect(onResolveManagedAssetDrop).toHaveBeenCalledWith(files);
    expect(onAssetsDroppedOnTrash).toHaveBeenCalledWith(["asset-1"]);
  });

  it("accepts a native internal trash drop when the source allows copy but not move", async () => {
    const props = createNavigationProps({
      isInternalAssetDrag: () => true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const trashRow = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")]
      .find((row) => /Trash|回收站/u.test(row.textContent ?? ""));
    expect(trashRow).toBeDefined();
    const transfer = createDragTransfer(["Files"], [], "copyLink");

    let dragOver: Event | undefined;
    await act(async () => {
      dragOver = dispatchDragEvent(trashRow!, "dragover", transfer);
    });

    expect(dragOver?.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe("copy");
    expect(trashRow?.classList.contains("is-drop-target")).toBe(true);
  });

  it("does not accept a managed drag when the source allows no operation", async () => {
    const props = createNavigationProps({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const trashRow = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")]
      .find((row) => /Trash|回收站/u.test(row.textContent ?? ""));
    expect(trashRow).toBeDefined();
    const transfer = createDragTransfer(
      ["application/x-keel-managed-assets"],
      [],
      "none",
    );

    let dragOver: Event | undefined;
    await act(async () => {
      dragOver = dispatchDragEvent(trashRow!, "dragover", transfer);
    });

    expect(dragOver?.defaultPrevented).toBe(false);
    expect(trashRow?.classList.contains("is-drop-target")).toBe(false);
  });

  it("does not trash an external native File drop", async () => {
    const files = [new File(["fixture"], "fixture.png", { type: "image/png" })];
    const onResolveManagedAssetDrop = vi.fn(async () => ["asset-1"]);
    const onAssetsDroppedOnTrash = vi.fn();
    const props = createNavigationProps({
      isInternalAssetDrag: () => false,
      onResolveManagedAssetDrop,
      onAssetsDroppedOnTrash,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          sidebar(props),
        ),
      );
    });

    const trashRow = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")]
      .find((row) => /Trash|回收站/u.test(row.textContent ?? ""));
    expect(trashRow).toBeDefined();

    await act(async () => {
      dispatchDropEvent(trashRow!, createDragTransfer(["Files"], files));
      await Promise.resolve();
    });

    expect(onResolveManagedAssetDrop).not.toHaveBeenCalled();
    expect(onAssetsDroppedOnTrash).not.toHaveBeenCalled();
  });

});

describe("NavigationSidebar folder-section blank area", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  const parentFolder = {
    folderId: "folder-parent",
    parentFolderId: null,
    name: "Parent",
    relativePath: "parent",
    directAssetCount: 3,
    childFolderCount: 1,
  };
  const childFolder = {
    folderId: "folder-child",
    parentFolderId: "folder-parent",
    name: "Child",
    relativePath: "parent/child",
    directAssetCount: 5,
    childFolderCount: 0,
  };
  /** Another root-level folder: a drop here really does change the parent. */
  const siblingFolder = {
    folderId: "folder-sibling",
    parentFolderId: null,
    name: "Sibling",
    relativePath: "sibling",
    directAssetCount: 1,
    childFolderCount: 0,
  };

  async function renderSidebar(
    overrides: NavigationOverrides = {},
  ): Promise<HTMLElement> {
    const props = createNavigationProps({
      folders: [parentFolder, childFolder, siblingFolder],
      ...overrides,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          // Explicit preference keeps the renderer independent of
          // globalThis.localStorage (see the sibling suite).
          { children: null, initialPreference: "zh-CN" },
          sidebar(props),
        ),
      );
    });
    const nav = container.querySelector<HTMLElement>(".navigation-scroll");
    expect(nav).not.toBeNull();
    return nav!;
  }

  function folderRow(nav: HTMLElement, folderId: string): HTMLButtonElement {
    const row = nav.querySelector<HTMLButtonElement>(
      `button[data-nav-folder-id="${folderId}"]`,
    );
    expect(row).not.toBeNull();
    return row!;
  }

  /** The folder list container: its own box is the blank area's outer edge. */
  function folderList(nav: HTMLElement): HTMLElement {
    const list = nav.querySelector<HTMLElement>(".nav-folder-list");
    expect(list).not.toBeNull();
    return list!;
  }

  /** The indentation column left of a row: blank, but visually part of it. */
  function rowGutter(nav: HTMLElement, folderId: string): HTMLElement {
    const gutter = folderRow(nav, folderId).closest<HTMLElement>(".nav-tree-row");
    expect(gutter).not.toBeNull();
    return gutter!;
  }

  // Serpent-6e3b10
  it("returns to the library root when the folder list itself is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      onChooseFolder,
    });

    await act(async () => folderList(nav).click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10 — the folder section's own empty state is inside the blank
  // area.
  it("returns to the library root when the folder section's empty state is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      folders: [],
      onChooseFolder,
    });
    const emptyState = nav.querySelector<HTMLElement>(
      ".nav-folder-list p.nav-empty",
    );
    expect(emptyState).not.toBeNull();

    await act(async () => emptyState!.click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10
  it("returns to the library root when the indentation gutter is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      onChooseFolder,
    });

    await act(async () => rowGutter(nav, childFolder.folderId).click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10 — everything outside the folder section stays inert.
  it("does not navigate from the rest of the pane", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      onChooseFolder,
    });
    const heading = nav.querySelector<HTMLElement>(".nav-section-heading > span");
    expect(heading).not.toBeNull();

    await act(async () => {
      heading!.click();
      nav.click();
    });

    expect(onChooseFolder).not.toHaveBeenCalled();
  });

  // Serpent-316493 follow-up: right-clicking the blank area is a right-click on
  // the library root.
  it("opens the root context menu when the blank area is right-clicked", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });

    await act(async () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 42,
        clientY: 24,
      });
      folderList(nav).dispatchEvent(event);
    });

    expect(onOpenRootFolderContextMenu).toHaveBeenCalledWith({ x: 42, y: 24 });
  });

  it("keeps a folder row right-click on that row's own menu", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });

    await act(async () => {
      folderRow(nav, childFolder.folderId).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(onOpenRootFolderContextMenu).not.toHaveBeenCalled();
  });

  // Serpent-a6c516: the 「资源库根目录」 row is the same subject as the blank area.
  it("opens the root context menu from the library root row", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });
    const rootRow = [
      ...nav.querySelectorAll<HTMLButtonElement>(".nav-row"),
    ].find((row) => row.textContent?.includes("资源库根目录"));
    expect(rootRow).toBeDefined();

    await act(async () => {
      rootRow!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 7,
          clientY: 9,
        }),
      );
    });

    expect(onOpenRootFolderContextMenu).toHaveBeenCalledWith({ x: 7, y: 9 });
  });

  // Serpent-6e3b10
  it("keeps a folder row click on that folder and never falls back to the root", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({ onChooseFolder });

    await act(async () => folderRow(nav, childFolder.folderId).click());

    expect(onChooseFolder).toHaveBeenCalledWith(childFolder.folderId);
    expect(onChooseFolder).not.toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10
  it("ignores blank-area clicks while an inline editor owns the click", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      inlineFolderEdit: {
        kind: "create",
        parentFolderId: null,
        value: "New",
        error: null,
        submitting: false,
      },
      onChooseFolder,
    });

    await act(async () => {
      folderList(nav).click();
      rowGutter(nav, childFolder.folderId).click();
    });

    expect(onChooseFolder).not.toHaveBeenCalled();
  });

  // Serpent-b29bc4
  it("moves dragged folders to the library root when dropped on the blank area", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const list = folderList(nav);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(true);

    let dropEvent: Event | undefined;
    await act(async () => {
      dropEvent = dispatchDropEvent(list, transfer);
    });

    expect(dropEvent?.defaultPrevented).toBe(true);
    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(null, [
      childFolder.folderId,
    ]);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);
  });

  // Serpent-b29bc4
  it("moves dragged folders to the root when dropped on the gutter", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const gutter = rowGutter(nav, childFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(gutter, "dragenter", transfer);
      dispatchDragEvent(gutter, "dragover", transfer);
      dispatchDropEvent(gutter, transfer);
    });

    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(null, [
      childFolder.folderId,
    ]);
  });

  // Serpent-b29bc4
  it("keeps a folder row drop on that row instead of the blank area", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const row = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      // Real HTML5 drags fire dragenter before dragover; the row highlight is
      // set on dragenter, the drop decision on dragover.
      dispatchDragEvent(row, "dragenter", transfer);
      dispatchDragEvent(row, "dragover", transfer);
    });
    expect(row.classList.contains("is-drop-target")).toBe(true);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);

    await act(async () => {
      dispatchDropEvent(row, transfer);
    });

    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(
      parentFolder.folderId,
      [childFolder.folderId],
    );
  });

  // Serpent-b29bc4 — dragging off the blank area onto a row must hand the
  // highlight over instead of leaving both lit.
  it("clears the blank-area highlight once the drag hovers a folder row", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const list = nav.querySelector<HTMLElement>(".nav-folder-list")!;
    const row = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });
    expect(list.classList.contains("is-root-drop-target")).toBe(true);

    await act(async () => {
      dispatchDragEvent(row, "dragenter", transfer);
      dispatchDragEvent(row, "dragover", transfer);
    });

    expect(list.classList.contains("is-root-drop-target")).toBe(false);
    expect(row.classList.contains("is-drop-target")).toBe(true);
  });

  // Serpent-374266: a target that would change nothing is not a target — it must
  // not highlight (and therefore never shows the "cannot move" notice).
  it("does not highlight folder targets that would change nothing", async () => {
    const nav = await renderSidebar();
    const childRow = folderRow(nav, childFolder.folderId);
    const parentRow = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    // The drag payload is unreadable during dragover (protected mode), so the
    // sidebar records the ids at dragstart; replay that here.
    await act(async () => {
      dispatchDragEvent(childRow, "dragstart", transfer);
    });

    await act(async () => {
      // Its current parent, and its own row.
      dispatchDragEvent(parentRow, "dragenter", transfer);
      dispatchDragEvent(parentRow, "dragover", transfer);
      dispatchDragEvent(childRow, "dragenter", transfer);
      dispatchDragEvent(childRow, "dragover", transfer);
    });

    expect(parentRow.classList.contains("is-drop-target")).toBe(false);
    expect(childRow.classList.contains("is-drop-target")).toBe(false);
  });

  // Serpent-374266 — the counterpart: a real reparent still highlights.
  it("still highlights a folder target that would change the parent", async () => {
    const nav = await renderSidebar();
    const childRow = folderRow(nav, childFolder.folderId);
    const siblingRow = folderRow(nav, siblingFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(childRow, "dragstart", transfer);
      dispatchDragEvent(siblingRow, "dragenter", transfer);
      dispatchDragEvent(siblingRow, "dragover", transfer);
    });

    expect(siblingRow.classList.contains("is-drop-target")).toBe(true);
  });

  // Serpent-374266 — folders that already live at the root have nowhere to go.
  it("does not highlight the blank area for folders already at the root", async () => {
    const nav = await renderSidebar();
    const parentRow = folderRow(nav, parentFolder.folderId);
    const list = folderList(nav);
    const transfer = createFolderDragTransfer([parentFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(parentRow, "dragstart", transfer);
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });

    expect(list.classList.contains("is-root-drop-target")).toBe(false);
  });

  // Serpent-b29bc4 — one more time: no folder drag, no root move.
  it("moves nothing when a folder is dropped outside the folder section", async () => {    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    // The pane itself (outside the folder list) is not a drop target.
    const outside = nav;
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(outside, "dragenter", transfer);
      dispatchDragEvent(outside, "dragover", transfer);
      dispatchDropEvent(outside, transfer);
    });

    expect(onFoldersDroppedOnFolder).not.toHaveBeenCalled();
  });

  // Serpent-b29bc4 — blank space must not become a new asset/file target.
  it("leaves asset and native-file drags over the blank area untouched", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const onExternalDrop = vi.fn();
    const nav = await renderSidebar({
      onFoldersDroppedOnFolder,
      onExternalDrop,
    });
    const list = folderList(nav);
    const assetTransfer = {
      ...createDragTransfer(["application/x-keel-managed-assets"]),
      getData: () => JSON.stringify(["asset-1"]),
    } as unknown as DataTransfer;
    const fileTransfer = {
      ...createDragTransfer(["Files"]),
      files: [new File(["asset"], "asset.png")],
    } as unknown as DataTransfer;

    let assetDragOver: Event | undefined;
    let fileDrop: Event | undefined;
    await act(async () => {
      assetDragOver = dispatchDragEvent(list, "dragover", assetTransfer);
      fileDrop = dispatchDropEvent(list, fileTransfer);
    });

    expect(assetDragOver?.defaultPrevented).toBe(false);
    expect(fileDrop?.defaultPrevented).toBe(false);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);
    expect(onFoldersDroppedOnFolder).not.toHaveBeenCalled();
    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it("filters the folder tree from the heading search and keeps ancestors", async () => {
    const nav = await renderSidebar();
    // Folder search lives permanently in the section heading row.
    const input = nav.querySelector<HTMLInputElement>(
      '.nav-section-heading input[aria-label="搜索文件夹"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Child");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(nav.querySelector("[data-nav-folder-id='folder-child']")).not.toBeNull();
    expect(nav.querySelector("[data-nav-folder-id='folder-parent']")).not.toBeNull();
    expect(nav.querySelector("[data-nav-folder-id='folder-sibling']")).toBeNull();
  });
  it("inserts a folder beside a row in another parent (custom order)", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const draggedRow = folderRow(nav, childFolder.folderId);
    const targetRow = folderRow(nav, siblingFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);
    setRowRect(targetRow);

    await act(async () => {
      dispatchDragEvent(draggedRow, "dragstart", transfer);
      dispatchDragEvent(targetRow, "dragenter", transfer, 101);
      dispatchDragEvent(targetRow, "dragover", transfer, 101);
    });

    expect(
      targetRow.closest(".nav-tree-row")?.getAttribute("data-insert-edge"),
    ).toBe("before");

    await act(async () => {
      dispatchDropEvent(targetRow, transfer);
    });

    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(
      null,
      [childFolder.folderId],
      { blockingUi: false },
    );
  });

  it("aligns the insertion line with a nested folder row", async () => {
    const nav = await renderSidebar();
    const draggedRow = folderRow(nav, siblingFolder.folderId);
    const targetRow = folderRow(nav, childFolder.folderId);
    const transfer = createFolderDragTransfer([siblingFolder.folderId]);
    setRowRect(targetRow);

    await act(async () => {
      dispatchDragEvent(draggedRow, "dragstart", transfer);
      dispatchDragEvent(targetRow, "dragover", transfer, 101);
    });

    const line = targetRow
      .closest(".nav-tree-row")
      ?.querySelector<HTMLElement>(".nav-folder-insert-line");
    expect(line).not.toBeNull();
    // depth 1: 14px indent + 16px disclosure + 2px gap.
    expect(line?.style.left).toBe("32px");
  });

});
