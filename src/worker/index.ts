import '../shared/install-legacy-env';
import {
  parseWorkerRequest,
  type WorkerCommand,
  type WorkerRequest,
} from '../shared/protocol/requests';
import {
  parseWorkerControlMessage,
  type WorkerResponse,
  type WorkerResult,
} from '../shared/protocol/responses';
import { stopOutgoingLibrariesForOpen } from './library/library-open-stop';
import {
  parseModelThumbnailRenderResponse,
} from '../shared/model-thumbnail-protocol';
import {
  parseDocumentThumbnailRenderResponse,
} from '../shared/document-thumbnail-protocol';
import type {
  LibraryService} from './library-service';
import {
  LibraryServiceError,
  hasIdleForegroundImageSlot,
  shutdownActiveMediaProcesses,
  shutdownWorkerResources,
} from './library-service';
import { publicErrorForWorkerFailure } from './public-error';
import { dispatchAutomationReadOnlyRequest } from './automation-readonly-dispatch';
import {
  boundedWriteLibraryId,
  executeBoundedWriteWorkerCommand,
} from './bounded-write-command';
import { parseLinkedMissingVisibilityMessage } from '../shared/linked-missing-visibility';
import {
  parsePluginMediaProviderResponse,
  parsePluginThumbnailExtensionsMessage,
} from '../shared/plugin-media-protocol';
import {
  searchRequestLaneKey,
} from './library/search-request-coordinator';
import {
  performanceLaneForCommand,
  performanceInteractionKeyForCommand,
  isInteractivePerformanceLane,
  shouldPreemptAutomaticMedia,
  type PerformanceRequestEnvelope,
} from '../shared/performance-contract';
import { createPublicError } from '../shared/protocol/errors';
import {
  SchedulerCancelledError,
} from './library/interactive-scheduler';
import { executeBrowseSessionWorkerCommand } from './handlers/browse-session';
import { runWithVerifiedDestructiveBackup } from './destructive-backup';
import { executeLibraryIdentityWorkerCommand } from './handlers/library-identity';
import { executeLibraryTransferWorkerCommand } from './handlers/library-transfer';
import { executeExtensionWorkerCommand } from './handlers/extension';
import { executeFolderWorkerCommand } from './handlers/folders';
import { executeLinkedFolderWorkerCommand } from './handlers/linked-folders';
import { executeAssetIngestionWorkerCommand } from './handlers/asset-ingestion';
import { executeIgnoreWorkerCommand } from './handlers/ignore';
import { executeRuleWorkerCommand } from './handlers/rules';
import { executeTagWorkerCommand } from './handlers/tags';
import { executeAssetMutationWorkerCommand } from './handlers/asset-mutations';
import { executePluginJobWorkerCommand } from './handlers/plugin-jobs';
import { executeMediaPathWorkerCommand } from './handlers/media-paths';
import { executeMediaJobWorkerCommand } from './handlers/media-jobs';
import { executeMediaGenerationWorkerCommand } from './handlers/media-generation';
import { executeVisibleWindowWorkerCommand } from './handlers/visible-window';
import { executeAiWorkerCommand } from './handlers/ai';
import { executeAssetQueryWorkerCommand } from './handlers/asset-query';
import { closeSemanticIndexWorkerLibrary, executeSemanticIndexWorkerCommand, reserveSemanticDeleteCleanup, semanticPermanentDeleteCandidates, withSemanticDeleteCleanupStatus } from './handlers/semantic-index';
import { executeLibraryLifecycleWorkerCommand } from './handlers/library-lifecycle';
import { executeSyncWorkerCommand } from './handlers/sync';
import {
  type StartupBurstGateToken,
} from './library/startup-burst-gate';
// Evaluated after every import above, as the moved statements were.
import { WORKER_CMD_LOG, activeSecondaryMediaQueueControllers, activeSecondaryMediaQueues, activeThumbnailQueueAssetScopes, activeThumbnailQueueControllers, activeThumbnailQueues, aiJobAbortRegistry, aiProcessBatchAbortControllers, aiProgressThrottler, analysisControls, cancelAutomaticMediaForLibrary, cancelDeferredStartupThumbnailScene, cancelMediaResourceRetry, cancelVisibleWindowDimensionProbes, closingLibraryIds, deferStartupThumbnailScene, deferredMediaResourceRetries, deferredStartupThumbnailGenerations, enqueueVisibleWindowDimensionProbes, errorForLog, getCurrentWorkerActivity, interactiveScheduler, isLibraryTransitionCommand, lastViewportPreemptAtMs, lastViewportVisibleChangeAtMs, lastVisibleWindowAssetIdsByLibrary, lastVisibleWindowKeyByLibrary, latestAssetSearchRequests, libraryGenerationRegistry, libraryService, noteInteractiveMediaRequest, parentPort, pendingDocumentThumbnailRenders, pendingModelThumbnailRenders, pendingPluginMediaProviderRequests, pendingThumbnailQueueAborts, pendingThumbnailQueueFailureRecoveries, pendingThumbnailQueueFailureRetries, processLifetime, providerConcurrencyLimiter, publishAiProgress, scheduleOpenBackgroundReconciliation, scheduleSecondaryMediaQueue, scheduleThumbnailQueue, scheduleThumbnailScene, secondaryMediaRetryTimers, setCurrentWorkerActivity, startDeferredStartupThumbnailScene, startupBurstGates, startupThumbnailVisibleWindows, suspendAutomaticMediaForInteractive, thumbnailCompletionFanout, viewportPriorityOverlay, visibleDimensionProbeStates, withMediaSchedulingSuspended, writePluginMediaArtifact } from './worker-runtime';

// worker-runtime has already thrown when the worker was not started by Main;
// repeating the check narrows parentPort for the code below.
if (!parentPort) {
  throw new Error('Library Worker must be started by the Electron main process.');
}
const workerPort = parentPort;

function destructiveBackupLibraryId(command: WorkerCommand): string | undefined {
  switch (command.type) {
    case 'asset.delete-permanent':
    case 'asset.delete-from-disk':
    case 'asset.delete-linked':
    case 'asset.purge-trash':
    case 'folder.delete-from-disk':
    case 'folder.delete-empty':
    case 'linked-folder.remove':
    case 'linked-folder.delete-subtree':
      return command.libraryId;
    default:
      return undefined;
  }
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResult> {
  if (request.command.type === 'library.open' || request.command.type === 'library.close'
    || request.command.type === 'library.delete-from-disk') {
    await closeSemanticIndexWorkerLibrary(request.command.type === 'library.open' ? undefined : request.command.libraryId);
  }
  const semanticResult = await executeSemanticIndexWorkerCommand(libraryService, request, {
    runWithoutAdmission: (work) => interactiveScheduler.runWithoutAdmission(request.requestId, work),
  });
  if (semanticResult) return semanticResult;

  const automationResult = await dispatchAutomationReadOnlyRequest(libraryService, request);
  if (automationResult) return automationResult;

  const destructiveLibraryId = destructiveBackupLibraryId(request.command);
  if (destructiveLibraryId) {
    return runWithVerifiedDestructiveBackup(
      libraryService,
      destructiveLibraryId,
      async () => {
        const candidates = semanticPermanentDeleteCandidates(libraryService, request.command);
        if (candidates.length > 0) {
          reserveSemanticDeleteCleanup(libraryService, destructiveLibraryId, candidates);
        }
        const result = await handleRequestWithoutWriteLease(request);
        return withSemanticDeleteResult(libraryService, request.command, candidates, result);
      },
    );
  }

  if (request.command.type === 'history.group.begin' || request.command.type === 'history.group.complete') {
    const lease = await libraryService.acquireWriteLease(request.command.libraryId);
    try {
      const historyContext = request.historyContext;
      if (historyContext?.sourceReference === undefined || historyContext.sourceReference === null) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      if (request.command.type === 'history.group.begin') {
        const result = libraryService.beginOperationHistoryGroup({
          libraryId: request.command.libraryId,
          source: historyContext.source,
          sourceReference: historyContext.sourceReference,
          ...(request.command.rule ? { rule: request.command.rule } : {}),
        });
        return { ok: true, type: 'history.group.begun', historyEntryId: result.historyEntryId };
      }
      const result = libraryService.completeOperationHistoryGroup(
        request.command.libraryId,
        request.command.expectedHistoryEntryId,
      );
      return {
        ok: true,
        type: 'history.group.completed',
        historyEntryId: result.historyEntryId,
        status: libraryService.getOperationHistoryStatus(request.command.libraryId),
      };
    } finally {
      lease.release();
    }
  }

  // Mixed desktop trash is a filesystem batch, so it cannot run inside the
  // synchronous SQLite transaction used by bounded metadata writes. It still
  // owns the same durable per-library writer lease for the entire
  // preflight→execute→history-commit window.
  if (request.command.type === 'selection.trash') {
    const lease = await libraryService.acquireWriteLease(request.command.libraryId);
    try {
      const result = await libraryService.trashSelectionAsync({
        libraryId: request.command.libraryId,
        assetIds: request.command.assetIds,
        folderIds: request.command.folderIds,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
      });
      return { ok: true, type: 'selection.trashed', ...result };
    } finally {
      try {
        lease.release();
      } catch (error) {
        libraryService.reportDiagnostic('selection.trash.lease-release', error, {
          libraryId: request.command.libraryId,
        });
      }
    }
  }

  const libraryId = boundedWriteLibraryId(request.command);
  if (!libraryId) {
    return handleRequestWithoutWriteLease(request);
  }

  try {
    const result = await libraryService.runBoundedWrite(
      libraryId,
      () => executeBoundedWriteWorkerCommand(libraryService, request.command, request.historyContext),
    );
    if (result === undefined) {
      throw new Error(`Bounded write command ${request.command.type} has no executor.`);
    }
    return result;
  } catch (error) {
    libraryService.reportDiagnostic('write-lease.execute', error, {
      libraryId,
      commandType: request.command.type,
    });
    throw error;
  }
}

function withSemanticDeleteResult(
  service: LibraryService,
  command: WorkerCommand,
  candidates: readonly string[],
  result: WorkerResult,
): WorkerResult {
  const libraryId = 'libraryId' in command ? command.libraryId : undefined;
  if (!libraryId) return result;
  return withSemanticDeleteCleanupStatus(service, libraryId, candidates, result);
}

function recordPermanentDeleteBarrier(
  input: {
    affectedCount: number;
    affectedEntities?: readonly string[];
    commandId: string;
    labelKey: string;
    libraryId: string;
    reason: string;
    historyContext?: WorkerRequest['historyContext'];
  },
): void {
  if (input.affectedCount <= 0) return;
  libraryService.recordOperationHistoryBarrier({
    libraryId: input.libraryId,
    source: input.historyContext?.source ?? 'desktop',
    sourceReference: input.historyContext?.sourceReference ?? null,
    commandId: input.commandId,
    labelKey: input.labelKey,
    reason: input.reason,
    affectedCount: input.affectedCount,
    affectedEntities: input.affectedEntities,
  });
}

/**
 * Stop every automatic background task one library owns.
 *
 * Shared by `library.close`, `library.delete-from-disk` and — critically —
 * `library.open`. A switch through the recent list sends `library.open` for the
 * replacement WITHOUT a preceding `library.close`
 * (`library.open-recent.request` dispatches open directly), so the outgoing
 * library's media churn kept the single Worker busy and the open command starved
 * behind it: switching away from a busy network library never completed —
 * measured as ≥90 s with the loading overlay up and no Worker activity logged,
 * versus a completed switch once the churn is stopped.
 *
 * This stops *scheduling* work (queued jobs, retry loops, dimension probes).
 * Draining a decoder that is already running is a separate caller decision:
 * `closeLibraryAsync` and `library.delete-from-disk` do it, `library.open` does
 * not, because the outgoing library is released by its own close path.
 */
function stopAutomaticWorkForLibrary(
  libraryId: string,
  options?: { cancelQueuedJobs?: boolean },
): void {
  cancelDeferredStartupThumbnailScene(libraryId);
  cancelAutomaticMediaForLibrary(libraryId);
  cancelMediaResourceRetry(libraryId);
  cancelVisibleWindowDimensionProbes(libraryId);
  lastVisibleWindowKeyByLibrary.delete(libraryId);
  lastVisibleWindowAssetIdsByLibrary.delete(libraryId);
  thumbnailCompletionFanout.clear(libraryId);
  viewportPriorityOverlay.clearLibrary(libraryId);
  lastViewportVisibleChangeAtMs.delete(libraryId);
  lastViewportPreemptAtMs.delete(libraryId);
  // Closing and deleting destroy the library, so its queued jobs go with it. A
  // switch does not: `stopOutgoingLibrariesForOpen` passes false so the queued
  // work survives for the next open instead of being cancelled and re-enqueued.
  if (options?.cancelQueuedJobs !== false) libraryService.cancelJobs(libraryId);
  publishAiProgress(libraryId);
  aiJobAbortRegistry.abort(libraryId);
}

async function handleRequestWithoutWriteLease(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.command.type) {
    case 'library.list':
    case 'library.change-sequence':
    case 'history.status':
    case 'history.group.begin':
    case 'history.group.complete':
    case 'history.undo':
    case 'history.redo':
    case 'library.create':
    case 'library.recovery-report':
    case 'library.inspect-eagle':
    case 'library.open-eagle':
    case 'library.inspect-billfish':
    case 'library.open-billfish':
    case 'library.navigation-summary': {
      const result = await executeLibraryIdentityWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled library identity command: ${request.command.type}`);
      }
      return result;
    }
    case 'sync.probe':
    case 'sync.preview':
    case 'sync.run':
    case 'sync.poll-remote':
    case 'sync.asset-card-status':
    case 'sync.list-remote-libraries':
    case 'sync.open-remote-library': {
      const result = await executeSyncWorkerCommand(libraryService, parentPort, request);
      if (result === undefined) {
        throw new Error(`Unhandled sync command: ${request.command.type}`);
      }
      return result;
    }
    case 'library.open':
    case 'library.close':
    case 'library.rename':
    case 'library.delete-from-disk':
    case 'system.cleanup-pending-deletions': {
      const result = await executeLibraryLifecycleWorkerCommand(libraryService, request, {
        prepareForOpen: () => {
          stopOutgoingLibrariesForOpen({
            openLibraryIds: libraryService.listOpenLibraryIds(),
            cancelQueuedJobs: false,
            stopper: {
              stopScheduling: (outgoingLibraryId) => {
                cancelDeferredStartupThumbnailScene(outgoingLibraryId);
                cancelAutomaticMediaForLibrary(outgoingLibraryId);
                cancelMediaResourceRetry(outgoingLibraryId);
                cancelVisibleWindowDimensionProbes(outgoingLibraryId);
                lastVisibleWindowKeyByLibrary.delete(outgoingLibraryId);
                lastVisibleWindowAssetIdsByLibrary.delete(outgoingLibraryId);
                thumbnailCompletionFanout.clear(outgoingLibraryId);
                viewportPriorityOverlay.clearLibrary(outgoingLibraryId);
                lastViewportVisibleChangeAtMs.delete(outgoingLibraryId);
                lastViewportPreemptAtMs.delete(outgoingLibraryId);
              },
              cancelQueuedJobs: (outgoingLibraryId) => {
                libraryService.cancelJobs(outgoingLibraryId);
              },
              dropQueuedViewportHints: (outgoingLibraryId) => {
                interactiveScheduler.cancelQueuedViewportHintsForLibrary(outgoingLibraryId);
              },
              abortAiJobs: (outgoingLibraryId) => {
                aiJobAbortRegistry.abort(outgoingLibraryId);
              },
              publishAiProgress,
            },
          });
        },
        stopAutomaticWork: stopAutomaticWorkForLibrary,
      });
      if (result === undefined) {
        throw new Error(`Unhandled library lifecycle command: ${request.command.type}`);
      }
      return result;
    }
    case 'folder.create':
      // Routed through runBoundedWrite / executeBoundedWriteWorkerCommand.
      throw new Error('Bounded folder.create write was not dispatched through its transaction fence.');
    case 'appearance.set':
      throw new Error('Bounded appearance.set write was not dispatched through its transaction fence.');
    case 'folder.cover.set':
      throw new Error('Bounded folder.cover.set write was not dispatched through its transaction fence.');
    case 'folder.cover.clear':
      throw new Error('Bounded folder.cover.clear write was not dispatched through its transaction fence.');
    case 'folder.cover.set-asset':
      throw new Error('Bounded folder.cover.set-asset write was not dispatched through its transaction fence.');
    case 'folder.cover.resolve': {
      const resolved = libraryService.resolveFolderCustomCover(request.command);
      if (!resolved) throw new LibraryServiceError('FOLDER_NOT_FOUND');
      return {
        ok: true,
        type: 'folder.cover.resolved',
        absolutePath: resolved.absolutePath,
        mimeType: resolved.mimeType,
      };
    }
    case 'folder.rename':
    case 'folder.clone':
    case 'folder.move':
    case 'folder.get-path':
    case 'folder.list':
    case 'folder.browse-entries':
    case 'folder.filtered-counts':
    case 'folder.entries':
    case 'folder.indexed-bytes':
    case 'folder.list-trashed':
    case 'folder.restore-trashed':
    case 'folder.trash':
    case 'folder.delete-from-disk':
    case 'folder.delete-empty': {
      const result = await executeFolderWorkerCommand(libraryService, request, {
        scheduleCoverThumbnails: (libraryId, assetIds, maxIds) => {
          scheduleThumbnailScene(libraryId, 'cover', assetIds, maxIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled folder command: ${request.command.type}`);
      }
      return result;
    }
    case 'linked-folder.remove':
    case 'linked-folder.delete-subtree':
    case 'linked-folder.create-directory':
    case 'linked-folder.rename-directory':
    case 'linked-folder.list':
    case 'linked-folder.relink':
    case 'linked-folder.rules.get':
    case 'linked-folder.rules.set':
    case 'linked-folder.assets.copy':
    case 'linked-folder.convert': {
      const result = await executeLinkedFolderWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled linked-folder command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.list':
    case 'asset.sequence.create':
    case 'asset.sequence.dissolve':
    case 'asset.sequence.dissolve-batch':
    case 'asset.sequence.set-fps':
    case 'asset.import.probe-sequences':
    case 'asset.import.prepare':
    case 'asset.import-eagle':
    case 'asset.import-billfish':
    case 'asset.import.resolve':
    case 'asset.import.skip-source-failure':
    case 'asset.import.abandon':
    case 'asset.refresh':
    case 'asset.import-linked': {
      const result = await executeAssetIngestionWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        withMediaSchedulingSuspended,
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset ingestion command: ${request.command.type}`);
      }
      return result;
    }
    case 'library.companion-extensions.set':
      // PF: the set is process-wide; the next read re-pairs companions.
      libraryService.setCompanionExtensions(request.command.extensions);
      return { ok: true, type: 'library.companion-extensions.updated', libraryId: request.command.libraryId };
    case 'ignore.list':
    case 'ignore.gitignore.get':
    case 'ignore.gitignore.preview':
    case 'ignore.gitignore.set':
    case 'ignore.set': {
      const result = executeIgnoreWorkerCommand(libraryService, request, {
        scheduleRefreshThumbnails: (libraryId) => {
          scheduleThumbnailScene(libraryId, 'refresh');
        },
      });
      if (result === undefined) {
        throw new Error(`Unhandled ignore command: ${request.command.type}`);
      }
      return result;
    }
    case 'rule.list':
    case 'rule.save':
    case 'rule.delete':
    case 'rule.set-enabled':
    case 'rule.layout.set':
    case 'rule.runs.list':
    case 'rule.run.record':
    case 'rule.changed-assets':
    case 'automatic-task.layout.get':
    case 'automatic-task.layout.set':
    case 'automatic-task.list':
    case 'automatic-task.set':
    case 'automatic-task.delete': {
      const result = executeRuleWorkerCommand(libraryService, request);
      if (result === undefined) throw new Error(`Unhandled rule command: ${request.command.type}`);
      return result;
    }
    case 'automatic-task.run':await libraryService.runAutomaticTasks(request.command.libraryId,request.command.taskId,true,()=>interactiveScheduler.yieldAdmission(request.requestId));return {ok:true,type:'automatic-task.result',tasks:libraryService.listAutomaticTasks(request.command.libraryId)};
    case 'tag.list':
    case 'tag.create':
    case 'tag.rename':
    case 'tag.delete':
    case 'tag.delete-many':
    case 'tag.merge':
    case 'tag.cooccurrence':
    case 'tag.assign':
    case 'tag.remove': {
      const result = executeTagWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled tag command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.metadata.get':
    case 'asset.extracted-metadata.get':
    case 'asset.color-space.set':
    case 'asset.metadata.set':
    case 'asset.metadata.set-many':
    case 'asset.metadata.backfill':
    case 'asset.rating.set':
    case 'asset.search': {
      const result = await executeAssetQueryWorkerCommand(libraryService, request, {
        shouldYieldForSearchCoalescing: (libraryId) => startupBurstGates.isBrowseServed(libraryId),
        isLatestSearchRequest: (libraryId, laneKey, requestId) => (
          latestAssetSearchRequests.isLatest(libraryId, laneKey, requestId)
        ),
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset query command: ${request.command.type}`);
      }
      return result;
    }
    case 'browse.session.open':
    case 'browse.session.page':
    case 'browse.session.ids':
    case 'browse.session.close': {
      const result = executeBrowseSessionWorkerCommand(
        libraryService,
        (libraryId) => libraryGenerationRegistry.current(libraryId) ?? 0,
        request,
      );
      if (result === undefined) {
        throw new Error(`Unhandled browse session command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.trash':
    case 'asset.content.replace':
    case 'asset.content.stage':
    case 'asset.content.replace-batch':
    case 'asset.content.read':
    case 'asset.restore':
    case 'asset.restore-preview':
    case 'asset.move':
    case 'asset.move-undo':
    case 'asset.trash-undo':
    case 'asset.copy':
    case 'asset.copy-undo':
    case 'asset.rename-file':
    case 'asset.rename-files':
    case 'asset.restore-if-original-vacant':
    case 'asset.palette.aggregate-recent':
    case 'asset.zip.list':
    case 'asset.zip.read-entry':
    case 'asset.text.read':
    case 'asset.text.save':
    case 'asset.delete-permanent':
    case 'asset.delete-from-disk':
    case 'asset.delete-linked':
    case 'asset.list-trash':
    case 'asset.purge-trash':
    case 'asset.relink':
    case 'asset.recovery-probe':
    case 'asset.relink-batch.preview':
    case 'asset.relink-batch.apply':
    case 'asset.delete-cancel': {
      const result = await executeAssetMutationWorkerCommand(libraryService, request, {
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        recordPermanentDeleteBarrier,
      });
      if (result === undefined) {
        throw new Error(`Unhandled asset mutation command: ${request.command.type}`);
      }
      return result;
    }
    case 'extension.save-from-url':
    case 'extension.save-from-file': {
      const result = await executeExtensionWorkerCommand(libraryService, request, {
        scheduleMutationThumbnails: (libraryId, assetIds) => {
          scheduleThumbnailScene(libraryId, 'mutation', assetIds);
        },
      });
      if (result === undefined) {
        throw new Error(`Unhandled extension command: ${request.command.type}`);
      }
      return result;
    }
    case 'library.export':
    case 'library.export-cancel':
    case 'library.import-folder':
    case 'library.import-zip':
    case 'library.import-cancel':
    case 'library.import-validate': {
      const result = await executeLibraryTransferWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled library transfer command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.analyze': {
      const result = await executeAiWorkerCommand(libraryService, request, {
        analysisControls,
        publishAiProgress,
        aiJobAbortRegistry,
        providerConcurrencyLimiter,
        aiProcessBatchAbortControllers,
        parentPort,
        runWithoutAdmission: (requestId, work) =>
          interactiveScheduler.runWithoutAdmission(requestId, work),
      });
      if (result === undefined) {
        throw new Error(`Unhandled AI command: ${request.command.type}`);
      }
      return result;
    }
    case 'ai.content.get': {
      const result = await executeAiWorkerCommand(libraryService, request, {
        analysisControls,
        publishAiProgress,
        aiJobAbortRegistry,
        providerConcurrencyLimiter,
        aiProcessBatchAbortControllers,
        parentPort,
        runWithoutAdmission: (requestId, work) =>
          interactiveScheduler.runWithoutAdmission(requestId, work),
      });
      if (result === undefined) {
        throw new Error(`Unhandled AI command: ${request.command.type}`);
      }
      return result;
    }
    case 'media.generate-thumbnail':
    case 'media.retry-artifact': {
      const result = await executeMediaGenerationWorkerCommand(libraryService, request, {
        writePluginMediaArtifact,
        scheduleThumbnails: (libraryId, scene, assetIds) => {
          scheduleThumbnailScene(libraryId, scene, assetIds);
        },
        publishThumbnailReady: (event) => {
          thumbnailCompletionFanout.publishImmediate(event);
        },
        scheduleSecondaryMediaQueue,
      });
      if (result === undefined) {
        throw new Error(`Unhandled media generation command: ${request.command.type}`);
      }
      return result;
    }
    case 'model.convert-fbx':
    case 'media.get-artifact-path':
    case 'media.get-artifact-paths':
    case 'media.get-source-path':
    case 'media.get-thumbnail-artifact':
    case 'media.get-preview-artifact':
    case 'media.get-asset-path':
    case 'model.resolve-companions':
    case 'media.get-asset-paths':
    case 'media.get-asset-drag-infos':
    case 'media.resolve-asset-paths': {
      const result = await executeMediaPathWorkerCommand(libraryService, request, {
        writePluginMediaArtifact,
        scheduleThumbnails: (libraryId, scene, assetIds, maxIds, options) => {
          scheduleThumbnailScene(libraryId, scene, assetIds, maxIds, options);
        },
        mutationPendingFor: (libraryId) => interactiveScheduler.mutationPendingFor(libraryId),
      });
      if (result === undefined) {
        throw new Error(`Unhandled media path command: ${request.command.type}`);
      }
      return result;
    }
    case 'asset.thumbnail.visible-window': {
      const result = executeVisibleWindowWorkerCommand(libraryService, request, {
        startupThumbnailVisibleWindows,
        deferredStartupThumbnailGenerations,
        startDeferredStartupThumbnailScene,
        viewportPriorityOverlay,
        currentLibraryGeneration: (libraryId) => libraryGenerationRegistry.current(libraryId),
        lastVisibleWindowKeyByLibrary,
        lastVisibleWindowAssetIdsByLibrary,
        lastViewportVisibleChangeAtMs,
        lastViewportPreemptAtMs,
        activeThumbnailQueueAssetScopes,
        setImmediateAssetIds: (libraryId, assetIds) => {
          thumbnailCompletionFanout.setImmediateAssetIds(libraryId, assetIds);
        },
        hasIdleForegroundImageSlot,
        scheduleVisibleThumbnails: (libraryId, assetIds, preemptVisible) => {
          scheduleThumbnailScene(
            libraryId,
            'visible',
            assetIds,
            assetIds.length,
            { light: true, preemptVisible },
          );
        },
        enqueueVisibleWindowDimensionProbes,
      });
      if (result === undefined) {
        throw new Error(`Unhandled visible-window command: ${request.command.type}`);
      }
      return result;
    }
    case 'media.enqueue-thumbnail-jobs':
    case 'media.set-audio-preview-preference':
    case 'asset.rotate-image-content':
    case 'media.process-thumbnail-queue':
    case 'media.job-summary':
    case 'media.list-jobs':
    case 'media.pause-jobs':
    case 'media.resume-jobs':
    case 'media.cancel-jobs':
    case 'media.retry-jobs': {
      const result = await executeMediaJobWorkerCommand(libraryService, request, {
        scheduleThumbnailQueue,
      });
      if (result === undefined) {
        throw new Error(`Unhandled media job command: ${request.command.type}`);
      }
      return result;
    }
    case 'plugin.jobs.enqueue':
    case 'plugin.jobs.list':
    case 'plugin.jobs.claim-next':
    case 'plugin.jobs.complete':
    case 'plugin.jobs.cancel':
    case 'plugin.jobs.pause':
    case 'plugin.jobs.resume':
    case 'plugin.jobs.retry':
    case 'plugin.jobs.report-progress':
    case 'plugin.jobs.pause-owners':
    case 'plugin.derived-fields.materialize':
    case 'plugin.derived-fields.query': {
      const result = executePluginJobWorkerCommand(libraryService, request);
      if (result === undefined) {
        throw new Error(`Unhandled plugin job command: ${request.command.type}`);
      }
      return result;
    }
    case 'ai.configure':
    case 'ai.test-connection':
    case 'ai.enqueue-analysis':
    case 'ai.pending-assets.request':
    case 'ai.process-queue':
    case 'ai.set-concurrency-limit':
    case 'ai.clear-content':
    case 'ai.pause-jobs':
    case 'ai.resume-jobs':
    case 'ai.cancel-jobs':
    case 'ai.retry-jobs':
    case 'ai.status': {
      const result = await executeAiWorkerCommand(libraryService, request, {
        analysisControls,
        publishAiProgress,
        aiJobAbortRegistry,
        providerConcurrencyLimiter,
        aiProcessBatchAbortControllers,
        parentPort,
        runWithoutAdmission: (requestId, work) =>
          interactiveScheduler.runWithoutAdmission(requestId, work),
      });
      if (result === undefined) {
        throw new Error(`Unhandled AI command: ${request.command.type}`);
      }
      return result;
    }
    case 'automation.file-operation-plan':
      // This preflight is deliberately accepted only through the fail-closed
      // automation-readonly dispatcher above. A normal desktop request must
      // not be able to manufacture a plan outside Main approval.
      throw new Error('Automation file-operation planning requires automation-readonly dispatch.');
    case 'automation.file-import-plan':
      throw new Error('Automation import planning requires automation-readonly dispatch.');
    case 'semantic.index.begin':
    case 'semantic.index.rebuild':
    case 'semantic.index.targets':
    case 'semantic.index.prepare':
    case 'semantic.index.audio.release':
    case 'semantic.index.audio-window':
    case 'semantic.index.write':
    case 'semantic.index.search':
    case 'semantic.index.cancel-search':
    case 'semantic.index.similar':
    case 'semantic.index.close':
    case 'semantic.index.job':
    case 'semantic.index.import-legacy':
      throw new Error('Semantic index commands must be dispatched through the Worker-owned index handler.');
    case 'selection.trash':
      throw new Error('Selection trash must be dispatched through its writer lease.');
    default:
      return assertNever(request.command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Worker command: ${String(value)}`);
}

function requestIdFrom(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('requestId' in input)) return undefined;
  const requestId = input.requestId;
  return typeof requestId === 'string' && requestId.trim() !== '' && requestId.length <= 255
    ? requestId
    : undefined;
}

function performanceEnvelopeForRequest(request: WorkerRequest): PerformanceRequestEnvelope {
  if (request.performance) return request.performance;
  const libraryId = 'libraryId' in request.command && typeof request.command.libraryId === 'string'
    ? request.command.libraryId
    : undefined;
  const interactionKey = performanceInteractionKeyForCommand(request.command);
  return {
    lane: performanceLaneForCommand(request.command),
    sentAtEpochMs: request.sentAt ?? Date.now(),
    ...(libraryId === undefined ? {} : { libraryId }),
    ...(interactionKey === undefined ? {} : { interactionKey }),
  };
}

function performanceAssetIdForRequest(request: WorkerRequest): string | undefined {
  return 'assetId' in request.command && typeof request.command.assetId === 'string'
    ? request.command.assetId
    : undefined;
}

function logWorkerRequestSpan(input: {
  request: WorkerRequest;
  performanceEnvelope: PerformanceRequestEnvelope;
  callbackAt: number;
  executeMs: number;
  outcome: 'ok' | 'cancelled' | 'failed';
  reasonCode?: string;
}): void {
  if (!WORKER_CMD_LOG) return;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: 'performance.span',
    requestId: input.request.requestId,
    ownerId: 'library-worker.request',
    libraryId: input.performanceEnvelope.libraryId,
    assetId: performanceAssetIdForRequest(input.request),
    lane: input.performanceEnvelope.lane,
    stage: 'request',
    queueMs: Math.max(0, input.callbackAt - input.performanceEnvelope.sentAtEpochMs),
    executeMs: Math.max(0, input.executeMs),
    outcome: input.outcome,
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
  }));
}

const handleLibraryWorkerMessage = async (event: { data: unknown }): Promise<void> => {
  const input: unknown = event.data;
  const callbackAt = WORKER_CMD_LOG ? Date.now() : 0;

  const linkedMissingVisibility = parseLinkedMissingVisibilityMessage(input);
  if (linkedMissingVisibility) {
    libraryService.setShowMissingLinkedFiles(linkedMissingVisibility.show);
    return;
  }

  const thumbnailExtensions = parsePluginThumbnailExtensionsMessage(input);
  if (thumbnailExtensions) {
    const hasNewExtensions = libraryService.setPluginThumbnailExtensions(
      thumbnailExtensions.libraryId,
      thumbnailExtensions.extensions,
    );
    if (hasNewExtensions && libraryService.hasOpenLibrary(thumbnailExtensions.libraryId)) {
      // Extension synchronization is frequent (including an empty startup
      // update). Only newly claimed formats need a bounded primary admission;
      // ordinary startup and explicit refresh own legacy-artifact maintenance.
      scheduleThumbnailQueue(thumbnailExtensions.libraryId, {
        limit: 50,
        priority: 100,
        skipStaleRepair: true,
      });
    }
    return;
  }

  try {
    const providerResponse = parsePluginMediaProviderResponse(input);
    const pending = pendingPluginMediaProviderRequests.get(providerResponse.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPluginMediaProviderRequests.delete(providerResponse.requestId);
      pending.resolve(providerResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    // Slice E: Main's offscreen render result (PNG bytes or typed failure).
    const renderResponse = parseModelThumbnailRenderResponse(input);
    const pending = pendingModelThumbnailRenders.get(renderResponse.requestId);
    if (pending) {
      pending.cleanup();
      pendingModelThumbnailRenders.delete(renderResponse.requestId);
      pending.resolve(renderResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    // Main's offscreen document capture result.
    const documentResponse = parseDocumentThumbnailRenderResponse(input);
    const pendingDocument = pendingDocumentThumbnailRenders.get(documentResponse.requestId);
    if (pendingDocument) {
      pendingDocument.cleanup();
      pendingDocumentThumbnailRenders.delete(documentResponse.requestId);
      pendingDocument.resolve(documentResponse.result);
    }
    return;
  } catch {
    // A normal Worker request or control message; validate it below.
  }

  try {
    const control = parseWorkerControlMessage(input);
    if (control.type === 'worker.shutdown') {
      startupBurstGates.cancelAll('Worker shutdown cancelled startup reconciliation.');
      aiJobAbortRegistry.abortAll();
      aiProgressThrottler.clearAll();
      for (const libraryId of [...deferredMediaResourceRetries.keys()]) {
        cancelMediaResourceRetry(libraryId);
      }
      for (const libraryId of [...visibleDimensionProbeStates.keys()]) {
        cancelVisibleWindowDimensionProbes(libraryId);
      }
      for (const libraryId of new Set([
        ...activeThumbnailQueues,
        ...activeThumbnailQueueControllers.keys(),
        ...deferredStartupThumbnailGenerations.keys(),
        ...activeSecondaryMediaQueues,
        ...activeSecondaryMediaQueueControllers.keys(),
        ...secondaryMediaRetryTimers.keys(),
        ...pendingThumbnailQueueAborts,
        ...pendingThumbnailQueueFailureRetries.keys(),
        ...pendingThumbnailQueueFailureRecoveries,
      ])) {
        cancelAutomaticMediaForLibrary(libraryId);
      }
      interactiveScheduler.cancelAllQueued();
      closingLibraryIds.clear();
      libraryGenerationRegistry.reset();
      // Kill real encoder children first so a stuck media promise cannot hold
      // shutdown hostage. Abort/close then runs as a bounded second pass, and
      // the final cleanup catches children that raced the first termination.
      await closeSemanticIndexWorkerLibrary();
      await shutdownWorkerResources(
        (timeoutMs) => libraryService.closeAllAsync(timeoutMs),
        shutdownActiveMediaProcesses,
        500,
      );
      workerPort.postMessage({ type: 'worker.shutdown.ack' });
      clearInterval(processLifetime);
      return;
    }
  } catch {
    // A normal request is not a control message; validate it below.
  }

  const requestId = requestIdFrom(input);
  if (!requestId) return;

  // KEEL_WORKER_CMD_LOG=1 emits one JSON line per
  // command with event-loop wait (message → dispatch) and service time, so
  // browse-latency attribution can see what the single Worker thread was
  // doing while the renderer waited.
  const cmdLogReceivedAt = WORKER_CMD_LOG ? performance.now() : 0;

  let response: WorkerResponse;
  // track in-flight commands so the open-reconciliation gate
  // can tell "startup burst drained" apart from "gap between burst waves".
  const responseCommandType =
    typeof input === 'object' && input !== null && 'command' in input &&
    typeof input.command === 'object' && input.command !== null && 'type' in input.command
      ? String(input.command.type)
      : '';
  let trackedLibraryId: string | undefined;
  let trackedLibraryGeneration: number | undefined;
  let startupResponseGate: StartupBurstGateToken | undefined;
  try {
    const request = parseWorkerRequest(input);
    const performanceEnvelope = performanceEnvelopeForRequest(request);
    // the renderer already stamps browse commands with a
    // navigation id. Carry it onto the command diagnostic line so the benchmark
    // can join this command's queue / admission / run spans to the click that
    // caused it instead of guessing from time windows. Diagnostics only.
    const cmdNavigationIdRaw = (request.command as { navigationId?: unknown }).navigationId;
    const cmdLogNavigationId = typeof cmdNavigationIdRaw === 'string' ? cmdNavigationIdRaw : undefined;
    trackedLibraryId = performanceEnvelope.libraryId;
    trackedLibraryGeneration = performanceEnvelope.libraryGeneration
      ?? (trackedLibraryId === undefined
        ? undefined
        : libraryGenerationRegistry.current(trackedLibraryId));
    if (trackedLibraryId !== undefined) {
      startupBurstGates.beginCommand(trackedLibraryId, trackedLibraryGeneration);
    }
    const generationBoundLibraryId = performanceEnvelope.libraryId;
    const generationBoundGeneration = performanceEnvelope.libraryGeneration;
    const generationBound = generationBoundGeneration === undefined
      || generationBoundLibraryId === undefined
      ? undefined
      : () => libraryGenerationRegistry.isCurrent(
        generationBoundLibraryId,
        generationBoundGeneration,
      );

    const scheduledRequest = {
      requestId: request.requestId,
      lane: performanceEnvelope.lane,
      label: request.command.type,
      ...(performanceEnvelope.deadlineAtEpochMs === undefined
        ? {}
        : { deadlineAtEpochMs: performanceEnvelope.deadlineAtEpochMs }),
      ...(performanceEnvelope.libraryId === undefined
        ? {}
        : { libraryId: performanceEnvelope.libraryId }),
      ...(performanceEnvelope.libraryGeneration === undefined
        ? {}
        : { libraryGeneration: performanceEnvelope.libraryGeneration }),
      ...(performanceEnvelope.consumerId === undefined
        ? {}
        : { consumerId: performanceEnvelope.consumerId }),
      ...(performanceEnvelope.interactionKey === undefined
        ? {}
        : { interactionKey: performanceEnvelope.interactionKey }),
      ...(performanceEnvelope.interactionGeneration === undefined
        ? {}
        : { interactionGeneration: performanceEnvelope.interactionGeneration }),
      ...(request.command.type === 'library.close'
        || request.command.type === 'library.delete-from-disk'
        ? { lifecycleBoundary: true }
        : {}),
      ...(isLibraryTransitionCommand(request.command.type)
        ? { lifecyclePriority: true }
        : {}),
      ...(generationBound === undefined ? {} : { isCurrent: generationBound }),
    } as const;
    const lifecycleBoundary = request.command.type === 'library.close'
      || request.command.type === 'library.delete-from-disk';
    const lifecycleLibraryId = request.command.type === 'library.close'
      || request.command.type === 'library.delete-from-disk'
      ? request.command.libraryId
      : undefined;
    const onAdmitted = (): void => {
      if (lifecycleBoundary) {
        closingLibraryIds.add(lifecycleLibraryId!);
        startupBurstGates.cancel(
          lifecycleLibraryId!,
          'Library lifecycle boundary superseded startup reconciliation.',
        );
      }
      if (
        isInteractivePerformanceLane(performanceEnvelope.lane)
        && performanceEnvelope.libraryId !== undefined
        && shouldPreemptAutomaticMedia(request.command, performanceEnvelope.lane)
      ) {
        suspendAutomaticMediaForInteractive(performanceEnvelope.libraryId);
      }
      if (
        request.command.type === 'media.get-preview-artifact'
        || request.command.type === 'asset.text.read'
        || request.command.type === 'asset.zip.list'
        || request.command.type === 'asset.zip.read-entry'
        || request.command.type === 'media.get-source-path'
      ) {
        // Source paths are cheap control lookups; preview resolution is a
        // viewer upgrade and may need to claim a decoder for RAW/OIIO/ICO or a
        // plugin artifact. Both still record activity before the handler.
        noteInteractiveMediaRequest(request.command.libraryId, {
          abortSecondary: request.command.type !== 'media.get-source-path',
        });
        if (request.command.type === 'media.get-preview-artifact') {
          libraryService.interruptThumbnailJobsOutsideViewport(
            request.command.libraryId,
            [request.command.assetId],
          );
        }
      }
      if (request.command.type === 'asset.search') {
        noteInteractiveMediaRequest(request.command.libraryId, { abortSecondary: false });
        latestAssetSearchRequests.mark(
          request.command.libraryId,
          searchRequestLaneKey(request.command),
          request.requestId,
        );
      } else if (request.command.type === 'asset.thumbnail.visible-window') {
        noteInteractiveMediaRequest(request.command.libraryId);
      }
    };
    const runScheduled = async (): Promise<WorkerResult> => {
      const dispatchStartedAt = performance.now();
      const previousActivity = getCurrentWorkerActivity();
      setCurrentWorkerActivity(`command:${request.command.type}`);
      let outcome: 'ok' | 'failed' = 'ok';
      let reasonCode: string | undefined;
      try {
        const result = await handleRequest(request);
        if (!result.ok) {
          outcome = 'failed';
          reasonCode = result.error.code;
        }
        libraryGenerationRegistry.observeResult(result);
        if (
          result.ok
          && result.type === 'library.opened'
        ) {
          closingLibraryIds.delete(result.library.libraryId);
          if (result.library.readOnly) return result;
          const generation = libraryGenerationRegistry.current(result.library.libraryId);
          if (generation !== undefined) {
            startupResponseGate = scheduleOpenBackgroundReconciliation(
              result.library.libraryId,
              generation,
            );
            deferStartupThumbnailScene(result.library.libraryId, generation);
          }
        }
        return result;
      } catch (error) {
        outcome = 'failed';
        reasonCode = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
        throw error;
      } finally {
        if (lifecycleBoundary && outcome === 'failed') {
          closingLibraryIds.delete(lifecycleLibraryId!);
        }
        const executeMs = performance.now() - dispatchStartedAt;
        setCurrentWorkerActivity(previousActivity);
        logWorkerRequestSpan({
          request,
          performanceEnvelope,
          callbackAt,
          executeMs,
          outcome,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        });
        if (WORKER_CMD_LOG) {
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            scope: 'worker.cmd',
            requestId: request.requestId,
            type: request.command.type,
            lane: performanceEnvelope.lane,
            // Attribution across a library switch: a stalled switch is caused by
            // work belonging to the *outgoing* library, which the request type
            // and lane alone cannot show.
            ...(performanceEnvelope.libraryId === undefined
              ? {}
              : { libraryId: performanceEnvelope.libraryId }),
            ...(cmdLogNavigationId === undefined ? {} : { navigationId: cmdLogNavigationId }),
            callbackAt,
            sentAt: performanceEnvelope.sentAtEpochMs,
            queueMs: Math.max(0, callbackAt - performanceEnvelope.sentAtEpochMs),
            schedulerWaitMs: Math.round((dispatchStartedAt - cmdLogReceivedAt) * 100) / 100,
            runMs: Math.round(executeMs * 100) / 100,
            outcome,
            ...(reasonCode === undefined ? {} : { reasonCode }),
          }));
        }
      }
    };
    try {
      const cancelWhileTransferRuns =
        request.command.type === 'library.import-cancel'
        || request.command.type === 'library.export-cancel'
        || request.command.type === 'asset.delete-cancel'
        || request.command.type === 'semantic.index.cancel-search';
      const aiProcessLibraryId = request.command.type === 'ai.process-queue'
        ? request.command.libraryId
        : undefined;
      response = {
        requestId: request.requestId,
        result: cancelWhileTransferRuns
          ? await runScheduled()
          : await interactiveScheduler.schedule(scheduledRequest, runScheduled, {
            ...(lifecycleBoundary
              ? { cancelQueuedForLibrary: lifecycleLibraryId! }
              : {}),
            ...(aiProcessLibraryId === undefined
              ? {}
              : {
                cancel: () => {
                  aiProcessBatchAbortControllers.get(request.requestId)?.abort();
                  aiJobAbortRegistry.abort(aiProcessLibraryId);
                },
              }),
            onAdmitted,
          }),
      };
    } catch (error) {
      if (!(error instanceof SchedulerCancelledError)) throw error;
      logWorkerRequestSpan({
        request,
        performanceEnvelope,
        callbackAt,
        executeMs: 0,
        outcome: 'cancelled',
        reasonCode: error.reasonCode,
      });
      response = {
        requestId: request.requestId,
        result: { ok: false, error: createPublicError('CANCELLED') },
      };
    }
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: 'worker.request',
      requestId,
      commandType:
        typeof input === 'object' && input !== null && 'command' in input &&
        typeof input.command === 'object' && input.command !== null && 'type' in input.command
          ? String(input.command.type)
          : 'malformed',
      error: errorForLog(error),
    }));
    response = {
      requestId,
      result: {
        ok: false,
        error: publicErrorForWorkerFailure(error),
      },
    };
  }

  workerPort.postMessage(response);
  // settle the open-reconciliation startup gate only after the
  // response has actually been posted to Main — "served" must mean delivered.
  if (startupResponseGate !== undefined) {
    startupBurstGates.finishOpenResponse(startupResponseGate);
  }
  if (trackedLibraryId !== undefined) {
    startupBurstGates.finishCommand({
      libraryId: trackedLibraryId,
      ...(trackedLibraryGeneration === undefined
        ? {}
        : { generation: trackedLibraryGeneration }),
      commandType: responseCommandType,
      servedSuccessfully: response.result.ok,
    });
  }
};

parentPort.on('message', (event) => {
  void handleLibraryWorkerMessage(event);
});

// CI 诊断：UtilityProcess fork 后若模块加载失败/被系统杀，main 只见握手
// 超时且无任何输出。ready 前打印 boot 行（经 stdout 转发到 app-log），
// 可区分「worker 未执行」与「执行但握手慢」。
process.stdout.write(
  `${JSON.stringify({ scope: 'worker.boot', message: 'worker module loaded, sending ready.' })}\n`,
);
parentPort.postMessage({ type: 'worker.ready' });
