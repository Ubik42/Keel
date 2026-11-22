import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { KeelShellApi } from "../../../shared/external-url";
import type { WorkspaceRenderSnapshot } from "../../workspace/workspace-render-snapshot-cache";
import { type AssetMetadataResult } from "../../../shared/asset-types";
import { isEditableTextTarget } from "../../../shared/edit-context-menu";
import { type BrowseMembershipChange } from "../../filters/browse-filter-membership";
import { LibraryOperationError } from "../../common/error-utils";
import { FOLDER_COVER_PICKER_PAGE_SIZE, folderCoverPickerAssetMatches, folderCoverPickerImageFilter, folderCoverPickerSearchQuery } from "../../folders/folder-cover-picker";
import { addRetiredImportId, runImportRpc } from "../../import/import-progress-session";
import { type LibraryViewSessionToken } from "../../library/library-view-session";
import { type FolderTreeExpandActions } from "../../folders/NavigationSidebar";
import { isPluginSidebarViewsEnabled, usePluginSidebarViews } from "../../plugins/plugin-sidebar-views";
import { parseSearchExpressionDetailed, type parseSearchExpression } from "../../search/search-expression";
import { resolveSearchFolderResults } from "../../search/search-folder-results";
import { type BrowseState, useBrowseField } from "../../stores/browse-store";
import { dialogsFields, useDialogField } from "../../stores/dialogs-store";
import { inspectorFields, useInspectorField } from "../../stores/inspector-store";
import { type NavigationState, useNavigationField } from "../../stores/navigation-store";
import { usePluginsField } from "../../stores/plugins-store";
import { type QueryState, useQueryField } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState, useSessionField } from "../../stores/session-store";
import { transfersFields, useTransfersField } from "../../stores/transfers-store";
import { type WorkspaceState } from "../../stores/workspace-store";
import { useBrowsePagination } from "../../browse/use-browse-pagination";
import { useInspectorMultiEdit } from "../../inspector/use-inspector-multi-edit";
import { useWorkspaceTabsController } from "../../workspace/use-workspace-tabs";
import { type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { createDefaultWorkspaceTabBrowseState, type WorkspaceTabBrowseState, type WorkspaceTabSession } from "../../workspace/workspace-tabs";
import { buildWorkspaceTabsSession, readWorkspaceTabsSession, writeWorkspaceTabsSession } from "../../workspace/workspace-tabs-session";
import { type RendererWindow } from "../shared/app-shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface UseBrowseStateDeps {
  pendingLibraryCloseFencesRef: RefObject<Map<string, Set<number>>>;
  setTrashBrowseTombstoneId: Dispatch<SetStateAction<BrowseState["trashBrowseTombstoneId"]>>;
  api: KeelLibraryApi | undefined;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setBrowseLayout: Dispatch<SetStateAction<BrowseState["browseLayout"]>>;
  setVirtualBrowseLayout: Dispatch<SetStateAction<BrowseState["virtualBrowseLayout"]>>;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  setSearchSnippets: Dispatch<SetStateAction<BrowseState["searchSnippets"]>>;
  setError: (text: string | null) => void;
  t: TranslateFn;
  browseLayout: BrowseState["browseLayout"];
  virtualBrowseLayout: BrowseState["virtualBrowseLayout"];
  library: SessionState["library"];
  selectedAssetIds: SelectionState["selectedAssetIds"];
  setNotice: (text: string | null, historyEntryId?: string) => void;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  retiredImportIdsRef: RefObject<Set<string>>;
  shellApi: KeelShellApi | undefined;
  beginWorkspaceNavigation: () => () => boolean;
  captureWorkspaceTabContext: () => { viewport: WorkspaceNavViewport; selectedAssetIds: string[]; selectedAssetId: string | null; browseState: WorkspaceTabBrowseState; cachedTitle: string; renderSnapshot: WorkspaceRenderSnapshot | null; } | null;
  restoreWorkspaceTabSession: (tab: WorkspaceTabSession, isCurrent: () => boolean) => Promise<void>;
  restoreAllAssetsWorkspaceTab: (isCurrent: () => boolean) => Promise<void>;
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  searchValue: QueryState["searchValue"];
  lastValidFolderSearchQueryRef: RefObject<{ scope: string; query: ReturnType<typeof parseSearchExpression>; } | null>;
  folders: NavigationState["folders"];
  linkedFolders: NavigationState["linkedFolders"];
  setFindSimilarSource: Dispatch<SetStateAction<NavigationState["findSimilarSource"]>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
/** How long a settled close keeps fencing its late `library.closed` event. */
const LIBRARY_CLOSE_EVENT_GRACE_MS = 10_000;

export function useBrowseState({ pendingLibraryCloseFencesRef, setTrashBrowseTombstoneId, api, setAssets, setBrowseLayout, setVirtualBrowseLayout, setSearchTotal, setSearchOffset, setSearchSnippets, setError, t, browseLayout, virtualBrowseLayout, library, selectedAssetIds, setNotice, syncBrowseFilterMembershipRef, ensureLibraryView, isCurrentLibraryView, retiredImportIdsRef, shellApi, beginWorkspaceNavigation, captureWorkspaceTabContext, restoreWorkspaceTabSession, restoreAllAssetsWorkspaceTab, sortField, sortOrder, setNavHistoryUi, searchValue, lastValidFolderSearchQueryRef, folders, linkedFolders, setFindSimilarSource }: UseBrowseStateDeps) {
  const clearLibraryClosePending = useCallback(
    (libraryId: string, generation: number) => {
      // Main publishes `library.closed` on the lifecycle channel, which can
      // arrive after the close request itself has resolved — even after the
      // user switched back to that library. Keep the fence a while longer so
      // that late event is still recognised as stale and does not close the
      // reopened library.
      window.setTimeout(() => {
        const pending = pendingLibraryCloseFencesRef.current.get(libraryId);
        if (!pending) return;
        pending.delete(generation);
        if (pending.size === 0) {
          pendingLibraryCloseFencesRef.current.delete(libraryId);
        }
      }, LIBRARY_CLOSE_EVENT_GRACE_MS);
    },
    [pendingLibraryCloseFencesRef],
  );
  const reloadCurrentContentRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const loadAiContentForAssetRef = useRef<(assetId: string) => Promise<void>>(
    async () => undefined,
  );
  const refreshAfterAiRef = useRef<(assetId: string) => Promise<void>>(
    async () => undefined,
  );

  // Metadata editor
  const [assetMetadata, setAssetMetadata] = useInspectorField("assetMetadata");
  const setExtractedMetadataRefreshKey = inspectorFields.setterFor("extractedMetadataRefreshKey");
  const setVersionConflict = inspectorFields.setterFor("versionConflict");
  const metadataByAssetRef = useRef(new Map<string, AssetMetadataResult>());
  const metadataConflictAssetIdsRef = useRef(new Set<string>());
  // Pending edit values
  const [editDescription, setEditDescription] = useInspectorField("editDescription");
  const setEditRating = inspectorFields.setterFor("editRating");
  const [editFavorite, setEditFavorite] = useInspectorField("editFavorite");
  const [editSourceUrl, setEditSourceUrl] = useInspectorField("editSourceUrl");
  const [editAuthor, setEditAuthor] = useInspectorField("editAuthor");
  // REQ-SELECT-004: UE-style multi-select Inspector model (null when <2 selected).

  // Trash / Delete / Relink state
  const [showTrash, setShowTrash] = useNavigationField("showTrash");
  useEffect(() => {
    if (!showTrash) {
      queueMicrotask(() => setTrashBrowseTombstoneId(null));
    }
  }, [showTrash, setTrashBrowseTombstoneId]);
  const [showTagManagement, setShowTagManagement] = useNavigationField("showTagManagement");
  const [activePluginSidebarViewId, setActivePluginSidebarViewId] = useNavigationField("activePluginSidebarViewId");
  const [trashedAssets, setTrashedAssets] = useBrowseField("trashedAssets");
  const [trashedAssetCount, setTrashedAssetCount] = useBrowseField("trashedAssetCount");

  // Serpent-ws4k: paginated browse/search loading. First pages render
  // immediately; a scroll sentinel appends the next page; select-all/invert
  // resolve the full scope id set on demand (idsOnly).
  const browsePagination = useBrowsePagination({
    api: api ?? null,
    setAssets,
    setTrashedAssets,
    setBrowseLayout,
    setVirtualBrowseLayout,
    setSearchTotal,
    setSearchOffset,
    setSearchSnippets,
    onLoadMoreFailed: () =>
      setError(t("toast.loadMoreFailed")),
  });
  // All controller members are stable useCallback identities; destructure so
  // downstream useCallback deps do not churn every render.
  const {
    beginPage: beginBrowsePage,
    ensureVisibleRange: ensureBrowseVisibleRange,
    ensureVisibleIndices: ensureBrowseVisibleIndices,
    fetchScopeAssetIds: fetchBrowseScopeAssetIds,
    removeLocally: removeLocallyFromBrowse,
    applyGeometryPatches: applyBrowseGeometryPatches,
    applyPreviewPatches: applyBrowsePreviewPatches,
    reset: resetBrowsePagination,
  } = browsePagination;
  function resetBrowsePaginationPreservingVisibleLayout() {
    const previousLayout = browseLayout;
    const previousVirtualLayout = virtualBrowseLayout;
    resetBrowsePagination();
    setBrowseLayout(previousLayout);
    setVirtualBrowseLayout(previousVirtualLayout);
  }
  const applyBrowseGeometryPatchesRef = useRef(applyBrowseGeometryPatches);
  applyBrowseGeometryPatchesRef.current = applyBrowseGeometryPatches;
  const applyBrowsePreviewPatchesRef = useRef(applyBrowsePreviewPatches);
  applyBrowsePreviewPatchesRef.current = applyBrowsePreviewPatches;

  const {
    multiEdit,
    rebuildAndApplyMultiEdit,
    saveMetadataForSelection,
    batchSetRatingForSelection,
  } = useInspectorMultiEdit({
    api: api ?? null,
    library,
    selectedAssetIds,
    metadataByAssetRef,
    metadataConflictAssetIdsRef,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setAssetMetadata,
    setAssets,
    setTrashedAssets,
    setNotice,
    setError,
    syncBrowseFilterMembershipRef,
  });
  // Serpent-c9r3: bridge the multi-edit rebuilder into the ai.content.cleared
  // event effect (whose deps intentionally exclude it) via a ref, matching the
  // reloadCurrentContentRef / refreshAfterAiRef pattern.
  const rebuildAndApplyMultiEditRef = useRef<(ids: string[]) => void>(
    () => undefined,
  );

  const [restoreDialog, setRestoreDialog] = useDialogField("restoreDialog");
  const [moveDialog, setMoveDialog] = useDialogField("moveDialog");
  const [operationHistory, setOperationHistory] = useSessionField("operationHistory");
  const [editableTextFocused, setEditableTextFocused] = useState(false);
  useEffect(() => {
    const update = (target: EventTarget | null) => {
      setEditableTextFocused(isEditableTextTarget(target));
    };
    const onFocusIn = (event: FocusEvent) => update(event.target);
    const onFocusOut = (event: FocusEvent) => {
      if (isEditableTextTarget(event.relatedTarget)) {
        update(event.relatedTarget);
        return;
      }
      // A modal may remove its focused input without focusing another element.
      // Read activeElement after the browser completes that focus transition.
      queueMicrotask(() => update(document.activeElement));
    };
    update(document.activeElement);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);
  const refreshOperationHistory = useCallback(async () => {
    if (!api || !library) {
      setOperationHistory(null);
      return;
    }
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    const result = await api.getOperationHistoryStatus({ libraryId: targetLibraryId });
    if (result.ok && isCurrentLibraryView(viewSession)) {
      setOperationHistory(result.value);
    }
  }, [api, ensureLibraryView, isCurrentLibraryView, library, setOperationHistory]);
  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshOperationHistory();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refreshOperationHistory]);
  const [imageSequenceDialog, setImageSequenceDialog] = useDialogField("imageSequenceDialog");
  const [batchRelinkPreview, setBatchRelinkPreview] = useTransfersField("batchRelinkPreview");
  const [batchRelinkKeepMetadata] = useTransfersField("batchRelinkKeepMetadata");

  // Export / Import state
  const [exportProgress, setExportProgress] = useTransfersField("exportProgress");
  const exportStartedAtRef = useRef<number | null>(null);
  const [importProgress, setImportProgress] = useTransfersField("importProgress");
  const importRpcDepthRef = useRef(0);
  const activeImportIdRef = useRef<string | null>(null);
  const [importRpcInFlight, setImportRpcInFlight] = useTransfersField("importRpcInFlight");
  const [importOverlayDismissed, setImportOverlayDismissed] = useTransfersField("importOverlayDismissed");
  const beginImportRpc = useCallback(() => {
    importRpcDepthRef.current += 1;
    setImportOverlayDismissed(false);
    setImportRpcInFlight(true);
  }, [setImportOverlayDismissed, setImportRpcInFlight]);
  const endImportRpc = useCallback(() => {
    importRpcDepthRef.current = Math.max(0, importRpcDepthRef.current - 1);
    if (importRpcDepthRef.current === 0) {
      addRetiredImportId(
        retiredImportIdsRef.current,
        transfersFields.get("importProgress")?.importId ?? activeImportIdRef.current,
      );
      activeImportIdRef.current = null;
      setImportProgress(null);
      setImportOverlayDismissed(false);
      setImportRpcInFlight(false);
    }
  }, [setImportOverlayDismissed, setImportProgress, setImportRpcInFlight, retiredImportIdsRef]);
  const runCurrentImportRpc = useCallback(
    <T,>(work: () => Promise<T>): Promise<T> => runImportRpc(
      { begin: beginImportRpc, end: endImportRpc },
      work,
    ),
    [beginImportRpc, endImportRpc],
  );
  const dismissImportOverlay = useCallback(() => {
    const importId = transfersFields.get("importProgress")?.importId;
    addRetiredImportId(retiredImportIdsRef.current, importId);
    setImportOverlayDismissed(true);
  }, [setImportOverlayDismissed, retiredImportIdsRef]);
  const importAwaitingUserDecisionRef = useRef(false);
  const [importInterrupt, setImportInterrupt] = useTransfersField("importInterrupt");
  const [deleteProgress, setDeleteProgress] = useTransfersField("deleteProgress");
  const [libraryTransferKind, setLibraryTransferKind] = useTransfersField("libraryTransferKind");
  const [libraryTransferName, setLibraryTransferName] = useTransfersField("libraryTransferName");

  // REQ-PREF-001: browse-area general settings panel (theme/language/canvas).
  const [appSettingsOpen, setAppSettingsOpen] = useDialogField("appSettingsOpen");
  const [appSettingsCategory, setAppSettingsCategory] = useDialogField("appSettingsCategory");
  const [pluginContributionEpoch, setPluginContributionEpoch] = usePluginsField("pluginContributionEpoch");
  const pluginContributionRefreshKey = `${appSettingsOpen ? "settings" : "browse"}:${pluginContributionEpoch}`;
  const pluginSidebarRefreshKey = pluginContributionRefreshKey;
  useEffect(() => {
    const api = (window as RendererWindow).keel?.plugins;
    if (api?.onContributionsChanged === undefined) return;
    return api.onContributionsChanged(() => {
      setPluginContributionEpoch((current) => current + 1);
    });
  }, [setPluginContributionEpoch]);
  const pluginManagerApi = (window as RendererWindow).keel?.plugins;
  const pluginSidebarViews = usePluginSidebarViews(
    (window as RendererWindow).keel?.plugins,
    library?.libraryId,
    isPluginSidebarViewsEnabled(library?.libraryId),
    pluginSidebarRefreshKey,
  );
  const activePluginSidebarView = useMemo(
    () => pluginSidebarViews.find((view) => view.id === activePluginSidebarViewId),
    [activePluginSidebarViewId, pluginSidebarViews],
  );
  const showPluginSidebarView = activePluginSidebarView !== undefined;
  const [appLogOpen, setAppLogOpen] = useDialogField("appLogOpen");
  const setAutomaticTasksOpen = dialogsFields.setterFor("automaticTasksOpen");
  const [automaticTaskEditorId,setAutomaticTaskEditorId]=useState<string|null|undefined>(undefined);
  const [scriptSandboxPreviewOpen, setScriptSandboxPreviewOpen] = useDialogField("scriptSandboxPreviewOpen");
  const [aboutOpen, setAboutOpen] = useDialogField("aboutOpen");
  const [openSourceLicensesOpen, setOpenSourceLicensesOpen] = useDialogField("openSourceLicensesOpen");
  const [librarySettingsOpen, setLibrarySettingsOpen] = useDialogField("librarySettingsOpen");
  const setGitignoreContent = dialogsFields.setterFor("gitignoreContent");
  /** 同步传输进度（手动/自动），供资源库设置同步页显示进度条与速度。 */
  const [syncProgress, setSyncProgress] = useTransfersField("syncProgress");
  /** 当前库的同步绑定状态（库切换器 link/link-off 图标）。 */
  const [syncBindingStatus, setSyncBindingStatus] = useTransfersField("syncBindingStatus");
  /** 本次同步是否发生过实际传输（完成音、Inspector 重拉仍用；不再弹 toast）。 */
  const syncRunNotifiedRef = useRef(false);
  const syncRunStartedAtRef = useRef<number | null>(null);
  const [showIgnoredItems, setShowIgnoredItems] = useQueryField("showIgnoredItems");
  const loadFolderCoverPickerPage = useCallback(async (query: string, offset: number) => {
    if (!api || !library) return { items: [], total: 0 };
    const result = await api.searchAssets({
      libraryId: library.libraryId,
      query: folderCoverPickerSearchQuery(query),
      filters: [folderCoverPickerImageFilter()],
      limit: FOLDER_COVER_PICKER_PAGE_SIZE,
      offset,
      showIgnored: showIgnoredItems,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    const items = result.value.items
      .filter((asset) =>
        asset.mediaType === "image"
        && !asset.deletedAt
        && folderCoverPickerAssetMatches(asset, query))
      .map((asset) => ({
        assetId: asset.assetId,
        displayName: asset.displayName,
        relativeFilePath: asset.relativeFilePath,
        thumbnailArtifactId: asset.thumbnailArtifactId,
        previewRevisionId: asset.previewRevisionId ?? asset.currentRevisionId,
      }));
    return { items, total: result.value.total };
  }, [api, library, showIgnoredItems]);
  const [showMissingLinkedFiles, setShowMissingLinkedFiles] = useQueryField("showMissingLinkedFiles");
  const showMissingLinkedPublishRef = useRef<Promise<void>>(Promise.resolve());
  useLayoutEffect(() => {
    showMissingLinkedPublishRef.current = shellApi?.setShowMissingLinkedFiles(showMissingLinkedFiles)
      ?? Promise.resolve();
  }, [shellApi, showMissingLinkedFiles]);
  const [workspaceTabRevealTarget, setWorkspaceTabRevealTarget] = useState<{
    kind: "folder";
    id: string;
    requestId: number;
  } | null>(null);
  const workspaceTabRevealRequestRef = useRef(0);
  const pendingWorkspacePreviewRef = useRef<{
    assetId: string;
    viewport: WorkspaceNavViewport;
    isCurrent: () => boolean;
  } | null>(null);
  const pendingWorkspaceTabSelectionRef = useRef<{
    selectedAssetIds: string[];
    selectedAssetId: string | null;
    isCurrent: () => boolean;
  } | null>(null);
  const folderTreeActionsRef = useRef<FolderTreeExpandActions | null>(null);
  const cancelWorkspaceViewportRestoreRef = useRef<(() => void) | null>(null);
  // True while a Back/Forward replay is being applied. Suppresses viewport
  // saving and tab-context capture so the replay neither records a new history
  // step nor overwrites the target's saved viewport (Serpent-b8a853 shared
  // timeline; previously this was a per-tab history identity comparison).
  const workspaceHistoryReplayActiveRef = useRef(false);
  const {
    state: workspaceTabsState,
    historyRef: navHistoryRef,
    selectTab: selectWorkspaceTab,
    addTab: addWorkspaceTab,
    closeTab: closeWorkspaceTab,
    closeOtherTabs: closeOtherWorkspaceTabs,
    moveTab: moveWorkspaceTab,
    resetTabs: resetWorkspaceTabs,
    restoreTabs: restoreWorkspaceTabs,
    saveActiveContext: saveWorkspaceTabContext,
    syncActiveTabLocation: syncActiveWorkspaceTabLocation,
    beginNavigation: beginWorkspaceTabNavigation,
    isNavigationCurrent: isWorkspaceTabNavigationCurrent,
    activateRenderSnapshotLibrary,
    getRenderSnapshot: getWorkspaceRenderSnapshot,
  } = useWorkspaceTabsController({
    beginTransition: beginWorkspaceNavigation,
    captureContext: captureWorkspaceTabContext,
    restoreTab: restoreWorkspaceTabSession,
    restoreAll: restoreAllAssetsWorkspaceTab,
    getDefaultBrowseState: () =>
      createDefaultWorkspaceTabBrowseState(sortField, sortOrder),
    onHistoryChanged: (history) => {
      setNavHistoryUi({
        canBack: history.canBack,
        canForward: history.canForward,
      });
    },
    persistTabs: (tabsState) => {
      const libraryId = library?.libraryId;
      if (!libraryId) return;
      writeWorkspaceTabsSession(
        libraryId,
        buildWorkspaceTabsSession(tabsState),
      );
    },
  });
  // Serpent-f74e48: while a text term is present, surface matching folders
  // (name or relative path) as a "Folders" section above the asset grid.
  const searchFolderResults = useMemo(() => {
    if (searchValue.trim() === "") return [];
    const scopeKey = `${library?.libraryId ?? "no-library"}:${workspaceTabsState.activeTabId}`;
    const parsed = parseSearchExpressionDetailed(searchValue);
    const query = parsed.ok
      ? { clauses: [], expression: parsed.expression }
      : lastValidFolderSearchQueryRef.current?.scope === scopeKey
        ? lastValidFolderSearchQueryRef.current.query
        : { clauses: [] };
    if (parsed.ok) lastValidFolderSearchQueryRef.current = { scope: scopeKey, query };
    return resolveSearchFolderResults({
      query,
      folders,
      linkedFolders,
    });
  }, [searchValue, folders, linkedFolders, library?.libraryId, workspaceTabsState.activeTabId, lastValidFolderSearchQueryRef]);
  // Serpent-f74e48: fetch the real FolderBrowseEntry (cover previews + counts)
  // for search-matched folders so the reused asset-browser folder cards show
  // the same previews as normal browsing. Enrichment is keyed by the matched
  // ref set so a slow older response never overwrites a newer search.
  const searchFolderMatchKey = searchFolderResults.length
    ? searchFolderResults
        .map((result) => `${result.locationKind}:${result.folderId}`)
        .join("|")
    : null;
  const [searchFolderRealKey, setSearchFolderRealKey] = useBrowseField("searchFolderRealKey");
  const [searchFolderRealEntries, setSearchFolderRealEntries] = useBrowseField("searchFolderRealEntries");
  const searchFolderEntriesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!api || !library || searchFolderMatchKey === null) return;
    searchFolderEntriesKeyRef.current = searchFolderMatchKey;
    let cancelled = false;
    void api
      .listFolderEntriesByRefs({
        libraryId: library.libraryId,
        refs: searchFolderResults.map((result) => ({
          locationKind: result.locationKind,
          folderId: result.folderId,
        })),
      })
      .then((result) => {
        if (
          !cancelled &&
          result.ok &&
          searchFolderEntriesKeyRef.current === searchFolderMatchKey
        ) {
          setSearchFolderRealKey(searchFolderMatchKey);
          setSearchFolderRealEntries(result.value);
        }
      })
      .catch(() => {
        // Enrichment is best-effort: fall back to the lightweight entries.
      });
    return () => {
      cancelled = true;
    };
  }, [searchFolderMatchKey, searchFolderResults, library, api, setSearchFolderRealEntries, setSearchFolderRealKey]);
  const beginBrowsePageClearingSimilar = useCallback(
    (...args: Parameters<typeof beginBrowsePage>) => {
      const definition = args[0];
      setFindSimilarSource((current) =>
        current
        && definition.kind === "search"
        && definition.similaritySourceAssetId === current.assetId
        && definition.libraryId === current.libraryId
          ? current
          : null,
      );
      return beginBrowsePage(...args);
    },
    [beginBrowsePage, setFindSimilarSource],
  );
  useEffect(() => {
    activateRenderSnapshotLibrary(library?.libraryId ?? null);
  }, [activateRenderSnapshotLibrary, library?.libraryId]);
  /**
   * Rebuild the saved tab strip for the library the session restore just opened.
   * The write is explicit: `persistTabs` reads the library from render state,
   * which has not caught up with the library being opened yet.
   */
  const restoreWorkspaceTabsForLibrary = useCallback(
    (libraryId: string) => {
      const restored = restoreWorkspaceTabs(
        readWorkspaceTabsSession(libraryId),
      );
      writeWorkspaceTabsSession(
        libraryId,
        buildWorkspaceTabsSession(restored),
      );
    },
    [restoreWorkspaceTabs],
  );
  const setAppLogEntries = dialogsFields.setterFor("appLogEntries");
  const setAppLogLoading = dialogsFields.setterFor("appLogLoading");
  const [appLogAutomationCorrelationId, setAppLogAutomationCorrelationId] = useDialogField("appLogAutomationCorrelationId");
  return { setAboutOpen, appLogAutomationCorrelationId, setAppLogEntries, setAppLogLoading, setAppSettingsOpen, setAppLogAutomationCorrelationId, setAppLogOpen, metadataByAssetRef, metadataConflictAssetIdsRef, assetMetadata, setAssetMetadata, setVersionConflict, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setTrashedAssets, syncBindingStatus, syncProgress, cancelWorkspaceViewportRestoreRef, showTrash, trashedAssets, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, saveMetadataForSelection, batchSetRatingForSelection, workspaceTabsState, pluginSidebarViews, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, showIgnoredItems, showTagManagement, showPluginSidebarView, fetchBrowseScopeAssetIds, editableTextFocused, workspaceHistoryReplayActiveRef, navHistoryRef, syncActiveWorkspaceTabLocation, pendingWorkspacePreviewRef, showMissingLinkedPublishRef, setTrashedAssetCount, beginBrowsePageClearingSimilar, setShowTrash, restoreWorkspaceTabsForLibrary, scriptSandboxPreviewOpen, importProgress, appSettingsOpen, reloadCurrentContentRef, setLibraryTransferKind, setImportProgress, setLibraryTransferName, clearLibraryClosePending, resetWorkspaceTabs, applyBrowseGeometryPatchesRef, applyBrowsePreviewPatchesRef, setExtractedMetadataRefreshKey, refreshAfterAiRef, rebuildAndApplyMultiEditRef, beginWorkspaceTabNavigation, isWorkspaceTabNavigationCurrent, setShowTagManagement, setActivePluginSidebarViewId, trashedAssetCount, activePluginSidebarViewId, setShowIgnoredItems, pendingWorkspaceTabSelectionRef, getWorkspaceRenderSnapshot, saveWorkspaceTabContext, selectWorkspaceTab, resetBrowsePaginationPreservingVisibleLayout, rebuildAndApplyMultiEdit, removeLocallyFromBrowse, imageSequenceDialog, setImageSequenceDialog, runCurrentImportRpc, loadAiContentForAssetRef, resetBrowsePagination, setRestoreDialog, restoreDialog, moveDialog, setMoveDialog, operationHistory, setOperationHistory, refreshOperationHistory, batchRelinkKeepMetadata, setBatchRelinkPreview, batchRelinkPreview, exportStartedAtRef, setExportProgress, exportProgress, deleteProgress, setImportInterrupt, importAwaitingUserDecisionRef, importRpcDepthRef, activeImportIdRef, setSyncProgress, syncRunStartedAtRef, syncRunNotifiedRef, setDeleteProgress, importRpcInFlight, importOverlayDismissed, librarySettingsOpen, appLogOpen, aboutOpen, openSourceLicensesOpen, setLibrarySettingsOpen, setScriptSandboxPreviewOpen, setOpenSourceLicensesOpen, dismissImportOverlay, addWorkspaceTab, closeWorkspaceTab, pluginSidebarRefreshKey, setSyncBindingStatus, activePluginSidebarView, appSettingsCategory, setGitignoreContent, showMissingLinkedFiles, setShowMissingLinkedFiles, setAppSettingsCategory, searchFolderResults, searchFolderRealKey, searchFolderMatchKey, searchFolderRealEntries, pluginManagerApi, importInterrupt, libraryTransferKind, libraryTransferName, moveWorkspaceTab, setAutomaticTaskEditorId, setAutomaticTasksOpen, workspaceTabRevealTarget, folderTreeActionsRef, pluginContributionRefreshKey, browsePagination, loadFolderCoverPickerPage, automaticTaskEditorId, closeOtherWorkspaceTabs, setWorkspaceTabRevealTarget, workspaceTabRevealRequestRef };
}
