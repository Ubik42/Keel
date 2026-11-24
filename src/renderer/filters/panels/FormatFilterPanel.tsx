import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { DimensionId } from "../DimensionFilterBar";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { FormatGroupSelectionState } from "../dimension-filter-selection";
import { FormatGroupCheckbox } from "./FormatGroupCheckbox";
import { formatGroupSelectionState, formatTokensHas, toggleFormatGroup, toggleFormatToken } from "../dimension-filter-selection";
import { FORMAT_FILTER_GROUPS, FORMAT_TEXT_TOKEN, FORMAT_UNKNOWN_TOKEN } from "../format-filter-presets";
import { groupKey, MISC_GROUP_LABEL_KEY } from "../format-quick-preferences";
import { type QueryState } from "../../stores/query-store";
import { PortaledPopover } from "../../workbench/overlay/PortaledPopover";
import { Icon } from "../../common/Icons";

export interface FormatFilterPanelProps {
  openDimension: DimensionId | null;
  formatDimRef: RefObject<HTMLDivElement | null>;
  t: TranslateFn;
  controlsDisabled: boolean;
  setFormatFilter: Dispatch<SetStateAction<QueryState["formatFilter"]>>;
  formatFilter: QueryState["formatFilter"];
  otherGroupState: FormatGroupSelectionState;
  otherFormatTokens: ("html" | "hdf" | "htm" | "text")[];
  excludeFormatFilter: QueryState["excludeFormatFilter"];
  disabled: boolean | undefined;
  setExcludeFormatFilter: Dispatch<SetStateAction<QueryState["excludeFormatFilter"]>>;
  /** Choices shown directly in the filter row (format-quick-preferences.ts). */
  quickKeys: readonly string[];
  onToggleQuick: (key: string) => void;
}

/**
 * Format filter panel. In edit mode, every group and format has a pin that
 * decides whether the filter row lists it outside the panel.
 */
export function FormatFilterPanel({ openDimension, formatDimRef, t, controlsDisabled, setFormatFilter, formatFilter, otherGroupState, otherFormatTokens, excludeFormatFilter, disabled, setExcludeFormatFilter, quickKeys, onToggleQuick }: FormatFilterPanelProps) {
  const [editing, setEditing] = useState(false);
  if (openDimension !== "format") return null;

  const quickPin = (key: string, label: string) => {
    const listed = quickKeys.includes(key);
    return (
      <button
        aria-label={`${t(listed ? "filter.formatQuickHide" : "filter.formatQuickShow")}：${label}`}
        aria-pressed={listed}
        className={`format-quick-pin${listed ? " is-listed" : ""}`}
        onClick={() => onToggleQuick(key)}
        title={t(listed ? "filter.formatQuickHide" : "filter.formatQuickShow")}
        type="button"
      >
        <Icon name="pin" size={12} />
      </button>
    );
  };

  const chip = (token: string, label: string) => {
    const active = formatTokensHas(formatFilter, token);
    if (editing) {
      const listed = quickKeys.includes(token);
      return (
        <button
          aria-label={`${t(listed ? "filter.formatQuickHide" : "filter.formatQuickShow")}：${label}`}
          aria-pressed={listed}
          className={`filter-preset-chip is-quick-edit${listed ? " is-listed" : ""}`}
          key={token}
          onClick={() => onToggleQuick(token)}
          type="button"
        >
          {label}
          <Icon name="pin" size={11} />
        </button>
      );
    }
    return (
      <button
        aria-pressed={active}
        className={`filter-preset-chip${active ? " is-active" : ""}`}
        disabled={controlsDisabled}
        key={token}
        onClick={(event) => setFormatFilter(toggleFormatToken(formatFilter, token, event.shiftKey))}
        type="button"
      >
        {label}
      </button>
    );
  };

  return (
    <PortaledPopover
      anchorRef={formatDimRef}
      className="dimension-filter-popover is-wide format-filter-popover"
      data-dimension="format"
      role="dialog"
    >
      <div className="format-filter-head">
        <input
          aria-label={t("filter.format")}
          className="text-field"
          disabled={controlsDisabled}
          onChange={(event) => setFormatFilter(event.target.value)}
          placeholder="png, jpg, mp4"
          value={formatFilter}
        />
        <button
          aria-pressed={editing}
          className={`format-quick-edit${editing ? " is-active" : ""}`}
          onClick={() => setEditing((value) => !value)}
          type="button"
        >
          <Icon name={editing ? "check" : "edit"} size={13} />
          {t(editing ? "filter.formatQuickDone" : "filter.formatQuickEdit")}
        </button>
      </div>
      {editing && <p className="dimension-filter-hint">{t("filter.formatQuickEditHint")}</p>}
      {FORMAT_FILTER_GROUPS.map((group) => {
        const groupState = formatGroupSelectionState(formatFilter, group.extensions);
        return (
          <div className="format-filter-group" key={group.labelKey}>
            <div className="format-filter-group-row">
              <FormatGroupCheckbox
                checked={groupState === "all"}
                disabled={controlsDisabled}
                indeterminate={groupState === "partial"}
                label={t(group.labelKey)}
                onToggle={() => setFormatFilter(toggleFormatGroup(formatFilter, group.extensions))}
              />
              {editing && quickPin(groupKey(group.labelKey), t(group.labelKey))}
            </div>
            <div className="filter-presets" role="group">
              {group.extensions.map((ext) => chip(ext, ext))}
            </div>
          </div>
        );
      })}
      <div className="format-filter-group">
        <div className="format-filter-group-row">
          <FormatGroupCheckbox
            checked={otherGroupState === "all"}
            disabled={controlsDisabled}
            indeterminate={otherGroupState === "partial"}
            label={t(MISC_GROUP_LABEL_KEY)}
            onToggle={() => setFormatFilter(toggleFormatGroup(formatFilter, otherFormatTokens))}
          />
          {editing && quickPin(groupKey(MISC_GROUP_LABEL_KEY), t(MISC_GROUP_LABEL_KEY))}
        </div>
        <div className="filter-presets" role="group">
          {otherFormatTokens.map((ext) => chip(ext, ext === FORMAT_TEXT_TOKEN ? t("filter.formatText") : ext))}
        </div>
      </div>
      <div className="format-filter-group">
        <FormatGroupCheckbox
          checked={formatTokensHas(formatFilter, FORMAT_UNKNOWN_TOKEN)}
          disabled={controlsDisabled}
          indeterminate={false}
          label={t("filter.formatUnrecognized")}
          onToggle={() => setFormatFilter(toggleFormatGroup(formatFilter, [FORMAT_UNKNOWN_TOKEN]))}
        />
      </div>
      <label className="dimension-filter-check">
        <input
          checked={excludeFormatFilter}
          disabled={disabled || !formatFilter.trim()}
          onChange={(event) => setExcludeFormatFilter(event.target.checked)}
          type="checkbox"
        />
        {t("filter.exclude")}
      </label>
      <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
    </PortaledPopover>
  );
}
