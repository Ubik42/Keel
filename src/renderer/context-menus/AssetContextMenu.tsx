import { useSessionField } from "../stores/session-store";
import { useBrowseField } from "../stores/browse-store";
import { useNavigationField } from "../stores/navigation-store";
import { memo, useEffect, useMemo, useState } from "react";
import type {
  AssetSummary,
} from "../../shared/asset-types";
import {
  ContextMenu,
  ContextMenuBackdrop,
  useContextMenu,
} from "../workbench/menu/context-menu";
import { TagPickerMenu } from "../tags/TagPickerMenu";
import { useLocale } from "../i18n";
import type { KeelPluginManagerApi } from "../../shared/plugin-manager-api";
import {
  placePluginMenuItemsAroundHost,
  runPluginMenuCommand,
  usePluginMenuContributions,
  type PluginMenuDescriptor,
} from "../plugins/plugin-menu-contributions";
import { createPluginMenuContributionContext } from "../plugins/plugin-contribution-context";
import type { RendererWindow, TagPickerState} from './menu-shared';
import { HOST_MENU_ANCHORS, INLINE_HOST_ANCHORS, descriptorKey, useAssetContextMenuActions } from './menu-shared';
import { AssetMenuItems } from "./AssetMenuItems";
import { MultiAssetMenuItems } from "./MultiAssetMenuItems";
import { FolderMenuItems } from "./FolderMenuItems";
import { TrashedFolderMenuItems } from "./TrashedFolderMenuItems";
import { TrashMenuItems } from "./TrashMenuItems";
import { WorkspaceTabMenuItems } from "./WorkspaceTabMenuItems";
import { WorkspaceMenuItems } from "./WorkspaceMenuItems";
export { AssetContextMenuActionsProvider, type AssetContextMenuActions } from './menu-shared';

interface AssetContextMenuProps {
  busy?: boolean;
  assets: AssetSummary[];
  canAnalyze: boolean;
  /** Serpent-rsbt: show link-off on AI analyze when connection is unavailable. */
  aiDisconnected: boolean;
  /**
   * Managed folder that receives OS clipboard paste from asset menus.
   * Typically the current browse folder; null hides paste.
   */
  pasteTargetFolderId: string | null | undefined;
  /** Folder tombstones in trash (Serpent-b3kf / empty-trash enablement). */
}

// Memoized: the app shell re-renders often; this panel renders only when its
// props or consumed contexts change.
export const AssetContextMenu = memo(function AssetContextMenu(props: AssetContextMenuProps) {
  const { locale, t } = useLocale();
  const {
    assets,
    canAnalyze,
    aiDisconnected,
    pasteTargetFolderId,
  } = props;
  const { onBatchAssignTag, onBatchRemoveTag, onAssignTag, pluginBrowseScope, pluginViewerState, pluginContributionRefreshKey } = useAssetContextMenuActions();
  const [tags] = useNavigationField("tags");
  const [contextLibrary] = useSessionField("library");
  const libraryId = contextLibrary?.libraryId;
  const pluginApi = (window as { keel?: { plugins?: KeelPluginManagerApi } }).keel?.plugins;
  const [trashedFolders] = useNavigationField("trashedFolders");
  const trashedFolderCount = trashedFolders.length;
  const [linkedFolders] = useNavigationField("linkedFolders");
  const [managedFolders] = useNavigationField("folders");
  const [customFolderCoverIds] = useBrowseField("folderCustomCoverIds");
  const [trashedAssetCount] = useBrowseField("trashedAssetCount");

  const { active: activeContextMenu } = useContextMenu();
  const [tagPicker, setTagPicker] = useState<TagPickerState | null>(null);

  // The picker swaps the menu body in place; never let it leak into the next
  // menu. Adjust during render (React-sanctioned derived-state pattern):
  // whenever the open menu changes descriptor or closes, drop the picker.
  const activeDescriptorKey = activeContextMenu
    ? descriptorKey(activeContextMenu.descriptor)
    : null;
  const pluginContributionContext = useMemo(() => {
    if (activeContextMenu === null) return undefined;
    return createPluginMenuContributionContext({
      descriptor: activeContextMenu.descriptor,
      assets: props.assets,
      libraryId: libraryId,
      busy: props.busy,
      locale,
      browse: pluginBrowseScope,
      viewer: pluginViewerState,
    });
  }, [
    activeContextMenu,
    locale,
    props.busy,
    props.assets,
    libraryId,
    pluginBrowseScope,
    pluginViewerState,
  ]);
  const [pickerMenuKey, setPickerMenuKey] = useState(activeDescriptorKey);
  if (pickerMenuKey !== activeDescriptorKey) {
    setPickerMenuKey(activeDescriptorKey);
    setTagPicker(null);
  }

  // 「AI分析未分析项」：多选菜单打开时预取选中里没有任何 AI 数据的资产
  //（运行时判断 ai_content 有无记录，不动数据库字段）。key 变化时在
  // render 期重置（与 pickerMenuKey 同模式），effect 只做异步查询。
  const [aiPendingKey, setAiPendingKey] = useState(activeDescriptorKey);
  const [aiPendingAssetIds, setAiPendingAssetIds] = useState<readonly string[]>([]);
  if (aiPendingKey !== activeDescriptorKey) {
    setAiPendingKey(activeDescriptorKey);
    setAiPendingAssetIds([]);
  }
  useEffect(() => {
    const descriptor = activeContextMenu?.descriptor;
    if (
      !descriptor ||
      descriptor.type !== "multi-asset" ||
      !libraryId
    ) {
      return;
    }
    const assetIds = [...descriptor.assetIds];
    if (assetIds.length === 0) {
      return;
    }
    let cancelled = false;
    void (window as RendererWindow).keel?.library
      ?.pendingAiAssets({ libraryId: libraryId, assetIds })
      .then((result) => {
        if (!cancelled && result.ok) {
          setAiPendingAssetIds(result.value.assetIds);
        }
      })
      .catch(() => {
        if (!cancelled) setAiPendingAssetIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDescriptorKey, activeContextMenu, libraryId]);


  const pluginAssetMenuItems = usePluginMenuContributions(
    pluginApi,
    libraryId,
    "menus.asset",
    activeContextMenu?.descriptor.type === "asset"
      || activeContextMenu?.descriptor.type === "multi-asset",
    `${pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );
  const pluginFolderMenuItems = usePluginMenuContributions(
    pluginApi,
    libraryId,
    "menus.folder",
    activeContextMenu?.descriptor.type === "folder",
    `${pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );
  const pluginAssetMenuPlacement = useMemo(
    () => placePluginMenuItemsAroundHost(
      pluginAssetMenuItems,
      HOST_MENU_ANCHORS,
      INLINE_HOST_ANCHORS,
    ),
    [pluginAssetMenuItems],
  );
  const pluginFolderMenuPlacement = useMemo(
    () => placePluginMenuItemsAroundHost(
      pluginFolderMenuItems,
      HOST_MENU_ANCHORS,
      INLINE_HOST_ANCHORS,
    ),
    [pluginFolderMenuItems],
  );
  const pluginWorkspaceMenuItems = usePluginMenuContributions(
    pluginApi,
    libraryId,
    "menus.workspace",
    activeContextMenu?.descriptor.type === "workspace",
    `${pluginContributionRefreshKey ?? ""}:${activeDescriptorKey}`,
    pluginContributionContext,
  );

  const runPluginCommand = (
    item: PluginMenuDescriptor,
    context: {
      assetIds?: string[];
      folderIds?: string[];
    },
  ) => {
    if (!pluginApi || !libraryId) return;
    void runPluginMenuCommand(pluginApi, libraryId, item, {
      ...context,
      assets: (context.assetIds ?? [])
        .map((assetId) => props.assets.find((asset) => asset.assetId === assetId))
        .filter((asset): asset is typeof props.assets[number] => asset !== undefined),
      contributionContext: pluginContributionContext,
    });
  };

  if (!activeContextMenu) return null;
  // Inspector tag chips render their own menu for this descriptor.
  if (activeContextMenu.descriptor.type === "organization") return null;
  // Keel-接管: the workspace canvas menu is a plugin extension point
  // (PLUGIN-015). With no plugin contributions it would render an empty
  // floating menu on blank-canvas right-click — suppress it entirely; the
  // active descriptor stays set so a late async contribution still appears.
  if (
    activeContextMenu.descriptor.type === "workspace" &&
    pluginWorkspaceMenuItems.length === 0
  ) {
    return null;
  }

  const ariaLabel =
    activeContextMenu.descriptor.type === "multi-asset"
      ? t("menu.batchAssetOps", {
          count: activeContextMenu.descriptor.assetIds.length,
        })
      : activeContextMenu.descriptor.type === "asset"
        ? t("menu.assetOps", {
            name: activeContextMenu.descriptor.displayName,
          })
        : activeContextMenu.descriptor.type === "folder"
            ? t("menu.folderOps", {
                name: activeContextMenu.descriptor.name,
              })
            : activeContextMenu.descriptor.type === "workspace"
              ? t("scope.workspace")
            : activeContextMenu.descriptor.type === "workspace-tab"
              ? activeContextMenu.descriptor.name
            : activeContextMenu.descriptor.type === "trash"
              ? t("scope.trash")
              : activeContextMenu.descriptor.type === "trashed-folder"
                ? t("menu.folderOps", {
                    name: activeContextMenu.descriptor.name,
                  })
                : "";

  return (
    <ContextMenuBackdrop>
      <ContextMenu
        ariaLabel={
          tagPicker
            ? tagPicker.mode === "assign"
              ? t("batch.assignTag")
              : t("batch.removeTag")
            : ariaLabel
        }
        position={activeContextMenu.position}
      >
        {tagPicker ? (
          <TagPickerMenu
            mode={tagPicker.mode}
            onPick={(tagId) => {
              if (tagPicker.mode === "assign") {
                const [singleAssetId] = tagPicker.assetIds;
                if (tagPicker.single && singleAssetId) {
                  onAssignTag(singleAssetId, tagId);
                } else {
                  onBatchAssignTag(tagId, tagPicker.assetIds);
                }
              } else {
                onBatchRemoveTag(tagId, tagPicker.assetIds);
              }
            }}
            tags={tags}
          />
        ) : (
          <>
        <WorkspaceMenuItems
          activeContextMenu={activeContextMenu}
          pluginWorkspaceMenuItems={pluginWorkspaceMenuItems}
          t={t}
          runPluginCommand={runPluginCommand}
        />
        <WorkspaceTabMenuItems
          activeContextMenu={activeContextMenu}
          t={t}
        />
        <TrashMenuItems
          activeContextMenu={activeContextMenu}
          trashedAssetCount={trashedAssetCount}
          trashedFolderCount={trashedFolderCount}
          t={t}
        />
        <TrashedFolderMenuItems
          activeContextMenu={activeContextMenu}
          t={t}
        />
        <FolderMenuItems
          activeContextMenu={activeContextMenu}
          linkedFolders={linkedFolders}
          locale={locale}
          pluginFolderMenuPlacement={pluginFolderMenuPlacement}
          t={t}
          runPluginCommand={runPluginCommand}
          managedFolders={managedFolders}
          customFolderCoverIds={customFolderCoverIds}
        />
        <MultiAssetMenuItems
          activeContextMenu={activeContextMenu}
          assets={assets}
          linkedFolders={linkedFolders}
          managedFolders={managedFolders}
          locale={locale}
          pluginAssetMenuPlacement={pluginAssetMenuPlacement}
          aiPendingAssetIds={aiPendingAssetIds}
          pasteTargetFolderId={pasteTargetFolderId}
          setTagPicker={setTagPicker}
          t={t}
          canAnalyze={canAnalyze}
          aiDisconnected={aiDisconnected}
          runPluginCommand={runPluginCommand}
          tags={tags}
          customFolderCoverIds={customFolderCoverIds}
        />
        <AssetMenuItems
          activeContextMenu={activeContextMenu}
          assets={assets}
          pasteTargetFolderId={pasteTargetFolderId}
          locale={locale}
          canAnalyze={canAnalyze}
          t={t}
          pluginAssetMenuPlacement={pluginAssetMenuPlacement}
          runPluginCommand={runPluginCommand}
          tags={tags}
          aiDisconnected={aiDisconnected}
        />
          </>
        )}
      </ContextMenu>
    </ContextMenuBackdrop>
  );
});
