import path from 'node:path';
import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import { OPEN_WITH_CHOOSE_PROGRAM_CHANNEL, STARTUP_PREFERENCES_SET_CHANNEL, OPEN_EXTERNAL_URL_CHANNEL, REVEAL_APP_LOG_CHANNEL, READ_APP_LOG_CHANNEL, SHOW_EDIT_CONTEXT_MENU_CHANNEL, NATIVE_EDIT_COPY_CHANNEL, NATIVE_EDIT_COMMAND_CHANNEL, APP_LOCALE_CHANNEL, LINKED_MISSING_VISIBILITY_CHANNEL, APPLICATION_MENU_ITEM_STATE_CHANNEL, ACTIVE_CONTEXT_CHANNEL, BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL, APPLICATION_SHORTCUTS_ENABLED_CHANNEL, VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL, PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL, PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL } from '../shared/protocol/channels';
import { state } from './main-state';
import { type StartupPreferencesSnapshot } from '../shared/startup-preferences';
import { readStartupPreferencesSnapshot, storeStartupPreferences, nativeMenuRecentLibraries, readShortcutBindingsSnapshot } from './app-preference-files';
import { type OpenExternalUrlResult, resolveOpenExternalUrlTarget, type RevealAppLogResult } from '../shared/external-url';
import { existsSync } from 'node:fs';
import { type ReadAppLogResult, parseReadAppLogRequest } from '../shared/app-log';
import { type ShowEditContextMenuResult } from '../shared/edit-context-menu';
import { popupEditContextMenu } from './edit-context-menu';
import { mapSystemLocaleToAppLocale, tryParseAppLocaleSync } from '../shared/native-dialog-i18n';
import { installApplicationMenu, setApplicationMenuCommandChecked, setApplicationMenuCommandEnabled, setApplicationMenuCommandLabel } from './application-menu';
import { tryParseActiveContext } from '../shared/protocol/requests';
import { focusedContexts } from './extension-save';
import { recordExtensionBrowseFolder } from './extension-recent-browse-folders';
import { setWindowsBrowseShortcutAcceleratorsEnabled, setWindowsApplicationShortcutAcceleratorsEnabled } from './viewer-video-shortcut-menu';
import { setViewerVideoShortcutCaptureActive } from './viewer-video-shortcut-capture';
import { parsePluginInputCapturePublishPayload, parsePluginInputCaptureSystemModalPayload } from '../shared/plugin-input-capture-renderer';
import { schedulePluginInputCaptureFlush, publishPluginInputCaptureSessionsToRenderer } from './main-window';

/**
 * IPC for the shell: open-with program chooser, startup preferences, app log, native edit commands, locale, menu item state, active context, shortcut gating and plugin input capture (split out of startApplication, P8).
 */
export function registerShellIpc() {
  ipcMain.handle(OPEN_WITH_CHOOSE_PROGRAM_CHANNEL, async (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return null;
    const result = await dialog.showOpenDialog(state.mainWindow, {
      properties: ["openFile"],
      ...(process.platform === "win32"
        ? { filters: [{ name: "Programs", extensions: ["exe", "bat", "cmd"] }] }
        : {}),
    });
    const executablePath = result.canceled ? undefined : result.filePaths[0];
    if (!executablePath) return null;
    return { name: path.parse(executablePath).name, executablePath };
  });

  ipcMain.handle(STARTUP_PREFERENCES_SET_CHANNEL, (event, input: unknown): StartupPreferencesSnapshot => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.startup-preferences", "Rejected startup preference update.", {
        code: "unauthorized-sender",
      });
      return readStartupPreferencesSnapshot();
    }
    try {
      return storeStartupPreferences(input);
    } catch (error) {
      state.logger?.error("startup.login-item", error);
      return {
        ...readStartupPreferencesSnapshot(),
        registrationFailed: true,
      };
    }
  });

  // 渲染进程请求在系统浏览器打开外部链接（检查器「源链接」跳转）。
  // 发送者与 URL 双重校验，仅放行不含凭据的 HTTP(S)。失败回传公开错误码；日志不含 URL。
  ipcMain.handle(
    OPEN_EXTERNAL_URL_CHANNEL,
    async (event, input: unknown): Promise<OpenExternalUrlResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const resolved = resolveOpenExternalUrlTarget(input);
      if (!resolved.ok) {
        state.logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: resolved.code,
        });
        return resolved;
      }
      try {
        await shell.openExternal(resolved.url);
        return { ok: true };
      } catch (error) {
        state.logger?.error("ipc.open-external-url", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Reveal serpent.log in the file manager without exposing the path to Renderer.
  ipcMain.handle(
    REVEAL_APP_LOG_CHANNEL,
    (event): RevealAppLogResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.reveal-app-log", "Rejected reveal-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      if (!state.appLogPath || !existsSync(state.appLogPath)) {
        state.logger?.info("ipc.reveal-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        shell.showItemInFolder(state.appLogPath);
        return { ok: true };
      } catch (error) {
        state.logger?.error("ipc.reveal-app-log", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Read only the recent, already-redacted entries for the in-app diagnostics view.
  // The absolute log path remains Main-owned and never crosses the bridge.
  ipcMain.handle(
    READ_APP_LOG_CHANNEL,
    (event, input: unknown): ReadAppLogResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.read-app-log", "Rejected read-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const request = parseReadAppLogRequest(input);
      if (!request) {
        state.logger?.info("ipc.read-app-log", "Rejected malformed app-log filter.", {
          code: "malformed_request",
        });
        return { ok: false, code: "malformed_request" };
      }
      if (!state.appLogPath || !existsSync(state.appLogPath)) {
        state.logger?.info("ipc.read-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        return {
          ok: true,
          entries: state.logger?.readRecent(500, {
            redactPaths: true,
            automationCorrelationId: request.automationCorrelationId,
          }) ?? [],
          fileName: path.basename(state.appLogPath),
        };
      } catch (error) {
        state.logger?.error("ipc.read-app-log", error, { code: "read_failure" });
        return { ok: false, code: "read_failure" };
      }
    },
  );

  // 文本输入右键：仅授权主窗口弹出 role 编辑菜单；Renderer 只传坐标。
  ipcMain.handle(
    SHOW_EDIT_CONTEXT_MENU_CHANNEL,
    (event, input: unknown): ShowEditContextMenuResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const result = popupEditContextMenu(event.sender, input);
      if (!result.ok) {
        state.logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: result.code,
        });
      }
      return result;
    },
  );

  // Serpent-166q: text-field ⌘C fallback when Edit menu routes through renderer.
  ipcMain.handle(NATIVE_EDIT_COPY_CHANNEL, (event): void => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    event.sender.copy();
  });
  ipcMain.handle(NATIVE_EDIT_COMMAND_CHANNEL, (event, input: unknown): void => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    if (input === "paste") event.sender.paste();
    if (input === "select-all") event.sender.selectAll();
  });

  // Bootstrap dialog locale from OS before Renderer syncs (Serpent-bwb).
  state.appLocale = mapSystemLocaleToAppLocale(app.getLocale());

  ipcMain.on(APP_LOCALE_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.app-locale", "Rejected app-locale update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseAppLocaleSync(input);
    if (!parsed.ok) {
      state.logger?.info("ipc.app-locale", "Dropped malformed app-locale update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    state.appLocale = parsed.locale;
    installApplicationMenu({
      locale: state.appLocale,
      recentLibraries: nativeMenuRecentLibraries(),
      shortcutBindings: readShortcutBindingsSnapshot(),
    });
    state.windowsTray?.updateLocale(state.appLocale);
  });

  // Serpent-q0b1: the renderer syncs native menu item enabled-state (business
  // undo/redo availability). Only commands from the real window are accepted.
  ipcMain.handle(LINKED_MISSING_VISIBILITY_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    if (typeof input !== "boolean") return;
    state.showMissingLinkedFiles = input;
    state.workerClient?.publishShowMissingLinkedFiles(input);
    setApplicationMenuCommandChecked("library.show-missing-linked", input);
  });

  ipcMain.handle(APPLICATION_MENU_ITEM_STATE_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return;
    }
    const record = input as { command?: unknown; enabled?: unknown; label?: unknown } | null;
    if (record === null || typeof record !== "object") return;
    if (typeof record.command !== "string") return;
    if (typeof record.enabled === "boolean") {
      setApplicationMenuCommandEnabled(record.command, record.enabled);
    }
    if (typeof record.label === "string" && record.label.length > 0 && record.label.length <= 200) {
      setApplicationMenuCommandLabel(record.command, record.label);
    }
  });

  ipcMain.on(ACTIVE_CONTEXT_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info("ipc.active-context", "Rejected active-context update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseActiveContext(input);
    if (!parsed.ok) {
      state.logger?.info("ipc.active-context", "Dropped malformed active-context update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId !== undefined) {
      focusedContexts.set(windowId, parsed.context);
      if (parsed.context.libraryId) {
        state.lastExtensionTargetWindowId = windowId;
      }
      if (
        state.extensionBrowseFoldersStorePath &&
        parsed.context.libraryId &&
        parsed.context.selectedFolderId
      ) {
        recordExtensionBrowseFolder(
          state.extensionBrowseFoldersStorePath,
          parsed.context.libraryId,
          parsed.context.selectedFolderId,
        );
      }
    }
  });

  ipcMain.on(BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL, (_event, input: unknown) => {
    const enabled =
      typeof input === "object" &&
      input !== null &&
      "enabled" in input &&
      Boolean((input as { enabled?: unknown }).enabled);
    setWindowsBrowseShortcutAcceleratorsEnabled(enabled);
  });

  ipcMain.on(APPLICATION_SHORTCUTS_ENABLED_CHANNEL, (event, input: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return;
    const enabled =
      typeof input === "object" &&
      input !== null &&
      "enabled" in input &&
      Boolean((input as { enabled?: unknown }).enabled);
    setWindowsApplicationShortcutAcceleratorsEnabled(enabled);
  });

  ipcMain.on(VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL, (event, input: unknown) => {
    const scope = typeof input === "object" && input !== null && "scope" in input
      && (input as { scope?: unknown }).scope === "viewer.audio"
      ? "viewer.audio"
      : "viewer.video";
    const active =
      typeof input === "object" &&
      input !== null &&
      "active" in input &&
      Boolean((input as { active?: unknown }).active);
    setViewerVideoShortcutCaptureActive(
      event.sender,
      active,
      readShortcutBindingsSnapshot(),
      scope,
    );
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL, (event, payload: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info('ipc.plugin-input-capture', 'Rejected input capture event.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCapturePublishPayload(payload);
    if (parsed === null) return;
    const result = state.pluginInputCaptureBroker?.publish(parsed);
    if (result === 'queued') schedulePluginInputCaptureFlush();
    if (result === 'released') publishPluginInputCaptureSessionsToRenderer();
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL, (event, payload: unknown) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      state.logger?.info('ipc.plugin-input-capture', 'Rejected system modal seam.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCaptureSystemModalPayload(payload);
    if (parsed === null) return;
    state.pluginInputCaptureBroker?.setSystemModalActive(parsed.active);
  });
}
