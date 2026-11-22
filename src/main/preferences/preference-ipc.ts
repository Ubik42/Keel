import { ipcMain, app } from 'electron';
import { STARTUP_PREFERENCES_GET_CHANNEL, SHORTCUT_BINDINGS_GET_CHANNEL, SHORTCUT_BINDINGS_EXPORT_CHANNEL, SHORTCUT_BINDINGS_IMPORT_CHANNEL, SHORTCUT_BINDINGS_SET_CHANNEL, OPEN_WITH_SETTINGS_GET_CHANNEL, OPEN_WITH_SETTINGS_SET_CHANNEL } from '../../shared/protocol/channels';
import { type StartupPreferencesSnapshot } from '../../shared/startup-preferences';
import { state } from '../main-state';
import { readStartupPreferencesSnapshot, readShortcutBindingsSnapshot, exportShortcutBindingsFile, importShortcutBindingsFile, storeShortcutBindings } from './app-preference-files';
import { type ShortcutFileExportResult, type ShortcutFileImportResult, type ShortcutBindingsSetResult } from '../../shared/shortcut-api';
import { DEFAULT_OPEN_WITH_SETTINGS } from '../../shared/open-with';
import { readOpenWithSettings, openWithSettingsFilePath, writeOpenWithSettings } from '../shell/open-with-settings-store';

/**
 * IPC for startup preferences, shortcut bindings and open-with settings (split out of startApplication, P8).
 */
export function registerPreferenceIpc() {
  ipcMain.handle(STARTUP_PREFERENCES_GET_CHANNEL, (event): StartupPreferencesSnapshot => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return readStartupPreferencesSnapshot();
    }
    return readStartupPreferencesSnapshot();
  });

  ipcMain.handle(SHORTCUT_BINDINGS_GET_CHANNEL, (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
      return readShortcutBindingsSnapshot();
    }
    return readShortcutBindingsSnapshot();
  });

  ipcMain.handle(
    SHORTCUT_BINDINGS_EXPORT_CHANNEL,
    async (event): Promise<ShortcutFileExportResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        return { ok: false, error: "unauthorized-sender" };
      }
      return exportShortcutBindingsFile();
    },
  );

  ipcMain.handle(
    SHORTCUT_BINDINGS_IMPORT_CHANNEL,
    async (event): Promise<ShortcutFileImportResult> => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        return { ok: false, error: "unauthorized-sender" };
      }
      return importShortcutBindingsFile();
    },
  );

  ipcMain.handle(
    SHORTCUT_BINDINGS_SET_CHANNEL,
    (event, input: unknown): ShortcutBindingsSetResult => {
      if (!state.mainWindow || event.sender !== state.mainWindow.webContents) {
        state.logger?.info("ipc.shortcuts", "Rejected shortcut update.", {
          code: "unauthorized-sender",
        });
        return {
          ok: false,
          bindings: readShortcutBindingsSnapshot(),
          error: "unauthorized-sender",
        };
      }
      try {
        return storeShortcutBindings(input);
      } catch (error) {
        state.logger?.error("shortcuts.store", error);
        return {
          ok: false,
          bindings: readShortcutBindingsSnapshot(),
          error: "shortcut-save-failed",
        };
      }
    },
  );

  // PF: open-with settings. Only the main window may read or change them.
  ipcMain.handle(OPEN_WITH_SETTINGS_GET_CHANNEL, (event) => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return DEFAULT_OPEN_WITH_SETTINGS;
    return readOpenWithSettings(openWithSettingsFilePath(app.getPath("userData")));
  });
  ipcMain.handle(OPEN_WITH_SETTINGS_SET_CHANNEL, (event, input: unknown) => {
    const filePath = openWithSettingsFilePath(app.getPath("userData"));
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return readOpenWithSettings(filePath);
    try {
      return writeOpenWithSettings(filePath, input);
    } catch (error) {
      state.logger?.error("open-with.settings", error);
      return readOpenWithSettings(filePath);
    }
  });
}
