import { createFieldStore } from './create-field-store';

export interface WorkspaceState {
  navHistoryUi: { canBack: boolean; canForward: boolean };
  // @fields
}

export const workspaceFields = createFieldStore<WorkspaceState>(() => ({
    navHistoryUi: {
    canBack: false,
    canForward: false,
  },
    // @initial
}));

export const useWorkspaceField = workspaceFields.useField;
