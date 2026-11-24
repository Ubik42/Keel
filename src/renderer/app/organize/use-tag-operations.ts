import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { SearchQuery } from "../../../shared/asset-types";
import type { BrowseFirstPage } from "../../browse/use-browse-pagination";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { type AssetSummary, type FilterClause, type SearchScope, type SortDefinition, type TagSummary } from "../../../shared/asset-types";
import { type BrowseMembershipChange } from "../../filters/browse-filter-membership";
import { LibraryOperationError, toMessage } from "../../common/error-utils";
import { type LibraryViewSessionToken } from "../../library/library-view-session";
import { type SemanticSearchPageSize } from "../../ai/semantic-search-preferences";
import { type BrowseState } from "../../stores/browse-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { tagBrowseDefinition } from "../../tags/tag-browse-definition";
import { descendantTagIds } from "../../tags/tag-tree-model";
import { isTagDescendantsIncluded, saveTagDescendantsPreferences, withTagDescendantsIncluded } from "../../tags/tag-descendants-preferences";
import { navigationFields } from "../../stores/navigation-store";
import { BROWSE_PAGE_SIZE, registerBrowseSearchPage } from "../../browse/use-browse-pagination";
import { type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { type WorkspaceTabBrowseState } from "../../workspace/workspace-tabs";
import { type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface UseTagOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  beginWorkspaceNavigationRequest: (historyMode: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  ensureLibraryView: (libraryId: string) => LibraryViewSessionToken | null;
  managedImportTargetFolderIdRef: RefObject<string | undefined>;
  saveCurrentWorkspaceHistoryViewport: () => void;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  isCurrentLibraryView: (token: LibraryViewSessionToken) => boolean;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  showIgnoredItems: QueryState["showIgnoredItems"];
  closeContextMenu: () => void;
  resetBrowsePaginationPreservingVisibleLayout: () => void;
  skipDiscoveryReloadSignatureRef: RefObject<string | null>;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setShowTagManagement: Dispatch<SetStateAction<NavigationState["showTagManagement"]>>;
  setActivePluginSidebarViewId: Dispatch<SetStateAction<NavigationState["activePluginSidebarViewId"]>>;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  setAssetScope: Dispatch<SetStateAction<NavigationState["assetScope"]>>;
  clearAssetSelection: (options?: { preserveFolders?: boolean; }) => void;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setExcludeTagFilter: Dispatch<SetStateAction<QueryState["excludeTagFilter"]>>;
  setExcludedTagFilter: Dispatch<SetStateAction<QueryState["excludedTagFilter"]>>;
  setTagFilterMatch: Dispatch<SetStateAction<QueryState["tagFilterMatch"]>>;
  setSearchOffset: Dispatch<SetStateAction<BrowseState["searchOffset"]>>;
  applySearchResult: (result: { items: AssetSummary[]; total: number; offset: number; snippets?: Array<{ assetId: string; text: string; }>; }) => void;
  beginBrowsePageClearingSimilar: (definition: { kind: "search"; libraryId: string; query: SearchQuery | null; filters?: FilterClause[] | null; scope?: SearchScope | null; sort?: SortDefinition | null; showIgnored: boolean; sessionId?: string; target: "assets" | "trash"; pinnedOrder?: boolean; rankedAssetIds?: readonly string[]; rankedPageSize?: SemanticSearchPageSize; similaritySourceAssetId?: string; }, firstPage: BrowseFirstPage) => void;
  recordNavigation: (location: WorkspaceNavLocation, request: WorkspaceNavigationRequest) => void;
  finishWorkspaceNavigation: (request: WorkspaceNavigationRequest, viewport?: WorkspaceNavViewport) => void;
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  tags: NavigationState["tags"];
  createWorkspaceNavigationRequest: (request: WorkspaceNavigationRequest | undefined, historyMode?: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  acknowledgeWorkspaceNavigation: (location: WorkspaceNavLocation) => void;
  queryDefinitionForWorkspaceBrowseState: (state: WorkspaceTabBrowseState) => SearchDefinition;
  applyWorkspaceTabBrowseStateForNavigation: (request: WorkspaceNavigationRequest) => void;
  clearDiscoveryControls: () => void;
  setTagFilterExpression: Dispatch<SetStateAction<QueryState["tagFilterExpression"]>>;
  setTagFilterLastValidExpression: Dispatch<SetStateAction<QueryState["tagFilterLastValidExpression"]>>;
  setTagFilterMode: Dispatch<SetStateAction<QueryState["tagFilterMode"]>>;
  pinnedTagId: string | null;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
  activeTagId: NavigationState["activeTagId"];
  refreshTagAndMetadataState: (assetId: string) => Promise<void>;
  syncBrowseFilterMembershipRef: RefObject<(change: BrowseMembershipChange) => void>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  selectedAssetId: SelectionState["selectedAssetId"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useTagOperations({ api, library, beginWorkspaceNavigationRequest, ensureLibraryView, managedImportTargetFolderIdRef, saveCurrentWorkspaceHistoryViewport, closeAssetPreview, isCurrentLibraryView, currentQueryDefinition, showIgnoredItems, closeContextMenu, resetBrowsePaginationPreservingVisibleLayout, skipDiscoveryReloadSignatureRef, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setActiveTagId, setAssetScope, clearAssetSelection, setTagFilter, setExcludeTagFilter, setExcludedTagFilter, setTagFilterMatch, setSearchOffset, applySearchResult, beginBrowsePageClearingSimilar, recordNavigation, finishWorkspaceNavigation, setError, t, locale, setWorkspaceNavigationPending, setUiState, tags, createWorkspaceNavigationRequest, acknowledgeWorkspaceNavigation, queryDefinitionForWorkspaceBrowseState, applyWorkspaceTabBrowseStateForNavigation, clearDiscoveryControls, setTagFilterExpression, setTagFilterLastValidExpression, setTagFilterMode, pinnedTagId, setPinnedTagId, activeTagId, refreshTagAndMetadataState, syncBrowseFilterMembershipRef, setNotice, selectedAssetId }: UseTagOperationsDeps) {

  // tag-management AND/OR jump — leave management, scope to all
  // assets and apply the selected tag names as one OR clause (any) or one
  // clause per tag (all).
  async function handleSearchTagsFromManagement(
    tagNames: string[],
    match: "all" | "any",
  ) {
    if (!api || !library || tagNames.length === 0) return;
    const request = beginWorkspaceNavigationRequest("push");
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    managedImportTargetFolderIdRef.current = undefined;
    saveCurrentWorkspaceHistoryViewport();
    await closeAssetPreview(false);
    if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
    const joined = tagNames.join(", ");
    try {
      const definition = currentQueryDefinition({
        tagFilter: joined,
        tagFilterMatch: match,
        excludeTagFilter: false,
        excludedTagFilter: "",
      });
      const includeIgnored =
        request.browseState?.showIgnoredItems ?? showIgnoredItems;
      const result = await api.openBrowseSession({
        libraryId: targetLibraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        // first window only; scrollbar jumps fetch other offsets.
        limit: BROWSE_PAGE_SIZE,
        showIgnored: includeIgnored,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      closeContextMenu();
      resetBrowsePaginationPreservingVisibleLayout();
      skipDiscoveryReloadSignatureRef.current = JSON.stringify(definition);
      setShowTrash(false);
      setShowTagManagement(false);
      setActivePluginSidebarViewId(null);
      setActiveTagId(null);
      setAssetScope("all");
      clearAssetSelection();
      setTagFilter(joined);
      setExcludeTagFilter(false);
      setExcludedTagFilter("");
      setTagFilterMatch(match);
      setSearchOffset(0);
      api.setActiveContext(targetLibraryId);
      applySearchResult(result.value);
      registerBrowseSearchPage(beginBrowsePageClearingSimilar, {
        libraryId: targetLibraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        scope: null,
        showIgnored: includeIgnored,
        target: "assets",
        items: result.value.items,
        total: result.value.total,
        offset: result.value.offset,
        sessionId: result.value.sessionId,
        snippets: result.value.snippets,
      });
      recordNavigation({ kind: "all" }, request);
      finishWorkspaceNavigation(request);
    } catch (caught) {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) {
        setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
        setWorkspaceNavigationPending(false);
      }
    } finally {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) setUiState("ready");
    }
  }

  async function chooseTag(
    tagId: string,
    navigation?: WorkspaceNavigationRequest,
    tagCatalog: readonly TagSummary[] = tags,
  ) {
    if (!api || !library) return;
    const request = createWorkspaceNavigationRequest(navigation);
    if (!request.isCurrent()) return;
    if (request.historyMode === "push") saveCurrentWorkspaceHistoryViewport();
    const targetLibraryId = library.libraryId;
    const viewSession = ensureLibraryView(targetLibraryId);
    if (!viewSession) return;
    const tag = tagCatalog.find((candidate) => candidate.tagId === tagId);
    if (!tag) {
      setWorkspaceNavigationPending(false);
      return;
    }
    acknowledgeWorkspaceNavigation({ kind: "tag", tagId });
    await closeAssetPreview(false);
    if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
    try {
      const includeDescendants =
        descendantTagIds(tagCatalog, tagId).length > 1 &&
        isTagDescendantsIncluded(navigationFields.get("tagDescendantsPrefs"), targetLibraryId, tagId);
      const tagExpression = JSON.stringify(tag.name);
      const definition: SearchDefinition = request.browseState
        ? queryDefinitionForWorkspaceBrowseState(request.browseState)
        : tagBrowseDefinition(tag.name, currentQueryDefinition(), includeDescendants);
      const includeIgnored =
        request.browseState?.showIgnoredItems ?? showIgnoredItems;
      const result = await api.openBrowseSession({
        libraryId: targetLibraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        // first window only; scrollbar jumps fetch other offsets.
        limit: BROWSE_PAGE_SIZE,
        showIgnored: includeIgnored,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      if (!request.isCurrent() || !isCurrentLibraryView(viewSession)) return;
      managedImportTargetFolderIdRef.current = undefined;
      closeContextMenu();
      resetBrowsePaginationPreservingVisibleLayout();
      if (!request.browseState) {
        skipDiscoveryReloadSignatureRef.current = JSON.stringify(definition);
      }
      applyWorkspaceTabBrowseStateForNavigation(request);
      setShowTrash(false);
      setShowTagManagement(false);
      setActivePluginSidebarViewId(null);
      setActiveTagId(tagId);
      setAssetScope("all");
      clearAssetSelection();
      if (!request.browseState) {
        clearDiscoveryControls();
        setTagFilterExpression(tagExpression);
        setTagFilterLastValidExpression(tagExpression);
        setTagFilterMode("expression");
        setTagFilter(tag.name);
        setExcludeTagFilter(false);
        setExcludedTagFilter("");
        setTagFilterMatch("any");
      }
      setSearchOffset(0);
      api.setActiveContext(targetLibraryId);
      applySearchResult(result.value);
      registerBrowseSearchPage(beginBrowsePageClearingSimilar, {
        libraryId: targetLibraryId,
        query: definition.search ?? null,
        filters: definition.filters,
        sort: definition.sort,
        scope: null,
        showIgnored: includeIgnored,
        target: "assets",
        items: result.value.items,
        total: result.value.total,
        offset: result.value.offset,
        sessionId: result.value.sessionId,
        snippets: result.value.snippets,
      });
      setUiState("ready");
      recordNavigation({ kind: "tag", tagId }, request);
      if (!request.deferReveal) finishWorkspaceNavigation(request);
    } catch (caught) {
      if (request.isCurrent() && isCurrentLibraryView(viewSession)) {
        setError(toMessage(caught, t("toast.readTagAssetsFailed"), locale));
        setWorkspaceNavigationPending(false);
        setUiState("ready");
      }
    }
  }

  /** Switches the active tag between "with child tags" and "this tag only". */
  async function toggleTagDescendants() {
    if (!library || !activeTagId) return;
    const prefs = navigationFields.get("tagDescendantsPrefs");
    const next = withTagDescendantsIncluded(
      prefs,
      library.libraryId,
      activeTagId,
      !isTagDescendantsIncluded(prefs, library.libraryId, activeTagId),
    );
    navigationFields.setterFor("tagDescendantsPrefs")(next);
    saveTagDescendantsPreferences(next);
    await chooseTag(activeTagId, createWorkspaceNavigationRequest(undefined, "none"));
  }

  async function togglePinnedTag(tagId: string) {
    if (pinnedTagId === tagId) {
      setPinnedTagId(null);
      if (!activeTagId) {
        setTagFilter(""); setTagFilterExpression(""); setTagFilterLastValidExpression("");
        setExcludeTagFilter(false); setExcludedTagFilter("");
      }
      return;
    }
    await chooseTag(tagId);
    setPinnedTagId(tagId);
  }

  async function assignAssetToTag(assetId: string, tagId: string) {
    if (!api || !library) return;
    try {
      const result = await api.assignTags({
        libraryId: library.libraryId,
        assetIds: [assetId],
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await refreshTagAndMetadataState(assetId);
      const tagName = tags.find((tag) => tag.tagId === tagId)?.name;
      if (tagName) {
        syncBrowseFilterMembershipRef.current({
          kind: "tags",
          assetIds: [assetId],
          addedTagNames: [tagName],
          removedTagNames: [],
        });
      }
      setNotice(t("toast.tagAdded"), result.value.historyEntryId);
    } catch (caught) {
      setError(toMessage(caught, t("toast.addTagFailed"), locale));
    }
  }

  async function handleRemoveTagFromAsset(tagId: string) {
    if (!api || !library || !selectedAssetId) return;
    const targetAssetId = selectedAssetId;
    try {
      const result = await api.removeTags({
        libraryId: library.libraryId,
        assetIds: [targetAssetId],
        tagIds: [tagId],
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      await refreshTagAndMetadataState(targetAssetId);
      const tagName = tags.find((tag) => tag.tagId === tagId)?.name;
      if (tagName) {
        syncBrowseFilterMembershipRef.current({
          kind: "tags",
          assetIds: [targetAssetId],
          addedTagNames: [],
          removedTagNames: [tagName],
        });
      }
      setNotice(t("toast.tagRemoved"), result.value.historyEntryId);
    } catch (caught) {
      setError(toMessage(caught, t("toast.removeTagFailed"), locale));
    }
  }

  async function handleCreateAndAssignTag(tagName: string) {
    if (!api || !library || !selectedAssetId || !tagName.trim()) return;
    const targetAssetId = selectedAssetId;
    try {
      const createResult = await api.createTag({
        libraryId: library.libraryId,
        name: tagName.trim(),
      });
      if (!createResult.ok) throw new LibraryOperationError(createResult.error);
      const assignResult = await api.assignTags({
        libraryId: library.libraryId,
        assetIds: [targetAssetId],
        tagIds: [createResult.value.tagId],
      });
      if (!assignResult.ok) throw new LibraryOperationError(assignResult.error);
      await refreshTagAndMetadataState(targetAssetId);
      syncBrowseFilterMembershipRef.current({
        kind: "tags",
        assetIds: [targetAssetId],
        addedTagNames: [tagName.trim()],
        removedTagNames: [],
      });
      setNotice(
        t("toast.tagCreatedAssigned", { name: tagName.trim() }),
        assignResult.value.historyEntryId,
      );
    } catch (caught) {
      setError(toMessage(caught, t("toast.createTagFailed"), locale));
    }
  }
  return { chooseTag, toggleTagDescendants, assignAssetToTag, handleRemoveTagFromAsset, handleCreateAndAssignTag, togglePinnedTag, handleSearchTagsFromManagement };
}
