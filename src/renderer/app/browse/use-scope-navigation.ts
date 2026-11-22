import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { type AssetMetadataResult, type SearchScope, type TagSummary } from "../../../shared/asset-types";
import { type EntityAppearance as TagAppearance } from "../../../shared/entity-appearance";
import { type RendererLibrarySummary } from "../../../shared/protocol/responses";
import { type BrowseMembershipChange } from "../../browse-filter-membership";
import { LibraryOperationError, toMessage } from "../../error-utils";
import { isFolderRecursiveEnabled } from "../../folder-recursive-preferences";
import { type LibraryViewSessionToken } from "../../library-view-session";
import { type BrowseState } from "../../stores/browse-store";
import { type InspectorState } from "../../stores/inspector-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { tagRenameError } from "../../tag-rename-error";
import { type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { type WorkspaceTabBrowseState } from "../../workspace-tabs";
import { type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";
import { folderRecursiveRef } from "../shared/app-shared";

export interface UseScopeNavigationDeps {
  library: SessionState["library"];
  createWorkspaceNavigationRequest: (request: WorkspaceNavigationRequest | undefined, historyMode?: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  saveCurrentWorkspaceHistoryViewport: () => void;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  activeTagId: NavigationState["activeTagId"];
  pinnedTagId: string | null;
  captureWorkspaceTabBrowseState: () => WorkspaceTabBrowseState;
  folderRecursivePrefs: NavigationState["folderRecursivePrefs"];
  acknowledgeWorkspaceNavigation: (location: WorkspaceNavLocation) => void;
  setFolderRecursive: Dispatch<SetStateAction<NavigationState["folderRecursive"]>>;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  showIgnoredItems: QueryState["showIgnoredItems"];
  queryDefinitionForWorkspaceBrowseState: (state: WorkspaceTabBrowseState) => SearchDefinition;
  queryDefinitionForNavigationRequest: (request: WorkspaceNavigationRequest) => SearchDefinition;
  assetScope: NavigationState["assetScope"];
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  resetBrowsePaginationPreservingVisibleLayout: () => void;
  applyWorkspaceTabBrowseStateForNavigation: (request: WorkspaceNavigationRequest) => void;
  closeContextMenu: () => void;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setShowTagManagement: Dispatch<SetStateAction<NavigationState["showTagManagement"]>>;
  setActivePluginSidebarViewId: Dispatch<SetStateAction<NavigationState["activePluginSidebarViewId"]>>;
  setAssetScope: Dispatch<SetStateAction<NavigationState["assetScope"]>>;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setTagFilterExpression: Dispatch<SetStateAction<QueryState["tagFilterExpression"]>>;
  setTagFilterLastValidExpression: Dispatch<SetStateAction<QueryState["tagFilterLastValidExpression"]>>;
  setExcludeTagFilter: Dispatch<SetStateAction<QueryState["excludeTagFilter"]>>;
  setExcludedTagFilter: Dispatch<SetStateAction<QueryState["excludedTagFilter"]>>;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  resetDiscoveryIfNavigationReplacesLive: (request: WorkspaceNavigationRequest) => void;
  api: KeelLibraryApi | undefined;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  recordNavigation: (location: WorkspaceNavLocation, request: WorkspaceNavigationRequest) => void;
  finishWorkspaceNavigation: (request: WorkspaceNavigationRequest, viewport?: WorkspaceNavViewport) => void;
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
  chooseFolderRef: RefObject<(scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; }) => Promise<void>>;
  showTrash: NavigationState["showTrash"];
  setTrashBrowseTombstoneId: Dispatch<SetStateAction<BrowseState["trashBrowseTombstoneId"]>>;
  setTags: Dispatch<SetStateAction<NavigationState["tags"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  metadataByAssetRef: RefObject<Map<string, { assetId: string; description: string | null; rating: number; favorite: boolean; palette: string | null; automaticPalette: { hex: string; ratio: number; }[]; effectivePalette: string[]; paletteSource: "manual" | "automatic" | null; sourcePageUrl: string | null; author: string | null; tags: { id: string; name: string; source: "user" | "ai"; }[]; entityVersion: number; updatedAt: string; companions?: { assetId: string; fileName: string; }[] | undefined; }>>;
  setAssetMetadata: Dispatch<SetStateAction<InspectorState["assetMetadata"]>>;
  selectedAssetIds: SelectionState["selectedAssetIds"];
  rebuildAndApplyMultiEdit: (assetIds: readonly string[]) => void;
  chooseTag: (tagId: string, navigation?: WorkspaceNavigationRequest, tagCatalog?: readonly TagSummary[]) => Promise<void>;
  tags: NavigationState["tags"];
  refreshTagAndMetadataState: (assetId: string) => Promise<void>;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useScopeNavigation({ library, createWorkspaceNavigationRequest, saveCurrentWorkspaceHistoryViewport, ensureLibraryView, activeTagId, pinnedTagId, captureWorkspaceTabBrowseState, folderRecursivePrefs, acknowledgeWorkspaceNavigation, setFolderRecursive, managedImportTargetFolderIdRef, closeAssetPreview, isCurrentLibraryView, loadContent, showIgnoredItems, queryDefinitionForWorkspaceBrowseState, queryDefinitionForNavigationRequest, assetScope, setWorkspaceNavigationPending, resetBrowsePaginationPreservingVisibleLayout, applyWorkspaceTabBrowseStateForNavigation, closeContextMenu, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setAssetScope, setTagFilter, setTagFilterExpression, setTagFilterLastValidExpression, setExcludeTagFilter, setExcludedTagFilter, setPinnedTagId, clearAssetSelection, setActiveTagId, resetDiscoveryIfNavigationReplacesLive, api, setUiState, recordNavigation, finishWorkspaceNavigation, setError, t, locale, chooseFolderRef, showTrash, setTrashBrowseTombstoneId, setTags, setNotice, metadataByAssetRef, setAssetMetadata, selectedAssetIds, rebuildAndApplyMultiEdit, chooseTag, tags, refreshTagAndMetadataState, syncBrowseFilterMembershipRef }: UseScopeNavigationDeps) {

  async function chooseFolder(
    scope: AssetScope,
    options?: {
      refreshSidebar?: boolean;
      blockingNavigation?: boolean;
      navigation?: WorkspaceNavigationRequest;
    },
  ) {
    if (!library) return;
    const request = createWorkspaceNavigationRequest(options?.navigation);
    if (!request.isCurrent()) return;
    if (request.historyMode === "push") saveCurrentWorkspaceHistoryViewport();
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    const folderId = scope === "all" || scope === "root" ? undefined : scope;
    const leavingTagBrowse = !request.browseState && activeTagId !== null && pinnedTagId !== activeTagId;
    const folderBrowseState = captureWorkspaceTabBrowseState();
    if (leavingTagBrowse) {
      folderBrowseState.filters = { ...folderBrowseState.filters, pinnedTagId: null,
        tagFilter: "", tagFilterExpression: "", tagFilterLastValidExpression: "",
        excludeTagFilter: false, excludedTagFilter: "" };
    }
    const recursive = request.browseState
      ? request.browseState.folderRecursive
      : scope !== "all" && scope !== "root"
        ? isFolderRecursiveEnabled(folderRecursivePrefs, targetLibraryId, scope)
        : false;
    acknowledgeWorkspaceNavigation(
      scope === "all"
        ? { kind: "all" }
        : scope === "root"
          ? { kind: "root" }
          : { kind: "folder", folderId: scope },
    );
    folderRecursiveRef.current = recursive;
    setFolderRecursive(recursive);
    managedImportTargetFolderIdRef.current = folderId;
    let commitPreparedContent: (() => void) | undefined;
    try {
      // REQ-VIEW-004: leave the browse affiliate viewer when the browse scope changes.
      await closeAssetPreview(false);
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      await loadContent({ ...library, libraryId: targetLibraryId }, scope, {
        showIgnored: request.browseState?.showIgnoredItems ?? showIgnoredItems,
        folderRecursive: recursive,
        discovery: leavingTagBrowse ? queryDefinitionForWorkspaceBrowseState(folderBrowseState) : queryDefinitionForNavigationRequest(request),
        // Ordinary navigation keeps sidebar queries out of the hot path for
        // large libraries. A destructive mutation that removed the current
        // folder opts in once so the deleted row cannot remain visible.
        refreshSidebar:
          options?.refreshSidebar ??
          (scope === "all" || scope === "root" || scope === assetScope),
        blockingLibraryLoad: options?.blockingNavigation,
        navigationIsCurrent: request.isCurrent,
        deferCommit: true,
        onPrepared: (commit) => {
          commitPreparedContent = commit;
        },
      });
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      if (!commitPreparedContent) {
        setWorkspaceNavigationPending(false);
        return;
      }

      // Commit the prepared browse page and its route in one React batch. The
      // old committed canvas remains untouched while Worker reads are pending.
      resetBrowsePaginationPreservingVisibleLayout();
      commitPreparedContent();
      applyWorkspaceTabBrowseStateForNavigation(request);
      closeContextMenu();
      setShowTrash(false);
      setShowTagManagement(false);
      setActivePluginSidebarViewId(null);
      setAssetScope(scope);
      if (leavingTagBrowse) {
        setTagFilter(""); setTagFilterExpression(""); setTagFilterLastValidExpression("");
        setExcludeTagFilter(false); setExcludedTagFilter(""); setPinnedTagId(null);
      }
      folderRecursiveRef.current = recursive;
      setFolderRecursive(recursive);
      clearAssetSelection();
      setActiveTagId(null);
      resetDiscoveryIfNavigationReplacesLive(request);
      managedImportTargetFolderIdRef.current = folderId;
      api?.setActiveContext(targetLibraryId, folderId);
      setUiState("ready");
      recordNavigation(
        scope === "all"
          ? { kind: "all" }
          : scope === "root"
            ? { kind: "root" }
            : { kind: "folder", folderId: scope },
        request,
      );
      if (!request.deferReveal) finishWorkspaceNavigation(request);
    } catch (caught) {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) {
        setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
        setWorkspaceNavigationPending(false);
        setUiState("ready");
      }
    }
  }
  chooseFolderRef.current = chooseFolder;

  async function enterTrash() {
    await enterTrashAt(null);
  }

  async function enterTrashAt(
    tombstoneId: string | null,
    navigation?: WorkspaceNavigationRequest,
  ) {
    if (!library) return;
    const request = createWorkspaceNavigationRequest(navigation);
    if (!request.isCurrent()) return;
    if (request.historyMode === "push") saveCurrentWorkspaceHistoryViewport();
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    acknowledgeWorkspaceNavigation({ kind: "trash", tombstoneId });
    await closeAssetPreview(false);
    if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
    if (showTrash && !request.deferReveal) {
      managedImportTargetFolderIdRef.current = undefined;
      setTrashBrowseTombstoneId(tombstoneId);
      clearAssetSelection();
      recordNavigation({ kind: "trash", tombstoneId }, request);
      if (!request.deferReveal) finishWorkspaceNavigation(request);
      return;
    }
    let commitPreparedContent: (() => void) | undefined;
    try {
      managedImportTargetFolderIdRef.current = undefined;
      await loadContent({ ...library, libraryId: targetLibraryId }, "all", {
        trashMode: true,
        showIgnored: request.browseState?.showIgnoredItems ?? showIgnoredItems,
        // Trash browse renders folder tombstone cards from the sidebar query;
        // unlike ordinary folder navigation, this transition must refresh
        // that list after a destructive mutation.
        refreshSidebar: true,
        discovery: queryDefinitionForNavigationRequest(request),
        navigationIsCurrent: request.isCurrent,
        deferCommit: true,
        onPrepared: (commit) => {
          commitPreparedContent = commit;
        },
      });
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      if (!commitPreparedContent) {
        setWorkspaceNavigationPending(false);
        return;
      }
      resetBrowsePaginationPreservingVisibleLayout();
      commitPreparedContent();
      applyWorkspaceTabBrowseStateForNavigation(request);
      setShowTrash(true);
      setTrashBrowseTombstoneId(tombstoneId);
      setShowTagManagement(false);
      setActivePluginSidebarViewId(null);
      setActiveTagId(null);
      resetDiscoveryIfNavigationReplacesLive(request);
      clearAssetSelection();
      setAssetScope("all");
      api?.setActiveContext(targetLibraryId);
      setUiState("ready");
      recordNavigation({ kind: "trash", tombstoneId }, request);
      if (!request.deferReveal) finishWorkspaceNavigation(request);
    } catch (caught) {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) {
        setError(toMessage(caught, t("toast.readTrashFailed"), locale));
        setWorkspaceNavigationPending(false);
        setUiState("ready");
      }
    }
  }

  async function enterTagManagement(navigation?: WorkspaceNavigationRequest) {
    if (!library) return;
    const request = createWorkspaceNavigationRequest(navigation);
    if (!request.isCurrent()) return;
    if (request.historyMode === "push") saveCurrentWorkspaceHistoryViewport();
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    try {
      await closeAssetPreview(false);
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      if (!api) {
        setWorkspaceNavigationPending(false);
        return;
      }
      const tagResult = await api.listTags({ libraryId: targetLibraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      managedImportTargetFolderIdRef.current = undefined;
      closeContextMenu();
      setTags(tagResult.value);
      applyWorkspaceTabBrowseStateForNavigation(request);
      setShowTagManagement(true);
      setActivePluginSidebarViewId(null);
      setShowTrash(false);
      setActiveTagId(null);
      setAssetScope("all");
      clearAssetSelection();
      resetDiscoveryIfNavigationReplacesLive(request);
      api.setActiveContext(targetLibraryId);
      setUiState("ready");
      recordNavigation({ kind: "tag-management" }, request);
      if (!request.deferReveal) finishWorkspaceNavigation(request);
    } catch (caught) {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) {
        setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
        if (request.deferReveal) setWorkspaceNavigationPending(false);
      }
    } finally {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) setUiState("ready");
    }
  }

  async function enterPluginSidebarView(
    viewId: string,
    navigation?: WorkspaceNavigationRequest,
  ) {
    if (!library) return;
    const request = createWorkspaceNavigationRequest(navigation);
    if (!request.isCurrent()) return;
    if (request.historyMode === "push") saveCurrentWorkspaceHistoryViewport();
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    await closeAssetPreview(false);
    if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
    managedImportTargetFolderIdRef.current = undefined;
    closeContextMenu();
    applyWorkspaceTabBrowseStateForNavigation(request);
    setShowTrash(false);
    setShowTagManagement(false);
    setActivePluginSidebarViewId(viewId);
    setAssetScope("all");
    clearAssetSelection();
    setActiveTagId(null);
    resetDiscoveryIfNavigationReplacesLive(request);
    api?.setActiveContext(targetLibraryId);
    recordNavigation({ kind: "plugin-sidebar", viewId }, request);
    if (!request.deferReveal) finishWorkspaceNavigation(request);
  }

  async function handleCreateTagInManagement(name: string, parentTagId?: string | null): Promise<boolean> {
    if (!api || !library) return false;
    try {
      const result = await api.createTag({
        libraryId: library.libraryId,
        name,
        parentTagId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(t("toast.tagCreated", { name }), result.value.historyEntryId);
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
      return false;
    }
  }

  async function handleRenameTagInManagement(
    tagId: string,
    name: string,
    appearance?: TagAppearance | null,
  ): Promise<boolean> {
    if (!api || !library) return false;
    try {
      const result = await api.renameTag({
        libraryId: library.libraryId,
        tagId,
        name,
        appearance,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      const rename = (metadata: AssetMetadataResult) => ({ ...metadata,
        tags: metadata.tags.map(tag => tag.id === tagId ? { ...tag, name } : tag),
      });
      for (const [id, metadata] of metadataByAssetRef.current) {
        metadataByAssetRef.current.set(id, rename(metadata));
      }
      setAssetMetadata(current => current ? rename(current) : current);
      if (selectedAssetIds.length >= 2) rebuildAndApplyMultiEdit(selectedAssetIds);
      if (activeTagId) await chooseTag(activeTagId, undefined, tagResult.value);
      setNotice(appearance === undefined ? t("toast.tagRenamed", { name }) : t("tagTree.appearanceSaved"), result.value.historyEntryId);
      return true;
    } catch (caught) {
      setError(tagRenameError(caught, locale));
      return false;
    }
  }

  async function handleDeleteTagsInManagement(
    tagIds: string[],
  ): Promise<boolean> {
    if (!api || !library || tagIds.length === 0) return false;
    try {
      const result =
        tagIds.length === 1
          ? await api.deleteTag({
              libraryId: library.libraryId,
              tagId: tagIds[0]!,
            })
          : await api.deleteTags({ libraryId: library.libraryId, tagIds });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      if (activeTagId) {
        if (tagIds.includes(activeTagId)) await chooseFolder('all');
        else await chooseTag(activeTagId, undefined, tagResult.value);
      }
      setNotice(
        tagIds.length === 1
          ? t("toast.tagDeleted")
          : t("toast.tagsDeleted", { count: tagIds.length }),
        result.value.historyEntryId,
      );
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.deleteTagFailed"), locale));
      return false;
    }
  }

  async function handleMergeTagsInManagement(
    tagIds: string[],
    name: string,
  ): Promise<boolean> {
    if (!api || !library || tagIds.length < 2 || !name.trim()) return false;
    try {
      const result = await api.mergeTags({
        libraryId: library.libraryId,
        sourceTagIds: tagIds,
        name: name.trim(),
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const tagResult = await api.listTags({ libraryId: library.libraryId });
      if (!tagResult.ok) throw new LibraryOperationError(tagResult.error);
      setTags(tagResult.value);
      setNotice(t("toast.tagMerged", { name: name.trim() }), result.value.historyEntryId);
      return true;
    } catch (caught) {
      setError(toMessage(caught, t("toast.mergeTagsFailed"), locale));
      return false;
    }
  }

  async function moveTagInTree(tagId: string, parentTagId: string | null): Promise<boolean> {
    const tag = tags.find((item) => item.tagId === tagId);
    if (!api || !library || !tag) return false;
    try {
      const result = await api.renameTag({ libraryId: library.libraryId, tagId, name: tag.name, parentTagId });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const updated = await api.listTags({ libraryId: library.libraryId });
      if (!updated.ok) throw new LibraryOperationError(updated.error);
      setTags(updated.value);
      if (activeTagId) await chooseTag(activeTagId, undefined, updated.value);
      setNotice(t('tagTree.moved'), result.value.historyEntryId);
      return true;
    } catch (caught) { setError(toMessage(caught, t('tagTree.moveFailed'), locale)); return false; }
  }

  async function assignAssetsToTreeTag(assetIds: string[], tagId: string): Promise<void> {
    if (!api || !library || assetIds.length === 0) return;
    try {
      const result = await api.assignTags({ libraryId: library.libraryId, assetIds, tagIds: [tagId] });
      if (!result.ok) throw new LibraryOperationError(result.error);
      for (const id of assetIds) metadataByAssetRef.current.delete(id);
      await refreshTagAndMetadataState(assetIds[0]!);
      const name = tags.find((tag) => tag.tagId === tagId)?.name;
      if (name) syncBrowseFilterMembershipRef.current({ kind: 'tags', assetIds, addedTagNames: [name], removedTagNames: [] });
      setNotice(t('toast.tagAdded'), result.value.historyEntryId);
    } catch (caught) { setError(toMessage(caught, t('tagTree.assignFailed'), locale)); }
  }
  return { chooseFolder, enterTrashAt, enterTagManagement, enterPluginSidebarView, handleCreateTagInManagement, handleRenameTagInManagement, moveTagInTree, handleDeleteTagsInManagement, assignAssetsToTreeTag, enterTrash, handleMergeTagsInManagement };
}
