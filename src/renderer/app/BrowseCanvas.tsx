import { useBrowseField } from "../stores/browse-store";
import { useNavigationField } from "../stores/navigation-store";
import { usePreviewField } from "../stores/preview-store";
import { useQueryField } from "../stores/query-store";
import { useSelectionField } from "../stores/selection-store";
import { useSessionField } from "../stores/session-store";
import type { DragEvent, JSX, MouseEvent, MutableRefObject, RefObject } from "react";
import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { PluginIframeViewDescriptor } from "../plugin-iframe-view-host";
import type { TagSummary } from "../../shared/asset-types";
import type { EntityAppearance } from "../../shared/entity-appearance";
import type { BrowseCanvasBodyLayout } from "../folder-browse-canvas";
import type { ResizablePanel } from "../workbench/shell/panel-auto-hide";
import type { CanvasPreferences } from "../canvas-preferences";
import type { AppLocale } from "../i18n/types";
import type { AssetRenameDialogState } from "../useAssetRename";
import type { KeelLibraryApi, PreviewResolution } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { VirtualBrowseLayout } from "../browse/virtual-browse-layout";
import type { UseBrowsePaginationResult } from "../use-browse-pagination";
import type { BrowseEmptyState } from "../browse-empty-state";
import { type AssetSummary } from "../../shared/asset-types";
import { assetTypeBadgeLabel, fileExtensionLabel, formatSequenceDuration, shouldShowAssetCardBadges, shouldShowDurationBadge, shouldShowExtensionBadge, shouldShowTypeBadgeAlongsideExtension } from "../asset-card-badges";
import { assetCardKey, isCardHoverPreviewable, isCardSequencePlayable, resolveAssetCardCoverUrl } from "../asset-card-hover-preview";
import { MANAGED_ASSETS_DRAG_TYPE, resolveDragDropMode, resolveDraggedAssetIds } from "../asset-drag-drop";
import { ASSET_DRAG_PREVIEW_HEIGHT, ASSET_DRAG_PREVIEW_WIDTH, dismissAssetDragPreview, showAssetDragPreview } from "../asset-drag-preview";
import { resolveAssetSourceBadgeLabel, shouldShowAssetSourceBadge } from "../asset-source-badge";
import { AssetCardMedia } from "../AssetCardMedia";
import { corruptAssetAffordance, isCorruptAsset, missingAssetAffordance, shouldShowMissingAssetOverlay } from "../availability-affordance";
import { resolveBrowseContextMenuIntent } from "../browse-selection-menu";
import { virtualLayoutEntryForAsset } from "../browse/virtual-browse-layout";
import { BrowseLayoutPreview } from "../BrowseLayoutPreview";
import { assetCaptionAlignClass, shouldShowGridDimensions } from "../canvas-preferences";
import { formatBytes } from "../format-file-meta";
import { Icon } from "../Icons";
import { JustifiedAssetRows } from "../justified-asset-rows";
import { MasonryColumns } from "../masonry-columns";
import { PluginSidebarViewPanel } from "../plugin-sidebar-views";
import { resolveSearchSnippetCaption } from "../search-snippet-caption";
import { SyncCardStatusBadge } from "../SyncCardStatusBadge";
import { TAG_DRAG_TYPE } from "../tag-drag-drop";
import { TagManagementWorkspace } from "../TagManagementWorkspace";
import { TextAssetPreviewTile } from "../TextAssetPreviewTile";
import { shouldShowThumbnailFailureBadge } from "../thumbnail-failure-badge";
import { trashedFromLabel } from "../trashed-from-label";
import { splitAssetFileName } from "../useAssetRename";
import { assetGridLayoutStyle } from "../workbench/collection/asset-grid-layout";
import { resolveMasonryTabTarget } from "../workbench/collection/masonry-focus-order";
import { isImeKeyboardEvent } from "../workbench/overlay/ime-safe-dismiss";
import { formatDate, formatDuration, highlightSnippet, renderMiddleEllipsisFilename, type RendererWindow, type WorkspaceNavigationRequest } from "./app-shared";

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
          {/* Serpent-wgl2: rendered once, mutated directly via ref — a
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
                    const showCornerBadges =
                      shouldShowAssetCardBadges(assetCardSize);
                    const renderAssetCard = (
                      asset: AssetSummary,
                      renderOptions?: { loadImmediately?: boolean; stableSlot?: boolean },
                    ) => {
                      const typeBadge = assetTypeBadgeLabel(
                        asset.mediaType,
                        asset.displayName,
                      );
                      const showExtension =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeExtension &&
                        shouldShowExtensionBadge(asset.mediaType);
                      const showDuration =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeDuration &&
                        shouldShowDurationBadge(
                          asset.mediaType,
                          asset.displayName,
                          asset.durationMs,
                        );
                      const showTypeBadge =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeType &&
                        Boolean(typeBadge) &&
                        shouldShowTypeBadgeAlongsideExtension(showExtension) &&
                        !asset.deletedAt &&
                        !shouldShowMissingAssetOverlay(asset.availability);
                      const sourceBadgeLabel =
                        showCornerBadges &&
                        canvasPrefs.fields.badgeSource &&
                        !showTrash &&
                        shouldShowAssetSourceBadge(
                          sourceBadgeContext,
                          asset.managedFolderId,
                        )
                          ? resolveAssetSourceBadgeLabel(
                              folders,
                              asset.managedFolderId,
                              selectedFolderId ?? null,
                            )
                          : null;
                      const trashOriginBadgeLabel =
                        showTrash &&
                        asset.deletedAt &&
                        asset.trashedFromPath
                          ? trashedFromLabel(asset.trashedFromPath, locale)
                          : null;
                      const snippetCaption = resolveSearchSnippetCaption(
                        searchSnippets.get(asset.assetId),
                        asset.displayName,
                      );
                      const syncStatus =
                        canvasPrefs.fields.badgeSync !== false
                          ? syncCardStatuses.get(asset.assetId)
                          : undefined;
                      const layoutThumbnailArtifactId =
                        layoutThumbnailArtifacts.libraryId === library?.libraryId
                          ? layoutThumbnailArtifacts.ids.get(asset.assetId)
                          : undefined;
                      const layoutEntry = virtualBrowseLayout
                        ? virtualLayoutEntryForAsset(virtualBrowseLayout, asset.assetId)
                        : undefined;
                      const cardCover = resolveAssetCardCoverUrl({
                        libraryId: library?.libraryId,
                        assetId: asset.assetId,
                        mediaType: asset.mediaType,
                        availability: asset.availability,
                        deletedAt: asset.deletedAt,
                        thumbnailStatus: layoutThumbnailArtifactId
                          ? "ready"
                          : asset.thumbnailStatus,
                        thumbnailArtifactId:
                          layoutThumbnailArtifactId ?? asset.thumbnailArtifactId,
                        layoutPreviewArtifactId:
                          layoutThumbnailArtifactId
                          ?? layoutEntry?.previewArtifactId
                          ?? null,
                        previewKind: asset.previewKind,
                        previewRevisionId: asset.previewRevisionId,
                      });
                      const showThumbnailFailure = shouldShowThumbnailFailureBadge(
                        asset,
                        thumbnailFailures.has(asset.assetId),
                      );
                      const renamingThisAsset =
                        assetRenameDialog?.assetId === asset.assetId;
                      const corruptAsset = isCorruptAsset(asset);
                      const CardTag = renamingThisAsset ? "div" : "button";
                      return (
                    <CardTag
                      aria-label={canvasPrefs.fields.name ? undefined : asset.displayName}
                      data-hover-tip={canvasPrefs.fields.name ? undefined : asset.displayName}
                      aria-pressed={selectedIdSet.has(asset.assetId)}
                      className={`asset-card${selectedIdSet.has(asset.assetId) ? " is-selected" : ""}${asset.availability === "missing" ? " is-missing" : ""}${corruptAsset ? " is-corrupt" : ""}${asset.deletedAt ? " is-trashed" : ""}${renamingThisAsset ? " is-renaming" : ""}`}
                      data-tag-drop-target={tagDropTargetId === asset.assetId || undefined}
                      data-asset-id={asset.assetId}
                      data-asset-name={asset.displayName}
                      data-media-type={asset.mediaType}
                      draggable={
                        !showTrash && !renamingThisAsset && (
                          !nativeAssetDragEnabled
                          || (selectedIdSet.has(asset.assetId)
                            ? selectedNativeDragReady
                            : nativeDragReadyIds.has(asset.assetId))
                        )
                      }
                      key={renderOptions?.stableSlot
                        ? undefined
                        : assetCardKey(library?.libraryId, asset.assetId)}
                      {...(renamingThisAsset
                        ? { role: "group" as const }
                        : { type: "button" as const })}
                      onMouseDown={(e) => {
                        cardMouseDownRef.current = e.button;
                        if (e.button !== 0 || showTrash || renamingThisAsset || !api || !library) {
                          return;
                        }
                        const ids = resolveDraggedAssetIds(asset.assetId, selectedAssetIds);
                        api.primeAssetDrag({
                          libraryId: library.libraryId,
                          assetIds: ids,
                        });
                      }}
                      onMouseEnter={() => {
                        setHoveredAssetId(asset.assetId);
                      }}
                      onMouseLeave={() => {
                        clearHoveredAssetId(asset.assetId);
                      }}
                      onClick={(event) => {
                        if (renamingThisAsset) return;
                        handleCardClick(asset.assetId, event);
                      }}
                      onKeyDown={(event) => {
                        if (
                          renamingThisAsset ||
                          assetViewMode !== "masonry" ||
                          event.key !== "Tab"
                        ) {
                          return;
                        }
                        const nextAssetId = resolveMasonryTabTarget(
                          selectionAssetIds ?? [],
                          asset.assetId,
                          event.shiftKey,
                        );
                        if (!nextAssetId) return;
                        const nextCard = workspaceCanvasRef.current?.querySelector<HTMLElement>(
                          `.asset-card[data-asset-id="${CSS.escape(nextAssetId)}"]`,
                        );
                        if (!nextCard) return;
                        event.preventDefault();
                        nextCard.focus();
                      }}
                      onDoubleClick={() => {
                        if (renamingThisAsset) return;
                        openAssetByDefault(asset);
                      }}
                      onDragEnd={() => {
                        managedAssetDragIdsRef.current = null;
                        // REQ-DND-003: unmount the custom drag ghost.
                        dismissAssetDragPreview(dragPreviewRef.current);
                        dragPreviewRef.current = null;
                      }}
                      onDragOver={(event) => {
                        if (!showTrash && event.dataTransfer.types.includes(TAG_DRAG_TYPE)) {
                          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setTagDropTargetId(asset.assetId); return;
                        }
                      }}
                      onDragLeave={() => setTagDropTargetId(null)}
                      onDragStart={(event) => {
                        // REQ-DND-001/002: folder/trash drops resolve this
                        // selection snapshot at the target (asset-drag-drop.ts).
                        const ids = resolveDraggedAssetIds(asset.assetId, selectedAssetIds);
                        // Native OS drag and Chromium HTML5 drag cannot share a
                        // single session: Electron requires preventDefault()
                        // before startDrag, while in-app E2E keeps the HTML5
                        // payload to exercise internal targets. The test flag
                        // only disables the OS hand-off; production always
                        // uses the native path.
                        // `globalThis` in preload is isolated from the page
                        // world when contextIsolation is enabled. Use the
                        // explicit diagnostics bridge so E2E HTML5 drops do
                        // not enter Electron's native OS drag loop, while
                        // production still uses startDrag().
                        if (nativeAssetDragEnabled && api && library) {
                          if (!ids.every((id) => nativeDragReadyIds.has(id))) {
                            event.preventDefault();
                            api.primeAssetDrag({ libraryId: library.libraryId, assetIds: ids });
                            return;
                          }
                          // Electron's supported path is an asynchronous
                          // one-way IPC from dragstart. A synchronous round
                          // trip deadlocks when this native file drag returns
                          // to Keel as a drop. The OS drag carries Files,
                          // so the canvas must not treat it as an import.
                          beginInternalAssetDrag();
                          event.preventDefault();
                          api.startAssetDrag({
                            libraryId: library.libraryId,
                            assetIds: ids,
                          });
                          return;
                        }
                        managedAssetDragIdsRef.current = ids;
                        event.dataTransfer.setData(
                          MANAGED_ASSETS_DRAG_TYPE,
                          JSON.stringify(ids),
                        );
                        // Serpent-aa3: Option/Alt during dragover selects copy
                        // vs move via dropEffect; both must be allowed here.
                        event.dataTransfer.effectAllowed = "copyMove";
                        // REQ-DND-003: replace Chromium's full-card ghost with
                        // the small, translucent, rounded preview tile
                        // (asset-drag-preview.ts); the same keel:// URL as
                        // the card's <img>, so it is already cached.
                        const preview = showAssetDragPreview({
                          thumbnailUrl:
                            asset.thumbnailStatus === "ready" &&
                            asset.thumbnailArtifactId &&
                            library
                              ? `keel://preview/${library.libraryId}/${asset.thumbnailArtifactId}`
                              : null,
                          fileName: asset.displayName,
                          count: ids.length,
                          copyMode: resolveDragDropMode({
                            altKey: event.altKey,
                          }) === "copy",
                        });
                        dragPreviewRef.current = preview;
                        event.dataTransfer.setDragImage(
                          preview,
                          ASSET_DRAG_PREVIEW_WIDTH / 2,
                          ASSET_DRAG_PREVIEW_HEIGHT / 2,
                        );
                      }}
                      onDrop={(event) => {
                        if (!showTrash && event.dataTransfer.types.includes(TAG_DRAG_TYPE)) {
                          event.preventDefault(); event.stopPropagation(); setTagDropTargetId(null);
                          const tagId = event.dataTransfer.getData(TAG_DRAG_TYPE);
                          if (tags.some((tag) => tag.tagId === tagId)) void assignAssetsToTreeTag([asset.assetId], tagId);
                          return;
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const intent = resolveBrowseContextMenuIntent(
                          { kind: "asset", id: asset.assetId },
                          {
                            assetIds: selectedAssetIds,
                            folderIds: selectedFolderIds,
                          },
                        );
                        if (intent.type === "single-asset") {
                          if (!selectedIdSet.has(intent.assetId)) {
                            setSelectedAssetIds([intent.assetId]);
                            setSelectedAssetId(intent.assetId);
                          }
                          setSelectedFolderIds([]);
                          if (library) {
                            openContextMenu(
                              {
                                type: "asset",
                                assetId: asset.assetId,
                                displayName: asset.displayName,
                                locationKind: asset.locationKind,
                                isAvailable: asset.availability === "available",
                                isDeleted: Boolean(asset.deletedAt),
                              },
                              { x: e.clientX, y: e.clientY },
                            );
                          }
                          return;
                        }
                        if (intent.type !== "multi" || !library) return;
                        openContextMenu(
                          {
                            type: "multi-asset",
                            assetIds: [...intent.assetIds],
                            folderIds: [...intent.folderIds],
                            count:
                              intent.assetIds.length + intent.folderIds.length,
                          },
                          { x: e.clientX, y: e.clientY },
                        );
                      }}
                      type="button"
                    >
                      <div
                        className="asset-preview"
                        data-hover-tip={
                          showThumbnailFailure
                            ? thumbnailFailures.get(asset.assetId)
                            : undefined
                        }
                      >
                        {(() => {
                          if (asset.mediaType === "text" && api && library) {
                            return (
                              <TextAssetPreviewTile
                                api={api}
                                assetId={asset.assetId}
                                fileName={asset.relativeFilePath || asset.displayName}
                                libraryId={library.libraryId}
                                revisionId={asset.currentRevisionId}
                              />
                            );
                          }
                          const thumbCover = cardCover.url;
                          if (isCardSequencePlayable(asset) && library) {
                            const sequenceActive =
                              hoveredAssetId === asset.assetId ||
                              selectedAssetId === asset.assetId;
                            if (
                              thumbCover ||
                              asset.sequence?.frames.some(
                                (frame) => frame.thumbnailArtifactId,
                              )
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  hovering={hoveredAssetId === asset.assetId}
                                  hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                  hoverVideoSound={canvasPrefs.hoverVideoSound}
                                  isActive={sequenceActive}
                                  libraryId={library.libraryId}
                                  loadImmediately={
                                    renderOptions?.loadImmediately
                                      ?? Boolean(virtualBrowseLayout)
                                  }
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                  mediaMuted={viewerVolumeMuted}
                                  mediaVolume={viewerVolume}
                                  preview={null}
                                  sequence={asset.sequence}
                                />
                              );
                            }
                          }
                          const cardActive =
                            activePreviewAssetId === asset.assetId;
                          const cardThumbFailed =
                            asset.thumbnailStatus === "failed"
                            && !layoutThumbnailArtifactId;
                          if (isCardHoverPreviewable(asset)) {
                            if (
                              thumbCover ||
                              (cardActive && activeResolution?.url)
                            ) {
                              return (
                                <AssetCardMedia
                                  alt={asset.displayName}
                                  coverUrl={thumbCover}
                                  failed={cardThumbFailed}
                                  hovering={hoveredAssetId === asset.assetId}
                                  hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                  hoverVideoSound={canvasPrefs.hoverVideoSound}
                                  isActive={cardActive}
                                  libraryId={library.libraryId}
                                  loadImmediately={
                                    renderOptions?.loadImmediately
                                      ?? Boolean(virtualBrowseLayout)
                                  }
                                  deferUntilVisible={Boolean(virtualBrowseLayout)}
                                  mediaMuted={viewerVolumeMuted}
                                  mediaVolume={viewerVolume}
                                  onLiveVideoError={() =>
                                    retryLiveVideoProxyFallback(asset.assetId)
                                  }
                                  preview={
                                    cardActive ? activeResolution : null
                                  }
                                />
                              );
                            }
                          } else if (thumbCover) {
                            // Serpent-2ajm: unify with AssetCardMedia so a
                            // failed load shows the themed fallback icon
                            // instead of the browser's broken-image glyph.
                            return (
                              <AssetCardMedia
                                alt={asset.displayName}
                                coverUrl={thumbCover}
                                failed={cardThumbFailed}
                                hovering={hoveredAssetId === asset.assetId}
                                hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                                hoverVideoSound={canvasPrefs.hoverVideoSound}
                                isActive={false}
                                libraryId={library.libraryId}
                                loadImmediately={
                                  renderOptions?.loadImmediately
                                    ?? Boolean(virtualBrowseLayout)
                                }
                                deferUntilVisible={Boolean(virtualBrowseLayout)}
                                mediaMuted={viewerVolumeMuted}
                                mediaVolume={viewerVolume}
                                preview={null}
                              />
                            );
                          }
                          return (
                            <>
                              <Icon
                                name={
                                  cardThumbFailed ? "broken-file" : "file"
                                }
                                size={28}
                              />
                              {!showExtension &&
                                shouldShowExtensionBadge(asset.mediaType) && (
                                  <span className="asset-extension">
                                    {fileExtensionLabel(asset.displayName)}
                                  </span>
                                )}
                            </>
                          );
                        })()}
                        {sourceBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                            className="asset-source-badge"
                            data-hover-tip={t("scope.containingFolder", {
                              name: sourceBadgeLabel,
                            })}
                          >
                            {sourceBadgeLabel}
                          </span>
                        )}
                        {trashOriginBadgeLabel && (
                          <span
                            aria-label={t("scope.containingFolder", {
                              name: trashOriginBadgeLabel,
                            })}
                            className="asset-source-badge"
                            data-hover-tip={asset.trashedFromPath ?? trashOriginBadgeLabel}
                          >
                            {trashOriginBadgeLabel}
                          </span>
                        )}
                        {showExtension && (
                          <span className="asset-extension">
                            {fileExtensionLabel(asset.displayName)}
                          </span>
                        )}
                        {showThumbnailFailure && (
                          <span className="missing-banner">
                            <Icon name="warning" size={12} />
                            {t("toast.thumbnailFailedBadge")}
                          </span>
                        )}
                        {shouldShowMissingAssetOverlay(asset.availability) && (
                          <span
                            aria-label={
                              corruptAsset
                                ? t("inspector.dataCorrupt")
                                : t("inspector.missing")
                            }
                            data-hover-tip={
                              corruptAsset
                                ? t("inspector.dataCorrupt")
                                : t("inspector.missing")
                            }
                            className="missing-overlay"
                          >
                            {(() => {
                              const affordance = corruptAsset
                                ? corruptAssetAffordance()
                                : missingAssetAffordance();
                              return (
                                <Icon
                                  color={affordance.iconColor}
                                  name={affordance.icon}
                                  size={28}
                                />
                              );
                            })()}
                          </span>
                        )}
                        {asset.deletedAt && (
                          <span
                            className="missing-banner"
                            style={{
                              background: "var(--raised-2)",
                              color: "var(--secondary)",
                              bottom: 6,
                              right: 6,
                            }}
                          >
                            <Icon name="trash" size={12} />
                            {t("inspector.trashed")}
                            {asset.remainingDays !== null &&
                              t("scope.remainingDays", {
                                days: asset.remainingDays,
                              })}
                          </span>
                        )}
                        {showDuration && asset.durationMs != null && (
                          <span className="asset-duration-badge">
                            {formatDuration(asset.durationMs)}
                          </span>
                        )}
                        {asset.sequence && (
                          <span className="asset-duration-badge asset-sequence-badge">
                            {asset.sequence.frameCount}F · {asset.sequence.fps} FPS ·{" "}
                            {formatSequenceDuration(
                              asset.sequence.frameCount,
                              asset.sequence.fps,
                            )}
                          </span>
                        )}
                        {showTypeBadge && typeBadge && (
                          <span className="asset-type-badge">{typeBadge}</span>
                        )}
                      </div>
                      {(renamingThisAsset ||
                        canvasPrefs.fields.name ||
                        canvasPrefs.fields.size ||
                        canvasPrefs.fields.date ||
                        snippetCaption != null ||
                        shouldShowGridDimensions(
                          canvasPrefs.fields,
                          assetViewMode,
                          asset.width,
                          asset.height,
                          { mediaType: asset.mediaType },
                        )) && (
                        <div
                          className={`asset-caption ${assetCaptionAlignClass(canvasPrefs.captionAlign)}`}
                        >
                          {shouldShowGridDimensions(
                            canvasPrefs.fields,
                            assetViewMode,
                            asset.width,
                            asset.height,
                            { mediaType: asset.mediaType },
                          ) &&
                            !renamingThisAsset && (
                              <span className="asset-dimensions">
                                {asset.width} × {asset.height}
                              </span>
                            )}
                          {(canvasPrefs.fields.name || renamingThisAsset) && (
                            <>
                              {renamingThisAsset && assetRenameDialog ? (
                                <span className="asset-inline-rename">
                                  <input
                                    aria-label={t("dialog.rename.fileTitle")}
                                    autoFocus
                                    className="text-field asset-inline-rename-input"
                                    readOnly={assetRenameDialog.submitting}
                                    aria-disabled={assetRenameDialog.submitting || undefined}
                                    onBlur={() => {
                                      void submitAssetRename();
                                    }}
                                    onChange={(event) =>
                                      changeAssetRenameValue(event.target.value)
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                    onFocus={(event) => {
                                      const { baseName } = splitAssetFileName(
                                        event.currentTarget.value,
                                      );
                                      event.currentTarget.setSelectionRange(
                                        0,
                                        baseName.length,
                                      );
                                    }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (isImeKeyboardEvent(event)) return;
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void submitAssetRename();
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelAssetRename();
                                      }
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    value={assetRenameDialog.value}
                                  />
                                  {assetRenameDialog.error ? (
                                    <span className="asset-inline-rename-error">
                                      {assetRenameDialog.error}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <strong className="asset-caption-filename" data-hover-tip={asset.displayName}>
                                  {renderMiddleEllipsisFilename(asset.displayName, searchValue)}
                                </strong>
                              )}
                            </>
                          )}
                          {snippetCaption != null ? (
                            <span className="search-snippet">
                              {highlightSnippet(snippetCaption)}
                            </span>
                          ) : (canvasPrefs.fields.size ||
                              canvasPrefs.fields.date) ? (
                            <span>
                              {canvasPrefs.fields.size &&
                                formatBytes(asset.byteSize)}
                              {canvasPrefs.fields.size &&
                                canvasPrefs.fields.date &&
                                " · "}
                              {canvasPrefs.fields.date &&
                                formatDate(asset.modifiedAt, locale, t("common.unknownTime"))}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {syncStatus ? <SyncCardStatusBadge status={syncStatus} /> : null}
                    </CardTag>
                    );
                    };
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
                {/* Serpent-87pd: invisible tail probe. A jump to the end fills
                    the last window, not pages 0 → 100 → 200. Serpent-6z5r:
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
