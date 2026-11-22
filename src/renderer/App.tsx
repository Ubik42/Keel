import { usePrefsStore } from "./stores/prefs-store";
import { sessionFields, useSessionField } from "./stores/session-store";
import { LocalConfirmationHost, requestConfirmation, useLocalConfirmation } from "./local-confirmation";
import { useShortcutRuntimeVersion } from "./workbench/shortcuts/shortcut-provider";
import { useLocale, useT } from "./i18n";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useScrollbarActivity } from "./workbench/collection/use-scrollbar-activity";
import { useNativeDragReadyIds } from "./use-native-drag-readiness";
import { type AssetScope, useNavigationField } from "./stores/navigation-store";
import { type AssetMetadataResult, type AssetSummary, type FilterClause, type LinkedFolderRule, type SortDefinition } from "../shared/asset-types";
import { useDialogField } from "./stores/dialogs-store";
import { browseFields, useBrowseField } from "./stores/browse-store";
import { type BrowseMembershipChange } from "./browse-filter-membership";
import { useSelectionField } from "./stores/selection-store";
import { createLibraryTransitionLock } from "./library-transition-lock";
import { createTrackedLibraryApi } from "./tracked-library-api";
import { useToastNotifications } from "./useToastNotifications";
import { CreateDialog, type CreateLibraryPhase } from "./CreateDialog";
import { transfersFields, useTransfersField } from "./stores/transfers-store";
import { isPostImportSequenceOfferId, type PostImportSequencePlan } from "./post-import-image-sequences";
import { importedSequenceFrameUrl, type SequencePreviewFrame, type SequencePreviewSource } from "./image-sequence-preview";
import { type ImportConflictPlan, type ImportSourceFailurePlan } from "../shared/protocol/responses";
import { loadImportConflictPreferences, type RememberedDuplicateDecision, type RememberedNameConflictDecision } from "./import-conflict-preferences";
import { resolveImportConflictPresentation } from "./import-conflict-flow";
import { usePanelResize } from "./workbench/shell/use-panel-resize";
import { useWorkspaceField } from "./stores/workspace-store";
import { LINKED_FOLDER_ADD_HINT_KEY, shouldShowLinkedFolderAddHint } from "./linked-folder-add-hint";
import { hasFeatureHintBeenShown, isFeatureHintEnabled, saveFeatureHintPreferences, withFeatureHintShown } from "./feature-hint-preferences";
import { FOLDER_BROWSE_CARD_PREFERENCES_CHANGED, loadFolderBrowseCardPreferences } from "./folder-browse-card-preferences";
import { useQueryField } from "./stores/query-store";
import { parseSearchExpressionDetailed, searchExpressionReasonKey, type parseSearchExpression } from "./search-expression";
import { clearSearchHistory, filterSearchHistory, moveSearchHistoryIndex, readSearchHistory, readVisibleSearchHistoryCount, rememberSearchQuery, searchHistoryNavigationDirection } from "./search-history";
import { recursiveSubfoldersHintKey } from "./recursive-subfolders-hint";
import { ContextMenuProvider, useContextMenu } from "./workbench/menu/context-menu";
import { createDefaultWorkspaceTabBrowseState, type WorkspaceTabBrowseState, type WorkspaceTabSession, workspaceTabBrowseStateHasDiscoveryInput } from "./workspace-tabs";
import { advanceLibraryViewSession, invalidateLibraryViewSession, isCurrentLibraryViewSession, type LibraryViewSession, type LibraryViewSessionToken } from "./library-view-session";
import { inspectorFields, useInspectorField } from "./stores/inspector-store";
import { useBrowsePagination } from "./use-browse-pagination";
import { useInspectorMultiEdit } from "./use-inspector-multi-edit";
import { isEditableTextTarget } from "../shared/edit-context-menu";
import { addRetiredImportId, runImportRpc } from "./import-progress-session";
import { usePluginsField } from "./stores/plugins-store";
import { PluginSidebarViewPanel, isPluginSidebarViewsEnabled, usePluginSidebarViews } from "./plugin-sidebar-views";
import { FOLDER_COVER_PICKER_PAGE_SIZE, folderCoverPickerAssetMatches, folderCoverPickerImageFilter, folderCoverPickerSearchQuery } from "./folder-cover-picker";
import { LibraryOperationError, messageForPublicError, toMessage } from "./error-utils";
import { browseEntryUnderPreview, type WorkspaceNavViewport, workspaceNavLocationsEqual } from "./workbench/workspace/workspace-nav-history";
import { NavigationSidebar, type FolderTreeExpandActions } from "./NavigationSidebar";
import { useWorkspaceTabsController } from "./use-workspace-tabs";
import { buildWorkspaceTabsSession, readWorkspaceTabsSession, writeWorkspaceTabsSession } from "./workspace-tabs-session";
import { resolveSearchFolderResults } from "./search-folder-results";
import { type ReadAppLogResult } from "../shared/app-log";
import { activeLibrarySwitchActivity } from "./library-switch-safety";
import { aiFields, useAiField } from "./stores/ai-store";
import { DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS, type AiApiFormat } from "../shared/ai-endpoints";
import { DEFAULT_AI_ANALYSIS_SETTINGS, toWireAiAnalysisSettings } from "../shared/ai-analysis-settings";
import { useInspectorAssetMetadata } from "./use-inspector-asset-metadata";
import { type AiProgressJobUpdate } from "./ai-analyze-progress";
import { usePreviewField } from "./stores/preview-store";
import { AssetPreviewModal, type AssetPreviewModalHandle } from "./AssetPreviewModal";
import { useViewerChromeIdle } from "./use-viewer-chrome-idle";
import { useSyncCardStatuses } from "./use-sync-card-status";
import { useViewerVolume } from "./use-viewer-volume";
import { enumerateDiscreteCardSizes } from "./card-size-stops";
import { FOLDER_CARD_ROW_INLINE_PADDING_PX, masonryAlignedFolderWidthPx } from "./folder-card-width";
import { PREVIEW_SCROLL_HOLD_MS, canvasHasPreviewScrollHold, installBrowseScrollWriteSpy, logBrowseScrollWrite, setCanvasPreviewScrollHold } from "./browse-scroll-debug";
import { captureWorkspaceNavViewport, pendingWorkspaceViewportAction, resolveWorkspaceScrollTop } from "./workbench/workspace/workspace-scroll-position";
import { rectLikeFromDomRect, type AnchorCard, type CanvasAnchor } from "./workbench/collection/canvas-scroll-anchor";
import { captureReflowAnchorFromCards, scheduleAnchorRestore, type ScrollOffsetSnapshot } from "./canvas-reflow-restore";
import { type PendingAssetReveal } from "./pending-asset-reveal";
import { type BrowseViewSnapshot } from "./workbench/collection/view-restore";
import { ASSET_DRAG_PREVIEW_HEIGHT, ASSET_DRAG_PREVIEW_WIDTH, dismissAssetDragPreview, setAssetDragPreviewCopyMode, showAssetDragPreview } from "./asset-drag-preview";
import { loadSemanticSearchPreferences, saveSemanticSearchPreferences } from "./semantic-search-preferences";
import { createPortal, flushSync } from "react-dom";
import { virtualLayoutEntryForAsset } from "./browse/virtual-browse-layout";
import { ScopeBreadcrumbs } from "./ScopeBreadcrumbs";
import { assetCardKey, isCardHoverPreviewable, isCardSequencePlayable, resolveAssetCardCoverUrl } from "./asset-card-hover-preview";
import { assetCaptionAlignClass, nextCanvasCaptionAlign, shouldShowGridDimensions } from "./canvas-preferences";
import { folderSearchScope } from "./folder-browse-scope";
import { LibrarySwitcher, buildRecentLibraryMenuEntries } from "./LibrarySwitcher";
import { saveFolderRecursivePreferences, withFolderRecursiveEnabled } from "./folder-recursive-preferences";
import { descendantTagIds } from "./tag-tree-model";
import { resolveInspectorTagTarget } from "./inspector-tag-target";
import { compactFormatFilterTokens } from "../shared/text-media";
import { buildTagFilterClauses, resolveTagFilterSets } from "./dimension-filter-selection";
import { DEFAULT_IMAGE_SEQUENCE_FPS } from "../shared/image-sequence";
import { splitAssetFileName } from "./useAssetRename";
import { linkedRevealFolderId, parseLinkedVirtualFolderId } from "../shared/linked-folder-tree";
import { playTaskCompletionSound } from "./task-completion-sound";
import { isBrowseScopeAffectedByFolderTrash } from "./folder-trash-scope";
import { formatBytes } from "./format-file-meta";
import { isImeKeyboardEvent } from "./workbench/overlay/ime-safe-dismiss";
import { aiAnalyzeConnectionReady, aiAnalyzeShowsDisconnectGlyph } from "./ai-connection-heartbeat";
import { KEEL_VERSION } from "./main-menu-items";
import { writeShowMissingLinkedFiles } from "./linked-missing-preference";
import { resolveBrowseContextMenuIntent } from "./browse-selection-menu";
import { HoverTipHost } from "./workbench/overlay/hover-tip";
import { PluginUiDialogHost } from "./plugin-ui-dialog-host";
import { EditTextContextMenuHost } from "./workbench/menu/edit-text-context-menu";
import { LibraryLoadingOverlay } from "./LibraryLoadingOverlay";
import { ImportProgressOverlay } from "./ImportProgressOverlay";
import { ImageSequenceImportDialog } from "./ImageSequenceImportDialog";
import { NameConflictDialog } from "./NameConflictDialog";
import { ContentDuplicateDialog } from "./ContentDuplicateDialog";
import { ImportSourceFailureDialog } from "./ImportSourceFailureDialog";
import { DeleteProgressOverlay } from "./DeleteProgressOverlay";
import { BlockingProgressOverlay } from "./BlockingProgressOverlay";
import { ScopeHistoryButtons } from "./ScopeHistoryButtons";
import { MainMenu } from "./MainMenu";
import { AppSettingsEntry } from "./AppSettingsEntry";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { Icon } from "./Icons";
import { SearchHistoryPopover } from "./SearchHistoryPopover";
import { WindowsWindowControls } from "./workbench/shell/WindowsWindowControls";
import { WindowEdgeResizeHandles } from "./workbench/shell/WindowEdgeResizeHandles";
import { TagTreeSidebar } from "./TagTreeSidebar";
import { AutomaticTasksSidebar } from "./AutomaticTasksSidebar";
import { LIBRARY_ROOT_FOLDER_ID, isLibraryRootFolderId } from "../shared/library-root-folder";
import { toggleFolderMultiSelection } from "./folder-selection-toggle";
import { iconActionAttrs } from "./icon-action-attrs";
import { CanvasToolbarControls } from "./CanvasToolbarControls";
import { PluginToolbarButtons } from "./plugin-toolbar-contributions";
import { PluginWorkspaceViews } from "./plugin-workspace-views";
import { DimensionFilterBar } from "./DimensionFilterBar";
import { PluginJobActivityBanner } from "./PluginJobActivityBanner";
import { Notice } from "./workbench/ui/patterns";
import { WorkspaceNoticeBanner } from "./WorkspaceNoticeBanner";
import { FindSimilarBanner } from "./FindSimilarBanner";
import { TagManagementWorkspace } from "./TagManagementWorkspace";
import { assetGridLayoutStyle } from "./workbench/collection/asset-grid-layout";
import { assetTypeBadgeLabel, fileExtensionLabel, formatSequenceDuration, shouldShowAssetCardBadges, shouldShowDurationBadge, shouldShowExtensionBadge, shouldShowTypeBadgeAlongsideExtension } from "./asset-card-badges";
import { corruptAssetAffordance, isCorruptAsset, missingAssetAffordance, shouldShowMissingAssetOverlay } from "./availability-affordance";
import { resolveAssetSourceBadgeLabel, shouldShowAssetSourceBadge } from "./asset-source-badge";
import { trashedFromLabel } from "./trashed-from-label";
import { resolveSearchSnippetCaption } from "./search-snippet-caption";
import { shouldShowThumbnailFailureBadge } from "./thumbnail-failure-badge";
import { MANAGED_ASSETS_DRAG_TYPE, resolveDragDropMode, resolveDraggedAssetIds } from "./asset-drag-drop";
import { resolveMasonryTabTarget } from "./workbench/collection/masonry-focus-order";
import { TAG_DRAG_TYPE } from "./tag-drag-drop";
import { TextAssetPreviewTile } from "./TextAssetPreviewTile";
import { AssetCardMedia } from "./AssetCardMedia";
import { SyncCardStatusBadge } from "./SyncCardStatusBadge";
import { MasonryColumns } from "./masonry-columns";
import { BrowseLayoutPreview } from "./BrowseLayoutPreview";
import { JustifiedAssetRows } from "./justified-asset-rows";
import { InspectorPanel } from "./InspectorPanel";
import { ImageSequenceDialog } from "./ImageSequenceDialog";
import { LinkedRulesDialog } from "./LinkedRulesDialog";
import { ConvertLinkedDialog } from "./ConvertLinkedDialog";
import { RestoreDialog } from "./RestoreDialog";
import { MoveDialog } from "./MoveDialog";
import { FolderCoverPickerDialog } from "./FolderCoverPickerDialog";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { AiConfigDialog } from "./AiConfigDialog";
import { LibrarySettingsDialog } from "./LibrarySettingsDialog";
import { OpenSyncLibraryDialog } from "./OpenSyncLibraryDialog";
import { AppLogDialog } from "./AppLogDialog";
import { LibraryRecoveryDialog } from "./LibraryRecoveryDialog";
import { AutomaticTasksDialog } from "./AutomaticTasksDialog";
import { ScriptSandboxPreviewDialog } from "./ScriptSandboxPreviewDialog";
import { AboutDialog } from "./AboutDialog";
import { OpenSourceLicensesDialog } from "./OpenSourceLicensesDialog";
import { ExportDialog } from "./ExportDialog";
import { ImportLibraryChooserDialog, OpenLibraryChooserDialog } from "./ImportLibraryChooserDialog";
import { ImportDialog } from "./ImportDialog";
import { RelinkPreview } from "./RelinkPreview";
import { AiConnectionFailureDialog } from "./AiConnectionFailureDialog";
import { FatalAlertDialog } from "./FatalAlertDialog";
import { CriticalConfirmationDialog } from "./CriticalConfirmationDialog";
import { MediaJobsDialog } from "./MediaJobsDialog";
import { AssetContextMenu } from "./AssetContextMenu";
import type {
  QueryFilterSnapshot,
  RendererWindow,
  SearchDefinition,
  WorkspaceNavigationRequest,
} from "./app/app-shared";
import { folderRecursiveRef, late } from "./app/app-shared";
import {
  IS_MAC_PLATFORM,
  IS_WINDOWS_PLATFORM,
  LIBRARY_LOADING_DISPLAY_DELAY_MS,
  SHORTCUT_PLATFORM,
  ToolButton,
  formatDate,
  formatDuration,
  highlightSnippet,
  parseNumericRange,
  renderMiddleEllipsisFilename,
  useDelayedVisibility,
} from "./app/app-shared";
import { useFolderCardRowElement } from "./app/use-folder-card-row-element";
import { useJobControlsAndMenu } from "./app/use-job-controls-and-menu";
import { useAiAnalysisJobs } from "./app/use-ai-analysis-jobs";
import { useAiConfigActions } from "./app/use-ai-config-actions";
import { useKeyboardRouting } from "./app/use-keyboard-routing";
import { useDialogEscapeAndFocus } from "./app/use-dialog-escape-and-focus";
import { useTransferOperations } from "./app/use-transfer-operations";
import { useSelectionDiskDelete } from "./app/use-selection-disk-delete";
import { useMoveUndoDelete } from "./app/use-move-undo-delete";
import { useLinkedFolderOperations } from "./app/use-linked-folder-operations";
import { useImportOperations } from "./app/use-import-operations";
import { useSearchOperations } from "./app/use-search-operations";
import { useFolderOperations } from "./app/use-folder-operations";
import { useImageSequenceOperations } from "./app/use-image-sequence-operations";
import { useContentQueries } from "./app/use-content-queries";
import { useTagOperations } from "./app/use-tag-operations";
import { useScopeNavigation } from "./app/use-scope-navigation";
import { useLibraryOpening } from "./app/use-library-opening";
import { useWorkspaceHistoryReplay } from "./app/use-workspace-history-replay";
import { useWorkspaceSnapshotRestore } from "./app/use-workspace-snapshot-restore";
import { useWorkspaceNavigationRequests } from "./app/use-workspace-navigation-requests";
import { useWorkspaceHistoryUi } from "./app/use-workspace-history-ui";
import { useLibraryEventSubscriptions } from "./app/use-library-event-subscriptions";
import { useContentLoading } from "./app/use-content-loading";
import { useCloseAssetPreview } from "./app/use-close-asset-preview";
import { useCanvasEffects } from "./app/use-canvas-effects";
import { useBrowseSelection } from "./app/use-browse-selection";
import { useBrowsePluginContext } from "./app/use-browse-plugin-context";
import { useAssetDragState } from "./app/use-asset-drag-state";


function AppInner() {
  const setCanvasPrefs = usePrefsStore((state) => state.setCanvas);
  const [libraryRecoveryDialogOpen, setLibraryRecoveryDialogOpen] = useSessionField("libraryRecoveryDialogOpen");
  const localConfirmation = useLocalConfirmation();
  const shortcutRuntimeVersion = useShortcutRuntimeVersion();
  const t = useT();
  const { locale } = useLocale();
  const rawLibraryApi = (window as RendererWindow).keel?.library;
  const nativeAssetDragEnabled = !(window as RendererWindow).keel?.e2e
    || Boolean((window as RendererWindow).keel?.e2e?.useNativeAssetDrag);
  const shellApi = (window as RendererWindow).keel?.shell;

  useEffect(() => {
    document.body.classList.toggle("platform-darwin", IS_MAC_PLATFORM);
  }, []);

  useScrollbarActivity();

  // Library / folder / assets (existing)
  const [library, setLibrary] = useSessionField("library");
  const nativeDragReadyIds = useNativeDragReadyIds(rawLibraryApi, library?.libraryId);
  const setRecentLibraries = sessionFields.setterFor("recentLibraries");
  const [folders, setFolders] = useNavigationField("folders");
  const [linkedFolders, setLinkedFolders] = useNavigationField("linkedFolders");
  const [linkedRulesEditor, setLinkedRulesEditor] = useState<{
    folderId: string;
    name: string;
    rules: LinkedFolderRule[];
  } | null>(null);
  const [convertLinkedDialog, setConvertLinkedDialog] = useDialogField("convertLinkedDialog");
  const [assets, setAssets] = useBrowseField("assets");
  const [findSimilarSource, setFindSimilarSource] = useNavigationField("findSimilarSource");
  const findSimilarTokenRef = useRef(0);
  const syncBrowseFilterMembershipRef = useRef<
    (change: BrowseMembershipChange) => void
  >(() => undefined);
  const [browseLayout, setBrowseLayout] = useBrowseField("browseLayout");
  const [virtualBrowseLayout, setVirtualBrowseLayout] = useBrowseField("virtualBrowseLayout");
  const [layoutThumbnailArtifacts, setLayoutThumbnailArtifacts] = useBrowseField("layoutThumbnailArtifacts");
  const [assetScope, setAssetScope] = useNavigationField("assetScope");
  // REQ-FOLDER-001/002/003/010: direct child folder cards shown above assets
  // when the current browse parent is a managed folder or the managed root.
  const [folderBrowseEntries, setFolderBrowseEntries] = useBrowseField("folderBrowseEntries");
  const [folderNavigationCovers, setFolderNavigationCovers] = useBrowseField("folderNavigationCovers");
  const setFolderCustomCoverIds = browseFields.setterFor("folderCustomCoverIds");
  const [folderCoverPicker, setFolderCoverPicker] = useState<{
    folderIds: string[];
    assetId: string;
  } | null>(null);
  // Serpent-d0nv: bump to re-fetch folder browse entries when a cover
  // candidate's thumbnail becomes ready (progressive cover refresh).
  const [folderBrowseRefreshToken, setFolderBrowseRefreshToken] = useBrowseField("folderBrowseRefreshToken");
  const folderCoverCandidateAssetIdsRef = useRef<ReadonlySet<string>>(new Set());
  /** Full trash tombstone list for hierarchy browse (Serpent-6pcd). */
  const [trashedFolders, setTrashedFolders] = useNavigationField("trashedFolders");
  const [trashBrowseTombstoneId, setTrashBrowseTombstoneId] = useBrowseField("trashBrowseTombstoneId");
  const [masonryGridWidth, setMasonryGridWidth] = useState(0);
  const assetGridRef = useRef<HTMLDivElement | null>(null);
  const [fatalDialogTitle, setFatalDialogTitle] = useDialogField("fatalDialogTitle");
  const [fatalAlertAlreadyOpen, setFatalAlertAlreadyOpen] = useDialogField("fatalAlertAlreadyOpen");
  const pendingAlreadyOpenPathRef = useRef<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useSelectionField("selectedFolderIds");
  const managedImportTargetFolderIdRef = useRef<string | undefined>(undefined);
  const [allAssetCount, setAllAssetCount] = useBrowseField("allAssetCount");
  const setRootAssetCount = browseFields.setterFor("rootAssetCount");
  const [selectedAssetId, setSelectedAssetId] = useSelectionField("selectedAssetId");
  const [selectedAssetIds, setSelectedAssetIds] = useSelectionField("selectedAssetIds");
  const selectedNativeDragReady = useMemo(
    () => selectedAssetIds.every((id) => nativeDragReadyIds.has(id)),
    [nativeDragReadyIds, selectedAssetIds],
  );
  // Session persistence must wait until the startup restore has applied the
  // saved scope and selection; otherwise the initial empty React state can
  // overwrite the last browsed asset in localStorage.
  const [browserSessionReady, setBrowserSessionReady] = useSessionField("browserSessionReady");
  const [uiState, setUiState] = useSessionField("uiState");
  const [libraryLoading, setLibraryLoading] = useSessionField("libraryLoading");
  const libraryLoadingVisible = useDelayedVisibility(
    libraryLoading !== null,
    LIBRARY_LOADING_DISPLAY_DELAY_MS,
  );
  const busy = [
    "booting",
    "creating",
    "opening",
    "closing",
    "loading",
    "importing",
  ].includes(uiState);
  const libraryTransitionLockRef = useRef<ReturnType<typeof createLibraryTransitionLock> | null>(null);
  const libraryTransitionLock =
    libraryTransitionLockRef.current ??
    (libraryTransitionLockRef.current = createLibraryTransitionLock());
  const libraryTransitionInlineOpeningRef = useRef<
    "open-eagle" | "open-billfish" | null
  >(null);
  const libraryWriteDepthRef = useRef(0);
  const libraryWriteInFlightRef = useRef(false);
  const [, forceLibraryWriteState] = useState(false);
  const beginLibraryWrite = useCallback(() => {
    libraryWriteDepthRef.current += 1;
    libraryWriteInFlightRef.current = true;
    forceLibraryWriteState(true);
  }, []);
  const endLibraryWrite = useCallback(() => {
    libraryWriteDepthRef.current = Math.max(0, libraryWriteDepthRef.current - 1);
    const active = libraryWriteDepthRef.current > 0;
    libraryWriteInFlightRef.current = active;
    forceLibraryWriteState(active);
  }, []);
  const api = useMemo(
    () =>
      rawLibraryApi
        ? createTrackedLibraryApi(
            rawLibraryApi,
            beginLibraryWrite,
            endLibraryWrite,
            libraryTransitionLock.runWrite,
          )
        : undefined,
    [beginLibraryWrite, endLibraryWrite, libraryTransitionLock, rawLibraryApi],
  );
  const audioPreviewPrefersCover = usePrefsStore((state) => state.audioPreviewPrefersCover);
  const applyAudioPreviewPreference = usePrefsStore((state) => state.setAudioPreviewPrefersCover);
  const bakeImageRotation = usePrefsStore((state) => state.bakeImageRotation);
  const applyBakeImageRotation = usePrefsStore((state) => state.setBakeImageRotation);
  const libraryIdForAudioPreview = library?.libraryId;
  useEffect(() => {
    if (!api || !libraryIdForAudioPreview) return;
    void api.setAudioPreviewPreference({
      libraryId: libraryIdForAudioPreview,
      preferCover: audioPreviewPrefersCover,
    });
  }, [api, audioPreviewPrefersCover, libraryIdForAudioPreview]);
  // Keep AI readiness (hasKey) in sync without requiring the settings dialog.
  useEffect(() => {
    if (!api) return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per api identity
  }, [api]);
  // Toast + fatal alert (REQ-SHELL-010 / Serpent-99lv): controller owns
  // auto-dismiss, stack ordering, and the toast closing lifecycle.
  const {
    renderedStack: renderedToastStack,
    fatal: fatalAlertMessage,
    setError,
    setWarning,
    setNotice,
    setFatal,
    dismissToast,
    handleToastTransitionEnd,
  } = useToastNotifications();
  // P1: tell the user once per library when `.keel` could not become `.keel`.
  const metaDirNoticeLibraryIdRef = useRef<string | null>(null);
  useEffect(() => {
    const migration = library?.metaDirMigration;
    if (!library || !migration || metaDirNoticeLibraryIdRef.current === library.libraryId) return;
    metaDirNoticeLibraryIdRef.current = library.libraryId;
    if (migration === "failed") {
      setWarning(t("library.metaDirMigrationFailed", { reason: library.metaDirMigrationReason ?? "?" }));
    } else {
      setNotice(t("library.metaDirMigrationBoth"));
    }
  }, [library, setNotice, setWarning, t]);
  const [workerRecoveryState, setWorkerRecoveryState] = useSessionField("workerRecoveryState");
  const topVisibleToastId = renderedToastStack.find(
    (entry) => !entry.closing,
  )?.id;
  const dismissFatalAlert = useCallback(() => {
    setFatalAlertAlreadyOpen(false);
    setFatalDialogTitle(null);
    setFatal(null);
  }, [setFatal, setFatalAlertAlreadyOpen, setFatalDialogTitle]);
  const dismissAlreadyOpenPrompt = useCallback(() => {
    pendingAlreadyOpenPathRef.current = null;
    dismissFatalAlert();
  }, [dismissFatalAlert]);

  const showBlockingError = useCallback(
    (title: string, message: string, options?: { alreadyOpen?: boolean }) => {
      if (options?.alreadyOpen !== true) {
        pendingAlreadyOpenPathRef.current = null;
      }
      setFatalAlertAlreadyOpen(options?.alreadyOpen === true);
      setFatalDialogTitle(title);
      setFatal(message);
    },
    [setFatal, setFatalAlertAlreadyOpen, setFatalDialogTitle],
  );

  // NAS/SMB 库提示不再用常驻 banner（破坏界面一体性），改为每次打开库时
  // 弹一次普通 warning toast。networkStorage 由打开动作决定，同一库不变，
  // 按库身份（libraryId）去重即可，不必依赖整个 library 对象。
  useEffect(() => {
    if (library?.networkStorage) {
      setWarning(t("shell.networkStorageNotice"));
    }
  }, [library?.networkStorage, library?.libraryId, setWarning, t]);

  // 恢复提示（备份/抢救后）不再用常驻 banner，改为打开库时弹一次确认弹窗；
  // 同一库只弹一次（ref 记录），避免 recovery 对象引用抖动导致重复弹窗。
  const recoveryNotifiedLibraryIdRef = useRef<string | null>(null);
  useEffect(() => {
    const recovery = library?.recovery;
    if (
      recovery &&
      library?.libraryId !== recoveryNotifiedLibraryIdRef.current
    ) {
      recoveryNotifiedLibraryIdRef.current = library.libraryId;
      setLibraryRecoveryDialogOpen(true);
    }
  }, [library?.recovery, library?.libraryId, setLibraryRecoveryDialogOpen]);
  const [dialog, setDialog] = useDialogField("dialog");
  const [createLibraryPhase, setCreateLibraryPhase] =
    useState<CreateLibraryPhase>("start");
  const [useExistingCreateFolder] = useDialogField("useExistingCreateFolder");
  const [createStorageLayout] = useDialogField("createStorageLayout");
  const hadLibraryRef = useRef(false);
  const [dialogValue, setDialogValue] = useState(() => t("shell.myLibrary"));
  const [conflicts, setConflicts] = useTransfersField("conflicts");
  const [importSourceFailurePlan, setImportSourceFailurePlan] = useTransfersField("importSourceFailurePlan");
  const [importDecisionSubmitting, setImportDecisionSubmitting] = useTransfersField("importDecisionSubmitting");
  const completedImportIdRef = useRef<string | null>(null);
  const retiredImportIdsRef = useRef<Set<string>>(new Set());
  const [imageSequenceImportOffer, setImageSequenceImportOffer] = useTransfersField("imageSequenceImportOffer");
  const [imageSequenceImportIndex, setImageSequenceImportIndex] = useTransfersField("imageSequenceImportIndex");
  const imageSequenceOfferIdRef = useRef<string | null>(null);
  const [imageSequenceImportError, setImageSequenceImportError] = useTransfersField("imageSequenceImportError");
  const [imageSequenceImportSubmitting, setImageSequenceImportSubmitting] = useTransfersField("imageSequenceImportSubmitting");
  const postImportSequencePlanRef = useRef<PostImportSequencePlan | null>(null);
  const [imageSequenceConfirmPurpose, setImageSequenceConfirmPurpose] = useTransfersField("imageSequenceConfirmPurpose");

  useEffect(() => {
    const offerId = imageSequenceImportOffer?.offerId ?? null;
    if (offerId !== imageSequenceOfferIdRef.current) {
      imageSequenceOfferIdRef.current = offerId;
      setImageSequenceImportIndex(0);
    }
  }, [imageSequenceImportOffer, setImageSequenceImportIndex]);

  /**
   * Serpent-866c20：确认面板的预览来源。导入后成组时帧已经是库内资产（走 source
   * 通道）；导入前的候选帧只交给 Main 的 offerId + 帧号解析，Renderer 不经手路径。
   */
  const imageSequencePreviewSource = useMemo((): SequencePreviewSource | null => {
    const offer = imageSequenceImportOffer;
    if (!offer) return null;
    const index = Math.min(
      imageSequenceImportIndex,
      Math.max(0, offer.sequences.length - 1),
    );
    const sequence = offer.sequences[index];
    if (!sequence) return null;
    const planned = postImportSequencePlanRef.current?.sequences[index];
    if (planned && planned.frameAssetIds.length > 0) {
      const frames: SequencePreviewFrame[] = [];
      planned.frameAssetIds.forEach((assetId, offset) => {
        const revisionId = planned.frameRevisionIds[offset];
        // 没有修订就无法按 source 协议取源文件，宁可少一帧也不给坏 URL。
        if (!revisionId) return;
        frames.push({
          frameNumber:
            planned.frameNumbers[offset] ?? sequence.firstFrame + offset,
          url: importedSequenceFrameUrl(offer.libraryId, assetId, revisionId),
        });
      });
      return frames.length > 0 ? { kind: "assets", frames } : null;
    }
    if (!offer.offerId || isPostImportSequenceOfferId(offer.offerId)) return null;
    return {
      kind: "pending",
      offerId: offer.offerId,
      sequenceIndex: index,
      firstFrame: sequence.firstFrame,
      frameCount: sequence.frameCount,
    };
  }, [imageSequenceImportIndex, imageSequenceImportOffer]);
  const [conflictPhase, setConflictPhase] = useTransfersField("conflictPhase");
  const [duplicateDecision, setDuplicateDecision] = useTransfersField("duplicateDecision");
  const [nameDecision, setNameDecision] = useTransfersField("nameDecision");
  const [rememberNameConflict, setRememberNameConflict] = useTransfersField("rememberNameConflict");
  const [rememberDuplicate, setRememberDuplicate] = useTransfersField("rememberDuplicate");
  const resolveImportConflictsRef = useRef<
    (
      plan: ImportConflictPlan,
      name: RememberedNameConflictDecision,
      duplicate: RememberedDuplicateDecision,
    ) => Promise<void>
  >(async () => {});
  const presentImportConflicts = useCallback((plan: ImportConflictPlan) => {
    const prefs = loadImportConflictPreferences();
    const presentation = resolveImportConflictPresentation(plan, prefs);
    setImportSourceFailurePlan(null);
    setConflicts(plan);
    setNameDecision(presentation.nameDecision);
    setDuplicateDecision(presentation.duplicateDecision);
    setRememberNameConflict(false);
    setRememberDuplicate(false);
    setConflictPhase(presentation.phase);
    if (presentation.phase === null) {
      void resolveImportConflictsRef.current(
        plan,
        presentation.nameDecision,
        presentation.duplicateDecision,
      );
    }
  }, [setConflictPhase, setConflicts, setDuplicateDecision, setImportSourceFailurePlan, setNameDecision, setRememberDuplicate, setRememberNameConflict]);
  const clearImportConflictsUi = useCallback(() => {
    setConflicts(null);
    setConflictPhase(null);
  }, [setConflictPhase, setConflicts]);
  const presentImportSourceFailure = useCallback((plan: ImportSourceFailurePlan) => {
    clearImportConflictsUi();
    setImportSourceFailurePlan(plan);
  }, [clearImportConflictsUi, setImportSourceFailurePlan]);
  const clearImportSourceFailureUi = useCallback(() => {
    setImportSourceFailurePlan(null);
  }, [setImportSourceFailurePlan]);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);
  const panelResizeReleaseRef = useRef<() => void>(() => undefined);
  // REQ-SHELL-007 / REQ-SHELL-011: draggable nav/inspector pane widths + auto-hide.
  const {
    navPanelWidth,
    inspectorPanelWidth,
    resizing: panelResizing,
    shellStyle: panelResizeShellStyle,
    beginResize: beginPanelResize,
    beginEdgeRestore: beginPanelEdgeRestore,
    resetPanel: resetPanelWidth,
  } = usePanelResize({
    onAutoHide: (panel) => {
      if (panel === "nav") setLeftOpen(false);
      else setRightOpen(false);
    },
    onEdgeRestore: (panel) => {
      if (panel === "nav") setLeftOpen(true);
      else setRightOpen(true);
    },
    onResizeEnd: () => panelResizeReleaseRef.current(),
  });
  const workspaceHistoryReplayQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceHistoryReplayEpochRef = useRef(0);
  const workspaceTabTransitionRef = useRef(0);
  const [workspaceNavigationPending, setWorkspaceNavigationPending] =
    useState(false);
  const [navHistoryUi, setNavHistoryUi] = useWorkspaceField("navHistoryUi");

  // Tags
  const [tags, setTags] = useNavigationField("tags");
  const [tagDropTargetId, setTagDropTargetId] = useNavigationField("tagDropTargetId");
  const [activeTagId, setActiveTagId] = useNavigationField("activeTagId");
  const [storedPinnedTagId, setPinnedTagId] = useState<string | null>(null);

  // REQ-FOLDER-009: folder browse/search recurse only when explicitly enabled.
  const [folderRecursive, setFolderRecursive] = useNavigationField("folderRecursive");
  const [folderRecursivePrefs, setFolderRecursivePrefs] = useNavigationField("folderRecursivePrefs");
  const [showFolderCardsWhenRecursive, setShowFolderCardsWhenRecursive] = useNavigationField("showFolderCardsWhenRecursive");
  // Serpent-b8a853: one-time feature hints for hidden UI affordances share a
  // global switch (Settings → Feature hints) and per-key "seen" marks.
  const [featureHintPrefs, setFeatureHintPrefs] = useNavigationField("featureHintPrefs");
  // Linked-folder "new user" hint: after adding a normal folder, briefly pulse
  // the sidebar 导入链接文件夹 entry. Dismissed permanently by hovering it
  // >0.5s or by actually importing a linked folder.
  const [linkedFolderHintActive, setLinkedFolderHintActive] = useNavigationField("linkedFolderHintActive");
  const linkedFolderHintStopTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const linkedFolderHintHoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const includeSubfoldersHoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const linkedFolderAddHintEligible =
    shouldShowLinkedFolderAddHint({
      hintsEnabled: isFeatureHintEnabled(featureHintPrefs),
      alreadyDismissed: hasFeatureHintBeenShown(
        featureHintPrefs,
        LINKED_FOLDER_ADD_HINT_KEY,
      ),
      hasLinkedFolders: linkedFolders.length > 0,
    });
  useEffect(
    () => () => {
      if (linkedFolderHintStopTimerRef.current) {
        clearTimeout(linkedFolderHintStopTimerRef.current);
      }
      if (linkedFolderHintHoverTimerRef.current) {
        clearTimeout(linkedFolderHintHoverTimerRef.current);
      }
      if (includeSubfoldersHoverTimerRef.current) {
        clearTimeout(includeSubfoldersHoverTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    const onChanged = (): void => {
      setShowFolderCardsWhenRecursive(
        loadFolderBrowseCardPreferences().showWhenRecursive,
      );
    };
    window.addEventListener(FOLDER_BROWSE_CARD_PREFERENCES_CHANGED, onChanged);
    return () => {
      window.removeEventListener(
        FOLDER_BROWSE_CARD_PREFERENCES_CHANGED,
        onChanged,
      );
    };
  }, [setShowFolderCardsWhenRecursive]);
  // Hovering a highlighted affordance for >0.5s dismisses that hint
  // permanently (shared "all highlights" rule, Serpent-b8a853).
  const linkedFolderHintShow =
    linkedFolderHintActive && linkedFolderAddHintEligible;
  const beginLinkedFolderHintHover = (): void => {
    linkedFolderHintHoverTimerRef.current = setTimeout(() => {
      linkedFolderHintHoverTimerRef.current = null;
      setLinkedFolderHintActive(false);
      if (linkedFolderHintStopTimerRef.current) {
        clearTimeout(linkedFolderHintStopTimerRef.current);
        linkedFolderHintStopTimerRef.current = null;
      }
      const next = withFeatureHintShown(
        featureHintPrefs,
        LINKED_FOLDER_ADD_HINT_KEY,
      );
      setFeatureHintPrefs(next);
      saveFeatureHintPreferences(next);
    }, 500);
  };
  const endLinkedFolderHintHover = (): void => {
    if (linkedFolderHintHoverTimerRef.current) {
      clearTimeout(linkedFolderHintHoverTimerRef.current);
      linkedFolderHintHoverTimerRef.current = null;
    }
  };

  const [searchValue, setSearchValue] = useQueryField("searchValue");
  const lastValidSearchQueryRef = useRef<{ scope: string; query: ReturnType<typeof parseSearchExpression> } | null>(null);
  const lastValidFolderSearchQueryRef = useRef<{ scope: string; query: ReturnType<typeof parseSearchExpression> } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [storedSearchHistory, setStoredSearchHistory] = useQueryField("storedSearchHistory");
  const [searchHistoryOpen, setSearchHistoryOpen] = useDialogField("searchHistoryOpen");
  const searchHistoryDismissedUntilInputRef = useRef(false);
  const [searchHistoryActiveIndex, setSearchHistoryActiveIndex] = useQueryField("searchHistoryActiveIndex");
  const searchHistoryLibraryId = library?.libraryId ?? null;
  const searchHistory =
    searchHistoryLibraryId === null
      ? []
      : storedSearchHistory?.libraryId === searchHistoryLibraryId
        ? storedSearchHistory.queries
        : readSearchHistory(window.localStorage, searchHistoryLibraryId);
  function publishSearchHistory(queries: string[]) {
    if (!searchHistoryLibraryId) return;
    setStoredSearchHistory({ libraryId: searchHistoryLibraryId, queries });
  }
  const [formatFilter, setFormatFilter] = useQueryField("formatFilter");
  const [excludeFormatFilter, setExcludeFormatFilter] = useQueryField("excludeFormatFilter");
  const [colorFilter, setColorFilter] = useQueryField("colorFilter");
  const [colorSimilarity, setColorSimilarity] = useQueryField("colorSimilarity");
  const [excludeColorFilter, setExcludeColorFilter] = useQueryField("excludeColorFilter");
  const [tagFilter, setTagFilter] = useQueryField("tagFilter");
  const [tagFilterExpression, setTagFilterExpression] = useQueryField("tagFilterExpression");
  const [tagFilterMode, setTagFilterMode] = useQueryField("tagFilterMode");
  const [tagFilterLastValidExpression, setTagFilterLastValidExpression] = useQueryField("tagFilterLastValidExpression");
  const pinnedTagId = tagFilterMode === "expression" && tags.some(tag => tag.tagId === storedPinnedTagId && tagFilterExpression === JSON.stringify(tag.name)) ? storedPinnedTagId : null;
  const [excludeTagFilter, setExcludeTagFilter] = useQueryField("excludeTagFilter");
  const [excludedTagFilter, setExcludedTagFilter] = useQueryField("excludedTagFilter");
  const [includeAiTagFilter, setIncludeAiTagFilter] = useQueryField("includeAiTagFilter");
  // Serpent-eaxs: tag-management AND search ("包含 N 个标签") splits the tag
  // names into separate clauses (clauses are ANDed; values within one clause
  // are ORed). Any explicit filter-bar edit resets this to "any".
  const [tagFilterMatch, setTagFilterMatch] = useQueryField("tagFilterMatch");
  const [ratingFilter, setRatingFilter] = useQueryField("ratingFilter");
  const [excludeRatingFilter, setExcludeRatingFilter] = useQueryField("excludeRatingFilter");
  const [includeAiRatingFilter, setIncludeAiRatingFilter] = useQueryField("includeAiRatingFilter");
  const [favoriteFilter, setFavoriteFilter] = useQueryField("favoriteFilter");
  const [sourceUrlFilter, setSourceUrlFilter] = useQueryField("sourceUrlFilter");
  const [availabilityFilter, setAvailabilityFilter] = useQueryField("availabilityFilter");
  const [excludeAvailabilityFilter, setExcludeAvailabilityFilter] = useQueryField("excludeAvailabilityFilter");
  const [widthRange, setWidthRange] = useQueryField("widthRange");
  const [heightRange, setHeightRange] = useQueryField("heightRange");
  const [aspectRatioRange, setAspectRatioRange] = useQueryField("aspectRatioRange");
  /** Shape/aspect preset OR ranges (Serpent-gp4). */
  const [aspectRatioRanges, setAspectRatioRanges] = useQueryField("aspectRatioRanges");
  // REQ-FILTER-010: resolution buckets filter on the longer edge (long_edge).
  const [longEdgeRange, setLongEdgeRange] = useQueryField("longEdgeRange");
  const [durationRange, setDurationRange] = useQueryField("durationRange");
  const [sortField, setSortField] = useQueryField("sortField");
  const [sortOrder, setSortOrder] = useQueryField("sortOrder");
  /** Serpent-hm28: null = normal sort; otherwise client shuffle seed. */
  const [shuffleSeed, setShuffleSeed] = useQueryField("shuffleSeed");
  const [searchOffset, setSearchOffset] = useBrowseField("searchOffset");
  const [searchTotal, setSearchTotal] = useBrowseField("searchTotal");
  const [filteredFolderCountRefreshToken, setFilteredFolderCountRefreshToken] = useBrowseField("filteredFolderCountRefreshToken");
  const [searchSnippets, setSearchSnippets] = useBrowseField("searchSnippets");
  // Serpent-b8a853: one-time hint for the include-subfolders icon. The hint
  // key is per (library, folder scope); the actual flash decision needs the
  // browse canvas mode (folders-only = child-folder cards but zero direct
  // assets) which is computed below with browseCanvasBodyLayout.
  const recursiveHintKey =
    library && assetScope !== "all" && assetScope !== "root"
      ? recursiveSubfoldersHintKey(library.libraryId, assetScope)
      : null;
  const { open: openContextMenu, close: closeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  const skipDiscoveryReloadSignatureRef = useRef<string | null>(null);
  const lastAppliedWorkspaceBrowseStateRef = useRef<{
    tabId: string | null;
    state: WorkspaceTabBrowseState;
  } | null>(null);
  // Auto-search requests can resolve out of order while the user is still
  // typing. Only the newest first-page request may replace the canvas.
  const searchRequestGenerationRef = useRef(0);
  // Browse loads can overlap a destructive folder mutation. An older request
  // may then reject with FOLDER_NOT_FOUND after the UI has already navigated
  // away from that scope. Ignore every result (including errors) from a load
  // generation that is no longer current so stale reads cannot cover the
  // undoable mutation receipt with a misleading error toast.
  const contentLoadGenerationRef = useRef(0);
  const libraryViewSessionRef = useRef<LibraryViewSession>({
    libraryId: null,
    generation: 0,
  });
  const navigationHydrationAbortRef = useRef<AbortController | null>(null);
  const pendingLibraryCloseFencesRef = useRef(new Map<string, Set<number>>());
  const localAssetRemovalGenerationRef = useRef(0);

  const cancelPendingLibraryReads = useCallback(() => {
    contentLoadGenerationRef.current += 1;
    navigationHydrationAbortRef.current?.abort();
    navigationHydrationAbortRef.current = null;
  }, []);
  const beginLibraryTransition = useCallback(() => {
    cancelPendingLibraryReads();
    const next = invalidateLibraryViewSession(libraryViewSessionRef.current);
    libraryViewSessionRef.current = next;
    return next;
  }, [cancelPendingLibraryReads]);
  const activateLibraryView = useCallback(
    (libraryId: string) => {
      cancelPendingLibraryReads();
      const next = advanceLibraryViewSession(
        libraryViewSessionRef.current,
        libraryId,
      );
      libraryViewSessionRef.current = next;
      return next;
    },
    [cancelPendingLibraryReads],
  );
  const ensureLibraryView = useCallback(
    (libraryId: string): LibraryViewSessionToken | null => {
      const current = libraryViewSessionRef.current;
      if (current.libraryId === libraryId) {
        return {
          libraryId,
          generation: current.generation,
        };
      }
      // A stale callback can retain the previous library object for several
      // awaits. Never let that callback reactivate its old identity after a
      // newer library has been published; only bootstrap an identity while
      // the renderer has no library ref yet.
      if (sessionFields.get("library") !== null) return null;
      const next = activateLibraryView(libraryId);
      return {
        libraryId,
        generation: next.generation,
      };
    },
    [activateLibraryView],
  );
  const isCurrentLibraryView = useCallback(
    (token: LibraryViewSessionToken) =>
      isCurrentLibraryViewSession(libraryViewSessionRef.current, token),
    [],
  );
  const markLibraryClosePending = useCallback((libraryId: string): number => {
    const generation = libraryViewSessionRef.current.generation;
    const pending = pendingLibraryCloseFencesRef.current.get(libraryId) ?? new Set<number>();
    pending.add(generation);
    pendingLibraryCloseFencesRef.current.set(libraryId, pending);
    return generation;
  }, []);
  const clearLibraryClosePending = useCallback(
    (libraryId: string, generation: number) => {
      const pending = pendingLibraryCloseFencesRef.current.get(libraryId);
      if (!pending) return;
      pending.delete(generation);
      if (pending.size === 0) {
        pendingLibraryCloseFencesRef.current.delete(libraryId);
      }
    },
    [],
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
  const [batchRelinkKeepMetadata, setBatchRelinkKeepMetadata] = useTransfersField("batchRelinkKeepMetadata");

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
  }, [setImportOverlayDismissed, setImportProgress, setImportRpcInFlight]);
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
  }, [setImportOverlayDismissed]);
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
  const [automaticTasksOpen, setAutomaticTasksOpen] = useDialogField("automaticTasksOpen");
  const [automaticTaskEditorId,setAutomaticTaskEditorId]=useState<string|null|undefined>(undefined);
  const [scriptSandboxPreviewOpen, setScriptSandboxPreviewOpen] = useDialogField("scriptSandboxPreviewOpen");
  const [aboutOpen, setAboutOpen] = useDialogField("aboutOpen");
  const [openSourceLicensesOpen, setOpenSourceLicensesOpen] = useDialogField("openSourceLicensesOpen");
  const [librarySettingsOpen, setLibrarySettingsOpen] = useDialogField("librarySettingsOpen");
  const [openSyncLibraryOpen, setOpenSyncLibraryOpen] = useDialogField("openSyncLibraryOpen");
  const [gitignoreContent, setGitignoreContent] = useDialogField("gitignoreContent");
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
  }, [searchValue, folders, linkedFolders, library?.libraryId, workspaceTabsState.activeTabId]);
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
  const [appLogEntries, setAppLogEntries] = useDialogField("appLogEntries");
  const [appLogLoading, setAppLogLoading] = useDialogField("appLogLoading");
  const [appLogAutomationCorrelationId, setAppLogAutomationCorrelationId] = useDialogField("appLogAutomationCorrelationId");
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
    const sourceLibraryId = sessionFields.get("library")?.libraryId;
    const confirmed = activity === null || await requestConfirmation(
      t("shell.librarySwitchWarning"), false, { scopeBound: !keepDestinationChoice },
    );
    return confirmed && (keepDestinationChoice || sessionFields.get("library")?.libraryId === sourceLibraryId);
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

  function revealAppLog(): void {
    const bridge = (window as RendererWindow).keel?.shell;
    if (!bridge?.revealAppLog) {
      setError(t("toast.aiRevealLogFailed"));
      return;
    }
    void bridge.revealAppLog().then((result) => {
      if (!result.ok) setError(t("toast.aiRevealLogFailed"));
    });
  }

  // AI analysis state
  const [aiApiFormat, setAiApiFormat] = useAiField("aiApiFormat");
  const [aiModel, setAiModel] = useAiField("aiModel");
  const [aiBaseUrl, setAiBaseUrl] = useAiField("aiBaseUrl");
  const [aiApiKey, setAiApiKey] = useAiField("aiApiKey");
  const [aiDraftHasKey, setAiDraftHasKey] = useAiField("aiDraftHasKey");
  const [aiHasKey, setAiHasKey] = useAiField("aiHasKey");
  const [aiProfiles, setAiProfiles] = useAiField("aiProfiles");
  const [aiActiveProfileId, setAiActiveProfileId] = useAiField("aiActiveProfileId");
  const aiConnectionProbeGenerationRef = useRef(0);
  const updateAiActiveProfileId = useCallback((profileId: string | null) => {
    setAiActiveProfileId(profileId);
  }, [setAiActiveProfileId]);
  const [aiProfileDraftId, setAiProfileDraftId] = useAiField("aiProfileDraftId");
  const [aiProfileName, setAiProfileName] = useAiField("aiProfileName");
  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useAiField("aiDescriptionEnabled");
  const [aiTagsEnabled, setAiTagsEnabled] = useAiField("aiTagsEnabled");
  const [aiRatingEnabled, setAiRatingEnabled] = useAiField("aiRatingEnabled");
  const [aiForceExistingTags, setAiForceExistingTags] = useAiField("aiForceExistingTags");
  const [aiAnalysisSettings, setAiAnalysisSettings] = useAiField("aiAnalysisSettings");
  const [aiLanguages, setAiLanguages] = useAiField("aiLanguages");
  const [aiConcurrencyLimit, setAiConcurrencyLimit] = useAiField("aiConcurrencyLimit");
  const [aiMaxAnalysisImageEdgePx, setAiMaxAnalysisImageEdgePx] = useAiField("aiMaxAnalysisImageEdgePx");
  const [aiAutoAnalyzeEnabled, setAiAutoAnalyzeEnabled] = useAiField("aiAutoAnalyzeEnabled");
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useAiField("aiDisclaimerAccepted");
  const [aiConnectionState, setAiConnectionState] = useAiField("aiConnectionState");
  const setAiDraftConnectionState = aiFields.setterFor("aiDraftConnectionState");
  const setAiDraftConnectionReason = aiFields.setterFor("aiDraftConnectionReason");
  const [aiSaveVerifying, setAiSaveVerifying] = useAiField("aiSaveVerifying");
  const aiAutoConnectAttemptedRef = useRef(false);
  /** Fingerprint of credentials last proven by a successful probe. */
  const aiVerifiedFingerprintRef = useRef<string | null>(null);
  const aiConfigPersistDraftRef = useRef({
    apiFormat: DEFAULT_AI_API_FORMAT as AiApiFormat,
    model: DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT],
    baseUrl: "",
    apiKey: "",
    hasKey: false,
    descriptionEnabled: true,
    tagsEnabled: true,
    ratingEnabled: true,
    forceExistingTags: false,
    analysisSettings: toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS),
    languages: ["zh-CN"] as Array<"zh-CN" | "en" | "ja" | "ko">,
    concurrencyLimit: 16,
    maxAnalysisImageEdgePx: 2048,
    autoAnalyzeEnabled: false,
    disclaimerAccepted: false,
  });

  useEffect(() => {
    aiConfigPersistDraftRef.current = {
      apiFormat: aiApiFormat,
      model: aiModel,
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      hasKey: aiHasKey,
      descriptionEnabled: aiDescriptionEnabled,
      tagsEnabled: aiTagsEnabled,
      ratingEnabled: aiRatingEnabled,
      forceExistingTags: aiForceExistingTags,
      analysisSettings: aiAnalysisSettings,
      languages: aiLanguages,
      concurrencyLimit: aiConcurrencyLimit,
      maxAnalysisImageEdgePx: aiMaxAnalysisImageEdgePx,
      autoAnalyzeEnabled: aiAutoAnalyzeEnabled,
      disclaimerAccepted: aiDisclaimerAccepted,
    };
  }, [
    aiAnalysisSettings,
    aiApiFormat,
    aiApiKey,
    aiAutoAnalyzeEnabled,
    aiBaseUrl,
    aiConcurrencyLimit,
    aiDescriptionEnabled,
    aiDisclaimerAccepted,
    aiForceExistingTags,
    aiHasKey,
    aiLanguages,
    aiMaxAnalysisImageEdgePx,
    aiModel,
    aiRatingEnabled,
    aiTagsEnabled,
  ]);
  const [aiAnalyzing, setAiAnalyzing] = useAiField("aiAnalyzing");
  const [aiProgressBannerVisible, setAiProgressBannerVisible] = useAiField("aiProgressBannerVisible");
  const [aiContent, setAiContent] = useInspectorField("aiContent");
  /** Description editor is showing AI-layer text (human description empty). */
  const [descriptionIsAi, setDescriptionIsAi] = useInspectorField("descriptionIsAi");

  const {
    loadMetadata,
    loadAiContentForAsset,
    saveMetadata,
    applyLoadedMetadata,
  } = useInspectorAssetMetadata({
    api: api ?? null,
    library,
    selectedAssetId,
    metadataByAssetRef,
    metadataConflictAssetIdsRef,
    assetMetadata,
    setAssetMetadata,
    setVersionConflict,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setDescriptionIsAi,
    setAiContent,
    setAssets,
    setTrashedAssets,
    setNotice,
    setError,
    syncBrowseFilterMembershipRef,
  });

  const analyzingAssetIdRef = useRef<string | null>(null);
  const analyzingBatchSizeRef = useRef(0);
  const aiBatchJobIdsRef = useRef<string[]>([]);
  const aiBatchSkippedCountRef = useRef(0);
  const aiBatchKnownJobsRef = useRef<AiProgressJobUpdate[]>([]);
  const aiBatchCounterBaselineRef = useRef({ succeeded: 0, failed: 0 });
  const lastAiBatchJobIdsRef = useRef<string[]>([]);
  const lastAiBatchAssetIdRef = useRef<string | null>(null);
  const aiBatchStatusRequestRef = useRef(0);
  const refreshAiBatchStatusRef = useRef<() => void>(() => undefined);
  const applyLiveAiProgressRef = useRef<(event: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    changedJobs?: AiProgressJobUpdate[];
  }) => void>(() => undefined);
  const [aiBatchProgress, setAiBatchProgress] = useAiField("aiBatchProgress");
  const aiUiPrefs = usePrefsStore((state) => state.aiUi);
  const setAiUiPrefs = usePrefsStore((state) => state.setAiUi);
  const [importValidated, setImportValidated] = useTransfersField("importValidated");
  const [exportDialogOpen, setExportDialogOpen] = useDialogField("exportDialogOpen");
  const [importLibraryChooserOpen, setImportLibraryChooserOpen] = useTransfersField("importLibraryChooserOpen");
  const [openLibraryChooserOpen, setOpenLibraryChooserOpen] = useDialogField("openLibraryChooserOpen");

  // Thumbnail / Preview state
  const [previewAsset, setPreviewAsset] = usePreviewField("previewAsset");
  // Keep the browse surface visually hidden while the viewer close path
  // restores its scroll anchor. Revealing the grid before the two-frame
  // restoration causes a one-frame flash and can make Chromium paint at the
  // top of the canvas during a rapid open/close.
  const [previewRestoring, setPreviewRestoring] = usePreviewField("previewRestoring");
  const [previewCanvasReady, setPreviewCanvasReady] = usePreviewField("previewCanvasReady");
  const previewModalRef = useRef<AssetPreviewModalHandle>(null);
  // REQ-CANVAS-019: read synchronously inside the canvas ResizeObserver
  // callback (which is created once and does not close over fresh state)
  // to skip the reflow-anchor logic while the viewer hides the canvas.
  const previewAssetRef = useRef<AssetSummary | null>(null);
  const previewRestoringRef = useRef(false);
  useLayoutEffect(() => {
    previewAssetRef.current = previewAsset;
  }, [previewAsset]);
  // Serpent-njoy: owned here (not inside AssetPreviewModal, which remounts
  // per-asset via `key`) so switching assets never resets idle by itself.
  // While preview is open, any keyboard/pointer/wheel input wakes chrome;
  // `wakeViewerChrome` also runs when the viewer first opens.
  const {
    idle: viewerChromeIdle,
    onActivity: onViewerChromeActivity,
    wake: wakeViewerChrome,
  } = useViewerChromeIdle(undefined, Boolean(previewAsset));
  const canvasPrefs = usePrefsStore((state) => state.canvas);
  const syncCardAssetIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    for (const asset of assets) push(asset.assetId);
    for (const entry of browseLayout) push(entry.assetId);
    return ids;
  }, [assets, browseLayout]);
  const syncCardStatuses = useSyncCardStatuses({
    api,
    libraryId: library?.libraryId,
    bound: syncBindingStatus !== "none",
    showBadges: canvasPrefs.fields.badgeSync !== false && syncBindingStatus !== "none",
    assetIds: syncCardAssetIds,
    syncing: Boolean(
      syncProgress
      && syncProgress.phase !== "complete"
      && syncProgress.filesTotal > 0,
    ),
  });
  const imageSequencePrefs = usePrefsStore((state) => state.imageSequence);
  const setImageSequencePrefs = usePrefsStore((state) => state.setImageSequence);
  const viewerChromePrefs = usePrefsStore((state) => state.viewerChrome);
  const setViewerChromePrefs = usePrefsStore((state) => state.setViewerChrome);
  // Hover live previews (audio/video) carry the viewer volume preference over.
  const {
    volume: viewerVolume,
    muted: viewerVolumeMuted,
  } = useViewerVolume(false);
  const assetViewMode = canvasPrefs.viewMode;
  const assetCardSize = canvasPrefs.cardSize;
  const [canvasWidthPx, setCanvasWidthPx] = useState(0);
  const [folderCanvasContentWidthPx, setFolderCanvasContentWidthPx] = useState(0);
  const cardSizeStops = useMemo(
    () => enumerateDiscreteCardSizes(canvasWidthPx),
    [canvasWidthPx],
  );
  // Serpent-l67w: folder cards share the flush masonry column width so the
  // folder row lines up with waterfall columns (raw slider size can leave
  // leftover that `1fr` columns absorb).
  const folderCardWidthPx = useMemo(
    () =>
      masonryAlignedFolderWidthPx(
        Math.max(
          0,
          folderCanvasContentWidthPx - FOLDER_CARD_ROW_INLINE_PADDING_PX * 2,
        ),
        assetCardSize,
      ),
    [assetCardSize, folderCanvasContentWidthPx],
  );
  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  const previewScrollHoldTimerRef = useRef<number | null>(null);
  const lastPreviewRestoredTopRef = useRef(0);
  const clearPreviewScrollHold = useCallback(() => {
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
      previewScrollHoldTimerRef.current = null;
    }
    setCanvasPreviewScrollHold(workspaceCanvasRef.current, false);
  }, []);
  const armPreviewScrollHold = useCallback((restoredTop: number) => {
    lastPreviewRestoredTopRef.current = restoredTop;
    setCanvasPreviewScrollHold(workspaceCanvasRef.current, true);
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
    }
    previewScrollHoldTimerRef.current = window.setTimeout(() => {
      previewScrollHoldTimerRef.current = null;
      setCanvasPreviewScrollHold(workspaceCanvasRef.current, false);
    }, PREVIEW_SCROLL_HOLD_MS);
  }, []);
  useEffect(() => () => {
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
    }
  }, []);
  useLayoutEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return undefined;
    return installBrowseScrollWriteSpy(canvas);
  }, [library]);
  // A viewport restore waiting to be applied in the same commit the new
  // content paints in. Set when a navigation targets a saved offset; the
  // layout effect below positions the canvas before the browser paints, which
  // removes the "first frame at the top, second frame jumps" flicker when
  // switching folders or tabs (UX principle 0005: reduce flashing).
  const pendingViewportRestoreRef = useRef<WorkspaceNavViewport | null>(null);
  useLayoutEffect(() => {
    const viewport = pendingViewportRestoreRef.current;
    if (!viewport) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    if (extent <= 0) return;
    const targetTop = resolveWorkspaceScrollTop(viewport, extent);
    const previewActive =
      Boolean(previewAsset) ||
      previewRestoring ||
      Boolean(previewAssetRef.current) ||
      previewRestoringRef.current ||
      canvasHasPreviewScrollHold(canvas) ||
      Boolean(canvas.parentElement?.classList.contains("is-viewing"));
    const action = pendingWorkspaceViewportAction({
      previewActive,
      navigationPending: workspaceNavigationPending,
      restoreLoopActive: Boolean(cancelWorkspaceViewportRestoreRef.current),
      intendedTop: viewport.scrollTop,
      targetTop,
      currentTop: canvas.scrollTop,
      extent,
    });
    if (action === "clear") {
      pendingViewportRestoreRef.current = null;
      return;
    }
    logBrowseScrollWrite("pendingViewportRestore", canvas, {
      targetTop,
      intendedTop: viewport.scrollTop,
      currentTop: Math.round(canvas.scrollTop),
      navigationPending: workspaceNavigationPending,
    });
    canvas.scrollTop = targetTop;
  });
  const reportedVisibleWindowKeyRef = useRef("");
  const visibleWindowAssetIdsRef = useRef<ReadonlySet<string>>(new Set());
  const viewportScrollTopRef = useRef<number | undefined>(undefined);
  const viewportGenerationRef = useRef(0);
  const interactionGenerationRef = useRef(0);
  // Serpent-wgl2: the marquee box div is always mounted and moved directly
  // through this ref — never through React state (per-frame state re-renders
  // the whole non-memoized grid).
  const marqueeBoxRef = useRef<HTMLDivElement>(null);
  // REQ-CANVAS-019: rAF handle for the card-size-slider anchor restore.
  const cardSizeRestoreFrameRef = useRef<number | null>(null);
  // REQ-CANVAS-019: rAF handle for the container-width (sidebar/window
  // resize) anchor restore; separate from the card-size one above so the
  // two triggers never cancel each other's in-flight restoration.
  const reflowRestoreFrameRef = useRef<number | null>(null);
  const cardResizeAnchorRef = useRef<CanvasAnchor | null>(null);
  const cardResizeScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const reflowAnchorRef = useRef<CanvasAnchor | null>(null);
  const reflowScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const panelResizeLockRef = useRef(false);
  const panelReflowFrozenWidthRef = useRef<number | null>(null);
  const panelWidthSnapshotRef = useRef({ nav: navPanelWidth, inspector: inspectorPanelWidth });
  const panelResizingRef = useRef(panelResizing);
  useLayoutEffect(() => {
    panelResizingRef.current = panelResizing;
  }, [panelResizing]);

  const capturePanelResizeAnchor = useCallback((lock = true) => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    canvas.classList.remove("is-reflow-restoring");
    const cards: AnchorCard[] = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
    ).map((el) => ({
      assetId: el.dataset.assetId!,
      ...rectLikeFromDomRect(el.getBoundingClientRect()),
    }));
    reflowAnchorRef.current = captureReflowAnchorFromCards(
      cards,
      rectLikeFromDomRect(canvas.getBoundingClientRect()),
    );
    reflowScrollSnapshotRef.current = {
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    panelReflowFrozenWidthRef.current = canvas.clientWidth;
    canvas.classList.add("is-reflow-frozen");
    canvas.style.setProperty(
      "--reflow-frozen-width",
      `${panelReflowFrozenWidthRef.current}px`,
    );
    panelResizeLockRef.current = lock;
  }, []);

  const restorePanelAfterResize = useCallback(() => {
    panelResizeLockRef.current = false;
    const canvas = workspaceCanvasRef.current;
    const anchor = reflowAnchorRef.current;
    if (!canvas || !anchor) {
      canvas?.classList.remove("is-reflow-restoring");
      return;
    }
    // Keep the child layout observers suspended until the outer anchor has
    // converged. Removing the frozen width is what allows the real reflow;
    // this second class prevents Masonry's legacy raw-scroll loop from
    // racing the anchor compensation during that reflow.
    canvas.classList.remove("is-reflow-frozen");
    canvas.classList.add("is-reflow-restoring");
    scheduleAnchorRestore(
      canvas,
      anchor,
      reflowRestoreFrameRef,
      12,
      () => {
        canvas.classList.remove("is-reflow-restoring");
        reflowAnchorRef.current = null;
        reflowScrollSnapshotRef.current = null;
      },
      reflowScrollSnapshotRef.current ?? undefined,
    );
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", restorePanelAfterResize);
    return () => window.removeEventListener("pointerup", restorePanelAfterResize);
  }, [restorePanelAfterResize]);

  useLayoutEffect(() => {
    panelResizeReleaseRef.current = restorePanelAfterResize;
    return () => {
      panelResizeReleaseRef.current = () => undefined;
    };
  }, [restorePanelAfterResize]);

  useLayoutEffect(() => {
    if (!panelResizing) {
      panelReflowFrozenWidthRef.current = null;
      const canvas = workspaceCanvasRef.current;
      canvas?.classList.remove("is-reflow-frozen");
      canvas?.style.removeProperty("--reflow-frozen-width");
    }
  }, [panelResizing]);

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
  }, [inspectorPanelWidth, navPanelWidth]);
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
    [],
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
  const { setMediaJobsOpen, visibleVirtualBrowseLayout, visibleBrowseLayout, shuffleOrder, selectedFolderId, visibleAssets, selectedFolder, setThumbnailFailures, selectedAsset, jobStatusCoordinatorRef, setAiJobs, workspaceTabPresentations, getManagedAssetDragIds, embeddingSelectionRef, embeddingService, mediaJobsOpen, aiConnectionFailureGate, onAiConnectionFailureAbort, pluginUiDialogOpen, aiJobs, notifyAiConnectionBatchStarted, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, setPluginJobs, controlAiJobsRef, openMediaJobs, managedFolderDragIdsRef, setPluginUiDialogOpen, semanticSearchActive, embeddingSearchReady, embeddingIndex, backgroundJobsActive, getManagedFolderDragIds, dragPreviewRef, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, thumbnailFailures, managedAssetDragIdsRef, automaticPaletteRatios, displayedPalette, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, handleOpenSourceUrl, embeddingBound, handleAiConnectionFailureRetry, mediaJobsLoading, embeddingSelectionId, pluginJobs } = useAssetDragState({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, library, api, setFindSimilarSource, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, assetScope, folders, showTrash, trashedAssets, selectedAssetId, assets, browseLayout, virtualBrowseLayout, shellApi, selectedAssetIds, assetMetadata, multiEdit, editDescription, editFavorite, editSourceUrl, editAuthor, descriptionIsAi, aiContent, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setDescriptionIsAi, setAiContent, saveMetadata, saveMetadataForSelection, batchSetRatingForSelection, loadMetadata, setNotice, setError, trashedFolders, trashBrowseTombstoneId, shuffleSeed, workspaceTabsState, linkedFolders, tags, pluginSidebarViews, t });
  const { canvasFolderBrowseEntries, setHoveredAssetId, hoveredAssetIdRef, clearHoveredAssetId, selectedVisibleAssets, pluginSurfaceContext, filteredFolderCounts, browseCanvasBodyLayout, importMenuCopy, recursiveHintActive, scopeBreadcrumbSegments, sourceBadgeContext, hoveredAssetId, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, assetRenderSections, browseEmptyState, pluginBrowseScope, pluginViewerState } = useBrowsePluginContext({ api, library, workspaceCanvasRef, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, visibleVirtualBrowseLayout, visibleBrowseLayout, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, browseLayout, virtualBrowseLayout, shuffleOrder, ensureBrowseVisibleIndices, ensureBrowseVisibleRange, selectedFolderId, showTrash, activeTagId, searchValue, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, previewAsset, selectedAssetIds, visibleAssets, busy, locale, assetScope, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, selectedFolder, currentQueryDefinition, showIgnoredItems, filteredFolderCountRefreshToken, folderBrowseEntries, trashedFolders, trashBrowseTombstoneId, t, tags, folders, linkedFolders, recursiveHintKey, showTagManagement, showPluginSidebarView, folderRecursive, featureHintPrefs, selectedAssetId });
  const { resizeAssetCards, selectionAnchorRef, setAssetSelectionAnchor, clearAssetSelection, selectedAssets, diskDeleteKeyboardTargets, previewIndex, browseScopeAssetIds, selectAllBrowseScope, invertBrowseScope, handleFolderCardClick, cardMouseDownRef, selectedFolderIdSet, workspaceBrowseCount, handleCanvasMouseDown, selectedIdSet, handleCardClick, selectionAssetIds, folderInspector, folderInspectorAppearance, menuSkipScope } = useBrowseSelection({ assetViewMode, visibleAssets, masonryGridWidth, assetCardSize, canvasPrefs, assetGridRef, setMasonryGridWidth, canvasFolderBrowseEntries, selectedAssetIds, setSelectedAssetIds, setSelectedAssetId, previewAsset, workspaceCanvasRef, marqueeBoxRef, selectedFolderIds, setSelectedFolderIds, setHoveredAssetId, pendingRevealRef, pendingRestoredFocusRef, folderBrowseEntries, library, assetScope, showTrash, activeTagId, folders, linkedFolders, searchValue, api, trashedAssets, assets, showTagManagement, tags, searchTotal, fetchBrowseScopeAssetIds, shellApi, editableTextFocused, t, showBlockingError, setError, setWarning, setNotice, locale, ensureLibraryView, setFolderBrowseEntries, folderRecursive, showFolderCardsWhenRecursive, showIgnoredItems, isCurrentLibraryView, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, virtualBrowseLayout, cardResizeAnchorRef, cardResizeScrollSnapshotRef, reflowRestoreFrameRef, reflowAnchorRef, reflowScrollSnapshotRef, setCanvasPrefs, cardSizeRestoreFrameRef });
  const { openAssetPreview, saveCurrentWorkspaceHistoryViewport, navigateAssetPreview, persistAssetColorSpace } = useCanvasEffects({ workspaceCanvasRef, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewAssetRef, previewRestoringRef, cardResizeAnchorRef, reflowAnchorRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardResizeScrollSnapshotRef, previewAsset, previewRestoring, cardSizeRestoreFrameRef, sortField, sortOrder, assetCardSize, resizeAssetCards, workspaceHistoryReplayActiveRef, cancelWorkspaceViewportRestoreRef, navHistoryRef, pendingViewportRestoreRef, wakeViewerChrome, previewRestoreFrameRef, previewCloseGenerationRef, closingPreviewRef, setPreviewRestoring, setPreviewCanvasReady, cancelPreviewViewRestoreRef, clearPreviewScrollHold, previewFocusReturnRef, previewScrollSnapshotRef, setSelectedAssetIds, setSelectedAssetId, selectionAnchorRef, setPreviewAsset, syncActiveWorkspaceTabLocation, setNavHistoryUi, api, library, setError, t, setNotice, pendingWorkspacePreviewRef, visibleAssets, assets });
  const { closeAssetPreview } = useCloseAssetPreview({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, previewAsset, closingPreviewRef, navHistoryRef, syncActiveWorkspaceTabLocation, setNavHistoryUi, previewCloseGenerationRef, previewRestoringRef, setPreviewRestoring, setPreviewCanvasReady, setPreviewAsset, cancelWorkspaceViewportRestoreRef, pendingViewportRestoreRef, previewFocusReturnRef, previewScrollSnapshotRef, workspaceCanvasRef, lastPreviewRestoredTopRef, armPreviewScrollHold, clearPreviewScrollHold, api, library });
  const { loadContent } = useContentLoading({ api, showMissingLinkedPublishRef, showIgnoredItems, ensureLibraryView, contentLoadGenerationRef, navigationHydrationAbortRef, isCurrentLibraryView, setAllAssetCount, setRootAssetCount, setTrashedAssetCount, setFolders, setLinkedFolders, setTags, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, t, setThumbnailFailures, setSearchTotal, setSearchOffset, setSearchSnippets, beginBrowsePageClearingSimilar, setError, locale, setLibraryLoading, setFolderRecursive, setLibrary, setShowTrash, setTrashedAssets, setAssetScope, setActiveTagId, setTagFilter, setAssets, setSelectedAssetId, setSelectedAssetIds, setAssetSelectionAnchor, setBrowserSessionReady, managedImportTargetFolderIdRef, restoreWorkspaceTabsForLibrary, pendingRestoredFocusRef, navHistoryRef, setNavHistoryUi, setUiState, library, showTrash, activeTagId, assetScope, browserSessionReady, selectedAsset, tags, workspaceCanvasRef, assets, trashedAssets, selectedAssetId, pendingRevealRef, chooseFolderRef, refreshRecentLibraries, scriptSandboxPreviewOpen, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, importProgress, appSettingsOpen, busy, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef });
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

  return (
    <>
    <HoverTipHost />
    <PluginUiDialogHost onOpenChange={setPluginUiDialogOpen} pluginApi={pluginManagerApi} />
    <EditTextContextMenuHost />
    {libraryLoading && libraryLoadingVisible && !blockingImportOverlayVisible && !blockingDeleteOverlayVisible ? (
      <LibraryLoadingOverlay
        name={libraryLoading.name}
        operation={libraryLoading.operation}
        onCancel={
          libraryLoading.operation === "deleting"
            ? undefined
            : () => {
                void api?.cancelOpen().then((result) => {
                  if (!result.ok) return;
                  setLibraryLoading(null);
                  setUiState("idle");
                  setDialog(null);
                  setImportLibraryChooserOpen(false);
                  setOpenLibraryChooserOpen(true);
                });
              }
        }
      />
    ) : null}
    {blockingImportOverlayVisible ? (
      <ImportProgressOverlay
        actionsDisabled={importInterrupt !== null}
        onCancel={() => {
          void cancelImport("abandon");
        }}
        onStop={() => {
          void cancelImport("stop");
        }}
        onDismiss={dismissImportOverlay}
        progress={importProgress}
        transferKind={libraryTransferKind}
        transferName={libraryTransferName}
      />
    ) : null}
    {/* Import decision dialogs must sit outside .app-shell (isolation:isolate)
        and after the progress overlay so they remain clickable (Serpent-224ac8). */}
    <ImageSequenceImportDialog
      error={imageSequenceImportError}
      offer={imageSequenceImportOffer}
      sequenceIndex={imageSequenceImportIndex}
      previewSource={imageSequencePreviewSource}
      purpose={imageSequenceConfirmPurpose}
      onCancel={() => {
        postImportSequencePlanRef.current = null;
        setImageSequenceImportOffer(null);
        setImageSequenceImportError(null);
        if (imageSequenceConfirmPurpose === "import") {
          setImportProgress(null);
        }
      }}
      onConfirm={(input) => void confirmImageSequenceImportOffer(input)}
      open={imageSequenceImportOffer !== null}
      submitting={imageSequenceImportSubmitting}
    />
    {conflicts && conflictPhase === "name" && library && (
      <NameConflictDialog
        conflicts={conflicts}
        libraryId={library.libraryId}
        decision={nameDecision}
        remember={rememberNameConflict}
        onDecisionChange={setNameDecision}
        onRememberChange={setRememberNameConflict}
        onCancel={() => void abandonConflicts()}
        onConfirm={() => confirmNameConflictDialog()}
        submitting={importDecisionSubmitting}
      />
    )}
    {conflicts && conflictPhase === "duplicate" && library && (
      <ContentDuplicateDialog
        conflicts={conflicts}
        libraryId={library.libraryId}
        decision={duplicateDecision}
        remember={rememberDuplicate}
        onDecisionChange={setDuplicateDecision}
        onRememberChange={setRememberDuplicate}
        onCancel={() => void abandonConflicts()}
        onConfirm={() => confirmContentDuplicateDialog()}
        submitting={importDecisionSubmitting}
      />
    )}
    <ImportSourceFailureDialog
      key={importSourceFailurePlan?.importId ?? "import-source-failure"}
      onCancel={() => void abandonSourceFailure()}
      onConfirm={(input) => void skipImportSourceFailureWith(input)}
      open={importSourceFailurePlan !== null}
      plan={importSourceFailurePlan}
      submitting={importDecisionSubmitting}
    />
    {blockingDeleteOverlayVisible && !blockingImportOverlayVisible ? (
      <DeleteProgressOverlay
        onCancel={() => {
          void cancelDiskDelete();
        }}
        progress={deleteProgress}
      />
    ) : null}
    {exportProgress &&
    !["complete", "cancelled", "failed"].includes(exportProgress.phase) &&
    !blockingImportOverlayVisible &&
    !blockingDeleteOverlayVisible ? (
      <BlockingProgressOverlay
        cancelLabel={t("progress.cancelExport")}
        detail={
          exportProgress.phase === "snapshot-db"
            ? t("progress.snapshotDb")
            : exportProgress.phase === "enumerate"
              ? t("progress.enumerateFiles")
              : exportProgress.phase === "compress"
                ? t("progress.compressing")
                : t("progress.copyingFiles", {
                    processed: exportProgress.filesProcessed,
                    total: exportProgress.totalFiles,
                    bytesProcessed: formatBytes(exportProgress.bytesProcessed),
                    bytesTotal: formatBytes(exportProgress.totalBytes),
                  })
        }
        indeterminate={exportProgress.totalFiles <= 0}
        kind="export"
        max={exportProgress.totalFiles > 0 ? exportProgress.totalFiles : undefined}
        onCancel={exportProgress.exportId ? () => void cancelExport() : undefined}
        title={t("progress.exportingLibrary")}
        value={exportProgress.totalFiles > 0 ? exportProgress.filesProcessed : undefined}
      />
    ) : null}
    <main
      data-shortcut-version={shortcutRuntimeVersion}
      data-shell-layout="islands"
      className={`app-shell${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}${panelResizing ? " is-resizing" : ""}`}
      style={panelResizeShellStyle as React.CSSProperties}
    >
      <header className="app-toolbar">
        <div className="toolbar-cluster toolbar-nav-cluster">
          <ToolButton
            icon={leftOpen ? "panel-left-close" : "panel-left"}
            label={leftOpen ? t("shell.collapseNav") : t("shell.expandNav")}
            onClick={() => setLeftOpen((v) => !v)}
            pressed={leftOpen}
          />
          <LibrarySwitcher
            busy={busy}
            disabled={!api}
            portaled
            importMenuCopy={importMenuCopy}
            libraryName={library?.displayName ?? null}
            libraryOpen={Boolean(library)}
            onCloseLibrary={() => void closeLibrary()}
            onRemoveLibrary={() => void removeLibrary()}
            onDeleteLibraryFromDisk={() => requestDeleteLibraryFromDisk()}
            onOpenLibrarySettings={() => {
              setAppSettingsOpen(false);
              setLibrarySettingsOpen(true);
            }}
            onCreateLibrary={() => {
              setDialogValue(t("shell.myLibrary"));
              setCreateLibraryPhase("form");
              setDialog("library");
            }}
            onExportLibrary={() => setExportDialogOpen(true)}
            onImportFolder={() => void importAssets("folder")}
            onImportLibrary={() => {
              setOpenLibraryChooserOpen(false);
              setImportLibraryChooserOpen(true);
            }}
            onImportLinkedFolder={() => void importFolderAsLinked()}
            onMenuOpen={() => void refreshRecentLibraries()}
            onOpenLibrary={() => {
              setImportLibraryChooserOpen(false);
              setOpenLibraryChooserOpen(true);
            }}
            onOpenRecent={(path) => void openRecentLibrary(path)}
            onForgetRecent={(path) => void forgetRecentLibrary(path)}
          />
        </div>
        <div className="toolbar-cluster toolbar-workspace-cluster">
          <div className="toolbar-workspace-main">
            <div className="toolbar-workspace-leading">
              <ScopeHistoryButtons
                // Serpent-b7e173：预览已是历史条目（打开查看器必压在某浏览 scope 上），
                // 所以后退/前进由纯历史驱动即可，无需对预览做任何特判。
                canBack={navHistoryUi.canBack}
                canForward={navHistoryUi.canForward}
                onBack={() => void goWorkspaceBack()}
                onForward={() => void goWorkspaceForward()}
              />
              {IS_WINDOWS_PLATFORM ? (
                <MainMenu disabled={busy} sections={mainMenuSections} />
              ) : (
                <AppSettingsEntry
                  disabled={busy}
                  onOpen={() => {
                    setAppSettingsCategory("general");
                    setAppSettingsOpen(true);
                  }}
                />
              )}
            </div>
            <WorkspaceTabs
              activeTabId={workspaceTabsState.activeTabId}
              disabled={!library || busy}
              tabs={workspaceTabPresentations}
              onAdd={() => void addWorkspaceTab()}
              onClose={(tabId) => void closeWorkspaceTab(tabId)}
              onSelect={(tabId) => {
                void selectWorkspaceTab(tabId);
              }}
              onReorder={(tabId, toIndex) => moveWorkspaceTab(tabId, toIndex)}
              onContextMenu={(tabId, position) => {
                const tab = workspaceTabPresentations.find(
                  (candidate) => candidate.id === tabId,
                );
                if (!tab) return;
                openContextMenu(
                  {
                    type: "workspace-tab",
                    tabId,
                    name: tab.title,
                    entity: tab.entity,
                    canClose: workspaceTabPresentations.length > 1,
                    canCloseOthers: workspaceTabPresentations.length > 1,
                  },
                  position,
                );
              }}
            />
          </div>
          <form
            className="toolbar-workspace-search"
            onSubmit={(event) => void runSearch(event)}
            role="search"
          >
            <div
              className={`search-control-wrap${searchValue.trim() ? " has-value" : ""}${semanticSearchActive ? " is-semantic" : ""}`}
            >
              <Icon name="search" size={15} />
              <input
                aria-activedescendant={
                  searchHistoryOpen && searchHistoryActiveIndex >= 0
                    ? `search-history-${searchHistoryActiveIndex}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls={searchHistoryOpen ? "search-history-list" : undefined}
                aria-expanded={
                  searchHistoryOpen &&
                  filterSearchHistory(searchHistory, searchValue).length > 0
                }
                aria-label={t("toolbar.searchLibrary")}
                className="search-control"
                disabled={!library}
                onBlur={() => {
                  setSearchHistoryOpen(false);
                  setSearchHistoryActiveIndex(-1);
                }}
                onChange={(event) => {
                  searchHistoryDismissedUntilInputRef.current = false;
                  setSearchValue(event.target.value);
                  setSearchHistoryActiveIndex(-1);
                  setSearchHistoryOpen(true);
                }}
                onFocus={() => {
                  if (searchHistoryDismissedUntilInputRef.current) return;
                  setSearchHistoryActiveIndex(-1);
                  setSearchHistoryOpen(true);
                }}
                onKeyDown={(event) => {
                  if (isImeKeyboardEvent(event)) return;
                  const matches = filterSearchHistory(searchHistory, searchValue);
                  const visibleCount = Math.min(
                    matches.length,
                    readVisibleSearchHistoryCount() ?? matches.length,
                  );
                  if (!searchHistoryOpen || visibleCount === 0) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    setSearchHistoryActiveIndex(-1);
                    return;
                  }
                  const direction = searchHistoryNavigationDirection(event.key);
                  if (direction) {
                    event.preventDefault();
                    setSearchHistoryActiveIndex((current) =>
                      moveSearchHistoryIndex(current, visibleCount, direction),
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                    return;
                  }
                  if (event.key === "Enter" && searchHistoryActiveIndex >= 0) {
                    const query = matches[searchHistoryActiveIndex];
                    if (!query) return;
                    event.preventDefault();
                    setSearchValue(query);
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                  }
                }}
                placeholder={t("toolbar.searchPlaceholder")}
                ref={searchInputRef}
                role="combobox"
                type="search"
                value={searchValue}
              />
              {searchHistoryOpen && library && (
                <SearchHistoryPopover
                  activeIndex={searchHistoryActiveIndex}
                  items={filterSearchHistory(searchHistory, searchValue)}
                  onClear={() => {
                    clearSearchHistory(window.localStorage, library.libraryId);
                    publishSearchHistory([]);
                    setSearchHistoryActiveIndex(-1);
                    setSearchHistoryOpen(false);
                  }}
                  onHighlight={setSearchHistoryActiveIndex}
                  onPick={(query) => {
                    setSearchValue(query);
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                    publishSearchHistory(
                      rememberSearchQuery(window.localStorage, library.libraryId, query),
                    );
                  }}
                />
              )}
              <button
                aria-disabled={!library || !embeddingSearchReady}
                aria-label={t("toolbar.semanticSearch")}
                aria-pressed={semanticSearchActive}
                className={`search-semantic-toggle${semanticSearchActive ? " is-active" : ""}`}
                data-hover-tip={
                  !embeddingSearchReady
                    ? t("toolbar.semanticSearchNeedsSetup")
                    : embeddingIndex.phase === "starting" || embeddingIndex.phase === "indexing"
                      ? t("toolbar.semanticSearchIndexing")
                      : t(
                        embeddingService
                          ? "toolbar.semanticSearchHintText"
                          : "toolbar.semanticSearchHint",
                      )
                }
                disabled={!library}
                onClick={() => {
                  if (!embeddingSearchReady) return;
                  const current = loadSemanticSearchPreferences();
                  const active = current.searchMode === "semantic";
                  saveSemanticSearchPreferences({
                    version: 1,
                    enabled: current.enabled,
                    modelId: current.modelId,
                    searchMode: active ? "keyword" : "semantic",
                    pageSize: current.pageSize,
                  });
                  if (searchValue.trim()) void runSearch();
                }}
                type="button"
              >
                <Icon name="smart" size={13} />
              </button>
              <button
                aria-label={t("toolbar.searchSyntax")}
                className="search-syntax-help"
                data-hover-tip={t("toolbar.searchSyntaxHint")}
                data-hover-tip-variant="search-syntax"
                type="button"
              >
                ?
              </button>
              {searchValue.trim() !== "" && (
                <button
                  aria-label={t("toolbar.clearSearch")}
                  className="search-clear-btn"
                  disabled={!library}
                  onClick={() => setSearchValue("")}
                  type="button"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
              {searchValue.trim() !== "" && (() => {
                const result = parseSearchExpressionDetailed(searchValue);
                return result.ok ? null : (
                  <span className="search-expression-error" role="alert">
                    {t("toolbar.searchExpressionError", { position: result.diagnostic.start + 1, reason: t(`toolbar.searchExpressionReasons.${searchExpressionReasonKey(result.diagnostic.code)}`) })}
                  </span>
                );
              })()}
            </div>
          </form>
        </div>
        <div className="toolbar-cluster toolbar-inspector-cluster">
          <ToolButton
            icon={rightOpen ? "panel-right-close" : "panel-right"}
            label={
              rightOpen
                ? t("shell.collapseInspector")
                : t("shell.expandInspector")
            }
            onClick={() => setRightOpen((v) => !v)}
            pressed={rightOpen}
          />
        </div>
        {IS_WINDOWS_PLATFORM ? (
          <>
            <WindowsWindowControls shell={shellApi} />
            <WindowEdgeResizeHandles shell={shellApi} />
          </>
        ) : null}
      </header>
      <NavigationSidebar
        tagTree={library ? <TagTreeSidebar key={library.libraryId} libraryId={library.libraryId} tags={tags} activeTagId={activeTagId}
          pinnedTagId={pinnedTagId} onPin={(id) => void togglePinnedTag(id)}
          onChoose={(id) => void chooseTag(id)} onCreate={handleCreateTagInManagement} onRename={handleRenameTagInManagement}
          onAppearance={(id, appearance) => handleRenameTagInManagement(id, tags.find((tag) => tag.tagId === id)?.name ?? "", appearance)}
          onMove={moveTagInTree} onDelete={handleDeleteTagsInManagement} onAssign={assignAssetsToTreeTag} getAssetDragIds={getManagedAssetDragIds} isInternalAssetDrag={isInternalAssetDrag} onResolveManagedAssetDrop={resolveManagedAssetDrop} /> : undefined}
        automaticTasks={library && api ? <AutomaticTasksSidebar key={library.libraryId} api={api} libraryId={library.libraryId} systemBusy={backgroundJobsActive} onCreate={()=>{setAutomaticTaskEditorId(null);setAutomaticTasksOpen(true);}} onEdit={id=>{setAutomaticTaskEditorId(id);setAutomaticTasksOpen(true);}} onOpenRuns={openMediaJobs} onOpenScripts={()=>setScriptSandboxPreviewOpen(true)} /> : undefined}
        pluginSidebarViews={pluginSidebarViews}
        revealTarget={workspaceTabRevealTarget}
        onToggleShowIgnoredItems={() => {
          const next = !showIgnoredItems;
          setShowIgnoredItems(next);
          if (library) {
            void loadContent(library, assetScope, {
              trashMode: showTrash,
              discovery: currentQueryDefinition(),
              showIgnored: next,
            });
          }
        }}
        filteredFolderCounts={showTrash ? null : filteredFolderCounts}
        onChooseAllAssets={() => void chooseFolder("all")}
        onEnterTrash={() => void enterTrash()}
        onTrashContextMenu={(event) => {
          openContextMenu(
            { type: "trash" },
            { x: event.clientX, y: event.clientY },
          );
        }}
        onEnterTagManagement={() => void enterTagManagement()}
        onChoosePluginSidebarView={(viewId) => void enterPluginSidebarView(viewId)}
        onChooseFolder={(folderId) => {
          // 普通点击 = 进入该文件夹：选区回到「只隐式选中当前文件夹」的状态。
          setSelectedFolderIds([]);
          void chooseFolder(folderId);
        }}
        onExternalDragOver={handleTargetExternalDragOver}
        onExternalDrop={(event, targetFolderId) =>
          handleTargetExternalDrop(event, targetFolderId)
        }
        getManagedAssetDragIds={getManagedAssetDragIds}
        getManagedFolderDragIds={getManagedFolderDragIds}
        folderTreeActionsRef={folderTreeActionsRef}
        onOpenRootFolderContextMenu={({ x, y }) =>
          // Serpent-a6c516: the folder panel's blank area and the 「资源库根目录」
          // row are both the library root, so they share this menu.
          openContextMenu(
            {
              type: "folder",
              folderId: LIBRARY_ROOT_FOLDER_ID,
              // Shown in the menu's leading line and its accessible name.
              name: t("menu.libraryRoot"),
              locationKind: "managed",
              isLibraryRoot: true,
            },
            { x, y },
          )
        }
        onResolveManagedAssetDrop={resolveManagedAssetDrop}
        isInternalAssetDrag={isInternalAssetDrag}
        onAssetsDroppedOnFolder={(folderId, assetIds, mode) =>
          handleAssetsDroppedOnFolder(folderId, assetIds, mode)
        }
        onFoldersDroppedOnFolder={handleFoldersDroppedOnFolder}
        onToggleFolderSelection={(folderId) => {
          // Serpent-d7acfa：侧栏 Ctrl/⌘+点击切换多选，与画布文件夹卡片共用状态。
          // 正在浏览的文件夹是「隐式选中」的：第一次 Ctrl+点击应得到 {当前, 点击}。
          const openFolderId =
            assetScope === "all" || assetScope === "root" ? null : assetScope;
          const isSelectableFolder = (candidate: string) =>
            folders.some((folder) => folder.folderId === candidate) ||
            linkedFolders.some((folder) => folder.linkedFolderId === candidate);
          setSelectedFolderIds((current) =>
            toggleFolderMultiSelection(current, folderId, {
              openFolderId,
              isSelectable: isSelectableFolder,
            }),
          );
        }}
        onAssetsDroppedOnTrash={(assetIds) =>
          handleAssetsDroppedOnTrash(assetIds)
        }
        onFoldersDroppedOnTrash={handleFoldersDroppedOnTrash}
        onManagedAssetCopyModeChange={(copyMode) => {
          setAssetDragPreviewCopyMode(dragPreviewRef.current, copyMode);
        }}
        onImportFolderAsLinked={() => void importFolderAsLinked()}
        linkedFolderHintActive={linkedFolderHintShow}
        onLinkedFolderHintHover={beginLinkedFolderHintHover}
        onLinkedFolderHintHoverEnd={endLinkedFolderHintHover}
        onRelinkFolder={(folderId) => void relinkFolder(folderId)}
        onAddFolder={() => {
          // Serpent-b8a853: while the user has never used linked folders,
          // adding an ordinary folder pulses the 导入链接文件夹 entry.
          if (linkedFolderAddHintEligible) {
            setLinkedFolderHintActive(true);
            if (linkedFolderHintStopTimerRef.current) {
              clearTimeout(linkedFolderHintStopTimerRef.current);
            }
            linkedFolderHintStopTimerRef.current = setTimeout(() => {
              linkedFolderHintStopTimerRef.current = null;
              setLinkedFolderHintActive(false);
            }, 8000);
          }
          // Serpent-186547: the folder-section 「+」 always creates at the
          // library root, independent of the folder currently in scope.
          // Subfolders are created from the folder's context menu (新建子文件夹).
          openInlineFolderCreate(null);
        }}
        inlineFolderEdit={inlineFolderEdit}
        onInlineFolderEditChange={changeInlineFolderEdit}
        onInlineFolderEditCommit={(onCreateSuccess) =>
          void commitInlineFolderEdit((folderId, parentFolderId) => {
            onCreateSuccess?.(folderId, parentFolderId);
          })
        }
        onInlineFolderEditCancel={cancelInlineFolderEdit}
        onOpenContextMenu={openContextMenu}
        onImportDroppedFiles={(files, targetFolderId, webPayload) =>
          void importDroppedFiles(files, targetFolderId, webPayload)
        }
        onCopyManagedToLinked={(folder, assetIds) =>
          void copyManagedSelectionToLinked(folder, assetIds)
        }
      />
      <section className="workspace">
        <div
          className={`workspace-toolstrip${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
          data-chrome="unified"
        >
        <div
          className={`workspace-bar${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
        >
          <div className="workspace-title">
            {library &&
              !showTrash &&
              !showTagManagement &&
              !showPluginSidebarView &&
              !activeTagId &&
              assetScope !== "all" &&
              assetScope !== "root" && (
                <button
                  aria-pressed={folderRecursive}
                  className={`workspace-include-subfolders${
                    recursiveHintActive ? " is-feature-hinting" : ""
                  }`}
                  onMouseEnter={() => {
                    // Hovering the highlighted affordance >0.5s dismisses the
                    // hint permanently (shared all-highlights rule).
                    includeSubfoldersHoverTimerRef.current = setTimeout(() => {
                      includeSubfoldersHoverTimerRef.current = null;
                      if (recursiveHintKey) {
                        const hinted = withFeatureHintShown(
                          featureHintPrefs,
                          recursiveHintKey,
                        );
                        setFeatureHintPrefs(hinted);
                        saveFeatureHintPreferences(hinted);
                      }
                    }, 500);
                  }}
                  onMouseLeave={() => {
                    if (includeSubfoldersHoverTimerRef.current) {
                      clearTimeout(includeSubfoldersHoverTimerRef.current);
                      includeSubfoldersHoverTimerRef.current = null;
                    }
                  }}
                  onClick={() => {
                    // Include-subfolders changes the browse result set (REQ-VIEW-004).
                    void closeAssetPreview(false);
                    const next = !folderRecursiveRef.current;
                    folderRecursiveRef.current = next;
                    setFolderRecursive(next);
                    const nextPrefs = withFolderRecursiveEnabled(
                      folderRecursivePrefs,
                      library.libraryId,
                      assetScope,
                      next,
                    );
                    setFolderRecursivePrefs(nextPrefs);
                    saveFolderRecursivePreferences(nextPrefs);
                    // Once the user has expanded this folder's children, the
                    // hint is moot and must never pulse again (Serpent-b8a853).
                    if (next && recursiveHintKey) {
                      const hintedPrefs = withFeatureHintShown(
                        featureHintPrefs,
                        recursiveHintKey,
                      );
                      setFeatureHintPrefs(hintedPrefs);
                      saveFeatureHintPreferences(hintedPrefs);
                    }
                    const searchActive = currentQueryDefinition().search !== undefined;
                    void loadContent(library, assetScope, {
                      discovery: currentQueryDefinition(),
                      // Text search is recursive by definition (REQ-FILTER-012),
                      // so changing the browse-only switch must not narrow a
                      // live search result set.
                      searchScope: searchActive
                        ? folderSearchScope(assetScope)
                        : {
                            kind: "folder",
                            folderId: assetScope,
                            recursive: next,
                          },
                    }).catch((caught) => {
                      setError(
                        toMessage(caught, t("toast.readAssetsFailed"), locale),
                      );
                    });
                  }}
                  type="button"
                  {...iconActionAttrs(t("nav.includeChildFolders"))}
                >
                  <Icon name="folders" size={14} />
                </button>
              )}
            {showTagManagement || showPluginSidebarView ? (
              <span>{workspaceTitle()}</span>
            ) : (
              <ScopeBreadcrumbs
                onNavigateFolder={(folderId) => void chooseFolder(folderId)}
                onNavigateTrashTombstone={(tombstoneId) => {
                  void enterTrashAt(tombstoneId);
                }}
                segments={scopeBreadcrumbSegments}
              />
            )}
            <span className="item-count">
              {library
                ? showTagManagement
                  ? t("common.itemCount", { count: tags.length })
                  : t("common.itemCount", { count: workspaceBrowseCount })
                : t("common.notLoaded")}
            </span>
          </div>
          <div className="workspace-tools">
            {library && showTrash ? (
              <>
                <button
                  className="compact-action"
                  disabled={busy}
                  onClick={() => void emptyTrash()}
                  type="button"
                >
                  <Icon name="trash" size={14} />
                  {t("toolbar.emptyTrash")}
                </button>
                <span className="tool-separator" />
              </>
            ) : (
              library &&
              !showTrash &&
              !showTagManagement &&
              !showPluginSidebarView &&
              visibleAssets.some(
                (a) => a.availability === "missing" && !a.deletedAt,
              ) && (
                <>
                  <button
                    className="compact-action"
                    disabled={busy}
                    onClick={() => void startBatchRelink()}
                    type="button"
                  >
                    <Icon name="folder" size={14} />
                    {t("toolbar.batchRelink")}
                  </button>
                  <span className="tool-separator" />
                </>
              )
            )}
            {!showTagManagement && !showPluginSidebarView && (
              <CanvasToolbarControls
                actions={{
                  refresh: () => {
                    void refreshAssets();
                  },
                  setViewMode: (mode) => {
                    setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
                  },
                  toggleField: (field) => {
                    setCanvasPrefs((p) => ({
                      ...p,
                      fields: { ...p.fields, [field]: !p.fields[field] },
                    }));
                  },
                  cycleCaptionAlign: () => {
                    setCanvasPrefs((p) => ({
                      ...p,
                      captionAlign: nextCanvasCaptionAlign(p.captionAlign),
                    }));
                  },
                  openAiSettings: () => {
                    setAppSettingsCategory("ai");
                    setAppSettingsOpen(true);
                  },
                  openAppSettings: () => {
                    setAppSettingsCategory("general");
                    setAppSettingsOpen(true);
                  },
                }}
                busy={busy}
                canvasPrefs={canvasPrefs}
                cardSize={assetCardSize}
                cardSizeStops={cardSizeStops}
                libraryOpen={Boolean(library)}
                locale={locale}
                onCardSizeChange={resizeAssetCards}
                platform={SHORTCUT_PLATFORM}
              />
            )}
            <PluginToolbarButtons
              disabled={busy || library === null || showTagManagement || showPluginSidebarView}
              libraryId={library?.libraryId}
              pluginApi={(window as RendererWindow).keel?.plugins}
              refreshKey={pluginContributionRefreshKey}
              selectedAssetIds={selectedAssetIds}
              selectedAssets={selectedVisibleAssets}
              context={pluginSurfaceContext}
            />
          </div>
        </div>
        <PluginWorkspaceViews
          disabled={busy || library === null || showTagManagement || showPluginSidebarView}
          libraryId={library?.libraryId}
          pluginApi={(window as RendererWindow).keel?.plugins}
          refreshKey={pluginContributionRefreshKey}
        />
        {!showTagManagement && !showPluginSidebarView && (
        <div
          className={`workspace-discovery${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
        >
          <DimensionFilterBar
            disabled={!library}
            interactionsLocked={dialogFocusTrapActive}
            onClearFilter={clearDiscoveryFilter}
            onTagNamesChange={(names) => {
              // Discovery tag filters overlay the current folder/collection
              // scope. Do not set activeTagId — that is "browse by tag" mode
              // (chooseTag) and would clear folder nav highlight + folder cards
              // (Serpent-w9c6 / resolveFolderBrowseParentId).
              setTagFilter(names.join(", "));
              setActiveTagId(null);
            }}
            setSortField={(field) => {
              setShuffleSeed(null);
              setSortField(field);
            }}
            setSortOrder={(order) => {
              setShuffleSeed(null);
              setSortOrder(order);
            }}
            setTagFilter={(value) => {
              // Explicit filter-bar edits leave the tag-management AND mode.
              setTagFilterMatch("any");
              setTagFilter(value);
              setTagFilterExpression("");
            }}
            setTagFilterExpression={(value) => {
              setPinnedTagId(null);
              setTagFilterExpression(value);
              if (parseSearchExpressionDetailed(value, "tags").ok) setTagFilterLastValidExpression(value);
            }}
            shuffleActive={shuffleSeed !== null}
            onShuffle={() => {
              setShuffleSeed((prev) => {
                const next = Date.now() >>> 0;
                return prev === null ? next : (next ^ ((prev + 1) >>> 0)) >>> 0;
              });
            }}
            snapshot={{
              colorFilter,
              excludeColorFilter,
              formatFilter,
              excludeFormatFilter,
              tagFilter,
              tagFilterExpression,
              tagFilterMode,
              tagFilterLastValidExpression,
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
            }}
          />
        </div>
        )}
        </div>
        {(aiAnalyzing ||
          (aiJobs !== null && aiJobs.queued + aiJobs.running > 0)) &&
          aiProgressBannerVisible &&
          (() => {
            const batchProgress = aiBatchProgress;
            const progressLabel =
              batchProgress && batchProgress.batchTotal > 0
                ? t("toast.aiAnalyzeProgressCount", {
                    done: String(batchProgress.done),
                    total: String(batchProgress.batchTotal),
                  })
                : t("toast.aiAnalyzeStarted");
            return (
              <div className="workspace-ai-progress" role="status">
                <div className="workspace-ai-progress-body">
                  <div className="workspace-ai-progress-headline">
                    <span className="activity-pulse" aria-hidden />
                    <span className="workspace-ai-progress-message">
                      {progressLabel}
                    </span>
                  </div>
                  {batchProgress && batchProgress.batchTotal > 0 && (
                    <div
                      aria-valuemax={batchProgress.batchTotal}
                      aria-valuemin={0}
                      aria-valuenow={batchProgress.done}
                      className="task-progress-track workspace-ai-progress-bar"
                      role="progressbar"
                    >
                      <div
                        className="task-progress-fill"
                        style={{
                          width: `${Math.round((batchProgress.ratio ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="workspace-ai-progress-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void controlAiJobs("cancel")}
                    type="button"
                  >
                    {t("toast.aiAnalyzeStop")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setAiProgressBannerVisible(false)}
                    type="button"
                  >
                    {t("toast.aiAnalyzeRunInBackground")}
                  </button>
                </div>
              </div>
            );
          })()}
        {pluginJobActivity !== null && (
          <PluginJobActivityBanner
            job={pluginJobActivity}
            onDismiss={() => hidePluginJobActivity(pluginJobActivity.jobId)}
            onRunInBackground={() => hidePluginJobActivity(pluginJobActivity.jobId)}
            queuedMoreCount={pluginJobQueuedMore}
          />
        )}
        <div
          aria-busy={workspaceNavigationPending || workerRecoveryState === 'recovering'}
          className={`workspace-canvas-host${previewAsset || previewRestoring ? " is-viewing" : ""}${previewRestoring ? " is-restoring" : ""}${previewRestoring && previewCanvasReady ? " is-restore-visible" : ""}${workspaceNavigationPending ? " is-navigating" : ""}`}
        >
          {renderedToastStack.length > 0 || workerRecoveryState !== 'ready'
            ? createPortal(
                <div
                  aria-atomic="false"
                  aria-live="polite"
                  className="workspace-notice-stack workspace-notice"
                >
                  {workerRecoveryState !== 'ready' ? (
                    <Notice
                      className="workspace-notice-item"
                      message={t(workerRecoveryState === 'recovering' ? 'toast.workerRecovering' : 'toast.workerFailed')}
                      tone={workerRecoveryState === 'recovering' ? 'warning' : 'error'}
                    />
                  ) : null}
                  {renderedToastStack.map((message) => {
                    const isUndoTarget =
                      !message.closing &&
                      message.id === topVisibleToastId;
                    return (
                      <WorkspaceNoticeBanner
                        key={message.id}
                        closing={message.closing}
                        message={message}
                        onDismiss={() => dismissToast(message.id)}
                        onTransitionEnd={handleToastTransitionEnd}
                        onUndo={
                          message.kind === "notice" &&
                          isUndoTarget &&
                          message.historyEntryId
                            ? () => void undoLastFileOp(message.historyEntryId)
                            : undefined
                        }
                        toastId={message.id}
                        undoLabel={
                          message.kind === "notice" &&
                          isUndoTarget &&
                          message.historyEntryId
                            ? t("action.undo")
                            : undefined
                        }
                      />
                    );
                  })}
                </div>,
                document.body,
              )
            : null}
        {findSimilarSource
          && findSimilarSource.libraryId === library?.libraryId
          && findSimilarSource.workspaceTabId === workspaceTabsState.activeTabId
          && !previewAsset ? (
            <FindSimilarBanner
              coverUrl={findSimilarSource.coverUrl}
              displayName={findSimilarSource.displayName}
              onBack={() => void goWorkspaceBack()}
            />
          ) : null}
        <div
          className={`workspace-canvas${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}${externalDropActive ? " is-external-drop" : ""}`}
          inert={workerRecoveryState !== 'ready'}
          onDragEnter={handleExternalDragEnter}
          onDragLeave={handleExternalDragLeave}
          onDragOver={handleExternalDragOver}
          onDragOverCapture={handleExternalDragOver}
          onDrop={handleExternalDrop}
          onMouseDown={handleCanvasMouseDown}
          onContextMenu={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (
              target.closest(
                ".asset-card, .folder-card, button, [role='button'], [role='menuitem'], a, input, textarea, select",
              )
            ) {
              return;
            }
            if (!library || previewAsset || showTagManagement || showPluginSidebarView) return;
            event.preventDefault();
            openContextMenu(
              {
                type: "workspace",
                ...(selectedAssetIds.length > 0
                  ? { assetIds: [...selectedAssetIds] }
                  : {}),
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          ref={workspaceCanvasRef}
        >
          {/* Serpent-wgl2: rendered once, mutated directly via ref — a
              per-frame React state would re-render the whole grid. */}
          <div
            className="marquee-selection-box"
            ref={marqueeBoxRef}
          />
          {library && showPluginSidebarView ? (
            <PluginSidebarViewPanel
              activeView={activePluginSidebarView}
              libraryId={library.libraryId}
              pluginApi={(window as RendererWindow).keel?.plugins}
            />
          ) : library && showTagManagement ? (
            <TagManagementWorkspace
              busy={busy}
              onCreate={handleCreateTagInManagement}
              onDeleteMany={handleDeleteTagsInManagement}
              onMerge={handleMergeTagsInManagement}
              onOpenTag={(tagId) => void chooseTag(tagId)}
              onRename={handleRenameTagInManagement}
              onSearchTags={(names, match) =>
                void handleSearchTagsFromManagement(names, match)
              }
              tags={tags}
            />
          ) : library ? (
            browseCanvasBodyLayout.mode !== "empty" ? (
              <>
                {folderCardRowElement}
                {browseCanvasBodyLayout.showAssetGrid && (
                  <div
                    className={`asset-grid is-${assetViewMode}`}
                    ref={assetGridRef}
                    style={{
                      ...assetGridLayoutStyle(assetViewMode, assetCardSize),
                      ...(panelResizing && panelReflowFrozenWidthRef.current
                        ? {
                            width: `${panelReflowFrozenWidthRef.current}px`,
                            maxWidth: "none",
                          }
                        : {}),
                    }}
                  >
                  {(() => {
                    const showCornerBadges =
                      shouldShowAssetCardBadges(assetCardSize);
                    const renderAssetCard = (
                      asset: AssetSummary,
                      renderOptions?: { loadImmediately?: boolean; stableSlot?: boolean },
                    ) => {
                      const typeBadge = assetTypeBadgeLabel(
                        asset.mediaType,
                        asset.displayName,
                      );
                      const showExtension =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeExtension &&
                        shouldShowExtensionBadge(asset.mediaType);
                      const showDuration =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeDuration &&
                        shouldShowDurationBadge(
                          asset.mediaType,
                          asset.displayName,
                          asset.durationMs,
                        );
                      const showTypeBadge =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeType &&
                        Boolean(typeBadge) &&
                        shouldShowTypeBadgeAlongsideExtension(showExtension) &&
                        !asset.deletedAt &&
                        !shouldShowMissingAssetOverlay(asset.availability);
                      const sourceBadgeLabel =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeSource &&
                        !showTrash &&
                        shouldShowAssetSourceBadge(
                          sourceBadgeContext,
                          asset.managedFolderId,
                        )
                          ? resolveAssetSourceBadgeLabel(
                              folders,
                              asset.managedFolderId,
                              selectedFolderId ?? null,
                            )
                          : null;
                      const trashOriginBadgeLabel =
                        showTrash &&
                        asset.deletedAt &&
                        asset.trashedFromPath
                          ? trashedFromLabel(asset.trashedFromPath, locale)
                          : null;
                      const snippetCaption = resolveSearchSnippetCaption(
                        searchSnippets.get(asset.assetId),
                        asset.displayName,
                      );
                      const syncStatus =
                        canvasPrefs.fields.badgeSync !== false
                          ? syncCardStatuses.get(asset.assetId)
                          : undefined;
                      const layoutThumbnailArtifactId =
                        layoutThumbnailArtifacts.libraryId === library?.libraryId
                          ? layoutThumbnailArtifacts.ids.get(asset.assetId)
                          : undefined;
                      const layoutEntry = virtualBrowseLayout
                        ? virtualLayoutEntryForAsset(virtualBrowseLayout, asset.assetId)
                        : undefined;
                      const cardCover = resolveAssetCardCoverUrl({
                        libraryId: library?.libraryId,
                        assetId: asset.assetId,
                        mediaType: asset.mediaType,
                        availability: asset.availability,
                        deletedAt: asset.deletedAt,
                        thumbnailStatus: layoutThumbnailArtifactId
                          ? "ready"
                          : asset.thumbnailStatus,
                        thumbnailArtifactId:
                          layoutThumbnailArtifactId ?? asset.thumbnailArtifactId,
                        layoutPreviewArtifactId:
                          layoutThumbnailArtifactId
                          ?? layoutEntry?.previewArtifactId
                          ?? null,
                        previewKind: asset.previewKind,
                        previewRevisionId: asset.previewRevisionId,
                      });
                      const showThumbnailFailure = shouldShowThumbnailFailureBadge(
                        asset,
                        thumbnailFailures.has(asset.assetId),
                      );
                      const renamingThisAsset =
                        assetRenameDialog?.assetId === asset.assetId;
                      const corruptAsset = isCorruptAsset(asset);
                      const CardTag = renamingThisAsset ? "div" : "button";
                      return (
                    <CardTag
                      aria-label={canvasPrefs.fields.name ? undefined : asset.displayName}
                      data-hover-tip={canvasPrefs.fields.name ? undefined : asset.displayName}
                      aria-pressed={selectedIdSet.has(asset.assetId)}
                      className={`asset-card${selectedIdSet.has(asset.assetId) ? " is-selected" : ""}${asset.availability === "missing" ? " is-missing" : ""}${corruptAsset ? " is-corrupt" : ""}${asset.deletedAt ? " is-trashed" : ""}${renamingThisAsset ? " is-renaming" : ""}`}
                      data-tag-drop-target={tagDropTargetId === asset.assetId || undefined}
                      data-asset-id={asset.assetId}
                      data-asset-name={asset.displayName}
                      data-media-type={asset.mediaType}
                      draggable={
                        !showTrash && !renamingThisAsset && (
                          !nativeAssetDragEnabled
                          || (selectedIdSet.has(asset.assetId)
                            ? selectedNativeDragReady
                            : nativeDragReadyIds.has(asset.assetId))
                        )
                      }
                      key={renderOptions?.stableSlot
                        ? undefined
                        : assetCardKey(library?.libraryId, asset.assetId)}
                      {...(renamingThisAsset
                        ? { role: "group" as const }
                        : { type: "button" as const })}
                      onMouseDown={(e) => {
                        cardMouseDownRef.current = e.button;
                        if (e.button !== 0 || showTrash || renamingThisAsset || !api || !library) {
                          return;
                        }
                        const ids = resolveDraggedAssetIds(asset.assetId, selectedAssetIds);
                        api.primeAssetDrag({
                          libraryId: library.libraryId,
                          assetIds: ids,
                        });
                      }}
                      onMouseEnter={() => {
                        setHoveredAssetId(asset.assetId);
                      }}
                      onMouseLeave={() => {
                        clearHoveredAssetId(asset.assetId);
                      }}
                      onClick={(event) => {
                        if (renamingThisAsset) return;
                        handleCardClick(asset.assetId, event);
                      }}
                      onKeyDown={(event) => {
                        if (
                          renamingThisAsset ||
                          assetViewMode !== "masonry" ||
                          event.key !== "Tab"
                        ) {
                          return;
                        }
                        const nextAssetId = resolveMasonryTabTarget(
                          selectionAssetIds ?? [],
                          asset.assetId,
                          event.shiftKey,
                        );
                        if (!nextAssetId) return;
                        const nextCard = workspaceCanvasRef.current?.querySelector<HTMLElement>(
                          `.asset-card[data-asset-id="${CSS.escape(nextAssetId)}"]`,
                        );
                        if (!nextCard) return;
                        event.preventDefault();
                        nextCard.focus();
                      }}
                      onDoubleClick={() => {
                        if (renamingThisAsset) return;
                        openAssetByDefault(asset);
                      }}
                      onDragEnd={() => {
                        managedAssetDragIdsRef.current = null;
                        // REQ-DND-003: unmount the custom drag ghost.
                        dismissAssetDragPreview(dragPreviewRef.current);
                        dragPreviewRef.current = null;
                      }}
                      onDragOver={(event) => {
                        if (!showTrash && event.dataTransfer.types.includes(TAG_DRAG_TYPE)) {
                          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setTagDropTargetId(asset.assetId); return;
                        }
                      }}
                      onDragLeave={() => setTagDropTargetId(null)}
                      onDragStart={(event) => {
                        // REQ-DND-001/002: folder/trash drops resolve this
                        // selection snapshot at the target (asset-drag-drop.ts).
                        const ids = resolveDraggedAssetIds(asset.assetId, selectedAssetIds);
                        // Native OS drag and Chromium HTML5 drag cannot share a
                        // single session: Electron requires preventDefault()
                        // before startDrag, while in-app E2E keeps the HTML5
                        // payload to exercise internal targets. The test flag
                        // only disables the OS hand-off; production always
                        // uses the native path.
                        // `globalThis` in preload is isolated from the page
                        // world when contextIsolation is enabled. Use the
                        // explicit diagnostics bridge so E2E HTML5 drops do
                        // not enter Electron's native OS drag loop, while
                        // production still uses startDrag().
                        if (nativeAssetDragEnabled && api && library) {
                          if (!ids.every((id) => nativeDragReadyIds.has(id))) {
                            event.preventDefault();
                            api.primeAssetDrag({ libraryId: library.libraryId, assetIds: ids });
                            return;
                          }
                          // Electron's supported path is an asynchronous
                          // one-way IPC from dragstart. A synchronous round
                          // trip deadlocks when this native file drag returns
                          // to Keel as a drop. The OS drag carries Files,
                          // so the canvas must not treat it as an import.
                          beginInternalAssetDrag();
                          event.preventDefault();
                          api.startAssetDrag({
                            libraryId: library.libraryId,
                            assetIds: ids,
                          });
                          return;
                        }
                        managedAssetDragIdsRef.current = ids;
                        event.dataTransfer.setData(
                          MANAGED_ASSETS_DRAG_TYPE,
                          JSON.stringify(ids),
                        );
                        // Serpent-aa3: Option/Alt during dragover selects copy
                        // vs move via dropEffect; both must be allowed here.
                        event.dataTransfer.effectAllowed = "copyMove";
                        // REQ-DND-003: replace Chromium's full-card ghost with
                        // the small, translucent, rounded preview tile
                        // (asset-drag-preview.ts); the same keel:// URL as
                        // the card's <img>, so it is already cached.
                        const preview = showAssetDragPreview({
                          thumbnailUrl:
                            asset.thumbnailStatus === "ready" &&
                            asset.thumbnailArtifactId &&
                            library
                              ? `keel://preview/${library.libraryId}/${asset.thumbnailArtifactId}`
                              : null,
                          fileName: asset.displayName,
                          count: ids.length,
                          copyMode: resolveDragDropMode({
                            altKey: event.altKey,
                          }) === "copy",
                        });
                        dragPreviewRef.current = preview;
                        event.dataTransfer.setDragImage(
                          preview,
                          ASSET_DRAG_PREVIEW_WIDTH / 2,
                          ASSET_DRAG_PREVIEW_HEIGHT / 2,
                        );
                      }}
                      onDrop={(event) => {
                        if (!showTrash && event.dataTransfer.types.includes(TAG_DRAG_TYPE)) {
                          event.preventDefault(); event.stopPropagation(); setTagDropTargetId(null);
                          const tagId = event.dataTransfer.getData(TAG_DRAG_TYPE);
                          if (tags.some((tag) => tag.tagId === tagId)) void assignAssetsToTreeTag([asset.assetId], tagId);
                          return;
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const intent = resolveBrowseContextMenuIntent(
                          { kind: "asset", id: asset.assetId },
                          {
                            assetIds: selectedAssetIds,
                            folderIds: selectedFolderIds,
                          },
                        );
                        if (intent.type === "single-asset") {
                          if (!selectedIdSet.has(intent.assetId)) {
                            setSelectedAssetIds([intent.assetId]);
                            setSelectedAssetId(intent.assetId);
                          }
                          setSelectedFolderIds([]);
                          if (library) {
                            openContextMenu(
                              {
                                type: "asset",
                                assetId: asset.assetId,
                                displayName: asset.displayName,
                                locationKind: asset.locationKind,
                                isAvailable: asset.availability === "available",
                                isDeleted: Boolean(asset.deletedAt),
                              },
                              { x: e.clientX, y: e.clientY },
                            );
                          }
                          return;
                        }
                        if (intent.type !== "multi" || !library) return;
                        openContextMenu(
                          {
                            type: "multi-asset",
                            assetIds: [...intent.assetIds],
                            folderIds: [...intent.folderIds],
                            count:
                              intent.assetIds.length + intent.folderIds.length,
                          },
                          { x: e.clientX, y: e.clientY },
                        );
                      }}
                      type="button"
                    >
                      <div
                        className="asset-preview"
                        data-hover-tip={
                          showThumbnailFailure
                            ? thumbnailFailures.get(asset.assetId)
                            : undefined
                        }
                      >
                        {(() => {
                          if (asset.mediaType === "text" && api && library) {
                            return (
                              <TextAssetPreviewTile
                                api={api}
                                assetId={asset.assetId}
                                fileName={asset.relativeFilePath || asset.displayName}
                                libraryId={library.libraryId}
                                revisionId={asset.currentRevisionId}
                              />
                            );
                          }
                          const thumbCover = cardCover.url;
                          if (isCardSequencePlayable(asset) && library) {
                            const sequenceActive =
                              hoveredAssetId === asset.assetId ||
                              selectedAssetId === asset.assetId;
                            if (
                              thumbCover ||
                              asset.sequence?.frames.some(
                                (frame) => frame.thumbnailArtifactId,
                              )
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  hovering={hoveredAssetId === asset.assetId}
                                  hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                  hoverVideoSound={canvasPrefs.hoverVideoSound}
                                  isActive={sequenceActive}
                                  libraryId={library.libraryId}
                                  loadImmediately={
                                    renderOptions?.loadImmediately
                                      ?? Boolean(virtualBrowseLayout)
                                  }
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                  mediaMuted={viewerVolumeMuted}
                                  mediaVolume={viewerVolume}
                                  preview={null}
                                  sequence={asset.sequence}
                                />
                              );
                            }
                          }
                          const cardActive =
                            activePreviewAssetId === asset.assetId;
                          const cardThumbFailed =
                            asset.thumbnailStatus === "failed"
                            && !layoutThumbnailArtifactId;
                          if (isCardHoverPreviewable(asset)) {
                            if (
                              thumbCover ||
                              (cardActive && activeResolution?.url)
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  failed={cardThumbFailed}
                                  hovering={hoveredAssetId === asset.assetId}
                                  hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                  hoverVideoSound={canvasPrefs.hoverVideoSound}
                                  isActive={cardActive}
                                  libraryId={library.libraryId}
                                  loadImmediately={
                                    renderOptions?.loadImmediately
                                      ?? Boolean(virtualBrowseLayout)
                                  }
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                  mediaMuted={viewerVolumeMuted}
                                  mediaVolume={viewerVolume}
                                  onLiveVideoError={() =>
                                    retryLiveVideoProxyFallback(asset.assetId)
                                  }
                                  preview={
                                    cardActive ? activeResolution : null
                                  }
                                />
                              );
                            }
                          } else if (thumbCover) {
                            // Serpent-2ajm: unify with AssetCardMedia so a
                            // failed load shows the themed fallback icon
                            // instead of the browser's broken-image glyph.
                            return (
                              <AssetCardMedia
                                alt={asset.displayName}
                                coverUrl={thumbCover}
                                failed={cardThumbFailed}
                                hovering={hoveredAssetId === asset.assetId}
                                hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                hoverVideoSound={canvasPrefs.hoverVideoSound}
                                isActive={false}
                                libraryId={library.libraryId}
                                loadImmediately={
                                  renderOptions?.loadImmediately
                                    ?? Boolean(virtualBrowseLayout)
                                }
                                deferUntilVisible={Boolean(virtualBrowseLayout)}
                                mediaMuted={viewerVolumeMuted}
                                mediaVolume={viewerVolume}
                                preview={null}
                              />
                            );
                          }
                          return (
                            <>
                              <Icon
                                name={
                                  cardThumbFailed ? "broken-file" : "file"
                                }
                                size={28}
                              />
                              {!showExtension &&
                                shouldShowExtensionBadge(asset.mediaType) && (
                                  <span className="asset-extension">
                                    {fileExtensionLabel(asset.displayName)}
                                  </span>
                                )}
                            </>
                          );
                        })()}
                        {sourceBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                            className="asset-source-badge"
                            data-hover-tip={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                          >
                            {sourceBadgeLabel}
                          </span>
                        )}
                        {trashOriginBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: trashOriginBadgeLabel,
                            })}
                            className="asset-source-badge"
                            data-hover-tip={asset.trashedFromPath ?? trashOriginBadgeLabel}
                          >
                            {trashOriginBadgeLabel}
                          </span>
                        )}
                        {showExtension && (
                          <span className="asset-extension">
                            {fileExtensionLabel(asset.displayName)}
                          </span>
                        )}
                        {showThumbnailFailure && (
                          <span className="missing-banner">
                            <Icon name="warning" size={12} />
                            {t("toast.thumbnailFailedBadge")}
                          </span>
                        )}
                        {shouldShowMissingAssetOverlay(asset.availability) && (
                          <span
                            aria-label={
                              corruptAsset
                                ? t("inspector.dataCorrupt")
                                : t("inspector.missing")
                            }
                            data-hover-tip={
                              corruptAsset
                                ? t("inspector.dataCorrupt")
                                : t("inspector.missing")
                            }
                            className="missing-overlay"
                          >
                            {(() => {
                              const affordance = corruptAsset
                                ? corruptAssetAffordance()
                                : missingAssetAffordance();
                              return (
                                <Icon
                                  color={affordance.iconColor}
                                  name={affordance.icon}
                                  size={28}
                                />
                              );
                            })()}
                          </span>
                        )}
                        {asset.deletedAt && (
                          <span
                            className="missing-banner"
                            style={{
                              background: "var(--raised-2)",
                              color: "var(--secondary)",
                              bottom: 6,
                              right: 6,
                            }}
                          >
                            <Icon name="trash" size={12} />
                            {t("inspector.trashed")}
                            {asset.remainingDays !== null &&
                              t("scope.remainingDays", {
                                days: asset.remainingDays,
                              })}
                          </span>
                        )}
                        {showDuration && asset.durationMs != null && (
                          <span className="asset-duration-badge">
                            {formatDuration(asset.durationMs)}
                          </span>
                        )}
                        {asset.sequence && (
                          <span className="asset-duration-badge asset-sequence-badge">
                            {asset.sequence.frameCount}F · {asset.sequence.fps} FPS ·{" "}
                            {formatSequenceDuration(
                              asset.sequence.frameCount,
                              asset.sequence.fps,
                            )}
                          </span>
                        )}
                        {showTypeBadge && typeBadge && (
                          <span className="asset-type-badge">{typeBadge}</span>
                        )}
                      </div>
                      {(renamingThisAsset ||
                        canvasPrefs.fields.name ||
                        canvasPrefs.fields.size ||
                        canvasPrefs.fields.date ||
                        snippetCaption != null ||
                        shouldShowGridDimensions(
                          canvasPrefs.fields,
                          assetViewMode,
                          asset.width,
                          asset.height,
                          { mediaType: asset.mediaType },
                        )) && (
                        <div
                          className={`asset-caption ${assetCaptionAlignClass(canvasPrefs.captionAlign)}`}
                        >
                          {shouldShowGridDimensions(
                            canvasPrefs.fields,
                            assetViewMode,
                            asset.width,
                            asset.height,
                            { mediaType: asset.mediaType },
                          ) &&
                            !renamingThisAsset && (
                              <span className="asset-dimensions">
                                {asset.width} × {asset.height}
                              </span>
                            )}
                          {(canvasPrefs.fields.name || renamingThisAsset) && (
                            <>
                              {renamingThisAsset && assetRenameDialog ? (
                                <span className="asset-inline-rename">
                                  <input
                                    aria-label={t("dialog.rename.fileTitle")}
                                    autoFocus
                                    className="text-field asset-inline-rename-input"
                                    readOnly={assetRenameDialog.submitting}
                                    aria-disabled={assetRenameDialog.submitting || undefined}
                                    onBlur={() => {
                                      void submitAssetRename();
                                    }}
                                    onChange={(event) =>
                                      changeAssetRenameValue(event.target.value)
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                    onFocus={(event) => {
                                      const { baseName } = splitAssetFileName(
                                        event.currentTarget.value,
                                      );
                                      event.currentTarget.setSelectionRange(
                                        0,
                                        baseName.length,
                                      );
                                    }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (isImeKeyboardEvent(event)) return;
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void submitAssetRename();
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelAssetRename();
                                      }
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    value={assetRenameDialog.value}
                                  />
                                  {assetRenameDialog.error ? (
                                    <span className="asset-inline-rename-error">
                                      {assetRenameDialog.error}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <strong className="asset-caption-filename" data-hover-tip={asset.displayName}>
                                  {renderMiddleEllipsisFilename(asset.displayName, searchValue)}
                                </strong>
                              )}
                            </>
                          )}
                          {snippetCaption != null ? (
                            <span className="search-snippet">
                              {highlightSnippet(snippetCaption)}
                            </span>
                          ) : (canvasPrefs.fields.size ||
                              canvasPrefs.fields.date) ? (
                            <span>
                              {canvasPrefs.fields.size &&
                                formatBytes(asset.byteSize)}
                              {canvasPrefs.fields.size &&
                                canvasPrefs.fields.date &&
                                " · "}
                              {canvasPrefs.fields.date &&
                                formatDate(asset.modifiedAt, locale, t("common.unknownTime"))}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {syncStatus ? <SyncCardStatusBadge status={syncStatus} /> : null}
                    </CardTag>
                    );
                    };
                    return assetRenderSections.map((section) => (
                      <div
                        className={
                          section.label ? "trash-folder-group" : undefined
                        }
                        key={section.key || "__root__"}
                      >
                        {section.label ? (
                          <h3 className="trash-folder-group-header">
                            {section.label}
                          </h3>
                        ) : null}
                        {assetViewMode === "masonry" ? (
                          <MasonryColumns
                            assets={section.assets}
                            layout={visibleBrowseLayout}
                            virtualLayout={visibleVirtualBrowseLayout}
                            cardSize={assetCardSize}
                            renderCard={renderAssetCard}
                            renderLayoutPreview={(entry, renderOptions) =>
                              library ? (
                                <BrowseLayoutPreview
                                  entry={entry}
                                  fields={canvasPrefs.fields}
                                  libraryId={library.libraryId}
                                  previewArtifactId={
                                    layoutThumbnailArtifacts.libraryId === library.libraryId
                                      ? layoutThumbnailArtifacts.ids.get(entry.assetId)
                                      : undefined
                                  }
                                  syncStatus={
                                    canvasPrefs.fields.badgeSync !== false
                                      ? syncCardStatuses.get(entry.assetId)
                                      : undefined
                                  }
                                  viewMode="masonry"
                                  loadImmediately={renderOptions?.loadImmediately ?? true}
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                />
                              ) : null
                            }
                            captionFields={canvasPrefs.fields}
                            snippetLine={searchSnippets.size > 0}
                            suspendScrollRestoration={
                              Boolean(previewAsset || previewRestoring)
                            }
                          />
                        ) : (
                          <JustifiedAssetRows
                            assets={section.assets}
                            layout={visibleBrowseLayout}
                            virtualLayout={visibleVirtualBrowseLayout}
                            cardSize={assetCardSize}
                            captionFields={canvasPrefs.fields}
                            snippetLine={searchSnippets.size > 0}
                            renderCard={renderAssetCard}
                            renderLayoutPreview={(entry, renderOptions) =>
                              library ? (
                                <BrowseLayoutPreview
                                  entry={entry}
                                  fields={canvasPrefs.fields}
                                  libraryId={library.libraryId}
                                  previewArtifactId={
                                    layoutThumbnailArtifacts.libraryId === library.libraryId
                                      ? layoutThumbnailArtifacts.ids.get(entry.assetId)
                                      : undefined
                                  }
                                  syncStatus={
                                    canvasPrefs.fields.badgeSync !== false
                                      ? syncCardStatuses.get(entry.assetId)
                                      : undefined
                                  }
                                  viewMode="grid"
                                  loadImmediately={renderOptions?.loadImmediately ?? true}
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                />
                              ) : null
                            }
                          />
                        )}
                      </div>
                    ));
                  })()}
                  </div>
                )}
                {/* Serpent-87pd: invisible tail probe. A jump to the end fills
                    the last window, not pages 0 → 100 → 200. Serpent-6z5r:
                    no spinner or "loading more" copy. */}
                {browsePagination.hasMorePages && (
                  <div
                    ref={browsePagination.sentinelRef}
                    className="browse-load-more"
                    aria-hidden="true"
                  />
                )}
              </>
            ) : (
              <>
                {folderCardRowElement}
                <div className="empty-library">
                <div className="empty-orbit">
                  <Icon name={browseEmptyState.icon} size={24} />
                </div>
                <h1>{t(browseEmptyState.titleKey)}</h1>
                <p>{t(browseEmptyState.detailKey)}</p>
                {browseEmptyState.showImportActions ? (
                  <div className="empty-actions">
                    <button
                      className="primary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void importAssets("files")}
                      type="button"
                    >
                      {t("toolbar.importFiles")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void importAssets("folder")}
                      type="button"
                    >
                      {t("toolbar.importFolder")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void pasteClipboardImage()}
                      type="button"
                    >
                      {t("toolbar.pasteImage")}
                    </button>
                  </div>
                ) : null}
              </div>
              </>
            )
          ) : null}
        </div>
        {/* Drop overlay lives outside the scrollable canvas so it stays put
            while the browse grid scrolls (Serpent-ns3r). */}
        {externalDropActive && (
          <div className="external-drop-overlay" role="status">
            <div className="external-drop-overlay-content">
              <Icon name="upload" size={28} />
              <strong>{t("toolbar.dropToImport")}</strong>
              <span>{t("toolbar.dropHint")}</span>
            </div>
          </div>
        )}
        {workspaceNavigationPending && (
          <div
            aria-hidden="true"
            className="workspace-navigation-hold"
          />
        )}
        </div>
        {previewAsset && library && api && (
          <>
          <AssetPreviewModal
            ref={previewModalRef}
            api={api}
            asset={previewAsset}
            bakeImageRotation={bakeImageRotation}
            chromeIdle={viewerChromeIdle}
            canDiskDeleteAsset={!showTrash && previewAsset.deletedAt === null}
            canPermanentDelete={showTrash}
            canTrashAsset={
              previewAsset.locationKind === "managed"
              && previewAsset.deletedAt === null
              && !showTrash
            }
            libraryId={library.libraryId}
            navArrowsOnApproach={viewerChromePrefs.navArrowsOnApproach}
            onToggleNavArrowsOnApproach={() => {
              setViewerChromePrefs((current) => ({
                ...current,
                navArrowsOnApproach: !current.navArrowsOnApproach,
              }));
            }}
            onToggleVideoTransportOnApproach={() => {
              setViewerChromePrefs((current) => ({
                ...current,
                videoTransportOnApproach: !current.videoTransportOnApproach,
              }));
            }}
            onDiskDeleteAsset={() => {
              requestSelectionDiskDelete([previewAsset.assetId], []);
            }}
            onPermanentDelete={() => {
              const assetId = previewAsset.assetId;
              void deletePermanentFromTrash([assetId]).then((removed) => {
                if (removed) advanceOpenViewer(assetId);
              });
            }}
            onTrashAsset={() => {
              const assetId = previewAsset.assetId;
              void trashManagedAssets([assetId]).then(() => {
                advanceOpenViewer(assetId);
              });
            }}
            videoTransportOnApproach={viewerChromePrefs.videoTransportOnApproach}
            onChromeActivity={onViewerChromeActivity}
            onSetColorSpace={(assetId, colorSpace) => {
              void persistAssetColorSpace(assetId, colorSpace);
            }}
            onClose={() => void closeAssetPreview()}
            onInfoNotice={setNotice}
            onNext={
              previewIndex >= 0 && previewIndex < visibleAssets.length - 1
                ? () => navigateAssetPreview(visibleAssets[previewIndex + 1]!)
                : undefined
            }
            onPrevious={
              previewIndex > 0
                ? () => navigateAssetPreview(visibleAssets[previewIndex - 1]!)
                : undefined
            }
            pluginApi={(window as RendererWindow).keel?.plugins}
            pluginContributionRefreshKey={pluginContributionRefreshKey}
          />
          </>
        )}
      </section>
      <InspectorPanel
        aiContent={
          aiContent?.assetId === selectedAsset?.assetId ? aiContent : null
        }
        api={api}
        automaticPaletteRatios={automaticPaletteRatios}
        displayedPalette={displayedPalette}
        folderCount={folders.length}
        folderInspector={folderInspector ? {
          entries: folderInspector.entries,
          appearance: folderInspectorAppearance,
          byteSize: folderInspector.byteSize,
        } : null}
        handleFavoriteToggle={handleFavoriteToggle}
        handleMetadataDescriptionInput={handleMetadataDescriptionInput}
        handleMetadataDescriptionSave={handleMetadataDescriptionSave}
        handleRatingClick={handleRatingClick}
        handleSourceUrlInput={handleSourceUrlInput}
        handleSourceUrlSave={handleSourceUrlSave}
        handleAuthorInput={handleAuthorInput}
        handleAuthorSave={handleAuthorSave}
        loadMetadata={loadMetadata}
        onAssignTagToAsset={(tagId) => void handleInspectorAssignTag(tagId)}
        onCreateAndAssignTag={(tagName) => void handleInspectorCreateAndAssignTag(tagName)}
        onApplyTagNames={(tagNames) => void handleInspectorApplyTagNames(tagNames)}
        onOpenSourceUrl={handleOpenSourceUrl}
        onPaletteColorCopy={(color, copied) => {
          if (copied) {
            setNotice(t("toast.colorCopiedAlt", { color }));
          } else {
            setError(t("toast.colorCopyUnavailable"));
          }
        }}
        onRemoveTagFromAsset={handleInspectorRemoveTag}
        onFilterTag={(tagId) => void chooseTag(tagId)}
        onRenameTag={handleRenameTagInManagement}
        selectedAsset={selectedAsset}
        selectedAssets={selectedAssets}
        multiEdit={multiEdit}
        pluginApi={(window as RendererWindow).keel?.plugins}
        libraryId={library?.libraryId}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
      />
      <ImageSequenceDialog
        count={
          imageSequenceDialog?.mode === "update"
            ? imageSequenceDialog.frameCount ?? 0
            : imageSequenceDialog?.assetIds.length ?? 0
        }
        error={imageSequenceDialog?.error}
        fps={imageSequenceDialog?.fps ?? DEFAULT_IMAGE_SEQUENCE_FPS}
        mode={imageSequenceDialog?.mode}
        onCancel={() => setImageSequenceDialog(null)}
        onFpsChange={(fps) =>
          setImageSequenceDialog((current) =>
            current ? { ...current, fps, error: null } : current,
          )
        }
        onSubmit={() =>
          void (
            imageSequenceDialog?.mode === "update"
              ? updateImageSequenceFps()
              : createSelectedImageSequence()
          )
        }
        open={imageSequenceDialog !== null}
        submitting={imageSequenceDialog?.submitting}
      />
      {linkedRulesEditor && (
        <LinkedRulesDialog
          name={linkedRulesEditor.name}
          initialRules={linkedRulesEditor.rules}
          onClose={() => setLinkedRulesEditor(null)}
          onSave={(finalRules) => void saveLinkedRules(finalRules)}
        />
      )}
      {convertLinkedDialog.folderId && (
        <ConvertLinkedDialog
          folderName={convertLinkedDialog.name}
          folders={folders}
          targetFolderId={convertLinkedDialog.targetFolderId}
          onCancel={() =>
            setConvertLinkedDialog({
              folderId: "",
              name: "",
              targetFolderId: "",
            })
          }
          onConfirm={() => void convertLinkedToManaged()}
          onTargetChange={(targetFolderId) =>
            setConvertLinkedDialog((current) => ({
              ...current,
              targetFolderId,
            }))
          }
        />
      )}
      {restoreDialog && (
        <RestoreDialog
          assetIds={restoreDialog.assetIds}
          folders={folders}
          target={restoreDialog.target}
          conflictStrategy={restoreDialog.conflictStrategy}
          onTargetChange={(target) =>
            setRestoreDialog((current) =>
              current ? { ...current, target } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setRestoreDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void restoreTrashedAssets()}
          onCancel={() => setRestoreDialog(null)}
        />
      )}
      {moveDialog && (
        <MoveDialog
          assetIds={moveDialog.assetIds}
          folderIds={moveDialog.folderIds}
          folders={folders}
          linkedFolders={
            moveDialog.assetIds.length > 0 && moveDialog.folderIds.length === 0
              ? (() => {
                  const rootNames = new Map(
                    linkedFolders
                      .filter((folder) => (folder.relativePath ?? "") === "")
                      .map((folder) => [folder.folderId, folder.displayName]),
                  );
                  return linkedFolders.map((folder) => {
                    const rootName =
                      (folder.linkedFolderId
                        ? rootNames.get(folder.linkedFolderId)
                        : undefined) ?? folder.displayName;
                    return {
                      folderId: folder.folderId,
                      name: folder.displayName,
                      relativePath:
                        (folder.relativePath ?? "") === ""
                          ? rootName
                          : `${rootName}/${folder.relativePath}`,
                      assetCount: folder.assetCount,
                    };
                  });
                })()
              : undefined
          }
          targetFolderId={moveDialog.targetFolderId}
          conflictStrategy={moveDialog.conflictStrategy}
          folderOnly={
            moveDialog.folderIds.length > 0 && moveDialog.assetIds.length === 0
          }
          onTargetChange={(folderId) =>
            setMoveDialog((current) =>
              current ? { ...current, targetFolderId: folderId } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setMoveDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void moveManagedAssets()}
          onCancel={() => setMoveDialog(null)}
        />
      )}
      <FolderCoverPickerDialog
        open={folderCoverPicker !== null}
        libraryId={library?.libraryId ?? null}
        selectedAssetId={folderCoverPicker?.assetId ?? ""}
        pageSize={FOLDER_COVER_PICKER_PAGE_SIZE}
        loadPage={loadFolderCoverPickerPage}
        onSelect={(assetId) =>
          setFolderCoverPicker((current) =>
            current ? { ...current, assetId } : current,
          )
        }
        onConfirm={applyFolderCoverFromLibrary}
        onCancel={() => setFolderCoverPicker(null)}
      />
      <AppSettingsDialog
        aiConfigPanel={
          <AiConfigDialog
            open={appSettingsOpen && appSettingsCategory === "ai"}
            variant="embedded"
            onNewProfile={beginNewAiProfile}
            onSelectProfile={selectAiProfile}
            onActivateProfile={(id) => void activateAiProfile(id)}
            onDeleteProfile={(id) => void removeAiProfile(id)}
            onClearCredential={() => void clearAiProfileCredential()}
            onConcurrencyLimitChange={commitAiConcurrencyLimit}
            onMaxAnalysisImageEdgePxChange={commitAiMaxAnalysisImageEdgePx}
            onCommitAnalysisSettingsPatch={commitAiAnalysisSettingsPatch}
            onClose={() => {
              if (aiSaveVerifying) return;
              setAiApiKey("");
              // Keep global connection state for heartbeat / context menu
              // (Serpent-rsbt); re-sync from stored credentials after draft edits.
              void probeStoredAiConnection();
            }}
            onSave={() => void saveAiConfig()}
            onTestConnection={testAiConnectionFromDialog}
            onFetchModels={fetchAiModelsFromDialog}
          />
        }
        aiUiPrefs={aiUiPrefs}
        autoDetectImageSequences={imageSequencePrefs.autoDetectOnImport}
        imageSequenceDetectionEnabled={imageSequencePrefs.detectionEnabled}
        navArrowsOnApproach={viewerChromePrefs.navArrowsOnApproach}
        onToggleNavArrowsOnApproach={() => {
          setViewerChromePrefs((current) => ({
            ...current,
            navArrowsOnApproach: !current.navArrowsOnApproach,
          }));
        }}
        onToggleShowMissingLinkedFiles={() => {
          const next = !showMissingLinkedFiles;
          setShowMissingLinkedFiles(next);
          writeShowMissingLinkedFiles(next, globalThis.localStorage);
          const pending = shellApi?.setShowMissingLinkedFiles(next) ?? Promise.resolve();
          showMissingLinkedPublishRef.current = pending;
          void pending.then(() => {
            if (!library) return;
            void loadContent(library, assetScope, {
              trashMode: showTrash,
              discovery: currentQueryDefinition(),
              showIgnored: showIgnoredItems,
            });
          });
        }}
        onToggleVideoTransportOnApproach={() => {
          setViewerChromePrefs((current) => ({
            ...current,
            videoTransportOnApproach: !current.videoTransportOnApproach,
          }));
        }}
        videoTransportOnApproach={viewerChromePrefs.videoTransportOnApproach}
        canvasPrefs={canvasPrefs}
        onClose={() => {
          setAppSettingsOpen(false);
          setAppSettingsCategory("general");
        }}
        onSetViewMode={(mode) => {
          setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
        }}
        onSetCaptionAlign={(align) => {
          setCanvasPrefs((p) => ({ ...p, captionAlign: align }));
        }}
        onToggleField={(field) => {
          setCanvasPrefs((p) => ({
            ...p,
            fields: { ...p.fields, [field]: !p.fields[field] },
          }));
        }}
        onToggleHoverAudioPlay={() => {
          setCanvasPrefs((p) => ({ ...p, hoverAudioPlay: !p.hoverAudioPlay }));
        }}
        onToggleHoverVideoSound={() => {
          setCanvasPrefs((p) => ({ ...p, hoverVideoSound: !p.hoverVideoSound }));
        }}
        audioPreviewPrefersCover={audioPreviewPrefersCover}
        onAudioPreviewPrefersCoverChange={applyAudioPreviewPreference}
        bakeImageRotation={bakeImageRotation}
        onBakeImageRotationChange={applyBakeImageRotation}
        onToggleShowAiBadges={() => {
          setAiUiPrefs((p) => ({ ...p, showAiBadges: !p.showAiBadges }));
        }}
        onToggleAutoDetectImageSequences={() => {
          setImageSequencePrefs((p) => ({
            ...p,
            autoDetectOnImport: !p.autoDetectOnImport,
          }));
        }}
        onToggleImageSequenceDetection={() => {
          setImageSequencePrefs((p) => ({
            ...p,
            detectionEnabled: !p.detectionEnabled,
          }));
        }}
        onOpenAppLog={openAppLog}
        onOpenExtensionReleases={() => {
          void shellApi?.openExternalUrl(
            "https://github.com/dolag233/Serpent-Extension/releases/latest",
          );
        }}
        pluginApi={(window as RendererWindow).keel?.plugins}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
        libraryId={library?.libraryId}
        mcpApi={(window as RendererWindow).keel?.mcp}
        showCardSyncStatus={canvasPrefs.fields.badgeSync}
        onShowCardSyncStatusChange={(checked) => {
          setCanvasPrefs((current) => ({
            ...current,
            fields: { ...current.fields, badgeSync: checked },
          }));
        }}
        embeddingServicesApi={api ?? undefined}
        syncServerCallbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncSaveServer(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncSaveServer(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncDeleteServer(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncDeleteServer(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true };
          },
          async syncProbe(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncProbe(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
      />
      <LibrarySettingsDialog
        key={`${library?.libraryId ?? "none"}:${librarySettingsOpen ? "open" : "closed"}`}
        library={library}
        open={librarySettingsOpen}
        gitignoreContent={gitignoreContent}
        onClose={() => {
          setLibrarySettingsOpen(false);
        }}
        onSaveName={async (name) => {
          if (!api || !library) return;
          const result = await api.rename({ libraryId: library.libraryId, displayName: name });
          if (!result.ok) {
            setError(messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")));
            return;
          }
          setLibrary(result.value);
          setNotice(t("toast.librarySettingsSaved"));
        }}
        onSaveGitignore={async (content) => {
          if (!api || !library) return;
          const result = await api.setGitignore({ libraryId: library.libraryId, content });
          if (!result.ok) {
            setError(messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")));
            return;
          }
          setGitignoreContent(result.value.content);
          setNotice(t("toast.librarySettingsSaved"));
          await reloadCurrentContent();
        }}
        onPreviewGitignore={async (content) => {
          if (!api || !library) return null;
          const result = await api.previewGitignore({ libraryId: library.libraryId, content });
          if (!result.ok) return null;
          return result.value;
        }}
        syncCallbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncProbe(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncProbe(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncPreview(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncPreview(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncRun(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const startedAt = Date.now();
            syncRunStartedAtRef.current = startedAt;
            const result = await api.syncRun(input);
            if (!result.ok) {
              syncRunStartedAtRef.current = null;
              playTaskCompletionSound(startedAt);
              return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            }
            return { ok: true, value: result.value };
          },
          async syncSaveBinding(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncSaveBinding(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            if (input.enabled !== undefined) {
              setSyncBindingStatus(input.enabled ? "enabled" : "disabled");
            }
            return { ok: true };
          },
          async syncGetBinding(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncGetBinding(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
        syncProgress={syncProgress}
        embeddingIndex={embeddingBound ? embeddingIndex : null}
        embeddingCallbacks={{
          async listServices() {
            if (!api) return { ok: false };
            const result = await api.embeddingListServices();
            if (!result.ok || !result.value) return { ok: false };
            return { ok: true, value: result.value };
          },
          async installStatus() {
            if (!api) return { ok: false };
            const result = await api.embeddingInstallStatus();
            if (!result.ok) return { ok: false };
            return { ok: true, value: result.value };
          },
          async getBinding(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingGetBinding(input);
            if (!result.ok) return { ok: false };
            return { ok: true, value: result.value };
          },
          async saveBinding(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingSaveBinding(input);
            if (!result.ok) return { ok: false };
            return { ok: true };
          },
          async rebuildIndex(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingIndexStatus({
              libraryId: input.libraryId, modelId: input.modelId, run: true, restart: false, rebuild: true,
            });
            return result.ok ? { ok: true } : { ok: false };
          },
        }}
      />
      <OpenSyncLibraryDialog
        callbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncListRemoteLibraries(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListRemoteLibraries(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncOpenRemoteLibrary(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncOpenRemoteLibrary(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
        onClose={() => setOpenSyncLibraryOpen(false)}
        onOpened={(opened) => {
          void (async () => {
            if (!api) return;
            await runLibraryOpenPipeline(
              "opening",
              () => Promise.resolve({ ok: true, value: opened }),
              t("toast.openRecentFailed"),
            );
          })();
        }}
        open={openSyncLibraryOpen}
      />
      <AppLogDialog
        automationCorrelationId={appLogAutomationCorrelationId}
        entries={appLogEntries}
        errorCode={appLogErrorCode}
        loading={appLogLoading}
        onClose={() => setAppLogOpen(false)}
        onAutomationCorrelationIdChange={setAppLogAutomationCorrelationId}
        onRefresh={() => void refreshAppLog()}
        onReveal={revealAppLog}
        open={appLogOpen}
      />
      {library?.recovery && (
        <LibraryRecoveryDialog
          onClose={() => setLibraryRecoveryDialogOpen(false)}
          onRevealReport={() => void revealRecoveryReport()}
          open={libraryRecoveryDialogOpen}
          recovery={library.recovery}
        />
      )}
      {library && api && <AutomaticTasksDialog key={library.libraryId} api={api} libraryId={library.libraryId} initialTaskId={automaticTaskEditorId} open={automaticTasksOpen} currentQueryJson={JSON.stringify(currentQueryDefinition())} tags={tags} folders={folders} onClose={() => setAutomaticTasksOpen(false)} onOpenScripts={() => {setAutomaticTasksOpen(false);setScriptSandboxPreviewOpen(true);}} onChanged={async()=>{const r=await api.listTags({libraryId:library.libraryId});if(r.ok)setTags(r.value);}} />}
      <ScriptSandboxPreviewDialog
        automation={(window as RendererWindow).keel?.automation}
        libraryId={library?.libraryId ?? null}
        onClose={() => {
          setScriptSandboxPreviewOpen(false);
        }}
        onExecutionSettled={() => refreshAfterAutomationScript()}
        onOpenExecutionLog={(logId) => {
          setScriptSandboxPreviewOpen(false);
          openAppLog(logId);
        }}
        open={scriptSandboxPreviewOpen}
      />
      <AboutDialog
        open={aboutOpen}
        version={KEEL_VERSION}
        onClose={() => setAboutOpen(false)}
        onOpenGitHub={() => {
          const bridge = (window as RendererWindow).keel?.shell;
          if (!bridge?.openExternalUrl) return;
          void bridge.openExternalUrl("https://github.com/Ubik42/Keel");
        }}
      />
      <OpenSourceLicensesDialog
        open={openSourceLicensesOpen}
        onClose={() => setOpenSourceLicensesOpen(false)}
      />
      <CreateDialog
        busy={busy}
        open={dialog === "library"}
        phase={createLibraryPhase}
        required={!library}
        value={dialogValue}
        onValueChange={setDialogValue}
        onBeginCreate={() => {
          setDialogValue(t("shell.myLibrary"));
          setCreateLibraryPhase("form");
        }}
        onBackToStart={() => {
          if (createLibraryPhase === "eagle") {
            cancelEagleInspectFlow();
            if (library) setDialog(null);
            return;
          }
          if (createLibraryPhase === "billfish") {
            cancelBillfishInspectFlow();
            if (library) setDialog(null);
            return;
          }
          if (library) {
            setDialog(null);
            return;
          }
          setCreateLibraryPhase("start");
        }}
        onSubmit={() => {
          if (createLibraryPhase === "eagle") {
            void submitEagleLibraryName();
            return;
          }
          if (createLibraryPhase === "billfish") {
            void submitBillfishLibraryName();
            return;
          }
          setDialog(null);
          void runLibraryOperation("create");
        }}
        onCancel={() => {
          if (createLibraryPhase === "eagle") {
            cancelEagleInspectFlow();
          }
          if (createLibraryPhase === "billfish") {
            cancelBillfishInspectFlow();
          }
          setDialog(null);
          setCreateLibraryPhase("start");
        }}
        onOpenExisting={() => {
          // Keep the required no-library surface mounted while the native
          // picker is open. This avoids the auto-open effect racing a cancel
          // and makes the action visibly await the selected library. When a
          // library is already open, the menu dialog can close immediately.
          if (library) setDialog(null);
          void runLibraryOperation("open");
        }}
        onImportLibrary={() => {
          setDialog(null);
          setImportLibraryChooserOpen(true);
        }}
        onOpenRecent={(path) => {
          setDialog(null);
          void openRecentLibrary(path);
        }}
        onForgetRecent={(path) => {
          void forgetRecentLibrary(path);
        }}
      />
      {exportDialogOpen && (
        <ExportDialog
          open={exportDialogOpen}
          exporting={
            exportProgress !== null &&
            !["complete", "cancelled", "failed"].includes(exportProgress.phase)
          }
          onClose={() => setExportDialogOpen(false)}
          onExportFolder={(includeLinked) =>
            void exportLibrary("folder", includeLinked)
          }
          onExportZip={(includeLinked) =>
            void exportLibrary("zip", includeLinked)
          }
        />
      )}
      <OpenLibraryChooserDialog
        open={openLibraryChooserOpen}
        onCancel={() => setOpenLibraryChooserOpen(false)}
        onOpenKeel={() => {
          setOpenLibraryChooserOpen(false);
          if (library) setDialog(null);
          void runLibraryOperation("open");
        }}
        onOpenSyncLibrary={() => {
          setOpenLibraryChooserOpen(false);
          setAppSettingsOpen(false);
          setOpenSyncLibraryOpen(true);
        }}
        onOpenEagle={() => {
          setOpenLibraryChooserOpen(false);
          void openEagleLibrary();
        }}
        onOpenBillfish={() => {
          setOpenLibraryChooserOpen(false);
          void openBillfishLibrary();
        }}
      />
      <ImportLibraryChooserDialog
        open={importLibraryChooserOpen}
        externalKind={library ? "import" : "open"}
        onCancel={() => setImportLibraryChooserOpen(false)}
        onImportFolder={() => {
          setImportLibraryChooserOpen(false);
          void startImport();
        }}
        onImportZip={() => {
          setImportLibraryChooserOpen(false);
          void startImportZip();
        }}
        onOpenEagle={() => {
          setImportLibraryChooserOpen(false);
          void openEagleLibrary();
        }}
        onImportEagle={() => {
          setImportLibraryChooserOpen(false);
          void importEagleLibrary();
        }}
        onOpenBillfish={() => {
          setImportLibraryChooserOpen(false);
          void openBillfishLibrary();
        }}
        onImportBillfish={() => {
          setImportLibraryChooserOpen(false);
          void importBillfishLibrary();
        }}
      />
      {importValidated && (
        <ImportDialog
          open
          validated={importValidated}
          importing={
            importProgress !== null &&
            !["complete", "cancelled", "failed"].includes(importProgress.phase)
          }
          onClose={() => setImportValidated(null)}
          onImportCopy={() => void completeImportCopy()}
          onImportOpenInPlace={() => void completeImportInPlace()}
          onImportZip={() => {
            setImportValidated(null);
            void startImportZip();
          }}
        />
      )}
      <RelinkPreview
        session={batchRelinkPreview}
        keepMetadata={batchRelinkKeepMetadata}
        onKeepMetadataChange={setBatchRelinkKeepMetadata}
        onApply={() => void applyBatchRelink()}
        onCancel={() => void cancelBatchRelink()}
      />
      <AiConnectionFailureDialog
        failedCount={aiConnectionFailureGate.failedJobIds.length}
        failureCode={aiConnectionFailureGate.failureCode}
        onAbort={onAiConnectionFailureAbort}
        onRetry={handleAiConnectionFailureRetry}
        open={aiConnectionFailureGate.open}
      />
      <FatalAlertDialog
        cancelLabel={fatalAlertAlreadyOpen ? t("common.cancel") : null}
        confirmLabel={fatalAlertAlreadyOpen ? t("common.confirm") : null}
        message={fatalAlertMessage}
        title={fatalDialogTitle}
        onCancel={fatalAlertAlreadyOpen ? dismissAlreadyOpenPrompt : undefined}
        onConfirm={fatalAlertAlreadyOpen ? confirmAlreadyOpenLibrarySwitch : undefined}
        onDismiss={fatalAlertAlreadyOpen ? dismissAlreadyOpenPrompt : dismissFatalAlert}
        onSwitchLibrary={fatalAlertAlreadyOpen ? undefined : openLibraryChooserFromError}
      />
      <CriticalConfirmationDialog
        onDecide={criticalConfirmation.decide}
        request={criticalConfirmation.request}
      />
      <MediaJobsDialog
        open={mediaJobsOpen && library !== null}
        mediaJobs={mediaJobs}
        mediaJobsLoading={mediaJobsLoading}
        aiJobs={aiJobs}
        embeddingIndex={embeddingSearchReady && embeddingSelectionId ? { modelId: embeddingSelectionId, snapshot: embeddingIndex, modalities: embeddingService?.modalities } : null}
        pluginJobs={pluginJobs}
        onClose={() => setMediaJobsOpen(false)}
        onControlMediaJobs={(action, jobIds) => void controlMediaJobs(action, jobIds)}
        onLoadMoreMediaJobs={() => void loadMoreMediaJobs()}
        onControlAiJobs={(action, jobIds) => void controlAiJobs(action, jobIds)}
        onRevealAppLog={revealAppLog}
        onViewAppLog={openAppLog}
      />
      {/* Unified context menu */}
      <AssetContextMenu
        busy={busy}
        libraryId={library?.libraryId}
        pluginBrowseScope={pluginBrowseScope}
        pluginViewerState={pluginViewerState}
        pluginApi={(window as RendererWindow).keel?.plugins}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
        assets={visibleAssets}
        menuSkipScope={menuSkipScope}
        onCloseWorkspaceTab={(tabId) => void closeWorkspaceTab(tabId)}
        onCloseOtherWorkspaceTabs={(tabId) =>
          void closeOtherWorkspaceTabs(tabId)
        }
        onRevealWorkspaceTabEntity={(entity) => {
          setLeftOpen(true);
          setWorkspaceTabRevealTarget({
            ...entity,
            requestId: ++workspaceTabRevealRequestRef.current,
          });
        }}
        onCopyWorkspaceTabName={(name) => {
          void navigator.clipboard.writeText(name).then(
            () => setNotice(t("tabs.copyNameDone")),
            () => setError(t("tabs.copyNameFailed")),
          );
        }}
        onCreateSubfolder={(folderId) => {
          openInlineFolderCreate(isLibraryRootFolderId(folderId) ? null : folderId);
        }}
        onExpandFolderTree={(folderId) => {
          folderTreeActionsRef.current?.expandSubtree(folderId);
        }}
        onCollapseFolderTree={(folderId) => {
          folderTreeActionsRef.current?.collapseSubtree(folderId);
        }}
        onImportLinkedFolderInto={(folderId) => {
          // Serpent-316493: 导入链接文件夹 under the right-clicked folder (or at
          // the library root when the folder panel's blank area was clicked).
          void importFolderAsLinked(
            isLibraryRootFolderId(folderId) ? null : folderId,
          );
        }}
        onSetIgnore={({ locationKind, linkedFolderId, relativePath, pathKind, ignored, name }) => {
          void setIgnoreState({ locationKind, linkedFolderId, relativePath, pathKind, ignored, name });
        }}
        onRenameFolder={(folderId, currentName) => {
          openInlineFolderRename(folderId, currentName);
        }}
        onOpenFolderInFileManager={(folderId) => {
          void handleOpenFolderInFileManager(folderId);
        }}
        onCopyFolderPath={(folderId) => {
          void handleCopyFolderPath(folderId);
        }}
        onCopyFolder={(folderId) => {
          void handleCopyFolder(folderId);
        }}
        onPasteIntoFolder={(folderId) => {
          // Serpent-316493 follow-up: the root sentinel means "the library
          // root", which paste/import APIs express as null.
          dispatchClipboardPaste(isLibraryRootFolderId(folderId) ? null : folderId);
        }}
        onCloneFolder={(folderId) => {
          void cloneFolder(folderId);
        }}
        onMoveFolder={(folderIds) =>
          setMoveDialog({
            assetIds: [],
            folderIds: [...folderIds],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          })
        }
        onOpenLinkedRules={(folder) => void openLinkedRules(folder)}
        onTrashManagedFolder={(folderId, name) => {
          requestTrashManagedFolder(folderId, name);
        }}
        onDeleteFolderFromDisk={({ folderId, name, locationKind, linkedRelativePath }) => {
          if (locationKind === "managed") {
            openDiskDelete({ kind: "managed", folderId, name });
            return;
          }
          if (linkedRelativePath) {
            openDiskDelete({
              kind: "linked-child",
              folderId: linkedRevealFolderId(folderId, linkedRelativePath),
              linkedFolderId: folderId,
              relativePath: linkedRelativePath,
              name,
            });
          } else {
            openDiskDelete({
              kind: "linked-child",
              folderId,
              linkedFolderId: folderId,
              relativePath: "",
              name,
            });
          }
        }}
        onRemoveLinkedFolder={(folderId, name) => {
          void removeLinkedFolder(folderId, name);
        }}
        onSetEntityAppearance={setEntityAppearance}
        onChooseFolderCover={chooseFolderCover}
        onChooseFolderCoverFromLibrary={openFolderCoverLibraryPicker}
        onClearFolderCover={clearFolderCover}
        onUseAssetAsFolderCover={useAssetAsFolderCover}
        onBatchAssignTag={(tagId, assetIds) => {
          void batchAssignTagToSelection(tagId, assetIds);
        }}
        onBatchRemoveTag={(tagId, assetIds) => {
          void batchRemoveTagFromSelection(tagId, assetIds);
        }}
        onMoveToFolder={(assetIds, folderIds) =>
          setMoveDialog({
            assetIds: [...assetIds],
            folderIds: [...(folderIds ?? [])],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          })
        }
        onTrash={(assetIds, folderIds) => {
          void trashMixedSelection(assetIds, folderIds ?? []);
        }}
        onDeleteFromDisk={(assetIds, folderIds) => {
          requestSelectionDiskDelete(assetIds, folderIds ?? []);
        }}
        onRestore={(assetIds) => {
          void requestRestoreTrashedAssets(assetIds);
        }}
        onPermanentDelete={(assetIds) => {
          void deletePermanentFromTrash(assetIds);
        }}
        onRelink={(assetId) => { void relinkMissingAsset(assetId); }}
        onAnalyze={(assetId, batchIds) => {
          void handleAnalyzeClick(assetId, batchIds);
        }}
        onClearAiContent={(assetIds) => { void handleClearAiContent(assetIds); }}
        canAnalyze={
          aiAnalyzeConnectionReady(aiHasKey, aiConnectionState) && !aiAnalyzing
        }
        aiDisconnected={aiAnalyzeShowsDisconnectGlyph(
          aiHasKey,
          aiConnectionState,
        )}
        onCopyToLinked={(folder, assetIds) => { void copyManagedSelectionToLinked(folder, assetIds); }}
        onClearSelection={clearAssetSelection}
        onOpenExternal={(assetId) => { void handleOpenExternal(assetId); }}
        openWithPrograms={openWithSettings.programs}
        onOpenWithProgram={(assetId, programId) => { void openAssetWithProgram(assetId, programId); }}
        onOpenWithPicker={(assetId) => { void openAssetWithProgram(assetId); }}
        onViewAsset={(assetId) => {
          const asset = visibleAssets.find((item) => item.assetId === assetId);
          if (asset) openAssetPreview(asset);
        }}
        onSetAssetColorSpace={(assetId, colorSpace) => {
          void persistAssetColorSpace(assetId, colorSpace);
        }}
        onCreateImageSequence={(assetIds) => {
          void openCreateImageSequenceDialog(assetIds);
        }}
        onSetImageSequenceFps={(sequenceId, frameCount, fps) => {
          setImageSequenceDialog({
            assetIds: [],
            mode: "update",
            sequenceId,
            frameCount,
            fps,
            submitting: false,
            error: null,
          });
        }}
        onDissolveImageSequence={(sequenceId) => {
          void dissolveSelectedImageSequence(sequenceId);
        }}
        onDissolveImageSequences={(sequenceIds) => {
          void dissolveSelectedImageSequences(sequenceIds);
        }}
        onRevealInFolder={(assetId) => { void handleRevealInFolder(assetId); }}
        onShowInLibraryFolder={(assetId) => {
          void showAssetInContainingFolder(assetId);
        }}
        semanticSearchEnabled={embeddingBound}
        embeddingSelectionId={embeddingSelectionId}
        embeddingAdapter={embeddingService?.adapter ?? null}
        embeddingModalities={embeddingService?.modalities ?? null}
        onFindSimilar={(assetId) => {
          void runFindSimilar(assetId);
        }}
        onCopyFilePath={(assetId) => { void handleCopyFilePath(assetId); }}
        onCopyAssetFiles={(assetIds) => {
          void handleCopyAssetFiles(assetIds);
        }}
        pasteTargetFolderId={browsePasteDestination}
        onRenameAssetFile={(assetId) => { openAssetRename(assetId); }}
        onAssignTag={(assetId, tagId) => { void assignAssetToTag(assetId, tagId); }}
        trashedFolderCount={trashedFolders.length}
        onRestoreTrashedFolder={(tombstoneId, name) => {
          void restoreTrashedManagedFolder(tombstoneId, name);
        }}
        onEmptyTrash={() => {
          void emptyTrash();
        }}
      />
      {/* REQ-SHELL-007 / REQ-SHELL-011 pane resize + edge restore handles. */}
      {leftOpen ? (
        <div
          aria-label={t("shell.resizeNav")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeNav")}
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("nav");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ left: navPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreNavEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreNavEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ left: 0 }}
        />
      )}
      {rightOpen ? (
        <div
          aria-label={t("shell.resizeInspector")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeInspector")}
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("inspector");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ right: inspectorPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreInspectorEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreInspectorEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ right: 0 }}
        />
      )}
    </main>
    <LocalConfirmationHost blocked={criticalConfirmation.request !== null} scopeKey={library?.libraryId} />
    </>
  );
}

export function App() {
  return (
    <ContextMenuProvider>
      <AppInner />
    </ContextMenuProvider>
  );
}
