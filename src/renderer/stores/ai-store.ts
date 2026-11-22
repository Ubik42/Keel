import { createFieldStore } from './create-field-store';
import { type AiAnalysisSettingsWire, DEFAULT_AI_ANALYSIS_SETTINGS, toWireAiAnalysisSettings } from '../../shared/ai-analysis-settings';
import { type AiApiFormat, DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS } from '../../shared/ai-endpoints';
import { type AiConnectionState } from '../AiConfigDialog';
import { type AiBatchProgressSnapshot } from '../ai-analyze-progress';

export interface AiState {
  aiApiFormat: AiApiFormat;
  aiModel: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiDraftHasKey: boolean;
  aiHasKey: boolean;
  aiProfiles: Array<{
    id: string;
    name: string;
    apiFormat: AiApiFormat;
    model: string;
    baseUrl: string;
    hasCredential: boolean;
  }>;
  aiActiveProfileId: string | null;
  aiProfileDraftId: string | null;
  aiProfileName: string;
  aiDescriptionEnabled: boolean;
  aiTagsEnabled: boolean;
  aiRatingEnabled: boolean;
  aiForceExistingTags: boolean;
  aiAnalysisSettings: AiAnalysisSettingsWire;
  aiLanguages: Array<"zh-CN" | "en" | "ja" | "ko">;
  aiConcurrencyLimit: number;
  aiMaxAnalysisImageEdgePx: number;
  aiAutoAnalyzeEnabled: boolean;
  aiDisclaimerAccepted: boolean;
  aiConnectionState: AiConnectionState;
  aiDraftConnectionState: AiConnectionState;
  aiDraftConnectionReason: string | undefined;
  aiSaveVerifying: boolean;
  aiAnalyzing: boolean;
  aiProgressBannerVisible: boolean;
  aiBatchProgress: AiBatchProgressSnapshot | null;
  // @fields
}

export const aiFields = createFieldStore<AiState>(() => ({
    aiApiFormat: DEFAULT_AI_API_FORMAT,
    aiModel: DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT],
    aiBaseUrl: "",
    aiApiKey: "",
    aiDraftHasKey: false,
    aiHasKey: false,
    aiProfiles: [],
    aiActiveProfileId: null,
    aiProfileDraftId: null,
    aiProfileName: "",
    aiDescriptionEnabled: true,
    aiTagsEnabled: true,
    aiRatingEnabled: true,
    aiForceExistingTags: false,
    aiAnalysisSettings: toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS),
    aiLanguages: ["zh-CN"],
    aiConcurrencyLimit: 16,
    aiMaxAnalysisImageEdgePx: 2048,
    aiAutoAnalyzeEnabled: false,
    aiDisclaimerAccepted: false,
    aiConnectionState: "idle",
    aiDraftConnectionState: "idle",
    aiDraftConnectionReason: undefined,
    aiSaveVerifying: false,
    aiAnalyzing: false,
    aiProgressBannerVisible: true,
    aiBatchProgress: null,
    // @initial
}));

export const useAiField = aiFields.useField;
