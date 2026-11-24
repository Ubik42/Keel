import { useState, type RefObject } from "react";
import type { DimensionId } from "../DimensionFilterBar";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { Icon } from "../../common/Icons";
import { PortaledPopover } from "../../workbench/overlay/PortaledPopover";
import { isImeKeyboardEvent } from "../../workbench/overlay/ime-safe-dismiss";
import {
  sameTagTreeStates,
  withTagTreePresetDeleted,
  withTagTreePresetSaved,
  withTagTreeStates,
  type TagTreePreset,
  type TagTreeStates,
} from "../../tags/tag-tree-states";
import { updateTagTreePrefs } from "../../tags/tag-tree-state-store";

export interface TagPresetPanelProps {
  openDimension: DimensionId | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  libraryId: string | null;
  states: TagTreeStates;
  presets: readonly TagTreePreset[];
  controlsDisabled: boolean;
  t: TranslateFn;
}

function newPresetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Tag presets: save the tag tree's include/exclude states under a name and
 * switch between saved states. The tree itself is where states are set.
 */
export function TagPresetPanel({ openDimension, anchorRef, libraryId, states, presets, controlsDisabled, t }: TagPresetPanelProps) {
  const [name, setName] = useState("");
  if (openDimension !== "tags") return null;
  const values = Object.values(states);
  const includeCount = values.filter((state) => state === "include").length;
  const excludeCount = values.length - includeCount;
  const disabled = controlsDisabled || !libraryId;
  const save = () => {
    const trimmed = name.trim();
    if (!libraryId || !trimmed || values.length === 0) return;
    updateTagTreePrefs((prefs) => withTagTreePresetSaved(prefs, libraryId, trimmed, states, newPresetId()));
    setName("");
  };
  return (
    <PortaledPopover
      anchorRef={anchorRef}
      className="dimension-filter-popover tag-preset-popover"
      data-dimension="tags"
      role="dialog"
      aria-label={t("filter.tagPresets")}
    >
      <p className="dimension-filter-hint">{t("filter.tagPresetsHelp")}</p>
      <p className="tag-preset-current">{t("filter.tagPresetCurrent", { include: includeCount, exclude: excludeCount })}</p>
      {presets.length === 0
        ? <p className="dimension-filter-hint">{t("filter.tagPresetEmpty")}</p>
        : <ul className="tag-preset-list">
          {presets.map((preset) => {
            const active = sameTagTreeStates(preset.states, states);
            return (
              <li key={preset.id} className="tag-preset-row">
                <button
                  type="button"
                  className={`tag-preset-apply${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => { if (libraryId) updateTagTreePrefs((prefs) => withTagTreeStates(prefs, libraryId, preset.states)); }}
                >
                  <Icon name={active ? "check" : "tag"} size={13} />
                  <span>{preset.name}</span>
                </button>
                <button
                  type="button"
                  className="tiny-action"
                  aria-label={t("filter.tagPresetDelete", { name: preset.name })}
                  title={t("filter.tagPresetDelete", { name: preset.name })}
                  disabled={disabled}
                  onClick={() => { if (libraryId) updateTagTreePrefs((prefs) => withTagTreePresetDeleted(prefs, libraryId, preset.id)); }}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>}
      <form className="tag-preset-save" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <input
          className="text-field"
          aria-label={t("filter.tagPresetName")}
          placeholder={t("filter.tagPresetName")}
          maxLength={80}
          disabled={disabled || values.length === 0}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (isImeKeyboardEvent(event) && event.key === "Enter") event.preventDefault(); }}
        />
        <button type="submit" className="tiny-action" aria-label={t("filter.tagPresetSave")} title={t("filter.tagPresetSave")} disabled={disabled || values.length === 0 || !name.trim()}>
          <Icon name="check" size={14} />
        </button>
      </form>
      <button
        type="button"
        className="tag-preset-clear"
        disabled={disabled || values.length === 0}
        onClick={() => { if (libraryId) updateTagTreePrefs((prefs) => withTagTreeStates(prefs, libraryId, {})); }}
      >
        {t("filter.tagPresetClear")}
      </button>
    </PortaledPopover>
  );
}
