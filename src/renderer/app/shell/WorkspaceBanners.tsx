import { useAiField } from "../../stores/ai-store";
import { useJobsField } from "../../stores/jobs-store";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { PluginJobActivityBanner } from "../../plugins/PluginJobActivityBanner";

export interface WorkspaceBannersProps {
  t: TranslateFn;
  controlAiJobs: (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>;
  pluginJobActivity: { jobId: string; libraryId: string; kind: "plugin.background"; status: "failed" | "queued" | "running" | "paused" | "succeeded" | "cancelled" | "interrupted"; progress: number; attemptCount: number; errorCode: string | null; errorDetail: string | null; ownerPluginId: string; ownerPackageHash: string; pluginHandlerId: string; payload: Record<string, unknown>; recoveryStrategy: "idempotent" | "checkpoint"; createdAt: string; updatedAt: string; ownerPluginInstanceId?: string | undefined; ownerScope?: "library" | "global" | undefined; ownerLibraryId?: string | null | undefined; executionAvailability?: "ready" | "blocked" | undefined; completed?: number | undefined; total?: number | undefined; phase?: string | undefined; message?: string | undefined; itemResults?: { itemId: string; status: "failed" | "succeeded" | "cancelled" | "skipped"; assetId?: string | undefined; errorCode?: string | undefined; errorDetail?: string | undefined; retryInput?: Record<string, unknown> | undefined; }[] | undefined; failedAssetIds?: string[] | undefined; retryInput?: Record<string, unknown> | undefined; checkpoint?: { version: string; data: Record<string, unknown>; savedAt: string; cursor?: string | undefined; } | undefined; cancellation?: { requested: boolean; reason?: string | undefined; } | undefined; } | null;
  hidePluginJobActivity: (jobId: string) => void;
  pluginJobQueuedMore: number;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function WorkspaceBanners({ t, controlAiJobs, pluginJobActivity, hidePluginJobActivity, pluginJobQueuedMore }: WorkspaceBannersProps) {
  const [aiAnalyzing] = useAiField("aiAnalyzing");
  const [aiJobs] = useJobsField("aiJobs");
  const [aiProgressBannerVisible, setAiProgressBannerVisible] = useAiField("aiProgressBannerVisible");
  const [aiBatchProgress] = useAiField("aiBatchProgress");
  return (
<>
{(aiAnalyzing ||
          (aiJobs !== null && aiJobs.queued + aiJobs.running > 0)) &&
          aiProgressBannerVisible &&
          (() => {
            const batchProgress = aiBatchProgress;
            const progressLabel =
              batchProgress && batchProgress.batchTotal > 0
                ? t("toast.aiAnalyzeProgressCount", {
                    done: String(batchProgress.done),
                    total: String(batchProgress.batchTotal),
                  })
                : t("toast.aiAnalyzeStarted");
            return (
              <div className="workspace-ai-progress" role="status">
                <div className="workspace-ai-progress-body">
                  <div className="workspace-ai-progress-headline">
                    <span className="activity-pulse" aria-hidden />
                    <span className="workspace-ai-progress-message">
                      {progressLabel}
                    </span>
                  </div>
                  {batchProgress && batchProgress.batchTotal > 0 && (
                    <div
                      aria-valuemax={batchProgress.batchTotal}
                      aria-valuemin={0}
                      aria-valuenow={batchProgress.done}
                      className="task-progress-track workspace-ai-progress-bar"
                      role="progressbar"
                    >
                      <div
                        className="task-progress-fill"
                        style={{
                          width: `${Math.round((batchProgress.ratio ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="workspace-ai-progress-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void controlAiJobs("cancel")}
                    type="button"
                  >
                    {t("toast.aiAnalyzeStop")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setAiProgressBannerVisible(false)}
                    type="button"
                  >
                    {t("toast.aiAnalyzeRunInBackground")}
                  </button>
                </div>
              </div>
            );
          })()}
        {pluginJobActivity !== null && (
          <PluginJobActivityBanner
            job={pluginJobActivity}
            onDismiss={() => hidePluginJobActivity(pluginJobActivity.jobId)}
            onRunInBackground={() => hidePluginJobActivity(pluginJobActivity.jobId)}
            queuedMoreCount={pluginJobQueuedMore}
          />
        )}
</>
  );
}
