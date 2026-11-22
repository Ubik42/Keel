import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkspaceNavHistory } from "../../workbench/workspace/workspace-nav-history";
import type { WorkspaceTabsState } from "../../workspace-tabs";
import type { SelectWorkspaceTabOptions } from "../../use-workspace-tabs";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { AppLocale } from "../../i18n/types";
import { type AssetSummary, type TagSummary } from "../../../shared/asset-types";
import { toMessage } from "../../error-utils";
import { type BrowseState } from "../../stores/browse-store";
import { type AssetScope } from "../../stores/navigation-store";
import { type PreviewState } from "../../stores/preview-store";
import { browseEntryUnderPreview, type WorkspaceNavLocation, type WorkspaceNavViewport } from "../../workbench/workspace/workspace-nav-history";
import { type WorkspaceNavigationHistoryMode } from "../../workbench/workspace/workspace-navigation-coordinator";
import { captureWorkspaceNavViewport } from "../../workbench/workspace/workspace-scroll-position";
import { historyReplayClosesPreview } from "../../workspace-discovery-navigation";
import { type WorkspaceNavigationRequest } from "../shared/app-shared";

export interface UseWorkspaceHistoryReplayDeps {
  navHistoryRef: RefObject<WorkspaceNavHistory>;
  workspaceHistoryReplayActiveRef: RefObject<boolean>;
  syncNavHistoryUi: () => void;
  chooseFolder: (scope: AssetScope, options?: { refreshSidebar?: boolean; blockingNavigation?: boolean; navigation?: WorkspaceNavigationRequest; }) => Promise<void>;
  chooseTag: (tagId: string, navigation?: WorkspaceNavigationRequest, tagCatalog?: readonly TagSummary[]) => Promise<void>;
  enterTrashAt: (tombstoneId: string | null, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  visibleAssets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  assets: BrowseState["assets"];
  openAssetPreview: (asset: AssetSummary, options?: { recordHistory?: boolean; }) => void;
  enterTagManagement: (navigation?: WorkspaceNavigationRequest) => Promise<void>;
  enterPluginSidebarView: (viewId: string, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  runFindSimilar: (assetId: string, navigation?: WorkspaceNavigationRequest) => Promise<void>;
  workspaceHistoryReplayEpochRef: RefObject<number>;
  workspaceHistoryReplayQueueRef: RefObject<Promise<void>>;
  cancelWorkspaceViewportRestoreRef: RefObject<(() => void) | null>;
  workspaceCanvasRef: RefObject<HTMLDivElement | null>;
  saveWorkspaceTabContext: () => WorkspaceTabsState;
  workspaceTabsState: WorkspaceTabsState;
  selectWorkspaceTab: (tabId: string, options?: SelectWorkspaceTabOptions) => Promise<void>;
  previewAsset: PreviewState["previewAsset"];
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  beginWorkspaceNavigationRequest: (historyMode: WorkspaceNavigationHistoryMode) => WorkspaceNavigationRequest;
  finishWorkspaceNavigation: (request: WorkspaceNavigationRequest, viewport?: WorkspaceNavViewport) => void;
  setWorkspaceNavigationPending: Dispatch<SetStateAction<boolean>>;
  setError: (text: string | null) => void;
  t: TranslateFn;
  locale: AppLocale;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useWorkspaceHistoryReplay({ navHistoryRef, workspaceHistoryReplayActiveRef, syncNavHistoryUi, chooseFolder, chooseTag, enterTrashAt, visibleAssets, assets, openAssetPreview, enterTagManagement, enterPluginSidebarView, runFindSimilar, workspaceHistoryReplayEpochRef, workspaceHistoryReplayQueueRef, cancelWorkspaceViewportRestoreRef, workspaceCanvasRef, saveWorkspaceTabContext, workspaceTabsState, selectWorkspaceTab, previewAsset, closeAssetPreview, beginWorkspaceNavigationRequest, finishWorkspaceNavigation, setWorkspaceNavigationPending, setError, t, locale }: UseWorkspaceHistoryReplayDeps) {

  function recordNavigation(
    location: WorkspaceNavLocation,
    request: WorkspaceNavigationRequest,
  ) {
    if (!request.isCurrent() || request.historyMode !== "push") return;
    navHistoryRef.current.push(location);
    workspaceHistoryReplayActiveRef.current = false;
    syncNavHistoryUi();
  }

  async function applyWorkspaceLocation(
    location: WorkspaceNavLocation,
    request: WorkspaceNavigationRequest,
  ) {
    switch (location.kind) {
      case "all":
        await chooseFolder("all", { navigation: request });
        return;
      case "root":
        await chooseFolder("root", { navigation: request });
        return;
      case "folder":
        await chooseFolder(location.folderId, { navigation: request });
        return;
      case "tag":
        await chooseTag(location.tagId, request);
        return;
      case "trash":
        await enterTrashAt(location.tombstoneId, request);
        return;
      case "preview": {
        // 回放查看器状态：preview 条目总是在某浏览 scope 之后打开，其资产应在
        // 当前视图（assets/visibleAssets）中；找不到（已删除/被过滤）则把这条
        // 失效 preview 从历史移除（dismissCurrent，当前正是栈顶 preview），
        // 让 current 落回下层浏览 scope，避免留下幽灵 preview。
        const target = [...visibleAssets, ...assets].find(
          (candidate) => candidate.assetId === location.assetId,
        );
        if (target) {
          openAssetPreview(target);
        } else {
          navHistoryRef.current.dismissCurrent();
          syncNavHistoryUi();
        }
        return;
      }
      case "tag-management":
        await enterTagManagement(request);
        return;
      case "plugin-sidebar":
        await enterPluginSidebarView(location.viewId, request);
        return;
      case "similar":
        await runFindSimilar(location.assetId, request);
        return;
    }
  }

  function enqueueWorkspaceHistoryReplay(operation: () => Promise<void>) {
    const requestedEpoch = workspaceHistoryReplayEpochRef.current;
    const pending = workspaceHistoryReplayQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (requestedEpoch !== workspaceHistoryReplayEpochRef.current) return;
        await operation();
      });
    workspaceHistoryReplayQueueRef.current = pending.catch(() => undefined);
    return pending;
  }

  async function replayWorkspaceHistoryStep(direction: "back" | "forward") {
    cancelWorkspaceViewportRestoreRef.current?.();
    cancelWorkspaceViewportRestoreRef.current = null;
    navHistoryRef.current.saveCurrentViewport(
      captureWorkspaceNavViewport(workspaceCanvasRef.current),
    );
    // Sync the outgoing tab's cached location to the pre-replay cursor before
    // moving it, so a later switch/replay back to that tab lands where it was.
    saveWorkspaceTabContext();
    const leavingLocation = navHistoryRef.current.current;
    const leavingTabId = navHistoryRef.current.currentTabId;
    const browseUnderPreview =
      leavingLocation.kind === "preview"
        ? browseEntryUnderPreview(navHistoryRef.current, leavingTabId).location
        : null;
    const location =
      direction === "back"
        ? navHistoryRef.current.back()
        : navHistoryRef.current.forward();
    if (!location) return;
    workspaceHistoryReplayActiveRef.current = true;
    syncNavHistoryUi();
    const targetTabId = navHistoryRef.current.currentTabId;
    const targetViewport = navHistoryRef.current.currentViewport;
    let replayRequest: WorkspaceNavigationRequest | null = null;
    try {
      if (targetTabId !== workspaceTabsState.activeTabId) {
        // The step belongs to another tab: activate it and restore the entry's
        // recorded location. Replaying must not record a new history step.
        await selectWorkspaceTab(targetTabId, {
          location,
          viewport: targetViewport,
        });
      } else if (
        historyReplayClosesPreview({
          direction,
          leaving: leavingLocation,
          arriving: location,
          previewOpen: previewAsset != null,
          sameTab: true,
          browseUnderPreview,
        })
      ) {
        // REQ-VIEW-004: Back from the viewer is close-viewer, not a fresh
        // folder load. Reloading without browseState used to wipe tab filters.
        await closeAssetPreview(true, false);
      } else {
        replayRequest = {
          ...beginWorkspaceNavigationRequest("replay"),
          deferReveal: true,
        };
        await applyWorkspaceLocation(location, replayRequest);
        if (replayRequest.isCurrent()) {
          finishWorkspaceNavigation(replayRequest, targetViewport);
        }
      }
    } catch (caught) {
      if (replayRequest === null || replayRequest.isCurrent()) {
        setWorkspaceNavigationPending(false);
        setError(toMessage(caught, t("toast.readAssetsFailed"), locale));
      }
    } finally {
      workspaceHistoryReplayActiveRef.current = false;
    }
  }

  function goWorkspaceBack() {
    return enqueueWorkspaceHistoryReplay(() =>
      replayWorkspaceHistoryStep("back"),
    );
  }

  function goWorkspaceForward() {
    return enqueueWorkspaceHistoryReplay(() =>
      replayWorkspaceHistoryStep("forward"),
    );
  }
  return { applyWorkspaceLocation, recordNavigation, goWorkspaceBack, goWorkspaceForward };
}
