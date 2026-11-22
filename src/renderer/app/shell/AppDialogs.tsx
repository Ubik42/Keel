import { aiFields, useAiField } from "../../stores/ai-store";
import { useDialogField } from "../../stores/dialogs-store";
import { useEmbeddingField } from "../../stores/embedding-store";
import { useJobsField } from "../../stores/jobs-store";
import { useNavigationField } from "../../stores/navigation-store";
import { useQueryField } from "../../stores/query-store";
import { useSessionField } from "../../stores/session-store";
import { transfersFields, useTransfersField } from "../../stores/transfers-store";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TrashRestoreRequest } from "../../trash-restore-flow";
import type { AiAnalysisSettingsWire } from "../../../shared/ai-analysis-settings";
import type { AiUiPreferences } from "../../ai-ui-preferences";
import type { ImageSequencePreferences } from "../../image-sequence-preferences";
import type { ViewerChromePreferences } from "../../viewer-chrome-preferences";
import type { KeelShellApi } from "../../../shared/external-url";
import type { RendererLibrarySummary } from "../../../shared/protocol/responses";
import type { SearchScope } from "../../../shared/asset-types";
import type { CanvasPreferences } from "../../canvas-preferences";
import type { EmbeddingHttpServiceSummary, KeelLibraryApi, LibraryApiResult } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import type { ConnectionFailureGateState } from "../../ai-connection-failure";
import type { CriticalConfirmationDecision, CriticalConfirmationPrompt } from "../../../shared/critical-confirmation";
import { type LinkedFolderRule, type SortDefinition } from "../../../shared/asset-types";
import { DEFAULT_IMAGE_SEQUENCE_FPS } from "../../../shared/image-sequence";
import { AboutDialog } from "../../AboutDialog";
import { AiConfigDialog } from "../../AiConfigDialog";
import { AiConnectionFailureDialog } from "../../AiConnectionFailureDialog";
import { AppLogDialog } from "../../AppLogDialog";
import { AppSettingsDialog } from "../../AppSettingsDialog";
import { RuleDetailDialog } from "../../RuleDetailDialog";
import { ConvertLinkedDialog } from "../../ConvertLinkedDialog";
import { CreateDialog, type CreateLibraryPhase } from "../../CreateDialog";
import { CriticalConfirmationDialog } from "../../CriticalConfirmationDialog";
import { messageForPublicError } from "../../error-utils";
import { ExportDialog } from "../../ExportDialog";
import { FatalAlertDialog } from "../../FatalAlertDialog";
import { FOLDER_COVER_PICKER_PAGE_SIZE } from "../../folder-cover-picker";
import { FolderCoverPickerDialog } from "../../FolderCoverPickerDialog";
import { ImageSequenceDialog } from "../../ImageSequenceDialog";
import { ImportDialog } from "../../ImportDialog";
import { ImportLibraryChooserDialog, OpenLibraryChooserDialog } from "../../ImportLibraryChooserDialog";
import { LibraryRecoveryDialog } from "../../LibraryRecoveryDialog";
import { LibrarySettingsDialog } from "../../LibrarySettingsDialog";
import { writeShowMissingLinkedFiles } from "../../linked-missing-preference";
import { LinkedRulesDialog } from "../../LinkedRulesDialog";
import { KEEL_VERSION } from "../../main-menu-items";
import { MediaJobsDialog } from "../../MediaJobsDialog";
import { MoveDialog } from "../../MoveDialog";
import { OpenSourceLicensesDialog } from "../../OpenSourceLicensesDialog";
import { OpenSyncLibraryDialog } from "../../OpenSyncLibraryDialog";
import { RelinkPreview } from "../../RelinkPreview";
import { RestoreDialog } from "../../RestoreDialog";
import { ScriptSandboxPreviewDialog } from "../../ScriptSandboxPreviewDialog";
import { type AssetScope } from "../../stores/navigation-store";
import { playTaskCompletionSound } from "../../task-completion-sound";
import { type QueryFilterSnapshot, type RendererWindow, type SearchDefinition } from "../shared/app-shared";

export interface AppDialogsProps {
  updateImageSequenceFps: () => Promise<void>;
  createSelectedImageSequence: () => Promise<void>;
  linkedRulesEditor: { folderId: string; name: string; rules: LinkedFolderRule[]; } | null;
  setLinkedRulesEditor: Dispatch<SetStateAction<{ folderId: string; name: string; rules: LinkedFolderRule[]; } | null>>;
  saveLinkedRules: (finalRules: LinkedFolderRule[]) => Promise<void>;
  convertLinkedToManaged: () => Promise<void>;
  restoreTrashedAssets: (payload?: TrashRestoreRequest) => Promise<void>;
  moveManagedAssets: () => Promise<void>;
  folderCoverPicker: { folderIds: string[]; assetId: string; } | null;
  loadFolderCoverPickerPage: (query: string, offset: number) => Promise<{ items: { assetId: string; displayName: string; relativeFilePath: string; thumbnailArtifactId: string | null; previewRevisionId: string; }[]; total: number; }>;
  setFolderCoverPicker: Dispatch<SetStateAction<{ folderIds: string[]; assetId: string; } | null>>;
  applyFolderCoverFromLibrary: (assetId: string) => void;
  beginNewAiProfile: () => void;
  selectAiProfile: (id: string) => void;
  activateAiProfile: (id: string) => Promise<void>;
  removeAiProfile: (id: string) => Promise<void>;
  clearAiProfileCredential: () => Promise<void>;
  commitAiConcurrencyLimit: (value: number) => void;
  commitAiMaxAnalysisImageEdgePx: (value: number) => void;
  commitAiAnalysisSettingsPatch: (patch: Partial<AiAnalysisSettingsWire>) => void;
  probeStoredAiConnection: () => Promise<void>;
  saveAiConfig: () => Promise<void>;
  testAiConnectionFromDialog: () => Promise<{ success: boolean; reason?: string; }>;
  fetchAiModelsFromDialog: () => Promise<{ models: string[]; reason?: string; }>;
  aiUiPrefs: AiUiPreferences;
  imageSequencePrefs: ImageSequencePreferences;
  viewerChromePrefs: ViewerChromePreferences;
  setViewerChromePrefs: (action: SetStateAction<ViewerChromePreferences>) => void;
  shellApi: KeelShellApi | undefined;
  showMissingLinkedPublishRef: RefObject<Promise<void>>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "text" | "image" | "video" | "audio" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  canvasPrefs: CanvasPreferences;
  setCanvasPrefs: (action: SetStateAction<CanvasPreferences>) => void;
  audioPreviewPrefersCover: boolean;
  applyAudioPreviewPreference: (preferCover: boolean) => void;
  bakeImageRotation: boolean;
  applyBakeImageRotation: (bakeIntoFile: boolean) => void;
  setAiUiPrefs: (action: SetStateAction<AiUiPreferences>) => void;
  setImageSequencePrefs: (action: SetStateAction<ImageSequencePreferences>) => void;
  openAppLog: (automationCorrelationId?: string) => void;
  pluginContributionRefreshKey: string;
  api: KeelLibraryApi | undefined;
  t: TranslateFn;
  locale: AppLocale;
  setError: (text: string | null) => void;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  syncRunStartedAtRef: RefObject<number | null>;
  embeddingBound: boolean;
  runLibraryOpenPipeline: (busyState: "creating" | "opening", action: () => Promise<LibraryApiResult<RendererLibrarySummary>>, failureMessage: string, inlineOpeningOperation?: "open-eagle" | "open-billfish", loadingName?: string | null, openOptions?: { selectedLibraryPath?: string | null; skipSwitchConfirm?: boolean; }) => Promise<void>;
  appLogErrorCode: "unauthorized_sender" | "malformed_request" | "log_missing" | "read_failure" | null;
  refreshAppLog: (automationCorrelationId?: string) => Promise<void>;
  revealAppLog: () => void;
  revealRecoveryReport: () => Promise<void>;
  automaticTaskEditorId: string | null | undefined;
  refreshAfterAutomationScript: () => Promise<void>;
  busy: boolean;
  createLibraryPhase: CreateLibraryPhase;
  dialogValue: string;
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  cancelEagleInspectFlow: () => void;
  cancelBillfishInspectFlow: () => void;
  submitEagleLibraryName: () => Promise<void>;
  submitBillfishLibraryName: () => Promise<void>;
  runLibraryOperation: (kind: "create" | "open") => Promise<void>;
  openRecentLibrary: (libraryPath: string) => Promise<void>;
  forgetRecentLibrary: (libraryPath: string) => Promise<void>;
  exportLibrary: (format: "folder" | "zip", includeLinkedContent: boolean) => Promise<void>;
  openEagleLibrary: () => Promise<void>;
  openBillfishLibrary: () => Promise<void>;
  startImport: () => Promise<void>;
  startImportZip: () => Promise<void>;
  importEagleLibrary: () => Promise<void>;
  importBillfishLibrary: () => Promise<void>;
  completeImportCopy: () => Promise<void>;
  completeImportInPlace: () => Promise<void>;
  applyBatchRelink: () => Promise<void>;
  cancelBatchRelink: () => Promise<void>;
  aiConnectionFailureGate: ConnectionFailureGateState;
  onAiConnectionFailureAbort: () => void;
  handleAiConnectionFailureRetry: () => Promise<void>;
  fatalAlertMessage: string | null;
  dismissAlreadyOpenPrompt: () => void;
  confirmAlreadyOpenLibrarySwitch: () => void;
  dismissFatalAlert: () => void;
  openLibraryChooserFromError: () => void;
  criticalConfirmation: { request: CriticalConfirmationPrompt | null; decide: (decision: CriticalConfirmationDecision) => void; };
  embeddingSearchReady: boolean;
  embeddingSelectionId: string | null;
  embeddingService: EmbeddingHttpServiceSummary | null;
  controlMediaJobs: (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>;
  loadMoreMediaJobs: () => Promise<void>;
  controlAiJobs: (action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function AppDialogs({ updateImageSequenceFps, createSelectedImageSequence, linkedRulesEditor, setLinkedRulesEditor, saveLinkedRules, convertLinkedToManaged, restoreTrashedAssets, moveManagedAssets, folderCoverPicker, loadFolderCoverPickerPage, setFolderCoverPicker, applyFolderCoverFromLibrary, beginNewAiProfile, selectAiProfile, activateAiProfile, removeAiProfile, clearAiProfileCredential, commitAiConcurrencyLimit, commitAiMaxAnalysisImageEdgePx, commitAiAnalysisSettingsPatch, probeStoredAiConnection, saveAiConfig, testAiConnectionFromDialog, fetchAiModelsFromDialog, aiUiPrefs, imageSequencePrefs, viewerChromePrefs, setViewerChromePrefs, shellApi, showMissingLinkedPublishRef, loadContent, currentQueryDefinition, canvasPrefs, setCanvasPrefs, audioPreviewPrefersCover, applyAudioPreviewPreference, bakeImageRotation, applyBakeImageRotation, setAiUiPrefs, setImageSequencePrefs, openAppLog, pluginContributionRefreshKey, api, t, locale, setError, setNotice, reloadCurrentContent, syncRunStartedAtRef, embeddingBound, runLibraryOpenPipeline, appLogErrorCode, refreshAppLog, revealAppLog, revealRecoveryReport, automaticTaskEditorId, refreshAfterAutomationScript, busy, createLibraryPhase, dialogValue, setDialogValue, setCreateLibraryPhase, cancelEagleInspectFlow, cancelBillfishInspectFlow, submitEagleLibraryName, submitBillfishLibraryName, runLibraryOperation, openRecentLibrary, forgetRecentLibrary, exportLibrary, openEagleLibrary, openBillfishLibrary, startImport, startImportZip, importEagleLibrary, importBillfishLibrary, completeImportCopy, completeImportInPlace, applyBatchRelink, cancelBatchRelink, aiConnectionFailureGate, onAiConnectionFailureAbort, handleAiConnectionFailureRetry, fatalAlertMessage, dismissAlreadyOpenPrompt, confirmAlreadyOpenLibrarySwitch, dismissFatalAlert, openLibraryChooserFromError, criticalConfirmation, embeddingSearchReady, embeddingSelectionId, embeddingService, controlMediaJobs, loadMoreMediaJobs, controlAiJobs }: AppDialogsProps) {
  const [imageSequenceDialog, setImageSequenceDialog] = useDialogField("imageSequenceDialog");
  const [convertLinkedDialog, setConvertLinkedDialog] = useDialogField("convertLinkedDialog");
  const [folders] = useNavigationField("folders");
  const [restoreDialog, setRestoreDialog] = useDialogField("restoreDialog");
  const [moveDialog, setMoveDialog] = useDialogField("moveDialog");
  const [linkedFolders] = useNavigationField("linkedFolders");
  const [library, setLibrary] = useSessionField("library");
  const [appSettingsOpen, setAppSettingsOpen] = useDialogField("appSettingsOpen");
  const [appSettingsCategory, setAppSettingsCategory] = useDialogField("appSettingsCategory");
  const [aiSaveVerifying] = useAiField("aiSaveVerifying");
  const setAiApiKey = aiFields.setterFor("aiApiKey");
  const [showMissingLinkedFiles, setShowMissingLinkedFiles] = useQueryField("showMissingLinkedFiles");
  const [assetScope] = useNavigationField("assetScope");
  const [showTrash] = useNavigationField("showTrash");
  const [showIgnoredItems] = useQueryField("showIgnoredItems");
  const [librarySettingsOpen, setLibrarySettingsOpen] = useDialogField("librarySettingsOpen");
  const [gitignoreContent, setGitignoreContent] = useDialogField("gitignoreContent");
  const setSyncBindingStatus = transfersFields.setterFor("syncBindingStatus");
  const [syncProgress] = useTransfersField("syncProgress");
  const [embeddingIndex] = useEmbeddingField("embeddingIndex");
  const [openSyncLibraryOpen, setOpenSyncLibraryOpen] = useDialogField("openSyncLibraryOpen");
  const [appLogAutomationCorrelationId, setAppLogAutomationCorrelationId] = useDialogField("appLogAutomationCorrelationId");
  const [appLogEntries] = useDialogField("appLogEntries");
  const [appLogLoading] = useDialogField("appLogLoading");
  const [appLogOpen, setAppLogOpen] = useDialogField("appLogOpen");
  const [libraryRecoveryDialogOpen, setLibraryRecoveryDialogOpen] = useSessionField("libraryRecoveryDialogOpen");
  const [automaticTasksOpen, setAutomaticTasksOpen] = useDialogField("automaticTasksOpen");
  const [scriptSandboxPreviewOpen, setScriptSandboxPreviewOpen] = useDialogField("scriptSandboxPreviewOpen");
  const [aboutOpen, setAboutOpen] = useDialogField("aboutOpen");
  const [openSourceLicensesOpen, setOpenSourceLicensesOpen] = useDialogField("openSourceLicensesOpen");
  const [dialog, setDialog] = useDialogField("dialog");
  const [importLibraryChooserOpen, setImportLibraryChooserOpen] = useTransfersField("importLibraryChooserOpen");
  const [exportDialogOpen, setExportDialogOpen] = useDialogField("exportDialogOpen");
  const [exportProgress] = useTransfersField("exportProgress");
  const [openLibraryChooserOpen, setOpenLibraryChooserOpen] = useDialogField("openLibraryChooserOpen");
  const [importValidated, setImportValidated] = useTransfersField("importValidated");
  const [importProgress] = useTransfersField("importProgress");
  const [batchRelinkPreview] = useTransfersField("batchRelinkPreview");
  const [batchRelinkKeepMetadata, setBatchRelinkKeepMetadata] = useTransfersField("batchRelinkKeepMetadata");
  const [fatalAlertAlreadyOpen] = useDialogField("fatalAlertAlreadyOpen");
  const [fatalDialogTitle] = useDialogField("fatalDialogTitle");
  const [mediaJobsOpen, setMediaJobsOpen] = useDialogField("mediaJobsOpen");
  const [mediaJobs] = useJobsField("mediaJobs");
  const [mediaJobsLoading] = useJobsField("mediaJobsLoading");
  const [aiJobs] = useJobsField("aiJobs");
  const [pluginJobs] = useJobsField("pluginJobs");
  return (
<>
<ImageSequenceDialog
        count={
          imageSequenceDialog?.mode === "update"
            ? imageSequenceDialog.frameCount ?? 0
            : imageSequenceDialog?.assetIds.length ?? 0
        }
        error={imageSequenceDialog?.error}
        fps={imageSequenceDialog?.fps ?? DEFAULT_IMAGE_SEQUENCE_FPS}
        mode={imageSequenceDialog?.mode}
        onCancel={() => setImageSequenceDialog(null)}
        onFpsChange={(fps) =>
          setImageSequenceDialog((current) =>
            current ? { ...current, fps, error: null } : current,
          )
        }
        onSubmit={() =>
          void (
            imageSequenceDialog?.mode === "update"
              ? updateImageSequenceFps()
              : createSelectedImageSequence()
          )
        }
        open={imageSequenceDialog !== null}
        submitting={imageSequenceDialog?.submitting}
      />
      {linkedRulesEditor && (
        <LinkedRulesDialog
          name={linkedRulesEditor.name}
          initialRules={linkedRulesEditor.rules}
          onClose={() => setLinkedRulesEditor(null)}
          onSave={(finalRules) => void saveLinkedRules(finalRules)}
        />
      )}
      {convertLinkedDialog.folderId && (
        <ConvertLinkedDialog
          folderName={convertLinkedDialog.name}
          folders={folders}
          targetFolderId={convertLinkedDialog.targetFolderId}
          onCancel={() =>
            setConvertLinkedDialog({
              folderId: "",
              name: "",
              targetFolderId: "",
            })
          }
          onConfirm={() => void convertLinkedToManaged()}
          onTargetChange={(targetFolderId) =>
            setConvertLinkedDialog((current) => ({
              ...current,
              targetFolderId,
            }))
          }
        />
      )}
      {restoreDialog && (
        <RestoreDialog
          assetIds={restoreDialog.assetIds}
          folders={folders}
          target={restoreDialog.target}
          conflictStrategy={restoreDialog.conflictStrategy}
          onTargetChange={(target) =>
            setRestoreDialog((current) =>
              current ? { ...current, target } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setRestoreDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void restoreTrashedAssets()}
          onCancel={() => setRestoreDialog(null)}
        />
      )}
      {moveDialog && (
        <MoveDialog
          assetIds={moveDialog.assetIds}
          folderIds={moveDialog.folderIds}
          folders={folders}
          linkedFolders={
            moveDialog.assetIds.length > 0 && moveDialog.folderIds.length === 0
              ? (() => {
                  const rootNames = new Map(
                    linkedFolders
                      .filter((folder) => (folder.relativePath ?? "") === "")
                      .map((folder) => [folder.folderId, folder.displayName]),
                  );
                  return linkedFolders.map((folder) => {
                    const rootName =
                      (folder.linkedFolderId
                        ? rootNames.get(folder.linkedFolderId)
                        : undefined) ?? folder.displayName;
                    return {
                      folderId: folder.folderId,
                      name: folder.displayName,
                      relativePath:
                        (folder.relativePath ?? "") === ""
                          ? rootName
                          : `${rootName}/${folder.relativePath}`,
                      assetCount: folder.assetCount,
                    };
                  });
                })()
              : undefined
          }
          targetFolderId={moveDialog.targetFolderId}
          conflictStrategy={moveDialog.conflictStrategy}
          folderOnly={
            moveDialog.folderIds.length > 0 && moveDialog.assetIds.length === 0
          }
          onTargetChange={(folderId) =>
            setMoveDialog((current) =>
              current ? { ...current, targetFolderId: folderId } : current,
            )
          }
          onStrategyChange={(strategy) =>
            setMoveDialog((current) =>
              current ? { ...current, conflictStrategy: strategy } : current,
            )
          }
          onConfirm={() => void moveManagedAssets()}
          onCancel={() => setMoveDialog(null)}
        />
      )}
      <FolderCoverPickerDialog
        open={folderCoverPicker !== null}
        libraryId={library?.libraryId ?? null}
        selectedAssetId={folderCoverPicker?.assetId ?? ""}
        pageSize={FOLDER_COVER_PICKER_PAGE_SIZE}
        loadPage={loadFolderCoverPickerPage}
        onSelect={(assetId) =>
          setFolderCoverPicker((current) =>
            current ? { ...current, assetId } : current,
          )
        }
        onConfirm={applyFolderCoverFromLibrary}
        onCancel={() => setFolderCoverPicker(null)}
      />
      <AppSettingsDialog
        aiConfigPanel={
          <AiConfigDialog
            open={appSettingsOpen && appSettingsCategory === "ai"}
            variant="embedded"
            onNewProfile={beginNewAiProfile}
            onSelectProfile={selectAiProfile}
            onActivateProfile={(id) => void activateAiProfile(id)}
            onDeleteProfile={(id) => void removeAiProfile(id)}
            onClearCredential={() => void clearAiProfileCredential()}
            onConcurrencyLimitChange={commitAiConcurrencyLimit}
            onMaxAnalysisImageEdgePxChange={commitAiMaxAnalysisImageEdgePx}
            onCommitAnalysisSettingsPatch={commitAiAnalysisSettingsPatch}
            onClose={() => {
              if (aiSaveVerifying) return;
              setAiApiKey("");
              // Keep global connection state for heartbeat / context menu
              // (Serpent-rsbt); re-sync from stored credentials after draft edits.
              void probeStoredAiConnection();
            }}
            onSave={() => void saveAiConfig()}
            onTestConnection={testAiConnectionFromDialog}
            onFetchModels={fetchAiModelsFromDialog}
          />
        }
        aiUiPrefs={aiUiPrefs}
        autoDetectImageSequences={imageSequencePrefs.autoDetectOnImport}
        imageSequenceDetectionEnabled={imageSequencePrefs.detectionEnabled}
        navArrowsOnApproach={viewerChromePrefs.navArrowsOnApproach}
        onToggleNavArrowsOnApproach={() => {
          setViewerChromePrefs((current) => ({
            ...current,
            navArrowsOnApproach: !current.navArrowsOnApproach,
          }));
        }}
        onToggleShowMissingLinkedFiles={() => {
          const next = !showMissingLinkedFiles;
          setShowMissingLinkedFiles(next);
          writeShowMissingLinkedFiles(next, globalThis.localStorage);
          const pending = shellApi?.setShowMissingLinkedFiles(next) ?? Promise.resolve();
          showMissingLinkedPublishRef.current = pending;
          void pending.then(() => {
            if (!library) return;
            void loadContent(library, assetScope, {
              trashMode: showTrash,
              discovery: currentQueryDefinition(),
              showIgnored: showIgnoredItems,
            });
          });
        }}
        onToggleVideoTransportOnApproach={() => {
          setViewerChromePrefs((current) => ({
            ...current,
            videoTransportOnApproach: !current.videoTransportOnApproach,
          }));
        }}
        videoTransportOnApproach={viewerChromePrefs.videoTransportOnApproach}
        canvasPrefs={canvasPrefs}
        onClose={() => {
          setAppSettingsOpen(false);
          setAppSettingsCategory("general");
        }}
        onSetViewMode={(mode) => {
          setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
        }}
        onSetCaptionAlign={(align) => {
          setCanvasPrefs((p) => ({ ...p, captionAlign: align }));
        }}
        onToggleField={(field) => {
          setCanvasPrefs((p) => ({
            ...p,
            fields: { ...p.fields, [field]: !p.fields[field] },
          }));
        }}
        onToggleHoverAudioPlay={() => {
          setCanvasPrefs((p) => ({ ...p, hoverAudioPlay: !p.hoverAudioPlay }));
        }}
        onToggleHoverVideoSound={() => {
          setCanvasPrefs((p) => ({ ...p, hoverVideoSound: !p.hoverVideoSound }));
        }}
        audioPreviewPrefersCover={audioPreviewPrefersCover}
        onAudioPreviewPrefersCoverChange={applyAudioPreviewPreference}
        bakeImageRotation={bakeImageRotation}
        onBakeImageRotationChange={applyBakeImageRotation}
        onToggleShowAiBadges={() => {
          setAiUiPrefs((p) => ({ ...p, showAiBadges: !p.showAiBadges }));
        }}
        onToggleAutoDetectImageSequences={() => {
          setImageSequencePrefs((p) => ({
            ...p,
            autoDetectOnImport: !p.autoDetectOnImport,
          }));
        }}
        onToggleImageSequenceDetection={() => {
          setImageSequencePrefs((p) => ({
            ...p,
            detectionEnabled: !p.detectionEnabled,
          }));
        }}
        onOpenAppLog={openAppLog}
        onOpenExtensionReleases={() => {
          void shellApi?.openExternalUrl(
            "https://github.com/dolag233/Serpent-Extension/releases/latest",
          );
        }}
        pluginApi={(window as RendererWindow).keel?.plugins}
        pluginContributionRefreshKey={pluginContributionRefreshKey}
        libraryId={library?.libraryId}
        mcpApi={(window as RendererWindow).keel?.mcp}
        showCardSyncStatus={canvasPrefs.fields.badgeSync}
        onShowCardSyncStatusChange={(checked) => {
          setCanvasPrefs((current) => ({
            ...current,
            fields: { ...current.fields, badgeSync: checked },
          }));
        }}
        embeddingServicesApi={api ?? undefined}
        syncServerCallbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncSaveServer(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncSaveServer(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncDeleteServer(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncDeleteServer(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true };
          },
          async syncProbe(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncProbe(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
      />
      <LibrarySettingsDialog
        key={`${library?.libraryId ?? "none"}:${librarySettingsOpen ? "open" : "closed"}`}
        library={library}
        open={librarySettingsOpen}
        gitignoreContent={gitignoreContent}
        onClose={() => {
          setLibrarySettingsOpen(false);
        }}
        onSaveName={async (name) => {
          if (!api || !library) return;
          const result = await api.rename({ libraryId: library.libraryId, displayName: name });
          if (!result.ok) {
            setError(messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")));
            return;
          }
          setLibrary(result.value);
          setNotice(t("toast.librarySettingsSaved"));
        }}
        onSaveGitignore={async (content) => {
          if (!api || !library) return;
          const result = await api.setGitignore({ libraryId: library.libraryId, content });
          if (!result.ok) {
            setError(messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")));
            return;
          }
          setGitignoreContent(result.value.content);
          setNotice(t("toast.librarySettingsSaved"));
          await reloadCurrentContent();
        }}
        onPreviewGitignore={async (content) => {
          if (!api || !library) return null;
          const result = await api.previewGitignore({ libraryId: library.libraryId, content });
          if (!result.ok) return null;
          return result.value;
        }}
        syncCallbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncProbe(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncProbe(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncPreview(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncPreview(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncRun(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const startedAt = Date.now();
            syncRunStartedAtRef.current = startedAt;
            const result = await api.syncRun(input);
            if (!result.ok) {
              syncRunStartedAtRef.current = null;
              playTaskCompletionSound(startedAt);
              return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            }
            return { ok: true, value: result.value };
          },
          async syncSaveBinding(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncSaveBinding(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            if (input.enabled !== undefined) {
              setSyncBindingStatus(input.enabled ? "enabled" : "disabled");
            }
            return { ok: true };
          },
          async syncGetBinding(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncGetBinding(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
        syncProgress={syncProgress}
        embeddingIndex={embeddingBound ? embeddingIndex : null}
        embeddingCallbacks={{
          async listServices() {
            if (!api) return { ok: false };
            const result = await api.embeddingListServices();
            if (!result.ok || !result.value) return { ok: false };
            return { ok: true, value: result.value };
          },
          async installStatus() {
            if (!api) return { ok: false };
            const result = await api.embeddingInstallStatus();
            if (!result.ok) return { ok: false };
            return { ok: true, value: result.value };
          },
          async getBinding(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingGetBinding(input);
            if (!result.ok) return { ok: false };
            return { ok: true, value: result.value };
          },
          async saveBinding(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingSaveBinding(input);
            if (!result.ok) return { ok: false };
            return { ok: true };
          },
          async rebuildIndex(input) {
            if (!api) return { ok: false };
            const result = await api.embeddingIndexStatus({
              libraryId: input.libraryId, modelId: input.modelId, run: true, restart: false, rebuild: true,
            });
            return result.ok ? { ok: true } : { ok: false };
          },
        }}
      />
      <OpenSyncLibraryDialog
        callbacks={{
          async syncListServers() {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListServers();
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncListRemoteLibraries(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncListRemoteLibraries(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
          async syncOpenRemoteLibrary(input) {
            if (!api) return { ok: false, message: t("common.unavailable") };
            const result = await api.syncOpenRemoteLibrary(input);
            if (!result.ok) return { ok: false, message: messageForPublicError(result.error, locale, t("toast.librarySettingsSaveFailed")) };
            return { ok: true, value: result.value };
          },
        }}
        onClose={() => setOpenSyncLibraryOpen(false)}
        onOpened={(opened) => {
          void (async () => {
            if (!api) return;
            await runLibraryOpenPipeline(
              "opening",
              () => Promise.resolve({ ok: true, value: opened }),
              t("toast.openRecentFailed"),
            );
          })();
        }}
        open={openSyncLibraryOpen}
      />
      <AppLogDialog
        automationCorrelationId={appLogAutomationCorrelationId}
        entries={appLogEntries}
        errorCode={appLogErrorCode}
        loading={appLogLoading}
        onClose={() => setAppLogOpen(false)}
        onAutomationCorrelationIdChange={setAppLogAutomationCorrelationId}
        onRefresh={() => void refreshAppLog()}
        onReveal={revealAppLog}
        open={appLogOpen}
      />
      {library?.recovery && (
        <LibraryRecoveryDialog
          onClose={() => setLibraryRecoveryDialogOpen(false)}
          onRevealReport={() => void revealRecoveryReport()}
          open={libraryRecoveryDialogOpen}
          recovery={library.recovery}
        />
      )}
      {library && <RuleDetailDialog key={library.libraryId} libraryId={library.libraryId} ruleId={automaticTaskEditorId ?? null} open={automaticTasksOpen} onClose={() => setAutomaticTasksOpen(false)} onOpenScripts={() => {setAutomaticTasksOpen(false);setScriptSandboxPreviewOpen(true);}} />}
      <ScriptSandboxPreviewDialog
        automation={(window as RendererWindow).keel?.automation}
        libraryId={library?.libraryId ?? null}
        onClose={() => {
          setScriptSandboxPreviewOpen(false);
        }}
        onExecutionSettled={() => refreshAfterAutomationScript()}
        onOpenExecutionLog={(logId) => {
          setScriptSandboxPreviewOpen(false);
          openAppLog(logId);
        }}
        open={scriptSandboxPreviewOpen}
      />
      <AboutDialog
        open={aboutOpen}
        version={KEEL_VERSION}
        onClose={() => setAboutOpen(false)}
        onOpenGitHub={() => {
          const bridge = (window as RendererWindow).keel?.shell;
          if (!bridge?.openExternalUrl) return;
          void bridge.openExternalUrl("https://github.com/Ubik42/Keel");
        }}
      />
      <OpenSourceLicensesDialog
        open={openSourceLicensesOpen}
        onClose={() => setOpenSourceLicensesOpen(false)}
      />
      <CreateDialog
        busy={busy}
        open={dialog === "library"}
        phase={createLibraryPhase}
        required={!library}
        value={dialogValue}
        onValueChange={setDialogValue}
        onBeginCreate={() => {
          setDialogValue(t("shell.myLibrary"));
          setCreateLibraryPhase("form");
        }}
        onBackToStart={() => {
          if (createLibraryPhase === "eagle") {
            cancelEagleInspectFlow();
            if (library) setDialog(null);
            return;
          }
          if (createLibraryPhase === "billfish") {
            cancelBillfishInspectFlow();
            if (library) setDialog(null);
            return;
          }
          if (library) {
            setDialog(null);
            return;
          }
          setCreateLibraryPhase("start");
        }}
        onSubmit={() => {
          if (createLibraryPhase === "eagle") {
            void submitEagleLibraryName();
            return;
          }
          if (createLibraryPhase === "billfish") {
            void submitBillfishLibraryName();
            return;
          }
          setDialog(null);
          void runLibraryOperation("create");
        }}
        onCancel={() => {
          if (createLibraryPhase === "eagle") {
            cancelEagleInspectFlow();
          }
          if (createLibraryPhase === "billfish") {
            cancelBillfishInspectFlow();
          }
          setDialog(null);
          setCreateLibraryPhase("start");
        }}
        onOpenExisting={() => {
          // Keep the required no-library surface mounted while the native
          // picker is open. This avoids the auto-open effect racing a cancel
          // and makes the action visibly await the selected library. When a
          // library is already open, the menu dialog can close immediately.
          if (library) setDialog(null);
          void runLibraryOperation("open");
        }}
        onImportLibrary={() => {
          setDialog(null);
          setImportLibraryChooserOpen(true);
        }}
        onOpenRecent={(path) => {
          setDialog(null);
          void openRecentLibrary(path);
        }}
        onForgetRecent={(path) => {
          void forgetRecentLibrary(path);
        }}
      />
      {exportDialogOpen && (
        <ExportDialog
          open={exportDialogOpen}
          exporting={
            exportProgress !== null &&
            !["complete", "cancelled", "failed"].includes(exportProgress.phase)
          }
          onClose={() => setExportDialogOpen(false)}
          onExportFolder={(includeLinked) =>
            void exportLibrary("folder", includeLinked)
          }
          onExportZip={(includeLinked) =>
            void exportLibrary("zip", includeLinked)
          }
        />
      )}
      <OpenLibraryChooserDialog
        open={openLibraryChooserOpen}
        onCancel={() => setOpenLibraryChooserOpen(false)}
        onOpenKeel={() => {
          setOpenLibraryChooserOpen(false);
          if (library) setDialog(null);
          void runLibraryOperation("open");
        }}
        onOpenSyncLibrary={() => {
          setOpenLibraryChooserOpen(false);
          setAppSettingsOpen(false);
          setOpenSyncLibraryOpen(true);
        }}
        onOpenEagle={() => {
          setOpenLibraryChooserOpen(false);
          void openEagleLibrary();
        }}
        onOpenBillfish={() => {
          setOpenLibraryChooserOpen(false);
          void openBillfishLibrary();
        }}
      />
      <ImportLibraryChooserDialog
        open={importLibraryChooserOpen}
        externalKind={library ? "import" : "open"}
        onCancel={() => setImportLibraryChooserOpen(false)}
        onImportFolder={() => {
          setImportLibraryChooserOpen(false);
          void startImport();
        }}
        onImportZip={() => {
          setImportLibraryChooserOpen(false);
          void startImportZip();
        }}
        onOpenEagle={() => {
          setImportLibraryChooserOpen(false);
          void openEagleLibrary();
        }}
        onImportEagle={() => {
          setImportLibraryChooserOpen(false);
          void importEagleLibrary();
        }}
        onOpenBillfish={() => {
          setImportLibraryChooserOpen(false);
          void openBillfishLibrary();
        }}
        onImportBillfish={() => {
          setImportLibraryChooserOpen(false);
          void importBillfishLibrary();
        }}
      />
      {importValidated && (
        <ImportDialog
          open
          validated={importValidated}
          importing={
            importProgress !== null &&
            !["complete", "cancelled", "failed"].includes(importProgress.phase)
          }
          onClose={() => setImportValidated(null)}
          onImportCopy={() => void completeImportCopy()}
          onImportOpenInPlace={() => void completeImportInPlace()}
          onImportZip={() => {
            setImportValidated(null);
            void startImportZip();
          }}
        />
      )}
      <RelinkPreview
        session={batchRelinkPreview}
        keepMetadata={batchRelinkKeepMetadata}
        onKeepMetadataChange={setBatchRelinkKeepMetadata}
        onApply={() => void applyBatchRelink()}
        onCancel={() => void cancelBatchRelink()}
      />
      <AiConnectionFailureDialog
        failedCount={aiConnectionFailureGate.failedJobIds.length}
        failureCode={aiConnectionFailureGate.failureCode}
        onAbort={onAiConnectionFailureAbort}
        onRetry={handleAiConnectionFailureRetry}
        open={aiConnectionFailureGate.open}
      />
      <FatalAlertDialog
        cancelLabel={fatalAlertAlreadyOpen ? t("common.cancel") : null}
        confirmLabel={fatalAlertAlreadyOpen ? t("common.confirm") : null}
        message={fatalAlertMessage}
        title={fatalDialogTitle}
        onCancel={fatalAlertAlreadyOpen ? dismissAlreadyOpenPrompt : undefined}
        onConfirm={fatalAlertAlreadyOpen ? confirmAlreadyOpenLibrarySwitch : undefined}
        onDismiss={fatalAlertAlreadyOpen ? dismissAlreadyOpenPrompt : dismissFatalAlert}
        onSwitchLibrary={fatalAlertAlreadyOpen ? undefined : openLibraryChooserFromError}
      />
      <CriticalConfirmationDialog
        onDecide={criticalConfirmation.decide}
        request={criticalConfirmation.request}
      />
      <MediaJobsDialog
        open={mediaJobsOpen && library !== null}
        mediaJobs={mediaJobs}
        mediaJobsLoading={mediaJobsLoading}
        aiJobs={aiJobs}
        embeddingIndex={embeddingSearchReady && embeddingSelectionId ? { modelId: embeddingSelectionId, snapshot: embeddingIndex, modalities: embeddingService?.modalities } : null}
        pluginJobs={pluginJobs}
        onClose={() => setMediaJobsOpen(false)}
        onControlMediaJobs={(action, jobIds) => void controlMediaJobs(action, jobIds)}
        onLoadMoreMediaJobs={() => void loadMoreMediaJobs()}
        onControlAiJobs={(action, jobIds) => void controlAiJobs(action, jobIds)}
        onRevealAppLog={revealAppLog}
        onViewAppLog={openAppLog}
      />
</>
  );
}
