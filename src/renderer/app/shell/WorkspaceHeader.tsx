import type { DimensionFilterBarActions } from "../../filters/DimensionFilterBar";
import { useStableCallbacks } from "../shared/use-stable-callbacks";
import { dialogsFields } from "../../stores/dialogs-store";
import { useNavigationField } from "../../stores/navigation-store";
import { usePreviewField } from "../../stores/preview-store";
import { queryFields, useQueryField } from "../../stores/query-store";
import { useSelectionField } from "../../stores/selection-store";
import { useSessionField } from "../../stores/session-store";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RendererLibrarySummary } from "../../../shared/protocol/responses";
import type { SearchScope } from "../../../shared/asset-types";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import type { ScopeBreadcrumbSegment } from "../../search/ScopeBreadcrumbs";
import type { CanvasPreferences } from "../../browse/canvas-preferences";
import type { ClearableFilterId } from "../../filters/active-discovery-filters";
import { type SortDefinition } from "../../../shared/asset-types";
import { nextCanvasCaptionAlign } from "../../browse/canvas-preferences";
import { CanvasToolbarControls } from "../../browse/CanvasToolbarControls";
import { DimensionFilterBar , DimensionFilterBarActionsProvider } from "../../filters/DimensionFilterBar";
import { toMessage } from "../../common/error-utils";
import { saveFeatureHintPreferences, withFeatureHintShown } from "../../common/feature-hint-preferences";
import { folderSearchScope } from "../../browse/folder-browse-scope";
import { saveFolderRecursivePreferences, withFolderRecursiveEnabled } from "../../folders/folder-recursive-preferences";
import { iconActionAttrs } from "../../common/icon-action-attrs";
import { Icon } from "../../common/Icons";
import { PluginToolbarButtons } from "../../plugins/plugin-toolbar-contributions";
import { PluginWorkspaceViews } from "../../plugins/plugin-workspace-views";
import { ScopeBreadcrumbs } from "../../search/ScopeBreadcrumbs";
import { parseSearchExpressionDetailed } from "../../search/search-expression";
import { type AssetScope } from "../../stores/navigation-store";
import { SHORTCUT_PLATFORM, folderRecursiveRef, type QueryFilterSnapshot, type RendererWindow, type SearchDefinition, type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface WorkspaceHeaderProps {
  showPluginSidebarView: boolean;
  recursiveHintActive: boolean;
  includeSubfoldersHoverTimerRef: RefObject<NodeJS.Timeout | null>;
  recursiveHintKey: string | null;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  currentQueryDefinition: (overrides?: { tagFilter?: string; tagFilterMatch?: "any" | "all"; excludeTagFilter?: boolean; excludedTagFilter?: string; searchValue?: string | null; colorFilter?: string | null; excludeColorFilter?: boolean; colorSimilarity?: number; sortField?: SortDefinition["field"]; sortOrder?: SortDefinition["order"]; filtersSnapshot?: QueryFilterSnapshot; }) => SearchDefinition;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
  workspaceTitle: () => string;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  enterTrashAt: (tombstoneId: string | null, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  scopeBreadcrumbSegments: ScopeBreadcrumbSegment[];
  workspaceBrowseCount: number;
  busy: boolean;
  emptyTrash: () => Promise<void>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  startBatchRelink: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  setCanvasPrefs: (action: SetStateAction<CanvasPreferences>) => void;
  canvasPrefs: CanvasPreferences;
  assetCardSize: number;
  cardSizeStops: number[];
  resizeAssetCards: (requestedSize: number, clientX?: number, clientY?: number) => void;
  pluginContributionRefreshKey: string;
  selectedVisibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  pluginSurfaceContext: { contextId: string; revision: number; app: { platform: string; locale: string; theme: "light" | "dark" | "system"; busy: boolean; }; surface: { id: string; kind: string; }; window: { windowId: string; }; library: { open: boolean; writable: boolean; offline: boolean; id?: string | undefined; }; selection: { count: number; assetCount: number; folderCount: number; mixed: boolean; extensions: string[]; mimeTypes: string[]; mediaKinds: string[]; summary: { managedCount: number; unmanagedCount: number; availableCount: number; unavailableCount: number; deletedCount: number; hasDeleted: boolean; hasUnavailable: boolean; }; hasDeleted: boolean; hasUnavailable: boolean; ref?: string | undefined; primaryId?: string | undefined; }; browse: { folderId?: string | undefined; tagId?: string | undefined; search?: string | undefined; filter?: string | undefined; }; viewer: { active: boolean; fullscreen: boolean; assetId?: string | undefined; extension?: string | undefined; mimeType?: string | undefined; mediaKind?: string | undefined; }; };
  dialogFocusTrapActive: boolean;
  clearDiscoveryFilter: (id: ClearableFilterId) => void;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function WorkspaceHeader({ showPluginSidebarView, recursiveHintActive, includeSubfoldersHoverTimerRef, recursiveHintKey, closeAssetPreview, currentQueryDefinition, loadContent, setError, t, locale, workspaceTitle, chooseFolder, enterTrashAt, scopeBreadcrumbSegments, workspaceBrowseCount, busy, emptyTrash, visibleAssets, startBatchRelink, refreshAssets, setCanvasPrefs, canvasPrefs, assetCardSize, cardSizeStops, resizeAssetCards, pluginContributionRefreshKey, selectedVisibleAssets, pluginSurfaceContext, dialogFocusTrapActive, clearDiscoveryFilter, setPinnedTagId}: WorkspaceHeaderProps) {
  const [previewAsset] = usePreviewField("previewAsset");
  const [previewRestoring] = usePreviewField("previewRestoring");
  const [library] = useSessionField("library");
  const [showTrash] = useNavigationField("showTrash");
  const [showTagManagement] = useNavigationField("showTagManagement");
  const [activeTagId, setActiveTagId] = useNavigationField("activeTagId");
  const [assetScope] = useNavigationField("assetScope");
  const [folderRecursive, setFolderRecursive] = useNavigationField("folderRecursive");
  const [featureHintPrefs, setFeatureHintPrefs] = useNavigationField("featureHintPrefs");
  const [folderRecursivePrefs, setFolderRecursivePrefs] = useNavigationField("folderRecursivePrefs");
  const [tags] = useNavigationField("tags");
  const setAppSettingsCategory = dialogsFields.setterFor("appSettingsCategory");
  const setAppSettingsOpen = dialogsFields.setterFor("appSettingsOpen");
  const [selectedAssetIds] = useSelectionField("selectedAssetIds");
  const [tagFilter, setTagFilter] = useQueryField("tagFilter");
  const [shuffleSeed, setShuffleSeed] = useQueryField("shuffleSeed");
  const setSortField = queryFields.setterFor("sortField");
  const setSortOrder = queryFields.setterFor("sortOrder");
  const setTagFilterMatch = queryFields.setterFor("tagFilterMatch");
  const [tagFilterExpression, setTagFilterExpression] = useQueryField("tagFilterExpression");
  const [tagFilterLastValidExpression, setTagFilterLastValidExpression] = useQueryField("tagFilterLastValidExpression");
  const [colorFilter] = useQueryField("colorFilter");
  const [excludeColorFilter] = useQueryField("excludeColorFilter");
  const [formatFilter] = useQueryField("formatFilter");
  const [excludeFormatFilter] = useQueryField("excludeFormatFilter");
  const [tagFilterMode] = useQueryField("tagFilterMode");
  const [excludeTagFilter] = useQueryField("excludeTagFilter");
  const [excludedTagFilter] = useQueryField("excludedTagFilter");
  const [includeAiTagFilter] = useQueryField("includeAiTagFilter");
  const [ratingFilter] = useQueryField("ratingFilter");
  const [excludeRatingFilter] = useQueryField("excludeRatingFilter");
  const [includeAiRatingFilter] = useQueryField("includeAiRatingFilter");
  const [favoriteFilter] = useQueryField("favoriteFilter");
  const [sourceUrlFilter] = useQueryField("sourceUrlFilter");
  const [availabilityFilter] = useQueryField("availabilityFilter");
  const [excludeAvailabilityFilter] = useQueryField("excludeAvailabilityFilter");
  const [widthRange] = useQueryField("widthRange");
  const [heightRange] = useQueryField("heightRange");
  const [aspectRatioRange] = useQueryField("aspectRatioRange");
  const [aspectRatioRanges] = useQueryField("aspectRatioRanges");
  const [longEdgeRange] = useQueryField("longEdgeRange");
  const [durationRange] = useQueryField("durationRange");
  const dimensionFilterBarActions = useStableCallbacks<DimensionFilterBarActions>({
            onClearFilter: clearDiscoveryFilter,
            onTagNamesChange: (names) => {
              // Discovery tag filters overlay the current folder/collection
              // scope. Do not set activeTagId — that is "browse by tag" mode
              // (chooseTag) and would clear folder nav highlight + folder cards
              // (resolveFolderBrowseParentId).
              setTagFilter(names.join(", "));
              setActiveTagId(null);
            },
            setSortField: (field) => {
              setShuffleSeed(null);
              setSortField(field);
            },
            setSortOrder: (order) => {
              setShuffleSeed(null);
              setSortOrder(order);
            },
            setTagFilter: (value) => {
              // Explicit filter-bar edits leave the tag-management AND mode.
              setTagFilterMatch("any");
              setTagFilter(value);
              setTagFilterExpression("");
            },
            setTagFilterExpression: (value) => {
              setPinnedTagId(null);
              setTagFilterExpression(value);
              if (parseSearchExpressionDetailed(value, "tags").ok) setTagFilterLastValidExpression(value);
            },
            onShuffle: () => {
              setShuffleSeed((prev) => {
                const next = Date.now() >>> 0;
                return prev === null ? next : (next ^ ((prev + 1) >>> 0)) >>> 0;
              });
            },
          });
  // Same object while no filter value changes, so the memoized bar can skip renders.
  const filterSnapshot = useStableCallbacks({
    colorFilter,
    excludeColorFilter,
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
    longEdgeRange,
    durationRange,
  });
  return (
<div
          className={`workspace-toolstrip${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
          data-chrome="unified"
        >
        <div
          className={`workspace-bar${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
        >
          <div className="workspace-title">
            {library &&
              !showTrash &&
              !showTagManagement &&
              !showPluginSidebarView &&
              !activeTagId &&
              assetScope !== "all" &&
              assetScope !== "root" && (
                <button
                  aria-pressed={folderRecursive}
                  className={`workspace-include-subfolders${
                    recursiveHintActive ? " is-feature-hinting" : ""
                  }`}
                  onMouseEnter={() => {
                    // Hovering the highlighted affordance >0.5s dismisses the
                    // hint permanently (shared all-highlights rule).
                    includeSubfoldersHoverTimerRef.current = setTimeout(() => {
                      includeSubfoldersHoverTimerRef.current = null;
                      if (recursiveHintKey) {
                        const hinted = withFeatureHintShown(
                          featureHintPrefs,
                          recursiveHintKey,
                        );
                        setFeatureHintPrefs(hinted);
                        saveFeatureHintPreferences(hinted);
                      }
                    }, 500);
                  }}
                  onMouseLeave={() => {
                    if (includeSubfoldersHoverTimerRef.current) {
                      clearTimeout(includeSubfoldersHoverTimerRef.current);
                      includeSubfoldersHoverTimerRef.current = null;
                    }
                  }}
                  onClick={() => {
                    // Include-subfolders changes the browse result set (REQ-VIEW-004).
                    void closeAssetPreview(false);
                    const next = !folderRecursiveRef.current;
                    folderRecursiveRef.current = next;
                    setFolderRecursive(next);
                    const nextPrefs = withFolderRecursiveEnabled(
                      folderRecursivePrefs,
                      library.libraryId,
                      assetScope,
                      next,
                    );
                    setFolderRecursivePrefs(nextPrefs);
                    saveFolderRecursivePreferences(nextPrefs);
                    // Once the user has expanded this folder's children, the
                    // hint is moot and must never pulse again.
                    if (next && recursiveHintKey) {
                      const hintedPrefs = withFeatureHintShown(
                        featureHintPrefs,
                        recursiveHintKey,
                      );
                      setFeatureHintPrefs(hintedPrefs);
                      saveFeatureHintPreferences(hintedPrefs);
                    }
                    const searchActive = currentQueryDefinition().search !== undefined;
                    void loadContent(library, assetScope, {
                      discovery: currentQueryDefinition(),
                      // Text search is recursive by definition (REQ-FILTER-012),
                      // so changing the browse-only switch must not narrow a
                      // live search result set.
                      searchScope: searchActive
                        ? folderSearchScope(assetScope)
                        : {
                            kind: "folder",
                            folderId: assetScope,
                            recursive: next,
                          },
                    }).catch((caught) => {
                      setError(
                        toMessage(caught, t("toast.readAssetsFailed"), locale),
                      );
                    });
                  }}
                  type="button"
                  {...iconActionAttrs(t("nav.includeChildFolders"))}
                >
                  <Icon name="folders" size={14} />
                </button>
              )}
            {showTagManagement || showPluginSidebarView ? (
              <span>{workspaceTitle()}</span>
            ) : (
              <ScopeBreadcrumbs
                onNavigateFolder={(folderId) => void chooseFolder(folderId)}
                onNavigateTrashTombstone={(tombstoneId) => {
                  void enterTrashAt(tombstoneId);
                }}
                segments={scopeBreadcrumbSegments}
              />
            )}
            <span className="item-count">
              {library
                ? showTagManagement
                  ? t("common.itemCount", { count: tags.length })
                  : t("common.itemCount", { count: workspaceBrowseCount })
                : t("common.notLoaded")}
            </span>
          </div>
          <div className="workspace-tools">
            {library && showTrash ? (
              <>
                <button
                  className="compact-action"
                  disabled={busy}
                  onClick={() => void emptyTrash()}
                  type="button"
                >
                  <Icon name="trash" size={14} />
                  {t("toolbar.emptyTrash")}
                </button>
                <span className="tool-separator" />
              </>
            ) : (
              library &&
              !showTrash &&
              !showTagManagement &&
              !showPluginSidebarView &&
              visibleAssets.some(
                (a) => a.availability === "missing" && !a.deletedAt,
              ) && (
                <>
                  <button
                    className="compact-action"
                    disabled={busy}
                    onClick={() => void startBatchRelink()}
                    type="button"
                  >
                    <Icon name="folder" size={14} />
                    {t("toolbar.batchRelink")}
                  </button>
                  <span className="tool-separator" />
                </>
              )
            )}
            {!showTagManagement && !showPluginSidebarView && (
              <CanvasToolbarControls
                actions={{
                  refresh: () => {
                    void refreshAssets();
                  },
                  setViewMode: (mode) => {
                    setCanvasPrefs((p) => ({ ...p, viewMode: mode }));
                  },
                  toggleField: (field) => {
                    setCanvasPrefs((p) => ({
                      ...p,
                      fields: { ...p.fields, [field]: !p.fields[field] },
                    }));
                  },
                  cycleCaptionAlign: () => {
                    setCanvasPrefs((p) => ({
                      ...p,
                      captionAlign: nextCanvasCaptionAlign(p.captionAlign),
                    }));
                  },
                  openAiSettings: () => {
                    setAppSettingsCategory("ai");
                    setAppSettingsOpen(true);
                  },
                  openAppSettings: () => {
                    setAppSettingsCategory("general");
                    setAppSettingsOpen(true);
                  },
                }}
                busy={busy}
                canvasPrefs={canvasPrefs}
                cardSize={assetCardSize}
                cardSizeStops={cardSizeStops}
                libraryOpen={Boolean(library)}
                locale={locale}
                onCardSizeChange={resizeAssetCards}
                platform={SHORTCUT_PLATFORM}
              />
            )}
            <PluginToolbarButtons
              disabled={busy || library === null || showTagManagement || showPluginSidebarView}
              libraryId={library?.libraryId}
              pluginApi={(window as RendererWindow).keel?.plugins}
              refreshKey={pluginContributionRefreshKey}
              selectedAssetIds={selectedAssetIds}
              selectedAssets={selectedVisibleAssets}
              context={pluginSurfaceContext}
            />
          </div>
        </div>
        <PluginWorkspaceViews
          disabled={busy || library === null || showTagManagement || showPluginSidebarView}
          libraryId={library?.libraryId}
          pluginApi={(window as RendererWindow).keel?.plugins}
          refreshKey={pluginContributionRefreshKey}
        />
        {!showTagManagement && !showPluginSidebarView && (
        <div
          className={`workspace-discovery${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}`}
        >
          <DimensionFilterBarActionsProvider value={dimensionFilterBarActions}>
          <DimensionFilterBar
            disabled={!library}
            interactionsLocked={dialogFocusTrapActive}
            shuffleActive={shuffleSeed !== null}
            snapshot={filterSnapshot}
          />
          </DimensionFilterBarActionsProvider>
        </div>
        )}
        </div>
  );
}
