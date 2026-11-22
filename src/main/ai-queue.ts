import { AiQueueScheduler } from './ai-queue-scheduler';
import { AI_ANALYSIS_QUEUE_BATCH_SIZE } from '../shared/ai-concurrency';
import { DEFAULT_AI_RELIABILITY_SETTINGS } from '../shared/ai-reliability';
import { runRulesFor } from './rule-triggers';
import { loadAiConfig, hasCompletedAiProfileMigration, getDecryptedProfileApiKey, getDecryptedApiKey } from './ai-settings-files';
import { state } from './main-state';
import { legacyAiConnectionProfile, captureAiConnectionSnapshot } from './ai-profile-store';
import { toWireAiAnalysisSettings } from '../shared/ai-analysis-settings';

/**
 * AI analysis queue: automatic analysis after import and batch processing (split out of index.ts, P8).
 */
export const aiQueueScheduler = new AiQueueScheduler(processAiQueueBatch, {
  batchSize: AI_ANALYSIS_QUEUE_BATCH_SIZE,
  baseRetryDelayMs: DEFAULT_AI_RELIABILITY_SETTINGS.retryBaseDelayMs,
  maxRetryDelayMs: DEFAULT_AI_RELIABILITY_SETTINGS.retryMaxDelayMs,
  retryJitterRatio: DEFAULT_AI_RELIABILITY_SETTINGS.retryJitterRatio,
});

export async function enqueueAutoAnalyzeAfterImport(
  libraryId: string,
  importedAssetIds: string[],
  folderId?: string,
): Promise<void> {
  if (importedAssetIds.length > 0 || folderId) void runRulesFor(libraryId, 'after-import');
  try {
    const config = loadAiConfig();
    if (!config.autoAnalyzeEnabled || !config.hasKey || !config.apiFormat) return;
    if ((importedAssetIds.length === 0 && !folderId) || !state.workerClient) return;

    const result = await state.workerClient.request({
      type: "ai.enqueue-analysis",
      libraryId,
      ...(importedAssetIds.length > 0 ? { assetIds: importedAssetIds } : {}),
      ...(folderId ? { folderId } : {}),
    });
    if (result.ok && result.type === "ai.jobs.enqueued") {
      state.logger?.info(
        "auto-analyze",
        `Enqueued ${result.enqueued} AI analysis jobs after import.`,
      );
      await processAiQueue(libraryId);
    }
  } catch (error) {
    state.logger?.error("auto-analyze", error);
    // Non-blocking: import succeeded regardless of AI enqueue failure.
  }
}

export async function processAiQueue(libraryId: string): Promise<void> {
  try {
    const config = loadAiConfig();
    aiQueueScheduler.setRetryPolicy(config.reliabilitySettings);
    await aiQueueScheduler.trigger(libraryId);
  } catch (error) {
    state.logger?.error("ai.queue.config", error, { libraryId });
  }
}

export async function processAiQueueBatch(
  libraryId: string,
  maxJobs: number,
): Promise<{ processed: number; requeued: number }> {
  let config: ReturnType<typeof loadAiConfig>;
  try {
    config = loadAiConfig();
  } catch (error) {
    state.logger?.error("ai.queue.config", error, { libraryId });
    return { processed: 0, requeued: 0 };
  }
  const activeProfile = config.profiles.find(
    (profile) => profile.id === config.activeProfileId,
  );
  const legacyFallbackAvailable = !activeProfile
    && !hasCompletedAiProfileMigration()
    && Boolean(config.apiFormat);
  if (!config.hasKey || !state.workerClient || (!activeProfile && !legacyFallbackAvailable)) {
    return { processed: 0, requeued: 0 };
  }
  try {
    const profile = activeProfile ?? legacyAiConnectionProfile({
      apiFormat: config.apiFormat,
      model: config.model,
      baseUrl: config.baseUrl,
    });
    const apiKey = activeProfile
      ? getDecryptedProfileApiKey(activeProfile.id)
      : getDecryptedApiKey();
    const connection = captureAiConnectionSnapshot(profile, apiKey);
    // Keep each Worker admission bounded. A 32-job batch with 16 external
    // waits used to be one long scheduler request; slice it into short
    // continuations so claim/commit ownership is reacquired between waves.
    const sliceSize = Math.max(1, Math.min(config.concurrencyLimit, 8));
    let processed = 0;
    let requeued = 0;
    while (processed < maxJobs) {
      const requested = Math.min(sliceSize, maxJobs - processed);
      const result = await state.workerClient.request({
        type: "ai.process-queue",
        libraryId,
        apiFormat: connection.apiFormat,
        model: connection.model,
        apiKey: connection.apiKey,
        ...(connection.baseUrl.trim() ? { baseUrl: connection.baseUrl.trim() } : {}),
        enabledFields: {
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          rating: config.ratingEnabled,
        },
        analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
        languages: config.languages,
        concurrencyLimit: config.concurrencyLimit,
        maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
        requestTimeoutMs: config.reliabilitySettings.requestTimeoutMs,
        maxAttempts: config.reliabilitySettings.maxAttempts,
        maxJobs: requested,
      });
      if (!result.ok) {
        state.logger?.error(
          "ai.queue.process",
          new Error(`Worker rejected AI queue batch: ${result.error.code}`),
        );
        break;
      }
      if (result.type !== "ai.jobs.processed") {
        state.logger?.error(
          "ai.queue.process",
          new Error(`Unexpected AI queue result: ${result.type}`),
        );
        break;
      }
      processed += result.processed;
      requeued += result.requeued;
      if (result.requeued > 0 || result.processed < requested) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return { processed, requeued };
  } catch (error) {
    state.logger?.error("ai.queue.process", error);
    return { processed: 0, requeued: 0 };
  }
}
