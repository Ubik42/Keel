import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { AppLocale } from "../../i18n/types";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { LibraryTransitionLock } from "../../library/library-transition-lock";
import { type SearchScope } from "../../../shared/asset-types";
import { type RendererLibrarySummary } from "../../../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "../../common/error-utils";
import { translateForLocale } from "../../i18n";
import { shouldSuppressImportContinueError } from "../../import/import-conflict-submit";
import { appendSemanticCleanupNotice } from "../../ai/semantic-cleanup-notice";
import { type BrowseState } from "../../stores/browse-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type AssetScope } from "../../stores/navigation-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { transfersFields, type TransfersState } from "../../stores/transfers-store";
import { playTaskCompletionSound } from "../../jobs/task-completion-sound";
import { isUserCancellation, userCancellationNoticeKey } from "../../common/user-cancellation";
import { type SearchDefinition, renderedLibrary } from "../shared/app-shared";
import { useRelinkOperations } from "../organize/use-relink-operations";

export interface UseTransferOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  locale: AppLocale;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  setError: (text: string | null) => void;
  selectedAssetId: SelectionState["selectedAssetId"];
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  batchRelinkKeepMetadata: TransfersState["batchRelinkKeepMetadata"];
  setBatchRelinkPreview: Dispatch<SetStateAction<TransfersState["batchRelinkPreview"]>>;
  batchRelinkPreview: TransfersState["batchRelinkPreview"];
  exportStartedAtRef: RefObject<number | null>;
  setExportDialogOpen: Dispatch<SetStateAction<DialogsState["exportDialogOpen"]>>;
  setExportProgress: Dispatch<SetStateAction<TransfersState["exportProgress"]>>;
  exportProgress: TransfersState["exportProgress"];
  deleteProgress: TransfersState["deleteProgress"];
  conflicts: TransfersState["conflicts"];
  abandonConflicts: () => Promise<void>;
  setImportInterrupt: Dispatch<SetStateAction<TransfersState["importInterrupt"]>>;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  imageSequenceImportOffer: TransfersState["imageSequenceImportOffer"];
  setImageSequenceImportOffer: Dispatch<SetStateAction<TransfersState["imageSequenceImportOffer"]>>;
  setImageSequenceImportError: Dispatch<SetStateAction<TransfersState["imageSequenceImportError"]>>;
  importProgress: TransfersState["importProgress"];
  setLibraryTransferKind: Dispatch<SetStateAction<TransfersState["libraryTransferKind"]>>;
  setLibraryTransferName: Dispatch<SetStateAction<TransfersState["libraryTransferName"]>>;
  completedImportIdRef: RefObject<string | null>;
  runCurrentImportRpc: <T>(work: () => Promise<T>) => Promise<T>;
  setImportValidated: Dispatch<SetStateAction<TransfersState["importValidated"]>>;
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  libraryTransitionLock: LibraryTransitionLock;
  confirmLibrarySwitch: (keepDestinationChoice?: boolean) => Promise<boolean>;
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  beginLibraryTransition: () => Readonly<{ libraryId: string | null; generation: number; }>;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  clearLibraryScopedView: () => void;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  activateLibraryView: (libraryId: string) => Readonly<{ libraryId: string | null; generation: number; }>;
  clearDiscoveryControls: () => void;
  markLibraryClosePending: (libraryId: string) => number;
  setWarning: (text: string | null) => void;
  clearLibraryClosePending: (libraryId: string, generation: number) => void;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  importValidated: TransfersState["importValidated"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useTransferOperations({ api, library, setUiState, locale, setNotice, t, loadContent, setError, selectedAssetId, setAssets, reloadCurrentContent, batchRelinkKeepMetadata, setBatchRelinkPreview, batchRelinkPreview, exportStartedAtRef, setExportDialogOpen, setExportProgress, exportProgress, deleteProgress, conflicts, abandonConflicts, setImportInterrupt, setImportProgress, imageSequenceImportOffer, setImageSequenceImportOffer, setImageSequenceImportError, importProgress, setLibraryTransferKind, setLibraryTransferName, completedImportIdRef, runCurrentImportRpc, setImportValidated, showBlockingError, libraryTransitionLock, confirmLibrarySwitch, setLibraryLoading, beginLibraryTransition, closeAssetPreview, clearLibraryScopedView, setLibrary, activateLibraryView, clearDiscoveryControls, markLibraryClosePending, setWarning, clearLibraryClosePending, refreshRecentLibraries, importValidated }: UseTransferOperationsDeps) {

  async function emptyTrash() {
    if (!api || !library) return;
    const startedAt = Date.now();
    setUiState("loading");
    try {
      const result = await api.purgeTrash({ libraryId: library.libraryId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const failureReasons = [
        ...new Set(
          result.value.failures.map(({ reason }) =>
            translateForLocale(locale, `error.reason.${reason}`),
          ),
        ),
      ];
      setNotice(
        t("toast.emptyTrashDone", { count: result.value.purgedCount }) +
          (result.value.skippedCount > 0
            ? t("toast.emptyTrashSkipped", {
                count: result.value.skippedCount,
                reasons: failureReasons.join("；"),
              })
            : "") +
          appendSemanticCleanupNotice("", result.value.semanticCleanupPending === true,
            t("toast.semanticCleanupPending")) +
          t("common.sentenceEnd"),
      );
      await loadContent(library, "all", { trashMode: true });
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      if (isUserCancellation(caught)) {
        setNotice(t(userCancellationNoticeKey("emptyTrash")));
        return;
      }
      setError(toMessage(caught, t("toast.emptyTrashFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }
  const { cancelBatchRelink, startBatchRelink, applyBatchRelink, relinkMissingAsset } = useRelinkOperations({ selectedAssetId, api, library, setUiState, setAssets, setNotice, t, reloadCurrentContent, batchRelinkKeepMetadata, setBatchRelinkPreview, setError, locale, batchRelinkPreview });

  // --- Export / Import operations ---

  async function exportLibrary(format: "folder" | "zip", includeLinkedContent: boolean) {
    if (!api || !library) return;
    exportStartedAtRef.current = Date.now();
    setExportDialogOpen(false);
    setExportProgress({
      type: "export.progress",
      exportId: "",
      libraryId: library.libraryId,
      phase: "snapshot-db",
      filesProcessed: 0,
      totalFiles: 0,
      bytesProcessed: 0,
      totalBytes: 0,
    });
    try {
      const result = await api.exportLibrary({
        libraryId: library.libraryId,
        libraryName: library.displayName,
        includeLinkedContent,
        format,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          // folder/save dialog cancel must clear the optimistic strip.
          setExportProgress(null);
          exportStartedAtRef.current = null;
          setNotice(t("toast.exportCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
      }
    } catch (caught) {
      const startedAt = exportStartedAtRef.current;
      exportStartedAtRef.current = null;
      setExportProgress(null);
      if (startedAt !== null) playTaskCompletionSound(startedAt);
      setError(toMessage(caught, t("toast.exportFailed"), locale));
    } finally {
      setTimeout(() => {
        setExportProgress((prev) => {
          if (
            !prev ||
            prev.phase === "complete" ||
            prev.phase === "cancelled" ||
            prev.phase === "failed"
          ) {
            return null;
          }
          // Still running after the dialog returned — keep showing until events settle.
          return prev;
        });
      }, 4000);
    }
  }

  async function cancelExport() {
    if (!api || !exportProgress?.exportId) return;
    try {
      const result = await api.cancelLibraryExport({
        exportId: exportProgress.exportId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(t("toast.cancellingExport"));
      exportStartedAtRef.current = null;
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelExportFailed"), locale));
    }
  }

  async function cancelDiskDelete() {
    if (!api || !deleteProgress?.operationId) return;
    try {
      const result = await api.cancelDiskDelete({
        operationId: deleteProgress.operationId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(t("toast.cancellingDiskDelete"));
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelDiskDeleteFailed"), locale));
    }
  }

  async function cancelImport(mode: "abandon" | "stop" = "abandon") {
    if (!api) return;
    if (conflicts) {
      await abandonConflicts();
      setImportInterrupt(null);
      setImportProgress(null);
      return;
    }
    if (imageSequenceImportOffer) {
      setImageSequenceImportOffer(null);
      setImageSequenceImportError(null);
      setImportInterrupt(null);
      setImportProgress(null);
      return;
    }
    if (!importProgress?.importId) {
      setImportInterrupt(null);
      setImportProgress(null);
      setLibraryTransferKind("import");
      setLibraryTransferName("");
      return;
    }
    const current = transfersFields.get("importInterrupt");
    if (current === "abandon") return;
    if (current === "stop" && mode === "stop") return;
    const firstRequest = current === null;
    setImportInterrupt(mode);
    if (firstRequest || mode === "abandon") {
      setNotice(
        t(mode === "stop" ? "toast.stoppingImport" : "toast.cancellingImport"),
      );
    }
    const importId = importProgress.importId;
    try {
      const result = await api.cancelLibraryImport({
        importId,
        mode,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
    } catch (caught) {
      const code = caught instanceof LibraryOperationError ? caught.code : "";
      if (
        shouldSuppressImportContinueError({
          code,
          importId,
          completedImportId: completedImportIdRef.current,
          isInFlightRequest: true,
        })
      ) {
        setImportInterrupt(null);
        setImportProgress(null);
        setLibraryTransferKind("import");
        return;
      }
      setError(toMessage(caught, t("toast.cancelImportFailed"), locale));
      setImportInterrupt(null);
    }
  }

  async function startImport() {
    if (!api) return;
    try {
      const result = await runCurrentImportRpc(() => api.importLibrary());
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setImportProgress(null);
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportValidated(result.value);
      setImportProgress(null);
    } catch (caught) {
      showBlockingError(
        t("dialog.blockingError.importValidateFailed"),
        toMessage(caught, t("toast.importValidateFailed"), locale),
      );
      setImportProgress(null);
    }
  }

  async function startImportZip() {
    if (!api) return;
    const startedAt = Date.now();
    try {
      const result = await runCurrentImportRpc(() => api.importLibraryZip());
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setImportProgress(null);
          setNotice(t("toast.importCancelled"));
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setImportProgress(null);
      if (await activateImportedLibrary(result.value)) {
        playTaskCompletionSound(startedAt);
      }
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.zipImportFailed"), locale),
      );
      setImportProgress(null);
    }
  }

  async function activateImportedLibrary(imported: { libraryId: string }): Promise<boolean> {
    if (!api) {
      throw new Error(t("toast.bridgeUnavailable"));
    }
    // The zip import itself is a tracked write. If the user requested a
    // library transition while it was running, do not let its late
    // activation overwrite the library the user chose next.
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) {
      return false;
    }
    let activated = false;
    await libraryTransitionLock(async () => {
      try {
        setLibraryLoading({ name: null });
        const openResult = await api.listOpen();
        if (!openResult.ok) throw new LibraryOperationError(openResult.error);
        const summary =
          openResult.value.find((entry) => entry.libraryId === imported.libraryId) ??
          null;
        if (!summary) {
          throw new Error(t("toast.importFailed"));
        }
        const previousLibraryId = renderedLibrary.current?.libraryId;
        beginLibraryTransition();
        await closeAssetPreview(false);
        clearLibraryScopedView();
        renderedLibrary.current = summary;
        activateLibraryView(summary.libraryId);
        setLibrary(summary);
        setLibraryLoading({ name: summary.displayName });
        clearDiscoveryControls();
        api.setActiveContext(summary.libraryId);
        const firstPagePromise = loadContent(summary, "all", {
          navigationPriority: "library-switch",
          blockingLibraryLoad: true,
        });
        const previousLibraryWillClose =
          previousLibraryId !== undefined &&
          previousLibraryId !== summary.libraryId;
        const previousCloseGeneration = previousLibraryWillClose
          ? markLibraryClosePending(previousLibraryId!)
          : undefined;
        const previousClosePromise = previousLibraryWillClose
          ? api.close({ libraryId: previousLibraryId! })
          : undefined;
        if (previousClosePromise) {
          void previousClosePromise
            .then((closeResult) => {
              if (!closeResult.ok) {
                setWarning(t("toast.previousLibraryCloseFailed"));
              }
            })
            .catch(() => {
              setWarning(t("toast.previousLibraryCloseFailed"));
            })
            .finally(() => {
              if (previousCloseGeneration !== undefined) {
                clearLibraryClosePending(
                  previousLibraryId!,
                  previousCloseGeneration,
                );
              }
            });
        }
        await firstPagePromise;
        await refreshRecentLibraries(summary.displayPath);
        activated = true;
        setNotice(t("toast.libraryImportComplete", { name: summary.displayName }));
      } finally {
        setLibraryLoading(null);
        setUiState(activated ? "ready" : "idle");
      }
    });
    return activated;
  }

  async function completeImportCopy() {
    if (!api || !importValidated) return;
    // the validated dialog must disappear the moment the import
    // starts; the blocking import overlay is the only indicator from here until completion.
    const validated = importValidated;
    const startedAt = Date.now();
    setImportValidated(null);
    try {
      const result = await runCurrentImportRpc(async () => {
        setImportProgress({
          type: "import.progress",
          importId: validated.importId,
          phase: "copy",
          filesProcessed: 0,
          totalFiles: 0,
          bytesProcessed: 0,
          totalBytes: 0,
        });
        return api.importLibraryCopy({
          importId: validated.importId,
        });
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(t("toast.importCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
        return;
      }
      setImportProgress(null);
      if (await activateImportedLibrary(result.value)) {
        playTaskCompletionSound(startedAt);
      }
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
      setImportProgress(null);
    }
  }

  async function completeImportInPlace() {
    if (!api || !importValidated) return;
    // same immediate-dismissal contract as completeImportCopy —
    // the validated dialog closes as soon as the import starts and the
    // persistent activity strip (正在导入资源库) becomes the only indicator.
    const validated = importValidated;
    const startedAt = Date.now();
    setImportValidated(null);
    try {
      const result = await runCurrentImportRpc(async () => {
        setImportProgress({
          type: "import.progress",
          importId: validated.importId,
          phase: "open",
          filesProcessed: 0,
          totalFiles: 0,
          bytesProcessed: 0,
          totalBytes: 0,
        });
        return api.importLibraryOpenInPlace({
          importId: validated.importId,
        });
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(t("toast.importCancelled"));
        } else {
          throw new LibraryOperationError(result.error);
        }
        return;
      }
      setImportProgress(null);
      if (await activateImportedLibrary(result.value)) {
        playTaskCompletionSound(startedAt);
      }
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.libraryImportFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
      setImportProgress(null);
    }
  }
  return { cancelBatchRelink, cancelImport, cancelDiskDelete, cancelExport, emptyTrash, startBatchRelink, exportLibrary, startImport, startImportZip, completeImportCopy, completeImportInPlace, applyBatchRelink, relinkMissingAsset };
}
