import { type AssetSummary } from "../../shared/asset-types";
import { isLibraryIgnoreFileName, isLibraryMetaDirName } from "../../shared/library-meta-dir";
import { DEFAULT_ASSET_OBSERVER_FACTORY, DEFAULT_DEBOUNCE_SCHEDULER, LibraryServiceError, MAX_LINKED_WATCHER_CHANGED_FILES, isUnreadablePathError, openConfiguredDatabase, readLibraryIdentity, type AssetRefreshResult, type DatabaseConnection, type DiscoveredSourceEntry, type LibraryService, type LinkedWatcherChanges, type ManagedFolderRow, type NetworkMetadataSourceState, type OpenLibrary, type OpenReconciliationTask, type RefreshManagedAssetsDiscovery, type RefreshManagedAssetsOptions, type WatchRefreshState } from "../library-service";
import { portablePathIdentity } from "./library-rules";
import { NetworkMetadataSnapshotRejectedError, networkMetadataSourceFingerprintEqual } from "./network-metadata-cache";
import { sqliteAllInChunks, withSqliteInPredicate } from "./sqlite-in";
import { randomUUID } from "node:crypto";
import { lstatSync, type BigIntStats, type Stats } from "node:fs";
import path from "node:path";

/** LibraryService methods defined in this module (PL). */
export interface ScanMethods {
  shouldEmitWatcherAssetChange(...args: Parameters<typeof shouldEmitWatcherAssetChange>): ReturnType<typeof shouldEmitWatcherAssetChange>;
  refreshManagedAssetsOnOpen(...args: Parameters<typeof refreshManagedAssetsOnOpen>): ReturnType<typeof refreshManagedAssetsOnOpen>;
  watchNotifyNow(...args: Parameters<typeof watchNotifyNow>): ReturnType<typeof watchNotifyNow>;
  startAssetWatcher(...args: Parameters<typeof startAssetWatcher>): ReturnType<typeof startAssetWatcher>;
  networkScanIntervalMs(...args: Parameters<typeof networkScanIntervalMs>): ReturnType<typeof networkScanIntervalMs>;
  startNetworkScan(...args: Parameters<typeof startNetworkScan>): ReturnType<typeof startNetworkScan>;
  scheduleNetworkScan(...args: Parameters<typeof scheduleNetworkScan>): ReturnType<typeof scheduleNetworkScan>;
  scheduleAssetRefresh(...args: Parameters<typeof scheduleAssetRefresh>): ReturnType<typeof scheduleAssetRefresh>;
  scheduleWatcherRefresh(...args: Parameters<typeof scheduleWatcherRefresh>): ReturnType<typeof scheduleWatcherRefresh>;
  finishWatcherRefresh(...args: Parameters<typeof finishWatcherRefresh>): ReturnType<typeof finishWatcherRefresh>;
  runWatcherReconciliation(...args: Parameters<typeof runWatcherReconciliation>): ReturnType<typeof runWatcherReconciliation>;
  stopAssetWatcher(...args: Parameters<typeof stopAssetWatcher>): ReturnType<typeof stopAssetWatcher>;
  refreshNetworkMetadataCache(...args: Parameters<typeof refreshNetworkMetadataCache>): ReturnType<typeof refreshNetworkMetadataCache>;
  runOpenBackgroundReconciliation(...args: Parameters<typeof runOpenBackgroundReconciliation>): ReturnType<typeof runOpenBackgroundReconciliation>;
  cancelOpenBackgroundReconciliation(...args: Parameters<typeof cancelOpenBackgroundReconciliation>): ReturnType<typeof cancelOpenBackgroundReconciliation>;
  cancelReconciliationForClientMutation(...args: Parameters<typeof cancelReconciliationForClientMutation>): ReturnType<typeof cancelReconciliationForClientMutation>;
  watcherStableFileWindowMs(...args: Parameters<typeof watcherStableFileWindowMs>): ReturnType<typeof watcherStableFileWindowMs>;
  waitForWatcherStabilityWindow(...args: Parameters<typeof waitForWatcherStabilityWindow>): ReturnType<typeof waitForWatcherStabilityWindow>;
  prepareOpenReconciliationFingerprints(...args: Parameters<typeof prepareOpenReconciliationFingerprints>): ReturnType<typeof prepareOpenReconciliationFingerprints>;
  reconciliationAbortError(...args: Parameters<typeof reconciliationAbortError>): ReturnType<typeof reconciliationAbortError>;
  assertReconciliationActive(...args: Parameters<typeof assertReconciliationActive>): ReturnType<typeof assertReconciliationActive>;
  yieldReconciliation(...args: Parameters<typeof yieldReconciliation>): ReturnType<typeof yieldReconciliation>;
  refreshManagedAssets(libraryId: string, options: { includeAssets: true } & RefreshManagedAssetsOptions): AssetRefreshResult & { assets: AssetSummary[] };
  refreshManagedAssets(libraryId: string, options?: RefreshManagedAssetsOptions): AssetRefreshResult;
}

export function shouldEmitWatcherAssetChange(this: LibraryService): boolean {
  return this.watchNotifyNow() >= this.suppressWatcherNotifyUntilMs;
}

/**
* Reconcile disk changes that happened while the app was closed. Existing
* assets are processed in small transactions so a large NAS/library scan
* cannot monopolize the Worker event loop. Discovery of new files remains a
* final pass, preserving normal refresh semantics without holding the
* connection in one long transaction.
* Serpent-4bdd26 收编 codex/large-library-performance@15f3325c。
*/
export async function refreshManagedAssetsOnOpen(this: LibraryService, libraryId: string, task: OpenReconciliationTask, diagnosticScope = 'open.refresh-managed-assets'): Promise<void> {
  // 分阶段计时（KEEL_REFRESH_STAGE_LOG=1）：打开路径里整段对账会堵住 Worker
  // 事件循环数秒（SMB 库实测 7.3 s），必须能区分是「枚举」「指纹」还是「应用批次」。
  const stageLog = process.env.KEEL_REFRESH_STAGE_LOG === '1';
  let stageMarkAt = performance.now();
  const markRefreshStage = (stage: string, details?: Record<string, unknown>): void => {
    if (!stageLog) return;
    const now = performance.now();
    console.error(JSON.stringify({
      scope: 'open.refresh-managed-assets.stage',
      libraryId,
      generation: task.generation,
      reason: task.reason,
      triggerScope: task.triggerScope ?? diagnosticScope,
      diagnosticScope,
      stage,
      durationMs: Math.round((now - stageMarkAt) * 100) / 100,
      ...details,
    }));
    stageMarkAt = now;
  };
  try {
    this.assertReconciliationActive(task);
    const openLibrary = this.openById.get(libraryId);
    if (!openLibrary || openLibrary.readOnly) return;
    const linkedFolderIds = task.reason === 'watcher' && task.linkedFolderIds?.length
      ? [...new Set(task.linkedFolderIds)]
      : undefined;
    const linkedFolderIdScope = linkedFolderIds === undefined
      ? undefined
      : new Set(linkedFolderIds);
    if (task.reason === 'watcher' && task.linkedFilePathsByFolder !== undefined) {
      const pathCount = [...task.linkedFilePathsByFolder.values()]
        .reduce((total, paths) => total + paths.size, 0);
      const changedPathRefresh = await this.refreshLinkedWatcherFileChanges(
        task,
        task.linkedFilePathsByFolder,
      );
      if (changedPathRefresh !== null) {
        markRefreshStage('linked-file-changes', {
          requestedLinkedFolderCount: task.linkedFilePathsByFolder.size,
          changedPathCount: pathCount,
          inspectedPathCount: changedPathRefresh.inspectedPathCount,
          changedCount: changedPathRefresh.changedCount,
          missingCount: changedPathRefresh.missingCount,
        });
        if (changedPathRefresh.changedCount > 0 && this.shouldEmitWatcherAssetChange()) {
          this.options.onAssetsChanged?.({
            type: 'asset.changed',
            libraryId,
            changedCount: changedPathRefresh.changedCount,
            missingCount: changedPathRefresh.missingCount,
            source: 'watcher',
          });
        }
        return;
      }
      markRefreshStage('linked-file-fallback', {
        requestedLinkedFolderCount: task.linkedFilePathsByFolder.size,
        changedPathCount: pathCount,
      });
    }
    const linkedFolderFilter = linkedFolderIds === undefined
      ? ''
      : ` AND a.linked_folder_id IN (${linkedFolderIds.map(() => '?').join(',')})`;
    const existingAssets = (openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.relative_file_path,
                r.byte_size, r.modified_at
           FROM assets a
           LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.deleted_at IS NULL
            AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
            ${linkedFolderFilter}
          ORDER BY a.relative_file_path`,
      )
      .all(...(linkedFolderIds ?? [])) as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        relative_file_path: string;
        byte_size: number | null;
        modified_at: string | null;
      }>);

    // One async filesystem walk supplies both the existing-asset snapshot
    // and the new-file discovery set. The old implementation first lstat'ed
    // every existing row, then walked the same tree again to find new files;
    // on a 20k library that doubled NAS metadata traffic and forced hundreds
    // of synchronous DB batches.
    this.assertReconciliationActive(task);
    markRefreshStage('existing-snapshot');
    const discovery = await this.collectManagedAssetDiscoveryAsync(
      task,
      linkedFolderIds === undefined ? undefined : { linkedFolderIds },
    );
    this.assertReconciliationActive(task);
    const linkedEntryCount = [...discovery.linkedEntriesByFolder.values()]
      .reduce((total, entries) => total + entries.length, 0);
    markRefreshStage('discovery-walk', {
      requestedLinkedFolderCount: linkedFolderIdScope?.size ?? null,
      scannedLinkedFolderCount: discovery.linkedEntriesByFolder.size,
      linkedEntryCount,
      managedEntryCount: discovery.managedEntries.length,
    });
    if (task.reason === 'watcher' || task.reason === 'network') {
      await this.waitForStableWatcherDiscovery(task, discovery, existingAssets);
      this.assertReconciliationActive(task);
    }
    this.reconcileMovedLinkedAssets(openLibrary, discovery, linkedFolderIdScope);
    const networkFingerprint = task.reason === 'network' && openLibrary.summary.networkStorage
      ? this.networkDiscoveryFingerprint(discovery)
      : undefined;
    const networkScan = this.networkScanByLibrary.get(libraryId);
    if (
      task.reason === 'network'
      && networkFingerprint !== undefined
      && networkScan?.fingerprint === networkFingerprint
    ) {
      // The remote tree is unchanged since the last completed checkpoint.
      // Do not repeat SQLite comparison, revision hashing, or artifact
      // admission merely because the low-frequency timer fired.
      return;
    }
    await this.prepareOpenReconciliationFingerprints(task, discovery, existingAssets);
    this.assertReconciliationActive(task);
    markRefreshStage('prepare-fingerprints');
    const discoveredManagedPaths = new Set(
      discovery.managedEntries.map((entry) => portablePathIdentity(entry.relativePath)),
    );
    const discoveredLinkedPaths = new Map(
      [...discovery.linkedEntriesByFolder].map(([folderId, entries]) => [
        folderId,
        new Set(entries.map((entry) => portablePathIdentity(entry.relativePath))),
      ]),
    );
    const discoveredLinkedAssetIds = new Set(
      [...discovery.linkedEntriesByFolder.values()]
        .flat()
        .flatMap((entry) => entry.assetId === undefined ? [] : [entry.assetId]),
    );
    const staleExistingAssetIds = existingAssets
      .filter((asset) => {
        if (asset.location_kind === 'linked' && discoveredLinkedAssetIds.has(asset.asset_id)) {
          return false;
        }
        if (asset.location_kind === 'managed') {
          return !discoveredManagedPaths.has(portablePathIdentity(asset.relative_file_path));
        }
        const linkedPaths = discoveredLinkedPaths.get(asset.linked_folder_id ?? '');
        // An offline linked root is not scanned and must not be converted to
        // missing merely because the NAS is temporarily unavailable.
        return linkedPaths !== undefined
          && !linkedPaths.has(portablePathIdentity(asset.relative_file_path));
      })
      .map((asset) => asset.asset_id);
    let changedCount = 0;
    let missingCount = 0;
    // Missing rows are the only remaining fallback-lstat path. It is usually
    // a tiny set; keep it small on network libraries because a missing NAS
    // entry can still spend a full timeout in the OS path resolver.
    const missingBatchSize = openLibrary.summary.networkStorage ? 1 : 32;
    for (let offset = 0; offset < staleExistingAssetIds.length; offset += missingBatchSize) {
      this.assertReconciliationActive(task);
      const refresh = this.refreshManagedAssets(libraryId, {
        assetIds: staleExistingAssetIds.slice(offset, offset + missingBatchSize),
        discoverSources: false,
      });
      changedCount += refresh.changedCount;
      missingCount += refresh.missingCount;
      await this.yieldReconciliation(task);
    }

    // Discovery is separate from SQLite writes. The async scanner yielded as
    // it walked the tree; now commit its entries in short transactions while
    // reusing the same existing-identity maps for every batch.
    this.assertReconciliationActive(task);
    markRefreshStage('stale-missing-batches');
    const discovered = await this.applyDiscoveredAssetsInBatches(task, discovery);
    changedCount += discovered.changedCount;
    missingCount += discovered.missingCount;
    markRefreshStage('apply-discovered-batches');
    if (changedCount > 0 && this.shouldEmitWatcherAssetChange()) {
      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId,
        changedCount,
        missingCount,
        source: 'watcher',
      });
    }
    if (networkFingerprint !== undefined && networkScan) {
      networkScan.fingerprint = networkFingerprint;
    }
  } catch (error) {
    if (task.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
    this.diagnose(
      task.reason === 'network' ? 'network-scan.offline' : diagnosticScope,
      error,
      { libraryId },
    );
  }
}

/**
* Clock used to arm/check the client-mutation suppression window. Injectable
* so watcher tests that drive the debounce scheduler manually can advance
* time past the suppression instead of relying on wall-clock sleeps.
*/
export function watchNotifyNow(this: LibraryService): number {
  return this.options.watchNotifyClock?.now() ?? Date.now();
}

export function startAssetWatcher(this: LibraryService, openLibrary: OpenLibrary): void {
  const libraryId = openLibrary.summary.libraryId;
  if (!this.watchRefreshByLibrary.has(libraryId)) {
    this.watchRefreshByLibrary.set(libraryId, { dirty: false, reason: 'watcher' });
  }
  if (openLibrary.summary.networkStorage) {
    // fs.watch is not a trustworthy cross-machine change source on SMB/NFS.
    // Keep the managed root on the low-frequency, fingerprinted scanner;
    // linked roots may still have their own local observer below.
    this.startNetworkScan(libraryId);
    return;
  }
  const observerFactory = this.options.observerFactory ?? DEFAULT_ASSET_OBSERVER_FACTORY;
  try {
    const assetsPath = this.assetsPath(openLibrary);
    const observer = observerFactory(
      assetsPath,
      (event) => {
        const filename = event?.filename?.toString().replaceAll('\\', '/');
        const firstSegment = filename?.split('/')[0]?.toLowerCase();
        if (firstSegment !== undefined && (isLibraryMetaDirName(firstSegment) || isLibraryIgnoreFileName(firstSegment))) return;
        this.scheduleAssetRefresh(libraryId);
      },
      (error) => this.diagnose('asset-watcher.error', error, { libraryId, assetsPath }),
    );
    this.watchByLibraryId.set(libraryId, { observer });
  } catch (error) {
    this.diagnose('asset-watcher.start', error, {
      libraryId,
      assetsPath: this.assetsPath(openLibrary),
    });
    // Watching is opportunistic; library open and explicit refresh must still work.
  }
}

export function networkScanIntervalMs(this: LibraryService): number {
  const configured = this.options.networkScanIntervalMs;
  if (configured === undefined || !Number.isFinite(configured)) return 30_000;
  return Math.max(0, Math.min(86_400_000, Math.trunc(configured)));
}

export function startNetworkScan(this: LibraryService, libraryId: string): void {
  if (this.networkScanIntervalMs() <= 0) return;
  if (!this.networkScanByLibrary.has(libraryId)) {
    this.networkScanByLibrary.set(libraryId, {});
  }
  this.scheduleNetworkScan(libraryId, this.networkScanIntervalMs());
}

export function scheduleNetworkScan(this: LibraryService, libraryId: string, delayMs: number): void {
  const state = this.networkScanByLibrary.get(libraryId);
  const openLibrary = this.openById.get(libraryId);
  if (
    !state
    || state.timer !== undefined
    || !openLibrary
    || openLibrary.readOnly
    || !openLibrary.summary.networkStorage
  ) return;
  const scheduler = this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER;
  try {
    state.timer = scheduler.schedule(() => {
      state.timer = undefined;
      const current = this.openById.get(libraryId);
      if (!current || current.readOnly || !current.summary.networkStorage) return;
      this.scheduleWatcherRefresh(
        libraryId,
        { scope: 'network-watcher.schedule', libraryId },
        'network',
      );
    }, Math.max(0, Math.trunc(delayMs)));
  } catch (error) {
    state.timer = undefined;
    this.diagnose('network-watcher.schedule', error, { libraryId });
  }
}

export function scheduleAssetRefresh(this: LibraryService, libraryId: string): void {
  const libraryWatch = this.watchByLibraryId.get(libraryId);
  if (!libraryWatch || !this.openById.has(libraryId)) return;
  this.scheduleWatcherRefresh(libraryId, { scope: 'asset-watcher.schedule', libraryId });
}

/**
* Coalesce native watcher noise at the library boundary. Managed and linked
* roots share this state, so a bulk copy touching both trees creates one
* asynchronous reconciliation rather than one full scan per observer.
*/
export function scheduleWatcherRefresh(this: LibraryService, libraryId: string, diagnosticContext: Record<string, unknown>, reason: 'watcher' | 'network' = 'watcher', linkedChanges?: LinkedWatcherChanges): void {
  const state = this.watchRefreshByLibrary.get(libraryId);
  if (!state || !this.openById.has(libraryId)) return;
  const wasDirty = state.dirty;
  state.dirty = true;
  state.triggerScope = String(
    diagnosticContext.scope ?? state.triggerScope ?? 'asset-watcher.schedule',
  );
  const requestedLinkedFolderIds = [
    ...(typeof diagnosticContext.linkedFolderId === 'string'
      ? [diagnosticContext.linkedFolderId]
      : []),
    ...(Array.isArray(diagnosticContext.linkedFolderIds)
      ? diagnosticContext.linkedFolderIds.filter((value): value is string => typeof value === 'string')
      : []),
  ];
  if (
    reason === 'network'
    || diagnosticContext.fullRefresh === true
    || requestedLinkedFolderIds.length === 0
  ) {
    state.fullRefreshRequested = true;
    state.linkedFolderIds?.clear();
    state.linkedChanges = undefined;
  } else if (state.fullRefreshRequested !== true) {
    state.linkedFolderIds ??= new Set<string>();
    for (const folderId of requestedLinkedFolderIds) state.linkedFolderIds.add(folderId);
    if (state.linkedChanges?.kind === 'scope' || linkedChanges?.kind === 'scope' || linkedChanges === undefined) {
      state.linkedChanges = { kind: 'scope' };
    } else {
      const pathsByFolder = new Map<string, Set<string>>(
        [...(state.linkedChanges?.pathsByFolder ?? new Map())]
          .map(([folderId, paths]) => [folderId, new Set(paths)]),
      );
      for (const [folderId, paths] of linkedChanges.pathsByFolder) {
        const mergedPaths = pathsByFolder.get(folderId) ?? new Set<string>();
        for (const relativePath of paths) mergedPaths.add(relativePath);
        pathsByFolder.set(folderId, mergedPaths);
      }
      const changedPathCount = [...pathsByFolder.values()]
        .reduce((total, paths) => total + paths.size, 0);
      state.linkedChanges = changedPathCount > MAX_LINKED_WATCHER_CHANGED_FILES
        ? { kind: 'scope' }
        : { kind: 'files', pathsByFolder };
    }
  }
  // A native event is more specific than the periodic checkpoint. If both
  // arrive in one debounce window, retain the watcher reason so a changed
  // file is reconciled immediately instead of being fingerprint-only.
  if (reason === 'watcher' || !wasDirty) state.reason = reason;
  else if (state.reason !== 'watcher') state.reason = reason;
  // A refresh already owns the filesystem snapshot. The completion handler
  // schedules one trailing pass if another event arrived while it ran.
  if (state.promise) return;
  const scheduler = this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER;
  try {
    if (state.timer !== undefined) scheduler.cancel(state.timer);
    state.timer = scheduler.schedule(() => {
      state.timer = undefined;
      if (!state.dirty || !this.openById.has(libraryId)) return;
      state.dirty = false;
      const refreshReason = state.reason;
      const triggerScope = state.triggerScope;
      const fullRefresh = state.fullRefreshRequested === true || refreshReason === 'network';
      const linkedFolderIds = fullRefresh
        ? undefined
        : [...(state.linkedFolderIds ?? [])];
      const linkedChanges = fullRefresh ? undefined : state.linkedChanges;
      state.reason = 'watcher';
      state.triggerScope = undefined;
      state.fullRefreshRequested = false;
      state.linkedFolderIds = undefined;
      state.linkedChanges = undefined;
      const refresh = this.runWatcherReconciliation(
        libraryId,
        refreshReason,
        triggerScope,
        linkedFolderIds?.length ? linkedFolderIds : undefined,
        linkedChanges?.kind === 'files' ? linkedChanges.pathsByFolder : undefined,
      );
      state.promise = refresh;
      return refresh.then(
        () => this.finishWatcherRefresh(libraryId, state),
        (error) => {
          if (!(error instanceof Error && error.name === 'AbortError')) {
            this.diagnose('asset-watcher.refresh', error, { libraryId });
          }
          this.finishWatcherRefresh(libraryId, state);
        },
      );
    }, this.options.debounceMs ?? 250);
  } catch (error) {
    state.timer = undefined;
    this.diagnose(String(diagnosticContext.scope ?? 'asset-watcher.schedule'), error, diagnosticContext);
    if (state.reason === 'network') {
      this.scheduleNetworkScan(libraryId, this.networkScanIntervalMs());
    }
    // Scheduler failures leave explicit/manual refresh available and must
    // never escape the native observer callback.
  }
}

export function finishWatcherRefresh(this: LibraryService, libraryId: string, state: WatchRefreshState): void {
  if (this.watchRefreshByLibrary.get(libraryId) !== state) return;
  state.promise = undefined;
  if (state.dirty && this.openById.has(libraryId)) {
    const fullRefresh = state.fullRefreshRequested === true || state.reason === 'network';
    const linkedFolderIds = fullRefresh ? undefined : [...(state.linkedFolderIds ?? [])];
    const linkedChanges = fullRefresh ? undefined : state.linkedChanges;
    this.scheduleWatcherRefresh(
      libraryId,
      {
        scope: state.triggerScope ?? 'asset-watcher.schedule',
        libraryId,
        ...(fullRefresh
          ? { fullRefresh: true }
          : linkedFolderIds?.length
            ? { linkedFolderIds }
            : {}),
      },
      state.reason,
      linkedChanges,
    );
    return;
  }
  if (this.openById.get(libraryId)?.summary.networkStorage) {
    this.scheduleNetworkScan(libraryId, this.networkScanIntervalMs());
  }
}

/**
* Run the watcher pass through the same cancellable async discovery owner as
* open reconciliation. A watcher never performs the old synchronous full
* `refreshManagedAssets` call on the Worker event loop.
*/
export async function runWatcherReconciliation(this: LibraryService, libraryId: string, reason: 'watcher' | 'network' = 'watcher', triggerScope?: string, linkedFolderIds?: string[], linkedFilePathsByFolder?: Map<string, Set<string>>): Promise<void> {
  const initialLibrary = this.openById.get(libraryId);
  if (!initialLibrary || initialLibrary.readOnly) return;
  const previous = this.reconciliationOwner.current(libraryId);
  if (previous) {
    try {
      await previous.promise;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        this.diagnose('asset-watcher.wait-for-reconciliation', error, { libraryId });
      }
    }
  }
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary || openLibrary !== initialLibrary || openLibrary.readOnly) return;

  const task = this.reconciliationOwner.register({
    libraryId,
    openLibrary,
    reason,
    ...(triggerScope === undefined ? {} : { triggerScope }),
    ...(linkedFolderIds === undefined ? {} : { linkedFolderIds }),
    ...(linkedFilePathsByFolder === undefined ? {} : { linkedFilePathsByFolder }),
  });
  task.promise = (async () => {
    try {
      await this.yieldReconciliation(task);
      if (reason === 'network') {
        await this.refreshNetworkMetadataCache(openLibrary, task, 'network');
      }
      await this.refreshManagedAssetsOnOpen(
        libraryId,
        task,
        reason === 'network' ? 'network-scan.refresh' : 'asset-watcher.refresh',
      );
    } catch (error) {
      // Closing a library deliberately aborts a watcher reconciliation before
      // awaiting it. Treat that cancellation as a settled task so close does
      // not leak an expected AbortError through the Worker IPC boundary.
      if (error instanceof Error && error.name === 'AbortError') return;
      throw error;
    }
  })();
  try {
    await task.promise;
  } finally {
    this.reconciliationOwner.clearIfCurrent(task);
  }
}

export function stopAssetWatcher(this: LibraryService, libraryId: string): void {
  const libraryWatch = this.watchByLibraryId.get(libraryId);
  this.watchByLibraryId.delete(libraryId);
  const state = this.watchRefreshByLibrary.get(libraryId);
  this.watchRefreshByLibrary.delete(libraryId);
  if (state?.timer !== undefined) {
    try {
      (this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER).cancel(state.timer);
    } catch (error) {
      this.diagnose('asset-watcher.cancel', error, { libraryId });
      // Continue closing the observer and database.
    }
  }
  const networkScan = this.networkScanByLibrary.get(libraryId);
  this.networkScanByLibrary.delete(libraryId);
  if (networkScan?.timer !== undefined) {
    try {
      (this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER).cancel(networkScan.timer);
    } catch (error) {
      this.diagnose('network-watcher.cancel', error, { libraryId });
    }
  }
  if (!libraryWatch) return;
  try {
    libraryWatch.observer.close();
  } catch (error) {
    this.diagnose('asset-watcher.close', error, { libraryId });
    // Closing the database is still required even if the native observer already failed.
  }
}

export async function refreshNetworkMetadataCache(this: LibraryService, openLibrary: OpenLibrary, task: OpenReconciliationTask, reason: 'open' | 'network'): Promise<void> {
  const state = openLibrary.networkMetadataCache;
  if (!state) return;
  const libraryId = openLibrary.summary.libraryId;
  const sourceState = this.networkMetadataSourceState(
    openLibrary.writeConnection,
    libraryId,
    state.databasePath,
  );
  if (!sourceState) {
    // A transient network failure must not blank the last verified local
    // view. Keep it read-only/stale and let the next low-frequency scan
    // validate the remote truth before replacing it.
    this.emitNetworkMetadataCacheEvent({
      type: 'offline',
      libraryId,
      sourceChangeSequence: state.manifest?.sourceChangeSequence,
      reason: 'remote-source-state-unavailable',
    });
    return;
  }
  if (sourceState.schemaVersion !== state.schemaVersion) {
    state.readThrough.invalidateReadConnection();
    this.emitNetworkMetadataCacheEvent({
      type: 'error',
      libraryId,
      reason: 'remote-source-state-unavailable',
    });
    return;
  }

  const currentManifest = state.manifest;
  const sourceFingerprintChanged = state.observedSourceFingerprint !== undefined
    && !networkMetadataSourceFingerprintEqual(
      state.observedSourceFingerprint,
      sourceState.sourceFingerprint,
    );
  const currentSnapshotIsCurrent = currentManifest !== undefined
    && currentManifest.sourceChangeSequence === sourceState.sourceChangeSequence
    && currentManifest.schemaVersion === sourceState.schemaVersion;
  if (currentSnapshotIsCurrent && !sourceFingerprintChanged && state.readThrough.readCacheActive) return;

  if (state.refreshInFlight) {
    await state.refreshInFlight;
    return;
  }

  const sourceCursorChanged = currentManifest !== undefined
    && currentManifest.sourceChangeSequence !== sourceState.sourceChangeSequence;
  if (sourceCursorChanged || sourceFingerprintChanged) {
    // The source state is now known to be newer/different. Stop serving the
    // old snapshot immediately; a failed/oversized refresh must fall back to
    // the remote primary rather than keep showing known-stale catalog rows.
    state.readThrough.invalidateReadConnection();
    this.emitNetworkMetadataCacheEvent({
      type: 'stale',
      libraryId,
      sourceChangeSequence: sourceState.sourceChangeSequence,
      reason: sourceFingerprintChanged ? 'remote-source-fingerprint' : reason,
    });
  }
  const startedAt = performance.now();
  this.emitNetworkMetadataCacheEvent({
    type: 'refresh-started',
    libraryId,
    sourceChangeSequence: sourceState.sourceChangeSequence,
    reason,
  });
  const refresh = (async (): Promise<void> => {
    let attemptSourceState = sourceState;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let verifiedSourceState: NetworkMetadataSourceState | undefined;
      try {
        this.assertReconciliationActive(task);
        const loaded = await this.networkMetadataCache.createSnapshot({
          onProgress: this.options.onNetworkMetadataSnapshotProgress,
          cacheKey: state.cacheKey,
          libraryId,
          schemaVersion: attemptSourceState.schemaVersion,
          sourceChangeSequence: attemptSourceState.sourceChangeSequence,
          sourceFingerprint: attemptSourceState.sourceFingerprint,
          sourceConnection: openLibrary.writeConnection,
          signal: task.controller.signal,
          openReadonly: (snapshotPath) => openConfiguredDatabase(
            snapshotPath,
            this.options.sqliteBusyTimeoutMsForTests,
            { readonly: true },
          ),
          validate: (connection) => this.validateNetworkMetadataSnapshot(
            connection as DatabaseConnection,
            libraryId,
            attemptSourceState.schemaVersion,
          ),
          beforePublish: () => {
            const currentSourceState = this.networkMetadataSourceState(
              openLibrary.writeConnection,
              libraryId,
              state.databasePath,
            );
            return currentSourceState !== undefined
              && currentSourceState.sourceChangeSequence === attemptSourceState.sourceChangeSequence
              && networkMetadataSourceFingerprintEqual(
                currentSourceState.sourceFingerprint,
                attemptSourceState.sourceFingerprint,
              );
          },
          afterPublish: () => {
            const currentSourceState = this.networkMetadataSourceState(
              openLibrary.writeConnection,
              libraryId,
              state.databasePath,
            );
            if (
              currentSourceState === undefined
              || currentSourceState.sourceChangeSequence !== attemptSourceState.sourceChangeSequence
              || !networkMetadataSourceFingerprintEqual(
                currentSourceState.sourceFingerprint,
                attemptSourceState.sourceFingerprint,
              )
            ) return false;
            verifiedSourceState = currentSourceState;
            return true;
          },
        });
        const accepted = await this.networkMetadataCache.acceptSnapshot({
          snapshot: loaded,
          accept: (acceptedSnapshot) => {
            this.assertReconciliationActive(task);
            if (openLibrary.networkMetadataCache !== state) {
              // syncGitignore or another lifecycle boundary replaced this
              // state while the backup was in flight; acceptSnapshot closes
              // the unclaimed connection before the next attempt exits.
              return false;
            }
            state.readThrough.replaceReadConnection(acceptedSnapshot.connection);
            state.manifest = acceptedSnapshot.manifest;
            state.observedSourceFingerprint = verifiedSourceState?.sourceFingerprint
              ?? attemptSourceState.sourceFingerprint;
            state.observedSourceChangeSequence = verifiedSourceState?.sourceChangeSequence
              ?? attemptSourceState.sourceChangeSequence;
            return true;
          },
        });
        if (accepted) {
          this.emitNetworkMetadataCacheEvent({
            type: 'refreshed',
            libraryId,
            sourceChangeSequence: loaded.manifest.sourceChangeSequence,
            durationMs: Math.round(performance.now() - startedAt),
            reason,
          });
          return;
        }

        if (openLibrary.networkMetadataCache !== state) return;
        if (attempt === 0) {
          const retrySourceState = this.networkMetadataSourceState(
            openLibrary.writeConnection,
            libraryId,
            state.databasePath,
          );
          if (retrySourceState && retrySourceState.schemaVersion === state.schemaVersion) {
            attemptSourceState = retrySourceState;
            continue;
          }
        }
        this.emitNetworkMetadataCacheEvent({
          type: 'refresh-skipped',
          libraryId,
          sourceChangeSequence: attemptSourceState.sourceChangeSequence,
          durationMs: Math.round(performance.now() - startedAt),
          reason: 'publication-raced',
        });
        return;
      } catch (error) {
        if (task.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
        if (error instanceof NetworkMetadataSnapshotRejectedError) {
          this.emitNetworkMetadataCacheEvent({
            type: 'refresh-skipped',
            libraryId,
            sourceChangeSequence: verifiedSourceState?.sourceChangeSequence ?? attemptSourceState.sourceChangeSequence,
            durationMs: Math.round(performance.now() - startedAt),
            reason: error.reason,
          });
          return;
        }
        this.emitNetworkMetadataCacheEvent({
          type: 'error',
          libraryId,
          durationMs: Math.round(performance.now() - startedAt),
          reason: 'snapshot-failed',
        });
        this.diagnose('network-metadata-cache.refresh', error, { libraryId, reason });
        return;
      }
    }
  })();
  state.refreshInFlight = refresh;
  try {
    await refresh;
  } finally {
    if (state.refreshInFlight === refresh) state.refreshInFlight = undefined;
  }
}

/**
* Serpent-tumv (LIB-018, deferred open maintenance): the disk-heavy post-open
* reconciliation that used to run inside the synchronous library.open —
* artifact-file sweep, expired-trash purge, and the whole Assets-directory
* rescan. The Worker runtime starts this after the library.opened response
* has been delivered; each step yields the event loop so the user's first
* browse requests are not starved behind a large-library rescan.
*/
export async function runOpenBackgroundReconciliation(this: LibraryService, libraryId: string, options?: {
      admissionYield?: () => Promise<void>;
      /** Queue only primary previews invalidated by the bounded artifact scan. */
      onMissingPrimaryArtifacts?: (assetIds: string[]) => void;
    }): Promise<void> {
  const openLibrary = this.openById.get(libraryId);
  if (!openLibrary || openLibrary.readOnly) return;
  this.cancelDeferredOpenMaintenance(libraryId);
  this.reconciliationOwner.abort(libraryId);
  const task = this.reconciliationOwner.register({
    libraryId,
    openLibrary,
    reason: 'open',
    ...(options?.admissionYield === undefined ? {} : { admissionYield: options.admissionYield }),
  });
  const generation = task.generation;
  const stageLog = process.env.KEEL_REFRESH_STAGE_LOG === '1';
  const startedAt = performance.now();
  let stageMark = startedAt;
  const markStage = (stage: string): void => {
    if (!stageLog) return;
    const now = performance.now();
    console.error(JSON.stringify({
      scope: 'open.reconciliation.stage',
      libraryId,
      generation,
      stage,
      durationMs: Math.round((now - stageMark) * 100) / 100,
      totalMs: Math.round((now - startedAt) * 100) / 100,
    }));
    stageMark = now;
  };

  task.promise = (async () => {
    try {
      // Establish the pre-reconciliation safety point before any background
      // write. Every subsequent stage is owned by this open generation.
      await this.yieldReconciliation(task);
      this.assertReconciliationActive(task);
      // Schema/identity validation already ran in the synchronous open.
      // Keep this cheap guard here; the full quick_check is deliberately
      // deferred until the end so a 20k-library integrity scan cannot sit in
      // front of the first viewer request.
      await this.refreshNetworkMetadataCache(openLibrary, task, 'open');
      markStage('network-metadata-cache');
      readLibraryIdentity(openLibrary.connection, { skipQuickCheck: true });
      markStage('identity');
      await this.yieldReconciliation(task);
      await this.linkedDirectoryIndex(openLibrary).recover(() => this.yieldReconciliation(task));
      markStage('directory-index-recovery');

      // The first pass is source reconciliation: it repairs the browse
      // surface before optional maintenance touches old rows. This keeps a
      // large ignored subtree or a stale trash sweep from delaying the first
      // usable browse/viewer response.
      await this.refreshManagedAssetsOnOpen(libraryId, task);
      markStage('asset-reconciliation');
      await this.yieldReconciliation(task);

      this.assertReconciliationActive(task);
      await this.reconcileDefaultIgnoredAssets(openLibrary, task);
      markStage('default-ignore-cleanup');
      await this.yieldReconciliation(task);
      this.assertReconciliationActive(task);
      this.retireLegacyGifProxyJobs(openLibrary);
      markStage('legacy-proxy-cleanup');
      await this.yieldReconciliation(task);
      // The verified backup is important, but its native copy plus the
      // destination quick_check are synchronous enough to produce a visible
      // event-loop spike on a large library. Keep it in the same generation
      // owner, but schedule it after reconciliation returns and the user is
      // idle rather than making it part of the first browse critical path.
      markStage('backup-deferred');
      await this.yieldReconciliation(task);

      try {
        this.assertReconciliationActive(task);
        this.purgeExpiredTrash(libraryId);
        markStage('trash-purge');
      } catch (error) {
        if (task.controller.signal.aborted) throw error;
        this.diagnose('trash.purge-on-open', error, { libraryId });
      }
      await this.yieldReconciliation(task);
      this.assertReconciliationActive(task);
      const current = this.openById.get(libraryId);
      if (current) markStage('post-reconciliation-backup-deferred');
      await this.yieldReconciliation(task);
      this.assertReconciliationActive(task);
      await this.warmBrowseIndexCache(openLibrary, task);
      markStage('index-warm');
      // Artifact-file reconciliation remains last and yields between every
      // directory batch. It repairs derived-file drift without competing
      // with the first browse/viewer requests.
      await this.yieldReconciliation(task);
      this.assertReconciliationActive(task);
      await this.reconcileMissingArtifactFiles(
        openLibrary,
        () => this.yieldReconciliation(task),
        options?.onMissingPrimaryArtifacts,
      );
      markStage('artifact-reconciliation');
      this.assertReconciliationActive(task);
      await this.reconcileOrphanArtifactFiles(openLibrary, () => this.yieldReconciliation(task));
      markStage('artifact-orphan-cleanup');
      this.assertReconciliationActive(task);
      // quick_check(1) is a single synchronous SQLite operation and cannot
      // be time-sliced. Schedule it after this owner returns so the final
      // maintenance scan cannot become the tail latency of a viewer request.
      // The timer rechecks the interaction idle window and is cancelled when
      // the library generation closes or is replaced.
      this.scheduleDeferredOpenMaintenance(openLibrary, generation);
      markStage('open-maintenance-deferred');
    } catch (error) {
      if (task.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      this.diagnose('open.background-reconciliation', error, { libraryId, generation });
    }
  })();

  try {
    await task.promise;
  } finally {
    this.reconciliationOwner.clearIfCurrent(task);
  }
}

/** Request the current open-generation owner to stop at its next safe point. */
export function cancelOpenBackgroundReconciliation(this: LibraryService, libraryId: string): void {
  this.reconciliationOwner.abort(libraryId);
}

/**
* Fence a pending filesystem reconciliation before an explicit source-root
* mutation. A watcher can have already captured the old root while the user
* is choosing a replacement; allowing that stale snapshot to commit after
* relink would immediately mark the restored assets missing again.
*/
export function cancelReconciliationForClientMutation(this: LibraryService, libraryId: string): void {
  this.cancelDeferredOpenMaintenance(libraryId);
  this.cancelOpenBackgroundReconciliation(libraryId);
  const state = this.watchRefreshByLibrary.get(libraryId);
  if (!state) return;
  if (state.timer !== undefined) {
    try {
      (this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER).cancel(state.timer);
    } catch (error) {
      this.diagnose('asset-watcher.cancel-before-mutation', error, { libraryId });
    }
    state.timer = undefined;
  }
  state.dirty = false;
  state.reason = 'watcher';
  state.fullRefreshRequested = false;
  state.linkedFolderIds = undefined;
  state.linkedChanges = undefined;
}

export function watcherStableFileWindowMs(this: LibraryService): number {
  const configured = this.options.watcherStableFileWindowMs;
  if (configured === undefined) return 200;
  if (!Number.isFinite(configured)) return 200;
  return Math.max(0, Math.min(5_000, Math.trunc(configured)));
}

export async function waitForWatcherStabilityWindow(this: LibraryService, task: OpenReconciliationTask, delayMs: number): Promise<void> {
  this.assertReconciliationActive(task);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      task.controller.signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    timer.unref?.();
    const abort = (): void => {
      clearTimeout(timer);
      task.controller.signal.removeEventListener('abort', abort);
      reject(this.reconciliationAbortError());
    };
    task.controller.signal.addEventListener('abort', abort, { once: true });
  });
  this.assertReconciliationActive(task);
}

/**
* Prepare fingerprints for the open-generation snapshot before any
* `refreshManagedAssets` transaction starts. In particular, portable-copy
* mtime changes must not make the transaction read and hash every source
* file while holding SQLite's writer lock (0032 §7).
*/
export async function prepareOpenReconciliationFingerprints(this: LibraryService, task: OpenReconciliationTask, discovery: RefreshManagedAssetsDiscovery, existingAssets: ReadonlyArray<{
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      byte_size: number | null;
      modified_at: string | null;
    }>): Promise<void> {
  const openLibrary = task.openLibrary;
  const existingById = new Map(existingAssets.map((asset) => [asset.asset_id, asset]));
  const entries = [
    ...[...discovery.linkedEntriesByFolder.values()].flat(),
    ...discovery.managedEntries,
  ];
  const readBuffer = Buffer.allocUnsafe(1 << 20);
  let sliceStartedAt = performance.now();

  for (const entry of entries) {
    this.assertReconciliationActive(task);
    const asset = entry.assetId === undefined ? undefined : existingById.get(entry.assetId);
    if (!asset) continue;

    const timestampEquivalent = Math.abs(
      Date.parse(entry.modifiedAt) - Date.parse(asset.modified_at ?? ''),
    ) <= 1;
    const byteChanged = entry.byteSize !== (asset.byte_size ?? -1);
    const mtimeChanged = entry.modifiedAt !== (asset.modified_at ?? '') && !timestampEquivalent;
    if (!byteChanged && !mtimeChanged) continue;

    const sourcePath = asset.location_kind === 'linked'
      ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, entry.relativePath)
      : this.folderPath(openLibrary, entry.relativePath);
    // This is deliberately awaited before refreshManagedAssets enters its
    // transaction. The bounded stream prevents a large source from causing
    // the memory spike that a readFile/hash implementation would create.
    entry.contentFingerprint = await this.computeContentFingerprintAsync(
      sourcePath,
      task.controller.signal,
      readBuffer,
      () => this.yieldReconciliation(task),
    );

    if (performance.now() - sliceStartedAt >= 6) {
      await this.yieldReconciliation(task);
      sliceStartedAt = performance.now();
    }
  }
}

export function reconciliationAbortError(this: LibraryService): Error {
  return this.reconciliationOwner.abortError();
}

export function assertReconciliationActive(this: LibraryService, task: OpenReconciliationTask): void {
  if (
    task.controller.signal.aborted
    || !this.reconciliationOwner.isCurrent(task)
    || this.openById.get(task.libraryId) !== task.openLibrary
    || !this.sqlitePrimaryIsOpen(task.openLibrary)
  ) {
    throw this.reconciliationAbortError();
  }
}

export async function yieldReconciliation(this: LibraryService, task: OpenReconciliationTask): Promise<void> {
  this.assertReconciliationActive(task);
  await new Promise<void>((resolve) => setImmediate(resolve));
  this.assertReconciliationActive(task);
  // Serpent-be29a9: hand the background admission back before parking. The
  // scheduler admits a queued interactive request or mutation immediately
  // instead of waiting for this pass to finish (measured: 28.3 s of
  // navigation wait behind one open reconciliation that ran up to 25.8 s as a
  // single admitted task). No-op when nothing is waiting.
  await task.admissionYield?.();
  this.assertReconciliationActive(task);
  // A single 100ms sleep is not an idle window: it merely delays the next
  // synchronous stage while the user is still interacting. The old code
  // then entered identity/source reconciliation with up to ~2s of active
  // viewer/browse traffic remaining, which reproduced as a 300–500ms page
  // queue on the first scrollbar jump. Stay parked in bounded timer slices
  // until the latest interaction deadline really expires.
  while (true) {
    const remainingMs = (this.interactiveIdleUntilByLibrary.get(task.libraryId) ?? 0) - Date.now();
    if (remainingMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remainingMs, 100)));
    this.assertReconciliationActive(task);
  }
}

export function refreshManagedAssets(this: LibraryService, libraryId: string, options: { includeAssets: true } & RefreshManagedAssetsOptions): AssetRefreshResult & { assets: AssetSummary[] };
export function refreshManagedAssets(this: LibraryService, libraryId: string, options?: RefreshManagedAssetsOptions): AssetRefreshResult;
export function refreshManagedAssets(this: LibraryService, libraryId: string, options?: RefreshManagedAssetsOptions): AssetRefreshResult {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // Serpent-4bdd26 收编 codex/large-library-performance@15f3325c：
  // assetIds 限定已有资产的 stat/revision 对账范围；空列表仍表示“只发现
  // 新文件”，而带 discovery 的非空列表还可以复用同一批异步文件快照来
  // 对账已有资产。discoverSources=false 跳过文件系统枚举（仅缺失资产
  // 批次走 fallback lstat）。
  const assetIds = options?.assetIds;
  type RefreshAssetRow = {
    asset_id: string;
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_file_path: string;
    current_revision_id: string;
    revision_row_id: string | null;
    availability: 'available' | 'missing';
    byte_size: number | null;
    modified_at: string | null;
    content_fingerprint: string | null;
    source_device: string | null;
    source_inode: string | null;
  };
  const queryBefore = (placeholders?: string): string =>
    `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.relative_file_path,
            a.current_revision_id, r.revision_id AS revision_row_id,
            a.availability, r.byte_size, r.modified_at,
            r.content_fingerprint, a.source_device, a.source_inode
      FROM assets a
       LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL${placeholders === undefined
        ? ''
        : placeholders === ''
          ? ' AND 1 = 0'
          : ` AND a.asset_id IN (${placeholders})`}
      ORDER BY a.relative_file_path`;
  const discoverSources = options?.discoverSources ?? true;
  const discovery = discoverSources
    ? options?.discovery ?? this.collectManagedAssetDiscovery(openLibrary)
    : undefined;
  if (discovery) this.reconcileMovedLinkedAssets(openLibrary, discovery);
  // Serpent-onch 风格分阶段计时：KEEL_REFRESH_STAGE_LOG=1 时输出各阶段耗时，
  // 用于大库全量对账的归因（Serpent-4bdd26）。生产默认关闭。
  const stageLog = process.env.KEEL_REFRESH_STAGE_LOG === '1';
  const stageStartedAt = stageLog ? performance.now() : 0;
  let stageMark = stageStartedAt;
  const markStage = (label: string): void => {
    if (!stageLog) return;
    const now = performance.now();
    console.error(JSON.stringify({
      scope: 'refresh.managed-assets.stage',
      libraryId,
      stage: label,
      durationMs: Math.round((now - stageMark) * 100) / 100,
    }));
    stageMark = now;
  };
  const requestedAssetIds = assetIds === undefined ? undefined : [...new Set(assetIds)];
  const before = requestedAssetIds === undefined
    ? openLibrary.connection.prepare(queryBefore()).all() as RefreshAssetRow[]
    : sqliteAllInChunks<string, RefreshAssetRow>({
        connection: openLibrary.connection,
        values: requestedAssetIds,
        buildSql: queryBefore,
      });
  markStage('before-query');

  // A refresh can also be triggered by a watcher or an explicit client
  // command, not only by the async open owner. Prepare any needed content
  // identity before the transaction for those callers too. The open path
  // already carries an async fingerprint on each discovery entry; ordinary
  // refreshes use a synchronous preflight. If a source appears in the small
  // race after that preflight, the commit below is deliberately conservative
  // and stores a null fingerprint rather than reading the file under the
  // SQLite writer lock (0032 §7/§14).
  const managedPreflightByIdentity = new Map(
    (discovery?.managedEntries ?? []).map((entry) => [
      portablePathIdentity(entry.relativePath),
      entry,
    ]),
  );
  const linkedPreflightByKey = new Map<string, DiscoveredSourceEntry>();
  const linkedPreflightByAssetId = new Map<string, DiscoveredSourceEntry>();
  for (const [folderId, entries] of discovery?.linkedEntriesByFolder ?? []) {
    for (const entry of entries) {
      linkedPreflightByKey.set(
        `${folderId}\u0000${portablePathIdentity(entry.relativePath)}`,
        entry,
      );
      if (entry.assetId !== undefined) linkedPreflightByAssetId.set(entry.assetId, entry);
    }
  }
  const preflightSourceByAssetId = new Map<string, {
    byteSize: number;
    modifiedAt: string;
    fingerprint?: string;
  }>();
  const preflightFingerprintFor = (
    asset: (typeof before)[number],
    entry: DiscoveredSourceEntry | undefined,
  ): void => {
    let byteSize: number;
    let modifiedAt: string;
    let sourcePath: string | undefined;
    if (entry) {
      byteSize = entry.byteSize;
      modifiedAt = entry.modifiedAt;
    } else if (options?.discoverSources === false) {
      sourcePath = asset.location_kind === 'linked'
        ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path)
        : this.folderPath(openLibrary, asset.relative_file_path);
      let fileStat: BigIntStats | Stats;
      try {
        fileStat = this.options.assetLstat
          ? this.options.assetLstat(sourcePath)
          : lstatSync(sourcePath, { bigint: true });
      } catch (error) {
        if (isUnreadablePathError(error)) return;
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
      }
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) return;
      byteSize = Number(fileStat.size);
      modifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
    } else {
      return;
    }
    if (!Number.isSafeInteger(byteSize)) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
        reason: 'UNSUPPORTED_FILE_ENTRY',
      });
    }

    const previousModifiedAt = asset.modified_at ?? '';
    const previousByteSize = asset.byte_size ?? -1;
    const timestampEquivalent = Math.abs(Date.parse(modifiedAt) - Date.parse(previousModifiedAt)) <= 1;
    const byteChanged = byteSize !== previousByteSize;
    const mtimeChanged = modifiedAt !== previousModifiedAt && !timestampEquivalent;
    const sourceChanged = byteChanged || mtimeChanged || !asset.revision_row_id;
    let fingerprint: string | undefined;
    if (sourceChanged) {
      // Discovery already stat'ed and validated every unchanged entry.
      // Resolve/validate the path again only when this row is about to read
      // or replace source identity; doing it for every stable asset repeated
      // root + ancestor lstat/realpath calls on network libraries.
      sourcePath ??= asset.location_kind === 'linked'
        ? this.linkedAssetPath(
          openLibrary,
          asset.linked_folder_id,
          entry?.relativePath ?? asset.relative_file_path,
        )
        : this.folderPath(
          openLibrary,
          entry?.relativePath ?? asset.relative_file_path,
        );
      fingerprint = entry?.contentFingerprint ?? this.computeContentFingerprint(sourcePath);
    }
    preflightSourceByAssetId.set(asset.asset_id, {
      byteSize,
      modifiedAt,
      ...(fingerprint === undefined ? {} : { fingerprint }),
    });
  };
  for (const asset of before) {
    const entry = asset.location_kind === 'linked'
      ? linkedPreflightByKey.get(
        `${asset.linked_folder_id ?? ''}\u0000${portablePathIdentity(asset.relative_file_path)}`,
      ) ?? linkedPreflightByAssetId.get(asset.asset_id)
      : managedPreflightByIdentity.get(portablePathIdentity(asset.relative_file_path));
    preflightFingerprintFor(asset, entry);
  }
  markStage('precompute-fingerprints');

  let changedCount = 0;
  let missingCount = 0;
  const discoveredAssetIds: string[] = [];
  // Serpent-4bdd26: per-file stats gathered once by the enumerations below
  // and consumed by the comparison loop, so a full refresh costs one lstat
  // per file instead of two (measured ~10ms per round trip on SMB).
  const linkedSnapshot = new Map<string, DiscoveredSourceEntry>();

  openLibrary.connection.transaction(() => {
    if (!discovery) this.reconcileLinkedFolderStatuses(openLibrary);
    const folderNow = new Date().toISOString();
    // Each discovery batch carries one bounded filesystem snapshot. Reuse
    // the caller's identity maps so this loop does not rescan all 20k asset
    // identities for every 64-file transaction.
    const linkedFolderIds = discovery === undefined
      ? []
      : [...discovery.linkedEntriesByFolder.keys()];
    const linkedFolderRows = linkedFolderIds.length === 0
      ? []
      : withSqliteInPredicate(
        openLibrary.connection,
        'folder_id',
        linkedFolderIds,
        (sql, params) =>
          openLibrary.connection
            .prepare(
              `SELECT folder_id, absolute_root_path, status
                 FROM linked_folders
                WHERE ${sql}`,
            )
            .all(...params) as Array<{
              folder_id: string;
              absolute_root_path: string;
              status: 'available' | 'offline';
            }>,
      );
    for (const folder of linkedFolderRows) {
      if (this.linkedRootIsGone(folder.absolute_root_path)) continue;

      const existingIdentities = discovery?.existingLinkedAssetIdsByFolder?.get(folder.folder_id)
        ?? new Map(
          (openLibrary.connection
            .prepare('SELECT asset_id, path_identity FROM assets WHERE linked_folder_id = ?')
            .all(folder.folder_id) as Array<{ asset_id: string; path_identity: string }>)
            .map((row) => [row.path_identity, row.asset_id] as const),
        );
      const insertAsset = openLibrary.connection.prepare(
        `INSERT INTO assets
           (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
            path_identity, current_revision_id, availability, source_device, source_inode,
            created_at, updated_at)
         VALUES (?, 'linked', NULL, ?, ?, ?, NULL, 'available', ?, ?, ?, ?)`,
      );
      const insertRevision = openLibrary.connection.prepare(
        `INSERT INTO revisions
           (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
            original_filename, origin, accepted_at)
         VALUES (?, ?, NULL, ?, ?, ?, 'external_change', ?)`,
      );
      const setCurrentRevision = openLibrary.connection.prepare(
        'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
      );
      for (const entry of discovery?.linkedEntriesByFolder.get(folder.folder_id) ?? []) {
        // Serpent-4bdd26: the enumeration already lstat'ed every file; keep
        // its size/mtime so the comparison loop below reuses one stat per
        // file instead of issuing a second network round trip per asset.
        linkedSnapshot.set(
          `${folder.folder_id}\u0000${portablePathIdentity(entry.relativePath)}`,
          entry,
        );
        const pathIdentity = portablePathIdentity(entry.relativePath);
        if (existingIdentities.has(pathIdentity)) continue;
        const assetId = randomUUID();
        const revisionId = randomUUID();
        insertAsset.run(
          assetId,
          folder.folder_id,
          entry.relativePath,
          pathIdentity,
          entry.sourceDevice ?? null,
          entry.sourceInode ?? null,
          folderNow,
          folderNow,
        );
        insertRevision.run(
          revisionId,
          assetId,
          entry.byteSize,
          entry.modifiedAt,
          entry.originalFilename,
          folderNow,
        );
        setCurrentRevision.run(revisionId, folderNow, assetId);
        existingIdentities.set(pathIdentity, assetId);
        this.syncAssetSearchContent(openLibrary.connection, assetId);
        discoveredAssetIds.push(assetId);
        changedCount += 1;
      }
    }

    const folderRows = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity, created_at, appearance_glyph_kind, appearance_glyph_value, appearance_color_id FROM managed_folders ORDER BY relative_path',
      )
      .all() as ManagedFolderRow[];
    const foldersByPath = new Map(folderRows.map((folder) => [folder.path_identity, folder]));
    const existingManagedIdentities = discovery?.existingManagedAssetIdsByIdentity
      ?? new Map(
        (openLibrary.connection
          .prepare("SELECT asset_id, path_identity FROM assets WHERE location_kind = 'managed'")
          .all() as Array<{ asset_id: string; path_identity: string }>)
          .map((row) => [row.path_identity, row.asset_id] as const),
      );
    const managedEntries = discovery?.managedEntries ?? [];
    markStage('enumerate-managed');
    // Serpent-4bdd26: reuse the enumeration stats for the comparison loop —
    // one lstat per file instead of two on the whole-library refresh.
    const managedSnapshot = new Map(
      managedEntries.map((entry) => [
        portablePathIdentity(entry.relativePath),
        entry,
      ]),
    );
    markStage('managed-snapshot');
    const directoriesNeeded = new Set<string>();
    for (const entry of managedEntries) {
      let directory = path.posix.dirname(entry.relativePath);
      while (directory !== '.') {
        directoriesNeeded.add(directory);
        directory = path.posix.dirname(directory);
      }
    }
    for (const relativeDirectory of [...directoriesNeeded].sort()) {
      const directoryIdentity = portablePathIdentity(relativeDirectory);
      if (foldersByPath.has(directoryIdentity)) continue;
      const parentPath = path.posix.dirname(relativeDirectory);
      const parentIdentity = parentPath === '.' ? undefined : portablePathIdentity(parentPath);
      const folder: ManagedFolderRow = {
        folder_id: randomUUID(),
        parent_folder_id:
          parentIdentity === undefined
            ? null
            : (foldersByPath.get(parentIdentity)?.folder_id ?? null),
        name: path.posix.basename(relativeDirectory),
        relative_path: relativeDirectory,
        path_identity: directoryIdentity,
      };
      if (parentPath !== '.' && folder.parent_folder_id === null) continue;
      openLibrary.connection
        .prepare(
          `INSERT INTO managed_folders
             (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          folder.folder_id,
          folder.parent_folder_id,
          folder.name,
          folder.relative_path,
          folder.path_identity,
          folderNow,
        );
      foldersByPath.set(directoryIdentity, folder);
    }
    const insertManagedAsset = openLibrary.connection.prepare(
      `INSERT INTO assets
         (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
          path_identity, current_revision_id, availability, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, ?, NULL, 'available', ?, ?)`,
    );
    const insertManagedRevision = openLibrary.connection.prepare(
      `INSERT INTO revisions
         (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
          original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'external_change', ?)`,
    );
    const setManagedCurrentRevision = openLibrary.connection.prepare(
      'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
    );
    for (const entry of managedEntries) {
      const pathIdentity = portablePathIdentity(entry.relativePath);
      if (existingManagedIdentities.has(pathIdentity)) continue;
      const directory = path.posix.dirname(entry.relativePath);
      const managedFolderId =
        directory === '.'
          ? null
          : (foldersByPath.get(portablePathIdentity(directory))?.folder_id ?? null);
      if (directory !== '.' && managedFolderId === null) continue;
      const assetId = randomUUID();
      const revisionId = randomUUID();
      insertManagedAsset.run(
        assetId,
        managedFolderId,
        entry.relativePath,
        pathIdentity,
        folderNow,
        folderNow,
      );
      insertManagedRevision.run(
        revisionId,
        assetId,
        entry.byteSize,
        entry.modifiedAt,
        entry.originalFilename,
        folderNow,
      );
      setManagedCurrentRevision.run(revisionId, folderNow, assetId);
      existingManagedIdentities.set(pathIdentity, assetId);
      this.syncAssetSearchContent(openLibrary.connection, assetId);
      discoveredAssetIds.push(assetId);
      if (this.thumbnailEligible(openLibrary.summary.libraryId, entry.relativePath)) {
        openLibrary.connection
          .prepare(
            `INSERT OR IGNORE INTO jobs
               (job_id, library_id, asset_id, revision_id, kind, status, priority,
                progress, attempt_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
          )
          .run(randomUUID(), libraryId, assetId, revisionId, folderNow, folderNow);
      }
      changedCount += 1;
    }

    // 离线链接根（root 目录不可用）已由 reconcileLinkedFolderStatuses 置为
    // offline；其资产的缺失属于「目录整体离线」，status-changed 日志已覆盖，
    // 不做逐资产 asset-missing 刷屏（Serpent-c2d052）。
    const offlineLinkedFolderIds = new Set(
      (openLibrary.connection
        .prepare("SELECT folder_id FROM linked_folders WHERE status = 'offline'")
        .all() as Array<{ folder_id: string }>).map((row) => row.folder_id),
    );
    for (const asset of before) {
      if (
        asset.location_kind === 'managed' &&
        openLibrary.preservedRelinkPathIdentities.has(
          portablePathIdentity(asset.relative_file_path),
        )
      ) {
        continue;
      }
      // Serpent-4bdd26: the enumerations above already lstat'ed every
      // source file; consult that snapshot first and only fall back to a
      // direct lstat for rows it cannot cover (e.g. an offline linked root
      // skipped by its enumeration, or ignore-rule edge cases).
      const snapshotKey = asset.location_kind === 'linked'
        ? `${asset.linked_folder_id ?? ''}\u0000${portablePathIdentity(asset.relative_file_path)}`
        : portablePathIdentity(asset.relative_file_path);
      const snapshotEntry = asset.location_kind === 'linked'
        ? linkedPreflightByAssetId.get(asset.asset_id)
          ?? linkedSnapshot.get(snapshotKey)
        : managedSnapshot.get(snapshotKey);
      const pathChanged = asset.location_kind === 'linked'
        && snapshotEntry !== undefined
        && portablePathIdentity(asset.relative_file_path)
          !== portablePathIdentity(snapshotEntry.relativePath);
      const preflightSource = preflightSourceByAssetId.get(asset.asset_id);
      let snapshotByteSize: number | null = null;
      let snapshotModifiedAt: string | null = null;
      // Serpent-4bdd26: only the fallback path needs a fully validated
      // absolute path. folderPath()/linkedAssetPath() lstat every path
      // component (symlink-escape guard) — ~290ms per 20k rows — which is
      // pure waste when the enumeration just walked that exact tree with
      // its own symlink checks. Content fingerprints resolve lazily below.
      const resolveAssetPath = (): string =>
        asset.location_kind === 'linked'
          ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path)
          : this.folderPath(openLibrary, asset.relative_file_path);
      let fileStat: BigIntStats | Stats | undefined;
      if (snapshotEntry) {
        snapshotByteSize = Number.isSafeInteger(snapshotEntry.byteSize)
          ? snapshotEntry.byteSize
          : null;
        snapshotModifiedAt = snapshotEntry.modifiedAt;
      } else {
        try {
          fileStat = this.options.assetLstat
            ? this.options.assetLstat(resolveAssetPath())
            : lstatSync(resolveAssetPath(), { bigint: true });
        } catch (error) {
          if (isUnreadablePathError(error)) {
            fileStat = undefined;
          } else {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
          }
        }
      }
      const sourceDevice = asset.location_kind === 'linked'
        ? snapshotEntry?.sourceDevice
          ?? (fileStat === undefined ? null : String(fileStat.dev))
        : null;
      const sourceInode = asset.location_kind === 'linked'
        ? snapshotEntry?.sourceInode
          ?? (fileStat === undefined ? null : String(fileStat.ino))
        : null;
      const statIsFile = snapshotEntry
        ? true
        : Boolean(fileStat?.isFile() && !fileStat.isSymbolicLink());
      if (!snapshotEntry && (!fileStat || !statIsFile)) {
        if (asset.availability === 'available') {
          openLibrary.connection
            .prepare("UPDATE assets SET availability = 'missing', updated_at = ? WHERE asset_id = ?")
            .run(new Date().toISOString(), asset.asset_id);
          changedCount += 1;
          missingCount += 1;
          // 仅对「链接资产 + 文件夹未离线」的逐文件缺失打日志：managed 资产
          // 不属链接磁盘同步；文件夹整体离线由 status-changed 覆盖，避免
          // 整目录 N 条刷屏（Serpent-c2d052）。
          if (
            asset.location_kind === 'linked'
            && !offlineLinkedFolderIds.has(asset.linked_folder_id ?? '')
          ) {
            this.diagnose('linked-folder.sync.asset-missing', 'External file disappeared from disk; asset marked missing', {
              libraryId: openLibrary.summary.libraryId,
              assetId: asset.asset_id,
              locationKind: asset.location_kind,
              linkedFolderId: asset.linked_folder_id,
              relativeFilePath: asset.relative_file_path,
            });
          }
        }
        continue;
      }

      const byteSize = snapshotEntry
        ? snapshotByteSize!
        : Number(fileStat!.size);
      if (!Number.isSafeInteger(byteSize)) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      // BigIntStats exposes integer mtimeMs while Stats may retain a fractional
      // value whose prebuilt Date rounds differently. Normalize both to the
      // filesystem millisecond used when linked/import revisions are created.
      const modifiedAt = snapshotModifiedAt
        ?? new Date(Number(fileStat!.mtimeMs)).toISOString();
      const currentRelativePath = snapshotEntry?.relativePath ?? asset.relative_file_path;
      if (!asset.revision_row_id) {
        // A dangling current_revision_id (or a NULL revision after a partial
        // write) must stay visible until this source-backed repair completes.
        // Rebuild the durable revision from the file instead of dropping the
        // asset from browse results through an inner join.
        const revisionId = randomUUID();
        const now = new Date().toISOString();
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at, content_fingerprint)
             VALUES (?, ?, NULL, ?, ?, ?, 'external_change', ?, ?)`,
          )
          .run(
            revisionId,
            asset.asset_id,
            byteSize,
            modifiedAt,
            path.posix.basename(currentRelativePath),
            now,
            snapshotEntry?.contentFingerprint
              ?? preflightSource?.fingerprint
              ?? null,
          );
        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET current_revision_id = ?, availability = 'available',
                    relative_file_path = ?, path_identity = ?, source_device = ?,
                    source_inode = ?, updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            revisionId,
            currentRelativePath,
            portablePathIdentity(currentRelativePath),
            sourceDevice,
            sourceInode,
            now,
            asset.asset_id,
          );
        if (
          this.thumbnailEligible(openLibrary.summary.libraryId, currentRelativePath)
          && !this.isExplicitlyIgnored(
            openLibrary,
            asset.location_kind,
            asset.linked_folder_id,
            currentRelativePath,
            'asset',
          )
        ) {
          openLibrary.connection
            .prepare(
              `INSERT OR IGNORE INTO jobs
                 (job_id, library_id, asset_id, revision_id, kind, status, priority,
                  progress, attempt_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
            )
            .run(randomUUID(), libraryId, asset.asset_id, revisionId, now, now);
        }
        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        discoveredAssetIds.push(asset.asset_id);
        changedCount += 1;
        continue;
      }
      // On APFS, fs.utimes() can restore an ISO millisecond as one microsecond
      // less (for example .178000 -> .177999), which crosses the Date floor and
      // used to create a phantom revision when a missing file reappeared. Only
      // tolerate that one-millisecond representation edge while restoring a
      // missing asset; available-file refreshes retain exact change detection.
      // Files copied from an exported library can round an ISO millisecond
      // timestamp by one millisecond on APFS/NTFS. Treat that representation
      // edge as equivalent for both available and reappearing assets; a
      // genuine source edit is still represented by a larger timestamp or
      // byte-size change.
      const previousModifiedAt = asset.modified_at ?? '';
      const previousByteSize = asset.byte_size ?? -1;
      const timestampEquivalent = Math.abs(Date.parse(modifiedAt) - Date.parse(previousModifiedAt)) <= 1;
      const byteChanged = byteSize !== previousByteSize;
      const mtimeChanged = modifiedAt !== previousModifiedAt && !timestampEquivalent;
      // Serpent-1tio: a library copied to another platform (zip export →
      // extraction) rewrites every file mtime while the bytes stay identical.
      // mtime alone would re-import the whole library and orphan the exported
      // artifacts. When only the mtime moved and the size matches, verify the
      // content fingerprint: a match keeps the revision (and its artifacts);
      // a NULL stored fingerprint means the revision was never verified —
      // backfill it from the file and treat the copy as unchanged.
      let statChanged = byteChanged || mtimeChanged;
      let fingerprint: string | null = null;
      if (statChanged) {
        // Open reconciliation precomputes this asynchronously before the
        // transaction. Non-open refresh callers retain the synchronous
        // preflight. A race that is not covered by either snapshot is
        // treated conservatively; it must never cause file I/O while the
        // bounded SQLite transaction is open.
        fingerprint = snapshotEntry?.contentFingerprint
          ?? preflightSource?.fingerprint
          ?? null;
        if (!byteChanged && mtimeChanged && fingerprint !== null) {
          const stored = asset.content_fingerprint;
          if (stored === null) {
            // Backfill also adopts the file's mtime: otherwise every later
            // refresh would re-hash the file (mtime still differs) while
            // the content is known identical.
            openLibrary.connection
              .prepare(
                'UPDATE revisions SET content_fingerprint = ?, modified_at = ? WHERE revision_id = ?',
              )
              .run(fingerprint, modifiedAt, asset.current_revision_id);
            statChanged = false;
          } else if (fingerprint === stored) {
            statChanged = false;
          }
        }
      }
      const now = new Date().toISOString();
      if (statChanged) {
        const revisionId = randomUUID();
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at, content_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?, ?)`,
          )
          .run(
            revisionId,
            asset.asset_id,
            asset.current_revision_id,
            byteSize,
            modifiedAt,
            path.posix.basename(currentRelativePath),
            now,
            fingerprint,
          );
        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET current_revision_id = ?, availability = 'available',
                    relative_file_path = ?, path_identity = ?, source_device = ?,
                    source_inode = ?, updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            revisionId,
            currentRelativePath,
            portablePathIdentity(currentRelativePath),
            sourceDevice,
            sourceInode,
            now,
            asset.asset_id,
          );
        // Invalidate old revision artifacts
        openLibrary.connection
          .prepare(
            `UPDATE revision_artifacts
                SET invalidated_at = ?
              WHERE revision_id = ?
                AND invalidated_at IS NULL`,
          )
          .run(now, asset.current_revision_id);
        // Enqueue only decodable media; unsupported assets keep their normal
        // file icon and never churn through a permanently failing queue.
        if (
          this.thumbnailEligible(openLibrary.summary.libraryId, currentRelativePath)
          && !this.isExplicitlyIgnored(
            openLibrary,
            asset.location_kind,
            asset.linked_folder_id,
            currentRelativePath,
            'asset',
          )
        ) {
          openLibrary.connection
            .prepare(
              `INSERT OR IGNORE INTO jobs
                 (job_id, library_id, asset_id, revision_id, kind, status, priority,
                  progress, attempt_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
            )
            .run(randomUUID(), libraryId, asset.asset_id, revisionId, now, now);
        }
        changedCount += 1;
        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
      } else if (
        pathChanged
        || (asset.location_kind === 'linked'
          && (sourceDevice !== asset.source_device || sourceInode !== asset.source_inode))
        || asset.availability === 'missing'
      ) {
        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET relative_file_path = ?, path_identity = ?, source_device = ?,
                    source_inode = ?, availability = 'available', updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            currentRelativePath,
            portablePathIdentity(currentRelativePath),
            sourceDevice,
            sourceInode,
            now,
            asset.asset_id,
          );
        if (pathChanged || asset.availability === 'missing') changedCount += 1;
        if (pathChanged || asset.availability === 'missing') {
          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        }
      }
    }
    markStage('compare-loop');
  })();
  markStage('transaction');
  this.persistSourceImageDimensionsForAssets(openLibrary, discoveredAssetIds);
  this.reconcileLinkedWatchers(openLibrary);
  markStage('post-phases');

  const result = {
    changedCount,
    missingCount,
    ...(options?.includeAssets
      ? { assets: this.listAssets({ libraryId, recursive: true }) }
      : {}),
  };
  markStage(options?.includeAssets ? 'list-assets' : 'return');
  if (changedCount > 0 || missingCount > 0) {
    // refreshManagedAssets 同时对账 managed 与 linked，摘要用中性 scope，
    // 避免纯 managed 变更被误标为链接磁盘同步（Serpent-c2d052）。
    this.diagnose('assets.sync.reconciled', 'Disk reconciliation applied changes', {
      libraryId,
      changedCount,
      missingCount,
    });
  }
  return result;
}
