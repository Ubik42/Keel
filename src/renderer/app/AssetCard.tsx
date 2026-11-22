import { memo } from "react";
import type { JSX } from "react";
import type { AssetRenameDialogState } from "../useAssetRename";
import type { PreviewResolution } from "../../shared/library-api";
import { type AssetSummary } from "../../shared/asset-types";
import { assetTypeBadgeLabel, fileExtensionLabel, formatSequenceDuration, shouldShowDurationBadge, shouldShowExtensionBadge, shouldShowTypeBadgeAlongsideExtension } from "../asset-card-badges";
import { isCardHoverPreviewable, isCardSequencePlayable, resolveAssetCardCoverUrl } from "../asset-card-hover-preview";
import { MANAGED_ASSETS_DRAG_TYPE, resolveDragDropMode, resolveDraggedAssetIds } from "../asset-drag-drop";
import { ASSET_DRAG_PREVIEW_HEIGHT, ASSET_DRAG_PREVIEW_WIDTH, dismissAssetDragPreview, showAssetDragPreview } from "../asset-drag-preview";
import { resolveAssetSourceBadgeLabel, shouldShowAssetSourceBadge } from "../asset-source-badge";
import { AssetCardMedia } from "../AssetCardMedia";
import { corruptAssetAffordance, isCorruptAsset, missingAssetAffordance, shouldShowMissingAssetOverlay } from "../availability-affordance";
import { resolveBrowseContextMenuIntent } from "../browse-selection-menu";
import { assetCaptionAlignClass, shouldShowGridDimensions } from "../canvas-preferences";
import { formatBytes } from "../format-file-meta";
import { Icon } from "../Icons";
import { resolveSearchSnippetCaption } from "../search-snippet-caption";
import { SyncCardStatusBadge } from "../SyncCardStatusBadge";
import { TAG_DRAG_TYPE } from "../tag-drag-drop";
import { TextAssetPreviewTile } from "../TextAssetPreviewTile";
import { shouldShowThumbnailFailureBadge } from "../thumbnail-failure-badge";
import { trashedFromLabel } from "../trashed-from-label";
import { splitAssetFileName } from "../useAssetRename";
import { resolveMasonryTabTarget } from "../workbench/collection/masonry-focus-order";
import { isImeKeyboardEvent } from "../workbench/overlay/ime-safe-dismiss";
import { formatDate, formatDuration, highlightSnippet, renderMiddleEllipsisFilename } from "./app-shared";

type SyncCardStatus = Parameters<typeof SyncCardStatusBadge>[0]["status"];
import type { BrowseCanvasProps } from "./BrowseCanvas";
import type { NavigationState } from "../stores/navigation-store";
import type { SessionState } from "../stores/session-store";
import type { QueryState } from "../stores/query-store";

/** Shared inputs of every card; functions keep their identity (useStableCallbacks). */
export interface AssetCardContext {
  api: BrowseCanvasProps["api"];
  assetViewMode: BrowseCanvasProps["assetViewMode"];
  assignAssetsToTreeTag: BrowseCanvasProps["assignAssetsToTreeTag"];
  beginInternalAssetDrag: BrowseCanvasProps["beginInternalAssetDrag"];
  cancelAssetRename: BrowseCanvasProps["cancelAssetRename"];
  canvasPrefs: BrowseCanvasProps["canvasPrefs"];
  cardMouseDownRef: BrowseCanvasProps["cardMouseDownRef"];
  changeAssetRenameValue: BrowseCanvasProps["changeAssetRenameValue"];
  clearHoveredAssetId: BrowseCanvasProps["clearHoveredAssetId"];
  dragPreviewRef: BrowseCanvasProps["dragPreviewRef"];
  handleCardClick: BrowseCanvasProps["handleCardClick"];
  locale: BrowseCanvasProps["locale"];
  managedAssetDragIdsRef: BrowseCanvasProps["managedAssetDragIdsRef"];
  nativeAssetDragEnabled: BrowseCanvasProps["nativeAssetDragEnabled"];
  openAssetByDefault: BrowseCanvasProps["openAssetByDefault"];
  openContextMenu: BrowseCanvasProps["openContextMenu"];
  retryLiveVideoProxyFallback: BrowseCanvasProps["retryLiveVideoProxyFallback"];
  selectedFolderId: BrowseCanvasProps["selectedFolderId"];
  setHoveredAssetId: BrowseCanvasProps["setHoveredAssetId"];
  sourceBadgeContext: BrowseCanvasProps["sourceBadgeContext"];
  submitAssetRename: BrowseCanvasProps["submitAssetRename"];
  t: BrowseCanvasProps["t"];
  viewerVolume: BrowseCanvasProps["viewerVolume"];
  viewerVolumeMuted: BrowseCanvasProps["viewerVolumeMuted"];
  workspaceCanvasRef: BrowseCanvasProps["workspaceCanvasRef"];
  folders: NavigationState["folders"];
  tags: NavigationState["tags"];
  showTrash: NavigationState["showTrash"];
  library: SessionState["library"];
  searchValue: QueryState["searchValue"];
  setSelectedAssetIds(ids: string[]): void;
  setSelectedAssetId(id: string | undefined): void;
  setSelectedFolderIds(ids: string[]): void;
  setTagDropTargetId(id: string | null): void;
  showCornerBadges: boolean;
  /** Cards defer media until visible in a virtual layout. */
  virtualized: boolean;
  getSelectedAssetIds(): string[];
  getSelectedFolderIds(): string[];
  getSelectionAssetIds(): string[] | undefined;
  getNativeDragReadyIds(): ReadonlySet<string>;
}

export interface AssetCardProps {
  asset: AssetSummary;
  loadImmediately: boolean | undefined;
  ctx: AssetCardContext;
  selected: boolean;
  hovering: boolean;
  primarySelected: boolean;
  active: boolean;
  activeResolution: PreviewResolution | null;
  dropTarget: boolean;
  renameDialog: AssetRenameDialogState | null;
  nativeDragReady: boolean;
  thumbnailFailure: string | undefined;
  snippet: string | undefined;
  syncStatusValue: SyncCardStatus | undefined;
  layoutThumbnailArtifactValue: string | undefined;
  layoutPreviewArtifactId: string | null;
}

/**
 * One card in the browse grid. Memoized: hovering, selecting or playing a
 * card re-renders only the cards whose own props change.
 */
export const AssetCard = memo(function AssetCard(props: AssetCardProps): JSX.Element {
  const { asset, ctx, selected, hovering, primarySelected, active, activeResolution, dropTarget, renameDialog, nativeDragReady, thumbnailFailure, snippet, syncStatusValue, layoutThumbnailArtifactValue, layoutPreviewArtifactId } = props;
  const renderOptions = { loadImmediately: props.loadImmediately };
  const { api, assetViewMode, assignAssetsToTreeTag, beginInternalAssetDrag, cancelAssetRename, canvasPrefs, cardMouseDownRef, changeAssetRenameValue, clearHoveredAssetId, dragPreviewRef, handleCardClick, locale, managedAssetDragIdsRef, nativeAssetDragEnabled, openAssetByDefault, openContextMenu, retryLiveVideoProxyFallback, selectedFolderId, setHoveredAssetId, sourceBadgeContext, submitAssetRename, t, viewerVolume, viewerVolumeMuted, workspaceCanvasRef, folders, tags, showTrash, library, searchValue, setSelectedAssetIds, setSelectedAssetId, setSelectedFolderIds, setTagDropTargetId, showCornerBadges, virtualized, getSelectedAssetIds, getSelectedFolderIds, getSelectionAssetIds, getNativeDragReadyIds } = ctx;
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
      snippet,
      asset.displayName,
    );
    const syncStatus =
      syncStatusValue;
    const layoutThumbnailArtifactId =
      layoutThumbnailArtifactValue;
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
        ?? layoutPreviewArtifactId
        ?? null,
      previewKind: asset.previewKind,
      previewRevisionId: asset.previewRevisionId,
    });
    const showThumbnailFailure = shouldShowThumbnailFailureBadge(
      asset,
      thumbnailFailure !== undefined,
    );
    const renamingThisAsset =
      renameDialog !== null;
    const corruptAsset = isCorruptAsset(asset);
    const CardTag = renamingThisAsset ? "div" : "button";
    return (
  <CardTag
    aria-label={canvasPrefs.fields.name ? undefined : asset.displayName}
    data-hover-tip={canvasPrefs.fields.name ? undefined : asset.displayName}
    aria-pressed={selected}
    className={`asset-card${selected ? " is-selected" : ""}${asset.availability === "missing" ? " is-missing" : ""}${corruptAsset ? " is-corrupt" : ""}${asset.deletedAt ? " is-trashed" : ""}${renamingThisAsset ? " is-renaming" : ""}`}
    data-tag-drop-target={dropTarget || undefined}
    data-asset-id={asset.assetId}
    data-asset-name={asset.displayName}
    data-media-type={asset.mediaType}
    draggable={
      !showTrash && !renamingThisAsset && (
        !nativeAssetDragEnabled
        || nativeDragReady
      )
    }
    {...(renamingThisAsset
      ? { role: "group" as const }
      : { type: "button" as const })}
    onMouseDown={(e) => {
      cardMouseDownRef.current = e.button;
      if (e.button !== 0 || showTrash || renamingThisAsset || !api || !library) {
        return;
      }
      const ids = resolveDraggedAssetIds(asset.assetId, getSelectedAssetIds());
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
        getSelectionAssetIds() ?? [],
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
      const ids = resolveDraggedAssetIds(asset.assetId, getSelectedAssetIds());
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
        if (!ids.every((id) => getNativeDragReadyIds().has(id))) {
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
          assetIds: getSelectedAssetIds(),
          folderIds: getSelectedFolderIds(),
        },
      );
      if (intent.type === "single-asset") {
        if (!getSelectedAssetIds().includes(intent.assetId)) {
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
          ? thumbnailFailure
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
            hovering ||
            primarySelected;
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
                hovering={hovering}
                hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                hoverVideoSound={canvasPrefs.hoverVideoSound}
                isActive={sequenceActive}
                libraryId={library.libraryId}
                loadImmediately={
                  renderOptions?.loadImmediately
                    ?? virtualized
                }
                deferUntilVisible={virtualized}
                mediaMuted={viewerVolumeMuted}
                mediaVolume={viewerVolume}
                preview={null}
                sequence={asset.sequence}
              />
            );
          }
        }
        const cardActive =
          active;
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
                hovering={hovering}
                hoverAudioPlay={canvasPrefs.hoverAudioPlay}
                hoverVideoSound={canvasPrefs.hoverVideoSound}
                isActive={cardActive}
                libraryId={library?.libraryId ?? ""}
                loadImmediately={
                  renderOptions?.loadImmediately
                    ?? virtualized
                }
                deferUntilVisible={virtualized}
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
              hovering={hovering}
              hoverAudioPlay={canvasPrefs.hoverAudioPlay}
              hoverVideoSound={canvasPrefs.hoverVideoSound}
              isActive={false}
              libraryId={library?.libraryId ?? ""}
              loadImmediately={
                renderOptions?.loadImmediately
                  ?? virtualized
              }
              deferUntilVisible={virtualized}
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
            background: "var(--ui-surface-raised-subtle)",
            color: "var(--ui-content-secondary)",
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
            {renamingThisAsset && renameDialog ? (
              <span className="asset-inline-rename">
                <input
                  aria-label={t("dialog.rename.fileTitle")}
                  autoFocus
                  className="text-field asset-inline-rename-input"
                  readOnly={renameDialog.submitting}
                  aria-disabled={renameDialog.submitting || undefined}
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
                  value={renameDialog.value}
                />
                {renameDialog.error ? (
                  <span className="asset-inline-rename-error">
                    {renameDialog.error}
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
});
