import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { SearchQuery } from "../../shared/asset-types";
import type { BrowseFirstPage } from "../use-browse-pagination";
import type { AppLocale } from "../i18n/types";
import type { WorkspaceNavHistory } from "../workbench/workspace/workspace-nav-history";
import { type FilterClause, type SearchScope, type SortDefinition } from "../../shared/asset-types";
import { type LibraryNavigationSummary } from "../../shared/library-navigation";
import { type RendererLibrarySummary } from "../../shared/protocol/responses";
import { assetSupportsThumbnail } from "../../shared/thumbnail-support";
import { missingNavigationSummaryIsFailure } from "../blocking-navigation-summary";
import { deferNavigationHydration } from "../browse/defer-navigation-hydration";
import { type CreateLibraryPhase } from "../CreateDialog";
import { LibraryOperationError, toMessage } from "../error-utils";
import { folderBrowseScope } from "../folder-browse-scope";
import { type LibraryViewSessionToken } from "../library-view-session";
import { type PendingAssetReveal } from "../pending-asset-reveal";
import { type SemanticSearchPageSize } from "../semantic-search-preferences";
import { type BrowseState } from "../stores/browse-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../stores/navigation-store";
import { type QueryState } from "../stores/query-store";
import { type SelectionState } from "../stores/selection-store";
import { type SessionState } from "../stores/session-store";
import { type TransfersState } from "../stores/transfers-store";
import { type WorkspaceState } from "../stores/workspace-store";
import { BROWSE_PAGE_SIZE, registerBrowseSearchPage } from "../use-browse-pagination";
import { useBrowserSessionPersist, useBrowserSessionRestore, usePendingRestoredAssetFocus } from "../use-browser-session-restore";
import { useExtensionActiveContext } from "../use-extension-active-context";
import { useExtensionSaveReveal } from "../use-extension-save-reveal";
import { usePendingAssetReveal } from "../use-pending-asset-reveal";
import { type SearchDefinition } from "./app-shared";
import { useCallback, useEffect } from "react";
import { folderRecursiveRef } from "./app-shared";

export interface UseContentLoadingDeps {
  api: KeelLibraryApi | undefined;
  showMissingLinkedPublishRef: RefObject<Promise<void>>;
  showIgnoredItems: QueryState["showIgnoredItems"];
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  contentLoadGenerationRef: RefObject<number>;
  navigationHydrationAbortRef: RefObject<AbortController | null>;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  setAllAssetCount: Dispatch<SetStateAction<BrowseState["allAssetCount"]>>;
  setRootAssetCount: Dispatch<SetStateAction<BrowseState["rootAssetCount"]>>;
  setTrashedAssetCount: Dispatch<SetStateAction<BrowseState["trashedAssetCount"]>>;
  setFolders: Dispatch<SetStateAction<NavigationState["folders"]>>;
  setLinkedFolders: Dispatch<SetStateAction<NavigationState["linkedFolders"]>>;
  setTags: Dispatch<SetStateAction<NavigationState["tags"]>>;
  setTrashedFolders: Dispatch<SetStateAction<NavigationState["trashedFolders"]>>;
  setFolderNavigationCovers: Dispatch<SetStateAction<BrowseState["folderNavigationCovers"]>>;
  setFolderCustomCoverIds: Dispatch<SetStateAction<BrowseState["folderCustomCoverIds"]>>;
  t: TranslateFn;
  setThumbnailFailures: Dispatch<SetStateAction<BrowseState["thumbnailFailures"]>>;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  setSearchSnippets: Dispatch<SetStateAction<BrowseState["searchSnippets"]>>;
  beginBrowsePageClearingSimilar: (definition: { kind: "search"; libraryId: string; query: SearchQuery | null; filters?: FilterClause[] | null; scope?: SearchScope | null; sort?: SortDefinition | null; showIgnored: boolean; sessionId?: string; target: "assets" | "trash"; pinnedOrder?: boolean; rankedAssetIds?: readonly string[]; rankedPageSize?: SemanticSearchPageSize; similaritySourceAssetId?: string; }, firstPage: BrowseFirstPage) => void;
  setError: (text: string | null) => void;
  locale: AppLocale;
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  setFolderRecursive: Dispatch<SetStateAction<NavigationState["folderRecursive"]>>;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setAssetScope: Dispatch<SetStateAction<NavigationState["assetScope"]>>;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  setBrowserSessionReady: Dispatch<SetStateAction<SessionState["browserSessionReady"]>>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  restoreWorkspaceTabsForLibrary: (libraryId: string) => void;
  pendingRestoredFocusRef: RefObject<string | null>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  library: SessionState["library"];
  showTrash: NavigationState["showTrash"];
  activeTagId: NavigationState["activeTagId"];
  assetScope: NavigationState["assetScope"];
  browserSessionReady: SessionState["browserSessionReady"];
  selectedAsset: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | undefined;
  tags: NavigationState["tags"];
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  assets: BrowseState["assets"];
  trashedAssets: BrowseState["trashedAssets"];
  selectedAssetId: SelectionState["selectedAssetId"];
  pendingRevealRef: RefObject<PendingAssetReveal | null>;
  chooseFolderRef: RefObject<(scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; }) => Promise<void>>;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  scriptSandboxPreviewOpen: DialogsState["scriptSandboxPreviewOpen"];
  importLibraryChooserOpen: TransfersState["importLibraryChooserOpen"];
  openLibraryChooserOpen: DialogsState["openLibraryChooserOpen"];
  importValidated: TransfersState["importValidated"];
  importProgress: TransfersState["importProgress"];
  appSettingsOpen: DialogsState["appSettingsOpen"];
  busy: boolean;
  dialog: DialogsState["dialog"];
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  setDialog: Dispatch<SetStateAction<DialogsState["dialog"]>>;
  hadLibraryRef: RefObject<boolean>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useContentLoading({ api, showMissingLinkedPublishRef, showIgnoredItems, ensureLibraryView, contentLoadGenerationRef, navigationHydrationAbortRef, isCurrentLibraryView, setAllAssetCount, setRootAssetCount, setTrashedAssetCount, setFolders, setLinkedFolders, setTags, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, t, setThumbnailFailures, setSearchTotal, setSearchOffset, setSearchSnippets, beginBrowsePageClearingSimilar, setError, locale, setLibraryLoading, setFolderRecursive, setLibrary, setShowTrash, setTrashedAssets, setAssetScope, setActiveTagId, setTagFilter, setAssets, setSelectedAssetId, setSelectedAssetIds, setAssetSelectionAnchor, setBrowserSessionReady, managedImportTargetFolderIdRef, restoreWorkspaceTabsForLibrary, pendingRestoredFocusRef, navHistoryRef, setNavHistoryUi, setUiState, library, showTrash, activeTagId, assetScope, browserSessionReady, selectedAsset, tags, workspaceCanvasRef, assets, trashedAssets, selectedAssetId, pendingRevealRef, chooseFolderRef, refreshRecentLibraries, scriptSandboxPreviewOpen, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, importProgress, appSettingsOpen, busy, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef }: UseContentLoadingDeps) {

  const loadContent = useCallback(
    async (
      activeLibrary: RendererLibrarySummary,
      scope: AssetScope,
      opts?: {
        trashMode?: boolean;
        discovery?: SearchDefinition;
        searchScope?: SearchScope;
        showIgnored?: boolean;
        /** Navigation keeps sidebar data; mutations/library open opt in to refresh. */
        refreshSidebar?: boolean;
        /** Library replacement hydrates navigation before the new view is shown. */
        navigationPriority?: "normal" | "library-switch" | "mutation";
        /** Keep the workspace covered until the complete navigation snapshot is ready. */
        blockingLibraryLoad?: boolean;
        /** A tab/history transition may be superseded independently of the library. */
        navigationIsCurrent?: () => boolean;
        /** Folder recursion is captured with the request, not read after an await. */
        folderRecursive?: boolean;
        /** Return a read-only prepared page so its caller can commit page and route together. */
        deferCommit?: boolean;
        onPrepared?: (commit: () => void) => void;
      },
    ) => {
      if (!api) return;
      await showMissingLinkedPublishRef.current;
      const trashMode = opts?.trashMode ?? false;
      const includeIgnored = opts?.showIgnored ?? showIgnoredItems;
      const refreshSidebar = opts?.refreshSidebar ?? true;
      const browseScope: SearchScope | undefined =
        opts?.searchScope ??
        (trashMode
          ? { kind: "trash" }
          : folderBrowseScope(
              scope,
              opts?.folderRecursive ?? folderRecursiveRef.current,
            ));
      const viewSession = ensureLibraryView(activeLibrary.libraryId);
      if (!viewSession) return [];
      const libId = { libraryId: activeLibrary.libraryId };
      const generation = ++contentLoadGenerationRef.current;
      navigationHydrationAbortRef.current?.abort();
      const navigationHydrationAbort = new AbortController();
      navigationHydrationAbortRef.current = navigationHydrationAbort;
      const isCurrentLoad = () =>
        generation === contentLoadGenerationRef.current &&
        isCurrentLibraryView(viewSession) &&
        (opts?.navigationIsCurrent?.() ?? true);
      const includeLibraryCounts =
        refreshSidebar || trashMode || scope === "all" || scope === "root";
      // Post the primary browse request before sidebar/count hydration. The
      // Worker is a single synchronous SQLite owner; constructing the sidebar
      // Promise first used to put folders/tags/collections ahead of the page
      // the user is actually waiting to see (several hundred ms on 20k
      // libraries, and materially worse on network-backed libraries).
      const primaryAssetPromise = api.openBrowseSession({
        ...libId,
        query: opts?.discovery?.search ?? null,
        filters: opts?.discovery?.filters,
        scope: browseScope,
        sort: opts?.discovery?.sort,
        // Stage C.1: materialize the ordered scope once in Worker; later
        // pages reuse the opaque snapshot instead of rebuilding COUNT/scope SQL.
        limit: BROWSE_PAGE_SIZE,
        showIgnored: includeIgnored,
      });
      // Navigation hydration is one Worker read model. When it is not needed,
      // retain the old count-only fallback for mutation paths that explicitly
      // keep sidebar rows untouched. Both paths start after the primary browse
      // request, so sidebar work cannot win the Worker queue race.
      /**
       * The navigation summary is a library-scoped read model, not a load-scoped
       * one: it describes the whole library's folders, collections and counts.
       * Requiring the *load generation* to still match discarded summaries that
       * had already arrived successfully. On a library whose writes keep firing
       * browse-change reloads (a NAS library running thumbnail/palette jobs),
       * every load was superseded before it could apply the sidebar, so the
       * sidebar stayed permanently empty ("尚无托管或链接文件夹 / 尚无合集") behind
       * a loading overlay that never cleared.
       *
       * Scope it to the library/view instead: a summary for the library still on
       * screen is always safe to apply, and applying the newest one wins.
       */
      const isCurrentLibraryNavigation = () =>
        isCurrentLibraryView(viewSession)
        && (opts?.navigationIsCurrent?.() ?? true);
      const applyNavigationSummary = (summary: LibraryNavigationSummary) => {
        setAllAssetCount(summary.allAssetCount);
        setRootAssetCount(summary.rootAssetCount);
        setTrashedAssetCount(summary.trashedAssetCount);
        setFolders(summary.folders);
        setLinkedFolders(summary.linkedFolders);
        setTags(summary.tags);
        setTrashedFolders(summary.trashedFolders);
        const covers = summary.folderCovers ?? [];
        setFolderNavigationCovers(covers);
        setFolderCustomCoverIds(new Set(covers.map((cover) => cover.folderId)));
      };
      const loadNavigationSummary = () => {
        if (!isCurrentLibraryView(viewSession)) return Promise.resolve(undefined);
        return api.fetchLibraryNavigationSummary({
          ...libId,
          showIgnored: includeIgnored,
          includeTrashedFolders: trashMode,
        }).then((result) => {
          if (result.ok && isCurrentLibraryNavigation()) {
            applyNavigationSummary(result.value);
          }
          return result;
        });
      };
      const navigationPromise = refreshSidebar
        ? primaryAssetPromise.then(
            (primaryResult) => {
              if (!primaryResult.ok) return undefined;
              if (opts?.blockingLibraryLoad) return loadNavigationSummary();
              return deferNavigationHydration(loadNavigationSummary, {
                signal: navigationHydrationAbort.signal,
                immediate: opts?.navigationPriority === "library-switch"
                  || opts?.navigationPriority === "mutation",
              });
            },
            () => undefined,
          )
        : Promise.resolve(undefined);
      const countPromise = !refreshSidebar && includeLibraryCounts
        ? Promise.all([
            trashMode || scope !== "all"
              ? api.searchAssets({ ...libId, query: null, limit: 1, offset: 0, showIgnored: includeIgnored })
              : Promise.resolve(undefined),
            trashMode || scope !== "root"
              ? api.searchAssets({
                  ...libId,
                  query: null,
                  limit: 1,
                  offset: 0,
                  scope: { kind: "folder", folderId: null, recursive: false },
                  showIgnored: includeIgnored,
                })
              : Promise.resolve(undefined),
            api.searchAssets({
              ...libId,
              query: null,
              limit: 1,
              offset: 0,
              scope: { kind: "trash" },
              showIgnored: includeIgnored,
            }),
          ])
        : Promise.resolve(undefined);
      const assetResult = await primaryAssetPromise;
      if (!isCurrentLoad()) return;
      if (!assetResult.ok) throw new LibraryOperationError(assetResult.error);

      let blockingNavigation: LibraryNavigationSummary | undefined;
      if (opts?.blockingLibraryLoad) {
        try {
          const navigationResult = await navigationPromise;
          if (!isCurrentLoad()) return;
          if (missingNavigationSummaryIsFailure({
            refreshSidebar,
            navigationResult,
          })) {
            throw new Error(t("toast.readAssetsFailed"));
          }
          if (navigationResult) {
            if (!navigationResult.ok) {
              throw new LibraryOperationError(navigationResult.error);
            }
            blockingNavigation = navigationResult.value;
          }
        } finally {
          if (navigationHydrationAbortRef.current === navigationHydrationAbort) {
            navigationHydrationAbortRef.current = null;
          }
        }
      }

      const commitPreparedContent = () => {
      // Ordinary browse scopes apply the canvas immediately and hydrate the
      // sidebar later. A library replacement is different: blockingNavigation
      // was read before this point, while the loading overlay still covers
      // every state update, so no partial library identity can be shown.
      // Serpent-sa65: beginPage owns the first summaries and starts the compact
      // real-asset layout fetch that gives the virtual canvas full geometry.
      // Serpent-2oga: drop stale failure badges when the list already has ready thumbs.
      setThumbnailFailures((current) => {
        if (current.size === 0) return current;
        const next = new Map(current);
        for (const asset of assetResult.value.items) {
          if (
            asset.thumbnailStatus === "ready" ||
            !assetSupportsThumbnail(asset)
          ) {
            next.delete(asset.assetId);
          }
        }
        return next.size === current.size ? current : next;
      });
      setSearchTotal(assetResult.value.total);
      setSearchOffset(assetResult.value.offset);
      setSearchSnippets(
        new Map(
          (assetResult.value.snippets ?? []).map((snippet) => [snippet.assetId, snippet.text]),
        ),
      );
      // Serpent-ws4k: register the paginated query so the scroll sentinel can
      // append the next page with the exact same scope/sort/filters.
      registerBrowseSearchPage(beginBrowsePageClearingSimilar, {
        libraryId: activeLibrary.libraryId,
        query: opts?.discovery?.search ?? null,
        filters: opts?.discovery?.filters,
        scope: browseScope,
        sort: opts?.discovery?.sort,
        showIgnored: includeIgnored,
        sessionId: assetResult.value.sessionId,
        target: trashMode ? "trash" : "assets",
        items: assetResult.value.items,
        total: assetResult.value.total,
        offset: assetResult.value.offset,
        snippets: assetResult.value.snippets,
      });

      if (blockingNavigation) {
        applyNavigationSummary(blockingNavigation);
        return assetResult.value.items;
      }

      // Progressive navigation hydration. A stale navigation response is
      // ignored just like a stale browse page and cannot repaint a newer
      // library/scope.
      void Promise.all([navigationPromise, countPromise])
        .then(([navigation, counts]) => {
          if (!isCurrentLoad()) return;
          if (navigation) {
            if (!navigation.ok) throw new LibraryOperationError(navigation.error);
            applyNavigationSummary(navigation.value);
            return;
          }
          if (!counts) return;
          const [allResult, rootCountResult, trashCountResult] = counts;
          if (allResult && !allResult.ok) throw new LibraryOperationError(allResult.error);
          if (rootCountResult && !rootCountResult.ok) throw new LibraryOperationError(rootCountResult.error);
          if (!trashCountResult.ok) throw new LibraryOperationError(trashCountResult.error);
          if (allResult) setAllAssetCount(allResult.value.total);
          if (rootCountResult) setRootAssetCount(rootCountResult.value.total);
          setTrashedAssetCount(trashCountResult.value.total);
        })
        .catch((caught: unknown) => {
          if (!isCurrentLoad()) return;
          setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
        })
        .finally(() => {
          if (navigationHydrationAbortRef.current === navigationHydrationAbort) {
            navigationHydrationAbortRef.current = null;
          }
        });
      };
      if (opts?.deferCommit) {
        opts.onPrepared?.(commitPreparedContent);
        return assetResult.value.items;
      }
      commitPreparedContent();
      return assetResult.value.items;
    },
    [
      api,
      beginBrowsePageClearingSimilar,
      ensureLibraryView,
      isCurrentLibraryView,
      locale,
      setError,
      showIgnoredItems,
      t, setAllAssetCount, setFolderCustomCoverIds, setFolderNavigationCovers, setFolders, setLinkedFolders, setRootAssetCount, setSearchOffset, setSearchSnippets, setSearchTotal, setTags, setThumbnailFailures, setTrashedAssetCount, setTrashedFolders, contentLoadGenerationRef, navigationHydrationAbortRef, showMissingLinkedPublishRef],
  );

  useBrowserSessionRestore({
    api: api ?? null,
    loadContent,
    setLibraryLoading,
    folderRecursiveRef,
    setFolderRecursive,
    setLibrary,
    setShowTrash,
    setTrashedAssets,
    setAssetScope,
    setActiveTagId,
    setTagFilter,
    setAssets,
    setSearchTotal,
    beginBrowsePage: beginBrowsePageClearingSimilar,
    setSelectedAssetId,
    setSelectedAssetIds,
    setAssetSelectionAnchor,
    setBrowserSessionReady,
    resetImportTargetFolderRef: managedImportTargetFolderIdRef,
    restoreWorkspaceTabs: restoreWorkspaceTabsForLibrary,
    pendingRestoredFocusRef,
    navHistoryRef,
    setNavHistoryUi,
    setUiState,
    setError,
  });
  useExtensionActiveContext({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    showTrash,
    activeTagId,
    assetScope,
  });
  useBrowserSessionPersist({
    library,
    browserSessionReady,
    selectedAsset,
    showTrash,
    activeTagId,
    tags,
    assetScope,
  });
  usePendingRestoredAssetFocus({
    pendingRestoredFocusRef,
    workspaceCanvasRef,
    assets,
    trashedAssets,
    selectedAssetId,
  });
  usePendingAssetReveal({
    pendingRevealRef,
    assets,
    setSelectedAssetIds,
    setSelectedAssetId,
    setAssetSelectionAnchor,
    pendingRestoredFocusRef,
  });
  useExtensionSaveReveal({
    api: api ?? null,
    libraryId: library?.libraryId,
    chooseFolderRef,
    pendingRevealRef,
  });
  // Serpent-y0au: keep recent libraries warm on the no-library start surface.
  useEffect(() => {
    if (!api || library) return;
    void refreshRecentLibraries(null);
    // refreshRecentLibraries closes over library; null path is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when api/library identity changes
  }, [api, library]);
  // Serpent-kipk: no-library surface is the shared create dialog (start phase),
  // full-window centered with backdrop — not a card inside the canvas.
  useEffect(() => {
    if (library) return;
    if (scriptSandboxPreviewOpen) return;
    // Keep the required start surface closed while any import flow owns the
    // foreground. The native ZIP picker can take long enough for the chooser
    // to close before its progress event arrives; without this guard the
    // no-library effect immediately remounts CreateDialog over the picker or
    // import progress (Serpent-o5j3).
    if (importLibraryChooserOpen || openLibraryChooserOpen || importValidated || importProgress || appSettingsOpen || busy) return;
    if (dialog === "library") return;
    queueMicrotask(() => {
      setDialogValue(t("shell.myLibrary"));
      setCreateLibraryPhase("start");
      setDialog("library");
    });
  }, [
    library,
    dialog,
    importLibraryChooserOpen,
    openLibraryChooserOpen,
    importValidated,
    importProgress,
    appSettingsOpen,
    busy,
    scriptSandboxPreviewOpen,
    t, setDialog, setCreateLibraryPhase, setDialogValue]);
  // Yield the required create surface while another full-window modal is up.
  useEffect(() => {
    if (library) return;
    if (!importLibraryChooserOpen && !openLibraryChooserOpen && !appSettingsOpen) return;
    if (dialog === "library") {
      queueMicrotask(() => setDialog(null));
    }
  }, [library, importLibraryChooserOpen, openLibraryChooserOpen, appSettingsOpen, dialog, setDialog]);
  // Dismiss the auto-opened no-library surface once a library becomes available.
  // Do not close a menu-opened create dialog while a library is already open.
  useEffect(() => {
    if (!library) {
      hadLibraryRef.current = false;
      return;
    }
    if (!hadLibraryRef.current && dialog === "library") {
      setDialog(null);
      setCreateLibraryPhase("start");
    }
    hadLibraryRef.current = true;
  }, [library, dialog, setDialog, hadLibraryRef, setCreateLibraryPhase]);
  return { loadContent };
}
