import { type ReadAppLogResult } from "../../shared/app-log";
import { type FilterClause, type SortDefinition } from "../../shared/asset-types";
import { parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { compactFormatFilterTokens } from "../../shared/text-media";
import { buildTagFilterClauses, resolveTagFilterSets } from "../dimension-filter-selection";
import { LibraryOperationError, toMessage } from "../error-utils";
import { isBrowseScopeAffectedByFolderTrash } from "../folder-trash-scope";
import { resolveInspectorTagTarget } from "../inspector-tag-target";
import { activeLibrarySwitchActivity } from "../library-switch-safety";
import { buildRecentLibraryMenuEntries } from "../LibrarySwitcher";
import { requestConfirmation } from "../local-confirmation";
import { parseSearchExpressionDetailed } from "../search-expression";
import { sessionFields } from "../stores/session-store";
import { transfersFields } from "../stores/transfers-store";
import { descendantTagIds } from "../tag-tree-model";
import { playTaskCompletionSound } from "../task-completion-sound";
import { browseEntryUnderPreview, workspaceNavLocationsEqual } from "../workbench/workspace/workspace-nav-history";
import { captureWorkspaceNavViewport, resolveWorkspaceScrollTop } from "../workbench/workspace/workspace-scroll-position";
import { type WorkspaceTabSession, workspaceTabBrowseStateHasDiscoveryInput } from "../workspace-tabs";
import { late, parseNumericRange, type QueryFilterSnapshot, type RendererWindow, type SearchDefinition, type WorkspaceNavigationRequest, renderedLibrary } from "./app-shared";
import { useAiAnalysisJobs } from "./use-ai-analysis-jobs";
import { useAiAndPreviewState } from "./use-ai-and-preview-state";
import { useAiConfigActions } from "./use-ai-config-actions";
import { useBrowseState } from "./use-browse-state";
import { useContentQueries } from "./use-content-queries";
import { useCoreState } from "./use-core-state";
import { useDialogEscapeAndFocus } from "./use-dialog-escape-and-focus";
import { useFolderCardRowElement } from "./use-folder-card-row-element";
import { useFolderOperations } from "./use-folder-operations";
import { useImageSequenceOperations } from "./use-image-sequence-operations";
import { useImportOperations } from "./use-import-operations";
import { useJobControlsAndMenu } from "./use-job-controls-and-menu";
import { useKeyboardRouting } from "./use-keyboard-routing";
import { useLibraryEventSubscriptions } from "./use-library-event-subscriptions";
import { useLibraryOpening } from "./use-library-opening";
import { useLibraryShellState } from "./use-library-shell-state";
import { useLinkedFolderOperations } from "./use-linked-folder-operations";
import { useMoveUndoDelete } from "./use-move-undo-delete";
import { usePreviewRestoreState } from "./use-preview-restore-state";
import { useScopeNavigation } from "./use-scope-navigation";
import { useSearchOperations } from "./use-search-operations";
import { useSelectionDiskDelete } from "./use-selection-disk-delete";
import { useTagOperations } from "./use-tag-operations";
import { useTransferOperations } from "./use-transfer-operations";
import { useWorkspaceHistoryReplay } from "./use-workspace-history-replay";
import { useWorkspaceHistoryUi } from "./use-workspace-history-ui";
import { useWorkspaceNavigationRequests } from "./use-workspace-navigation-requests";
import { useWorkspaceSnapshotRestore } from "./use-workspace-snapshot-restore";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useAppController() {
  const { api, library, t, setFatalAlertAlreadyOpen, setFatalDialogTitle, pendingAlreadyOpenPathRef, setLibraryRecoveryDialogOpen, linkedFolders, assetScope, setTrashBrowseTombstoneId, setAssets, setBrowseLayout, setVirtualBrowseLayout, browseLayout, virtualBrowseLayout, selectedAssetIds, syncBrowseFilterMembershipRef, shellApi, folders, setFindSimilarSource, libraryWriteInFlightRef, selectedAssetId, assets, trashedFolders, trashBrowseTombstoneId, busy, locale, folderBrowseEntries, masonryGridWidth, assetGridRef, setMasonryGridWidth, setSelectedAssetIds, setSelectedAssetId, selectedFolderIds, setSelectedFolderIds, setFolderBrowseEntries, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, setCanvasPrefs, setAllAssetCount, setRootAssetCount, setFolders, setLinkedFolders, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, setLibraryLoading, setLibrary, setAssetScope, setBrowserSessionReady, managedImportTargetFolderIdRef, setUiState, browserSessionReady, libraryTransitionInlineOpeningRef, libraryTransitionLock, setLayoutThumbnailArtifacts, setFolderBrowseRefreshToken, findSimilarTokenRef, setRecentLibraries, allAssetCount, setFolderCoverPicker, folderCoverPicker, setLinkedRulesEditor, linkedRulesEditor, convertLinkedDialog, setConvertLinkedDialog, uiState, libraryLoadingVisible, localConfirmation, libraryLoading, shortcutRuntimeVersion, nativeAssetDragEnabled, selectedNativeDragReady, nativeDragReadyIds, bakeImageRotation, audioPreviewPrefersCover, applyAudioPreviewPreference, applyBakeImageRotation } = useCoreState();
  // Keep AI readiness (hasKey) in sync without requiring the settings dialog.
  useEffect(() => {
    if (!api) return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per api identity
  }, [api]);
  const { pendingLibraryCloseFencesRef, setSearchTotal, setSearchOffset, setSearchSnippets, setError, setNotice, ensureLibraryView, isCurrentLibraryView, retiredImportIdsRef, sortField, sortOrder, setNavHistoryUi, searchValue, lastValidFolderSearchQueryRef, dismissFatalAlert, workspaceNavigationPending, navPanelWidth, inspectorPanelWidth, panelResizing, panelResizeReleaseRef, shuffleSeed, tags, activeTagId, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, filteredFolderCountRefreshToken, recursiveHintKey, folderRecursive, featureHintPrefs, searchTotal, showBlockingError, setWarning, showFolderCardsWhenRecursive, contentLoadGenerationRef, navigationHydrationAbortRef, setTags, setFolderRecursive, setActiveTagId, setTagFilter, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef, setWorkerRecoveryState, setWorkspaceNavigationPending, libraryViewSessionRef, beginLibraryTransition, activateLibraryView, setFilteredFolderCountRefreshToken, setFatal, pinnedTagId, colorSimilarity, tagFilterLastValidExpression, workspaceTabTransitionRef, workspaceHistoryReplayEpochRef, closeContextMenu, searchOffset, searchSnippets, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setColorSimilarity, setExcludeColorFilter, setTagFilterExpression, setTagFilterMode, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setTagFilterMatch, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setLongEdgeRange, setDurationRange, setSortField, setSortOrder, setShuffleSeed, lastAppliedWorkspaceBrowseStateRef, skipDiscoveryReloadSignatureRef, workspaceHistoryReplayQueueRef, dialogValue, useExistingCreateFolder, createStorageLayout, markLibraryClosePending, hadDiscoveryInput, folderRecursivePrefs, lastValidSearchQueryRef, localAssetRemovalGenerationRef, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, presentImportConflicts, presentImportSourceFailure, clearImportConflictsUi, clearImportSourceFailureUi, searchRequestGenerationRef, searchHistoryDismissedUntilInputRef, setSearchHistoryOpen, setSearchHistoryActiveIndex, publishSearchHistory, imageSequenceImportOffer, setImageSequenceImportSubmitting, setImageSequenceImportIndex, imageSequenceConfirmPurpose, setImportDecisionSubmitting, completedImportIdRef, resolveImportConflictsRef, importSourceFailurePlan, conflicts, rememberNameConflict, nameDecision, setConflictPhase, duplicateDecision, rememberDuplicate, setFeatureHintPrefs, setLinkedFolderHintActive, cancelPendingLibraryReads, conflictPhase, fatalAlertMessage, importDecisionSubmitting, searchInputRef, openContextMenu, imageSequenceImportError, imageSequenceImportIndex, imageSequencePreviewSource, imageSequenceImportSubmitting, setNameDecision, setRememberNameConflict, setDuplicateDecision, setRememberDuplicate, leftOpen, rightOpen, panelResizeShellStyle, setLeftOpen, searchHistory, setRightOpen, linkedFolderHintShow, beginLinkedFolderHintHover, endLinkedFolderHintHover, linkedFolderAddHintEligible, linkedFolderHintStopTimerRef, includeSubfoldersHoverTimerRef, workerRecoveryState, renderedToastStack, topVisibleToastId, dismissToast, handleToastTransitionEnd, createLibraryPhase, dismissAlreadyOpenPrompt, resetPanelWidth, beginPanelResize, beginPanelEdgeRestore } = useLibraryShellState({ library, t, setFatalAlertAlreadyOpen, setFatalDialogTitle, pendingAlreadyOpenPathRef, setLibraryRecoveryDialogOpen, linkedFolders, assetScope });
  const { setAboutOpen, appLogAutomationCorrelationId, setAppLogEntries, setAppLogLoading, setAppSettingsOpen, setAppLogAutomationCorrelationId, setAppLogOpen, metadataByAssetRef, metadataConflictAssetIdsRef, assetMetadata, setAssetMetadata, setVersionConflict, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setTrashedAssets, syncBindingStatus, syncProgress, cancelWorkspaceViewportRestoreRef, showTrash, trashedAssets, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, saveMetadataForSelection, batchSetRatingForSelection, workspaceTabsState, pluginSidebarViews, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, showIgnoredItems, showTagManagement, showPluginSidebarView, fetchBrowseScopeAssetIds, editableTextFocused, workspaceHistoryReplayActiveRef, navHistoryRef, syncActiveWorkspaceTabLocation, pendingWorkspacePreviewRef, showMissingLinkedPublishRef, setTrashedAssetCount, beginBrowsePageClearingSimilar, setShowTrash, restoreWorkspaceTabsForLibrary, scriptSandboxPreviewOpen, importProgress, appSettingsOpen, reloadCurrentContentRef, setLibraryTransferKind, setImportProgress, setLibraryTransferName, clearLibraryClosePending, resetWorkspaceTabs, applyBrowseGeometryPatchesRef, applyBrowsePreviewPatchesRef, setExtractedMetadataRefreshKey, refreshAfterAiRef, rebuildAndApplyMultiEditRef, beginWorkspaceTabNavigation, isWorkspaceTabNavigationCurrent, setShowTagManagement, setActivePluginSidebarViewId, trashedAssetCount, activePluginSidebarViewId, setShowIgnoredItems, pendingWorkspaceTabSelectionRef, getWorkspaceRenderSnapshot, saveWorkspaceTabContext, selectWorkspaceTab, resetBrowsePaginationPreservingVisibleLayout, rebuildAndApplyMultiEdit, removeLocallyFromBrowse, imageSequenceDialog, setImageSequenceDialog, runCurrentImportRpc, loadAiContentForAssetRef, resetBrowsePagination, setRestoreDialog, restoreDialog, moveDialog, setMoveDialog, operationHistory, setOperationHistory, refreshOperationHistory, batchRelinkKeepMetadata, setBatchRelinkPreview, batchRelinkPreview, exportStartedAtRef, setExportProgress, exportProgress, deleteProgress, setImportInterrupt, importAwaitingUserDecisionRef, importRpcDepthRef, activeImportIdRef, setSyncProgress, syncRunStartedAtRef, syncRunNotifiedRef, setDeleteProgress, importRpcInFlight, importOverlayDismissed, librarySettingsOpen, appLogOpen, aboutOpen, openSourceLicensesOpen, setLibrarySettingsOpen, setScriptSandboxPreviewOpen, setOpenSourceLicensesOpen, dismissImportOverlay, addWorkspaceTab, closeWorkspaceTab, pluginSidebarRefreshKey, setSyncBindingStatus, activePluginSidebarView, appSettingsCategory, setGitignoreContent, showMissingLinkedFiles, setShowMissingLinkedFiles, setAppSettingsCategory, searchFolderResults, searchFolderRealKey, searchFolderMatchKey, searchFolderRealEntries, pluginManagerApi, importInterrupt, libraryTransferKind, libraryTransferName, moveWorkspaceTab, setAutomaticTaskEditorId, setAutomaticTasksOpen, workspaceTabRevealTarget, folderTreeActionsRef, pluginContributionRefreshKey, browsePagination, loadFolderCoverPickerPage, automaticTaskEditorId, closeOtherWorkspaceTabs, setWorkspaceTabRevealTarget, workspaceTabRevealRequestRef } = useBrowseState({ pendingLibraryCloseFencesRef, setTrashBrowseTombstoneId, api, setAssets, setBrowseLayout, setVirtualBrowseLayout, setSearchTotal, setSearchOffset, setSearchSnippets, setError, t, browseLayout, virtualBrowseLayout, library, selectedAssetIds, setNotice, syncBrowseFilterMembershipRef, ensureLibraryView, isCurrentLibraryView, retiredImportIdsRef, shellApi, beginWorkspaceNavigation, captureWorkspaceTabContext, restoreWorkspaceTabSession, restoreAllAssetsWorkspaceTab, sortField, sortOrder, setNavHistoryUi, searchValue, lastValidFolderSearchQueryRef, folders, linkedFolders, setFindSimilarSource });
  const [appLogErrorCode, setAppLogErrorCode] = useState<
    Extract<ReadAppLogResult, { ok: false }>["code"] | null
  >(null);

  async function confirmLibrarySwitch(keepDestinationChoice = false): Promise<boolean> {
    const activity = activeLibrarySwitchActivity({
      uiState: sessionFields.get("uiState"),
      importProgress: transfersFields.get("importProgress"),
      exportProgress: transfersFields.get("exportProgress"),
      syncProgress: transfersFields.get("syncProgress"),
      writeOperationInFlight: libraryWriteInFlightRef.current,
    });
    const sourceLibraryId = renderedLibrary.current?.libraryId;
    const confirmed = activity === null || await requestConfirmation(
      t("shell.librarySwitchWarning"), false, { scopeBound: !keepDestinationChoice },
    );
    return confirmed && (keepDestinationChoice || renderedLibrary.current?.libraryId === sourceLibraryId);
  }

  function openLibraryChooserFromError(): void {
    dismissFatalAlert();
    setOpenLibraryChooserOpen(true);
  }

  const openAbout = useCallback(() => {
    setAboutOpen(true);
  }, [setAboutOpen]);

  async function refreshAppLog(automationCorrelationId = appLogAutomationCorrelationId): Promise<void> {
    const bridge = (window as RendererWindow).keel?.shell;
    if (!bridge?.readAppLog) {
      setAppLogEntries([]);
      setAppLogErrorCode("read_failure");
      return;
    }
    setAppLogLoading(true);
    try {
      const correlationId = automationCorrelationId.trim();
      const result = await bridge.readAppLog(correlationId === "" ? undefined : correlationId);
      if (result.ok) {
        setAppLogEntries(result.entries);
        setAppLogErrorCode(null);
      } else {
        setAppLogEntries([]);
        setAppLogErrorCode(result.code);
      }
    } finally {
      setAppLogLoading(false);
    }
  }

  function openAppLog(automationCorrelationId = ""): void {
    setAppSettingsOpen(false);
    setMediaJobsOpen(false);
    setAppLogAutomationCorrelationId(automationCorrelationId);
    setAppLogOpen(true);
    void refreshAppLog(automationCorrelationId);
  }
  const { setOpenLibraryChooserOpen, panelWidthSnapshotRef, reflowAnchorRef, workspaceCanvasRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardSizeRestoreFrameRef, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, descriptionIsAi, aiContent, setDescriptionIsAi, setAiContent, saveMetadata, loadMetadata, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, previewAsset, assetCardSize, canvasPrefs, marqueeBoxRef, cardResizeAnchorRef, cardResizeScrollSnapshotRef, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewRestoringRef, previewRestoring, pendingViewportRestoreRef, wakeViewerChrome, setPreviewRestoring, setPreviewCanvasReady, clearPreviewScrollHold, setPreviewAsset, lastPreviewRestoredTopRef, armPreviewScrollHold, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, applyLoadedMetadata, applyLiveAiProgressRef, imageSequencePrefs, loadAiContentForAsset, setExportDialogOpen, setImportValidated, exportDialogOpen, setImportLibraryChooserOpen, previewModalRef, setAiProfiles, updateAiActiveProfileId, setAiProfileDraftId, setAiProfileName, setAiApiFormat, setAiModel, setAiBaseUrl, setAiHasKey, setAiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, setAiDescriptionEnabled, setAiTagsEnabled, setAiRatingEnabled, setAiForceExistingTags, setAiAnalysisSettings, setAiLanguages, setAiConcurrencyLimit, setAiMaxAnalysisImageEdgePx, setAiAutoAnalyzeEnabled, setAiDisclaimerAccepted, aiVerifiedFingerprintRef, aiProfiles, aiProfileDraftId, aiApiKey, aiActiveProfileId, aiApiFormat, aiModel, aiBaseUrl, aiDraftHasKey, setAiConnectionState, aiConfigPersistDraftRef, setAiApiKey, setAiSaveVerifying, aiAnalysisSettings, aiProfileName, aiAutoConnectAttemptedRef, aiHasKey, aiConnectionProbeGenerationRef, refreshAiBatchStatusRef, revealAppLog, folderCardWidthPx, panelReflowFrozenWidthRef, cardSizeStops, previewCanvasReady, syncCardStatuses, viewerVolumeMuted, viewerVolume, viewerChromeIdle, viewerChromePrefs, setViewerChromePrefs, onViewerChromeActivity, aiUiPrefs, setAiUiPrefs, setImageSequencePrefs, capturePanelResizeAnchor } = useAiAndPreviewState({ setError, t, api, library, selectedAssetId, metadataByAssetRef, metadataConflictAssetIdsRef, assetMetadata, setAssetMetadata, setVersionConflict, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setAssets, setTrashedAssets, setNotice, syncBrowseFilterMembershipRef, assets, browseLayout, syncBindingStatus, syncProgress, workspaceNavigationPending, cancelWorkspaceViewportRestoreRef, navPanelWidth, inspectorPanelWidth, panelResizing, panelResizeReleaseRef });
  const { setMediaJobsOpen, closeAssetPreview, loadContent, jobStatusCoordinatorRef, setThumbnailFailures, setAiJobs, workspaceTabPresentations, visibleAssets, openAssetPreview, saveCurrentWorkspaceHistoryViewport, clearAssetSelection, chooseFolderRef, selectedFolderId, revealAfterImportRef, offerPostImportSequencesRef, getManagedAssetDragIds, selectionAnchorRef, pendingRevealRef, embeddingSelectionRef, embeddingService, pendingRestoredFocusRef, setAssetSelectionAnchor, hoveredAssetIdRef, clearHoveredAssetId, setHoveredAssetId, mediaJobsOpen, aiConnectionFailureGate, onAiConnectionFailureAbort, pluginUiDialogOpen, navigateAssetPreview, selectedAsset, selectedAssets, diskDeleteKeyboardTargets, selectedVisibleAssets, pluginSurfaceContext, previewIndex, selectedFolder, aiJobs, notifyAiConnectionBatchStarted, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, setPluginJobs, controlAiJobsRef, browseScopeAssetIds, selectAllBrowseScope, invertBrowseScope, openMediaJobs, filteredFolderCounts, canvasFolderBrowseEntries, browseCanvasBodyLayout, managedFolderDragIdsRef, handleFolderCardClick, cardMouseDownRef, selectedFolderIdSet, setPluginUiDialogOpen, importMenuCopy, semanticSearchActive, embeddingSearchReady, backgroundJobsActive, getManagedFolderDragIds, dragPreviewRef, recursiveHintActive, scopeBreadcrumbSegments, workspaceBrowseCount, resizeAssetCards, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, handleCanvasMouseDown, sourceBadgeContext, selectedIdSet, handleCardClick, selectionAssetIds, managedAssetDragIdsRef, hoveredAssetId, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, assetRenderSections, visibleBrowseLayout, visibleVirtualBrowseLayout, browseEmptyState, persistAssetColorSpace, automaticPaletteRatios, displayedPalette, folderInspector, folderInspectorAppearance, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, handleOpenSourceUrl, embeddingBound, handleAiConnectionFailureRetry, embeddingSelectionId, pluginBrowseScope, pluginViewerState, menuSkipScope } = usePreviewRestoreState({ panelWidthSnapshotRef, navPanelWidth, inspectorPanelWidth, reflowAnchorRef, workspaceCanvasRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardSizeRestoreFrameRef, library, api, setFindSimilarSource, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, assetScope, folders, showTrash, trashedAssets, selectedAssetId, assets, browseLayout, virtualBrowseLayout, shellApi, selectedAssetIds, assetMetadata, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, descriptionIsAi, aiContent, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setDescriptionIsAi, setAiContent, saveMetadata, saveMetadataForSelection, batchSetRatingForSelection, loadMetadata, setNotice, setError, trashedFolders, trashBrowseTombstoneId, shuffleSeed, workspaceTabsState, linkedFolders, tags, pluginSidebarViews, t, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, activeTagId, searchValue, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, previewAsset, busy, locale, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, currentQueryDefinition, showIgnoredItems, filteredFolderCountRefreshToken, folderBrowseEntries, recursiveHintKey, showTagManagement, showPluginSidebarView, folderRecursive, featureHintPrefs, masonryGridWidth, assetCardSize, canvasPrefs, assetGridRef, setMasonryGridWidth, setSelectedAssetIds, setSelectedAssetId, marqueeBoxRef, selectedFolderIds, setSelectedFolderIds, searchTotal, fetchBrowseScopeAssetIds, editableTextFocused, showBlockingError, setWarning, ensureLibraryView, setFolderBrowseEntries, showFolderCardsWhenRecursive, isCurrentLibraryView, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, cardResizeAnchorRef, cardResizeScrollSnapshotRef, setCanvasPrefs, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewRestoringRef, previewRestoring, sortField, sortOrder, workspaceHistoryReplayActiveRef, cancelWorkspaceViewportRestoreRef, navHistoryRef, pendingViewportRestoreRef, wakeViewerChrome, setPreviewRestoring, setPreviewCanvasReady, clearPreviewScrollHold, setPreviewAsset, syncActiveWorkspaceTabLocation, setNavHistoryUi, pendingWorkspacePreviewRef, lastPreviewRestoredTopRef, armPreviewScrollHold, showMissingLinkedPublishRef, contentLoadGenerationRef, navigationHydrationAbortRef, setAllAssetCount, setRootAssetCount, setTrashedAssetCount, setFolders, setLinkedFolders, setTags, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, setSearchTotal, setSearchOffset, setSearchSnippets, beginBrowsePageClearingSimilar, setLibraryLoading, setFolderRecursive, setLibrary, setShowTrash, setTrashedAssets, setAssetScope, setActiveTagId, setTagFilter, setAssets, setBrowserSessionReady, managedImportTargetFolderIdRef, restoreWorkspaceTabsForLibrary, setUiState, browserSessionReady, refreshRecentLibraries, scriptSandboxPreviewOpen, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, importProgress, appSettingsOpen, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef });
  useLibraryEventSubscriptions({ api, setWorkerRecoveryState, setWorkspaceNavigationPending, setError, t, reloadCurrentContentRef, locale, applyClosedLibraryUi: late(() => applyClosedLibraryUi), setLibraryTransferKind, setNotice, setImportProgress, closeAssetPreview, libraryTransitionInlineOpeningRef, libraryTransitionLock, setLibraryTransferName, pendingLibraryCloseFencesRef, libraryViewSessionRef, setUiState, refreshRecentLibraries, scriptSandboxPreviewOpen, beginLibraryTransition, clearLibraryScopedView: late(() => clearLibraryScopedView), setLibrary, activateLibraryView, setLibraryLoading, loadContent, clearLibraryClosePending, library, resetWorkspaceTabs, ensureLibraryView, isCurrentLibraryView, setAssets, applyBrowseGeometryPatchesRef, syncBrowseFilterMembershipRef, applyBrowsePreviewPatchesRef, setLayoutThumbnailArtifacts, setFolderBrowseRefreshToken, visibleWindowAssetIdsRef, previewAssetRef, folderCoverCandidateAssetIdsRef, jobStatusCoordinatorRef, setExtractedMetadataRefreshKey, applyLoadedMetadata, setFolderNavigationCovers, setThumbnailFailures });
  const { captureWorkspaceTabBrowseState, syncNavHistoryUi } = useWorkspaceHistoryUi({ api, library, jobStatusCoordinatorRef, setAiJobs, applyLiveAiProgressRef, reloadCurrentContentRef, refreshAfterAiRef, setFilteredFolderCountRefreshToken, setAiContent, setNotice, t, rebuildAndApplyMultiEditRef, locale, setError, setFatal, syncActiveWorkspaceTabLocation, setNavHistoryUi, navHistoryRef, searchValue, pinnedTagId, formatFilter, excludeFormatFilter, colorFilter, excludeColorFilter, colorSimilarity, tagFilter, tagFilterExpression, tagFilterMode, tagFilterLastValidExpression, excludeTagFilter, excludedTagFilter, includeAiTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, includeAiRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, sortField, sortOrder, shuffleSeed, folderRecursive, showIgnoredItems });

  function beginWorkspaceNavigation(): () => boolean {
    findSimilarTokenRef.current += 1;
    const token = (workspaceTabTransitionRef.current += 1);
    workspaceHistoryReplayEpochRef.current += 1;
    return () => workspaceTabTransitionRef.current === token;
  }
  const { captureWorkspaceRenderSnapshot, applyWorkspaceLocationFlags, beginWorkspaceNavigationRequest, createWorkspaceNavigationRequest, acknowledgeWorkspaceNavigation } = useWorkspaceNavigationRequests({ findSimilarTokenRef, beginWorkspaceTabNavigation, isWorkspaceTabNavigationCurrent, setWorkspaceNavigationPending, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setActiveTagId, setAssetScope, setTrashBrowseTombstoneId, closeContextMenu, virtualBrowseLayout, workspaceCanvasRef, navHistoryRef, browseLayout, searchOffset, searchValue, showTrash, trashBrowseTombstoneId, trashedAssets, trashedFolders, trashedAssetCount, showTagManagement, activePluginSidebarViewId, assets, searchTotal, searchSnippets });

  function captureWorkspaceTabContext() {
    workspaceHistoryReplayEpochRef.current += 1;
    if (workspaceHistoryReplayActiveRef.current) {
      return null;
    }
    return {
      viewport: captureWorkspaceNavViewport(workspaceCanvasRef.current),
      selectedAssetIds,
      selectedAssetId: selectedAssetId ?? null,
      browseState: captureWorkspaceTabBrowseState(),
      cachedTitle:
        workspaceTabPresentations.find(
          (tab) => tab.id === workspaceTabsState.activeTabId,
        )?.title ?? workspaceTitle(),
      renderSnapshot: captureWorkspaceRenderSnapshot(),
    };
  }
  const { finishWorkspaceNavigation, applyWorkspaceRenderSnapshot, applyWorkspaceTabBrowseStateForNavigation } = useWorkspaceSnapshotRestore({ cancelWorkspaceViewportRestoreRef, workspaceCanvasRef, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setColorSimilarity, setExcludeColorFilter, setTagFilter, setTagFilterExpression, setTagFilterMode, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setTagFilterMatch, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setLongEdgeRange, setDurationRange, setSortField, setSortOrder, setShuffleSeed, setFolderRecursive, setShowIgnoredItems, lastAppliedWorkspaceBrowseStateRef, skipDiscoveryReloadSignatureRef, queryDefinitionForWorkspaceBrowseState: late(() => queryDefinitionForWorkspaceBrowseState), applyWorkspaceLocationFlags, setAssets, setBrowseLayout, setVirtualBrowseLayout, setSearchTotal, setSearchOffset, setSearchSnippets, setTrashedAssets, setTrashedFolders, setTrashedAssetCount, pendingViewportRestoreRef, setWorkspaceNavigationPending });

  async function restoreAllAssetsWorkspaceTab(isCurrent: () => boolean) {
    const request: WorkspaceNavigationRequest = {
      historyMode: "none",
      isCurrent,
      deferReveal: true,
    };
    await chooseFolder("all", { navigation: request });
    if (isCurrent()) finishWorkspaceNavigation(request);
  }

  async function restoreWorkspaceTabSession(
    tab: WorkspaceTabSession,
    isCurrent: () => boolean,
  ) {
    const current = tab.location;
    const previewBrowse =
      current.kind === "preview"
        ? browseEntryUnderPreview(navHistoryRef.current, tab.id)
        : null;
    const firstLocation = previewBrowse?.location ?? current;
    const targetViewport = previewBrowse?.viewport ?? tab.viewport;
    const pendingSelection = tab.browseState &&
      workspaceTabBrowseStateHasDiscoveryInput(tab.browseState)
      ? {
          selectedAssetIds: [...tab.selectedAssetIds],
          selectedAssetId: tab.selectedAssetId,
          isCurrent,
        }
      : null;
    const request: WorkspaceNavigationRequest = {
      historyMode: "none",
      isCurrent,
      deferReveal: true,
      ...(tab.browseState
        ? { browseState: tab.browseState, browseStateTabId: tab.id }
        : {}),
    };
    setWorkspaceNavigationPending(true);
    pendingWorkspaceTabSelectionRef.current = pendingSelection;
    pendingWorkspacePreviewRef.current =
      current.kind === "preview"
        ? { assetId: current.assetId, viewport: targetViewport, isCurrent }
        : null;
    const renderSnapshot = getWorkspaceRenderSnapshot(tab.id);
    if (
      renderSnapshot &&
      workspaceNavLocationsEqual(renderSnapshot.location, firstLocation)
    ) {
      // Commit the cached DOM and its scroll position before the browser paints;
      // the translucent hold layer must never expose the prior tab's offset.
      flushSync(() => {
        applyWorkspaceRenderSnapshot(renderSnapshot);
        applyWorkspaceTabBrowseStateForNavigation(request);
      });
      if (isCurrent()) {
        const canvas = workspaceCanvasRef.current;
        if (canvas) {
          const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
          canvas.scrollTop = resolveWorkspaceScrollTop(targetViewport, extent);
        }
      }
    }
    if (!isCurrent()) return;
    try {
      await applyWorkspaceLocation(firstLocation, request);
    } catch {
      if (isCurrent()) setWorkspaceNavigationPending(false);
    }
    if (!isCurrent()) {
      const pending = pendingWorkspacePreviewRef.current;
      if (current.kind === "preview" && pending?.assetId === current.assetId) {
        pendingWorkspacePreviewRef.current = null;
      }
      if (pendingWorkspaceTabSelectionRef.current === pendingSelection) {
        pendingWorkspaceTabSelectionRef.current = null;
      }
      return;
    }
    setSelectedAssetIds([...tab.selectedAssetIds]);
    setSelectedAssetId(tab.selectedAssetId ?? undefined);
    if (current.kind === "preview") {
      const target = [...visibleAssets, ...assets].find(
        (candidate) => candidate.assetId === current.assetId,
      );
      if (target) openAssetPreview(target);
    }
    finishWorkspaceNavigation(request, targetViewport);
  }
  const { applyWorkspaceLocation, recordNavigation, goWorkspaceBack, goWorkspaceForward } = useWorkspaceHistoryReplay({ navHistoryRef, workspaceHistoryReplayActiveRef, syncNavHistoryUi, chooseFolder: late(() => chooseFolder), chooseTag: late(() => chooseTag), enterTrashAt: late(() => enterTrashAt), visibleAssets, assets, openAssetPreview, enterTagManagement: late(() => enterTagManagement), enterPluginSidebarView: late(() => enterPluginSidebarView), runFindSimilar: late(() => runFindSimilar), workspaceHistoryReplayEpochRef, workspaceHistoryReplayQueueRef, cancelWorkspaceViewportRestoreRef, workspaceCanvasRef, saveWorkspaceTabContext, workspaceTabsState, selectWorkspaceTab, previewAsset, closeAssetPreview, beginWorkspaceNavigationRequest, finishWorkspaceNavigation, setWorkspaceNavigationPending, setError, t, locale });

  async function refreshRecentLibraries(currentLibraryPath?: string | null) {
    if (!api) return;
    try {
      const result = await api.listRecent();
      if (!result.ok) return;
      setRecentLibraries(
        buildRecentLibraryMenuEntries(
          result.value,
          currentLibraryPath === undefined
            ? (library?.displayPath ?? null)
            : currentLibraryPath,
        ),
      );
    } catch {
      // 最近资源库列表读取失败不影响菜单主功能，保持现有列表。
    }
  }
  const { clearDiscoveryControls, openRecentLibrary, clearDiscoveryFilter, runLibraryOpenPipeline, revealRecoveryReport, cancelEagleInspectFlow, cancelBillfishInspectFlow, submitEagleLibraryName, submitBillfishLibraryName, runLibraryOperation, openEagleLibrary, openBillfishLibrary, confirmAlreadyOpenLibrarySwitch } = useLibraryOpening({ api, t, dialogValue, useExistingCreateFolder, createStorageLayout, libraryTransitionLock, libraryTransitionInlineOpeningRef, importProgress, confirmLibrarySwitch, setImportProgress, setDialog, showBlockingError, locale, setDialogValue, setCreateLibraryPhase, setLibraryTransferKind, setLibraryTransferName, library, setError, setUiState, setLibraryLoading, beginLibraryTransition, closeAssetPreview, clearLibraryScopedView: late(() => clearLibraryScopedView), setLibrary, activateLibraryView, loadContent, markLibraryClosePending, setWarning, clearLibraryClosePending, refreshRecentLibraries, pendingAlreadyOpenPathRef, dismissFatalAlert, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setExcludeColorFilter, setTagFilter, setTagFilterExpression, setTagFilterLastValidExpression, setTagFilterMode, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setDurationRange, setLongEdgeRange, hadDiscoveryInput, setActiveTagId });
  const { chooseFolder, enterTrashAt, enterTagManagement, enterPluginSidebarView, handleCreateTagInManagement, handleRenameTagInManagement, moveTagInTree, handleDeleteTagsInManagement, assignAssetsToTreeTag, enterTrash, handleMergeTagsInManagement } = useScopeNavigation({ library, createWorkspaceNavigationRequest, saveCurrentWorkspaceHistoryViewport, ensureLibraryView, activeTagId, pinnedTagId, captureWorkspaceTabBrowseState, folderRecursivePrefs, acknowledgeWorkspaceNavigation, setFolderRecursive, managedImportTargetFolderIdRef, closeAssetPreview, isCurrentLibraryView, loadContent, showIgnoredItems, queryDefinitionForWorkspaceBrowseState: late(() => queryDefinitionForWorkspaceBrowseState), queryDefinitionForNavigationRequest: late(() => queryDefinitionForNavigationRequest), assetScope, setWorkspaceNavigationPending, resetBrowsePaginationPreservingVisibleLayout, applyWorkspaceTabBrowseStateForNavigation, closeContextMenu, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setAssetScope, setTagFilter, setTagFilterExpression, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setPinnedTagId, clearAssetSelection, setActiveTagId, resetDiscoveryIfNavigationReplacesLive: late(() => resetDiscoveryIfNavigationReplacesLive), api, setUiState, recordNavigation, finishWorkspaceNavigation, setError, t, locale, chooseFolderRef, showTrash, setTrashBrowseTombstoneId, setTags, setNotice, metadataByAssetRef, setAssetMetadata, selectedAssetIds, rebuildAndApplyMultiEdit, chooseTag: late(() => chooseTag), tags, refreshTagAndMetadataState, syncBrowseFilterMembershipRef });
  const { chooseTag, assignAssetToTag, handleRemoveTagFromAsset, handleCreateAndAssignTag, togglePinnedTag, handleSearchTagsFromManagement } = useTagOperations({ api, library, beginWorkspaceNavigationRequest, ensureLibraryView, managedImportTargetFolderIdRef, saveCurrentWorkspaceHistoryViewport, closeAssetPreview, isCurrentLibraryView, currentQueryDefinition, showIgnoredItems, closeContextMenu, resetBrowsePaginationPreservingVisibleLayout, skipDiscoveryReloadSignatureRef, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setActiveTagId, setAssetScope, clearAssetSelection, setTagFilter, setExcludeTagFilter, setExcludedTagFilter, setTagFilterMatch, setSearchOffset, applySearchResult: late(() => applySearchResult), beginBrowsePageClearingSimilar, recordNavigation, finishWorkspaceNavigation, setError, t, locale, setWorkspaceNavigationPending, setUiState, tags, createWorkspaceNavigationRequest, acknowledgeWorkspaceNavigation, queryDefinitionForWorkspaceBrowseState: late(() => queryDefinitionForWorkspaceBrowseState), applyWorkspaceTabBrowseStateForNavigation, clearDiscoveryControls, setTagFilterExpression, setTagFilterLastValidExpression, setTagFilterMode, pinnedTagId, setPinnedTagId, activeTagId, refreshTagAndMetadataState, syncBrowseFilterMembershipRef, setNotice, selectedAssetId });

  // REQ-MENU-007: multi-selection path — create the tag once, then assign it
  // to the whole selection via the shared batch helper (which reports its own
  // "已为 N 项资产添加标签。" notice or a batch error).
  async function handleCreateAndAssignTagToSelection(
    tagName: string,
    assetIds: string[],
  ) {
    if (!api || !library || assetIds.length === 0 || !tagName.trim()) return;
    try {
      const createResult = await api.createTag({
        libraryId: library.libraryId,
        name: tagName.trim(),
      });
      if (!createResult.ok) throw new LibraryOperationError(createResult.error);
      await batchAssignTagToSelection(createResult.value.tagId, assetIds);
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
    }
  }

  async function refreshTagAndMetadataState(assetId: string) {
    if (!api || !library) return;
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    const [tagResult, metadataResult] = await Promise.all([
      api.listTags({ libraryId: targetLibraryId }),
      api.getAssetMetadata({ libraryId: targetLibraryId, assetId }),
    ]);
    if (!isCurrentLibraryView(viewSession)) return;
    if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
    if (!metadataResult.ok) throw new LibraryOperationError(metadataResult.error);
    setTags(tagResult.value);
    // Keep cache and Inspector editor fields coherent. Updating only
    // `assetMetadata` leaves editRating/editFavorite stale, which made a
    // completed script look as though its metadata write had not applied.
    applyLoadedMetadata(assetId, metadataResult.value);
  }

  // REQ-MENU-007: Inspector tag operations apply to the whole multi-selection.
  // The shared batch helpers only refresh the tag list, so after a batch op
  // also refresh the primary asset's metadata to keep the Inspector's tag
  // chips in sync (single-asset handlers already do this themselves).
  async function refreshInspectorTagStateAfterBatch() {
    const ids =
      selectedAssetIds.length >= 2
        ? [...new Set(selectedAssetIds)]
        : selectedAssetId
          ? [selectedAssetId]
          : [];
    if (ids.length === 0) return;
    try {
      for (const assetId of ids) {
        await refreshTagAndMetadataState(assetId);
      }
      if (ids.length >= 2) {
        rebuildAndApplyMultiEdit(ids);
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.tagUpdatedRefreshFailed"), locale));
    }
  }

  async function handleInspectorAssignTag(tagId: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await assignAssetToTag(target.assetId, tagId);
      return;
    }
    await batchAssignTagToSelection(tagId, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
  }

  async function handleInspectorRemoveTag(tagId: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await handleRemoveTagFromAsset(tagId);
      return;
    }
    await batchRemoveTagFromSelection(tagId, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
  }

  async function handleInspectorCreateAndAssignTag(tagName: string) {
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    if (target.kind === "single") {
      await handleCreateAndAssignTag(tagName);
      return;
    }
    await handleCreateAndAssignTagToSelection(tagName, target.assetIds);
    await refreshInspectorTagStateAfterBatch();
  }

  async function handleInspectorApplyTagNames(tagNames: string[]) {
    if (!api || !library || tagNames.length === 0) return;
    const target = resolveInspectorTagTarget(selectedAssetIds, selectedAssetId);
    if (!target) return;
    const assetIds = target.kind === "single" ? [target.assetId] : target.assetIds;
    try {
      const tagIds: string[] = [];
      let createdCount = 0;
      let createdName = "";
      for (const name of tagNames) {
        const existing = tags.find(
          (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
        if (existing) {
          tagIds.push(existing.tagId);
          continue;
        }
        const createResult = await api.createTag({
          libraryId: library.libraryId,
          name,
        });
        if (!createResult.ok) throw new LibraryOperationError(createResult.error);
        tagIds.push(createResult.value.tagId);
        createdCount += 1;
        createdName = createResult.value.name;
      }
      const assignResult = await api.assignTags({
        libraryId: library.libraryId,
        assetIds,
        tagIds,
      });
      if (!assignResult.ok) throw new LibraryOperationError(assignResult.error);
      if (target.kind === "single") {
        await refreshTagAndMetadataState(target.assetId);
      } else {
        await refreshInspectorTagStateAfterBatch();
      }
      const notice = tagNames.length > 1
        ? t("toast.tagsAppliedCount", { count: tagNames.length })
        : createdCount === 1
          ? t("toast.tagCreatedAssigned", { name: createdName })
          : t("toast.tagAdded");
      setNotice(notice, assignResult.value.historyEntryId);
    } catch (caught) {
      setError(toMessage(caught, t("toast.addTagFailed"), locale));
    }
  }

  function currentQueryDefinition(
    overrides: {
      tagFilter?: string;
      tagFilterMatch?: "any" | "all";
      excludeTagFilter?: boolean;
      excludedTagFilter?: string;
      searchValue?: string | null;
      colorFilter?: string | null;
      excludeColorFilter?: boolean;
      colorSimilarity?: number;
      sortField?: SortDefinition["field"];
      sortOrder?: SortDefinition["order"];
      filtersSnapshot?: QueryFilterSnapshot;
    } = {},
  ): SearchDefinition {
    const filtersState = overrides.filtersSnapshot ?? {
      pinnedTagId,
      formatFilter,
      excludeFormatFilter,
      tagFilter,
      tagFilterExpression,
      tagFilterMode,
      tagFilterLastValidExpression,
      excludeTagFilter,
      excludedTagFilter,
      includeAiTagFilter,
      tagFilterMatch,
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
    const filters: FilterClause[] = [];
    const formatTokens = filtersState.formatFilter
      .split(",")
      .map((value) => value.trim().replace(/^\./, ""))
      .filter(Boolean);
    const formatValues = compactFormatFilterTokens(formatTokens);
    const ratings = filtersState.ratingFilter
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-5]$/.test(value));
    const effectiveColorFilter = overrides.colorFilter === undefined
      ? colorFilter
      : overrides.colorFilter ?? "";
    const colors = effectiveColorFilter
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (colors.length > 0)
      filters.push({
        field: "color",
        values: colors,
        exclude: overrides.excludeColorFilter ?? excludeColorFilter,
        similarity: overrides.colorSimilarity ?? colorSimilarity,
      });
    if (formatValues.length > 0)
      filters.push({
        field: "format",
        values: formatValues,
        exclude: filtersState.excludeFormatFilter,
      });
    const exactTagId = filtersState.pinnedTagId ?? activeTagId;
    const exactTag = exactTagId ? tags.find(tag => tag.tagId === exactTagId) : undefined;
    if (exactTag && filtersState.tagFilterMode === "expression"
      && filtersState.tagFilterExpression === JSON.stringify(exactTag.name)) {
      filters.push({ field: "tag", values: [exactTag.name], exclude: false,
        includeAi: filtersState.includeAiTagFilter,
        ...(descendantTagIds(tags, exactTag.tagId).length > 1 ? { includeDescendants: true } : {}) });
    } else if (filtersState.tagFilterMode === "expression") {
      const parsedTags = parseSearchExpressionDetailed(filtersState.tagFilterExpression ?? "", "tags");
      if (!parsedTags.ok && filtersState.tagFilterLastValidExpression) {
        const lastValidTags = parseSearchExpressionDetailed(filtersState.tagFilterLastValidExpression, "tags");
        if (lastValidTags.ok && lastValidTags.expression.root) filters.push({
          field: "tag_expression", exclude: false as const,
          expression: lastValidTags.expression,
          expressionSource: filtersState.tagFilterLastValidExpression,
          includeAi: filtersState.includeAiTagFilter,
        });
      }
      if (parsedTags.ok && parsedTags.expression.root) filters.push({
        field: "tag_expression",
        exclude: false as const,
        expression: parsedTags.expression,
        expressionSource: filtersState.tagFilterExpression,
        includeAi: filtersState.includeAiTagFilter,
      });
    } else filters.push(...buildTagFilterClauses(
      resolveTagFilterSets({
        tagFilter: overrides.tagFilter ?? filtersState.tagFilter,
        excludeTagFilter: overrides.excludeTagFilter ?? filtersState.excludeTagFilter,
        excludedTagFilter: overrides.excludedTagFilter ?? filtersState.excludedTagFilter,
      }),
      overrides.tagFilterMatch ?? filtersState.tagFilterMatch,
      filtersState.includeAiTagFilter,
    ));
    if (ratings.length > 0)
      filters.push({
        field: "rating",
        values: ratings,
        exclude: filtersState.excludeRatingFilter,
        includeAi: filtersState.includeAiRatingFilter,
      });
    if (filtersState.favoriteFilter !== "any")
      filters.push({
        field: "favorite",
        values: [],
        exclude: filtersState.favoriteFilter === "no",
      });
    if (filtersState.sourceUrlFilter !== "any")
      filters.push({
        field: "source_url",
        values: [],
        exclude: filtersState.sourceUrlFilter === "no",
      });
    if (filtersState.availabilityFilter !== "any")
      filters.push({
        field: "availability",
        values: [filtersState.availabilityFilter],
        exclude: filtersState.excludeAvailabilityFilter,
      });
    const technicalRanges: Array<{
      field: "width" | "height" | "aspect_ratio" | "duration_ms" | "long_edge";
      input: { min: string; max: string; exclude: boolean };
      scale?: number;
      integer?: boolean;
    }> = [
      { field: "width", input: filtersState.widthRange },
      { field: "height", input: filtersState.heightRange },
      { field: "long_edge", input: filtersState.longEdgeRange },
      { field: "duration_ms", input: filtersState.durationRange, scale: 1_000 },
    ];
    const aspectInputs =
      overrides.filtersSnapshot
        ? filtersState.aspectRatioRanges.length > 0
          ? filtersState.aspectRatioRanges
          : (
            filtersState.aspectRatioRange.min || filtersState.aspectRatioRange.max
              ? [{
                min: filtersState.aspectRatioRange.min,
                max: filtersState.aspectRatioRange.max,
              }]
              : []
          )
        : aspectRatioRanges.length > 0
          ? aspectRatioRanges
          : aspectRatioRange.min || aspectRatioRange.max
            ? [{ min: aspectRatioRange.min, max: aspectRatioRange.max }]
            : [];
    const aspectExclude = overrides.filtersSnapshot
      ? filtersState.aspectRatioRange.exclude
      : aspectRatioRange.exclude;
    const aspectParsed = aspectInputs
      .map((input) => parseNumericRange(input.min, input.max, 1, false))
      .filter((range): range is NonNullable<typeof range> => range !== null);
    if (aspectParsed.length > 0) {
      filters.push({
        field: "aspect_ratio",
        ranges: aspectParsed,
        exclude: aspectExclude,
      });
    }
    for (const { field, input, scale = 1, integer = true } of technicalRanges) {
      const range = parseNumericRange(input.min, input.max, scale, integer);
      if (range)
        filters.push({ field, ranges: [range], exclude: input.exclude });
    }
    const requestedSearch = overrides.searchValue === undefined
      ? searchValue
      : overrides.searchValue ?? "";
    const searchParse = parseSearchExpressionDetailed(requestedSearch);
    const searchScopeKey = `${library?.libraryId ?? "no-library"}:${workspaceTabsState.activeTabId}`;
    if (searchParse.ok && overrides.searchValue === undefined) {
      lastValidSearchQueryRef.current = { scope: searchScopeKey, query: { clauses: [], expression: searchParse.expression, expressionSource: requestedSearch } };
    }
    return {
      ...((overrides.searchValue === undefined
        ? searchValue
        : overrides.searchValue ?? "").trim()
        ? {
            search: searchParse.ok
              ? { clauses: [], expression: searchParse.expression, expressionSource: requestedSearch }
              : lastValidSearchQueryRef.current?.scope === searchScopeKey
                ? lastValidSearchQueryRef.current.query
                : { clauses: [] },
          }
        : {}),
      ...(filters.length > 0 ? { filters } : {}),
      sort: {
        field: overrides.sortField ?? sortField,
        order: overrides.sortOrder ?? sortOrder,
      },
    };
  }
  const { queryDefinitionForWorkspaceBrowseState, queryDefinitionForNavigationRequest, resetDiscoveryIfNavigationReplacesLive, applySearchResult, reloadCurrentContent, deferredReconcileTimerRef, applyLocalAssetRemoval, currentSearchScope } = useContentQueries({ currentQueryDefinition, captureWorkspaceTabBrowseState, sortField, sortOrder, clearDiscoveryControls, setSearchTotal, setSearchOffset, setSearchSnippets, assetScope, folderRecursive, library, showTrash, setFilteredFolderCountRefreshToken, loadContent, activeTagId, tags, localAssetRemovalGenerationRef, assets, trashedAssets, searchTotal, allAssetCount, setAssets, setTrashedAssets, setAllAssetCount, removeLocallyFromBrowse, workspaceCanvasRef, reloadCurrentContentRef });
  const { batchAssignTagToSelection, batchRemoveTagFromSelection, requestTrashManagedFolder, handleOpenFolderInFileManager, handleCopyFolder, handleCopyFolderPath, dispatchClipboardPaste, openDiskDelete, deleteManagedAssetsFromDisk, trashManagedAssets, browsePasteDestination, handleOpenExternal, handleCopyAssetFiles, handleCopyFilePath, handleRevealInFolder, pasteClipboardImage, pasteOsClipboardFiles, createFolderCardDropHandlers, isInternalAssetDrag, resolveManagedAssetDrop, handleTargetExternalDragOver, handleTargetExternalDrop, handleAssetsDroppedOnFolder, handleFoldersDroppedOnFolder, handleAssetsDroppedOnTrash, handleFoldersDroppedOnTrash, importDroppedFiles, copyManagedSelectionToLinked, externalDropActive, handleExternalDragEnter, handleExternalDragLeave, handleExternalDragOver, handleExternalDrop, openAssetByDefault, beginInternalAssetDrag, updateImageSequenceFps, createSelectedImageSequence, refreshAfterAutomationScript, cloneFolder, removeLinkedFolder, openWithSettings, openAssetWithProgram, openCreateImageSequenceDialog, dissolveSelectedImageSequence, dissolveSelectedImageSequences } = useImageSequenceOperations({ api, library, imageSequenceDialog, setImageSequenceDialog, locale, clearAssetSelection, reloadCurrentContent, setSelectedAssetIds, visibleAssets, setError, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, reloadCurrentContentRef, activeTagId, tags, currentQueryDefinition, deferredReconcileTimerRef, workspaceCanvasRef, showTrash, trashedAssets, assets, setTrashedAssets, setAssets, setSearchTotal, removeLocallyFromBrowse, setFilteredFolderCountRefreshToken, syncBrowseFilterMembershipRef, refreshTagAndMetadataState, t, setUiState, setTags, setNotice, applyLocalAssetRemoval, chooseTag, setFolders, assetScope, folders, releaseAssetPreviewsBeforeDiskDelete, chooseFolder, openAssetPreview, showTagManagement, showPluginSidebarView, selectedFolderId, presentImportConflicts, presentImportSourceFailure, revealAfterImportRef, runCurrentImportRpc, busy, imageSequencePrefs, previewAsset, managedImportTargetFolderIdRef, offerPostImportSequencesRef, setImportProgress, clearImportConflictsUi, clearImportSourceFailureUi, getManagedAssetDragIds });
  const { showSemanticResults, executeSearchDefinition, assetRenameDialog, cancelAssetRename, openAssetRename, openInlineFolderCreate, inlineFolderEdit, changeInlineFolderEdit, commitInlineFolderEdit, cancelInlineFolderEdit, submitAssetRename, changeAssetRenameValue, applyFolderCoverFromLibrary, openInlineFolderRename, setEntityAppearance, chooseFolderCover, openFolderCoverLibraryPicker, clearFolderCover, useAssetAsFolderCover } = useFolderOperations({ api, library, visibleAssets, reloadCurrentContent, setNotice, setSelectedAssetId, setSelectedAssetIds, linkedFolders, assetScope, chooseFolder, folders, requestTrashManagedFolder, setFolders, setLinkedFolders, setError, t, locale, setFolderBrowseRefreshToken, selectedAssetIds, setFolderCoverPicker, folderCoverPicker, setFolderCustomCoverIds, showTrash, previewAsset, selectedFolderId, selectedFolderIds, handleOpenFolderInFileManager, handleCopyFolder, handleCopyFolderPath, dispatchClipboardPaste, trashMixedSelection, requestSelectionDiskDelete, openDiskDelete, createWorkspaceNavigationRequest, ensureLibraryView, searchRequestGenerationRef, showIgnoredItems, currentSearchScope, isCurrentLibraryView, resetBrowsePaginationPreservingVisibleLayout, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, tagFilter, setActiveTagId, pendingWorkspaceTabSelectionRef, selectionAnchorRef, pendingRevealRef, clearAssetSelection, applySearchResult, beginBrowsePageClearingSimilar, finishWorkspaceNavigation, workspaceCanvasRef, currentQueryDefinition, setFindSimilarSource });
  const { runFindSimilar, revealAfterImport, runSearch } = useSearchOperations({ api, library, previewAssetRef, previewRestoringRef, embeddingSelectionRef, currentQueryDefinition, currentSearchScope, beginWorkspaceNavigationRequest, closeAssetPreview, showIgnoredItems, embeddingService, setNotice, t, showSemanticResults, setError, locale, setWorkspaceNavigationPending, setUiState, workspaceTabsState, findSimilarTokenRef, recordNavigation, finishWorkspaceNavigation, searchValue, tagFilterMode, tagFilterExpression, searchHistoryDismissedUntilInputRef, setSearchHistoryOpen, setSearchHistoryActiveIndex, executeSearchDefinition, workspaceCanvasRef, colorFilter, formatFilter, tagFilter, ratingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, durationRange, longEdgeRange, sortField, sortOrder, skipDiscoveryReloadSignatureRef, hadDiscoveryInput, showTrash, showTagManagement, showPluginSidebarView, publishSearchHistory, excludeColorFilter, colorSimilarity, excludeFormatFilter, tagFilterLastValidExpression, excludeTagFilter, excludedTagFilter, includeAiTagFilter, excludeRatingFilter, includeAiRatingFilter, excludeAvailabilityFilter, loadAiContentForAssetRef, loadAiContentForAsset, rebuildAndApplyMultiEditRef, rebuildAndApplyMultiEdit, refreshAfterAiRef, refreshTagAndMetadataState, setFolderBrowseRefreshToken, reloadCurrentContent, pendingRevealRef, assetScope, chooseFolder, revealAfterImportRef });
  const { abandonConflicts, showAssetInContainingFolder, importAssets, confirmImageSequenceImportOffer, confirmNameConflictDialog, confirmContentDuplicateDialog, abandonSourceFailure, skipImportSourceFailureWith, importEagleLibrary, importBillfishLibrary } = useImportOperations({ visibleAssets, assets, pendingRevealRef, showTrash, assetScope, pendingRestoredFocusRef, setSelectedAssetIds, setSelectedAssetId, setAssetSelectionAnchor, workspaceCanvasRef, chooseFolder, library, imageSequencePrefs, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, offerPostImportSequencesRef, api, setUiState, setError, setNotice, runCurrentImportRpc, managedImportTargetFolderIdRef, t, presentImportConflicts, presentImportSourceFailure, locale, revealAfterImport, showBlockingError, setImportProgress, importProgress, setLibraryTransferKind, setFolderBrowseRefreshToken, reloadCurrentContent, imageSequenceImportOffer, setImageSequenceImportSubmitting, setImageSequenceImportIndex, imageSequenceConfirmPurpose, clearAssetSelection, setImportDecisionSubmitting, completedImportIdRef, clearImportConflictsUi, resolveImportConflictsRef, importSourceFailurePlan, clearImportSourceFailureUi, conflicts, rememberNameConflict, nameDecision, setConflictPhase, duplicateDecision, rememberDuplicate });
  const { applyClosedLibraryUi, clearLibraryScopedView, refreshAssets, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, importFolderAsLinked, forgetRecentLibrary, relinkFolder, saveLinkedRules, convertLinkedToManaged, restoreTrashedAssets, openLinkedRules, requestRestoreTrashedAssets, restoreTrashedManagedFolder } = useLinkedFolderOperations({ api, library, setUiState, reloadCurrentContent, refreshAfterAiRef, setNotice, t, setError, locale, runCurrentImportRpc, featureHintPrefs, setFeatureHintPrefs, setLinkedFolderHintActive, setLinkedRulesEditor, linkedRulesEditor, convertLinkedDialog, setConvertLinkedDialog, libraryTransitionLock, confirmLibrarySwitch, beginLibraryTransition, markLibraryClosePending, closeAssetPreview, clearLibraryClosePending, refreshRecentLibraries, cancelPendingLibraryReads, cancelWorkspaceViewportRestoreRef, setWorkspaceNavigationPending, localAssetRemovalGenerationRef, deferredReconcileTimerRef, managedImportTargetFolderIdRef, setAssetSelectionAnchor, hoveredAssetIdRef, clearHoveredAssetId, metadataByAssetRef, metadataConflictAssetIdsRef, setFolderCoverPicker, resetBrowsePagination, workspaceHistoryReplayEpochRef, resetWorkspaceTabs, libraryViewSessionRef, setLibrary, assetScope, setLibraryLoading, setAssets, setFindSimilarSource, setSelectedAssetIds, setSelectedAssetId, setHoveredAssetId, loadContent, setRestoreDialog, restoreDialog, clearAssetSelection, showTrash, closeContextMenu });
  const { assetSelectionLocationKind, requestAssetDiskDelete, deletePermanentFromTrash, undoLastFileOp, redoLastOperation, moveManagedAssets, setIgnoreState } = useMoveUndoDelete({ api, library, moveDialog, setMoveDialog, setUiState, setNotice, t, clearAssetSelection, reloadCurrentContent, setError, locale, operationHistory, setOperationHistory, reloadCurrentContentRef, refreshOperationHistory, trashedAssets, applyLocalAssetRemoval, assets, releaseAssetPreviewsBeforeDiskDelete, deleteManagedAssetsFromDisk });

  /**
   * Chromium can keep a source stream open for a card hover/selection even
   * after the full viewer closes.  Clear every source-backed card first and
   * give React two frames to unmount the media elements before Windows sees
   * the filesystem delete request.
   */
  async function releaseAssetPreviewsBeforeDiskDelete() {
    await closeAssetPreview(false);
    clearAssetSelection();
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }

  function requestSelectionDiskDelete(
    assetIds: string[],
    folderIds: readonly string[],
  ) {
    const folderIdList = [...folderIds];
    const locationKind = assetSelectionLocationKind(assetIds);
    if (folderIdList.length === 0) {
      requestAssetDiskDelete(assetIds, locationKind);
      return;
    }
    if (assetIds.length === 0 && folderIdList.length === 1) {
      const folderId = folderIdList[0]!;
      const name =
        folderBrowseEntries.find((entry) => entry.folderId === folderId)
          ?.name ??
        folders.find((folder) => folder.folderId === folderId)?.name ??
        folderId;
      openDiskDelete({ kind: "managed", folderId, name });
      return;
    }
    void executeSelectionDiskDelete(assetIds, folderIdList, locationKind);
  }
  const { executeSelectionDiskDelete } = useSelectionDiskDelete({ api, library, releaseAssetPreviewsBeforeDiskDelete, setUiState, setNotice, t, reloadCurrentContent, clearAssetSelection, applyLocalAssetRemoval, setError, locale });

  async function trashMixedSelection(
    assetIds: string[],
    folderIds: readonly string[] = [],
  ) {
    if (!api || !library) return;
    if (assetIds.length === 0 && folderIds.length === 0) return;
    const startedAt = Date.now();

    // 2026-09-15 用户决定：链接资产与链接文件夹不再有「移入回收站」（旧实现会逐个
    // 文件送进系统回收站：实测 126 ms/文件，1.5 万文件约 31 分钟且独占调度器）。
    // 链接项的唯一删除动作是「强制从硬盘删除」，这里只处理托管项。
    const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
    const managedAssetIds = assetIds.filter(
      (assetId) => assetById.get(assetId)?.locationKind !== "linked",
    );
    const managedFolderIds = folderIds.filter(
      (folderId) =>
        !parseLinkedVirtualFolderId(folderId)
        && !linkedFolders.some((folder) => folder.folderId === folderId),
    );
    if (managedAssetIds.length === 0 && managedFolderIds.length === 0) {
      return;
    }
    if (managedFolderIds.length === 0) {
      await trashManagedAssets(managedAssetIds);
      return;
    }
    setUiState("loading");
    try {
      let trashedAssets = 0;
      let trashedFolders = 0;
      let historyEntryId: string | undefined;
      if (managedAssetIds.length === 0 && managedFolderIds.length === 1) {
        const result = await api.trashFolder({
          libraryId: library.libraryId,
          folderId: managedFolderIds[0]!,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        trashedFolders = 1;
        trashedAssets = result.value.trashedAssetCount;
        historyEntryId = result.value.historyEntryId;
      } else {
        const result = await api.trashSelection({
          libraryId: library.libraryId,
          assetIds: managedAssetIds,
          folderIds: [...managedFolderIds],
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        trashedAssets = result.value.trashedAssetCount;
        trashedFolders = result.value.trashedFolderCount;
        historyEntryId = result.value.historyEntryId;
      }
      setNotice(
        t("toast.selectionTrashed", {
          folders: trashedFolders,
          assets: trashedAssets,
        }),
        historyEntryId,
      );
      clearAssetSelection();
      if (
        isBrowseScopeAffectedByFolderTrash(assetScope, managedFolderIds, folders)
      ) {
        await chooseFolder("root");
      } else {
        await reloadCurrentContent();
      }
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.batchDeleteFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }
  const { cancelBatchRelink, cancelImport, cancelDiskDelete, cancelExport, emptyTrash, startBatchRelink, exportLibrary, startImport, startImportZip, completeImportCopy, completeImportInPlace, applyBatchRelink, relinkMissingAsset } = useTransferOperations({ api, library, setUiState, locale, setNotice, t, loadContent, setError, selectedAssetId, setAssets, reloadCurrentContent, batchRelinkKeepMetadata, setBatchRelinkPreview, batchRelinkPreview, exportStartedAtRef, setExportDialogOpen, setExportProgress, exportProgress, deleteProgress, conflicts, abandonConflicts, setImportInterrupt, setImportProgress, imageSequenceImportOffer, setImageSequenceImportOffer, setImageSequenceImportError, importProgress, setLibraryTransferKind, setLibraryTransferName, completedImportIdRef, runCurrentImportRpc, setImportValidated, showBlockingError, libraryTransitionLock, confirmLibrarySwitch, setLibraryLoading, beginLibraryTransition, closeAssetPreview, clearLibraryScopedView, setLibrary, activateLibraryView, clearDiscoveryControls, markLibraryClosePending, setWarning, clearLibraryClosePending, refreshRecentLibraries, importValidated });
  const { dialogFocusTrapActive, dialogEscapeSnapshot, blockingImportOverlayVisible, blockingDeleteOverlayVisible, criticalConfirmation } = useDialogEscapeAndFocus({ api, library, reloadCurrentContentRef, setLayoutThumbnailArtifacts, refreshOperationHistory, applyLoadedMetadata, setNotice, t, setError, locale, setExportProgress, exportStartedAtRef, importAwaitingUserDecisionRef, importRpcDepthRef, retiredImportIdsRef, activeImportIdRef, setImportProgress, setImportInterrupt, setLibraryTransferKind, setSyncProgress, syncRunStartedAtRef, syncRunNotifiedRef, refreshAfterAiRef, setDeleteProgress, conflicts, conflictPhase, imageSequenceImportOffer, importSourceFailurePlan, uiState, importProgress, importRpcInFlight, importOverlayDismissed, deleteProgress, assetRenameDialog, imageSequenceDialog, batchRelinkPreview, restoreDialog, moveDialog, exportDialogOpen, importLibraryChooserOpen, openLibraryChooserOpen, appSettingsOpen, librarySettingsOpen, appLogOpen, scriptSandboxPreviewOpen, aboutOpen, openSourceLicensesOpen, mediaJobsOpen, linkedRulesEditor, convertLinkedDialog, dialog, fatalAlertMessage, aiConnectionFailureGate, importDecisionSubmitting, cancelAssetRename, postImportSequencePlanRef, setImageSequenceImportOffer, setImageSequenceImportError, imageSequenceConfirmPurpose, setImageSequenceDialog, cancelBatchRelink, setRestoreDialog, setMoveDialog, setExportDialogOpen, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, setAppSettingsOpen, setLibrarySettingsOpen, setAppLogOpen, setScriptSandboxPreviewOpen, setAboutOpen, setOpenSourceLicensesOpen, setMediaJobsOpen, setLinkedRulesEditor, setConvertLinkedDialog, setCreateLibraryPhase, setDialog, clearImportConflictsUi, presentImportConflicts, clearImportSourceFailureUi, dismissFatalAlert, onAiConnectionFailureAbort, cancelImport, dismissImportOverlay, cancelDiskDelete, shellApi, libraryLoadingVisible, pluginUiDialogOpen, exportProgress, localConfirmation, showTagManagement, showPluginSidebarView, previewAsset });
  const { loadAiConfig, workspaceTitle, matchingDraftAiProfileId, advanceOpenViewer } = useKeyboardRouting({ dialogFocusTrapActive, previewAssetRef, visibleAssets, navigateAssetPreview, closeAssetPreview, library, busy, workspaceTabsState, previewAsset, addWorkspaceTab, closeWorkspaceTab, showTagManagement, showPluginSidebarView, showTrash, selectedAsset, selectedAssets, browsePasteDestination, diskDeleteKeyboardTargets, searchInputRef, handleOpenExternal, trashManagedAssets, openAssetRename, handleCopyAssetFiles, handleCopyFilePath, dispatchClipboardPaste, handleRevealInFolder, showAssetInContainingFolder, requestSelectionDiskDelete, deletePermanentFromTrash, refreshAssets, pluginSidebarRefreshKey, selectedAssetIds, selectedVisibleAssets, pluginSurfaceContext, shellApi, dialogEscapeSnapshot, goWorkspaceBack, goWorkspaceForward, managedImportTargetFolderIdRef, api, setSyncBindingStatus, pasteClipboardImage, pasteOsClipboardFiles, dialog, conflicts, batchRelinkPreview, restoreDialog, previewModalRef, previewIndex, openAssetPreview, t, activePluginSidebarView, activeTagId, tags, assetScope, selectedFolder, setError, locale, setAiProfiles, updateAiActiveProfileId, setAiProfileDraftId, setAiProfileName, setAiApiFormat, setAiModel, setAiBaseUrl, setAiHasKey, setAiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, setAiDescriptionEnabled, setAiTagsEnabled, setAiRatingEnabled, setAiForceExistingTags, setAiAnalysisSettings, setAiLanguages, setAiConcurrencyLimit, setAiMaxAnalysisImageEdgePx, setAiAutoAnalyzeEnabled, setAiDisclaimerAccepted, aiVerifiedFingerprintRef, aiProfiles, aiProfileDraftId });
  const { beginNewAiProfile, selectAiProfile, activateAiProfile, removeAiProfile, clearAiProfileCredential, commitAiConcurrencyLimit, commitAiMaxAnalysisImageEdgePx, commitAiAnalysisSettingsPatch, probeStoredAiConnection, saveAiConfig, testAiConnectionFromDialog, fetchAiModelsFromDialog } = useAiConfigActions({ aiProfiles, aiProfileDraftId, aiApiKey, aiActiveProfileId, aiApiFormat, aiModel, aiBaseUrl, api, t, aiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, aiVerifiedFingerprintRef, setAiConnectionState, matchingDraftAiProfileId, locale, setAiDraftHasKey, setAiHasKey, aiConfigPersistDraftRef, setError, setAiApiKey, setNotice, setAiSaveVerifying, setAiMaxAnalysisImageEdgePx, setAiConcurrencyLimit, aiAnalysisSettings, setAiAnalysisSettings, aiProfileName, setAiProfileDraftId, setAiProfileName, aiAutoConnectAttemptedRef, setAiProfiles, updateAiActiveProfileId, setAiApiFormat, setAiModel, setAiBaseUrl, loadAiConfig, appSettingsOpen, appSettingsCategory, aiHasKey, librarySettingsOpen, library, setGitignoreContent, aiConnectionProbeGenerationRef });
  const { refreshAiBatchStatus, loadAiJobs, controlMediaJobs, loadMoreMediaJobs, handleAnalyzeClick, handleClearAiContent } = useAiAnalysisJobs({ selectedAssetId, api, library, setError, t, aiHasKey, loadAiConfig, aiJobs, setAiJobs, notifyAiConnectionBatchStarted, locale, setNotice, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, lastAiBatchJobIdsRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, setAiContent, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, showBlockingError, reloadCurrentContentRef, refreshAiBatchStatusRef, applyLiveAiProgressRef, setPluginJobs, jobStatusCoordinatorRef, mediaJobsOpen });
  const { folderCardRowVisible, folderRowEntries, searchActive, mainMenuSections, controlAiJobs } = useJobControlsAndMenu({ api, library, setError, t, locale, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, lastAiBatchJobIdsRef, lastAiBatchAssetIdRef, aiBatchStatusRequestRef, analyzingAssetIdRef, analyzingBatchSizeRef, setAiAnalyzing, setAiBatchProgress, setNotice, refreshAiBatchStatus, loadAiJobs, controlAiJobsRef, busy, editableTextFocused, operationHistory, selectedAssetIds, browsePasteDestination, browseScopeAssetIds, showMissingLinkedFiles, setDialogValue, setCreateLibraryPhase, setDialog, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, importAssets, importFolderAsLinked, pasteClipboardImage, setExportDialogOpen, setAppSettingsOpen, setLibrarySettingsOpen, setShowMissingLinkedFiles, shellApi, showMissingLinkedPublishRef, loadContent, assetScope, showTrash, currentQueryDefinition, showIgnoredItems, undoLastFileOp, redoLastOperation, selectedAssets, handleCopyAssetFiles, dispatchClipboardPaste, selectAllBrowseScope, invertBrowseScope, clearAssetSelection, setAppSettingsCategory, openMediaJobs, openAppLog, openAbout, setOpenSourceLicensesOpen, revealAppLog, openRecentLibrary, dialogFocusTrapActive, searchValue, searchFolderResults, searchFolderRealKey, searchFolderMatchKey, searchFolderRealEntries, filteredFolderCounts, canvasFolderBrowseEntries });
  const { folderCardRowElement } = useFolderCardRowElement({ folderCardRowVisible, browseCanvasBodyLayout, folderCardWidthPx, panelResizing, panelReflowFrozenWidthRef, folderRowEntries, showTrash, library, filteredFolderCounts, createFolderCardDropHandlers, selectedFolderIds, managedFolderDragIdsRef, searchActive, chooseFolder, handleFolderCardClick, openContextMenu, selectedAssetIds, setSelectedFolderIds, setSelectedAssetIds, enterTrashAt, cardMouseDownRef, selectedFolderIdSet });
  return { setPluginUiDialogOpen, pluginManagerApi, libraryLoading, libraryLoadingVisible, blockingImportOverlayVisible, blockingDeleteOverlayVisible, api, setLibraryLoading, setUiState, setDialog, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, importInterrupt, cancelImport, dismissImportOverlay, importProgress, libraryTransferKind, libraryTransferName, imageSequenceImportError, imageSequenceImportOffer, imageSequenceImportIndex, imageSequencePreviewSource, imageSequenceConfirmPurpose, postImportSequencePlanRef, setImageSequenceImportOffer, setImageSequenceImportError, setImportProgress, confirmImageSequenceImportOffer, imageSequenceImportSubmitting, conflicts, conflictPhase, library, nameDecision, rememberNameConflict, setNameDecision, setRememberNameConflict, abandonConflicts, confirmNameConflictDialog, importDecisionSubmitting, duplicateDecision, rememberDuplicate, setDuplicateDecision, setRememberDuplicate, confirmContentDuplicateDialog, importSourceFailurePlan, abandonSourceFailure, skipImportSourceFailureWith, cancelDiskDelete, deleteProgress, exportProgress, t, cancelExport, shortcutRuntimeVersion, leftOpen, rightOpen, panelResizing, panelResizeShellStyle, setLeftOpen, busy, importMenuCopy, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, setDialogValue, setCreateLibraryPhase, importAssets, importFolderAsLinked, refreshRecentLibraries, openRecentLibrary, forgetRecentLibrary, goWorkspaceBack, goWorkspaceForward, mainMenuSections, workspaceTabsState, workspaceTabPresentations, addWorkspaceTab, closeWorkspaceTab, selectWorkspaceTab, moveWorkspaceTab, openContextMenu, runSearch, semanticSearchActive, searchHistory, searchHistoryDismissedUntilInputRef, searchInputRef, publishSearchHistory, embeddingSearchReady, embeddingService, setRightOpen, shellApi, showIgnoredItems, setShowIgnoredItems, loadContent, assetScope, showTrash, currentQueryDefinition, chooseFolder, enterTrash, enterTagManagement, enterPluginSidebarView, setSelectedFolderIds, handleTargetExternalDragOver, handleTargetExternalDrop, getManagedAssetDragIds, getManagedFolderDragIds, resolveManagedAssetDrop, isInternalAssetDrag, handleAssetsDroppedOnFolder, handleFoldersDroppedOnFolder, folders, linkedFolders, handleAssetsDroppedOnTrash, handleFoldersDroppedOnTrash, dragPreviewRef, beginLinkedFolderHintHover, endLinkedFolderHintHover, relinkFolder, linkedFolderAddHintEligible, setLinkedFolderHintActive, linkedFolderHintStopTimerRef, openInlineFolderCreate, changeInlineFolderEdit, commitInlineFolderEdit, cancelInlineFolderEdit, importDroppedFiles, copyManagedSelectionToLinked, tags, activeTagId, pinnedTagId, togglePinnedTag, chooseTag, handleCreateTagInManagement, handleRenameTagInManagement, moveTagInTree, handleDeleteTagsInManagement, assignAssetsToTreeTag, backgroundJobsActive, setAutomaticTaskEditorId, setAutomaticTasksOpen, openMediaJobs, setScriptSandboxPreviewOpen, pluginSidebarViews, workspaceTabRevealTarget, filteredFolderCounts, folderTreeActionsRef, linkedFolderHintShow, inlineFolderEdit, showPluginSidebarView, recursiveHintActive, includeSubfoldersHoverTimerRef, recursiveHintKey, closeAssetPreview, setError, locale, workspaceTitle, enterTrashAt, scopeBreadcrumbSegments, workspaceBrowseCount, emptyTrash, visibleAssets, startBatchRelink, refreshAssets, setCanvasPrefs, canvasPrefs, assetCardSize, cardSizeStops, resizeAssetCards, pluginContributionRefreshKey, selectedVisibleAssets, pluginSurfaceContext, dialogFocusTrapActive, clearDiscoveryFilter, setPinnedTagId, controlAiJobs, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, workspaceNavigationPending, workerRecoveryState, previewAsset, previewRestoring, previewCanvasReady, renderedToastStack, topVisibleToastId, dismissToast, handleToastTransitionEnd, undoLastFileOp, externalDropActive, handleExternalDragEnter, handleExternalDragLeave, handleExternalDragOver, handleExternalDrop, handleCanvasMouseDown, workspaceCanvasRef, marqueeBoxRef, activePluginSidebarView, handleMergeTagsInManagement, handleSearchTagsFromManagement, browseCanvasBodyLayout, folderCardRowElement, assetViewMode, assetGridRef, panelReflowFrozenWidthRef, sourceBadgeContext, selectedFolderId, syncCardStatuses, assetRenameDialog, selectedIdSet, nativeAssetDragEnabled, selectedNativeDragReady, nativeDragReadyIds, cardMouseDownRef, setHoveredAssetId, clearHoveredAssetId, handleCardClick, selectionAssetIds, openAssetByDefault, managedAssetDragIdsRef, beginInternalAssetDrag, hoveredAssetId, viewerVolumeMuted, viewerVolume, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, submitAssetRename, changeAssetRenameValue, cancelAssetRename, assetRenderSections, visibleBrowseLayout, visibleVirtualBrowseLayout, browsePagination, browseEmptyState, pasteClipboardImage, previewModalRef, bakeImageRotation, viewerChromeIdle, viewerChromePrefs, setViewerChromePrefs, requestSelectionDiskDelete, deletePermanentFromTrash, advanceOpenViewer, trashManagedAssets, onViewerChromeActivity, persistAssetColorSpace, setNotice, previewIndex, navigateAssetPreview, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, loadMetadata, handleInspectorAssignTag, handleInspectorCreateAndAssignTag, handleInspectorApplyTagNames, handleOpenSourceUrl, handleInspectorRemoveTag, aiContent, selectedAsset, automaticPaletteRatios, displayedPalette, folderInspector, folderInspectorAppearance, selectedAssets, multiEdit, updateImageSequenceFps, createSelectedImageSequence, linkedRulesEditor, setLinkedRulesEditor, saveLinkedRules, convertLinkedToManaged, restoreTrashedAssets, moveManagedAssets, folderCoverPicker, loadFolderCoverPickerPage, setFolderCoverPicker, applyFolderCoverFromLibrary, beginNewAiProfile, selectAiProfile, activateAiProfile, removeAiProfile, clearAiProfileCredential, commitAiConcurrencyLimit, commitAiMaxAnalysisImageEdgePx, commitAiAnalysisSettingsPatch, probeStoredAiConnection, saveAiConfig, testAiConnectionFromDialog, fetchAiModelsFromDialog, aiUiPrefs, imageSequencePrefs, showMissingLinkedPublishRef, audioPreviewPrefersCover, applyAudioPreviewPreference, applyBakeImageRotation, setAiUiPrefs, setImageSequencePrefs, openAppLog, reloadCurrentContent, syncRunStartedAtRef, embeddingBound, runLibraryOpenPipeline, appLogErrorCode, refreshAppLog, revealAppLog, revealRecoveryReport, automaticTaskEditorId, refreshAfterAutomationScript, createLibraryPhase, dialogValue, cancelEagleInspectFlow, cancelBillfishInspectFlow, submitEagleLibraryName, submitBillfishLibraryName, runLibraryOperation, exportLibrary, openEagleLibrary, openBillfishLibrary, startImport, startImportZip, importEagleLibrary, importBillfishLibrary, completeImportCopy, completeImportInPlace, applyBatchRelink, cancelBatchRelink, aiConnectionFailureGate, onAiConnectionFailureAbort, handleAiConnectionFailureRetry, fatalAlertMessage, dismissAlreadyOpenPrompt, confirmAlreadyOpenLibrarySwitch, dismissFatalAlert, openLibraryChooserFromError, criticalConfirmation, embeddingSelectionId, controlMediaJobs, loadMoreMediaJobs, pluginBrowseScope, pluginViewerState, menuSkipScope, closeOtherWorkspaceTabs, setWorkspaceTabRevealTarget, workspaceTabRevealRequestRef, setIgnoreState, openInlineFolderRename, handleOpenFolderInFileManager, handleCopyFolderPath, handleCopyFolder, dispatchClipboardPaste, cloneFolder, openLinkedRules, requestTrashManagedFolder, openDiskDelete, removeLinkedFolder, setEntityAppearance, chooseFolderCover, openFolderCoverLibraryPicker, clearFolderCover, useAssetAsFolderCover, batchAssignTagToSelection, batchRemoveTagFromSelection, trashMixedSelection, requestRestoreTrashedAssets, relinkMissingAsset, handleAnalyzeClick, handleClearAiContent, clearAssetSelection, handleOpenExternal, openWithSettings, openAssetWithProgram, openAssetPreview, openCreateImageSequenceDialog, dissolveSelectedImageSequence, dissolveSelectedImageSequences, handleRevealInFolder, showAssetInContainingFolder, runFindSimilar, handleCopyFilePath, handleCopyAssetFiles, browsePasteDestination, openAssetRename, assignAssetToTag, restoreTrashedManagedFolder, capturePanelResizeAnchor, resetPanelWidth, beginPanelResize, navPanelWidth, beginPanelEdgeRestore, inspectorPanelWidth };
}
