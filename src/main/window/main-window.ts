import { type PluginInputCaptureSessionsPayload } from '../../shared/plugin-input-capture-renderer';
import { state } from '../main-state';
import { PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL, SHELL_SWIPE_CHANNEL, WINDOW_FOCUS_CHANNEL, SHELL_NOTIFY_CHANNEL } from '../../shared/protocol/channels';
import { focusKeelWindow, focusedContexts } from '../ingestion/extension-save';
import { MCP_START_FLAG } from '../mcp/mcp-stdio-launcher';
import { shouldHandleSecondaryLaunch, shouldShowMainWindowOnReady } from '../../shared/startup-preferences';
import { screen, BrowserWindow, app, dialog } from 'electron';
import { pickIsolatedWindowPlacement } from './e2e-isolated-window';
import { logRendererConsoleMessage, logRendererProcessGone, logRendererUnresponsive, logRendererResponsive } from './renderer-diagnostics';
import { appIconImage } from '../app/app-icon';
import { shouldUseLinuxRoundedCorners, linuxRoundedWindowOptions, attachLinuxRoundedCorners } from './linux-window-corners';
import { shouldUseFramelessTitleBar, shouldHideApplicationMenuBar } from '../../shared/window-controls';
import { default as path } from 'node:path';
import { clearViewerVideoShortcutCapture, isViewerVideoShortcutContentsActive, viewerShortcutScopeForContents } from './viewer-video-shortcut-capture';
import { matchWindowsApplicationShortcut, isWindowsApplicationShortcut, forwardApplicationShortcutToWindow } from './viewer-video-shortcut-menu';
import { matchBrowseKeyboardShortcut } from '../../shared/browse-keyboard-shortcuts';
import { readShortcutBindingsSnapshot } from '../preferences/app-preference-files';
import { shortcutPlatformFromProcess } from '../../shared/shortcut-bindings';
import { forwardBrowseShortcut } from './browse-shortcut-forward';
import { matchViewerVideoLetterShortcut, viewerShortcutRepeatForward } from '../../shared/viewer-video-shortcuts';
import { forwardViewerVideoShortcut } from './viewer-video-shortcut-forward';
import { bindWindowMaximizedEvents } from './window-controls';
import { sendToLiveWebContents } from './web-contents-send';
import { loadRendererDevUrl } from '../app/dev-renderer-load';

/**
 * The main window: creation, placement, renderer diagnostics, second-instance handling and the plugin input-capture sessions it shows (split out of index.ts, P8).
 */
export function buildPluginInputCaptureSessionsPayload(): PluginInputCaptureSessionsPayload {
  const sessions = state.pluginInputCaptureBroker?.activeSessions() ?? [];
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      scope: session.scope,
      ...(session.ownerViewId === undefined ? {} : { ownerViewId: session.ownerViewId }),
      keyboard: session.keyboard,
      pointer: session.pointer,
    })),
  };
}

export function publishPluginInputCaptureSessionsToRenderer(): void {
  if (!state.mainWindow) return;
  state.mainWindow.webContents.send(
    PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
    buildPluginInputCaptureSessionsPayload(),
  );
}

export function schedulePluginInputCaptureFlush(): void {
  if (state.pluginInputCaptureFlushTimer !== undefined) return;
  state.pluginInputCaptureFlushTimer = setTimeout(() => {
    state.pluginInputCaptureFlushTimer = undefined;
    state.pluginInputCaptureBroker?.flush();
  }, 0);
}

export function focusMainWindow(): boolean {
  return focusKeelWindow(
    state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.id : undefined,
  );
}

/** Launched by `Keel.exe --mcp`: start the MCP server, stay in the background. */
export const launchedForMcp = process.argv.includes(MCP_START_FLAG);

export async function startMcpForLauncher(): Promise<void> {
  try {
    if (state.embeddedMcpServer?.snapshot().runtime.status !== "running") await state.embeddedMcpServer?.start();
  } catch (error) {
    state.logger?.error("mcp.server.launcher-start", error);
  }
}

export function handleSecondInstance(_event: Electron.Event, argv: string[]): void {
  if (!shouldHandleSecondaryLaunch({ applicationQuitting: state.applicationQuitting })) return;
  if (argv.includes(MCP_START_FLAG)) {
    void startMcpForLauncher();
    return;
  }
  // A second launch while Vite is preparing its first module graph must not
  // reload the still-loading window and reset its mount deadline.
  focusMainWindow();
}

/**
 * Isolated-session placement for `KEEL_E2E_ISOLATED=1`: real E2E must keep
 * real `show()`/focus semantics (an earlier `showInactive` attempt broke
 * keyboard/focus tests and was reverted — see
 * docs/internal/development/2026-07-19-e2e-isolated-session-development-log.md), so
 * this only changes *where* the window appears, never how it is shown.
 * When a non-primary display exists, the window is placed fully within it;
 * on a single-display Mac there is no isolation available yet and the
 * window falls back to the primary display (logged, not silent).
 */
export function resolveE2eIsolatedPlacement(
  defaultSize: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined {
  if (process.env.KEEL_E2E_ISOLATED !== "1") return undefined;

  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
  }));
  const primaryDisplayId = screen.getPrimaryDisplay().id;
  const placement = pickIsolatedWindowPlacement(
    displays,
    primaryDisplayId,
    defaultSize,
  );

  if (placement) {
    state.logger?.info(
      "e2e.isolated-window",
      "Placing the E2E window on a secondary display so it does not steal foreground focus.",
      { ...placement },
    );
    return placement;
  }

  state.logger?.info(
    "e2e.isolated-window",
    "KEEL_E2E_ISOLATED=1 was set but no secondary display was detected; " +
      "falling back to the primary display. The E2E window will steal " +
      "foreground focus on this machine (a known limitation).",
    { displayCount: displays.length },
  );
  return undefined;
}

export function attachRendererDiagnostics(window: BrowserWindow): void {
  window.webContents.on(
    "console-message",
    (details) => {
      logRendererConsoleMessage(
        state.logger,
        details.level,
        details.message,
        details.lineNumber,
        details.sourceId,
      );
    },
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    logRendererProcessGone(state.logger, window.id, details);
  });
  window.webContents.on("unresponsive", () => {
    logRendererUnresponsive(state.logger, window.id);
  });
  window.webContents.on("responsive", () => {
    logRendererResponsive(state.logger, window.id);
  });
}

export async function createMainWindow(): Promise<void> {
  const defaultWidth = 1440;
  const defaultHeight = 900;
  const isolatedPlacement = resolveE2eIsolatedPlacement({
    width: defaultWidth,
    height: defaultHeight,
  });

  const devIcon = appIconImage();
  // the macOS dock otherwise shows the default Electron icon
  // in dev builds (packaged apps ship the real .icns).
  if (process.platform === "darwin" && devIcon) {
    app.dock?.setIcon(devIcon);
  }

  const linuxRoundedCorners = shouldUseLinuxRoundedCorners();
  const window = new BrowserWindow({
    width: isolatedPlacement?.width ?? defaultWidth,
    height: isolatedPlacement?.height ?? defaultHeight,
    ...(isolatedPlacement
      ? { x: isolatedPlacement.x, y: isolatedPlacement.y }
      : {}),
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#111417",
    ...(devIcon ? { icon: devIcon } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 16 },
        }
      : shouldUseFramelessTitleBar(process.platform)
        ? {
            // hide system title bar; renderer draws caption buttons.
            titleBarStyle: "hidden" as const,
          }
        : {}),
    ...(linuxRoundedCorners ? linuxRoundedWindowOptions() : {}),
    webPreferences: {
      preload: path.join(__dirname, "index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The opt-in performance harness needs frames while remaining hidden.
      ...(process.env.KEEL_E2E === "1" && process.env.KEEL_E2E_PERF_OFFSCREEN === "1"
        ? { offscreen: true, backgroundThrottling: false }
        : {}),
    },
  });

  state.mainWindow = window;
  if (linuxRoundedCorners) attachLinuxRoundedCorners(window);
  const mainContentsId = window.webContents.id;
  // Keep renderer diagnostics active in both development and packaged builds.
  // A blank window in a packaged build must leave the same evidence as one
  // started from Vite; idle windows produce no log entries.
  attachRendererDiagnostics(window);
  const showMainWindowIfAllowed = (): void => {
    // E2E can keep its renderer fully loaded and automatable without putting
    // a test window over the user's desktop session. An update handoff stays
    // hidden so a second launch cannot flash a window.
    const e2eShowInactive = process.env.KEEL_E2E === "1"
      && process.env.KEEL_E2E_SHOW_INACTIVE === "1";
    if (shouldShowMainWindowOnReady({
      applicationQuitting: state.applicationQuitting,
      e2eHideWindow: process.env.KEEL_E2E === "1"
        && process.env.KEEL_E2E_HIDE_WINDOW === "1"
        && !e2eShowInactive,
    })) {
      if (window.isVisible()) return;
      if (launchedForMcp) {
        // Started by the MCP launcher: keep the window out of the way.
        window.showInactive();
        window.minimize();
      } else if (e2eShowInactive) window.showInactive();
      else window.show();
    }
  };
  window.on("ready-to-show", showMainWindowIfAllowed);
  // Cleanup while webContents/HWND still exist (`closed` is too late).
  window.on("close", () => {
    clearViewerVideoShortcutCapture(mainContentsId);
  });
  window.on("closed", () => {
    if (state.mainWindow === window) {
      focusedContexts.delete(window.id);
      state.mainWindow = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.on("will-download", (event, item) => {
    if (item.getURL().startsWith("keel-plugin:")) event.preventDefault();
  });
  // VIEWER-018: letter keys under CJK IME — Menu accelerators + IMM32 suspend
  // are primary on Windows; before-input remains a cross-platform fallback.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    const captureType = input.type === 'keyUp' ? 'keyup' : 'keydown';
    const captureResult = state.pluginInputCaptureBroker?.publish({
      target: { scope: 'application' },
      event: {
        type: captureType,
        timestamp: Date.now(),
        key: input.key,
        code: input.code,
        repeat: input.isAutoRepeat,
        altKey: input.alt,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
        isComposing: input.isComposing,
      },
    });
    if (captureResult === 'delivered' || captureResult === 'queued') {
      event.preventDefault();
      return;
    }
    if (shouldHideApplicationMenuBar(process.platform)) {
      const appAction = input.type === "keyDown"
        ? matchWindowsApplicationShortcut({
            key: input.key,
            code: input.code,
            keyCode: (input as { keyCode?: number }).keyCode,
            control: input.control,
            meta: input.meta,
            alt: input.alt,
            shift: input.shift,
            isAutoRepeat: input.isAutoRepeat,
          })
        : null;
      const repeatedAppAction = input.type === "keyDown" && input.isAutoRepeat
        ? isWindowsApplicationShortcut({
            key: input.key,
            code: input.code,
            keyCode: (input as { keyCode?: number }).keyCode,
            control: input.control,
            meta: input.meta,
            alt: input.alt,
            shift: input.shift,
          })
        : false;
      if (appAction || repeatedAppAction) {
        event.preventDefault();
        if (appAction) forwardApplicationShortcutToWindow(window, appAction);
        return;
      }
      const browseInput = {
        type: input.type,
        code: input.code,
        key: input.key,
        keyCode: (input as { keyCode?: number }).keyCode,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      };
      const browseAction = matchBrowseKeyboardShortcut(browseInput, {
        bindings: readShortcutBindingsSnapshot(),
        platform: shortcutPlatformFromProcess(process.platform),
      });
      if (browseAction) {
        if (browseAction === "copy-path") {
          event.preventDefault();
          forwardBrowseShortcut(window.webContents, browseAction, {
            key: input.key,
            code: input.code,
            ctrlKey: input.control,
            metaKey: input.meta,
            altKey: input.alt,
            shiftKey: input.shift,
          });
        } else {
          forwardBrowseShortcut(window.webContents, browseAction);
        }
      }
    }
    if (!isViewerVideoShortcutContentsActive(window.webContents.id)) {
      return;
    }
    const viewerScope = viewerShortcutScopeForContents(window.webContents.id);
    if (viewerScope === null) return;
    const viewerInput = {
      type: input.type,
      code: input.code,
      key: input.key,
      keyCode: (input as { keyCode?: number }).keyCode,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
      isAutoRepeat: input.isAutoRepeat,
    };
    const bindings = readShortcutBindingsSnapshot();
    const platform = shortcutPlatformFromProcess(process.platform);
    const action = matchViewerVideoLetterShortcut(
      viewerInput,
      bindings,
      platform,
      viewerScope,
    );
    const repeatedViewerAction = input.type === "keyDown" && input.isAutoRepeat
      ? matchViewerVideoLetterShortcut(
        { ...viewerInput, isAutoRepeat: false },
        bindings,
        platform,
        viewerScope,
      )
      : null;
    if (!action && !repeatedViewerAction) return;
    event.preventDefault();
    const forward = viewerShortcutRepeatForward(action, repeatedViewerAction);
    if (forward) {
      forwardViewerVideoShortcut(window.webContents, forward.action, {
        repeat: forward.repeat,
      });
    }
  });
  // Defense in depth: even if a page-zoom accelerator sneaks
  // back into the menu, Chromium must not rescale the whole UI.
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  // keep caption maximize/restore glyph in sync on Windows.
  if (shouldUseFramelessTitleBar(process.platform)) {
    bindWindowMaximizedEvents(window);
  }
  // macOS three-finger swipe (requires Trackpad → Swipe between pages).
  // Event is on BrowserWindow, not webContents.
  window.on("swipe", (_event, direction) => {
    sendToLiveWebContents(window.webContents, SHELL_SWIPE_CHANNEL, direction);
  });

  const publishWindowFocus = () => {
    if (window.isDestroyed()) return;
    if (window.isFocused()) {
      state.lastExtensionTargetWindowId = window.id;
    }
    sendToLiveWebContents(window.webContents, WINDOW_FOCUS_CHANNEL, {
      focused: window.isFocused(),
    });
  };
  window.on("focus", publishWindowFocus);
  window.on("blur", () => {
    state.pluginInputCaptureBroker?.releaseForWindowBlur();
    publishWindowFocus();
  });
  window.once("ready-to-show", publishWindowFocus);
  window.webContents.once("did-finish-load", () => {
    publishPluginInputCaptureSessionsToRenderer();
    if (state.pendingPluginDeviceStateRecoveryNotice) {
      state.pendingPluginDeviceStateRecoveryNotice = false;
      window.webContents.send(SHELL_NOTIFY_CHANNEL, {
        severity: 'warning',
        mode: 'toast',
        message: '插件授权设置已重置，原设置已备份；如需使用插件，请重新授权。',
      });
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    let devModuleNetworkChanged = false;
    const devOrigin = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    const devSession = window.webContents.session;
    devSession.webRequest.onErrorOccurred(
      { urls: [`${devOrigin}/*`] },
      (details) => {
        if (details.webContentsId === window.webContents.id
          && details.resourceType === "script"
          && details.error === "net::ERR_NETWORK_CHANGED") {
          devModuleNetworkChanged = true;
        }
      },
    );
    window.once("closed", () => {
      devSession.webRequest.onErrorOccurred(null);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // aborted
      const detail = [
        `Failed to load renderer (${errorCode}): ${errorDescription}`,
        validatedURL ? `URL: ${validatedURL}` : null,
        "If the window is black after npm start, a Vite port conflict is likely.",
        "Use `npm start` (auto free port) or free the process on 5173.",
      ]
        .filter(Boolean)
        .join("\n");
      state.logger?.error("main.window.load", detail);
      dialog.showErrorBox("Keel renderer failed to load", detail);
    });
    try {
      await loadRendererDevUrl(window, MAIN_WINDOW_VITE_DEV_SERVER_URL, state.logger, {
        consumeNetworkChange: () => {
          const changed = devModuleNetworkChanged;
          devModuleNetworkChanged = false;
          return changed;
        },
        // A cold Vite module graph can leave a hidden BrowserWindow without a
        // first paint. Showing it after navigation lets Chromium schedule the
        // Renderer normally; the E2E hidden-window policy is still respected.
        onNavigated: () => {
          const visibleBefore = window.isVisible();
          showMainWindowIfAllowed();
          state.logger?.info("main.window.dev-navigation", "Renderer navigation completed.", {
            visibleBefore,
            visibleAfter: window.isVisible(),
          });
        },
      });
    } catch (error) {
      state.logger?.error("main.window.dev-load", error);
      dialog.showErrorBox(
        "Keel renderer failed to load",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}
