import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { isEditableTextTarget } from "../../../shared/edit-context-menu";
import { LibraryOperationError, toMessage } from "../../common/error-utils";
import { translateForLocale } from "../../i18n";
import { appendSemanticCleanupNotice } from "../../ai/semantic-cleanup-notice";
import { type BrowseState } from "../../stores/browse-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type SessionState } from "../../stores/session-store";
import { playTaskCompletionSound } from "../../jobs/task-completion-sound";
import { isUserCancellation, userCancellationNoticeKey } from "../../common/user-cancellation";
import { useCallback } from "react";

export interface UseMoveUndoDeleteDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  moveDialog: DialogsState["moveDialog"];
  setMoveDialog: Dispatch<SetStateAction<DialogsState["moveDialog"]>>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  setError: (text: string | null) => void;
  locale: AppLocale;
  operationHistory: SessionState["operationHistory"];
  setOperationHistory: Dispatch<SetStateAction<SessionState["operationHistory"]>>;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  refreshOperationHistory: () => Promise<void>;
  trashedAssets: BrowseState["trashedAssets"];
  applyLocalAssetRemoval: (assetIds: string[], options?: { removedCount?: number; libraryId?: string; }) => (() => void);
  assets: BrowseState["assets"];
  releaseAssetPreviewsBeforeDiskDelete: () => Promise<void>;
  deleteManagedAssetsFromDisk: (assetIds: string[], locationKind?: "managed" | "linked" | "mixed") => Promise<void>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useMoveUndoDelete({ api, library, moveDialog, setMoveDialog, setUiState, setNotice, t, clearAssetSelection, reloadCurrentContent, setError, locale, operationHistory, setOperationHistory, reloadCurrentContentRef, refreshOperationHistory, trashedAssets, applyLocalAssetRemoval, assets, releaseAssetPreviewsBeforeDiskDelete, deleteManagedAssetsFromDisk }: UseMoveUndoDeleteDeps) {

  async function moveManagedAssets() {
    if (!api || !library || !moveDialog) return;
    const { assetIds, folderIds, targetFolderId, conflictStrategy } = moveDialog;
    setMoveDialog(null);
    setUiState("loading");
    try {
      if (assetIds.length > 0) {
        const result = await api.moveAssets({
          libraryId: library.libraryId,
          assetIds,
          targetFolderId,
          conflictStrategy,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          t("toast.movedCountDetail", { count: result.value.movedCount }) +
            (result.value.skippedCount
              ? t("toast.skippedSuffix", { count: result.value.skippedCount })
              : "") +
            t("common.sentenceEnd"),
          result.value.historyEntryId,
        );
      }
      if (folderIds.length > 0) {
        const folderResult = await api.moveFolders({
          libraryId: library.libraryId,
          folderIds,
          targetParentFolderId: targetFolderId,
          conflictStrategy:
            conflictStrategy === "replace" ? "keep-both" : conflictStrategy,
        });
        if (!folderResult.ok) throw new LibraryOperationError(folderResult.error);
        if (assetIds.length === 0) {
          if (folderResult.value.skippedCount > 0) {
            setNotice(
              t("toast.folderMoveSkipped", {
                moved: folderResult.value.movedCount,
                skipped: folderResult.value.skippedCount,
              }),
              folderResult.value.historyEntryId,
            );
          } else {
            setNotice(
              t("toast.folderMoveDone", {
                count: folderResult.value.movedCount,
              }),
              folderResult.value.historyEntryId,
            );
          }
        }
      }
      clearAssetSelection();
      await reloadCurrentContent();
    } catch (caught) {
      setError(toMessage(caught, t("toast.moveFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  const undoLastFileOp = useCallback(async (expectedHistoryEntryId?: string) => {
    if (isEditableTextTarget(document.activeElement)) {
      document.execCommand("undo");
      return;
    }
    if (!api || !library) return;
    const current = operationHistory?.undoTop;
    const historyEntryId = expectedHistoryEntryId ?? current?.historyEntryId;
    if (!historyEntryId) return;
    setUiState("loading");
    try {
      const result = await api.undoOperationHistory({
        libraryId: library.libraryId,
        expectedHistoryEntryId: historyEntryId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setOperationHistory(result.value);
      setNotice(
        t("toast.historyUndoDone", { count: current?.affectedCount ?? 1 }),
      );
      await reloadCurrentContentRef.current();
    } catch (caught) {
      setError(toMessage(caught, t("toast.historyUndoFailed"), locale));
      await refreshOperationHistory();
    } finally {
      setUiState("ready");
    }
  }, [api, library, locale, operationHistory, refreshOperationHistory, setError, setNotice, t, setOperationHistory, setUiState, reloadCurrentContentRef]);

  const redoLastOperation = useCallback(async () => {
    if (isEditableTextTarget(document.activeElement)) {
      document.execCommand("redo");
      return;
    }
    if (!api || !library) return;
    const current = operationHistory?.redoTop;
    if (!current) return;
    setUiState("loading");
    try {
      const result = await api.redoOperationHistory({
        libraryId: library.libraryId,
        expectedHistoryEntryId: current.historyEntryId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      setOperationHistory(result.value);
      setNotice(t("toast.historyRedoDone", { count: current.affectedCount }));
      await reloadCurrentContentRef.current();
    } catch (caught) {
      setError(toMessage(caught, t("toast.historyRedoFailed"), locale));
      await refreshOperationHistory();
    } finally {
      setUiState("ready");
    }
  }, [api, library, locale, operationHistory, refreshOperationHistory, setError, setNotice, t, setOperationHistory, setUiState, reloadCurrentContentRef]);

  async function deletePermanentFromTrash(assetIds: string[]): Promise<boolean> {
    if (!api || !library || assetIds.length === 0) return false;
    const startedAt = Date.now();
    setUiState("loading");
    try {
      const result = await api.deleteAssetsPermanent({
        libraryId: library.libraryId,
        assetIds,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      let msg = t("toast.permanentDeleted", {
        count: result.value.deletedCount,
      });
      msg = appendSemanticCleanupNotice(msg, result.value.semanticCleanupPending === true,
        t("toast.semanticCleanupPending"));
      if (result.value.skippedCount > 0) {
        const skippedNames = new Map(
          trashedAssets.map((asset) => [asset.assetId, asset.displayName]),
        );
        msg += t("toast.permanentDeleteSkipped", {
          count: result.value.skippedCount,
          reasons: result.value.skippedReasons
            .map(({ assetId, reason }) =>
              t("toast.permanentDeleteItem", {
                name: skippedNames.get(assetId) ?? t("toast.selectedAsset"),
                reason: translateForLocale(locale, `error.reason.${reason}`),
              }),
            )
            .join("；"),
        });
      }
      setNotice(msg);
      clearAssetSelection();
      applyLocalAssetRemoval(assetIds, {
        removedCount: result.value.deletedCount,
      });
      playTaskCompletionSound(startedAt);
      return true;
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      if (isUserCancellation(caught)) {
        setNotice(t(userCancellationNoticeKey("permanentDelete")));
        return false;
      }
      setError(toMessage(caught, t("toast.permanentDeleteFailed"), locale));
      return false;
    } finally {
      setUiState("ready");
    }
  }

  function requestAssetDiskDelete(
    assetIds: string[],
    locationKind?: "managed" | "linked" | "mixed",
  ) {
    if (assetIds.length === 0) return;
    void deleteManagedAssetsFromDiskAfterClosingPreview(assetIds, locationKind);
  }

  /**
   * 2026-09-15：主进程弹「确认危险操作」时需要按操作本身的语义写文案——链接资产的
   * 源文件会被永久删除（不再送系统回收站），必须点明，不能沿用托管资产的通用说法。
   * 渲染层知道当前列表的 locationKind，主进程没有数据库访问，因此这里只作为「文案
   * 提示」随请求下发；真正的删除分流仍由 Worker 依 assets.location_kind 决定。
   */
  function assetSelectionLocationKind(
    assetIds: string[],
  ): "managed" | "linked" | "mixed" {
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
    let linked = 0;
    for (const assetId of assetIds) {
      if (byId.get(assetId)?.locationKind === "linked") linked += 1;
    }
    if (linked === 0) return "managed";
    return linked === assetIds.length ? "linked" : "mixed";
  }

  async function setIgnoreState(input: {
    locationKind: "managed" | "linked";
    linkedFolderId?: string | null;
    relativePath: string;
    pathKind: "asset" | "folder" | "extension";
    ignored: boolean;
    name: string;
  }) {
    if (!api || !library) return;
    try {
      const result = await api.setIgnore({
        libraryId: library.libraryId,
        locationKind: input.locationKind,
        linkedFolderId: input.linkedFolderId,
        relativePath: input.relativePath,
        pathKind: input.pathKind,
        ignored: input.ignored,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await reloadCurrentContent();
      if (input.ignored && input.pathKind === "extension") {
        setNotice(t("toast.ignoreExtensionUpdated", { extension: input.relativePath }));
        return;
      }
      setNotice(t("toast.ignoreUpdated", {
        action: input.ignored
          ? input.pathKind === "folder"
            ? t("menu.ignoreFolder")
            : t("menu.ignore")
          : t("menu.unignore"),
        name: input.name,
      }));
    } catch (caught) {
      setError(toMessage(caught, t("toast.ignoreFailed"), locale));
    }
  }

  async function deleteManagedAssetsFromDiskAfterClosingPreview(
    assetIds: string[],
    locationKind?: "managed" | "linked" | "mixed",
  ) {
    await releaseAssetPreviewsBeforeDiskDelete();
    await deleteManagedAssetsFromDisk(assetIds, locationKind);
  }
  return { assetSelectionLocationKind, requestAssetDiskDelete, deletePermanentFromTrash, undoLastFileOp, redoLastOperation, moveManagedAssets, setIgnoreState };
}
