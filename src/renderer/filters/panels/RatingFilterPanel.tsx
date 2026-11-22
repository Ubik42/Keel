import type { DimensionId } from "../DimensionFilterBar";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { type QueryState } from "../../stores/query-store";
import { PortaledPopover } from "../../workbench/overlay/PortaledPopover";

export interface RatingFilterPanelProps {
  openDimension: DimensionId | null;
  ratingDimRef: RefObject<HTMLDivElement | null>;
  selectedRatings: Set<string>;
  controlsDisabled: boolean;
  toggleRating: (star: number, shiftKey: boolean) => void;
  t: TranslateFn;
  excludeRatingFilter: QueryState["excludeRatingFilter"];
  disabled: boolean | undefined;
  setExcludeRatingFilter: Dispatch<SetStateAction<QueryState["excludeRatingFilter"]>>;
  includeAiRating: QueryState["includeAiRatingFilter"];
  setIncludeAiRating: Dispatch<SetStateAction<QueryState["includeAiRatingFilter"]>>;
}

/** Extracted from DimensionFilterBar (P4); renders the same elements. */
export function RatingFilterPanel({ openDimension, ratingDimRef, selectedRatings, controlsDisabled, toggleRating, t, excludeRatingFilter, disabled, setExcludeRatingFilter, includeAiRating, setIncludeAiRating }: RatingFilterPanelProps) {
  return (
<>
{openDimension === "rating" && (
            <PortaledPopover
              anchorRef={ratingDimRef}
              className="dimension-filter-popover"
              data-dimension="rating"
              role="dialog"
            >
              <div className="dimension-rating-row" role="group">
                {[5, 4, 3, 2, 1, 0].map((star) => (
                  <button
                    aria-pressed={selectedRatings.has(String(star))}
                    className={`dimension-rating-chip${selectedRatings.has(String(star)) ? " is-active" : ""}`}
                    disabled={controlsDisabled}
                    key={star}
                    onClick={(event) => toggleRating(star, event.shiftKey)}
                    type="button"
                  >
                    {star === 0 ? t("filter.unrated") : `${star}★`}
                  </button>
                ))}
              </div>
              <div className="dimension-filter-check-row">
                <label className="dimension-filter-check">
                  <input
                    checked={excludeRatingFilter}
                    disabled={disabled || selectedRatings.size === 0}
                    onChange={(event) =>
                      setExcludeRatingFilter(event.target.checked)
                    }
                    type="checkbox"
                  />
                  {t("filter.exclude")}
                </label>
                <label className="dimension-filter-check">
                  <input
                    checked={includeAiRating}
                    disabled={controlsDisabled}
                    onChange={(event) => setIncludeAiRating(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="inspector-ai-badge">{t("filter.ai")}</span>
                </label>
              </div>
              <p className="dimension-filter-hint">{t("filter.shiftMultiSelectHint")}</p>
            </PortaledPopover>
          )}
</>
  );
}
