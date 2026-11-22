import { rememberRecentLibrary } from './recent-libraries';
import { recentLibraryPath } from './external-library-staging';
import { state } from './main-state';
import { installApplicationMenu } from './application-menu';
import { nativeMenuRecentLibraries, readShortcutBindingsSnapshot } from './app-preference-files';
import { processAiQueue } from './ai-queue';

/**
 * What happens after a library opens: recent list, menu, plugin thumbnail and companion extensions, rules and sync (split out of index.ts, P8).
 */
export function rememberOpenedLibrary(libraryPath: string, displayName: string, libraryId?: string): void {
  rememberRecentLibrary(
    recentLibraryPath(),
    { path: libraryPath, name: displayName, ...(libraryId === undefined ? {} : { libraryId }) },
    {
      onError: (error) => {
        state.logger?.error("recent-library.write", error);
      },
    },
  );
  refreshApplicationMenuRecentLibraries();
}

/**
 * Re-installs the native menu so its 资源库 → 最近使用的资源库 section tracks the
 * store. Called after any recent-library mutation (open, forget, remove).
 */
export function refreshApplicationMenuRecentLibraries(): void {
  if (process.platform !== "darwin") return;
  installApplicationMenu({
    locale: state.appLocale,
    recentLibraries: nativeMenuRecentLibraries(),
    shortcutBindings: readShortcutBindingsSnapshot(),
  });
}

/** Shared post-open hook for dialog opens and startup recent-library restore. */
export function pluginThumbnailExtensionsFor(libraryId: string): string[] {
  const extensions = new Set<string>();
  for (const provider of state.pluginActivationCoordinator?.listActiveProviders(libraryId) ?? []) {
    if (provider.kind !== 'thumbnail') continue;
    for (const raw of provider.extensions ?? []) {
      const extension = raw.replace(/^\./u, '').toLowerCase();
      if (/^[a-z0-9][a-z0-9+_-]*$/u.test(extension)) extensions.add(extension);
    }
  }
  return [...extensions];
}

export async function syncPluginThumbnailExtensions(): Promise<void> {
  const client = state.workerClient;
  if (!client) return;
  const listed = await client.request({ type: 'library.list' });
  if (!listed.ok || listed.type !== 'library.list') return;
  for (const library of listed.libraries) {
    client.publishPluginThumbnailExtensions(
      library.libraryId,
      pluginThumbnailExtensionsFor(library.libraryId),
    );
  }
}

/**
 * PF: tell the Worker which companion extensions active plugins declare. The
 * Worker keeps one process-wide set, so send the union over open libraries.
 */
export async function syncPluginCompanionExtensions(): Promise<void> {
  const coordinator = state.pluginActivationCoordinator;
  if (!coordinator || !state.workerClient) return;
  const libraryIds = coordinator.trackedOpenLibraryIds();
  if (libraryIds.length === 0) return;
  const extensions = [...new Set(libraryIds.flatMap((id) => coordinator.listCompanionExtensions(id)))];
  try {
    await state.workerClient.request({ type: "library.companion-extensions.set", libraryId: libraryIds[0]!, extensions });
  } catch (error) {
    state.logger?.error("plugin.companion-extensions", error);
  }
}

export async function notifyLibraryOpenedSideEffects(input: {
  libraryId: string;
  libraryDirectory: string;
}): Promise<void> {
  void processAiQueue(input.libraryId);
  try {
    await state.pluginActivationCoordinator?.onLibraryOpened({
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
    });
    await syncPluginCompanionExtensions();
  } catch (error) {
    state.logger?.error("plugin.activation.library-opened", error, {
      libraryId: input.libraryId,
    });
  }
  // Global plugin activation uses an internal pseudo-library. Once the real
  // library is open, tick only jobs explicitly enqueued or retried in this
  // application session; interrupted rows are never auto-recovered.
  state.pluginJobScheduler?.tick(input.libraryId);
  await syncPluginThumbnailExtensions();
  state.workerClient?.publishShowMissingLinkedFiles(state.showMissingLinkedFiles);
}
