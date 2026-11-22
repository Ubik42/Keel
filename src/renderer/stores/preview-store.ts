import { createFieldStore } from './create-field-store';
import { type AssetSummary } from '../../shared/asset-types';

export interface PreviewState {
  previewAsset: AssetSummary | null;
  previewRestoring: boolean;
  previewCanvasReady: boolean;
  // @fields
}

export const previewFields = createFieldStore<PreviewState>(() => ({
    previewAsset: null,
    previewRestoring: false,
    previewCanvasReady: false,
    // @initial
}));

export const usePreviewField = previewFields.useField;
