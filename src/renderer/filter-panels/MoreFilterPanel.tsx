import type { DimensionId } from "../DimensionFilterBar";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { ColorFilterPopover } from "../ColorFilterPopover";
import { ASPECT_RATIO_PRESETS, ORIENTATION_PRESETS, RESOLUTION_PRESETS, aspectRatioPresetRange, togglePresetRange, togglePresetRanges, type RangeStrings } from "../filter-presets";
import { FilterPresetChips } from "../FilterPresetChips";
import { type QueryState } from "../stores/query-store";
import { TechnicalRangeFilter } from "../TechnicalRangeFilter";
import { PortaledPopover } from "../workbench/overlay/PortaledPopover";
import { Select } from "../workbench/ui/primitives";

export interface MoreFilterPanelProps {
  openDimension: DimensionId | null;
  moreDimRef: RefObject<HTMLDivElement | null>;
  t: TranslateFn;
  colorFilter: QueryState["colorFilter"];
  colorFilterPrefs: QueryState["colorFilterPrefs"];
  colorSimilarity: QueryState["colorSimilarity"];
  controlsDisabled: boolean;
  excludeColorFilter: QueryState["excludeColorFilter"];
  onColorFilterPrefsChange: Dispatch<SetStateAction<QueryState["colorFilterPrefs"]>>;
  setColorFilter: Dispatch<SetStateAction<QueryState["colorFilter"]>>;
  setColorSimilarity: Dispatch<SetStateAction<QueryState["colorSimilarity"]>>;
  setExcludeColorFilter: Dispatch<SetStateAction<QueryState["excludeColorFilter"]>>;
  applyShapePreset: (range: RangeStrings, shiftKey: boolean) => void;
  shapeSelectedRanges: RangeStrings[];
  aspectRatioRange: QueryState["aspectRatioRange"];
  setAspectRatioRange: Dispatch<SetStateAction<QueryState["aspectRatioRange"]>>;
  setAspectRatioRanges: Dispatch<SetStateAction<QueryState["aspectRatioRanges"]>>;
  setFavoriteFilter: Dispatch<SetStateAction<QueryState["favoriteFilter"]>>;
  favoriteFilter: QueryState["favoriteFilter"];
  setSourceUrlFilter: Dispatch<SetStateAction<QueryState["sourceUrlFilter"]>>;
  sourceUrlFilter: QueryState["sourceUrlFilter"];
  setAvailabilityFilter: Dispatch<SetStateAction<QueryState["availabilityFilter"]>>;
  availabilityFilter: QueryState["availabilityFilter"];
  excludeAvailabilityFilter: QueryState["excludeAvailabilityFilter"];
  disabled: boolean | undefined;
  setExcludeAvailabilityFilter: Dispatch<SetStateAction<QueryState["excludeAvailabilityFilter"]>>;
  longEdgeRange: QueryState["longEdgeRange"];
  setLongEdgeRange: Dispatch<SetStateAction<QueryState["longEdgeRange"]>>;
  widthRange: QueryState["widthRange"];
  setWidthRange: Dispatch<SetStateAction<QueryState["widthRange"]>>;
  heightRange: QueryState["heightRange"];
  setHeightRange: Dispatch<SetStateAction<QueryState["heightRange"]>>;
  durationRange: QueryState["durationRange"];
  setDurationRange: Dispatch<SetStateAction<QueryState["durationRange"]>>;
}

/** Extracted from DimensionFilterBar (P4); renders the same elements. */
export function MoreFilterPanel({ openDimension, moreDimRef, t, colorFilter, colorFilterPrefs, colorSimilarity, controlsDisabled, excludeColorFilter, onColorFilterPrefsChange, setColorFilter, setColorSimilarity, setExcludeColorFilter, applyShapePreset, shapeSelectedRanges, aspectRatioRange, setAspectRatioRange, setAspectRatioRanges, setFavoriteFilter, favoriteFilter, setSourceUrlFilter, sourceUrlFilter, setAvailabilityFilter, availabilityFilter, excludeAvailabilityFilter, disabled, setExcludeAvailabilityFilter, longEdgeRange, setLongEdgeRange, widthRange, setWidthRange, heightRange, setHeightRange, durationRange, setDurationRange }: MoreFilterPanelProps) {
  return (
<>
{openDimension === "more" && (
            <PortaledPopover
              anchorRef={moreDimRef}
              className="dimension-filter-popover is-wide"
              data-dimension="more"
              role="dialog"
            >
              <details className="dimension-filter-more-section">
                <summary>{t('filter.dimColor')}</summary>
              <ColorFilterPopover
                colorFilter={colorFilter}
                colorFilterPrefs={colorFilterPrefs}
                colorSimilarity={colorSimilarity}
                disabled={controlsDisabled}
                excludeColorFilter={excludeColorFilter}
                onColorFilterPrefsChange={onColorFilterPrefsChange}
                setColorFilter={setColorFilter}
                setColorSimilarity={setColorSimilarity}
                setExcludeColorFilter={setExcludeColorFilter}
              />
              </details>
              <details className="dimension-filter-more-section">
                <summary>{t('filter.dimShape')}</summary>
              <FilterPresetChips
                disabled={controlsDisabled}
                label={t("filter.orientation")}
                onToggle={applyShapePreset}
                presets={ORIENTATION_PRESETS.map((preset) => ({
                  label:
                    preset.id === "landscape"
                      ? t("filter.landscape")
                      : t("filter.portrait"),
                  range: preset.range,
                }))}
                selected={shapeSelectedRanges}
              />
              <FilterPresetChips
                disabled={controlsDisabled}
                label={t("filter.aspectRatioPresets")}
                onToggle={applyShapePreset}
                presets={ASPECT_RATIO_PRESETS.map((preset) => ({
                  label: preset.label,
                  range: aspectRatioPresetRange(preset),
                }))}
                selected={shapeSelectedRanges}
              />
              <TechnicalRangeFilter
                label={t("filter.aspectRatio")}
                range={aspectRatioRange}
                setRange={(next) => {
                  setAspectRatioRange(next);
                  const resolved =
                    typeof next === "function" ? next(aspectRatioRange) : next;
                  setAspectRatioRanges(
                    resolved.min || resolved.max
                      ? [{ min: resolved.min, max: resolved.max }]
                      : [],
                  );
                }}
                step="0.01"
              />
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>

              </details>
              <label>
                {t("filter.favoriteField")}
                <Select
                  aria-label={t("filter.favorite")}
                  className="text-field"
                  disabled={controlsDisabled}
                  onValueChange={(value) =>
                    setFavoriteFilter(value as typeof favoriteFilter)
                  }
                  options={[
                    { value: "any", label: t("common.none") },
                    { value: "yes", label: t("filter.favoriteOnly") },
                    { value: "no", label: t("filter.notFavorite") },
                  ]}
                  value={favoriteFilter}
                />
              </label>
              <label>
                {t("filter.sourceUrlField")}
                <Select
                  aria-label={t("filter.sourceUrl")}
                  className="text-field"
                  disabled={controlsDisabled}
                  onValueChange={(value) =>
                    setSourceUrlFilter(value as typeof sourceUrlFilter)
                  }
                  options={[
                    { value: "any", label: t("common.none") },
                    { value: "yes", label: t("filter.hasSourceUrl") },
                    { value: "no", label: t("filter.noSourceUrl") },
                  ]}
                  value={sourceUrlFilter}
                />
              </label>
              <label>
                {t("filter.availabilityField")}
                <Select
                  aria-label={t("filter.availability")}
                  className="text-field"
                  disabled={controlsDisabled}
                  onValueChange={(value) =>
                    setAvailabilityFilter(value as typeof availabilityFilter)
                  }
                  options={[
                    { value: "any", label: t("common.all") },
                    { value: "available", label: t("filter.available") },
                    { value: "missing", label: t("filter.missing") },
                  ]}
                  value={availabilityFilter}
                />
              </label>
              <label className="dimension-filter-check">
                <input
                  checked={excludeAvailabilityFilter}
                  disabled={disabled || availabilityFilter === "any"}
                  onChange={(event) =>
                    setExcludeAvailabilityFilter(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("filter.exclude")}
              </label>
              <FilterPresetChips
                disabled={controlsDisabled}
                label={t("filter.resolutionPresets")}
                onToggle={(range, shiftKey) => {
                  if (shiftKey) {
                    const seed =
                      longEdgeRange.min || longEdgeRange.max
                        ? [
                            {
                              min: longEdgeRange.min,
                              max: longEdgeRange.max,
                            },
                          ]
                        : [];
                    const next = togglePresetRanges(seed, range, true);
                    if (next.length === 1) {
                      setLongEdgeRange((current) => ({
                        ...current,
                        min: next[0]!.min,
                        max: next[0]!.max,
                      }));
                    } else if (next.length === 0) {
                      setLongEdgeRange((current) => ({
                        ...current,
                        min: "",
                        max: "",
                      }));
                    } else {
                      // Resolution still uses a single range in App state;
                      // Shift multi falls back to replace for long-edge.
                      setLongEdgeRange((current) => ({
                        ...current,
                        ...range,
                      }));
                    }
                    return;
                  }
                  setLongEdgeRange((current) => ({
                    ...current,
                    ...togglePresetRange(current, range),
                  }));
                }}
                presets={RESOLUTION_PRESETS}
                selected={
                  longEdgeRange.min || longEdgeRange.max
                    ? [
                        {
                          min: longEdgeRange.min,
                          max: longEdgeRange.max,
                        },
                      ]
                    : []
                }
              />
              <TechnicalRangeFilter
                label={t("filter.longEdgePx")}
                range={longEdgeRange}
                setRange={setLongEdgeRange}
              />
              <TechnicalRangeFilter
                label={t("filter.widthPx")}
                range={widthRange}
                setRange={setWidthRange}
              />
              <TechnicalRangeFilter
                label={t("filter.heightPx")}
                range={heightRange}
                setRange={setHeightRange}
              />
              <TechnicalRangeFilter
                label={t("filter.durationSec")}
                range={durationRange}
                setRange={setDurationRange}
                step="0.1"
              />
            </PortaledPopover>
          )}
</>
  );
}
