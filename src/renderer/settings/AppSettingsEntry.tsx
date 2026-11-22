import type { ReactNode } from "react";
import { Icon } from "../common/Icons";
import { iconActionAttrs } from "../common/icon-action-attrs";
import { useLocale } from "../i18n";

export type AppSettingsEntryProps = {
  onOpen: () => void;
  disabled?: boolean;
};

/**
 * PREF-001: dedicated settings gear in the navigation column,
 * left of the sidebar toggle. Not part of the browse/canvas toolbar.
 */
export function AppSettingsEntry({
  onOpen,
  disabled = false,
}: AppSettingsEntryProps): ReactNode {
  const { t } = useLocale();
  return (
    <button
      className="app-settings-entry"
      disabled={disabled}
      onClick={onOpen}
      type="button"
      {...iconActionAttrs(t("toolbar.appSettings"))}
    >
      <Icon name="settings" size={15} />
    </button>
  );
}
