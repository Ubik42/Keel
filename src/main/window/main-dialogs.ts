import { type NativeDialogHost, selectOpenFile, selectSavePath, selectImportSources as selectImportSourcesDialog, selectLibraryDirectory, selectPluginPackage } from './native-dialogs';
import { state } from '../main-state';
import { app } from 'electron';

/**
 * Native open/save dialogs used by Main (split out of index.ts, P8).
 */
export function createNativeDialogHost(): NativeDialogHost {
  return {
    getLocale: () => state.appLocale,
    getMainWindow: () => state.mainWindow ?? null,
    isE2e: () => !app.isPackaged && process.env.KEEL_E2E === "1",
  };
}

export async function selectAutomationScriptToOpen(): Promise<string | undefined> {
  return selectOpenFile(
    createNativeDialogHost(),
    'openAutomationScript',
    process.env.KEEL_E2E_OPEN_AUTOMATION_SCRIPT,
    [{ name: 'Keel scripts', extensions: ['keel.js', 'keel.ts', 'serpent.js', 'serpent.ts'] }],
  );
}

export async function selectAutomationScriptToSave(): Promise<string | undefined> {
  return selectSavePath(
    createNativeDialogHost(),
    'saveAutomationScript',
    process.env.KEEL_E2E_SAVE_AUTOMATION_SCRIPT,
    {
      defaultPath: 'Untitled.keel.ts',
      filters: [{ name: 'Keel scripts', extensions: ['keel.js', 'keel.ts'] }],
    },
  );
}

export async function selectImportSources(
  sourceKind: "files" | "folder",
): Promise<string[] | undefined> {
  return selectImportSourcesDialog(createNativeDialogHost(), sourceKind);
}

export async function selectDirectory(
  dialogId: "createLibrary" | "openLibrary",
): Promise<string | undefined> {
  return selectLibraryDirectory(createNativeDialogHost(), dialogId);
}

export async function selectPluginPackageForInstall(
  sourceKind: "zip" | "folder",
): Promise<string | undefined> {
  return selectPluginPackage(
    createNativeDialogHost(),
    sourceKind,
    process.env.KEEL_E2E_PLUGIN_PACKAGE,
  );
}
