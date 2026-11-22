import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkspaceTabsState } from "../../workspace-tabs";
import type { BrowsePasteDestination } from "../../browse-paste-target";
import type { KeelShellApi } from "../../../shared/external-url";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { PluginIframeViewDescriptor } from "../../plugin-iframe-view-host";
import type { AppLocale } from "../../i18n/types";
import { normalizeAiAnalysisSettings, toWireAiAnalysisSettings } from "../../../shared/ai-analysis-settings";
import { DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS, type AiApiFormat } from "../../../shared/ai-endpoints";
import { type AssetSummary } from "../../../shared/asset-types";
import { type ShortcutEventLike } from "../../../shared/shortcut-resolution";
import { type AssetPreviewModalHandle } from "../../AssetPreviewModal";
import { toMessage } from "../../error-utils";
import { usePluginShortcutKeyboard } from "../../plugin-shortcut-contributions";
import { type AiState } from "../../stores/ai-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type TransfersState } from "../../stores/transfers-store";
import { useBrowseCommandKeyboard } from "../../use-browse-command-keyboard";
import { usePluginInputCaptureFanIn } from "../../use-plugin-input-capture-fanin";
import { usePluginInputCaptureModalSeam } from "../../use-plugin-input-capture-modal-seam";
import { useWorkspaceMouseNavigation } from "../../use-workspace-mouse-navigation";
import { useWorkspaceTabShortcuts } from "../../use-workspace-tab-shortcuts";
import { type DialogEscapeSnapshot } from "../../workbench/overlay/dialog-escape-stack";
import { isImeKeyboardEvent } from "../../workbench/overlay/ime-safe-dismiss";
import { hasActiveModalDialog } from "../../workbench/overlay/use-dialog-focus-trap";
import { listenForShortcutInputs, matchesRuntimeShortcut } from "../../workbench/shortcuts/shortcut-runtime";
import { SHORTCUT_PLATFORM, type RendererWindow } from "../shared/app-shared";
import { useCallback, useEffect } from "react";

export interface UseKeyboardRoutingDeps {
  dialogFocusTrapActive: boolean;
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  navigateAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  library: SessionState["library"];
  busy: boolean;
  workspaceTabsState: WorkspaceTabsState;
  previewAsset: PreviewState["previewAsset"];
  addWorkspaceTab: () => Promise<void>;
  closeWorkspaceTab: (tabId: string) => Promise<void>;
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  showTrash: NavigationState["showTrash"];
  selectedAsset: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | undefined;
  selectedAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  browsePasteDestination: BrowsePasteDestination;
  diskDeleteKeyboardTargets: { assetIds: string[]; folderIds: string[]; };
  searchInputRef: RefObject<HTMLInputElement | null>;
  handleOpenExternal: (assetId: string) => Promise<void>;
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  openAssetRename: (assetId: string) => void;
  handleCopyAssetFiles: (assetIds: string[]) => Promise<void>;
  handleCopyFilePath: (assetId: string) => Promise<void>;
  dispatchClipboardPaste: (destination: string | null) => void;
  handleRevealInFolder: (assetId: string) => Promise<void>;
  showAssetInContainingFolder: (assetId: string) => Promise<void>;
  requestSelectionDiskDelete: (assetIds: string[], folderIds: readonly string[]) => void;
  deletePermanentFromTrash: (assetIds: string[]) => Promise<boolean>;
  refreshAssets: () => Promise<void>;
  pluginSidebarRefreshKey: string;
  selectedAssetIds: SelectionState["selectedAssetIds"];
  selectedVisibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  pluginSurfaceContext: { contextId: string; revision: number; app: { platform: string; locale: string; theme: "system" | "light" | "dark"; busy: boolean; }; surface: { id: string; kind: string; }; window: { windowId: string; }; library: { open: boolean; writable: boolean; offline: boolean; id?: string | undefined; }; selection: { count: number; assetCount: number; folderCount: number; mixed: boolean; extensions: string[]; mimeTypes: string[]; mediaKinds: string[]; summary: { managedCount: number; unmanagedCount: number; availableCount: number; unavailableCount: number; deletedCount: number; hasDeleted: boolean; hasUnavailable: boolean; }; hasDeleted: boolean; hasUnavailable: boolean; ref?: string | undefined; primaryId?: string | undefined; }; browse: { folderId?: string | undefined; tagId?: string | undefined; search?: string | undefined; filter?: string | undefined; }; viewer: { active: boolean; fullscreen: boolean; assetId?: string | undefined; extension?: string | undefined; mimeType?: string | undefined; mediaKind?: string | undefined; }; };
  shellApi: KeelShellApi | undefined;
  dialogEscapeSnapshot: DialogEscapeSnapshot;
  goWorkspaceBack: () => Promise<void>;
  goWorkspaceForward: () => Promise<void>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  api: KeelLibraryApi | undefined;
  setSyncBindingStatus: Dispatch<SetStateAction<TransfersState["syncBindingStatus"]>>;
  pasteClipboardImage: (options?: { targetFolderId?: string; onNoClipboardImage?: () => void | Promise<void>; }) => Promise<void>;
  pasteOsClipboardFiles: (folderId: string | null) => void;
  dialog: DialogsState["dialog"];
  conflicts: TransfersState["conflicts"];
  batchRelinkPreview: TransfersState["batchRelinkPreview"];
  restoreDialog: DialogsState["restoreDialog"];
  previewModalRef: RefObject<AssetPreviewModalHandle | null>;
  previewIndex: number;
  openAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  t: TranslateFn;
  activePluginSidebarView: PluginIframeViewDescriptor | undefined;
  activeTagId: NavigationState["activeTagId"];
  tags: NavigationState["tags"];
  assetScope: NavigationState["assetScope"];
  selectedFolder: { folderId: string; parentFolderId: string | null; name: string; relativePath: string; directAssetCount: number; childFolderCount: number; createdAt?: string | undefined; appearance?: { glyphKind: "emoji" | "icon" | null; glyphValue: string | null; colorId: "blue" | "indigo" | "purple" | "pink" | "orange" | "green" | "teal" | "red" | null; } | null | undefined; } | undefined;
  setError: (text: string | null) => void;
  locale: AppLocale;
  setAiProfiles: Dispatch<SetStateAction<AiState["aiProfiles"]>>;
  updateAiActiveProfileId: (profileId: string | null) => void;
  setAiProfileDraftId: Dispatch<SetStateAction<AiState["aiProfileDraftId"]>>;
  setAiProfileName: Dispatch<SetStateAction<AiState["aiProfileName"]>>;
  setAiApiFormat: Dispatch<SetStateAction<AiState["aiApiFormat"]>>;
  setAiModel: Dispatch<SetStateAction<AiState["aiModel"]>>;
  setAiBaseUrl: Dispatch<SetStateAction<AiState["aiBaseUrl"]>>;
  setAiHasKey: Dispatch<SetStateAction<AiState["aiHasKey"]>>;
  setAiDraftHasKey: Dispatch<SetStateAction<AiState["aiDraftHasKey"]>>;
  setAiDraftConnectionState: Dispatch<SetStateAction<AiState["aiDraftConnectionState"]>>;
  setAiDraftConnectionReason: Dispatch<SetStateAction<AiState["aiDraftConnectionReason"]>>;
  setAiDescriptionEnabled: Dispatch<SetStateAction<AiState["aiDescriptionEnabled"]>>;
  setAiTagsEnabled: Dispatch<SetStateAction<AiState["aiTagsEnabled"]>>;
  setAiRatingEnabled: Dispatch<SetStateAction<AiState["aiRatingEnabled"]>>;
  setAiForceExistingTags: Dispatch<SetStateAction<AiState["aiForceExistingTags"]>>;
  setAiAnalysisSettings: Dispatch<SetStateAction<AiState["aiAnalysisSettings"]>>;
  setAiLanguages: Dispatch<SetStateAction<AiState["aiLanguages"]>>;
  setAiConcurrencyLimit: Dispatch<SetStateAction<AiState["aiConcurrencyLimit"]>>;
  setAiMaxAnalysisImageEdgePx: Dispatch<SetStateAction<AiState["aiMaxAnalysisImageEdgePx"]>>;
  setAiAutoAnalyzeEnabled: Dispatch<SetStateAction<AiState["aiAutoAnalyzeEnabled"]>>;
  setAiDisclaimerAccepted: Dispatch<SetStateAction<AiState["aiDisclaimerAccepted"]>>;
  aiVerifiedFingerprintRef: RefObject<string | null>;
  aiProfiles: AiState["aiProfiles"];
  aiProfileDraftId: AiState["aiProfileDraftId"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useKeyboardRouting({ dialogFocusTrapActive, previewAssetRef, visibleAssets, navigateAssetPreview, closeAssetPreview, library, busy, workspaceTabsState, previewAsset, addWorkspaceTab, closeWorkspaceTab, showTagManagement, showPluginSidebarView, showTrash, selectedAsset, selectedAssets, browsePasteDestination, diskDeleteKeyboardTargets, searchInputRef, handleOpenExternal, trashManagedAssets, openAssetRename, handleCopyAssetFiles, handleCopyFilePath, dispatchClipboardPaste, handleRevealInFolder, showAssetInContainingFolder, requestSelectionDiskDelete, deletePermanentFromTrash, refreshAssets, pluginSidebarRefreshKey, selectedAssetIds, selectedVisibleAssets, pluginSurfaceContext, shellApi, dialogEscapeSnapshot, goWorkspaceBack, goWorkspaceForward, managedImportTargetFolderIdRef, api, setSyncBindingStatus, pasteClipboardImage, pasteOsClipboardFiles, dialog, conflicts, batchRelinkPreview, restoreDialog, previewModalRef, previewIndex, openAssetPreview, t, activePluginSidebarView, activeTagId, tags, assetScope, selectedFolder, setError, locale, setAiProfiles, updateAiActiveProfileId, setAiProfileDraftId, setAiProfileName, setAiApiFormat, setAiModel, setAiBaseUrl, setAiHasKey, setAiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, setAiDescriptionEnabled, setAiTagsEnabled, setAiRatingEnabled, setAiForceExistingTags, setAiAnalysisSettings, setAiLanguages, setAiConcurrencyLimit, setAiMaxAnalysisImageEdgePx, setAiAutoAnalyzeEnabled, setAiDisclaimerAccepted, aiVerifiedFingerprintRef, aiProfiles, aiProfileDraftId }: UseKeyboardRoutingDeps) {

  useEffect(() => {
    // Serpent-0rk: freeze shell pointer targets while any modal is open.
    document.body.classList.toggle("keel-modal-open", dialogFocusTrapActive);
    return () => {
      document.body.classList.remove("keel-modal-open");
    };
  }, [dialogFocusTrapActive]);

  function advanceOpenViewer(removedId: string) {
    const viewed = previewAssetRef.current;
    if (!viewed || viewed.assetId !== removedId) return;
    const index = visibleAssets.findIndex((item) => item.assetId === removedId);
    const next = index >= 0
      ? visibleAssets[index + 1] ?? (index > 0 ? visibleAssets[index - 1] ?? null : null)
      : null;
    if (next) navigateAssetPreview(next);
    else void closeAssetPreview();
  }

  useWorkspaceTabShortcuts({
    enabled: Boolean(library),
    platform: SHORTCUT_PLATFORM,
    busy,
    tabCount: workspaceTabsState.tabs.length,
    previewOpen: Boolean(previewAsset),
    onNewTab: () => {
      void addWorkspaceTab();
    },
    onCloseTab: () => {
      void closeWorkspaceTab(workspaceTabsState.activeTabId);
    },
  });

  useBrowseCommandKeyboard({
    enabled: Boolean(library) && !showTagManagement && !showPluginSidebarView,
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    showTrash,
    libraryOpen: Boolean(library),
    busy,
    selectedAsset: previewAsset ?? selectedAsset,
    selectedAssets: previewAsset ? [previewAsset] : selectedAssets,
    pasteDestinationFolderId: browsePasteDestination,
    diskDeleteAssetIds: diskDeleteKeyboardTargets.assetIds,
    diskDeleteFolderIds: diskDeleteKeyboardTargets.folderIds,
    searchInputRef,
    onOpenExternal: (assetId) => {
      void handleOpenExternal(assetId);
    },
    onTrashManaged: (assetIds) => {
      const viewedId = previewAssetRef.current?.assetId;
      void trashManagedAssets(assetIds).then(() => {
        if (viewedId && assetIds.includes(viewedId)) advanceOpenViewer(viewedId);
      });
    },
    onRename: openAssetRename,
    onCopyFiles: (assetIds) => {
      void handleCopyAssetFiles(assetIds);
    },
    onCopyFilePath: (assetId) => {
      void handleCopyFilePath(assetId);
    },
    onPasteIntoFolder: dispatchClipboardPaste,
    onRevealInFolder: (assetId) => {
      void handleRevealInFolder(assetId);
    },
    onShowInLibraryFolder: (assetId) => {
      void showAssetInContainingFolder(assetId);
    },
    onDiskDelete: (assetIds, folderIds) => {
      requestSelectionDiskDelete([...assetIds], folderIds);
    },
    onPermanentDelete: (assetIds) => {
      const viewedId = previewAssetRef.current?.assetId;
      void deletePermanentFromTrash([...assetIds]).then((removed) => {
        if (removed && viewedId && assetIds.includes(viewedId)) advanceOpenViewer(viewedId);
      });
    },
    onRefreshDisk: () => {
      void refreshAssets();
    },
  });

  usePluginShortcutKeyboard({
    enabled: Boolean(library) && !showTagManagement && !showPluginSidebarView,
    platform: SHORTCUT_PLATFORM,
    pluginApi: (window as RendererWindow).keel?.plugins,
    libraryId: library?.libraryId,
    refreshKey: pluginSidebarRefreshKey,
    previewOpen: Boolean(previewAsset),
    selectedAssetIds,
    selectedAssets: selectedVisibleAssets,
    context: pluginSurfaceContext,
  });

  usePluginInputCaptureFanIn({
    shell: shellApi,
    enabled: Boolean(library),
    previewOpen: Boolean(previewAsset),
  });
  usePluginInputCaptureModalSeam({
    shell: shellApi,
    snapshot: dialogEscapeSnapshot,
  });

  useWorkspaceMouseNavigation({
    enabled: Boolean(library),
    onBack: () => {
      void goWorkspaceBack();
    },
    onForward: () => {
      void goWorkspaceForward();
    },
  });

  // Serpent-166q: macOS Edit → Copy accelerator (custom menu, not role:copy).
  useEffect(() => {
    if (!shellApi) return;
    return shellApi.onCopySelection(() => {
      const target = document.activeElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        void shellApi.nativeEditCopy();
        return;
      }
      if (previewAsset || showTrash || !library) {
        void shellApi.nativeEditCopy();
        return;
      }
      const copyIds = selectedAssets
        .filter(
          (asset) => asset.availability === "available" && !asset.deletedAt,
        )
        .map((asset) => asset.assetId);
      if (copyIds.length > 0) {
        void handleCopyAssetFiles(copyIds);
        return;
      }
      void shellApi.nativeEditCopy();
    });
  }, [
    shellApi,
    previewAsset,
    showTrash,
    library,
    selectedAssets,
    handleCopyAssetFiles,
  ]);

  // Capture-phase Escape guard: when context menu is open, stop
  // propagation so the non-capture handler (which clears selection)
  // does not fire on the same Escape key press. Uses stopPropagation()
  // (not stopImmediatePropagation()) to avoid blocking the context-
  // menu's own native capture listener, which is registered first.
  useEffect(() => {
    const onEscapeCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isImeKeyboardEvent(event)) return;
      if (document.querySelector(".context-menu")) {
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onEscapeCapture, true);
    return () => document.removeEventListener("keydown", onEscapeCapture, true);
  }, []);

  useEffect(() => {
    managedImportTargetFolderIdRef.current = undefined;
  }, [library?.libraryId, managedImportTargetFolderIdRef]);

  // 打开库后拉取同步绑定状态（库切换器 link/link-off 图标）。
  const activeLibraryId = library?.libraryId;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!api || !activeLibraryId) {
        if (!cancelled) setSyncBindingStatus("none");
        return;
      }
      const result = await api.syncGetBinding({ libraryId: activeLibraryId });
      if (cancelled) return;
      if (result.ok && result.value) {
        setSyncBindingStatus(result.value.enabled ? "enabled" : "disabled");
      } else {
        setSyncBindingStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, activeLibraryId, setSyncBindingStatus]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        !library ||
        busy ||
        showTrash ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (hasActiveModalDialog()) return;

      // Windows clipboard images are frequently bitmap-only (CF_DIB) that the
      // renderer's clipboardData never reports as an image item. Delegate
      // classification to Main's clipboard.readImage(): image first, then OS
      // file paths, and stay silent when the clipboard holds neither.
      event.preventDefault();
      void pasteClipboardImage({
        targetFolderId:
          browsePasteDestination === undefined
            ? managedImportTargetFolderIdRef.current
            : (browsePasteDestination ?? undefined),
        onNoClipboardImage: () => {
          if (browsePasteDestination === undefined) return;
          pasteOsClipboardFiles(browsePasteDestination);
        },
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [
    library,
    busy,
    showTrash,
    browsePasteDestination,
    managedImportTargetFolderIdRef,
    pasteClipboardImage,
    pasteOsClipboardFiles,
  ]);

  useEffect(() => {
    if (
      dialog ||
      conflicts ||
      batchRelinkPreview ||
      restoreDialog
    )
      return;
    const onShortcutInput = (shortcutInput: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      const target = event.target;
      const keyboard = shortcutInput.kind === "mouse" ? null : shortcutInput;
      if (hasActiveModalDialog()) return;
      if (previewAsset) {
        if (keyboard?.key === "Escape" && !document.fullscreenElement) {
          event.preventDefault();
          void (async () => {
            if (previewModalRef.current) {
              await previewModalRef.current.requestClose();
            } else {
              await closeAssetPreview();
            }
          })();
          return;
        }
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement &&
            (target.isContentEditable || target.closest('[role="dialog"]')))
        ) {
          return;
        }
        const previous = matchesRuntimeShortcut("viewer.previous", shortcutInput, SHORTCUT_PLATFORM);
        const next = matchesRuntimeShortcut("viewer.next", shortcutInput, SHORTCUT_PLATFORM);
        if (previous || next) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (previous && previewIndex > 0) {
            navigateAssetPreview(visibleAssets[previewIndex - 1]!);
          } else if (next && previewIndex >= 0 && previewIndex < visibleAssets.length - 1) {
            navigateAssetPreview(visibleAssets[previewIndex + 1]!);
          }
        }
        return;
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('[role="dialog"]')))
      )
        return;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'button:not(.asset-card), a, [role="button"]:not(.asset-card), [role="menuitem"]',
        )
      )
        return;
      if (!keyboard || (keyboard.key !== "Enter" && keyboard.key !== " ") || keyboard.repeat) return;
      if (
        !selectedAsset ||
        selectedAsset.availability !== "available" ||
        selectedAsset.deletedAt
      )
        return;
      event.preventDefault();
      openAssetPreview(selectedAsset);
    };
    const removeShortcutInputs = listenForShortcutInputs(document, onShortcutInput);
    return removeShortcutInputs;
  }, [
    batchRelinkPreview,
    closeAssetPreview,
    conflicts,
    dialog,
    previewAsset,
    previewIndex,
    navigateAssetPreview,
    openAssetPreview,
    restoreDialog,
    selectedAsset,
    visibleAssets, previewModalRef]);

  // macOS three-finger swipe while viewing → previous/next (same order as arrows).
  useEffect(() => {
    if (!previewAsset) return;
    const shellBridge = (window as RendererWindow).keel?.shell;
    if (!shellBridge?.onSwipe) return;
    return shellBridge.onSwipe((direction) => {
      if (direction === "left") {
        if (previewIndex >= 0 && previewIndex < visibleAssets.length - 1) {
          navigateAssetPreview(visibleAssets[previewIndex + 1]!);
        }
        return;
      }
      if (direction === "right") {
        if (previewIndex > 0) {
          navigateAssetPreview(visibleAssets[previewIndex - 1]!);
        }
      }
    });
  }, [
    navigateAssetPreview,
    previewAsset,
    previewIndex,
    visibleAssets,
  ]);

  // Serpent-oy07: sync BrowserWindow focus to document (native macOS traffic lights
  // dim on inactive via hiddenInset; renderer can mirror for shell chrome).
  useEffect(() => {
    const shellBridge = (window as RendererWindow).keel?.shell;
    if (!shellBridge?.onWindowFocusChanged) return;
    const apply = (focused: boolean) => {
      document.documentElement.dataset.windowFocused = focused
        ? "true"
        : "false";
    };
    apply(document.hasFocus());
    return shellBridge.onWindowFocusChanged(apply);
  }, []);

  function workspaceTitle() {
    if (!library) return t("scope.workspace");
    if (showTagManagement) return t("scope.tagManagement");
    if (showPluginSidebarView) return activePluginSidebarView?.title ?? t("scope.workspace");
    if (showTrash) return t("scope.trash");
    if (activeTagId) {
      const tag = tags.find((x) => x.tagId === activeTagId);
      return tag
        ? t("scope.tagNamed", { name: tag.name })
        : t("scope.tagFilter");
    }
    if (assetScope === "all") return t("scope.allAssets");
    if (assetScope === "root") return t("scope.rootFolder");
    return selectedFolder?.name ?? t("scope.workspace");
  }

  async function loadAiConfig() {
    if (!api) return;
    try {
      const result = await api.getAiConfig();
      if (!result.ok) {
        setError(toMessage(result.error, t("toast.aiConfigLoadFailed"), locale));
        return;
      }
      setAiProfiles(result.value.profiles);
      updateAiActiveProfileId(result.value.activeProfileId);
      setAiProfileDraftId(result.value.activeProfileId);
      setAiProfileName(
        result.value.profiles.find((profile) => profile.id === result.value.activeProfileId)?.name ?? "",
      );
      setAiApiFormat(
        (result.value.apiFormat as AiApiFormat) ?? DEFAULT_AI_API_FORMAT,
      );
      setAiModel(result.value.model ?? DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT]);
      setAiBaseUrl(result.value.baseUrl ?? "");
      setAiHasKey(result.value.hasKey);
      setAiDraftHasKey(result.value.hasKey);
      setAiDraftConnectionState(result.value.hasKey ? "idle" : "disconnected");
      setAiDraftConnectionReason(undefined);
      setAiDescriptionEnabled(result.value.enabledFields.description);
      setAiTagsEnabled(result.value.enabledFields.tags);
      setAiRatingEnabled(result.value.enabledFields.rating);
      setAiForceExistingTags(result.value.analysisSettings.forceExistingTags);
      setAiAnalysisSettings(
        toWireAiAnalysisSettings(
          normalizeAiAnalysisSettings(result.value.analysisSettings),
        ),
      );
      const langs = result.value.languages as
        | Array<"zh-CN" | "en" | "ja" | "ko">
        | undefined;
      setAiLanguages(langs?.length ? [langs[0]!] : ["zh-CN"]);
      setAiConcurrencyLimit(result.value.concurrencyLimit);
      setAiMaxAnalysisImageEdgePx(result.value.maxAnalysisImageEdgePx);
      setAiAutoAnalyzeEnabled(result.value.autoAnalyzeEnabled);
      setAiDisclaimerAccepted(result.value.disclaimerAccepted);
      aiVerifiedFingerprintRef.current = null;
    } catch (caught) {
      setError(toMessage(caught, t("toast.aiConfigLoadFailed"), locale));
    }
  }

  const matchingDraftAiProfileId = useCallback((): string | undefined => {
    const profile = aiProfiles.find((item) => item.id === aiProfileDraftId);
    return profile?.hasCredential ? profile.id : undefined;
  }, [aiProfileDraftId, aiProfiles]);
  return { loadAiConfig, workspaceTitle, matchingDraftAiProfileId, advanceOpenViewer };
}
