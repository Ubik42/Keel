import { type KeelLibraryApi } from '../../shared/library-api';
import { type KeelPluginManagerApi } from '../../shared/plugin-manager-api';
import { isMacPlatform } from '../workbench/menu/command-types';
import { type TranslateFn, useT } from '../i18n';
import { type IconName, Icon } from '../Icons';
import { type PluginMenuDescriptor, type PluginMenuHostPlacement } from '../plugin-menu-contributions';
import { ContextMenuSection, ContextMenuSubmenu, ContextMenuItem, type ContextMenuDescriptor } from '../workbench/menu/context-menu';
import { type ReactNode, createContext, useContext } from 'react';
import { createCommandRegistry } from '../workbench/menu/command-registry';
import { assetCommandDefinitions } from '../commands/asset-commands';
import { assetMultiCommandDefinitions } from '../commands/asset-multi-commands';
import { sidebarCommandDefinitions } from '../commands/sidebar-commands';
import { folderCoverClearTargets } from '../folder-cover';
import { type LinkedFolderSummary } from '../../shared/asset-types';
import { type EntityAppearanceTarget, type EntityAppearance } from '../../shared/entity-appearance';
import { type PluginContributionContext } from '../../plugins/plugin-context';
import { type MenuSkipScopeOptions } from '../menu-skip-report';
import { type EmbeddingHttpAdapter } from '../../shared/embedding/http-service';
import { type EmbeddingModality } from '../../shared/embedding/modalities';

/**
 * Pieces shared by the context menus: plugin menu placement, command registries, the folder-cover items and the actions context (split out of AssetContextMenu, P4).
 */
export type RendererWindow = Window & {
  keel?: {
    library?: KeelLibraryApi;
    plugins?: KeelPluginManagerApi;
  };
};

export const isMac = isMacPlatform(navigator.userAgent);

export function pluginMenuGroupLabel(group: string, t: TranslateFn): string {
  if (group === "image-processing") {
    return t("contextMenu.pluginGroups.imageProcessing");
  }
  if (group === "media-tools") {
    return t("contextMenu.pluginGroups.mediaTools");
  }
  return group;
}

export const PLUGIN_MENU_ICON_NAMES: ReadonlySet<IconName> = new Set<IconName>([
  "activity", "archive", "box", "clipboard", "copy", "edit", "file", "folder",
  "globe", "grid", "heart", "info", "link", "refresh", "search", "settings",
  "sliders", "star", "tag", "trash", "upload", "warning",
]);

export function pluginMenuIcon(name: string | undefined): IconName {
  return name !== undefined && PLUGIN_MENU_ICON_NAMES.has(name as IconName)
    ? name as IconName
    : "box";
}

export function PluginMenuCommandsSection(props: {
  items: readonly PluginMenuDescriptor[];
  onRun: (item: PluginMenuDescriptor) => void;
  label: string;
}) {
  const t = useT();
  if (props.items.length === 0) return null;
  const hasNamedGroup = props.items.some((item) => (item.group ?? "").length > 0);
  // Named plugin groups already provide the section title; avoid nesting them
  // under the generic "Plugin commands" header.
  if (hasNamedGroup) {
    return (
      <PluginMenuItems
        items={props.items}
        onRun={props.onRun}
        resolveGroupLabel={(group) => pluginMenuGroupLabel(group, t)}
        showGroupLabels
      />
    );
  }
  return (
    <ContextMenuSection label={props.label}>
      <PluginMenuItems items={props.items} onRun={props.onRun} />
    </ContextMenuSection>
  );
}

export function PluginMenuItems(props: {
  items: readonly PluginMenuDescriptor[];
  onRun: (item: PluginMenuDescriptor) => void;
  showGroupLabels?: boolean;
  resolveGroupLabel?: (group: string) => string;
}) {
  if (props.items.length === 0) return null;
  const grouped = new Map<string, PluginMenuDescriptor[]>();
  for (const item of props.items) {
    const group = item.group ?? "";
    const current = grouped.get(group) ?? [];
    current.push(item);
    grouped.set(group, current);
  }
  const renderItem = (item: PluginMenuDescriptor): ReactNode => {
    if (item.children.length > 0) {
      return (
        <ContextMenuSubmenu
          icon={<Icon name={pluginMenuIcon(item.icon)} size={14} />}
          key={item.id}
          label={item.label}
          disabled={item.disabled}
        >
          {item.children.map(renderItem)}
        </ContextMenuSubmenu>
      );
    }
    if (item.commandId === undefined) return null;
    return (
      <ContextMenuItem
        key={item.id}
        icon={<Icon name={pluginMenuIcon(item.icon)} size={14} />}
        label={item.label}
        shortcut={item.shortcut}
        disabled={item.disabled}
        checked={item.checked}
        onAction={() => props.onRun(item)}
      />
    );
  };
  const hasNamedGroup = [...grouped.keys()].some((group) => group.length > 0);
  if (props.showGroupLabels !== true || !hasNamedGroup) {
    return <>{props.items.map(renderItem)}</>;
  }
  return (
    <>
      {[...grouped.entries()].map(([group, items]) => (
        <ContextMenuSection
          key={group || "default"}
          label={group
            ? (props.resolveGroupLabel?.(group) ?? group)
            : undefined}
          labelCase="preserve"
        >
          {items.map(renderItem)}
        </ContextMenuSection>
      ))}
    </>
  );
}

export type PluginHostMenuGroup = "open" | "organize" | "metadata" | "delete";

export const HOST_MENU_ANCHORS: Record<PluginHostMenuGroup, readonly string[]> = {
  open: [
    "asset.view",
    "asset.open-external",
    "asset.reveal-in-folder",
    "asset.show-in-library-folder",
    "folder.open-in-file-manager",
  ],
  organize: [
    "asset.relink",
    "asset.move-to-folder",
    "asset.copy",
    "asset.paste",
    "asset.copy-file-path",
    "asset.rename",
    "folder.create-subfolder",
    "folder.rename",
    "folder.linked-rules",
    "folder.copy",
    "folder.paste",
    "folder.clone",
    "folder.copy-path",
  ],
  metadata: ["asset.ai-analyze", "asset.clear-ai-content"],
  delete: [
    "asset.move-to-trash",
    "asset.delete-from-disk",
    "asset.delete-permanent",
    "folder.move-to-trash",
    "folder.delete-from-disk",
    "folder.remove-from-library",
  ],
};

export const INLINE_HOST_ANCHORS = new Set(["asset.rename", "folder.rename"]);

export function pluginItemsForHostGroup(
  placement: PluginMenuHostPlacement,
  group: PluginHostMenuGroup,
  edge: "before" | "after",
): PluginMenuDescriptor[] {
  return placement.groups.get(group)?.[edge] ?? [];
}

export function pluginItemsAtHostAnchor(
  placement: PluginMenuHostPlacement,
  anchor: string,
  edge: "before" | "after",
): PluginMenuDescriptor[] {
  return placement.anchors.get(anchor)?.[edge] ?? [];
}

export function pluginItemsOutsideHostGroups(
  placement: PluginMenuHostPlacement,
): PluginMenuDescriptor[] {
  return placement.outside;
}

// 0015-B: 单资产右键菜单的静态项由统一命令注册表驱动（REQ-COMMAND-001）；
// 注册表是纯数据，模块级构建一次即可。0015-C: 多资产分支同样接入。
// 0015-D: 文件夹 / 合集 / 智能合集三个侧边栏分支同样接入。
export const assetCommandRegistry = createCommandRegistry(assetCommandDefinitions);

export const assetMultiCommandRegistry = createCommandRegistry(
  assetMultiCommandDefinitions,
);

export const sidebarCommandRegistry = createCommandRegistry(sidebarCommandDefinitions);

/** Which tag action the in-menu picker is performing, and on which assets. */
export interface TagPickerState {
  mode: "assign" | "remove";
  assetIds: string[];
  /** Single-asset assign routes to onAssignTag; everything else is batch. */
  single: boolean;
}

/** Stable identity of the open menu, used to reset picker state on change. */
export function descriptorKey(descriptor: ContextMenuDescriptor): string {
  switch (descriptor.type) {
    case "asset":
      return `asset:${descriptor.assetId}`;
    case "multi-asset":
      return `multi-asset:${descriptor.assetIds.join(",")}:${(descriptor.folderIds ?? []).join(",")}`;
    case "organization":
      return `organization:${descriptor.id}`;
    case "folder":
      return `folder:${descriptor.folderId}`;
    case "trash":
      return "trash";
    case "trashed-folder":
      return `trashed-folder:${descriptor.tombstoneId}`;
    case "workspace":
      return `workspace:${(descriptor.assetIds ?? []).join(",")}`;
    case "workspace-tab":
      return `workspace-tab:${descriptor.tabId}`;
  }
}

export function FolderCoverMenuItems({
  folderIds,
  customFolderCoverIds,
  onChooseFromLibrary,
  onChooseFromFile,
  onClear,
}: {
  folderIds: readonly string[];
  customFolderCoverIds: ReadonlySet<string>;
  onChooseFromLibrary: (folderIds: readonly string[]) => void;
  onChooseFromFile: (folderIds: readonly string[]) => void;
  onClear: (folderIds: readonly string[]) => void;
}) {
  const t = useT();
  if (folderIds.length === 0) return null;
  const clearFolderIds = folderCoverClearTargets(folderIds, customFolderCoverIds);
  return (
    <>
      <ContextMenuSubmenu
        icon={<Icon name="file" size={14} />}
        label={t("command.folder.chooseCover")}
      >
        <ContextMenuItem
          label={t("command.folder.chooseCoverFromLibrary")}
          onAction={() => onChooseFromLibrary(folderIds)}
        />
        <ContextMenuItem
          label={t("command.folder.chooseCoverFromFile")}
          onAction={() => onChooseFromFile(folderIds)}
        />
      </ContextMenuSubmenu>
      {clearFolderIds.length > 0 ? (
        <ContextMenuItem
          icon={<Icon name="eye-off" size={14} />}
          label={t("command.folder.clearCover")}
          onAction={() => onClear(clearFolderIds)}
        />
      ) : null}
    </>
  );
}

/** Operations AssetContextMenu triggers; the parent provides them (P4). */
export interface AssetContextMenuActions {
  onCreateSubfolder: (folderId: string) => void;
  onExpandFolderTree: (folderId: string) => void;
  onCollapseFolderTree: (folderId: string) => void;
  /** Serpent-316493: 导入链接文件夹 as a child of this managed folder. */
  onImportLinkedFolderInto: (folderId: string) => void;
  onSetIgnore: (args: {
    locationKind: "managed" | "linked";
    linkedFolderId?: string | null;
    relativePath: string;
    pathKind: "asset" | "folder" | "extension";
    ignored: boolean;
    name: string;
  }) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onOpenFolderInFileManager: (folderId: string) => void;
  onCopyFolderPath: (folderId: string) => void;
  onCopyFolder: (folderId: string) => void;
  onPasteIntoFolder: (folderId: string | null) => void;
  onCloneFolder: (folderId: string) => void;
  onMoveFolder: (folderIds: string[]) => void;
  onOpenLinkedRules: (folder: LinkedFolderSummary) => void;
  onTrashManagedFolder: (folderId: string, name: string) => void;
  onDeleteFolderFromDisk: (args: {
    folderId: string;
    name: string;
    locationKind: "managed" | "linked";
    linkedRelativePath?: string;
  }) => void;
  onRemoveLinkedFolder: (folderId: string, name: string) => void;
  onSetEntityAppearance: (
    target: EntityAppearanceTarget,
    appearance: EntityAppearance | null,
  ) => void;
  onChooseFolderCover: (folderIds: readonly string[]) => void;
  onChooseFolderCoverFromLibrary: (folderIds: readonly string[]) => void;
  onClearFolderCover: (folderIds: readonly string[]) => void;
  /** Single image asset: set its parent folder cover to this asset. */
  onUseAssetAsFolderCover: (assetId: string, folderId: string) => void;
  onBatchAssignTag: (tagId: string, assetIds: string[]) => void;
  onBatchRemoveTag: (tagId: string, assetIds: string[]) => void;
  onMoveToFolder: (assetIds: string[], folderIds?: readonly string[]) => void;
  onTrash: (assetIds: string[], folderIds?: readonly string[]) => void;
  onDeleteFromDisk: (assetIds: string[], folderIds?: readonly string[]) => void;
  onRestore: (assetIds: string[]) => void;
  onPermanentDelete: (assetIds: string[]) => void;
  onRelink: (assetId: string) => void;
  onAnalyze: (assetId: string, batchIds?: readonly string[]) => void;
  onClearAiContent: (assetIds: string[]) => void;
  onCopyToLinked: (folder: LinkedFolderSummary, assetIds: string[]) => void;
  onClearSelection: () => void;
  onOpenExternal: (assetId: string) => void;
  onOpenWithProgram?: (assetId: string, programId: string) => void;
  /** PF: the system "open with" picker. */
  onOpenWithPicker?: (assetId: string) => void;
  onViewAsset: (assetId: string) => void;
  onSetAssetColorSpace: (assetId: string, colorSpace: string | null) => void;
  onCreateImageSequence: (assetIds: string[]) => void;
  onSetImageSequenceFps: (
    sequenceId: string,
    frameCount: number,
    fps: number,
  ) => void;
  onDissolveImageSequence: (sequenceId: string) => void;
  onDissolveImageSequences: (sequenceIds: string[]) => void;
  onRevealInFolder: (assetId: string) => void;
  onShowInLibraryFolder: (assetId: string) => void;
  onFindSimilar: (assetId: string) => void;
  onCopyFilePath: (assetId: string) => void;
  /** OS file clipboard copy (Finder/Explorer interoperable). */
  onCopyAssetFiles: (assetIds: string[]) => void;
  onRenameAssetFile: (assetId: string) => void;
  onAssignTag: (assetId: string, tagId: string) => void;
  onRestoreTrashedFolder: (tombstoneId: string, name: string) => void;
  onEmptyTrash: () => void;
  onCloseWorkspaceTab: (tabId: string) => void;
  onCloseOtherWorkspaceTabs: (tabId: string) => void;
  onRevealWorkspaceTabEntity: (
    entity: { kind: "folder"; id: string },
  ) => void;
  onCopyWorkspaceTabName: (name: string) => void;

  pluginBrowseScope?: Partial<PluginContributionContext["browse"]>;
  pluginViewerState?: Partial<PluginContributionContext["viewer"]>;
  pluginContributionRefreshKey?: string | null;
  /** Current browse-scope IDs so select-all is not treated as "out of scope". */
  menuSkipScope?: MenuSkipScopeOptions;
  /** PF: programs registered in the open-with settings. */
  openWithPrograms?: readonly { programId: string; name: string }[];
  semanticSearchEnabled: boolean;
  embeddingSelectionId?: string | null;
  embeddingAdapter?: EmbeddingHttpAdapter | null;
  embeddingModalities?: readonly EmbeddingModality[] | null;
}

export const AssetContextMenuActionsContext = createContext<AssetContextMenuActions | null>(null);

export const AssetContextMenuActionsProvider = AssetContextMenuActionsContext.Provider;

export function useAssetContextMenuActions(): AssetContextMenuActions {
  const actions = useContext(AssetContextMenuActionsContext);
  if (!actions) throw new Error("AssetContextMenu needs AssetContextMenuActionsProvider.");
  return actions;
}
