import { BUILT_IN_COMPANION_EXTENSIONS } from './library/companion-files';
import { randomUUID } from 'node:crypto';
import { rm as rmAsync } from 'node:fs/promises';
import path from 'node:path';


import {
  MediaJobStatusSummaryCache,
} from './media/media-job-status-summary';
import type {
  countLinkedDirectoryAssets,
} from '../shared/linked-folder-tree';
import {
  type LibraryChangeSubscription,
} from './library/library-write-coordinator';
import {
  defaultNetworkMetadataCacheDirectory,
  NetworkMetadataCache,
  type NetworkMetadataCacheManifest,
  type NetworkMetadataSourceFingerprint,
  type NetworkReadThroughConnection,
} from './library/network-metadata-cache';

import {
  type GitIgnoreMatcher,
} from './library/gitignore';
import { type LinkedFolderRule } from '../shared/asset-types';
import {
  type LibraryNavigationSummary,
} from '../shared/library-navigation';

let sharpModule: SharpModule | undefined;
export function requireSharp(): SharpModule {
  if (!sharpModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharpModule = require('sharp') as SharpModule;
      // libvips keeps recently used input files open in its file cache. On
      // Windows an open handle blocks delete/rename, which breaks asset
      // trash/move/rename right after a thumbnail or palette was generated
      // (POSIX unlinks open files, so this never surfaced on macOS). Keep the
      // decoded-operation cache but never hold source files open. Keep the
      // memory cache bounded as well: this Worker is the owner of all open
      // libraries and must not let libvips retain a large batch after a wave.
      sharpModule.cache?.({ files: 0, memory: 32, items: 128 });
      // Two queue jobs are allowed, but each libvips operation gets one native
      // worker. Without this, Sharp's default is roughly one thread per CPU
      // core per image and queue-level bounds still oversubscribe the machine.
      sharpModule.concurrency?.(1);
    } catch (error) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'SHARP_UNAVAILABLE',
        cause: error,
      });
    }
  }
  return sharpModule;
}
import type {
  InternalLibrarySummary,
} from '../shared/protocol/responses';
import {
  isAudioFileName,
} from '../shared/audio-media';
import {
  isSupportedImageExtension,
  isSupportedModelExtension,
  isSupportedDocumentExtension,
  isSupportedFontExtension,
  isSupportedVideoExtension,
} from '../shared/media-formats';
import {
  ArtifactDescriptorCache,
} from './media/artifact-descriptor-cache';
import {
  BrowseSessionStore,
} from './library/browse-session-store';
import {
  LibraryReconciliationOwner,
  type LibraryReconciliationTask,
} from './library/reconciliation-owner';
import {
  type ImageColorSpaceInfo,
} from './media/image-color-space';
import {
  isTextFileName,
} from '../shared/text-media';
import {
  type SkippedImportSource,
} from './library/import-source-failure';
import { assetSupportsThumbnail } from '../shared/thumbnail-support';
import type { LinkedDirectoryIndex} from './library/linked-directory-index';
import type { SingleFlightRead } from './library/single-flight-read';
import * as linkedMethods from "./library/linked-methods";
import * as coreMethods from "./library/core-methods";
import * as assetMethods from "./library/asset-methods";
import * as mediaMethods from "./media/media-methods";
import * as syncMethods from "./integrations/sync-methods";
import * as scanMethods from "./library/scan-methods";
import * as trashMethods from "./library/trash-methods";
import * as sessionMethods from "./library/session-methods";
import * as historyMethods from "./library/history-methods";
import * as folderMethods from "./library/folder-methods";
import * as importMethods from "./library/import-methods";
import * as queryMethods from "./library/query-methods";
import * as tagMethods from "./library/tag-methods";
import * as billfishEagleMethods from "./integrations/billfish-eagle-methods";
import * as aiMethods from "./integrations/ai-methods";
import * as exportMethods from "./library/export-methods";
import * as ruleMethods from "./library/rule-methods";
import { type ArtifactDescriptor, type ArtifactPathCacheEntry, type ExistingDestination, type ImportSourceEntry, type LibraryServiceOptions, type LibraryWatch, type LinkedFolderWatch, type NetworkScanState, type OperationManifest, type SharpModule, type WatchRefreshState } from './library-service-types';
import { type DatabaseConnection } from './library/database';
import { type ExrPlaneDescriptor } from './media/media-definitions';
import { LibraryServiceError } from './library/library-errors';
import { type MediaAutoRepairComponent, type ModelThumbnailRenderOutcome, type ModelThumbnailRendererInput, type SpawnFunction, type VideoProbeResult, activeMediaProcesses, defaultSpawnFn, killMediaProcess } from './media/media-process';
import { type TransferCancelState } from './library/library-fs';
// Re-exported so existing importers of library-service keep working.
export * from './library/database';
export * from './library/schema-sql';
export * from './media/media-process';
export * from './library/library-errors';
export * from './library/library-fs';
export * from './library-service-types';
export * from './library-migrations';
export * from './media/media-definitions';
export * from './library/download-safety';
export * from './library/ignore-defaults';
export const DATABASE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const FINALIZED_IMPORT_RETENTION_MS = 10 * 60_000;

export interface OpenLibrary {
  connection: DatabaseConnection;
  /** The remote writable truth source; `connection` may be a NAS read-through adapter. */
  writeConnection: DatabaseConnection;
  summary: InternalLibrarySummary;
  changeSubscription: LibraryChangeSubscription;
  /** Whether this handle was opened for inspection without write access. */
  readOnly: boolean;
  /** Managed path identities whose on-disk file must not be auto-reconciled after relink recovery preserved them. */
  preservedRelinkPathIdentities: Set<string>;
  /** Last .keelignore contents materialized into gitignore_ignored_paths. */
  gitignoreText: string;
  /** Parsed rules used while discovering files that are not in SQLite yet. */
  gitignoreMatcher: GitIgnoreMatcher;
  /** Whether the current ignore text has been materialized at least once. */
  gitignoreMaterialized: boolean;
  /**
   * memo for the recursive per-collection asset counts keyed
   * by the narrow browse change sequence. The recursive CTE costs ~25-100ms
   * on a 20k library and the sidebar re-requests it after every mutation;
   * artifact/job progress is not a membership change and must not evict it.
   */
  collectionCountCache?: { browseChangeSequence: number; counts: Map<string, number> };
  /**
   * memo for recursive per-folder asset counts keyed by
   * browse sequence + showIgnored. The sidebar re-requests it after every
   * mutation; the direct-count GROUP BY dominates the ~20ms otherwise.
   */
  folderCountCache?: { key: string; counts: Map<string, number> };
  /**
   * Ordered visible asset ids learned by the compact layout query. The
   * renderer already paid for this full-scope order to build the scrollbar;
   * reusing it turns a later deep page request into bounded primary-key reads
   * instead of another cold ORDER BY/OFFSET walk over the whole library. The
   * narrow browse sequence keeps thumbnail/job progress from discarding it.
   */
  browseIndexCache?: { browseChangeSequence: number; assetIds: string[] };
  /**
   * Coherent sidebar/count read model keyed by browse sequence and visibility.
   * The returned summary still carries the broad sequence for cross-process
   * fencing; artifact/job progress may therefore change that number without
   * forcing the expensive navigation queries to run again.
   */
  navigationSummaryCache?: { key: string; value: LibraryNavigationSummary };
  /**
   * Custom folder covers for the current browse + library change sequence.
   * Scoped folder-card reads reuse this map; a sequence change drops it.
   */
  folderCoverIndexCache?: {
    key: string;
    index: Map<string, {
      token: string;
      assetId?: string;
      artifactId?: string;
      revisionId?: string;
    }>;
  };
  /**
   * Remote-library metadata snapshot. The snapshot is disposable and
   * read-only; every write and ambiguous SQL statement remains on
   * `writeConnection` through the read-through adapter.
   */
  networkMetadataCache?: {
    cacheKey: string;
    databasePath: string;
    schemaVersion: number;
    readThrough: NetworkReadThroughConnection;
    writeThrough: NetworkReadThroughConnection;
    manifest?: NetworkMetadataCacheManifest;
    /** Fingerprint observed by this open generation; manifest mtime is advisory across opens. */
    observedSourceFingerprint?: NetworkMetadataSourceFingerprint;
    /** Narrow catalog cursor; volatile jobs/artifacts do not invalidate this snapshot. */
    observedSourceChangeSequence?: number;
    refreshInFlight?: Promise<void>;
  };
}

export type OpenReconciliationTask = LibraryReconciliationTask<OpenLibrary>;

export interface PendingImport {
  directories: string[];
  entries: ImportSourceEntry[];
  createImageSequence?: boolean;
  /** Eagle imports deliberately avoid the O(existing-assets × same-size) scan. */
  skipLibraryDuplicateScan?: boolean;
  expiryHandle?: unknown;
  imageSequenceFps?: number;
  libraryId: string;
  operationPath: string;
  dedupeSameNameByContent?: boolean;
  suppressAssetChangeEvents?: boolean;
  /** External bulk conversion skips full-file hashing. */
  skipContentHash?: boolean;
  /**
   * Identity → on-disk destination for bulk conversion. Avoids readdir of
   * Assets for every file (O(n²) on a 20k Eagle library).
   */
  destinationIndex?: Map<string, ExistingDestination>;
  /**
   * SHA-256 of existing same-size library files hashed during prepare.
   * Resolve reuses this so a no-conflict import does not re-read the library.
   */
  contentHashCache?: Map<string, string>;
  unstagedEntries?: ImportSourceEntry[];
  skippedSources?: SkippedImportSource[];
  skipRemainingSourceFailures?: boolean;
  awaitingSourceFailureDecision?: boolean;
  stagePath?: string;
  prepareInput?: Parameters<LibraryService['prepareImport']>[0];
  preparingManifest?: OperationManifest;
}

// If the UtilityProcess is terminated without receiving the normal shutdown
// control message, Node still gives us a synchronous exit hook. This closes
// the last gap that previously left ffmpeg.exe alive after Keel stopped.
process.once('exit', () => {
  for (const processHandle of activeMediaProcesses) killMediaProcess(processHandle);
});

/**
 * 永久删除一个链接资产的源文件。
 *
 * 2026-09-15 用户决定：链接资产/文件夹的删除动作就是「强制从硬盘删除」，不再使用
 * 系统回收站。旧实现为每个文件 spawn 一次 `trash` 的本地 helper（实测 126 ms/文件，
 * 1.5 万文件约 31 分钟，并且全程独占 Worker 调度器），既慢又不可在库内恢复。
 */
export async function defaultRemoveLinkedSourceFile(sourcePath: string): Promise<void> {
  await rmAsync(sourcePath, { force: true, maxRetries: 5, retryDelay: 120 });
}

// PL: methods live in domain modules; see installLibraryServiceMethods below.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- PL: the class holds state, the interface lists the methods installed below.
export interface LibraryService extends ruleMethods.RuleMethods, linkedMethods.LinkedMethods, coreMethods.CoreMethods, assetMethods.AssetMethods, mediaMethods.MediaMethods, syncMethods.SyncMethods, scanMethods.ScanMethods, trashMethods.TrashMethods, sessionMethods.SessionMethods, historyMethods.HistoryMethods, folderMethods.FolderMethods, importMethods.ImportMethods, queryMethods.QueryMethods, tagMethods.TagMethods, billfishEagleMethods.BillfishEagleMethods, aiMethods.AiMethods, exportMethods.ExportMethods {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the interface above.
export class LibraryService {
  /** Stable for this Worker process; a new app process gets a new session. */
  readonly applicationSessionId = randomUUID();
  reportedMemoryProbeUnavailable = false;
  /** App setting: audio grid thumbnails use cover art when the file has one. */
  audioPreviewPrefersCover = true;
  readonly openById = new Map<string, OpenLibrary>();
  readonly runningAutomaticTasks = new Set<string>();
  readonly openIdByPath = new Map<string, string>();
  /**
   * prepared-statement cache keyed by `libraryId\0sql`.
   * better-sqlite3 re-compiles on every `.prepare()` call; hot per-row paths
   * (isExplicitlyIgnored runs once per enumerated file) measured 410ms of
   * pure compile time per 20k rows vs 54ms with a cached statement.
   */
  readonly preparedStatementCache = new Map<string, unknown>();
  /**
   * text cards only need a small UTF-8 prefix. Keep the
   * decoded result by revision so remounting cards (or opening the Inspector
   * for the same asset) does not reopen the linked source file in the Worker.
   * The cache is deliberately bounded and includes maxBytes because the text
   * editor requests a larger cap than browse cards.
   */
  readonly textAssetPreviewCache = new Map<string, {
    value: {
      assetId: string;
      revisionId: string;
      content: string;
      truncated: boolean;
      byteSize: number;
      lineCount: number;
      editable: boolean;
      mimeType: string;
    };
  }>();
  static readonly TEXT_ASSET_PREVIEW_CACHE_LIMIT = 256;
  /**
   * 进行中的同步会话（libraryId → sessionId）。内存级互斥：自动同步与
   * 手动同步不能同时在跑；进程退出自动释放，崩溃残留不会误锁。
   */
  readonly activeSyncSessions = new Map<string, string>();
  /** >0 时用户命令边界不广播 asset.changed，避免同步回放再触发自动同步。 */
  syncReplayDepth = 0;
  readonly databaseBackupInFlight = new Map<string, Promise<boolean>>();
  readonly databaseBackupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly pendingImports = new Map<string, PendingImport>();
  /** Monotonic `import.progress.sequence` per importId. */
  readonly importProgressSequences = new Map<string, number>();
  /**
   * A resolve can finish the durable commit before a late cancel/abandon RPC
   * arrives. Retain those ids briefly so the already-successful operation is
   * idempotent from the renderer's point of view.
   */
  readonly finalizedImportIds = new Map<string, number>();
  readonly watchByLibraryId = new Map<string, LibraryWatch>();
  readonly linkedWatchByKey = new Map<string, LinkedFolderWatch>();
  /** One coalesced asynchronous filesystem refresh per open library. */
  readonly watchRefreshByLibrary = new Map<string, WatchRefreshState>();
  /** Network libraries use a low-frequency discovery fingerprint checkpoint. */
  readonly networkScanByLibrary = new Map<string, NetworkScanState>();
  readonly activeExports = new Map<string, TransferCancelState>();
  readonly activeImports = new Map<string, TransferCancelState>();
  readonly activeDiskDeletes = new Map<string, TransferCancelState>();
  readonly activeExportByLibraryId = new Map<string, string>();
  readonly activeImportBySource = new Map<string, string>();
  readonly activeImportByDestination = new Map<string, string>();
  readonly activeMediaJobs = new Map<string, {
    controller: AbortController;
    libraryId: string;
    assetId: string;
    settled: Promise<void>;
  }>();
  /**
   * A missing component can be repaired while a library remains open. Once a
   * repair wave has been queued, do not requeue the same component on every
   * visible-range refresh if the replacement fails again. Closing the library
   * starts a new detection wave.
   */
  readonly autoRepairAttemptedByLibrary = new Map<
    string,
    Set<MediaAutoRepairComponent>
  >();
  /** Eagle imports keep their media previews but never enter auto-AI later. */
  readonly autoAnalysisSuppressedAssetIds = new Map<string, Set<string>>();
  /** review fix: coalesce overlapping lazy contact-sheet generations. */
  readonly videoContactSheetInFlight = new Map<string, {
    controller: AbortController;
    promise: Promise<boolean>;
    waiters: number;
  }>();
  /** Coalesce full ffprobe metadata extraction by library and source revision. */
  readonly videoMetadataProbeInFlight = new Map<string, {
    controller: AbortController;
    promise: Promise<VideoProbeResult>;
    waiters: number;
    identity: object;
  }>();
  /** Avoid synchronously probing missing tools on every visible-range request. */
  readonly autoRepairProbeFailedAtByLibrary = new Map<
    string,
    Map<MediaAutoRepairComponent, number>
  >();
  /** Successful OIIO part probes are immutable for a revision. */
  readonly exrPlanesByRevision = new Map<string, ExrPlaneDescriptor[]>();
  /** Color metadata probes are immutable for a revision. */
  readonly imageColorSpaceByRevision = new Map<string, ImageColorSpaceInfo>();
  /** Coalesce concurrent RAW viewer decodes and remember a failed attempt per revision. */
  readonly rawViewerImageInFlight = new Map<string, Promise<void>>();
  /** ICO files can contain several sizes; coalesce the largest-page viewer decode. */
  readonly icoViewerImageInFlight = new Map<string, Promise<void>>();
  /** Coalesce full-resolution OIIO viewer decodes for TIFF/PSD/EXR/TGA/BMP. */
  readonly oiioViewerImageInFlight = new Map<string, Promise<void>>();
  /** Cache the first H.264 encoder that actually encodes a 1-frame probe. */
  readonly videoProxyEncoderByFfmpegPath = new Map<string, string | null>();
  /**
   * Serving a keel:// preview used to repeat one artifact lookup and four
   * containment filesystem probes for every image request. The cache is
   * scoped by library and invalidated by the durable library change sequence;
   * entries are never shared across libraries or usages.
   */
  readonly artifactPathCache = new Map<string, ArtifactPathCacheEntry>();
  /**
   * 任务面板/状态栏读的是按状态分组的总数，而该查询要遍历整个媒体
   * 任务历史（真实库中位约 110 ms）。`jobs` 的写入已经由 `library_change_on_jobs_*`
   * 触发器 bump `library_change_sequence`，所以按序号校验 + 有界陈旧即可把它变成
   * O(1) 读，不需要在每个任务写路径挂钩子。
   */
  readonly mediaJobSummaryCache = new MediaJobStatusSummaryCache();
  /**
   * The descriptor is tiny, but getPreviewArtifact/getExtractedMetadata can
   * ask for the same current row repeatedly while a card remounts. Entries
   * are fenced by the durable library change sequence, so artifact writes
   * invalidate only affected descriptors on the next lookup.
   */
  readonly artifactDescriptorCache = new ArtifactDescriptorCache<ArtifactDescriptor | null>();
  /** Worker-owned ordered browse snapshots; summaries are fetched per page. */
  readonly browseSessionStore = new BrowseSessionStore();
  /** Disk-heavy open maintenance yields while the user is actively browsing. */
  readonly interactiveIdleUntilByLibrary = new Map<string, number>();
  /**
   * Open-time backup and full quick_check are deferred so synchronous SQLite
   * work cannot end the first browse/viewer wave. The timer is still owned by
   * the open generation and is cancelled when that generation closes.
   */
  readonly deferredOpenMaintenanceByLibrary = new Map<string, ReturnType<typeof setTimeout>>();
  /** One cancellable reconciliation owner per open library generation. */
  readonly reconciliationOwner = new LibraryReconciliationOwner<OpenLibrary>();
  /**
   * Open automation groups are keyed by their Main-owned execution source.
   * The value is an in-memory reservation until the first real step is
   * recorded. Keeping the reservation out of `operation_history` prevents a
   * history-group handshake from invalidating an approved file-operation plan.
   */
  readonly openOperationHistoryGroups = new Map<string, string>();
  /** Rule that owns an open history group, keyed by history entry id. */
  readonly openOperationHistoryGroupRules = new Map<string, { ruleId: string; name: string; version: string }>();
  /** Prevent a replayed history recipe from creating a second history entry. */
  historyReplayDepth = 0;
  /** User-scoped disposable read snapshots for network libraries. */
  readonly networkMetadataCache: NetworkMetadataCache;
  /**
   * After in-app filesystem mutations (text save, copy, move, import…), watcher
   * refreshes still update DB but must not surface a "disk synced" toast — that
   * copy is reserved for true external changes.
   */
  suppressWatcherNotifyUntilMs = 0;
  artifactsDirReady = new WeakSet<OpenLibrary>();
  readonly linkedDirectoryIndexes = new WeakMap<OpenLibrary, LinkedDirectoryIndex>();
  readonly navigationBuilds = new WeakMap<OpenLibrary, SingleFlightRead<LibraryNavigationSummary>>();
  readonly linkedAssetPaths = new WeakMap<OpenLibrary, Map<string, { key: string; paths: string[] }>>();
  readonly linkedAssetCounts = new WeakMap<string[], ReturnType<typeof countLinkedDirectoryAssets>>();
  readonly linkedRuleMatchers = new WeakMap<LinkedFolderRule[], (relativePath: string) => boolean>();

  constructor(readonly options: LibraryServiceOptions = {}) {
    this.networkMetadataCache = new NetworkMetadataCache(
      options.networkMetadataCacheDirectory ?? defaultNetworkMetadataCacheDirectory(),
    );
  }

  modelAiViewsRenderer?: (
    input: ModelThumbnailRendererInput,
  ) => Promise<ModelThumbnailRenderOutcome>;

  get spawnFn(): SpawnFunction {
    return this.options.spawnFn ?? defaultSpawnFn;
  }

  folderCoverSweepScheduled = new WeakSet<OpenLibrary>();

  _companionExtensions: readonly string[] = BUILT_IN_COMPANION_EXTENSIONS;

  /**
   * Bring asset_companions up to date with the live assets. Runs lazily on
   * reads: every asset change bumps browse_change_sequence, so the stored
   * sequence tells whether pairs can be stale. Relations of trashed
   * companions are kept so a restore can bring them back with the primary.
   */
  readonly _companionIndexState = new WeakMap<OpenLibrary, { sequence: number; extensionKey: string; hasRows: boolean }>();

  /**
   * Detect media type from a file extension.
   * Returns a product media category, not a Chromium capability. Images whose
   * source cannot be safely mounted in Chromium (RAW, EXR, PSD, etc.) still
   * classify as `image` because the Worker owns an OIIO-derived preview path.
   * `model` covers the T1 3D set. FBX/OBJ/glTF/GLB/STL preview and thumbnails
   * are renderer-side (slices C/E). `.blend` classifies as `other`.
   */
  static detectMediaType(filenameOrMime: string): 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'font' | 'other' {
    const lower = filenameOrMime.toLowerCase();
    if (isSupportedImageExtension(lower)) {
      return 'image';
    }
    if (isSupportedVideoExtension(lower)) {
      return 'video';
    }
    if (isSupportedModelExtension(lower)) {
      return 'model';
    }
    if (isAudioFileName(lower)) {
      return 'audio';
    }
    // PDF and HTML are documents previewed in a browser-like
    // renderer, not plain text. Check before the text whitelist so they
    // classify as `document`.
    if (isSupportedDocumentExtension(lower)) {
      return 'document';
    }
    // fonts get their own media type (card sample + viewer).
    if (isSupportedFontExtension(lower)) {
      return 'font';
    }
    if (isTextFileName(lower)) {
      return 'text';
    }
    return 'other';
  }

  /**
   * Map detector output onto AssetSummary.mediaType.
   * searchAssets / trash listing previously collapsed audio+text to `other`
   *, which hid duration badges and Inspector audio tech lines.
   * `model` passes through unchanged since slice A.
   */
  static toSummaryMediaType(
    detected: ReturnType<typeof LibraryService.detectMediaType>,
  ): 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'font' | 'other' {
    return detected === 'image' ||
      detected === 'video' ||
      detected === 'audio' ||
      detected === 'text' ||
      detected === 'model' ||
      detected === 'document' ||
      detected === 'font'
      ? detected
      : 'other';
  }

  readonly _pluginThumbnailExtensions = new Map<string, Set<string>>();

  static supportsThumbnail(filename: string): boolean {
    return assetSupportsThumbnail({
      mediaType: LibraryService.toSummaryMediaType(
        LibraryService.detectMediaType(filename),
      ),
      displayName: path.basename(filename),
    });
  }

  // ── Search ──────────────────────────────────────────────────────────

  /**
   * The compact layout query and the ordinary all-assets browse share the
   * same stable order. Keep this narrow: filters, folders and
   * explicit sorts each have their own semantics and must use the SQL path.
   */
  /** Linked assets with availability `missing` stay in browse until this is false. */
  _showMissingLinkedFiles = true;

  // ── ZIP export ───────────────────────────────────────────────────────────

  /** Maximum total size for a standard (non-ZIP64) ZIP archive: 4 GiB = 4,294,967,296 bytes. */
  static readonly ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  /** Maximum entry count for a standard (non-ZIP64) ZIP archive: 65535. */
  static readonly ZIP_MAX_ENTRIES = 65534;
}

function installLibraryServiceMethods(target: object, ...modules: object[]): void {
  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== 'function') continue;
      Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
    }
  }
}
installLibraryServiceMethods(LibraryService.prototype, ruleMethods, linkedMethods, coreMethods, assetMethods, mediaMethods, syncMethods, scanMethods, trashMethods, sessionMethods, historyMethods, folderMethods, importMethods, queryMethods, tagMethods, billfishEagleMethods, aiMethods, exportMethods);

