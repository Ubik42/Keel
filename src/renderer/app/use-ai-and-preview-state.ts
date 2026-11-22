import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { ResizablePanel } from "../workbench/shell/panel-auto-hide";
import { DEFAULT_AI_ANALYSIS_SETTINGS, toWireAiAnalysisSettings } from "../../shared/ai-analysis-settings";
import { DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS, type AiApiFormat } from "../../shared/ai-endpoints";
import { type AssetSummary } from "../../shared/asset-types";
import { type AiProgressJobUpdate } from "../ai-analyze-progress";
import { type AssetPreviewModalHandle } from "../AssetPreviewModal";
import { type BrowseMembershipChange } from "../browse-filter-membership";
import { PREVIEW_SCROLL_HOLD_MS, canvasHasPreviewScrollHold, installBrowseScrollWriteSpy, logBrowseScrollWrite, setCanvasPreviewScrollHold } from "../browse-scroll-debug";
import { captureReflowAnchorFromCards, scheduleAnchorRestore, type ScrollOffsetSnapshot } from "../canvas-reflow-restore";
import { enumerateDiscreteCardSizes } from "../card-size-stops";
import { FOLDER_CARD_ROW_INLINE_PADDING_PX, masonryAlignedFolderWidthPx } from "../folder-card-width";
import { aiFields, useAiField } from "../stores/ai-store";
import { type BrowseState } from "../stores/browse-store";
import { useDialogField } from "../stores/dialogs-store";
import { type InspectorState, useInspectorField } from "../stores/inspector-store";
import { usePrefsStore } from "../stores/prefs-store";
import { usePreviewField } from "../stores/preview-store";
import { type SelectionState } from "../stores/selection-store";
import { type SessionState } from "../stores/session-store";
import { type TransfersState, useTransfersField } from "../stores/transfers-store";
import { useInspectorAssetMetadata } from "../use-inspector-asset-metadata";
import { useSyncCardStatuses } from "../use-sync-card-status";
import { useViewerChromeIdle } from "../use-viewer-chrome-idle";
import { useViewerVolume } from "../use-viewer-volume";
import { rectLikeFromDomRect, type AnchorCard, type CanvasAnchor } from "../workbench/collection/canvas-scroll-anchor";
import { type WorkspaceNavViewport } from "../workbench/workspace/workspace-nav-history";
import { pendingWorkspaceViewportAction, resolveWorkspaceScrollTop } from "../workbench/workspace/workspace-scroll-position";
import { type RendererWindow } from "./app-shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface UseAiAndPreviewStateDeps {
  setError: (text: string | null) => void;
  t: TranslateFn;
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  selectedAssetId: SelectionState["selectedAssetId"];
  metadataByAssetRef: RefObject<Map<string, { assetId: string; description: string | null; rating: number; favorite: boolean; palette: string | null; automaticPalette: { hex: string; ratio: number; }[]; effectivePalette: string[]; paletteSource: "manual" | "automatic" | null; sourcePageUrl: string | null; author: string | null; tags: { id: string; name: string; source: "ai" | "user"; }[]; entityVersion: number; updatedAt: string; companions?: { assetId: string; fileName: string; }[] | undefined; }>>;
  metadataConflictAssetIdsRef: RefObject<Set<string>>;
  assetMetadata: InspectorState["assetMetadata"];
  setAssetMetadata: Dispatch<SetStateAction<InspectorState["assetMetadata"]>>;
  setVersionConflict: Dispatch<SetStateAction<InspectorState["versionConflict"]>>;
  setEditDescription: Dispatch<SetStateAction<InspectorState["editDescription"]>>;
  setEditRating: Dispatch<SetStateAction<InspectorState["editRating"]>>;
  setEditFavorite: Dispatch<SetStateAction<InspectorState["editFavorite"]>>;
  setEditSourceUrl: Dispatch<SetStateAction<InspectorState["editSourceUrl"]>>;
  setEditAuthor: Dispatch<SetStateAction<InspectorState["editAuthor"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setTrashedAssets: Dispatch<SetStateAction<BrowseState["trashedAssets"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
  assets: BrowseState["assets"];
  browseLayout: BrowseState["browseLayout"];
  syncBindingStatus: TransfersState["syncBindingStatus"];
  syncProgress: TransfersState["syncProgress"];
  workspaceNavigationPending: boolean;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  navPanelWidth: number;
  inspectorPanelWidth: number;
  panelResizing: ResizablePanel | null;
  panelResizeReleaseRef: RefObject<() => void>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useAiAndPreviewState({ setError, t, api, library, selectedAssetId, metadataByAssetRef, metadataConflictAssetIdsRef, assetMetadata, setAssetMetadata, setVersionConflict, setEditDescription, setEditRating, setEditFavorite, setEditSourceUrl, setEditAuthor, setAssets, setTrashedAssets, setNotice, syncBrowseFilterMembershipRef, assets, browseLayout, syncBindingStatus, syncProgress, workspaceNavigationPending, cancelWorkspaceViewportRestoreRef, navPanelWidth, inspectorPanelWidth, panelResizing, panelResizeReleaseRef }: UseAiAndPreviewStateDeps) {

  function revealAppLog(): void {
    const bridge = (window as RendererWindow).keel?.shell;
    if (!bridge?.revealAppLog) {
      setError(t("toast.aiRevealLogFailed"));
      return;
    }
    void bridge.revealAppLog().then((result) => {
      if (!result.ok) setError(t("toast.aiRevealLogFailed"));
    });
  }

  // AI analysis state
  const [aiApiFormat, setAiApiFormat] = useAiField("aiApiFormat");
  const [aiModel, setAiModel] = useAiField("aiModel");
  const [aiBaseUrl, setAiBaseUrl] = useAiField("aiBaseUrl");
  const [aiApiKey, setAiApiKey] = useAiField("aiApiKey");
  const [aiDraftHasKey, setAiDraftHasKey] = useAiField("aiDraftHasKey");
  const [aiHasKey, setAiHasKey] = useAiField("aiHasKey");
  const [aiProfiles, setAiProfiles] = useAiField("aiProfiles");
  const [aiActiveProfileId, setAiActiveProfileId] = useAiField("aiActiveProfileId");
  const aiConnectionProbeGenerationRef = useRef(0);
  const updateAiActiveProfileId = useCallback((profileId: string | null) => {
    setAiActiveProfileId(profileId);
  }, [setAiActiveProfileId]);
  const [aiProfileDraftId, setAiProfileDraftId] = useAiField("aiProfileDraftId");
  const [aiProfileName, setAiProfileName] = useAiField("aiProfileName");
  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useAiField("aiDescriptionEnabled");
  const [aiTagsEnabled, setAiTagsEnabled] = useAiField("aiTagsEnabled");
  const [aiRatingEnabled, setAiRatingEnabled] = useAiField("aiRatingEnabled");
  const [aiForceExistingTags, setAiForceExistingTags] = useAiField("aiForceExistingTags");
  const [aiAnalysisSettings, setAiAnalysisSettings] = useAiField("aiAnalysisSettings");
  const [aiLanguages, setAiLanguages] = useAiField("aiLanguages");
  const [aiConcurrencyLimit, setAiConcurrencyLimit] = useAiField("aiConcurrencyLimit");
  const [aiMaxAnalysisImageEdgePx, setAiMaxAnalysisImageEdgePx] = useAiField("aiMaxAnalysisImageEdgePx");
  const [aiAutoAnalyzeEnabled, setAiAutoAnalyzeEnabled] = useAiField("aiAutoAnalyzeEnabled");
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useAiField("aiDisclaimerAccepted");
  const setAiConnectionState = aiFields.setterFor("aiConnectionState");
  const setAiDraftConnectionState = aiFields.setterFor("aiDraftConnectionState");
  const setAiDraftConnectionReason = aiFields.setterFor("aiDraftConnectionReason");
  const setAiSaveVerifying = aiFields.setterFor("aiSaveVerifying");
  const aiAutoConnectAttemptedRef = useRef(false);
  /** Fingerprint of credentials last proven by a successful probe. */
  const aiVerifiedFingerprintRef = useRef<string | null>(null);
  const aiConfigPersistDraftRef = useRef({
    apiFormat: DEFAULT_AI_API_FORMAT as AiApiFormat,
    model: DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT],
    baseUrl: "",
    apiKey: "",
    hasKey: false,
    descriptionEnabled: true,
    tagsEnabled: true,
    ratingEnabled: true,
    forceExistingTags: false,
    analysisSettings: toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS),
    languages: ["zh-CN"] as Array<"zh-CN" | "en" | "ja" | "ko">,
    concurrencyLimit: 16,
    maxAnalysisImageEdgePx: 2048,
    autoAnalyzeEnabled: false,
    disclaimerAccepted: false,
  });

  useEffect(() => {
    aiConfigPersistDraftRef.current = {
      apiFormat: aiApiFormat,
      model: aiModel,
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      hasKey: aiHasKey,
      descriptionEnabled: aiDescriptionEnabled,
      tagsEnabled: aiTagsEnabled,
      ratingEnabled: aiRatingEnabled,
      forceExistingTags: aiForceExistingTags,
      analysisSettings: aiAnalysisSettings,
      languages: aiLanguages,
      concurrencyLimit: aiConcurrencyLimit,
      maxAnalysisImageEdgePx: aiMaxAnalysisImageEdgePx,
      autoAnalyzeEnabled: aiAutoAnalyzeEnabled,
      disclaimerAccepted: aiDisclaimerAccepted,
    };
  }, [
    aiAnalysisSettings,
    aiApiFormat,
    aiApiKey,
    aiAutoAnalyzeEnabled,
    aiBaseUrl,
    aiConcurrencyLimit,
    aiDescriptionEnabled,
    aiDisclaimerAccepted,
    aiForceExistingTags,
    aiHasKey,
    aiLanguages,
    aiMaxAnalysisImageEdgePx,
    aiModel,
    aiRatingEnabled,
    aiTagsEnabled,
  ]);
  const [aiAnalyzing, setAiAnalyzing] = useAiField("aiAnalyzing");
  const setAiProgressBannerVisible = aiFields.setterFor("aiProgressBannerVisible");
  const [aiContent, setAiContent] = useInspectorField("aiContent");
  /** Description editor is showing AI-layer text (human description empty). */
  const [descriptionIsAi, setDescriptionIsAi] = useInspectorField("descriptionIsAi");

  const {
    loadMetadata,
    loadAiContentForAsset,
    saveMetadata,
    applyLoadedMetadata,
  } = useInspectorAssetMetadata({
    api: api ?? null,
    library,
    selectedAssetId,
    metadataByAssetRef,
    metadataConflictAssetIdsRef,
    assetMetadata,
    setAssetMetadata,
    setVersionConflict,
    setEditDescription,
    setEditRating,
    setEditFavorite,
    setEditSourceUrl,
    setEditAuthor,
    setDescriptionIsAi,
    setAiContent,
    setAssets,
    setTrashedAssets,
    setNotice,
    setError,
    syncBrowseFilterMembershipRef,
  });

  const analyzingAssetIdRef = useRef<string | null>(null);
  const analyzingBatchSizeRef = useRef(0);
  const aiBatchJobIdsRef = useRef<string[]>([]);
  const aiBatchSkippedCountRef = useRef(0);
  const aiBatchKnownJobsRef = useRef<AiProgressJobUpdate[]>([]);
  const aiBatchCounterBaselineRef = useRef({ succeeded: 0, failed: 0 });
  const lastAiBatchJobIdsRef = useRef<string[]>([]);
  const lastAiBatchAssetIdRef = useRef<string | null>(null);
  const aiBatchStatusRequestRef = useRef(0);
  const refreshAiBatchStatusRef = useRef<() => void>(() => undefined);
  const applyLiveAiProgressRef = useRef<(event: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    changedJobs?: AiProgressJobUpdate[];
  }) => void>(() => undefined);
  const setAiBatchProgress = aiFields.setterFor("aiBatchProgress");
  const aiUiPrefs = usePrefsStore((state) => state.aiUi);
  const setAiUiPrefs = usePrefsStore((state) => state.setAiUi);
  const [importValidated, setImportValidated] = useTransfersField("importValidated");
  const [exportDialogOpen, setExportDialogOpen] = useDialogField("exportDialogOpen");
  const [importLibraryChooserOpen, setImportLibraryChooserOpen] = useTransfersField("importLibraryChooserOpen");
  const [openLibraryChooserOpen, setOpenLibraryChooserOpen] = useDialogField("openLibraryChooserOpen");

  // Thumbnail / Preview state
  const [previewAsset, setPreviewAsset] = usePreviewField("previewAsset");
  // Keep the browse surface visually hidden while the viewer close path
  // restores its scroll anchor. Revealing the grid before the two-frame
  // restoration causes a one-frame flash and can make Chromium paint at the
  // top of the canvas during a rapid open/close.
  const [previewRestoring, setPreviewRestoring] = usePreviewField("previewRestoring");
  const [previewCanvasReady, setPreviewCanvasReady] = usePreviewField("previewCanvasReady");
  const previewModalRef = useRef<AssetPreviewModalHandle>(null);
  // REQ-CANVAS-019: read synchronously inside the canvas ResizeObserver
  // callback (which is created once and does not close over fresh state)
  // to skip the reflow-anchor logic while the viewer hides the canvas.
  const previewAssetRef = useRef<AssetSummary | null>(null);
  const previewRestoringRef = useRef(false);
  useLayoutEffect(() => {
    previewAssetRef.current = previewAsset;
  }, [previewAsset]);
  // Serpent-njoy: owned here (not inside AssetPreviewModal, which remounts
  // per-asset via `key`) so switching assets never resets idle by itself.
  // While preview is open, any keyboard/pointer/wheel input wakes chrome;
  // `wakeViewerChrome` also runs when the viewer first opens.
  const {
    idle: viewerChromeIdle,
    onActivity: onViewerChromeActivity,
    wake: wakeViewerChrome,
  } = useViewerChromeIdle(undefined, Boolean(previewAsset));
  const canvasPrefs = usePrefsStore((state) => state.canvas);
  const syncCardAssetIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    for (const asset of assets) push(asset.assetId);
    for (const entry of browseLayout) push(entry.assetId);
    return ids;
  }, [assets, browseLayout]);
  const syncCardStatuses = useSyncCardStatuses({
    api,
    libraryId: library?.libraryId,
    bound: syncBindingStatus !== "none",
    showBadges: canvasPrefs.fields.badgeSync !== false && syncBindingStatus !== "none",
    assetIds: syncCardAssetIds,
    syncing: Boolean(
      syncProgress
      && syncProgress.phase !== "complete"
      && syncProgress.filesTotal > 0,
    ),
  });
  const imageSequencePrefs = usePrefsStore((state) => state.imageSequence);
  const setImageSequencePrefs = usePrefsStore((state) => state.setImageSequence);
  const viewerChromePrefs = usePrefsStore((state) => state.viewerChrome);
  const setViewerChromePrefs = usePrefsStore((state) => state.setViewerChrome);
  // Hover live previews (audio/video) carry the viewer volume preference over.
  const {
    volume: viewerVolume,
    muted: viewerVolumeMuted,
  } = useViewerVolume(false);
  const assetViewMode = canvasPrefs.viewMode;
  const assetCardSize = canvasPrefs.cardSize;
  const [canvasWidthPx, setCanvasWidthPx] = useState(0);
  const [folderCanvasContentWidthPx, setFolderCanvasContentWidthPx] = useState(0);
  const cardSizeStops = useMemo(
    () => enumerateDiscreteCardSizes(canvasWidthPx),
    [canvasWidthPx],
  );
  // Serpent-l67w: folder cards share the flush masonry column width so the
  // folder row lines up with waterfall columns (raw slider size can leave
  // leftover that `1fr` columns absorb).
  const folderCardWidthPx = useMemo(
    () =>
      masonryAlignedFolderWidthPx(
        Math.max(
          0,
          folderCanvasContentWidthPx - FOLDER_CARD_ROW_INLINE_PADDING_PX * 2,
        ),
        assetCardSize,
      ),
    [assetCardSize, folderCanvasContentWidthPx],
  );
  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  const previewScrollHoldTimerRef = useRef<number | null>(null);
  const lastPreviewRestoredTopRef = useRef(0);
  const clearPreviewScrollHold = useCallback(() => {
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
      previewScrollHoldTimerRef.current = null;
    }
    setCanvasPreviewScrollHold(workspaceCanvasRef.current, false);
  }, []);
  const armPreviewScrollHold = useCallback((restoredTop: number) => {
    lastPreviewRestoredTopRef.current = restoredTop;
    setCanvasPreviewScrollHold(workspaceCanvasRef.current, true);
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
    }
    previewScrollHoldTimerRef.current = window.setTimeout(() => {
      previewScrollHoldTimerRef.current = null;
      setCanvasPreviewScrollHold(workspaceCanvasRef.current, false);
    }, PREVIEW_SCROLL_HOLD_MS);
  }, []);
  useEffect(() => () => {
    if (previewScrollHoldTimerRef.current !== null) {
      window.clearTimeout(previewScrollHoldTimerRef.current);
    }
  }, []);
  useLayoutEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return undefined;
    return installBrowseScrollWriteSpy(canvas);
  }, [library]);
  // A viewport restore waiting to be applied in the same commit the new
  // content paints in. Set when a navigation targets a saved offset; the
  // layout effect below positions the canvas before the browser paints, which
  // removes the "first frame at the top, second frame jumps" flicker when
  // switching folders or tabs (UX principle 0005: reduce flashing).
  const pendingViewportRestoreRef = useRef<WorkspaceNavViewport | null>(null);
  useLayoutEffect(() => {
    const viewport = pendingViewportRestoreRef.current;
    if (!viewport) return;
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    if (extent <= 0) return;
    const targetTop = resolveWorkspaceScrollTop(viewport, extent);
    const previewActive =
      Boolean(previewAsset) ||
      previewRestoring ||
      Boolean(previewAssetRef.current) ||
      previewRestoringRef.current ||
      canvasHasPreviewScrollHold(canvas) ||
      Boolean(canvas.parentElement?.classList.contains("is-viewing"));
    const action = pendingWorkspaceViewportAction({
      previewActive,
      navigationPending: workspaceNavigationPending,
      restoreLoopActive: Boolean(cancelWorkspaceViewportRestoreRef.current),
      intendedTop: viewport.scrollTop,
      targetTop,
      currentTop: canvas.scrollTop,
      extent,
    });
    if (action === "clear") {
      pendingViewportRestoreRef.current = null;
      return;
    }
    logBrowseScrollWrite("pendingViewportRestore", canvas, {
      targetTop,
      intendedTop: viewport.scrollTop,
      currentTop: Math.round(canvas.scrollTop),
      navigationPending: workspaceNavigationPending,
    });
    canvas.scrollTop = targetTop;
  });
  const reportedVisibleWindowKeyRef = useRef("");
  const visibleWindowAssetIdsRef = useRef<ReadonlySet<string>>(new Set());
  const viewportScrollTopRef = useRef<number | undefined>(undefined);
  const viewportGenerationRef = useRef(0);
  const interactionGenerationRef = useRef(0);
  // Serpent-wgl2: the marquee box div is always mounted and moved directly
  // through this ref — never through React state (per-frame state re-renders
  // the whole non-memoized grid).
  const marqueeBoxRef = useRef<HTMLDivElement>(null);
  // REQ-CANVAS-019: rAF handle for the card-size-slider anchor restore.
  const cardSizeRestoreFrameRef = useRef<number | null>(null);
  // REQ-CANVAS-019: rAF handle for the container-width (sidebar/window
  // resize) anchor restore; separate from the card-size one above so the
  // two triggers never cancel each other's in-flight restoration.
  const reflowRestoreFrameRef = useRef<number | null>(null);
  const cardResizeAnchorRef = useRef<CanvasAnchor | null>(null);
  const cardResizeScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const reflowAnchorRef = useRef<CanvasAnchor | null>(null);
  const reflowScrollSnapshotRef = useRef<ScrollOffsetSnapshot | null>(null);
  const panelResizeLockRef = useRef(false);
  const panelReflowFrozenWidthRef = useRef<number | null>(null);
  const panelWidthSnapshotRef = useRef({ nav: navPanelWidth, inspector: inspectorPanelWidth });
  const panelResizingRef = useRef(panelResizing);
  useLayoutEffect(() => {
    panelResizingRef.current = panelResizing;
  }, [panelResizing]);

  const capturePanelResizeAnchor = useCallback((lock = true) => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas) return;
    canvas.classList.remove("is-reflow-restoring");
    const cards: AnchorCard[] = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
    ).map((el) => ({
      assetId: el.dataset.assetId!,
      ...rectLikeFromDomRect(el.getBoundingClientRect()),
    }));
    reflowAnchorRef.current = captureReflowAnchorFromCards(
      cards,
      rectLikeFromDomRect(canvas.getBoundingClientRect()),
    );
    reflowScrollSnapshotRef.current = {
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    panelReflowFrozenWidthRef.current = canvas.clientWidth;
    canvas.classList.add("is-reflow-frozen");
    canvas.style.setProperty(
      "--reflow-frozen-width",
      `${panelReflowFrozenWidthRef.current}px`,
    );
    panelResizeLockRef.current = lock;
  }, []);

  const restorePanelAfterResize = useCallback(() => {
    panelResizeLockRef.current = false;
    const canvas = workspaceCanvasRef.current;
    const anchor = reflowAnchorRef.current;
    if (!canvas || !anchor) {
      canvas?.classList.remove("is-reflow-restoring");
      return;
    }
    // Keep the child layout observers suspended until the outer anchor has
    // converged. Removing the frozen width is what allows the real reflow;
    // this second class prevents Masonry's legacy raw-scroll loop from
    // racing the anchor compensation during that reflow.
    canvas.classList.remove("is-reflow-frozen");
    canvas.classList.add("is-reflow-restoring");
    scheduleAnchorRestore(
      canvas,
      anchor,
      reflowRestoreFrameRef,
      12,
      () => {
        canvas.classList.remove("is-reflow-restoring");
        reflowAnchorRef.current = null;
        reflowScrollSnapshotRef.current = null;
      },
      reflowScrollSnapshotRef.current ?? undefined,
    );
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", restorePanelAfterResize);
    return () => window.removeEventListener("pointerup", restorePanelAfterResize);
  }, [restorePanelAfterResize]);

  useLayoutEffect(() => {
    panelResizeReleaseRef.current = restorePanelAfterResize;
    return () => {
      panelResizeReleaseRef.current = () => undefined;
    };
  }, [restorePanelAfterResize, panelResizeReleaseRef]);

  useLayoutEffect(() => {
    if (!panelResizing) {
      panelReflowFrozenWidthRef.current = null;
      const canvas = workspaceCanvasRef.current;
      canvas?.classList.remove("is-reflow-frozen");
      canvas?.style.removeProperty("--reflow-frozen-width");
    }
  }, [panelResizing]);
  return { setOpenLibraryChooserOpen, panelWidthSnapshotRef, reflowAnchorRef, workspaceCanvasRef, reflowScrollSnapshotRef, panelResizeLockRef, reflowRestoreFrameRef, panelResizingRef, cardSizeRestoreFrameRef, aiAnalyzing, lastAiBatchJobIdsRef, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, descriptionIsAi, aiContent, setDescriptionIsAi, setAiContent, saveMetadata, loadMetadata, reportedVisibleWindowKeyRef, interactionGenerationRef, viewportScrollTopRef, previewAssetRef, viewportGenerationRef, visibleWindowAssetIdsRef, assetViewMode, previewAsset, assetCardSize, canvasPrefs, marqueeBoxRef, cardResizeAnchorRef, cardResizeScrollSnapshotRef, setFolderCanvasContentWidthPx, setCanvasWidthPx, previewRestoringRef, previewRestoring, pendingViewportRestoreRef, wakeViewerChrome, setPreviewRestoring, setPreviewCanvasReady, clearPreviewScrollHold, setPreviewAsset, lastPreviewRestoredTopRef, armPreviewScrollHold, importLibraryChooserOpen, openLibraryChooserOpen, importValidated, applyLoadedMetadata, applyLiveAiProgressRef, imageSequencePrefs, loadAiContentForAsset, setExportDialogOpen, setImportValidated, exportDialogOpen, setImportLibraryChooserOpen, previewModalRef, setAiProfiles, updateAiActiveProfileId, setAiProfileDraftId, setAiProfileName, setAiApiFormat, setAiModel, setAiBaseUrl, setAiHasKey, setAiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, setAiDescriptionEnabled, setAiTagsEnabled, setAiRatingEnabled, setAiForceExistingTags, setAiAnalysisSettings, setAiLanguages, setAiConcurrencyLimit, setAiMaxAnalysisImageEdgePx, setAiAutoAnalyzeEnabled, setAiDisclaimerAccepted, aiVerifiedFingerprintRef, aiProfiles, aiProfileDraftId, aiApiKey, aiActiveProfileId, aiApiFormat, aiModel, aiBaseUrl, aiDraftHasKey, setAiConnectionState, aiConfigPersistDraftRef, setAiApiKey, setAiSaveVerifying, aiAnalysisSettings, aiProfileName, aiAutoConnectAttemptedRef, aiHasKey, aiConnectionProbeGenerationRef, refreshAiBatchStatusRef, revealAppLog, folderCardWidthPx, panelReflowFrozenWidthRef, cardSizeStops, previewCanvasReady, syncCardStatuses, viewerVolumeMuted, viewerVolume, viewerChromeIdle, viewerChromePrefs, setViewerChromePrefs, onViewerChromeActivity, aiUiPrefs, setAiUiPrefs, setImageSequencePrefs, capturePanelResizeAnchor };
}
