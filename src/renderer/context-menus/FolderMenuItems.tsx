import type { AppLocale } from "../i18n/types";
import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { PluginMenuHostPlacement } from "../plugin-menu-contributions";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { useAssetContextMenuActions } from "./menu-shared";
import { linkedRevealFolderId, parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { type SidebarCommandContext } from "../commands/sidebar-commands";
import { EntityAppearancePicker } from "../EntityAppearancePicker";
import { Icon } from "../Icons";
import { type PluginMenuDescriptor } from "../plugin-menu-contributions";
import { type BrowseState } from "../stores/browse-store";
import { type NavigationState } from "../stores/navigation-store";
import { ContextMenuItem, ContextMenuSection, ContextMenuSubmenu } from "../workbench/menu/context-menu";
import { FolderCoverMenuItems, PluginMenuCommandsSection, PluginMenuItems, isMac, pluginItemsAtHostAnchor, pluginItemsForHostGroup, pluginItemsOutsideHostGroups, sidebarCommandRegistry } from "./menu-shared";

export interface FolderMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  linkedFolders: NavigationState["linkedFolders"];
  locale: AppLocale;
  pluginFolderMenuPlacement: PluginMenuHostPlacement;
  t: TranslateFn;
  runPluginCommand: (item: PluginMenuDescriptor, context: { assetIds?: string[]; folderIds?: string[]; }) => void;
  managedFolders: NavigationState["folders"];
  customFolderCoverIds: BrowseState["folderCustomCoverIds"];
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function FolderMenuItems({ activeContextMenu, linkedFolders, locale, pluginFolderMenuPlacement, t, runPluginCommand, managedFolders, customFolderCoverIds }: FolderMenuItemsProps) {
  const { onOpenFolderInFileManager, onCreateSubfolder, onImportLinkedFolderInto, onRenameFolder, onOpenLinkedRules, onCopyFolderPath, onCopyFolder, onPasteIntoFolder, onCloneFolder, onExpandFolderTree, onCollapseFolderTree, onMoveFolder, onTrashManagedFolder, onDeleteFolderFromDisk, onRemoveLinkedFolder, onSetEntityAppearance, onChooseFolderCover, onChooseFolderCoverFromLibrary, onClearFolderCover, onSetIgnore } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "folder" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "folder") return null;
          // REQ-MENU-006: open/copy-path apply to managed and linked folders.
          // Offline linked roots disable the path actions, mirroring the
          // unavailable-asset convention (disabled + reason, not an error).
          // 0015-D: 标题/可见性/禁用原因由注册表 resolveMenu 求值；此处把
          // descriptor 与 linkedFolders 解析结果组装成 SidebarCommandContext。
          const isLinkedChild =
            desc.locationKind === "linked" &&
            desc.linkedRelativePath !== undefined;
          const linkedFolder =
            desc.locationKind === "linked"
              ? linkedFolders.find((folder) => folder.folderId === desc.folderId)
              : undefined;
          // Linked child rows are virtual ids.  Actions that operate on the
          // selected directory (create, rename, paste and copy) must receive
          // that virtual scope, while disk-delete/trash still need the root
          // id plus the relative path below.
          const commandSubjectId =
            desc.locationKind === "linked"
              ? linkedRevealFolderId(desc.folderId, desc.linkedRelativePath)
              : desc.folderId;
          const commandContext: SidebarCommandContext = {
            surface: "sidebar",
            locale,
            platform: isMac ? "mac" : "windows",
            selectedAssetIds: [],
            primaryAssetId: null,
            assetScope: "none",
            trashMode: false,
            menuKind: "folder",
            subjectId: commandSubjectId,
            subjectName: desc.name,
            locationKind: desc.locationKind,
            status: desc.status,
            linkedFolderResolved: linkedFolder !== undefined,
            linkedFolder,
            isLinkedRoot: desc.locationKind === "linked" ? !isLinkedChild : undefined,
            linkedRelativePath: desc.linkedRelativePath,
            isLibraryRoot: desc.isLibraryRoot === true,
            actions: {
              openFolderInFileManager: onOpenFolderInFileManager,
              createSubfolder: onCreateSubfolder,
              importLinkedFolderInto: onImportLinkedFolderInto,
              renameFolder: onRenameFolder,
              openLinkedRules: onOpenLinkedRules,
              copyFolderPath: onCopyFolderPath,
              copyFolder: onCopyFolder,
              pasteIntoFolder: onPasteIntoFolder,
              cloneFolder: onCloneFolder,
              expandFolderTree: onExpandFolderTree,
              collapseFolderTree: onCollapseFolderTree,
              moveFolder: onMoveFolder,
              trashManagedFolder: onTrashManagedFolder,
              deleteFolderFromDisk: (_folderId, name) =>
                onDeleteFolderFromDisk({
                  folderId: desc.folderId,
                  name,
                  locationKind: desc.locationKind,
                  linkedRelativePath: desc.linkedRelativePath,
                }),
              removeLinkedFolder: onRemoveLinkedFolder,
            },
          };
          const resolvedById = new Map(
            sidebarCommandRegistry
              .resolveMenu(commandContext)
              .map((item) => [item.id, item]),
          );
          const runSidebarCommand = (id: string) => {
            const item = resolvedById.get(id);
            if (!item || item.disabled) return;
            void sidebarCommandRegistry.get(id)?.run(commandContext);
          };
          const openInFileManagerItem = resolvedById.get(
            "folder.open-in-file-manager",
          );
          const createSubfolderItem = resolvedById.get(
            "folder.create-subfolder",
          );
          const expandAllItem = resolvedById.get("folder.expand-all");
          const collapseAllItem = resolvedById.get("folder.collapse-all");
          const importLinkedItem = resolvedById.get("folder.import-linked");
          const renameItem = resolvedById.get("folder.rename");
          const linkedRulesItem = resolvedById.get("folder.linked-rules");
          const copyPathItem = resolvedById.get("folder.copy-path");
          const copyItem = resolvedById.get("folder.copy");
          const pasteItem = resolvedById.get("folder.paste");
          const cloneItem = resolvedById.get("folder.clone");
          const trashItem = resolvedById.get("folder.move-to-trash");
          const deleteFromDiskItem = resolvedById.get(
            "folder.delete-from-disk",
          );
          const removeFromLibraryItem = resolvedById.get(
            "folder.remove-from-library",
          );
          // Serpent-316493 follow-up: the library root has no managed_folders
          // row, so plugin folder commands (which receive a folder id) are not
          // offered for the blank-area menu.
          const folderPluginItems = (
            group: "open" | "organize" | "delete",
            placement: "before" | "after",
          ) =>
            desc.isLibraryRoot
              ? []
              : pluginItemsForHostGroup(pluginFolderMenuPlacement, group, placement);
          return (
            <>
              {/* Serpent-a6c516: name the subject — the root has no row of its
                  own in the menu, so the panel's blank area / root row menu
                  starts by saying what it acts on. Quiet caption weight: the
                  shared summary class is the emphasized multi-select style. */}
              {desc.isLibraryRoot && (
                <div className="context-menu-selection-summary context-menu-subject">
                  {t("menu.libraryRoot")}
                </div>
              )}
              <ContextMenuSection label={t("command.group.open")}>
                <PluginMenuItems
                  items={folderPluginItems("open", "before")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
                {openInFileManagerItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={openInFileManagerItem.label}
                    disabled={openInFileManagerItem.disabled}
                    disabledReason={
                      openInFileManagerItem.disabledReason ?? undefined
                    }
                    onAction={() =>
                      runSidebarCommand("folder.open-in-file-manager")
                    }
                    shortcut={openInFileManagerItem.shortcutLabel ?? undefined}
                  />
                )}
                <PluginMenuItems
                  items={folderPluginItems("open", "after")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
              </ContextMenuSection>
              <ContextMenuSection label={t("command.group.folders")}>
                <PluginMenuItems
                  items={folderPluginItems("organize", "before")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
                {createSubfolderItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={createSubfolderItem.label}
                    shortcut={createSubfolderItem.shortcutLabel ?? undefined}
                    onAction={() =>
                      runSidebarCommand("folder.create-subfolder")
                    }
                  />
                )}
                {expandAllItem && (
                  <ContextMenuItem
                    icon={<Icon name="folders" size={14} />}
                    label={expandAllItem.label}
                    onAction={() => runSidebarCommand("folder.expand-all")}
                  />
                )}
                {collapseAllItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder-tree" size={14} />}
                    label={collapseAllItem.label}
                    onAction={() => runSidebarCommand("folder.collapse-all")}
                  />
                )}
                {importLinkedItem && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label={importLinkedItem.label}
                    onAction={() => runSidebarCommand("folder.import-linked")}
                  />
                )}
                {renameItem && (
                  <>
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginFolderMenuPlacement, "folder.rename", "before")}
                      onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                    />
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label={renameItem.label}
                      shortcut={renameItem.shortcutLabel ?? undefined}
                      onAction={() => runSidebarCommand("folder.rename")}
                    />
                    {(!desc.isLibraryRoot &&
                      (desc.locationKind === "managed" ||
                        (desc.locationKind === "linked" && !desc.linkedRelativePath))) && (
                      <ContextMenuSubmenu
                        icon={<Icon name="palette" size={14} />}
                        label={t("command.folder.appearance")}
                      >
                        <EntityAppearancePicker
                          value={
                            desc.locationKind === "linked"
                              ? linkedFolders.find((folder) => folder.folderId === desc.folderId)
                                  ?.appearance ?? null
                              : managedFolders.find((folder) => folder.folderId === desc.folderId)
                                  ?.appearance ?? null
                          }
                          onChange={(appearance) =>
                            onSetEntityAppearance(
                              {
                                kind:
                                  desc.locationKind === "linked"
                                    ? "linked-folder"
                                    : "managed-folder",
                                id: desc.folderId,
                              },
                              appearance,
                            )
                          }
                        />
                      </ContextMenuSubmenu>
                    )}
                    {!desc.isLibraryRoot ? (
                      <FolderCoverMenuItems
                        folderIds={[commandSubjectId]}
                        customFolderCoverIds={customFolderCoverIds}
                        onChooseFromFile={onChooseFolderCover}
                        onChooseFromLibrary={onChooseFolderCoverFromLibrary}
                        onClear={onClearFolderCover}
                      />
                    ) : null}
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginFolderMenuPlacement, "folder.rename", "after")}
                      onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                    />
                  </>
                )}
                {linkedRulesItem && (
                  <ContextMenuItem
                    icon={<Icon name="link" size={14} />}
                    label={linkedRulesItem.label}
                    onAction={() => runSidebarCommand("folder.linked-rules")}
                  />
                )}
                {copyItem && (
                  <ContextMenuItem
                    icon={<Icon name="clipboard" size={14} />}
                    label={copyItem.label}
                    disabled={copyItem.disabled}
                    disabledReason={copyItem.disabledReason ?? undefined}
                    shortcut={copyItem.shortcutLabel ?? undefined}
                    onAction={() => runSidebarCommand("folder.copy")}
                  />
                )}
                {pasteItem && (
                  <ContextMenuItem
                    icon={<Icon name="clipboard" size={14} />}
                    label={pasteItem.label}
                    shortcut={pasteItem.shortcutLabel ?? undefined}
                    onAction={() => runSidebarCommand("folder.paste")}
                  />
                )}
                {cloneItem && (
                  <ContextMenuItem
                    icon={<Icon name="folder" size={14} />}
                    label={cloneItem.label}
                    onAction={() => runSidebarCommand("folder.clone")}
                  />
                )}
                {copyPathItem && (
                  <ContextMenuItem
                    icon={<Icon name="file" size={14} />}
                    label={copyPathItem.label}
                    shortcut={copyPathItem.shortcutLabel ?? undefined}
                    disabled={copyPathItem.disabled}
                    disabledReason={copyPathItem.disabledReason ?? undefined}
                    onAction={() => runSidebarCommand("folder.copy-path")}
                  />
                )}
                <PluginMenuItems
                  items={folderPluginItems("organize", "after")}
                  onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                />
                {/* Serpent-a6c516: the library root cannot be ignored — it has
                    no managed folder row, so this entry would build an ignore
                    rule from the menu's own label instead of a real path. */}
                {!desc.isLibraryRoot && (
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={t("menu.ignoreFolder")}
                    onAction={() => {
                      const managed = desc.locationKind === "managed"
                        ? managedFolders.find((folder) => folder.folderId === desc.folderId)
                        : undefined;
                      const linkedRef = desc.locationKind === "linked"
                        ? parseLinkedVirtualFolderId(desc.folderId)
                        : null;
                      onSetIgnore({
                        locationKind: desc.locationKind,
                        linkedFolderId: desc.locationKind === "linked"
                          ? linkedRef?.linkedFolderId ?? desc.folderId
                          : null,
                        relativePath: desc.locationKind === "linked"
                          ? desc.linkedRelativePath ?? linkedRef?.relativePath ?? ""
                          : managed?.relativePath ?? desc.name,
                        pathKind: "folder",
                        ignored: true,
                        name: desc.name,
                      });
                    }}
                  />
                )}
              </ContextMenuSection>
              {(trashItem
                || deleteFromDiskItem
                || removeFromLibraryItem
                || folderPluginItems("delete", "before").length > 0
                || folderPluginItems("delete", "after").length > 0) && (
                <ContextMenuSection>
                  <PluginMenuItems
                    items={folderPluginItems("delete", "before")}
                    onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                  />
                  {trashItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={trashItem.label}
                      shortcut={trashItem.shortcutLabel ?? undefined}
                      danger
                      disabled={trashItem.disabled}
                      disabledReason={trashItem.disabledReason ?? undefined}
                      onAction={() => runSidebarCommand("folder.move-to-trash")}
                    />
                  )}
                  {/* 2026-09-15 用户要求：链接文件夹的「移除链接文件夹」排在「强制从硬盘删除」之前
                      ——移除只删链接记录（可再次导入），比永久删除更安全，因此放在前面。 */}
                  {removeFromLibraryItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={removeFromLibraryItem.label}
                      danger
                      onAction={() =>
                        runSidebarCommand("folder.remove-from-library")
                      }
                    />
                  )}
                  {deleteFromDiskItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={deleteFromDiskItem.label}
                      shortcut={deleteFromDiskItem.shortcutLabel ?? undefined}
                      danger
                      disabled={deleteFromDiskItem.disabled}
                      disabledReason={
                        deleteFromDiskItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runSidebarCommand("folder.delete-from-disk")
                      }
                    />
                  )}
                  <PluginMenuItems
                    items={folderPluginItems("delete", "after")}
                    onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
                  />
                </ContextMenuSection>
              )}
              <PluginMenuCommandsSection
                items={pluginItemsOutsideHostGroups(pluginFolderMenuPlacement)}
                label={t("contextMenu.pluginCommands")}
                onRun={(item) => runPluginCommand(item, { folderIds: [desc.folderId] })}
              />
            </>
          );
        })()}
</>
  );
}
