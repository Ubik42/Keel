import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { Icon, type IconName } from "../../Icons";
import { isImeKeyboardEvent } from "../overlay/ime-safe-dismiss";

/**
 * Shared parts of the sidebar trees (folders, tags). Trees render a flat list
 * of rows with a depth, so these are composable pieces rather than one
 * component that owns the data: a tree container with optional arrow-key
 * navigation, the disclosure button and the expand/collapse keys of a row.
 */

/** Container with tree semantics; ArrowUp/ArrowDown/Home/End move focus between rows. */
export function TreeList({
  label,
  className,
  keyboardNavigation = true,
  children,
}: {
  label: string;
  className?: string;
  keyboardNavigation?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      aria-label={label}
      className={className}
      onKeyDown={keyboardNavigation ? moveTreeFocus : undefined}
      role="tree"
    >
      {children}
    </div>
  );
}

function moveTreeFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (isImeKeyboardEvent(event)) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  if (items.length === 0) return;
  const index = items.indexOf(event.target as HTMLElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  items[next]?.focus();
}

/** Expand/collapse button of a row with children. */
export function TreeDisclosure({
  expanded,
  label,
  onToggle,
  className,
  expandedClassName = "is-expanded",
  icon = "chevron-right",
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
  className: string;
  expandedClassName?: string;
  icon?: IconName;
}): ReactNode {
  return (
    <button
      aria-expanded={expanded}
      aria-label={label}
      className={`${className}${expanded ? ` ${expandedClassName}` : ""}`}
      onClick={(event: MouseEvent) => {
        // The row behind the button has its own click (open the folder or tag).
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

/** ArrowRight expands and ArrowLeft collapses a row; returns true when it handled the key. */
export function handleTreeItemKey(
  event: KeyboardEvent,
  row: { hasChildren: boolean; expanded: boolean; onToggle: () => void },
): boolean {
  if (!row.hasChildren) return false;
  if ((event.key === "ArrowRight" && !row.expanded) || (event.key === "ArrowLeft" && row.expanded)) {
    event.preventDefault();
    row.onToggle();
    return true;
  }
  return false;
}
