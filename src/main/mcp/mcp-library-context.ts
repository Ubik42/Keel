import { type AutomationExecutionContext } from '../../automation/command-gateway';
import { readRecentLibraryEntries } from '../library/recent-libraries';
import { recentLibraryPath } from '../library/external-library-staging';
import { state } from '../main-state';
import { AutomationLibraryContextError } from '../automation/automation-execution-journal';
import { publishLifecycle } from '../window/renderer-events';
import { rememberOpenedLibrary, notifyLibraryOpenedSideEffects } from '../library/library-opened';
import { type AutomationCommandId } from '../../automation/command-registry';

/**
 * MCP commands that change the active library context (open, close, switch) for agents (split out of index.ts, P8).
 */
export async function executeMcpLibraryContextCommand(input: {
  commandId: 'library.list-open' | 'library.list-recent' | 'library.open' | 'library.show-in-desktop';
  executionId: string;
  context: AutomationExecutionContext;
  commandInput: unknown;
}): Promise<unknown> {
  if (input.commandId === 'library.list-recent') {
    return readRecentLibraryEntries(recentLibraryPath(), (error) => {
      state.logger?.error('recent-library.read', error);
    }).map((entry) => ({
      libraryId: entry.libraryId ?? null,
      displayName: entry.name,
    }));
  }
  const journal = state.automationExecutionJournal;
  const client = state.workerClient;
  if (!journal || !client) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  const listed = await client.request({ type: 'library.list' });
  if (!listed.ok || listed.type !== 'library.list') {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  const libraries = listed.libraries;
  if (input.commandId === 'library.list-open') {
    return {
      libraries: libraries.map((library) => ({
        libraryId: library.libraryId,
        displayName: library.displayName,
        active: false,
      })),
      activeLibraryId: null,
      contextRevision: 0,
    };
  }

  const commandInput = input.commandInput as { libraryId?: string };
  let selected = commandInput.libraryId === undefined
    ? undefined
    : libraries.find((library) => library.libraryId === commandInput.libraryId);
  let needsOpen = false;
  if (input.commandId === 'library.open' && selected === undefined && commandInput.libraryId !== undefined) {
    const recent = readRecentLibraryEntries(recentLibraryPath(), (error) => {
      state.logger?.error('recent-library.read', error);
    }).find((entry) => entry.libraryId === commandInput.libraryId);
    if (recent === undefined) {
      throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
    }
    selected = {
      libraryId: recent.libraryId!,
      displayName: recent.name,
      libraryPath: recent.path,
    };
    needsOpen = true;
  }
  if (input.commandId === 'library.open' && selected === undefined) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
  }
  if (selected === undefined) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
  }
  if (input.commandId === 'library.open') {
    if (selected.libraryId === '' || needsOpen) {
      publishLifecycle({ type: 'library.opening', operation: 'open', source: 'mcp' });
      const opened = await client.request({
        type: 'library.open',
        selectedLibraryPath: selected.libraryPath,
      });
      if (!opened.ok || opened.type !== 'library.opened') {
        throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
      }
      selected = opened.library;
      rememberOpenedLibrary(selected.libraryPath, selected.displayName, selected.libraryId);
      await notifyLibraryOpenedSideEffects({
        libraryId: selected.libraryId,
        libraryDirectory: selected.libraryPath,
      });
      publishLifecycle({
        type: 'library.opened',
        source: 'mcp',
        library: {
          libraryId: selected.libraryId,
          displayName: selected.displayName,
          storageLayout: selected.storageLayout,
          displayPath: selected.libraryPath,
          ...(selected.readOnly === undefined ? {} : { readOnly: selected.readOnly }),
          ...(selected.networkStorage === undefined ? {} : { networkStorage: selected.networkStorage }),
          ...(selected.libraryVersion === undefined ? {} : { libraryVersion: selected.libraryVersion }),
          ...(selected.supportedSchemaVersion === undefined ? {} : { supportedSchemaVersion: selected.supportedSchemaVersion }),
          ...(selected.migrationStuck === undefined ? {} : { migrationStuck: selected.migrationStuck }),
        },
      });
    }
  }
  if (selected.libraryId === '') {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  if (input.commandId === 'library.show-in-desktop') {
    publishLifecycle({
      type: 'library.opened',
      source: 'mcp',
      library: {
        libraryId: selected.libraryId,
        displayName: selected.displayName,
        storageLayout: selected.storageLayout,
        displayPath: selected.libraryPath,
      },
    });
  }
  return {
    libraryId: selected.libraryId,
    displayName: selected.displayName,
    contextRevision: 0,
  };
}

export async function normalizeMcpCommandInput(input: {
  commandId: AutomationCommandId;
  executionId: string;
  context: AutomationExecutionContext;
  commandInput: unknown;
  signal?: AbortSignal;
}): Promise<unknown | undefined> {
  // MCP always supplies explicit paths. Opening a native picker here would
  // make a supposedly stateless/headless request depend on a human and would
  // recreate the repeated confirmation failure this adapter is designed to
  // eliminate. The Registry MCP schemas validate these fields before this
  // normalizer runs.
  if (input.signal?.aborted) return input.commandInput;
  return input.commandInput;
}
