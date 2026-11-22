import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { KeelShellApi } from "../../shared/external-url";
import type { InspectorMultiEditModel } from "../inspector-multi-edit";
import type { MetadataSaveFields } from "../use-inspector-asset-metadata";
import type { WorkspaceTabsState } from "../workspace-tabs";
import type { PluginIframeViewDescriptor } from "../plugin-iframe-view-host";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { resolveEffectiveEmbeddingSelection } from "../../shared/embedding/library-binding";
import { computeAiBatchProgressForJobs, type AiProgressJobUpdate } from "../ai-analyze-progress";
import { dismissAssetDragPreview } from "../asset-drag-preview";
import { assetSummaryFromLayoutEntry } from "../browse-window-slots";
import { permuteVirtualBrowseLayout, virtualLayoutEntryForAsset } from "../browse/virtual-browse-layout";
import { shuffleBrowseItems, shuffledIndexOrder } from "../client-shuffle";
import { subscribeEmbeddingCatalog, subscribeEmbeddingInstallActivity } from "../embedding-catalog-events";
import type { JobStatusCoordinator } from "../job-status-coordinator";
import { countOtherLivePluginJobs, hasActivePluginJobs, selectPluginJobActivity } from "../plugin-job-activity";
import { loadSemanticSearchPreferences, subscribeSemanticSearchPreferences } from "../semantic-search-preferences";
import { semanticBackgroundWorkActive, semanticToolbarReady } from "../semantic-work";
import { type AiState } from "../stores/ai-store";
import { type BrowseState, useBrowseField } from "../stores/browse-store";
import { useDialogField } from "../stores/dialogs-store";
import { useEmbeddingField } from "../stores/embedding-store";
import { type InspectorState } from "../stores/inspector-store";
import { useJobsField } from "../stores/jobs-store";
import { type NavigationState } from "../stores/navigation-store";
import { type QueryState } from "../stores/query-store";
import { type SelectionState } from "../stores/selection-store";
import { type SessionState } from "../stores/session-store";
import { filterTrashedAssetsAtTombstone } from "../trash-browse";
import { useAiConnectionFailure } from "../use-ai-connection-failure";
import { useInspectorFieldHandlers } from "../use-inspector-field-handlers";
import { presentWorkspaceTab } from "../workspace-tab-presentation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";

export interface UseAssetDragStateDeps {
  cancelPreviewViewRestoreRef: RefObject<(() => void) | null>;
  previewRestoreFrameRef: RefObject<number | null>;
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
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useAssetDragState({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, library, api, setFindSimilarSource, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, assetScope, folders, showTrash, trashedAssets, selectedAssetId, assets, browseLayout, virtualBrowseLayout, shellApi, selectedAssetIds, assetMetadata, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, descriptionIsAi, aiContent, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setDescriptionIsAi, setAiContent, saveMetadata, saveMetadataForSelection, batchSetRatingForSelection, loadMetadata, setNotice, setError, trashedFolders, trashBrowseTombstoneId, shuffleSeed, workspaceTabsState, linkedFolders, tags, pluginSidebarViews, t }: UseAssetDragStateDeps) {
  useEffect(
    () => () => {
      cancelPreviewViewRestoreRef.current?.();
      cancelPreviewViewRestoreRef.current = null;
      if (previewRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(previewRestoreFrameRef.current);
      }
    },
    [cancelPreviewViewRestoreRef, previewRestoreFrameRef],
  );
  // REQ-DND-003: the custom drag ghost node mounted by showAssetDragPreview,
  // kept so onDragEnd can remove it from the document.
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  // HTML5-only drag selection snapshot for internal targets. Native OS drags
  // are resolved from their returned File handles instead; retaining a native
  // drag's ids here would leak a completed session into a later external drop.
  const managedAssetDragIdsRef = useRef<readonly string[] | null>(null);
  const getManagedAssetDragIds = useCallback(
    () =>
      managedAssetDragIdsRef.current
        ? [...managedAssetDragIdsRef.current]
        : null,
    [],
  );
  // Serpent-374266: the same snapshot for managed-folder drags started from the
  // browse canvas. The sidebar needs it to tell whether a folder drop target
  // would change anything; the HTML5 payload itself cannot be read during
  // dragover (protected mode).
  const managedFolderDragIdsRef = useRef<readonly string[] | null>(null);
  const getManagedFolderDragIds = useCallback(
    () =>
      managedFolderDragIdsRef.current
        ? [...managedFolderDragIdsRef.current]
        : null,
    [],
  );
  useEffect(() => {
    const clearManagedFolderDragIds = () => {
      managedFolderDragIdsRef.current = null;
    };
    window.addEventListener("dragend", clearManagedFolderDragIds);
    window.addEventListener("drop", clearManagedFolderDragIds);
    return () => {
      window.removeEventListener("dragend", clearManagedFolderDragIds);
      window.removeEventListener("drop", clearManagedFolderDragIds);
    };
  }, []);
  // Escape cancels the renderer-side drag session immediately. Native OS
  // drags are cancelled by Electron/the operating system; this also clears
  // the custom ghost and internal selection fallback so a cancelled gesture
  // cannot leak into the next drop.
  useEffect(() => {
    const handleDragCancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!managedAssetDragIdsRef.current && !dragPreviewRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      managedAssetDragIdsRef.current = null;
      dismissAssetDragPreview(dragPreviewRef.current);
      dragPreviewRef.current = null;
    };
    window.addEventListener("keydown", handleDragCancel);
    return () => window.removeEventListener("keydown", handleDragCancel);
  }, []);
  const [pluginUiDialogOpen, setPluginUiDialogOpen] = useDialogField("pluginUiDialogOpen");
  const [thumbnailFailures, setThumbnailFailures] = useBrowseField("thumbnailFailures");
  const [mediaJobsOpen, setMediaJobsOpen] = useDialogField("mediaJobsOpen");
  const loadMediaJobsRef = useRef<(quiet?: boolean) => Promise<void>>(async () => undefined);
  const [mediaJobs, setMediaJobs] = useJobsField("mediaJobs");
  const [aiJobs, setAiJobs] = useJobsField("aiJobs");
  const [pluginJobs, setPluginJobs] = useJobsField("pluginJobs");
  const [hiddenPluginJobActivityId, setHiddenPluginJobActivityId] = useJobsField("hiddenPluginJobActivityId");
  const [mediaJobsLoading, setMediaJobsLoading] = useJobsField("mediaJobsLoading");
  const [semanticSearchPrefs, setSemanticSearchPrefs] = useEmbeddingField("semanticSearchPrefs");
  const [embeddingIndex, setEmbeddingIndex] = useEmbeddingField("embeddingIndex");
  const [embeddingBinding, setEmbeddingBinding] = useEmbeddingField("embeddingBinding");
  const [embeddingForLibraryId, setEmbeddingForLibraryId] = useEmbeddingField("embeddingForLibraryId");
  const [embeddingInstall, setEmbeddingInstall] = useEmbeddingField("embeddingInstall");
  const [embeddingServices, setEmbeddingServices] = useEmbeddingField("embeddingServices");
  const [embeddingInstalling, setEmbeddingInstalling] = useEmbeddingField("embeddingInstalling");
  const embeddingRestartRef = useRef(true);
  const lastStartedSelectionRef = useRef<string | null>(null);
  const embeddingSelectionRef = useRef<string | null>(null);
  useEffect(() => subscribeSemanticSearchPreferences(() => {
    setSemanticSearchPrefs(loadSemanticSearchPreferences());
  }), [setSemanticSearchPrefs]);
  useEffect(() => subscribeEmbeddingInstallActivity(setEmbeddingInstalling), [setEmbeddingInstalling]);
  const openLibraryId = library?.libraryId ?? null;
  useEffect(() => {
    if (!api || !openLibraryId) return;
    let cancelled = false;
    const load = async () => {
      const [binding, status, services] = await Promise.all([
        api.embeddingGetBinding({ libraryId: openLibraryId }),
        api.embeddingInstallStatus(),
        api.embeddingListServices(),
      ]);
      if (cancelled) return;
      if (binding.ok) setEmbeddingBinding(binding.value);
      if (status.ok) setEmbeddingInstall(status.value);
      if (services.ok && services.value) setEmbeddingServices(services.value);
      setEmbeddingForLibraryId(openLibraryId);
      const prefs = loadSemanticSearchPreferences();
      const libraryBinding = binding.ok
        ? (binding.value.inherit ? undefined : { selectionId: binding.value.selectionId, enabled: binding.value.enabled })
        : undefined;
      const selectionId = resolveEffectiveEmbeddingSelection({
        globalEnabled: prefs.enabled,
        defaultModelId: prefs.modelId,
        libraryBinding,
      });
      const service = services.ok && services.value
        ? services.value.find((item) => item.id === selectionId) ?? null
        : null;
      const ready = semanticToolbarReady({
        selectionId,
        runtimeInstalled: status.ok ? status.value.runtimeInstalled : false,
        models: status.ok ? status.value.models : [],
        service,
      });
      const bound = Boolean(selectionId) && (
        service
          ? service.textStatus === "verified" && service.dimensions != null
          : ready
      );
      if (!bound) setFindSimilarSource(null);
    };
    void load();
    const unsubscribe = subscribeEmbeddingCatalog(() => { void load(); });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, openLibraryId, setEmbeddingBinding, setEmbeddingForLibraryId, setEmbeddingInstall, setEmbeddingServices, setFindSimilarSource]);
  const activeEmbeddingBinding = embeddingForLibraryId === openLibraryId ? embeddingBinding : null;
  const embeddingSelectionId = resolveEffectiveEmbeddingSelection({
    globalEnabled: semanticSearchPrefs.enabled,
    defaultModelId: semanticSearchPrefs.modelId,
    libraryBinding: activeEmbeddingBinding == null || activeEmbeddingBinding.inherit
      ? undefined
      : { selectionId: activeEmbeddingBinding.selectionId, enabled: activeEmbeddingBinding.enabled },
  });
  const embeddingService = embeddingServices.find((service) => service.id === embeddingSelectionId) ?? null;
  const embeddingSearchReady = semanticToolbarReady({
    selectionId: embeddingSelectionId,
    runtimeInstalled: embeddingInstall?.runtimeInstalled ?? false,
    models: embeddingInstall?.models ?? [],
    service: embeddingService,
  });
  const embeddingBound = Boolean(embeddingSelectionId) && (
    embeddingService
      ? embeddingService.textStatus === "verified" && embeddingService.dimensions != null
      : embeddingSearchReady
  );
  embeddingSelectionRef.current = embeddingSearchReady ? embeddingSelectionId : null;
  useEffect(() => {
    embeddingRestartRef.current = true;
  }, [embeddingSelectionId, library?.libraryId]);
  useEffect(() => {
    if (!api || !library) return;
    if (!embeddingSearchReady || !embeddingSelectionId) {
      const previous = lastStartedSelectionRef.current;
      lastStartedSelectionRef.current = null;
      if (!previous) return;
      void api.embeddingIndexStatus({
        libraryId: library.libraryId,
        modelId: previous,
        run: false,
        restart: false,
      }).then((result) => {
        if (result.ok) setEmbeddingIndex(result.value);
      });
      return;
    }
    lastStartedSelectionRef.current = embeddingSelectionId;
    let cancelled = false;
    const tick = () => {
      const restart = embeddingRestartRef.current;
      embeddingRestartRef.current = false;
      void api.embeddingIndexStatus({
        libraryId: library.libraryId,
        modelId: embeddingSelectionId,
        run: true,
        restart,
      }).then((result) => {
        if (cancelled || !result.ok) return;
        setEmbeddingIndex(result.value);
      });
    };
    tick();
    const timer = window.setInterval(
      tick,
      embeddingIndex.phase === "ready" || embeddingIndex.phase === "failed" || embeddingIndex.phase === "unavailable"
        ? 5_000
        : 1_500,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    api,
    library,
    embeddingSearchReady,
    embeddingSelectionId,
    embeddingIndex.phase, setEmbeddingIndex]);
  const semanticSearchActive = embeddingSearchReady && semanticSearchPrefs.searchMode === "semantic";
  const pluginJobsActive = hasActivePluginJobs(pluginJobs);
  const pluginJobActivityCandidate = selectPluginJobActivity(pluginJobs);
  const pluginJobActivity =
    pluginJobActivityCandidate?.jobId === hiddenPluginJobActivityId
      ? null
      : pluginJobActivityCandidate;
  const pluginJobQueuedMore = countOtherLivePluginJobs(
    pluginJobs,
    pluginJobActivity?.jobId,
  );
  const backgroundJobsActive = useMemo(() => {
    if (aiAnalyzing) return true;
    const mediaActive =
      (mediaJobs?.queued ?? 0) + (mediaJobs?.running ?? 0) > 0;
    const aiActive = (aiJobs?.queued ?? 0) + (aiJobs?.running ?? 0) > 0;
    return mediaActive || aiActive || pluginJobsActive || semanticBackgroundWorkActive({
      installing: embeddingInstalling,
      enabled: embeddingSearchReady,
      phase: embeddingIndex.phase,
    });
  }, [aiAnalyzing, aiJobs, embeddingIndex.phase, embeddingInstalling, embeddingSearchReady, mediaJobs, pluginJobsActive]);
  const openMediaJobs = useCallback(() => {
    setMediaJobsLoading(true);
    setMediaJobsOpen(true);
    void loadMediaJobsRef.current(true);
  }, [setMediaJobsLoading, setMediaJobsOpen]);
  const hidePluginJobActivity = useCallback((jobId: string) => {
    setHiddenPluginJobActivityId(jobId);
  }, [setHiddenPluginJobActivityId]);
  const controlAiJobsRef = useRef<
    (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>
  >(async () => undefined);
  /** Serpent-e97c00: bounded fallback status polling for the open library. */
  const jobStatusCoordinatorRef = useRef<JobStatusCoordinator | null>(null);
  const {
    gate: aiConnectionFailureGate,
    notifyBatchStarted: notifyAiConnectionBatchStarted,
    onRetry: onAiConnectionFailureRetry,
    onAbort: onAiConnectionFailureAbort,
  } = useAiConnectionFailure({
    api: api ?? null,
    libraryId: library?.libraryId,
    failedCount: aiJobs?.failed ?? 0,
    queuedCount: aiJobs?.queued ?? 0,
    runningCount: aiJobs?.running ?? 0,
    aiAnalyzing,
    controlAiJobs: useCallback(
      async (action, jobIds) => {
        await controlAiJobsRef.current(action, jobIds);
      },
      [],
    ),
  });
  const handleAiConnectionFailureRetry = useCallback(async () => {
    const retryJobIds = aiConnectionFailureGate.failedJobIds.filter((jobId) =>
      lastAiBatchJobIdsRef.current.includes(jobId),
    );
    // Wait for Worker retry to persist `queued` before re-arming. Otherwise a
    // status refresh can observe the old terminal `failed` state and finish
    // the retried batch immediately.
    await onAiConnectionFailureRetry();
    if (retryJobIds.length === 0) return;
    aiBatchStatusRequestRef.current++;
    aiBatchJobIdsRef.current = retryJobIds;
    aiBatchSkippedCountRef.current = 0;
    aiBatchKnownJobsRef.current = [];
    aiBatchCounterBaselineRef.current = {
      succeeded: aiJobs?.succeeded ?? 0,
      failed: aiJobs?.failed ?? 0,
    };
    analyzingAssetIdRef.current = lastAiBatchAssetIdRef.current;
    analyzingBatchSizeRef.current = retryJobIds.length;
    setAiBatchProgress(computeAiBatchProgressForJobs(retryJobIds, []));
    flushSync(() => {
      setAiAnalyzing(true);
      setAiProgressBannerVisible(true);
    });
    // Progress events drive the banner; a status RPC would wait behind the queue.
  }, [aiConnectionFailureGate.failedJobIds, onAiConnectionFailureRetry, setAiAnalyzing, setAiBatchProgress, setAiProgressBannerVisible, aiBatchCounterBaselineRef, aiBatchJobIdsRef, aiBatchKnownJobsRef, aiBatchSkippedCountRef, aiBatchStatusRequestRef, analyzingAssetIdRef, analyzingBatchSizeRef, lastAiBatchAssetIdRef, lastAiBatchJobIdsRef]);


  const selectedFolderId =
    assetScope === "all" || assetScope === "root" ? undefined : assetScope;
  const selectedFolder = folders.find(
    (folder) => folder.folderId === selectedFolderId,
  );
  const selectedAssetFromList = showTrash
    ? trashedAssets.find((a) => a.assetId === selectedAssetId)
    : assets.find((asset) => asset.assetId === selectedAssetId);
  const selectedLayoutEntry = selectedAssetId
    ? browseLayout.find((entry) => entry.assetId === selectedAssetId)
      ?? (virtualBrowseLayout
        ? virtualLayoutEntryForAsset(virtualBrowseLayout, selectedAssetId)
        : undefined)
    : undefined;
  const selectedAsset = selectedAssetFromList
    ?? (selectedLayoutEntry ? assetSummaryFromLayoutEntry(selectedLayoutEntry) : undefined);

  const {
    handleMetadataDescriptionInput,
    handleMetadataDescriptionSave,
    handleRatingClick,
    handleFavoriteToggle,
    handleSourceUrlInput,
    handleSourceUrlSave,
    handleAuthorInput,
    handleAuthorSave,
    handleOpenSourceUrl,
  } = useInspectorFieldHandlers({
    api: api ?? null,
    shellApi,
    library,
    selectedAsset,
    selectedAssetId,
    selectedAssetIds,
    assetMetadata,
    multiEdit,
    editDescription,
    editFavorite,
    editSourceUrl,
    editAuthor,
    descriptionIsAi,
    aiContent,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setDescriptionIsAi,
    setAiContent,
    saveMetadata,
    saveMetadataForSelection,
    batchSetRatingForSelection,
    loadMetadata,
    setNotice,
    setError,
  });

  const effectivePalette = assetMetadata?.effectivePalette;
  const displayedPalette = useMemo(() => effectivePalette ?? [], [effectivePalette]);
  const automaticPalette = assetMetadata?.automaticPalette;
  const automaticPaletteRatios = useMemo(
    () => new Map((automaticPalette ?? []).map((color) => [color.hex, color.ratio])),
    [automaticPalette],
  );

  const visibleAssets = useMemo(() => {
    const base = showTrash
      ? filterTrashedAssetsAtTombstone(
          trashedAssets,
          trashedFolders,
          trashBrowseTombstoneId,
        )
      : assets;
    return shuffleBrowseItems(base, shuffleSeed, !showTrash);
  }, [
    assets,
    showTrash,
    shuffleSeed,
    trashBrowseTombstoneId,
    trashedAssets,
    trashedFolders,
  ]);
  const workspaceTabPresentations = workspaceTabsState.tabs.map((tab) =>
    presentWorkspaceTab(tab, {
      folders,
      linkedFolders,
      tags,
      assets: [...visibleAssets, ...assets],
      pluginViews: pluginSidebarViews,
      t,
    }),
  );

  // Serpent-b963a9: masonry/justified canvases use the full-scope layout index
  // for geometry, so shuffling only the loaded summaries leaves the cards in
  // the original order whenever a filter is active. Keep the API rank index
  // unchanged for pagination, but use the same client shuffle for rendering.
  const visibleBrowseLayout = useMemo(() => {
    return shuffleBrowseItems(browseLayout, shuffleSeed, !showTrash);
  }, [browseLayout, showTrash, shuffleSeed]);
  const shuffleOrder = useMemo(() => {
    if (shuffleSeed === null || showTrash) return null;
    const total = virtualBrowseLayout?.total ?? 0;
    if (total <= 0) return null;
    return shuffledIndexOrder(total, shuffleSeed);
  }, [shuffleSeed, showTrash, virtualBrowseLayout?.total]);
  const visibleVirtualBrowseLayout = useMemo(() => {
    if (!virtualBrowseLayout) return null;
    if (!shuffleOrder) return virtualBrowseLayout;
    return permuteVirtualBrowseLayout(virtualBrowseLayout, shuffleOrder);
  }, [shuffleOrder, virtualBrowseLayout]);
  return { setMediaJobsOpen, visibleVirtualBrowseLayout, visibleBrowseLayout, shuffleOrder, selectedFolderId, visibleAssets, selectedFolder, setThumbnailFailures, selectedAsset, jobStatusCoordinatorRef, setAiJobs, workspaceTabPresentations, getManagedAssetDragIds, embeddingSelectionRef, embeddingService, mediaJobsOpen, aiConnectionFailureGate, onAiConnectionFailureAbort, pluginUiDialogOpen, aiJobs, notifyAiConnectionBatchStarted, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, setPluginJobs, controlAiJobsRef, openMediaJobs, managedFolderDragIdsRef, setPluginUiDialogOpen, semanticSearchActive, embeddingSearchReady, embeddingIndex, backgroundJobsActive, getManagedFolderDragIds, dragPreviewRef, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, thumbnailFailures, managedAssetDragIdsRef, automaticPaletteRatios, displayedPalette, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, handleOpenSourceUrl, embeddingBound, handleAiConnectionFailureRetry, mediaJobsLoading, embeddingSelectionId, pluginJobs };
}
