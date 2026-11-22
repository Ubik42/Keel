import { useNavigationField } from "../../stores/navigation-store";
import { usePreviewField } from "../../stores/preview-store";
import { useSessionField } from "../../stores/session-store";
import type { RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../../shared/library-api";
import type { ViewerChromePreferences } from "../../viewer-chrome-preferences";
import type { ViewerChromeActivitySource } from "../../viewer-chrome-idle";
import { type AssetSummary } from "../../../shared/asset-types";
import { AssetPreviewModal, type AssetPreviewModalHandle } from "../../AssetPreviewModal";
import { type RendererWindow } from "../shared/app-shared";

export interface AssetPreviewHostProps {
  api: KeelLibraryApi | undefined;
  previewModalRef: RefObject<AssetPreviewModalHandle | null>;
  bakeImageRotation: boolean;
  viewerChromeIdle: boolean;
  viewerChromePrefs: ViewerChromePreferences;
  setViewerChromePrefs: (action: SetStateAction<ViewerChromePreferences>) => void;
  requestSelectionDiskDelete: (assetIds: string[], folderIds: readonly string[]) => void;
  deletePermanentFromTrash: (assetIds: string[]) => Promise<boolean>;
  advanceOpenViewer: (removedId: string) => void;
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  onViewerChromeActivity: (source: ViewerChromeActivitySource) => void;
  persistAssetColorSpace: (assetId: string, colorSpace: string | null) => Promise<void>;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  previewIndex: number;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  navigateAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  pluginContributionRefreshKey: string;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function AssetPreviewHost({ api, previewModalRef, bakeImageRotation, viewerChromeIdle, viewerChromePrefs, setViewerChromePrefs, requestSelectionDiskDelete, deletePermanentFromTrash, advanceOpenViewer, trashManagedAssets, onViewerChromeActivity, persistAssetColorSpace, closeAssetPreview, setNotice, previewIndex, visibleAssets, navigateAssetPreview, pluginContributionRefreshKey }: AssetPreviewHostProps) {
  const [previewAsset] = usePreviewField("previewAsset");
  const [library] = useSessionField("library");
  const [showTrash] = useNavigationField("showTrash");
  return (
<>
{previewAsset && library && api && (
          <>
          <AssetPreviewModal
            ref={previewModalRef}
            api={api}
            asset={previewAsset}
            bakeImageRotation={bakeImageRotation}
            chromeIdle={viewerChromeIdle}
            canDiskDeleteAsset={!showTrash && previewAsset.deletedAt === null}
            canPermanentDelete={showTrash}
            canTrashAsset={
              previewAsset.locationKind === "managed"
              && previewAsset.deletedAt === null
              && !showTrash
            }
            libraryId={library.libraryId}
            navArrowsOnApproach={viewerChromePrefs.navArrowsOnApproach}
            onToggleNavArrowsOnApproach={() => {
              setViewerChromePrefs((current) => ({
                ...current,
                navArrowsOnApproach: !current.navArrowsOnApproach,
              }));
            }}
            onToggleVideoTransportOnApproach={() => {
              setViewerChromePrefs((current) => ({
                ...current,
                videoTransportOnApproach: !current.videoTransportOnApproach,
              }));
            }}
            onDiskDeleteAsset={() => {
              requestSelectionDiskDelete([previewAsset.assetId], []);
            }}
            onPermanentDelete={() => {
              const assetId = previewAsset.assetId;
              void deletePermanentFromTrash([assetId]).then((removed) => {
                if (removed) advanceOpenViewer(assetId);
              });
            }}
            onTrashAsset={() => {
              const assetId = previewAsset.assetId;
              void trashManagedAssets([assetId]).then(() => {
                advanceOpenViewer(assetId);
              });
            }}
            videoTransportOnApproach={viewerChromePrefs.videoTransportOnApproach}
            onChromeActivity={onViewerChromeActivity}
            onSetColorSpace={(assetId, colorSpace) => {
              void persistAssetColorSpace(assetId, colorSpace);
            }}
            onClose={() => void closeAssetPreview()}
            onInfoNotice={setNotice}
            onNext={
              previewIndex >= 0 && previewIndex < visibleAssets.length - 1
                ? () => navigateAssetPreview(visibleAssets[previewIndex + 1]!)
                : undefined
            }
            onPrevious={
              previewIndex > 0
                ? () => navigateAssetPreview(visibleAssets[previewIndex - 1]!)
                : undefined
            }
            pluginApi={(window as RendererWindow).keel?.plugins}
            pluginContributionRefreshKey={pluginContributionRefreshKey}
          />
          </>
        )}
</>
  );
}
