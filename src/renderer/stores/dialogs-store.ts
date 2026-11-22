import { createFieldStore } from './create-field-store';
import { type AppLogEntry } from '../../shared/app-log';
import type { AppSettingsCategoryId } from '../app-settings-sections';

export type DialogKind = "library" | "tag" | null;

export interface DialogsState {
  convertLinkedDialog: {
    folderId: string;
    name: string;
    targetFolderId: string;
  };
  fatalDialogTitle: string | null;
  fatalAlertAlreadyOpen: boolean;
  searchHistoryOpen: boolean;
  restoreDialog: {
    assetIds: string[];
    target: "original" | "root" | string;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null;
  moveDialog: {
    assetIds: string[];
    folderIds: string[];
    targetFolderId: string | null;
    conflictStrategy: "keep-both" | "replace" | "skip";
  } | null;
  imageSequenceDialog: {
    assetIds: string[];
    mode: "create" | "update";
    sequenceId?: string;
    frameCount?: number;
    fps: number;
    submitting: boolean;
    error: string | null;
  } | null;
  appSettingsOpen: boolean;
  appSettingsCategory: AppSettingsCategoryId;
  appLogOpen: boolean;
  automaticTasksOpen: boolean;
  scriptSandboxPreviewOpen: boolean;
  aboutOpen: boolean;
  openSourceLicensesOpen: boolean;
  librarySettingsOpen: boolean;
  openSyncLibraryOpen: boolean;
  exportDialogOpen: boolean;
  openLibraryChooserOpen: boolean;
  pluginUiDialogOpen: boolean;
  mediaJobsOpen: boolean;
  dialog: DialogKind;
  useExistingCreateFolder: boolean;
  createStorageLayout: 'root' | 'assets';
  gitignoreContent: string;
  appLogEntries: AppLogEntry[];
  appLogLoading: boolean;
  appLogAutomationCorrelationId: string;
  // @fields
}

export const dialogsFields = createFieldStore<DialogsState>(() => ({
    convertLinkedDialog: { folderId: "", name: "", targetFolderId: "" },
    fatalDialogTitle: null,
    fatalAlertAlreadyOpen: false,
    searchHistoryOpen: false,
    restoreDialog: null,
    moveDialog: null,
    imageSequenceDialog: null,
    appSettingsOpen: false,
    appSettingsCategory: "general",
    appLogOpen: false,
    automaticTasksOpen: false,
    scriptSandboxPreviewOpen: false,
    aboutOpen: false,
    openSourceLicensesOpen: false,
    librarySettingsOpen: false,
    openSyncLibraryOpen: false,
    exportDialogOpen: false,
    openLibraryChooserOpen: false,
    pluginUiDialogOpen: false,
    mediaJobsOpen: false,
    dialog: null,
    useExistingCreateFolder: false,
    createStorageLayout: 'root',
    gitignoreContent: "",
    appLogEntries: [],
    appLogLoading: false,
    appLogAutomationCorrelationId: "",
    // @initial
}));

export const useDialogField = dialogsFields.useField;
