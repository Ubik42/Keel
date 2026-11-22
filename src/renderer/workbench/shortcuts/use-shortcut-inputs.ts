import { useEffect, useInsertionEffect, useRef } from "react";

import type { ShortcutEventLike } from "../../../shared/shortcut-resolution";
import { listenForShortcutInputs, type ShortcutDomEvent } from "./shortcut-runtime";

/**
 * Hook form of listenForShortcutInputs: the handler always sees the latest
 * props and state, and the registration only changes when the target, phase
 * or `enabled` change, so it keeps its place in the dispatch order.
 */
export function useShortcutInputs(
  handler: (input: ShortcutEventLike, event: ShortcutDomEvent) => void,
  options: { target?: Window | Document; capture?: boolean; enabled?: boolean } = {},
): void {
  const { target, capture = false, enabled = true } = options;
  const latest = useRef(handler);
  useInsertionEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    return listenForShortcutInputs(target ?? document, (input, event) => latest.current(input, event), capture);
  }, [capture, enabled, target]);
}
