import { createFieldStore } from './create-field-store';
import { type HistoryStatus, type RendererLibrarySummary } from '../../shared/protocol/responses';
import { type RecentLibraryMenuEntry } from '../LibrarySwitcher';

export type LibraryLoadingState = {
  name: string | null;
  operation?: "opening" | "deleting";
};

export type UiState =
  | "booting"
  | "idle"
  | "creating"
  | "opening"
  | "closing"
  | "loading"
  | "importing"
  | "ready";

export interface SessionState {
  library: RendererLibrarySummary | null;
  recentLibraries: RecentLibraryMenuEntry[];
  libraryLoading: LibraryLoadingState | null;
  workerRecoveryState: 'ready' | 'recovering' | 'failed';
  libraryRecoveryDialogOpen: boolean;
  operationHistory: HistoryStatus | null;
  browserSessionReady: boolean;
  uiState: UiState;
  // @fields
}

export const sessionFields = createFieldStore<SessionState>(() => ({
    library: null,
    recentLibraries: [],
    libraryLoading: null,
    workerRecoveryState: 'ready',
    libraryRecoveryDialogOpen: false,
    operationHistory: null,
    browserSessionReady: false,
    uiState: "booting",
    // @initial
}));

export const useSessionField = sessionFields.useField;
