import { useState, type ReactNode } from "react";

import {
  normalizeOpenWithExtension,
  type OpenWithSettings,
  type OpenWithTarget,
} from "../shared/open-with";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { SettingsCard } from "./ui/patterns";
import { openWithBridge, useOpenWithSettings } from "./use-open-with-settings";

function targetValue(target: OpenWithTarget): string {
  return target.kind === "program" ? `program:${target.programId}` : target.kind;
}

function parseTargetValue(value: string): OpenWithTarget {
  if (value.startsWith("program:")) return { kind: "program", programId: value.slice("program:".length) };
  return value === "system" ? { kind: "system" } : { kind: "viewer" };
}

/** PF: registered programs and the per-extension default for double-click. */
export function OpenWithSettingsCard(): ReactNode {
  const t = useT();
  const { settings, save } = useOpenWithSettings();
  const [extensionDraft, setExtensionDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("system");
  const draftExtension = normalizeOpenWithExtension(extensionDraft);

  async function update(next: OpenWithSettings): Promise<void> {
    await save(next);
  }

  async function addProgram(): Promise<void> {
    const chosen = await openWithBridge()?.chooseProgram();
    if (!chosen) return;
    await update({
      ...settings,
      programs: [...settings.programs, { programId: crypto.randomUUID(), ...chosen }],
    });
  }

  async function removeProgram(programId: string): Promise<void> {
    const defaults = Object.fromEntries(Object.entries(settings.defaults)
      .filter(([, target]) => !(target.kind === "program" && target.programId === programId)));
    await update({ ...settings, programs: settings.programs.filter((program) => program.programId !== programId), defaults });
  }

  async function setDefault(extension: string, target: OpenWithTarget | null): Promise<void> {
    const defaults = { ...settings.defaults };
    if (target === null) delete defaults[extension];
    else defaults[extension] = target;
    await update({ ...settings, defaults });
  }

  const targetOptions = [
    { value: "viewer", label: t("menu.openWithViewer") },
    { value: "system", label: t("menu.openWithSystem") },
    ...settings.programs.map((program) => ({ value: `program:${program.programId}`, label: program.name })),
  ];
  const defaults = Object.entries(settings.defaults).sort(([left], [right]) => left.localeCompare(right));

  return (
    <SettingsCard>
      <div className="app-settings-row-copy">
        <strong>{t("settings.openWith")}</strong>
        <span>{t("settings.openWithHint")}</span>
      </div>

      <div className="open-with-settings-section">
        <span className="micro-label">{t("settings.openWithPrograms")}</span>
        {settings.programs.length === 0 ? (
          <span className="app-settings-empty-hint">{t("settings.openWithNoPrograms")}</span>
        ) : (
          <ul className="open-with-settings-list">
            {settings.programs.map((program) => (
              <li key={program.programId}>
                <span className="open-with-settings-name">{program.name}</span>
                <span className="open-with-settings-path" data-hover-tip={program.executablePath}>{program.executablePath}</span>
                <button
                  className="app-settings-memory-chip-remove"
                  onClick={() => void removeProgram(program.programId)}
                  type="button"
                  {...iconActionAttrs(t("settings.openWithRemoveProgram"))}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="secondary-button" onClick={() => void addProgram()} type="button">
          {t("settings.openWithAddProgram")}
        </button>
      </div>

      <div className="open-with-settings-section">
        <span className="micro-label">{t("settings.openWithDefaults")}</span>
        {defaults.length === 0 ? (
          <span className="app-settings-empty-hint">{t("settings.openWithNoDefaults")}</span>
        ) : (
          <ul className="open-with-settings-list">
            {defaults.map(([extension, target]) => (
              <li key={extension}>
                <span className="open-with-settings-name">.{extension}</span>
                <select
                  aria-label={t("settings.openWithDefaultFor", { extension })}
                  className="text-field"
                  onChange={(event) => void setDefault(extension, parseTargetValue(event.target.value))}
                  value={targetValue(target)}
                >
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  className="app-settings-memory-chip-remove"
                  onClick={() => void setDefault(extension, null)}
                  type="button"
                  {...iconActionAttrs(t("settings.openWithRemoveDefault"))}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="open-with-settings-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draftExtension) return;
            void setDefault(draftExtension, parseTargetValue(targetDraft)).then(() => setExtensionDraft(""));
          }}
        >
          <input
            aria-label={t("settings.openWithExtension")}
            className="text-field"
            onChange={(event) => setExtensionDraft(event.target.value)}
            placeholder={t("settings.openWithExtensionPlaceholder")}
            value={extensionDraft}
          />
          <select
            aria-label={t("settings.openWithTarget")}
            className="text-field"
            onChange={(event) => setTargetDraft(event.target.value)}
            value={targetDraft}
          >
            {targetOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button className="secondary-button" disabled={!draftExtension} type="submit">
            {t("settings.openWithAddDefault")}
          </button>
        </form>
      </div>
    </SettingsCard>
  );
}
