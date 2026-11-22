import type { Dispatch, RefObject, SetStateAction } from "react";
import type { EmbeddingHttpServiceSummary, KeelLibraryApi } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import type { WorkspaceTabsState } from "../../workspace-tabs";
import { type AssetSummary, type SearchScope, type SortDefinition } from "../../../shared/asset-types";
import { isEmbeddingServiceSelectionId } from "../../../shared/embedding/http-service";
import { LOCAL_SEMANTIC_ENCODE_MODALITIES, embeddingInputModalitiesForAdapter, embeddingServiceTextOnly } from "../../../shared/embedding/modalities";
import { isSemanticSearchModelId } from "../../../shared/embedding/profile";
import { resolveAssetCardCoverUrl } from "../../asset-card-hover-preview";
import { LibraryOperationError, toMessage } from "../../error-utils";
import { canFindSimilarForAsset, resolveFindSimilar, type FindSimilarSource } from "../../find-similar";
import { currentScopeShowsRevealAssets, pendingRevealFromAssets, sharedBrowseScopeForAssets, type PendingAssetReveal } from "../../pending-asset-reveal";
import { parseSearchExpressionDetailed } from "../../search-expression";
import { rememberSearchQuery } from "../../search-history";
import { mergeKeywordAndSemanticRanks } from "../../semantic-browse";
import { semanticSearchNotice } from "../../semantic-index-copy";
import { loadSemanticSearchPreferences, type SemanticSearchPageSize } from "../../semantic-search-preferences";
import { browseFields, type BrowseState } from "../../stores/browse-store";
import { type DialogsState } from "../../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { selectionFields } from "../../stores/selection-store";
import { sessionFields, type SessionState } from "../../stores/session-store";
import { fetchFirstRankedBrowsePage } from "../../use-browse-pagination";
import { type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { captureWorkspaceNavViewport } from "../../workbench/workspace/workspace-scroll-position";
import { type QueryFilterSnapshot, type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";
import { type FormEvent, useEffect } from "react";

export interface UseSearchOperationsDeps {
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  previewAssetRef: RefObject<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; } | null>;
  previewRestoringRef: RefObject<boolean>;
  embeddingSelectionRef: RefObject<string | null>;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  currentSearchScope: (recursivelySearchFolders?: boolean) => SearchScope | undefined;
  beginWorkspaceNavigationRequest: (historyMode: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  showIgnoredItems: QueryState["showIgnoredItems"];
  embeddingService: EmbeddingHttpServiceSummary | null;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  showSemanticResults: (items: AssetSummary[], rankedAssetIds: readonly string[], rankedPageSize: SemanticSearchPageSize, source?: FindSimilarSource) => void;
  setError: (text: string | null) => void;
  locale: AppLocale;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  workspaceTabsState: WorkspaceTabsState;
  findSimilarTokenRef: RefObject<number>;
  recordNavigation: (location: WorkspaceNavLocation, request: WorkspaceNavigationRequest) => void;
  finishWorkspaceNavigation: (request: WorkspaceNavigationRequest, viewport?: WorkspaceNavViewport) => void;
  searchValue: QueryState["searchValue"];
  tagFilterMode: QueryState["tagFilterMode"];
  tagFilterExpression: QueryState["tagFilterExpression"];
  searchHistoryDismissedUntilInputRef: RefObject<boolean>;
  setSearchHistoryOpen: Dispatch<SetStateAction<DialogsState["searchHistoryOpen"]>>;
  setSearchHistoryActiveIndex: Dispatch<SetStateAction<QueryState["searchHistoryActiveIndex"]>>;
  executeSearchDefinition: (definition: SearchDefinition, navigation?: WorkspaceNavigationRequest, reloadViewport?: WorkspaceNavViewport) => Promise<{ sessionId: string; libraryGeneration: number; changeSequence: number; catalogSequence?: number; snapshotGeneration?: number | null; queryFingerprint: string; items: AssetSummary[]; total: number; offset: number; snippets?: { assetId: string; text: string; }[]; } | undefined>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  colorFilter: QueryState["colorFilter"];
  formatFilter: QueryState["formatFilter"];
  tagFilter: QueryState["tagFilter"];
  ratingFilter: QueryState["ratingFilter"];
  favoriteFilter: QueryState["favoriteFilter"];
  sourceUrlFilter: QueryState["sourceUrlFilter"];
  availabilityFilter: QueryState["availabilityFilter"];
  widthRange: QueryState["widthRange"];
  heightRange: QueryState["heightRange"];
  aspectRatioRange: QueryState["aspectRatioRange"];
  aspectRatioRanges: QueryState["aspectRatioRanges"];
  durationRange: QueryState["durationRange"];
  longEdgeRange: QueryState["longEdgeRange"];
  sortField: QueryState["sortField"];
  sortOrder: QueryState["sortOrder"];
  skipDiscoveryReloadSignatureRef: RefObject<string | null>;
  hadDiscoveryInput: RefObject<boolean>;
  showTrash: NavigationState["showTrash"];
  showTagManagement: NavigationState["showTagManagement"];
  showPluginSidebarView: boolean;
  publishSearchHistory: (queries: string[]) => void;
  excludeColorFilter: QueryState["excludeColorFilter"];
  colorSimilarity: QueryState["colorSimilarity"];
  excludeFormatFilter: QueryState["excludeFormatFilter"];
  tagFilterLastValidExpression: QueryState["tagFilterLastValidExpression"];
  excludeTagFilter: QueryState["excludeTagFilter"];
  excludedTagFilter: QueryState["excludedTagFilter"];
  includeAiTagFilter: QueryState["includeAiTagFilter"];
  excludeRatingFilter: QueryState["excludeRatingFilter"];
  includeAiRatingFilter: QueryState["includeAiRatingFilter"];
  excludeAvailabilityFilter: QueryState["excludeAvailabilityFilter"];
  loadAiContentForAssetRef: RefObject<(assetId: string) => Promise<void>>;
  loadAiContentForAsset: (assetId: string) => Promise<void>;
  rebuildAndApplyMultiEditRef: RefObject<(ids: string[]) => void>;
  rebuildAndApplyMultiEdit: (assetIds: readonly string[]) => void;
  refreshAfterAiRef: RefObject<(assetId: string) => Promise<void>>;
  refreshTagAndMetadataState: (assetId: string) => Promise<void>;
  setFolderBrowseRefreshToken: Dispatch<SetStateAction<BrowseState["folderBrowseRefreshToken"]>>;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  pendingRevealRef: RefObject<PendingAssetReveal | null>;
  assetScope: NavigationState["assetScope"];
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  revealAfterImportRef: RefObject<(completion: { assets: AssetSummary[]; }) => Promise<void>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useSearchOperations({ api, library, previewAssetRef, previewRestoringRef, embeddingSelectionRef, currentQueryDefinition, currentSearchScope, beginWorkspaceNavigationRequest, closeAssetPreview, showIgnoredItems, embeddingService, setNotice, t, showSemanticResults, setError, locale, setWorkspaceNavigationPending, setUiState, workspaceTabsState, findSimilarTokenRef, recordNavigation, finishWorkspaceNavigation, searchValue, tagFilterMode, tagFilterExpression, searchHistoryDismissedUntilInputRef, setSearchHistoryOpen, setSearchHistoryActiveIndex, executeSearchDefinition, workspaceCanvasRef, colorFilter, formatFilter, tagFilter, ratingFilter, favoriteFilter, sourceUrlFilter, availabilityFilter, widthRange, heightRange, aspectRatioRange, aspectRatioRanges, durationRange, longEdgeRange, sortField, sortOrder, skipDiscoveryReloadSignatureRef, hadDiscoveryInput, showTrash, showTagManagement, showPluginSidebarView, publishSearchHistory, excludeColorFilter, colorSimilarity, excludeFormatFilter, tagFilterLastValidExpression, excludeTagFilter, excludedTagFilter, includeAiTagFilter, excludeRatingFilter, includeAiRatingFilter, excludeAvailabilityFilter, loadAiContentForAssetRef, loadAiContentForAsset, rebuildAndApplyMultiEditRef, rebuildAndApplyMultiEdit, refreshAfterAiRef, refreshTagAndMetadataState, setFolderBrowseRefreshToken, reloadCurrentContent, pendingRevealRef, assetScope, chooseFolder, revealAfterImportRef }: UseSearchOperationsDeps) {

  async function runSemanticSearch(query: string, silent?: boolean, cancellationRetry = 0) {
    if (!api || !library) return;
    if (silent && (previewAssetRef.current || previewRestoringRef.current)) return;
    const modelId = embeddingSelectionRef.current;
    if (!modelId) return;
    const searchPreferences = loadSemanticSearchPreferences();
    const pageSize = searchPreferences.pageSize;
    const definition = currentQueryDefinition();
    const searchScope = currentSearchScope(definition.search !== undefined);
    const request = silent
      ? { isCurrent: () => true }
      : beginWorkspaceNavigationRequest("none");
    try {
      if (!silent) await closeAssetPreview(false);
      if (!request.isCurrent()) return;
      const [ranked, keyword] = await Promise.all([
        api.embeddingSearch({
          libraryId: library.libraryId,
          modelId,
          query,
          filters: definition.filters,
          scope: searchScope,
          showIgnored: showIgnoredItems,
        }),
        api.searchAssets({
          libraryId: library.libraryId,
          query: definition.search ?? null,
          filters: definition.filters,
          scope: searchScope,
          idsOnly: true,
          showIgnored: showIgnoredItems,
        }),
      ]);
      if (!request.isCurrent()) return;
      if (!ranked.ok) throw new LibraryOperationError(ranked.error);
      if (ranked.value.cancelled) {
        if (cancellationRetry < 1 && request.isCurrent()) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
          if (request.isCurrent()) await runSemanticSearch(query, silent, cancellationRetry + 1);
        }
        return;
      }
      const keywordAssetIds = keyword.ok ? (keyword.value.assetIds ?? []) : [];
      const rankedAssetIds = mergeKeywordAndSemanticRanks({
        keywordAssetIds,
        semanticAssetIds: ranked.value.assetIds,
      });
      if (rankedAssetIds.length === 0) {
        const notice = semanticSearchNotice({
          ...ranked.value,
          matched: 0,
          textOnly: isEmbeddingServiceSelectionId(modelId) && embeddingServiceTextOnly(embeddingService?.modalities),
        });
        setNotice(t(notice.key, notice.params));
        if (ranked.value.phase === "ready") {
          showSemanticResults([], [], pageSize);
        }
        return;
      }
      const firstPage = await fetchFirstRankedBrowsePage({
        api,
        libraryId: library.libraryId,
        rankedAssetIds,
        pageSize,
        shouldContinue: () => request.isCurrent(),
      });
      if (!request.isCurrent() || !firstPage) return;
      if (!firstPage.ok) throw new LibraryOperationError(firstPage.error);
      showSemanticResults(
        firstPage.value.items,
        firstPage.value.rankedAssetIds,
        pageSize,
      );
      setNotice(null);
    } catch (caught) {
      if (request.isCurrent()) {
        if (sessionFields.get("workerRecoveryState") === 'ready') setError(toMessage(caught, t("toast.searchFailed"), locale));
        if (!silent) setWorkspaceNavigationPending(false);
      }
    } finally {
      if (request.isCurrent()) setUiState("ready");
    }
  }

  async function describeSimilarSource(assetId: string): Promise<FindSimilarSource | null> {
    if (!api || !library) return null;
    const known = browseFields.get("assets").find((asset) => asset.assetId === assetId);
    const listed = known
      ? null
      : await api.listAssets({
          libraryId: library.libraryId,
          recursive: true,
          assetIds: [assetId],
        });
    if (listed && !listed.ok) throw new LibraryOperationError(listed.error);
    const asset = known ?? listed?.value[0];
    const coverUrl = asset
      ? resolveAssetCardCoverUrl({
          libraryId: library.libraryId,
          assetId: asset.assetId,
          mediaType: asset.mediaType,
          availability: asset.availability,
          deletedAt: asset.deletedAt,
          thumbnailStatus: asset.thumbnailStatus,
          thumbnailArtifactId: asset.thumbnailArtifactId,
        }).url
      : null;
    return {
      libraryId: library.libraryId,
      workspaceTabId: workspaceTabsState.activeTabId,
      assetId,
      displayName: asset?.displayName ?? "",
      coverUrl,
    };
  }

  async function runFindSimilar(
    assetId: string,
    navigation?: WorkspaceNavigationRequest,
  ) {
    if (!api || !library) return;
    const modelId = embeddingSelectionRef.current;
    if (!modelId) return;
    let source = browseFields.get("assets").find((asset) => asset.assetId === assetId);
    if (!source) {
      const listed = await api.listAssets({ libraryId: library.libraryId, recursive: true, assetIds: [assetId] });
      if (!listed.ok) return;
      source = listed.value[0];
    }
    const sourceModalities = isSemanticSearchModelId(modelId)
      ? LOCAL_SEMANTIC_ENCODE_MODALITIES
      : embeddingService
        ? embeddingInputModalitiesForAdapter(embeddingService.adapter, embeddingService.modalities)
        : [];
    if (!source || !canFindSimilarForAsset(source, sourceModalities)) return;
    const preferences = loadSemanticSearchPreferences();
    const token = ++findSimilarTokenRef.current;
    const polling = () =>
      findSimilarTokenRef.current === token && (navigation?.isCurrent() ?? true);
    let page;
    try {
      page = await resolveFindSimilar({
        query: async () => {
          const result = await api.embeddingSimilar({
            libraryId: library.libraryId,
            modelId,
            assetId,
            filters: currentQueryDefinition().filters,
            scope: currentSearchScope(currentQueryDefinition().search !== undefined),
          });
          if (!result.ok) throw new LibraryOperationError(result.error);
          return { status: result.value.status, assetIds: result.value.assetIds };
        },
        shouldContinue: polling,
        delay: (milliseconds) => new Promise((resolve) => {
          window.setTimeout(resolve, milliseconds);
        }),
        onPreparing: () => setNotice(t("settings.semanticSearch.similarPreparing")),
      });
    } catch (caught) {
      if (polling() && sessionFields.get("workerRecoveryState") === 'ready') setError(toMessage(caught, t("toast.searchFailed"), locale));
      return;
    }
    if (!page || !polling()) return;
    if (page.status === "unsupported") {
      setNotice(t("settings.semanticSearch.similarUnsupported"));
      return;
    }
    if (page.status === "unavailable") {
      setNotice(t("settings.semanticSearch.similarUnavailable"));
      return;
    }
    if (page.status === "failed") {
      setNotice(t("settings.semanticSearch.similarFailed"));
      return;
    }
    const request = navigation ?? beginWorkspaceNavigationRequest("push");
    if (!request.isCurrent()) return;
    try {
      if (!navigation) await closeAssetPreview(false);
      if (!request.isCurrent()) return;
      const source = await describeSimilarSource(assetId);
      if (!request.isCurrent() || !source) return;
      if (page.assetIds.length === 0) {
        showSemanticResults([], [], preferences.pageSize, source);
        setNotice(t("settings.semanticSearch.similarEmpty"));
      } else {
        const firstPage = await fetchFirstRankedBrowsePage({
          api,
          libraryId: library.libraryId,
          rankedAssetIds: page.assetIds,
          pageSize: preferences.pageSize,
          shouldContinue: () => request.isCurrent(),
        });
        if (!request.isCurrent() || !firstPage) return;
        if (!firstPage.ok) throw new LibraryOperationError(firstPage.error);
        showSemanticResults(
          firstPage.value.items,
          firstPage.value.rankedAssetIds,
          preferences.pageSize,
          source,
        );
        setNotice(null);
      }
      if (!navigation) {
        recordNavigation({ kind: "similar", assetId }, request);
        finishWorkspaceNavigation(request);
      }
    } catch (caught) {
      if (request.isCurrent()) {
        if (sessionFields.get("workerRecoveryState") === 'ready') setError(toMessage(caught, t("toast.searchFailed"), locale));
        if (!navigation) setWorkspaceNavigationPending(false);
      }
    } finally {
      if (request.isCurrent()) setUiState("ready");
    }
  }

  async function runSearch(
    event?: FormEvent,
    opts?: { silent?: boolean },
  ) {
    event?.preventDefault();
    if (sessionFields.get("workerRecoveryState") !== 'ready') return;
    if (
      (searchValue.trim() && !parseSearchExpressionDetailed(searchValue).ok) ||
      (tagFilterMode === "expression" && tagFilterExpression.trim()
        && !parseSearchExpressionDetailed(tagFilterExpression, "tags").ok)
    ) return;
    if (event) {
      searchHistoryDismissedUntilInputRef.current = true;
      setSearchHistoryOpen(false);
      setSearchHistoryActiveIndex(-1);
    }
    if (!api || !library) return;
    const semanticQuery = searchValue.trim();
    const semantic = loadSemanticSearchPreferences();
    if (semantic.searchMode === "semantic" && embeddingSelectionRef.current && semanticQuery) {
      await runSemanticSearch(semanticQuery, opts?.silent);
      return;
    }
    if (opts?.silent && (previewAssetRef.current || previewRestoringRef.current)) {
      return;
    }
    if (opts?.silent) {
      try {
        await executeSearchDefinition(currentQueryDefinition(), {
          historyMode: "none",
          isCurrent: () => true,
          deferReveal: true,
        });
      } catch (caught) {
        if (sessionFields.get("workerRecoveryState") === 'ready') setError(toMessage(caught, t("toast.searchFailed"), locale));
      } finally {
        setUiState("ready");
      }
      return;
    }
    const reloadViewport = captureWorkspaceNavViewport(workspaceCanvasRef.current);
    const request = beginWorkspaceNavigationRequest("none");
    try {
      if (!opts?.silent) {
        await closeAssetPreview(false);
      }
      if (!request.isCurrent()) return;
      const definition = currentQueryDefinition();
      const result = await executeSearchDefinition(
        definition,
        request,
        reloadViewport,
      );
      // Serpent-huvw: discovery debounce / reload must not toast "搜索完成"
      // and wipe AI completion / error toasts.
      if (result && !opts?.silent) {
        setNotice(t("toast.searchDone", { total: result.total }));
      }
    } catch (caught) {
      if (request.isCurrent()) {
        if (sessionFields.get("workerRecoveryState") === 'ready') setError(toMessage(caught, t("toast.searchFailed"), locale));
        setWorkspaceNavigationPending(false);
      }
    } finally {
      if (request.isCurrent()) setUiState("ready");
    }
  }

  useEffect(() => {
    const searchIsInvalid = Boolean(searchValue.trim()) && !parseSearchExpressionDetailed(searchValue).ok;
    const tagExpressionIsInvalid = tagFilterMode === "expression"
      && Boolean(tagFilterExpression.trim())
      && !parseSearchExpressionDetailed(tagFilterExpression, "tags").ok;
    // Keep the current cards in place while the user is typing an incomplete
    // expression. Do not send the last valid AST as a new Worker request.
    if (searchIsInvalid || tagExpressionIsInvalid) return;
    const hasDiscoveryInput = Boolean(
      searchValue.trim() ||
      colorFilter.trim() ||
      formatFilter.trim() ||
      (tagFilterMode === "selection" && tagFilter.trim()) ||
      (tagFilterMode === "expression" && tagFilterExpression.trim()) ||
      ratingFilter.trim() ||
      favoriteFilter !== "any" ||
      sourceUrlFilter !== "any" ||
      availabilityFilter !== "any" ||
      widthRange.min ||
      widthRange.max ||
      heightRange.min ||
      heightRange.max ||
      aspectRatioRange.min ||
      aspectRatioRange.max ||
      aspectRatioRanges.length > 0 ||
      durationRange.min ||
      durationRange.max ||
      longEdgeRange.min ||
      longEdgeRange.max ||
      sortField !== "name" ||
      sortOrder !== "asc",
    );
    const skippedSignature = skipDiscoveryReloadSignatureRef.current;
    if (skippedSignature !== null) {
      skipDiscoveryReloadSignatureRef.current = null;
      if (skippedSignature === JSON.stringify(currentQueryDefinition())) {
        hadDiscoveryInput.current = hasDiscoveryInput;
        return;
      }
    }
    const shouldClearPreviousResults =
      hadDiscoveryInput.current && !hasDiscoveryInput;
    hadDiscoveryInput.current = hasDiscoveryInput;
    if (
      !library ||
      showTrash ||
      // Serpent-eaxs: entering tag management clears discovery controls; the
      // debounced "clear filters → show all" reload must not fire behind the
      // management page — its response handler closes the page and dumps the
      // user back on 所有资产. Explicit submit (runSearch) still exits.
      showTagManagement ||
      showPluginSidebarView ||
      (!hasDiscoveryInput && !shouldClearPreviousResults)
    )
      return;
    const timer = window.setTimeout(() => {
      if (previewAssetRef.current || previewRestoringRef.current) return;
      const query = searchValue.trim();
      if (query) {
        publishSearchHistory(
          rememberSearchQuery(window.localStorage, library.libraryId, query),
        );
      }
      void runSearch(undefined, { silent: true });
    }, 200);
    return () => window.clearTimeout(timer);
    // Search execution reads the current scope and API from the same render;
    // only discovery controls should restart the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    library,
    showTrash,
    showTagManagement,
    showPluginSidebarView,
    searchValue,
    colorFilter,
    excludeColorFilter,
    colorSimilarity,
    formatFilter,
    excludeFormatFilter,
    tagFilter,
    tagFilterExpression,
    tagFilterMode,
    tagFilterLastValidExpression,
    excludeTagFilter,
    excludedTagFilter,
    includeAiTagFilter,
    ratingFilter,
    excludeRatingFilter,
    includeAiRatingFilter,
    favoriteFilter,
    sourceUrlFilter,
    availabilityFilter,
    excludeAvailabilityFilter,
    widthRange,
    heightRange,
    aspectRatioRange,
    aspectRatioRanges,
    durationRange,
    longEdgeRange,
    sortField,
    sortOrder,
  ]);

  loadAiContentForAssetRef.current = loadAiContentForAsset;
  rebuildAndApplyMultiEditRef.current = rebuildAndApplyMultiEdit;
  refreshAfterAiRef.current = async (assetId: string) => {
    try {
      await refreshTagAndMetadataState(assetId);
    } catch {
      // Best-effort; AI content load still proceeds.
    }
    await loadAiContentForAsset(assetId);
    // Multi-selection: the batch-edit Inspector reads the multiEdit model
    // built from per-asset metadata (intersection), so every selected
    // asset's metadata must be fresh before the model is rebuilt — the
    // primary alone was refreshed above (Serpent-c9r3 regression: batch AI
    // analysis completed but the Inspector stayed stale until a reselect).
    if (selectionFields.get("selectedAssetIds").length >= 2) {
      const ids = [...new Set(selectionFields.get("selectedAssetIds"))];
      for (const id of ids) {
        if (id === assetId) continue;
        try {
          await refreshTagAndMetadataState(id);
        } catch {
          // Best-effort per asset; the rebuild still proceeds.
        }
      }
      rebuildAndApplyMultiEdit(ids);
    }
  };

  async function revealAfterImport(completion: {
    assets: AssetSummary[];
  }): Promise<void> {
    // Folder cards are backed by a separate direct-child query from the asset
    // page. A successful import can create a new managed folder without
    // changing the current browse scope, so explicitly invalidate that query
    // before revealing the imported assets.
    setFolderBrowseRefreshToken((token) => token + 1);
    const reveal = pendingRevealFromAssets(completion.assets);
    if (!reveal) {
      await reloadCurrentContent({ blockingNavigation: true });
      return;
    }
    pendingRevealRef.current = reveal;
    if (!currentScopeShowsRevealAssets(assetScope, completion.assets)) {
      const target = sharedBrowseScopeForAssets(completion.assets);
      if (target) {
        await chooseFolder(target, { blockingNavigation: true });
        return;
      }
    }
    await reloadCurrentContent({ blockingNavigation: true });
  }
  revealAfterImportRef.current = revealAfterImport;
  return { runFindSimilar, revealAfterImport, runSearch };
}
