import type { Dispatch, DragEvent, FormEvent, JSX, MouseEvent, MutableRefObject, RefObject, SetStateAction, TransitionEvent } from "react";
import type { KeelPluginManagerApi } from "../../shared/plugin-manager-api";
import type { LibraryLoadingState, UiState } from "../stores/session-store";
import type { EmbeddingHttpServiceSummary, KeelLibraryApi, LibraryApiResult, PreviewResolution } from "../../shared/library-api";
import type { DialogKind } from "../stores/dialogs-store";
import type { LibraryTransferKind } from "../library-transfer-progress";
import type { SequencePreviewSource } from "../image-sequence-preview";
import type { ImageSequenceConfirmPurpose } from "../image-sequence-import-dialog";
import type { PostImportSequencePlan } from "../post-import-image-sequences";
import type { ImportConflictPhase } from "../import-conflict-flow";
import type { RememberedDuplicateDecision, RememberedNameConflictDecision } from "../import-conflict-preferences";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { ResizablePanel } from "../workbench/shell/panel-auto-hide";
import type { BrowseEmptyState, ImportMenuCopy } from "../browse-empty-state";
import type { CreateLibraryPhase } from "../CreateDialog";
import type { MainMenuSection } from "../main-menu-items";
import type { WorkspaceTabsState } from "../workspace-tabs";
import type { WorkspaceTabPresentation } from "../workspace-tab-presentation";
import type { SelectWorkspaceTabOptions } from "../use-workspace-tabs";
import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { KeelShellApi } from "../../shared/external-url";
import type { RendererLibrarySummary } from "../../shared/protocol/responses";
import type { AssetScope } from "../stores/navigation-store";
import type { AssetSummary, FolderBrowseEntry, LinkedFolderRule, LinkedFolderSummary, SearchScope, TagSummary } from "../../shared/asset-types";
import type { DragDropMode } from "../asset-drag-drop";
import type { EntityAppearance, EntityAppearanceTarget } from "../../shared/entity-appearance";
import type { PluginIframeViewDescriptor } from "../plugin-iframe-view-host";
import type { FilteredFolderCounts } from "../use-filtered-folder-counts";
import type { FolderTreeExpandActions } from "../NavigationSidebar";
import type { InlineFolderEditState } from "../inline-folder-edit";
import type { AppLocale } from "../i18n/types";
import type { ScopeBreadcrumbSegment } from "../ScopeBreadcrumbs";
import type { CanvasPreferences } from "../canvas-preferences";
import type { ClearableFilterId } from "../active-discovery-filters";
import type { ToastStackMessage } from "../toast-notifications";
import type { BrowseCanvasBodyLayout } from "../folder-browse-canvas";
import type { AssetRenameDialogState } from "../useAssetRename";
import type { VirtualBrowseLayout } from "../browse/virtual-browse-layout";
import type { UseBrowsePaginationResult } from "../use-browse-pagination";
import type { AssetPreviewModalHandle } from "../AssetPreviewModal";
import type { ViewerChromePreferences } from "../viewer-chrome-preferences";
import type { ViewerChromeActivitySource } from "../viewer-chrome-idle";
import type { InspectorMultiEditModel } from "../inspector-multi-edit";
import type { TrashRestoreRequest } from "../trash-restore-flow";
import type { AiAnalysisSettingsWire } from "../../shared/ai-analysis-settings";
import type { AiUiPreferences } from "../ai-ui-preferences";
import type { ImageSequencePreferences } from "../image-sequence-preferences";
import type { ConnectionFailureGateState } from "../ai-connection-failure";
import type { CriticalConfirmationDecision, CriticalConfirmationPrompt } from "../../shared/critical-confirmation";
import type { MenuSkipScopeOptions } from "../menu-skip-report";
import type { FolderDiskDeleteTarget } from "../use-folder-delete-actions";
import type { BrowsePasteDestination } from "../browse-paste-target";
import { type SortDefinition } from "../../shared/asset-types";
import { LIBRARY_ROOT_FOLDER_ID } from "../../shared/library-root-folder";
import { setAssetDragPreviewCopyMode } from "../asset-drag-preview";
import { AutomaticTasksSidebar } from "../AutomaticTasksSidebar";
import { BlockingProgressOverlay } from "../BlockingProgressOverlay";
import { ContentDuplicateDialog } from "../ContentDuplicateDialog";
import { DeleteProgressOverlay } from "../DeleteProgressOverlay";
import { toggleFolderMultiSelection } from "../folder-selection-toggle";
import { formatBytes } from "../format-file-meta";
import { Icon } from "../Icons";
import { ImageSequenceImportDialog } from "../ImageSequenceImportDialog";
import { ImportProgressOverlay } from "../ImportProgressOverlay";
import { ImportSourceFailureDialog } from "../ImportSourceFailureDialog";
import { InspectorPanel, InspectorPanelActionsProvider } from "../InspectorPanel";
import { LibraryLoadingOverlay } from "../LibraryLoadingOverlay";
import { LocalConfirmationHost } from "../local-confirmation";
import { NameConflictDialog } from "../NameConflictDialog";
import { NavigationSidebar, NavigationSidebarActionsProvider } from "../NavigationSidebar";
import { PluginUiDialogHost } from "../plugin-ui-dialog-host";
import { TagTreeSidebar } from "../TagTreeSidebar";
import { EditTextContextMenuHost } from "../workbench/menu/edit-text-context-menu";
import { HoverTipHost } from "../workbench/overlay/hover-tip";
import { type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest } from "./app-shared";
import { AppAssetContextMenu } from "./AppAssetContextMenu";
import { AppDialogs } from "./AppDialogs";
import { AppToolbar } from "./AppToolbar";
import { AssetPreviewHost } from "./AssetPreviewHost";
import { BrowseCanvas } from "./BrowseCanvas";
import { PaneResizeHandles } from "./PaneResizeHandles";
import { WorkspaceBanners } from "./WorkspaceBanners";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceNotices } from "./WorkspaceNotices";

export interface AppViewProps {
  setPluginUiDialogOpen: Dispatch<SetStateAction<boolean>>;
  pluginManagerApi: KeelPluginManagerApi | undefined;
  libraryLoading: LibraryLoadingState | null;
  libraryLoadingVisible: boolean;
  blockingImportOverlayVisible: boolean;
  blockingDeleteOverlayVisible: boolean;
  api: KeelLibraryApi | undefined;
  setLibraryLoading: Dispatch<SetStateAction<LibraryLoadingState | null>>;
  setUiState: Dispatch<SetStateAction<UiState>>;
  setDialog: Dispatch<SetStateAction<DialogKind>>;
  setImportLibraryChooserOpen: Dispatch<SetStateAction<boolean>>;
  setOpenLibraryChooserOpen: Dispatch<SetStateAction<boolean>>;
  importInterrupt: "abandon" | "stop" | null;
  cancelImport: (mode?: "abandon" | "stop") => Promise<void>;
  dismissImportOverlay: () => void;
  importProgress: { type: "import.progress"; importId: string; phase: "failed" | "open" | "copy" | "complete" | "cancelled" | "validate" | "extract" | "verify"; filesProcessed: number; totalFiles: number; bytesProcessed: number; totalBytes: number; cancelable?: boolean | undefined; copiesFiles?: boolean | undefined; sequence?: number | undefined; } | null;
  libraryTransferKind: LibraryTransferKind;
  libraryTransferName: string;
  imageSequenceImportError: string | null;
  imageSequenceImportOffer: { defaultFps: number; libraryId: string; sequences: { displayName: string; extension: string; firstFrame: number; frameCount: number; height: number | null; lastFrame: number; numberStyle: "trailing" | "parens"; numericWidth: number; prefix: string; width: number | null; framePaths?: string[] | undefined; }[]; offerId?: string | undefined; selectedPaths?: string[] | undefined; targetFolderId?: string | undefined; } | null;
  imageSequenceImportIndex: number;
  imageSequencePreviewSource: SequencePreviewSource | null;
  imageSequenceConfirmPurpose: ImageSequenceConfirmPurpose;
  postImportSequencePlanRef: RefObject<PostImportSequencePlan | null>;
  setImageSequenceImportOffer: Dispatch<SetStateAction<{ defaultFps: number; libraryId: string; sequences: { displayName: string; extension: string; firstFrame: number; frameCount: number; height: number | null; lastFrame: number; numberStyle: "trailing" | "parens"; numericWidth: number; prefix: string; width: number | null; framePaths?: string[] | undefined; }[]; offerId?: string | undefined; selectedPaths?: string[] | undefined; targetFolderId?: string | undefined; } | null>>;
  setImageSequenceImportError: Dispatch<SetStateAction<string | null>>;
  setImportProgress: Dispatch<SetStateAction<{ type: "import.progress"; importId: string; phase: "failed" | "open" | "copy" | "complete" | "cancelled" | "validate" | "extract" | "verify"; filesProcessed: number; totalFiles: number; bytesProcessed: number; totalBytes: number; cancelable?: boolean | undefined; copiesFiles?: boolean | undefined; sequence?: number | undefined; } | null>>;
  confirmImageSequenceImportOffer: (input: { action: "import-sequence" | "import-selected"; firstFrame: number; fps: number; lastFrame: number; sequenceIndex: number; applyToRest: boolean; }) => Promise<void>;
  imageSequenceImportSubmitting: boolean;
  conflicts: { importId: string; fileCount: number; totalBytes: number; suspectedDuplicateCount: number; libraryDuplicateCount: number; nameConflictCount: number; examples: { displayName: string; kind: "suspected-duplicate" | "library-duplicate" | "name-conflict"; existingDisplayName?: string | undefined; existingAssetId?: string | undefined; existingThumbnailArtifactId?: string | undefined; }[]; } | null;
  conflictPhase: ImportConflictPhase | null;
  library: { libraryId: string; displayName: string; displayPath: string; storageLayout?: "root" | "assets" | undefined; readOnly?: boolean | undefined; networkStorage?: boolean | undefined; libraryVersion?: number | undefined; supportedSchemaVersion?: number | undefined; migrationStuck?: boolean | undefined; metaDirMigration?: "failed" | "both" | undefined; metaDirMigrationReason?: string | undefined; recovery?: { mode: "backup-1" | "backup-2" | "read-only" | "rescue"; reportAvailable?: boolean | undefined; recoveredAssetCount?: number | undefined; metadataRecovered?: boolean | undefined; metadataLosses?: ("collections" | "tags" | "ratings" | "descriptions" | "source-links")[] | undefined; } | undefined; } | null;
  nameDecision: RememberedNameConflictDecision;
  rememberNameConflict: boolean;
  setNameDecision: Dispatch<SetStateAction<RememberedNameConflictDecision>>;
  setRememberNameConflict: Dispatch<SetStateAction<boolean>>;
  abandonConflicts: () => Promise<void>;
  confirmNameConflictDialog: () => void;
  importDecisionSubmitting: boolean;
  duplicateDecision: RememberedDuplicateDecision;
  rememberDuplicate: boolean;
  setDuplicateDecision: Dispatch<SetStateAction<RememberedDuplicateDecision>>;
  setRememberDuplicate: Dispatch<SetStateAction<boolean>>;
  confirmContentDuplicateDialog: () => void;
  importSourceFailurePlan: { importId: string; failedCount: number; remainingCount: number; examples: { displayName: string; reason?: "NOT_A_LIBRARY" | "ZIP_TOO_LARGE" | "TRANSFER_IN_PROGRESS" | "DISK_FULL" | "PERMISSION_DENIED" | "FILE_BUSY" | "PATH_LIMIT_EXCEEDED" | "READ_ONLY_FILESYSTEM" | "SOURCE_NOT_FOUND" | "SOURCE_CHANGED" | "SOURCE_TRASH_FAILED" | "SOURCE_TRASH_RECONCILIATION_REQUIRED" | "SYMBOLIC_LINK_NOT_ALLOWED" | "ROOT_NOT_ALLOWED" | "UNSUPPORTED_FILE_ENTRY" | "MIME_TYPE_MISSING" | "MIME_TYPE_UNSUPPORTED" | "MIME_EXTENSION_MISMATCH" | "MAGIC_BYTES_MISMATCH" | "NAME_NOT_SUPPORTED" | "IO_ERROR" | "SHARP_UNAVAILABLE" | "FFMPEG_REQUIRED" | "OIIO_REQUIRED" | "MEDIA_PROCESSING_FAILED" | "PALETTE_SOURCE_NOT_READY" | "PALETTE_EXTRACTION_FAILED" | "UNSUPPORTED_FORMAT" | "PATH_ESCAPE" | "AI_AUTH" | "AI_PERMISSION" | "AI_QUOTA" | "AI_RATE_LIMIT" | "AI_NETWORK" | "AI_TIMEOUT" | "AI_INVALID_RESPONSE" | "AI_REQUEST_REJECTED" | "AI_NOT_CONFIGURED" | "AI_REFUSED" | "THUMBNAIL_REQUIRED" | "EAGLE_METADATA_UNREADABLE" | "BILLFISH_METADATA_UNREADABLE" | "IMPORT_COPY_FAILED" | "IMPORT_REGISTER_FAILED" | "EAGLE_THUMBNAIL_FAILED" | "LIBRARY_PARENT_MISSING" | "LIBRARY_PARENT_IS_ROOT" | "LIBRARY_PARENT_NOT_DIRECTORY" | "LIBRARY_PARENT_INSIDE_SOURCE" | "SYNC_AUTH_FAILED" | "SYNC_INVALID_URL" | "SYNC_PERMISSION_DENIED" | "SYNC_NOT_FOUND" | "SYNC_TIMEOUT" | "SYNC_TLS" | "SYNC_DNS" | "SYNC_CONNECTION_REFUSED" | "SYNC_NETWORK" | "SYNC_QUOTA_EXCEEDED" | "SYNC_LOCKED" | "SYNC_CONFLICT" | "SYNC_METHOD_NOT_ALLOWED" | "SYNC_WRITE_UNSUPPORTED" | "SYNC_HTTP_ERROR" | "LINKED_FOLDER_NETWORK_DISCONNECTED" | "LINKED_FOLDER_NOT_FOUND" | "LINKED_FOLDER_FOREIGN_DEVICE" | "LINKED_SOURCE_INSIDE_LIBRARY" | "LINKED_SOURCE_ALREADY_LINKED" | "LINKED_SOURCE_INSIDE_LINKED_FOLDER" | "IMAGE_SEQUENCE_SELECTION" | "PERMANENT_DELETE_NEEDS_TRASH" | undefined; }[]; } | null;
  abandonSourceFailure: () => Promise<void>;
  skipImportSourceFailureWith: (input: { applyToRest: boolean; }) => Promise<void>;
  cancelDiskDelete: () => Promise<void>;
  deleteProgress: { type: "delete.progress"; operationId: string; libraryId: string; kind: "trash" | "disk" | "permanent" | "linked-remove"; phase: "failed" | "complete" | "cancelled" | "run"; filesProcessed: number; totalFiles: number; cancelable?: boolean | undefined; } | null;
  exportProgress: { type: "export.progress"; exportId: string; libraryId: string; phase: "failed" | "snapshot-db" | "enumerate" | "copy" | "compress" | "complete" | "cancelled"; filesProcessed: number; totalFiles: number; bytesProcessed: number; totalBytes: number; } | null;
  t: TranslateFn;
  cancelExport: () => Promise<void>;
  shortcutRuntimeVersion: number;
  leftOpen: boolean;
  rightOpen: boolean;
  panelResizing: ResizablePanel | null;
  panelResizeShellStyle: Record<string, string>;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  importMenuCopy: ImportMenuCopy;
  closeLibrary: () => Promise<void>;
  removeLibrary: () => Promise<void>;
  requestDeleteLibraryFromDisk: () => void;
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  importAssets: (kind: "files" | "folder") => Promise<void>;
  importFolderAsLinked: (parentFolderId?: string | null) => Promise<void>;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  openRecentLibrary: (libraryPath: string) => Promise<void>;
  forgetRecentLibrary: (libraryPath: string) => Promise<void>;
  goWorkspaceBack: () => Promise<void>;
  goWorkspaceForward: () => Promise<void>;
  mainMenuSections: MainMenuSection[];
  workspaceTabsState: WorkspaceTabsState;
  workspaceTabPresentations: WorkspaceTabPresentation[];
  addWorkspaceTab: () => Promise<void>;
  closeWorkspaceTab: (tabId: string) => Promise<void>;
  selectWorkspaceTab: (tabId: string, options?: SelectWorkspaceTabOptions) => Promise<void>;
  moveWorkspaceTab: (tabId: string, toIndex: number) => void;
  openContextMenu: (descriptor: ContextMenuDescriptor, position: { x: number; y: number; }) => void;
  runSearch: (event?: FormEvent, opts?: { silent?: boolean; }) => Promise<void>;
  semanticSearchActive: boolean;
  searchHistory: string[];
  searchHistoryDismissedUntilInputRef: RefObject<boolean>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  publishSearchHistory: (queries: string[]) => void;
  embeddingSearchReady: boolean;
  embeddingService: EmbeddingHttpServiceSummary | null;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  shellApi: KeelShellApi | undefined;
  showIgnoredItems: boolean;
  setShowIgnoredItems: Dispatch<SetStateAction<boolean>>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  assetScope: string;
  showTrash: boolean;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  enterTrash: () => Promise<void>;
  enterTagManagement: (navigation?: WorkspaceNavigationRequest) => Promise<void>;
  enterPluginSidebarView: (viewId: string, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  setSelectedFolderIds: Dispatch<SetStateAction<string[]>>;
  handleTargetExternalDragOver: (event: DragEvent<HTMLElement>) => void;
  handleTargetExternalDrop: (event: DragEvent<HTMLElement>, targetFolderId: string | null | undefined) => void;
  getManagedAssetDragIds: () => string[] | null;
  getManagedFolderDragIds: () => string[] | null;
  resolveManagedAssetDrop: (files: File[]) => Promise<string[]>;
  isInternalAssetDrag: () => boolean;
  handleAssetsDroppedOnFolder: (targetFolderId: string | null, assetIds: string[], mode: DragDropMode) => void;
  handleFoldersDroppedOnFolder: (targetFolderId: string | null, draggedFolderIds: readonly string[], options?: { blockingUi?: boolean; }) => void;
  folders: { folderId: string; parentFolderId: string | null; name: string; relativePath: string; directAssetCount: number; childFolderCount: number; createdAt?: string | undefined; appearance?: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null | undefined; }[];
  linkedFolders: { folderId: string; displayName: string; status: "available" | "offline"; assetCount: number; absoluteRootPath: string; relativePath: string; linkedFolderId?: string | undefined; parentFolderId?: string | null | undefined; createdAt?: string | undefined; appearance?: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null | undefined; }[];
  handleAssetsDroppedOnTrash: (assetIds: string[]) => void;
  handleFoldersDroppedOnTrash: (draggedFolderIds: readonly string[]) => void;
  dragPreviewRef: RefObject<HTMLElement | null>;
  beginLinkedFolderHintHover: () => void;
  endLinkedFolderHintHover: () => void;
  relinkFolder: (folderId: string) => Promise<void>;
  linkedFolderAddHintEligible: boolean;
  setLinkedFolderHintActive: Dispatch<SetStateAction<boolean>>;
  linkedFolderHintStopTimerRef: RefObject<NodeJS.Timeout | null>;
  openInlineFolderCreate: (parentFolderId: string | null) => void;
  changeInlineFolderEdit: (value: string) => void;
  commitInlineFolderEdit: (onCreateSuccess?: (folderId: string, parentFolderId: string | null) => void) => Promise<void>;
  cancelInlineFolderEdit: () => void;
  importDroppedFiles: (files: File[], targetFolderId?: string | null | undefined, webPayload?: { html: string; uriList: string; }) => Promise<void>;
  copyManagedSelectionToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => Promise<void>;
  tags: { tagId: string; name: string; assetCount: number; appearance?: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null | undefined; parentTagId?: string | null | undefined; subtreeAssetCount?: number | undefined; }[];
  activeTagId: string | null;
  pinnedTagId: string | null;
  togglePinnedTag: (tagId: string) => Promise<void>;
  chooseTag: (tagId: string, navigation?: WorkspaceNavigationRequest, tagCatalog?: readonly TagSummary[]) => Promise<void>;
  handleCreateTagInManagement: (name: string, parentTagId?: string | null) => Promise<boolean>;
  handleRenameTagInManagement: (tagId: string, name: string, appearance?: EntityAppearance | null) => Promise<boolean>;
  moveTagInTree: (tagId: string, parentTagId: string | null) => Promise<boolean>;
  handleDeleteTagsInManagement: (tagIds: string[]) => Promise<boolean>;
  assignAssetsToTreeTag: (assetIds: string[], tagId: string) => Promise<void>;
  backgroundJobsActive: boolean;
  setAutomaticTaskEditorId: Dispatch<SetStateAction<string | null | undefined>>;
  setAutomaticTasksOpen: Dispatch<SetStateAction<boolean>>;
  openMediaJobs: () => void;
  setScriptSandboxPreviewOpen: Dispatch<SetStateAction<boolean>>;
  pluginSidebarViews: PluginIframeViewDescriptor[];
  workspaceTabRevealTarget: { kind: "folder"; id: string; requestId: number; } | null;
  filteredFolderCounts: FilteredFolderCounts | null;
  folderTreeActionsRef: RefObject<FolderTreeExpandActions | null>;
  linkedFolderHintShow: boolean;
  inlineFolderEdit: InlineFolderEditState | null;
  showPluginSidebarView: boolean;
  recursiveHintActive: boolean;
  includeSubfoldersHoverTimerRef: RefObject<NodeJS.Timeout | null>;
  recursiveHintKey: string | null;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  setError: (text: string | null) => void;
  locale: AppLocale;
  workspaceTitle: () => string;
  enterTrashAt: (tombstoneId: string | null, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  scopeBreadcrumbSegments: ScopeBreadcrumbSegment[];
  workspaceBrowseCount: number;
  emptyTrash: () => Promise<void>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  startBatchRelink: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  setCanvasPrefs: (action: SetStateAction<CanvasPreferences>) => void;
  canvasPrefs: CanvasPreferences;
  assetCardSize: number;
  cardSizeStops: number[];
  resizeAssetCards: (requestedSize: number, clientX?: number, clientY?: number) => void;
  pluginContributionRefreshKey: string;
  selectedVisibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  pluginSurfaceContext: { contextId: string; revision: number; app: { platform: string; locale: string; theme: "system" | "light" | "dark"; busy: boolean; }; surface: { id: string; kind: string; }; window: { windowId: string; }; library: { open: boolean; writable: boolean; offline: boolean; id?: string | undefined; }; selection: { count: number; assetCount: number; folderCount: number; mixed: boolean; extensions: string[]; mimeTypes: string[]; mediaKinds: string[]; summary: { managedCount: number; unmanagedCount: number; availableCount: number; unavailableCount: number; deletedCount: number; hasDeleted: boolean; hasUnavailable: boolean; }; hasDeleted: boolean; hasUnavailable: boolean; ref?: string | undefined; primaryId?: string | undefined; }; browse: { folderId?: string | undefined; tagId?: string | undefined; search?: string | undefined; filter?: string | undefined; }; viewer: { active: boolean; fullscreen: boolean; assetId?: string | undefined; extension?: string | undefined; mimeType?: string | undefined; mediaKind?: string | undefined; }; };
  dialogFocusTrapActive: boolean;
  clearDiscoveryFilter: (id: ClearableFilterId) => void;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
  controlAiJobs: (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>;
  pluginJobActivity: { jobId: string; libraryId: string; kind: "plugin.background"; status: "failed" | "cancelled" | "queued" | "running" | "paused" | "succeeded" | "interrupted"; progress: number; attemptCount: number; errorCode: string | null; errorDetail: string | null; ownerPluginId: string; ownerPackageHash: string; pluginHandlerId: string; payload: Record<string, unknown>; recoveryStrategy: "idempotent" | "checkpoint"; createdAt: string; updatedAt: string; ownerPluginInstanceId?: string | undefined; ownerScope?: "library" | "global" | undefined; ownerLibraryId?: string | null | undefined; executionAvailability?: "ready" | "blocked" | undefined; completed?: number | undefined; total?: number | undefined; phase?: string | undefined; message?: string | undefined; itemResults?: { itemId: string; status: "failed" | "cancelled" | "succeeded" | "skipped"; assetId?: string | undefined; errorCode?: string | undefined; errorDetail?: string | undefined; retryInput?: Record<string, unknown> | undefined; }[] | undefined; failedAssetIds?: string[] | undefined; retryInput?: Record<string, unknown> | undefined; checkpoint?: { version: string; data: Record<string, unknown>; savedAt: string; cursor?: string | undefined; } | undefined; cancellation?: { requested: boolean; reason?: string | undefined; } | undefined; } | null;
  hidePluginJobActivity: (jobId: string) => void;
  pluginJobQueuedMore: number;
  workspaceNavigationPending: boolean;
  workerRecoveryState: "failed" | "ready" | "recovering";
  previewAsset: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null;
  previewRestoring: boolean;
  previewCanvasReady: boolean;
  renderedToastStack: readonly ToastStackMessage[];
  topVisibleToastId: number | undefined;
  dismissToast: (id: number) => void;
  handleToastTransitionEnd: (event: TransitionEvent) => void;
  undoLastFileOp: (expectedHistoryEntryId?: string) => Promise<void>;
  externalDropActive: boolean;
  handleExternalDragEnter: (event: DragEvent<HTMLElement>) => void;
  handleExternalDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleExternalDragOver: (event: DragEvent<HTMLElement>) => void;
  handleExternalDrop: (event: DragEvent<HTMLElement>) => void;
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  marqueeBoxRef: RefObject<HTMLDivElement | null>;
  activePluginSidebarView: PluginIframeViewDescriptor | undefined;
  handleMergeTagsInManagement: (tagIds: string[], name: string) => Promise<boolean>;
  handleSearchTagsFromManagement: (tagNames: string[], match: "all" | "any") => Promise<void>;
  browseCanvasBodyLayout: BrowseCanvasBodyLayout;
  folderCardRowElement: JSX.Element | null;
  assetViewMode: "grid" | "masonry";
  assetGridRef: RefObject<HTMLDivElement | null>;
  panelReflowFrozenWidthRef: RefObject<number | null>;
  sourceBadgeContext: { assetScope: string; mixedFolderBrowse: boolean; };
  selectedFolderId: string | undefined;
  syncCardStatuses: ReadonlyMap<string, "pending" | "syncing" | "conflict">;
  assetRenameDialog: AssetRenameDialogState | null;
  selectedIdSet: Set<string>;
  nativeAssetDragEnabled: boolean;
  selectedNativeDragReady: boolean;
  nativeDragReadyIds: ReadonlySet<string>;
  cardMouseDownRef: MutableRefObject<number>;
  setHoveredAssetId: (assetId: string | null) => void;
  clearHoveredAssetId: (assetId: string) => void;
  handleCardClick: (assetId: string, event: React.MouseEvent) => void;
  selectionAssetIds: string[] | undefined;
  openAssetByDefault: (asset: AssetSummary) => void;
  managedAssetDragIdsRef: RefObject<readonly string[] | null>;
  beginInternalAssetDrag: () => void;
  hoveredAssetId: string | null;
  viewerVolumeMuted: boolean;
  viewerVolume: number;
  activePreviewAssetId: string | null;
  activeResolution: PreviewResolution | null;
  retryLiveVideoProxyFallback: (assetId: string) => void;
  submitAssetRename: () => Promise<void>;
  changeAssetRenameValue: (value: string) => void;
  cancelAssetRename: () => void;
  assetRenderSections: { key: string; label: string | null; assets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[]; }[];
  visibleBrowseLayout: { assetId: string; width: number | null; height: number | null; previewArtifactId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; displayName?: string | undefined; relativeFilePath?: string | undefined; byteSize?: number | undefined; modifiedAt?: string | undefined; rating?: number | undefined; mediaType?: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other" | undefined; }[];
  visibleVirtualBrowseLayout: VirtualBrowseLayout | null;
  browsePagination: UseBrowsePaginationResult;
  browseEmptyState: BrowseEmptyState;
  pasteClipboardImage: (options?: { targetFolderId?: string; onNoClipboardImage?: () => void | Promise<void>; }) => Promise<void>;
  previewModalRef: RefObject<AssetPreviewModalHandle | null>;
  bakeImageRotation: boolean;
  viewerChromeIdle: boolean;
  viewerChromePrefs: ViewerChromePreferences;
  setViewerChromePrefs: (action: SetStateAction<ViewerChromePreferences>) => void;
  requestSelectionDiskDelete: (assetIds: string[], folderIds: readonly string[]) => void;
  deletePermanentFromTrash: (assetIds: string[]) => Promise<boolean>;
  advanceOpenViewer: (removedId: string) => void;
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  onViewerChromeActivity: (source: ViewerChromeActivitySource) => void;
  persistAssetColorSpace: (assetId: string, colorSpace: string | null) => Promise<void>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  previewIndex: number;
  navigateAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  handleFavoriteToggle: () => void;
  handleMetadataDescriptionInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  handleMetadataDescriptionSave: () => void;
  handleRatingClick: (rating: number) => void;
  handleSourceUrlInput: (event: FormEvent<HTMLInputElement>) => void;
  handleSourceUrlSave: () => void;
  handleAuthorInput: (event: FormEvent<HTMLInputElement>) => void;
  handleAuthorSave: () => void;
  loadMetadata: () => Promise<void>;
  handleInspectorAssignTag: (tagId: string) => Promise<void>;
  handleInspectorCreateAndAssignTag: (tagName: string) => Promise<void>;
  handleInspectorApplyTagNames: (tagNames: string[]) => Promise<void>;
  handleOpenSourceUrl: () => void;
  handleInspectorRemoveTag: (tagId: string) => Promise<void>;
  aiContent: { assetId: string; description?: string; tags?: string[]; rating?: number; modelVersion?: string; } | null;
  selectedAsset: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | undefined;
  automaticPaletteRatios: Map<string, number>;
  displayedPalette: string[];
  folderInspector: { entries: FolderBrowseEntry[]; byteSize: number | null; } | null;
  folderInspectorAppearance: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null;
  selectedAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  multiEdit: InspectorMultiEditModel | null;
  updateImageSequenceFps: () => Promise<void>;
  createSelectedImageSequence: () => Promise<void>;
  linkedRulesEditor: { folderId: string; name: string; rules: LinkedFolderRule[]; } | null;
  setLinkedRulesEditor: Dispatch<SetStateAction<{ folderId: string; name: string; rules: LinkedFolderRule[]; } | null>>;
  saveLinkedRules: (finalRules: LinkedFolderRule[]) => Promise<void>;
  convertLinkedToManaged: () => Promise<void>;
  restoreTrashedAssets: (payload?: TrashRestoreRequest) => Promise<void>;
  moveManagedAssets: () => Promise<void>;
  folderCoverPicker: { folderIds: string[]; assetId: string; } | null;
  loadFolderCoverPickerPage: (query: string, offset: number) => Promise<{ items: { assetId: string; displayName: string; relativeFilePath: string; thumbnailArtifactId: string | null; previewRevisionId: string; }[]; total: number; }>;
  setFolderCoverPicker: Dispatch<SetStateAction<{ folderIds: string[]; assetId: string; } | null>>;
  applyFolderCoverFromLibrary: (assetId: string) => void;
  beginNewAiProfile: () => void;
  selectAiProfile: (id: string) => void;
  activateAiProfile: (id: string) => Promise<void>;
  removeAiProfile: (id: string) => Promise<void>;
  clearAiProfileCredential: () => Promise<void>;
  commitAiConcurrencyLimit: (value: number) => void;
  commitAiMaxAnalysisImageEdgePx: (value: number) => void;
  commitAiAnalysisSettingsPatch: (patch: Partial<AiAnalysisSettingsWire>) => void;
  probeStoredAiConnection: () => Promise<void>;
  saveAiConfig: () => Promise<void>;
  testAiConnectionFromDialog: () => Promise<{ success: boolean; reason?: string; }>;
  fetchAiModelsFromDialog: () => Promise<{ models: string[]; reason?: string; }>;
  aiUiPrefs: AiUiPreferences;
  imageSequencePrefs: ImageSequencePreferences;
  showMissingLinkedPublishRef: RefObject<Promise<void>>;
  audioPreviewPrefersCover: boolean;
  applyAudioPreviewPreference: (preferCover: boolean) => void;
  applyBakeImageRotation: (bakeIntoFile: boolean) => void;
  setAiUiPrefs: (action: SetStateAction<AiUiPreferences>) => void;
  setImageSequencePrefs: (action: SetStateAction<ImageSequencePreferences>) => void;
  openAppLog: (automationCorrelationId?: string) => void;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  syncRunStartedAtRef: RefObject<number | null>;
  embeddingBound: boolean;
  runLibraryOpenPipeline: (busyState: "creating" | "opening", action: () => Promise<LibraryApiResult<RendererLibrarySummary>>, failureMessage: string, inlineOpeningOperation?: "open-eagle" | "open-billfish", loadingName?: string | null, openOptions?: { selectedLibraryPath?: string | null; skipSwitchConfirm?: boolean; }) => Promise<void>;
  appLogErrorCode: "unauthorized_sender" | "malformed_request" | "log_missing" | "read_failure" | null;
  refreshAppLog: (automationCorrelationId?: string) => Promise<void>;
  revealAppLog: () => void;
  revealRecoveryReport: () => Promise<void>;
  automaticTaskEditorId: string | null | undefined;
  refreshAfterAutomationScript: () => Promise<void>;
  createLibraryPhase: CreateLibraryPhase;
  dialogValue: string;
  cancelEagleInspectFlow: () => void;
  cancelBillfishInspectFlow: () => void;
  submitEagleLibraryName: () => Promise<void>;
  submitBillfishLibraryName: () => Promise<void>;
  runLibraryOperation: (kind: "create" | "open") => Promise<void>;
  exportLibrary: (format: "folder" | "zip", includeLinkedContent: boolean) => Promise<void>;
  openEagleLibrary: () => Promise<void>;
  openBillfishLibrary: () => Promise<void>;
  startImport: () => Promise<void>;
  startImportZip: () => Promise<void>;
  importEagleLibrary: () => Promise<void>;
  importBillfishLibrary: () => Promise<void>;
  completeImportCopy: () => Promise<void>;
  completeImportInPlace: () => Promise<void>;
  applyBatchRelink: () => Promise<void>;
  cancelBatchRelink: () => Promise<void>;
  aiConnectionFailureGate: ConnectionFailureGateState;
  onAiConnectionFailureAbort: () => void;
  handleAiConnectionFailureRetry: () => Promise<void>;
  fatalAlertMessage: string | null;
  dismissAlreadyOpenPrompt: () => void;
  confirmAlreadyOpenLibrarySwitch: () => void;
  dismissFatalAlert: () => void;
  openLibraryChooserFromError: () => void;
  criticalConfirmation: { request: CriticalConfirmationPrompt | null; decide: (decision: CriticalConfirmationDecision) => void; };
  embeddingSelectionId: string | null;
  controlMediaJobs: (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>;
  loadMoreMediaJobs: () => Promise<void>;
  pluginBrowseScope: Partial<{ folderId?: string | undefined; tagId?: string | undefined; search?: string | undefined; filter?: string | undefined; }>;
  pluginViewerState: Partial<{ active: boolean; fullscreen: boolean; assetId?: string | undefined; extension?: string | undefined; mimeType?: string | undefined; mediaKind?: string | undefined; }>;
  menuSkipScope: MenuSkipScopeOptions;
  closeOtherWorkspaceTabs: (tabId: string) => Promise<void>;
  setWorkspaceTabRevealTarget: Dispatch<SetStateAction<{ kind: "folder"; id: string; requestId: number; } | null>>;
  workspaceTabRevealRequestRef: RefObject<number>;
  setIgnoreState: (input: { locationKind: "managed" | "linked"; linkedFolderId?: string | null; relativePath: string; pathKind: "asset" | "folder" | "extension"; ignored: boolean; name: string; }) => Promise<void>;
  openInlineFolderRename: (folderId: string, currentName: string) => void;
  handleOpenFolderInFileManager: (folderId: string) => Promise<void>;
  handleCopyFolderPath: (folderId: string) => Promise<void>;
  handleCopyFolder: (folderId: string) => Promise<void>;
  dispatchClipboardPaste: (destination: string | null) => void;
  cloneFolder: (folderId: string) => Promise<void>;
  openLinkedRules: (folder: LinkedFolderSummary) => Promise<void>;
  requestTrashManagedFolder: (folderId: string, name: string) => void;
  openDiskDelete: (target: FolderDiskDeleteTarget) => void;
  removeLinkedFolder: (folderId: string, name: string) => Promise<void>;
  setEntityAppearance: (target: EntityAppearanceTarget, appearance: EntityAppearance | null) => void;
  chooseFolderCover: (folderIds: readonly string[]) => void;
  openFolderCoverLibraryPicker: (folderIds: readonly string[]) => void;
  clearFolderCover: (folderIds: readonly string[]) => void;
  useAssetAsFolderCover: (assetId: string, folderId: string) => void;
  batchAssignTagToSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  batchRemoveTagFromSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  trashMixedSelection: (assetIds: string[], folderIds?: readonly string[]) => Promise<void>;
  requestRestoreTrashedAssets: (assetIds: string[]) => Promise<void>;
  relinkMissingAsset: (assetId?: string | undefined) => Promise<void>;
  handleAnalyzeClick: (assetId?: string | undefined, batchIds?: readonly string[]) => Promise<void>;
  handleClearAiContent: (assetIds: string[]) => Promise<void>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  handleOpenExternal: (assetId: string) => Promise<void>;
  openWithSettings: { version: 1; programs: { programId: string; name: string; executablePath: string; }[]; defaults: Record<string, { kind: "viewer"; } | { kind: "system"; } | { kind: "program"; programId: string; }>; };
  openAssetWithProgram: (assetId: string, programId?: string) => Promise<void>;
  openAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  openCreateImageSequenceDialog: (assetIds: readonly string[]) => Promise<void>;
  dissolveSelectedImageSequence: (sequenceId: string) => Promise<void>;
  dissolveSelectedImageSequences: (sequenceIds: string[]) => Promise<void>;
  handleRevealInFolder: (assetId: string) => Promise<void>;
  showAssetInContainingFolder: (assetId: string) => Promise<void>;
  runFindSimilar: (assetId: string, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  handleCopyFilePath: (assetId: string) => Promise<void>;
  handleCopyAssetFiles: (assetIds: string[]) => Promise<void>;
  browsePasteDestination: BrowsePasteDestination;
  openAssetRename: (assetId: string) => void;
  assignAssetToTag: (assetId: string, tagId: string) => Promise<void>;
  restoreTrashedManagedFolder: (tombstoneId: string, name: string) => Promise<void>;
  capturePanelResizeAnchor: (lock?: boolean) => void;
  resetPanelWidth: (panel: ResizablePanel) => void;
  beginPanelResize: (panel: ResizablePanel, clientX: number) => void;
  navPanelWidth: number;
  beginPanelEdgeRestore: (panel: ResizablePanel, clientX: number) => void;
  inspectorPanelWidth: number;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function AppView({ setPluginUiDialogOpen, pluginManagerApi, libraryLoading, libraryLoadingVisible, blockingImportOverlayVisible, blockingDeleteOverlayVisible, api, setLibraryLoading, setUiState, setDialog, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, importInterrupt, cancelImport, dismissImportOverlay, importProgress, libraryTransferKind, libraryTransferName, imageSequenceImportError, imageSequenceImportOffer, imageSequenceImportIndex, imageSequencePreviewSource, imageSequenceConfirmPurpose, postImportSequencePlanRef, setImageSequenceImportOffer, setImageSequenceImportError, setImportProgress, confirmImageSequenceImportOffer, imageSequenceImportSubmitting, conflicts, conflictPhase, library, nameDecision, rememberNameConflict, setNameDecision, setRememberNameConflict, abandonConflicts, confirmNameConflictDialog, importDecisionSubmitting, duplicateDecision, rememberDuplicate, setDuplicateDecision, setRememberDuplicate, confirmContentDuplicateDialog, importSourceFailurePlan, abandonSourceFailure, skipImportSourceFailureWith, cancelDiskDelete, deleteProgress, exportProgress, t, cancelExport, shortcutRuntimeVersion, leftOpen, rightOpen, panelResizing, panelResizeShellStyle, setLeftOpen, busy, importMenuCopy, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, setDialogValue, setCreateLibraryPhase, importAssets, importFolderAsLinked, refreshRecentLibraries, openRecentLibrary, forgetRecentLibrary, goWorkspaceBack, goWorkspaceForward, mainMenuSections, workspaceTabsState, workspaceTabPresentations, addWorkspaceTab, closeWorkspaceTab, selectWorkspaceTab, moveWorkspaceTab, openContextMenu, runSearch, semanticSearchActive, searchHistory, searchHistoryDismissedUntilInputRef, searchInputRef, publishSearchHistory, embeddingSearchReady, embeddingService, setRightOpen, shellApi, showIgnoredItems, setShowIgnoredItems, loadContent, assetScope, showTrash, currentQueryDefinition, chooseFolder, enterTrash, enterTagManagement, enterPluginSidebarView, setSelectedFolderIds, handleTargetExternalDragOver, handleTargetExternalDrop, getManagedAssetDragIds, getManagedFolderDragIds, resolveManagedAssetDrop, isInternalAssetDrag, handleAssetsDroppedOnFolder, handleFoldersDroppedOnFolder, folders, linkedFolders, handleAssetsDroppedOnTrash, handleFoldersDroppedOnTrash, dragPreviewRef, beginLinkedFolderHintHover, endLinkedFolderHintHover, relinkFolder, linkedFolderAddHintEligible, setLinkedFolderHintActive, linkedFolderHintStopTimerRef, openInlineFolderCreate, changeInlineFolderEdit, commitInlineFolderEdit, cancelInlineFolderEdit, importDroppedFiles, copyManagedSelectionToLinked, tags, activeTagId, pinnedTagId, togglePinnedTag, chooseTag, handleCreateTagInManagement, handleRenameTagInManagement, moveTagInTree, handleDeleteTagsInManagement, assignAssetsToTreeTag, backgroundJobsActive, setAutomaticTaskEditorId, setAutomaticTasksOpen, openMediaJobs, setScriptSandboxPreviewOpen, pluginSidebarViews, workspaceTabRevealTarget, filteredFolderCounts, folderTreeActionsRef, linkedFolderHintShow, inlineFolderEdit, showPluginSidebarView, recursiveHintActive, includeSubfoldersHoverTimerRef, recursiveHintKey, closeAssetPreview, setError, locale, workspaceTitle, enterTrashAt, scopeBreadcrumbSegments, workspaceBrowseCount, emptyTrash, visibleAssets, startBatchRelink, refreshAssets, setCanvasPrefs, canvasPrefs, assetCardSize, cardSizeStops, resizeAssetCards, pluginContributionRefreshKey, selectedVisibleAssets, pluginSurfaceContext, dialogFocusTrapActive, clearDiscoveryFilter, setPinnedTagId, controlAiJobs, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore, workspaceNavigationPending, workerRecoveryState, previewAsset, previewRestoring, previewCanvasReady, renderedToastStack, topVisibleToastId, dismissToast, handleToastTransitionEnd, undoLastFileOp, externalDropActive, handleExternalDragEnter, handleExternalDragLeave, handleExternalDragOver, handleExternalDrop, handleCanvasMouseDown, workspaceCanvasRef, marqueeBoxRef, activePluginSidebarView, handleMergeTagsInManagement, handleSearchTagsFromManagement, browseCanvasBodyLayout, folderCardRowElement, assetViewMode, assetGridRef, panelReflowFrozenWidthRef, sourceBadgeContext, selectedFolderId, syncCardStatuses, assetRenameDialog, selectedIdSet, nativeAssetDragEnabled, selectedNativeDragReady, nativeDragReadyIds, cardMouseDownRef, setHoveredAssetId, clearHoveredAssetId, handleCardClick, selectionAssetIds, openAssetByDefault, managedAssetDragIdsRef, beginInternalAssetDrag, hoveredAssetId, viewerVolumeMuted, viewerVolume, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, submitAssetRename, changeAssetRenameValue, cancelAssetRename, assetRenderSections, visibleBrowseLayout, visibleVirtualBrowseLayout, browsePagination, browseEmptyState, pasteClipboardImage, previewModalRef, bakeImageRotation, viewerChromeIdle, viewerChromePrefs, setViewerChromePrefs, requestSelectionDiskDelete, deletePermanentFromTrash, advanceOpenViewer, trashManagedAssets, onViewerChromeActivity, persistAssetColorSpace, setNotice, previewIndex, navigateAssetPreview, handleFavoriteToggle, handleMetadataDescriptionInput, handleMetadataDescriptionSave, handleRatingClick, handleSourceUrlInput, handleSourceUrlSave, handleAuthorInput, handleAuthorSave, loadMetadata, handleInspectorAssignTag, handleInspectorCreateAndAssignTag, handleInspectorApplyTagNames, handleOpenSourceUrl, handleInspectorRemoveTag, aiContent, selectedAsset, automaticPaletteRatios, displayedPalette, folderInspector, folderInspectorAppearance, selectedAssets, multiEdit, updateImageSequenceFps, createSelectedImageSequence, linkedRulesEditor, setLinkedRulesEditor, saveLinkedRules, convertLinkedToManaged, restoreTrashedAssets, moveManagedAssets, folderCoverPicker, loadFolderCoverPickerPage, setFolderCoverPicker, applyFolderCoverFromLibrary, beginNewAiProfile, selectAiProfile, activateAiProfile, removeAiProfile, clearAiProfileCredential, commitAiConcurrencyLimit, commitAiMaxAnalysisImageEdgePx, commitAiAnalysisSettingsPatch, probeStoredAiConnection, saveAiConfig, testAiConnectionFromDialog, fetchAiModelsFromDialog, aiUiPrefs, imageSequencePrefs, showMissingLinkedPublishRef, audioPreviewPrefersCover, applyAudioPreviewPreference, applyBakeImageRotation, setAiUiPrefs, setImageSequencePrefs, openAppLog, reloadCurrentContent, syncRunStartedAtRef, embeddingBound, runLibraryOpenPipeline, appLogErrorCode, refreshAppLog, revealAppLog, revealRecoveryReport, automaticTaskEditorId, refreshAfterAutomationScript, createLibraryPhase, dialogValue, cancelEagleInspectFlow, cancelBillfishInspectFlow, submitEagleLibraryName, submitBillfishLibraryName, runLibraryOperation, exportLibrary, openEagleLibrary, openBillfishLibrary, startImport, startImportZip, importEagleLibrary, importBillfishLibrary, completeImportCopy, completeImportInPlace, applyBatchRelink, cancelBatchRelink, aiConnectionFailureGate, onAiConnectionFailureAbort, handleAiConnectionFailureRetry, fatalAlertMessage, dismissAlreadyOpenPrompt, confirmAlreadyOpenLibrarySwitch, dismissFatalAlert, openLibraryChooserFromError, criticalConfirmation, embeddingSelectionId, controlMediaJobs, loadMoreMediaJobs, pluginBrowseScope, pluginViewerState, menuSkipScope, closeOtherWorkspaceTabs, setWorkspaceTabRevealTarget, workspaceTabRevealRequestRef, setIgnoreState, openInlineFolderRename, handleOpenFolderInFileManager, handleCopyFolderPath, handleCopyFolder, dispatchClipboardPaste, cloneFolder, openLinkedRules, requestTrashManagedFolder, openDiskDelete, removeLinkedFolder, setEntityAppearance, chooseFolderCover, openFolderCoverLibraryPicker, clearFolderCover, useAssetAsFolderCover, batchAssignTagToSelection, batchRemoveTagFromSelection, trashMixedSelection, requestRestoreTrashedAssets, relinkMissingAsset, handleAnalyzeClick, handleClearAiContent, clearAssetSelection, handleOpenExternal, openWithSettings, openAssetWithProgram, openAssetPreview, openCreateImageSequenceDialog, dissolveSelectedImageSequence, dissolveSelectedImageSequences, handleRevealInFolder, showAssetInContainingFolder, runFindSimilar, handleCopyFilePath, handleCopyAssetFiles, browsePasteDestination, openAssetRename, assignAssetToTag, restoreTrashedManagedFolder, capturePanelResizeAnchor, resetPanelWidth, beginPanelResize, navPanelWidth, beginPanelEdgeRestore, inspectorPanelWidth }: AppViewProps) {
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
      <AppToolbar
        leftOpen={leftOpen}
        t={t}
        setLeftOpen={setLeftOpen}
        busy={busy}
        api={api}
        importMenuCopy={importMenuCopy}
        closeLibrary={closeLibrary}
        removeLibrary={removeLibrary}
        requestDeleteLibraryFromDisk={requestDeleteLibraryFromDisk}
        setDialogValue={setDialogValue}
        setCreateLibraryPhase={setCreateLibraryPhase}
        importAssets={importAssets}
        importFolderAsLinked={importFolderAsLinked}
        refreshRecentLibraries={refreshRecentLibraries}
        openRecentLibrary={openRecentLibrary}
        forgetRecentLibrary={forgetRecentLibrary}
        goWorkspaceBack={goWorkspaceBack}
        goWorkspaceForward={goWorkspaceForward}
        mainMenuSections={mainMenuSections}
        workspaceTabsState={workspaceTabsState}
        workspaceTabPresentations={workspaceTabPresentations}
        addWorkspaceTab={addWorkspaceTab}
        closeWorkspaceTab={closeWorkspaceTab}
        selectWorkspaceTab={selectWorkspaceTab}
        moveWorkspaceTab={moveWorkspaceTab}
        openContextMenu={openContextMenu}
        runSearch={runSearch}
        semanticSearchActive={semanticSearchActive}
        searchHistory={searchHistory}
        searchHistoryDismissedUntilInputRef={searchHistoryDismissedUntilInputRef}
        searchInputRef={searchInputRef}
        publishSearchHistory={publishSearchHistory}
        embeddingSearchReady={embeddingSearchReady}
        embeddingService={embeddingService}
        rightOpen={rightOpen}
        setRightOpen={setRightOpen}
        shellApi={shellApi}
      />
      <NavigationSidebarActionsProvider value={{
        onToggleShowIgnoredItems: () => {
          const next = !showIgnoredItems;
          setShowIgnoredItems(next);
          if (library) {
            void loadContent(library, assetScope, {
              trashMode: showTrash,
              discovery: currentQueryDefinition(),
              showIgnored: next,
            });
          }
        },
        onChooseAllAssets: () => void chooseFolder("all"),
        onEnterTrash: () => void enterTrash(),
        onTrashContextMenu: (event) => {
          openContextMenu(
            { type: "trash" },
            { x: event.clientX, y: event.clientY },
          );
        },
        onEnterTagManagement: () => void enterTagManagement(),
        onChoosePluginSidebarView: (viewId) => void enterPluginSidebarView(viewId),
        onChooseFolder: (folderId) => {
          // 普通点击 = 进入该文件夹：选区回到「只隐式选中当前文件夹」的状态。
          setSelectedFolderIds([]);
          void chooseFolder(folderId);
        },
        onExternalDragOver: handleTargetExternalDragOver,
        onExternalDrop: (event, targetFolderId) =>
          handleTargetExternalDrop(event, targetFolderId),
        getManagedAssetDragIds,
        getManagedFolderDragIds,
        onOpenRootFolderContextMenu: ({ x, y }) =>
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
          ),
        onResolveManagedAssetDrop: resolveManagedAssetDrop,
        isInternalAssetDrag,
        onAssetsDroppedOnFolder: (folderId, assetIds, mode) =>
          handleAssetsDroppedOnFolder(folderId, assetIds, mode),
        onFoldersDroppedOnFolder: handleFoldersDroppedOnFolder,
        onToggleFolderSelection: (folderId) => {
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
        },
        onAssetsDroppedOnTrash: (assetIds) =>
          handleAssetsDroppedOnTrash(assetIds),
        onFoldersDroppedOnTrash: handleFoldersDroppedOnTrash,
        onManagedAssetCopyModeChange: (copyMode) => {
          setAssetDragPreviewCopyMode(dragPreviewRef.current, copyMode);
        },
        onImportFolderAsLinked: () => void importFolderAsLinked(),
        onLinkedFolderHintHover: beginLinkedFolderHintHover,
        onLinkedFolderHintHoverEnd: endLinkedFolderHintHover,
        onRelinkFolder: (folderId) => void relinkFolder(folderId),
        onAddFolder: () => {
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
        },
        onInlineFolderEditChange: changeInlineFolderEdit,
        onInlineFolderEditCommit: (onCreateSuccess) =>
          void commitInlineFolderEdit((folderId, parentFolderId) => {
            onCreateSuccess?.(folderId, parentFolderId);
          }),
        onInlineFolderEditCancel: cancelInlineFolderEdit,
        onOpenContextMenu: openContextMenu,
        onImportDroppedFiles: (files, targetFolderId, webPayload) =>
          void importDroppedFiles(files, targetFolderId, webPayload),
        onCopyManagedToLinked: (folder, assetIds) =>
          void copyManagedSelectionToLinked(folder, assetIds),
      }}>
      <NavigationSidebar
        tagTree={library ? <TagTreeSidebar key={library.libraryId} libraryId={library.libraryId} tags={tags} activeTagId={activeTagId}
          pinnedTagId={pinnedTagId} onPin={(id) => void togglePinnedTag(id)}
          onChoose={(id) => void chooseTag(id)} onCreate={handleCreateTagInManagement} onRename={handleRenameTagInManagement}
          onAppearance={(id, appearance) => handleRenameTagInManagement(id, tags.find((tag) => tag.tagId === id)?.name ?? "", appearance)}
          onMove={moveTagInTree} onDelete={handleDeleteTagsInManagement} onAssign={assignAssetsToTreeTag} getAssetDragIds={getManagedAssetDragIds} isInternalAssetDrag={isInternalAssetDrag} onResolveManagedAssetDrop={resolveManagedAssetDrop} /> : undefined}
        automaticTasks={library && api ? <AutomaticTasksSidebar key={library.libraryId} api={api} libraryId={library.libraryId} systemBusy={backgroundJobsActive} onCreate={()=>{setAutomaticTaskEditorId(null);setAutomaticTasksOpen(true);}} onEdit={id=>{setAutomaticTaskEditorId(id);setAutomaticTasksOpen(true);}} onOpenRuns={openMediaJobs} onOpenScripts={()=>setScriptSandboxPreviewOpen(true)} /> : undefined}
        pluginSidebarViews={pluginSidebarViews}
        revealTarget={workspaceTabRevealTarget}
        filteredFolderCounts={showTrash ? null : filteredFolderCounts}
        folderTreeActionsRef={folderTreeActionsRef}
        linkedFolderHintActive={linkedFolderHintShow}
        inlineFolderEdit={inlineFolderEdit}
      />
      </NavigationSidebarActionsProvider>
      <section className="workspace">
        <WorkspaceHeader
          showPluginSidebarView={showPluginSidebarView}
          recursiveHintActive={recursiveHintActive}
          includeSubfoldersHoverTimerRef={includeSubfoldersHoverTimerRef}
          recursiveHintKey={recursiveHintKey}
          closeAssetPreview={closeAssetPreview}
          currentQueryDefinition={currentQueryDefinition}
          loadContent={loadContent}
          setError={setError}
          t={t}
          locale={locale}
          workspaceTitle={workspaceTitle}
          chooseFolder={chooseFolder}
          enterTrashAt={enterTrashAt}
          scopeBreadcrumbSegments={scopeBreadcrumbSegments}
          workspaceBrowseCount={workspaceBrowseCount}
          busy={busy}
          emptyTrash={emptyTrash}
          visibleAssets={visibleAssets}
          startBatchRelink={startBatchRelink}
          refreshAssets={refreshAssets}
          setCanvasPrefs={setCanvasPrefs}
          canvasPrefs={canvasPrefs}
          assetCardSize={assetCardSize}
          cardSizeStops={cardSizeStops}
          resizeAssetCards={resizeAssetCards}
          pluginContributionRefreshKey={pluginContributionRefreshKey}
          selectedVisibleAssets={selectedVisibleAssets}
          pluginSurfaceContext={pluginSurfaceContext}
          dialogFocusTrapActive={dialogFocusTrapActive}
          clearDiscoveryFilter={clearDiscoveryFilter}
          setPinnedTagId={setPinnedTagId}
        />
        <WorkspaceBanners
          t={t}
          controlAiJobs={controlAiJobs}
          pluginJobActivity={pluginJobActivity}
          hidePluginJobActivity={hidePluginJobActivity}
          pluginJobQueuedMore={pluginJobQueuedMore}
        />
        <div
          aria-busy={workspaceNavigationPending || workerRecoveryState === 'recovering'}
          className={`workspace-canvas-host${previewAsset || previewRestoring ? " is-viewing" : ""}${previewRestoring ? " is-restoring" : ""}${previewRestoring && previewCanvasReady ? " is-restore-visible" : ""}${workspaceNavigationPending ? " is-navigating" : ""}`}
        >
          <WorkspaceNotices
            renderedToastStack={renderedToastStack}
            t={t}
            topVisibleToastId={topVisibleToastId}
            dismissToast={dismissToast}
            handleToastTransitionEnd={handleToastTransitionEnd}
            undoLastFileOp={undoLastFileOp}
            workspaceTabsState={workspaceTabsState}
            goWorkspaceBack={goWorkspaceBack}
          />
        <BrowseCanvas
          externalDropActive={externalDropActive}
          handleExternalDragEnter={handleExternalDragEnter}
          handleExternalDragLeave={handleExternalDragLeave}
          handleExternalDragOver={handleExternalDragOver}
          handleExternalDrop={handleExternalDrop}
          handleCanvasMouseDown={handleCanvasMouseDown}
          showPluginSidebarView={showPluginSidebarView}
          openContextMenu={openContextMenu}
          workspaceCanvasRef={workspaceCanvasRef}
          marqueeBoxRef={marqueeBoxRef}
          activePluginSidebarView={activePluginSidebarView}
          busy={busy}
          handleCreateTagInManagement={handleCreateTagInManagement}
          handleDeleteTagsInManagement={handleDeleteTagsInManagement}
          handleMergeTagsInManagement={handleMergeTagsInManagement}
          chooseTag={chooseTag}
          handleRenameTagInManagement={handleRenameTagInManagement}
          handleSearchTagsFromManagement={handleSearchTagsFromManagement}
          browseCanvasBodyLayout={browseCanvasBodyLayout}
          folderCardRowElement={folderCardRowElement}
          assetViewMode={assetViewMode}
          assetGridRef={assetGridRef}
          assetCardSize={assetCardSize}
          panelResizing={panelResizing}
          panelReflowFrozenWidthRef={panelReflowFrozenWidthRef}
          canvasPrefs={canvasPrefs}
          sourceBadgeContext={sourceBadgeContext}
          selectedFolderId={selectedFolderId}
          locale={locale}
          syncCardStatuses={syncCardStatuses}
          assetRenameDialog={assetRenameDialog}
          selectedIdSet={selectedIdSet}
          nativeAssetDragEnabled={nativeAssetDragEnabled}
          selectedNativeDragReady={selectedNativeDragReady}
          nativeDragReadyIds={nativeDragReadyIds}
          cardMouseDownRef={cardMouseDownRef}
          api={api}
          setHoveredAssetId={setHoveredAssetId}
          clearHoveredAssetId={clearHoveredAssetId}
          handleCardClick={handleCardClick}
          selectionAssetIds={selectionAssetIds}
          openAssetByDefault={openAssetByDefault}
          managedAssetDragIdsRef={managedAssetDragIdsRef}
          dragPreviewRef={dragPreviewRef}
          beginInternalAssetDrag={beginInternalAssetDrag}
          assignAssetsToTreeTag={assignAssetsToTreeTag}
          hoveredAssetId={hoveredAssetId}
          viewerVolumeMuted={viewerVolumeMuted}
          viewerVolume={viewerVolume}
          activePreviewAssetId={activePreviewAssetId}
          activeResolution={activeResolution}
          retryLiveVideoProxyFallback={retryLiveVideoProxyFallback}
          t={t}
          submitAssetRename={submitAssetRename}
          changeAssetRenameValue={changeAssetRenameValue}
          cancelAssetRename={cancelAssetRename}
          assetRenderSections={assetRenderSections}
          visibleBrowseLayout={visibleBrowseLayout}
          visibleVirtualBrowseLayout={visibleVirtualBrowseLayout}
          browsePagination={browsePagination}
          browseEmptyState={browseEmptyState}
          importAssets={importAssets}
          pasteClipboardImage={pasteClipboardImage}
        />
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
        <AssetPreviewHost
          api={api}
          previewModalRef={previewModalRef}
          bakeImageRotation={bakeImageRotation}
          viewerChromeIdle={viewerChromeIdle}
          viewerChromePrefs={viewerChromePrefs}
          setViewerChromePrefs={setViewerChromePrefs}
          requestSelectionDiskDelete={requestSelectionDiskDelete}
          deletePermanentFromTrash={deletePermanentFromTrash}
          advanceOpenViewer={advanceOpenViewer}
          trashManagedAssets={trashManagedAssets}
          onViewerChromeActivity={onViewerChromeActivity}
          persistAssetColorSpace={persistAssetColorSpace}
          closeAssetPreview={closeAssetPreview}
          setNotice={setNotice}
          previewIndex={previewIndex}
          visibleAssets={visibleAssets}
          navigateAssetPreview={navigateAssetPreview}
          pluginContributionRefreshKey={pluginContributionRefreshKey}
        />
      </section>
      <InspectorPanelActionsProvider value={{
        handleFavoriteToggle,
        handleMetadataDescriptionInput,
        handleMetadataDescriptionSave,
        handleRatingClick,
        handleSourceUrlInput,
        handleSourceUrlSave,
        handleAuthorInput,
        handleAuthorSave,
        loadMetadata,
        onAssignTagToAsset: (tagId) => void handleInspectorAssignTag(tagId),
        onCreateAndAssignTag: (tagName) => void handleInspectorCreateAndAssignTag(tagName),
        onApplyTagNames: (tagNames) => void handleInspectorApplyTagNames(tagNames),
        onOpenSourceUrl: handleOpenSourceUrl,
        onPaletteColorCopy: (color, copied) => {
          if (copied) {
            setNotice(t("toast.colorCopiedAlt", { color }));
          } else {
            setError(t("toast.colorCopyUnavailable"));
          }
        },
        onRemoveTagFromAsset: handleInspectorRemoveTag,
        onFilterTag: (tagId) => void chooseTag(tagId),
        onRenameTag: handleRenameTagInManagement,
      }}>
      <InspectorPanel
        aiContent={
          aiContent?.assetId === selectedAsset?.assetId ? aiContent : null
        }
        api={api}
        automaticPaletteRatios={automaticPaletteRatios}
        displayedPalette={displayedPalette}
        folderInspector={folderInspector ? {
          entries: folderInspector.entries,
          appearance: folderInspectorAppearance,
          byteSize: folderInspector.byteSize,
        } : null}
        selectedAsset={selectedAsset}
        selectedAssets={selectedAssets}
        multiEdit={multiEdit}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
      />
      </InspectorPanelActionsProvider>
      <AppDialogs
        updateImageSequenceFps={updateImageSequenceFps}
        createSelectedImageSequence={createSelectedImageSequence}
        linkedRulesEditor={linkedRulesEditor}
        setLinkedRulesEditor={setLinkedRulesEditor}
        saveLinkedRules={saveLinkedRules}
        convertLinkedToManaged={convertLinkedToManaged}
        restoreTrashedAssets={restoreTrashedAssets}
        moveManagedAssets={moveManagedAssets}
        folderCoverPicker={folderCoverPicker}
        loadFolderCoverPickerPage={loadFolderCoverPickerPage}
        setFolderCoverPicker={setFolderCoverPicker}
        applyFolderCoverFromLibrary={applyFolderCoverFromLibrary}
        beginNewAiProfile={beginNewAiProfile}
        selectAiProfile={selectAiProfile}
        activateAiProfile={activateAiProfile}
        removeAiProfile={removeAiProfile}
        clearAiProfileCredential={clearAiProfileCredential}
        commitAiConcurrencyLimit={commitAiConcurrencyLimit}
        commitAiMaxAnalysisImageEdgePx={commitAiMaxAnalysisImageEdgePx}
        commitAiAnalysisSettingsPatch={commitAiAnalysisSettingsPatch}
        probeStoredAiConnection={probeStoredAiConnection}
        saveAiConfig={saveAiConfig}
        testAiConnectionFromDialog={testAiConnectionFromDialog}
        fetchAiModelsFromDialog={fetchAiModelsFromDialog}
        aiUiPrefs={aiUiPrefs}
        imageSequencePrefs={imageSequencePrefs}
        viewerChromePrefs={viewerChromePrefs}
        setViewerChromePrefs={setViewerChromePrefs}
        shellApi={shellApi}
        showMissingLinkedPublishRef={showMissingLinkedPublishRef}
        loadContent={loadContent}
        currentQueryDefinition={currentQueryDefinition}
        canvasPrefs={canvasPrefs}
        setCanvasPrefs={setCanvasPrefs}
        audioPreviewPrefersCover={audioPreviewPrefersCover}
        applyAudioPreviewPreference={applyAudioPreviewPreference}
        bakeImageRotation={bakeImageRotation}
        applyBakeImageRotation={applyBakeImageRotation}
        setAiUiPrefs={setAiUiPrefs}
        setImageSequencePrefs={setImageSequencePrefs}
        openAppLog={openAppLog}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
        api={api}
        t={t}
        locale={locale}
        setError={setError}
        setNotice={setNotice}
        reloadCurrentContent={reloadCurrentContent}
        syncRunStartedAtRef={syncRunStartedAtRef}
        embeddingBound={embeddingBound}
        runLibraryOpenPipeline={runLibraryOpenPipeline}
        appLogErrorCode={appLogErrorCode}
        refreshAppLog={refreshAppLog}
        revealAppLog={revealAppLog}
        revealRecoveryReport={revealRecoveryReport}
        automaticTaskEditorId={automaticTaskEditorId}
        refreshAfterAutomationScript={refreshAfterAutomationScript}
        busy={busy}
        createLibraryPhase={createLibraryPhase}
        dialogValue={dialogValue}
        setDialogValue={setDialogValue}
        setCreateLibraryPhase={setCreateLibraryPhase}
        cancelEagleInspectFlow={cancelEagleInspectFlow}
        cancelBillfishInspectFlow={cancelBillfishInspectFlow}
        submitEagleLibraryName={submitEagleLibraryName}
        submitBillfishLibraryName={submitBillfishLibraryName}
        runLibraryOperation={runLibraryOperation}
        openRecentLibrary={openRecentLibrary}
        forgetRecentLibrary={forgetRecentLibrary}
        exportLibrary={exportLibrary}
        openEagleLibrary={openEagleLibrary}
        openBillfishLibrary={openBillfishLibrary}
        startImport={startImport}
        startImportZip={startImportZip}
        importEagleLibrary={importEagleLibrary}
        importBillfishLibrary={importBillfishLibrary}
        completeImportCopy={completeImportCopy}
        completeImportInPlace={completeImportInPlace}
        applyBatchRelink={applyBatchRelink}
        cancelBatchRelink={cancelBatchRelink}
        aiConnectionFailureGate={aiConnectionFailureGate}
        onAiConnectionFailureAbort={onAiConnectionFailureAbort}
        handleAiConnectionFailureRetry={handleAiConnectionFailureRetry}
        fatalAlertMessage={fatalAlertMessage}
        dismissAlreadyOpenPrompt={dismissAlreadyOpenPrompt}
        confirmAlreadyOpenLibrarySwitch={confirmAlreadyOpenLibrarySwitch}
        dismissFatalAlert={dismissFatalAlert}
        openLibraryChooserFromError={openLibraryChooserFromError}
        criticalConfirmation={criticalConfirmation}
        embeddingSearchReady={embeddingSearchReady}
        embeddingSelectionId={embeddingSelectionId}
        embeddingService={embeddingService}
        controlMediaJobs={controlMediaJobs}
        loadMoreMediaJobs={loadMoreMediaJobs}
        controlAiJobs={controlAiJobs}
      />
      <AppAssetContextMenu
        busy={busy}
        pluginBrowseScope={pluginBrowseScope}
        pluginViewerState={pluginViewerState}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
        visibleAssets={visibleAssets}
        menuSkipScope={menuSkipScope}
        closeWorkspaceTab={closeWorkspaceTab}
        closeOtherWorkspaceTabs={closeOtherWorkspaceTabs}
        setLeftOpen={setLeftOpen}
        setWorkspaceTabRevealTarget={setWorkspaceTabRevealTarget}
        workspaceTabRevealRequestRef={workspaceTabRevealRequestRef}
        setNotice={setNotice}
        t={t}
        setError={setError}
        openInlineFolderCreate={openInlineFolderCreate}
        folderTreeActionsRef={folderTreeActionsRef}
        importFolderAsLinked={importFolderAsLinked}
        setIgnoreState={setIgnoreState}
        openInlineFolderRename={openInlineFolderRename}
        handleOpenFolderInFileManager={handleOpenFolderInFileManager}
        handleCopyFolderPath={handleCopyFolderPath}
        handleCopyFolder={handleCopyFolder}
        dispatchClipboardPaste={dispatchClipboardPaste}
        cloneFolder={cloneFolder}
        openLinkedRules={openLinkedRules}
        requestTrashManagedFolder={requestTrashManagedFolder}
        openDiskDelete={openDiskDelete}
        removeLinkedFolder={removeLinkedFolder}
        setEntityAppearance={setEntityAppearance}
        chooseFolderCover={chooseFolderCover}
        openFolderCoverLibraryPicker={openFolderCoverLibraryPicker}
        clearFolderCover={clearFolderCover}
        useAssetAsFolderCover={useAssetAsFolderCover}
        batchAssignTagToSelection={batchAssignTagToSelection}
        batchRemoveTagFromSelection={batchRemoveTagFromSelection}
        trashMixedSelection={trashMixedSelection}
        requestSelectionDiskDelete={requestSelectionDiskDelete}
        requestRestoreTrashedAssets={requestRestoreTrashedAssets}
        deletePermanentFromTrash={deletePermanentFromTrash}
        relinkMissingAsset={relinkMissingAsset}
        handleAnalyzeClick={handleAnalyzeClick}
        handleClearAiContent={handleClearAiContent}
        copyManagedSelectionToLinked={copyManagedSelectionToLinked}
        clearAssetSelection={clearAssetSelection}
        handleOpenExternal={handleOpenExternal}
        openWithSettings={openWithSettings}
        openAssetWithProgram={openAssetWithProgram}
        openAssetPreview={openAssetPreview}
        persistAssetColorSpace={persistAssetColorSpace}
        openCreateImageSequenceDialog={openCreateImageSequenceDialog}
        dissolveSelectedImageSequence={dissolveSelectedImageSequence}
        dissolveSelectedImageSequences={dissolveSelectedImageSequences}
        handleRevealInFolder={handleRevealInFolder}
        showAssetInContainingFolder={showAssetInContainingFolder}
        embeddingBound={embeddingBound}
        embeddingSelectionId={embeddingSelectionId}
        embeddingService={embeddingService}
        runFindSimilar={runFindSimilar}
        handleCopyFilePath={handleCopyFilePath}
        handleCopyAssetFiles={handleCopyAssetFiles}
        browsePasteDestination={browsePasteDestination}
        openAssetRename={openAssetRename}
        assignAssetToTag={assignAssetToTag}
        restoreTrashedManagedFolder={restoreTrashedManagedFolder}
        emptyTrash={emptyTrash}
      />
      <PaneResizeHandles
        leftOpen={leftOpen}
        t={t}
        panelResizing={panelResizing}
        capturePanelResizeAnchor={capturePanelResizeAnchor}
        resetPanelWidth={resetPanelWidth}
        beginPanelResize={beginPanelResize}
        navPanelWidth={navPanelWidth}
        beginPanelEdgeRestore={beginPanelEdgeRestore}
        rightOpen={rightOpen}
        inspectorPanelWidth={inspectorPanelWidth}
      />
    </main>
    <LocalConfirmationHost blocked={criticalConfirmation.request !== null} scopeKey={library?.libraryId} />
</>
  );
}
