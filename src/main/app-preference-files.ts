import { readRecentLibraryEntries } from './recent-libraries';
import { recentLibraryPath } from './external-library-staging';
import { state } from './main-state';
import { startupPreferencesFilePath, readStartupPreferences, startupPreferencesSnapshot as createStartupPreferencesSnapshot, applyStartupLoginItem, writeStartupPreferences } from './startup-preferences-store';
import { app, dialog } from 'electron';
import { shortcutBindingsFilePath, readShortcutBindings, writeShortcutBindings } from './shortcut-bindings-store';
import { type ShortcutFileExportResult, type ShortcutFileImportResult, type ShortcutBindingsSetResult } from '../shared/shortcut-api';
import { resolveNativeDialogCopy } from '../shared/native-dialog-i18n';
import { writeFileSync, readFileSync } from 'node:fs';
import { ensureRendererKeyboardFocus } from './renderer-keyboard-focus';
import { parseShortcutBindings, shortcutPlatformFromProcess, withPlatformBindings, type ShortcutOverride, parseShortcutChord } from '../shared/shortcut-bindings';
import { validateShortcutBindings, validateShortcutChord, findAllShortcutConflicts } from '../shared/shortcut-resolution';
import { installApplicationMenu } from './application-menu';
import { findShortcutAction } from '../shared/shortcut-catalog';
import { type StartupPreferencesSnapshot, type StartupPreferences } from '../shared/startup-preferences';

/**
 * Startup preferences, shortcut bindings (store, import, export) and the recent-library list for the native menu (split out of index.ts, P8).
 */
/**
 * Known libraries for the native 资源库 menu, most recently opened first.
 * Read fresh on every (re)install so the section tracks the store; labels are
 * literal names, so no i18n resolution is needed for them.
 */
export function nativeMenuRecentLibraries(): { path: string; name: string }[] {
  return readRecentLibraryEntries(recentLibraryPath(), (error) => {
    state.logger?.error("recent-library.read", error);
  }).map((entry) => ({ path: entry.path, name: entry.name }));
}

export function startupPreferencesPath(): string {
  return startupPreferencesFilePath(app.getPath("userData"));
}

export function shortcutBindingsPath(): string {
  return shortcutBindingsFilePath(app.getPath("userData"));
}

export function readShortcutBindingsSnapshot() {
  return readShortcutBindings(shortcutBindingsPath());
}

export async function exportShortcutBindingsFile(): Promise<ShortcutFileExportResult> {
  const copy = resolveNativeDialogCopy(state.appLocale, "exportShortcuts");
  try {
    const e2ePath =
      process.env.KEEL_E2E === "1"
        ? process.env.KEEL_E2E_SHORTCUTS_EXPORT_PATH
        : undefined;
    let filePath = e2ePath;
    if (!filePath) {
      const options: Electron.SaveDialogOptions = {
        title: copy.title,
        buttonLabel: copy.buttonLabel,
        defaultPath: "keel-shortcuts.json",
        filters: [{ name: copy.filterName ?? "JSON", extensions: ["json"] }],
      };
      const result = state.mainWindow
        ? await dialog.showSaveDialog(state.mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return { ok: false, error: "canceled", canceled: true };
      }
      filePath = result.filePath;
    }
    const bindings = readShortcutBindingsSnapshot();
    writeFileSync(filePath, `${JSON.stringify(bindings, null, 2)}\n`, "utf8");
    return { ok: true, path: filePath };
  } catch (error) {
    state.logger?.error("shortcuts.export", error);
    return { ok: false, error: "shortcut-export-failed" };
  } finally {
    ensureRendererKeyboardFocus(state.mainWindow, {
      reattachHwnd: true,
      reason: "shortcuts.export",
    });
  }
}

export async function importShortcutBindingsFile(): Promise<ShortcutFileImportResult> {
  const copy = resolveNativeDialogCopy(state.appLocale, "importShortcuts");
  try {
    const e2ePath =
      process.env.KEEL_E2E === "1"
        ? process.env.KEEL_E2E_SHORTCUTS_IMPORT_PATH
        : undefined;
    let selected = e2ePath;
    if (!selected) {
      const options: Electron.OpenDialogOptions = {
        title: copy.title,
        buttonLabel: copy.buttonLabel,
        properties: ["openFile"],
        filters: [{ name: copy.filterName ?? "JSON", extensions: ["json"] }],
      };
      const result = state.mainWindow
        ? await dialog.showOpenDialog(state.mainWindow, options)
        : await dialog.showOpenDialog(options);
      selected = result.filePaths[0];
      if (result.canceled || !selected) {
        return { ok: false, error: "canceled", canceled: true };
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(selected, "utf8"));
    } catch {
      return { ok: false, error: "invalid-shortcut-file" };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== 1 ||
      !(parsed as { platforms?: unknown }).platforms ||
      typeof (parsed as { platforms?: unknown }).platforms !== "object" ||
      Array.isArray((parsed as { platforms?: unknown }).platforms)
    ) {
      return { ok: false, error: "invalid-shortcut-file" };
    }
    const imported = parseShortcutBindings(parsed);
    const platform = shortcutPlatformFromProcess(process.platform);
    const validation = validateShortcutBindings(imported, platform);
    if (validation !== null) return { ok: false, error: validation };
    // Import only the current platform; the other platform's local settings
    // are preserved when a backup moves between Windows and macOS.
    const bindings = withPlatformBindings(
      readShortcutBindingsSnapshot(),
      platform,
      imported.platforms[platform],
    );
    writeShortcutBindings(shortcutBindingsPath(), bindings);
    installApplicationMenu({
      locale: state.appLocale,
      recentLibraries: nativeMenuRecentLibraries(),
      shortcutBindings: bindings,
    });
    return { ok: true, bindings };
  } catch (error) {
    state.logger?.error("shortcuts.import", error);
    return { ok: false, error: "shortcut-import-failed" };
  } finally {
    ensureRendererKeyboardFocus(state.mainWindow, {
      reattachHwnd: true,
      reason: "shortcuts.import",
    });
  }
}

export function storeShortcutBindings(input: unknown): ShortcutBindingsSetResult {
  const current = readShortcutBindingsSnapshot();
  const platform = shortcutPlatformFromProcess(process.platform);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, bindings: current, error: "invalid-shortcut-request" };
  }
  const record = input as { platform?: unknown; bindings?: unknown };
  if (record.platform !== platform) {
    return { ok: false, bindings: current, error: "invalid-shortcut-platform" };
  }
  if (
    !record.bindings ||
    typeof record.bindings !== "object" ||
    Array.isArray(record.bindings)
  ) {
    return { ok: false, bindings: current, error: "invalid-shortcut-bindings" };
  }

  const next: Record<string, ShortcutOverride> = {};
  for (const [actionId, value] of Object.entries(
    record.bindings as Record<string, unknown>,
  )) {
    if (value === null) {
      next[actionId] = null;
      continue;
    }
    const chord = parseShortcutChord(value);
    if (!chord) {
      return { ok: false, bindings: current, error: "invalid-shortcut-chord" };
    }
    const action = findShortcutAction(actionId);
    if (action?.customizable === false) {
      return { ok: false, bindings: current, error: "shortcut-fixed" };
    }
    if (action) {
      const reason = validateShortcutChord(chord, platform, action.scopes, actionId);
      if (reason !== null) {
        return { ok: false, bindings: current, error: "invalid-shortcut-chord" };
      }
    } else if (!Object.prototype.hasOwnProperty.call(current.platforms[platform], actionId)) {
      // Unknown ids are not accepted from a fresh renderer payload; existing
      // unknown entries are merged below so a downgrade does not lose data.
      continue;
    }
    next[actionId] = chord;
  }
  for (const [actionId, value] of Object.entries(current.platforms[platform])) {
    if (!(actionId in next) && !findShortcutAction(actionId)) {
      next[actionId] = value;
    }
  }

  const candidate = withPlatformBindings(current, platform, next);
  if (findAllShortcutConflicts(platform, candidate).length > 0) {
    return { ok: false, bindings: current, error: "shortcut-conflict" };
  }
  writeShortcutBindings(shortcutBindingsPath(), candidate);
  installApplicationMenu({
    locale: state.appLocale,
    recentLibraries: nativeMenuRecentLibraries(),
    shortcutBindings: candidate,
  });
  return { ok: true, bindings: candidate };
}

export function getOSLoginItemState(): {
  openAtLogin: boolean;
  executableWillLaunchAtLogin?: boolean;
  status?: string;
} {
  const state = app.getLoginItemSettings(
    process.platform === "win32" ? { args: [] } : undefined,
  );
  return {
    openAtLogin: state.openAtLogin,
    ...(process.platform === "win32"
      ? { executableWillLaunchAtLogin: state.executableWillLaunchAtLogin }
      : { status: state.status }),
  };
}

export function readStartupPreferencesSnapshot(): StartupPreferencesSnapshot {
  const preferences = readStartupPreferences(startupPreferencesPath());
  return createStartupPreferencesSnapshot({
    platform: process.platform,
    packaged: app.isPackaged,
    e2e: process.env.KEEL_E2E === "1",
    preferences,
    getLoginItemState: getOSLoginItemState,
    onReadError: (error) => state.logger?.error("startup.login-item", error),
  });
}

export function storeStartupPreferences(input: unknown): StartupPreferencesSnapshot {
  const current = readStartupPreferences(startupPreferencesPath());
  const record = typeof input === "object" && input !== null ? input as {
    openAtLogin?: unknown;
  } : {};
  const preferences: StartupPreferences = {
    version: 1,
    openAtLogin: typeof record.openAtLogin === "boolean" ? record.openAtLogin : current.openAtLogin,
  };
  const snapshot = applyStartupLoginItem({
    platform: process.platform,
    packaged: app.isPackaged,
    e2e: process.env.KEEL_E2E === "1",
    preferences,
    setLoginItemSettings: (settings) => {
      app.setLoginItemSettings({
        openAtLogin: settings.openAtLogin,
        ...(settings.args === undefined ? {} : { args: [...settings.args] }),
        ...(settings.enabled === undefined ? {} : { enabled: settings.enabled }),
      });
    },
    getLoginItemState: getOSLoginItemState,
  });
  if (!snapshot.registrationFailed) {
    writeStartupPreferences(startupPreferencesPath(), preferences);
  }
  return snapshot;
}
