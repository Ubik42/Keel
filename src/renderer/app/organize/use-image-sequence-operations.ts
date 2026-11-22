import type { Dispatch, RefObject, SetStateAction } from "react";
import { openAssetWithPlugin } from "../../plugins/plugin-open-with";
import type { RendererWindow } from "../shared/app-shared";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { AppLocale } from "../../i18n/types";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { ImageSequencePreferences } from "../../viewer/image-sequence-preferences";
import { type AssetSummary, type FilterClause, type SortDefinition, type TagSummary } from "../../../shared/asset-types";
import { DEFAULT_IMAGE_SEQUENCE_FPS } from "../../../shared/image-sequence";
import { resolveOpenWithTarget } from "../../../shared/open-with";
import { type ImportConflictPlan, type ImportSourceFailurePlan } from "../../../shared/protocol/responses";
import { decrementScopeCount, removeAssetIdsLocally } from "../../browse/asset-local-refresh";
import { assetsRemainingAfterMembership, type BrowseMembershipChange } from "../../filters/browse-filter-membership";
import { resolveBrowsePasteDestination } from "../../browse/browse-paste-target";
import { messageForPublicError, toMessage } from "../../common/error-utils";
import { resolveAssetSummariesForSelection } from "../../import/image-sequence-selection";
import { postImportSequencePlanFromAssets, type PostImportSequencePlan } from "../../import/post-import-image-sequences";
import { type BrowseState } from "../../stores/browse-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { selectionFields, type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type TransfersState } from "../../stores/transfers-store";
import { useAssetDragDropHandlers } from "../../browse/use-asset-drag-drop-handlers";
import { useExternalImportHandlers } from "../../import/use-external-import-handlers";
import { useFolderDeleteActions } from "../../folders/use-folder-delete-actions";
import { useFolderDragDropHandlers } from "../../folders/use-folder-drag-drop-handlers";
import { useFolderOrganizeActions } from "../../folders/use-folder-organize-actions";
import { useOpenWithSettings } from "../../settings/use-open-with-settings";
import { useShellFileActions } from "../../common/use-shell-file-actions";
import { useBatchActions } from "../../browse/useBatchActions";
import { type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest, renderedLibrary } from "../shared/app-shared";
import { useCallback, useEffect, useRef } from "react";

export interface UseImageSequenceOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  imageSequenceDialog: DialogsState["imageSequenceDialog"];
  setImageSequenceDialog: Dispatch<SetStateAction<DialogsState["imageSequenceDialog"]>>;
  locale: AppLocale;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  setError: (text: string | null) => void;
  postImportSequencePlanRef: RefObject<PostImportSequencePlan | null>;
  setImageSequenceConfirmPurpose: Dispatch<SetStateAction<TransfersState["imageSequenceConfirmPurpose"]>>;
  setImageSequenceImportError: Dispatch<SetStateAction<TransfersState["imageSequenceImportError"]>>;
  setImageSequenceImportOffer: Dispatch<SetStateAction<TransfersState["imageSequenceImportOffer"]>>;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  activeTagId: NavigationState["activeTagId"];
  tags: NavigationState["tags"];
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  deferredReconcileTimerRef: RefObject<number | undefined>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  showTrash: NavigationState["showTrash"];
  trashedAssets: BrowseState["trashedAssets"];
  assets: BrowseState["assets"];
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setSearchTotal: Dispatch<SetStateAction<BrowseState["searchTotal"]>>;
  removeLocallyFromBrowse: (assetIds: string[], removedCount: number) => () => void;
  setFilteredFolderCountRefreshToken: Dispatch<SetStateAction<BrowseState["filteredFolderCountRefreshToken"]>>;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
  refreshTagAndMetadataState: (assetId: string) => Promise<void>;
  t: TranslateFn;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setTags: Dispatch<SetStateAction<NavigationState["tags"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  applyLocalAssetRemoval: (assetIds: string[], options?: { removedCount?: number; libraryId?: string; }) => (() => void);
  chooseTag: (tagId: string, navigation?: WorkspaceNavigationRequest, tagCatalog?: readonly TagSummary[]) => Promise<void>;
  setFolders: Dispatch<SetStateAction<NavigationState["folders"]>>;
  assetScope: NavigationState["assetScope"];
  folders: NavigationState["folders"];
  releaseAssetPreviewsBeforeDiskDelete: () => Promise<void>;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  openAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  selectedFolderId: string | undefined;
  presentImportConflicts: (plan: ImportConflictPlan) => void;
  presentImportSourceFailure: (plan: ImportSourceFailurePlan) => void;
  revealAfterImportRef: RefObject<(completion: { assets: AssetSummary[]; }) => Promise<void>>;
  runCurrentImportRpc: <T>(work: () => Promise<T>) => Promise<T>;
  busy: boolean;
  imageSequencePrefs: ImageSequencePreferences;
  previewAsset: PreviewState["previewAsset"];
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  offerPostImportSequencesRef: RefObject<(assets: readonly AssetSummary[]) => void>;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  clearImportConflictsUi: () => void;
  clearImportSourceFailureUi: () => void;
  getManagedAssetDragIds: () => string[] | null;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useImageSequenceOperations({ api, library, imageSequenceDialog, setImageSequenceDialog, locale, clearAssetSelection, reloadCurrentContent, setSelectedAssetIds, visibleAssets, setError, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, reloadCurrentContentRef, activeTagId, tags, currentQueryDefinition, deferredReconcileTimerRef, workspaceCanvasRef, showTrash, trashedAssets, assets, setTrashedAssets, setAssets, setSearchTotal, removeLocallyFromBrowse, setFilteredFolderCountRefreshToken, syncBrowseFilterMembershipRef, refreshTagAndMetadataState, t, setUiState, setTags, setNotice, applyLocalAssetRemoval, chooseTag, setFolders, assetScope, folders, releaseAssetPreviewsBeforeDiskDelete, chooseFolder, openAssetPreview, showTagManagement, showPluginSidebarView, selectedFolderId, presentImportConflicts, presentImportSourceFailure, revealAfterImportRef, runCurrentImportRpc, busy, imageSequencePrefs, previewAsset, managedImportTargetFolderIdRef, offerPostImportSequencesRef, setImportProgress, clearImportConflictsUi, clearImportSourceFailureUi, getManagedAssetDragIds }: UseImageSequenceOperationsDeps) {

  function requestTrashManagedFolder(folderId: string, name: string) {
    void trashManagedFolder(folderId, name);
  }

  async function createSelectedImageSequence() {
    if (!api || !library || !imageSequenceDialog) return;
    setImageSequenceDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const result = await api.createImageSequence({
      libraryId: library.libraryId,
      assetIds: imageSequenceDialog.assetIds,
      fps: imageSequenceDialog.fps,
    });
    if (!result.ok) {
      setImageSequenceDialog((current) =>
        current
          ? { ...current, submitting: false, error: messageForPublicError(result.error, locale) }
          : current,
      );
      return;
    }
    setImageSequenceDialog(null);
    clearAssetSelection();
    await reloadCurrentContent();
    setSelectedAssetIds([result.value.assetId]);
  }

  async function openCreateImageSequenceDialog(assetIds: readonly string[]) {
    if (!library || !api) return;
    const resolved = await resolveAssetSummariesForSelection({
      listAssets: (input) => api.listAssets(input),
      libraryId: library.libraryId,
      assetIds,
      loadedAssets: visibleAssets,
    });
    if (!resolved.ok) {
      setError(messageForPublicError(resolved.error, locale));
      return;
    }
    const plan = postImportSequencePlanFromAssets(library.libraryId, resolved.value);
    if (!plan) {
      setImageSequenceDialog({
        assetIds: [...assetIds],
        mode: "create",
        fps: DEFAULT_IMAGE_SEQUENCE_FPS,
        submitting: false,
        error: null,
      });
      return;
    }
    postImportSequencePlanRef.current = plan;
    setImageSequenceConfirmPurpose("create");
    setImageSequenceImportError(null);
    setImageSequenceImportOffer(plan.offer);
  }

  async function updateImageSequenceFps() {
    if (
      !api ||
      !library ||
      !imageSequenceDialog ||
      imageSequenceDialog.mode !== "update" ||
      !imageSequenceDialog.sequenceId
    ) {
      return;
    }
    setImageSequenceDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const result = await api.setImageSequenceFps({
      libraryId: library.libraryId,
      sequenceId: imageSequenceDialog.sequenceId,
      fps: imageSequenceDialog.fps,
    });
    if (!result.ok) {
      setImageSequenceDialog((current) =>
        current
          ? { ...current, submitting: false, error: messageForPublicError(result.error, locale) }
          : current,
      );
      return;
    }
    setImageSequenceDialog(null);
    await reloadCurrentContent();
  }

  async function dissolveSelectedImageSequence(sequenceId: string) {
    if (!api || !library) return;
    const result = await api.dissolveImageSequence({
      libraryId: library.libraryId,
      sequenceId,
    });
    if (!result.ok) {
      setError(messageForPublicError(result.error, locale));
      return;
    }
    clearAssetSelection();
    await reloadCurrentContent();
  }

  async function dissolveSelectedImageSequences(sequenceIds: string[]) {
    if (!api || !library || sequenceIds.length === 0) return;
    const result = await api.dissolveImageSequences({
      libraryId: library.libraryId,
      sequenceIds,
    });
    if (!result.ok) {
      setError(messageForPublicError(result.error, locale));
      return;
    }
    clearAssetSelection();
    await reloadCurrentContent();
  }
  useEffect(() => {
    reloadCurrentContentRef.current = reloadCurrentContent;
  });

  function visibleBrowseFilters(): FilterClause[] | null {
    const activeTagName = activeTagId
      ? tags.find((tag) => tag.tagId === activeTagId)?.name
      : undefined;
    const definition = activeTagName
      ? currentQueryDefinition({ tagFilter: activeTagName })
      : currentQueryDefinition();
    return definition.filters ?? [];
  }

  function scheduleFilteredBrowseReconcile(delayMs: number): void {
    const operationLibraryId = renderedLibrary.current?.libraryId;
    if (deferredReconcileTimerRef.current !== undefined) {
      window.clearTimeout(deferredReconcileTimerRef.current);
    }
    deferredReconcileTimerRef.current = window.setTimeout(() => {
      deferredReconcileTimerRef.current = undefined;
      if (
        operationLibraryId !== undefined
        && renderedLibrary.current?.libraryId !== operationLibraryId
      ) return;
      const canvas = workspaceCanvasRef.current;
      const scrollTopBefore = canvas?.scrollTop ?? 0;
      void reloadCurrentContentRef.current()
        .catch(() => undefined)
        .finally(() => {
          if (
            operationLibraryId !== undefined
            && renderedLibrary.current?.libraryId !== operationLibraryId
          ) return;
          const nextCanvas = workspaceCanvasRef.current;
          if (nextCanvas && nextCanvas.scrollTop !== scrollTopBefore) {
            nextCanvas.scrollTo({ top: scrollTopBefore });
          }
        });
    }, delayMs);
  }

  function dropAssetsFromFilteredBrowse(assetIds: readonly string[]): void {
    const removed = new Set(assetIds);
    const visible = showTrash ? trashedAssets : assets;
    const removedCount = visible.filter((asset) => removed.has(asset.assetId)).length;
    if (removedCount === 0) return;
    if (showTrash) {
      setTrashedAssets((current) => removeAssetIdsLocally(current, removed));
    } else {
      setAssets((current) => removeAssetIdsLocally(current, removed));
    }
    setSearchTotal((current) => decrementScopeCount(current, removedCount));
    removeLocallyFromBrowse([...assetIds], removedCount);
    scheduleFilteredBrowseReconcile(1500);
  }

  function syncBrowseFilterMembership(change: BrowseMembershipChange): void {
    if (change.kind === "dimensions" && showTrash) return;
    if (!showTrash && (visibleBrowseFilters()?.length ?? 0) > 0) {
      setFilteredFolderCountRefreshToken((token) => token + 1);
    }
    const visible = showTrash ? trashedAssets : assets;
    const next = assetsRemainingAfterMembership(visible, visibleBrowseFilters(), change);
    if (next.assets.length < visible.length) {
      const kept = new Set(next.assets.map((asset) => asset.assetId));
      dropAssetsFromFilteredBrowse(
        visible
          .filter((asset) => !kept.has(asset.assetId))
          .map((asset) => asset.assetId),
      );
      return;
    }
    if (next.reload) scheduleFilteredBrowseReconcile(0);
  }
  syncBrowseFilterMembershipRef.current = syncBrowseFilterMembership;

  async function refreshAfterAutomationScript() {
    try {
      // A script may issue hundreds of write commands. Refresh once after the
      // execution settles so cards retain the current browse scope/selection
      // and Inspector reflects committed metadata without a reload per batch.
      await reloadCurrentContent();
      const selected = selectionFields.get("selectedAssetId");
      if (selected) await refreshTagAndMetadataState(selected);
    } catch (caught) {
      setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
    }
  }

  const {
    batchAssignTagToSelection,
    batchRemoveTagFromSelection,
    trashManagedAssets,
    deleteManagedAssetsFromDisk,
    copyManagedSelectionToLinked,
  } = useBatchActions({
    api: api ?? null,
    library,
    setUiState,
    setTags,
    setNotice,
    setError,
    // Batch callbacks may outlive the render that started them. Resolve the
    // latest guarded reload function at call time so a completed old-library
    // mutation cannot reload a stale scope after a switch.
    reloadCurrentContent: () => reloadCurrentContentRef.current(),
    applyLocalAssetRemoval,
    isCurrentLibrary: (libraryId) => renderedLibrary.current?.libraryId === libraryId,
    chooseTag,
    clearAssetSelection,
    activeTagId,
    onTagsChanged: (action, tagId, assetIds) => {
      const tagName = tags.find((tag) => tag.tagId === tagId)?.name;
      if (!tagName) return;
      syncBrowseFilterMembershipRef.current({
        kind: "tags",
        assetIds,
        addedTagNames: action === "assign" ? [tagName] : [],
        removedTagNames: action === "remove" ? [tagName] : [],
      });
    },
  });

  const removeDeletedManagedFoldersFromSidebar = useCallback(
    (deletedFolderIds: readonly string[]) => {
      setFolders((current) => {
        const removed = new Set(deletedFolderIds);
        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of current) {
            if (
              folder.parentFolderId !== null &&
              removed.has(folder.parentFolderId) &&
              !removed.has(folder.folderId)
            ) {
              removed.add(folder.folderId);
              changed = true;
            }
          }
        }
        return current.filter((folder) => !removed.has(folder.folderId));
      });
    },
    [setFolders],
  );

  const {
    trashManagedFolder,
    openDiskDelete,
    removeLinkedFolder,
  } = useFolderDeleteActions({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    locale,
    assetScope,
    folders,
    setNotice,
    setError,
    setUiState,
    closePreview: releaseAssetPreviewsBeforeDiskDelete,
    reloadCurrentContent,
    onManagedFoldersTrashed: removeDeletedManagedFoldersFromSidebar,
    onDeletedCurrentScope: () => {
      void chooseFolder("root", { refreshSidebar: true });
    },
  });

  const {
    handleOpenExternal,
    handleRevealInFolder,
    handleCopyFilePath,
    handleCopyAssetFiles,
    handleOpenFolderInFileManager,
    handleCopyFolderPath,
    handleCopyFolder,
  } = useShellFileActions({
    api: api ?? null,
    library,
    setError,
    setNotice,
  });

  // PF: double-click and the "打开方式" menu follow the per-extension default.
  const { settings: openWithSettings } = useOpenWithSettings();
  const openAssetWithProgram = useCallback(async (assetId: string, programId?: string) => {
    if (!api || !library) return;
    const result = await api.openWith({ libraryId: library.libraryId, assetId, ...(programId === undefined ? {} : { programId }) });
    if (!result.ok) setError(t("toast.openWithFailed"));
  }, [api, library, setError, t]);
  const openAssetByDefault = useCallback((asset: AssetSummary) => {
    const target = resolveOpenWithTarget(openWithSettings, asset.displayName);
    if (target.kind === "system" && asset.availability === "available" && !asset.deletedAt) {
      void handleOpenExternal(asset.assetId);
    } else if (target.kind === "program" && asset.availability === "available" && !asset.deletedAt) {
      void openAssetWithProgram(asset.assetId, target.programId);
    } else if (target.kind === "plugin" && asset.availability === "available" && !asset.deletedAt) {
      // A plugin that is gone or fails falls back to the Keel viewer.
      void openAssetWithPlugin((window as RendererWindow).keel?.plugins, library?.libraryId, target, asset)
        .then((opened) => { if (!opened) openAssetPreview(asset); });
    } else {
      openAssetPreview(asset);
    }
  }, [handleOpenExternal, library?.libraryId, openAssetPreview, openAssetWithProgram, openWithSettings]);

  const browsePasteDestination = resolveBrowsePasteDestination({
    libraryOpen: Boolean(library),
    showTrash,
    showTagManagement,
    showPluginSidebarView,
    assetScope,
    selectedFolderId,
  });

  const { pasteIntoFolder, cloneFolder } =
    useFolderOrganizeActions({
      api: api ?? null,
      libraryId: library?.libraryId ?? null,
      locale,
      setNotice,
      setError,
      setUiState,
      reloadCurrentContent,
      onPasteConflict: (plan) => {
        presentImportConflicts(plan);
      },
      onPasteSourceFailure: (plan) => {
        presentImportSourceFailure(plan);
      },
      onPasteSequenceOffer: (offer) => {
        setImageSequenceConfirmPurpose("import");
        setImageSequenceImportOffer(offer);
      },
      onPasteCompleted: (completion) => revealAfterImportRef.current(completion),
      runImportRpc: runCurrentImportRpc,
    });

  const osClipboardPasteAtRef = useRef(0);
  const pasteOsClipboardFiles = useCallback(
    (folderId: string | null) => {
      const now = Date.now();
      if (now - osClipboardPasteAtRef.current < 400) return;
      osClipboardPasteAtRef.current = now;
      void pasteIntoFolder(folderId);
    },
    [pasteIntoFolder],
  );

  const {
    handleAssetsDroppedOnFolder,
    handleAssetsDroppedOnTrash,
  } = useAssetDragDropHandlers({
    api: api ?? null,
    library,
    assets,
    assetScope,
    setNotice,
    setError,
    setUiState,
    clearAssetSelection,
    trashManagedAssets,
    reloadCurrentContentRef,
  });

  const resolveManagedAssetDrop = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (!api || !library) return [];
      const result = await api.resolveManagedAssetDrop({
        libraryId: library.libraryId,
        files,
      });
      return result.ok ? result.value.assetIds : [];
    },
    [api, library],
  );

  const {
    handleFoldersDroppedOnFolder,
    handleFoldersDroppedOnTrash,
  } = useFolderDragDropHandlers({
    api: api ?? null,
    libraryId: library?.libraryId ?? null,
    assetScope,
    folders,
    setNotice,
    setError,
    setUiState,
    reloadCurrentContent,
    onManagedFoldersTrashed: removeDeletedManagedFoldersFromSidebar,
    onDeletedCurrentScope: async () => {
      await chooseFolder("root", { refreshSidebar: true });
    },
  });

  const {
    externalDropActive,
    pasteClipboardImage,
    importDroppedFiles,
    beginInternalAssetDrag,
    isInternalAssetDrag,
    handleExternalDragEnter,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    handleTargetExternalDragOver,
    handleTargetExternalDrop,
    createFolderCardDropHandlers,
  } = useExternalImportHandlers({
    api: api ?? null,
    library,
    busy,
    autoDetectImageSequences: imageSequencePrefs.autoDetectOnImport,
    detectImageSequences: imageSequencePrefs.detectionEnabled,
    previewBlocksDrop: Boolean(previewAsset),
    managedImportTargetFolderIdRef,
    onImportCompleted: async (completion) => {
      await revealAfterImportRef.current(completion);
      offerPostImportSequencesRef.current(completion.assets);
    },
    setUiState,
    setImportProgress,
    runImportRpc: runCurrentImportRpc,
    setError,
    setNotice,
    setConflicts: (plan) => {
      if (plan === null) clearImportConflictsUi();
      else presentImportConflicts(plan);
    },
    setSourceFailurePlan: (plan) => {
      if (plan === null) clearImportSourceFailureUi();
      else presentImportSourceFailure(plan);
    },
    setImageSequenceImportOffer,
    onFoldersDroppedOnFolder: handleFoldersDroppedOnFolder,
    getManagedAssetDragIds,
    onResolveManagedAssetDrop: resolveManagedAssetDrop,
    onAssetsDroppedOnFolder: (folderId, assetIds, mode) =>
      handleAssetsDroppedOnFolder(folderId, assetIds, mode),
  });

  // Paste-into-folder entry shared by the keyboard shortcut, Edit menu, and
  // context menus: the clipboard may hold a bitmap image (invisible to the
  // paste event on Windows) or OS file paths — try the image first and fall
  // back to OS file paste.
  const dispatchClipboardPaste = useCallback(
    (destination: string | null) => {
      void pasteClipboardImage({
        targetFolderId: destination ?? undefined,
        onNoClipboardImage: () => pasteOsClipboardFiles(destination),
      });
    },
    [pasteClipboardImage, pasteOsClipboardFiles],
  );
  return { batchAssignTagToSelection, batchRemoveTagFromSelection, requestTrashManagedFolder, handleOpenFolderInFileManager, handleCopyFolder, handleCopyFolderPath, dispatchClipboardPaste, openDiskDelete, deleteManagedAssetsFromDisk, trashManagedAssets, browsePasteDestination, handleOpenExternal, handleCopyAssetFiles, handleCopyFilePath, handleRevealInFolder, pasteClipboardImage, pasteOsClipboardFiles, createFolderCardDropHandlers, isInternalAssetDrag, resolveManagedAssetDrop, handleTargetExternalDragOver, handleTargetExternalDrop, handleAssetsDroppedOnFolder, handleFoldersDroppedOnFolder, handleAssetsDroppedOnTrash, handleFoldersDroppedOnTrash, importDroppedFiles, copyManagedSelectionToLinked, externalDropActive, handleExternalDragEnter, handleExternalDragLeave, handleExternalDragOver, handleExternalDrop, openAssetByDefault, beginInternalAssetDrag, updateImageSequenceFps, createSelectedImageSequence, refreshAfterAutomationScript, cloneFolder, removeLinkedFolder, openWithSettings, openAssetWithProgram, openCreateImageSequenceDialog, dissolveSelectedImageSequence, dissolveSelectedImageSequences };
}
