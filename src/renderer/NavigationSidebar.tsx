import { useBrowseField } from "./stores/browse-store";
import { dialogsFields } from "./stores/dialogs-store";
import { useNavigationField } from "./stores/navigation-store";
import { useQueryField } from "./stores/query-store";
import { useSelectionField } from "./stores/selection-store";
import { useSessionField } from "./stores/session-store";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon, type IconName } from "./Icons";
import { AppearanceGlyph } from "./AppearanceGlyph";
import type { EntityAppearance } from "../shared/entity-appearance";
import { IconActionButton } from "./icon-action-button";
import {
  linkedFolderHoverDetail,
  linkedFolderNavAffordance,
} from "./availability-affordance";
import { useT } from "./i18n";
import { isImeKeyboardEvent, shouldHoldDismissForIme } from "./workbench/overlay/ime-safe-dismiss";
import type {
  LinkedFolderSummary,
} from "../shared/asset-types";
import type { ContextMenuDescriptor } from "./workbench/menu/context-menu";
import {
  parseManagedAssetDrag,
  resolveDragDropMode,
  resolveInternalAssetDropIds,
  resolveManagedDropEffect,
  supportsManagedAssetDrag,
  type DragDropMode,
} from "./asset-drag-drop";
import {
  MANAGED_FOLDERS_DRAG_TYPE,
  canMoveFoldersToParent,
  parseManagedFolderDrag,
  resolveDraggedFolderIds,
  resolveFolderOntoFolderDrop,
  supportsManagedFolderDrag,
  type FolderDragFact,
} from "./workbench/tree/folder-drag-drop";
import {
  externalImportPayload,
  shouldConsumeManagedAssetDrop,
  supportsExternalImportTransfer,
} from "./external-import-transfer";
import {
  inlineCreateRowIndex,
  inlineFolderEditDepth,
  type InlineFolderEditState,
} from "./inline-folder-edit";
import {
  isToggleSelectionModifier,
  resolveSelectionPlatform,
} from "./workbench/selection/selection-modifiers";
import { isLibraryRootFolderId } from "../shared/library-root-folder";
import {
  buildUnifiedDirectoryNavEntries,
  hideOfflineLinkedDirectoryEntries,
  filterCollapsedDirectoryEntries,
  filterDirectoryEntriesByName,
  folderIdsInSubtree,
  managedFolderIdsWithChildren,
  sortManagedTreeEntries,
  withFolderSubtreeCollapsed,
  type FolderTreeSortMode,
} from "./unified-directory-nav";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
  ROVING_OPTION_SELECTOR,
} from "./workbench/overlay/roving-list-keyboard";
import {
  isAllAssetsNavActive,
  isManagedFolderNavActive,
  isPluginSidebarViewNavActive,
  isRootFolderNavActive,
  isTagManagementNavActive,
  isTrashNavActive,
} from "./browse-nav-active";
import {
  loadNavTreePreferences,
  saveNavTreePreferences,
  withCollapsedFolderIds,
  type NavTreePreferences,
} from "./nav-tree-preferences";
import {
  loadFolderSortPreferences,
  saveFolderSortPreferences,
  withFolderSort,
  type FolderSortOrder,
  type FolderSortPreferences,
} from "./folder-sort-preferences";
import { PortaledPopover } from "./workbench/overlay/PortaledPopover";
import { PaneSurface } from "./workbench/ui/surfaces";
import {
  applyFolderSiblingOrder,
  insertBesideSibling,
  loadFolderCustomOrder,
  saveFolderCustomOrder,
  type FolderDropEdge,
} from "./folder-custom-order";

// ---------------------------------------------------------------------------
// NavRow — local presentational row
// ---------------------------------------------------------------------------

function NavRow({
  icon,
  appearance,
  linkedBadge,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop,
  onDragEnter,
  onDragLeave,
  dropActive,
  depth = 0,
  disabled,
  draggable,
  onDragStart,
  iconColor,
  title,
  disclosure,
  navFolderId,
  navFolderKind,
  multiSelected,
  insertEdge,
}: {
  icon: IconName;
  appearance?: EntityAppearance | null;
  linkedBadge?: "link" | "link-off" | null;
  label: string;
  count?: ReactNode;
  active?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnter?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLButtonElement>) => void;
  /** REQ-DND-001/002: asset-drag hover affordance (is-drop-target class). */
  dropActive?: boolean;
  depth?: number;
  disabled?: boolean;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  iconColor?: string;
  title?: string;
  /** CU-D2: optional disclosure control rendered beside the row. */
  disclosure?: ReactNode;
  /** Serpent-vf8x: focus target for folder keyboard shortcuts. */
  navFolderId?: string;
  navFolderKind?: "managed" | "linked";
  /** Serpent-d7acfa: row participates in the sidebar multi-folder selection. */
  multiSelected?: boolean;
  /** Custom-order drop insertion edge (Keel: folder 自定义 sort). */
  insertEdge?: FolderDropEdge | null;
}) {
  // CU-D9: always expose the full label on hover; when a status title is also
  // provided (e.g. offline linked folder), append it after the name.
  const hoverTitle =
    title && title !== label ? `${label} — ${title}` : label;
  return (
    <div
      className="nav-tree-row"
      data-insert-edge={insertEdge ?? undefined}
      style={{ paddingLeft: depth * 14 }}
    >
      {insertEdge ? (
        <span
          aria-hidden="true"
          className="nav-folder-insert-line"
          // Start where the row button starts (after the disclosure column),
          // so the line spans the folder row instead of the indentation gutter.
          style={{ left: depth * 14 + 18 }}
        />
      ) : null}
      {disclosure ?? <span className="nav-disclosure-spacer" aria-hidden="true" />}
      <button
        className={`nav-row${active ? " is-active" : ""}${multiSelected ? " is-multi-selected" : ""}${dropActive ? " is-drop-target" : ""}`}
        data-nav-folder-id={navFolderId}
        data-nav-folder-kind={navFolderKind}
        disabled={disabled}
        draggable={draggable}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        style={{ paddingLeft: 7 }}
        data-hover-tip={hoverTitle}
        type="button"
      >
        <AppearanceGlyph
          appearance={appearance}
          color={iconColor}
          fallback={icon}
          linkedBadge={linkedBadge}
          size={15}
        />
        <span className="nav-row-label">{label}</span>
        {count !== undefined && (
          <span aria-hidden="true" className="nav-count">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineFolderEditRow — REQ-FOLDER-007 in-tree name edit row
// ---------------------------------------------------------------------------

/**
 * The single editing surface for 新建子文件夹 / 重命名… / 侧栏「+」: a folder
 * row whose label is an input. Enter commits, Escape cancels, and blur routes
 * through the same commit resolution (valid non-empty names submit, anything
 * else cancels); typed worker failures render inline under the row and keep
 * it open for correction. While the input is focused the global shortcut
 * handlers stay inert because they all bail out on editable targets.
 */
function InlineFolderEditRow({
  depth,
  state,
  onChange,
  onCommit,
  onCancel,
}: {
  depth: number;
  state: InlineFolderEditState;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const commitOnce = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    onCommit();
    // Keep the guard through the pointerdown → blur sequence. The parent owns
    // the actual async state transition and will unmount this row when done.
    window.setTimeout(() => {
      committingRef.current = false;
    }, 0);
  }, [onCommit]);

  // Both create and rename start replacement-ready, matching native file
  // manager behavior for directory names.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [state.kind]);

  // A blank area is not focusable, so Chromium does not always blur the input
  // when the user clicks there. Commit on the same outside interaction that
  // would normally cause blur, keeping Enter/Escape as the explicit keyboard
  // alternatives.
  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && !input.contains(event.target as Node | null)) commitOnce();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [commitOnce]);

  return (
    <div className="nav-tree-row" style={{ paddingLeft: depth * 14 }}>
      <span className="nav-disclosure-spacer" aria-hidden="true" />
      <div className="nav-inline-edit" style={{ paddingLeft: 7 }}>
      <Icon name="folder" size={15} />
      <input
        aria-invalid={state.error ? true : undefined}
        aria-label={
          state.kind === "create"
            ? t("nav.newFolderName")
            : t("nav.folderRename")
        }
        className="text-field"
        maxLength={80}
        onBlur={(event) => {
          if (shouldHoldDismissForIme({ focusEvent: event })) return;
          commitOnce();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeKeyboardEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commitOnce();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        ref={inputRef}
        value={state.value}
      />
      {state.error ? (
        <p className="nav-inline-edit-error" role="alert">
          {state.error}
        </p>
      ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  actionLabel,
  toggleAction,
  toggleActive,
  toggleLabel,
  secondaryAction,
  secondaryLabel,
  secondaryActionClassName,
  onSecondaryActionMouseEnter,
  onSecondaryActionMouseLeave,
  extraAction,
  search,
  children,
}: {
  title: string;
  action?: () => void;
  /** Explicit primary tooltip; defaults to nav.addSection. */
  actionLabel?: string;
  toggleAction?: () => void;
  toggleActive?: boolean;
  toggleLabel?: string;
  secondaryAction?: () => void;
  secondaryLabel?: string;
  /** Overrides the secondary action button class (feature hints). */
  secondaryActionClassName?: string;
  onSecondaryActionMouseEnter?: () => void;
  onSecondaryActionMouseLeave?: () => void;
  /** Extra leading action node rendered first in the heading action group. */
  extraAction?: ReactNode;
  /** Search control sitting immediately to the right of the section title. */
  search?: {
    open: boolean;
    alwaysVisible?: boolean;
    query: string;
    label: string;
    placeholder: string;
    onToggle: () => void;
    onQueryChange: (value: string) => void;
    onClose: () => void;
  };
  children: ReactNode;
}) {
  const t = useT();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const primaryLabel = actionLabel ?? t("nav.addSection", { title });
  const linkLabel = secondaryLabel ?? t("nav.secondaryAction", { title });
  useEffect(() => {
    if (!search?.open || search.alwaysVisible) return;
    searchInputRef.current?.focus();
  }, [search?.open, search?.alwaysVisible]);
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span className="nav-section-title-row">
          <span>{title}</span>
          {search?.alwaysVisible ? (
            <label className="sidebar-heading-search">
              <Icon name="search" size={13} />
              <input aria-label={search.label} placeholder={search.placeholder} ref={searchInputRef} value={search.query} onChange={(event) => search.onQueryChange(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Escape' && !shouldHoldDismissForIme({ composing: event.nativeEvent.isComposing, keyEvent: event })) {
                  event.preventDefault(); event.stopPropagation(); search.onClose();
                }
              }} />
            </label>
          ) : search ? (
            <IconActionButton
              className={search.open ? "tiny-action is-active" : "tiny-action"}
              icon="search"
              label={search.label}
              onClick={search.onToggle}
            />
          ) : null}
        </span>
        {(action || secondaryAction || toggleAction || extraAction) && (
          <span className="nav-section-actions">
            {extraAction}
            {toggleAction && (
              <IconActionButton
                icon={toggleActive ? "eye" : "eye-off"}
                label={toggleLabel ?? t("nav.showIgnored")}
                onClick={toggleAction}
              />
            )}
            {action && (
              <IconActionButton
                icon="plus"
                label={primaryLabel}
                onClick={action}
              />
            )}
            {secondaryAction && (
              <IconActionButton
                icon="link"
                label={linkLabel}
                onClick={secondaryAction}
                className={secondaryActionClassName ?? "tiny-action"}
                onMouseEnter={onSecondaryActionMouseEnter}
                onMouseLeave={onSecondaryActionMouseLeave}
              />
            )}
          </span>
        )}
      </div>
      {search && !search.alwaysVisible ? (
        <div
          className={`nav-section-search-slot${search.open ? " is-open" : ""}`}
          aria-hidden={search.open ? undefined : true}
        >
          <div className="nav-section-search-clip">
            <input
              aria-label={search.label}
              className="nav-section-search"
              onChange={(event) => search.onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                if (
                  shouldHoldDismissForIme({
                    composing: event.nativeEvent.isComposing,
                    keyEvent: event,
                  })
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                search.onClose();
              }}
              placeholder={search.placeholder}
              ref={searchInputRef}
              tabIndex={search.open ? 0 : -1}
              value={search.query}
            />
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SidebarSortTrigger — shared folder tree sort control
// Mirrors the browse sort panel (SortModeControl): a direction radio group
// plus a field list, so adding a new field is one array entry, never an N-way
// option explosion.
// ---------------------------------------------------------------------------

const FOLDER_SORT_ROVING_SELECTOR = `${ROVING_OPTION_SELECTOR}, [role="radio"]`;

const FOLDER_SORT_FIELDS: readonly {
  mode: FolderTreeSortMode;
  labelKey: string;
}[] = [
  { mode: "name", labelKey: "nav.sortByName" },
  { mode: "created", labelKey: "nav.sortByCreated" },
  { mode: "count", labelKey: "nav.sortByCount" },
  { mode: "custom", labelKey: "nav.sortByCustom" },
];

const FOLDER_SORT_ORDERS: readonly FolderSortOrder[] = ["asc", "desc"];

function folderSortOrderLabel(
  order: FolderSortOrder,
  t: ReturnType<typeof useT>,
): string {
  return order === "asc" ? t("nav.sortAsc") : t("nav.sortDesc");
}

function SidebarSortTrigger({
  mode,
  order,
  labelKey,
  fields = FOLDER_SORT_FIELDS,
  onChange,
}: {
  mode: FolderTreeSortMode;
  order: FolderSortOrder;
  labelKey: string;
  fields?: readonly {
    mode: FolderTreeSortMode;
    labelKey: string;
  }[];
  onChange: (mode: FolderTreeSortMode, order: FolderSortOrder) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const listId = useId();
  // "自定义" is the default order; custom ignores the asc/desc switch.
  const nonDefault = mode !== "custom";

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      // PortaledPopover is not a DOM child of the anchor, so clicks inside
      // the open list must not count as outside. Mirrors SortModeControl.
      if (event.target.closest("[data-dimension-filter-popover]")) return;
      const anchor = anchorRef.current;
      if (!anchor || anchor.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    const raf = requestAnimationFrame(() => {
      const list = document.getElementById(listId);
      if (list instanceof HTMLDivElement) {
        focusFirstRovingItem(list, FOLDER_SORT_ROVING_SELECTOR);
      }
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      cancelAnimationFrame(raf);
    };
  }, [listId, open]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    const list = event.currentTarget;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: list,
      itemSelector: FOLDER_SORT_ROVING_SELECTOR,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "escape") {
      setOpen(false);
    } else {
      setKeyboardNav(true);
    }
  }

  function pickField(next: FolderTreeSortMode) {
    onChange(next, order);
    setOpen(false);
  }

  function pickOrder(next: FolderSortOrder) {
    onChange(mode, next);
    setOpen(false);
  }

  return (
    <span className="nav-section-sort" ref={anchorRef}>
      <IconActionButton
        icon={order === "asc" ? "sort-asc" : "sort-desc"}
        label={t(labelKey)}
        onClick={() => setOpen((current) => !current)}
        className={`tiny-action${open || nonDefault ? " is-active" : ""}`}
      />
      {open && (
        <PortaledPopover
          anchorRef={anchorRef}
          className={`dimension-filter-popover sort-mode-popover${keyboardNav ? " is-keyboard-navigation" : ""}`}
          id={listId}
          onKeyDown={onListKeyDown}
          onPointerMove={() => setKeyboardNav(false)}
          role="dialog"
        >
          {mode !== "custom" && (
          <div
            aria-label={t("nav.sortDirection")}
            className="sort-mode-order-group"
            role="radiogroup"
          >
            <div className="sort-mode-section-label">
              {t("nav.sortDirection")}
            </div>
            {FOLDER_SORT_ORDERS.map((nextOrder) => (
              <button
                aria-checked={order === nextOrder}
                className={`sort-mode-option sort-mode-order-option${order === nextOrder ? " is-active" : ""}`}
                key={nextOrder}
                onClick={() => pickOrder(nextOrder)}
                role="radio"
                tabIndex={-1}
                type="button"
              >
                <Icon
                  name={nextOrder === "asc" ? "sort-asc" : "sort-desc"}
                  size={14}
                />
                <span>{folderSortOrderLabel(nextOrder, t)}</span>
              </button>
            ))}
          </div>
          )}
          <div
            aria-label={t("nav.sortBy")}
            className="sort-mode-field-list"
            role="listbox"
          >
            <div className="sort-mode-section-label">{t("nav.sortBy")}</div>
            {fields.map((field) => (
              <button
                aria-selected={mode === field.mode}
                className={`sort-mode-option${mode === field.mode ? " is-active" : ""}`}
                key={field.mode}
                onClick={() => pickField(field.mode)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {t(field.labelKey)}
              </button>
            ))}
          </div>
        </PortaledPopover>
      )}
    </span>
  );
}

export type FolderTreeExpandActions = {
  collapseSubtree: (folderId: string) => void;
  expandSubtree: (folderId: string) => void;
};

// ---------------------------------------------------------------------------
// NavigationSidebar — props
// ---------------------------------------------------------------------------

export interface NavigationSidebarProps {
  tagTree?: ReactNode;
  automaticTasks?: ReactNode;

  pluginSidebarViews?: readonly { id: string; title: string }[];
  onToggleShowIgnoredItems: () => void;
  revealTarget?: {
    kind: "folder";
    id: string;
    requestId: number;
  } | null;

  /**
   * Set while a discovery filter is active. Counts render as filtered/total.
   * Missing folder ids count as zero matches.
   */
  filteredFolderCounts?: {
    all: number;
    root: number;
    byFolderId: ReadonlyMap<string, number>;
  } | null;

  // --- Navigation callbacks ---
  onChooseAllAssets: () => void;
  onEnterTrash: () => void;
  onTrashContextMenu?: (event: React.MouseEvent) => void;
  onEnterTagManagement: () => void;
  onChoosePluginSidebarView?: (viewId: string) => void;
  onChooseFolder: (folderId: string) => void;

  // --- External drag/drop ---
  onExternalDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onExternalDrop: (
    event: React.DragEvent<HTMLElement>,
    targetFolderId: string | null | undefined,
  ) => void;
  /** Renderer-only fallback for a native drag whose custom payload was lost. */
  getManagedAssetDragIds?: () => readonly string[] | null;
  /**
   * Serpent-374266: dragged managed-folder ids from the browse canvas (sidebar
   * rows record their own). Used to decide whether a folder drop target would
   * actually change anything; the HTML5 payload cannot be read during dragover.
   */
  getManagedFolderDragIds?: () => readonly string[] | null;
  /**
   * Serpent-316493 follow-up: right-click on the folder panel's blank area,
   * i.e. on the library root.
   */
  onOpenRootFolderContextMenu?: (position: { x: number; y: number }) => void;
  folderTreeActionsRef?: MutableRefObject<FolderTreeExpandActions | null>;
  /** Resolve an Electron native file drop back to managed asset ids. */
  onResolveManagedAssetDrop?: (files: File[]) => Promise<string[]>;
  /** True only while Keel is completing a drag it started from an asset card. */
  isInternalAssetDrag?: () => boolean;

  // --- Internal asset drag/drop (REQ-DND-001/002 + Serpent-aa3 copy mode) ---
  onAssetsDroppedOnFolder: (
    folderId: string | null,
    assetIds: string[],
    mode: DragDropMode,
  ) => void;
  onFoldersDroppedOnFolder: (
    targetFolderId: string | null,
    folderIds: string[],
    options?: { blockingUi?: boolean },
  ) => void;
  /**
   * Serpent-d7acfa：Ctrl/⌘+点击侧栏文件夹行时切换它是否加入多选（不导航）。
   */
  onToggleFolderSelection: (folderId: string) => void;
  onAssetsDroppedOnTrash: (assetIds: string[]) => void;
  onFoldersDroppedOnTrash: (folderIds: string[]) => void;
  /** Mid-drag Option/Alt flips; used to update the drag-preview "+" badge. */
  onManagedAssetCopyModeChange?: (copyMode: boolean) => void;

  // --- Linked folder actions ---
  onImportFolderAsLinked: () => void;
  /** Serpent-b8a853: pulse the sidebar "导入链接文件夹" entry as a feature hint. */
  linkedFolderHintActive?: boolean;
  onLinkedFolderHintHover?: () => void;
  onLinkedFolderHintHoverEnd?: () => void;
  onRelinkFolder: (folderId: string) => void;

  // --- Folder creation entry (sidebar 「+」; opens the inline edit row) ---
  onAddFolder: () => void;

  // --- Inline folder edit (REQ-FOLDER-007) ---
  inlineFolderEdit: InlineFolderEditState | null;
  onInlineFolderEditChange: (value: string) => void;
  onInlineFolderEditCommit: (
    onCreateSuccess?: (
      folderId: string,
      parentFolderId: string | null,
    ) => void,
  ) => void;
  onInlineFolderEditCancel: () => void;

  // --- Context menu ---
  onOpenContextMenu: (
    descriptor: ContextMenuDescriptor,
    position: { x: number; y: number },
  ) => void;

  onImportDroppedFiles: (
    files: File[],
    targetFolderId: string | null | undefined,
    webPayload?: { html: string; uriList: string },
  ) => void;

  // --- Managed-to-linked copy ---
  onCopyManagedToLinked: (
    folder: LinkedFolderSummary,
    assetIds: string[],
  ) => void;
}

// ---------------------------------------------------------------------------
// NavigationSidebar — component
// ---------------------------------------------------------------------------

/** Serpent-d7acfa：侧栏多选与画布选择共用同一套平台修饰键（mac ⌘ / Windows Ctrl）。 */
const SIDEBAR_SELECTION_PLATFORM = resolveSelectionPlatform(
  typeof navigator === "undefined" ? "" : navigator.userAgent,
);

function isFolderMultiSelectClick(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): boolean {
  return isToggleSelectionModifier(event, SIDEBAR_SELECTION_PLATFORM);
}

export function NavigationSidebar(props: NavigationSidebarProps) {
  const t = useT();
  const {
    pluginSidebarViews = [],
    onToggleShowIgnoredItems,
    revealTarget = null,
    filteredFolderCounts = null,
    onChooseAllAssets,
    onEnterTrash,
    onTrashContextMenu,
    onEnterTagManagement,
    onChoosePluginSidebarView,
    onChooseFolder,
    onExternalDragOver,
    onExternalDrop,
    getManagedAssetDragIds,
    getManagedFolderDragIds,
    onOpenRootFolderContextMenu,
    folderTreeActionsRef,
    onResolveManagedAssetDrop,
    isInternalAssetDrag,
    onAssetsDroppedOnFolder,
    onFoldersDroppedOnFolder,
    onToggleFolderSelection,
    onAssetsDroppedOnTrash,
    onFoldersDroppedOnTrash,
    onManagedAssetCopyModeChange,
    onImportFolderAsLinked,
    linkedFolderHintActive,
    onLinkedFolderHintHover,
    onLinkedFolderHintHoverEnd,
    onRelinkFolder,
    onAddFolder,
    inlineFolderEdit,
    onInlineFolderEditChange,
    onInlineFolderEditCommit,
    onInlineFolderEditCancel,
    onOpenContextMenu,
    onImportDroppedFiles,
    onCopyManagedToLinked,
  } = props;
  const [library] = useSessionField("library");
  const [assetScope] = useNavigationField("assetScope");
  const [showTrash] = useNavigationField("showTrash");
  const [showTagManagement] = useNavigationField("showTagManagement");
  const [activePluginSidebarViewId] = useNavigationField("activePluginSidebarViewId");
  const [activeTagId] = useNavigationField("activeTagId");
  const [showIgnoredItems] = useQueryField("showIgnoredItems");
  const [showMissingLinkedFiles] = useQueryField("showMissingLinkedFiles");
  const [allAssetCount] = useBrowseField("allAssetCount");
  const [rootAssetCount] = useBrowseField("rootAssetCount");
  const [trashedAssetCount] = useBrowseField("trashedAssetCount");
  const [folders] = useNavigationField("folders");
  const [linkedFolders] = useNavigationField("linkedFolders");
  const [selectedFolderIds] = useSelectionField("selectedFolderIds");
  const onConvertLinkedDialog = dialogsFields.setterFor("convertLinkedDialog");

  const browseNavFlags = {
    assetScope,
    showTrash,
    showTagManagement,
    activePluginSidebarViewId,
    activeTagId,
  };

  // REQ-DND-001/002: which row is the current asset-drag hover target.
  // Cleared on leave/drop, and defensively on window dragend/drop so a drop
  // outside any row never leaves a stale highlight.
  const [assetDropTarget, setAssetDropTarget] = useState<string | null>(null);
  // Serpent-b29bc4: a managed-folder drag hovering the folder section's blank
  // area (indentation gutter / space below the last row) targets the root.
  const [folderListDropActive, setFolderListDropActive] = useState(false);
  // Serpent-374266: ids of the folder drag started from this sidebar. The HTML5
  // payload is unreadable during dragover, so the drop-target validity check
  // needs its own copy (cleared on every dragend/drop).
  const draggedFolderIdsRef = useRef<string[] | null>(null);
  const folderDragFacts = useMemo<FolderDragFact[]>(
    () =>
      folders.map((folder) => ({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
      })),
    [folders],
  );
  const [navTreePrefs, setNavTreePrefs] = useState<NavTreePreferences>(() =>
    loadNavTreePreferences(),
  );
  const handledRevealRequestRef = useRef<number | null>(null);
  const [folderSortPrefs, setFolderSortPrefs] = useState<FolderSortPreferences>(
    () => loadFolderSortPreferences(),
  );
  // Keel folder custom order: device-local, keyed by library id (the sort
  // mode itself is device-local too).
  const [folderCustomOrder, setFolderCustomOrder] = useState<
    ReadonlyMap<string, number>
  >(() => loadFolderCustomOrder(library?.libraryId));
  const loadedCustomOrderLibraryRef = useRef<string | null>(null);
  useEffect(() => {
    const libraryId = library?.libraryId ?? null;
    if (loadedCustomOrderLibraryRef.current === libraryId) return;
    loadedCustomOrderLibraryRef.current = libraryId;
    setFolderCustomOrder(loadFolderCustomOrder(libraryId));
  }, [library?.libraryId]);
  const [folderSearchOpen, setFolderSearchOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");
  function changeFolderSort(mode: FolderTreeSortMode, order: FolderSortOrder) {
    const next = withFolderSort(folderSortPrefs, { mode, order });
    setFolderSortPrefs(next);
    saveFolderSortPreferences(next);
  }
  function toggleFolderSearch() {
    setFolderSearchOpen((open) => {
      if (open) setFolderSearchQuery("");
      return !open;
    });
  }
  function closeFolderSearch() {
    setFolderSearchOpen(false);
    setFolderSearchQuery("");
  }
  useEffect(() => {
    if (!assetDropTarget && !folderListDropActive) return;
    const clear = () => {
      setAssetDropTarget(null);
      setFolderListDropActive(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [assetDropTarget, folderListDropActive]);

  // Serpent-374266: the folder-drag snapshot must not outlive its gesture, even
  // when the drag ends without ever highlighting a target (e.g. dropped back on
  // its own row).
  useEffect(() => {
    const clearDraggedFolders = () => {
      draggedFolderIdsRef.current = null;
    };
    window.addEventListener("dragend", clearDraggedFolders);
    window.addEventListener("drop", clearDraggedFolders);
    return () => {
      window.removeEventListener("dragend", clearDraggedFolders);
      window.removeEventListener("drop", clearDraggedFolders);
    };
  }, []);

  const persistedCollapsedFolderIds = useMemo(
    () => new Set(navTreePrefs.collapsedFolderIds),
    [navTreePrefs.collapsedFolderIds],
  );
  // Creating under a collapsed parent must reveal the inline create row. Keep
  // this as derived view state: opening or cancelling an editor must not
  // mutate the user's persisted navigation preference.
  const collapsedFolderIds = useMemo(() => {
    if (inlineFolderEdit?.kind !== "create" || !inlineFolderEdit.parentFolderId) {
      return persistedCollapsedFolderIds;
    }
    const next = new Set(persistedCollapsedFolderIds);
    next.delete(inlineFolderEdit.parentFolderId);
    return next;
  }, [persistedCollapsedFolderIds, inlineFolderEdit]);

  function toggleFolderCollapsed(folderId: string) {
    const nextIds = persistedCollapsedFolderIds.has(folderId)
      ? navTreePrefs.collapsedFolderIds.filter((id) => id !== folderId)
      : [...navTreePrefs.collapsedFolderIds, folderId];
    const next = withCollapsedFolderIds(navTreePrefs, nextIds);
    setNavTreePrefs(next);
    saveNavTreePreferences(next);
  }

  const unifiedDirectoryEntries = useMemo(() => {
    const entries = buildUnifiedDirectoryNavEntries(folders, linkedFolders);
    return showMissingLinkedFiles
      ? entries
      : hideOfflineLinkedDirectoryEntries(entries);
  }, [folders, linkedFolders, showMissingLinkedFiles]);
  const sortedDirectoryEntries = useMemo(() => sortManagedTreeEntries(
    unifiedDirectoryEntries,
    folderSortPrefs.mode,
    folderSortPrefs.order,
    folderCustomOrder,
  ), [unifiedDirectoryEntries, folderSortPrefs.mode, folderSortPrefs.order, folderCustomOrder]);
  function applyFolderSubtree(folderId: string, collapse: boolean) {
    const rootId = isLibraryRootFolderId(folderId) || folderId === "root"
      ? null
      : folderId;
    const subtree = folderIdsInSubtree(unifiedDirectoryEntries, rootId);
    const nextIds = withFolderSubtreeCollapsed(
      navTreePrefs.collapsedFolderIds,
      subtree.length > 0 || rootId === null ? subtree : [folderId],
      collapse,
    );
    const next = withCollapsedFolderIds(navTreePrefs, nextIds);
    setNavTreePrefs(next);
    saveNavTreePreferences(next);
  }

  useLayoutEffect(() => {
    if (!folderTreeActionsRef) return;
    folderTreeActionsRef.current = {
      collapseSubtree: (folderId) => applyFolderSubtree(folderId, true),
      expandSubtree: (folderId) => applyFolderSubtree(folderId, false),
    };
  });

  useEffect(() => {
    if (!revealTarget) return;
    if (handledRevealRequestRef.current === revealTarget.requestId) return;
    const collapsed = navTreePrefs.collapsedFolderIds;
    const ancestors: string[] = [];
    const seen = new Set<string>();
    {
      const byId = new Map<string, { parentId: string | null }>();
      for (const folder of folders) {
        byId.set(folder.folderId, { parentId: folder.parentFolderId });
      }
      for (const folder of linkedFolders) {
        byId.set(folder.folderId, { parentId: folder.parentFolderId ?? null });
      }
      let cursor = byId.get(revealTarget.id);
      while (cursor?.parentId) {
        if (seen.has(cursor.parentId)) break;
        seen.add(cursor.parentId);
        ancestors.push(cursor.parentId);
        cursor = byId.get(cursor.parentId);
      }
    }
    const nextCollapsed = collapsed.filter((id) => !ancestors.includes(id));
    if (nextCollapsed.length !== collapsed.length) {
      const next = withCollapsedFolderIds(navTreePrefs, nextCollapsed);
      const frame = window.requestAnimationFrame(() => {
        setNavTreePrefs(next);
        saveNavTreePreferences(next);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const selector = `[data-nav-folder-id="${CSS.escape(revealTarget.id)}"]`;
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLButtonElement>(selector);
      if (!row) return;
      row.scrollIntoView({ block: "nearest" });
      row.focus({ preventScroll: true });
      handledRevealRequestRef.current = revealTarget.requestId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [folders, linkedFolders, navTreePrefs, revealTarget]);

  function revealCreatedFolderParent(
    _folderId: string,
    parentId: string | null,
  ) {
    if (!parentId) return;
    setNavTreePrefs((current) => {
      if (!current.collapsedFolderIds.includes(parentId)) return current;
      const next = withCollapsedFolderIds(
        current,
        current.collapsedFolderIds.filter((id) => id !== parentId),
      );
      saveNavTreePreferences(next);
      return next;
    });
  }

  function commitInlineFolderEditWithVisibleParent() {
    onInlineFolderEditCommit(revealCreatedFolderParent);
  }

  /**
   * Row wiring shared by the root row and managed folder rows: internal
   * asset drags resolve here; anything else falls through to the existing
   * external-import handlers unchanged.
   */
  function applyManagedAssetDragOver(
    event: React.DragEvent<HTMLElement>,
  ): DragDropMode | null {
    const mode = resolveDragDropMode({ altKey: event.altKey });
    const dropEffect = resolveManagedDropEffect(
      mode,
      event.dataTransfer.effectAllowed,
    );
    if (!dropEffect) return null;
    event.preventDefault();
    event.dataTransfer.dropEffect = dropEffect;
    onManagedAssetCopyModeChange?.(mode === "copy");
    return mode;
  }

  /**
   * Serpent-374266: a folder drop that would not change the tree is not a
   * target — no highlight, no accept, no drop, no notice. The dragged ids come
   * from this component's own dragstart (browse folder cards report theirs via
   * `getManagedFolderDragIds`). When neither knows, fail open so drag sources
   * the sidebar cannot see keep the existing highlight behaviour.
   *
   * The payload itself cannot be read here: HTML5 puts the drag data store in
   * protected mode during dragenter/dragover, so `getData` returns "".
   */
  const currentDraggedFolderIds = useCallback((): string[] | null => {
    return (
      draggedFolderIdsRef.current ??
      (getManagedFolderDragIds ? [...(getManagedFolderDragIds() ?? [])] : null)
    );
  }, [getManagedFolderDragIds]);

  const acceptsFolderDrop = useCallback(
    (targetFolderId: string | null): boolean => {
      const draggedIds = currentDraggedFolderIds();
      if (!draggedIds || draggedIds.length === 0) return true;
      return (
        resolveFolderOntoFolderDrop({
          targetFolderId,
          draggedFolderIds: draggedIds,
          folders: folderDragFacts,
        }).kind === "move"
      );
    },
    [currentDraggedFolderIds, folderDragFacts],
  );

  /**
   * A custom-order insertion beside a row lands the dragged folders in that
   * row's parent. Validate the destination against the real folder tree so a
   * drop never creates a cycle (folder into itself / into its descendant).
   */
  function acceptsFolderInsertBeside(targetFolderId: string): boolean {
    const draggedIds = currentDraggedFolderIds();
    if (!draggedIds || draggedIds.length === 0) return false;
    const target = sortedDirectoryEntries.find(
      (entry) => entry.folderId === targetFolderId,
    );
    if (!target) return false;
    return canMoveFoldersToParent({
      targetParentFolderId: target.parentFolderId,
      draggedFolderIds: draggedIds,
      folders: folderDragFacts,
    });
  }

  function assetFolderDropHandlers(key: string, folderId: string | null) {
    return {
      dropActive: assetDropTarget === key,
      onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          if (acceptsFolderDrop(folderId)) setAssetDropTarget(key);
          return;
        }
        if (
          supportsManagedAssetDrag(event.dataTransfer) ||
          supportsExternalImportTransfer(event.dataTransfer)
        ) setAssetDropTarget(key);
      },
      onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
        // BUG-DND-001: moving onto a row child (icon/label/count) fires
        // dragleave on the row; only a real exit clears the highlight.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setAssetDropTarget((current) => (current === key ? null : current));
      },
      onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          // Not a valid target (own row / current parent / own descendant):
          // leave the event alone so the drop is not accepted at all.
          if (!acceptsFolderDrop(folderId)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return;
        }
        if (supportsManagedAssetDrag(event.dataTransfer)) {
          applyManagedAssetDragOver(event);
          return;
        }
        if (supportsExternalImportTransfer(event.dataTransfer)) {
          setAssetDropTarget(key);
        }
        onExternalDragOver(event);
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
        const folderIds = parseManagedFolderDrag(event.dataTransfer);
        setAssetDropTarget(null);
        if (folderIds && folderIds.length > 0) {
          event.preventDefault();
          onFoldersDroppedOnFolder(folderId, folderIds);
          return;
        }
        const ids =
          parseManagedAssetDrag(event.dataTransfer) ??
          (getManagedAssetDragIds
            ? [...(getManagedAssetDragIds() ?? [])]
            : null) ??
          null;
        setAssetDropTarget(null);
        if (ids && ids.length > 0) {
          event.preventDefault();
          onAssetsDroppedOnFolder(
            folderId,
            ids,
            resolveDragDropMode({ altKey: event.altKey }),
          );
          return;
        }
        const files = Array.from(event.dataTransfer.files);
        const internalAssetDrag = isInternalAssetDrag?.() ?? false;
        if (
          files.length > 0 &&
          internalAssetDrag &&
          onResolveManagedAssetDrop
        ) {
          event.preventDefault();
          event.stopPropagation();
          const payload = externalImportPayload(event.dataTransfer);
          void onResolveManagedAssetDrop(files).then((resolvedIds) => {
            if (
              shouldConsumeManagedAssetDrop(
                internalAssetDrag,
                files.length,
                resolvedIds,
              )
            ) {
              onAssetsDroppedOnFolder(
                folderId,
                resolvedIds,
                resolveDragDropMode({ altKey: event.altKey }),
              );
              return;
            }
            void onImportDroppedFiles(payload.files, folderId, payload);
          });
          return;
        }
        onExternalDrop(event, folderId);
      },
    };
  }

  /**
   * Custom-order drop layer: in "自定义" mode the top/bottom 30% of a folder
   * row inserts before/after while the middle keeps the existing
   * move-into-folder behaviour. The insertion line is rendered from
   * `folderInsertEdge`.
   */
  function folderRowDropHandlers(key: string, folderId: string | null) {
    const base = assetFolderDropHandlers(key, folderId);
    if (folderId === null) return base;
    return {
      ...base,
      onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => {
        if (
          folderSortPrefs.mode === "custom" &&
          supportsManagedFolderDrag(event.dataTransfer)
        ) {
          // The row's top/bottom bands insert beside it; dragOver decides
          // whether this is an insertion or a move-into-folder.
          return;
        }
        base.onDragEnter?.(event);
      },
      onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
        if (
          folderSortPrefs.mode === "custom" &&
          supportsManagedFolderDrag(event.dataTransfer)
        ) {
          const edge = acceptsFolderInsertBeside(folderId)
            ? folderDropEdgeAt(event)
            : null;
          if (edge) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setAssetDropTarget(null);
            setFolderInsertEdge((current) =>
              current?.folderId === folderId && current.edge === edge
                ? current
                : { folderId, edge },
            );
            return;
          }
          setFolderInsertEdge((current) =>
            current?.folderId === folderId ? null : current,
          );
          if (acceptsFolderDrop(folderId)) setAssetDropTarget(key);
        }
        base.onDragOver?.(event);
      },
      onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
        base.onDragLeave?.(event);
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setFolderInsertEdge((current) =>
          current?.folderId === folderId ? null : current,
        );
      },
      onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
        const folderIds = parseManagedFolderDrag(event.dataTransfer);
        if (
          folderSortPrefs.mode === "custom" &&
          folderIds !== null &&
          folderIds.length > 0 &&
          folderInsertEdge?.folderId === folderId &&
          acceptsFolderInsertBeside(folderId)
        ) {
          event.preventDefault();
          setFolderInsertEdge(null);
          setAssetDropTarget(null);
          reorderFolderBeside(folderId, folderInsertEdge.edge, folderIds);
          return;
        }
        setFolderInsertEdge(null);
        base.onDrop?.(event);
      },
    };
  }

  /**
   * Serpent-6e3b10 / Serpent-b29bc4: the blank area **of the folder section** —
   * the indentation gutter left of the rows and the empty strip below the last
   * row — is a real target. Clicking it returns to the library root; dropping
   * dragged managed folders on it moves them to the root.
   *
   * Scope is the folder list only (2026-09-12 user clarification on a marked-up
   * screenshot): the sections below are not
   * blank space, and neither is the rest of the pane. A first version used the
   * whole `.navigation-scroll` and the band under the tree — which is what the
   * user actually aims at — was covered by the next section's heading and its
   * "尚无合集" paragraph, so the click was swallowed.
   *
   * "Blank" means the event does not land on a row or a control. Rows and
   * controls stay foreground so their own handlers keep working untouched, and
   * the indentation gutter counts as blank because it belongs to no row.
   */
  const NAV_FOREGROUND_SELECTOR = [
    ".nav-row",
    ".nav-disclosure",
    ".nav-inline-edit",
    "button",
    "input",
    "textarea",
    "select",
    "label",
    "a[href]",
    "[role]",
    "[tabindex]",
    "[contenteditable='true']",
  ].join(", ");

  function isFolderListBlankTarget(event: {
    target: EventTarget | null;
    currentTarget: EventTarget | null;
  }): boolean {
    if (event.target === event.currentTarget) return true;
    let node = event.target instanceof Element ? event.target : null;
    while (node && node !== event.currentTarget) {
      if (node.matches(NAV_FOREGROUND_SELECTOR)) return false;
      node = node.parentElement;
    }
    return true;
  }

  // An open inline editor owns the click that follows (blur commits it);
  // navigating at the same time would fight that commit.
  const inlineEditorOpen = inlineFolderEdit !== null;

  /** Handlers for the folder section's blank area (the indentation gutter). */
  function folderListBlankHandlers() {
    return {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        if (!library || inlineEditorOpen) return;
        if (!isFolderListBlankTarget(event)) return;
        void onChooseFolder("root");
      },
      // Serpent-316493 follow-up: the blank area *is* the library root, so its
      // context menu is the root folder menu (open in file manager, new folder,
      // import linked folder, paste, copy path).
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
        if (!library) return;
        if (!isFolderListBlankTarget(event)) return;
        event.preventDefault();
        onOpenRootFolderContextMenu?.({ x: event.clientX, y: event.clientY });
      },
      onDragEnter: (event: React.DragEvent<HTMLElement>) => {
        if (!library || !supportsManagedFolderDrag(event.dataTransfer)) return;
        if (!isFolderListBlankTarget(event)) return;
        // Serpent-374266: folders already at the root would not move anywhere.
        if (!acceptsFolderDrop(null)) return;
        setFolderListDropActive(true);
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        if (!library || !supportsManagedFolderDrag(event.dataTransfer)) return;
        if (!isFolderListBlankTarget(event) || !acceptsFolderDrop(null)) {
          // A row took over under the pointer, or the drop would change
          // nothing: drop the blank-area highlight so only a real target stays
          // highlighted.
          setFolderListDropActive(false);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setFolderListDropActive(true);
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        // Moving onto a child fires dragleave here even though the area is still
        // the drop target; a real exit (or a row taking over in dragover) is
        // what clears the highlight.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setFolderListDropActive(false);
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        if (!supportsManagedFolderDrag(event.dataTransfer)) return;
        if (!isFolderListBlankTarget(event)) return;
        setFolderListDropActive(false);
        const folderIds = parseManagedFolderDrag(event.dataTransfer);
        if (!library || !folderIds || folderIds.length === 0) return;
        event.preventDefault();
        onFoldersDroppedOnFolder(null, folderIds);
      },
    };
  }

  const [folderInsertEdge, setFolderInsertEdge] = useState<{
    folderId: string;
    edge: FolderDropEdge;
  } | null>(null);
  useEffect(() => {
    const clear = () => {
      setFolderInsertEdge(null);
    };
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
    return () => {
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear);
    };
  }, []);

  function folderDropEdgeAt(
    event: React.DragEvent<HTMLElement>,
  ): FolderDropEdge | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.3) return "before";
    if (ratio > 0.7) return "after";
    return null;
  }

  /** Reorder the dragged folder beside `targetId` and persist the sequence. */
  function reorderFolderBeside(
    targetId: string,
    edge: FolderDropEdge,
    draggedIds: readonly string[],
  ): void {
    if (!library?.libraryId || draggedIds.length === 0) return;
    const target = sortedDirectoryEntries.find(
      (entry) => entry.folderId === targetId,
    );
    if (!target) return;
    const draggedParents = draggedIds.map(
      (folderId) =>
        sortedDirectoryEntries.find((entry) => entry.folderId === folderId)
          ?.parentFolderId ?? null,
    );
    const needsMove = draggedIds.some(
      (_folderId, index) => draggedParents[index] !== target.parentFolderId,
    );
    const siblings = sortedDirectoryEntries
      .filter((entry) => entry.parentFolderId === target.parentFolderId)
      .map((entry) => entry.folderId);
    if (siblings.length === 0 && !needsMove) return;
    const nextSequence = insertBesideSibling(
      siblings,
      draggedIds,
      targetId,
      edge,
    );
    if (nextSequence.join("\u0000") === siblings.join("\u0000")) return;
    const next = applyFolderSiblingOrder(
      folderCustomOrder,
      target.parentFolderId,
      nextSequence,
    );
    setFolderCustomOrder(next);
    saveFolderCustomOrder(library.libraryId, next);
    // Cross-level drop: move first, then the stored order above places it
    // beside the target as soon as the refreshed tree arrives.
    if (needsMove) {
      onFoldersDroppedOnFolder(target.parentFolderId, [...draggedIds], {
        blockingUi: false,
      });
    }
  }

  const folderSearchActive = folderSearchQuery.trim().length > 0;
  const directoryEntries = useMemo(() => folderSearchActive
    ? filterDirectoryEntriesByName(sortedDirectoryEntries, folderSearchQuery)
    : filterCollapsedDirectoryEntries(sortedDirectoryEntries, collapsedFolderIds),
  [folderSearchActive, sortedDirectoryEntries, folderSearchQuery, collapsedFolderIds]);
  const foldersWithChildren = useMemo(
    () => managedFolderIdsWithChildren(unifiedDirectoryEntries),
    [unifiedDirectoryEntries],
  );
  function renderDirectoryEntries(): ReactNode {
    if (directoryEntries.length === 0 && inlineFolderEdit?.kind !== "create") {
      return (
        <p className="nav-empty">
          {folderSearchActive ? t("nav.searchEmpty") : t("nav.emptyManagedOrLinked")}
        </p>
      );
    }

    const rows: ReactNode[] = directoryEntries.map((entry) => {
      if (entry.kind === "managed") {
        // A rename session swaps the folder's own row for the edit row.
        if (
          inlineFolderEdit?.kind === "rename" &&
          inlineFolderEdit.folderId === entry.folderId
        ) {
          return (
            <InlineFolderEditRow
              depth={entry.depth}
              key={entry.folderId}
              onCancel={onInlineFolderEditCancel}
              onChange={onInlineFolderEditChange}
              onCommit={onInlineFolderEditCommit}
              state={inlineFolderEdit}
            />
          );
        }
        const hasChildren = foldersWithChildren.has(entry.folderId);
        const expanded = !collapsedFolderIds.has(entry.folderId);
        return (
          <NavRow
            active={isManagedFolderNavActive(browseNavFlags, entry.folderId)}
            count={filteredFolderCounts
              ? filteredFolderCounts.byFolderId.get(entry.folderId) ?? 0
              : entry.directAssetCount}
            depth={entry.depth}
            disclosure={
              hasChildren ? (
                <button
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? t("nav.collapseFolder", { name: entry.name })
                      : t("nav.expandFolder", { name: entry.name })
                  }
                  className={`nav-disclosure${expanded ? " is-expanded" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolderCollapsed(entry.folderId);
                  }}
                  type="button"
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              ) : undefined
            }
            icon="folder"
            appearance={entry.appearance}
            key={entry.folderId}
            label={entry.name}
            navFolderId={entry.folderId}
            navFolderKind="managed"
            multiSelected={selectedFolderIds.includes(entry.folderId)}
            insertEdge={
              folderInsertEdge?.folderId === entry.folderId
                ? folderInsertEdge.edge
                : null
            }
            onClick={(event) => {
              // Serpent-d7acfa：侧栏树里的文件夹也能 Ctrl/⌘ 多选，复用画布卡片的
              // 同一份选择状态与同一个批量菜单入口（普通点击仍然进文件夹）。
              if (isFolderMultiSelectClick(event)) {
                onToggleFolderSelection(entry.folderId);
                return;
              }
              void onChooseFolder(entry.folderId);
            }}
            draggable
            onDragStart={(event) => {
              const ids = resolveDraggedFolderIds(
                entry.folderId,
                selectedFolderIds,
              );
              // Serpent-374266: remember the ids for drop-target validation
              // (the payload is unreadable during dragover).
              draggedFolderIdsRef.current = [...ids];
              event.dataTransfer.setData(
                MANAGED_FOLDERS_DRAG_TYPE,
                JSON.stringify(ids),
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              // Serpent-d7acfa：右键的行属于多选时，直接开批量菜单（回收站/硬盘
              // 删除/设置图标/忽略一次作用于全部选中文件夹）。
              if (
                selectedFolderIds.length > 1 &&
                selectedFolderIds.includes(entry.folderId)
              ) {
                onOpenContextMenu(
                  {
                    type: "multi-asset",
                    assetIds: [],
                    folderIds: [...selectedFolderIds],
                    count: selectedFolderIds.length,
                  },
                  { x: event.clientX, y: event.clientY },
                );
                return;
              }
              onOpenContextMenu(
                {
                  type: "folder",
                  folderId: entry.folderId,
                  name: entry.name,
                  locationKind: "managed",
                },
                { x: event.clientX, y: event.clientY },
              );
            }}
            {...folderRowDropHandlers(`folder:${entry.folderId}`, entry.folderId)}
          />
        );
      }

      const lf = linkedFolders.find(
        (folder) => folder.folderId === entry.folderId,
      );
      if (!lf) return null;
      // Linked directories are physical folders with virtual ids in the
      // library index.  Keep the same inline rename affordance as managed
      // folders instead of falling back to a dialog or hiding the action.
      if (
        inlineFolderEdit?.kind === "rename" &&
        inlineFolderEdit.folderId === entry.folderId
      ) {
        return (
          <InlineFolderEditRow
            depth={entry.depth}
            key={entry.folderId}
            onCancel={onInlineFolderEditCancel}
            onChange={onInlineFolderEditChange}
            onCommit={onInlineFolderEditCommit}
            state={inlineFolderEdit}
          />
        );
      }
      const offline = entry.status === "offline";
      const linkedAffordance = linkedFolderNavAffordance(entry.status);
      const hasChildren = foldersWithChildren.has(entry.folderId);
      const expanded = !collapsedFolderIds.has(entry.folderId);
      const linkedRootId = entry.linkedFolderId;
      const hasCustomLinkedGlyph = Boolean(entry.appearance?.glyphKind);
      return (
        <NavRow
          active={isManagedFolderNavActive(browseNavFlags, entry.folderId)}
          depth={entry.depth}
          disclosure={
            hasChildren ? (
              <button
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? t("nav.collapseFolder", { name: entry.name })
                    : t("nav.expandFolder", { name: entry.name })
                }
                className={`nav-disclosure${expanded ? " is-expanded" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolderCollapsed(entry.folderId);
                }}
                type="button"
              >
                <Icon name="chevron-right" size={12} />
              </button>
            ) : undefined
          }
          icon={hasCustomLinkedGlyph ? "folder" : linkedAffordance.icon}
          appearance={entry.appearance}
          linkedBadge={hasCustomLinkedGlyph ? (offline ? "link-off" : "link") : undefined}
          iconColor={hasCustomLinkedGlyph ? undefined : linkedAffordance.iconColor}
          key={entry.folderId}
          label={entry.name}
          navFolderId={entry.folderId}
          navFolderKind="linked"
          multiSelected={selectedFolderIds.includes(entry.folderId)}
          count={filteredFolderCounts
            ? filteredFolderCounts.byFolderId.get(entry.folderId) ?? 0
            : entry.assetCount}
          title={linkedFolderHoverDetail(
            entry.status,
            lf.absoluteRootPath,
            {
              online: t("nav.linkedFolder"),
              offline: t("nav.linkedFolderOffline"),
              pathLabel: t("nav.linkedFolderPath"),
            },
          )}
          onClick={
            offline
              ? () => void onRelinkFolder(entry.folderId)
              : (event) => {
                  // Serpent-d7acfa：链接根同样支持 Ctrl/⌘ 多选（离线时仍走重新指定）。
                  if (isFolderMultiSelectClick(event)) {
                    onToggleFolderSelection(entry.folderId);
                    return;
                  }
                  void onChooseFolder(entry.folderId);
                }
          }
          onContextMenu={(event) => {
            event.preventDefault();
            // Shift+right-click keeps the legacy convert-to-managed shortcut;
            // a plain right-click opens the shared folder menu (REQ-MENU-006),
            // which also carries the linked-rules entry.
            if (event.shiftKey && entry.relativePath === "") {
              onConvertLinkedDialog({
                folderId: linkedRootId,
                name: lf.displayName,
                targetFolderId: "",
              });
              return;
            }
            // Serpent-d7acfa：多选中的行开批量菜单（链接根也支持外观/忽略）。
            if (
              selectedFolderIds.length > 1 &&
              selectedFolderIds.includes(entry.folderId)
            ) {
              onOpenContextMenu(
                {
                  type: "multi-asset",
                  assetIds: [],
                  folderIds: [...selectedFolderIds],
                  count: selectedFolderIds.length,
                },
                { x: event.clientX, y: event.clientY },
              );
              return;
            }
            onOpenContextMenu(
              {
                type: "folder",
                folderId: linkedRootId,
                name: entry.name,
                locationKind: "linked",
                status: entry.status,
                linkedRelativePath:
                  entry.relativePath === "" ? undefined : entry.relativePath,
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          dropActive={assetDropTarget === `linked:${entry.folderId}`}
          onDragEnter={(event) => {
            if (
              supportsManagedAssetDrag(event.dataTransfer) ||
              supportsExternalImportTransfer(event.dataTransfer)
            )
              setAssetDropTarget(`linked:${entry.folderId}`);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null))
              return;
            setAssetDropTarget((current) =>
              current === `linked:${entry.folderId}` ? null : current,
            );
          }}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(
                "application/x-keel-managed-assets",
              )
            ) {
              // 与 managed 文件夹一致：普通拖=移动、Option 拖=复制
              // （Serpent-f6f779，链接文件夹不再强制复制）。
              applyManagedAssetDragOver(event);
              return;
            }
            if (supportsExternalImportTransfer(event.dataTransfer)) {
              event.preventDefault();
              setAssetDropTarget(`linked:${entry.folderId}`);
            }
          }}
          onDrop={(event) => {
            const ids = resolveInternalAssetDropIds(
              event.dataTransfer,
              getManagedAssetDragIds ? getManagedAssetDragIds() : null,
            );
            const mode = resolveDragDropMode({ altKey: event.altKey });
            if (ids) {
              event.preventDefault();
              setAssetDropTarget(null);
              if (mode === "copy") {
                // Option 拖：复制语义，managed 源保留原位。
                // `lf` retains the virtual child relativePath.  Passing the
                // root summary here silently copied into the linked root and
                // made child folders appear to accept drops without effect.
                void onCopyManagedToLinked(lf, ids);
              } else {
                // 普通拖：与 managed 文件夹一致，走 moveAssets 的链接目标
                // 分支（复制进链接目录 + 删除 managed 源），Serpent-f6f779。
                void onAssetsDroppedOnFolder(entry.folderId, ids, "move");
              }
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            const internalAssetDrag = isInternalAssetDrag?.() ?? false;
            if (
              files.length > 0 &&
              internalAssetDrag &&
              onResolveManagedAssetDrop
            ) {
              event.preventDefault();
              setAssetDropTarget(null);
              const payload = externalImportPayload(event.dataTransfer);
              void onResolveManagedAssetDrop(files).then((resolvedIds) => {
                if (
                  shouldConsumeManagedAssetDrop(
                    internalAssetDrag,
                    files.length,
                    resolvedIds,
                  )
                ) {
                  if (mode === "copy") {
                    void onCopyManagedToLinked(lf, resolvedIds);
                  } else {
                    void onAssetsDroppedOnFolder(
                      entry.folderId,
                      resolvedIds,
                      "move",
                    );
                  }
                  return;
                }
                // A native file that is not indexed yet must be imported
                // directly into the selected linked directory.  Falling
                // through to the resolver alone made Explorer/Finder drops
                // appear to do nothing because no managed asset id existed.
                void onImportDroppedFiles(payload.files, lf.folderId, payload);
              });
            } else if (files.length > 0) {
              event.preventDefault();
              setAssetDropTarget(null);
              const payload = externalImportPayload(event.dataTransfer);
              void onImportDroppedFiles(payload.files, lf.folderId, payload);
            }
          }}
        />
      );
    });

    // A create session adds a pending name-edit row as the parent's first
    // child (top of the list when creating at the library root). A collapsed
    // parent is expanded only as derived view state while the editor exists;
    // its persisted preference changes only after a successful create.
    if (inlineFolderEdit?.kind === "create") {
      rows.splice(
        inlineCreateRowIndex(directoryEntries, inlineFolderEdit.parentFolderId),
        0,
        <InlineFolderEditRow
          depth={inlineFolderEditDepth(inlineFolderEdit, directoryEntries)}
          key="inline-folder-create"
          onCancel={onInlineFolderEditCancel}
          onChange={onInlineFolderEditChange}
          onCommit={commitInlineFolderEditWithVisibleParent}
          state={inlineFolderEdit}
        />,
      );
    }
    return rows;
  }

  return (
    <PaneSurface
      className="navigation-pane"
      data-ui-surface-variant="navigation"
    >
      <nav className="navigation-scroll">
        <NavRow
          active={library ? isAllAssetsNavActive(browseNavFlags) : true}
          count={library
            ? (filteredFolderCounts
              ? filteredFolderCounts.all
              : allAssetCount)
            : undefined}
          disabled={!library}
          icon="grid"
          label={t("scope.allAssets")}
          onClick={() => void onChooseAllAssets()}
          {...(library
            ? assetFolderDropHandlers("root", null)
            : {
                onDragOver: onExternalDragOver,
                onDrop: (event: React.DragEvent<HTMLButtonElement>) =>
                  onExternalDrop(event, null),
            })}
        />
        <NavRow
          active={Boolean(library && isRootFolderNavActive(browseNavFlags))}
          count={library
            ? (filteredFolderCounts
              ? filteredFolderCounts.root
              : rootAssetCount)
            : undefined}
          disabled={!library}
          icon="folder"
          label={t("scope.rootFolder")}
          onClick={() => void onChooseFolder("root")}
          // Serpent-a6c516: the root row opens the same library-root menu as the
          // folder panel's blank area.
          onContextMenu={(event) => {
            if (!library) return;
            event.preventDefault();
            onOpenRootFolderContextMenu?.({ x: event.clientX, y: event.clientY });
          }}
          {...(library
            ? assetFolderDropHandlers("root-assets", null)
            : {
                onDragOver: onExternalDragOver,
                onDrop: (event: React.DragEvent<HTMLButtonElement>) =>
                  onExternalDrop(event, null),
              })}
        />
        <NavRow
          active={Boolean(library && isTrashNavActive(browseNavFlags))}
          count={trashedAssetCount || undefined}
          disabled={!library}
          icon="trash"
          label={t("scope.trash")}
          onClick={() => void onEnterTrash()}
          onContextMenu={(event) => {
            if (!library) return;
            event.preventDefault();
            onTrashContextMenu?.(event);
          }}
          dropActive={assetDropTarget === "trash"}
          onDragEnter={(event) => {
            if (
              supportsManagedFolderDrag(event.dataTransfer) ||
              supportsManagedAssetDrag(event.dataTransfer) ||
              supportsExternalImportTransfer(event.dataTransfer)
            )
              setAssetDropTarget("trash");
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null))
              return;
            setAssetDropTarget((current) =>
              current === "trash" ? null : current,
            );
          }}
          onDragOver={(event) => {
            if (
              supportsManagedFolderDrag(event.dataTransfer) ||
              supportsManagedAssetDrag(event.dataTransfer)
            ) {
              // Trash remains a trash action; negotiate only the browser's
              // transport effect because native file drags may not allow move.
              const effect = resolveManagedDropEffect(
                "move",
                event.dataTransfer.effectAllowed,
              );
              if (!effect) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = effect;
              onManagedAssetCopyModeChange?.(false);
            } else if (supportsExternalImportTransfer(event.dataTransfer)) {
              const internalAssetDrag = isInternalAssetDrag?.() ?? false;
              const effect = internalAssetDrag
                ? resolveManagedDropEffect(
                    "move",
                    event.dataTransfer.effectAllowed,
                  )
                : null;
              if (internalAssetDrag && !effect) return;
              // Native asset drags arrive as Files. Resolve them on drop and
              // keep the trash affordance consistent with the managed path.
              event.preventDefault();
              // Preserve the existing external-file target behavior; internal
              // asset files use a compatible OS operation while the drop
              // handler still performs trash semantics.
              if (effect) event.dataTransfer.dropEffect = effect;
              else event.dataTransfer.dropEffect = "move";
              setAssetDropTarget("trash");
              onManagedAssetCopyModeChange?.(false);
            }
          }}
          onDrop={(event) => {
            const folderIds = parseManagedFolderDrag(event.dataTransfer);
            setAssetDropTarget(null);
            if (folderIds && folderIds.length > 0) {
              event.preventDefault();
              onFoldersDroppedOnTrash(folderIds);
              return;
            }
            const ids =
              parseManagedAssetDrag(event.dataTransfer) ??
              (getManagedAssetDragIds
                ? [...(getManagedAssetDragIds() ?? [])]
                : null) ??
              null;
            setAssetDropTarget(null);
            if (ids && ids.length > 0) {
              event.preventDefault();
              onAssetsDroppedOnTrash(ids);
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            const internalAssetDrag = isInternalAssetDrag?.() ?? false;
            if (files.length > 0) {
              event.preventDefault();
              if (internalAssetDrag && onResolveManagedAssetDrop) {
                void onResolveManagedAssetDrop(files).then((resolvedIds) => {
                  if (
                    shouldConsumeManagedAssetDrop(
                      internalAssetDrag,
                      files.length,
                      resolvedIds,
                    )
                  ) {
                    onAssetsDroppedOnTrash(resolvedIds);
                  }
                });
              }
            }
          }}
        />
        <NavRow
          active={Boolean(library && isTagManagementNavActive(browseNavFlags))}
          disabled={!library}
          icon="tag"
          label={t("nav.tagManagement")}
          onClick={() => onEnterTagManagement()}
        />
        {pluginSidebarViews.map((view) => (
          <NavRow
            active={Boolean(library && isPluginSidebarViewNavActive(browseNavFlags, view.id))}
            disabled={!library}
            icon="box"
            key={view.id}
            label={view.title}
            onClick={() => onChoosePluginSidebarView?.(view.id)}
          />
        ))}
        {props.tagTree}
        <Section
          title={t("nav.folders")}
          search={
            library
              ? {
                  open: folderSearchOpen,
                  alwaysVisible: true,
                  query: folderSearchQuery,
                  label: t("nav.searchFolders"),
                  placeholder: t("nav.searchNamePlaceholder"),
                  onToggle: toggleFolderSearch,
                  onQueryChange: setFolderSearchQuery,
                  onClose: closeFolderSearch,
                }
              : undefined
          }
          action={library ? onAddFolder : undefined}
          actionLabel={t("nav.addFolder")}
          toggleAction={library ? onToggleShowIgnoredItems : undefined}
          toggleActive={showIgnoredItems}
          toggleLabel={t("nav.showIgnored")}
          secondaryAction={library ? onImportFolderAsLinked : undefined}
          secondaryLabel={t("nav.importLinkedFolder")}
          secondaryActionClassName={
            linkedFolderHintActive
              ? "tiny-action is-feature-hinting"
              : "tiny-action"
          }
          onSecondaryActionMouseEnter={onLinkedFolderHintHover}
          onSecondaryActionMouseLeave={onLinkedFolderHintHoverEnd}
          extraAction={
            library ? (
              <SidebarSortTrigger
                labelKey="nav.sortFolders"
                mode={folderSortPrefs.mode}
                order={folderSortPrefs.order}
                onChange={changeFolderSort}
              />
            ) : undefined
          }
        >
          {library ? (
            <div
              className={`nav-folder-list${folderListDropActive ? " is-root-drop-target" : ""}`}
              {...folderListBlankHandlers()}
            >
              {renderDirectoryEntries()}
            </div>
          ) : (
            <p className="nav-empty">{t("nav.openLibraryFoldersHint")}</p>
          )}
        </Section>
        {props.automaticTasks}
      </nav>
    </PaneSurface>
  );
}
