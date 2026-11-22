import type { Dispatch, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { LibraryOperationError, toMessage } from "../../error-utils";
import { appendSemanticCleanupNotice } from "../../semantic-cleanup-notice";
import { type SessionState } from "../../stores/session-store";
import { playTaskCompletionSound } from "../../task-completion-sound";

export interface UseSelectionDiskDeleteDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  releaseAssetPreviewsBeforeDiskDelete: () => Promise<void>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  applyLocalAssetRemoval: (assetIds: string[], options?: { removedCount?: number; libraryId?: string; }) => (() => void);
  setError: (text: string | null) => void;
  locale: AppLocale;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useSelectionDiskDelete({ api, library, releaseAssetPreviewsBeforeDiskDelete, setUiState, setNotice, t, reloadCurrentContent, clearAssetSelection, applyLocalAssetRemoval, setError, locale }: UseSelectionDiskDeleteDeps) {

  async function executeSelectionDiskDelete(
    assetIds: string[],
    folderIds: readonly string[],
    locationKind: "managed" | "linked" | "mixed" = "managed",
  ) {
    if (!api || !library) return;
    if (assetIds.length === 0 && folderIds.length === 0) return;
    const startedAt = Date.now();
    await releaseAssetPreviewsBeforeDiskDelete();
    setUiState("loading");
    try {
      let deletedAssets = 0;
      let deletedFolders = 0;
      let semanticCleanupPending = false;
      if (assetIds.length > 0) {
        const result = await api.deleteAssetsFromDisk({
          libraryId: library.libraryId,
          assetIds,
          locationKind,
        });
        if (!result.ok) {
          if (result.error.code === "CANCELLED") {
            setNotice(t("toast.diskDeleteCancelled"));
            await reloadCurrentContent({ blockingNavigation: false });
            return;
          }
          throw new LibraryOperationError(result.error);
        }
        deletedAssets = result.value.deletedCount;
        semanticCleanupPending = result.value.semanticCleanupPending === true;
      }
      for (const folderId of folderIds) {
        const result = await api.deleteFolderFromDisk({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        deletedFolders += 1;
        deletedAssets += result.value.deletedAssetCount;
      }
      setNotice(
        appendSemanticCleanupNotice(t("toast.selectionDeletedFromDisk", {
          folders: deletedFolders,
          assets: deletedAssets,
        }), semanticCleanupPending, t("toast.semanticCleanupPending")),
      );
      clearAssetSelection();
      applyLocalAssetRemoval(assetIds, { removedCount: deletedAssets });
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      if (caught instanceof LibraryOperationError && caught.code === "CANCELLED") {
        setNotice(t("toast.diskDeleteCancelled"));
        await reloadCurrentContent({ blockingNavigation: false });
        return;
      }
      setError(toMessage(caught, t("toast.folderDeleteFromDiskFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }
  return { executeSelectionDiskDelete };
}
