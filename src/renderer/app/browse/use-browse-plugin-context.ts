import type { RefObject } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { AppLocale } from "../../i18n/types";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { type PluginContributionContext } from "../../../plugins/plugin-context";
import { type SortDefinition } from "../../../shared/asset-types";
import { viewportPriorityReportKey } from "../../../shared/viewport-priority";
import { buildActiveFilterChips } from "../../filters/active-discovery-filters";
import { isCardHoverPreviewable } from "../../browse/asset-card-hover-preview";
import { resolveBrowseEmptyState, resolveImportMenuCopy } from "../../browse/browse-empty-state";
import { browseRankFromPublishedId } from "../../browse/browse-window-slots";
import { isGeometryPlaceholder } from "../../browse/use-virtual-browse-session";
import { type VirtualBrowseLayout, virtualLayoutPublishedId } from "../../browse/virtual-browse-layout";
import { readPublishedCanvasAssetLayout, readPublishedCanvasAssetLayoutIndex } from "../../browse/canvas-asset-layout";
import { hasFeatureHintBeenShown, isFeatureHintEnabled } from "../../common/feature-hint-preferences";
import { filteredFolderBrowseEntries } from "../../filters/filtered-folder-visibility";
import { buildLinkedFolderBreadcrumbTrail, buildManagedFolderBreadcrumbTrail } from "../../folders/folder-breadcrumb-trail";
import { resolveBrowseCanvasBodyLayout } from "../../browse/folder-browse-canvas";
import { buildPluginBrowseScope, buildPluginViewerState } from "../../plugins/plugin-context-state";
import { createPluginMenuContributionContext } from "../../plugins/plugin-contribution-context";
import { shouldFlashRecursiveSubfoldersHint } from "../../folders/recursive-subfolders-hint";
import { buildScopeBreadcrumbSegments } from "../../search/ScopeBreadcrumbs";
import { browseFields, type BrowseState } from "../../stores/browse-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { type QueryState } from "../../stores/query-store";
import { selectionFields, type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { buildTrashBreadcrumbHops, filterTrashedFoldersAtTombstone } from "../../trash/trash-browse";
import { trashedFoldersToBrowseEntries } from "../../trash/trashed-folder-entries";
import { useAssetCardHoverPreview } from "../../browse/use-asset-card-hover-preview";
import { useFilteredFolderCounts } from "../../filters/use-filtered-folder-counts";
import { collectIntersectingCanvasAssetIds, composeBrowseViewportPriorityBands, orderedIdsForViewportPriorityReport } from "../../browse/viewport-priority-report";
import { type QueryFilterSnapshot, type SearchDefinition } from "../shared/app-shared";
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface UseBrowsePluginContextDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  reportedVisibleWindowKeyRef: RefObject<string>;
  interactionGenerationRef: RefObject<number>;
  viewportScrollTopRef: RefObject<number | undefined>;
  visibleVirtualBrowseLayout: VirtualBrowseLayout | null;
  visibleBrowseLayout: { assetId: string; width: number | null; height: number | null; previewArtifactId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; displayName?: string | undefined; relativeFilePath?: string | undefined; byteSize?: number | undefined; modifiedAt?: string | undefined; rating?: number | undefined; mediaType?: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other" | undefined; }[];
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  viewportGenerationRef: RefObject<number>;
  visibleWindowAssetIdsRef: RefObject<ReadonlySet<string>>;
  assetViewMode: "grid" | "masonry";
  browseLayout: BrowseState["browseLayout"];
  virtualBrowseLayout: BrowseState["virtualBrowseLayout"];
  shuffleOrder: number[] | null;
  ensureBrowseVisibleIndices: (indices: readonly number[]) => Promise<void>;
  ensureBrowseVisibleRange: (startIndex: number, endIndex: number) => Promise<void>;
  selectedFolderId: string | undefined;
  showTrash: NavigationState["showTrash"];
  activeTagId: NavigationState["activeTagId"];
  searchValue: QueryState["searchValue"];
  colorFilter: QueryState["colorFilter"];
  excludeColorFilter: QueryState["excludeColorFilter"];
  formatFilter: QueryState["formatFilter"];
  excludeFormatFilter: QueryState["excludeFormatFilter"];
  tagFilter: QueryState["tagFilter"];
  excludeTagFilter: QueryState["excludeTagFilter"];
  excludedTagFilter: QueryState["excludedTagFilter"];
  tagFilterMatch: QueryState["tagFilterMatch"];
  ratingFilter: QueryState["ratingFilter"];
  excludeRatingFilter: QueryState["excludeRatingFilter"];
  favoriteFilter: QueryState["favoriteFilter"];
  sourceUrlFilter: QueryState["sourceUrlFilter"];
  availabilityFilter: QueryState["availabilityFilter"];
  excludeAvailabilityFilter: QueryState["excludeAvailabilityFilter"];
  widthRange: QueryState["widthRange"];
  heightRange: QueryState["heightRange"];
  aspectRatioRange: QueryState["aspectRatioRange"];
  aspectRatioRanges: QueryState["aspectRatioRanges"];
  longEdgeRange: QueryState["longEdgeRange"];
  durationRange: QueryState["durationRange"];
  previewAsset: PreviewState["previewAsset"];
  selectedAssetIds: SelectionState["selectedAssetIds"];
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  busy: boolean;
  locale: AppLocale;
  assetScope: NavigationState["assetScope"];
  tagFilterExpression: QueryState["tagFilterExpression"];
  tagFilterMode: QueryState["tagFilterMode"];
  includeAiTagFilter: QueryState["includeAiTagFilter"];
  includeAiRatingFilter: QueryState["includeAiRatingFilter"];
  selectedFolder: { folderId: string; parentFolderId: string | null; name: string; relativePath: string; directAssetCount: number; childFolderCount: number; createdAt?: string | undefined; appearance?: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null | undefined; } | undefined;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  showIgnoredItems: QueryState["showIgnoredItems"];
  filteredFolderCountRefreshToken: BrowseState["filteredFolderCountRefreshToken"];
  folderBrowseEntries: BrowseState["folderBrowseEntries"];
  trashedFolders: NavigationState["trashedFolders"];
  trashBrowseTombstoneId: BrowseState["trashBrowseTombstoneId"];
  t: TranslateFn;
  tags: NavigationState["tags"];
  folders: NavigationState["folders"];
  linkedFolders: NavigationState["linkedFolders"];
  recursiveHintKey: string | null;
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  folderRecursive: NavigationState["folderRecursive"];
  featureHintPrefs: NavigationState["featureHintPrefs"];
  selectedAssetId: SelectionState["selectedAssetId"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useBrowsePluginContext({ api, library, workspaceCanvasRef, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, visibleVirtualBrowseLayout, visibleBrowseLayout, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, browseLayout, virtualBrowseLayout, shuffleOrder, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, selectedFolderId, showTrash, activeTagId, searchValue, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, previewAsset, selectedAssetIds, visibleAssets, busy, locale, assetScope, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, selectedFolder, currentQueryDefinition, showIgnoredItems, filteredFolderCountRefreshToken, folderBrowseEntries, trashedFolders, trashBrowseTombstoneId, t, tags, folders, linkedFolders, recursiveHintKey, showTagManagement, showPluginSidebarView, folderRecursive, featureHintPrefs, selectedAssetId }: UseBrowsePluginContextDeps) {

  // Report mounted cards and real layout slots. A fresh scrollbar destination
  // can queue its thumbnail work before the page summaries mount, while the
  // compact-layout scroll listener below fetches those summaries in parallel.
  useEffect(() => {
    if (!api || !library) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    // A new browse layout can follow an asset mutation while the visible IDs
    // stay identical. Reset the renderer-side guard so it can re-arm the
    // Worker after the Worker invalidates its corresponding key.
    reportedVisibleWindowKeyRef.current = "";
    interactionGenerationRef.current += 1;
    viewportScrollTopRef.current = undefined;
    let frame: number | undefined;
    let debounceTimer: number | undefined;
    const report = () => {
      frame = undefined;
      const intersectingIds = collectIntersectingCanvasAssetIds(
        canvas,
        (assetId) => isGeometryPlaceholder({ assetId }),
      );
      const orderedIds = orderedIdsForViewportPriorityReport({
        visibleIds: intersectingIds,
        ...(visibleVirtualBrowseLayout
          ? {
              virtualLayout: {
                indexOf: (assetId) => visibleVirtualBrowseLayout.indexByAssetId.get(assetId),
                idAt: (index) => {
                  const published = virtualLayoutPublishedId(visibleVirtualBrowseLayout, index);
                  return isGeometryPlaceholder({ assetId: published }) ? undefined : published;
                },
                total: visibleVirtualBrowseLayout.total,
              },
            }
          : {}),
        fallbackOrderedIds: visibleBrowseLayout.map((entry) => entry.assetId),
      });
      const bands = composeBrowseViewportPriorityBands({
        intersectingIds,
        focusedIds: [
          previewAssetRef.current?.assetId,
          selectionFields.get("selectedAssetId"),
        ],
        orderedIds,
        loadedIds: browseFields.get("assets").map((asset) => asset.assetId),
        scrollTop: canvas.scrollTop,
        previousScrollTop: viewportScrollTopRef.current,
        viewportHeight: canvas.clientHeight,
      });
      if (!bands) return;
      viewportScrollTopRef.current = canvas.scrollTop;
      const key = viewportPriorityReportKey(library.libraryId, bands, 0);
      if (key === reportedVisibleWindowKeyRef.current) return;
      reportedVisibleWindowKeyRef.current = key;
      viewportGenerationRef.current += 1;
      visibleWindowAssetIdsRef.current = new Set(bands.visible);
      void api.reportVisibleWindow({
        libraryId: library.libraryId,
        assetIds: bands.visible,
        consumerId: `browse:${window.name || "main"}`,
        interactionGeneration: interactionGenerationRef.current,
        viewportGeneration: viewportGenerationRef.current,
        direction: bands.direction,
        focusedAssetIds: bands.focused,
        nearForwardAssetIds: bands.nearForward,
        nearBackwardAssetIds: bands.nearBackward,
        scopeWarmAssetIds: bands.scopeWarm,
      });
    };
    const schedule = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = undefined;
        frame = window.requestAnimationFrame(report);
      }, 50);
    };
    canvas.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      canvas.removeEventListener("scroll", schedule);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    };
  }, [api, library, assetViewMode, browseLayout, visibleVirtualBrowseLayout, visibleBrowseLayout, interactionGenerationRef, previewAssetRef, reportedVisibleWindowKeyRef, viewportGenerationRef, viewportScrollTopRef, visibleWindowAssetIdsRef, workspaceCanvasRef]);

  // Map the scrollbar to the compact real-asset index. One-frame coalescing
  // avoids request spam without spending 50ms of the 500ms loading budget.
  useEffect(() => {
    if (!api || !library) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const rankById = virtualBrowseLayout
      ? virtualBrowseLayout.indexByAssetId
      : new Map(
          browseLayout.map((entry, index) => [entry.assetId, index] as const),
        );
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        const total = virtualBrowseLayout?.total ?? browseLayout.length;
        if (total === 0) return;
        const canvasRect = canvas.getBoundingClientRect();
        const visibleRanks: number[] = [];
        for (const grid of canvas.querySelectorAll<HTMLElement>(
          ".masonry-columns, .justified-rows",
        )) {
          const layout = readPublishedCanvasAssetLayout(grid);
          const layoutIndex = readPublishedCanvasAssetLayoutIndex(grid);
          const gridRect = grid.getBoundingClientRect();
          if (layout) {
            const gridContentTop = gridRect.top - canvasRect.top + canvas.scrollTop;
            const viewTop = canvas.scrollTop - gridContentTop;
            const viewBottom = viewTop + canvas.clientHeight;
            for (const item of layout) {
              if (item.y + item.height < viewTop || item.y > viewBottom) continue;
              const rank = browseRankFromPublishedId(item.id, rankById);
              if (rank !== undefined && rank >= 0 && rank < total) {
                visibleRanks.push(rank);
              }
            }
          } else if (layoutIndex && layoutIndex.total > 0) {
            const gridContentTop = gridRect.top - canvasRect.top + canvas.scrollTop;
            const viewTop = canvas.scrollTop - gridContentTop;
            const viewBottom = viewTop + canvas.clientHeight;
            layoutIndex.forEachIntersecting(
              {
                left: 0,
                top: viewTop,
                right: Math.max(1, gridRect.width),
                bottom: viewBottom,
              },
              (item) => {
                const rank = browseRankFromPublishedId(item.id, rankById);
                if (rank !== undefined && rank >= 0 && rank < total) {
                  visibleRanks.push(rank);
                }
              },
            );
          } else {
            for (const slot of grid.querySelectorAll<HTMLElement>("[data-layout-index]")) {
              const rect = slot.getBoundingClientRect();
              if (
                rect.bottom <= canvasRect.top
                || rect.top >= canvasRect.bottom
                || rect.right <= canvasRect.left
                || rect.left >= canvasRect.right
              ) continue;
              const rank = Number(slot.dataset.layoutIndex);
              if (Number.isSafeInteger(rank) && rank >= 0 && rank < total) {
                visibleRanks.push(rank);
              }
            }
          }
        }
        if (visibleRanks.length > 0) {
          if (shuffleOrder) {
            void ensureBrowseVisibleIndices(visibleRanks);
          } else {
            void ensureBrowseVisibleRange(
              Math.min(...visibleRanks),
              Math.max(...visibleRanks),
            );
          }
          return;
        }
        const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
        const ratio = maxScroll <= 0 ? 0 : canvas.scrollTop / maxScroll;
        const displayCenter = Math.round(ratio * Math.max(0, total - 1));
        const sourceCenter = shuffleOrder?.[displayCenter] ?? displayCenter;
        // Neighbor pages are added by browsePageOffsetsForRange. Passing a
        // ±page-size span here would queue 3–4 windows behind a jump.
        if (shuffleOrder) {
          void ensureBrowseVisibleIndices([sourceCenter]);
        } else {
          void ensureBrowseVisibleRange(sourceCenter, sourceCenter);
        }
      });
    };
    canvas.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      canvas.removeEventListener("scroll", schedule);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [
    api,
    browseLayout,
    ensureBrowseVisibleRange,
    ensureBrowseVisibleIndices,
    library,
    shuffleOrder,
    virtualBrowseLayout, workspaceCanvasRef]);

  const pluginBrowseScope = useMemo<Partial<PluginContributionContext["browse"]>>(
    () => buildPluginBrowseScope({
      selectedFolderId,
      showTrash,
      tagId: activeTagId,
      searchValue,
      filter: {
        colorFilter,
        excludeColorFilter,
        formatFilter,
        excludeFormatFilter,
        tagFilter,
        excludeTagFilter,
        excludedTagFilter,
        tagFilterMatch,
        ratingFilter,
        excludeRatingFilter,
        favoriteFilter,
        sourceUrlFilter,
        availabilityFilter,
        excludeAvailabilityFilter,
        widthRange,
        heightRange,
        aspectRatioRange,
        aspectRatioRanges,
        longEdgeRange,
        durationRange,
      },
    }),
    [
      activeTagId,
      aspectRatioRange,
      aspectRatioRanges,
      availabilityFilter,
      colorFilter,
      durationRange,
      excludeAvailabilityFilter,
      excludeColorFilter,
      excludeFormatFilter,
      excludeRatingFilter,
      excludeTagFilter,
      excludedTagFilter,
      favoriteFilter,
      formatFilter,
      heightRange,
      ratingFilter,
      searchValue,
      selectedFolderId,
      showTrash,
      sourceUrlFilter,
      tagFilter,
      tagFilterMatch,
      widthRange,
      longEdgeRange,
    ],
  );
  const pluginViewerState = useMemo<Partial<PluginContributionContext["viewer"]>>(
    () => buildPluginViewerState(previewAsset, Boolean(document.fullscreenElement)),
    [previewAsset],
  );
  const pluginSurfaceContext = useMemo(() => createPluginMenuContributionContext({
    descriptor: { type: "workspace", assetIds: [...selectedAssetIds] },
    assets: visibleAssets,
    libraryId: library?.libraryId,
    busy,
    locale,
    browse: pluginBrowseScope,
    viewer: pluginViewerState,
  }), [busy, library?.libraryId, locale, pluginBrowseScope, pluginViewerState, selectedAssetIds, visibleAssets]);
  const selectedVisibleAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedAssetIds.includes(asset.assetId)),
    [selectedAssetIds, visibleAssets],
  );

  // Serpent-6pcd: assets at the current trash hop only (no source-folder grouping).
  const assetRenderSections = useMemo(
    () => [{ key: "", label: null as string | null, assets: visibleAssets }],
    [visibleAssets],
  );
  // CU-U1: origin chip context for recursive folder / mixed-folder surfaces.
  const sourceBadgeContext = useMemo(() => {
    const mixedFolderBrowse =
      Boolean(searchValue.trim()) ||
      Boolean(activeTagId);
    return {
      assetScope,
      mixedFolderBrowse,
    };
  }, [
    assetScope,
    searchValue,
    activeTagId,
  ]);

  const importMenuCopy = resolveImportMenuCopy();

  const browseEmptyState = useMemo(() => {
    // The default "hide text" format filter does not count as narrowing, so an
    // empty library still shows the import call to action.
    const defaultFormatFilter = formatFilter === "text" && excludeFormatFilter;
    const discoverySnapshot = {
      colorFilter,
      excludeColorFilter,
      formatFilter: defaultFormatFilter ? "" : formatFilter,
      excludeFormatFilter: defaultFormatFilter ? false : excludeFormatFilter,
      tagFilter,
      tagFilterExpression,
      tagFilterMode,
      excludeTagFilter,
      excludedTagFilter,
      includeAiTagFilter,
      ratingFilter,
      excludeRatingFilter,
      includeAiRatingFilter,
      favoriteFilter,
      sourceUrlFilter,
      availabilityFilter,
      excludeAvailabilityFilter,
      widthRange,
      heightRange,
      aspectRatioRange,
      aspectRatioRanges,
      longEdgeRange,
      durationRange,
    };
    const hasActiveDiscovery =
      searchValue.trim() !== "" ||
      buildActiveFilterChips(discoverySnapshot).length > 0;
    return resolveBrowseEmptyState({
      showTrash,
      hasActiveDiscovery,
      hasSelectedFolder: Boolean(selectedFolder),
    });
  }, [
    showTrash,
    searchValue,
    selectedFolder,
    colorFilter,
    excludeColorFilter,
    formatFilter,
    excludeFormatFilter,
    tagFilter,
    tagFilterExpression,
    tagFilterMode,
    excludeTagFilter,
    excludedTagFilter,
    includeAiTagFilter,
    ratingFilter,
    excludeRatingFilter,
    includeAiRatingFilter,
    favoriteFilter,
    sourceUrlFilter,
    availabilityFilter,
    excludeAvailabilityFilter,
    widthRange,
    heightRange,
    aspectRatioRange,
    aspectRatioRanges,
    longEdgeRange,
    durationRange,
  ]);

  // CANVAS-022: folders-only (recursive off, zero direct assets) must not
  // mount an empty asset grid — its min-height:100% left a large void.
  const filteredFolderCounts = useFilteredFolderCounts({
    api,
    libraryId: library?.libraryId,
    filters: currentQueryDefinition({ searchValue: null }).filters,
    showIgnored: showIgnoredItems,
    enabled: !showTrash,
    refreshToken: filteredFolderCountRefreshToken,
  });
  const canvasFolderBrowseEntries = useMemo(() => {
    if (!showTrash) return filteredFolderBrowseEntries(folderBrowseEntries, filteredFolderCounts);
    return trashedFoldersToBrowseEntries(
      filterTrashedFoldersAtTombstone(trashedFolders, trashBrowseTombstoneId),
    );
  }, [folderBrowseEntries, filteredFolderCounts, showTrash, trashBrowseTombstoneId, trashedFolders]);
  const trashBreadcrumbHops = useMemo(
    () =>
      showTrash
        ? buildTrashBreadcrumbHops(
            trashedFolders,
            trashBrowseTombstoneId,
            t("scope.trash"),
          )
        : [],
    [showTrash, t, trashBrowseTombstoneId, trashedFolders],
  );
  const scopeBreadcrumbSegments = buildScopeBreadcrumbSegments(
    {
      showTrash,
      trashBreadcrumbHops,
      activeTagLabel: activeTagId
        ? (tags.find((tag) => tag.tagId === activeTagId)?.name ?? null)
        : null,
      assetScope,
      folderTrail:
        assetScope !== "all" && assetScope !== "root"
          ? buildManagedFolderBreadcrumbTrail(folders, assetScope).length > 0
            ? buildManagedFolderBreadcrumbTrail(folders, assetScope)
            : buildLinkedFolderBreadcrumbTrail(linkedFolders, assetScope)
          : [],
      linkedFolderLabel: null,
    },
    t,
  );
  const browseCanvasBodyLayout = resolveBrowseCanvasBodyLayout(
    visibleAssets.length,
    canvasFolderBrowseEntries.length,
  );

  // Serpent-b8a853: the include-subfolders hint pulses only for the folder-scope
  // button, in a folder browsing mode that shows
  // child-folder cards but zero direct assets, while the recursive toggle is
  // off, the global feature-hint switch is on, and the hint is not yet
  // dismissed (the user has never expanded this folder's subfolders). The
  // pulse is a pure derived state, so it keeps breathing while the condition
  // holds and stops the moment the user enables recursive for the folder.
  const recursiveHintActive =
    recursiveHintKey !== null &&
    assetScope !== "all" &&
    assetScope !== "root" &&
    !showTrash &&
    !showTagManagement &&
    !showPluginSidebarView &&
    !activeTagId &&
    shouldFlashRecursiveSubfoldersHint({
      recursiveEnabled: folderRecursive,
      hintsEnabled: isFeatureHintEnabled(featureHintPrefs),
      alreadyDismissed: hasFeatureHintBeenShown(
        featureHintPrefs,
        recursiveHintKey,
      ),
      hasChildFoldersWithoutDirectAssets:
        browseCanvasBodyLayout.mode === "folders-only",
    });

  const visibleAssetById = useMemo(() => {
    const map = new Map<string, (typeof visibleAssets)[number]>();
    for (const asset of visibleAssets) {
      map.set(asset.assetId, asset);
    }
    return map;
  }, [visibleAssets]);

  const isHoverPreviewable = useCallback(
    (assetId: string) => {
      const asset = visibleAssetById.get(assetId);
      return asset ? isCardHoverPreviewable(asset) : false;
    },
    [visibleAssetById],
  );

  const {
    hoveredAssetId,
    setHoveredAssetId,
    clearHoveredAssetId,
    activePreviewAssetId,
    activeResolution,
    retryLiveVideoProxyFallback,
  } = useAssetCardHoverPreview({
    api,
    libraryId: library?.libraryId,
    primarySelectedAssetId: selectedAssetId,
    isPreviewable: isHoverPreviewable,
  });
  const hoveredAssetIdRef = useRef<string | null>(null);
  hoveredAssetIdRef.current = hoveredAssetId;
  return { canvasFolderBrowseEntries, setHoveredAssetId, hoveredAssetIdRef, clearHoveredAssetId, selectedVisibleAssets, pluginSurfaceContext, filteredFolderCounts, browseCanvasBodyLayout, importMenuCopy, recursiveHintActive, scopeBreadcrumbSegments, sourceBadgeContext, hoveredAssetId, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, assetRenderSections, browseEmptyState, pluginBrowseScope, pluginViewerState };
}
