import { useNavigationField } from "../stores/navigation-store";
import { useQueryField } from "../stores/query-store";
import { useSessionField } from "../stores/session-store";
import { liveTagTreeStates, tagTreePresetsFor, tagTreeStatesFor, withTagTreeStates, type TagTreeStates } from "../tags/tag-tree-states";
import { updateTagTreePrefs } from "../tags/tag-tree-state-store";
import { memo, useEffect, useRef, useState, createContext, useContext } from "react";

import { Icon, type IconName } from "../common/Icons";
import {
  togglePresetRanges,
  type RangeStrings,
} from "./filter-presets";
import {
  applyDimensionSelectionClick,
  formatGroupSelectionState,
} from "./dimension-filter-selection";
import {
  OTHER_FORMAT_EXTENSIONS,
  FORMAT_TEXT_TOKEN,
} from "./format-filter-presets";
import { DimensionEnableToggle } from "./dimension-enable-toggle";
import {
  buildActiveFilterChips,
  type ClearableFilterId,
  type DiscoveryFilterSnapshot,
} from "./active-discovery-filters";
import {
  parseColorFilterValues,
} from "../../shared/color-filter-presets";
import { SortModeControl, type SortFieldOption } from "../browse/SortModeControl";
import { useT } from "../i18n";
import type { SortDefinition } from "../../shared/asset-types";
import {
  attachCompositionLock,
  shouldHoldDismissForIme,
} from "../workbench/overlay/ime-safe-dismiss";
import { MoreFilterPanel } from "./panels/MoreFilterPanel";
import { FormatFilterPanel } from "./panels/FormatFilterPanel";
import { RatingFilterPanel } from "./panels/RatingFilterPanel";
import { TagPresetPanel } from "./panels/TagPresetPanel";

export type DimensionId =
  | "color"
  | "tags"
  | "shape"
  | "rating"
  | "format"
  | "more";

const HOVER_OPEN_DELAY_MS = 500;
const HOVER_CLOSE_DELAY_MS = 150;

export type DimensionFilterBarProps = {
  disabled?: boolean;
  /**
   * highest-layer modal is open — do not open hover popovers or
   * accept pointer interaction even if buttons are not `disabled`.
   */
  interactionsLocked?: boolean;
  snapshot: DiscoveryFilterSnapshot;
  shuffleActive?: boolean;
};

/** Operations DimensionFilterBar triggers; the parent provides them (P4). */
export interface DimensionFilterBarActions {
  setTagFilterExpression?: (value: string) => void;
  setTagFilter: (value: string) => void;
  onTagNamesChange: (names: string[]) => void;
  setSortField: (value: SortFieldOption) => void;
  setSortOrder: (value: SortDefinition["order"]) => void;
  onShuffle?: () => void;
  onClearFilter: (id: ClearableFilterId) => void;
}

const DimensionFilterBarActionsContext = createContext<DimensionFilterBarActions | null>(null);
export const DimensionFilterBarActionsProvider = DimensionFilterBarActionsContext.Provider;

function useDimensionFilterBarActions(): DimensionFilterBarActions {
  const actions = useContext(DimensionFilterBarActionsContext);
  if (!actions) throw new Error("DimensionFilterBar needs DimensionFilterBarActionsProvider.");
  return actions;
}

function DimensionButton({
  icon,
  label,
  active,
  open,
  excluding,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  open?: boolean;
  /** REQ-FILTER-024: exclude mode uses --filter-exclude (muted in dark). */
  excluding?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={open || undefined}
      aria-pressed={active === undefined ? undefined : active}
      data-hover-tip={label}
      className={`dimension-filter-btn${active ? " is-active" : ""}${open ? " is-open" : ""}${excluding ? " is-excluding" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size={18} />
      <span className="dimension-filter-btn-label">{label}</span>
    </button>
  );
}

// Memoized: the app shell re-renders often; this panel renders only when its
// props or consumed contexts change.
export const DimensionFilterBar = memo(function DimensionFilterBar(props: DimensionFilterBarProps) {
  const t = useT();
  const {
    disabled,
    interactionsLocked = false,
    snapshot,
    shuffleActive = false,
  } = props;
  const { setSortField, setSortOrder, onShuffle, onClearFilter } = useDimensionFilterBarActions();
  const [availabilityFilter, setAvailabilityFilter] = useQueryField("availabilityFilter");
  const [aspectRatioRange, setAspectRatioRange] = useQueryField("aspectRatioRange");
  const [aspectRatioRanges, setAspectRatioRanges] = useQueryField("aspectRatioRanges");
  const [colorFilter, setColorFilter] = useQueryField("colorFilter");
  const [colorFilterPrefs, onColorFilterPrefsChange] = useQueryField("colorFilterPrefs");
  const [colorSimilarity, setColorSimilarity] = useQueryField("colorSimilarity");
  const [durationRange, setDurationRange] = useQueryField("durationRange");
  const [excludeAvailabilityFilter, setExcludeAvailabilityFilter] = useQueryField("excludeAvailabilityFilter");
  const [excludeColorFilter, setExcludeColorFilter] = useQueryField("excludeColorFilter");
  const [excludeFormatFilter, setExcludeFormatFilter] = useQueryField("excludeFormatFilter");
  const [excludeRatingFilter, setExcludeRatingFilter] = useQueryField("excludeRatingFilter");
  const [includeAiRating, setIncludeAiRating] = useQueryField("includeAiRatingFilter");
  const [favoriteFilter, setFavoriteFilter] = useQueryField("favoriteFilter");
  const [formatFilter, setFormatFilter] = useQueryField("formatFilter");
  const [heightRange, setHeightRange] = useQueryField("heightRange");
  const [longEdgeRange, setLongEdgeRange] = useQueryField("longEdgeRange");
  const [ratingFilter, setRatingFilter] = useQueryField("ratingFilter");
  const [sourceUrlFilter, setSourceUrlFilter] = useQueryField("sourceUrlFilter");
  const [widthRange, setWidthRange] = useQueryField("widthRange");
  const [sortField] = useQueryField("sortField");
  const [sortOrder] = useQueryField("sortOrder");
  const [tags] = useNavigationField("tags");
  const [library] = useSessionField("library");
  const [tagTreePrefs] = useQueryField("tagTreePrefs");
  const libraryId = library?.libraryId ?? null;
  const tagTreeStates = liveTagTreeStates(tagTreeStatesFor(tagTreePrefs, libraryId), tags);
  const tagPresets = tagTreePresetsFor(tagTreePrefs, libraryId);

  const [openDimension, setOpenDimension] = useState<DimensionId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tagsDimRef = useRef<HTMLDivElement>(null);
  const ratingDimRef = useRef<HTMLDivElement>(null);
  const formatDimRef = useRef<HTMLDivElement>(null);
  const moreDimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openDimension) return;
    const composition = attachCompositionLock();
    const onMouseDown = (event: MouseEvent) => {
      if (composition.isActive()) return;
      const root = rootRef.current;
      if (!root || !(event.target instanceof Element)) return;
      // Portaled popovers live under document.body (MENU-015), so outside-click
      // must treat both the bar and `[data-dimension-filter-popover]` as inside.
      if (root.contains(event.target)) return;
      if (event.target.closest("[data-dimension-filter-popover]")) return;
      setOpenDimension(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldHoldDismissForIme({ composing: composition.isActive(), keyEvent: event })) {
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenDimension(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      composition.dispose();
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openDimension]);

  // REQ-FILTER-021: hovering (or keyboard-focusing) a dimension opens its
  // settings popover, independently of the click toggle below. Pointer hover
  // waits briefly before opening so moving across the toolbar does not create
  // a popover on every dimension. Listening at
  // the bar root and matching `[data-dimension]` ancestors (rather than
  // binding per-dimension React handlers that would read a ref during
  // render) keeps this entirely inside an effect, mirroring the existing
  // outside-click-close effect above and hover-tip.tsx's document-listener
  // pattern. A short close delay absorbs the gap between a button and its
  // popover (rendered a few pixels below it) so moving the pointer from one
  // into the other doesn't flicker-close. Portaled popovers sit under body
  // (MENU-015), so pointer/focus leave also treats
  // `[data-dimension-filter-popover]` as still inside the filter chrome.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled || interactionsLocked) {
      setOpenDimension(null);
      return;
    }

    const composition = attachCompositionLock();
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOpenTimer = () => {
      if (openTimer !== null) {
        clearTimeout(openTimer);
        openTimer = null;
      }
    };
    const clearCloseTimer = () => {
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const openForDimensionOf = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const dim = target.closest<HTMLElement>("[data-dimension]");
      const id = dim?.dataset.dimension as DimensionId | undefined;
      if (!id) return;
      clearOpenTimer();
      clearCloseTimer();
      setOpenDimension(id);
    };
    const scheduleOpenForDimensionOf = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const dim = target.closest<HTMLElement>("[data-dimension]");
      const id = dim?.dataset.dimension as DimensionId | undefined;
      if (!id) return;
      clearOpenTimer();
      clearCloseTimer();
      openTimer = setTimeout(() => {
        openTimer = null;
        setOpenDimension(id);
      }, HOVER_OPEN_DELAY_MS);
    };
    const isFilterChrome = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return (
        root.contains(target) ||
        target.closest("[data-dimension-filter-popover]") !== null
      );
    };
    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = setTimeout(() => setOpenDimension(null), HOVER_CLOSE_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-dimension-filter-popover]")) {
        clearOpenTimer();
        clearCloseTimer();
        return;
      }
      scheduleOpenForDimensionOf(event.target);
      clearCloseTimer();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (isFilterChrome(event.relatedTarget)) return;
      if (
        event.buttons !== 0 &&
        event.target instanceof Element &&
        event.target.closest("[data-color-add-draft]")
      ) {
        return;
      }
      // Leaving the filter chrome invalidates any delayed open, including
      // pointer transitions whose relatedTarget is outside the document.
      // Otherwise the close timer can run first and the stale open timer can
      // reopen the popover a moment later.
      clearOpenTimer();
      // IME candidate HWND is not in-document; relatedTarget is null.
      if (composition.isActive() || event.relatedTarget === null) return;
      scheduleClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isFilterChrome(event.target)) return;
      openForDimensionOf(event.target);
      clearCloseTimer();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isFilterChrome(event.target)) return;
      if (isFilterChrome(event.relatedTarget)) return;
      if (
        shouldHoldDismissForIme({
          composing: composition.isActive(),
          focusEvent: event,
        })
      ) {
        return;
      }
      scheduleClose();
    };

    // Document-level: portaled popovers are outside `root`, so root-only
    // pointerout never sees the leave-from-popover case.
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      composition.dispose();
      clearOpenTimer();
      clearCloseTimer();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [disabled, interactionsLocked]);

  // REQ-FILTER-021: one remembered-value toggle per dimension. Clicking a
  // dimension button clears its live filter value (remembering it) when
  // active, or restores the remembered value when inactive; see
  // dimension-enable-toggle.ts.
  const tagsToggleRef = useRef(new DimensionEnableToggle<TagTreeStates>());
  const ratingToggleRef = useRef(
    new DimensionEnableToggle<{ ratingFilter: string; exclude: boolean }>(),
  );
  const formatToggleRef = useRef(
    new DimensionEnableToggle<{ formatFilter: string; exclude: boolean }>(),
  );

  const chips = buildActiveFilterChips(snapshot, {
    textFormatLabel: t("filter.formatText"),
    unknownFormatLabel: t("filter.formatUnrecognized"),
  });
  const controlsDisabled = Boolean(disabled || interactionsLocked);
  const tagStateValues = Object.values(tagTreeStates);
  const selectedRatings = new Set(
    ratingFilter
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  // REQ-FILTER-025: default click covers the dimension's selection with just
  // the clicked value; Shift+click OR-accumulates it. See
  // dimension-filter-selection.ts for the shared resolver.
  const toggleRating = (star: number, shiftKey: boolean) => {
    const key = String(star);
    const next = applyDimensionSelectionClick([...selectedRatings], key, shiftKey);
    setRatingFilter(next.sort().join(", "));
  };

  const selectedColors = new Set(parseColorFilterValues(colorFilter));
  const tagActive = tagStateValues.length > 0;
  const colorActive = selectedColors.size > 0;
  const shapeActive =
    aspectRatioRanges.length > 0 ||
    aspectRatioRange.min !== "" ||
    aspectRatioRange.max !== "";
  const shapeSelectedRanges: RangeStrings[] =
    aspectRatioRanges.length > 0
      ? [...aspectRatioRanges]
      : aspectRatioRange.min || aspectRatioRange.max
        ? [{ min: aspectRatioRange.min, max: aspectRatioRange.max }]
        : [];
  const applyShapePreset = (range: RangeStrings, shiftKey: boolean) => {
    const next = togglePresetRanges(shapeSelectedRanges, range, shiftKey);
    setAspectRatioRanges(next);
    if (next.length === 1) {
      setAspectRatioRange((current) => ({
        ...current,
        min: next[0]!.min,
        max: next[0]!.max,
      }));
    } else {
      setAspectRatioRange((current) => ({
        ...current,
        min: "",
        max: "",
      }));
    }
  };
  const ratingActive = selectedRatings.size > 0;
  const favoriteActive = favoriteFilter === "yes";
  const formatActive = formatFilter.trim() !== "";
  const otherFormatTokens = [...OTHER_FORMAT_EXTENSIONS, FORMAT_TEXT_TOKEN];
  const otherGroupState = formatGroupSelectionState(
    formatFilter,
    otherFormatTokens,
  );
  const moreActive =
    colorActive || shapeActive ||
    sourceUrlFilter !== "any" ||
    availabilityFilter !== "any" ||
    longEdgeRange.min !== "" ||
    longEdgeRange.max !== "" ||
    widthRange.min !== "" ||
    widthRange.max !== "" ||
    heightRange.min !== "" ||
    heightRange.max !== "" ||
    durationRange.min !== "" ||
    durationRange.max !== "";

  // REQ-FILTER-021: click toggles a dimension's filter on/off, remembering
  // the cleared value so a second click restores it (hover, wired via the
  // pointer/focus effect above, opens the settings popover instead).
  const handleTagsDimensionClick = () => {
    if (!libraryId) return;
    tagsToggleRef.current.toggle(tagActive, tagTreeStates, {}, (value) =>
      updateTagTreePrefs((prefs) => withTagTreeStates(prefs, libraryId, value)));
  };

  const handleRatingDimensionClick = () => {
    ratingToggleRef.current.toggle(
      ratingActive,
      { ratingFilter, exclude: excludeRatingFilter },
      { ratingFilter: "", exclude: false },
      (value) => {
        setRatingFilter(value.ratingFilter);
        setExcludeRatingFilter(value.exclude);
      },
    );
  };

  const handleFormatDimensionClick = () => {
    formatToggleRef.current.toggle(
      formatActive,
      { formatFilter, exclude: excludeFormatFilter },
      { formatFilter: "", exclude: false },
      (value) => {
        setFormatFilter(value.formatFilter);
        setExcludeFormatFilter(value.exclude);
      },
    );
  };

  const handleMoreDimensionClick = () => {
    setOpenDimension("more");
  };

  return (
    <div className="dimension-filter-bar" ref={rootRef}>
      <div className="dimension-filter-dims" role="toolbar" aria-label={t("filter.dimensions")}>
        <div className="dimension-filter-dim" data-dimension="tags" ref={tagsDimRef}>
          <DimensionButton
            active={tagActive}
            disabled={controlsDisabled}
            excluding={tagActive && !tagStateValues.includes("include")}
            icon="tag"
            label={t("filter.tagPresets")}
            onClick={handleTagsDimensionClick}
            open={openDimension === "tags"}
          />
          <TagPresetPanel
            openDimension={openDimension}
            anchorRef={tagsDimRef}
            libraryId={libraryId}
            states={tagTreeStates}
            presets={tagPresets}
            controlsDisabled={controlsDisabled}
            t={t}
          />
        </div>

        <div className="dimension-filter-dim" data-dimension="rating" ref={ratingDimRef}>
          <DimensionButton
            active={ratingActive}
            disabled={controlsDisabled}
            excluding={excludeRatingFilter && ratingActive}
            icon="star"
            label={t("filter.dimRating")}
            onClick={handleRatingDimensionClick}
            open={openDimension === "rating"}
          />
          <RatingFilterPanel
            openDimension={openDimension}
            ratingDimRef={ratingDimRef}
            selectedRatings={selectedRatings}
            controlsDisabled={controlsDisabled}
            toggleRating={toggleRating}
            t={t}
            excludeRatingFilter={excludeRatingFilter}
            disabled={disabled}
            setExcludeRatingFilter={setExcludeRatingFilter}
            includeAiRating={includeAiRating}
            setIncludeAiRating={setIncludeAiRating}
          />
        </div>

        <div className="dimension-filter-dim">
          <DimensionButton
            active={favoriteActive}
            disabled={controlsDisabled}
            icon="heart"
            label={t("filter.favoriteOnly")}
            onClick={() => setFavoriteFilter(favoriteActive ? "any" : "yes")}
          />
        </div>

        <div className="dimension-filter-dim" data-dimension="format" ref={formatDimRef}>
          <DimensionButton
            active={formatActive}
            disabled={controlsDisabled}
            excluding={excludeFormatFilter && formatActive}
            icon="file"
            label={t("filter.dimFormat")}
            onClick={handleFormatDimensionClick}
            open={openDimension === "format"}
          />
          <FormatFilterPanel
            openDimension={openDimension}
            formatDimRef={formatDimRef}
            t={t}
            controlsDisabled={controlsDisabled}
            setFormatFilter={setFormatFilter}
            formatFilter={formatFilter}
            otherGroupState={otherGroupState}
            otherFormatTokens={otherFormatTokens}
            excludeFormatFilter={excludeFormatFilter}
            disabled={disabled}
            setExcludeFormatFilter={setExcludeFormatFilter}
          />
        </div>

        <div className="dimension-filter-dim" data-dimension="more" ref={moreDimRef}>
          <DimensionButton
            active={moreActive}
            disabled={controlsDisabled}
            icon="menu"
            label={t("filter.dimMore")}
            onClick={handleMoreDimensionClick}
            open={openDimension === "more"}
          />
          <MoreFilterPanel
            openDimension={openDimension}
            moreDimRef={moreDimRef}
            t={t}
            colorFilter={colorFilter}
            colorFilterPrefs={colorFilterPrefs}
            colorSimilarity={colorSimilarity}
            controlsDisabled={controlsDisabled}
            excludeColorFilter={excludeColorFilter}
            onColorFilterPrefsChange={onColorFilterPrefsChange}
            setColorFilter={setColorFilter}
            setColorSimilarity={setColorSimilarity}
            setExcludeColorFilter={setExcludeColorFilter}
            applyShapePreset={applyShapePreset}
            shapeSelectedRanges={shapeSelectedRanges}
            aspectRatioRange={aspectRatioRange}
            setAspectRatioRange={setAspectRatioRange}
            setAspectRatioRanges={setAspectRatioRanges}
            setSourceUrlFilter={setSourceUrlFilter}
            sourceUrlFilter={sourceUrlFilter}
            setAvailabilityFilter={setAvailabilityFilter}
            availabilityFilter={availabilityFilter}
            excludeAvailabilityFilter={excludeAvailabilityFilter}
            disabled={disabled}
            setExcludeAvailabilityFilter={setExcludeAvailabilityFilter}
            longEdgeRange={longEdgeRange}
            setLongEdgeRange={setLongEdgeRange}
            widthRange={widthRange}
            setWidthRange={setWidthRange}
            heightRange={heightRange}
            setHeightRange={setHeightRange}
            durationRange={durationRange}
            setDurationRange={setDurationRange}
          />
        </div>

        <SortModeControl
          disabled={controlsDisabled}
          onShuffle={onShuffle}
          setSortField={setSortField}
          setSortOrder={setSortOrder}
          shuffleActive={shuffleActive}
          sortField={sortField}
          sortOrder={sortOrder}
        />
      </div>

      {chips.length > 0 && (
        <div className="dimension-filter-chips" aria-label={t("filter.activeFilters")}>
          {chips.map((chip) => {
            const label = labelForActiveChip(chip.id, t);
            return (
              <button
                className="dimension-active-chip"
                key={chip.id}
                onClick={() => onClearFilter(chip.id as ClearableFilterId)}
                type="button"
                data-hover-tip={t("filter.clearChip")}
              >
                <span>
                  {label}
                  {chip.detail ? ` · ${chip.detail}` : ""}
                </span>
                <Icon name="close" size={10} />
              </button>
            );
          })}
          <button
            className="dimension-active-chip is-clear-all"
            onClick={() => onClearFilter("all")}
            type="button"
          >
            {t("filter.clearAll")}
          </button>
        </div>
      )}
    </div>
  );
});

function labelForActiveChip(id: string, t: ReturnType<typeof useT>): string {
  switch (id) {
    case "color":
      return t("filter.dimColor");
    case "format":
      return t("filter.formatField");
    case "tag":
    case "tag-expression":
      return t("filter.tagField");
    case "rating":
      return t("filter.ratingField");
    case "favorite":
      return t("filter.favoriteField");
    case "source_url":
      return t("filter.sourceUrlField");
    case "availability":
      return t("filter.availabilityField");
    case "aspect_ratio":
      return t("filter.aspectRatio");
    case "long_edge":
      return t("filter.longEdgePx");
    case "width":
      return t("filter.widthPx");
    case "height":
      return t("filter.heightPx");
    case "duration":
      return t("filter.durationSec");
    default:
      return id;
  }
}
