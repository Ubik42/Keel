import { automationScriptAssetSearchInputSchema } from '../../shared/automation-script-api';
import { parseSearchExpressionDetailed } from '../../shared/search-expression';

/**
 * Scripts and Standard Host guests pass toolbar-style `{ query: string|null }`.
 * The Automation Gateway expects the same structured SearchQuery AST as Worker.
 * Returns undefined when the payload is neither script-shaped nor already valid
 * enough to forward (caller maps that to an invalid-search failure).
 */
export function normalizeAutomationAssetSearchInput(rawInput: unknown): unknown | undefined {
  const search = automationScriptAssetSearchInputSchema.safeParse(rawInput);
  if (!search.success) return undefined;
  const { definition, scope, query: text, ...page } = search.data;
  const scopePart = scope ? { scope: { kind: 'folder' as const, folderId: scope.folderId, recursive: scope.recursive } } : {};
  if (definition) {
    // A structured query; a text query, when also given, is not combined with it.
    return {
      ...page,
      query: definition.search ?? null,
      ...(definition.filters ? { filters: definition.filters } : {}),
      ...(definition.sort ? { sort: definition.sort } : {}),
      ...scopePart,
    };
  }
  if (text === null || text === undefined) return { ...page, query: null, ...scopePart };
  const parsed = parseSearchExpressionDetailed(text);
  if (!parsed.ok) return undefined;
  return {
    ...page,
    query: { clauses: [], expression: parsed.expression },
    ...scopePart,
  };
}
