import { createFieldStore } from './create-field-store';
import { type AssetMetadataResult } from '../../shared/asset-types';

export interface InspectorState {
  assetMetadata: AssetMetadataResult | null;
  extractedMetadataRefreshKey: number;
  versionConflict: boolean;
  editDescription: string;
  editRating: number;
  editFavorite: boolean;
  editSourceUrl: string;
  editAuthor: string;
  aiContent: {
    assetId: string;
    description?: string;
    tags?: string[];
    rating?: number;
    modelVersion?: string;
  } | null;
  descriptionIsAi: boolean;
  // @fields
}

export const inspectorFields = createFieldStore<InspectorState>(() => ({
    assetMetadata: null,
    extractedMetadataRefreshKey: 0,
    versionConflict: false,
    editDescription: "",
    editRating: 0,
    editFavorite: false,
    editSourceUrl: "",
    editAuthor: "",
    aiContent: null,
    descriptionIsAi: false,
    // @initial
}));

export const useInspectorField = inspectorFields.useField;
