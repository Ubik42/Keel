import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CanvasPreferences } from "../../browse/canvas-preferences";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { KeelShellApi } from "../../../shared/external-url";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { automationCommandToast } from "../../rules/automation-command-toast";
import { canDeleteAssetFromDiskWithShortcut } from "../../browse/browse-key-command";
import { CARD_SIZE_MAX, CARD_SIZE_MIN } from "../../browse/canvas-preferences";
import { scheduleAnchorRestore, type ScrollOffsetSnapshot } from "../../browse/canvas-reflow-restore";
import { enumerateDiscreteCardSizes, nearestDiscreteCardSize } from "../../browse/card-size-stops";
import { resolveFolderBrowseParentId, shouldShowFolderBrowseCards } from "../../browse/folder-browse-canvas";
import { browseCardLayoutWidthPx } from "../../browse/folder-card-width";
import { collectFolderCoverCandidateAssetIds } from "../../folders/folder-cover-refresh";
import { useFolderInspector } from "../../inspector/folder-inspector";
import { type LibraryViewSessionToken } from "../../library/library-view-session";
import { buildMarqueeLayoutKey } from "../../browse/marquee-layout-key";
import { computeMasonrySelectionAssetIds } from "../../browse/masonry-selection-order";
import { browseScopeFromVirtualLayout, buildMultiAssetMenuSkipReport } from "../../jobs/menu-skip-report";
import { type PendingAssetReveal } from "../../browse/pending-asset-reveal";
import { type BrowseState } from "../../stores/browse-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { type QueryState } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { useSelectionKeyboard } from "../../browse/use-selection-keyboard";
import { useAssetSelection } from "../../browse/useAssetSelection";
import { captureAnchor, pickNearestCard, rectLikeFromDomRect, type AnchorCard, type CanvasAnchor } from "../../workbench/collection/canvas-scroll-anchor";
import { hasActiveModalDialog } from "../../workbench/overlay/use-dialog-focus-trap";
import { invertSelection } from "../../workbench/selection/invert-selection";
import { SHORTCUT_PLATFORM } from "../shared/app-shared";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";

export interface UseBrowseSelectionDeps {
  assetViewMode: "grid" | "masonry";
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  masonryGridWidth: number;
  assetCardSize: number;
  canvasPrefs: CanvasPreferences;
  assetGridRef: RefObject<HTMLDivElement | null>;
  setMasonryGridWidth: Dispatch<SetStateAction<number>>;
  canvasFolderBrowseEntries: { folderId: string; parentFolderId: string | null; locationKind: "managed" | "linked"; name: string; relativePath: string; status: "available" | "offline"; directAssetCount: number; recursiveAssetCount: number; childFolderCount: number; coverArtifactIds: string[]; coverAssetIds: string[]; hasCustomCover?: boolean | undefined; customCoverToken?: string | undefined; customCoverAssetId?: string | undefined; customCoverArtifactId?: string | undefined; customCoverSourcePreview?: { assetId: string; revisionId: string; } | undefined; coverSourcePreviews?: { assetId: string; revisionId: string; }[] | undefined; linkedFolderId?: string | null | undefined; }[];
  selectedAssetIds: SelectionState["selectedAssetIds"];
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  previewAsset: PreviewState["previewAsset"];
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  marqueeBoxRef: RefObject<HTMLDivElement | null>;
  selectedFolderIds: SelectionState["selectedFolderIds"];
  setSelectedFolderIds: Dispatch<SetStateAction<SelectionState["selectedFolderIds"]>>;
  setHoveredAssetId: (assetId: string | null) => void;
  pendingRevealRef: RefObject<PendingAssetReveal | null>;
  pendingRestoredFocusRef: RefObject<string | null>;
  folderBrowseEntries: BrowseState["folderBrowseEntries"];
  library: SessionState["library"];
  assetScope: NavigationState["assetScope"];
  showTrash: NavigationState["showTrash"];
  activeTagId: NavigationState["activeTagId"];
  folders: NavigationState["folders"];
  linkedFolders: NavigationState["linkedFolders"];
  searchValue: QueryState["searchValue"];
  api: KeelLibraryApi | undefined;
  trashedAssets: BrowseState["trashedAssets"];
  assets: BrowseState["assets"];
  showTagManagement: NavigationState["showTagManagement"];
  tags: NavigationState["tags"];
  searchTotal: BrowseState["searchTotal"];
  fetchBrowseScopeAssetIds: () => Promise<string[] | null>;
  shellApi: KeelShellApi | undefined;
  editableTextFocused: boolean;
  t: TranslateFn;
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  setError: (text: string | null) => void;
  setWarning: (text: string | null) => void;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  locale: AppLocale;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  setFolderBrowseEntries: Dispatch<SetStateAction<BrowseState["folderBrowseEntries"]>>;
  folderRecursive: NavigationState["folderRecursive"];
  showFolderCardsWhenRecursive: NavigationState["showFolderCardsWhenRecursive"];
  showIgnoredItems: QueryState["showIgnoredItems"];
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  folderBrowseRefreshToken: BrowseState["folderBrowseRefreshToken"];
  folderCoverCandidateAssetIdsRef: RefObject<ReadonlySet<string>>;
  folderNavigationCovers: BrowseState["folderNavigationCovers"];
  virtualBrowseLayout: BrowseState["virtualBrowseLayout"];
  cardResizeAnchorRef: RefObject<CanvasAnchor | null>;
  cardResizeScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  reflowRestoreFrameRef: RefObject<number | null>;
  reflowAnchorRef: RefObject<CanvasAnchor | null>;
  reflowScrollSnapshotRef: RefObject<ScrollOffsetSnapshot | null>;
  setCanvasPrefs: (action: SetStateAction<CanvasPreferences>) => void;
  cardSizeRestoreFrameRef: RefObject<number | null>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useBrowseSelection({ assetViewMode, visibleAssets, masonryGridWidth, assetCardSize, canvasPrefs, assetGridRef, setMasonryGridWidth, canvasFolderBrowseEntries, selectedAssetIds, setSelectedAssetIds, setSelectedAssetId, previewAsset, workspaceCanvasRef, marqueeBoxRef, selectedFolderIds, setSelectedFolderIds, setHoveredAssetId, pendingRevealRef, pendingRestoredFocusRef, folderBrowseEntries, library, assetScope, showTrash, activeTagId, folders, linkedFolders, searchValue, api, trashedAssets, assets, showTagManagement, tags, searchTotal, fetchBrowseScopeAssetIds, shellApi, editableTextFocused, t, showBlockingError, setError, setWarning, setNotice, locale, ensureLibraryView, setFolderBrowseEntries, folderRecursive, showFolderCardsWhenRecursive, showIgnoredItems, isCurrentLibraryView, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, virtualBrowseLayout, cardResizeAnchorRef, cardResizeScrollSnapshotRef, reflowRestoreFrameRef, reflowAnchorRef, reflowScrollSnapshotRef, setCanvasPrefs, cardSizeRestoreFrameRef }: UseBrowseSelectionDeps) {

  const selectionAssetIds = useMemo(() => {
    if (assetViewMode !== "masonry") return undefined;
    return computeMasonrySelectionAssetIds(
      visibleAssets,
      masonryGridWidth,
      assetCardSize,
      canvasPrefs.fields.name ||
        canvasPrefs.fields.size ||
        canvasPrefs.fields.date,
    );
  }, [
    assetCardSize,
    assetViewMode,
    canvasPrefs.fields.date,
    canvasPrefs.fields.name,
    canvasPrefs.fields.size,
    masonryGridWidth,
    visibleAssets,
  ]);

  useLayoutEffect(() => {
    if (assetViewMode !== "masonry") return;
    const element = assetGridRef.current;
    if (!element) return;
    const updateWidth = () => setMasonryGridWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [assetViewMode, visibleAssets.length, canvasFolderBrowseEntries.length, assetGridRef, setMasonryGridWidth]);

  // REQ-FOLDER-010 / Serpent-nu6o: selection order must match the canvas,
  // including trash tombstone cards (folderBrowseEntries is empty in trash).
  const visibleFolderIds = useMemo(
    () => canvasFolderBrowseEntries.map((entry) => entry.folderId),
    [canvasFolderBrowseEntries],
  );
  const marqueeLayoutKey = useMemo(
    () =>
      buildMarqueeLayoutKey({
        viewMode: assetViewMode,
        cardSize: assetCardSize,
        masonryGridWidth,
        fields: canvasPrefs.fields,
        assetIds:
          selectionAssetIds ?? visibleAssets.map((asset) => asset.assetId),
        folderIds: visibleFolderIds,
      }),
    [
      assetCardSize,
      assetViewMode,
      canvasPrefs.fields,
      masonryGridWidth,
      selectionAssetIds,
      visibleAssets,
      visibleFolderIds,
    ],
  );
  const {
    handleCanvasMouseDown,
    clearAssetSelection,
    selectionAnchorRef,
    setAssetSelectionAnchor,
    handleCardClick,
    handleFolderCardClick,
    cardMouseDownRef,
    selectedIdSet,
  } = useAssetSelection({
    assets: visibleAssets,
    selectedAssetIds,
    setSelectedAssetIds,
    setSelectedAssetId,
    previewAsset,
    workspaceCanvasRef,
    marqueeBoxRef,
    folderIds: visibleFolderIds,
    selectionAssetIds,
    masonryShiftSelection: assetViewMode === "masonry",
    marqueeLayoutKey,
    selectedFolderIds,
    setSelectedFolderIds,
    onSelectionCleared: () => {
      setHoveredAssetId(null);
      // An import reveal intentionally re-applies selection once its first
      // content refresh settles. A deliberate blank-canvas click must cancel
      // that pending action, otherwise a just-imported sequence is impossible
      // to deselect for the next 280 ms.
      pendingRevealRef.current = null;
      pendingRestoredFocusRef.current = null;
    },
  });
  const selectedFolderIdSet = useMemo(
    () => new Set(selectedFolderIds),
    [selectedFolderIds],
  );
  const folderInspectorCards = useMemo(
    () => selectedAssetIds.length > 0
      ? []
      : folderBrowseEntries.filter((entry) => selectedFolderIdSet.has(entry.folderId)),
    [selectedAssetIds.length, folderBrowseEntries, selectedFolderIdSet],
  );
  const currentFolderInspectorRef = useMemo(() => {
    if (selectedAssetIds.length > 0 || folderInspectorCards.length > 0 || !library) return null;
    const parentId = resolveFolderBrowseParentId({
      assetScope,
      showTrash,
      activeTagId,
      folders,
      linkedFolders,
      searchActive: searchValue.trim() !== "",
    });
    if (typeof parentId !== "string") return null;
    const managed = folders.some((folder) => folder.folderId === parentId);
    return {
      locationKind: managed ? "managed" as const : "linked" as const,
      folderId: parentId,
    };
  }, [
    selectedAssetIds.length,
    folderInspectorCards.length,
    library,
    assetScope,
    showTrash,
    activeTagId,
    folders,
    linkedFolders,
    searchValue,
  ]);
  const folderInspector = useFolderInspector({
    api,
    libraryId: library?.libraryId ?? null,
    enabled: folderInspectorCards.length > 0 || currentFolderInspectorRef !== null,
    cardEntries: folderInspectorCards,
    currentRef: currentFolderInspectorRef,
  });
  const folderInspectorAppearance = folderInspector?.entries.length === 1
    ? folders.find((folder) => folder.folderId === folderInspector.entries[0]?.folderId)?.appearance
      ?? linkedFolders.find((folder) => folder.folderId === folderInspector.entries[0]?.folderId)?.appearance
      ?? null
    : null;

  const browseScopeAssetIds = useMemo(() => {
    const rows = showTrash ? trashedAssets : assets;
    return rows.map((asset) => asset.assetId);
  }, [showTrash, trashedAssets, assets]);
  const workspaceBrowseCount = useMemo(() => {
    if (showTagManagement) return tags.length;
    if (searchTotal !== null) return searchTotal;
    return showTrash ? trashedAssets.length : visibleAssets.length;
  }, [
    showTagManagement,
    tags.length,
    searchTotal,
    showTrash,
    trashedAssets.length,
    visibleAssets.length,
  ]);
  // Serpent-ws4k: select-all / invert cover the *whole* browse scope, not just
  // the loaded page, so they resolve the full id set on demand (idsOnly).
  // A stale id set (scope switched mid-fetch) and a null/empty resolve are
  // both no-ops — matching the pre-pagination synchronous guards, they never
  // clear an existing selection.
  const selectAllBrowseScope = useCallback(async () => {
    const ids = await fetchBrowseScopeAssetIds();
    if (!ids || ids.length === 0) return;
    setSelectedAssetIds([...ids]);
    setSelectedAssetId(ids.at(-1));
    setAssetSelectionAnchor(ids[0] ?? null);
  }, [
    fetchBrowseScopeAssetIds,
    setAssetSelectionAnchor,
    setSelectedAssetId,
    setSelectedAssetIds,
  ]);

  const invertBrowseScope = useCallback(async () => {
    const ids = await fetchBrowseScopeAssetIds();
    if (!ids || ids.length === 0) return;
    const next = invertSelection(ids, selectedAssetIds);
    setSelectedAssetIds(next);
    setSelectedAssetId(next.at(-1));
    setAssetSelectionAnchor(next[0] ?? null);
  }, [
    fetchBrowseScopeAssetIds,
    selectedAssetIds,
    setAssetSelectionAnchor,
    setSelectedAssetId,
    setSelectedAssetIds,
  ]);

  useSelectionKeyboard({
    enabled: Boolean(library),
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    browseScopeAssetIds,
    selectedAssetIds,
    clearAssetSelection,
    onSelectAll: () => void selectAllBrowseScope(),
    onInvert: () => void invertBrowseScope(),
  });

  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onInvertSelection(() => {
      if (previewAsset) return;
      if (editableTextFocused) return;
      if (hasActiveModalDialog()) return;
      if (browseScopeAssetIds.length === 0) return;
      void invertBrowseScope();
    });
  }, [
    shellApi,
    previewAsset,
    editableTextFocused,
    browseScopeAssetIds,
    invertBrowseScope,
    setAssetSelectionAnchor,
  ]);

  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onShellNotify((payload) => {
      if (payload.mode === 'dialog') {
        const title = payload.title?.trim()
          || (payload.severity === 'warning'
            ? t('dialog.blockingError.automationWarning')
            : payload.severity === 'info'
              ? t('dialog.blockingError.automationNotice')
              : t('dialog.blockingError.automationError'));
        showBlockingError(title, payload.message);
        return;
      }
      if (payload.severity === 'error') setError(payload.message);
      else if (payload.severity === 'warning') setWarning(payload.message);
      else setNotice(payload.message);
    });
  }, [shellApi, setError, setWarning, setNotice, showBlockingError, t]);

  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onCommandCompleted((payload) => {
      // Serpent-fmbr: MCP operations show the same toasts as manual ones —
      // composed here from the structured result, never MCP-specific wording.
      const toast = automationCommandToast(payload, locale);
      if (toast !== undefined) setNotice(toast.message, toast.historyEntryId);
    });
  }, [shellApi, locale, setNotice]);

  // REQ-FOLDER-001/002/003/010: load direct child folder cards whenever the
  // browse parent is a managed folder or the managed root; cleared for
  // trash/tag/search/linked-only views.
  useEffect(() => {
    let cancelled = false;
    async function loadFolderBrowseEntries() {
      const viewSession = library
        ? ensureLibraryView(library.libraryId)
        : null;
      const parentFolderId =
        api && library
          ? resolveFolderBrowseParentId({
              assetScope,
              showTrash,
              activeTagId,
              folders,
              linkedFolders,
              searchActive: Boolean(searchValue.trim()),
            })
          : undefined;
      if (!api || !library || parentFolderId === undefined) {
        if (!cancelled) setFolderBrowseEntries([]);
        return;
      }
      // Recursive browse still shows direct child folder cards unless the
      // Settings switch turns that off (Serpent-4e9caa).
      if (
        !shouldShowFolderBrowseCards(
          assetScope,
          folderRecursive,
          showFolderCardsWhenRecursive,
        )
      ) {
        if (!cancelled) setFolderBrowseEntries([]);
        return;
      }
      const result = await api.listFolderBrowseEntries({
        libraryId: library.libraryId,
        parentFolderId,
        showIgnored: showIgnoredItems,
      });
      if (
        !cancelled &&
        viewSession &&
        isCurrentLibraryView(viewSession) &&
        result.ok
      ) {
        setFolderBrowseEntries(result.value);
      }
    }
    void loadFolderBrowseEntries();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    library,
    assetScope,
    showTrash,
    activeTagId,
    folders,
    linkedFolders,
    searchValue,
    showIgnoredItems,
    folderRecursive,
    showFolderCardsWhenRecursive,
    ensureLibraryView,
    isCurrentLibraryView,
    // Serpent-d0nv: a cover candidate's thumbnail.ready bumps this token so
    // the row re-fetches and the generated cover appears without navigation.
    folderBrowseRefreshToken, setFolderBrowseEntries]);

  // Serpent-d0nv: keep the cover-candidate asset set (from the last browse
  // entries response) visible to the thumbnail event subscriber so a ready
  // cover refreshes the folder-card row without a full reload.

  useEffect(() => {
    folderCoverCandidateAssetIdsRef.current = collectFolderCoverCandidateAssetIds(
      folderBrowseEntries,
      folderNavigationCovers,
    );
  }, [folderBrowseEntries, folderNavigationCovers, folderCoverCandidateAssetIdsRef]);

  const previewIndex = previewAsset
    ? visibleAssets.findIndex((asset) => asset.assetId === previewAsset.assetId)
    : -1;
  const selectedAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedIdSet.has(asset.assetId)),
    [selectedIdSet, visibleAssets],
  );
  const diskDeleteKeyboardTargets = useMemo(() => {
    const menuSkipScope = browseScopeFromVirtualLayout(virtualBrowseLayout);
    const report = buildMultiAssetMenuSkipReport(
      selectedAssetIds,
      visibleAssets,
      selectedFolderIds,
      menuSkipScope,
    );
    const visibleById = new Map(
      visibleAssets.map((asset) => [asset.assetId, asset]),
    );
    return {
      assetIds: report.trash.processAssetIds.filter((assetId) => {
        const asset = visibleById.get(assetId);
        return canDeleteAssetFromDiskWithShortcut(asset);
      }),
      folderIds: [...report.trash.processFolderIds],
    };
  }, [selectedAssetIds, visibleAssets, selectedFolderIds, virtualBrowseLayout]);
  const menuSkipScope = useMemo(
    () => browseScopeFromVirtualLayout(virtualBrowseLayout),
    [virtualBrowseLayout],
  );
  const resizeAssetCards = useCallback(
    (requestedSize: number, clientX?: number, clientY?: number) => {
      const root = workspaceCanvasRef.current;
      const width = root ? browseCardLayoutWidthPx(root) : 0;
      const stops = enumerateDiscreteCardSizes(width);
      const nextSize = nearestDiscreteCardSize(
        Math.min(
          CARD_SIZE_MAX,
          Math.max(CARD_SIZE_MIN, Math.round(requestedSize)),
        ),
        stops,
      );
      if (!root || nextSize === assetCardSize) return;

      const rootRect = root.getBoundingClientRect();
      const anchorX = clientX ?? rootRect.left + rootRect.width / 2;
      const anchorY = clientY ?? rootRect.top + rootRect.height / 2;
      const cardEls = Array.from(
        root.querySelectorAll<HTMLElement>("[data-asset-id]"),
      );
      const cards: AnchorCard[] = cardEls.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          assetId: el.dataset.assetId!,
          ...rectLikeFromDomRect(rect),
        };
      });
      const pointed = document
        .elementFromPoint(anchorX, anchorY)
        ?.closest<HTMLElement>("[data-asset-id]");
      const pointedInRoot = pointed && root.contains(pointed) ? pointed : null;
      const anchorCard = pointedInRoot
        ? cards.find((card) => card.assetId === pointedInRoot.dataset.assetId) ?? null
        : pickNearestCard(cards, rootRect, anchorX, anchorY);
      const anchorState = anchorCard
        ? captureAnchor(anchorCard, anchorX, anchorY)
        : null;
      const previousAnchor = cardResizeAnchorRef.current;
      const previousScroll = cardResizeScrollSnapshotRef.current;
      const pointerMoved = Boolean(
        previousAnchor &&
          anchorState &&
          Math.hypot(
            previousAnchor.clientX - anchorState.clientX,
            previousAnchor.clientY - anchorState.clientY,
          ) > 24,
      );
      const scrollMoved = Boolean(
        previousScroll &&
          Math.abs(previousScroll.top - root.scrollTop) > 1,
      );
      // One continuous pinch keeps the first anchor. A later gesture whose
      // pointer or scroll offset moved (slider, then wheel on another card)
      // has to recapture; otherwise the stale snapshot scrolls back to the
      // start of the previous gesture.
      if (!previousAnchor || pointerMoved || scrollMoved) {
        cardResizeAnchorRef.current = anchorState;
        cardResizeScrollSnapshotRef.current = {
          left: root.scrollLeft,
          top: root.scrollTop,
        };
      }

      // Virtual geometry compensation and the width-reflow anchor must not
      // fight the pointer anchor. Cancel an in-flight width restore so its
      // completion callback cannot clear this zoom anchor.
      if (reflowRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(reflowRestoreFrameRef.current);
        reflowRestoreFrameRef.current = null;
      }
      reflowAnchorRef.current = null;
      reflowScrollSnapshotRef.current = null;
      if (cardResizeAnchorRef.current) {
        root.classList.add("is-reflow-restoring");
      }
      setCanvasPrefs((p) => ({ ...p, cardSize: nextSize }));
      // Serpent-32p: always re-anchor after settle; width/size reflow may reset
      // scrollTop mid-wait, and bailing left the visible set wrong.
      scheduleAnchorRestore(
        root,
        cardResizeAnchorRef.current,
        cardSizeRestoreFrameRef,
        30,
        () => {
          root.classList.remove("is-reflow-restoring");
          cardResizeAnchorRef.current = null;
          cardResizeScrollSnapshotRef.current = null;
        },
        cardResizeScrollSnapshotRef.current ?? undefined,
      );
    },
    [assetCardSize, setCanvasPrefs, cardResizeAnchorRef, cardResizeScrollSnapshotRef, cardSizeRestoreFrameRef, reflowAnchorRef, reflowRestoreFrameRef, reflowScrollSnapshotRef, workspaceCanvasRef],
  );
  return { resizeAssetCards, selectionAnchorRef, setAssetSelectionAnchor, clearAssetSelection, selectedAssets, diskDeleteKeyboardTargets, previewIndex, browseScopeAssetIds, selectAllBrowseScope, invertBrowseScope, handleFolderCardClick, cardMouseDownRef, selectedFolderIdSet, workspaceBrowseCount, handleCanvasMouseDown, selectedIdSet, handleCardClick, selectionAssetIds, folderInspector, folderInspectorAppearance, menuSkipScope };
}
