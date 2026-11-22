import { createFieldStore } from './create-field-store';
import { type SortDefinition } from '../../shared/asset-types';
import { loadBrowseSortPreferences } from '../browse-sort-preferences';
import { loadColorFilterPreferences } from '../color-filter-preferences';
import { readShowMissingLinkedFiles } from '../linked-missing-preference';

export interface QueryState {
  searchValue: string;
  storedSearchHistory: {
    libraryId: string;
    queries: string[];
  } | null;
  searchHistoryActiveIndex: number;
  formatFilter: string;
  excludeFormatFilter: boolean;
  colorFilter: string;
  colorSimilarity: ReturnType<typeof loadColorFilterPreferences>["similarity"];
  colorFilterPrefs: ReturnType<typeof loadColorFilterPreferences>;
  excludeColorFilter: boolean;
  tagFilter: string;
  tagFilterExpression: string;
  tagFilterMode: "selection" | "expression";
  tagFilterLastValidExpression: string;
  excludeTagFilter: boolean;
  excludedTagFilter: string;
  includeAiTagFilter: boolean;
  tagFilterMatch: "any" | "all";
  ratingFilter: string;
  excludeRatingFilter: boolean;
  includeAiRatingFilter: boolean;
  favoriteFilter: "any" | "yes" | "no";
  sourceUrlFilter: "any" | "yes" | "no";
  availabilityFilter: "any" | "available" | "missing";
  excludeAvailabilityFilter: boolean;
  widthRange: { min: string; max: string; exclude: boolean };
  heightRange: { min: string; max: string; exclude: boolean };
  aspectRatioRange: { min: string; max: string; exclude: boolean };
  aspectRatioRanges: Array<{ min: string; max: string }>;
  longEdgeRange: { min: string; max: string; exclude: boolean };
  durationRange: { min: string; max: string; exclude: boolean };
  sortField: SortDefinition["field"];
  sortOrder: SortDefinition["order"];
  shuffleSeed: number | null;
  showIgnoredItems: boolean;
  showMissingLinkedFiles: boolean;
  // @fields
}

export const queryFields = createFieldStore<QueryState>(() => ({
    searchValue: "",
    storedSearchHistory: null,
    searchHistoryActiveIndex: -1,
    formatFilter: "text",
    excludeFormatFilter: true,
    colorFilter: "",
    colorSimilarity: loadColorFilterPreferences().similarity,
    colorFilterPrefs: loadColorFilterPreferences(),
    excludeColorFilter: false,
    tagFilter: "",
    tagFilterExpression: "",
    tagFilterMode: "expression",
    tagFilterLastValidExpression: "",
    excludeTagFilter: false,
    excludedTagFilter: "",
    includeAiTagFilter: true,
    tagFilterMatch: "any",
    ratingFilter: "",
    excludeRatingFilter: false,
    includeAiRatingFilter: true,
    favoriteFilter: "any",
    sourceUrlFilter: "any",
    availabilityFilter: "any",
    excludeAvailabilityFilter: false,
    widthRange: {
    min: "",
    max: "",
    exclude: false,
  },
    heightRange: {
    min: "",
    max: "",
    exclude: false,
  },
    aspectRatioRange: {
    min: "",
    max: "",
    exclude: false,
  },
    aspectRatioRanges: [],
    longEdgeRange: {
    min: "",
    max: "",
    exclude: false,
  },
    durationRange: {
    min: "",
    max: "",
    exclude: false,
  },
    sortField: loadBrowseSortPreferences().field,
    sortOrder: loadBrowseSortPreferences().order,
    shuffleSeed: null,
    showIgnoredItems: false,
    showMissingLinkedFiles: readShowMissingLinkedFiles(globalThis.localStorage),
    // @initial
}));

export const useQueryField = queryFields.useField;
