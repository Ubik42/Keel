import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { useAssetContextMenuActions } from "./menu-shared";
import { Icon } from "../Icons";
import { type BrowseState } from "../stores/browse-store";
import { ContextMenuItem, ContextMenuSection } from "../workbench/menu/context-menu";

export interface TrashMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  trashedAssetCount: BrowseState["trashedAssetCount"];
  trashedFolderCount: number;
  t: TranslateFn;
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function TrashMenuItems({ activeContextMenu, trashedAssetCount, trashedFolderCount, t }: TrashMenuItemsProps) {
  const { onEmptyTrash } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "trash" && (
          <ContextMenuSection>
            <ContextMenuItem
              danger
              disabled={
                trashedAssetCount === 0 &&
                trashedFolderCount === 0
              }
              disabledReason={
                trashedAssetCount === 0 &&
                trashedFolderCount === 0
                  ? t("empty.trashTitle")
                  : undefined
              }
              icon={<Icon name="trash" size={14} />}
              label={t("toolbar.emptyTrash")}
              onAction={onEmptyTrash}
            />
          </ContextMenuSection>
        )}
</>
  );
}
