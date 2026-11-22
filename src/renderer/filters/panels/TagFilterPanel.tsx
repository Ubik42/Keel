import type { DimensionId } from "../DimensionFilterBar";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { FilterTagPicker } from "../FilterTagPicker";
import { type NavigationState } from "../../stores/navigation-store";
import { type QueryState } from "../../stores/query-store";
import { type TagFilterRecency } from "../../tags/tag-filter-recency";
import { PortaledPopover } from "../../workbench/overlay/PortaledPopover";

export interface TagFilterPanelProps {
  openDimension: DimensionId | null;
  tagsDimRef: RefObject<HTMLDivElement | null>;
  controlsDisabled: boolean;
  excludedTagNames: string[];
  includedTagNames: string[];
  tagFilterExpression: QueryState["tagFilterExpression"];
  tagFilterLastValidExpression: QueryState["tagFilterLastValidExpression"];
  setTagFilterExpression: ((value: string) => void) | undefined;
  tagFilterMode: QueryState["tagFilterMode"];
  setTagFilterMode: Dispatch<SetStateAction<QueryState["tagFilterMode"]>>;
  tagFilterMatch: QueryState["tagFilterMatch"];
  setTagFilterMatch: Dispatch<SetStateAction<QueryState["tagFilterMatch"]>>;
  handleTagSelectionChange: (next: { includes: string[]; excludes: string[]; }) => void;
  tagRecency: TagFilterRecency;
  tags: NavigationState["tags"];
  includeAiTag: QueryState["includeAiTagFilter"];
  setIncludeAiTag: Dispatch<SetStateAction<QueryState["includeAiTagFilter"]>>;
  t: TranslateFn;
}

/** Extracted from DimensionFilterBar (P4); renders the same elements. */
export function TagFilterPanel({ openDimension, tagsDimRef, controlsDisabled, excludedTagNames, includedTagNames, tagFilterExpression, tagFilterLastValidExpression, setTagFilterExpression, tagFilterMode, setTagFilterMode, tagFilterMatch, setTagFilterMatch, handleTagSelectionChange, tagRecency, tags, includeAiTag, setIncludeAiTag, t }: TagFilterPanelProps) {
  return (
<>
{openDimension === "tags" && (
            <PortaledPopover
              anchorRef={tagsDimRef}
              className="dimension-filter-popover is-tag-filter"
              data-dimension="tags"
              role="dialog"
            >
              <FilterTagPicker
                disabled={controlsDisabled}
                excludedNames={excludedTagNames}
                includedNames={includedTagNames}
                expression={tagFilterExpression}
                lastValidExpression={tagFilterLastValidExpression}
                onExpressionChange={setTagFilterExpression ?? (() => {})}
                expressionMode={tagFilterMode === "expression"}
                onExpressionModeChange={(value) => setTagFilterMode?.(value ? "expression" : "selection")}
                tagMatch={tagFilterMatch}
                onTagMatchChange={(value) => setTagFilterMatch?.(value)}
                onChange={handleTagSelectionChange}
                recentNames={tagRecency.names}
                tags={tags}
              />
              <div className="dimension-filter-check-row">
                <label className="dimension-filter-check">
                  <input
                    checked={includeAiTag}
                    disabled={controlsDisabled}
                    onChange={(event) => setIncludeAiTag(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="inspector-ai-badge">{t("filter.ai")}</span>
                </label>
              </div>
              <p className="dimension-filter-hint">{t("filter.tagClickHint")}</p>
            </PortaledPopover>
          )}
</>
  );
}
