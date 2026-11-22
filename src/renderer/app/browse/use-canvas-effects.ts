import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ResizablePanel } from "../../workbench/shell/panel-auto-hide";
import type { WorkspaceNavHistory } from "../../workbench/workspace/workspace-nav-history";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { type AssetSummary } from "../../../shared/asset-types";
import { type ShortcutEventLike } from "../../../shared/shortcut-resolution";
import { canvasHasPreviewScrollHold, logBrowseScrollWrite } from "../../browse/browse-scroll-debug";
import { saveBrowseSortPreferences } from "../../browse/browse-sort-preferences";
import { retainReflowAnchor, scheduleAnchorRestore, type ScrollOffsetSnapshot } from "../../browse/canvas-reflow-restore";
import { enumerateDiscreteCardSizes, nextDiscreteCardSizeFromWheelDelta, stepDiscreteCardSize } from "../../browse/card-size-stops";
import { browseCardLayoutWidthPx, elementContentBoxWidthPx } from "../../browse/folder-card-width";
import { GLOBAL_ZOOM_MENU_ACTION_EVENT, defaultKeyboardCardSize, matchGlobalZoomShortcut, shouldIgnoreGlobalZoomShortcut, type GlobalZoomAction } from "../../common/global-zoom-shortcuts";
import { type BrowseState } from "../../stores/browse-store";
import { type PreviewState } from "../../stores/preview-store";
import { type QueryState } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type WorkspaceState } from "../../stores/workspace-store";
import { rectLikeFromDomRect, type AnchorCard, type CanvasAnchor } from "../../workbench/collection/canvas-scroll-anchor";
import { captureBrowseViewSnapshot, type BrowseViewSnapshot } from "../../workbench/collection/view-restore";
import { listenForShortcutInputs } from "../../workbench/shortcuts/shortcut-runtime";
import { type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { captureWorkspaceNavViewport, resolveWorkspaceScrollTop } from "../../workbench/workspace/workspace-scroll-position";
import { SHORTCUT_PLATFORM } from "../shared/app-shared";
import { useCallback, useEffect, useLayoutEffect } from "react";

export interface UseCanvasEffectsDeps {
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  setFolderCanvasContentWidthPx: Dispatch<SetStateAction<number>>;
  setCanvasWidthPx: Dispatch<SetStateAction<number>>;
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  previewRestoringRef: RefObject<boolean>;
  cardResizeAnchorRef: RefObject<CanvasAnchor | null>;
  reflowAnchorRef: RefObject<CanvasAnchor | null>;
  reflowScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  panelResizeLockRef: RefObject<boolean>;
  reflowRestoreFrameRef: RefObject<number | null>;
  panelResizingRef: RefObject<ResizablePanel | null>;
  cardResizeScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  previewAsset: PreviewState["previewAsset"];
  previewRestoring: PreviewState["previewRestoring"];
  cardSizeRestoreFrameRef: RefObject<number | null>;
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  assetCardSize: number;
  resizeAssetCards: (requestedSize: number, clientX?: number, clientY?: number) => void;
  workspaceHistoryReplayActiveRef: RefObject<boolean>;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  pendingViewportRestoreRef: RefObject<WorkspaceNavViewport | null>;
  wakeViewerChrome: () => void;
  previewRestoreFrameRef: RefObject<number | null>;
  previewCloseGenerationRef: RefObject<number>;
  closingPreviewRef: RefObject<string | null>;
  setPreviewRestoring: Dispatch<SetStateAction<PreviewState["previewRestoring"]>>;
  setPreviewCanvasReady: Dispatch<SetStateAction<PreviewState["previewCanvasReady"]>>;
  cancelPreviewViewRestoreRef: RefObject<(() => void) | null>;
  clearPreviewScrollHold: () => void;
  previewFocusReturnRef: RefObject<string | null>;
  previewScrollSnapshotRef: RefObject<BrowseViewSnapshot | null>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  selectionAnchorRef: MutableRefObject<string | null>;
  setPreviewAsset: Dispatch<SetStateAction<PreviewState["previewAsset"]>>;
  syncActiveWorkspaceTabLocation: () => void;
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setError: (text: string | null) => void;
  t: TranslateFn;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  pendingWorkspacePreviewRef: RefObject<{ assetId: string; viewport: WorkspaceNavViewport; isCurrent: () => boolean; } | null>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  assets: BrowseState["assets"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useCanvasEffects({ workspaceCanvasRef, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewAssetRef, previewRestoringRef, cardResizeAnchorRef, reflowAnchorRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardResizeScrollSnapshotRef, previewAsset, previewRestoring, cardSizeRestoreFrameRef, sortField, sortOrder, assetCardSize, resizeAssetCards, workspaceHistoryReplayActiveRef, cancelWorkspaceViewportRestoreRef, navHistoryRef, pendingViewportRestoreRef, wakeViewerChrome, previewRestoreFrameRef, previewCloseGenerationRef, closingPreviewRef, setPreviewRestoring, setPreviewCanvasReady, cancelPreviewViewRestoreRef, clearPreviewScrollHold, previewFocusReturnRef, previewScrollSnapshotRef, setSelectedAssetIds, setSelectedAssetId, selectionAnchorRef, setPreviewAsset, syncActiveWorkspaceTabLocation, setNavHistoryUi, api, library, setError, t, setNotice, pendingWorkspacePreviewRef, visibleAssets, assets }: UseCanvasEffectsDeps) {

  // REQ-CANVAS-019: dragging the sidebar or resizing the window changes the
  // canvas's available width, which the grid/masonry/justified layouts react
  // to by reflowing (different column/row placement). Left unhandled, that
  // reflow leaves the raw scroll offset pointing at a different area of the
  // grid. Watch the canvas's own box size (not the preview toggle, which
  // moves the host to a full-size overlay while preserving the canvas
  // viewport) and re-anchor scroll the same way the card-size slider does.
  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    let lastWidth: number | null = null;
    const host = canvas.parentElement;
    const observer = new ResizeObserver(() => {
      // The host is the flex item whose width changes when a divider moves.
      // Read the canvas's current width instead of trusting observer entry
      // ordering when both elements resize in the same notification.
      const width = browseCardLayoutWidthPx(canvas);
      const contentWidth = elementContentBoxWidthPx(canvas);
      // The viewer overlay preserves the canvas width. View-restore.ts owns
      // scroll restoration for the viewer close path, so a preview transition
      // must never be interpreted as a reflow.
      if (width <= 0) {
        lastWidth = null;
        setFolderCanvasContentWidthPx(0);
        return;
      }
      setCanvasWidthPx(Math.round(width));
      setFolderCanvasContentWidthPx(Math.round(contentWidth));
      if (lastWidth === null) {
        lastWidth = width;
        return;
      }
      if (
        width === lastWidth ||
        previewAssetRef.current ||
        previewRestoringRef.current ||
        canvasHasPreviewScrollHold(canvas) ||
        // Ctrl-wheel / slider zoom owns the pointer anchor. A scrollbar
        // width change in that window must not retarget scroll to the
        // topmost card and leave the pointed card below the fold.
        cardResizeAnchorRef.current
      ) {
        lastWidth = width;
        return;
      }
      lastWidth = width;

      const rootRect = canvas.getBoundingClientRect();
      const cards: AnchorCard[] = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).map((el) => ({
        assetId: el.dataset.assetId!,
        ...rectLikeFromDomRect(el.getBoundingClientRect()),
      }));
      // Prefer topmost visible card so the leading visible set (A/B/C) stays
      // after column-count changes — center-nearest jumped too easily.
      reflowAnchorRef.current = retainReflowAnchor(
        reflowAnchorRef.current,
        cards,
        rectLikeFromDomRect(rootRect),
      );
      if (!reflowScrollSnapshotRef.current) {
        reflowScrollSnapshotRef.current = {
          left: canvas.scrollLeft,
          top: canvas.scrollTop,
        };
      }
      if (panelResizeLockRef.current) {
        const snapshot = reflowScrollSnapshotRef.current;
        if (snapshot) {
          canvas.scrollLeft = snapshot.left;
          canvas.scrollTop = snapshot.top;
        }
        return;
      }
      scheduleAnchorRestore(
        canvas,
        reflowAnchorRef.current,
        reflowRestoreFrameRef,
        10,
        () => {
          if (!panelResizingRef.current) {
      canvas.classList.remove("is-reflow-restoring");
      reflowAnchorRef.current = null;
      reflowScrollSnapshotRef.current = null;
      cardResizeAnchorRef.current = null;
      cardResizeScrollSnapshotRef.current = null;
          }
        },
        reflowScrollSnapshotRef.current ?? undefined,
      );
    });
    observer.observe(canvas);
    if (host) observer.observe(host);
    return () => observer.disconnect();
  }, [cardResizeAnchorRef, cardResizeScrollSnapshotRef, panelResizeLockRef, panelResizingRef, previewAssetRef, previewRestoringRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef, setCanvasWidthPx, setFolderCanvasContentWidthPx, workspaceCanvasRef]);

  useLayoutEffect(() => {
    if (!previewAsset && !previewRestoring) return;
    if (cardSizeRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(cardSizeRestoreFrameRef.current);
      cardSizeRestoreFrameRef.current = null;
    }
    if (reflowRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(reflowRestoreFrameRef.current);
      reflowRestoreFrameRef.current = null;
    }
    cardResizeAnchorRef.current = null;
    cardResizeScrollSnapshotRef.current = null;
    reflowAnchorRef.current = null;
    reflowScrollSnapshotRef.current = null;
  }, [previewAsset, previewRestoring, cardResizeAnchorRef, cardResizeScrollSnapshotRef, cardSizeRestoreFrameRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef]);

  useEffect(() => {
    saveBrowseSortPreferences({
      version: 1,
      field: sortField,
      order: sortOrder,
    });
  }, [sortField, sortOrder]);

  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || previewAsset) return;
      event.preventDefault();
      const wheelSample = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      };
      // Mouse notches: sign-only (one stop). Trackpad pinch: normalize LINE/PAGE
      // into pixels for the continuous high-gain path.
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * canvas.clientHeight
            : event.deltaY;
      const stops = enumerateDiscreteCardSizes(browseCardLayoutWidthPx(canvas));
      const nextSize = nextDiscreteCardSizeFromWheelDelta(
        assetCardSize,
        delta,
        stops,
        wheelSample,
      );
      resizeAssetCards(nextSize, event.clientX, event.clientY);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [assetCardSize, previewAsset, resizeAssetCards, workspaceCanvasRef]);

  // Browse canvas Cmd/Ctrl+=|-|0 — discrete card stops; 0 = default size
  //. Viewer owns the chord while preview is open.
  useEffect(() => {
    if (previewAsset) return;
    const applyZoomAction = (action: GlobalZoomAction) => {
      const canvas = workspaceCanvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const centerX = rect
        ? rect.left + rect.width / 2
        : undefined;
      const centerY = rect
        ? rect.top + rect.height / 2
        : undefined;
      if (action === "reset") {
        resizeAssetCards(defaultKeyboardCardSize(), centerX, centerY);
        return;
      }
      const stops = enumerateDiscreteCardSizes(
        canvas ? browseCardLayoutWidthPx(canvas) : 0,
      );
      resizeAssetCards(
        stepDiscreteCardSize(
          assetCardSize,
          action === "in" ? 1 : -1,
          stops,
        ),
        centerX,
        centerY,
      );
    };
    const onShortcutInput = (shortcutInput: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (shouldIgnoreGlobalZoomShortcut(event.target)) return;
      const action = matchGlobalZoomShortcut(shortcutInput, SHORTCUT_PLATFORM);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyZoomAction(action);
    };
    const onMenuZoom = (event: Event) => {
      if (shouldIgnoreGlobalZoomShortcut(document.activeElement)) return;
      const action = (event as CustomEvent<GlobalZoomAction>).detail;
      if (action !== "in" && action !== "out" && action !== "reset") return;
      applyZoomAction(action);
    };
    const removeShortcutInputs = listenForShortcutInputs(document, onShortcutInput);
    window.addEventListener(GLOBAL_ZOOM_MENU_ACTION_EVENT, onMenuZoom);
    return () => {
      removeShortcutInputs();
      window.removeEventListener(GLOBAL_ZOOM_MENU_ACTION_EVENT, onMenuZoom);
    };
  }, [assetCardSize, previewAsset, resizeAssetCards, workspaceCanvasRef]);

  const saveCurrentWorkspaceHistoryViewport = useCallback(() => {
    if (workspaceHistoryReplayActiveRef.current) {
      return;
    }
    cancelWorkspaceViewportRestoreRef.current?.();
    cancelWorkspaceViewportRestoreRef.current = null;
    navHistoryRef.current.saveCurrentViewport(
      captureWorkspaceNavViewport(workspaceCanvasRef.current),
    );
  }, [navHistoryRef, cancelWorkspaceViewportRestoreRef, workspaceCanvasRef, workspaceHistoryReplayActiveRef]);

  const openAssetPreview = useCallback((
    asset: AssetSummary,
    options?: { recordHistory?: boolean },
  ) => {
    if (asset.availability !== "available" || asset.deletedAt) return;
    previewAssetRef.current = asset;
    pendingViewportRestoreRef.current = null;
    if (
      options?.recordHistory !== false &&
      navHistoryRef.current.current.kind !== "preview"
    ) {
      saveCurrentWorkspaceHistoryViewport();
    }
    // entering the viewer always shows chrome, regardless of
    // whatever idle state accumulated while browsing; only opening (not
    // navigateAssetPreview) wakes it.
    wakeViewerChrome();
    if (previewRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(previewRestoreFrameRef.current);
      previewRestoreFrameRef.current = null;
    }
    previewCloseGenerationRef.current += 1;
    closingPreviewRef.current = null;
    previewAssetRef.current = asset;
    previewRestoringRef.current = false;
    pendingViewportRestoreRef.current = null;
    setPreviewRestoring(false);
    setPreviewCanvasReady(false);
    cancelPreviewViewRestoreRef.current?.();
    cancelPreviewViewRestoreRef.current = null;
    clearPreviewScrollHold();
    // A card-size or panel reflow may still have an anchor-restoration frame
    // queued when the user opens the viewer immediately after resizing. That
    // stale callback must not overwrite the viewer-close snapshot later.
    if (cardSizeRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(cardSizeRestoreFrameRef.current);
      cardSizeRestoreFrameRef.current = null;
    }
    if (reflowRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(reflowRestoreFrameRef.current);
      reflowRestoreFrameRef.current = null;
    }
    cardResizeAnchorRef.current = null;
    cardResizeScrollSnapshotRef.current = null;
    reflowAnchorRef.current = null;
    reflowScrollSnapshotRef.current = null;
    previewFocusReturnRef.current = asset.assetId;
    const canvas = workspaceCanvasRef.current;
    if (canvas) {
      const card = Array.from(
        canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
      ).find((el) => el.dataset.assetId === asset.assetId);
      previewScrollSnapshotRef.current = captureBrowseViewSnapshot(
        asset.assetId,
        card?.getBoundingClientRect() ?? null,
        canvas.scrollLeft,
        canvas.scrollTop,
        Math.max(0, canvas.scrollHeight - canvas.clientHeight),
      );
      logBrowseScrollWrite("openAssetPreview.capture", canvas, {
        snapshotTop: Math.round(canvas.scrollTop),
        hasCard: Boolean(card),
      });
    } else {
      previewScrollSnapshotRef.current = null;
    }
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    setPreviewAsset(asset);
    // 打开查看器注册一个历史状态。已是 preview（重复打开）则
    // 原地替换，避免叠层 preview；applyWorkspaceLocation 回放时 suppress 不重复记。
    if (options?.recordHistory !== false) {
      const previewLocation: WorkspaceNavLocation = {
        kind: "preview",
        assetId: asset.assetId,
      };
      if (navHistoryRef.current.current.kind === "preview") {
        navHistoryRef.current.replaceCurrent(previewLocation);
      } else {
        navHistoryRef.current.push(previewLocation);
        workspaceHistoryReplayActiveRef.current = false;
      }
      syncActiveWorkspaceTabLocation();
      setNavHistoryUi({
        canBack: navHistoryRef.current.canBack,
        canForward: navHistoryRef.current.canForward,
      });
    }
  }, [navHistoryRef, saveCurrentWorkspaceHistoryViewport, selectionAnchorRef, setNavHistoryUi, syncActiveWorkspaceTabLocation, wakeViewerChrome, clearPreviewScrollHold, setPreviewAsset, setPreviewCanvasReady, setPreviewRestoring, setSelectedAssetId, setSelectedAssetIds, cancelPreviewViewRestoreRef, cardResizeAnchorRef, cardResizeScrollSnapshotRef, cardSizeRestoreFrameRef, closingPreviewRef, pendingViewportRestoreRef, previewAssetRef, previewCloseGenerationRef, previewFocusReturnRef, previewRestoreFrameRef, previewRestoringRef, previewScrollSnapshotRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef, workspaceCanvasRef, workspaceHistoryReplayActiveRef]);

  const persistAssetColorSpace = useCallback(async (assetId: string, colorSpace: string | null) => {
    if (!api || !library) return;
    const result = await api.setAssetColorSpaceOverride({
      libraryId: library.libraryId,
      assetId,
      colorSpace,
    });
    if (!result.ok) {
      setError(t("toast.colorSpaceSaveFailed"));
      return;
    }
    setNotice(t("toast.colorSpaceSaved"));
  }, [api, library, setError, setNotice, t]);

  const navigateAssetPreview = useCallback((
    asset: AssetSummary,
    options?: { recordHistory?: boolean },
  ) => {
    setSelectedAssetIds([asset.assetId]);
    setSelectedAssetId(asset.assetId);
    selectionAnchorRef.current = asset.assetId;
    previewFocusReturnRef.current = asset.assetId;
    setPreviewAsset(asset);
    // 查看器内切资产只更新当前 preview 条目的 assetId，不新增历史。
    if (options?.recordHistory !== false) {
      navHistoryRef.current.replaceCurrent({
        kind: "preview",
        assetId: asset.assetId,
      });
      syncActiveWorkspaceTabLocation();
      setNavHistoryUi({
        canBack: navHistoryRef.current.canBack,
        canForward: navHistoryRef.current.canForward,
      });
    }
  }, [navHistoryRef, selectionAnchorRef, setNavHistoryUi, syncActiveWorkspaceTabLocation, setPreviewAsset, setSelectedAssetId, setSelectedAssetIds, previewFocusReturnRef]);

  useEffect(() => {
    const pendingPreview = pendingWorkspacePreviewRef.current;
    if (!pendingPreview) return;
    if (!pendingPreview.isCurrent()) {
      pendingWorkspacePreviewRef.current = null;
      return;
    }
    const target = [...visibleAssets, ...assets].find(
      (asset) => asset.assetId === pendingPreview.assetId,
    );
    if (!target) return;
    const canvas = workspaceCanvasRef.current;
    if (canvas) {
      const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      canvas.scrollTo({
        top: resolveWorkspaceScrollTop(pendingPreview.viewport, extent),
        left: 0,
      });
    }
    pendingWorkspacePreviewRef.current = null;
    openAssetPreview(target, { recordHistory: false });
  }, [assets, openAssetPreview, visibleAssets, pendingWorkspacePreviewRef, workspaceCanvasRef]);
  return { openAssetPreview, saveCurrentWorkspaceHistoryViewport, navigateAssetPreview, persistAssetColorSpace };
}
