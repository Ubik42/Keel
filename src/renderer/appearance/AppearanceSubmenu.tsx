import type { EntityAppearance } from "../../shared/entity-appearance";
import { Icon, type IconName } from "../common/Icons";
import { ContextMenuSubmenu } from "../workbench/menu/context-menu";
import { EntityAppearancePicker } from "./EntityAppearancePicker";

/**
 * The "Appearance" row of an object's context menu. The picker opens as a
 * submenu beside the row, next to the object, and each choice applies at once.
 * Folders, folder selections and tags use the same row.
 */
export function AppearanceSubmenu({
  label,
  value,
  fallback,
  onChange,
  randomLabel,
  onRandom,
}: {
  label: string;
  value: EntityAppearance | null;
  fallback?: IconName;
  onChange: (next: EntityAppearance | null) => void;
  randomLabel?: string;
  onRandom?: () => void;
}) {
  return (
    <ContextMenuSubmenu icon={<Icon name="palette" size={14} />} label={label}>
      <EntityAppearancePicker
        value={value}
        fallback={fallback}
        onChange={onChange}
        randomLabel={randomLabel}
        onRandom={onRandom}
      />
    </ContextMenuSubmenu>
  );
}
