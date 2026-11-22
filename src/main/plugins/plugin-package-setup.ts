import type { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
import type { PluginStorageStore } from './plugin-storage-store';
import type { PluginSettingsStore } from './plugin-settings-store';
import { state } from '../main-state';
import { createPluginPackageRequestHandler } from './plugin-package-ipc';
import { selectPluginPackageForInstall } from '../window/main-dialogs';
import { PLUGIN_INSTALL_PROGRESS_CHANNEL, PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL } from '../../shared/protocol/channels';
import { shell } from 'electron';
import { syncPluginCompanionExtensions } from '../library/library-opened';

/**
 * Plugin package requests (install, update, remove, settings) wired to the package manager and plugin stores (split out of startApplication, P8).
 */
export function setUpPluginPackageRequests({ pluginSettingsStore, pluginStorageStore, pluginMcpExposureStore }: {
  pluginSettingsStore: PluginSettingsStore;
  pluginStorageStore: PluginStorageStore;
  pluginMcpExposureStore: PluginMcpExposureStore;
}) {
  const pluginPackageRequest = state.pluginPackageManager === undefined
    ? undefined
    : createPluginPackageRequestHandler({
      manager: state.pluginPackageManager,
      activationCoordinator: state.pluginActivationCoordinator,
      settingsStore: pluginSettingsStore,
      storageStore: pluginStorageStore,
      mcpExposureStore: pluginMcpExposureStore,
      searchProviders: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin search providers are unavailable.');
        }
        return state.pluginProviderScheduler.searchAssets(input);
      },
      mediaProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin media providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveMediaProvider(input);
      },
      metadataProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin metadata providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveMetadataProvider(input);
      },
      importProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin import providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveImportProvider(input);
      },
      exportProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin export providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveExportProvider(input);
      },
      aiProvider: async (input) => {
        if (state.pluginProviderScheduler === undefined) {
          throw new Error('Plugin AI providers are unavailable.');
        }
        return state.pluginProviderScheduler.resolveAiProvider(input);
      },
      resolveLibraryDirectory: async (libraryId) => {
        const client = state.workerClient;
        if (client === undefined) return undefined;
        const result = await client.request({ type: 'library.list' });
        if (!result.ok || result.type !== 'library.list') return undefined;
        return result.libraries.find((library) => library.libraryId === libraryId)?.libraryPath;
      },
      chooseLocalPackage: selectPluginPackageForInstall,
      notifyInstallProgress: (event) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(PLUGIN_INSTALL_PROGRESS_CHANNEL, event);
        }
      },
      revealPackageDirectory: (absoluteDirectory) => {
        shell.showItemInFolder(absoluteDirectory);
      },
      afterMutation: async ({ requestType, libraryId, libraryDirectory }) => {
        const coordinator = state.pluginActivationCoordinator;
        if (coordinator === undefined) return;
        try {
          if (requestType === 'plugin-manager.resolve'
            || requestType === 'plugin-manager.safe-mode'
            || requestType === 'plugin-manager.install-local'
            || requestType === 'plugin-manager.install-github'
            || requestType === 'plugin-manager.uninstall'
            || requestType === 'plugin-manager.trust'
            || requestType === 'plugin-manager.reload') {
            // Enable/disable (especially user-scoped) and package lifecycle can
            // change contributions in every open library Host.
            await coordinator.refreshOpenLibraries();
          } else if (libraryId !== undefined && libraryDirectory !== undefined) {
            await coordinator.refreshLibrary({ libraryId, libraryDirectory });
          }
          await syncPluginCompanionExtensions();
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send(PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL, {
              libraryId: libraryId ?? null,
              requestType,
            });
          }
          state.embeddedMcpServer?.notifyToolsChanged();
        } catch (error) {
          state.logger?.error('plugin.activation.after-mutation', error, { requestType, libraryId });
        }
      },
      logger: state.logger,
    });
  return { pluginPackageRequest };
}
