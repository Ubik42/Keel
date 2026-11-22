import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AppLocale } from "../i18n/types";
import type { LibraryTransitionLock } from "../library-transition-lock";
import { type LinkedFolderRule, type LinkedFolderSummary, type SearchScope } from "../../shared/asset-types";
import { type RendererLibrarySummary } from "../../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "../error-utils";
import { saveFeatureHintPreferences, withFeatureHintShown } from "../feature-hint-preferences";
import { advanceLibraryViewSession } from "../library-view-session";
import { LINKED_FOLDER_ADD_HINT_KEY } from "../linked-folder-add-hint";
import { requestConfirmation } from "../local-confirmation";
import { resetLibraryScope } from "../stores/actions/reset-library-scope";
import { type BrowseState } from "../stores/browse-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../stores/navigation-store";
import { selectionFields, type SelectionState } from "../stores/selection-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { playTaskCompletionSound } from "../task-completion-sound";
import { shouldOpenTrashRestoreDialog, silentTrashRestoreRequest, type TrashRestoreRequest } from "../trash-restore-flow";
import { userCancellationNoticeKey } from "../user-cancellation";
import { IS_WINDOWS_PLATFORM, type SearchDefinition } from "./app-shared";
import { flushSync } from "react-dom";

export interface UseLinkedFolderOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  refreshAfterAiRef: RefObject<(assetId: string) => Promise<void>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  setError: (text: string | null) => void;
  locale: AppLocale;
  runCurrentImportRpc: <T>(work: () => Promise<T>) => Promise<T>;
  featureHintPrefs: NavigationState["featureHintPrefs"];
  setFeatureHintPrefs: Dispatch<SetStateAction<NavigationState["featureHintPrefs"]>>;
  setLinkedFolderHintActive: Dispatch<SetStateAction<NavigationState["linkedFolderHintActive"]>>;
  setLinkedRulesEditor: Dispatch<SetStateAction<{ folderId: string; name: string; rules: LinkedFolderRule[]; } | null>>;
  linkedRulesEditor: { folderId: string; name: string; rules: LinkedFolderRule[]; } | null;
  convertLinkedDialog: DialogsState["convertLinkedDialog"];
  setConvertLinkedDialog: Dispatch<SetStateAction<DialogsState["convertLinkedDialog"]>>;
  libraryTransitionLock: LibraryTransitionLock;
  confirmLibrarySwitch: (keepDestinationChoice?: boolean) => Promise<boolean>;
  beginLibraryTransition: () => Readonly<{ libraryId: string | null; generation: number; }>;
  markLibraryClosePending: (libraryId: string) => number;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  clearLibraryClosePending: (libraryId: string, generation: number) => void;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  cancelPendingLibraryReads: () => void;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  localAssetRemovalGenerationRef: RefObject<number>;
  deferredReconcileTimerRef: RefObject<number | undefined>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  hoveredAssetIdRef: RefObject<string | null>;
  clearHoveredAssetId: (assetId: string) => void;
  metadataByAssetRef: RefObject<Map<string, { assetId: string; description: string | null; rating: number; favorite: boolean; palette: string | null; automaticPalette: { hex: string; ratio: number; }[]; effectivePalette: string[]; paletteSource: "manual" | "automatic" | null; sourcePageUrl: string | null; author: string | null; tags: { id: string; name: string; source: "ai" | "user"; }[]; entityVersion: number; updatedAt: string; companions?: { assetId: string; fileName: string; }[] | undefined; }>>;
  metadataConflictAssetIdsRef: RefObject<Set<string>>;
  setFolderCoverPicker: Dispatch<SetStateAction<{ folderIds: string[]; assetId: string; } | null>>;
  resetBrowsePagination: () => void;
  workspaceHistoryReplayEpochRef: RefObject<number>;
  resetWorkspaceTabs: () => void;
  libraryViewSessionRef: RefObject<Readonly<{ libraryId: string | null; generation: number; }>>;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  assetScope: NavigationState["assetScope"];
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setFindSimilarSource: Dispatch<SetStateAction<NavigationState["findSimilarSource"]>>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  setHoveredAssetId: (assetId: string | null) => void;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  setRestoreDialog: Dispatch<SetStateAction<DialogsState["restoreDialog"]>>;
  restoreDialog: DialogsState["restoreDialog"];
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  showTrash: NavigationState["showTrash"];
  closeContextMenu: () => void;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useLinkedFolderOperations({ api, library, setUiState, reloadCurrentContent, refreshAfterAiRef, setNotice, t, setError, locale, runCurrentImportRpc, featureHintPrefs, setFeatureHintPrefs, setLinkedFolderHintActive, setLinkedRulesEditor, linkedRulesEditor, convertLinkedDialog, setConvertLinkedDialog, libraryTransitionLock, confirmLibrarySwitch, beginLibraryTransition, markLibraryClosePending, closeAssetPreview, clearLibraryClosePending, refreshRecentLibraries, cancelPendingLibraryReads, cancelWorkspaceViewportRestoreRef, setWorkspaceNavigationPending, localAssetRemovalGenerationRef, deferredReconcileTimerRef, managedImportTargetFolderIdRef, setAssetSelectionAnchor, hoveredAssetIdRef, clearHoveredAssetId, metadataByAssetRef, metadataConflictAssetIdsRef, setFolderCoverPicker, resetBrowsePagination, workspaceHistoryReplayEpochRef, resetWorkspaceTabs, libraryViewSessionRef, setLibrary, assetScope, setLibraryLoading, setAssets, setFindSimilarSource, setSelectedAssetIds, setSelectedAssetId, setHoveredAssetId, loadContent, setRestoreDialog, restoreDialog, clearAssetSelection, showTrash, closeContextMenu }: UseLinkedFolderOperationsDeps) {

  async function refreshAssets() {
    if (!api || !library) return;
    const startedAt = Date.now();
    setUiState("loading");
    try {
      const result = await api.refreshAssets({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await reloadCurrentContent();
      const selected = selectionFields.get("selectedAssetId");
      if (selected) await refreshAfterAiRef.current(selected);
      setNotice(
        result.value.changedCount
          ? t("toast.diskSynced", { count: result.value.changedCount })
          : t("toast.diskUpToDate"),
      );
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.refreshFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function importFolderAsLinked(parentFolderId: string | null = null) {
    if (!api || !library) return;
    const startedAt = Date.now();
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result = await runCurrentImportRpc(() =>
        api.importFolderAsLinked({
          libraryId: library.libraryId,
          displayName: undefined,
          // Serpent-316493: null = library root (folder-section link button);
          // a managed folder id hangs the link under that folder.
          parentFolderId,
        }),
      );
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(t("toast.linkedFolderCreated", { name: result.value.displayName }));
      // Using the linked-folder feature once dismisses this hint permanently.
      const dismissedHint = withFeatureHintShown(
        featureHintPrefs,
        LINKED_FOLDER_ADD_HINT_KEY,
      );
      setFeatureHintPrefs(dismissedHint);
      saveFeatureHintPreferences(dismissedHint);
      setLinkedFolderHintActive(false);
      // The new linked-folder row is part of the navigation snapshot, not the
      // primary asset page. Wait for that snapshot here so the completed
      // operation never reports success while the sidebar still looks stale.
      await reloadCurrentContent({ blockingNavigation: true });
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.linkFolderFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function relinkFolder(folderId: string) {
    if (!api || !library) return;
    const startedAt = Date.now();
    setUiState("loading");
    try {
      const result = await api.relinkMissingFolder({
        libraryId: library.libraryId,
        folderId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setNotice(t("toast.linkedFolderRelocated", { name: result.value.displayName }));
      await reloadCurrentContent();
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.relocateFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function openLinkedRules(folder: LinkedFolderSummary) {
    if (!api || !library) return;
    try {
      const result = await api.getLinkedFolderRules({
        libraryId: library.libraryId,
        folderId: folder.folderId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setLinkedRulesEditor({
        folderId: folder.folderId,
        name: folder.displayName,
        rules: result.value,
      });
    } catch (caught) {
      setError(toMessage(caught, t("toast.readLinkedRulesFailed"), locale));
    }
  }

  async function saveLinkedRules(finalRules: LinkedFolderRule[]) {
    if (!api || !library || !linkedRulesEditor) return;
    setUiState("loading");
    try {
      const result = await api.setLinkedFolderRules({
        libraryId: library.libraryId,
        folderId: linkedRulesEditor.folderId,
        rules: finalRules,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        t("toast.linkedRulesSaved", {
          hidden: result.value.hiddenCount,
          restored: result.value.restoredCount,
        }),
      );
      setLinkedRulesEditor(null);
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.saveLinkedRulesFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function convertLinkedToManaged() {
    if (!api || !library || !convertLinkedDialog.folderId) return;
    const dialogState = convertLinkedDialog;
    if (
      !await requestConfirmation(
        t("toast.convertLinkedConfirm", { name: dialogState.name }),
      )
    )
      return;
    if (sessionFields.get("library")?.libraryId !== library.libraryId) return;
    const startedAt = Date.now();
    setUiState("importing");
    try {
      const result = await api.convertLinkedFolderToManaged({
        libraryId: library.libraryId,
        folderId: dialogState.folderId,
        targetFolderId: dialogState.targetFolderId || undefined,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setConvertLinkedDialog({ folderId: "", name: "", targetFolderId: "" });
      setNotice(
        t("toast.convertLinkedDone", { count: result.value.convertedCount }),
      );
      await reloadCurrentContent();
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.convertLinkedFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function closeLibrary() {
    if (!api) return;
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) return;
    await libraryTransitionLock(async () => {
      const currentLibrary = sessionFields.get("library");
      if (!currentLibrary) return;
      beginLibraryTransition();
      setUiState("closing");
      const closeGeneration = markLibraryClosePending(currentLibrary.libraryId);
      let closed = false;
      try {
        await closeAssetPreview(false);
        const result = await api.close({ libraryId: currentLibrary.libraryId });
        clearLibraryClosePending(currentLibrary.libraryId, closeGeneration);
        if (!result.ok) throw new LibraryOperationError(result.error);
        closed = true;
        applyClosedLibraryUi();
        await refreshRecentLibraries(null);
      } catch (caught) {
        clearLibraryClosePending(currentLibrary.libraryId, closeGeneration);
        setError(toMessage(caught, t("toast.closeFailed"), locale));
      } finally {
        setUiState(closed ? "idle" : "ready");
      }
    });
  }

  async function removeLibrary() {
    if (!api) return;
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) return;
    await libraryTransitionLock(async () => {
      const currentLibrary = sessionFields.get("library");
      if (!currentLibrary) return;
      beginLibraryTransition();
      const removedName = currentLibrary.displayName;
      const removedPath = currentLibrary.displayPath;
      setUiState("closing");
      const closeGeneration = markLibraryClosePending(currentLibrary.libraryId);
      let removed = false;
      try {
        await closeAssetPreview(false);
        const result = await api.close({ libraryId: currentLibrary.libraryId });
        clearLibraryClosePending(currentLibrary.libraryId, closeGeneration);
        if (!result.ok) throw new LibraryOperationError(result.error);
        const forgotten = await api.forgetRecent({ path: removedPath });
        if (!forgotten.ok) throw new LibraryOperationError(forgotten.error);
        removed = true;
        applyClosedLibraryUi();
        await refreshRecentLibraries(null);
        setNotice(t("toast.libraryRemoved", { name: removedName }));
      } catch (caught) {
        clearLibraryClosePending(currentLibrary.libraryId, closeGeneration);
        setError(toMessage(caught, t("toast.libraryRemoveFailed"), locale));
      } finally {
        setUiState(removed ? "idle" : "ready");
      }
    });
  }

  async function forgetRecentLibrary(libraryPath: string) {
    if (!api) return;
    try {
      const result = await api.forgetRecent({ path: libraryPath });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await refreshRecentLibraries(library?.displayPath ?? null);
      } catch (caught) {
      setError(toMessage(caught, t("toast.libraryRemoveFailed"), locale));
    }
  }

  /**
   * Drop every piece of browse/inspector state that belongs to the previous
   * library before publishing a new library identity. Keeping the old rows
   * until the delayed navigation summary arrives makes the sidebar lie about
   * the active database for one or more paints.
   */
  function clearLibraryScopedView() {
    cancelPendingLibraryReads();
    cancelWorkspaceViewportRestoreRef.current?.();
    cancelWorkspaceViewportRestoreRef.current = null;
    setWorkspaceNavigationPending(false);
    localAssetRemovalGenerationRef.current += 1;
    if (deferredReconcileTimerRef.current !== undefined) {
      window.clearTimeout(deferredReconcileTimerRef.current);
      deferredReconcileTimerRef.current = undefined;
    }
    managedImportTargetFolderIdRef.current = undefined;
    resetLibraryScope();
    setAssetSelectionAnchor(null);
    if (hoveredAssetIdRef.current) {
      clearHoveredAssetId(hoveredAssetIdRef.current);
    }
    metadataByAssetRef.current.clear();
    metadataConflictAssetIdsRef.current.clear();
    setFolderCoverPicker(null);
    resetBrowsePagination();
    workspaceHistoryReplayEpochRef.current += 1;
    resetWorkspaceTabs();
  }

  function applyClosedLibraryUi() {
    cancelPendingLibraryReads();
    libraryViewSessionRef.current = advanceLibraryViewSession(
      libraryViewSessionRef.current,
      null,
    );
    clearLibraryScopedView();
    setLibrary(null);
    api?.setActiveContext(null);
  }

  function requestDeleteLibraryFromDisk() {
    if (!library) return;
    void confirmDeleteLibraryFromDisk();
  }

  async function confirmDeleteLibraryFromDisk() {
    if (!api) return;
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) return;
    await libraryTransitionLock(async () => {
      const currentLibrary = sessionFields.get("library");
      if (!currentLibrary) return;
      beginLibraryTransition();
      const deletedName = currentLibrary.displayName;
      const openLibrary = currentLibrary;
      const openScope = assetScope;
      const startedAt = Date.now();
      setUiState("closing");
      setLibraryLoading({ name: deletedName, operation: "deleting" });
      const closeGeneration = markLibraryClosePending(openLibrary.libraryId);
      let toreDown = false;
      try {
      await closeAssetPreview(false);
      // Serpent-dfgg: Chromium keeps keel:// thumbnail/source files mapped
      // until <img> unmounts. Drop the browse canvas before asking the Worker
      // to rm the library root, then wait one paint so handles actually close.
      flushSync(() => {
        setAssets([]);
        setFindSimilarSource(null);
        setSelectedAssetIds([]);
        setSelectedAssetId(undefined);
        setHoveredAssetId(null);
        resetBrowsePagination();
      });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      if (IS_WINDOWS_PLATFORM) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 120);
        });
      }
      const result = await api.deleteLibraryFromDisk({
        libraryId: openLibrary.libraryId,
      });
      clearLibraryClosePending(openLibrary.libraryId, closeGeneration);
      if (!result.ok) throw new LibraryOperationError(result.error);
      toreDown = true;
      applyClosedLibraryUi();
      await refreshRecentLibraries(null);
      // Serpent-65d837: the library root is gone but a `.del-*` aside may still
      // be draining; never let the user believe the disk is fully clean.
      if (result.ok && result.value.pendingCleanup) {
        setNotice(t("toast.libraryDeletedCleanupPending", { name: deletedName }));
      } else {
        setNotice(t("toast.libraryDeletedFromDisk", { name: deletedName }));
      }
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      clearLibraryClosePending(openLibrary.libraryId, closeGeneration);
      // Serpent-qgm1: a failed disk deletion must NOT masquerade as success.
      // The worker reopens a still-valid library; a half-deleted tree comes
      // back as LIBRARY_NOT_FOUND and the UI must close.
      const cancelled =
        caught instanceof LibraryOperationError && caught.code === "CANCELLED";
      const gone =
        caught instanceof LibraryOperationError &&
        (caught.code === "LIBRARY_NOT_FOUND" || caught.code === "NOT_A_LIBRARY");
      if (cancelled) {
        // 用户在确认窗点了取消：信息提示，不是失败。
        setNotice(t(userCancellationNoticeKey("libraryDelete")));
      }
      if (!cancelled) {
        playTaskCompletionSound(startedAt);
        setError(toMessage(caught, t("toast.libraryDeleteFailed"), locale));
      }
      if (gone) {
        toreDown = true;
        applyClosedLibraryUi();
        await refreshRecentLibraries(null);
      } else {
        try {
          await loadContent(openLibrary, openScope, { refreshSidebar: true });
        } catch {
          toreDown = true;
          applyClosedLibraryUi();
        }
        void refreshRecentLibraries(openLibrary.displayPath);
      }
      } finally {
        setLibraryLoading(null);
        setUiState(toreDown ? "idle" : "ready");
      }
    });
  }

  async function requestRestoreTrashedAssets(assetIds: string[]) {
    if (!api || !library) return;
    try {
      const preview = await api.previewRestoreAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!preview.ok) throw new LibraryOperationError(preview.error);
      if (shouldOpenTrashRestoreDialog(preview.value.hasNameConflicts)) {
        setRestoreDialog({
          assetIds,
          target: "original",
          conflictStrategy: "keep-both",
        });
        return;
      }
      await restoreTrashedAssets(silentTrashRestoreRequest(assetIds));
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreFailed"), locale));
    }
  }

  // --- Trash operations ---

  async function restoreTrashedAssets(payload?: TrashRestoreRequest) {
    const request = payload ?? restoreDialog;
    if (!api || !library || !request) return;
    const { assetIds, target, conflictStrategy } = request;
    setRestoreDialog(null);
    setUiState("loading");
    try {
      const result = await api.restoreAssets({
        libraryId: library.libraryId,
        assetIds,
        ...(target === "original"
          ? {}
          : { targetFolderId: target === "root" ? null : target }),
        conflictStrategy,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const skippedCount = assetIds.length - result.value.restoredCount;
      setNotice(
        t("toast.restoredCount", { count: result.value.restoredCount }) +
          (skippedCount
            ? t("toast.conflictAssetsSkippedSuffix", { count: skippedCount })
            : "") +
          t("common.sentenceEnd"),
        result.value.historyEntryId,
      );
      clearAssetSelection();
      if (showTrash) {
        await loadContent(library, "all", { trashMode: true });
      } else {
        await reloadCurrentContent();
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function restoreTrashedManagedFolder(
    tombstoneId: string,
    name: string,
  ) {
    if (!api || !library) return;
    closeContextMenu();
    setUiState("loading");
    try {
      const result = await api.restoreTrashedManagedFolder({
        libraryId: library.libraryId,
        tombstoneId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        t("toast.restoreTrashedFolderDone", {
          name,
          folders: result.value.restoredFolderCount,
          assets: result.value.restoredAssetCount,
        }) + t("common.sentenceEnd"),
        result.value.historyEntryId,
      );
      clearAssetSelection();
      await loadContent(library, "all", { trashMode: true });
    } catch (caught) {
      setError(toMessage(caught, t("toast.restoreTrashedFolderFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }
  return { applyClosedLibraryUi, clearLibraryScopedView, refreshAssets, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, importFolderAsLinked, forgetRecentLibrary, relinkFolder, saveLinkedRules, convertLinkedToManaged, restoreTrashedAssets, openLinkedRules, requestRestoreTrashedAssets, restoreTrashedManagedFolder };
}
