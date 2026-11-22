import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { useAssetContextMenuActions } from "./menu-shared";
import { Icon } from "../common/Icons";
import { ContextMenuItem, ContextMenuSection } from "../workbench/menu/context-menu";
import { formatRuntimeShortcut } from "../workbench/shortcuts/shortcut-runtime";
import { isMac } from "./menu-shared";

export interface WorkspaceTabMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  t: TranslateFn;
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function WorkspaceTabMenuItems({ activeContextMenu, t }: WorkspaceTabMenuItemsProps) {
  const { onCloseWorkspaceTab, onCloseOtherWorkspaceTabs, onRevealWorkspaceTabEntity, onCopyWorkspaceTabName, onCopyFolderPath, onOpenFolderInFileManager } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "workspace-tab" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "workspace-tab") return null;
          return (
            <>
              <ContextMenuSection>
                {desc.canClose ? (
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={t("tabs.close")}
                    shortcut={formatRuntimeShortcut(
                      "workspace.close-tab",
                      isMac ? "mac" : "windows",
                    ) ?? undefined}
                    onAction={() => onCloseWorkspaceTab(desc.tabId)}
                  />
                ) : null}
                <ContextMenuItem
                  disabled={!desc.canCloseOthers}
                  icon={<Icon name="close" size={14} />}
                  label={t("tabs.closeOthers")}
                  onAction={() => onCloseOtherWorkspaceTabs(desc.tabId)}
                />
              </ContextMenuSection>
              {desc.entity ? (
                <ContextMenuSection>
                  <ContextMenuItem
                    icon={<Icon name="folder-tree" size={14} />}
                    label={t("tabs.revealFolder")}
                    onAction={() => onRevealWorkspaceTabEntity(desc.entity!)}
                  />
                  <ContextMenuItem
                    icon={<Icon name="copy" size={14} />}
                    label={t("tabs.copyName")}
                    onAction={() => onCopyWorkspaceTabName(desc.name)}
                  />
                  {desc.entity.kind === "folder" ? (
                    <>
                      <ContextMenuItem
                        icon={<Icon name="copy" size={14} />}
                        label={t("tabs.copyPath")}
                        onAction={() => onCopyFolderPath(desc.entity!.id)}
                      />
                      <ContextMenuItem
                        icon={<Icon name="external-link" size={14} />}
                        label={
                          isMac
                            ? t("command.folder.revealInFinder")
                            : t("command.folder.revealInExplorer")
                        }
                        shortcut={isMac ? "⌘⇧S" : "Ctrl+Shift+S"}
                        onAction={() => onOpenFolderInFileManager(desc.entity!.id)}
                      />
                    </>
                  ) : null}
                </ContextMenuSection>
              ) : null}
            </>
          );
        })()}
</>
  );
}
