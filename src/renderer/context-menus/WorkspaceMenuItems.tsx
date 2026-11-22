import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { type PluginMenuDescriptor } from "../plugins/plugin-menu-contributions";
import { PluginMenuCommandsSection } from "./menu-shared";

export interface WorkspaceMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  pluginWorkspaceMenuItems: PluginMenuDescriptor[];
  t: TranslateFn;
  runPluginCommand: (item: PluginMenuDescriptor, context: { assetIds?: string[]; folderIds?: string[]; }) => void;
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function WorkspaceMenuItems({ activeContextMenu, pluginWorkspaceMenuItems, t, runPluginCommand }: WorkspaceMenuItemsProps) {

  return (
<>
{activeContextMenu.descriptor.type === "workspace" && (() => {
          const desc = activeContextMenu.descriptor;
          if (desc.type !== "workspace") return null;
          const assetIds = desc.assetIds;
          return (
            <PluginMenuCommandsSection
              items={pluginWorkspaceMenuItems}
              label={t("contextMenu.pluginCommands")}
              onRun={(item) => runPluginCommand(
                item,
                assetIds === undefined || assetIds.length === 0
                  ? {}
                  : { assetIds: [...assetIds] },
              )}
            />
          );
        })()}
</>
  );
}
