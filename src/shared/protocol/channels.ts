export const LIBRARY_REQUEST_CHANNEL = 'keel:library:request' as const;
/** Renderer → Main: start an OS file drag during dragstart. */
export const ASSET_NATIVE_DRAG_CHANNEL = 'keel:asset:native-drag' as const;
/** Renderer → Main: warm drag paths before dragstart, without waiting. */
export const ASSET_NATIVE_DRAG_PRIME_CHANNEL = 'keel:asset:native-drag-prime' as const;
/** Main → Renderer: ids whose validated OS drag paths are cached in Main. */
export const ASSET_NATIVE_DRAG_READINESS_CHANNEL = 'keel:asset:native-drag-readiness' as const;
export const LIBRARY_LIFECYCLE_CHANNEL = 'keel:library:lifecycle' as const;
export const ASSET_CHANGE_CHANNEL = 'keel:asset:changed' as const;
export const LIBRARY_CHANGED_CHANNEL = 'keel:library:changed' as const;
export const THUMBNAIL_CHANNEL = 'keel:thumbnail' as const;
export const PROGRESS_CHANNEL = 'keel:progress' as const;
export const AI_PROGRESS_CHANNEL = 'keel:ai:progress' as const;
export const AI_COMPLETED_CHANNEL = 'keel:ai:completed' as const;
export const AI_CLEARED_CHANNEL = 'keel:ai:cleared' as const;

export const EXTENSION_SAVE_COMPLETED_CHANNEL =
  'keel:extension:save-completed' as const;
export const ACTIVE_CONTEXT_CHANNEL = 'keel:active-context' as const;
/** Renderer → Main: effective UI locale for native dialogs (Serpent-bwb). */
export const APP_LOCALE_CHANNEL = 'keel:app-locale' as const;
export const OPEN_EXTERNAL_URL_CHANNEL = 'keel:shell:open-external-url' as const;
/** Renderer → Main: read launch-at-login preferences. */
export const SHORTCUT_BINDINGS_GET_CHANNEL = 'keel:shortcuts:get' as const;
export const SHORTCUT_BINDINGS_SET_CHANNEL = 'keel:shortcuts:set' as const;
export const SHORTCUT_BINDINGS_EXPORT_CHANNEL = 'keel:shortcuts:export' as const;
export const SHORTCUT_BINDINGS_IMPORT_CHANNEL = 'keel:shortcuts:import' as const;

export const STARTUP_PREFERENCES_GET_CHANNEL = 'keel:startup-preferences:get' as const;
/** Renderer → Main: persist launch-at-login preferences. */
export const STARTUP_PREFERENCES_SET_CHANNEL = 'keel:startup-preferences:set' as const;
/** PF: open-with settings (programs and per-extension defaults). */
export const OPEN_WITH_SETTINGS_GET_CHANNEL = 'keel:open-with:get' as const;
export const OPEN_WITH_SETTINGS_SET_CHANNEL = 'keel:open-with:set' as const;
/** PF: native picker for a program to register; returns its name and path. */
export const OPEN_WITH_CHOOSE_PROGRAM_CHANNEL = 'keel:open-with:choose-program' as const;
/** Main → Renderer: script/MCP/plugin user-visible toast or blocking dialog. */
export const SHELL_NOTIFY_CHANNEL = 'keel:shell:notify' as const;
/**
 * Main → Renderer: an automation (MCP) command finished executing with a
 * structured result (Serpent-fmbr); the renderer shows the same toast as the
 * equivalent manual operation. Read-only and failed commands are not emitted.
 */
export const COMMAND_COMPLETED_CHANNEL = 'keel:command:completed' as const;
export const REVEAL_APP_LOG_CHANNEL = 'keel:shell:reveal-app-log' as const;
export const READ_APP_LOG_CHANNEL = 'keel:shell:read-app-log' as const;
export const SHOW_EDIT_CONTEXT_MENU_CHANNEL =
  'keel:shell:show-edit-context-menu' as const;
export const SHELL_SWIPE_CHANNEL = 'keel:shell:swipe' as const;
export const WINDOW_CONTROL_CHANNEL = 'keel:shell:window-control' as const;
/** Renderer → Main: begin frameless edge resize (Linux). */
export const WINDOW_EDGE_RESIZE_CHANNEL = 'keel:shell:window-edge-resize' as const;
/** Renderer → Main: setBounds fallback while dragging a resize edge. */
export const WINDOW_SET_BOUNDS_CHANNEL = 'keel:shell:window-set-bounds' as const;
/** Renderer → Main: read current window bounds (Linux edge-resize fallback). */
export const WINDOW_GET_BOUNDS_CHANNEL = 'keel:shell:window-get-bounds' as const;
/** Main → Renderer: trigger invert selection (macOS Edit menu, Serpent-te8p). */
export const INVERT_SELECTION_CHANNEL = 'keel:shell:invert-selection' as const;
/** Main → Renderer: Edit Copy (⌘C) — file copy when assets selected (Serpent-166q). */
export const COPY_SELECTION_CHANNEL = 'keel:shell:copy-selection' as const;
/** Main → Renderer: dispatch a native menu command through the app menu model. */
export const APPLICATION_MENU_COMMAND_CHANNEL =
  'keel:shell:application-menu-command' as const;
/** Renderer → Main: sync a native menu item's enabled state (Serpent-q0b1). */
export const APPLICATION_MENU_ITEM_STATE_CHANNEL =
  'keel:shell:application-menu-item-state' as const;
/** Renderer → Main: whether linked-folder browse includes missing source files. */
export const LINKED_MISSING_VISIBILITY_CHANNEL =
  'keel:shell:linked-missing-visibility' as const;
/** Renderer → Main: fall back to Chromium text copy when no asset file copy. */
export const NATIVE_EDIT_COPY_CHANNEL = 'keel:shell:native-edit-copy' as const;
export const NATIVE_EDIT_COMMAND_CHANNEL = 'keel:shell:native-edit-command' as const;
export const WINDOW_MAXIMIZED_CHANNEL =
  'keel:shell:window-maximized' as const;
/** Main → Renderer: BrowserWindow focus state (macOS traffic lights / shell chrome). */
export const WINDOW_FOCUS_CHANNEL = 'keel:shell:window-focus' as const;
/** Renderer → Main: enable Main before-input capture for video letter keys. */
export const VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL =
  'keel:viewer:video-shortcuts-active' as const;
/** Main → Renderer: video letter shortcut (D/F/X/C) after before-input. */
export const VIEWER_VIDEO_SHORTCUT_CHANNEL =
  'keel:viewer:video-shortcut' as const;
/** Main → Renderer: Windows F2 / Delete / Shift+Delete (Serpent-g8u9). */
export const BROWSE_SHORTCUT_CHANNEL =
  'keel:shell:browse-shortcut' as const;
/** Renderer → Main: disable hidden F2/Delete accelerators in text fields. */
export const BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL =
  'keel:shell:browse-shortcut-menu-enabled' as const;
/** Renderer → Main: enable app accelerators independently of browse/viewer scope. */
export const APPLICATION_SHORTCUTS_ENABLED_CHANNEL =
  'keel:shell:application-shortcuts-enabled' as const;

/** Renderer Desktop Console → Main-owned Automation Execution/Gateway bridge. */
export const AUTOMATION_SCRIPT_OPEN_CHANNEL = 'keel:automation:script-open' as const;
export const AUTOMATION_SCRIPT_SAVE_CHANNEL = 'keel:automation:script-save' as const;
export const AUTOMATION_SCRIPT_START_CHANNEL = 'keel:automation:script-start' as const;
/** Renderer Desktop Console → Main: run an already Main-authorized execution. */
export const AUTOMATION_SCRIPT_EXECUTE_CHANNEL = 'keel:automation:script-execute' as const;
export const AUTOMATION_SCRIPT_COMMAND_CHANNEL = 'keel:automation:script-command' as const;
export const AUTOMATION_SCRIPT_COMPLETE_CHANNEL = 'keel:automation:script-complete' as const;
export const AUTOMATION_SCRIPT_CANCEL_CHANNEL = 'keel:automation:script-cancel' as const;
export const AUTOMATION_SCRIPT_HISTORY_CHANNEL = 'keel:automation:script-history' as const;
export const AUTOMATION_SCRIPT_UNDO_CHANNEL = 'keel:automation:script-undo' as const;
export const AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL = 'keel:automation:script-recent-list' as const;
export const AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL = 'keel:automation:script-recent-open' as const;
/** Renderer ↔ Main: device-level embedded MCP service settings. */
export const MCP_SETTINGS_REQUEST_CHANNEL = 'keel:mcp:settings-request' as const;
export const MCP_SETTINGS_EVENT_CHANNEL = 'keel:mcp:settings-event' as const;
/** Critical confirmation child window: the preload exposes only these two calls. */
export const CRITICAL_CONFIRMATION_GET_CHANNEL = 'keel:critical-confirmation:get' as const;
export const CRITICAL_CONFIRMATION_DECIDE_CHANNEL = 'keel:critical-confirmation:decide' as const;
/** Main → renderer: show the themed in-app critical confirmation dialog. */
export const CRITICAL_CONFIRMATION_PROMPT_CHANNEL = 'keel:critical-confirmation:prompt' as const;
/** Renderer → Main: the in-app dialog's cancel/confirm decision. */
export const CRITICAL_CONFIRMATION_RESPOND_CHANNEL = 'keel:critical-confirmation:respond' as const;
/** Renderer plugin manager → Main. File paths remain Main-owned. */
export const PLUGIN_MANAGER_CHANNEL = 'keel:plugin-manager:request' as const;
/** Main → Renderer: progress and terminal state for a GitHub plugin install. */
export const PLUGIN_INSTALL_PROGRESS_CHANNEL = 'keel:plugin:install-progress' as const;
/** Main → Renderer: semantic model / runtime download progress. */
export const EMBEDDING_INSTALL_PROGRESS_CHANNEL = 'keel:embedding:install-progress' as const;
/** Main → Renderer: plugin contributions changed after install/enable/refresh. */
export const PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL =
  'keel:plugin:contributions-changed' as const;
/** Main → Renderer: active plugin input capture sessions for fan-in gating. */
export const PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL =
  'keel:plugin:input-capture-sessions' as const;
/** Renderer → Main: DOM input capture fan-in event. */
export const PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL =
  'keel:plugin:input-capture-event' as const;
/** Renderer → Main: system modal pause seam (dialogs outrank plugins). */
export const PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL =
  'keel:plugin:input-capture-system-modal' as const;

/**
 * Offscreen model-thumbnail renderer channels (slice E, Serpent-hnmg).
 * Main → offscreen window: a render job (payload = model-thumbnail.render-request).
 * Offscreen window → Main: the rendered frame (payload = model-thumbnail.render-response).
 */
export const OFFSCREEN_THUMBNAIL_RENDER_CHANNEL =
  'keel:offscreen-thumbnail:render' as const;
export const OFFSCREEN_THUMBNAIL_FRAME_CHANNEL =
  'keel:offscreen-thumbnail:frame' as const;

export const WORKER_READY_MESSAGE_TYPE = 'worker.ready' as const;
export const WORKER_SHUTDOWN_MESSAGE_TYPE = 'worker.shutdown' as const;
export const WORKER_SHUTDOWN_ACK_MESSAGE_TYPE = 'worker.shutdown.ack' as const;
export const RULE_RUN_RECORDED_CHANNEL = 'keel:rule:run-recorded';
export const RULE_INVOKE_CHANNEL = 'keel:rule:invoke';
