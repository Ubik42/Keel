import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { useAssetContextMenuActions } from "./menu-shared";
import { Icon } from "../common/Icons";
import { ContextMenuItem, ContextMenuSection } from "../workbench/menu/context-menu";

export interface TrashedFolderMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  t: TranslateFn;
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function TrashedFolderMenuItems({ activeContextMenu, t }: TrashedFolderMenuItemsProps) {
  const { onRestoreTrashedFolder } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "trashed-folder" && (
          <ContextMenuSection label={t("command.group.trashActions")}>
            <ContextMenuItem
              icon={<Icon name="refresh" size={14} />}
              label={t("menu.restoreTrashedFolder")}
              onAction={() => {
                const desc = activeContextMenu.descriptor;
                if (desc.type !== "trashed-folder") return;
                onRestoreTrashedFolder(desc.tombstoneId, desc.name);
              }}
            />
          </ContextMenuSection>
        )}
</>
  );
}
