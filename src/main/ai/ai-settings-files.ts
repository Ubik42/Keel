import { type AiApiFormat, DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS } from '../../shared/ai-endpoints';
import { type AiAnalysisSettings, DEFAULT_AI_ANALYSIS_SETTINGS } from '../../shared/ai-analysis-settings';
import { type AiReliabilitySettings, DEFAULT_AI_RELIABILITY_SETTINGS } from '../../shared/ai-reliability';
import { DEFAULT_AI_ANALYSIS_CONCURRENCY } from '../../shared/ai-concurrency';
import { DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX } from '../../shared/ai-analysis-image';
import { default as path } from 'node:path';
import { app, safeStorage } from 'electron';
import { type SyncServerRecord, type SyncBindingRecord } from '../library-request/sync';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, type Dirent, readdirSync } from 'node:fs';
import { type EmbeddingModelCatalog } from '../embedding/embedding-model-catalog';
import { type EmbeddingServiceCatalog } from '../embedding/embedding-service-registry';
import { type EmbeddingLibraryBinding, parseEmbeddingBindings } from '../embedding/embedding-library-binding';
import { type AiAnalysisPreferences, normalizeAiAnalysisPreferences } from './ai-analysis-preferences';
import { type AiProfileCatalog, emptyAiProfileCatalog, parseAiProfileCatalog, isAiProfileId, migrateAiProfileStorage, legacyAiConnectionProfile, summarizeAiProfiles, AiProfileStorageError, type AiConnectionProfileDraft, createAiProfileId, saveAiConnectionProfile as saveAiProfileInCatalog, AiProfileValidationError, activateAiProfile, deleteAiProfile, resolveAiCredential } from './ai-profile-store';
import { readAtomicJsonFile, writeAtomicJsonFile } from '../app/atomic-json-file';
import { type AiProfileTransactionIo, recoverAiProfileTransaction as recoverAiProfileTransactionFromJournal, type AiProfileCredentialMutation, commitAiProfileTransaction as commitAiProfileTransactionToJournal } from './ai-profile-transaction';
import { state } from '../main-state';
import { runAiProfileMigrationStartup } from './ai-profile-legacy-config';

/**
 * AI profiles, AI analysis settings, sync servers and embedding services stored as files in userData (split out of index.ts, P8).
 */
// ── AI Config ────────────────────────────────────────────────────────────

export interface AiConfig {
  apiFormat: AiApiFormat;
  model: string;
  /** Empty = official default for the selected API format. */
  baseUrl: string;
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  ratingEnabled: boolean;
  analysisSettings: AiAnalysisSettings;
  concurrencyLimit: number;
  /** Longest edge for images uploaded to analysis (default 2048 / 2K). */
  maxAnalysisImageEdgePx: number;
  reliabilitySettings: AiReliabilitySettings;
  languages: Array<"zh-CN" | "en" | "ja" | "ko">;
  autoAnalyzeEnabled: boolean;
  disclaimerAccepted: boolean;
}

export type LegacyAiConfig = Partial<AiConfig> & {
  provider?: string;
  language?: string;
  apiFormat?: string;
  languages?: unknown;
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  apiFormat: DEFAULT_AI_API_FORMAT,
  model: DEFAULT_AI_MODELS[DEFAULT_AI_API_FORMAT],
  baseUrl: "",
  descriptionEnabled: true,
  tagEnabled: true,
  ratingEnabled: true,
  analysisSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
  concurrencyLimit: DEFAULT_AI_ANALYSIS_CONCURRENCY,
  maxAnalysisImageEdgePx: DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  reliabilitySettings: { ...DEFAULT_AI_RELIABILITY_SETTINGS },
  languages: ["zh-CN", "en"],
  autoAnalyzeEnabled: false,
  disclaimerAccepted: false,
};

export function aiConfigPath(): string {
  return path.join(app.getPath("userData"), "ai-config.json");
}

export function aiProfilesPath(): string {
  return path.join(app.getPath("userData"), "ai-profiles.json");
}

export function aiAnalysisSettingsPath(): string {
  return path.join(app.getPath("userData"), "ai-analysis-settings.json");
}

export function aiProfileMigrationPath(): string {
  return path.join(app.getPath("userData"), "ai-profile-migration.json");
}

export function aiProfileTransactionPath(): string {
  return path.join(app.getPath("userData"), "ai-profile-transaction.json");
}

export function aiKeyPath(): string {
  return path.join(app.getPath("userData"), "ai-key.enc");
}

export function aiProfileKeyPath(id: string): string {
  return path.join(app.getPath("userData"), "ai-profile-keys", `${id}.bin`);
}

// ── Serpent-xffq: 同步服务器（全局）与库绑定持久化 ───────────────────
export function syncServersPath(): string {
  return path.join(app.getPath("userData"), "sync-servers.json");
}

export function syncBindingsPath(): string {
  return path.join(app.getPath("userData"), "sync-bindings.json");
}

export function readSyncServers(): SyncServerRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(syncServersPath(), "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as SyncServerRecord[];
  } catch {
    // 首次运行。
  }
  return [];
}

export function writeSyncServers(servers: SyncServerRecord[]): void {
  writeFileSync(syncServersPath(), JSON.stringify(servers, null, 2), "utf-8");
}

export function readSyncBindings(): Record<string, SyncBindingRecord> {
  try {
    const parsed = JSON.parse(readFileSync(syncBindingsPath(), "utf-8")) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, SyncBindingRecord>;
  } catch {
    // 首次运行。
  }
  return {};
}

export function writeSyncBindings(bindings: Record<string, SyncBindingRecord>): void {
  writeFileSync(syncBindingsPath(), JSON.stringify(bindings, null, 2), "utf-8");
}

export function embeddingModelsPath(): string {
  return path.join(app.getPath("userData"), "embedding-models.json");
}

export function readEmbeddingModels(): unknown {
  try {
    return JSON.parse(readFileSync(embeddingModelsPath(), "utf-8")) as unknown;
  } catch {
    return null;
  }
}

export function writeEmbeddingModels(catalog: EmbeddingModelCatalog): void {
  writeFileSync(embeddingModelsPath(), JSON.stringify(catalog, null, 2), "utf-8");
}

export function embeddingServicesPath(): string {
  return path.join(app.getPath("userData"), "embedding-services.json");
}

export function readEmbeddingServices(): unknown {
  try {
    return JSON.parse(readFileSync(embeddingServicesPath(), "utf-8")) as unknown;
  } catch {
    return null;
  }
}

export function writeEmbeddingServices(catalog: EmbeddingServiceCatalog): void {
  writeFileSync(embeddingServicesPath(), JSON.stringify(catalog, null, 2), "utf-8");
}

export function embeddingBindingsPath(): string {
  return path.join(app.getPath("userData"), "embedding-library-bindings.json");
}

export function readEmbeddingBindings(): Record<string, EmbeddingLibraryBinding> {
  try {
    return parseEmbeddingBindings(JSON.parse(readFileSync(embeddingBindingsPath(), "utf-8")) as unknown);
  } catch {
    return {};
  }
}

export function writeEmbeddingBindings(bindings: Record<string, EmbeddingLibraryBinding>): void {
  writeFileSync(embeddingBindingsPath(), JSON.stringify(bindings, null, 2), "utf-8");
}

export function embeddingServiceKeyPath(id: string): string {
  return path.join(app.getPath("userData"), "embedding-service-keys", `${id}.bin`);
}

export function readEmbeddingServiceKey(id: string): string | null {
  try {
    return safeStorage.decryptString(readFileSync(embeddingServiceKeyPath(id)));
  } catch {
    return null;
  }
}

export function writeEmbeddingServiceKey(id: string, apiKey: string): void {
  const filePath = embeddingServiceKeyPath(id);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, safeStorage.encryptString(apiKey));
}

export function deleteEmbeddingServiceKey(id: string): void {
  rmSync(embeddingServiceKeyPath(id), { force: true });
}

export function resolveSyncServerCredentials(serverId: string): {
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls: boolean;
} | null {
  const server = readSyncServers().find((entry) => entry.id === serverId);
  if (!server) return null;
  let password: string | undefined;
  if (server.passwordEncrypted) {
    try {
      password = safeStorage.decryptString(Buffer.from(server.passwordEncrypted, "base64"));
    } catch {
      password = undefined;
    }
  }
  return {
    baseUrl: server.baseUrl,
    username: server.username,
    password,
    allowInsecureTls: server.allowInsecureTls,
  };
}

export function normalizeLegacyAiAnalysisPreferences(
  parsed: LegacyAiConfig | null,
): AiAnalysisPreferences {
  return normalizeAiAnalysisPreferences(parsed);
}

export function readAiProfileCatalog(required = false): AiProfileCatalog {
  recoverAiProfileTransactionIfPresent();
  const raw = readAtomicJsonFile(aiProfilesPath());
  if (raw === undefined) {
    if (required) throw new Error("AI profile catalog is missing after migration.");
    return emptyAiProfileCatalog();
  }
  return parseAiProfileCatalog(JSON.parse(raw) as unknown);
}

export function aiProfileTransactionIo(): AiProfileTransactionIo {
  return {
    readJournal: () => readAtomicJsonFile(aiProfileTransactionPath()) ?? null,
    writeJournal: (contents) => writeAtomicJsonFile(aiProfileTransactionPath(), contents),
    writeCredential: (profileId, encryptedCredentialBase64) => {
      const filename = aiProfileKeyPath(profileId);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, Buffer.from(encryptedCredentialBase64, "base64"), {
        mode: 0o600,
        flush: true,
      });
    },
    deleteCredential: (profileId) => deleteAiProfileCredential(profileId),
    writeCatalog: (catalog) => {
      writeAtomicJsonFile(aiProfilesPath(), JSON.stringify(catalog, null, 2));
    },
    deleteJournal: () => rmSync(aiProfileTransactionPath(), { force: true }),
  };
}

export function recoverAiProfileTransactionIfPresent(): void {
  recoverAiProfileTransactionFromJournal(aiProfileTransactionIo());
}

export function commitAiProfileCatalogTransaction(
  profileId: string,
  catalog: AiProfileCatalog,
  credential: AiProfileCredentialMutation,
): void {
  commitAiProfileTransactionToJournal({
    version: 1,
    profileId,
    credential,
    catalog,
  }, aiProfileTransactionIo());
}

export function readAiAnalysisPreferences(): AiAnalysisPreferences {
  const raw = readAtomicJsonFile(aiAnalysisSettingsPath());
  if (raw === undefined) return normalizeLegacyAiAnalysisPreferences(null);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI analysis preferences have an invalid structure.");
  }
  return normalizeAiAnalysisPreferences(parsed);
}

export function hasAiProfileCredential(profileId: string): boolean {
  return existsSync(aiProfileKeyPath(profileId));
}

export function readAiProfileCredential(profileId: string): string {
  try {
    return safeStorage.decryptString(readFileSync(aiProfileKeyPath(profileId)));
  } catch {
    throw new Error("AI API key not configured or could not be decrypted.");
  }
}

export function writeAiProfileCredential(profileId: string, apiKey: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable.");
  }
  const filename = aiProfileKeyPath(profileId);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, safeStorage.encryptString(apiKey), { mode: 0o600, flush: true });
}

export function deleteAiProfileCredential(profileId: string): void {
  rmSync(aiProfileKeyPath(profileId), { force: true });
}

export function cleanupOrphanAiProfileCredentials(catalog: AiProfileCatalog): void {
  const directory = path.join(app.getPath("userData"), "ai-profile-keys");
  if (!existsSync(directory)) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    state.logger?.error("ai.profile-keys.orphan-cleanup", error);
    return;
  }

  const knownProfileIds = new Set(catalog.profiles.map((profile) => profile.id));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) continue;
    const profileId = entry.name.slice(0, -".bin".length);
    if (!isAiProfileId(profileId) || knownProfileIds.has(profileId)) continue;
    try {
      rmSync(path.join(directory, entry.name), { force: true });
    } catch (error) {
      // Migration is still usable; this runs on every load so failed removals retry.
      state.logger?.error("ai.profile-keys.orphan-cleanup", error);
    }
  }
}

export function ensureAiProfileMigration(): void {
  recoverAiProfileTransactionIfPresent();
  const markerPath = aiProfileMigrationPath();
  const markerContents = readAtomicJsonFile(markerPath);
  let markerVersion: number | null = null;
  if (markerContents !== undefined) {
    const marker: unknown = JSON.parse(markerContents);
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
      throw new Error("AI profile migration marker has an invalid structure.");
    }
    const version = (marker as { version?: unknown }).version;
    if (version !== 1) throw new Error("AI profile migration marker has an unsupported version.");
    markerVersion = version;
  }

  runAiProfileMigrationStartup<LegacyAiConfig, void>({
    markerVersion,
    readLegacyConfig: () => readFileSync(aiConfigPath()),
    recoverCompletedMigration: () => {
      const catalog = readAiProfileCatalog(true);
      cleanupOrphanAiProfileCredentials(catalog);
      cleanupLegacyAiConfig();
    },
    migrate: (legacy) => {
      const legacyKeyExists = existsSync(aiKeyPath());
      migrateAiProfileStorage({
        markerExists: () => false,
        readCatalog: () => existsSync(aiProfilesPath()) ? readAiProfileCatalog() : null,
        cleanupOrphanCredentials: cleanupOrphanAiProfileCredentials,
        readPreferences: () => {
          if (!existsSync(aiAnalysisSettingsPath())) return null;
          return JSON.parse(readFileSync(aiAnalysisSettingsPath(), "utf-8")) as unknown;
        },
        legacyProfile: legacy !== null || legacyKeyExists
          ? legacyAiConnectionProfile({
              apiFormat: legacy?.apiFormat,
              provider: legacy?.provider,
              model: legacy?.model,
              baseUrl: legacy?.baseUrl,
            })
          : null,
        readLegacyCredential: () => legacyKeyExists
          ? safeStorage.decryptString(readFileSync(aiKeyPath()))
          : null,
        writeCredential: writeAiProfileCredential,
        verifyCredential: (profileId) => { readAiProfileCredential(profileId); },
        defaultPreferences: normalizeLegacyAiAnalysisPreferences(null),
        normalizeLegacyPreferences: () => legacy
          ? normalizeLegacyAiAnalysisPreferences(legacy)
          : null,
        writeCatalog: (catalog) => {
          writeAtomicJsonFile(aiProfilesPath(), JSON.stringify(catalog, null, 2));
        },
        writePreferences: (preferences) => {
          writeAtomicJsonFile(aiAnalysisSettingsPath(), JSON.stringify(preferences, null, 2));
        },
        writeMarker: () => {
          writeAtomicJsonFile(markerPath, JSON.stringify({ version: 1 }, null, 2));
        },
        cleanupLegacy: cleanupLegacyAiConfig,
      });
    },
  });
}

export function cleanupLegacyAiConfig(): void {
  try {
    rmSync(aiConfigPath(), { force: true });
    rmSync(aiKeyPath(), { force: true });
  } catch (error) {
    state.logger?.error("ai.profile-migration.cleanup", error);
  }
}

export function loadAiConfig(): AiConfig & {
  hasKey: boolean;
  activeProfileId: string | null;
  profiles: ReturnType<typeof summarizeAiProfiles>;
} {
  try {
    ensureAiProfileMigration();
    const catalog = readAiProfileCatalog();
    const profile = catalog.profiles.find((item) => item.id === catalog.activeProfileId);
    const preferences = readAiAnalysisPreferences();
    return {
      ...(profile ?? {
        apiFormat: DEFAULT_AI_CONFIG.apiFormat,
        model: DEFAULT_AI_CONFIG.model,
        baseUrl: DEFAULT_AI_CONFIG.baseUrl,
      }),
      ...preferences,
      activeProfileId: profile?.id ?? null,
      profiles: summarizeAiProfiles(catalog, hasAiProfileCredential),
      hasKey: profile ? hasAiProfileCredential(profile.id) : false,
    };
  } catch (error) {
    if (error instanceof AiProfileStorageError) throw error;
    throw new AiProfileStorageError(error);
  }
}

export function saveAiConfig(config: AiConfig): void {
  ensureAiProfileMigration();
  const preferences: AiAnalysisPreferences = {
    descriptionEnabled: config.descriptionEnabled,
    tagEnabled: config.tagEnabled,
    ratingEnabled: config.ratingEnabled,
    analysisSettings: config.analysisSettings,
    concurrencyLimit: config.concurrencyLimit,
    maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
    reliabilitySettings: config.reliabilitySettings,
    languages: config.languages,
    autoAnalyzeEnabled: config.autoAnalyzeEnabled,
    disclaimerAccepted: config.disclaimerAccepted,
  };
  writeAtomicJsonFile(aiAnalysisSettingsPath(), JSON.stringify(preferences, null, 2));
}

export function saveAiConnectionProfile(
  draft: AiConnectionProfileDraft & { apiKey?: string; clearCredential?: boolean },
): string {
  ensureAiProfileMigration();
  const catalog = readAiProfileCatalog();
  const profileId = draft.id ?? createAiProfileId();
  const next = saveAiProfileInCatalog(catalog, { ...draft, id: profileId });
  const key = draft.apiKey?.trim();
  let credential: AiProfileCredentialMutation = { kind: "preserve" };
  if (key) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable.");
    }
    credential = {
      kind: "write",
      encryptedCredentialBase64: safeStorage.encryptString(key).toString("base64"),
    };
  } else if (draft.clearCredential) {
    credential = { kind: "delete" };
  }
  commitAiProfileCatalogTransaction(profileId, next, credential);
  return profileId;
}

export function activateAiConnectionProfile(profileId: string): void {
  ensureAiProfileMigration();
  if (!hasAiProfileCredential(profileId)) {
    throw new AiProfileValidationError("AI profile has no saved credential.");
  }
  readAiProfileCredential(profileId);
  const next = activateAiProfile(readAiProfileCatalog(), profileId);
  commitAiProfileCatalogTransaction(profileId, next, { kind: "preserve" });
}

export function deleteAiConnectionProfile(profileId: string): void {
  ensureAiProfileMigration();
  const catalog = readAiProfileCatalog();
  const next = deleteAiProfile(catalog, profileId);
  commitAiProfileCatalogTransaction(profileId, next, { kind: "delete" });
}

export function getDecryptedApiKey(): string {
  const activeProfileId = loadAiConfig().activeProfileId;
  return resolveAiCredential(
    activeProfileId,
    hasCompletedAiProfileMigration(),
    readAiProfileCredential,
    () => {
      // Keep the previous installation usable if migration cannot finish
      // because the new profile files or secure storage are temporarily unavailable.
      try {
        return safeStorage.decryptString(readFileSync(aiKeyPath()));
      } catch {
        throw new Error("AI API key not configured.");
      }
    },
  );
}

export function hasCompletedAiProfileMigration(): boolean {
  try {
    const marker = JSON.parse(readFileSync(aiProfileMigrationPath(), "utf-8")) as {
      version?: unknown;
    };
    return marker.version === 1;
  } catch {
    return false;
  }
}

export function getDecryptedProfileApiKey(profileId: string): string {
  try {
    if (!readAiProfileCatalog().profiles.some((profile) => profile.id === profileId)) {
      throw new Error("AI profile does not exist.");
    }
    return readAiProfileCredential(profileId);
  } catch (error) {
    if (error instanceof AiProfileStorageError) throw error;
    throw new AiProfileStorageError(error);
  }
}
