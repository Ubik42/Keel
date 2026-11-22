import { requestConfirmation } from "../common/local-confirmation";
import type { LinkedFolderSummary, TagSummary } from "../../shared/asset-types";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { RendererLibrarySummary } from "../../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "../common/error-utils";
import { formatBatchTagNotice } from "../tags/batch-tag-notice";
import { translateForLocale, useLocale } from "../i18n";
import { appendSemanticCleanupNotice } from "../ai/semantic-cleanup-notice";

export interface UseBatchActionsParams {
  api: KeelLibraryApi | null;
  library: RendererLibrarySummary | null;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  setTags: (tags: TagSummary[]) => void;
  setNotice: (msg: string, historyEntryId?: string) => void;
  setError: (msg: string | null) => void;
  reloadCurrentContent: () => Promise<void>;
  /**
   * Keel-关联刷新: remove the deleted asset ids from the visible list and
   * adjust scope counts locally, deferring the expensive full reload to the
   * background. Deleting a linked asset used to wait for a whole searchAssets
   * round trip (~10s on large libraries) before the card disappeared.
   */
  applyLocalAssetRemoval: (
    assetIds: string[],
    options?: { removedCount?: number; libraryId?: string },
  ) => () => void;
  /** Prevent late read/UI callbacks from an old library crossing a switch. */
  isCurrentLibrary: (libraryId: string) => boolean;
  chooseTag: (tagId: string) => Promise<void>;
  clearAssetSelection: () => void;
  activeTagId: string | null;
  onTagsChanged?: (
    action: "assign" | "remove",
    tagId: string,
    assetIds: readonly string[],
  ) => void;
}

export interface UseBatchActionsResult {
  batchAssignTagToSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  batchRemoveTagFromSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  deleteManagedAssetsFromDisk: (
    assetIds: string[],
    locationKind?: 'managed' | 'linked' | 'mixed',
  ) => Promise<void>;
  copyManagedSelectionToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => Promise<void>;
}

export function useBatchActions({
  api,
  library,
  setUiState,
  setTags,
  setNotice,
  setError,
  reloadCurrentContent,
  applyLocalAssetRemoval,
  isCurrentLibrary,
  chooseTag,
  clearAssetSelection,
  activeTagId,
  onTagsChanged,
}: UseBatchActionsParams): UseBatchActionsResult {
  const { locale } = useLocale();

  async function batchAssignTagToSelection(tagId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.assignTags({
        libraryId: library.libraryId,
        assetIds,
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      const skipped = new Set(result.value.skipped.map((item) => item.assetId));
      onTagsChanged?.(
        "assign",
        tagId,
        assetIds.filter((assetId) => !skipped.has(assetId)),
      );
      setNotice(
        formatBatchTagNotice(
          "assign",
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
        result.value.historyEntryId,
      );
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchAssignTagFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function batchRemoveTagFromSelection(tagId: string, assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    setUiState("loading");
    try {
      const result = await api.removeTags({
        libraryId: library.libraryId,
        assetIds,
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (tagResult.ok) setTags(tagResult.value);
      const skipped = new Set(result.value.skipped.map((item) => item.assetId));
      onTagsChanged?.(
        "remove",
        tagId,
        assetIds.filter((assetId) => !skipped.has(assetId)),
      );
      if (activeTagId === tagId) {
        await chooseTag(tagId);
      }
      // review: tag removals do not broadcast asset.changed, and
      // the tag-filter overlay keeps its filter after the removal — reload the
      // current content so a filtered scope empties immediately instead of
      // showing stale cards until the next navigation.
      await reloadCurrentContent();
      setNotice(
        formatBatchTagNotice(
          "remove",
          assetIds.length - result.value.skipped.length,
          result.value.skipped,
          locale,
        ),
        result.value.historyEntryId,
      );
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.batchRemoveTagFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function trashManagedAssets(assetIds: string[]) {
    if (!api || !library) return undefined;
    const operationLibraryId = library.libraryId;
    // the Worker must still finish the durable trash/history
    // transaction before we report success, but the visible cards do not need
    // to wait for that round trip.  Remove them optimistically and reconcile
    // immediately if the mutation fails; otherwise large-library deletes can
    // leave the user staring at cards for several seconds.
    const optimisticallyRemoved = assetIds.length > 0;
    let restoreLocalRemoval: (() => void) | undefined;
    setUiState("loading");
    if (optimisticallyRemoved) {
      clearAssetSelection();
      restoreLocalRemoval = applyLocalAssetRemoval(assetIds, {
        libraryId: operationLibraryId,
      });
    }
    try {
      const result = await api.trashAssets({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (!isCurrentLibrary(operationLibraryId)) {
        return result.value.historyEntryId;
      }
      setNotice(
        translateForLocale(locale, "toast.batchTrashed", {
          count: result.value.trashedCount,
        }),
        result.value.historyEntryId,
      );
      // A concurrent mutation can make the durable count smaller than the
      // optimistic selection.  Re-read the current scope in that uncommon
      // case instead of leaving an under-counted view until navigation.
      if (
        isCurrentLibrary(operationLibraryId) &&
        result.value.trashedCount !== assetIds.length
      ) {
        await reloadCurrentContent();
      }
      if (!isCurrentLibrary(operationLibraryId)) return result.value.historyEntryId;
      return result.value.historyEntryId;
    } catch (caught) {
      if (optimisticallyRemoved && isCurrentLibrary(operationLibraryId)) {
        // Restore cards/counts when the durable operation failed.  The
        // background reconcile scheduled by applyLocalAssetRemoval is safe to
        // leave in place and will converge the view once more.
        try {
          await reloadCurrentContent();
        } catch {
          // A failed reload must not leave the optimistic removal silently in
          // place. Restore the exact pre-delete snapshot and surface both
          // failures so the user knows the view is authoritative again.
          restoreLocalRemoval?.();
        }
      }
      if (isCurrentLibrary(operationLibraryId)) {
        setError(
          toMessage(
            caught,
            translateForLocale(locale, "toast.batchDeleteFailed"),
            locale,
          ),
        );
      }
      return undefined;
    } finally {
      if (isCurrentLibrary(operationLibraryId)) setUiState("ready");
    }
  }

  async function deleteManagedAssetsFromDisk(
    assetIds: string[],
    locationKind?: 'managed' | 'linked' | 'mixed',
  ) {
    if (!api || !library || assetIds.length === 0) return;
    const operationLibraryId = library.libraryId;
    setUiState("loading");
    try {
      const result = await api.deleteAssetsFromDisk({
        libraryId: library.libraryId,
        assetIds,
        locationKind,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(translateForLocale(locale, "toast.diskDeleteCancelled"));
          if (!isCurrentLibrary(operationLibraryId)) return;
          await reloadCurrentContent();
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setNotice(
        appendSemanticCleanupNotice(translateForLocale(locale, "toast.assetsDeletedFromDisk", {
          count: result.value.deletedCount,
        }), result.value.semanticCleanupPending === true,
        translateForLocale(locale, "toast.semanticCleanupPending")),
      );
      if (!isCurrentLibrary(operationLibraryId)) return;
      clearAssetSelection();
      applyLocalAssetRemoval(assetIds, {
        removedCount: result.value.deletedCount,
        libraryId: operationLibraryId,
      });
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.assetsDeleteFromDiskFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  async function copyManagedSelectionToLinked(
    folder: LinkedFolderSummary,
    assetIds: string[],
  ) {
    if (!api || !library || assetIds.length === 0) return;
    if (
      !await requestConfirmation(
        translateForLocale(locale, "toast.copyToExternalConfirm", {
          count: assetIds.length,
          name: folder.displayName,
        }),
      )
    )
      return;
    if (!isCurrentLibrary(library.libraryId)) return;
    setUiState("importing");
    try {
      const result = await api.copyAssetsToLinkedFolder({
        libraryId: library.libraryId,
        folderId: folder.linkedFolderId ?? folder.folderId,
        ...(folder.relativePath ? { relativePath: folder.relativePath } : {}),
        assetIds,
        conflictStrategy: "keep-both",
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setNotice(
        translateForLocale(locale, "toast.copyToExternalDone", {
          count: result.value.copiedCount,
          skipped: result.value.skippedCount,
        }),
      );
      await reloadCurrentContent();
    } catch (caught) {
      setError(
        toMessage(
          caught,
          translateForLocale(locale, "toast.copyToExternalFailed"),
          locale,
        ),
      );
    } finally {
      setUiState("ready");
    }
  }

  return {
    batchAssignTagToSelection,
    batchRemoveTagFromSelection,
    trashManagedAssets,
    deleteManagedAssetsFromDisk,
    copyManagedSelectionToLinked,
  };
}
