import type { useLocalConfirmation } from "../local-confirmation";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AppLocale } from "../i18n/types";
import type { AssetRenameDialogState } from "../useAssetRename";
import type { ConnectionFailureGateState } from "../ai-connection-failure";
import type { KeelShellApi } from "../../shared/external-url";
import { type AssetMetadataResult, type LinkedFolderRule } from "../../shared/asset-types";
import { type ImportConflictPlan } from "../../shared/protocol/responses";
import { type CreateLibraryPhase } from "../CreateDialog";
import { isActiveDeleteProgress, isDeleteProgressCancelable } from "../delete-progress-copy";
import { toMessage } from "../error-utils";
import { formatBytes } from "../format-file-meta";
import { isBlockingImportOverlayVisible, shouldApplyImportProgressEvent } from "../import-progress-copy";
import { addRetiredImportId } from "../import-progress-session";
import { shouldRefreshContentForLibraryChange } from "../library-change-refresh";
import { type PostImportSequencePlan } from "../post-import-image-sequences";
import { type BrowseState } from "../stores/browse-store";
import { type DialogsState } from "../stores/dialogs-store";
import { type NavigationState } from "../stores/navigation-store";
import { type PreviewState } from "../stores/preview-store";
import { selectionFields } from "../stores/selection-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { transfersFields, type TransfersState } from "../stores/transfers-store";
import { playTaskCompletionSound } from "../task-completion-sound";
import { useCriticalConfirmationPrompt } from "../use-critical-confirmation-prompt";
import { useDialogEscapeDismiss } from "../use-dialog-escape-dismiss";
import { useWindowsBrowseShortcutBridge } from "../use-windows-browse-shortcut-bridge";
import { resolveDialogEscapeAction, type DialogEscapeSnapshot } from "../workbench/overlay/dialog-escape-stack";
import { useDialogFocusTrap } from "../workbench/overlay/use-dialog-focus-trap";
import { LIBRARY_LOADING_DISPLAY_DELAY_MS, NETWORK_LIBRARY_RELOAD_INTERVAL_MS, useDelayedVisibility } from "./app-shared";
import { useEffect, useMemo } from "react";

export interface UseDialogEscapeAndFocusDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  reloadCurrentContentRef: RefObject<() => Promise<void>>;
  setLayoutThumbnailArtifacts: Dispatch<SetStateAction<BrowseState["layoutThumbnailArtifacts"]>>;
  refreshOperationHistory: () => Promise<void>;
  applyLoadedMetadata: (targetAssetId: string, metadata: AssetMetadataResult) => void;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  setError: (text: string | null) => void;
  locale: AppLocale;
  setExportProgress: Dispatch<SetStateAction<TransfersState["exportProgress"]>>;
  exportStartedAtRef: RefObject<number | null>;
  importAwaitingUserDecisionRef: RefObject<boolean>;
  importRpcDepthRef: RefObject<number>;
  retiredImportIdsRef: RefObject<Set<string>>;
  activeImportIdRef: RefObject<string | null>;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  setImportInterrupt: Dispatch<SetStateAction<TransfersState["importInterrupt"]>>;
  setLibraryTransferKind: Dispatch<SetStateAction<TransfersState["libraryTransferKind"]>>;
  setSyncProgress: Dispatch<SetStateAction<TransfersState["syncProgress"]>>;
  syncRunStartedAtRef: RefObject<number | null>;
  syncRunNotifiedRef: RefObject<boolean>;
  refreshAfterAiRef: RefObject<(assetId: string) => Promise<void>>;
  setDeleteProgress: Dispatch<SetStateAction<TransfersState["deleteProgress"]>>;
  conflicts: TransfersState["conflicts"];
  conflictPhase: TransfersState["conflictPhase"];
  imageSequenceImportOffer: TransfersState["imageSequenceImportOffer"];
  importSourceFailurePlan: TransfersState["importSourceFailurePlan"];
  uiState: SessionState["uiState"];
  importProgress: TransfersState["importProgress"];
  importRpcInFlight: TransfersState["importRpcInFlight"];
  importOverlayDismissed: TransfersState["importOverlayDismissed"];
  deleteProgress: TransfersState["deleteProgress"];
  assetRenameDialog: AssetRenameDialogState | null;
  imageSequenceDialog: DialogsState["imageSequenceDialog"];
  batchRelinkPreview: TransfersState["batchRelinkPreview"];
  restoreDialog: DialogsState["restoreDialog"];
  moveDialog: DialogsState["moveDialog"];
  exportDialogOpen: DialogsState["exportDialogOpen"];
  importLibraryChooserOpen: TransfersState["importLibraryChooserOpen"];
  openLibraryChooserOpen: DialogsState["openLibraryChooserOpen"];
  appSettingsOpen: DialogsState["appSettingsOpen"];
  librarySettingsOpen: DialogsState["librarySettingsOpen"];
  appLogOpen: DialogsState["appLogOpen"];
  scriptSandboxPreviewOpen: DialogsState["scriptSandboxPreviewOpen"];
  aboutOpen: DialogsState["aboutOpen"];
  openSourceLicensesOpen: DialogsState["openSourceLicensesOpen"];
  mediaJobsOpen: DialogsState["mediaJobsOpen"];
  linkedRulesEditor: { folderId: string; name: string; rules: LinkedFolderRule[]; } | null;
  convertLinkedDialog: DialogsState["convertLinkedDialog"];
  dialog: DialogsState["dialog"];
  fatalAlertMessage: string | null;
  aiConnectionFailureGate: ConnectionFailureGateState;
  importDecisionSubmitting: TransfersState["importDecisionSubmitting"];
  cancelAssetRename: () => void;
  postImportSequencePlanRef: RefObject<PostImportSequencePlan | null>;
  setImageSequenceImportOffer: Dispatch<SetStateAction<TransfersState["imageSequenceImportOffer"]>>;
  setImageSequenceImportError: Dispatch<SetStateAction<TransfersState["imageSequenceImportError"]>>;
  imageSequenceConfirmPurpose: TransfersState["imageSequenceConfirmPurpose"];
  setImageSequenceDialog: Dispatch<SetStateAction<DialogsState["imageSequenceDialog"]>>;
  cancelBatchRelink: () => Promise<void>;
  setRestoreDialog: Dispatch<SetStateAction<DialogsState["restoreDialog"]>>;
  setMoveDialog: Dispatch<SetStateAction<DialogsState["moveDialog"]>>;
  setExportDialogOpen: Dispatch<SetStateAction<DialogsState["exportDialogOpen"]>>;
  setImportLibraryChooserOpen: Dispatch<SetStateAction<TransfersState["importLibraryChooserOpen"]>>;
  setOpenLibraryChooserOpen: Dispatch<SetStateAction<DialogsState["openLibraryChooserOpen"]>>;
  setAppSettingsOpen: Dispatch<SetStateAction<DialogsState["appSettingsOpen"]>>;
  setLibrarySettingsOpen: Dispatch<SetStateAction<DialogsState["librarySettingsOpen"]>>;
  setAppLogOpen: Dispatch<SetStateAction<DialogsState["appLogOpen"]>>;
  setScriptSandboxPreviewOpen: Dispatch<SetStateAction<DialogsState["scriptSandboxPreviewOpen"]>>;
  setAboutOpen: Dispatch<SetStateAction<DialogsState["aboutOpen"]>>;
  setOpenSourceLicensesOpen: Dispatch<SetStateAction<DialogsState["openSourceLicensesOpen"]>>;
  setMediaJobsOpen: Dispatch<SetStateAction<DialogsState["mediaJobsOpen"]>>;
  setLinkedRulesEditor: Dispatch<SetStateAction<{ folderId: string; name: string; rules: LinkedFolderRule[]; } | null>>;
  setConvertLinkedDialog: Dispatch<SetStateAction<DialogsState["convertLinkedDialog"]>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  setDialog: Dispatch<SetStateAction<DialogsState["dialog"]>>;
  clearImportConflictsUi: () => void;
  presentImportConflicts: (plan: ImportConflictPlan) => void;
  clearImportSourceFailureUi: () => void;
  dismissFatalAlert: () => void;
  onAiConnectionFailureAbort: () => void;
  cancelImport: (mode?: "abandon" | "stop") => Promise<void>;
  dismissImportOverlay: () => void;
  cancelDiskDelete: () => Promise<void>;
  shellApi: KeelShellApi | undefined;
  libraryLoadingVisible: boolean;
  pluginUiDialogOpen: DialogsState["pluginUiDialogOpen"];
  exportProgress: TransfersState["exportProgress"];
  localConfirmation: ReturnType<typeof useLocalConfirmation> | null;
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  previewAsset: PreviewState["previewAsset"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useDialogEscapeAndFocus({ api, library, reloadCurrentContentRef, setLayoutThumbnailArtifacts, refreshOperationHistory, applyLoadedMetadata, setNotice, t, setError, locale, setExportProgress, exportStartedAtRef, importAwaitingUserDecisionRef, importRpcDepthRef, retiredImportIdsRef, activeImportIdRef, setImportProgress, setImportInterrupt, setLibraryTransferKind, setSyncProgress, syncRunStartedAtRef, syncRunNotifiedRef, refreshAfterAiRef, setDeleteProgress, conflicts, conflictPhase, imageSequenceImportOffer, importSourceFailurePlan, uiState, importProgress, importRpcInFlight, importOverlayDismissed, deleteProgress, assetRenameDialog, imageSequenceDialog, batchRelinkPreview, restoreDialog, moveDialog, exportDialogOpen, importLibraryChooserOpen, openLibraryChooserOpen, appSettingsOpen, librarySettingsOpen, appLogOpen, scriptSandboxPreviewOpen, aboutOpen, openSourceLicensesOpen, mediaJobsOpen, linkedRulesEditor, convertLinkedDialog, dialog, fatalAlertMessage, aiConnectionFailureGate, importDecisionSubmitting, cancelAssetRename, postImportSequencePlanRef, setImageSequenceImportOffer, setImageSequenceImportError, imageSequenceConfirmPurpose, setImageSequenceDialog, cancelBatchRelink, setRestoreDialog, setMoveDialog, setExportDialogOpen, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, setAppSettingsOpen, setLibrarySettingsOpen, setAppLogOpen, setScriptSandboxPreviewOpen, setAboutOpen, setOpenSourceLicensesOpen, setMediaJobsOpen, setLinkedRulesEditor, setConvertLinkedDialog, setCreateLibraryPhase, setDialog, clearImportConflictsUi, presentImportConflicts, clearImportSourceFailureUi, dismissFatalAlert, onAiConnectionFailureAbort, cancelImport, dismissImportOverlay, cancelDiskDelete, shellApi, libraryLoadingVisible, pluginUiDialogOpen, exportProgress, localConfirmation, showTagManagement, showPluginSidebarView, previewAsset }: UseDialogEscapeAndFocusDeps) {

  useEffect(() => {
    if (!api || !library) return;
    const effectLibraryId = library.libraryId;
    const isEffectLibraryCurrent = () =>
      sessionFields.get("library")?.libraryId === effectLibraryId;
    let reloadTimer: number | undefined;
    let reloadInFlight = false;
    let reloadQueued = false;
    let networkReloadCooldownTimer: number | undefined;
    let lastNetworkReloadAt = 0;
    let assetChangeDebounceTimer: number | undefined;
    const scheduleSilentReload = () => {
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined;
        if (!isEffectLibraryCurrent()) return;
        if (reloadInFlight) {
          reloadQueued = true;
          return;
        }
        reloadInFlight = true;
        void reloadCurrentContentRef
          .current()
          .catch(() => undefined)
          .finally(() => {
            reloadInFlight = false;
            if (!isEffectLibraryCurrent()) return;
            if (reloadQueued) {
              reloadQueued = false;
              scheduleSilentReload();
            }
          });
      }, 120);
    };
    const scheduleNetworkLibraryReload = () => {
      const now = Date.now();
      const elapsed = now - lastNetworkReloadAt;
      if (lastNetworkReloadAt === 0 || elapsed >= NETWORK_LIBRARY_RELOAD_INTERVAL_MS) {
        lastNetworkReloadAt = now;
        scheduleSilentReload();
        return;
      }
      // A burst of thumbnail/job writes can bump the shared sequence many
      // times. Keep one trailing refresh so the latest committed asset set is
      // observed without turning every sequence bump into a full search.
      if (networkReloadCooldownTimer !== undefined) return;
      networkReloadCooldownTimer = window.setTimeout(() => {
        networkReloadCooldownTimer = undefined;
        lastNetworkReloadAt = Date.now();
        scheduleSilentReload();
      }, NETWORK_LIBRARY_RELOAD_INTERVAL_MS - elapsed);
    };
    const unsubscribe = api.onAssetsChanged((event) => {
      if (event.libraryId !== effectLibraryId || !isEffectLibraryCurrent()) return;
      setLayoutThumbnailArtifacts({
        libraryId: library.libraryId,
        ids: new Map(),
      });
      void refreshOperationHistory();
      // Serpent-yqrl: while a user import is applying, each committed asset
      // triggers a silent canvas refresh so cards appear one-by-one.
      if (sessionFields.get("uiState") === "importing" || transfersFields.get("importProgress")) {
        scheduleSilentReload();
        return;
      }
      // Keel-关联刷新: batch mutations (delete/trash/relink) broadcast one
      // asset.changed per asset — debounce so a 500-asset delete triggers one
      // reconcile instead of 500 queued full reloads. Local removal already
      // cleared the cards; this reload only reconciles derived data.
      if (assetChangeDebounceTimer !== undefined) {
        window.clearTimeout(assetChangeDebounceTimer);
      }
      const latestEvent = event;
      assetChangeDebounceTimer = window.setTimeout(() => {
        assetChangeDebounceTimer = undefined;
        void Promise.resolve().then(async () => {
          try {
            if (!isEffectLibraryCurrent()) return;
            await reloadCurrentContentRef.current();
            if (!isEffectLibraryCurrent()) return;
            const currentSelectedAssetId = selectionFields.get("selectedAssetId");
            if (currentSelectedAssetId) {
              const metadata = await api.getAssetMetadata({
                libraryId: effectLibraryId,
                assetId: currentSelectedAssetId,
              });
              if (isEffectLibraryCurrent() && metadata.ok &&
                selectionFields.get("selectedAssetId") === currentSelectedAssetId) {
                applyLoadedMetadata(currentSelectedAssetId, metadata.value);
              }
            }
            if (!isEffectLibraryCurrent()) return;
            if (latestEvent.source === "text-save") {
              setNotice(t("toast.textFileSaved"));
            } else if (latestEvent.source === "watcher") {
              const missing = latestEvent.missingCount
                ? t("toast.diskSyncedMissing", { count: latestEvent.missingCount })
                : "";
              setNotice(
                t("toast.diskSyncedAuto", {
                  count: latestEvent.changedCount,
                  missing,
                }),
              );
            }
            // source === 'client' / 'content-replace' / 'sync' (or omitted): silent
            // canvas + folder-tree refresh. `sync` is WebDAV replay; do not toast.
          } catch (caught) {
            if (isEffectLibraryCurrent()) {
              setError(toMessage(caught, t("toast.diskChangedRefreshFailed"), locale));
            }
          }
        });
      }, 300);
    });
    let historyTimer: number | undefined;
    const scheduleHistoryRefresh = () => {
      if (historyTimer !== undefined) window.clearTimeout(historyTimer);
      historyTimer = window.setTimeout(() => {
        historyTimer = undefined;
        void refreshOperationHistory();
      }, 1500);
    };
    const unsubscribeLibraryChanged = api.onLibraryChanged((event) => {
      if (event.libraryId !== effectLibraryId || !isEffectLibraryCurrent()) return;
      scheduleHistoryRefresh();
      // Cross-process change-sequence bumps are not asset mutation counts.
      // Refresh silently without forging an asset.changed payload.
      const importing =
        sessionFields.get("uiState") === "importing" || Boolean(transfersFields.get("importProgress"));
      if (shouldRefreshContentForLibraryChange({
        networkStorage: library.networkStorage,
        importing,
      })) {
        if (!importing && library.networkStorage === true) {
          scheduleNetworkLibraryReload();
        } else {
          scheduleSilentReload();
        }
        return;
      }
      // revision_artifacts / jobs writes also bump change-sequence. The grid
      // is patched by onThumbnailEvent; a full searchAssets here freezes the
      // canvas after large imports (Serpent-yti0). Asset-set mutations still
      // arrive on asset.changed. NAS/SMB libraries are the exception: their
      // database change sequence is the cross-instance signal because the
      // other computer's asset.changed event cannot reach this renderer.
    });
    return () => {
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      if (networkReloadCooldownTimer !== undefined) {
        window.clearTimeout(networkReloadCooldownTimer);
      }
      if (historyTimer !== undefined) window.clearTimeout(historyTimer);
      if (assetChangeDebounceTimer !== undefined) {
        window.clearTimeout(assetChangeDebounceTimer);
      }
      unsubscribe();
      unsubscribeLibraryChanged();
    };
  }, [api, applyLoadedMetadata, library, locale, refreshOperationHistory, setError, setNotice, t, setLayoutThumbnailArtifacts, reloadCurrentContentRef]);

  useEffect(() => {
    if (!api) return;
    return api.onProgress((event) => {
      if (event.type === "export.progress") {
        setExportProgress(event);
        if (event.phase === "complete") {
          const startedAt = exportStartedAtRef.current;
          exportStartedAtRef.current = null;
          if (startedAt !== null) playTaskCompletionSound(startedAt);
          setNotice(
            t("toast.exportComplete", {
              files: event.totalFiles,
              bytes: formatBytes(event.totalBytes),
            }),
          );
        } else if (event.phase === "cancelled") {
          exportStartedAtRef.current = null;
          setNotice(t("toast.exportCancelled"));
        } else if (event.phase === "failed") {
          const startedAt = exportStartedAtRef.current;
          exportStartedAtRef.current = null;
          if (startedAt !== null) playTaskCompletionSound(startedAt);
        }
      } else if (event.type === "import.progress") {
        if (
          !shouldApplyImportProgressEvent(
            event,
            importAwaitingUserDecisionRef.current,
            null,
            {
              rpcInFlight: importRpcDepthRef.current > 0,
              current: transfersFields.get("importProgress"),
              retiredImportIds: retiredImportIdsRef.current,
              activeImportId: activeImportIdRef.current
                ?? transfersFields.get("importProgress")?.importId
                ?? null,
            },
          )
        ) {
          return;
        }
        setImportProgress(event);
        if (event.importId && !activeImportIdRef.current) {
          activeImportIdRef.current = event.importId;
        }
        if (["complete", "cancelled", "failed"].includes(event.phase)) {
          addRetiredImportId(retiredImportIdsRef.current, event.importId);
          setImportInterrupt(null);
          setImportProgress(null);
          setLibraryTransferKind("import");
        }
      } else if (event.type === "sync.progress") {
        if (event.phase === "complete") {
          setSyncProgress(null);
          const startedAt = syncRunStartedAtRef.current;
          syncRunStartedAtRef.current = null;
          // 完成事件 filesDone=0（worker 不携带 report）。有实际传输时
          // 播完成音并重拉 Inspector；卡片状态标识代替 toast。
          const didNotify = syncRunNotifiedRef.current;
          if (didNotify) {
            syncRunNotifiedRef.current = false;
            if (startedAt !== null) playTaskCompletionSound(startedAt);
          }
          // 元数据回放可能不发 asset.changed，或选中项未变。F5 原先也不
          // 重拉 Inspector；同步结束后补拉当前选中项标签/描述。
          const selected = selectionFields.get("selectedAssetId");
          if (selected && didNotify) {
            void refreshAfterAiRef.current(selected);
          }
        } else {
          setSyncProgress(event);
          if (event.filesTotal > 0 && !syncRunNotifiedRef.current) {
            syncRunNotifiedRef.current = true;
          }
        }
      } else if (event.type === "delete.progress") {
        if (event.phase === "complete" || event.phase === "failed" || event.phase === "cancelled") {
          setDeleteProgress(null);
        } else {
          setDeleteProgress(event);
        }
      }
    });
  }, [api, setNotice, t, setDeleteProgress, setExportProgress, setImportInterrupt, setImportProgress, setLibraryTransferKind, setSyncProgress, activeImportIdRef, exportStartedAtRef, importAwaitingUserDecisionRef, importRpcDepthRef, refreshAfterAiRef, retiredImportIdsRef, syncRunNotifiedRef, syncRunStartedAtRef]);

  const importAwaitingUserDecision = Boolean(
    (conflicts && conflictPhase) ||
      imageSequenceImportOffer ||
      importSourceFailurePlan,
  );
  importAwaitingUserDecisionRef.current = importAwaitingUserDecision;
  const importOverlayReady = isBlockingImportOverlayVisible(
    uiState,
    importProgress,
    importAwaitingUserDecision,
    {
      rpcInFlight: importRpcInFlight,
      overlayDismissed: importOverlayDismissed,
    },
  );
  const blockingImportOverlayVisible = useDelayedVisibility(
    importOverlayReady,
    LIBRARY_LOADING_DISPLAY_DELAY_MS,
  );
  const blockingDeleteOverlayVisible =
    isActiveDeleteProgress(deleteProgress) && deleteProgress.totalFiles >= 2;
  const blockingDeleteCancelable = isDeleteProgressCancelable(deleteProgress);
  const blockingImportCancelable =
    Boolean(importProgress?.importId) && importProgress?.cancelable !== false;

  const dialogEscapeSnapshot = useMemo((): DialogEscapeSnapshot => {
    return {
      assetRenameOpen: Boolean(assetRenameDialog),
      imageSequenceImportOpen: Boolean(imageSequenceImportOffer),
      imageSequenceDialogOpen: Boolean(imageSequenceDialog),
      batchRelinkOpen: Boolean(batchRelinkPreview),
      restoreOpen: Boolean(restoreDialog),
      moveOpen: Boolean(moveDialog),
      exportDialogOpen,
      importLibraryChooserOpen,
      openLibraryChooserOpen,
      appSettingsOpen,
      librarySettingsOpen,
      appLogOpen,
      scriptSandboxPreviewOpen,
      aboutOpen,
      openSourceLicensesOpen,
      mediaJobsOpen: Boolean(mediaJobsOpen && library !== null),
      linkedRulesEditorOpen: Boolean(linkedRulesEditor),
      convertLinkedOpen: Boolean(convertLinkedDialog.folderId),
      dialogOpen: Boolean(dialog),
      pluginTrustPromptOpen: false,
      fatalAlertOpen: Boolean(fatalAlertMessage),
      aiConnectionFailureOpen: aiConnectionFailureGate.open,
      conflictsImportId: conflictPhase ? (conflicts?.importId ?? null) : null,
      sourceFailureImportId: importSourceFailurePlan?.importId ?? null,
      importDecisionSubmitting,
      blockingImportOpen: blockingImportOverlayVisible,
      blockingImportCancelable,
      blockingDeleteOpen: blockingDeleteOverlayVisible,
      blockingDeleteCancelable,
    };
  }, [
    assetRenameDialog,
    imageSequenceImportOffer,
    imageSequenceDialog,
    batchRelinkPreview,
    restoreDialog,
    moveDialog,
    exportDialogOpen,
    importLibraryChooserOpen,
    openLibraryChooserOpen,
    appSettingsOpen,
    librarySettingsOpen,
    appLogOpen,
    scriptSandboxPreviewOpen,
    aboutOpen,
    openSourceLicensesOpen,
    mediaJobsOpen,
    library,
    linkedRulesEditor,
    convertLinkedDialog.folderId,
    dialog,
    fatalAlertMessage,
    aiConnectionFailureGate.open,
    conflicts?.importId,
    conflictPhase,
    importSourceFailurePlan?.importId,
    importDecisionSubmitting,
    blockingImportOverlayVisible,
    blockingImportCancelable,
    blockingDeleteOverlayVisible,
    blockingDeleteCancelable,
  ]);

  useDialogEscapeDismiss({
    api: api ?? null,
    snapshot: dialogEscapeSnapshot,
    cancelAssetRename,
    cancelImageSequenceImport: () => {
      postImportSequencePlanRef.current = null;
      setImageSequenceImportOffer(null);
      setImageSequenceImportError(null);
      if (imageSequenceConfirmPurpose === "import") {
        setImportProgress(null);
      }
    },
    cancelImageSequenceDialog: () => setImageSequenceDialog(null),
    cancelBatchRelink,
    setRestoreDialog,
    setMoveDialog,
    setExportDialogOpen,
    setImportLibraryChooserOpen,
    setOpenLibraryChooserOpen,
    setAppSettingsOpen,
    setLibrarySettingsOpen,
    setAppLogOpen,
    setScriptSandboxPreviewOpen,
    setAboutOpen,
    setOpenSourceLicensesOpen,
    setMediaJobsOpen,
    setLinkedRulesEditor,
    resetConvertLinkedDialog: () => {
      setConvertLinkedDialog({ folderId: "", name: "", targetFolderId: "" });
    },
    setDialog: (value) => {
      // Serpent-kipk: required no-library surface cannot dismiss; Escape returns
      // to the start phase instead of leaving an empty canvas.
      if (value === null && !library) {
        setCreateLibraryPhase("start");
        return;
      }
      setDialog(value);
    },
    setConflicts: (value) => {
      if (value === null) {
        clearImportConflictsUi();
        setImportProgress(null);
      } else presentImportConflicts(value);
    },
    setSourceFailurePlan: (value) => {
      if (value === null) {
        clearImportSourceFailureUi();
        setImportProgress(null);
      }
    },
    setError,
    onDismissFatalAlert: dismissFatalAlert,
    onAbortAiConnectionFailure: onAiConnectionFailureAbort,
    onCancelBlockingImport: () => {
      void cancelImport("abandon");
    },
    onDismissBlockingImport: dismissImportOverlay,
    onCancelBlockingDelete: () => {
      void cancelDiskDelete();
    },
  });

  const criticalConfirmation = useCriticalConfirmationPrompt(shellApi);

  const dialogFocusTrapActive = Boolean(
    dialog ||
      conflicts ||
      importSourceFailurePlan ||
      assetRenameDialog ||
      batchRelinkPreview ||
      restoreDialog ||
      moveDialog ||
      exportDialogOpen ||
      importLibraryChooserOpen ||
      openLibraryChooserOpen ||
      appSettingsOpen ||
      librarySettingsOpen ||
      appLogOpen ||
      scriptSandboxPreviewOpen ||
      aboutOpen ||
      openSourceLicensesOpen ||
      Boolean(imageSequenceDialog) ||
      Boolean(imageSequenceImportOffer) ||
      Boolean(fatalAlertMessage) ||
      aiConnectionFailureGate.open ||
      (mediaJobsOpen && library !== null) ||
      linkedRulesEditor ||
      convertLinkedDialog.folderId ||
      libraryLoadingVisible ||
      pluginUiDialogOpen ||
      blockingImportOverlayVisible ||
      blockingDeleteOverlayVisible ||
      Boolean(
        exportProgress &&
          !["complete", "cancelled", "failed"].includes(exportProgress.phase),
      ) ||
      criticalConfirmation.request !== null || localConfirmation !== null,
  );
  useDialogFocusTrap(
    dialogFocusTrapActive,
    localConfirmation?.id ?? criticalConfirmation.request?.requestId ?? resolveDialogEscapeAction(dialogEscapeSnapshot).kind,
  );

  useWindowsBrowseShortcutBridge({
    shell: shellApi,
    enabled: Boolean(library) && !showTagManagement && !showPluginSidebarView,
    browseAcceleratorsBlocked:
      dialogFocusTrapActive ||
      Boolean(previewAsset),
    // The bridge checks document.activeElement itself for text focus; passing
    // the React state here could leave accelerators disabled after a focused
    // field is removed along with its modal.
    applicationAcceleratorsBlocked: dialogFocusTrapActive,
  });
  return { dialogFocusTrapActive, dialogEscapeSnapshot, blockingImportOverlayVisible, blockingDeleteOverlayVisible, criticalConfirmation };
}
