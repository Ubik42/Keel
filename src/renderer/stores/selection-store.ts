import { createFieldStore } from './create-field-store';

export interface SelectionState {
  selectedFolderIds: string[];
  selectedAssetId: string | undefined;
  selectedAssetIds: string[];
  // @fields
}

export const selectionFields = createFieldStore<SelectionState>(() => ({
    selectedFolderIds: [],
    selectedAssetId: undefined,
    selectedAssetIds: [],
    // @initial
}));

export const useSelectionField = selectionFields.useField;
