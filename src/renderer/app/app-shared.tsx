import { navigationFields } from "../stores/navigation-store";
import { isMacPlatform, type CommandPlatform } from "../workbench/menu/command-types";
import { usesWindowsStyleShell } from "../renderer-platform";
import { type KeelLibraryApi } from "../../shared/library-api";
import { type KeelShellApi } from "../../shared/external-url";
import { type KeelAutomationScriptApi } from "../../shared/automation-script-api";
import { type KeelPluginManagerApi } from "../../shared/plugin-manager-api";
import { type KeelMcpSettingsApi } from "../../shared/mcp";
import { type ReactNode, useEffect, useState } from "react";
import { type WorkspaceNavigationHistoryMode, type WorkspaceNavigationToken } from "../workbench/workspace/workspace-navigation-coordinator";
import { type WorkspaceTabBrowseState } from "../workspace-tabs";
import { splitSearchHighlights } from "../search-expression";
import { splitFilenameForDisplay } from "../filename-display";
import { type AiSearchPlan, type FilterClause, type SearchQuery, type SortDefinition } from "../../shared/asset-types";
import { Icon, type IconName } from "../Icons";
import { iconActionAttrs } from "../icon-action-attrs";
import { type AppLocale } from "../i18n";
import { formatShortDate } from "../format-file-meta";

export const IS_MAC_PLATFORM = isMacPlatform(navigator.userAgent);
// Windows-style shell: Windows and Linux (see usesWindowsStyleShell).
export const IS_WINDOWS_PLATFORM = usesWindowsStyleShell(navigator.userAgent);

export const SHORTCUT_PLATFORM: CommandPlatform = IS_MAC_PLATFORM ? "mac" : "windows";
/**
 * Minimum spacing between full browse reloads triggered by a remote library's
 * change sequence.
 *
 * Serpent-yti0 established that `revision_artifacts` / `jobs` writes bump the
 * shared change sequence, and that a full `searchAssets` per bump freezes the
 * canvas. Non-network libraries were fixed by ignoring those bumps; network
 * libraries still re-read, because another computer's asset changes genuinely
 * only arrive that way. This interval is that cross-instance visibility delay.
 */
export const NETWORK_LIBRARY_RELOAD_INTERVAL_MS = 750;

export type RendererWindow = Window & {
  keel?: {
    library?: KeelLibraryApi;
    shell?: KeelShellApi;
    automation?: KeelAutomationScriptApi;
    plugins?: KeelPluginManagerApi;
    mcp?: KeelMcpSettingsApi;
    e2e?: {
      useNativeAssetDrag?: boolean;
      getRequestCount: (type: string) => number;
    };
  };
};

export const LIBRARY_LOADING_DISPLAY_DELAY_MS = 3_000;

export function useDelayedVisibility(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      // Clear the previous activation so a later slow open gets its own
      // three-second grace period instead of reusing stale visibility.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset is the falling-edge cleanup for this timer state
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

export type QueryNumericRangeState = {
  min: string;
  max: string;
  exclude: boolean;
};
export type QueryFilterSnapshot = {
  pinnedTagId?: string | null;
  formatFilter: string;
  excludeFormatFilter: boolean;
  tagFilter: string;
  tagFilterExpression?: string;
  tagFilterMode?: "selection" | "expression";
  tagFilterLastValidExpression?: string;
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
  widthRange: QueryNumericRangeState;
  heightRange: QueryNumericRangeState;
  aspectRatioRange: QueryNumericRangeState;
  aspectRatioRanges: Array<{ min: string; max: string }>;
  longEdgeRange: QueryNumericRangeState;
  durationRange: QueryNumericRangeState;
};
// REQ-FOLDER-007 removed the "folder" kind: folder create/rename now happens
// inline in the directory tree (use-inline-folder-edit), not in a dialog.
export type WorkspaceNavigationRequest = Readonly<{
  token?: WorkspaceNavigationToken;
  historyMode: WorkspaceNavigationHistoryMode;
  isCurrent: () => boolean;
  deferReveal?: boolean;
  browseState?: WorkspaceTabBrowseState;
  browseStateTabId?: string;
}>;
export function renderFilenameHighlights(value: string, searchValue: string, keyPrefix: string): ReactNode {
  const segments = splitSearchHighlights(value, searchValue, "filename");
  // Keep the ordinary, non-search path as a text node. Wrapping every
  // segment in an inline span prevents text-overflow from producing the
  // intended middle ellipsis inside the flex prefix.
  if (segments.length === 1 && !segments[0]!.matched) {
    return segments[0]!.text;
  }
  return segments.map((segment, index) =>
    segment.matched ? (
      <mark className="search-text-highlight" key={`${keyPrefix}-match-${index}`}>
        {segment.text}
      </mark>
    ) : (
      <span key={`${keyPrefix}-text-${index}`}>{segment.text}</span>
    ),
  );
}

export function renderMiddleEllipsisFilename(name: string, searchValue: string): ReactNode {
  const parts = splitFilenameForDisplay(name);
  return (
    <>
      <span className="asset-filename-prefix">
        {renderFilenameHighlights(parts.prefix, searchValue, "filename-prefix")}
      </span>
      {parts.tail ? (
        <span className="asset-filename-tail">
          {renderFilenameHighlights(parts.tail, searchValue, "filename-tail")}
        </span>
      ) : null}
      {parts.extension ? (
        <span className="asset-filename-extension">
          {renderFilenameHighlights(parts.extension, searchValue, "filename-extension")}
        </span>
      ) : null}
    </>
  );
}

export type SearchDefinition = {
  search?: SearchQuery;
  filters?: FilterClause[];
  sort?: SortDefinition;
};

export function ToolButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  icon: IconName;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-pressed={pressed}
      className="tool-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...iconActionAttrs(label)}
    >
      <Icon name={icon} />
    </button>
  );
}

export function aiSearchPlanToDefinition(plan: AiSearchPlan): SearchDefinition {
  const positiveTerms = [...new Set([...plan.keywords, ...plan.synonyms])];
  const clauses: SearchQuery["clauses"] = [];
  if (positiveTerms.length > 0)
    clauses.push({ field: null, values: positiveTerms, exclude: false });
  // LibraryService executes exclude-only clauses through a parameterized
  // NOT-IN subquery, so a model exclusion is never silently discarded.
  if (plan.exclusions.length > 0) {
    clauses.push({
      field: null,
      values: [...new Set(plan.exclusions)],
      exclude: true,
    });
  }
  return {
    ...(clauses.length > 0 ? { search: { clauses } } : {}),
    ...(plan.filters.length > 0 ? { filters: plan.filters } : {}),
    ...(plan.sort ? { sort: plan.sort } : {}),
  };
}
export function formatDate(value: string, locale: AppLocale, unknownLabel: string) {
  return formatShortDate(value, locale, unknownLabel);
}
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseNumericRange(
  minInput: string,
  maxInput: string,
  scale = 1,
  integer = true,
): { min?: number; max?: number } | null {
  const minValue =
    minInput.trim() === "" ? undefined : Number(minInput) * scale;
  const maxValue =
    maxInput.trim() === "" ? undefined : Number(maxInput) * scale;
  if (minValue === undefined && maxValue === undefined) return null;
  if (
    (minValue !== undefined && (!Number.isFinite(minValue) || minValue < 0)) ||
    (maxValue !== undefined && (!Number.isFinite(maxValue) || maxValue < 0)) ||
    (minValue !== undefined && maxValue !== undefined && minValue > maxValue)
  ) {
    return null;
  }
  return {
    ...(minValue !== undefined
      ? { min: integer ? Math.round(minValue) : minValue }
      : {}),
    ...(maxValue !== undefined
      ? { max: integer ? Math.round(maxValue) : maxValue }
      : {}),
  };
}
export function highlightSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?b>)/i);
  let highlighted = false;
  return segments.map((segment, index) => {
    if (/^<b>$/i.test(segment)) {
      highlighted = true;
      return null;
    }
    if (/^<\/b>$/i.test(segment)) {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark key={index}>{segment}</mark>
    ) : (
      <span key={index}>{segment}</span>
    );
  });
}

// A view of the navigation store; stable across renders.
export const folderRecursiveRef = navigationFields.ref("folderRecursive");

/**
 * Pass a function that AppInner declares further down (P4 hook extraction).
 * Function declarations were hoisted before; after extraction they become
 * hook results, so callers get a forwarder that resolves the function on call.
 */
export function late<F extends (...args: never[]) => unknown>(get: () => F): F {
  return ((...args: Parameters<F>) => get()(...args)) as F;
}
