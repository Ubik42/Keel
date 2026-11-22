import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { AppLocale } from "../i18n/types";
import { type AiAnalysisSettingsWire } from "../../shared/ai-analysis-settings";
import { type AiApiFormat } from "../../shared/ai-endpoints";
import { AI_CONNECTION_HEARTBEAT_MS, shouldRunAiConnectionHeartbeat } from "../ai-connection-heartbeat";
import { isCurrentAiConnectionProbe } from "../ai-connection-probe-guard";
import { toMessage } from "../error-utils";
import { requestConfirmation } from "../local-confirmation";
import { aiFields, type AiState } from "../stores/ai-store";
import { type DialogsState } from "../stores/dialogs-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { useCallback, useEffect } from "react";

export interface UseAiConfigActionsDeps {
  aiProfiles: AiState["aiProfiles"];
  aiProfileDraftId: AiState["aiProfileDraftId"];
  aiApiKey: AiState["aiApiKey"];
  aiActiveProfileId: AiState["aiActiveProfileId"];
  aiApiFormat: AiState["aiApiFormat"];
  aiModel: AiState["aiModel"];
  aiBaseUrl: AiState["aiBaseUrl"];
  api: KeelLibraryApi | undefined;
  t: TranslateFn;
  aiDraftHasKey: AiState["aiDraftHasKey"];
  setAiDraftConnectionState: Dispatch<SetStateAction<AiState["aiDraftConnectionState"]>>;
  setAiDraftConnectionReason: Dispatch<SetStateAction<AiState["aiDraftConnectionReason"]>>;
  aiVerifiedFingerprintRef: RefObject<string | null>;
  setAiConnectionState: Dispatch<SetStateAction<AiState["aiConnectionState"]>>;
  matchingDraftAiProfileId: () => string | undefined;
  locale: AppLocale;
  setAiDraftHasKey: Dispatch<SetStateAction<AiState["aiDraftHasKey"]>>;
  setAiHasKey: Dispatch<SetStateAction<AiState["aiHasKey"]>>;
  aiConfigPersistDraftRef: RefObject<{ apiFormat: AiApiFormat; model: string; baseUrl: string; apiKey: string; hasKey: boolean; descriptionEnabled: boolean; tagsEnabled: boolean; ratingEnabled: boolean; forceExistingTags: boolean; analysisSettings: AiAnalysisSettingsWire; languages: Array<"zh-CN" | "en" | "ja" | "ko">; concurrencyLimit: number; maxAnalysisImageEdgePx: number; autoAnalyzeEnabled: boolean; disclaimerAccepted: boolean; }>;
  setError: (text: string | null) => void;
  setAiApiKey: Dispatch<SetStateAction<AiState["aiApiKey"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  setAiSaveVerifying: Dispatch<SetStateAction<AiState["aiSaveVerifying"]>>;
  setAiMaxAnalysisImageEdgePx: Dispatch<SetStateAction<AiState["aiMaxAnalysisImageEdgePx"]>>;
  setAiConcurrencyLimit: Dispatch<SetStateAction<AiState["aiConcurrencyLimit"]>>;
  aiAnalysisSettings: AiState["aiAnalysisSettings"];
  setAiAnalysisSettings: Dispatch<SetStateAction<AiState["aiAnalysisSettings"]>>;
  aiProfileName: AiState["aiProfileName"];
  setAiProfileDraftId: Dispatch<SetStateAction<AiState["aiProfileDraftId"]>>;
  setAiProfileName: Dispatch<SetStateAction<AiState["aiProfileName"]>>;
  aiAutoConnectAttemptedRef: RefObject<boolean>;
  setAiProfiles: Dispatch<SetStateAction<AiState["aiProfiles"]>>;
  updateAiActiveProfileId: (profileId: string | null) => void;
  setAiApiFormat: Dispatch<SetStateAction<AiState["aiApiFormat"]>>;
  setAiModel: Dispatch<SetStateAction<AiState["aiModel"]>>;
  setAiBaseUrl: Dispatch<SetStateAction<AiState["aiBaseUrl"]>>;
  loadAiConfig: () => Promise<void>;
  appSettingsOpen: DialogsState["appSettingsOpen"];
  appSettingsCategory: DialogsState["appSettingsCategory"];
  aiHasKey: AiState["aiHasKey"];
  librarySettingsOpen: DialogsState["librarySettingsOpen"];
  library: SessionState["library"];
  setGitignoreContent: Dispatch<SetStateAction<DialogsState["gitignoreContent"]>>;
  aiConnectionProbeGenerationRef: RefObject<number>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useAiConfigActions({ aiProfiles, aiProfileDraftId, aiApiKey, aiActiveProfileId, aiApiFormat, aiModel, aiBaseUrl, api, t, aiDraftHasKey, setAiDraftConnectionState, setAiDraftConnectionReason, aiVerifiedFingerprintRef, setAiConnectionState, matchingDraftAiProfileId, locale, setAiDraftHasKey, setAiHasKey, aiConfigPersistDraftRef, setError, setAiApiKey, setNotice, setAiSaveVerifying, setAiMaxAnalysisImageEdgePx, setAiConcurrencyLimit, aiAnalysisSettings, setAiAnalysisSettings, aiProfileName, setAiProfileDraftId, setAiProfileName, aiAutoConnectAttemptedRef, setAiProfiles, updateAiActiveProfileId, setAiApiFormat, setAiModel, setAiBaseUrl, loadAiConfig, appSettingsOpen, appSettingsCategory, aiHasKey, librarySettingsOpen, library, setGitignoreContent, aiConnectionProbeGenerationRef }: UseAiConfigActionsDeps) {

  const testAiConnectionFromDialog = useCallback(async (): Promise<{
    success: boolean;
    reason?: string;
  }> => {
    const selectedProfile = aiProfiles.find((profile) => profile.id === aiProfileDraftId);
    const testsActiveStoredProfile = !aiApiKey.trim()
      && aiProfileDraftId !== null
      && aiProfileDraftId === aiActiveProfileId
      && selectedProfile?.hasCredential === true
      && selectedProfile.apiFormat === aiApiFormat
      && selectedProfile.model === aiModel.trim()
      && selectedProfile.baseUrl === aiBaseUrl.trim();
    if (!api) return { success: false, reason: t("aiConfig.testFailed") };
    if (!aiApiKey.trim() && !aiDraftHasKey) {
      setAiDraftConnectionState("disconnected");
      setAiDraftConnectionReason(t("aiConfig.testFailed"));
      aiVerifiedFingerprintRef.current = null;
      return { success: false, reason: t("aiConfig.testFailed") };
    }
    setAiDraftConnectionState("connecting");
    setAiDraftConnectionReason(undefined);
    if (testsActiveStoredProfile) {
      setAiConnectionState("connecting");
    }
    const storedProfileId = aiApiKey.trim()
      ? undefined
      : matchingDraftAiProfileId();
    const fingerprint = [
      aiApiFormat,
      aiModel.trim(),
      aiBaseUrl.trim(),
      aiApiKey.trim() || (aiDraftHasKey ? "__stored__" : ""),
    ].join("\u0001");
    const result = await api.testAiConnection({
      apiFormat: aiApiFormat,
      model: aiModel.trim(),
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      baseUrl: aiBaseUrl.trim() || undefined,
      ...(storedProfileId ? { profileId: storedProfileId } : {}),
    });
    if (!result.ok) {
      const reason = toMessage(
        result.error,
        t("aiConfig.testFailed"),
        locale,
      );
      setAiDraftConnectionState("error");
      setAiDraftConnectionReason(reason);
      if (testsActiveStoredProfile) {
        setAiConnectionState("error");
      }
      aiVerifiedFingerprintRef.current = null;
      return { success: false, reason };
    }
    if (result.value.success) {
      setAiDraftConnectionState("connected");
      setAiDraftConnectionReason(undefined);
      if (testsActiveStoredProfile) {
        setAiConnectionState("connected");
      }
      aiVerifiedFingerprintRef.current = fingerprint;
      // Typed key is not on disk until save — only mark ready when stored.
      if (aiDraftHasKey || !aiApiKey.trim()) {
        setAiDraftHasKey(true);
        if (aiProfileDraftId === aiActiveProfileId) setAiHasKey(true);
      } else {
        // Probe OK with unsaved key: refresh from disk (still false until save).
        void api.getAiConfig().then((cfg) => {
          if (cfg.ok) setAiHasKey(cfg.value.hasKey);
        });
      }
      return { success: true };
    }
    const reason = result.value.reason ?? t("aiConfig.testFailed");
    setAiDraftConnectionState("error");
    setAiDraftConnectionReason(reason);
    if (testsActiveStoredProfile) {
      setAiConnectionState("error");
    }
    aiVerifiedFingerprintRef.current = null;
    return { success: false, reason };
  }, [
    aiApiFormat,
    aiApiKey,
    aiActiveProfileId,
    aiModel,
    aiBaseUrl,
    aiDraftHasKey,
    aiProfiles,
    aiProfileDraftId,
    matchingDraftAiProfileId,
    api,
    locale,
    t, setAiConnectionState, setAiDraftConnectionReason, setAiDraftConnectionState, setAiDraftHasKey, setAiHasKey, aiVerifiedFingerprintRef]);

  type AiConfigPersistOverrides = {
    maxAnalysisImageEdgePx?: number;
    concurrencyLimit?: number;
    analysisSettings?: AiAnalysisSettingsWire;
  };

  async function persistAiConfig(
    overrides: AiConfigPersistOverrides = {},
    options: {
      showNotice?: boolean;
      clearApiKeyDraft?: boolean;
      verifyConnection?: boolean;
    } = {},
  ): Promise<boolean> {
    const {
      showNotice = true,
      clearApiKeyDraft = false,
      verifyConnection = false,
    } = options;
    if (!api) return false;
    const draft = aiConfigPersistDraftRef.current;
    const result = await api.setAiConfig({
      enabledFields: {
        description: draft.descriptionEnabled,
        tags: draft.tagsEnabled,
        rating: draft.ratingEnabled,
      },
      analysisSettings: {
        ...(overrides.analysisSettings ?? draft.analysisSettings),
        forceExistingTags: draft.forceExistingTags,
      },
      languages: draft.languages.length > 0 ? [draft.languages[0]!] : ["zh-CN"],
      concurrencyLimit: overrides.concurrencyLimit ?? draft.concurrencyLimit,
      maxAnalysisImageEdgePx:
        overrides.maxAnalysisImageEdgePx ?? draft.maxAnalysisImageEdgePx,
      autoAnalyzeEnabled: draft.autoAnalyzeEnabled,
      disclaimerAccepted: draft.disclaimerAccepted,
    });
    if (!result.ok) {
      if (showNotice) {
        setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      }
      return false;
    }
    if (clearApiKeyDraft) setAiApiKey("");
    if (showNotice) setNotice(t("toast.aiConfigSaved"));
    if (verifyConnection) {
      setAiSaveVerifying(true);
      try {
        await testAiConnectionFromDialog();
      } finally {
        setAiSaveVerifying(false);
      }
    }
    return true;
  }

  function commitAiMaxAnalysisImageEdgePx(value: number) {
    setAiMaxAnalysisImageEdgePx(value);
    aiConfigPersistDraftRef.current.maxAnalysisImageEdgePx = value;
    void persistAiConfig({ maxAnalysisImageEdgePx: value });
  }

  function commitAiConcurrencyLimit(value: number) {
    setAiConcurrencyLimit(value);
    aiConfigPersistDraftRef.current.concurrencyLimit = value;
    void persistAiConfig({ concurrencyLimit: value });
  }

  function commitAiAnalysisSettingsPatch(
    patch: Partial<AiAnalysisSettingsWire>,
  ) {
    const next = { ...aiAnalysisSettings, ...patch };
    setAiAnalysisSettings(next);
    aiConfigPersistDraftRef.current.analysisSettings = next;
    void persistAiConfig({ analysisSettings: next });
  }

  async function saveAiConfig() {
    if (!api || !aiModel.trim()) return;
    const apiKey = aiApiKey.trim();
    const profileName = aiProfileName.trim() || t("aiConfig.newProfileName");
    const savedProfile = await api.saveAiProfile({
      ...(aiProfileDraftId ? { id: aiProfileDraftId } : {}),
      name: profileName,
      apiFormat: aiApiFormat,
      model: aiModel.trim(),
      baseUrl: aiBaseUrl.trim(),
      ...(apiKey ? { apiKey } : {}),
    });
    if (!savedProfile.ok) {
      setError(toMessage(savedProfile.error, t("toast.aiConfigSaveFailed"), locale));
      return;
    }
    setAiProfileDraftId(savedProfile.value.id);
    setAiProfileName(profileName);
    setAiApiKey("");
    setAiDraftHasKey(aiDraftHasKey || Boolean(apiKey));
    if (savedProfile.value.id === aiActiveProfileId) {
      setAiHasKey(aiDraftHasKey || Boolean(apiKey));
    }
    setAiDraftConnectionState("idle");
    setAiDraftConnectionReason(undefined);
    aiVerifiedFingerprintRef.current = null;
    setNotice(t("toast.aiConfigSaved"));
    if (savedProfile.value.id === aiActiveProfileId) {
      setAiConnectionState("idle");
      aiAutoConnectAttemptedRef.current = false;
    }

    const previousActiveProfileId = aiActiveProfileId;
    const refreshed = await api.getAiConfig();
    if (refreshed.ok) {
      setAiProfiles(refreshed.value.profiles);
      updateAiActiveProfileId(refreshed.value.activeProfileId);
      setAiHasKey(refreshed.value.hasKey);
      if (
        refreshed.value.activeProfileId === savedProfile.value.id
        && previousActiveProfileId !== savedProfile.value.id
      ) {
        setAiConnectionState("idle");
        aiAutoConnectAttemptedRef.current = false;
      }
      const saved = refreshed.value.profiles.find((profile) => profile.id === savedProfile.value.id);
      if (saved) setAiDraftHasKey(saved.hasCredential);
    }
  }

  function beginNewAiProfile() {
    setAiProfileDraftId(null);
    setAiProfileName(t("aiConfig.newProfileName"));
    setAiApiKey("");
    setAiDraftHasKey(false);
    setAiDraftConnectionState("disconnected");
    setAiDraftConnectionReason(undefined);
    aiVerifiedFingerprintRef.current = null;
  }

  function selectAiProfile(id: string) {
    if (!id) {
      beginNewAiProfile();
      return;
    }
    const profile = aiProfiles.find((item) => item.id === id);
    if (!profile) return;
    setAiProfileDraftId(profile.id);
    setAiProfileName(profile.name);
    setAiApiFormat(profile.apiFormat);
    setAiModel(profile.model);
    setAiBaseUrl(profile.baseUrl);
    setAiApiKey("");
    setAiDraftHasKey(profile.hasCredential);
    setAiDraftConnectionState("idle");
    setAiDraftConnectionReason(undefined);
    aiVerifiedFingerprintRef.current = null;
  }

  async function activateAiProfile(id: string) {
    if (!api) return;
    const result = await api.activateAiProfile({ id });
    if (!result.ok) {
      setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      return;
    }
    setAiApiKey("");
    setAiConnectionState("idle");
    aiAutoConnectAttemptedRef.current = false;
    await loadAiConfig();
  }

  async function removeAiProfile(id: string) {
    if (!api) return;
    if (!(await requestConfirmation(t("aiConfig.deleteProfileConfirm"), true))) return;
    const result = await api.deleteAiProfile({ id });
    if (!result.ok) {
      setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      return;
    }
    setAiApiKey("");
    await loadAiConfig();
  }

  async function clearAiProfileCredential() {
    if (!api || !aiProfileDraftId) return;
    if (!(await requestConfirmation(t("aiConfig.clearApiKeyConfirm"), true))) return;
    const result = await api.saveAiProfile({
      id: aiProfileDraftId,
      name: aiProfileName.trim(),
      apiFormat: aiApiFormat,
      model: aiModel.trim(),
      baseUrl: aiBaseUrl.trim(),
      clearCredential: true,
    });
    if (!result.ok) {
      setError(toMessage(result.error, t("toast.aiConfigSaveFailed"), locale));
      return;
    }
    setAiApiKey("");
    setAiDraftHasKey(false);
    setAiDraftConnectionState("disconnected");
    setAiDraftConnectionReason(undefined);
    const refreshed = await api.getAiConfig();
    if (refreshed.ok) {
      setAiProfiles(refreshed.value.profiles);
      updateAiActiveProfileId(refreshed.value.activeProfileId);
      setAiHasKey(refreshed.value.hasKey);
    }
  }

  useEffect(() => {
    const aiSettingsOpen =
      appSettingsOpen && appSettingsCategory === "ai";
    if (!aiSettingsOpen) {
      aiAutoConnectAttemptedRef.current = false;
      return;
    }
    if (!aiHasKey || aiAutoConnectAttemptedRef.current
      || aiProfileDraftId !== aiActiveProfileId) return;
    aiAutoConnectAttemptedRef.current = true;
    void testAiConnectionFromDialog();
  }, [
    appSettingsOpen,
    appSettingsCategory,
    aiHasKey,
    aiActiveProfileId,
    aiProfileDraftId,
    testAiConnectionFromDialog, aiAutoConnectAttemptedRef]);

  useEffect(() => {
    if (!appSettingsOpen || appSettingsCategory !== "ai") return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when AI settings surface opens
  }, [appSettingsOpen, appSettingsCategory]);

  useEffect(() => {
    if (!librarySettingsOpen || !api || !library) return;
    const libraryId = library.libraryId;
    void api.getGitignore({ libraryId }).then((gitignoreResult) => {
      if (sessionFields.get("library")?.libraryId !== libraryId) return;
      if (gitignoreResult.ok) setGitignoreContent(gitignoreResult.value.content);
    });
  }, [librarySettingsOpen, api, library, setGitignoreContent]);

  const probeStoredAiConnection = useCallback(async () => {
    const generation = ++aiConnectionProbeGenerationRef.current;
    const capturedProfileId = aiActiveProfileId;
    const isCurrentProbe = () => isCurrentAiConnectionProbe({
      capturedGeneration: generation,
      latestGeneration: aiConnectionProbeGenerationRef.current,
      capturedProfileId,
      activeProfileId: aiFields.get("aiActiveProfileId"),
    });
    if (!api) return;
    if (!shouldRunAiConnectionHeartbeat(aiHasKey)) {
      setAiConnectionState("disconnected");
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    setAiConnectionState((prev) =>
      prev === "connected" || prev === "connecting" ? prev : "connecting",
    );
    const cfg = await api.getAiConfig();
    if (!isCurrentProbe()) return;
    if (!cfg.ok || !cfg.value.hasKey || !cfg.value.apiFormat || !cfg.value.model) {
      setAiConnectionState("disconnected");
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    if (cfg.value.activeProfileId !== capturedProfileId) return;
    const result = await api.testAiConnection({
      apiFormat: cfg.value.apiFormat,
      model: cfg.value.model,
      baseUrl: cfg.value.baseUrl.trim() || undefined,
      ...(capturedProfileId ? { profileId: capturedProfileId } : {}),
    });
    if (!isCurrentProbe()) return;
    if (!result.ok) {
      setAiConnectionState("error");
      aiVerifiedFingerprintRef.current = null;
      return;
    }
    if (result.value.success) {
      setAiConnectionState("connected");
      aiVerifiedFingerprintRef.current = [
        cfg.value.apiFormat,
        cfg.value.model.trim(),
        cfg.value.baseUrl.trim(),
        "__stored__",
      ].join("\u0001");
      return;
    }
    setAiConnectionState("error");
    aiVerifiedFingerprintRef.current = null;
  }, [api, aiActiveProfileId, aiHasKey, setAiConnectionState, aiConnectionProbeGenerationRef, aiVerifiedFingerprintRef]);

  useEffect(() => {
    if (!shouldRunAiConnectionHeartbeat(aiHasKey)) {
      return;
    }
    queueMicrotask(() => {
      void probeStoredAiConnection();
    });
    const timer = window.setInterval(() => {
      void probeStoredAiConnection();
    }, AI_CONNECTION_HEARTBEAT_MS);
    const onFocus = () => {
      void probeStoredAiConnection();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [aiHasKey, probeStoredAiConnection]);

  async function fetchAiModelsFromDialog(): Promise<{
    models: string[];
    reason?: string;
  }> {
    if (!api) return { models: [], reason: t("aiConfig.fetchModelsFailed") };
    if (!aiApiKey.trim() && !aiDraftHasKey) {
      return { models: [], reason: t("aiConfig.fetchModelsFailed") };
    }
    const storedProfileId = aiApiKey.trim()
      ? undefined
      : matchingDraftAiProfileId();
    const result = await api.listAiModels({
      apiFormat: aiApiFormat,
      ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      baseUrl: aiBaseUrl.trim() || undefined,
      ...(storedProfileId ? { profileId: storedProfileId } : {}),
    });
    if (!result.ok) {
      return {
        models: [],
        reason: toMessage(
          result.error,
          t("aiConfig.fetchModelsFailed"),
          locale,
        ),
      };
    }
    return {
      models: result.value.models,
      reason: result.value.reason,
    };
  }
  return { beginNewAiProfile, selectAiProfile, activateAiProfile, removeAiProfile, clearAiProfileCredential, commitAiConcurrencyLimit, commitAiMaxAnalysisImageEdgePx, commitAiAnalysisSettingsPatch, probeStoredAiConnection, saveAiConfig, testAiConnectionFromDialog, fetchAiModelsFromDialog };
}
