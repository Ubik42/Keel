import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ImageSequencePreferences } from "../../image-sequence-preferences";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { type AssetSummary } from "../../../shared/asset-types";
import { type ImportConflictPlan, type ImportSourceFailurePlan } from "../../../shared/protocol/responses";
import { applyImportPrepareResult } from "../../apply-import-prepare-result";
import { LibraryOperationError, toMessage } from "../../error-utils";
import { imageSequenceImportFlags } from "../../image-sequence-preferences";
import { nextImportConflictPhaseAfterName } from "../../import-conflict-flow";
import { loadImportConflictPreferences, rememberDuplicateDecision, rememberNameConflictDecision, type RememberedDuplicateDecision, type RememberedNameConflictDecision } from "../../import-conflict-preferences";
import { canBeginImportDecisionSubmit, shouldSuppressImportContinueError } from "../../import-conflict-submit";
import { importSummaryMessage } from "../../import-summary";
import { browseScopeForAsset, type PendingAssetReveal } from "../../pending-asset-reveal";
import { isPostImportSequenceOfferId, postImportFrameGroupsForAction, postImportSequencePlanFromAssets, type PostImportSequencePlan } from "../../post-import-image-sequences";
import { type BrowseState } from "../../stores/browse-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { transfersFields, type TransfersState } from "../../stores/transfers-store";
import { playTaskCompletionSound } from "../../task-completion-sound";
import { type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface UseImportOperationsDeps {
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  assets: BrowseState["assets"];
  pendingRevealRef: RefObject<PendingAssetReveal | null>;
  showTrash: NavigationState["showTrash"];
  assetScope: NavigationState["assetScope"];
  pendingRestoredFocusRef: RefObject<string | null>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  library: SessionState["library"];
  imageSequencePrefs: ImageSequencePreferences;
  postImportSequencePlanRef: RefObject<PostImportSequencePlan | null>;
  setImageSequenceConfirmPurpose: Dispatch<SetStateAction<TransfersState["imageSequenceConfirmPurpose"]>>;
  setImageSequenceImportError: Dispatch<SetStateAction<TransfersState["imageSequenceImportError"]>>;
  setImageSequenceImportOffer: Dispatch<SetStateAction<TransfersState["imageSequenceImportOffer"]>>;
  offerPostImportSequencesRef: RefObject<(assets: readonly AssetSummary[]) => void>;
  api: KeelLibraryApi | undefined;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setError: (text: string | null) => void;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  runCurrentImportRpc: <T>(work: () => Promise<T>) => Promise<T>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  t: TranslateFn;
  presentImportConflicts: (plan: ImportConflictPlan) => void;
  presentImportSourceFailure: (plan: ImportSourceFailurePlan) => void;
  locale: AppLocale;
  revealAfterImport: (completion: { assets: AssetSummary[]; }) => Promise<void>;
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  importProgress: TransfersState["importProgress"];
  setLibraryTransferKind: Dispatch<SetStateAction<TransfersState["libraryTransferKind"]>>;
  setFolderBrowseRefreshToken: Dispatch<SetStateAction<BrowseState["folderBrowseRefreshToken"]>>;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  imageSequenceImportOffer: TransfersState["imageSequenceImportOffer"];
  setImageSequenceImportSubmitting: Dispatch<SetStateAction<TransfersState["imageSequenceImportSubmitting"]>>;
  setImageSequenceImportIndex: Dispatch<SetStateAction<TransfersState["imageSequenceImportIndex"]>>;
  imageSequenceConfirmPurpose: TransfersState["imageSequenceConfirmPurpose"];
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  setImportDecisionSubmitting: Dispatch<SetStateAction<TransfersState["importDecisionSubmitting"]>>;
  completedImportIdRef: RefObject<string | null>;
  clearImportConflictsUi: () => void;
  resolveImportConflictsRef: RefObject<(plan: ImportConflictPlan, name: RememberedNameConflictDecision, duplicate: RememberedDuplicateDecision) => Promise<void>>;
  importSourceFailurePlan: TransfersState["importSourceFailurePlan"];
  clearImportSourceFailureUi: () => void;
  conflicts: TransfersState["conflicts"];
  rememberNameConflict: TransfersState["rememberNameConflict"];
  nameDecision: TransfersState["nameDecision"];
  setConflictPhase: Dispatch<SetStateAction<TransfersState["conflictPhase"]>>;
  duplicateDecision: TransfersState["duplicateDecision"];
  rememberDuplicate: TransfersState["rememberDuplicate"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useImportOperations({ visibleAssets, assets, pendingRevealRef, showTrash, assetScope, pendingRestoredFocusRef, setSelectedAssetIds, setSelectedAssetId, setAssetSelectionAnchor, workspaceCanvasRef, chooseFolder, library, imageSequencePrefs, postImportSequencePlanRef, setImageSequenceConfirmPurpose, setImageSequenceImportError, setImageSequenceImportOffer, offerPostImportSequencesRef, api, setUiState, setError, setNotice, runCurrentImportRpc, managedImportTargetFolderIdRef, t, presentImportConflicts, presentImportSourceFailure, locale, revealAfterImport, showBlockingError, setImportProgress, importProgress, setLibraryTransferKind, setFolderBrowseRefreshToken, reloadCurrentContent, imageSequenceImportOffer, setImageSequenceImportSubmitting, setImageSequenceImportIndex, imageSequenceConfirmPurpose, clearAssetSelection, setImportDecisionSubmitting, completedImportIdRef, clearImportConflictsUi, resolveImportConflictsRef, importSourceFailurePlan, clearImportSourceFailureUi, conflicts, rememberNameConflict, nameDecision, setConflictPhase, duplicateDecision, rememberDuplicate }: UseImportOperationsDeps) {

  async function showAssetInContainingFolder(assetId: string) {
    const asset =
      visibleAssets.find((item) => item.assetId === assetId) ??
      assets.find((item) => item.assetId === assetId);
    if (!asset || asset.deletedAt) return;
    const scope = browseScopeForAsset(asset);
    if (!scope) return;
    pendingRevealRef.current = {
      assetIds: [asset.assetId],
      focusAssetId: asset.assetId,
    };
    const alreadyThere =
      !showTrash &&
      assetScope === scope;
    if (alreadyThere) {
      pendingRestoredFocusRef.current = asset.assetId;
      setSelectedAssetIds([asset.assetId]);
      setSelectedAssetId(asset.assetId);
      setAssetSelectionAnchor(asset.assetId);
      const card = Array.from(
        workspaceCanvasRef.current?.querySelectorAll<HTMLElement>(
          "[data-asset-id]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.assetId === asset.assetId);
      card?.scrollIntoView({ block: "center", inline: "center" });
      return;
    }
    await chooseFolder(scope);
  }

  function offerPostImportImageSequences(importedAssets: readonly AssetSummary[]) {
    if (!library) return;
    if (!imageSequencePrefs.detectionEnabled) return;
    if (imageSequencePrefs.autoDetectOnImport) return;
    const plan = postImportSequencePlanFromAssets(
      library.libraryId,
      importedAssets,
    );
    if (!plan) return;
    postImportSequencePlanRef.current = plan;
    setImageSequenceConfirmPurpose("import");
    setImageSequenceImportError(null);
    setImageSequenceImportOffer(plan.offer);
  }
  offerPostImportSequencesRef.current = offerPostImportImageSequences;

  // --- Existing operations ---

  async function importAssets(kind: "files" | "folder") {
    if (!api || !library) return;
    const startedAt = Date.now();
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const sequenceFlags = imageSequenceImportFlags(imageSequencePrefs);
      const result = await runCurrentImportRpc(() =>
        kind === "files"
          ? api.importFiles({
              libraryId: library.libraryId,
              targetFolderId: managedImportTargetFolderIdRef.current,
              ...sequenceFlags,
            })
          : api.importFolder({
              libraryId: library.libraryId,
              targetFolderId: managedImportTargetFolderIdRef.current,
              ...sequenceFlags,
            }),
      );
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(t("toast.importCancelled"));
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      const completion = applyImportPrepareResult(result.value, {
        onConflicts: presentImportConflicts,
        onSourceFailure: presentImportSourceFailure,
        onSequenceOffer: (offer) => {
          setImageSequenceConfirmPurpose("import");
          setImageSequenceImportOffer(offer);
        },
      });
      if (!completion) return;
      setNotice(importSummaryMessage(completion, locale));
      await revealAfterImport(completion);
      offerPostImportImageSequences(completion.assets);
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.importFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setImportProgress(null);
      setUiState("ready");
    }
  }

  async function importEagleLibrary() {
    if (!api || !library || importProgress) return;
    const startedAt = Date.now();
    setLibraryTransferKind("import");
    setError(null);
    setNotice(null);
    try {
      const result = await runCurrentImportRpc(() =>
        api.importEagleLibrary({ libraryId: library.libraryId }),
      );
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(t("toast.importCancelled"));
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setNotice(importSummaryMessage(result.value, locale));
      setFolderBrowseRefreshToken((token) => token + 1);
      await reloadCurrentContent({ blockingNavigation: true });
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.importFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setImportProgress(null);
    }
  }

  async function importBillfishLibrary() {
    if (!api || !library || importProgress) return;
    const startedAt = Date.now();
    setLibraryTransferKind("import");
    setError(null);
    setNotice(null);
    try {
      const result = await runCurrentImportRpc(() =>
        api.importBillfishLibrary({ libraryId: library.libraryId }),
      );
      if (!result.ok) {
        if (result.error.code === "CANCELLED") {
          setNotice(t("toast.importCancelled"));
          return;
        }
        throw new LibraryOperationError(result.error);
      }
      setNotice(importSummaryMessage(result.value, locale));
      setFolderBrowseRefreshToken((token) => token + 1);
      await reloadCurrentContent({ blockingNavigation: true });
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      showBlockingError(
        t("dialog.blockingError.importFailed"),
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setImportProgress(null);
    }
  }

  async function confirmImageSequenceImportOffer(input: {
    action: "import-sequence" | "import-selected";
    firstFrame: number;
    fps: number;
    lastFrame: number;
    sequenceIndex: number;
    applyToRest: boolean;
  }) {
    if (!api || !library || !imageSequenceImportOffer) return;
    if (isPostImportSequenceOfferId(imageSequenceImportOffer.offerId)) {
      const plan = postImportSequencePlanRef.current;
      if (!plan) {
        setImageSequenceImportOffer(null);
        return;
      }
      setImageSequenceImportSubmitting(true);
      setImageSequenceImportError(null);
      try {
        const { groups, nextSequenceIndex } = postImportFrameGroupsForAction({
          action: input.action,
          applyToRest: input.applyToRest,
          firstFrame: input.firstFrame,
          lastFrame: input.lastFrame,
          sequenceIndex: input.sequenceIndex,
          plan,
        });
        let createdAssetId: string | null = null;
        for (const assetIds of groups) {
          const result = await api.createImageSequence({
            libraryId: library.libraryId,
            assetIds,
            fps: input.fps,
          });
          if (!result.ok) throw new LibraryOperationError(result.error);
          createdAssetId = result.value.assetId;
        }
        if (nextSequenceIndex !== null) {
          setImageSequenceImportIndex(nextSequenceIndex);
        } else {
          postImportSequencePlanRef.current = null;
          setImageSequenceImportOffer(null);
        }
        if (imageSequenceConfirmPurpose === "create" && createdAssetId) {
          clearAssetSelection();
          await reloadCurrentContent({ blockingNavigation: true });
          setSelectedAssetIds([createdAssetId]);
        } else {
          await reloadCurrentContent({ blockingNavigation: true });
        }
      } catch (caught) {
        setImageSequenceImportError(
          toMessage(caught, t("toast.importFailed"), locale),
        );
      } finally {
        setImageSequenceImportSubmitting(false);
      }
      return;
    }
    const startedAt = Date.now();
    setImageSequenceImportSubmitting(true);
    setImageSequenceImportError(null);
    setUiState("importing");
    try {
      const result = await runCurrentImportRpc(() =>
        api.confirmImageSequenceImport({
          libraryId: library.libraryId,
          offerId: imageSequenceImportOffer.offerId!,
          action: input.action,
          sequenceIndex: input.sequenceIndex,
          firstFrame: input.firstFrame,
          lastFrame: input.lastFrame,
          fps: input.fps,
          applyToRest: input.applyToRest,
        }),
      );
      if (!result.ok) throw new LibraryOperationError(result.error);
      const completion = applyImportPrepareResult(result.value, {
        onConflicts: (plan) => {
          setImageSequenceImportOffer(null);
          setImportProgress(null);
          presentImportConflicts(plan);
        },
        onSourceFailure: (plan) => {
          setImageSequenceImportOffer(null);
          setImportProgress(null);
          presentImportSourceFailure(plan);
        },
        onSequenceOffer: (offer) => {
          setImageSequenceConfirmPurpose("import");
          setImageSequenceImportOffer(offer);
        },
      });
      if (!completion) return;
      setNotice(importSummaryMessage(completion, locale));
      await revealAfterImport(completion);
      const nextSequenceIndex = input.sequenceIndex + 1;
      if (
        !input.applyToRest &&
        nextSequenceIndex < imageSequenceImportOffer.sequences.length
      ) {
        setImageSequenceImportIndex(nextSequenceIndex);
      } else {
        setImageSequenceImportOffer(null);
        playTaskCompletionSound(startedAt);
      }
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setImageSequenceImportError(
        toMessage(caught, t("toast.importFailed"), locale),
      );
    } finally {
      setImageSequenceImportSubmitting(false);
      setUiState("ready");
    }
  }

  async function resolveImportConflictsWith(
    plan: ImportConflictPlan,
    name: RememberedNameConflictDecision,
    duplicate: RememberedDuplicateDecision,
  ) {
    if (!api || !library) return;
    if (!canBeginImportDecisionSubmit(transfersFields.get("importDecisionSubmitting"))) return;
    setImportDecisionSubmitting(true);
    const startedAt = Date.now();
    setUiState("importing");
    try {
      const result = await runCurrentImportRpc(() =>
        api.resolveImport({
          importId: plan.importId,
          suspectedDuplicate: duplicate,
          nameConflict: name,
        }),
      );
      if (!result.ok) throw new LibraryOperationError(result.error);
      completedImportIdRef.current = plan.importId;
      clearImportConflictsUi();
      setImportProgress(null);
      setLibraryTransferKind("import");
      setNotice(importSummaryMessage(result.value, locale));
      await revealAfterImport(result.value);
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      clearImportConflictsUi();
      setImportProgress(null);
      setLibraryTransferKind("import");
      const code =
        caught instanceof LibraryOperationError ? caught.code : "";
      if (
        shouldSuppressImportContinueError({
          code,
          importId: plan.importId,
          completedImportId: completedImportIdRef.current,
          isInFlightRequest: true,
        })
      ) {
        return;
      }
      showBlockingError(
        t("dialog.blockingError.importContinueFailed"),
        toMessage(caught, t("toast.continueImportFailed"), locale),
      );
    } finally {
      setImportDecisionSubmitting(false);
      setUiState("ready");
    }
  }
  resolveImportConflictsRef.current = resolveImportConflictsWith;

  async function skipImportSourceFailureWith(input: {
    applyToRest: boolean;
  }) {
    if (!api || !library || !importSourceFailurePlan) return;
    if (!canBeginImportDecisionSubmit(transfersFields.get("importDecisionSubmitting"))) return;
    const plan = importSourceFailurePlan;
    setImportDecisionSubmitting(true);
    const startedAt = Date.now();
    setUiState("importing");
    try {
      const result = await runCurrentImportRpc(() =>
        api.skipImportSourceFailure({
          importId: plan.importId,
          applyToRest: input.applyToRest,
        }),
      );
      if (!result.ok) throw new LibraryOperationError(result.error);
      const completion = applyImportPrepareResult(result.value, {
        onConflicts: (next) => {
          clearImportSourceFailureUi();
          presentImportConflicts(next);
        },
        onSourceFailure: presentImportSourceFailure,
        onSequenceOffer: (offer) => {
          clearImportSourceFailureUi();
          setImageSequenceConfirmPurpose("import");
          setImageSequenceImportOffer(offer);
        },
      });
      if (!completion) return;
      completedImportIdRef.current = plan.importId;
      clearImportSourceFailureUi();
      setImportProgress(null);
      setLibraryTransferKind("import");
      setNotice(importSummaryMessage(completion, locale));
      await revealAfterImport(completion);
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      clearImportSourceFailureUi();
      clearImportConflictsUi();
      setImportProgress(null);
      setLibraryTransferKind("import");
      const code =
        caught instanceof LibraryOperationError ? caught.code : "";
      if (
        shouldSuppressImportContinueError({
          code,
          importId: plan.importId,
          completedImportId: completedImportIdRef.current,
          isInFlightRequest: true,
        })
      ) {
        return;
      }
      showBlockingError(
        t("dialog.blockingError.importContinueFailed"),
        toMessage(caught, t("toast.continueImportFailed"), locale),
      );
    } finally {
      setImportDecisionSubmitting(false);
      setUiState("ready");
    }
  }

  async function abandonSourceFailure() {
    if (!api || !importSourceFailurePlan) return;
    const plan = importSourceFailurePlan;
    clearImportSourceFailureUi();
    setImportProgress(null);
    try {
      const result = await api.abandonImport({ importId: plan.importId });
      if (!result.ok) throw new LibraryOperationError(result.error);
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelPendingImportFailed"), locale));
    }
  }

  function confirmNameConflictDialog() {
    if (!conflicts) return;
    if (rememberNameConflict) {
      rememberNameConflictDecision(nameDecision);
    }
    const prefs = loadImportConflictPreferences();
    const next = nextImportConflictPhaseAfterName(conflicts, prefs);
    if (next === "duplicate") {
      setConflictPhase("duplicate");
      return;
    }
    void resolveImportConflictsWith(
      conflicts,
      nameDecision,
      duplicateDecision,
    );
  }

  function confirmContentDuplicateDialog() {
    if (!conflicts) return;
    if (rememberDuplicate) {
      rememberDuplicateDecision(duplicateDecision);
    }
    void resolveImportConflictsWith(
      conflicts,
      nameDecision,
      duplicateDecision,
    );
  }

  async function abandonConflicts() {
    if (!api || !conflicts) return;
    const plan = conflicts;
    clearImportConflictsUi();
    setImportProgress(null);
    try {
      const result = await api.abandonImport({ importId: plan.importId });
      if (!result.ok) throw new LibraryOperationError(result.error);
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelPendingImportFailed"), locale));
    }
  }
  return { abandonConflicts, showAssetInContainingFolder, importAssets, confirmImageSequenceImportOffer, confirmNameConflictDialog, confirmContentDuplicateDialog, abandonSourceFailure, skipImportSourceFailureWith, importEagleLibrary, importBillfishLibrary };
}
