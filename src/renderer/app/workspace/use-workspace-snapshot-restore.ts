import type { Dispatch, RefObject, SetStateAction } from "react";
import { DEFAULT_COLOR_SIMILARITY } from "../../../shared/color-filter-presets";
import { type VirtualBrowseLayout } from "../../browse/virtual-browse-layout";
import { type BrowseState } from "../../stores/browse-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { resolveWorkspaceScrollTop, restoreWorkspaceNavViewport } from "../../workbench/workspace/workspace-scroll-position";
import { type WorkspaceRenderSnapshot, type WorkspaceVirtualLayoutSnapshot } from "../../workspace/workspace-render-snapshot-cache";
import { resolveWorkspaceTagExpression, type WorkspaceTabBrowseState } from "../../workspace/workspace-tabs";
import { type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";
import { flushSync } from "react-dom";
import { folderRecursiveRef } from "../shared/app-shared";

export interface UseWorkspaceSnapshotRestoreDeps {
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
  setSearchValue: Dispatch<SetStateAction<QueryState["searchValue"]>>;
  setFormatFilter: Dispatch<SetStateAction<QueryState["formatFilter"]>>;
  setExcludeFormatFilter: Dispatch<SetStateAction<QueryState["excludeFormatFilter"]>>;
  setColorFilter: Dispatch<SetStateAction<QueryState["colorFilter"]>>;
  setColorSimilarity: Dispatch<SetStateAction<QueryState["colorSimilarity"]>>;
  setExcludeColorFilter: Dispatch<SetStateAction<QueryState["excludeColorFilter"]>>;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setTagFilterExpression: Dispatch<SetStateAction<QueryState["tagFilterExpression"]>>;
  setTagFilterMode: Dispatch<SetStateAction<QueryState["tagFilterMode"]>>;
  setTagFilterLastValidExpression: Dispatch<SetStateAction<QueryState["tagFilterLastValidExpression"]>>;
  setExcludeTagFilter: Dispatch<SetStateAction<QueryState["excludeTagFilter"]>>;
  setExcludedTagFilter: Dispatch<SetStateAction<QueryState["excludedTagFilter"]>>;
  setIncludeAiTagFilter: Dispatch<SetStateAction<QueryState["includeAiTagFilter"]>>;
  setTagFilterMatch: Dispatch<SetStateAction<QueryState["tagFilterMatch"]>>;
  setRatingFilter: Dispatch<SetStateAction<QueryState["ratingFilter"]>>;
  setExcludeRatingFilter: Dispatch<SetStateAction<QueryState["excludeRatingFilter"]>>;
  setIncludeAiRatingFilter: Dispatch<SetStateAction<QueryState["includeAiRatingFilter"]>>;
  setFavoriteFilter: Dispatch<SetStateAction<QueryState["favoriteFilter"]>>;
  setSourceUrlFilter: Dispatch<SetStateAction<QueryState["sourceUrlFilter"]>>;
  setAvailabilityFilter: Dispatch<SetStateAction<QueryState["availabilityFilter"]>>;
  setExcludeAvailabilityFilter: Dispatch<SetStateAction<QueryState["excludeAvailabilityFilter"]>>;
  setWidthRange: Dispatch<SetStateAction<QueryState["widthRange"]>>;
  setHeightRange: Dispatch<SetStateAction<QueryState["heightRange"]>>;
  setAspectRatioRange: Dispatch<SetStateAction<QueryState["aspectRatioRange"]>>;
  setAspectRatioRanges: Dispatch<SetStateAction<QueryState["aspectRatioRanges"]>>;
  setLongEdgeRange: Dispatch<SetStateAction<QueryState["longEdgeRange"]>>;
  setDurationRange: Dispatch<SetStateAction<QueryState["durationRange"]>>;
  setSortField: Dispatch<SetStateAction<QueryState["sortField"]>>;
  setSortOrder: Dispatch<SetStateAction<QueryState["sortOrder"]>>;
  setShuffleSeed: Dispatch<SetStateAction<QueryState["shuffleSeed"]>>;
  setFolderRecursive: Dispatch<SetStateAction<NavigationState["folderRecursive"]>>;
  setShowIgnoredItems: Dispatch<SetStateAction<QueryState["showIgnoredItems"]>>;
  lastAppliedWorkspaceBrowseStateRef: RefObject<{ tabId: string | null; state: WorkspaceTabBrowseState; } | null>;
  skipDiscoveryReloadSignatureRef: RefObject<string | null>;
  queryDefinitionForWorkspaceBrowseState: (state: WorkspaceTabBrowseState) => SearchDefinition;
  applyWorkspaceLocationFlags: (location: WorkspaceNavLocation) => void;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setBrowseLayout: Dispatch<SetStateAction<BrowseState["browseLayout"]>>;
  setVirtualBrowseLayout: Dispatch<SetStateAction<BrowseState["virtualBrowseLayout"]>>;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  setSearchSnippets: Dispatch<SetStateAction<BrowseState["searchSnippets"]>>;
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setTrashedFolders: Dispatch<SetStateAction<NavigationState["trashedFolders"]>>;
  setTrashedAssetCount: Dispatch<SetStateAction<BrowseState["trashedAssetCount"]>>;
  pendingViewportRestoreRef: RefObject<WorkspaceNavViewport | null>;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useWorkspaceSnapshotRestore({ cancelWorkspaceViewportRestoreRef, workspaceCanvasRef, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setColorSimilarity, setExcludeColorFilter, setTagFilter, setTagFilterExpression, setTagFilterMode, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setTagFilterMatch, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setLongEdgeRange, setDurationRange, setSortField, setSortOrder, setShuffleSeed, setFolderRecursive, setShowIgnoredItems, lastAppliedWorkspaceBrowseStateRef, skipDiscoveryReloadSignatureRef, queryDefinitionForWorkspaceBrowseState, applyWorkspaceLocationFlags, setAssets, setBrowseLayout, setVirtualBrowseLayout, setSearchTotal, setSearchOffset, setSearchSnippets, setTrashedAssets, setTrashedFolders, setTrashedAssetCount, pendingViewportRestoreRef, setWorkspaceNavigationPending }: UseWorkspaceSnapshotRestoreDeps) {

  function restoreCurrentWorkspaceHistoryViewport(
    viewport: WorkspaceNavViewport,
    isCurrent: () => boolean,
    onComplete?: () => void,
  ) {
    cancelWorkspaceViewportRestoreRef.current?.();
    const canvas = workspaceCanvasRef.current;
    if (!canvas) {
      onComplete?.();
      return;
    }
    cancelWorkspaceViewportRestoreRef.current = restoreWorkspaceNavViewport(
      canvas,
      viewport,
      isCurrent,
      onComplete,
    );
  }

  function applyWorkspaceTabBrowseState(state: WorkspaceTabBrowseState) {
    // Tag pins were replaced by tag tree states; old snapshots restore unpinned.
    setPinnedTagId(null);
    setSearchValue(state.searchValue);
    setFormatFilter(state.filters.formatFilter);
    setExcludeFormatFilter(state.filters.excludeFormatFilter);
    setColorFilter(state.filters.colorFilter);
    setColorSimilarity(state.filters.colorSimilarity ?? DEFAULT_COLOR_SIMILARITY);
    setExcludeColorFilter(state.filters.excludeColorFilter);
    const restoredTagExpression = resolveWorkspaceTagExpression(state.filters);
    setTagFilter(state.filters.tagFilter);
    setTagFilterExpression(restoredTagExpression);
    setTagFilterMode("expression");
    setTagFilterLastValidExpression(
      state.filters.tagFilterLastValidExpression?.trim()
        ? state.filters.tagFilterLastValidExpression
        : restoredTagExpression,
    );
    setExcludeTagFilter(state.filters.excludeTagFilter);
    setExcludedTagFilter(state.filters.excludedTagFilter ?? "");
    setIncludeAiTagFilter(state.filters.includeAiTagFilter);
    setTagFilterMatch(state.filters.tagFilterMatch);
    setRatingFilter(state.filters.ratingFilter);
    setExcludeRatingFilter(state.filters.excludeRatingFilter);
    setIncludeAiRatingFilter(state.filters.includeAiRatingFilter);
    setFavoriteFilter(state.filters.favoriteFilter);
    setSourceUrlFilter(state.filters.sourceUrlFilter);
    setAvailabilityFilter(state.filters.availabilityFilter);
    setExcludeAvailabilityFilter(state.filters.excludeAvailabilityFilter);
    setWidthRange({ ...state.filters.widthRange });
    setHeightRange({ ...state.filters.heightRange });
    setAspectRatioRange({ ...state.filters.aspectRatioRange });
    setAspectRatioRanges(state.filters.aspectRatioRanges.map((range) => ({ ...range })));
    setLongEdgeRange({ ...state.filters.longEdgeRange });
    setDurationRange({ ...state.filters.durationRange });
    setSortField(state.sortField);
    setSortOrder(state.sortOrder);
    setShuffleSeed(state.shuffleSeed);
    folderRecursiveRef.current = state.folderRecursive;
    setFolderRecursive(state.folderRecursive);
    setShowIgnoredItems(state.showIgnoredItems);
  }

  function applyWorkspaceTabBrowseStateForNavigation(
    request: WorkspaceNavigationRequest,
  ) {
    const state = request.browseState;
    const tabId = request.browseStateTabId ?? null;
    const lastApplied = lastAppliedWorkspaceBrowseStateRef.current;
    if (
      !state ||
      (lastApplied?.tabId === tabId && lastApplied.state === state)
    ) return;
    lastAppliedWorkspaceBrowseStateRef.current = { tabId, state };
    skipDiscoveryReloadSignatureRef.current = JSON.stringify(
      queryDefinitionForWorkspaceBrowseState(state),
    );
    applyWorkspaceTabBrowseState(state);
  }

  function restoreVirtualBrowseLayoutSnapshot(
    snapshot: WorkspaceVirtualLayoutSnapshot | null,
  ): VirtualBrowseLayout | null {
    if (!snapshot) return null;
    const entries = new Map(snapshot.entries);
    const assetIdsByIndex = new Map(snapshot.assetIdsByIndex);
    const indexByAssetId = new Map(snapshot.indexByAssetId);
    return {
      total: snapshot.total,
      geometryRevision: snapshot.geometryRevision,
      geometryEntries: new Map(snapshot.geometryEntries),
      assetIdsByIndex,
      entries,
      indexByAssetId,
    };
  }

  function applyWorkspaceRenderSnapshot(snapshot: WorkspaceRenderSnapshot): void {
    applyWorkspaceLocationFlags(snapshot.location);
    if (snapshot.kind === "browse") {
      setAssets([...snapshot.items]);
      setBrowseLayout([...snapshot.layout]);
      setVirtualBrowseLayout(restoreVirtualBrowseLayoutSnapshot(snapshot.virtualLayout));
      setSearchTotal(snapshot.total);
      setSearchOffset(snapshot.pageDescriptor.offset);
      setSearchSnippets(new Map(snapshot.snippets));
      return;
    }
    if (snapshot.kind === "trash") {
      setTrashedAssets([...snapshot.items]);
      setTrashedFolders([...snapshot.folders]);
      setBrowseLayout([...snapshot.layout]);
      setVirtualBrowseLayout(restoreVirtualBrowseLayoutSnapshot(snapshot.virtualLayout));
      setTrashedAssetCount(snapshot.total);
      setSearchOffset(snapshot.pageDescriptor.offset);
      return;
    }
    setAssets([]);
    setBrowseLayout([]);
    setVirtualBrowseLayout(null);
  }

  function finishWorkspaceNavigation(
    request: WorkspaceNavigationRequest,
    viewport: WorkspaceNavViewport = {
      scrollTop: 0,
      scrollProgress: 0,
      scrollExtent: 0,
    },
  ): void {
    if (!request.isCurrent()) return;
    const canvas = workspaceCanvasRef.current;
    if (canvas) {
      // Content may already be committed (cached snapshot / history entry):
      // flush anything pending and place the offset now, still pre-paint.
      flushSync(() => {});
      const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      canvas.scrollTop = resolveWorkspaceScrollTop(viewport, extent);
    }
    // Cancel any in-flight restore first (its onComplete would clear the
    // pending ref). Re-arm afterwards so the layout effect can place the
    // offset in the commit where new content paints.
    restoreCurrentWorkspaceHistoryViewport(viewport, request.isCurrent, () => {
      pendingViewportRestoreRef.current = null;
      if (request.isCurrent()) setWorkspaceNavigationPending(false);
    });
    pendingViewportRestoreRef.current = viewport;
  }
  return { finishWorkspaceNavigation, applyWorkspaceRenderSnapshot, applyWorkspaceTabBrowseStateForNavigation };
}
