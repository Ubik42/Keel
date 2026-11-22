// ---------------------------------------------------------------------------
// Renderer-visible shortcut runtime.
//
// Pure matcher helpers (asset/folder/collection keyboard hooks) cannot consume
// React context. The ShortcutProvider keeps this small mirror in sync; tests
// can reset it through setShortcutRuntime.
// ---------------------------------------------------------------------------

import {
  findShortcutAction,
  type ShortcutPlatform,
} from "../../../shared/shortcut-catalog";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBindings,
} from "../../../shared/shortcut-bindings";
import {
  formatActionShortcut,
  matchesActionShortcut,
  type ShortcutMouseEventLike,
  type ShortcutEventLike,
} from "../../../shared/shortcut-resolution";
import type { ShortcutEvent } from "../menu/command-types";

let runtimePlatform: ShortcutPlatform = "windows";
let runtimeBindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS;
let runtimeVersion = 0;

export type ShortcutDomEvent = KeyboardEvent | MouseEvent;

/**
 * Adapt an actual MouseEvent to the shared matcher without manufacturing a
 * KeyboardEvent or borrowing keyboard key semantics.
 */
export function shortcutInputFromMouseEvent(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): ShortcutMouseEventLike | null {
  if (event.button !== 3 && event.button !== 4) return null;
  return {
    kind: "mouse",
    button: event.button,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

type ShortcutInputHandler = (input: ShortcutEventLike, event: ShortcutDomEvent) => void;

/**
 * One keydown and one mousedown listener per target and phase serve every
 * shortcut handler (unified dispatch, P4). Handlers run in registration
 * order, exactly as separate listeners would; stopImmediatePropagation in a
 * handler skips the handlers after it, as it would skip later listeners.
 */
const dispatchers = new Map<Window | Document, Map<boolean, ShortcutInputHandler[]>>();

function keyboardInput(event: KeyboardEvent): ShortcutEventLike {
  // Native keyboard fields are prototype getters. Copy them explicitly so
  // consumers can spread the input to attach a target without losing keys.
  const input = {
    kind: "keyboard" as const,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    location: event.location,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
  };
  return input;
}

function dispatch(handlers: readonly ShortcutInputHandler[], input: ShortcutEventLike, event: ShortcutDomEvent): void {
  let stopped = false;
  const original = event.stopImmediatePropagation;
  event.stopImmediatePropagation = function stopImmediatePropagation(this: Event) {
    stopped = true;
    original.call(this);
  };
  try {
    for (const handler of [...handlers]) {
      handler(input, event);
      if (stopped) break;
    }
  } finally {
    event.stopImmediatePropagation = original;
  }
}

/** Register the keyboard and side-button event kinds used by the shortcut catalog. */
export function listenForShortcutInputs(
  target: Window | Document,
  handler: ShortcutInputHandler,
  capture = false,
): () => void {
  let phases = dispatchers.get(target);
  if (!phases) {
    phases = new Map();
    dispatchers.set(target, phases);
  }
  let handlers = phases.get(capture);
  if (!handlers) {
    const list: ShortcutInputHandler[] = [];
    handlers = list;
    phases.set(capture, list);
    const onKeyDown: EventListener = (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      dispatch(list, keyboardInput(event), event);
    };
    const onMouseDown: EventListener = (rawEvent) => {
      const event = rawEvent as MouseEvent;
      const input = shortcutInputFromMouseEvent(event);
      if (input !== null) dispatch(list, input, event);
    };
    target.addEventListener("keydown", onKeyDown, capture);
    target.addEventListener("mousedown", onMouseDown, capture);
    listenerCleanups.set(list, () => {
      target.removeEventListener("keydown", onKeyDown, capture);
      target.removeEventListener("mousedown", onMouseDown, capture);
    });
  }
  const list = handlers;
  list.push(handler);
  return () => {
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) {
      listenerCleanups.get(list)?.();
      listenerCleanups.delete(list);
      phases!.delete(capture);
    }
  };
}

const listenerCleanups = new WeakMap<ShortcutInputHandler[], () => void>();

/** Register only mouse side buttons when a native accelerator owns keyboard input. */
export function listenForMouseShortcutInputs(
  target: Window | Document,
  handler: (input: ShortcutMouseEventLike, event: MouseEvent) => void,
  capture = false,
): () => void {
  const onMouseDown: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    const input = shortcutInputFromMouseEvent(event);
    if (input !== null) handler(input, event);
  };
  target.addEventListener("mousedown", onMouseDown, capture);
  return () => target.removeEventListener("mousedown", onMouseDown, capture);
}

/** Bridge keyboard-only legacy command chords into their older event shape. */
export function asLegacyKeyboardShortcutEvent(
  input: ShortcutEventLike,
): ShortcutEvent | null {
  if (input.kind === "mouse") return null;
  return {
    key: input.key,
    code: input.code,
    keyCode: input.keyCode,
    metaKey: input.metaKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    altKey: input.altKey ?? false,
    shiftKey: input.shiftKey ?? false,
  };
}

export function setShortcutRuntime(
  platform: ShortcutPlatform,
  bindings: ShortcutBindings,
): void {
  runtimePlatform = platform;
  runtimeBindings = bindings;
  runtimeVersion += 1;
}

export function getShortcutRuntimePlatform(): ShortcutPlatform {
  return runtimePlatform;
}

export function getShortcutRuntimeBindings(): ShortcutBindings {
  return runtimeBindings;
}

export function getShortcutRuntimeVersion(): number {
  return runtimeVersion;
}

/** Returns null when the action is not part of the custom catalog. */
export function matchesRuntimeShortcut(
  actionId: string,
  event: ShortcutEventLike,
  platform: ShortcutPlatform = runtimePlatform,
): boolean | null {
  if (!findShortcutAction(actionId)) return null;
  return matchesActionShortcut(actionId, event, platform, runtimeBindings);
}

/** Returns null when the action is not part of the custom catalog. */
export function formatRuntimeShortcut(
  actionId: string,
  platform: ShortcutPlatform = runtimePlatform,
): string | null {
  if (!findShortcutAction(actionId)) return null;
  return formatActionShortcut(actionId, platform, runtimeBindings);
}
