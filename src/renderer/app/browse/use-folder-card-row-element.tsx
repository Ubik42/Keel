import type { Dispatch, DragEvent, MutableRefObject, RefObject, SetStateAction } from "react";
import type { BrowseCanvasBodyLayout } from "../../folder-browse-canvas";
import type { ResizablePanel } from "../../workbench/shell/panel-auto-hide";
import type { FilteredFolderCounts } from "../../use-filtered-folder-counts";
import type { ContextMenuDescriptor } from "../../workbench/menu/context-menu";
import { resolveBrowseContextMenuIntent } from "../../browse-selection-menu";
import { FolderCard } from "../../FolderCard";
import { type AssetScope, type NavigationState } from "../../stores/navigation-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { MANAGED_FOLDERS_DRAG_TYPE, resolveDraggedFolderIds } from "../../workbench/tree/folder-drag-drop";
import { type WorkspaceNavigationRequest } from "../shared/app-shared";
import { type CSSProperties } from "react";

export interface UseFolderCardRowElementDeps {
  folderCardRowVisible: boolean;
  browseCanvasBodyLayout: BrowseCanvasBodyLayout;
  folderCardWidthPx: number;
  panelResizing: ResizablePanel | null;
  panelReflowFrozenWidthRef: RefObject<number | null>;
  folderRowEntries: { folderId: string; parentFolderId: string | null; locationKind: "managed" | "linked"; name: string; relativePath: string; status: "available" | "offline"; directAssetCount: number; recursiveAssetCount: number; childFolderCount: number; coverArtifactIds: string[]; coverAssetIds: string[]; hasCustomCover?: boolean | undefined; customCoverToken?: string | undefined; customCoverAssetId?: string | undefined; customCoverArtifactId?: string | undefined; customCoverSourcePreview?: { assetId: string; revisionId: string; } | undefined; coverSourcePreviews?: { assetId: string; revisionId: string; }[] | undefined; linkedFolderId?: string | null | undefined; }[];
  showTrash: NavigationState["showTrash"];
  library: SessionState["library"];
  filteredFolderCounts: FilteredFolderCounts | null;
  createFolderCardDropHandlers: (folderId: string) => { dropActive: boolean; onDragEnter: (event: DragEvent<HTMLButtonElement>) => void; onDragLeave: (event: DragEvent<HTMLButtonElement>) => void; onDragOver: (event: DragEvent<HTMLButtonElement>) => void; onDrop: (event: DragEvent<HTMLButtonElement>) => void; };
  selectedFolderIds: SelectionState["selectedFolderIds"];
  managedFolderDragIdsRef: RefObject<readonly string[] | null>;
  searchActive: boolean;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  handleFolderCardClick: (folderId: string, event: React.MouseEvent) => void;
  openContextMenu: (descriptor: ContextMenuDescriptor, position: { x: number; y: number; }) => void;
  selectedAssetIds: SelectionState["selectedAssetIds"];
  setSelectedFolderIds: Dispatch<SetStateAction<SelectionState["selectedFolderIds"]>>;
  setSelectedAssetIds: Dispatch<SetStateAction<SelectionState["selectedAssetIds"]>>;
  enterTrashAt: (tombstoneId: string | null, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  cardMouseDownRef: MutableRefObject<number>;
  selectedFolderIdSet: Set<string>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useFolderCardRowElement({ folderCardRowVisible, browseCanvasBodyLayout, folderCardWidthPx, panelResizing, panelReflowFrozenWidthRef, folderRowEntries, showTrash, library, filteredFolderCounts, createFolderCardDropHandlers, selectedFolderIds, managedFolderDragIdsRef, searchActive, chooseFolder, handleFolderCardClick, openContextMenu, selectedAssetIds, setSelectedFolderIds, setSelectedAssetIds, enterTrashAt, cardMouseDownRef, selectedFolderIdSet }: UseFolderCardRowElementDeps) {
  const folderCardRowElement = folderCardRowVisible ? (
    <div
      className={
        browseCanvasBodyLayout.mode === "folders-only"
          ? "folder-card-row is-folders-only"
          : "folder-card-row"
      }
      style={
        {
          "--folder-card-size": `${folderCardWidthPx}px`,
          ...(panelResizing && panelReflowFrozenWidthRef.current
            ? {
                width: `${panelReflowFrozenWidthRef.current}px`,
              }
            : {}),
        } as CSSProperties
      }
    >
      {folderRowEntries.map((entry) => (
        <FolderCard
          draggable={!showTrash}
          entry={entry}
          key={entry.folderId}
          libraryId={library!.libraryId}
          trashed={showTrash}
          filteredCount={
            showTrash || !filteredFolderCounts
              ? undefined
              : filteredFolderCounts.byFolderId.get(entry.folderId) ?? 0
          }
          {...(showTrash
            ? {}
            : createFolderCardDropHandlers(entry.folderId))}
          onDragStart={(event) => {
            const folderIds = resolveDraggedFolderIds(
              entry.folderId,
              selectedFolderIds,
            );
            // Serpent-374266: let the sidebar validate drop targets with it.
            managedFolderDragIdsRef.current = [...folderIds];
            event.dataTransfer.setData(
              MANAGED_FOLDERS_DRAG_TYPE,
              JSON.stringify(folderIds),
            );
            event.dataTransfer.effectAllowed = "move";
          }}
          onClick={(folderId, event) => {
            // During a search a folder-result click enters the folder (the
            // browse-only selection semantics do not apply in search).
            if (searchActive) {
              void chooseFolder(folderId);
              return;
            }
            handleFolderCardClick(folderId, event);
          }}
          onContextMenu={(clickedEntry, event) => {
            event.preventDefault();
            if (showTrash) {
              openContextMenu(
                {
                  type: "trashed-folder",
                  tombstoneId: clickedEntry.folderId,
                  name: clickedEntry.name,
                  relativePath: clickedEntry.relativePath,
                },
                { x: event.clientX, y: event.clientY },
              );
              return;
            }
            const intent = resolveBrowseContextMenuIntent(
              { kind: "folder", id: clickedEntry.folderId },
              {
                assetIds: selectedAssetIds,
                folderIds: selectedFolderIds,
              },
            );
            if (intent.type === "single-folder") {
              setSelectedFolderIds([intent.folderId]);
              setSelectedAssetIds([]);
              openContextMenu(
                {
                  type: "folder",
                  folderId:
                    clickedEntry.linkedFolderId ?? intent.folderId,
                  name: clickedEntry.name,
                  locationKind: clickedEntry.locationKind,
                  linkedRelativePath:
                    clickedEntry.locationKind === "linked" &&
                    clickedEntry.relativePath
                      ? clickedEntry.relativePath
                      : undefined,
                },
                { x: event.clientX, y: event.clientY },
              );
              return;
            }
            if (intent.type !== "multi") return;
            openContextMenu(
              {
                type: "multi-asset",
                assetIds: [...intent.assetIds],
                folderIds: [...intent.folderIds],
                count:
                  intent.assetIds.length + intent.folderIds.length,
              },
              { x: event.clientX, y: event.clientY },
            );
          }}
          onDoubleClick={(folderId) => {
            if (showTrash) {
              const entry = folderRowEntries.find(
                (item) => item.folderId === folderId,
              );
              if (!entry) return;
              void enterTrashAt(entry.folderId);
              return;
            }
            void chooseFolder(folderId);
          }}
          onMouseDown={(event) => {
            cardMouseDownRef.current = event.button;
          }}
          selected={selectedFolderIdSet.has(entry.folderId)}
        />
      ))}
    </div>
  ) : null;
  return { folderCardRowElement };
}
