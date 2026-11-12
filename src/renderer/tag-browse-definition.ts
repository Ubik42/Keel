import type { FilterClause, SearchQuery, SortDefinition } from '../shared/asset-types';

/** A tag navigation replaces discovery filters and keeps the user's sort. */
export function tagBrowseDefinition(name: string, current: {
  search?: SearchQuery; filters?: FilterClause[]; sort?: SortDefinition;
}, includeDescendants = false): { filters: FilterClause[]; sort?: SortDefinition } {
  return {
    filters: [{ field: 'tag', values: [name], exclude: false, includeAi: true, ...(includeDescendants ? { includeDescendants: true } : {}) }],
    sort: current.sort,
  };
}
