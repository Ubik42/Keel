import type { DimensionId } from "../DimensionFilterBar";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { FormatGroupSelectionState } from "../dimension-filter-selection";
import { FormatGroupCheckbox } from "./FormatGroupCheckbox";
import { formatGroupSelectionState, formatTokensHas, toggleFormatGroup, toggleFormatToken } from "../dimension-filter-selection";
import { FORMAT_FILTER_GROUPS, FORMAT_TEXT_TOKEN, FORMAT_UNKNOWN_TOKEN } from "../format-filter-presets";
import { type QueryState } from "../stores/query-store";
import { PortaledPopover } from "../workbench/overlay/PortaledPopover";

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
}

/** Extracted from DimensionFilterBar (P4); renders the same elements. */
export function FormatFilterPanel({ openDimension, formatDimRef, t, controlsDisabled, setFormatFilter, formatFilter, otherGroupState, otherFormatTokens, excludeFormatFilter, disabled, setExcludeFormatFilter }: FormatFilterPanelProps) {
  return (
<>
{openDimension === "format" && (
            <PortaledPopover
              anchorRef={formatDimRef}
              className="dimension-filter-popover is-wide format-filter-popover"
              data-dimension="format"
              role="dialog"
            >
              <input
                aria-label={t("filter.format")}
                className="text-field"
                disabled={controlsDisabled}
                onChange={(event) => setFormatFilter(event.target.value)}
                placeholder="png, jpg, mp4"
                value={formatFilter}
              />
              {FORMAT_FILTER_GROUPS.map((group) => {
                const groupState = formatGroupSelectionState(
                  formatFilter,
                  group.extensions,
                );
                return (
                  <div className="format-filter-group" key={group.labelKey}>
                    <FormatGroupCheckbox
                      checked={groupState === "all"}
                      disabled={controlsDisabled}
                      indeterminate={groupState === "partial"}
                      label={t(group.labelKey)}
                      onToggle={() =>
                        setFormatFilter(
                          toggleFormatGroup(formatFilter, group.extensions),
                        )
                      }
                    />
                    <div className="filter-presets" role="group">
                      {group.extensions.map((ext) => {
                        const active = formatTokensHas(formatFilter, ext);
                        return (
                          <button
                            aria-pressed={active}
                            className={`filter-preset-chip${active ? " is-active" : ""}`}
                            disabled={controlsDisabled}
                            key={ext}
                            onClick={(event) =>
                              setFormatFilter(
                                toggleFormatToken(
                                  formatFilter,
                                  ext,
                                  event.shiftKey,
                                ),
                              )
                            }
                            type="button"
                          >
                            {ext}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="format-filter-group">
                <FormatGroupCheckbox
                  checked={otherGroupState === "all"}
                  disabled={controlsDisabled}
                  indeterminate={otherGroupState === "partial"}
                  label={t("filter.formatGroupMisc")}
                  onToggle={() =>
                    setFormatFilter(
                      toggleFormatGroup(formatFilter, otherFormatTokens),
                    )
                  }
                />
                <div className="filter-presets" role="group">
                  {otherFormatTokens.map((ext) => {
                    const active = formatTokensHas(formatFilter, ext);
                    return (
                      <button
                        aria-pressed={active}
                        className={`filter-preset-chip${active ? " is-active" : ""}`}
                        disabled={controlsDisabled}
                        key={ext}
                        onClick={(event) =>
                          setFormatFilter(
                            toggleFormatToken(
                              formatFilter,
                              ext,
                              event.shiftKey,
                            ),
                          )
                        }
                        type="button"
                      >
                        {ext === FORMAT_TEXT_TOKEN
                          ? t("filter.formatText")
                          : ext}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="format-filter-group">
                <FormatGroupCheckbox
                  checked={formatTokensHas(formatFilter, FORMAT_UNKNOWN_TOKEN)}
                  disabled={controlsDisabled}
                  indeterminate={false}
                  label={t("filter.formatUnrecognized")}
                  onToggle={() =>
                    setFormatFilter(
                      toggleFormatGroup(formatFilter, [FORMAT_UNKNOWN_TOKEN]),
                    )
                  }
                />
              </div>
              <label className="dimension-filter-check">
                <input
                  checked={excludeFormatFilter}
                  disabled={disabled || !formatFilter.trim()}
                  onChange={(event) =>
                    setExcludeFormatFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </PortaledPopover>
          )}
</>
  );
}
