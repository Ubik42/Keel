import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AppLocale } from "../i18n/types";
import type { LibraryTransitionLock } from "../library-transition-lock";
import { type AssetMetadataResult, type AssetSummary, type SearchScope } from "../../shared/asset-types";
import { type RendererLibrarySummary } from "../../shared/protocol/responses";
import { isBenignThumbnailErrorCode } from "../../shared/thumbnail-support";
import { applyAssetThumbnailPatches, mergeAssetThumbnailPatch, type AssetThumbnailPatch } from "../asset-thumbnail-patches";
import { type BrowseMembershipChange } from "../browse-filter-membership";
import { toMessage } from "../error-utils";
import { patchFolderNavigationCoverArtifact } from "../folder-cover";
import type { JobStatusCoordinator } from "../job-status-coordinator";
import { shouldApplyLibraryLifecycleEvent, shouldDetachLibraryOnOpening } from "../library-lifecycle-sync";
import { libraryTransferKindFromOperation } from "../library-transfer-progress";
import { type LibraryViewSessionToken } from "../library-view-session";
import { browseFields, type BrowseState } from "../stores/browse-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type InspectorState } from "../stores/inspector-store";
import { type AssetScope } from "../stores/navigation-store";
import { selectionFields } from "../stores/selection-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { type TransfersState } from "../stores/transfers-store";
import { expandThumbnailCardEvents, shouldProjectThumbnailCompletion } from "../thumbnail-completion-projection";
import { type SearchDefinition } from "./app-shared";
import { useEffect } from "react";

export interface UseLibraryEventSubscriptionsDeps {
  api: KeelLibraryApi | undefined;
  setWorkerRecoveryState: Dispatch<SetStateAction<SessionState["workerRecoveryState"]>>;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  setError: (text: string | null) => void;
  t: TranslateFn;
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  locale: AppLocale;
  applyClosedLibraryUi: () => void;
  setLibraryTransferKind: Dispatch<SetStateAction<TransfersState["libraryTransferKind"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  libraryTransitionInlineOpeningRef: RefObject<"open-eagle" | "open-billfish" | null>;
  libraryTransitionLock: LibraryTransitionLock;
  setLibraryTransferName: Dispatch<SetStateAction<TransfersState["libraryTransferName"]>>;
  pendingLibraryCloseFencesRef: RefObject<Map<string, Set<number>>>;
  libraryViewSessionRef: RefObject<Readonly<{ libraryId: string | null; generation: number; }>>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  scriptSandboxPreviewOpen: DialogsState["scriptSandboxPreviewOpen"];
  beginLibraryTransition: () => Readonly<{ libraryId: string | null; generation: number; }>;
  clearLibraryScopedView: () => void;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  activateLibraryView: (libraryId: string) => Readonly<{ libraryId: string | null; generation: number; }>;
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  clearLibraryClosePending: (libraryId: string, generation: number) => void;
  library: SessionState["library"];
  resetWorkspaceTabs: () => void;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  applyBrowseGeometryPatchesRef: RefObject<(patches: ReadonlyMap<string, { width: number; height: number; }>) => void>;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
  applyBrowsePreviewPatchesRef: RefObject<(patches: ReadonlyMap<string, { previewKind: "source" | null; previewRevisionId: string | null; }>) => void>;
  setLayoutThumbnailArtifacts: Dispatch<SetStateAction<BrowseState["layoutThumbnailArtifacts"]>>;
  setFolderBrowseRefreshToken: Dispatch<SetStateAction<BrowseState["folderBrowseRefreshToken"]>>;
  visibleWindowAssetIdsRef: RefObject<ReadonlySet<string>>;
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  folderCoverCandidateAssetIdsRef: RefObject<ReadonlySet<string>>;
  jobStatusCoordinatorRef: RefObject<JobStatusCoordinator | null>;
  setExtractedMetadataRefreshKey: Dispatch<SetStateAction<InspectorState["extractedMetadataRefreshKey"]>>;
  applyLoadedMetadata: (targetAssetId: string, metadata: AssetMetadataResult) => void;
  setFolderNavigationCovers: Dispatch<SetStateAction<BrowseState["folderNavigationCovers"]>>;
  setThumbnailFailures: Dispatch<SetStateAction<BrowseState["thumbnailFailures"]>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useLibraryEventSubscriptions({ api, setWorkerRecoveryState, setWorkspaceNavigationPending, setError, t, reloadCurrentContentRef, locale, applyClosedLibraryUi, setLibraryTransferKind, setNotice, setImportProgress, closeAssetPreview, libraryTransitionInlineOpeningRef, libraryTransitionLock, setLibraryTransferName, pendingLibraryCloseFencesRef, libraryViewSessionRef, setUiState, refreshRecentLibraries, scriptSandboxPreviewOpen, beginLibraryTransition, clearLibraryScopedView, setLibrary, activateLibraryView, setLibraryLoading, loadContent, clearLibraryClosePending, library, resetWorkspaceTabs, ensureLibraryView, isCurrentLibraryView, setAssets, applyBrowseGeometryPatchesRef, syncBrowseFilterMembershipRef, applyBrowsePreviewPatchesRef, setLayoutThumbnailArtifacts, setFolderBrowseRefreshToken, visibleWindowAssetIdsRef, previewAssetRef, folderCoverCandidateAssetIdsRef, jobStatusCoordinatorRef, setExtractedMetadataRefreshKey, applyLoadedMetadata, setFolderNavigationCovers, setThumbnailFailures }: UseLibraryEventSubscriptionsDeps) {
  // MCP can switch the library behind an already-open renderer. Ordinary
  // renderer requests still update state from their response, so only tagged
  // MCP events (plus the legacy script-preview bootstrap path) are applied.
  useEffect(() => {
    if (!api) return;
    return api.onLifecycle((event) => {
      if (event.type === 'worker.recovering') {
        setWorkerRecoveryState('recovering');
        setWorkspaceNavigationPending(false);
        return;
      }
      if (event.type === 'worker.failed') {
        setWorkerRecoveryState('failed');
        return;
      }
      if (event.type === 'worker.recovered') {
        setWorkerRecoveryState('ready');
        if (event.failedLibraryIds.length > 0) setError(t('toast.workerRestoreFailed'));
        const currentLibrary = sessionFields.get("library");
        if (currentLibrary && event.libraryIds.includes(currentLibrary.libraryId)) {
          void reloadCurrentContentRef.current().catch((caught) => {
            setError(toMessage(caught, t('toast.readAssetsFailed'), locale));
          });
        }
        return;
      }
      if (event.type === "library.opening" && shouldDetachLibraryOnOpening(event)) {
        const applyLibraryOpening = async () => {
          // Clear the active library when the replacement starts. The old
          // viewer is closed asynchronously below, but the browse shell must
          // stop presenting the previous library while conversion runs.
          applyClosedLibraryUi();
          const transferKind = libraryTransferKindFromOperation(
            event.type === "library.opening" ? event.operation : undefined,
          );
          setLibraryTransferKind(transferKind);
          if (event.type === "library.opening" && event.operation === "open-eagle") {
            setNotice(t("progress.validatingEagleLibrary"));
          } else if (event.type === "library.opening" && event.operation === "open-billfish") {
            setNotice(t("progress.validatingBillfishLibrary"));
          }
          setImportProgress({
            type: "import.progress",
            importId: "",
            phase: "validate",
            cancelable: true,
            filesProcessed: 0,
            totalFiles: 0,
            bytesProcessed: 0,
            totalBytes: 0,
          });
          await closeAssetPreview(false);
        };
        // A normal Eagle/Billfish action emits this event from inside the
        // transition callback that initiated it. Re-entering the FIFO here
        // would deadlock, so execute that already-owned callback directly;
        // events arriving from MCP or another source are queued normally.
        const inlineOpeningOwnedByThisAction =
          event.source !== "mcp" &&
          libraryTransitionInlineOpeningRef.current === event.operation;
        void (inlineOpeningOwnedByThisAction
          ? applyLibraryOpening()
          : libraryTransitionLock(applyLibraryOpening));
        return;
      }
      if (event.type === "library.open-failed") {
        setImportProgress(null);
        setLibraryTransferKind("import");
        setLibraryTransferName("");
        return;
      }
      if (event.type === "library.closed") {
        const closedLibraryId = event.libraryId;
        const pendingGenerations =
          pendingLibraryCloseFencesRef.current.get(closedLibraryId);
        if (
          event.source !== "mcp" &&
          pendingGenerations !== undefined &&
          !pendingGenerations.has(libraryViewSessionRef.current.generation)
        ) {
          // An ordinary renderer-initiated close has no lifecycle source tag.
          // If the same library was reopened before its old close event was
          // delivered, the id alone is ambiguous; the session generation is
          // what distinguishes that stale event from a real close. Keep all
          // pending generations until their own requests settle so two rapid
          // closes of the same library cannot overwrite one another.
          return;
        }
        const applyLibraryClosed = async () => {
          if (sessionFields.get("library")?.libraryId !== closedLibraryId) return;
          setUiState("closing");
          try {
            await closeAssetPreview(false);
            if (sessionFields.get("library")?.libraryId !== closedLibraryId) return;
            applyClosedLibraryUi();
            await refreshRecentLibraries(null);
          } catch (caught) {
            if (sessionFields.get("library")?.libraryId === closedLibraryId) {
              setError(toMessage(caught, t("toast.closeFailed"), locale));
            }
          } finally {
            if (sessionFields.get("library") === null) setUiState("idle");
          }
        };
        // Main can close the active library on behalf of MCP. Keep the same
        // serialized boundary as renderer-triggered close; events for the
        // previous library become no-ops after a replacement is committed.
        void libraryTransitionLock(applyLibraryClosed);
        return;
      }
      if (event.type !== "library.opened") return;
      const applyLibraryOpened = async () => {
        if (!shouldApplyLibraryLifecycleEvent({
          event,
          currentLibraryId: sessionFields.get("library")?.libraryId,
          scriptSandboxPreviewOpen,
        })) return;
        try {
          beginLibraryTransition();
          await closeAssetPreview(false);
          clearLibraryScopedView();
          setLibrary(event.library);
          activateLibraryView(event.library.libraryId);
          setLibrary(event.library);
          api.setActiveContext(event.library.libraryId);
          setLibraryLoading({ name: event.library.displayName });
          await loadContent(event.library, "all", {
            navigationPriority: "library-switch",
            blockingLibraryLoad: true,
          });
          await refreshRecentLibraries(event.library.displayPath);
          setImportProgress(null);
          setLibraryTransferKind("import");
          setLibraryTransferName("");
        } catch (caught) {
          setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
        } finally {
          setLibraryLoading(null);
        }
      };
      void libraryTransitionLock(applyLibraryOpened);
    });
    // loadContent is intentionally read from the current render; adding its
    // per-render function identity would resubscribe the lifecycle bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    activateLibraryView,
    beginLibraryTransition,
    clearLibraryClosePending,
    closeAssetPreview,
    library?.libraryId,
    locale,
    refreshRecentLibraries,
    resetWorkspaceTabs,
    scriptSandboxPreviewOpen,
    libraryTransitionLock,
    setError,
    setNotice,
    t,
  ]);
  useEffect(() => {
    if (!api) return;
    const effectLibraryId = library?.libraryId;
    const effectViewSession = effectLibraryId
      ? ensureLibraryView(effectLibraryId)
      : null;
    const isEffectLibraryCurrent = () =>
      effectViewSession !== null && isCurrentLibraryView(effectViewSession);
    const pending = new Map<string, AssetThumbnailPatch>();
    const pendingLayoutArtifactIds = new Map<string, string | null>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (pending.size === 0 && pendingLayoutArtifactIds.size === 0) return;
      if (!isEffectLibraryCurrent()) {
        pending.clear();
        pendingLayoutArtifactIds.clear();
        return;
      }
      const batch = new Map(pending);
      pending.clear();
      if (batch.size > 0) {
        setAssets((current) => applyAssetThumbnailPatches(current, batch));
        const geometryPatches = new Map<string, { width: number; height: number }>();
        const previewPatches = new Map<string, {
          previewKind: 'source' | null;
          previewRevisionId: string | null;
        }>();
        for (const [assetId, patch] of batch) {
          if (
            typeof patch.width === "number" &&
            patch.width > 0 &&
            typeof patch.height === "number" &&
            patch.height > 0
          ) {
            geometryPatches.set(assetId, {
              width: patch.width,
              height: patch.height,
            });
          }
          if (
            patch.previewKind !== undefined
            && patch.previewRevisionId !== undefined
          ) {
            previewPatches.set(assetId, {
              previewKind: patch.previewKind,
              previewRevisionId: patch.previewRevisionId,
            });
          }
        }
        if (geometryPatches.size > 0) {
          applyBrowseGeometryPatchesRef.current(geometryPatches);
          const measured: Array<{
            assetId: string;
            width: number;
            height: number;
            mediaType: AssetSummary["mediaType"];
          }> = [];
          for (const [assetId, size] of geometryPatches) {
            const current = browseFields.get("assets").find((asset) => asset.assetId === assetId);
            if (!current) continue;
            measured.push({
              assetId,
              width: size.width,
              height: size.height,
              mediaType: current.mediaType,
            });
          }
          if (measured.length > 0) {
            syncBrowseFilterMembershipRef.current({
              kind: "dimensions",
              assets: measured,
            });
          }
        }
        if (previewPatches.size > 0) {
          applyBrowsePreviewPatchesRef.current(previewPatches);
        }
      }
      if (pendingLayoutArtifactIds.size > 0) {
        const layoutBatch = new Map(pendingLayoutArtifactIds);
        pendingLayoutArtifactIds.clear();
        const libraryId = library?.libraryId ?? "";
        setLayoutThumbnailArtifacts((current) => {
          const ids = current.libraryId === libraryId
            ? new Map(current.ids)
            : new Map<string, string>();
          for (const [assetId, artifactId] of layoutBatch) {
            if (artifactId) ids.set(assetId, artifactId);
            else ids.delete(assetId);
          }
          while (ids.size > 512) {
            const oldest = ids.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            ids.delete(oldest);
          }
          return { libraryId, ids };
        });
      }
    };
    const queuePatch = (assetId: string, patch: AssetThumbnailPatch) => {
      pending.set(assetId, mergeAssetThumbnailPatch(pending.get(assetId), patch));
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(flush);
    };
    const queueLayoutArtifactPatch = (
      assetId: string,
      artifactId: string | null,
    ) => {
      pendingLayoutArtifactIds.set(assetId, artifactId);
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(flush);
    };
    // Serpent-d0nv: a burst of cover thumbnail.ready events collapses into a
    // single folder-browse-entries re-fetch (one IPC for the current parent).
    let folderBrowseRefreshFrame = 0;
    const scheduleFolderBrowseRefresh = () => {
      if (folderBrowseRefreshFrame !== 0) return;
      folderBrowseRefreshFrame = window.requestAnimationFrame(() => {
        folderBrowseRefreshFrame = 0;
        if (!isEffectLibraryCurrent()) return;
        setFolderBrowseRefreshToken((token) => token + 1);
      });
    };
    const thumbnailSubscriptions = () => ({
      loadedAssetIds: new Set(browseFields.get("assets").map((asset) => asset.assetId)),
      visibleAssetIds: visibleWindowAssetIdsRef.current,
      selectedAssetId: selectionFields.get("selectedAssetId") ?? null,
      viewerAssetId: previewAssetRef.current?.assetId ?? null,
      folderCoverAssetIds: folderCoverCandidateAssetIdsRef.current,
    });
    const unsubscribe = api.onThumbnailEvent((event) => {
      if (event.libraryId !== effectLibraryId || !isEffectLibraryCurrent()) return;
      const subscriptions = thumbnailSubscriptions();
      if (event.type === "asset.dimensions.ready") {
        if (!shouldProjectThumbnailCompletion(event.assetId, subscriptions)) return;
        const currentAsset = browseFields.get("assets").find(
          (asset) => asset.assetId === event.assetId,
        );
        if (
          event.revisionId !== undefined
          && currentAsset
          && currentAsset.currentRevisionId !== event.revisionId
        ) return;
        jobStatusCoordinatorRef.current?.noteActivity("media");
        queuePatch(event.assetId, {
          width: event.width,
          height: event.height,
          ...(event.previewKind === undefined
            ? {}
            : { previewKind: event.previewKind }),
          ...(event.previewRevisionId === undefined
            ? {}
            : { previewRevisionId: event.previewRevisionId }),
          ...(event.durationMs === undefined
            ? {}
            : { durationMs: event.durationMs }),
        });
        return;
      }
      if (event.type === "asset.derived.ready") {
        // Secondary media work is deliberately delayed so it cannot compete
        // with the visible thumbnail wave. Refresh only the selected
        // Inspector metadata when that work completes; a full canvas reload
        // here would turn one palette into a library-wide render storm.
        if (
          (event.kind === "extract_metadata" || event.kind === "extract_palette") &&
          selectionFields.get("selectedAssetId") === event.assetId &&
          library &&
          isEffectLibraryCurrent()
        ) {
          jobStatusCoordinatorRef.current?.noteActivity("media");
          if (event.kind === "extract_metadata") {
            setExtractedMetadataRefreshKey((key) => key + 1);
          }
          void api
            .getAssetMetadata({
              libraryId: library.libraryId,
              assetId: event.assetId,
            })
            .then((result) => {
              if (
                result.ok &&
                selectionFields.get("selectedAssetId") === event.assetId &&
                isEffectLibraryCurrent()
              ) {
                applyLoadedMetadata(event.assetId, result.value);
              }
            })
            .catch(() => undefined);
        }
        return;
      }
      const cardEvents = expandThumbnailCardEvents(event);
      if (cardEvents.length === 0) return;
      jobStatusCoordinatorRef.current?.noteActivity("media");
      const failureUpdates = new Map<string, string | null>();
      for (const cardEvent of cardEvents) {
        if (!shouldProjectThumbnailCompletion(cardEvent.assetId, subscriptions)) {
          continue;
        }
        if (cardEvent.type === "asset.thumbnail.failed") {
          queueLayoutArtifactPatch(cardEvent.assetId, null);
          const suppressFailure = isBenignThumbnailErrorCode(cardEvent.errorCode);
          failureUpdates.set(
            cardEvent.assetId,
            suppressFailure ? null : (cardEvent.reason ?? t("toast.thumbnailFailed")),
          );
          if (!suppressFailure) {
            queuePatch(cardEvent.assetId, {
              thumbnailStatus: "failed",
              thumbnailArtifactId: null,
              ...(cardEvent.width === undefined ? {} : { width: cardEvent.width }),
              ...(cardEvent.height === undefined ? {} : { height: cardEvent.height }),
            });
          }
          continue;
        }
        if (cardEvent.artifactId) {
          queueLayoutArtifactPatch(cardEvent.assetId, cardEvent.artifactId);
        }
        failureUpdates.set(cardEvent.assetId, null);
        if (cardEvent.artifactId) {
          queuePatch(cardEvent.assetId, {
            thumbnailStatus: "ready",
            thumbnailArtifactId: cardEvent.artifactId,
            ...(cardEvent.width === undefined ? {} : { width: cardEvent.width }),
            ...(cardEvent.height === undefined ? {} : { height: cardEvent.height }),
            ...(cardEvent.durationMs === undefined
              ? {}
              : { durationMs: cardEvent.durationMs }),
            sequenceFrameArtifactId: cardEvent.artifactId,
          });
          if (folderCoverCandidateAssetIdsRef.current.has(cardEvent.assetId)) {
            scheduleFolderBrowseRefresh();
            if (effectLibraryId && cardEvent.artifactId) {
              const patched = patchFolderNavigationCoverArtifact(
                browseFields.get("folderNavigationCovers"),
                cardEvent.assetId,
                cardEvent.artifactId,
              );
              if (patched.changed) {
                setFolderNavigationCovers(patched.covers);
              }
            }
          }
        }
      }
      if (failureUpdates.size > 0) {
        setThumbnailFailures((failures) => {
          let next = failures;
          for (const [assetId, reason] of failureUpdates) {
            if (reason === null) {
              if (!next.has(assetId)) continue;
              if (next === failures) next = new Map(failures);
              next.delete(assetId);
              continue;
            }
            if (next === failures) next = new Map(failures);
            next.set(assetId, reason);
          }
          return next;
        });
      }
    });
    return () => {
      unsubscribe();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      if (folderBrowseRefreshFrame !== 0) {
        window.cancelAnimationFrame(folderBrowseRefreshFrame);
      }
    };
  }, [
    api,
    applyLoadedMetadata,
    ensureLibraryView,
    isCurrentLibraryView,
    library,
    library?.libraryId,
    t, setAssets, setExtractedMetadataRefreshKey, setFolderBrowseRefreshToken, setFolderNavigationCovers, setLayoutThumbnailArtifacts, setThumbnailFailures, applyBrowseGeometryPatchesRef, applyBrowsePreviewPatchesRef, folderCoverCandidateAssetIdsRef, jobStatusCoordinatorRef, previewAssetRef, syncBrowseFilterMembershipRef, visibleWindowAssetIdsRef]);
  return {  };
}
