import { type NetworkMetadataSourceFingerprint, type NetworkMetadataCacheEvent } from './library/network-metadata-cache';
import type { SourceSnapshot } from './library/library-fs';
import { type HistoryPolicy, type HistorySource, type HistoryEntryState, type HistoryRecipe, type HistoryDirection, type HistoryStatus } from './library/operation-history';
import { type EntityAppearance } from '../shared/entity-appearance';
import type { ModelThumbnailRendererInput, ModelThumbnailRenderOutcome, MediaAutoRepairComponent, SpawnFunction } from './media/media-process';
import { type LibraryStorageKind } from './library/network-storage';
import { type Stats, type BigIntStats, watch } from 'node:fs';
import { type DnsLookup, type PinnedHttpTransport } from './library/secure-http-download';
import { type LibraryChangedEvent, type ExportProgressEvent, type ImportProgressEvent, type DeleteProgressEvent } from '../shared/protocol/responses';
import { type opendir as opendirAsync } from 'node:fs/promises';
import { type RawImageMetadataParser } from './media/raw-image-metadata';
import { type AssetSummary } from '../shared/asset-types';

/**
 * Row, manifest, history and option types shared by the Library Service and its method modules.
 */
export interface RawMetadataBackfillAdmissionState {
  token: string;
  cursorAssetId: string | null;
  exhausted: boolean;
  /** Durable write time, exposed for diagnostics/tests without affecting admission. */
  updatedAt?: string;
}

// sharp is an optional N-API dependency (no rebuild needed for Electron).
// The Worker loads it lazily so it can still start if sharp is missing.
export interface SharpModule {
  (input: string | Buffer, options?: {
    animated?: boolean;
    page?: number;
    pages?: number;
    failOn?: 'warning' | 'error' | 'none';
    sequentialRead?: boolean;
    limitInputPixels?: number | false;
  }): SharpInstance;
  cache?(options: boolean | { files?: number; memory?: number; items?: number }): unknown;
  concurrency?(threads?: number): number;
}

export interface SharpInstance {
  metadata(): Promise<{
    width?: number;
    height?: number;
    format?: string;
    orientation?: number;
    channels?: number;
    hasAlpha?: boolean;
    pages?: number;
    delay?: number[];
    loop?: number;
    space?: string;
    hasProfile?: boolean;
    icc?: Buffer;
  }>;
  rotate(): SharpInstance;
  toColourspace(colourspace: 'srgb'): SharpInstance;
  resize(options: {
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover' | 'fill' | 'outside';
    withoutEnlargement?: boolean;
  }): SharpInstance;
  composite(inputs: ReadonlyArray<{
    input: Buffer | string;
    left?: number;
    top?: number;
  }>): SharpInstance;
  jpeg(options?: { quality?: number }): SharpInstance;
  /** Replace transparent pixels with a solid background (audio waveform covers). */
  flatten?(options: {
    background: { r: number; g: number; b: number };
  }): SharpInstance;
  png?(options?: { quality?: number }): SharpInstance;
  raw?(): SharpInstance;
  toBuffer?(options?: { resolveWithObject?: false }): Promise<Buffer>;
  toBuffer?(options?: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: { channels: number };
  }>;
  webp(options: { quality?: number }): SharpInstance;
  toFile(output: string): Promise<unknown>;
  /** Drop native libvips handles immediately; GC is too late on Windows. */
  destroy?(): void;
}

export interface PaletteSharpInstance {
  rotate(): PaletteSharpInstance;
  toColourspace(colourspace: 'srgb'): PaletteSharpInstance;
  resize(options: {
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover' | 'fill' | 'outside';
    withoutEnlargement?: boolean;
  }): PaletteSharpInstance;
  ensureAlpha(): PaletteSharpInstance;
  raw(): PaletteSharpInstance;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: { channels: number };
  }>;
}

export interface PaletteSharpModule {
  (input: string): PaletteSharpInstance;
}

export interface LibraryRow {
  library_id: string;
  display_name: string;
}

export interface MigrationRow {
  checksum: string;
  version: number;
}

export interface NetworkMetadataSourceState {
  schemaVersion: number;
  sourceChangeSequence: number;
  sourceFingerprint: NetworkMetadataSourceFingerprint;
}

export interface NetworkMetadataSnapshotProgress {
  remainingPages: number;
  totalPages: number;
}

export const NETWORK_METADATA_SNAPSHOT_TABLES = [
  // These tables define catalog membership, ordering, folder/collection
  // navigation and the metadata shown in the browse surface. Everything not
  // explicitly listed remains on the remote primary, including future tables.
  'assets',
  'revisions',
  'managed_folders',
  'linked_folders',
  'linked_folder_rules',
  'linked_ignored_assets',
  'asset_sequence_frames',
  'asset_metadata',
  'asset_color_space_overrides',
  'tags',
  'human_asset_tags',
  'ai_asset_tags',
  'collections',
  'collection_assets',
  'smart_collections',
  'ai_content',
  'trashed_managed_folders',
  'explicit_ignored_paths',
  'gitignore_ignored_paths',
] as const;

export type DiscoveredSourceEntry = {
  assetId?: string;
  /** SHA-1 prepared during async reconciliation, before the SQLite batch. */
  contentFingerprint?: string;
  /** Stable source identity used to detect an in-root external rename. */
  sourceDevice?: string;
  sourceInode?: string;
  relativePath: string;
  byteSize: number;
  modifiedAt: string;
  originalFilename: string;
};

export interface RefreshManagedAssetsDiscovery {
  linkedEntriesByFolder: Map<string, DiscoveredSourceEntry[]>;
  managedEntries: DiscoveredSourceEntry[];
  scopedLinkedFolderIds?: ReadonlySet<string>;
  existingLinkedAssetIdsByFolder?: Map<string, Map<string, string>>;
  existingManagedAssetIdsByIdentity?: Map<string, string>;
  movedLinkedAssetsReconciled?: boolean;
}

export interface ArtifactPathCacheEntry {
  absolutePath: string;
  kind: string;
  changeSequence: number;
}

export interface ArtifactDescriptor {
  artifactId: string;
  filePath: string;
  mimeType: string;
  generatorVersion: string;
  artifactRole: string | null;
  generatorId: string | null;
  settingsHash: string | null;
  artifactKey: string | null;
  status: string;
  errorCode: string | null;
  width: number | null;
  height: number | null;
  generatedAt: string | null;
}

export interface ManagedFolderRow {
  folder_id: string;
  name: string;
  parent_folder_id: string | null;
  relative_path: string;
  path_identity: string;
  /** sidebar folder sort by creation time. */
  created_at?: string;
  appearance_glyph_kind?: string | null;
  appearance_glyph_value?: string | null;
  appearance_color_id?: string | null;
}

export interface AssetSummaryRow {
  asset_id: string;
  availability: 'available' | 'missing';
  byte_size: number;
  current_revision_id: string;
  managed_folder_id: string | null;
  linked_folder_id: string | null;
  location_kind: 'managed' | 'linked';
  modified_at: string;
  relative_file_path: string;
  rating: number;
  favorite: number;
}

export interface BatchRelinkAssetRow {
  asset_id: string;
  location_kind: 'managed' | 'linked';
  linked_folder_id: string | null;
  managed_folder_id: string | null;
  relative_file_path: string;
  current_revision_id: string | null;
  content_fingerprint: string | null;
}

export interface BatchRelinkMatch {
  matchedPath: string;
  resolvedRelativePath: string;
}

export interface ImportSourceEntry {
  byteSize: number;
  destinationRelativePath: string;
  /** Metadata projected from an Eagle item; absent for ordinary imports. */
  eagleMetadata?: EagleImportedMetadata;
  /** Thumbnail already copied during bulk staging so resolve can skip a second walk. */
  copiedThumbnail?: EagleCopiedThumbnail;
  /** Hash of the staged bytes, calculated once during preparation. */
  sha256?: string;
  /** SHA-1 content identity used to disambiguate missing-file recovery. */
  contentFingerprint?: string;
  /** Optional metadata intent committed atomically with this imported asset. */
  sourcePageUrl?: string;
  sourceSnapshot: SourceSnapshot;
  sourcePath: string;
}

export interface EagleCopiedThumbnail {
  artifactAbsPath: string;
  artifactId: string;
  artifactKind: 'thumbnail' | 'video_poster';
  artifactRelPath: string;
  byteSize: number;
  generatorVersion: string;
  height: number | null;
  mimeType: string;
  width: number | null;
}

export interface EagleImportedMetadata {
  description: string | null;
  rating: number;
  sourceModifiedAtMs: number;
  sourcePageUrl: string | null;
  sourceRootPath: string;
  tagIds: string[];
  thumbnailPath: string | null;
  thumbnailGeneratorVersion?: string;
  width?: number;
  height?: number;
}

export interface ManagedRelinkPlacementIdentity {
  ctimeNs: string;
  dev: string;
  ino: string;
  mtimeNs: string;
  sha256: string;
  size: string;
}

export interface ManagedRelinkPlacementManifestV3 {
  destinationRelativePath: string;
  kind: 'managed-relink-placement';
  phase: 'staged';
  stagedIdentity: ManagedRelinkPlacementIdentity;
  version: 3;
}

export interface ManagedRelinkPlacedMarkerV1 {
  kind: 'managed-relink-placement-complete';
  placedIdentity: ManagedRelinkPlacementIdentity;
  version: 1;
}

export interface ExistingAssetRow {
  asset_id: string;
  current_revision_id: string;
}

export interface ExistingDestination {
  actualRelativePath: string;
  size: number;
  fileVersion?: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mtimeMs: number;
  };
}

export function sameDestinationSnapshot(
  expected: ExistingDestination | undefined,
  current: ExistingDestination | undefined,
): boolean {
  if (expected === undefined || current === undefined) return expected === current;
  if (
    expected.actualRelativePath !== current.actualRelativePath ||
    expected.size !== current.size
  ) {
    return false;
  }
  const expectedVersion = expected.fileVersion;
  const currentVersion = current.fileVersion;
  if (expectedVersion === undefined || currentVersion === undefined) {
    return expectedVersion === currentVersion;
  }
  return expectedVersion.ctimeMs === currentVersion.ctimeMs
    && expectedVersion.dev === currentVersion.dev
    && expectedVersion.ino === currentVersion.ino
    && expectedVersion.mtimeMs === currentVersion.mtimeMs;
}

export interface PortablePathRow {
  id: string;
  relative_path: string;
}

export interface ImportAction {
  destinationRelativePath: string;
  entry: ImportSourceEntry;
  existingAsset?: ExistingAssetRow;
  expectedDestination: ExistingDestination | undefined;
  isReplacement: boolean;
}

export interface OperationManifest {
  directories: Array<{ existed: boolean; relativePath: string }>;
  files: Array<{
    backupName: string;
    destinationRelativePath: string;
    hadDestination: boolean;
    stageName: string;
  }>;
  phase?: 'prepared' | 'staging';
  version: 1;
}

export interface LinkedTrashOperationManifest {
  assetIds: string[];
  inFlightAssetId: string | null;
  kind: 'linked-trash';
  trashedAssetIds: string[];
  version: 2;
}

export interface RestoreOperationManifest {
  files: Array<{
    assetId: string;
    backupDestinationRelativePath: string | null;
    backupName: string;
    conflictingAssetId: string | null;
    destinationRelativePath: string;
    hadDestination: boolean;
    trashFilename: string;
  }>;
  kind: 'restore';
  version: 3;
}

export interface ManagedMoveConflict {
  assetId: string | null;
  backupName: string;
  kind: 'managed' | 'untracked';
  managedFolderId: string | null;
  operationId: string;
  relativePath: string;
  /** False when the DB row remains but its source file disappeared. */
  sourceExists?: boolean;
  trashFilename: string | null;
}

export interface ManagedMoveOperationManifest {
  files: Array<{
    assetId: string;
    destinationConflict: ManagedMoveConflict | null;
    destinationFolderId: string | null;
    destinationRelativePath: string;
    restoreConflict: ManagedMoveConflict | null;
    sourceFolderId: string | null;
    sourceRelativePath: string;
  }>;
  kind: 'managed-move' | 'managed-move-undo';
  originalOperationId: string | null;
  version: 4;
}

/** Durable journal for managed-folder duplicate (Option/Alt drag copy). */
export interface ManagedCopyOperationManifest {
  files: Array<{
    destinationConflict: ManagedMoveConflict | null;
    destinationFolderId: string | null;
    destinationRelativePath: string;
    newAssetId: string;
    sourceAssetId: string;
    sourceRelativePath: string;
  }>;
  kind: 'managed-copy' | 'managed-copy-undo';
  originalOperationId: string | null;
  version: 5;
}

export interface ContentReplaceBatchOperationManifest {
  files: Array<{
    assetId: string;
    backupName: string;
    destinationRelativePath: string;
    newRevisionId: string;
    originalModifiedAt: string;
    originalSha256: string;
    previousRevisionId: string;
    sha256: string;
    stageName: string;
  }>;
  kind: 'content-replace-batch';
  version: 6;
}

/**
 * Durable journal for managed-folder trash. The folder tree is first moved to
 * the operation directory, then its DB rows are removed. This keeps a failed
 * SQLite commit or a Worker restart recoverable instead of leaving a missing
 * directory with live index rows.
 */
export interface ManagedFolderTrashOperationManifest {
  assetIds: string[];
  assetOperationId: string | null;
  folder: {
    folderId: string;
    name: string;
    parentFolderId: string | null;
    pathIdentity: string;
    relativePath: string;
  };
  descendants: Array<{
    folderId: string;
    name: string;
    parentFolderId: string | null;
    pathIdentity: string;
    relativePath: string;
  }>;
  kind: 'folder-trash';
  phase: 'prepared' | 'assets-trashed' | 'tombstones-written' | 'filesystem-staged' | 'db-committed';
  trashedAt: string;
  tombstones: Array<{
    folderId: string;
    name: string;
    parentRelativePath: string | null;
    relativePath: string;
    tombstoneId: string;
    trashedAssetCount: number;
  }>;
  version: 7;
}

export type PersistedOperationManifest =
  | OperationManifest
  | LinkedTrashOperationManifest
  | RestoreOperationManifest
  | ManagedMoveOperationManifest
  | ManagedCopyOperationManifest
  | ContentReplaceBatchOperationManifest
  | ManagedFolderTrashOperationManifest;

export interface OperationRow {
  error_code: string | null;
  /** Present when selected; recoverFileOperations requires it for import lease skips. */
  kind?: string;
  manifest_json: string;
  operation_id: string;
  status: string;
}

export interface OperationHistoryRow {
  affected_count: number;
  applied_sequence: number;
  created_at: string;
  history_entry_id: string;
  label_args_json: string;
  label_key: string;
  policy: HistoryPolicy;
  source: HistorySource;
  source_reference: string | null;
  stale_code: string | null;
  state: HistoryEntryState;
  redo_sequence: number;
  updated_at: string;
}

export interface OperationHistoryStepRow {
  affected_entities_json: string;
  command_id: string;
  current_direction: 'forward' | 'inverse';
  forward_payload_json: string;
  history_entry_id: string;
  history_step_id: string;
  inverse_payload_json: string;
  ordinal: number;
  recipe_kind: string;
  recipe_version: number;
}

export interface RecordOperationHistoryInput {
  affectedCount: number;
  affectedEntities?: readonly string[];
  commandId: string;
  forwardRecipe: HistoryRecipe;
  inverseRecipe: HistoryRecipe;
  labelArgs?: Readonly<Record<string, string | number>>;
  labelKey: string;
  libraryId: string;
  policy?: HistoryPolicy;
  source?: HistorySource;
  sourceReference?: string | null;
}

export interface OperationHistoryGroupStepInput {
  affectedEntities?: readonly string[];
  commandId: string;
  forwardRecipe: HistoryRecipe;
  inverseRecipe: HistoryRecipe;
}

export interface TrashSelectionResult {
  historyEntryId: string;
  removedFolderCount: number;
  trashedAssetCount: number;
  trashedFolderCount: number;
}

export interface OperationHistoryTransitionResult {
  affectedCount: number;
  direction: HistoryDirection;
  historyEntryId: string;
  status: HistoryStatus;
}

export interface AssetMetadataHistorySnapshot {
  assetId: string;
  author: string | null;
  description: string | null;
  entityVersion: number;
  favorite: boolean;
  palette: string | null;
  rating: number;
  sourcePageUrl: string | null;
  updatedAt: string;
}

export interface ManagedFolderHistorySnapshot {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  relativePath: string;
  pathIdentity: string;
}

export interface TagHistorySnapshot {
  appearance?: EntityAppearance | null;
  hierarchy?: { parentTagId: string | null; childTagIds: string[] };
  tagId: string;
  libraryId: string;
  name: string;
  humanRelations: Array<{ assetId: string; tagId: string }>;
}

export type ImportFailurePoint =
  | 'after-stage'
  | 'after-backup'
  | 'after-first-place'
  | 'after-place'
  | 'after-import-metadata'
  | 'before-db-commit'
  | 'committed-cleanup'
  | 'committed-result-list'
  | 'crash-after-backup'
  | 'crash-after-place'
  | 'crash-during-prepare-stage'
  | 'crash-restore-before-filesystem'
  | 'crash-restore-after-backup'
  | 'crash-restore-after-filesystem'
  | 'crash-restore-before-db-commit'
  | 'crash-restore-after-db-commit'
  | 'crash-folder-trash-before-assets'
  | 'crash-folder-trash-after-assets'
  | 'crash-folder-trash-after-tombstones'
  | 'crash-folder-trash-after-filesystem'
  | 'crash-move-before-filesystem'
  | 'crash-move-after-conflict'
  | 'crash-move-after-filesystem'
  | 'crash-move-before-db-commit'
  | 'crash-move-after-db-commit'
  | 'crash-copy-before-filesystem'
  | 'crash-copy-after-conflict'
  | 'crash-copy-after-filesystem'
  | 'crash-copy-before-db-commit'
  | 'crash-copy-after-db-commit'
  | 'crash-content-replace-batch-after-backup'
  | 'crash-content-replace-batch-after-first-file'
  | 'crash-content-replace-batch-before-db-commit'
  | 'crash-content-replace-batch-after-db-commit'
  | 'crash-linked-convert-after-filesystem'
  | 'crash-relink-before-manifest-write'
  | 'crash-relink-after-manifest-before-placement'
  | 'crash-relink-after-placement-before-manifest-update'
  | 'crash-relink-after-filesystem'
  | 'crash-relink-before-db-commit'
  | 'crash-relink-after-db-commit'
  | 'crash-relink-batch-after-first-place'
  | 'recovery-restore'
  | 'rollback-restore';

export type ModelThumbnailRenderer = (
  input: ModelThumbnailRendererInput,
) => Promise<ModelThumbnailRenderOutcome>;

export interface LibraryServiceOptions {
  /** User-scoped local cache root for remote-library metadata snapshots. */
  networkMetadataCacheDirectory?: string;
  /** Test/diagnostic seam; events never contain absolute library/cache paths. */
  onNetworkMetadataCacheEvent?: (event: NetworkMetadataCacheEvent) => void;
  /** Test-only seam for proving stale-snapshot behavior when source state is unavailable. */
  networkMetadataSourceStateForTests?: (input: {
    libraryId: string;
    sourceDatabasePath: string;
  }) => NetworkMetadataSourceState | undefined;
  /** Test-only seam for injecting a concurrent writer during SQLite backup. */
  onNetworkMetadataSnapshotProgress?: (progress: NetworkMetadataSnapshotProgress) => void;
  /** Worker-owned SQLite backup for the independent semantic sidecar. */
  backupSemanticIndex?: (input: {
    libraryId: string;
    libraryPath: string;
    storageKind: LibraryStorageKind;
    destinationPath: string;
  }) => Promise<boolean>;
  afterSourceSnapshotCopy?: (sourcePath: string) => void;
  assetLstat?: (assetPath: string) => Stats;
  /** Test-only seams for classifying linked-root access failures on open. */
  linkedRootLstat?: (absoluteRootPath: string) => Stats | BigIntStats;
  linkedRootAccess?: (absoluteRootPath: string) => void;
  /** Test-only async fingerprint seam for proving file I/O stays outside DB transactions. */
  contentFingerprintAsync?: (assetPath: string, signal?: AbortSignal) => Promise<string>;
  beforeSourceSnapshotOpen?: (sourcePath: string) => void;
  debounceMs?: number;
  /**
   * Watcher-only settling window. A changed or newly-created file must report
   * the same size/mtime after this interval before it is committed. Zero is
   * useful for deterministic tests; production defaults to a short window so
   * a copy-in-progress does not become a partial revision.
   */
  watcherStableFileWindowMs?: number;
  /**
   * Low-frequency scan cadence for libraries whose root is on a network
   * filesystem. Native fs.watch is not a reliable cross-machine change
   * source there; zero disables the periodic scan for deterministic tests.
   */
  networkScanIntervalMs?: number;
  /** Test-only storage classification seam for deterministic NAS scan tests. */
  storageKindOverrideForTests?: LibraryStorageKind;
  /** DNS resolver used to reject non-public URL download targets on every hop. */
  dnsLookup?: DnsLookup;
  /** HTTP(S) transport receives an already validated, pinned address per hop. */
  pinnedHttpTransport?: PinnedHttpTransport;
  destinationLstat?: (destinationPath: string) => Stats;
  /** Test-only seam for an external destination appearing just before apply. */
  beforeImportDestinationApply?: () => void;
  failAt?: ImportFailurePoint | ImportFailurePoint[];
  /** E2E-only hard stop used to leave an operation at a real process boundary. */
  terminateProcessAt?: ImportFailurePoint;
  importClock?: ImportExpiryClock;
  importTtlMs?: number;
  onAssetsChanged?: (event: AssetsChangedEvent) => void;
  onLibraryChanged?: (event: LibraryChangedEvent) => void;
  onDiagnostic?: (diagnostic: LibraryServiceDiagnostic) => void;
  onProgress?: (event: ExportProgressEvent | ImportProgressEvent | DeleteProgressEvent) => void;
  observerFactory?: AssetObserverFactory;
  /** Deterministic slow/unavailable source-directory seam for Worker tests. */
  sourceDirectoryOpener?: typeof opendirAsync;
  scheduler?: DebounceScheduler;
  /** Injectable Sharp-compatible decoder for deterministic concurrency tests. */
  sharpFn?: SharpModule;
  /** Injectable raw-pixel decoder used only by local palette extraction. */
  paletteSharpFn?: PaletteSharpModule;
  /** Injectable EXIF/IPTC/XMP parser for RAW Inspector metadata tests. */
  rawImageMetadataParser?: RawImageMetadataParser;
  /**
   * Injectable media capability probe. Production probes ffmpeg+ffprobe or
   * oiiotool before automatically re-queuing component-missing artifacts.
   */
  mediaComponentProbe?: (component: MediaAutoRepairComponent) => boolean;
  /** Injectable spawn for binary subprocesses (ffmpeg/ffprobe/oiiotool). */
  spawnFn?: SpawnFunction;
  /** Test-only system-memory seam for deterministic adaptive FFmpeg concurrency coverage. */
  availablePhysicalMemoryBytesForTests?: () => number | undefined;
  /**
   * 永久删除一个链接资产的源文件。可注入，用于覆盖权限/占用/磁盘错误等路径。
   * 2026-09-15 起链接资产的删除**不再使用系统回收站**。
   */
  removeLinkedSourceFile?: (sourcePath: string) => Promise<void>;
  /** Test-only seam invoked after bounded-write lease acquisition. */
  beforeBoundedWriteTransaction?: (libraryId: string) => void;
  /** Test-only seam invoked immediately before the v23+ migration transaction. */
  beforeSchemaMigrationTransaction?: () => void;
  /** Test-only seam invoked before a batch content replacement backs up a target. */
  beforeContentReplaceBatchBackup?: (input: { assetId: string; libraryId: string }) => void;
  /** Test-only seam invoked after BEGIN IMMEDIATE acquires the migration mutex. */
  afterSchemaMigrationTransactionBegin?: () => void;
  /**
   * Test-only seam invoked after a damaged primary has been quarantined and
   * before Assets rescue creates a replacement database. Used to prove a
   * failed rescue puts the original file back.
   */
  beforeLibraryRescueForTests?: () => void;
  /**
   * offscreen HTML document thumbnail renderer, injected by
   * the Worker (asks Main to capture the source). When absent, HTML thumbnails
   * stay a benign no-op (generic file icon, never `failed`).
   */
  documentThumbnailRenderer?: (input: {
    libraryId: string;
    assetId: string;
    revisionId: string;
    url: string;
    /** Capture viewport (px); height omitted → the document default. */
    width: number;
    height?: number;
    signal?: AbortSignal;
  }) => Promise<{ png: Uint8Array; width: number; height: number } | null>;
  /** Test-only override for deterministic SQLite writer-contention tests. */
  sqliteBusyTimeoutMsForTests?: number;  /** Test-only clock for the 24-hour database-backup throttle. */
  databaseBackupClock?: { now(): number };
  /**
   * Test-only seam: receives every SQL statement executed on
   * the open-library connection, used by queue-throughput benchmarks to
   * assert DB write counts (e.g. batched success UPDATEs). Never set in
   * production — it adds a callback per statement.
   */
  onDbStatement?: (sql: string) => void;
  /** Removes one Keel trash directory; injectable for platform-error tests. */
  removeTrashPath?: (trashPath: string) => void;
  /**
   * Clock for the client-mutation watcher-notification suppression window.
   * Tests that drive the debounce scheduler manually inject a controllable
   * clock; production falls back to Date.now().
   */
  watchNotifyClock?: { now(): number };
}

export interface LibraryServiceDiagnostic {
  context?: Record<string, unknown>;
  error: unknown;
  scope: string;
}

export interface AssetsChangedEvent {
  changedCount: number;
  libraryId: string;
  missingCount: number;
  source?: 'watcher' | 'text-save' | 'content-replace' | 'client' | 'sync';
  /** Filesystem or served drag-icon path may have changed; metadata-only edits omit it. */
  nativeDragPathsChanged?: true;
  type: 'asset.changed';
}

export interface ImportExpiryClock {
  cancel(handle: unknown): void;
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface AssetRefreshResult {
  /**
   * the full recursive asset list is opt-in. Every internal
   * caller (open reconciliation, watcher refresh) only reads the counters,
   * and the eager `listAssets(recursive: true)` re-scan cost ~400ms per
   * refresh on a 20k library — pure waste when nobody consumes the rows.
   */
  assets?: AssetSummary[];
  changedCount: number;
  missingCount: number;
}

/**
 * 收编 codex/large-library-performance@15f3325c：开库对账的
 * 渐进批次选项。assetIds 限定 stat 范围（空列表 = 仅发现新文件）；
 * discoverSources=false 跳过文件系统枚举。
 */
export interface RefreshManagedAssetsOptions {
  /** Restrict the stat/revision pass; an empty list means discovery only. */
  assetIds?: readonly string[];
  /** Skip filesystem discovery when processing an existing-asset batch. */
  discoverSources?: boolean;
  /** Pre-scanned source entries; used by the cancellable background scanner. */
  discovery?: RefreshManagedAssetsDiscovery;
  /** Avoid materializing all AssetSummary objects for background maintenance. */
  includeAssets?: boolean;
}

export interface AssetObserver {
  close(): void;
}

export interface AssetObserverEvent {
  eventType: 'change' | 'rename';
  filename: string | Buffer | null;
}

export type AssetObserverFactory = (
  assetsPath: string,
  onEvent: (event?: AssetObserverEvent) => void,
  onError: (error: unknown) => void,
) => AssetObserver;

export type LinkedWatcherChanges =
  | { kind: 'files'; pathsByFolder: Map<string, Set<string>> }
  | { kind: 'scope' };

export const MAX_LINKED_WATCHER_CHANGED_FILES = 64;

export interface DebounceScheduler {
  cancel(handle: unknown): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface LibraryWatch {
  observer: AssetObserver;
}

export interface WatchRefreshState {
  dirty: boolean;
  reason: 'watcher' | 'network';
  triggerScope?: string;
  fullRefreshRequested?: boolean;
  linkedFolderIds?: Set<string>;
  linkedChanges?: LinkedWatcherChanges;
  timer?: unknown;
  promise?: Promise<void>;
}

export interface NetworkScanState {
  fingerprint?: string;
  timer?: unknown;
}

export interface LinkedFolderWatch extends LibraryWatch {
  folderId: string;
  libraryId: string;
  rootPath: string;
}

export const DEFAULT_DEBOUNCE_SCHEDULER: DebounceScheduler = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};

export const DEFAULT_IMPORT_EXPIRY_CLOCK: ImportExpiryClock = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
};

export const DEFAULT_ASSET_OBSERVER_FACTORY: AssetObserverFactory = (assetsPath, onEvent, onError) => {
  const observer = watch(assetsPath, { recursive: true }, (eventType, filename) => onEvent({
    eventType,
    filename,
  }));
  observer.on('error', onError);
  return observer;
};
