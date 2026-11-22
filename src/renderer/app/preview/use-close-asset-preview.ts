import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkspaceNavHistory } from "../../workbench/workspace/workspace-nav-history";
import type { KeelLibraryApi } from "../../../shared/library-api";
import { logBrowseScrollWrite, shouldApplyRestoredFocusScroll } from "../../browse/browse-scroll-debug";
import { scheduleBrowseViewRestore } from "../../browse/browse-view-restore-scheduler";
import { type PreviewState } from "../../stores/preview-store";
import { type SessionState } from "../../stores/session-store";
import { type WorkspaceState } from "../../stores/workspace-store";
import { type BrowseViewSnapshot } from "../../workbench/collection/view-restore";
import { type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { useCallback } from "react";
import { flushSync } from "react-dom";

export interface UseCloseAssetPreviewDeps {
  cancelPreviewViewRestoreRef: RefObject<(() => void) | null>;
  previewRestoreFrameRef: RefObject<number | null>;
  previewAsset: PreviewState["previewAsset"];
  closingPreviewRef: RefObject<string | null>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  syncActiveWorkspaceTabLocation: () => void;
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  previewCloseGenerationRef: RefObject<number>;
  previewRestoringRef: RefObject<boolean>;
  setPreviewRestoring: Dispatch<SetStateAction<PreviewState["previewRestoring"]>>;
  setPreviewCanvasReady: Dispatch<SetStateAction<PreviewState["previewCanvasReady"]>>;
  setPreviewAsset: Dispatch<SetStateAction<PreviewState["previewAsset"]>>;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  pendingViewportRestoreRef: RefObject<WorkspaceNavViewport | null>;
  previewFocusReturnRef: RefObject<string | null>;
  previewScrollSnapshotRef: RefObject<BrowseViewSnapshot | null>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  lastPreviewRestoredTopRef: RefObject<number>;
  armPreviewScrollHold: (restoredTop: number) => void;
  clearPreviewScrollHold: () => void;
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useCloseAssetPreview({ cancelPreviewViewRestoreRef, previewRestoreFrameRef, previewAsset, closingPreviewRef, navHistoryRef, syncActiveWorkspaceTabLocation, setNavHistoryUi, previewCloseGenerationRef, previewRestoringRef, setPreviewRestoring, setPreviewCanvasReady, setPreviewAsset, cancelWorkspaceViewportRestoreRef, pendingViewportRestoreRef, previewFocusReturnRef, previewScrollSnapshotRef, workspaceCanvasRef, lastPreviewRestoredTopRef, armPreviewScrollHold, clearPreviewScrollHold, api, library }: UseCloseAssetPreviewDeps) {

  const closeAssetPreview = useCallback(async (
    restoreBrowsePosition = true,
    updateHistory = true,
  ) => {
    // A scope transition can arrive after React has already cleared
    // `previewAsset` but before browse restoration finishes. Cancel that
    // stale restoration even when there is no longer an asset to close,
    // otherwise the previous scope can scroll/focus the newly selected scope.
    if (!restoreBrowsePosition) {
      cancelPreviewViewRestoreRef.current?.();
      cancelPreviewViewRestoreRef.current = null;
      if (previewRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(previewRestoreFrameRef.current);
        previewRestoreFrameRef.current = null;
      }
    }
    const closingAsset = previewAsset;
    if (!closingAsset) return;
    if (closingPreviewRef.current === closingAsset.assetId) return;
    // 查看器被关闭时（无论 X/Esc 显式关还是导航触发），若当前
    // 历史条目仍是 preview 则硬移除——否则「从预览导航到别处」会残留一个已关闭
    // 的 preview，导致 back 回到它。back()/forward() 已移 index（当前非 preview）
    // 或导航 push 会截断，不在此重复处理。
    if (updateHistory && navHistoryRef.current.current.kind === "preview") {
      navHistoryRef.current.dismissCurrent();
      syncActiveWorkspaceTabLocation();
      setNavHistoryUi({
        canBack: navHistoryRef.current.canBack,
        canForward: navHistoryRef.current.canForward,
      });
    }
    const closeGeneration = ++previewCloseGenerationRef.current;
    closingPreviewRef.current = closingAsset.assetId;
    previewRestoringRef.current = restoreBrowsePosition;
    // Commit the viewer teardown before measuring the browse extent. Measuring
    // the still-open viewer restores against stale geometry; its next commit
    // can then clamp a deep scroll back to zero.
    flushSync(() => {
      setPreviewRestoring(restoreBrowsePosition);
      setPreviewCanvasReady(false);
      setPreviewAsset(null);
    });
    cancelWorkspaceViewportRestoreRef.current?.();
    cancelWorkspaceViewportRestoreRef.current = null;
    pendingViewportRestoreRef.current = null;
    const assetId = previewFocusReturnRef.current;
    const scrollSnapshot = previewScrollSnapshotRef.current;
    previewFocusReturnRef.current = null;
    previewScrollSnapshotRef.current = null;
    cancelPreviewViewRestoreRef.current?.();
    cancelPreviewViewRestoreRef.current = null;
    if (previewRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(previewRestoreFrameRef.current);
      previewRestoreFrameRef.current = null;
    }
    const settleRestoredFocus = (remaining: number): void => {
      if (closeGeneration !== previewCloseGenerationRef.current) return;
      const currentCanvas = workspaceCanvasRef.current;
      const restoredFocusTarget = currentCanvas?.querySelector<HTMLElement>(
        `[data-asset-id="${assetId ?? ""}"]`,
      );
      if (currentCanvas && restoredFocusTarget) {
        const canvasRect = currentCanvas.getBoundingClientRect();
        const cardRect = restoredFocusTarget.getBoundingClientRect();
        const cardIsVisible =
          cardRect.bottom > canvasRect.top &&
          cardRect.top < canvasRect.bottom &&
          cardRect.right > canvasRect.left &&
          cardRect.left < canvasRect.right;
        if (!cardIsVisible) {
          const cardTop =
            currentCanvas.scrollTop + cardRect.top - canvasRect.top;
          const cardBottom = cardTop + cardRect.height;
          const nextTop =
            cardTop < currentCanvas.scrollTop
              ? cardTop
              : cardBottom > currentCanvas.scrollTop + currentCanvas.clientHeight
                ? cardBottom - currentCanvas.clientHeight
                : currentCanvas.scrollTop;
          if (
            shouldApplyRestoredFocusScroll(
              lastPreviewRestoredTopRef.current,
              nextTop,
              currentCanvas.clientHeight,
            )
          ) {
            currentCanvas.scrollTo({
              left: Math.max(
                0,
                currentCanvas.scrollLeft + cardRect.left - canvasRect.left,
              ),
              top: Math.max(0, nextTop),
            });
          } else {
            logBrowseScrollWrite("settleRestoredFocus.skipped", currentCanvas, {
              nextTop: Math.round(nextTop),
              restoredTop: Math.round(lastPreviewRestoredTopRef.current),
            });
          }
        }
        if (remaining <= 0) {
          restoredFocusTarget.focus({ preventScroll: true });
          previewRestoreFrameRef.current = null;
          return;
        }
      } else if (!currentCanvas || remaining <= 0) {
        previewRestoreFrameRef.current = null;
        return;
      }
      previewRestoreFrameRef.current = window.requestAnimationFrame(() =>
        settleRestoredFocus(remaining - 1),
      );
    };
    if (restoreBrowsePosition) {
      const canvas = workspaceCanvasRef.current;
      if (canvas && scrollSnapshot) {
        armPreviewScrollHold(scrollSnapshot.scrollTop);
        logBrowseScrollWrite("closeAssetPreview.restore", canvas, {
          snapshotTop: Math.round(scrollSnapshot.scrollTop),
        });
        // REQ-VIEW-008: wait until the live extent can hold
        // the captured offset. Two frames used to clamp a collapsed canvas
        // to scrollTop 0 and treat that as done.
        cancelPreviewViewRestoreRef.current = scheduleBrowseViewRestore({
          canvas,
          snapshot: scrollSnapshot,
          isCurrent: () => closeGeneration === previewCloseGenerationRef.current,
          onPositionReady: () => {
            if (closeGeneration === previewCloseGenerationRef.current) {
              setPreviewCanvasReady(true);
            }
          },
          onComplete: () => {
            if (closeGeneration !== previewCloseGenerationRef.current) return;
            cancelPreviewViewRestoreRef.current = null;
            armPreviewScrollHold(scrollSnapshot.scrollTop);
            previewRestoringRef.current = false;
            setPreviewRestoring(false);
            setPreviewCanvasReady(false);
            previewRestoreFrameRef.current = window.requestAnimationFrame(() =>
              settleRestoredFocus(12),
            );
          },
        });
      } else {
        previewRestoringRef.current = false;
        setPreviewRestoring(false);
        setPreviewCanvasReady(false);
        previewRestoreFrameRef.current = window.requestAnimationFrame(() =>
          settleRestoredFocus(12),
        );
      }
    }
    if (!restoreBrowsePosition) {
      clearPreviewScrollHold();
      setPreviewRestoring(false);
      setPreviewCanvasReady(false);
    }
    try {
      if (api && library) {
        await api.closePreview({
          libraryId: library.libraryId,
          assetId: closingAsset.assetId,
        });
      }
    } catch {
      // Closing the local viewer must still work while Main is shutting down.
    } finally {
      if (
        closingPreviewRef.current === closingAsset.assetId &&
        closeGeneration === previewCloseGenerationRef.current
      ) {
        closingPreviewRef.current = null;
      }
    }
  }, [api, armPreviewScrollHold, clearPreviewScrollHold, library, navHistoryRef, previewAsset, setNavHistoryUi, syncActiveWorkspaceTabLocation, setPreviewAsset, setPreviewCanvasReady, setPreviewRestoring, cancelPreviewViewRestoreRef, cancelWorkspaceViewportRestoreRef, closingPreviewRef, lastPreviewRestoredTopRef, pendingViewportRestoreRef, previewCloseGenerationRef, previewFocusReturnRef, previewRestoreFrameRef, previewRestoringRef, previewScrollSnapshotRef, workspaceCanvasRef]);
  return { closeAssetPreview };
}
