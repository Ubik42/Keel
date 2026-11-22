import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import type { WorkspaceNavHistory } from "../../workbench/workspace/workspace-nav-history";
import { type AiProgressJobUpdate } from "../../ai/ai-analyze-progress";
import type { JobStatusCoordinator } from "../../jobs/job-status-coordinator";
import { type BrowseState } from "../../stores/browse-store";
import { type InspectorState } from "../../stores/inspector-store";
import { type JobsState } from "../../stores/jobs-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { selectionFields } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type WorkspaceState } from "../../stores/workspace-store";
import { type WorkspaceTabBrowseState } from "../../workspace/workspace-tabs";
import { useEffect } from "react";

export interface UseWorkspaceHistoryUiDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  jobStatusCoordinatorRef: RefObject<JobStatusCoordinator | null>;
  setAiJobs: Dispatch<SetStateAction<JobsState["aiJobs"]>>;
  applyLiveAiProgressRef: RefObject<(event: { queued: number; running: number; succeeded: number; failed: number; changedJobs?: AiProgressJobUpdate[]; }) => void>;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  refreshAfterAiRef: RefObject<(assetId: string) => Promise<void>>;
  setFilteredFolderCountRefreshToken: Dispatch<SetStateAction<BrowseState["filteredFolderCountRefreshToken"]>>;
  setAiContent: Dispatch<SetStateAction<InspectorState["aiContent"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  rebuildAndApplyMultiEditRef: RefObject<(ids: string[]) => void>;
  locale: AppLocale;
  setError: (text: string | null) => void;
  setFatal: (text: string | null) => void;
  syncActiveWorkspaceTabLocation: () => void;
  setNavHistoryUi: Dispatch<SetStateAction<WorkspaceState["navHistoryUi"]>>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  searchValue: QueryState["searchValue"];
  pinnedTagId: string | null;
  formatFilter: QueryState["formatFilter"];
  excludeFormatFilter: QueryState["excludeFormatFilter"];
  colorFilter: QueryState["colorFilter"];
  excludeColorFilter: QueryState["excludeColorFilter"];
  colorSimilarity: QueryState["colorSimilarity"];
  tagFilter: QueryState["tagFilter"];
  tagFilterExpression: QueryState["tagFilterExpression"];
  tagFilterMode: QueryState["tagFilterMode"];
  tagFilterLastValidExpression: QueryState["tagFilterLastValidExpression"];
  excludeTagFilter: QueryState["excludeTagFilter"];
  excludedTagFilter: QueryState["excludedTagFilter"];
  includeAiTagFilter: QueryState["includeAiTagFilter"];
  tagFilterMatch: QueryState["tagFilterMatch"];
  ratingFilter: QueryState["ratingFilter"];
  excludeRatingFilter: QueryState["excludeRatingFilter"];
  includeAiRatingFilter: QueryState["includeAiRatingFilter"];
  favoriteFilter: QueryState["favoriteFilter"];
  sourceUrlFilter: QueryState["sourceUrlFilter"];
  availabilityFilter: QueryState["availabilityFilter"];
  excludeAvailabilityFilter: QueryState["excludeAvailabilityFilter"];
  widthRange: QueryState["widthRange"];
  heightRange: QueryState["heightRange"];
  aspectRatioRange: QueryState["aspectRatioRange"];
  aspectRatioRanges: QueryState["aspectRatioRanges"];
  longEdgeRange: QueryState["longEdgeRange"];
  durationRange: QueryState["durationRange"];
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  shuffleSeed: QueryState["shuffleSeed"];
  folderRecursive: NavigationState["folderRecursive"];
  showIgnoredItems: QueryState["showIgnoredItems"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useWorkspaceHistoryUi({ api, library, jobStatusCoordinatorRef, setAiJobs, applyLiveAiProgressRef, reloadCurrentContentRef, refreshAfterAiRef, setFilteredFolderCountRefreshToken, setAiContent, setNotice, t, rebuildAndApplyMultiEditRef, locale, setError, setFatal, syncActiveWorkspaceTabLocation, setNavHistoryUi, navHistoryRef, searchValue, pinnedTagId, formatFilter, excludeFormatFilter, colorFilter, excludeColorFilter, colorSimilarity, tagFilter, tagFilterExpression, tagFilterMode, tagFilterLastValidExpression, excludeTagFilter, excludedTagFilter, includeAiTagFilter, tagFilterMatch, ratingFilter, excludeRatingFilter, includeAiRatingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, excludeAvailabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, longEdgeRange, durationRange, sortField, sortOrder, shuffleSeed, folderRecursive, showIgnoredItems }: UseWorkspaceHistoryUiDeps) {
  useEffect(() => {
    if (!api || !library) return;
    const unsubscribeProgress = api.onAiProgress((event) => {
      if (event.libraryId !== library.libraryId) return;
      // Progress events already carry the counts; the fallback poll only needs
      // to learn that AI work exists (and stop backing off).
      jobStatusCoordinatorRef.current?.noteActivity("ai");
      // Serpent-u0tn: do not arm analyzing UI for background/import auto jobs
      // when no user-initiated batch size was set (JOBS-007 rollback residue).
      setAiJobs((current) =>
        current
          ? {
              ...current,
              queued: event.queued,
              running: event.running,
              succeeded: event.succeeded,
              failed: event.failed,
            }
          : {
              queued: event.queued,
              running: event.running,
              succeeded: event.succeeded,
              failed: event.failed,
              paused: 0,
              cancelled: 0,
              jobs: [],
            },
      );
      applyLiveAiProgressRef.current(event);
    });
    const unsubscribeCompleted = api.onAiCompleted((event) => {
      if (event.libraryId !== library.libraryId) return;
      jobStatusCoordinatorRef.current?.noteActivity("ai");
      // Refresh only — completion toast is owned by queue-drain (Serpent-4i18).
      void reloadCurrentContentRef.current();
      if (selectionFields.get("selectedAssetId") === event.assetId) {
        // Serpent-c9r3: refreshAfterAi refreshes the primary's metadata and
        // (for multi-selections) every selected asset's metadata, then
        // rebuilds the batch-edit Inspector model — without the rebuild the
        // multiEdit chips stay stale after a batch AI analysis completes.
        void refreshAfterAiRef.current(event.assetId);
      }
    });
    const unsubscribeCleared = api.onAiCleared((event) => {
      if (event.libraryId !== library.libraryId) return;
      setFilteredFolderCountRefreshToken((token) => token + 1);
      jobStatusCoordinatorRef.current?.noteActivity("ai");
      setAiContent(null);
      setNotice(t("toast.aiContentCleared", { count: event.affectedAssetCount }));
      // Serpent-c9r3: clearing AI must NOT disturb the browsing view, selection
      // or scroll position — so we deliberately do NOT call reloadCurrentContent
      // here (a full grid refetch resets the canvas). Grid cards carry no AI
      // badges, so skipping the grid reload leaves no visible AI residue. The
      // only surface that shows AI provenance is the Inspector, so refresh just
      // that: when the current selection (primary, or any member of a
      // multi-selection) was among the cleared assets, reload its metadata +
      // tags + AI content so the Inspector drops the stale AI description /
      // badge / tags / rating immediately instead of waiting for a reselect.
      const affected = new Set(event.affectedAssetIds);
      const selectedIds = selectionFields.get("selectedAssetIds");
      const primary = selectionFields.get("selectedAssetId");
      const selectedAffected =
        (primary != null && affected.has(primary)) ||
        selectedIds.some((id) => affected.has(id));
      if (selectedAffected && primary) {
        void refreshAfterAiRef.current(primary).then(() => {
          if (selectionFields.get("selectedAssetIds").length >= 2) {
            rebuildAndApplyMultiEditRef.current([...selectionFields.get("selectedAssetIds")]);
          }
        });
      }
    });
    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeCleared();
    };
  }, [api, library, locale, setError, setFatal, setNotice, t, setAiContent, setAiJobs, setFilteredFolderCountRefreshToken, applyLiveAiProgressRef, jobStatusCoordinatorRef, rebuildAndApplyMultiEditRef, refreshAfterAiRef, reloadCurrentContentRef]);

  function syncNavHistoryUi() {
    // Keep the active tab's cached location at the shared cursor so the tab
    // strip reflects the live view (the tabs no longer own their histories).
    syncActiveWorkspaceTabLocation();
    setNavHistoryUi({
      canBack: navHistoryRef.current.canBack,
      canForward: navHistoryRef.current.canForward,
    });
  }

  function captureWorkspaceTabBrowseState(): WorkspaceTabBrowseState {
    return {
      searchValue,
      filters: {
        pinnedTagId,
        formatFilter,
        excludeFormatFilter,
        colorFilter,
        excludeColorFilter,
        colorSimilarity,
        tagFilter,
        tagFilterExpression,
        tagFilterMode,
        tagFilterLastValidExpression,
        excludeTagFilter,
        excludedTagFilter,
        includeAiTagFilter,
        tagFilterMatch,
        ratingFilter,
        excludeRatingFilter,
        includeAiRatingFilter,
        favoriteFilter,
        sourceUrlFilter,
        availabilityFilter,
        excludeAvailabilityFilter,
        widthRange,
        heightRange,
        aspectRatioRange,
        aspectRatioRanges,
        longEdgeRange,
        durationRange,
      },
      sortField,
      sortOrder,
      shuffleSeed,
      folderRecursive,
      showIgnoredItems,
    };
  }
  return { captureWorkspaceTabBrowseState, syncNavHistoryUi };
}
