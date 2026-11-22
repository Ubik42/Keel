import { useT } from "../i18n";
import {
  ENTITY_APPEARANCE_COLOR_IDS,
  ENTITY_APPEARANCE_EMOJI_GROUPS,
  ENTITY_APPEARANCE_ICON_GROUPS,
  ENTITY_APPEARANCE_ICON_IDS,
  type EntityAppearance,
} from "../../shared/entity-appearance";
import { AppearanceGlyph, appearanceColorVar, CHROME_APPEARANCE_ICONS } from "./AppearanceGlyph";
import { APPEARANCE_ICON_PATHS } from "./appearance-icon-paths";
import { Icon, type IconName } from "../common/Icons";

export function EntityAppearancePicker({
  value,
  onChange,
  fallback = "folder",
  randomLabel,
  onRandom,
}: {
  value: EntityAppearance | null;
  onChange: (next: EntityAppearance | null) => void;
  /** The glyph the object shows without a custom one. */
  fallback?: IconName;
  /** Optional footer action that picks a random appearance. */
  randomLabel?: string;
  onRandom?: () => void;
}) {
  const t = useT();
  const current = value;

  function setGlyph(kind: "emoji" | "icon", glyphValue: string) {
    const same = current?.glyphKind === kind && current.glyphValue === glyphValue;
    if (same) {
      onChange(
        current?.colorId
          ? { glyphKind: null, glyphValue: null, colorId: current.colorId }
          : null,
      );
      return;
    }
    onChange({
      glyphKind: kind,
      glyphValue,
      colorId: current?.colorId ?? null,
    });
  }

  function setColor(colorId: (typeof ENTITY_APPEARANCE_COLOR_IDS)[number] | null) {
    if (colorId === null) {
      onChange(
        current?.glyphKind
          ? { glyphKind: current.glyphKind, glyphValue: current.glyphValue, colorId: null }
          : null,
      );
      return;
    }
    onChange({
      glyphKind: current?.glyphKind ?? null,
      glyphValue: current?.glyphValue ?? null,
      colorId,
    });
  }

  return (
    <div
      className="appearance-picker"
      onMouseDown={(event) => event.preventDefault()}
      role="group"
      aria-label={t("appearance.title")}
    >
      <div className="appearance-picker-colors" role="listbox" aria-label={t("appearance.colorLabel")}>
        <button
          className={`appearance-picker-swatch is-none${current?.colorId ? "" : " is-selected"}`}
          data-hover-tip={t("appearance.colorNone")} aria-label={t("appearance.colorNone")}
          onClick={() => setColor(null)}
          type="button"
        />
        {ENTITY_APPEARANCE_COLOR_IDS.map((colorId) => (
          <button
            className={`appearance-picker-swatch${current?.colorId === colorId ? " is-selected" : ""}`}
            data-hover-tip={t(`appearance.color.${colorId}` as "appearance.color.blue")}
            key={colorId} aria-label={t(`appearance.color.${colorId}` as "appearance.color.blue")}
            onClick={() => setColor(colorId)}
            style={{ background: appearanceColorVar(colorId) }}
            type="button"
          />
        ))}
      </div>
      <div className="appearance-picker-scroll">
        {ENTITY_APPEARANCE_EMOJI_GROUPS.map((group) => (
          <section className="appearance-picker-group" key={`emoji-${group.id}`}>
            <h4 className="appearance-picker-heading">{t(group.labelKey as "appearance.group.faces")}</h4>
            <div className="appearance-picker-grid">
              {group.items.map((emoji) => {
                const selected = current?.glyphKind === "emoji" && current.glyphValue === emoji;
                return (
                  <button
                    aria-pressed={selected}
                    className={`appearance-picker-cell${selected ? " is-selected" : ""}`}
                    key={emoji} aria-label={emoji}
                    onClick={() => setGlyph("emoji", emoji)}
                    type="button"
                  >
                    <span className="nav-entity-glyph-emoji">{emoji}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {ENTITY_APPEARANCE_ICON_GROUPS.map((group) => (
          <section className="appearance-picker-group" key={`icon-${group.id}`}>
            <h4 className="appearance-picker-heading">{t(group.labelKey as "appearance.group.faces")}</h4>
            <div className="appearance-picker-grid">
              {group.items.map((iconId) => {
                const selected = current?.glyphKind === "icon" && current.glyphValue === iconId;
                const path = APPEARANCE_ICON_PATHS[iconId];
                return (
                  <button
                    aria-pressed={selected}
                    className={`appearance-picker-cell${selected ? " is-selected" : ""}`}
                    key={iconId} aria-label={t("appearance.iconOption", { index: ENTITY_APPEARANCE_ICON_IDS.indexOf(iconId) + 1 })}
                    onClick={() => setGlyph("icon", iconId)}
                    type="button"
                  >
                    {CHROME_APPEARANCE_ICONS.has(iconId) ? (
                      <Icon name={iconId as IconName} size={16} />
                    ) : path ? (
                      <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" width={16} height={16}>
                        {path}
                      </svg>
                    ) : (
                      <Icon name="shapes" size={16} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="appearance-picker-footer">
        <AppearanceGlyph appearance={current} fallback={fallback} size={15} />
        <span className="appearance-picker-actions">
          {onRandom ? (
            <button className="appearance-picker-clear" onClick={onRandom} type="button">
              {randomLabel}
            </button>
          ) : null}
          <button
            className="appearance-picker-clear"
            disabled={!current}
            onClick={() => onChange(null)}
            type="button"
          >
            {t("appearance.clear")}
          </button>
        </span>
      </div>
    </div>
  );
}
