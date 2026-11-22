import { createFieldStore } from './create-field-store';
import { type EmbeddingIndexSnapshot, type SemanticSearchModelId } from '../../shared/embedding/profile';
import { type EmbeddingHttpServiceSummary } from '../../shared/library-api';
import { loadSemanticSearchPreferences } from '../semantic-search-preferences';

export interface EmbeddingState {
  semanticSearchPrefs: ReturnType<typeof loadSemanticSearchPreferences>;
  embeddingIndex: EmbeddingIndexSnapshot;
  embeddingBinding: { selectionId: string | null; enabled: boolean; inherit: boolean } | null;
  embeddingForLibraryId: string | null;
  embeddingInstall: {
    runtimeInstalled: boolean;
    runtimeDownloadable: boolean;
    models: Array<{ modelId: SemanticSearchModelId; installed: boolean }>;
  } | null;
  embeddingServices: EmbeddingHttpServiceSummary[];
  embeddingInstalling: boolean;
  // @fields
}

export const embeddingFields = createFieldStore<EmbeddingState>(() => ({
    semanticSearchPrefs: loadSemanticSearchPreferences(),
    embeddingIndex: {
    phase: "unavailable",
    done: 0,
    total: 0,
    failedCount: 0,
  },
    embeddingBinding: null,
    embeddingForLibraryId: null,
    embeddingInstall: null,
    embeddingServices: [],
    embeddingInstalling: false,
    // @initial
}));

export const useEmbeddingField = embeddingFields.useField;
