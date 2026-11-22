import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { type ImportConflictPlan, type ImportSourceFailurePlan } from "../../shared/protocol/responses";
import { type CreateLibraryPhase } from "../CreateDialog";
import { hasFeatureHintBeenShown, isFeatureHintEnabled, saveFeatureHintPreferences, withFeatureHintShown } from "../feature-hint-preferences";
import { FOLDER_BROWSE_CARD_PREFERENCES_CHANGED, loadFolderBrowseCardPreferences } from "../folder-browse-card-preferences";
import { importedSequenceFrameUrl, type SequencePreviewFrame, type SequencePreviewSource } from "../image-sequence-preview";
import { resolveImportConflictPresentation } from "../import-conflict-flow";
import { loadImportConflictPreferences, type RememberedDuplicateDecision, type RememberedNameConflictDecision } from "../import-conflict-preferences";
import { advanceLibraryViewSession, invalidateLibraryViewSession, isCurrentLibraryViewSession, type LibraryViewSession, type LibraryViewSessionToken } from "../library-view-session";
import { LINKED_FOLDER_ADD_HINT_KEY, shouldShowLinkedFolderAddHint } from "../linked-folder-add-hint";
import { isPostImportSequenceOfferId, type PostImportSequencePlan } from "../post-import-image-sequences";
import { recursiveSubfoldersHintKey } from "../recursive-subfolders-hint";
import { type parseSearchExpression } from "../search-expression";
import { readSearchHistory } from "../search-history";
import { useBrowseField } from "../stores/browse-store";
import { dialogsFields, type DialogsState, useDialogField } from "../stores/dialogs-store";
import { type NavigationState, useNavigationField } from "../stores/navigation-store";
import { queryFields, useQueryField } from "../stores/query-store";
import { sessionFields, type SessionState, useSessionField } from "../stores/session-store";
import { useTransfersField } from "../stores/transfers-store";
import { workspaceFields } from "../stores/workspace-store";
import { useToastNotifications } from "../useToastNotifications";
import { useContextMenu } from "../workbench/menu/context-menu";
import { usePanelResize } from "../workbench/shell/use-panel-resize";
import { type WorkspaceTabBrowseState } from "../workspace-tabs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseLibraryShellStateDeps {
  library: SessionState["library"];
  t: TranslateFn;
  setFatalAlertAlreadyOpen: Dispatch<SetStateAction<DialogsState["fatalAlertAlreadyOpen"]>>;
  setFatalDialogTitle: Dispatch<SetStateAction<DialogsState["fatalDialogTitle"]>>;
  pendingAlreadyOpenPathRef: RefObject<string | null>;
  setLibraryRecoveryDialogOpen: Dispatch<SetStateAction<SessionState["libraryRecoveryDialogOpen"]>>;
  linkedFolders: NavigationState["linkedFolders"];
  assetScope: NavigationState["assetScope"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useLibraryShellState({ library, t, setFatalAlertAlreadyOpen, setFatalDialogTitle, pendingAlreadyOpenPathRef, setLibraryRecoveryDialogOpen, linkedFolders, assetScope }: UseLibraryShellStateDeps) {
  // Toast + fatal alert (REQ-SHELL-010 / Serpent-99lv): controller owns
  // auto-dismiss, stack ordering, and the toast closing lifecycle.
  const {
    renderedStack: renderedToastStack,
    fatal: fatalAlertMessage,
    setError,
    setWarning,
    setNotice,
    setFatal,
    dismissToast,
    handleToastTransitionEnd,
  } = useToastNotifications();
  // P1: tell the user once per library when `.keel` could not become `.keel`.
  const metaDirNoticeLibraryIdRef = useRef<string | null>(null);
  useEffect(() => {
    const migration = library?.metaDirMigration;
    if (!library || !migration || metaDirNoticeLibraryIdRef.current === library.libraryId) return;
    metaDirNoticeLibraryIdRef.current = library.libraryId;
    if (migration === "failed") {
      setWarning(t("library.metaDirMigrationFailed", { reason: library.metaDirMigrationReason ?? "?" }));
    } else {
      setNotice(t("library.metaDirMigrationBoth"));
    }
  }, [library, setNotice, setWarning, t]);
  const [workerRecoveryState, setWorkerRecoveryState] = useSessionField("workerRecoveryState");
  const topVisibleToastId = renderedToastStack.find(
    (entry) => !entry.closing,
  )?.id;
  const dismissFatalAlert = useCallback(() => {
    setFatalAlertAlreadyOpen(false);
    setFatalDialogTitle(null);
    setFatal(null);
  }, [setFatal, setFatalAlertAlreadyOpen, setFatalDialogTitle]);
  const dismissAlreadyOpenPrompt = useCallback(() => {
    pendingAlreadyOpenPathRef.current = null;
    dismissFatalAlert();
  }, [dismissFatalAlert, pendingAlreadyOpenPathRef]);

  const showBlockingError = useCallback(
    (title: string, message: string, options?: { alreadyOpen?: boolean }) => {
      if (options?.alreadyOpen !== true) {
        pendingAlreadyOpenPathRef.current = null;
      }
      setFatalAlertAlreadyOpen(options?.alreadyOpen === true);
      setFatalDialogTitle(title);
      setFatal(message);
    },
    [setFatal, setFatalAlertAlreadyOpen, setFatalDialogTitle, pendingAlreadyOpenPathRef],
  );

  // NAS/SMB 库提示不再用常驻 banner（破坏界面一体性），改为每次打开库时
  // 弹一次普通 warning toast。networkStorage 由打开动作决定，同一库不变，
  // 按库身份（libraryId）去重即可，不必依赖整个 library 对象。
  useEffect(() => {
    if (library?.networkStorage) {
      setWarning(t("shell.networkStorageNotice"));
    }
  }, [library?.networkStorage, library?.libraryId, setWarning, t]);

  // 恢复提示（备份/抢救后）不再用常驻 banner，改为打开库时弹一次确认弹窗；
  // 同一库只弹一次（ref 记录），避免 recovery 对象引用抖动导致重复弹窗。
  const recoveryNotifiedLibraryIdRef = useRef<string | null>(null);
  useEffect(() => {
    const recovery = library?.recovery;
    if (
      recovery &&
      library?.libraryId !== recoveryNotifiedLibraryIdRef.current
    ) {
      recoveryNotifiedLibraryIdRef.current = library.libraryId;
      setLibraryRecoveryDialogOpen(true);
    }
  }, [library?.recovery, library?.libraryId, setLibraryRecoveryDialogOpen]);
  const [dialog, setDialog] = useDialogField("dialog");
  const [createLibraryPhase, setCreateLibraryPhase] =
    useState<CreateLibraryPhase>("start");
  const [useExistingCreateFolder] = useDialogField("useExistingCreateFolder");
  const [createStorageLayout] = useDialogField("createStorageLayout");
  const hadLibraryRef = useRef(false);
  const [dialogValue, setDialogValue] = useState(() => t("shell.myLibrary"));
  const [conflicts, setConflicts] = useTransfersField("conflicts");
  const [importSourceFailurePlan, setImportSourceFailurePlan] = useTransfersField("importSourceFailurePlan");
  const [importDecisionSubmitting, setImportDecisionSubmitting] = useTransfersField("importDecisionSubmitting");
  const completedImportIdRef = useRef<string | null>(null);
  const retiredImportIdsRef = useRef<Set<string>>(new Set());
  const [imageSequenceImportOffer, setImageSequenceImportOffer] = useTransfersField("imageSequenceImportOffer");
  const [imageSequenceImportIndex, setImageSequenceImportIndex] = useTransfersField("imageSequenceImportIndex");
  const imageSequenceOfferIdRef = useRef<string | null>(null);
  const [imageSequenceImportError, setImageSequenceImportError] = useTransfersField("imageSequenceImportError");
  const [imageSequenceImportSubmitting, setImageSequenceImportSubmitting] = useTransfersField("imageSequenceImportSubmitting");
  const postImportSequencePlanRef = useRef<PostImportSequencePlan | null>(null);
  const [imageSequenceConfirmPurpose, setImageSequenceConfirmPurpose] = useTransfersField("imageSequenceConfirmPurpose");

  useEffect(() => {
    const offerId = imageSequenceImportOffer?.offerId ?? null;
    if (offerId !== imageSequenceOfferIdRef.current) {
      imageSequenceOfferIdRef.current = offerId;
      setImageSequenceImportIndex(0);
    }
  }, [imageSequenceImportOffer, setImageSequenceImportIndex]);

  /**
   * Serpent-866c20：确认面板的预览来源。导入后成组时帧已经是库内资产（走 source
   * 通道）；导入前的候选帧只交给 Main 的 offerId + 帧号解析，Renderer 不经手路径。
   */
  const imageSequencePreviewSource = useMemo((): SequencePreviewSource | null => {
    const offer = imageSequenceImportOffer;
    if (!offer) return null;
    const index = Math.min(
      imageSequenceImportIndex,
      Math.max(0, offer.sequences.length - 1),
    );
    const sequence = offer.sequences[index];
    if (!sequence) return null;
    const planned = postImportSequencePlanRef.current?.sequences[index];
    if (planned && planned.frameAssetIds.length > 0) {
      const frames: SequencePreviewFrame[] = [];
      planned.frameAssetIds.forEach((assetId, offset) => {
        const revisionId = planned.frameRevisionIds[offset];
        // 没有修订就无法按 source 协议取源文件，宁可少一帧也不给坏 URL。
        if (!revisionId) return;
        frames.push({
          frameNumber:
            planned.frameNumbers[offset] ?? sequence.firstFrame + offset,
          url: importedSequenceFrameUrl(offer.libraryId, assetId, revisionId),
        });
      });
      return frames.length > 0 ? { kind: "assets", frames } : null;
    }
    if (!offer.offerId || isPostImportSequenceOfferId(offer.offerId)) return null;
    return {
      kind: "pending",
      offerId: offer.offerId,
      sequenceIndex: index,
      firstFrame: sequence.firstFrame,
      frameCount: sequence.frameCount,
    };
  }, [imageSequenceImportIndex, imageSequenceImportOffer]);
  const [conflictPhase, setConflictPhase] = useTransfersField("conflictPhase");
  const [duplicateDecision, setDuplicateDecision] = useTransfersField("duplicateDecision");
  const [nameDecision, setNameDecision] = useTransfersField("nameDecision");
  const [rememberNameConflict, setRememberNameConflict] = useTransfersField("rememberNameConflict");
  const [rememberDuplicate, setRememberDuplicate] = useTransfersField("rememberDuplicate");
  const resolveImportConflictsRef = useRef<
    (
      plan: ImportConflictPlan,
      name: RememberedNameConflictDecision,
      duplicate: RememberedDuplicateDecision,
    ) => Promise<void>
  >(async () => {});
  const presentImportConflicts = useCallback((plan: ImportConflictPlan) => {
    const prefs = loadImportConflictPreferences();
    const presentation = resolveImportConflictPresentation(plan, prefs);
    setImportSourceFailurePlan(null);
    setConflicts(plan);
    setNameDecision(presentation.nameDecision);
    setDuplicateDecision(presentation.duplicateDecision);
    setRememberNameConflict(false);
    setRememberDuplicate(false);
    setConflictPhase(presentation.phase);
    if (presentation.phase === null) {
      void resolveImportConflictsRef.current(
        plan,
        presentation.nameDecision,
        presentation.duplicateDecision,
      );
    }
  }, [setConflictPhase, setConflicts, setDuplicateDecision, setImportSourceFailurePlan, setNameDecision, setRememberDuplicate, setRememberNameConflict]);
  const clearImportConflictsUi = useCallback(() => {
    setConflicts(null);
    setConflictPhase(null);
  }, [setConflictPhase, setConflicts]);
  const presentImportSourceFailure = useCallback((plan: ImportSourceFailurePlan) => {
    clearImportConflictsUi();
    setImportSourceFailurePlan(plan);
  }, [clearImportConflictsUi, setImportSourceFailurePlan]);
  const clearImportSourceFailureUi = useCallback(() => {
    setImportSourceFailurePlan(null);
  }, [setImportSourceFailurePlan]);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 800);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1020);
  const panelResizeReleaseRef = useRef<() => void>(() => undefined);
  // REQ-SHELL-007 / REQ-SHELL-011: draggable nav/inspector pane widths + auto-hide.
  const {
    navPanelWidth,
    inspectorPanelWidth,
    resizing: panelResizing,
    shellStyle: panelResizeShellStyle,
    beginResize: beginPanelResize,
    beginEdgeRestore: beginPanelEdgeRestore,
    resetPanel: resetPanelWidth,
  } = usePanelResize({
    onAutoHide: (panel) => {
      if (panel === "nav") setLeftOpen(false);
      else setRightOpen(false);
    },
    onEdgeRestore: (panel) => {
      if (panel === "nav") setLeftOpen(true);
      else setRightOpen(true);
    },
    onResizeEnd: () => panelResizeReleaseRef.current(),
  });
  const workspaceHistoryReplayQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceHistoryReplayEpochRef = useRef(0);
  const workspaceTabTransitionRef = useRef(0);
  const [workspaceNavigationPending, setWorkspaceNavigationPending] =
    useState(false);
  const setNavHistoryUi = workspaceFields.setterFor("navHistoryUi");

  // Tags
  const [tags, setTags] = useNavigationField("tags");
  const [activeTagId, setActiveTagId] = useNavigationField("activeTagId");
  const [storedPinnedTagId, setPinnedTagId] = useState<string | null>(null);

  // REQ-FOLDER-009: folder browse/search recurse only when explicitly enabled.
  const [folderRecursive, setFolderRecursive] = useNavigationField("folderRecursive");
  const [folderRecursivePrefs] = useNavigationField("folderRecursivePrefs");
  const [showFolderCardsWhenRecursive, setShowFolderCardsWhenRecursive] = useNavigationField("showFolderCardsWhenRecursive");
  // Serpent-b8a853: one-time feature hints for hidden UI affordances share a
  // global switch (Settings → Feature hints) and per-key "seen" marks.
  const [featureHintPrefs, setFeatureHintPrefs] = useNavigationField("featureHintPrefs");
  // Linked-folder "new user" hint: after adding a normal folder, briefly pulse
  // the sidebar 导入链接文件夹 entry. Dismissed permanently by hovering it
  // >0.5s or by actually importing a linked folder.
  const [linkedFolderHintActive, setLinkedFolderHintActive] = useNavigationField("linkedFolderHintActive");
  const linkedFolderHintStopTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const linkedFolderHintHoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const includeSubfoldersHoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const linkedFolderAddHintEligible =
    shouldShowLinkedFolderAddHint({
      hintsEnabled: isFeatureHintEnabled(featureHintPrefs),
      alreadyDismissed: hasFeatureHintBeenShown(
        featureHintPrefs,
        LINKED_FOLDER_ADD_HINT_KEY,
      ),
      hasLinkedFolders: linkedFolders.length > 0,
    });
  useEffect(
    () => () => {
      if (linkedFolderHintStopTimerRef.current) {
        clearTimeout(linkedFolderHintStopTimerRef.current);
      }
      if (linkedFolderHintHoverTimerRef.current) {
        clearTimeout(linkedFolderHintHoverTimerRef.current);
      }
      if (includeSubfoldersHoverTimerRef.current) {
        clearTimeout(includeSubfoldersHoverTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    const onChanged = (): void => {
      setShowFolderCardsWhenRecursive(
        loadFolderBrowseCardPreferences().showWhenRecursive,
      );
    };
    window.addEventListener(FOLDER_BROWSE_CARD_PREFERENCES_CHANGED, onChanged);
    return () => {
      window.removeEventListener(
        FOLDER_BROWSE_CARD_PREFERENCES_CHANGED,
        onChanged,
      );
    };
  }, [setShowFolderCardsWhenRecursive]);
  // Hovering a highlighted affordance for >0.5s dismisses that hint
  // permanently (shared "all highlights" rule, Serpent-b8a853).
  const linkedFolderHintShow =
    linkedFolderHintActive && linkedFolderAddHintEligible;
  const beginLinkedFolderHintHover = (): void => {
    linkedFolderHintHoverTimerRef.current = setTimeout(() => {
      linkedFolderHintHoverTimerRef.current = null;
      setLinkedFolderHintActive(false);
      if (linkedFolderHintStopTimerRef.current) {
        clearTimeout(linkedFolderHintStopTimerRef.current);
        linkedFolderHintStopTimerRef.current = null;
      }
      const next = withFeatureHintShown(
        featureHintPrefs,
        LINKED_FOLDER_ADD_HINT_KEY,
      );
      setFeatureHintPrefs(next);
      saveFeatureHintPreferences(next);
    }, 500);
  };
  const endLinkedFolderHintHover = (): void => {
    if (linkedFolderHintHoverTimerRef.current) {
      clearTimeout(linkedFolderHintHoverTimerRef.current);
      linkedFolderHintHoverTimerRef.current = null;
    }
  };

  const [searchValue, setSearchValue] = useQueryField("searchValue");
  const lastValidSearchQueryRef = useRef<{ scope: string; query: ReturnType<typeof parseSearchExpression> } | null>(null);
  const lastValidFolderSearchQueryRef = useRef<{ scope: string; query: ReturnType<typeof parseSearchExpression> } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [storedSearchHistory, setStoredSearchHistory] = useQueryField("storedSearchHistory");
  const setSearchHistoryOpen = dialogsFields.setterFor("searchHistoryOpen");
  const searchHistoryDismissedUntilInputRef = useRef(false);
  const setSearchHistoryActiveIndex = queryFields.setterFor("searchHistoryActiveIndex");
  const searchHistoryLibraryId = library?.libraryId ?? null;
  const searchHistory =
    searchHistoryLibraryId === null
      ? []
      : storedSearchHistory?.libraryId === searchHistoryLibraryId
        ? storedSearchHistory.queries
        : readSearchHistory(window.localStorage, searchHistoryLibraryId);
  function publishSearchHistory(queries: string[]) {
    if (!searchHistoryLibraryId) return;
    setStoredSearchHistory({ libraryId: searchHistoryLibraryId, queries });
  }
  const [formatFilter, setFormatFilter] = useQueryField("formatFilter");
  const [excludeFormatFilter, setExcludeFormatFilter] = useQueryField("excludeFormatFilter");
  const [colorFilter, setColorFilter] = useQueryField("colorFilter");
  const [colorSimilarity, setColorSimilarity] = useQueryField("colorSimilarity");
  const [excludeColorFilter, setExcludeColorFilter] = useQueryField("excludeColorFilter");
  const [tagFilter, setTagFilter] = useQueryField("tagFilter");
  const [tagFilterExpression, setTagFilterExpression] = useQueryField("tagFilterExpression");
  const [tagFilterMode, setTagFilterMode] = useQueryField("tagFilterMode");
  const [tagFilterLastValidExpression, setTagFilterLastValidExpression] = useQueryField("tagFilterLastValidExpression");
  const pinnedTagId = tagFilterMode === "expression" && tags.some(tag => tag.tagId === storedPinnedTagId && tagFilterExpression === JSON.stringify(tag.name)) ? storedPinnedTagId : null;
  const [excludeTagFilter, setExcludeTagFilter] = useQueryField("excludeTagFilter");
  const [excludedTagFilter, setExcludedTagFilter] = useQueryField("excludedTagFilter");
  const [includeAiTagFilter, setIncludeAiTagFilter] = useQueryField("includeAiTagFilter");
  // Serpent-eaxs: tag-management AND search ("包含 N 个标签") splits the tag
  // names into separate clauses (clauses are ANDed; values within one clause
  // are ORed). Any explicit filter-bar edit resets this to "any".
  const [tagFilterMatch, setTagFilterMatch] = useQueryField("tagFilterMatch");
  const [ratingFilter, setRatingFilter] = useQueryField("ratingFilter");
  const [excludeRatingFilter, setExcludeRatingFilter] = useQueryField("excludeRatingFilter");
  const [includeAiRatingFilter, setIncludeAiRatingFilter] = useQueryField("includeAiRatingFilter");
  const [favoriteFilter, setFavoriteFilter] = useQueryField("favoriteFilter");
  const [sourceUrlFilter, setSourceUrlFilter] = useQueryField("sourceUrlFilter");
  const [availabilityFilter, setAvailabilityFilter] = useQueryField("availabilityFilter");
  const [excludeAvailabilityFilter, setExcludeAvailabilityFilter] = useQueryField("excludeAvailabilityFilter");
  const [widthRange, setWidthRange] = useQueryField("widthRange");
  const [heightRange, setHeightRange] = useQueryField("heightRange");
  const [aspectRatioRange, setAspectRatioRange] = useQueryField("aspectRatioRange");
  /** Shape/aspect preset OR ranges (Serpent-gp4). */
  const [aspectRatioRanges, setAspectRatioRanges] = useQueryField("aspectRatioRanges");
  // REQ-FILTER-010: resolution buckets filter on the longer edge (long_edge).
  const [longEdgeRange, setLongEdgeRange] = useQueryField("longEdgeRange");
  const [durationRange, setDurationRange] = useQueryField("durationRange");
  const [sortField, setSortField] = useQueryField("sortField");
  const [sortOrder, setSortOrder] = useQueryField("sortOrder");
  /** Serpent-hm28: null = normal sort; otherwise client shuffle seed. */
  const [shuffleSeed, setShuffleSeed] = useQueryField("shuffleSeed");
  const [searchOffset, setSearchOffset] = useBrowseField("searchOffset");
  const [searchTotal, setSearchTotal] = useBrowseField("searchTotal");
  const [filteredFolderCountRefreshToken, setFilteredFolderCountRefreshToken] = useBrowseField("filteredFolderCountRefreshToken");
  const [searchSnippets, setSearchSnippets] = useBrowseField("searchSnippets");
  // Serpent-b8a853: one-time hint for the include-subfolders icon. The hint
  // key is per (library, folder scope); the actual flash decision needs the
  // browse canvas mode (folders-only = child-folder cards but zero direct
  // assets) which is computed below with browseCanvasBodyLayout.
  const recursiveHintKey =
    library && assetScope !== "all" && assetScope !== "root"
      ? recursiveSubfoldersHintKey(library.libraryId, assetScope)
      : null;
  const { open: openContextMenu, close: closeContextMenu } =
    useContextMenu();
  const hadDiscoveryInput = useRef(false);
  const skipDiscoveryReloadSignatureRef = useRef<string | null>(null);
  const lastAppliedWorkspaceBrowseStateRef = useRef<{
    tabId: string | null;
    state: WorkspaceTabBrowseState;
  } | null>(null);
  // Auto-search requests can resolve out of order while the user is still
  // typing. Only the newest first-page request may replace the canvas.
  const searchRequestGenerationRef = useRef(0);
  // Browse loads can overlap a destructive folder mutation. An older request
  // may then reject with FOLDER_NOT_FOUND after the UI has already navigated
  // away from that scope. Ignore every result (including errors) from a load
  // generation that is no longer current so stale reads cannot cover the
  // undoable mutation receipt with a misleading error toast.
  const contentLoadGenerationRef = useRef(0);
  const libraryViewSessionRef = useRef<LibraryViewSession>({
    libraryId: null,
    generation: 0,
  });
  const navigationHydrationAbortRef = useRef<AbortController | null>(null);
  const pendingLibraryCloseFencesRef = useRef(new Map<string, Set<number>>());
  const localAssetRemovalGenerationRef = useRef(0);

  const cancelPendingLibraryReads = useCallback(() => {
    contentLoadGenerationRef.current += 1;
    navigationHydrationAbortRef.current?.abort();
    navigationHydrationAbortRef.current = null;
  }, []);
  const beginLibraryTransition = useCallback(() => {
    cancelPendingLibraryReads();
    const next = invalidateLibraryViewSession(libraryViewSessionRef.current);
    libraryViewSessionRef.current = next;
    return next;
  }, [cancelPendingLibraryReads]);
  const activateLibraryView = useCallback(
    (libraryId: string) => {
      cancelPendingLibraryReads();
      const next = advanceLibraryViewSession(
        libraryViewSessionRef.current,
        libraryId,
      );
      libraryViewSessionRef.current = next;
      return next;
    },
    [cancelPendingLibraryReads],
  );
  const ensureLibraryView = useCallback(
    (libraryId: string): LibraryViewSessionToken | null => {
      const current = libraryViewSessionRef.current;
      if (current.libraryId === libraryId) {
        return {
          libraryId,
          generation: current.generation,
        };
      }
      // A stale callback can retain the previous library object for several
      // awaits. Never let that callback reactivate its old identity after a
      // newer library has been published; only bootstrap an identity while
      // the renderer has no library ref yet.
      if (sessionFields.get("library") !== null) return null;
      const next = activateLibraryView(libraryId);
      return {
        libraryId,
        generation: next.generation,
      };
    },
    [activateLibraryView],
  );
  const isCurrentLibraryView = useCallback(
    (token: LibraryViewSessionToken) =>
      isCurrentLibraryViewSession(libraryViewSessionRef.current, token),
    [],
  );
  const markLibraryClosePending = useCallback((libraryId: string): number => {
    const generation = libraryViewSessionRef.current.generation;
    const pending = pendingLibraryCloseFencesRef.current.get(libraryId) ?? new Set<number>();
    pending.add(generation);
    pendingLibraryCloseFencesRef.current.set(libraryId, pending);
    return generation;
  }, []);
  return { pendingLibraryCloseFencesRef, setSearchTotal, setSearchOffset, setSearchSnippets, setError, setNotice, ensureLibraryView, isCurrentLibraryView, retiredImportIdsRef, sortField, sortOrder, setNavHistoryUi, searchValue, lastValidFolderSearchQueryRef, dismissFatalAlert, workspaceNavigationPending, navPanelWidth, inspectorPanelWidth, panelResizing, panelResizeReleaseRef, shuffleSeed, tags, activeTagId, colorFilter, excludeColorFilter, formatFilter, excludeFormatFilter, tagFilter, excludeTagFilter, excludedTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, tagFilterExpression, tagFilterMode, includeAiTagFilter, includeAiRatingFilter, filteredFolderCountRefreshToken, recursiveHintKey, folderRecursive, featureHintPrefs, searchTotal, showBlockingError, setWarning, showFolderCardsWhenRecursive, contentLoadGenerationRef, navigationHydrationAbortRef, setTags, setFolderRecursive, setActiveTagId, setTagFilter, dialog, setDialogValue, setCreateLibraryPhase, setDialog, hadLibraryRef, setWorkerRecoveryState, setWorkspaceNavigationPending, libraryViewSessionRef, beginLibraryTransition, activateLibraryView, setFilteredFolderCountRefreshToken, setFatal, pinnedTagId, colorSimilarity, tagFilterLastValidExpression, workspaceTabTransitionRef, workspaceHistoryReplayEpochRef, closeContextMenu, searchOffset, searchSnippets, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setColorSimilarity, setExcludeColorFilter, setTagFilterExpression, setTagFilterMode, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setTagFilterMatch, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setLongEdgeRange, setDurationRange, setSortField, setSortOrder, setShuffleSeed, lastAppliedWorkspaceBrowseStateRef, skipDiscoveryReloadSignatureRef, workspaceHistoryReplayQueueRef, dialogValue, useExistingCreateFolder, createStorageLayout, markLibraryClosePending, hadDiscoveryInput, folderRecursivePrefs, lastValidSearchQueryRef, localAssetRemovalGenerationRef, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, presentImportConflicts, presentImportSourceFailure, clearImportConflictsUi, clearImportSourceFailureUi, searchRequestGenerationRef, searchHistoryDismissedUntilInputRef, setSearchHistoryOpen, setSearchHistoryActiveIndex, publishSearchHistory, imageSequenceImportOffer, setImageSequenceImportSubmitting, setImageSequenceImportIndex, imageSequenceConfirmPurpose, setImportDecisionSubmitting, completedImportIdRef, resolveImportConflictsRef, importSourceFailurePlan, conflicts, rememberNameConflict, nameDecision, setConflictPhase, duplicateDecision, rememberDuplicate, setFeatureHintPrefs, setLinkedFolderHintActive, cancelPendingLibraryReads, conflictPhase, fatalAlertMessage, importDecisionSubmitting, searchInputRef, openContextMenu, imageSequenceImportError, imageSequenceImportIndex, imageSequencePreviewSource, imageSequenceImportSubmitting, setNameDecision, setRememberNameConflict, setDuplicateDecision, setRememberDuplicate, leftOpen, rightOpen, panelResizeShellStyle, setLeftOpen, searchHistory, setRightOpen, linkedFolderHintShow, beginLinkedFolderHintHover, endLinkedFolderHintHover, linkedFolderAddHintEligible, linkedFolderHintStopTimerRef, includeSubfoldersHoverTimerRef, workerRecoveryState, renderedToastStack, topVisibleToastId, dismissToast, handleToastTransitionEnd, createLibraryPhase, dismissAlreadyOpenPrompt, resetPanelWidth, beginPanelResize, beginPanelEdgeRestore };
}
