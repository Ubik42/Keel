import type { AssetContextMenuActions } from "../AssetContextMenu";
import { useStableCallbacks } from "./use-stable-callbacks";
import { useAiField } from "../stores/ai-store";
import { dialogsFields } from "../stores/dialogs-store";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MenuSkipScopeOptions } from "../menu-skip-report";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { LinkedFolderSummary } from "../../shared/asset-types";
import type { FolderDiskDeleteTarget } from "../use-folder-delete-actions";
import type { EntityAppearance, EntityAppearanceTarget } from "../../shared/entity-appearance";
import type { EmbeddingHttpServiceSummary } from "../../shared/library-api";
import type { BrowsePasteDestination } from "../browse-paste-target";
import { type AssetSummary } from "../../shared/asset-types";
import { isLibraryRootFolderId } from "../../shared/library-root-folder";
import { linkedRevealFolderId } from "../../shared/linked-folder-tree";
import { aiAnalyzeConnectionReady, aiAnalyzeShowsDisconnectGlyph } from "../ai-connection-heartbeat";
import { AssetContextMenu , AssetContextMenuActionsProvider } from "../AssetContextMenu";
import { type FolderTreeExpandActions } from "../NavigationSidebar";
import { type WorkspaceNavigationRequest } from "./app-shared";

export interface AppAssetContextMenuProps {
  busy: boolean;
  pluginBrowseScope: Partial<{ folderId?: string | undefined; tagId?: string | undefined; search?: string | undefined; filter?: string | undefined; }>;
  pluginViewerState: Partial<{ active: boolean; fullscreen: boolean; assetId?: string | undefined; extension?: string | undefined; mimeType?: string | undefined; mediaKind?: string | undefined; }>;
  pluginContributionRefreshKey: string;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  menuSkipScope: MenuSkipScopeOptions;
  closeWorkspaceTab: (tabId: string) => Promise<void>;
  closeOtherWorkspaceTabs: (tabId: string) => Promise<void>;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceTabRevealTarget: Dispatch<SetStateAction<{ kind: "folder"; id: string; requestId: number; } | null>>;
  workspaceTabRevealRequestRef: RefObject<number>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  setError: (text: string | null) => void;
  openInlineFolderCreate: (parentFolderId: string | null) => void;
  folderTreeActionsRef: RefObject<FolderTreeExpandActions | null>;
  importFolderAsLinked: (parentFolderId?: string | null) => Promise<void>;
  setIgnoreState: (input: { locationKind: "managed" | "linked"; linkedFolderId?: string | null; relativePath: string; pathKind: "asset" | "folder" | "extension"; ignored: boolean; name: string; }) => Promise<void>;
  openInlineFolderRename: (folderId: string, currentName: string) => void;
  handleOpenFolderInFileManager: (folderId: string) => Promise<void>;
  handleCopyFolderPath: (folderId: string) => Promise<void>;
  handleCopyFolder: (folderId: string) => Promise<void>;
  dispatchClipboardPaste: (destination: string | null) => void;
  cloneFolder: (folderId: string) => Promise<void>;
  openLinkedRules: (folder: LinkedFolderSummary) => Promise<void>;
  requestTrashManagedFolder: (folderId: string, name: string) => void;
  openDiskDelete: (target: FolderDiskDeleteTarget) => void;
  removeLinkedFolder: (folderId: string, name: string) => Promise<void>;
  setEntityAppearance: (target: EntityAppearanceTarget, appearance: EntityAppearance | null) => void;
  chooseFolderCover: (folderIds: readonly string[]) => void;
  openFolderCoverLibraryPicker: (folderIds: readonly string[]) => void;
  clearFolderCover: (folderIds: readonly string[]) => void;
  useAssetAsFolderCover: (assetId: string, folderId: string) => void;
  batchAssignTagToSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  batchRemoveTagFromSelection: (tagId: string, assetIds: string[]) => Promise<void>;
  trashMixedSelection: (assetIds: string[], folderIds?: readonly string[]) => Promise<void>;
  requestSelectionDiskDelete: (assetIds: string[], folderIds: readonly string[]) => void;
  requestRestoreTrashedAssets: (assetIds: string[]) => Promise<void>;
  deletePermanentFromTrash: (assetIds: string[]) => Promise<boolean>;
  relinkMissingAsset: (assetId?: string | undefined) => Promise<void>;
  handleAnalyzeClick: (assetId?: string | undefined, batchIds?: readonly string[]) => Promise<void>;
  handleClearAiContent: (assetIds: string[]) => Promise<void>;
  copyManagedSelectionToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => Promise<void>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  handleOpenExternal: (assetId: string) => Promise<void>;
  openWithSettings: { version: 1; programs: { programId: string; name: string; executablePath: string; }[]; defaults: Record<string, { kind: "viewer"; } | { kind: "system"; } | { kind: "program"; programId: string; }>; };
  openAssetWithProgram: (assetId: string, programId?: string) => Promise<void>;
  openAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  persistAssetColorSpace: (assetId: string, colorSpace: string | null) => Promise<void>;
  openCreateImageSequenceDialog: (assetIds: readonly string[]) => Promise<void>;
  dissolveSelectedImageSequence: (sequenceId: string) => Promise<void>;
  dissolveSelectedImageSequences: (sequenceIds: string[]) => Promise<void>;
  handleRevealInFolder: (assetId: string) => Promise<void>;
  showAssetInContainingFolder: (assetId: string) => Promise<void>;
  embeddingBound: boolean;
  embeddingSelectionId: string | null;
  embeddingService: EmbeddingHttpServiceSummary | null;
  runFindSimilar: (assetId: string, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  handleCopyFilePath: (assetId: string) => Promise<void>;
  handleCopyAssetFiles: (assetIds: string[]) => Promise<void>;
  browsePasteDestination: BrowsePasteDestination;
  openAssetRename: (assetId: string) => void;
  assignAssetToTag: (assetId: string, tagId: string) => Promise<void>;
  restoreTrashedManagedFolder: (tombstoneId: string, name: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function AppAssetContextMenu({ busy, pluginBrowseScope, pluginViewerState, pluginContributionRefreshKey, visibleAssets, menuSkipScope, closeWorkspaceTab, closeOtherWorkspaceTabs, setLeftOpen, setWorkspaceTabRevealTarget, workspaceTabRevealRequestRef, setNotice, t, setError, openInlineFolderCreate, folderTreeActionsRef, importFolderAsLinked, setIgnoreState, openInlineFolderRename, handleOpenFolderInFileManager, handleCopyFolderPath, handleCopyFolder, dispatchClipboardPaste, cloneFolder, openLinkedRules, requestTrashManagedFolder, openDiskDelete, removeLinkedFolder, setEntityAppearance, chooseFolderCover, openFolderCoverLibraryPicker, clearFolderCover, useAssetAsFolderCover, batchAssignTagToSelection, batchRemoveTagFromSelection, trashMixedSelection, requestSelectionDiskDelete, requestRestoreTrashedAssets, deletePermanentFromTrash, relinkMissingAsset, handleAnalyzeClick, handleClearAiContent, copyManagedSelectionToLinked, clearAssetSelection, handleOpenExternal, openWithSettings, openAssetWithProgram, openAssetPreview, persistAssetColorSpace, openCreateImageSequenceDialog, dissolveSelectedImageSequence, dissolveSelectedImageSequences, handleRevealInFolder, showAssetInContainingFolder, embeddingBound, embeddingSelectionId, embeddingService, runFindSimilar, handleCopyFilePath, handleCopyAssetFiles, browsePasteDestination, openAssetRename, assignAssetToTag, restoreTrashedManagedFolder, emptyTrash }: AppAssetContextMenuProps) {
  const setMoveDialog = dialogsFields.setterFor("moveDialog");
  const [aiHasKey] = useAiField("aiHasKey");
  const [aiConnectionState] = useAiField("aiConnectionState");
  const [aiAnalyzing] = useAiField("aiAnalyzing");
  const setImageSequenceDialog = dialogsFields.setterFor("imageSequenceDialog");
  const assetContextMenuActions = useStableCallbacks<AssetContextMenuActions>({
        onCloseWorkspaceTab: (tabId) => void closeWorkspaceTab(tabId),
        onCloseOtherWorkspaceTabs: (tabId) =>
          void closeOtherWorkspaceTabs(tabId),
        onRevealWorkspaceTabEntity: (entity) => {
          setLeftOpen(true);
          setWorkspaceTabRevealTarget({
            ...entity,
            requestId: ++workspaceTabRevealRequestRef.current,
          });
        },
        onCopyWorkspaceTabName: (name) => {
          void navigator.clipboard.writeText(name).then(
            () => setNotice(t("tabs.copyNameDone")),
            () => setError(t("tabs.copyNameFailed")),
          );
        },
        onCreateSubfolder: (folderId) => {
          openInlineFolderCreate(isLibraryRootFolderId(folderId) ? null : folderId);
        },
        onExpandFolderTree: (folderId) => {
          folderTreeActionsRef.current?.expandSubtree(folderId);
        },
        onCollapseFolderTree: (folderId) => {
          folderTreeActionsRef.current?.collapseSubtree(folderId);
        },
        onImportLinkedFolderInto: (folderId) => {
          // Serpent-316493: 导入链接文件夹 under the right-clicked folder (or at
          // the library root when the folder panel's blank area was clicked).
          void importFolderAsLinked(
            isLibraryRootFolderId(folderId) ? null : folderId,
          );
        },
        onSetIgnore: ({ locationKind, linkedFolderId, relativePath, pathKind, ignored, name }) => {
          void setIgnoreState({ locationKind, linkedFolderId, relativePath, pathKind, ignored, name });
        },
        onRenameFolder: (folderId, currentName) => {
          openInlineFolderRename(folderId, currentName);
        },
        onOpenFolderInFileManager: (folderId) => {
          void handleOpenFolderInFileManager(folderId);
        },
        onCopyFolderPath: (folderId) => {
          void handleCopyFolderPath(folderId);
        },
        onCopyFolder: (folderId) => {
          void handleCopyFolder(folderId);
        },
        onPasteIntoFolder: (folderId) => {
          // Serpent-316493 follow-up: the root sentinel means "the library
          // root", which paste/import APIs express as null.
          dispatchClipboardPaste(isLibraryRootFolderId(folderId) ? null : folderId);
        },
        onCloneFolder: (folderId) => {
          void cloneFolder(folderId);
        },
        onMoveFolder: (folderIds) =>
          setMoveDialog({
            assetIds: [],
            folderIds: [...folderIds],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          }),
        onOpenLinkedRules: (folder) => void openLinkedRules(folder),
        onTrashManagedFolder: (folderId, name) => {
          requestTrashManagedFolder(folderId, name);
        },
        onDeleteFolderFromDisk: ({ folderId, name, locationKind, linkedRelativePath }) => {
          if (locationKind === "managed") {
            openDiskDelete({ kind: "managed", folderId, name });
            return;
          }
          if (linkedRelativePath) {
            openDiskDelete({
              kind: "linked-child",
              folderId: linkedRevealFolderId(folderId, linkedRelativePath),
              linkedFolderId: folderId,
              relativePath: linkedRelativePath,
              name,
            });
          } else {
            openDiskDelete({
              kind: "linked-child",
              folderId,
              linkedFolderId: folderId,
              relativePath: "",
              name,
            });
          }
        },
        onRemoveLinkedFolder: (folderId, name) => {
          void removeLinkedFolder(folderId, name);
        },
        onSetEntityAppearance: setEntityAppearance,
        onChooseFolderCover: chooseFolderCover,
        onChooseFolderCoverFromLibrary: openFolderCoverLibraryPicker,
        onClearFolderCover: clearFolderCover,
        onUseAssetAsFolderCover: useAssetAsFolderCover,
        onBatchAssignTag: (tagId, assetIds) => {
          void batchAssignTagToSelection(tagId, assetIds);
        },
        onBatchRemoveTag: (tagId, assetIds) => {
          void batchRemoveTagFromSelection(tagId, assetIds);
        },
        onMoveToFolder: (assetIds, folderIds) =>
          setMoveDialog({
            assetIds: [...assetIds],
            folderIds: [...(folderIds ?? [])],
            targetFolderId: null,
            conflictStrategy: "keep-both",
          }),
        onTrash: (assetIds, folderIds) => {
          void trashMixedSelection(assetIds, folderIds ?? []);
        },
        onDeleteFromDisk: (assetIds, folderIds) => {
          requestSelectionDiskDelete(assetIds, folderIds ?? []);
        },
        onRestore: (assetIds) => {
          void requestRestoreTrashedAssets(assetIds);
        },
        onPermanentDelete: (assetIds) => {
          void deletePermanentFromTrash(assetIds);
        },
        onRelink: (assetId) => { void relinkMissingAsset(assetId); },
        onAnalyze: (assetId, batchIds) => {
          void handleAnalyzeClick(assetId, batchIds);
        },
        onClearAiContent: (assetIds) => { void handleClearAiContent(assetIds); },
        onCopyToLinked: (folder, assetIds) => { void copyManagedSelectionToLinked(folder, assetIds); },
        onClearSelection: clearAssetSelection,
        onOpenExternal: (assetId) => { void handleOpenExternal(assetId); },
        onOpenWithProgram: (assetId, programId) => { void openAssetWithProgram(assetId, programId); },
        onOpenWithPicker: (assetId) => { void openAssetWithProgram(assetId); },
        onViewAsset: (assetId) => {
          const asset = visibleAssets.find((item) => item.assetId === assetId);
          if (asset) openAssetPreview(asset);
        },
        onSetAssetColorSpace: (assetId, colorSpace) => {
          void persistAssetColorSpace(assetId, colorSpace);
        },
        onCreateImageSequence: (assetIds) => {
          void openCreateImageSequenceDialog(assetIds);
        },
        onSetImageSequenceFps: (sequenceId, frameCount, fps) => {
          setImageSequenceDialog({
            assetIds: [],
            mode: "update",
            sequenceId,
            frameCount,
            fps,
            submitting: false,
            error: null,
          });
        },
        onDissolveImageSequence: (sequenceId) => {
          void dissolveSelectedImageSequence(sequenceId);
        },
        onDissolveImageSequences: (sequenceIds) => {
          void dissolveSelectedImageSequences(sequenceIds);
        },
        onRevealInFolder: (assetId) => { void handleRevealInFolder(assetId); },
        onShowInLibraryFolder: (assetId) => {
          void showAssetInContainingFolder(assetId);
        },
        onFindSimilar: (assetId) => {
          void runFindSimilar(assetId);
        },
        onCopyFilePath: (assetId) => { void handleCopyFilePath(assetId); },
        onCopyAssetFiles: (assetIds) => {
          void handleCopyAssetFiles(assetIds);
        },
        onRenameAssetFile: (assetId) => { openAssetRename(assetId); },
        onAssignTag: (assetId, tagId) => { void assignAssetToTag(assetId, tagId); },
        onRestoreTrashedFolder: (tombstoneId, name) => {
          void restoreTrashedManagedFolder(tombstoneId, name);
        },
        onEmptyTrash: () => {
          void emptyTrash();
        },
        pluginBrowseScope,
  pluginViewerState,
  pluginContributionRefreshKey,
  menuSkipScope,
  openWithPrograms: openWithSettings.programs,
  semanticSearchEnabled: embeddingBound,
  embeddingSelectionId,
  embeddingAdapter: embeddingService?.adapter ?? null,
  embeddingModalities: embeddingService?.modalities ?? null,
});
  return (
<>
{/* Unified context menu */}
      <AssetContextMenuActionsProvider value={assetContextMenuActions}>
      <AssetContextMenu
        busy={busy}
        assets={visibleAssets}
        canAnalyze={
          aiAnalyzeConnectionReady(aiHasKey, aiConnectionState) && !aiAnalyzing
        }
        aiDisconnected={aiAnalyzeShowsDisconnectGlyph(
          aiHasKey,
          aiConnectionState,
        )}
        pasteTargetFolderId={browsePasteDestination}
      />
      </AssetContextMenuActionsProvider>
</>
  );
}
