import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { HistoryEntrySummary } from "../../../shared/protocol/responses";
import type { AppLocale } from "../../i18n/types";
import type { BrowsePasteDestination } from "../../browse-paste-target";
import type { KeelShellApi } from "../../../shared/external-url";
import type { FilteredFolderCounts } from "../../use-filtered-folder-counts";
import { type SearchScope, type SortDefinition } from "../../../shared/asset-types";
import { isEditableTextTarget } from "../../../shared/edit-context-menu";
import { type RendererLibrarySummary } from "../../../shared/protocol/responses";
import { cancellationAffectsAiBatch, type AiProgressJobUpdate } from "../../ai-analyze-progress";
import { type CreateLibraryPhase } from "../../CreateDialog";
import { toMessage } from "../../error-utils";
import { filteredFolderBrowseEntries } from "../../filtered-folder-visibility";
import { dispatchGlobalZoomMenuAction, dispatchGlobalZoomMenuCommandIfAllowed } from "../../global-zoom-shortcuts";
import { writeShowMissingLinkedFiles } from "../../linked-missing-preference";
import { buildMainMenuSections, collectMainMenuCommandStates, type MainMenuItem } from "../../main-menu-items";
import { type AiState } from "../../stores/ai-store";
import { type BrowseState } from "../../stores/browse-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type TransfersState } from "../../stores/transfers-store";
import { hasActiveModalDialog } from "../../workbench/overlay/use-dialog-focus-trap";
import { listenForMouseShortcutInputs, matchesRuntimeShortcut } from "../../workbench/shortcuts/shortcut-runtime";
import { IS_WINDOWS_PLATFORM, SHORTCUT_PLATFORM, type QueryFilterSnapshot, type SearchDefinition } from "../shared/app-shared";
import { useEffect, useRef } from "react";

export interface UseJobControlsAndMenuDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
  aiBatchJobIdsRef: RefObject<string[]>;
  aiBatchSkippedCountRef: RefObject<number>;
  aiBatchKnownJobsRef: RefObject<AiProgressJobUpdate[]>;
  lastAiBatchJobIdsRef: RefObject<string[]>;
  lastAiBatchAssetIdRef: RefObject<string | null>;
  aiBatchStatusRequestRef: RefObject<number>;
  analyzingAssetIdRef: RefObject<string | null>;
  analyzingBatchSizeRef: RefObject<number>;
  setAiAnalyzing: Dispatch<SetStateAction<AiState["aiAnalyzing"]>>;
  setAiBatchProgress: Dispatch<SetStateAction<AiState["aiBatchProgress"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  refreshAiBatchStatus: () => Promise<void>;
  loadAiJobs: (quiet?: boolean) => Promise<void>;
  controlAiJobsRef: RefObject<(action: "pause" | "resume" | "cancel" | "retry", jobIds?: string[]) => Promise<void>>;
  busy: boolean;
  editableTextFocused: boolean;
  operationHistory: SessionState["operationHistory"];
  selectedAssetIds: SelectionState["selectedAssetIds"];
  browsePasteDestination: BrowsePasteDestination;
  browseScopeAssetIds: string[];
  showMissingLinkedFiles: QueryState["showMissingLinkedFiles"];
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  setDialog: Dispatch<SetStateAction<DialogsState["dialog"]>>;
  setImportLibraryChooserOpen: Dispatch<SetStateAction<TransfersState["importLibraryChooserOpen"]>>;
  setOpenLibraryChooserOpen: Dispatch<SetStateAction<DialogsState["openLibraryChooserOpen"]>>;
  closeLibrary: () => Promise<void>;
  removeLibrary: () => Promise<void>;
  requestDeleteLibraryFromDisk: () => void;
  importAssets: (kind: "files" | "folder") => Promise<void>;
  importFolderAsLinked: (parentFolderId?: string | null) => Promise<void>;
  pasteClipboardImage: (options?: { targetFolderId?: string; onNoClipboardImage?: () => void | Promise<void>; }) => Promise<void>;
  setExportDialogOpen: Dispatch<SetStateAction<DialogsState["exportDialogOpen"]>>;
  setAppSettingsOpen: Dispatch<SetStateAction<DialogsState["appSettingsOpen"]>>;
  setLibrarySettingsOpen: Dispatch<SetStateAction<DialogsState["librarySettingsOpen"]>>;
  setShowMissingLinkedFiles: Dispatch<SetStateAction<QueryState["showMissingLinkedFiles"]>>;
  shellApi: KeelShellApi | undefined;
  showMissingLinkedPublishRef: RefObject<Promise<void>>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  assetScope: NavigationState["assetScope"];
  showTrash: NavigationState["showTrash"];
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  showIgnoredItems: QueryState["showIgnoredItems"];
  undoLastFileOp: (expectedHistoryEntryId?: string) => Promise<void>;
  redoLastOperation: () => Promise<void>;
  selectedAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  handleCopyAssetFiles: (assetIds: string[]) => Promise<void>;
  dispatchClipboardPaste: (destination: string | null) => void;
  selectAllBrowseScope: () => Promise<void>;
  invertBrowseScope: () => Promise<void>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  setAppSettingsCategory: Dispatch<SetStateAction<DialogsState["appSettingsCategory"]>>;
  openMediaJobs: () => void;
  openAppLog: (automationCorrelationId?: string) => void;
  openAbout: () => void;
  setOpenSourceLicensesOpen: Dispatch<SetStateAction<DialogsState["openSourceLicensesOpen"]>>;
  revealAppLog: () => void;
  openRecentLibrary: (libraryPath: string) => Promise<void>;
  dialogFocusTrapActive: boolean;
  searchValue: QueryState["searchValue"];
  searchFolderResults: { folderId: string; parentFolderId: string | null; locationKind: "managed" | "linked"; name: string; relativePath: string; status: "available" | "offline"; directAssetCount: number; recursiveAssetCount: number; childFolderCount: number; coverArtifactIds: string[]; coverAssetIds: string[]; hasCustomCover?: boolean | undefined; customCoverToken?: string | undefined; customCoverAssetId?: string | undefined; customCoverArtifactId?: string | undefined; customCoverSourcePreview?: { assetId: string; revisionId: string; } | undefined; coverSourcePreviews?: { assetId: string; revisionId: string; }[] | undefined; linkedFolderId?: string | null | undefined; }[];
  searchFolderRealKey: BrowseState["searchFolderRealKey"];
  searchFolderMatchKey: string | null;
  searchFolderRealEntries: BrowseState["searchFolderRealEntries"];
  filteredFolderCounts: FilteredFolderCounts | null;
  canvasFolderBrowseEntries: { folderId: string; parentFolderId: string | null; locationKind: "managed" | "linked"; name: string; relativePath: string; status: "available" | "offline"; directAssetCount: number; recursiveAssetCount: number; childFolderCount: number; coverArtifactIds: string[]; coverAssetIds: string[]; hasCustomCover?: boolean | undefined; customCoverToken?: string | undefined; customCoverAssetId?: string | undefined; customCoverArtifactId?: string | undefined; customCoverSourcePreview?: { assetId: string; revisionId: string; } | undefined; coverSourcePreviews?: { assetId: string; revisionId: string; }[] | undefined; linkedFolderId?: string | null | undefined; }[];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useJobControlsAndMenu({ api, library, setError, t, locale, aiBatchJobIdsRef, aiBatchSkippedCountRef, aiBatchKnownJobsRef, lastAiBatchJobIdsRef, lastAiBatchAssetIdRef, aiBatchStatusRequestRef, analyzingAssetIdRef, analyzingBatchSizeRef, setAiAnalyzing, setAiBatchProgress, setNotice, refreshAiBatchStatus, loadAiJobs, controlAiJobsRef, busy, editableTextFocused, operationHistory, selectedAssetIds, browsePasteDestination, browseScopeAssetIds, showMissingLinkedFiles, setDialogValue, setCreateLibraryPhase, setDialog, setImportLibraryChooserOpen, setOpenLibraryChooserOpen, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, importAssets, importFolderAsLinked, pasteClipboardImage, setExportDialogOpen, setAppSettingsOpen, setLibrarySettingsOpen, setShowMissingLinkedFiles, shellApi, showMissingLinkedPublishRef, loadContent, assetScope, showTrash, currentQueryDefinition, showIgnoredItems, undoLastFileOp, redoLastOperation, selectedAssets, handleCopyAssetFiles, dispatchClipboardPaste, selectAllBrowseScope, invertBrowseScope, clearAssetSelection, setAppSettingsCategory, openMediaJobs, openAppLog, openAbout, setOpenSourceLicensesOpen, revealAppLog, openRecentLibrary, dialogFocusTrapActive, searchValue, searchFolderResults, searchFolderRealKey, searchFolderMatchKey, searchFolderRealEntries, filteredFolderCounts, canvasFolderBrowseEntries }: UseJobControlsAndMenuDeps) {

  async function controlAiJobs(
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) {
    if (!api || !library) return;
    try {
      const result =
        action === "pause"
          ? await api.pauseAiJobs({ libraryId: library.libraryId, jobIds })
          : action === "resume"
            ? await api.resumeAiJobs({ libraryId: library.libraryId, jobIds })
            : action === "cancel"
              ? await api.cancelAiJobs({ libraryId: library.libraryId, jobIds })
              : await api.retryAiJobs({
                  libraryId: library.libraryId,
                  jobIds: jobIds ?? [],
                });
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.aiJobsOpFailed"), locale));
        return;
      }
      if (action === "cancel") {
        const activeJobIds = aiBatchJobIdsRef.current;
        const affectsActiveBatch = cancellationAffectsAiBatch(activeJobIds, jobIds);
        if (!jobIds) {
          // The workspace Stop control cancels the whole queue, including the
          // active batch. A panel action with explicit ids must not erase
          // unrelated or partially cancelled batch tracking.
          aiBatchJobIdsRef.current = [];
          aiBatchSkippedCountRef.current = 0;
          aiBatchKnownJobsRef.current = [];
          lastAiBatchJobIdsRef.current = [];
          lastAiBatchAssetIdRef.current = null;
          aiBatchStatusRequestRef.current++;
          analyzingAssetIdRef.current = null;
          analyzingBatchSizeRef.current = 0;
          setAiAnalyzing(false);
          setAiBatchProgress(null);
          setNotice(t("toast.aiAnalyzeStopped"));
        } else if (affectsActiveBatch) {
          // Keep the full ID set: the next status refresh records cancelled
          // jobs alongside any remaining success/failure outcomes.
          void refreshAiBatchStatus();
        }
      }
      await loadAiJobs(true);
    } catch {
      setError(t("toast.aiJobsOpNoResponse"));
    }
  }
  controlAiJobsRef.current = controlAiJobs;

  const mainMenuSections = buildMainMenuSections({
    locale,
    platform: SHORTCUT_PLATFORM,
    state: {
      libraryOpen: Boolean(library),
      busy,
      hasUndoableOperation: editableTextFocused
        || (operationHistory?.undoTop !== null && operationHistory?.undoTop !== undefined),
      hasRedoableOperation: editableTextFocused
        || (operationHistory?.redoTop !== null && operationHistory?.redoTop !== undefined),
      undoLabel: historyMenuLabel(operationHistory?.undoTop, "undo", t),
      redoLabel: historyMenuLabel(operationHistory?.redoTop, "redo", t),
      hasSelectedAssets: selectedAssetIds.length > 0,
      hasPasteTarget: browsePasteDestination !== undefined,
      hasBrowseAssets: browseScopeAssetIds.length > 0,
      showMissingLinkedFiles,
    },
    actions: {
      createLibrary: () => {
        setDialogValue(t("shell.myLibrary"));
        setCreateLibraryPhase("form");
        setDialog("library");
      },
      openLibrary: () => {
        setImportLibraryChooserOpen(false);
        setOpenLibraryChooserOpen(true);
      },
      closeLibrary: () => void closeLibrary(),
      removeLibrary: () => void removeLibrary(),
      deleteLibraryFromDisk: requestDeleteLibraryFromDisk,
      importFiles: () => void importAssets("files"),
      importFolder: () => void importAssets("folder"),
      importLinkedFolder: () => void importFolderAsLinked(),
      pasteImage: () => void pasteClipboardImage(),
      importLibrary: () => {
        setOpenLibraryChooserOpen(false);
        setImportLibraryChooserOpen(true);
      },
      exportLibrary: () => setExportDialogOpen(true),
      openLibrarySettings: () => {
        setAppSettingsOpen(false);
        setLibrarySettingsOpen(true);
      },
      toggleShowMissingLinkedFiles: () => {
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
      },
      undo: () => void undoLastFileOp(),
      redo: () => void redoLastOperation(),
      copySelection: () => {
        const copyIds = selectedAssets
          .filter((asset) => asset.availability === "available" && !asset.deletedAt)
          .map((asset) => asset.assetId);
        if (copyIds.length > 0) void handleCopyAssetFiles(copyIds);
      },
      paste: () => {
        if (browsePasteDestination !== undefined) {
          dispatchClipboardPaste(browsePasteDestination);
        }
      },
      selectAll: () => void selectAllBrowseScope(),
      invertSelection: () => void invertBrowseScope(),
      clearSelection: clearAssetSelection,
      openSettings: () => {
        setAppSettingsCategory("general");
        setAppSettingsOpen(true);
      },
      openBackgroundJobs: () => openMediaJobs(),
      toggleFullscreen: () => {
        void shellApi?.windowControl("fullscreen-toggle");
      },
      zoomIn: () => dispatchGlobalZoomMenuAction("in"),
      zoomOut: () => dispatchGlobalZoomMenuAction("out"),
      zoomReset: () => dispatchGlobalZoomMenuAction("reset"),
      openAppLog,
      openAbout,
      openGitHub: () => {
        void shellApi?.openExternalUrl("https://github.com/dolag233/Serpent");
      },
      openOpenSourceLicenses: () => setOpenSourceLicensesOpen(true),
      revealAppLog,
    },
  });
  const mainMenuSectionsRef = useRef(mainMenuSections);
  mainMenuSectionsRef.current = mainMenuSections;

  // macOS keeps a native menu bar. Route its commands through the same
  // canonical renderer menu actions used by the Windows in-app menu so the
  // two platforms expose identical product functionality.
  useEffect(() => {
    if (!shellApi) return;
    const findMenuItem = (
      items: readonly MainMenuItem[],
      id: string,
    ): MainMenuItem | undefined => {
      for (const item of items) {
        if (item.id === id) return item;
        const nested = item.submenu === undefined
          ? undefined
          : findMenuItem(item.submenu, id);
        if (nested) return nested;
      }
      return undefined;
    };
    return shellApi.onApplicationMenuCommand(({ command, payload }) => {
      const currentMenuSections = mainMenuSectionsRef.current;
      const globalZoomAction = command === "canvas.zoom-in"
        ? "in"
        : command === "canvas.zoom-out"
          ? "out"
          : command === "canvas.zoom-reset"
            ? "reset"
            : null;
      if (globalZoomAction) {
        dispatchGlobalZoomMenuCommandIfAllowed(
          globalZoomAction,
          document.activeElement,
          hasActiveModalDialog(),
        );
        return;
      }
      const activeElement = document.activeElement;
      const textEditingFocused = activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
        || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      if (
        command === "window.toggle-fullscreen" &&
        (textEditingFocused || hasActiveModalDialog())
      ) return;
      if (textEditingFocused && command === "edit.paste") {
        void shellApi.nativeEditCommand("paste");
        return;
      }
      if (textEditingFocused && command === "edit.select-all") {
        void shellApi.nativeEditCommand("select-all");
        return;
      }
      // Native 资源库 menu: open a recent library by path (same action the
      // in-app library switcher performs).
      if (command === "library.open-recent") {
        if (payload) void openRecentLibrary(payload);
        return;
      }
      if (command === "settings") {
        currentMenuSections.find((section) => section.id === "settings")?.onSelect?.();
        return;
      }
      const item = currentMenuSections.reduce<MainMenuItem | undefined>(
        (found, section) => found ?? findMenuItem(section.items ?? [], command),
        undefined,
      );
      // Serpent-q0b1: honor the same disabled state the Windows in-app menu
      // renders greyed out — a native macOS item stays clickable otherwise.
      if (item && !item.disabled) item.onSelect();
    });
  }, [shellApi, openRecentLibrary]);

  useEffect(() => {
    if (!shellApi) return;
    for (const { command, enabled } of collectMainMenuCommandStates(mainMenuSections)) {
      shellApi.setApplicationMenuCommandEnabled(command, enabled);
    }
  }, [mainMenuSections, shellApi]);

  useEffect(() => {
    if (!shellApi) return;
    shellApi.setApplicationMenuCommandLabel(
      "edit.undo",
      operationHistory?.undoTop === null || operationHistory?.undoTop === undefined
        ? t("shell.mainMenuUndo")
        : t("shell.mainMenuUndoCount", { count: operationHistory.undoTop.affectedCount }),
    );
    shellApi.setApplicationMenuCommandLabel(
      "edit.redo",
      operationHistory?.redoTop === null || operationHistory?.redoTop === undefined
        ? t("shell.mainMenuRedo")
        : t("shell.mainMenuRedoCount", { count: operationHistory.redoTop.affectedCount }),
    );
    // Keel-接管: the native menu accelerator must NOT intercept Cmd/Ctrl+Z
    // while a text field is focused — Chromium's native text undo/redo would
    // be swallowed. The item is only enabled for the business history outside
    // editable text (which is also what the in-app menu labels advertise).
    shellApi.setApplicationMenuCommandEnabled(
      "edit.undo",
      !editableTextFocused
        && operationHistory?.undoTop !== null && operationHistory?.undoTop !== undefined
        && !busy,
    );
    shellApi.setApplicationMenuCommandEnabled(
      "edit.redo",
      !editableTextFocused
        && operationHistory?.redoTop !== null && operationHistory?.redoTop !== undefined
        && !busy,
    );
    shellApi.setApplicationMenuCommandEnabled(
      "window.toggle-fullscreen",
      !isEditableTextTarget(document.activeElement)
        && !dialogFocusTrapActive
        && !hasActiveModalDialog(),
    );
  }, [busy, dialogFocusTrapActive, editableTextFocused, operationHistory, shellApi, t]);

  // Keel-接管: Windows has no native menu bar (its accelerators are gone),
  // so the business undo/redo shortcuts live in the renderer. A focused text
  // field keeps Ctrl+Z/Ctrl+Shift+Z for Chromium's native text undo/redo.
  useEffect(() => {
    if (!IS_WINDOWS_PLATFORM) return;
    const onUndoRedoKeyDown = (event: KeyboardEvent) => {
      if (editableTextFocused || busy) return;
      const undo = matchesRuntimeShortcut("edit.undo", event, SHORTCUT_PLATFORM) === true;
      const redo = matchesRuntimeShortcut("edit.redo", event, SHORTCUT_PLATFORM) === true;
      if (!undo && !redo) return;
      event.preventDefault();
      if (redo) {
        if (operationHistory?.redoTop !== null && operationHistory?.redoTop !== undefined) {
          void redoLastOperation();
        }
      } else if (operationHistory?.undoTop !== null && operationHistory?.undoTop !== undefined) {
        void undoLastFileOp();
      }
    };
    document.addEventListener("keydown", onUndoRedoKeyDown);
    return () => document.removeEventListener("keydown", onUndoRedoKeyDown);
  }, [busy, editableTextFocused, operationHistory, undoLastFileOp, redoLastOperation]);

  // Mouse chords cannot be registered as Electron accelerators. Route them
  // through the renderer while keeping native menus authoritative for keys.
  useEffect(() => listenForMouseShortcutInputs(document, (input, event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable) ||
      hasActiveModalDialog()
    ) return;
    if (matchesRuntimeShortcut("window.toggle-fullscreen", input, SHORTCUT_PLATFORM) === true) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void shellApi?.windowControl("fullscreen-toggle");
      return;
    }
    if (busy) return;
    const undo = matchesRuntimeShortcut("edit.undo", input, SHORTCUT_PLATFORM) === true;
    const redo = matchesRuntimeShortcut("edit.redo", input, SHORTCUT_PLATFORM) === true;
    if (!undo && !redo) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (redo) {
      if (operationHistory?.redoTop !== null && operationHistory?.redoTop !== undefined) {
        void redoLastOperation();
      }
    } else if (operationHistory?.undoTop !== null && operationHistory?.undoTop !== undefined) {
      void undoLastFileOp();
    }
  }), [
    busy,
    operationHistory,
    redoLastOperation,
    shellApi,
    undoLastFileOp,
  ]);

  // Serpent-f74e48: during a text search the ordinary folder-card-row is
  // reused directly (matching folders appear as the same cards as browsing)
  // instead of a bespoke "search results" section. The row is hoisted so it
  // also renders when the asset grid resolves to the empty state (search can
  // match folders while zero assets match). Folder results are FolderBrowseEntry
  // and therefore render through the exact same FolderCard as the browser.
  const searchActive = searchValue.trim() !== "";
  const folderRowEntries =
    !showTrash && searchActive && searchFolderResults.length > 0
      ? filteredFolderBrowseEntries(
          searchFolderRealKey === searchFolderMatchKey && searchFolderRealEntries.length > 0
            ? searchFolderRealEntries
            : searchFolderResults,
          filteredFolderCounts,
        )
      : canvasFolderBrowseEntries;
  const folderCardRowVisible =
    library !== null && folderRowEntries.length > 0;
  return { folderCardRowVisible, folderRowEntries, searchActive, mainMenuSections, controlAiJobs };
}

/** Undo/redo menu label; a rule run names its rule (provenance). */
function historyMenuLabel(
  entry: HistoryEntrySummary | null | undefined,
  direction: "undo" | "redo",
  t: TranslateFn,
): string | undefined {
  if (!entry) return undefined;
  const rule = entry.labelKey === "history.rule.run" ? entry.labelArgs.rule : undefined;
  if (typeof rule === "string") {
    return t(direction === "undo" ? "shell.mainMenuUndoRule" : "shell.mainMenuRedoRule", { rule, count: entry.affectedCount });
  }
  return t(direction === "undo" ? "shell.mainMenuUndoCount" : "shell.mainMenuRedoCount", { count: entry.affectedCount });
}
