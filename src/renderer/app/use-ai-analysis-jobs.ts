import { renderedLibrary } from "./app-shared";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AiJob } from "../../shared/protocol/responses";
import type { AppLocale } from "../i18n/types";
import { type AiJobStatus, type PluginJobStatus } from "../../shared/library-api";
import { MEDIA_JOB_LIST_PAGE_SIZE } from "../../shared/media-jobs";
import { collectRecentAiFailureCodes, computeAiBatchProgressForJobs, progressFromAiProgressEvent, type AiBatchProgressSnapshot, type AiProgressJobUpdate } from "../ai-analyze-progress";
import { summarizeAiFailureCodes } from "../ai-job-error-message";
import { toMessage } from "../error-utils";
import { JobStatusCoordinator } from "../job-status-coordinator";
import { requestConfirmation } from "../local-confirmation";
import { appendMediaJobListPage, applyMediaJobSummary, replaceMediaJobListPage, type MediaJobSummaryCounts } from "../media-job-status-state";
import { hasActivePluginJobs } from "../plugin-job-activity";
import { aiFields, type AiState } from "../stores/ai-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type InspectorState } from "../stores/inspector-store";
import { type JobsState } from "../stores/jobs-store";
import { type SelectionState } from "../stores/selection-store";
import { type SessionState } from "../stores/session-store";
import { useEffect } from "react";
import { flushSync } from "react-dom";

export interface UseAiAnalysisJobsDeps {
  selectedAssetId: SelectionState["selectedAssetId"];
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setError: (text: string | null) => void;
  t: TranslateFn;
  aiHasKey: AiState["aiHasKey"];
  loadAiConfig: () => Promise<void>;
  aiJobs: JobsState["aiJobs"];
  setAiJobs: Dispatch<SetStateAction<JobsState["aiJobs"]>>;
  notifyAiConnectionBatchStarted: (jobs: ReadonlyArray<AiJob>) => void;
  locale: AppLocale;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  aiBatchStatusRequestRef: RefObject<number>;
  aiBatchJobIdsRef: RefObject<string[]>;
  aiBatchSkippedCountRef: RefObject<number>;
  lastAiBatchJobIdsRef: RefObject<string[]>;
  analyzingAssetIdRef: RefObject<string | null>;
  lastAiBatchAssetIdRef: RefObject<string | null>;
  analyzingBatchSizeRef: RefObject<number>;
  aiBatchKnownJobsRef: RefObject<AiProgressJobUpdate[]>;
  aiBatchCounterBaselineRef: RefObject<{ succeeded: number; failed: number; }>;
  setAiBatchProgress: Dispatch<SetStateAction<AiState["aiBatchProgress"]>>;
  setAiAnalyzing: Dispatch<SetStateAction<AiState["aiAnalyzing"]>>;
  setAiProgressBannerVisible: Dispatch<SetStateAction<AiState["aiProgressBannerVisible"]>>;
  setAiContent: Dispatch<SetStateAction<InspectorState["aiContent"]>>;
  setMediaJobsLoading: Dispatch<SetStateAction<JobsState["mediaJobsLoading"]>>;
  setMediaJobs: Dispatch<SetStateAction<JobsState["mediaJobs"]>>;
  loadMediaJobsRef: RefObject<(quiet?: boolean) => Promise<void>>;
  mediaJobs: JobsState["mediaJobs"];
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  refreshAiBatchStatusRef: RefObject<() => void>;
  applyLiveAiProgressRef: RefObject<(event: { queued: number; running: number; succeeded: number; failed: number; changedJobs?: AiProgressJobUpdate[]; }) => void>;
  setPluginJobs: Dispatch<SetStateAction<JobsState["pluginJobs"]>>;
  jobStatusCoordinatorRef: RefObject<JobStatusCoordinator | null>;
  mediaJobsOpen: DialogsState["mediaJobsOpen"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useAiAnalysisJobs({ selectedAssetId, api, library, setError, t, aiHasKey, loadAiConfig, aiJobs, setAiJobs, notifyAiConnectionBatchStarted, locale, setNotice, aiBatchStatusRequestRef, aiBatchJobIdsRef, aiBatchSkippedCountRef, lastAiBatchJobIdsRef, analyzingAssetIdRef, lastAiBatchAssetIdRef, analyzingBatchSizeRef, aiBatchKnownJobsRef, aiBatchCounterBaselineRef, setAiBatchProgress, setAiAnalyzing, setAiProgressBannerVisible, setAiContent, setMediaJobsLoading, setMediaJobs, loadMediaJobsRef, mediaJobs, showBlockingError, reloadCurrentContentRef, refreshAiBatchStatusRef, applyLiveAiProgressRef, setPluginJobs, jobStatusCoordinatorRef, mediaJobsOpen }: UseAiAnalysisJobsDeps) {

  async function handleAnalyzeClick(
    assetId = selectedAssetId,
    batchIds?: readonly string[],
  ) {
    if (!api || !library) {
      setError(t("toast.aiAnalyzeFailed"));
      return;
    }
    const targetIds = [
      ...new Set(
        (batchIds && batchIds.length > 0
          ? batchIds
          : assetId
            ? [assetId]
            : []
        ).filter(Boolean),
      ),
    ] as string[];
    if (targetIds.length === 0) {
      setError(t("toast.aiAnalyzeNoAsset"));
      return;
    }
    if (!aiHasKey) {
      setError(t("command.reason.aiNotConfigured"));
      void loadAiConfig();
      return;
    }
    let counterBaseline = {
      succeeded: aiJobs?.succeeded ?? 0,
      failed: aiJobs?.failed ?? 0,
    };
    try {
      const status = await api.getAiJobStatus({ libraryId: library.libraryId });
      if (status.ok) {
        setAiJobs(status.value);
        counterBaseline = {
          succeeded: status.value.succeeded,
          failed: status.value.failed,
        };
        notifyAiConnectionBatchStarted(status.value.jobs);
      } else {
        notifyAiConnectionBatchStarted(aiJobs?.jobs ?? []);
      }
    } catch {
      notifyAiConnectionBatchStarted(aiJobs?.jobs ?? []);
    }
    try {
      const result = await api.analyzeAssets({
        libraryId: library.libraryId,
        assetIds: targetIds,
      });
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.aiAnalyzeFailed"), locale));
        return;
      }
      const jobIds = result.value.jobIds;
      const skippedCount = result.value.skippedAssetIds.length;
      if (jobIds.length === 0) {
        if (skippedCount > 0) {
          // 全部跳过（已有分析结果）——8-09 WIP 恢复：跳过不是失败
          setNotice(t("toast.aiAnalyzeSkippedBatch", { count: skippedCount }));
        } else {
          setError(t("toast.aiAnalyzeFailed"));
        }
        return;
      }
      aiBatchStatusRequestRef.current++;
      aiBatchJobIdsRef.current = jobIds;
      aiBatchSkippedCountRef.current = skippedCount;
      lastAiBatchJobIdsRef.current = jobIds;
      analyzingAssetIdRef.current = targetIds[0] ?? null;
      lastAiBatchAssetIdRef.current = analyzingAssetIdRef.current;
      analyzingBatchSizeRef.current = jobIds.length + skippedCount;
      aiBatchKnownJobsRef.current = [];
      aiBatchCounterBaselineRef.current = counterBaseline;
      setAiBatchProgress(
        computeAiBatchProgressForJobs(jobIds, [], { skipped: skippedCount }),
      );
      flushSync(() => {
        setAiAnalyzing(true);
        setAiProgressBannerVisible(true);
      });
      // Live progress comes from ai.progress events. A status RPC here would
      // sit behind ai.process-queue and freeze the banner at 0/total.
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiAnalyzeFailed"), locale));
    }
  }

  async function handleClearAiContent(assetIds: string[]) {
    if (!api || !library || assetIds.length === 0) return;
    // Product brief: batch clear requires confirmation (UI gate; worker only
    // enforces confirm for folder/library scopes).
    if (
      assetIds.length > 1 &&
      !await requestConfirmation(
        t("toast.aiContentClearConfirm", { count: String(assetIds.length) }),
      )
    ) {
      return;
    }
    if (renderedLibrary.current?.libraryId !== library.libraryId) return;
    try {
      const result = await api.clearAiContent({
        libraryId: library.libraryId,
        scope: { kind: "asset", assetIds },
        confirm: assetIds.length > 1,
      });
      if (!result.ok) {
        setError(
          toMessage(result.error, t("toast.aiContentClearFailed"), locale),
        );
        return;
      }
      if (
        selectedAssetId &&
        assetIds.includes(selectedAssetId)
      ) {
        setAiContent(null);
      }
      // Toast + list refresh also arrive via onAiCleared.
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiContentClearFailed"), locale));
    }
  }

  async function loadMediaJobs(quiet = false) {
    if (!api || !library) return;
    if (!quiet) setMediaJobsLoading(true);
    try {
      const result = await api.listMediaJobs({
        libraryId: library.libraryId,
        limit: MEDIA_JOB_LIST_PAGE_SIZE,
      });
      if (!result.ok) {
        if (!quiet) setError(toMessage(result.error, t("toast.mediaJobsLoadFailed"), locale));
        return;
      }
      setMediaJobs(replaceMediaJobListPage(result.value));
    } catch {
      if (!quiet) setError(t("toast.mediaJobsLoadNoResponse"));
    } finally {
      if (!quiet) setMediaJobsLoading(false);
    }
  }
  loadMediaJobsRef.current = loadMediaJobs;

  async function loadMoreMediaJobs() {
    if (!api || !library || !mediaJobs?.nextCursor || mediaJobs.hasMore !== true) return;
    try {
      const result = await api.listMediaJobs({
        libraryId: library.libraryId,
        cursor: mediaJobs.nextCursor,
        limit: MEDIA_JOB_LIST_PAGE_SIZE,
      });
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.mediaJobsLoadFailed"), locale));
        return;
      }
      setMediaJobs((current) => appendMediaJobListPage(current, result.value));
    } catch {
      setError(t("toast.mediaJobsLoadNoResponse"));
    }
  }

  async function loadAiJobs(quiet = false) {
    if (!api || !library) return;
    if (!quiet) setMediaJobsLoading(true);
    try {
      const result = await api.getAiJobStatus({ libraryId: library.libraryId });
      if (!result.ok) {
        if (!quiet) setError(toMessage(result.error, t("toast.aiJobsLoadFailed"), locale));
        return;
      }
      setAiJobs(result.value);
    } catch {
      if (!quiet) setError(t("toast.aiJobsLoadNoResponse"));
    } finally {
      if (!quiet) setMediaJobsLoading(false);
    }
  }

  function finishTrackedAiBatch(
    progress: AiBatchProgressSnapshot,
    jobs: ReadonlyArray<{ status: string; errorCode?: string | null }>,
  ): void {
    if (aiBatchJobIdsRef.current.length === 0) return;
    aiBatchJobIdsRef.current = [];
    aiBatchKnownJobsRef.current = [];
    aiBatchStatusRequestRef.current++;
    const pendingAssetId = analyzingAssetIdRef.current;
    const batchSize = analyzingBatchSizeRef.current;
    analyzingAssetIdRef.current = null;
    analyzingBatchSizeRef.current = 0;
    setAiAnalyzing(false);
    setAiBatchProgress(null);

    const detail = summarizeAiFailureCodes(
      collectRecentAiFailureCodes(
        jobs.map((job) => ({ status: job.status, errorCode: job.errorCode ?? null })),
      ),
      locale,
    );
    const showTotalFailure = () => {
      showBlockingError(
        t("dialog.aiAnalyzeFailure.title"),
        detail
          ? t("toast.aiAnalyzeFailedDetail", { detail })
          : t("toast.aiAnalyzeFailed"),
      );
    };
    const showSingleFailure = () => {
      setError(
        detail
          ? t("toast.aiAnalyzeFailedDetail", { detail })
          : t("toast.aiAnalyzeFailed"),
      );
    };

    const failedOutcomes = progress.failed;
    if (failedOutcomes > 0) {
      if (progress.succeeded === 0 && progress.cancelled === 0) {
        if (pendingAssetId && batchSize <= 1) showSingleFailure();
        else showTotalFailure();
      } else {
        setNotice(
          t("toast.aiAnalyzeDoneBatch", {
            succeeded: progress.succeeded,
            failed: failedOutcomes,
          }) +
            (progress.skipped > 0
              ? t("toast.aiAnalyzeSkippedSuffix", { count: progress.skipped })
              : "") +
            (detail ? ` ${detail}` : ""),
        );
      }
    } else if (progress.cancelled > 0) {
      setNotice(t("toast.aiAnalyzeStopped"));
    } else if (batchSize > 1) {
      setNotice(
        t("toast.aiAnalyzeDoneBatch", {
          succeeded: progress.succeeded,
          failed: 0,
        }) +
          (progress.skipped > 0
            ? t("toast.aiAnalyzeSkippedSuffix", { count: progress.skipped })
            : ""),
      );
    } else if (batchSize > 0) {
      setNotice(t("toast.aiAnalyzeDone"));
    }
    void reloadCurrentContentRef.current();
  }

  function applyLiveAiProgress(event: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    changedJobs?: AiProgressJobUpdate[];
  }): void {
    if (!aiFields.get("aiAnalyzing")) return;
    const jobIds = aiBatchJobIdsRef.current;
    if (jobIds.length === 0) return;
    const applied = progressFromAiProgressEvent({
      jobIds,
      knownJobs: aiBatchKnownJobsRef.current,
      changedJobs: event.changedJobs,
      skipped: aiBatchSkippedCountRef.current,
      baseline: aiBatchCounterBaselineRef.current,
      counters: event,
    });
    aiBatchKnownJobsRef.current = applied.knownJobs;
    setAiBatchProgress(applied.progress);
    if (applied.progress.done >= applied.progress.batchTotal) {
      finishTrackedAiBatch(applied.progress, applied.knownJobs);
    }
  }

  async function refreshAiBatchStatus() {
    if (!api || !library) return;
    const jobIds = aiBatchJobIdsRef.current;
    if (jobIds.length === 0) return;
    const requestNumber = ++aiBatchStatusRequestRef.current;
    try {
      const result = await api.getAiJobStatus({
        libraryId: library.libraryId,
        jobIds,
      });
      if (
        !result.ok ||
        requestNumber !== aiBatchStatusRequestRef.current ||
        aiBatchJobIdsRef.current !== jobIds
      ) {
        return;
      }
      const progress = computeAiBatchProgressForJobs(jobIds, result.value.jobs, {
        skipped: aiBatchSkippedCountRef.current,
      });
      aiBatchKnownJobsRef.current = result.value.jobs
        .filter((job) => jobIds.includes(job.jobId))
        .map((job) => ({
          jobId: job.jobId,
          status: job.status,
          errorCode: job.errorCode,
        }));
      setAiBatchProgress(progress);
      if (progress.done < progress.batchTotal) return;
      finishTrackedAiBatch(progress, result.value.jobs);
    } catch {
      // A transient status query must not finish or miscount an active batch;
      // the next progress event will retry this refresh.
    }
  }
  refreshAiBatchStatusRef.current = () => {
    void refreshAiBatchStatus();
  };
  applyLiveAiProgressRef.current = applyLiveAiProgress;

  useEffect(() => {
    // Serpent-e97c00: one bounded, coalesced fallback stream per open library.
    // Worker events stay the primary source; this only catches missed ones, and
    // it never queues a second request for a kind that is already in flight —
    // a Worker blocked for 30 seconds can therefore not accumulate 30 requests.
    if (!api || !library) return;
    const libraryId = library.libraryId;
    const mediaActive = (value: { queued?: number; running?: number } | null) =>
      (value?.queued ?? 0) + (value?.running ?? 0) > 0;
    const aiActive = (value: AiJobStatus | null) =>
      (value?.queued ?? 0) + (value?.running ?? 0) > 0;
    const coordinator = new JobStatusCoordinator({
      probes: {
        media: async () => {
          const result = await api.getMediaJobSummary({ libraryId });
          return result.ok ? { value: result.value, active: mediaActive(result.value) } : null;
        },
        ai: async () => {
          const result = await api.getAiJobStatus({ libraryId });
          return result.ok ? { value: result.value, active: aiActive(result.value) } : null;
        },
        plugin: async () => {
          const result = await api.listPluginJobs({ libraryId });
          return result.ok
            ? { value: result.value, active: hasActivePluginJobs(result.value) }
            : null;
        },
      },
      onResult: (kind, value) => {
        if (kind === "media") {
          setMediaJobs((current) => applyMediaJobSummary(current, value as MediaJobSummaryCounts));
        }
        else if (kind === "ai") setAiJobs(value as AiJobStatus);
        else setPluginJobs(value as PluginJobStatus);
        // Diagnostics for the performance benchmark; counts only, no identifiers.
        (
          globalThis as unknown as { __keelJobStatusStats?: unknown }
        ).__keelJobStatusStats = coordinator.stats();
      },
      onSettled: (kind) => {
        if (kind === "media") setMediaJobsLoading(false);
      },
    });
    jobStatusCoordinatorRef.current = coordinator;
    coordinator.setHidden(document.hidden);
    coordinator.start();
    // A hidden window keeps its last known task state instead of polling.
    const onVisibilityChange = () => coordinator.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      coordinator.stop();
      if (jobStatusCoordinatorRef.current === coordinator) {
        jobStatusCoordinatorRef.current = null;
      }
    };
  }, [api, library, setAiJobs, setMediaJobs, setMediaJobsLoading, setPluginJobs, jobStatusCoordinatorRef]);

  useEffect(() => {
    // Opening the panel tightens the cadence and re-enables event-driven
    // refreshes; closing it drops browsing back to the slow fallback so the
    // canvas does not pay for status queries it never displays. The first list
    // page is loaded from the open handler, not from this effect.
    jobStatusCoordinatorRef.current?.setPanelOpen(mediaJobsOpen);
    jobStatusCoordinatorRef.current?.setEventDrivenQueries(mediaJobsOpen);
  }, [mediaJobsOpen, jobStatusCoordinatorRef]);

  useEffect(() => {
    // Plugin work announces completion; treat it as a status change instead of
    // waiting for the next fallback tick.
    const onPluginCommandCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ libraryId?: string }>).detail;
      if (!detail?.libraryId || detail.libraryId === library?.libraryId) {
        jobStatusCoordinatorRef.current?.noteActivity("plugin");
      }
    };
    window.addEventListener("keel:plugin-command-completed", onPluginCommandCompleted);
    return () => {
      window.removeEventListener("keel:plugin-command-completed", onPluginCommandCompleted);
    };
  }, [library, jobStatusCoordinatorRef]);

  async function controlMediaJobs(
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) {
    if (!api || !library) return;
    try {
      const result =
        action === "pause"
          ? await api.pauseMediaJobs({ libraryId: library.libraryId, jobIds })
          : action === "resume"
            ? await api.resumeMediaJobs({
                libraryId: library.libraryId,
                jobIds,
              })
            : action === "cancel"
              ? await api.cancelMediaJobs({
                  libraryId: library.libraryId,
                  jobIds,
                })
              : await api.retryMediaJobs({
                  libraryId: library.libraryId,
                  jobIds: jobIds ?? [],
                });
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.mediaJobsOpFailed"), locale));
        return;
      }
      await loadMediaJobs(true);
    } catch {
      setError(t("toast.mediaJobsOpNoResponse"));
    }
  }
  return { refreshAiBatchStatus, loadAiJobs, controlMediaJobs, loadMoreMediaJobs, handleAnalyzeClick, handleClearAiContent };
}
