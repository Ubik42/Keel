import type { Dispatch, RefObject, SetStateAction } from "react";
import { type AssetSummary, type SearchScope, type SortDefinition } from "../../shared/asset-types";
import { type RendererLibrarySummary } from "../../shared/protocol/responses";
import { decrementScopeCount, removeAssetIdsLocally } from "../asset-local-refresh";
import { folderBrowseScope, folderSearchScope } from "../folder-browse-scope";
import { type BrowseState } from "../stores/browse-store";
import { type AssetScope, type NavigationState } from "../stores/navigation-store";
import { type QueryState } from "../stores/query-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { browseStateForWorkspaceNavigation, workspaceNavigationKeepsLiveDiscovery } from "../workspace-discovery-navigation";
import { createDefaultWorkspaceTabBrowseState, type WorkspaceTabBrowseState } from "../workspace-tabs";
import { type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest } from "./app-shared";
import { useCallback, useRef } from "react";

export interface UseContentQueriesDeps {
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  captureWorkspaceTabBrowseState: () => WorkspaceTabBrowseState;
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  clearDiscoveryControls: () => void;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  setSearchSnippets: Dispatch<SetStateAction<BrowseState["searchSnippets"]>>;
  assetScope: NavigationState["assetScope"];
  folderRecursive: NavigationState["folderRecursive"];
  library: SessionState["library"];
  showTrash: NavigationState["showTrash"];
  setFilteredFolderCountRefreshToken: Dispatch<SetStateAction<BrowseState["filteredFolderCountRefreshToken"]>>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  activeTagId: NavigationState["activeTagId"];
  tags: NavigationState["tags"];
  localAssetRemovalGenerationRef: RefObject<number>;
  assets: BrowseState["assets"];
  trashedAssets: BrowseState["trashedAssets"];
  searchTotal: BrowseState["searchTotal"];
  allAssetCount: BrowseState["allAssetCount"];
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setAllAssetCount: Dispatch<SetStateAction<BrowseState["allAssetCount"]>>;
  removeLocallyFromBrowse: (assetIds: string[], removedCount: number) => () => void;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useContentQueries({ currentQueryDefinition, captureWorkspaceTabBrowseState, sortField, sortOrder, clearDiscoveryControls, setSearchTotal, setSearchOffset, setSearchSnippets, assetScope, folderRecursive, library, showTrash, setFilteredFolderCountRefreshToken, loadContent, activeTagId, tags, localAssetRemovalGenerationRef, assets, trashedAssets, searchTotal, allAssetCount, setAssets, setTrashedAssets, setAllAssetCount, removeLocallyFromBrowse, workspaceCanvasRef, reloadCurrentContentRef }: UseContentQueriesDeps) {

  function queryDefinitionForWorkspaceBrowseState(
    state: WorkspaceTabBrowseState,
  ): SearchDefinition {
    return currentQueryDefinition({
      searchValue: state.searchValue,
      colorFilter: state.filters.colorFilter,
      excludeColorFilter: state.filters.excludeColorFilter,
      colorSimilarity: state.filters.colorSimilarity,
      sortField: state.sortField,
      sortOrder: state.sortOrder,
      filtersSnapshot: {
        pinnedTagId: state.filters.pinnedTagId,
        formatFilter: state.filters.formatFilter,
        excludeFormatFilter: state.filters.excludeFormatFilter,
        tagFilter: state.filters.tagFilter,
        tagFilterExpression: state.filters.tagFilterExpression,
        tagFilterMode: state.filters.tagFilterMode,
        tagFilterLastValidExpression: state.filters.tagFilterLastValidExpression,
        excludeTagFilter: state.filters.excludeTagFilter,
        excludedTagFilter: state.filters.excludedTagFilter ?? "",
        includeAiTagFilter: state.filters.includeAiTagFilter,
        tagFilterMatch: state.filters.tagFilterMatch,
        ratingFilter: state.filters.ratingFilter,
        excludeRatingFilter: state.filters.excludeRatingFilter,
        includeAiRatingFilter: state.filters.includeAiRatingFilter,
        favoriteFilter: state.filters.favoriteFilter,
        sourceUrlFilter: state.filters.sourceUrlFilter,
        availabilityFilter: state.filters.availabilityFilter,
        excludeAvailabilityFilter: state.filters.excludeAvailabilityFilter,
        widthRange: state.filters.widthRange,
        heightRange: state.filters.heightRange,
        aspectRatioRange: state.filters.aspectRatioRange,
        aspectRatioRanges: state.filters.aspectRatioRanges,
        longEdgeRange: state.filters.longEdgeRange,
        durationRange: state.filters.durationRange,
      },
    });
  }

  function queryDefinitionForNavigationRequest(
    request: WorkspaceNavigationRequest,
  ): SearchDefinition {
    return queryDefinitionForWorkspaceBrowseState(
      browseStateForWorkspaceNavigation({
        requestBrowseState: request.browseState,
        liveBrowseState: captureWorkspaceTabBrowseState(),
        emptyBrowseState: createDefaultWorkspaceTabBrowseState(sortField, sortOrder),
        historyMode: request.historyMode,
      }),
    );
  }

  function resetDiscoveryIfNavigationReplacesLive(
    request: WorkspaceNavigationRequest,
  ): void {
    if (
      workspaceNavigationKeepsLiveDiscovery({
        hasRequestBrowseState: request.browseState !== undefined,
        historyMode: request.historyMode,
      })
    ) {
      return;
    }
    if (!request.browseState) clearDiscoveryControls();
  }

  function applySearchResult(
    result: {
      items: AssetSummary[];
      total: number;
      offset: number;
      snippets?: Array<{ assetId: string; text: string }>;
    },
  ) {
    // Serpent-87pd: canvas slots come from beginPage. Replacing the list with
    // the first window here would collapse the scrollbar to 100 items.
    setSearchTotal(result.total);
    setSearchOffset(result.offset + result.items.length);
    setSearchSnippets(
      new Map(
        (result.snippets ?? []).map(
          (snippet) => [snippet.assetId, snippet.text] as const,
        ),
      ),
    );
  }

  function currentSearchScope(
    recursivelySearchFolders = false,
  ): SearchScope | undefined {
    return recursivelySearchFolders
      ? folderSearchScope(assetScope)
      : folderBrowseScope(assetScope, folderRecursive);
  }

  async function reloadCurrentContent(options?: {
    /** Wait for the navigation snapshot before resolving the operation. */
    blockingNavigation?: boolean;
    /** Folder mutations must publish sidebar changes without the browse idle delay. */
    navigationPriority?: "mutation";
  }) {
    if (!library) return;
    if (!showTrash) setFilteredFolderCountRefreshToken((token) => token + 1);
    if (showTrash) {
      await loadContent(library, "all", {
        trashMode: true,
        searchScope: { kind: "trash" },
      });
      return;
    }
    const activeTagName = activeTagId
      ? tags.find((tag) => tag.tagId === activeTagId)?.name
      : undefined;
    const discovery = activeTagName
      ? currentQueryDefinition({ tagFilter: activeTagName })
      : currentQueryDefinition();
    await loadContent(library, assetScope, {
      discovery,
      searchScope: currentSearchScope(discovery.search !== undefined),
      blockingLibraryLoad: options?.blockingNavigation,
      navigationPriority: options?.navigationPriority,
    });
  }

  // Keel-关联刷新: asset/folder deletions must clear cards immediately
  // instead of waiting for a full searchAssets round trip (~10s on large
  // libraries). Remove ids locally, adjust scope counts, and quietly
  // re-reconcile once in the background (derived sidebar/folder data stays
  // fresh without blocking the user).
  const deferredReconcileTimerRef = useRef<number | undefined>(undefined);
  const applyLocalAssetRemoval = useCallback(
    (
      assetIds: string[],
      options?: { removedCount?: number; libraryId?: string },
    ): (() => void) => {
      const operationLibraryId = options?.libraryId ?? sessionFields.get("library")?.libraryId;
      const removalGeneration = ++localAssetRemovalGenerationRef.current;
      let restored = false;
      const previousAssets = assets;
      const previousTrashedAssets = trashedAssets;
      const previousSearchTotal = searchTotal;
      const previousAllAssetCount = allAssetCount;
      const removed = new Set(assetIds);
      const removedCount = options?.removedCount ?? assetIds.length;
      setAssets((current) => removeAssetIdsLocally(current, removed));
      setTrashedAssets((current) => removeAssetIdsLocally(current, removed));
      setSearchTotal((current) => decrementScopeCount(current, removedCount));
      setAllAssetCount((current) => Math.max(0, current - removedCount));
      // Keel-关联刷新: fold the deletion into the pagination bookkeeping so
      // an in-flight append cannot resurrect the removed rows.
      const restoreBrowseState = removeLocallyFromBrowse(assetIds, removedCount);
      if (deferredReconcileTimerRef.current !== undefined) {
        window.clearTimeout(deferredReconcileTimerRef.current);
      }
      deferredReconcileTimerRef.current = window.setTimeout(() => {
        deferredReconcileTimerRef.current = undefined;
        if (
          operationLibraryId !== undefined &&
          sessionFields.get("library")?.libraryId !== operationLibraryId
        ) return;
        // Keep the user's scroll position across the silent reconcile — a
        // replaced first page must not yank the canvas to the bottom.
        const canvas = workspaceCanvasRef.current;
        const scrollTopBefore = canvas?.scrollTop ?? 0;
        void reloadCurrentContentRef.current()
          .catch(() => undefined)
          .finally(() => {
            if (
              operationLibraryId !== undefined &&
              sessionFields.get("library")?.libraryId !== operationLibraryId
            ) return;
            const nextCanvas = workspaceCanvasRef.current;
            if (nextCanvas && nextCanvas.scrollTop !== scrollTopBefore) {
              nextCanvas.scrollTo({ top: scrollTopBefore });
            }
          });
      }, 1500);
      return () => {
        if (
          restored ||
          removalGeneration !== localAssetRemovalGenerationRef.current
        ) return;
        if (
          operationLibraryId !== undefined &&
          sessionFields.get("library")?.libraryId !== operationLibraryId
        ) return;
        restored = true;
        if (deferredReconcileTimerRef.current !== undefined) {
          window.clearTimeout(deferredReconcileTimerRef.current);
          deferredReconcileTimerRef.current = undefined;
        }
        restoreBrowseState();
        setAssets(previousAssets);
        setTrashedAssets(previousTrashedAssets);
        setSearchTotal(previousSearchTotal);
        setAllAssetCount(previousAllAssetCount);
      };
    },
    [
      allAssetCount,
      assets,
      removeLocallyFromBrowse,
      searchTotal,
      trashedAssets, setAllAssetCount, setAssets, setSearchTotal, setTrashedAssets, localAssetRemovalGenerationRef, reloadCurrentContentRef, workspaceCanvasRef],
  );
  return { queryDefinitionForWorkspaceBrowseState, queryDefinitionForNavigationRequest, resetDiscoveryIfNavigationReplacesLive, applySearchResult, reloadCurrentContent, deferredReconcileTimerRef, applyLocalAssetRemoval, currentSearchScope };
}
