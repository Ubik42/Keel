import { useBrowseField } from "../../stores/browse-store";
import { useNavigationField } from "../../stores/navigation-store";
import { usePreviewField } from "../../stores/preview-store";
import { useQueryField } from "../../stores/query-store";
import { useSelectionField } from "../../stores/selection-store";
import { useSessionField } from "../../stores/session-store";
import type { DragEvent, JSX, MouseEvent, MutableRefObject, RefObject } from "react";
import type { ContextMenuDescriptor } from "../../workbench/menu/context-menu";
import type { PluginIframeViewDescriptor } from "../../plugins/plugin-iframe-view-host";
import type { TagSummary } from "../../../shared/asset-types";
import type { EntityAppearance } from "../../../shared/entity-appearance";
import type { BrowseCanvasBodyLayout } from "../../browse/folder-browse-canvas";
import type { ResizablePanel } from "../../workbench/shell/panel-auto-hide";
import type { CanvasPreferences } from "../../browse/canvas-preferences";
import type { AppLocale } from "../../i18n/types";
import type { AssetRenameDialogState } from "../../browse/useAssetRename";
import type { KeelLibraryApi, PreviewResolution } from "../../../shared/library-api";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { VirtualBrowseLayout } from "../../browse/virtual-browse-layout";
import type { UseBrowsePaginationResult } from "../../browse/use-browse-pagination";
import type { BrowseEmptyState } from "../../browse/browse-empty-state";
import { type AssetSummary } from "../../../shared/asset-types";
import { AssetCard, type AssetCardContext } from "./AssetCard";
import { useStableCallbacks } from "../shared/use-stable-callbacks";
import { shouldShowAssetCardBadges } from "../../browse/asset-card-badges";
import { assetCardKey } from "../../browse/asset-card-hover-preview";
import { virtualLayoutEntryForAsset } from "../../browse/virtual-browse-layout";
import { BrowseLayoutPreview } from "../../settings/BrowseLayoutPreview";
import { Icon } from "../../common/Icons";
import { JustifiedAssetRows } from "../../browse/justified-asset-rows";
import { MasonryColumns } from "../../browse/masonry-columns";
import { PluginSidebarViewPanel } from "../../plugins/plugin-sidebar-views";
import { TagManagementWorkspace } from "../../tags/TagManagementWorkspace";
import { assetGridLayoutStyle } from "../../workbench/collection/asset-grid-layout";
import { type RendererWindow, type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface BrowseCanvasProps {
  externalDropActive: boolean;
  handleExternalDragEnter: (event: DragEvent<HTMLElement>) => void;
  handleExternalDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleExternalDragOver: (event: DragEvent<HTMLElement>) => void;
  handleExternalDrop: (event: DragEvent<HTMLElement>) => void;
  handleCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  showPluginSidebarView: boolean;
  openContextMenu: (descriptor: ContextMenuDescriptor, position: { x: number; y: number; }) => void;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  marqueeBoxRef: RefObject<HTMLDivElement | null>;
  activePluginSidebarView: PluginIframeViewDescriptor | undefined;
  busy: boolean;
  handleCreateTagInManagement: (name: string, parentTagId?: string | null) => Promise<boolean>;
  handleDeleteTagsInManagement: (tagIds: string[]) => Promise<boolean>;
  handleMergeTagsInManagement: (tagIds: string[], name: string) => Promise<boolean>;
  chooseTag: (tagId: string, navigation?: WorkspaceNavigationRequest, tagCatalog?: readonly TagSummary[]) => Promise<void>;
  handleRenameTagInManagement: (tagId: string, name: string, appearance?: EntityAppearance | null) => Promise<boolean>;
  handleSearchTagsFromManagement: (tagNames: string[], match: "all" | "any") => Promise<void>;
  browseCanvasBodyLayout: BrowseCanvasBodyLayout;
  folderCardRowElement: JSX.Element | null;
  assetViewMode: "grid" | "masonry";
  assetGridRef: RefObject<HTMLDivElement | null>;
  assetCardSize: number;
  panelResizing: ResizablePanel | null;
  panelReflowFrozenWidthRef: RefObject<number | null>;
  canvasPrefs: CanvasPreferences;
  sourceBadgeContext: { assetScope: string; mixedFolderBrowse: boolean; };
  selectedFolderId: string | undefined;
  locale: AppLocale;
  syncCardStatuses: ReadonlyMap<string, "pending" | "syncing" | "conflict">;
  assetRenameDialog: AssetRenameDialogState | null;
  selectedIdSet: Set<string>;
  nativeAssetDragEnabled: boolean;
  selectedNativeDragReady: boolean;
  nativeDragReadyIds: ReadonlySet<string>;
  cardMouseDownRef: MutableRefObject<number>;
  api: KeelLibraryApi | undefined;
  setHoveredAssetId: (assetId: string | null) => void;
  clearHoveredAssetId: (assetId: string) => void;
  handleCardClick: (assetId: string, event: React.MouseEvent) => void;
  selectionAssetIds: string[] | undefined;
  openAssetByDefault: (asset: AssetSummary) => void;
  managedAssetDragIdsRef: RefObject<readonly string[] | null>;
  dragPreviewRef: RefObject<HTMLElement | null>;
  beginInternalAssetDrag: () => void;
  assignAssetsToTreeTag: (assetIds: string[], tagId: string) => Promise<void>;
  hoveredAssetId: string | null;
  viewerVolumeMuted: boolean;
  viewerVolume: number;
  activePreviewAssetId: string | null;
  activeResolution: PreviewResolution | null;
  retryLiveVideoProxyFallback: (assetId: string) => void;
  t: TranslateFn;
  submitAssetRename: () => Promise<void>;
  changeAssetRenameValue: (value: string) => void;
  cancelAssetRename: () => void;
  assetRenderSections: { key: string; label: string | null; assets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[]; }[];
  visibleBrowseLayout: { assetId: string; width: number | null; height: number | null; previewArtifactId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; displayName?: string | undefined; relativeFilePath?: string | undefined; byteSize?: number | undefined; modifiedAt?: string | undefined; rating?: number | undefined; mediaType?: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other" | undefined; }[];
  visibleVirtualBrowseLayout: VirtualBrowseLayout | null;
  browsePagination: UseBrowsePaginationResult;
  browseEmptyState: BrowseEmptyState;
  importAssets: (kind: "files" | "folder") => Promise<void>;
  pasteClipboardImage: (options?: { targetFolderId?: string; onNoClipboardImage?: () => void | Promise<void>; }) => Promise<void>;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function BrowseCanvas({ externalDropActive, handleExternalDragEnter, handleExternalDragLeave, handleExternalDragOver, handleExternalDrop, handleCanvasMouseDown, showPluginSidebarView, openContextMenu, workspaceCanvasRef, marqueeBoxRef, activePluginSidebarView, busy, handleCreateTagInManagement, handleDeleteTagsInManagement, handleMergeTagsInManagement, chooseTag, handleRenameTagInManagement, handleSearchTagsFromManagement, browseCanvasBodyLayout, folderCardRowElement, assetViewMode, assetGridRef, assetCardSize, panelResizing, panelReflowFrozenWidthRef, canvasPrefs, sourceBadgeContext, selectedFolderId, locale, syncCardStatuses, assetRenameDialog, selectedIdSet, nativeAssetDragEnabled, selectedNativeDragReady, nativeDragReadyIds, cardMouseDownRef, api, setHoveredAssetId, clearHoveredAssetId, handleCardClick, selectionAssetIds, openAssetByDefault, managedAssetDragIdsRef, dragPreviewRef, beginInternalAssetDrag, assignAssetsToTreeTag, hoveredAssetId, viewerVolumeMuted, viewerVolume, activePreviewAssetId, activeResolution, retryLiveVideoProxyFallback, t, submitAssetRename, changeAssetRenameValue, cancelAssetRename, assetRenderSections, visibleBrowseLayout, visibleVirtualBrowseLayout, browsePagination, browseEmptyState, importAssets, pasteClipboardImage }: BrowseCanvasProps) {
  const [previewAsset] = usePreviewField("previewAsset");
  const [previewRestoring] = usePreviewField("previewRestoring");
  const [workerRecoveryState] = useSessionField("workerRecoveryState");
  const [library] = useSessionField("library");
  const [showTagManagement] = useNavigationField("showTagManagement");
  const [selectedAssetIds, setSelectedAssetIds] = useSelectionField("selectedAssetIds");
  const [tags] = useNavigationField("tags");
  const [showTrash] = useNavigationField("showTrash");
  const [folders] = useNavigationField("folders");
  const [searchSnippets] = useBrowseField("searchSnippets");
  const [layoutThumbnailArtifacts] = useBrowseField("layoutThumbnailArtifacts");
  const [virtualBrowseLayout] = useBrowseField("virtualBrowseLayout");
  const [thumbnailFailures] = useBrowseField("thumbnailFailures");
  const [tagDropTargetId, setTagDropTargetId] = useNavigationField("tagDropTargetId");
  const [selectedFolderIds, setSelectedFolderIds] = useSelectionField("selectedFolderIds");
  const [selectedAssetId, setSelectedAssetId] = useSelectionField("selectedAssetId");
  const [searchValue] = useQueryField("searchValue");
  const [libraryLoading] = useSessionField("libraryLoading");
  // Same object while nothing the cards share changes; the getters read the
  // current selection when an event fires.
  const assetCardCtx = useStableCallbacks<AssetCardContext>({
    api,
    assetViewMode,
    assignAssetsToTreeTag,
    beginInternalAssetDrag,
    cancelAssetRename,
    canvasPrefs,
    cardMouseDownRef,
    changeAssetRenameValue,
    clearHoveredAssetId,
    dragPreviewRef,
    handleCardClick,
    locale,
    managedAssetDragIdsRef,
    nativeAssetDragEnabled,
    openAssetByDefault,
    openContextMenu,
    retryLiveVideoProxyFallback,
    selectedFolderId,
    setHoveredAssetId,
    sourceBadgeContext,
    submitAssetRename,
    t,
    viewerVolume,
    viewerVolumeMuted,
    workspaceCanvasRef,
    folders,
    tags,
    showTrash,
    library,
    searchValue,
    setSelectedAssetIds,
    setSelectedAssetId,
    setSelectedFolderIds,
    setTagDropTargetId,
    showCornerBadges: shouldShowAssetCardBadges(assetCardSize),
    virtualized: Boolean(virtualBrowseLayout),
    getSelectedAssetIds: () => selectedAssetIds,
    getSelectedFolderIds: () => selectedFolderIds,
    getSelectionAssetIds: () => selectionAssetIds,
    getNativeDragReadyIds: () => nativeDragReadyIds,
  });
  return (
<div
          className={`workspace-canvas${previewAsset ? " is-viewing" : previewRestoring ? " is-restoring" : ""}${externalDropActive ? " is-external-drop" : ""}`}
          inert={workerRecoveryState !== 'ready'}
          onDragEnter={handleExternalDragEnter}
          onDragLeave={handleExternalDragLeave}
          onDragOver={handleExternalDragOver}
          onDragOverCapture={handleExternalDragOver}
          onDrop={handleExternalDrop}
          onMouseDown={handleCanvasMouseDown}
          onContextMenu={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (
              target.closest(
                ".asset-card, .folder-card, button, [role='button'], [role='menuitem'], a, input, textarea, select",
              )
            ) {
              return;
            }
            if (!library || previewAsset || showTagManagement || showPluginSidebarView) return;
            event.preventDefault();
            openContextMenu(
              {
                type: "workspace",
                ...(selectedAssetIds.length > 0
                  ? { assetIds: [...selectedAssetIds] }
                  : {}),
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          ref={workspaceCanvasRef}
        >
          {/* rendered once, mutated directly via ref — a
              per-frame React state would re-render the whole grid. */}
          <div
            className="marquee-selection-box"
            ref={marqueeBoxRef}
          />
          {library && showPluginSidebarView ? (
            <PluginSidebarViewPanel
              activeView={activePluginSidebarView}
              libraryId={library.libraryId}
              pluginApi={(window as RendererWindow).keel?.plugins}
            />
          ) : library && showTagManagement ? (
            <TagManagementWorkspace
              busy={busy}
              onCreate={handleCreateTagInManagement}
              onDeleteMany={handleDeleteTagsInManagement}
              onMerge={handleMergeTagsInManagement}
              onOpenTag={(tagId) => void chooseTag(tagId)}
              onRename={handleRenameTagInManagement}
              onSearchTags={(names, match) =>
                void handleSearchTagsFromManagement(names, match)
              }
              tags={tags}
            />
          ) : library ? (
            browseCanvasBodyLayout.mode !== "empty" ? (
              <>
                {folderCardRowElement}
                {browseCanvasBodyLayout.showAssetGrid && (
                  <div
                    className={`asset-grid is-${assetViewMode}`}
                    ref={assetGridRef}
                    style={{
                      ...assetGridLayoutStyle(assetViewMode, assetCardSize),
                      ...(panelResizing && panelReflowFrozenWidthRef.current
                        ? {
                            width: `${panelReflowFrozenWidthRef.current}px`,
                            maxWidth: "none",
                          }
                        : {}),
                    }}
                  >
                  {(() => {
                    const renderAssetCard = (
                      asset: AssetSummary,
                      renderOptions?: { loadImmediately?: boolean; stableSlot?: boolean },
                    ) => (
                      <AssetCard
                        key={renderOptions?.stableSlot ? undefined : assetCardKey(library?.libraryId, asset.assetId)}
                        asset={asset}
                        loadImmediately={renderOptions?.loadImmediately}
                        ctx={assetCardCtx}
                        selected={selectedIdSet.has(asset.assetId)}
                        hovering={hoveredAssetId === asset.assetId}
                        primarySelected={selectedAssetId === asset.assetId}
                        active={activePreviewAssetId === asset.assetId}
                        activeResolution={activePreviewAssetId === asset.assetId ? activeResolution : null}
                        dropTarget={tagDropTargetId === asset.assetId}
                        renameDialog={assetRenameDialog?.assetId === asset.assetId ? assetRenameDialog : null}
                        nativeDragReady={selectedIdSet.has(asset.assetId) ? selectedNativeDragReady : nativeDragReadyIds.has(asset.assetId)}
                        thumbnailFailure={thumbnailFailures.get(asset.assetId)}
                        snippet={searchSnippets.get(asset.assetId)}
                        syncStatusValue={canvasPrefs.fields.badgeSync !== false ? syncCardStatuses.get(asset.assetId) : undefined}
                        layoutThumbnailArtifactValue={layoutThumbnailArtifacts.libraryId === library?.libraryId ? layoutThumbnailArtifacts.ids.get(asset.assetId) : undefined}
                        layoutPreviewArtifactId={virtualBrowseLayout ? virtualLayoutEntryForAsset(virtualBrowseLayout, asset.assetId)?.previewArtifactId ?? null : null}
                      />
                    );
                    return assetRenderSections.map((section) => (
                      <div
                        className={
                          section.label ? "trash-folder-group" : undefined
                        }
                        key={section.key || "__root__"}
                      >
                        {section.label ? (
                          <h3 className="trash-folder-group-header">
                            {section.label}
                          </h3>
                        ) : null}
                        {assetViewMode === "masonry" ? (
                          <MasonryColumns
                            assets={section.assets}
                            layout={visibleBrowseLayout}
                            virtualLayout={visibleVirtualBrowseLayout}
                            cardSize={assetCardSize}
                            renderCard={renderAssetCard}
                            renderLayoutPreview={(entry, renderOptions) =>
                              library ? (
                                <BrowseLayoutPreview
                                  entry={entry}
                                  fields={canvasPrefs.fields}
                                  libraryId={library.libraryId}
                                  previewArtifactId={
                                    layoutThumbnailArtifacts.libraryId === library.libraryId
                                      ? layoutThumbnailArtifacts.ids.get(entry.assetId)
                                      : undefined
                                  }
                                  syncStatus={
                                    canvasPrefs.fields.badgeSync !== false
                                      ? syncCardStatuses.get(entry.assetId)
                                      : undefined
                                  }
                                  viewMode="masonry"
                                  loadImmediately={renderOptions?.loadImmediately ?? true}
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                />
                              ) : null
                            }
                            captionFields={canvasPrefs.fields}
                            snippetLine={searchSnippets.size > 0}
                            suspendScrollRestoration={
                              Boolean(previewAsset || previewRestoring)
                            }
                          />
                        ) : (
                          <JustifiedAssetRows
                            assets={section.assets}
                            layout={visibleBrowseLayout}
                            virtualLayout={visibleVirtualBrowseLayout}
                            cardSize={assetCardSize}
                            captionFields={canvasPrefs.fields}
                            snippetLine={searchSnippets.size > 0}
                            renderCard={renderAssetCard}
                            renderLayoutPreview={(entry, renderOptions) =>
                              library ? (
                                <BrowseLayoutPreview
                                  entry={entry}
                                  fields={canvasPrefs.fields}
                                  libraryId={library.libraryId}
                                  previewArtifactId={
                                    layoutThumbnailArtifacts.libraryId === library.libraryId
                                      ? layoutThumbnailArtifacts.ids.get(entry.assetId)
                                      : undefined
                                  }
                                  syncStatus={
                                    canvasPrefs.fields.badgeSync !== false
                                      ? syncCardStatuses.get(entry.assetId)
                                      : undefined
                                  }
                                  viewMode="grid"
                                  loadImmediately={renderOptions?.loadImmediately ?? true}
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                />
                              ) : null
                            }
                          />
                        )}
                      </div>
                    ));
                  })()}
                  </div>
                )}
                {/* invisible tail probe. A jump to the end fills
                    the last window, not pages 0 → 100 → 200. 
                    no spinner or "loading more" copy. */}
                {browsePagination.hasMorePages && (
                  <div
                    ref={browsePagination.sentinelRef}
                    className="browse-load-more"
                    aria-hidden="true"
                  />
                )}
              </>
            ) : (
              <>
                {folderCardRowElement}
                <div className="empty-library">
                <div className="empty-orbit">
                  <Icon name={browseEmptyState.icon} size={24} />
                </div>
                <h1>{t(browseEmptyState.titleKey)}</h1>
                <p>{t(browseEmptyState.detailKey)}</p>
                {browseEmptyState.showImportActions ? (
                  <div className="empty-actions">
                    <button
                      className="primary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void importAssets("files")}
                      type="button"
                    >
                      {t("toolbar.importFiles")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void importAssets("folder")}
                      type="button"
                    >
                      {t("toolbar.importFolder")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={libraryLoading !== null}
                      onClick={() => void pasteClipboardImage()}
                      type="button"
                    >
                      {t("toolbar.pasteImage")}
                    </button>
                  </div>
                ) : null}
              </div>
              </>
            )
          ) : null}
        </div>
  );
}
