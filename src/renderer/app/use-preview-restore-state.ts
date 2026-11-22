import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ResizablePanel } from "../workbench/shell/panel-auto-hide";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { KeelShellApi } from "../../shared/external-url";
import type { InspectorMultiEditModel } from "../inspector-multi-edit";
import type { MetadataSaveFields } from "../use-inspector-asset-metadata";
import type { WorkspaceTabsState } from "../workspace-tabs";
import type { PluginIframeViewDescriptor } from "../plugin-iframe-view-host";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AppLocale } from "../i18n/types";
import type { CanvasPreferences } from "../canvas-preferences";
import type { WorkspaceNavHistory } from "../workbench/workspace/workspace-nav-history";
import type { SearchQuery, SearchScope } from "../../shared/asset-types";
import type { SemanticSearchPageSize } from "../semantic-search-preferences";
import type { BrowseFirstPage } from "../use-browse-pagination";
import { type AssetSummary, type FilterClause, type SortDefinition } from "../../shared/asset-types";
import { type AiProgressJobUpdate } from "../ai-analyze-progress";
import { scheduleAnchorRestore, type ScrollOffsetSnapshot } from "../canvas-reflow-restore";
import { type CreateLibraryPhase } from "../CreateDialog";
import { type LibraryViewSessionToken } from "../library-view-session";
import { type PendingAssetReveal } from "../pending-asset-reveal";
import { type AiState } from "../stores/ai-store";
import { type BrowseState } from "../stores/browse-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type InspectorState } from "../stores/inspector-store";
import { type AssetScope, type NavigationState } from "../stores/navigation-store";
import { type PreviewState } from "../stores/preview-store";
import { type QueryState } from "../stores/query-store";
import { type SelectionState } from "../stores/selection-store";
import { type SessionState } from "../stores/session-store";
import { type TransfersState } from "../stores/transfers-store";
import { type WorkspaceState } from "../stores/workspace-store";
import { type CanvasAnchor } from "../workbench/collection/canvas-scroll-anchor";
import { type BrowseViewSnapshot } from "../workbench/collection/view-restore";
import { type WorkspaceNavViewport } from "../workbench/workspace/workspace-nav-history";
import { type QueryFilterSnapshot, type SearchDefinition } from "./app-shared";
import { useAssetDragState } from "./use-asset-drag-state";
import { useBrowsePluginContext } from "./use-browse-plugin-context";
import { useBrowseSelection } from "./use-browse-selection";
import { useCanvasEffects } from "./use-canvas-effects";
import { useCloseAssetPreview } from "./use-close-asset-preview";
import { useContentLoading } from "./use-content-loading";
import { useEffect, useLayoutEffect, useRef } from "react";

export interface UsePreviewRestoreStateDeps {
  panelWidthSnapshotRef: RefObject<{ nav: number; inspector: number; }>;
  navPanelWidth: number;
  inspectorPanelWidth: number;
  reflowAnchorRef: RefObject<CanvasAnchor | null>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  reflowScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  panelResizeLockRef: RefObject<boolean>;
  reflowRestoreFrameRef: RefObject<number | null>;
  panelResizingRef: RefObject<ResizablePanel | null>;
  cardSizeRestoreFrameRef: RefObject<number | null>;
  library: SessionState["library"];
  api: KeelLibraryApi | undefined;
  setFindSimilarSource: Dispatch<SetStateAction<NavigationState["findSimilarSource"]>>;
  aiAnalyzing: AiState["aiAnalyzing"];
  lastAiBatchJobIdsRef: RefObject<string[]>;
  aiBatchStatusRequestRef: RefObject<number>;
  aiBatchJobIdsRef: RefObject<string[]>;
  aiBatchSkippedCountRef: RefObject<number>;
  aiBatchKnownJobsRef: RefObject<AiProgressJobUpdate[]>;
  aiBatchCounterBaselineRef: RefObject<{ succeeded: number; failed: number; }>;
  analyzingAssetIdRef: RefObject<string | null>;
  lastAiBatchAssetIdRef: RefObject<string | null>;
  analyzingBatchSizeRef: RefObject<number>;
  setAiBatchProgress: Dispatch<SetStateAction<AiState["aiBatchProgress"]>>;
  setAiAnalyzing: Dispatch<SetStateAction<AiState["aiAnalyzing"]>>;
  setAiProgressBannerVisible: Dispatch<SetStateAction<AiState["aiProgressBannerVisible"]>>;
  assetScope: NavigationState["assetScope"];
  folders: NavigationState["folders"];
  showTrash: NavigationState["showTrash"];
  trashedAssets: BrowseState["trashedAssets"];
  selectedAssetId: SelectionState["selectedAssetId"];
  assets: BrowseState["assets"];
  browseLayout: BrowseState["browseLayout"];
  virtualBrowseLayout: BrowseState["virtualBrowseLayout"];
  shellApi: KeelShellApi | undefined;
  selectedAssetIds: SelectionState["selectedAssetIds"];
  assetMetadata: InspectorState["assetMetadata"];
  multiEdit: InspectorMultiEditModel | null;
  editDescription: InspectorState["editDescription"];
  editFavorite: InspectorState["editFavorite"];
  editSourceUrl: InspectorState["editSourceUrl"];
  editAuthor: InspectorState["editAuthor"];
  descriptionIsAi: InspectorState["descriptionIsAi"];
  aiContent: InspectorState["aiContent"];
  setEditDescription: Dispatch<SetStateAction<InspectorState["editDescription"]>>;
  setEditRating: Dispatch<SetStateAction<InspectorState["editRating"]>>;
  setEditFavorite: Dispatch<SetStateAction<InspectorState["editFavorite"]>>;
  setEditSourceUrl: Dispatch<SetStateAction<InspectorState["editSourceUrl"]>>;
  setEditAuthor: Dispatch<SetStateAction<InspectorState["editAuthor"]>>;
  setDescriptionIsAi: Dispatch<SetStateAction<InspectorState["descriptionIsAi"]>>;
  setAiContent: Dispatch<SetStateAction<InspectorState["aiContent"]>>;
  saveMetadata: (fields: MetadataSaveFields) => Promise<void>;
  saveMetadataForSelection: (assetIds: readonly string[], fields: { description?: string; favorite?: boolean; palette?: string[]; sourcePageUrl?: string; author?: string; }) => Promise<void>;
  batchSetRatingForSelection: (rating: number, assetIds: string[]) => Promise<void>;
  loadMetadata: () => Promise<void>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  setError: (text: string | null) => void;
  trashedFolders: NavigationState["trashedFolders"];
  trashBrowseTombstoneId: BrowseState["trashBrowseTombstoneId"];
  shuffleSeed: QueryState["shuffleSeed"];
  workspaceTabsState: WorkspaceTabsState;
  linkedFolders: NavigationState["linkedFolders"];
  tags: NavigationState["tags"];
  pluginSidebarViews: PluginIframeViewDescriptor[];
  t: TranslateFn;
  reportedVisibleWindowKeyRef: RefObject<string>;
  interactionGenerationRef: RefObject<number>;
  viewportScrollTopRef: RefObject<number | undefined>;
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  viewportGenerationRef: RefObject<number>;
  visibleWindowAssetIdsRef: RefObject<ReadonlySet<string>>;
  assetViewMode: "grid" | "masonry";
  ensureBrowseVisibleIndices: (indices: readonly number[]) => Promise<void>;
  ensureBrowseVisibleRange: (startIndex: number, endIndex: number) => Promise<void>;
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
  busy: boolean;
  locale: AppLocale;
  tagFilterExpression: QueryState["tagFilterExpression"];
  tagFilterMode: QueryState["tagFilterMode"];
  includeAiTagFilter: QueryState["includeAiTagFilter"];
  includeAiRatingFilter: QueryState["includeAiRatingFilter"];
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  showIgnoredItems: QueryState["showIgnoredItems"];
  filteredFolderCountRefreshToken: BrowseState["filteredFolderCountRefreshToken"];
  folderBrowseEntries: BrowseState["folderBrowseEntries"];
  recursiveHintKey: string | null;
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  folderRecursive: NavigationState["folderRecursive"];
  featureHintPrefs: NavigationState["featureHintPrefs"];
  masonryGridWidth: number;
  assetCardSize: number;
  canvasPrefs: CanvasPreferences;
  assetGridRef: RefObject<HTMLDivElement | null>;
  setMasonryGridWidth: Dispatch<SetStateAction<number>>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  marqueeBoxRef: RefObject<HTMLDivElement | null>;
  selectedFolderIds: SelectionState["selectedFolderIds"];
  setSelectedFolderIds: Dispatch<SetStateAction<SelectionState["selectedFolderIds"]>>;
  searchTotal: BrowseState["searchTotal"];
  fetchBrowseScopeAssetIds: () => Promise<string[] | null>;
  editableTextFocused: boolean;
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  setWarning: (text: string | null) => void;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  setFolderBrowseEntries: Dispatch<SetStateAction<BrowseState["folderBrowseEntries"]>>;
  showFolderCardsWhenRecursive: NavigationState["showFolderCardsWhenRecursive"];
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  folderBrowseRefreshToken: BrowseState["folderBrowseRefreshToken"];
  folderCoverCandidateAssetIdsRef: RefObject<ReadonlySet<string>>;
  folderNavigationCovers: BrowseState["folderNavigationCovers"];
  cardResizeAnchorRef: RefObject<CanvasAnchor | null>;
  cardResizeScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  setCanvasPrefs: (action: SetStateAction<CanvasPreferences>) => void;
  setFolderCanvasContentWidthPx: Dispatch<SetStateAction<number>>;
  setCanvasWidthPx: Dispatch<SetStateAction<number>>;
  previewRestoringRef: RefObject<boolean>;
  previewRestoring: PreviewState["previewRestoring"];
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  workspaceHistoryReplayActiveRef: RefObject<boolean>;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  pendingViewportRestoreRef: RefObject<WorkspaceNavViewport | null>;
  wakeViewerChrome: () => void;
  setPreviewRestoring: Dispatch<SetStateAction<PreviewState["previewRestoring"]>>;
  setPreviewCanvasReady: Dispatch<SetStateAction<PreviewState["previewCanvasReady"]>>;
  clearPreviewScrollHold: () => void;
  setPreviewAsset: Dispatch<SetStateAction<PreviewState["previewAsset"]>>;
  syncActiveWorkspaceTabLocation: () => void;
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  pendingWorkspacePreviewRef: RefObject<{ assetId: string; viewport: WorkspaceNavViewport; isCurrent: () => boolean; } | null>;
  lastPreviewRestoredTopRef: RefObject<number>;
  armPreviewScrollHold: (restoredTop: number) => void;
  showMissingLinkedPublishRef: RefObject<Promise<void>>;
  contentLoadGenerationRef: RefObject<number>;
  navigationHydrationAbortRef: RefObject<AbortController | null>;
  setAllAssetCount: Dispatch<SetStateAction<BrowseState["allAssetCount"]>>;
  setRootAssetCount: Dispatch<SetStateAction<BrowseState["rootAssetCount"]>>;
  setTrashedAssetCount: Dispatch<SetStateAction<BrowseState["trashedAssetCount"]>>;
  setFolders: Dispatch<SetStateAction<NavigationState["folders"]>>;
  setLinkedFolders: Dispatch<SetStateAction<NavigationState["linkedFolders"]>>;
  setTags: Dispatch<SetStateAction<NavigationState["tags"]>>;
  setTrashedFolders: Dispatch<SetStateAction<NavigationState["trashedFolders"]>>;
  setFolderNavigationCovers: Dispatch<SetStateAction<BrowseState["folderNavigationCovers"]>>;
  setFolderCustomCoverIds: Dispatch<SetStateAction<BrowseState["folderCustomCoverIds"]>>;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  setSearchSnippets: Dispatch<SetStateAction<BrowseState["searchSnippets"]>>;
  beginBrowsePageClearingSimilar: (definition: { kind: "search"; libraryId: string; query: SearchQuery | null; filters?: FilterClause[] | null; scope?: SearchScope | null; sort?: SortDefinition | null; showIgnored: boolean; sessionId?: string; target: "assets" | "trash"; pinnedOrder?: boolean; rankedAssetIds?: readonly string[]; rankedPageSize?: SemanticSearchPageSize; similaritySourceAssetId?: string; }, firstPage: BrowseFirstPage) => void;
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  setFolderRecursive: Dispatch<SetStateAction<NavigationState["folderRecursive"]>>;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setAssetScope: Dispatch<SetStateAction<NavigationState["assetScope"]>>;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setBrowserSessionReady: Dispatch<SetStateAction<SessionState["browserSessionReady"]>>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  restoreWorkspaceTabsForLibrary: (libraryId: string) => void;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  browserSessionReady: SessionState["browserSessionReady"];
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  scriptSandboxPreviewOpen: DialogsState["scriptSandboxPreviewOpen"];
  importLibraryChooserOpen: TransfersState["importLibraryChooserOpen"];
  openLibraryChooserOpen: DialogsState["openLibraryChooserOpen"];
  importValidated: TransfersState["importValidated"];
  importProgress: TransfersState["importProgress"];
  appSettingsOpen: DialogsState["appSettingsOpen"];
  dialog: DialogsState["dialog"];
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  setDialog: Dispatch<SetStateAction<DialogsState["dialog"]>>;
  hadLibraryRef: RefObject<boolean>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function usePreviewRestoreState({ panelWidthSnapshotRef, navPanelWidth, inspectorPanelWidth, reflowAnchorRef, workspaceCanvasRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardSizeRestoreFrameRef, library, api, setFindSimilarSource, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, assetScope, folders, showTrash, trashedAssets, selectedAssetId, assets, browseLayout, virtualBrowseLayout, shellApi, selectedAssetIds, assetMetadata, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, descriptionIsAi, aiContent, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setDescriptionIsAi, setAiContent, saveMetadata, saveMetadataForSelection, batchSetRatingForSelection, loadMetadata, setNotice, setError, trashedFolders, trashBrowseTombstoneId, shuffleSeed, workspaceTabsState, linkedFolders, tags, pluginSidebarViews, t, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, activeTagId, searchValue, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, previewAsset, busy, locale, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, currentQueryDefinition, showIgnoredItems, filteredFolderCountRefreshToken, folderBrowseEntries, recursiveHintKey, showTagManagement, showPluginSidebarView, folderRecursive, featureHintPrefs, masonryGridWidth, assetCardSize, canvasPrefs, assetGridRef, setMasonryGridWidth, setSelectedAssetIds, setSelectedAssetId, marqueeBoxRef, selectedFolderIds, setSelectedFolderIds, searchTotal, fetchBrowseScopeAssetIds, editableTextFocused, showBlockingError, setWarning, ensureLibraryView, setFolderBrowseEntries, showFolderCardsWhenRecursive, isCurrentLibraryView, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, cardResizeAnchorRef, cardResizeScrollSnapshotRef, setCanvasPrefs, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewRestoringRef, previewRestoring, sortField, sortOrder, workspaceHistoryReplayActiveRef, cancelWorkspaceViewportRestoreRef, navHistoryRef, pendingViewportRestoreRef, wakeViewerChrome, setPreviewRestoring, setPreviewCanvasReady, clearPreviewScrollHold, setPreviewAsset, syncActiveWorkspaceTabLocation, setNavHistoryUi, pendingWorkspacePreviewRef, lastPreviewRestoredTopRef, armPreviewScrollHold, showMissingLinkedPublishRef, contentLoadGenerationRef, navigationHydrationAbortRef, setAllAssetCount, setRootAssetCount, setTrashedAssetCount, setFolders, setLinkedFolders, setTags, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, setSearchTotal, setSearchOffset, setSearchSnippets, beginBrowsePageClearingSimilar, setLibraryLoading, setFolderRecursive, setLibrary, setShowTrash, setTrashedAssets, setAssetScope, setActiveTagId, setTagFilter, setAssets, setBrowserSessionReady, managedImportTargetFolderIdRef, restoreWorkspaceTabsForLibrary, setUiState, browserSessionReady, refreshRecentLibraries, scriptSandboxPreviewOpen, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, importProgress, appSettingsOpen, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef }: UsePreviewRestoreStateDeps) {

  useLayoutEffect(() => {
    const previous = panelWidthSnapshotRef.current;
    if (
      previous.nav === navPanelWidth &&
      previous.inspector === inspectorPanelWidth
    ) {
      return;
    }
    panelWidthSnapshotRef.current = {
      nav: navPanelWidth,
      inspector: inspectorPanelWidth,
    };
    if (!reflowAnchorRef.current) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const snapshot = reflowScrollSnapshotRef.current;
    if (snapshot) {
      canvas.scrollLeft = Math.min(
        Math.max(0, snapshot.left),
        Math.max(0, canvas.scrollWidth - canvas.clientWidth),
      );
      canvas.scrollTop = Math.min(
        Math.max(0, snapshot.top),
        Math.max(0, canvas.scrollHeight - canvas.clientHeight),
      );
    }
    // During a drag, keep the raw offset fixed. Applying anchor deltas on
    // every width tick makes the viewport visibly slide with the divider.
    if (panelResizeLockRef.current) return;
    scheduleAnchorRestore(
      canvas,
      reflowAnchorRef.current,
      reflowRestoreFrameRef,
      10,
      () => {
        if (!panelResizingRef.current) {
          reflowAnchorRef.current = null;
          reflowScrollSnapshotRef.current = null;
        }
      },
      snapshot ?? undefined,
    );
  }, [inspectorPanelWidth, navPanelWidth, panelResizeLockRef, panelResizingRef, panelWidthSnapshotRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef, workspaceCanvasRef]);
  useEffect(
    () => () => {
      if (cardSizeRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(cardSizeRestoreFrameRef.current);
      }
      if (reflowRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(reflowRestoreFrameRef.current);
      }
      reflowAnchorRef.current = null;
      reflowScrollSnapshotRef.current = null;
    },
    [cardSizeRestoreFrameRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef],
  );
  // 筛选与排序面板：外点 / Esc 自动关闭（现代浮层语义），summary 切换不变。
  const pendingRestoredFocusRef = useRef<string | null>(null);
  const pendingRevealRef = useRef<PendingAssetReveal | null>(null);
  const chooseFolderRef = useRef<
    (
      scope: AssetScope,
      options?: { refreshSidebar?: boolean; blockingNavigation?: boolean },
    ) => Promise<void>
  >(async () => undefined);
  const revealAfterImportRef = useRef<
    (completion: { assets: AssetSummary[] }) => Promise<void>
  >(async () => undefined);
  const offerPostImportSequencesRef = useRef<
    (assets: readonly AssetSummary[]) => void
  >(() => undefined);
  const previewFocusReturnRef = useRef<string | null>(null);
  // REQ-VIEW-008: snapshot of the browse scroll position + the previewed
  // card's on-screen anchor, captured when the viewer opens so the close
  // path can correct for any reflow that happened while viewing (e.g. the
  // inspector panel toggled and changed the grid's available width).
  const previewScrollSnapshotRef = useRef<BrowseViewSnapshot | null>(null);
  const closingPreviewRef = useRef<string | null>(null);
  // Incremented whenever a viewer open/close supersedes a pending close. This
  // prevents a stale rAF/API completion from clearing the restoring state or
  // focusing the previous card after a rapid reopen of the same asset.
  const previewCloseGenerationRef = useRef(0);
  const previewRestoreFrameRef = useRef<number | null>(null);
  const cancelPreviewViewRestoreRef = useRef<(() => void) | null>(null);
  const { setMediaJobsOpen, visibleVirtualBrowseLayout, visibleBrowseLayout, shuffleOrder, selectedFolderId, visibleAssets, selectedFolder, setThumbnailFailures, selectedAsset, jobStatusCoordinatorRef, setAiJobs, workspaceTabPresentations, getManagedAssetDragIds, embeddingSelectionRef, embeddingService, mediaJobsOpen, aiConnectionFailureGate, onAiConnectionFailureAbort, pluginUiDialogOpen, aiJobs, notifyAiConnectionBatchStarted, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, setPluginJobs, controlAiJobsRef, openMediaJobs, managedFolderDragIdsRef, setPluginUiDialogOpen, semanticSearchActive, embeddingSearchReady, backgroundJobsActive, getManagedFolderDragIds, dragPreviewRef, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, managedAssetDragIdsRef, automaticPaletteRatios, displayedPalette, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, handleOpenSourceUrl, embeddingBound, handleAiConnectionFailureRetry, embeddingSelectionId } = useAssetDragState({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, library, api, setFindSimilarSource, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, assetScope, folders, showTrash, trashedAssets, selectedAssetId, assets, browseLayout, virtualBrowseLayout, shellApi, selectedAssetIds, assetMetadata, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, descriptionIsAi, aiContent, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setDescriptionIsAi, setAiContent, saveMetadata, saveMetadataForSelection, batchSetRatingForSelection, loadMetadata, setNotice, setError, trashedFolders, trashBrowseTombstoneId, shuffleSeed, workspaceTabsState, linkedFolders, tags, pluginSidebarViews, t });
  const { canvasFolderBrowseEntries, setHoveredAssetId, hoveredAssetIdRef, clearHoveredAssetId, selectedVisibleAssets, pluginSurfaceContext, filteredFolderCounts, browseCanvasBodyLayout, importMenuCopy, recursiveHintActive, scopeBreadcrumbSegments, sourceBadgeContext, hoveredAssetId, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, assetRenderSections, browseEmptyState, pluginBrowseScope, pluginViewerState } = useBrowsePluginContext({ api, library, workspaceCanvasRef, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, visibleVirtualBrowseLayout, visibleBrowseLayout, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, browseLayout, virtualBrowseLayout, shuffleOrder, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, selectedFolderId, showTrash, activeTagId, searchValue, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, previewAsset, selectedAssetIds, visibleAssets, busy, locale, assetScope, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, selectedFolder, currentQueryDefinition, showIgnoredItems, filteredFolderCountRefreshToken, folderBrowseEntries, trashedFolders, trashBrowseTombstoneId, t, tags, folders, linkedFolders, recursiveHintKey, showTagManagement, showPluginSidebarView, folderRecursive, featureHintPrefs, selectedAssetId });
  const { resizeAssetCards, selectionAnchorRef, setAssetSelectionAnchor, clearAssetSelection, selectedAssets, diskDeleteKeyboardTargets, previewIndex, browseScopeAssetIds, selectAllBrowseScope, invertBrowseScope, handleFolderCardClick, cardMouseDownRef, selectedFolderIdSet, workspaceBrowseCount, handleCanvasMouseDown, selectedIdSet, handleCardClick, selectionAssetIds, folderInspector, folderInspectorAppearance, menuSkipScope } = useBrowseSelection({ assetViewMode, visibleAssets, masonryGridWidth, assetCardSize, canvasPrefs, assetGridRef, setMasonryGridWidth, canvasFolderBrowseEntries, selectedAssetIds, setSelectedAssetIds, setSelectedAssetId, previewAsset, workspaceCanvasRef, marqueeBoxRef, selectedFolderIds, setSelectedFolderIds, setHoveredAssetId, pendingRevealRef, pendingRestoredFocusRef, folderBrowseEntries, library, assetScope, showTrash, activeTagId, folders, linkedFolders, searchValue, api, trashedAssets, assets, showTagManagement, tags, searchTotal, fetchBrowseScopeAssetIds, shellApi, editableTextFocused, t, showBlockingError, setError, setWarning, setNotice, locale, ensureLibraryView, setFolderBrowseEntries, folderRecursive, showFolderCardsWhenRecursive, showIgnoredItems, isCurrentLibraryView, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, virtualBrowseLayout, cardResizeAnchorRef, cardResizeScrollSnapshotRef, reflowRestoreFrameRef, reflowAnchorRef, reflowScrollSnapshotRef, setCanvasPrefs, cardSizeRestoreFrameRef });
  const { openAssetPreview, saveCurrentWorkspaceHistoryViewport, navigateAssetPreview, persistAssetColorSpace } = useCanvasEffects({ workspaceCanvasRef, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewAssetRef, previewRestoringRef, cardResizeAnchorRef, reflowAnchorRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardResizeScrollSnapshotRef, previewAsset, previewRestoring, cardSizeRestoreFrameRef, sortField, sortOrder, assetCardSize, resizeAssetCards, workspaceHistoryReplayActiveRef, cancelWorkspaceViewportRestoreRef, navHistoryRef, pendingViewportRestoreRef, wakeViewerChrome, previewRestoreFrameRef, previewCloseGenerationRef, closingPreviewRef, setPreviewRestoring, setPreviewCanvasReady, cancelPreviewViewRestoreRef, clearPreviewScrollHold, previewFocusReturnRef, previewScrollSnapshotRef, setSelectedAssetIds, setSelectedAssetId, selectionAnchorRef, setPreviewAsset, syncActiveWorkspaceTabLocation, setNavHistoryUi, api, library, setError, t, setNotice, pendingWorkspacePreviewRef, visibleAssets, assets });
  const { closeAssetPreview } = useCloseAssetPreview({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, previewAsset, closingPreviewRef, navHistoryRef, syncActiveWorkspaceTabLocation, setNavHistoryUi, previewCloseGenerationRef, previewRestoringRef, setPreviewRestoring, setPreviewCanvasReady, setPreviewAsset, cancelWorkspaceViewportRestoreRef, pendingViewportRestoreRef, previewFocusReturnRef, previewScrollSnapshotRef, workspaceCanvasRef, lastPreviewRestoredTopRef, armPreviewScrollHold, clearPreviewScrollHold, api, library });
  const { loadContent } = useContentLoading({ api, showMissingLinkedPublishRef, showIgnoredItems, ensureLibraryView, contentLoadGenerationRef, navigationHydrationAbortRef, isCurrentLibraryView, setAllAssetCount, setRootAssetCount, setTrashedAssetCount, setFolders, setLinkedFolders, setTags, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, t, setThumbnailFailures, setSearchTotal, setSearchOffset, setSearchSnippets, beginBrowsePageClearingSimilar, setError, locale, setLibraryLoading, setFolderRecursive, setLibrary, setShowTrash, setTrashedAssets, setAssetScope, setActiveTagId, setTagFilter, setAssets, setSelectedAssetId, setSelectedAssetIds, setAssetSelectionAnchor, setBrowserSessionReady, managedImportTargetFolderIdRef, restoreWorkspaceTabsForLibrary, pendingRestoredFocusRef, navHistoryRef, setNavHistoryUi, setUiState, library, showTrash, activeTagId, assetScope, browserSessionReady, selectedAsset, tags, workspaceCanvasRef, assets, trashedAssets, selectedAssetId, pendingRevealRef, chooseFolderRef, refreshRecentLibraries, scriptSandboxPreviewOpen, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, importProgress, appSettingsOpen, busy, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef });
  return { setMediaJobsOpen, closeAssetPreview, loadContent, jobStatusCoordinatorRef, setThumbnailFailures, setAiJobs, workspaceTabPresentations, visibleAssets, openAssetPreview, saveCurrentWorkspaceHistoryViewport, clearAssetSelection, chooseFolderRef, selectedFolderId, revealAfterImportRef, offerPostImportSequencesRef, getManagedAssetDragIds, selectionAnchorRef, pendingRevealRef, embeddingSelectionRef, embeddingService, pendingRestoredFocusRef, setAssetSelectionAnchor, hoveredAssetIdRef, clearHoveredAssetId, setHoveredAssetId, mediaJobsOpen, aiConnectionFailureGate, onAiConnectionFailureAbort, pluginUiDialogOpen, navigateAssetPreview, selectedAsset, selectedAssets, diskDeleteKeyboardTargets, selectedVisibleAssets, pluginSurfaceContext, previewIndex, selectedFolder, aiJobs, notifyAiConnectionBatchStarted, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, setPluginJobs, controlAiJobsRef, browseScopeAssetIds, selectAllBrowseScope, invertBrowseScope, openMediaJobs, filteredFolderCounts, canvasFolderBrowseEntries, browseCanvasBodyLayout, managedFolderDragIdsRef, handleFolderCardClick, cardMouseDownRef, selectedFolderIdSet, setPluginUiDialogOpen, importMenuCopy, semanticSearchActive, embeddingSearchReady, backgroundJobsActive, getManagedFolderDragIds, dragPreviewRef, recursiveHintActive, scopeBreadcrumbSegments, workspaceBrowseCount, resizeAssetCards, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, handleCanvasMouseDown, sourceBadgeContext, selectedIdSet, handleCardClick, selectionAssetIds, managedAssetDragIdsRef, hoveredAssetId, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, assetRenderSections, visibleBrowseLayout, visibleVirtualBrowseLayout, browseEmptyState, persistAssetColorSpace, automaticPaletteRatios, displayedPalette, folderInspector, folderInspectorAppearance, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, handleOpenSourceUrl, embeddingBound, handleAiConnectionFailureRetry, embeddingSelectionId, pluginBrowseScope, pluginViewerState, menuSkipScope };
}
