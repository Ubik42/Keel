import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkspaceNavigationToken } from "../../workbench/workspace/workspace-navigation-coordinator";
import type { WorkspaceNavHistory } from "../../workbench/workspace/workspace-nav-history";
import { type BrowseState } from "../../stores/browse-store";
import { type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { BROWSE_PAGE_SIZE } from "../../browse/use-browse-pagination";
import { type WorkspaceNavLocation } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { captureWorkspaceNavViewport } from "../../workbench/workspace/workspace-scroll-position";
import { type WorkspaceRenderSnapshot, type WorkspaceVirtualLayoutSnapshot } from "../../workspace/workspace-render-snapshot-cache";
import { type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface UseWorkspaceNavigationRequestsDeps {
  findSimilarTokenRef: RefObject<number>;
  beginWorkspaceTabNavigation: (historyMode?: WorkspaceNavigationHistoryMode) => WorkspaceNavigationToken;
  isWorkspaceTabNavigationCurrent: (token: WorkspaceNavigationToken) => boolean;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  setShowTrash: Dispatch<SetStateAction<NavigationState["showTrash"]>>;
  setShowTagManagement: Dispatch<SetStateAction<NavigationState["showTagManagement"]>>;
  setActivePluginSidebarViewId: Dispatch<SetStateAction<NavigationState["activePluginSidebarViewId"]>>;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
  setAssetScope: Dispatch<SetStateAction<NavigationState["assetScope"]>>;
  setTrashBrowseTombstoneId: Dispatch<SetStateAction<BrowseState["trashBrowseTombstoneId"]>>;
  closeContextMenu: () => void;
  virtualBrowseLayout: BrowseState["virtualBrowseLayout"];
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  browseLayout: BrowseState["browseLayout"];
  searchOffset: BrowseState["searchOffset"];
  searchValue: QueryState["searchValue"];
  showTrash: NavigationState["showTrash"];
  trashBrowseTombstoneId: BrowseState["trashBrowseTombstoneId"];
  trashedAssets: BrowseState["trashedAssets"];
  trashedFolders: NavigationState["trashedFolders"];
  trashedAssetCount: BrowseState["trashedAssetCount"];
  showTagManagement: NavigationState["showTagManagement"];
  activePluginSidebarViewId: NavigationState["activePluginSidebarViewId"];
  assets: BrowseState["assets"];
  searchTotal: BrowseState["searchTotal"];
  searchSnippets: BrowseState["searchSnippets"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useWorkspaceNavigationRequests({ findSimilarTokenRef, beginWorkspaceTabNavigation, isWorkspaceTabNavigationCurrent, setWorkspaceNavigationPending, setShowTrash, setShowTagManagement, setActivePluginSidebarViewId, setActiveTagId, setAssetScope, setTrashBrowseTombstoneId, closeContextMenu, virtualBrowseLayout, workspaceCanvasRef, navHistoryRef, browseLayout, searchOffset, searchValue, showTrash, trashBrowseTombstoneId, trashedAssets, trashedFolders, trashedAssetCount, showTagManagement, activePluginSidebarViewId, assets, searchTotal, searchSnippets }: UseWorkspaceNavigationRequestsDeps) {

  function beginWorkspaceNavigationRequest(
    historyMode: WorkspaceNavigationHistoryMode,
  ): WorkspaceNavigationRequest {
    findSimilarTokenRef.current += 1;
    const token = beginWorkspaceTabNavigation(historyMode);
    const request: WorkspaceNavigationRequest = {
      token,
      historyMode,
      isCurrent: () => isWorkspaceTabNavigationCurrent(token),
    };
    setWorkspaceNavigationPending(true);
    return request;
  }

  function createWorkspaceNavigationRequest(
    request: WorkspaceNavigationRequest | undefined,
    historyMode: WorkspaceNavigationHistoryMode = "push",
  ): WorkspaceNavigationRequest {
    return request ?? beginWorkspaceNavigationRequest(historyMode);
  }

  function applyWorkspaceLocationFlags(location: WorkspaceNavLocation): void {
    if (location.kind === "similar") return;
    setShowTrash(location.kind === "trash");
    setShowTagManagement(location.kind === "tag-management");
    setActivePluginSidebarViewId(
      location.kind === "plugin-sidebar" ? location.viewId : null,
    );
    setActiveTagId(location.kind === "tag" ? location.tagId : null);
    setAssetScope(location.kind === "folder" ? location.folderId : location.kind === "root" ? "root" : "all");
    if (location.kind === "trash") setTrashBrowseTombstoneId(location.tombstoneId);
  }

  /** Sidebar selection and chrome must move on the click, not after Worker SQL. */
  function acknowledgeWorkspaceNavigation(location: WorkspaceNavLocation): void {
    applyWorkspaceLocationFlags(location);
    closeContextMenu();
  }

  function virtualLayoutSnapshotForCurrentViewport(): WorkspaceVirtualLayoutSnapshot | null {
    if (!virtualBrowseLayout) return null;
    const viewport = captureWorkspaceNavViewport(workspaceCanvasRef.current);
    const focusIndex = Math.round(
      viewport.scrollProgress * Math.max(0, virtualBrowseLayout.total - 1),
    );
    const nearestIndices = (indices: Iterable<number>) =>
      [...indices]
        .sort((a, b) => Math.abs(a - focusIndex) - Math.abs(b - focusIndex))
        .slice(0, 240);
    const selectedGeometryIndices = new Set(
      nearestIndices(virtualBrowseLayout.geometryEntries.keys()),
    );
    const selectedAssetIndices = new Set(
      nearestIndices(virtualBrowseLayout.assetIdsByIndex.keys()),
    );
    const selectedEntryIndices = new Set(
      nearestIndices(virtualBrowseLayout.entries.keys()),
    );
    const selectedAssetIds = new Set(
      [...selectedAssetIndices].map((index) =>
        virtualBrowseLayout.assetIdsByIndex.get(index),
      ).filter((assetId): assetId is string => assetId !== undefined),
    );
    return {
      total: virtualBrowseLayout.total,
      geometryRevision: virtualBrowseLayout.geometryRevision,
      geometryEntries: [...virtualBrowseLayout.geometryEntries.entries()]
        .filter(([index]) => selectedGeometryIndices.has(index)),
      assetIdsByIndex: [...virtualBrowseLayout.assetIdsByIndex.entries()]
        .filter(([index]) => selectedAssetIndices.has(index)),
      entries: [...virtualBrowseLayout.entries.entries()]
        .filter(([index]) => selectedEntryIndices.has(index)),
      indexByAssetId: [...virtualBrowseLayout.indexByAssetId.entries()]
        .filter(([assetId]) => selectedAssetIds.has(assetId)),
    };
  }

  function captureWorkspaceRenderSnapshot(): WorkspaceRenderSnapshot | null {
    const history = navHistoryRef.current;
    const location = history.current.kind === "preview"
      ? (history.peek(-1) ?? { kind: "all" as const })
      : history.current;
    const virtualLayout = virtualLayoutSnapshotForCurrentViewport();
    if (!virtualLayout && browseLayout.length > 1_200) return null;
    const pageDescriptor = {
      sessionId: null,
      offset: searchOffset,
      pageSize: BROWSE_PAGE_SIZE,
      scopeKey: JSON.stringify(location),
      queryKey: searchValue.trim() || null,
    };
    const layout = virtualLayout ? [] : browseLayout;
    if (showTrash || location.kind === "trash") {
      return {
        kind: "trash",
        location: location.kind === "trash"
          ? location
          : { kind: "trash", tombstoneId: trashBrowseTombstoneId },
        items: trashedAssets.slice(0, 320),
        folders: trashedFolders.slice(0, 400),
        layout,
        virtualLayout,
        total: virtualBrowseLayout?.total ?? trashedAssetCount,
        pageDescriptor,
      };
    }
    if (showTagManagement || location.kind === "tag-management") {
      return { kind: "tag-management", location: { kind: "tag-management" } };
    }
    if (activePluginSidebarViewId || location.kind === "plugin-sidebar") {
      const viewId = location.kind === "plugin-sidebar"
        ? location.viewId
        : activePluginSidebarViewId!;
      return { kind: "plugin-sidebar", location: { kind: "plugin-sidebar", viewId } };
    }
    return {
      kind: "browse",
      location,
      items: assets.slice(0, 320),
      layout,
      virtualLayout,
      total: virtualBrowseLayout?.total ?? searchTotal ?? assets.length,
      snippets: [...searchSnippets.entries()].slice(0, 320),
      pageDescriptor,
    };
  }
  return { captureWorkspaceRenderSnapshot, applyWorkspaceLocationFlags, beginWorkspaceNavigationRequest, createWorkspaceNavigationRequest, acknowledgeWorkspaceNavigation };
}
