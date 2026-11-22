import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import type { FolderDiskDeleteTarget } from "../../use-folder-delete-actions";
import type { SearchQuery } from "../../../shared/asset-types";
import type { BrowseFirstPage } from "../../use-browse-pagination";
import { type AssetSummary, type FilterClause, type SearchScope, type SortDefinition } from "../../../shared/asset-types";
import { type EntityAppearance, type EntityAppearanceTarget } from "../../../shared/entity-appearance";
import { linkedDirectoryName, parseLinkedVirtualFolderId } from "../../../shared/linked-folder-tree";
import { LibraryOperationError, toMessage } from "../../error-utils";
import { type FindSimilarSource } from "../../find-similar";
import { type LibraryViewSessionToken } from "../../library-view-session";
import { type PendingAssetReveal } from "../../pending-asset-reveal";
import { semanticBrowseRegistration } from "../../semantic-browse";
import { type SemanticSearchPageSize } from "../../semantic-search-preferences";
import { type BrowseState } from "../../stores/browse-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { type QueryState } from "../../stores/query-store";
import { selectionFields, type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { BROWSE_PAGE_SIZE, registerBrowseSearchPage } from "../../use-browse-pagination";
import { useFolderCommandShortcuts } from "../../use-folder-command-shortcuts";
import { useInlineFolderEdit } from "../../use-inline-folder-edit";
import { useAssetRename } from "../../useAssetRename";
import { type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { captureWorkspaceNavViewport, shouldRestoreViewportAfterBrowseReload } from "../../workbench/workspace/workspace-scroll-position";
import { SHORTCUT_PLATFORM, type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";
import { useCallback } from "react";

export interface UseFolderOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  setSelectedAssetId: Dispatch<SetStateAction<SelectionState["selectedAssetId"]>>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  linkedFolders: NavigationState["linkedFolders"];
  assetScope: NavigationState["assetScope"];
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  folders: NavigationState["folders"];
  requestTrashManagedFolder: (folderId: string, name: string) => void;
  setFolders: Dispatch<SetStateAction<NavigationState["folders"]>>;
  setLinkedFolders: Dispatch<SetStateAction<NavigationState["linkedFolders"]>>;
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
  setFolderBrowseRefreshToken: Dispatch<SetStateAction<BrowseState["folderBrowseRefreshToken"]>>;
  selectedAssetIds: SelectionState["selectedAssetIds"];
  setFolderCoverPicker: Dispatch<SetStateAction<{ folderIds: string[]; assetId: string; } | null>>;
  folderCoverPicker: { folderIds: string[]; assetId: string; } | null;
  setFolderCustomCoverIds: Dispatch<SetStateAction<BrowseState["folderCustomCoverIds"]>>;
  showTrash: NavigationState["showTrash"];
  previewAsset: PreviewState["previewAsset"];
  selectedFolderId: string | undefined;
  selectedFolderIds: SelectionState["selectedFolderIds"];
  handleOpenFolderInFileManager: (folderId: string) => Promise<void>;
  handleCopyFolder: (folderId: string) => Promise<void>;
  handleCopyFolderPath: (folderId: string) => Promise<void>;
  dispatchClipboardPaste: (destination: string | null) => void;
  trashMixedSelection: (assetIds: string[], folderIds?: readonly string[]) => Promise<void>;
  requestSelectionDiskDelete: (assetIds: string[], folderIds: readonly string[]) => void;
  openDiskDelete: (target: FolderDiskDeleteTarget) => void;
  createWorkspaceNavigationRequest: (request: WorkspaceNavigationRequest | undefined, historyMode?: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  searchRequestGenerationRef: RefObject<number>;
  showIgnoredItems: QueryState["showIgnoredItems"];
  currentSearchScope: (recursivelySearchFolders?: boolean) => SearchScope | undefined;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  resetBrowsePaginationPreservingVisibleLayout: () => void;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setShowTagManagement: Dispatch<SetStateAction<NavigationState["showTagManagement"]>>;
  setActivePluginSidebarViewId: Dispatch<SetStateAction<NavigationState["activePluginSidebarViewId"]>>;
  tagFilter: QueryState["tagFilter"];
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  pendingWorkspaceTabSelectionRef: RefObject<{ selectedAssetIds: string[]; selectedAssetId: string | null; isCurrent: () => boolean; } | null>;
  selectionAnchorRef: MutableRefObject<string | null>;
  pendingRevealRef: RefObject<PendingAssetReveal | null>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  applySearchResult: (result: { items: AssetSummary[]; total: number; offset: number; snippets?: Array<{ assetId: string; text: string; }>; }) => void;
  beginBrowsePageClearingSimilar: (definition: { kind: "search"; libraryId: string; query: SearchQuery | null; filters?: FilterClause[] | null; scope?: SearchScope | null; sort?: SortDefinition | null; showIgnored: boolean; sessionId?: string; target: "assets" | "trash"; pinnedOrder?: boolean; rankedAssetIds?: readonly string[]; rankedPageSize?: SemanticSearchPageSize; similaritySourceAssetId?: string; }, firstPage: BrowseFirstPage) => void;
  finishWorkspaceNavigation: (request: WorkspaceNavigationRequest, viewport?: WorkspaceNavViewport) => void;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  setFindSimilarSource: Dispatch<SetStateAction<NavigationState["findSimilarSource"]>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useFolderOperations({ api, library, visibleAssets, reloadCurrentContent, setNotice, setSelectedAssetId, setSelectedAssetIds, linkedFolders, assetScope, chooseFolder, folders, requestTrashManagedFolder, setFolders, setLinkedFolders, setError, t, locale, setFolderBrowseRefreshToken, selectedAssetIds, setFolderCoverPicker, folderCoverPicker, setFolderCustomCoverIds, showTrash, previewAsset, selectedFolderId, selectedFolderIds, handleOpenFolderInFileManager, handleCopyFolder, handleCopyFolderPath, dispatchClipboardPaste, trashMixedSelection, requestSelectionDiskDelete, openDiskDelete, createWorkspaceNavigationRequest, ensureLibraryView, searchRequestGenerationRef, showIgnoredItems, currentSearchScope, isCurrentLibraryView, resetBrowsePaginationPreservingVisibleLayout, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, tagFilter, setActiveTagId, pendingWorkspaceTabSelectionRef, selectionAnchorRef, pendingRevealRef, clearAssetSelection, applySearchResult, beginBrowsePageClearingSimilar, finishWorkspaceNavigation, workspaceCanvasRef, currentQueryDefinition, setFindSimilarSource }: UseFolderOperationsDeps) {

  const {
    assetRenameDialog,
    openAssetRename,
    changeAssetRenameValue,
    cancelAssetRename,
    submitAssetRename,
  } = useAssetRename({
    api: api ?? null,
    library,
    visibleAssets,
    reloadCurrentContent,
    setNotice,
    setSelectedAssetId,
    setSelectedAssetIds,
  });

  const {
    inlineFolderEdit,
    openInlineFolderCreate,
    openInlineFolderRename,
    changeInlineFolderEdit,
    cancelInlineFolderEdit,
    commitInlineFolderEdit,
  } = useInlineFolderEdit({
    api: api ?? null,
    library,
    setNotice,
    reloadCurrentContent,
    isLinkedFolderId: (folderId) =>
      parseLinkedVirtualFolderId(folderId) !== null ||
      linkedFolders.some((folder) => folder.folderId === folderId),
    onRenameSuccess: async (newFolderId, previousFolderId) => {
      if (assetScope !== previousFolderId) return false;
      // Renaming the folder currently being browsed navigates to the same
      // scope with the same id.  Folder navigation normally skips the sidebar
      // query for performance, but here that would immediately put the old
      // name back after the success notice.  Refresh the folder tree as part
      // of this mutation so the sidebar settles in the same render cycle.
      await chooseFolder(newFolderId, { refreshSidebar: true });
      return true;
    },
  });

  const resolveManagedFolderName = useCallback(
    (folderId: string) => {
      const managed = folders.find((folder) => folder.folderId === folderId)?.name;
      if (managed !== undefined) return managed;
      const linkedRoot = linkedFolders.find(
        (folder) => folder.folderId === folderId,
      )?.displayName;
      if (linkedRoot !== undefined) return linkedRoot;
      const virtual = parseLinkedVirtualFolderId(folderId);
      if (virtual) return linkedDirectoryName(virtual.relativePath) || undefined;
      return undefined;
    },
    [folders, linkedFolders],
  );

  function requestTrashFolder(folderId: string, name: string) {
    // 2026-09-15 用户决定：链接文件夹没有「移入回收站」。这里对链接目标直接落空，
    // 而不是退回旧的逐文件系统回收站路径（链接文件夹请用「移除链接文件夹」或
    // 「强制从硬盘删除」）。
    if (
      parseLinkedVirtualFolderId(folderId)
      || linkedFolders.some((folder) => folder.folderId === folderId)
    ) {
      return;
    }
    requestTrashManagedFolder(folderId, name);
  }

  function setEntityAppearance(
    target: EntityAppearanceTarget,
    appearance: EntityAppearance | null,
  ) {
    if (!api || !library) return;
    void (async () => {
      try {
        const result = await api.setEntityAppearance({
          libraryId: library.libraryId,
          target,
          appearance,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        const next = result.value.appearance;
        switch (target.kind) {
          case "managed-folder":
            setFolders((current) =>
              current.map((folder) =>
                folder.folderId === target.id ? { ...folder, appearance: next } : folder,
              ),
            );
            return;
          case "linked-folder":
            setLinkedFolders((current) =>
              current.map((folder) =>
                folder.folderId === target.id ? { ...folder, appearance: next } : folder,
              ),
            );
            return;
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.appearanceFailed"), locale));
      }
    })();
  }

  function chooseFolderCover(folderIds: readonly string[]) {
    if (!api || !library || folderIds.length === 0) return;
    void (async () => {
      try {
        const result = await api.setFolderCover({
          libraryId: library.libraryId,
          folderIds: [...folderIds],
        });
        if (!result.ok) {
          if (result.error.code === "CANCELLED") return;
          throw new LibraryOperationError(result.error);
        }
        patchFolderCustomCoverIds(result.value.folderIds, result.value.hasCustomCover);
        setFolderBrowseRefreshToken((token) => token + 1);
      } catch (caught) {
        setError(toMessage(caught, t("error.code.FOLDER_COVER_UNSUPPORTED"), locale));
      }
    })();
  }

  function openFolderCoverLibraryPicker(folderIds: readonly string[]) {
    if (!library || folderIds.length === 0) return;
    const images = visibleAssets.filter(
      (asset) => asset.mediaType === "image" && !asset.deletedAt,
    );
    const selected = images.find((asset) => selectedAssetIds.includes(asset.assetId));
    setFolderCoverPicker({
      folderIds: [...folderIds],
      assetId: selected?.assetId ?? "",
    });
  }

  function applyFolderCoverFromLibrary(assetId: string) {
    if (!api || !library || !folderCoverPicker || !assetId) return;
    const { folderIds } = folderCoverPicker;
    void (async () => {
      try {
        const result = await api.setFolderCoverFromAsset({
          libraryId: library.libraryId,
          folderIds,
          assetId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        patchFolderCustomCoverIds(result.value.folderIds, result.value.hasCustomCover);
        setFolderCoverPicker(null);
        setFolderBrowseRefreshToken((token) => token + 1);
      } catch (caught) {
        setError(toMessage(caught, t("error.code.FOLDER_COVER_UNSUPPORTED"), locale));
      }
    })();
  }

  function useAssetAsFolderCover(assetId: string, folderId: string) {
    if (!api || !library) return;
    void (async () => {
      try {
        const result = await api.setFolderCoverFromAsset({
          libraryId: library.libraryId,
          folderIds: [folderId],
          assetId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        patchFolderCustomCoverIds(result.value.folderIds, result.value.hasCustomCover);
        setFolderBrowseRefreshToken((token) => token + 1);
      } catch (caught) {
        setError(toMessage(caught, t("error.code.FOLDER_COVER_UNSUPPORTED"), locale));
      }
    })();
  }

  function clearFolderCover(folderIds: readonly string[]) {
    if (!api || !library || folderIds.length === 0) return;
    void (async () => {
      try {
        const result = await api.clearFolderCover({
          libraryId: library.libraryId,
          folderIds: [...folderIds],
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        patchFolderCustomCoverIds(result.value.folderIds, result.value.hasCustomCover);
        setFolderBrowseRefreshToken((token) => token + 1);
      } catch (caught) {
        setError(toMessage(caught, t("error.code.FOLDER_COVER_UNSUPPORTED"), locale));
      }
    })();
  }

  function patchFolderCustomCoverIds(folderIds: readonly string[], hasCustomCover: boolean) {
    setFolderCustomCoverIds((current) => {
      const next = new Set(current);
      for (const folderId of folderIds) {
        if (hasCustomCover) next.add(folderId);
        else next.delete(folderId);
      }
      return next;
    });
  }

  // Serpent-vf8x: folder create/rename/trash chords (mac ⌘ / Windows Ctrl).
  useFolderCommandShortcuts({
    enabled: Boolean(library) && !showTrash,
    platform: SHORTCUT_PLATFORM,
    previewOpen: Boolean(previewAsset),
    browseManagedFolderId: selectedFolderId ?? null,
    selectedFolderCardIds: selectedFolderIds,
    selectedAssetCount: selectedAssetIds.length,
    resolveManagedFolderName,
    canRenameFolder: (folderId) =>
      folders.some((folder) => folder.folderId === folderId) ||
      linkedFolders.some(
        (folder) => folder.folderId === folderId && folder.status === "available",
      ),
    canOpenFolder: (folderId) => {
      if (folders.some((folder) => folder.folderId === folderId)) return true;
      const virtual = parseLinkedVirtualFolderId(folderId);
      const rootId = virtual?.linkedFolderId ?? folderId;
      return linkedFolders.some(
        (folder) => folder.folderId === rootId && folder.status === "available",
      );
    },
    openFolderInFileManager: (folderId) => {
      void handleOpenFolderInFileManager(folderId);
    },
    createSubfolder: (parentFolderId) => {
      openInlineFolderCreate(parentFolderId);
    },
    copyFolder: (folderId) => {
      void handleCopyFolder(folderId);
    },
    copyFolderPath: (folderId) => {
      void handleCopyFolderPath(folderId);
    },
    pasteIntoFolder: (folderId) => {
      dispatchClipboardPaste(folderId);
    },
    renameFolder: (folderId, currentName) => {
      openInlineFolderRename(folderId, currentName);
    },
    trashManagedFolder: (folderId, name) => {
      requestTrashFolder(folderId, name);
    },
    // Serpent-d7acfa：多选文件夹卡片时快捷键对全部选中项生效（复用既有的
    // 混合选择入口，托管/链接/根目录的跳过规则保持一致）。
    trashFolders: (folderIds) => {
      void trashMixedSelection([], folderIds);
    },
    deleteFolders: (folderIds) => {
      requestSelectionDiskDelete([], folderIds);
    },
    deleteFolderFromDisk: (folderId, name) => {
      const virtual = parseLinkedVirtualFolderId(folderId);
      if (virtual) {
        openDiskDelete({
          kind: "linked-child",
          folderId,
          linkedFolderId: virtual.linkedFolderId,
          relativePath: virtual.relativePath,
          name,
        });
        return;
      }
      if (linkedFolders.some((folder) => folder.folderId === folderId)) {
        openDiskDelete({
          kind: "linked-child",
          folderId,
          linkedFolderId: folderId,
          relativePath: "",
          name,
        });
        return;
      }
      openDiskDelete({ kind: "managed", folderId, name });
    },
  });


  async function executeSearchDefinition(
    definition: SearchDefinition,
    navigation?: WorkspaceNavigationRequest,
    reloadViewport?: WorkspaceNavViewport,
  ) {
    if (!api || !library) return;
    const request = createWorkspaceNavigationRequest(navigation, "none");
    if (!request.isCurrent()) return;
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    const requestGeneration = ++searchRequestGenerationRef.current;
    const includeIgnored =
      request.browseState?.showIgnoredItems ?? showIgnoredItems;
    // Resolve once so the first page and every subsequent page use exactly
    // the same scope even if sidebar state changes while the request is live.
    const searchScope = currentSearchScope(definition.search !== undefined);
    const result = await api.openBrowseSession({
      libraryId: targetLibraryId,
      query: definition.search ?? null,
      filters: definition.filters,
      scope: searchScope,
      sort: definition.sort,
      // Serpent-87pd: first window only; scrollbar jumps fetch other offsets.
      limit: BROWSE_PAGE_SIZE,
      showIgnored: includeIgnored,
    });
    if (!result.ok) throw new LibraryOperationError(result.error);
    if (
      !request.isCurrent() ||
      !isCurrentLibraryView(viewSession) ||
      requestGeneration !== searchRequestGenerationRef.current
    ) return;
    resetBrowsePaginationPreservingVisibleLayout();
    setShowTrash(false);
    setShowTagManagement(false);
    setActivePluginSidebarViewId(null);
    if (!tagFilter.trim()) setActiveTagId(null);
    const pendingTabSelection = pendingWorkspaceTabSelectionRef.current;
    const selectionNow = selectionFields.get("selectedAssetIds");
    const pageAssetIds = new Set(result.value.items.map((item) => item.assetId));
    // A browse response used to clear the selection unconditionally. Keep a
    // selection whose ids are all on the returned page so a click is not
    // wiped when the in-flight or follow-up search lands.
    const selectionStillOnPage =
      selectionNow.length > 0
      && selectionNow.every((id) => pageAssetIds.has(id));
    if (pendingTabSelection?.isCurrent()) {
      setSelectedAssetIds([...pendingTabSelection.selectedAssetIds]);
      setSelectedAssetId(pendingTabSelection.selectedAssetId ?? undefined);
      selectionAnchorRef.current = pendingTabSelection.selectedAssetId;
      pendingWorkspaceTabSelectionRef.current = null;
    } else if (selectionStillOnPage) {
      if (pendingTabSelection) pendingWorkspaceTabSelectionRef.current = null;
    } else {
      if (pendingTabSelection) pendingWorkspaceTabSelectionRef.current = null;
      if (!pendingRevealRef.current) {
        clearAssetSelection({ preserveFolders: true });
      }
    }
    applySearchResult(result.value);
    // Serpent-ws4k: subsequent pages must reuse the same query/scope/sort.
    registerBrowseSearchPage(beginBrowsePageClearingSimilar, {
      libraryId: targetLibraryId,
      query: definition.search ?? null,
      filters: definition.filters,
      scope: searchScope,
      sort: definition.sort,
      showIgnored: includeIgnored,
      sessionId: result.value.sessionId,
      target: "assets",
      items: result.value.items,
      total: result.value.total,
      offset: result.value.offset,
      snippets: result.value.snippets,
    });
    if (
      shouldRestoreViewportAfterBrowseReload(
        request.deferReveal ? "silent" : "submit",
      )
    ) {
      finishWorkspaceNavigation(
        request,
        reloadViewport ?? captureWorkspaceNavViewport(workspaceCanvasRef.current),
      );
    }
    return result.value;
  }

  function showSemanticResults(
    items: AssetSummary[],
    rankedAssetIds: readonly string[],
    rankedPageSize: SemanticSearchPageSize,
    source?: FindSimilarSource,
  ) {
    if (!library) return;
    setShowTrash(false);
    setShowTagManagement(false);
    setActivePluginSidebarViewId(null);
    if (!pendingRevealRef.current) clearAssetSelection({ preserveFolders: true });
    const definition = currentQueryDefinition();
    registerBrowseSearchPage(beginBrowsePageClearingSimilar, semanticBrowseRegistration({
      libraryId: library.libraryId,
      query: definition.search ?? null,
      filters: definition.filters,
      scope: currentSearchScope(definition.search !== undefined),
      sort: definition.sort,
      showIgnored: showIgnoredItems,
      rankedAssetIds,
      rankedPageSize,
      items,
      ...(source ? { similaritySourceAssetId: source.assetId } : {}),
    }));
    if (source) setFindSimilarSource(source);
  }
  return { showSemanticResults, executeSearchDefinition, assetRenameDialog, cancelAssetRename, openAssetRename, openInlineFolderCreate, inlineFolderEdit, changeInlineFolderEdit, commitInlineFolderEdit, cancelInlineFolderEdit, submitAssetRename, changeAssetRenameValue, applyFolderCoverFromLibrary, openInlineFolderRename, setEntityAppearance, chooseFolderCover, openFolderCoverLibraryPicker, clearFolderCover, useAssetAsFolderCover };
}
