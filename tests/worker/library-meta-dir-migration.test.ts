import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';
import { libraryMetaDir } from '../../src/shared/library-meta-dir';

const roots: string[] = [];
const services: LibraryService[] = [];

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'keel-meta-migration-'));
  roots.push(parent);
  const service = new LibraryService();
  services.push(service);
  return { parent, service };
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});

/** Build a library with current code, then turn it back into a pre-rename layout. */
function legacyLibrary(
  service: LibraryService,
  parent: string,
  storageLayout: 'root' | 'assets',
  setup?: (libraryPath: string, libraryId: string) => void,
) {
  const library = service.createLibrary({ displayName: `Legacy ${storageLayout}`, selectedParentPath: parent, storageLayout });
  setup?.(library.libraryPath, library.libraryId);
  service.closeAll();
  renameSync(path.join(library.libraryPath, '.keel'), path.join(library.libraryPath, '.serpent'));
  if (existsSync(path.join(library.libraryPath, '.keelignore'))) {
    renameSync(path.join(library.libraryPath, '.keelignore'), path.join(library.libraryPath, '.serpentignore'));
  }
  return library;
}

function addTextAsset(service: LibraryService, libraryId: string, parent: string, name: string) {
  const source = path.join(parent, name);
  writeFileSync(source, `content of ${name}`);
  service.prepareOrExecuteImport({ libraryId, sourceKind: 'files', sourcePaths: [source] });
  return service.listAssets({ libraryId, recursive: true }).find((asset) => asset.displayName.startsWith(name.split('.')[0]!))!;
}

describe('.serpent to .keel metadata migration', () => {
  for (const layout of ['root', 'assets'] as const) {
    it(`renames the metadata directory of a ${layout} library and keeps its assets`, () => {
      const { parent, service } = fixture();
      const legacy = legacyLibrary(service, parent, layout, (libraryPath, libraryId) => {
        addTextAsset(service, libraryId, parent, 'kept.txt');
        writeFileSync(path.join(libraryPath, '.keelignore'), '*.tmp\n');
      });
      const reopened = service.openLibrary(legacy.libraryPath);
      expect(reopened.libraryId).toBe(legacy.libraryId);
      expect(reopened.metaDirMigration).toBeUndefined();
      expect(existsSync(path.join(legacy.libraryPath, '.serpent'))).toBe(false);
      expect(existsSync(path.join(legacy.libraryPath, '.keel', 'library.db'))).toBe(true);
      const record = JSON.parse(readFileSync(path.join(legacy.libraryPath, '.keel', 'migration.json'), 'utf8')) as { from: string; to: string };
      expect(record).toMatchObject({ from: '.serpent', to: '.keel' });
      expect(existsSync(path.join(legacy.libraryPath, '.keelignore'))).toBe(true);
      expect(existsSync(path.join(legacy.libraryPath, '.serpentignore'))).toBe(false);
      expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((asset) => asset.displayName)).toEqual(['kept.txt']);
    });
  }

  it('migrates a Billfish takeover library and keeps .bf out of the scan', () => {
    const { parent, service } = fixture();
    const root = path.join(parent, 'billfish');
    mkdirSync(path.join(root, '.bf'), { recursive: true });
    writeFileSync(path.join(root, '.bf', 'billfish.db'), 'billfish');
    writeFileSync(path.join(root, 'photo.txt'), 'photo');
    const created = service.createLibrary({ displayName: 'Billfish', selectedParentPath: root, useExistingFolder: true });
    service.closeAll();
    renameSync(path.join(created.libraryPath, '.keel'), path.join(created.libraryPath, '.serpent'));
    const reopened = service.openLibrary(created.libraryPath);
    expect(existsSync(path.join(created.libraryPath, '.keel', 'library.db'))).toBe(true);
    expect(existsSync(path.join(created.libraryPath, '.bf', 'billfish.db'))).toBe(true);
    service.refreshManagedAssets(reopened.libraryId);
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((asset) => asset.relativeFilePath)).toEqual(['photo.txt']);
  });

  it('opens from the legacy directory when the rename fails and retries on the next open', () => {
    const { parent, service } = fixture();
    const legacy = legacyLibrary(service, parent, 'root');
    // An open handle inside the directory blocks the rename on Windows.
    const blocker = path.join(legacy.libraryPath, '.serpent', 'blocker.lock');
    writeFileSync(blocker, 'x');
    const handle = openSync(blocker, 'r');
    let failedOpen;
    try {
      failedOpen = service.openLibrary(legacy.libraryPath);
    } finally {
      closeSync(handle);
    }
    if (process.platform === 'win32') {
      expect(failedOpen.metaDirMigration).toBe('failed');
      expect(failedOpen.metaDirMigrationReason).toBeTruthy();
      expect(existsSync(path.join(legacy.libraryPath, '.serpent', 'library.db'))).toBe(true);
      expect(libraryMetaDir(legacy.libraryPath)).toBe(path.join(legacy.libraryPath, '.serpent'));
      addTextAsset(service, failedOpen.libraryId, parent, 'during-legacy.txt');
    }
    service.closeAll();
    const retried = service.openLibrary(legacy.libraryPath);
    expect(retried.metaDirMigration).toBeUndefined();
    expect(existsSync(path.join(legacy.libraryPath, '.serpent'))).toBe(false);
    expect(existsSync(path.join(legacy.libraryPath, '.keel', 'library.db'))).toBe(true);
    if (process.platform === 'win32') {
      expect(service.listAssets({ libraryId: retried.libraryId, recursive: true }).map((asset) => asset.displayName)).toEqual(['during-legacy.txt']);
    }
  });

  it('uses .keel and leaves the legacy directory alone when both exist', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Both', selectedParentPath: parent });
    service.closeAll();
    mkdirSync(path.join(library.libraryPath, '.serpent'));
    writeFileSync(path.join(library.libraryPath, '.serpent', 'stale.txt'), 'old');
    const reopened = service.openLibrary(library.libraryPath);
    expect(reopened.metaDirMigration).toBe('both');
    expect(readFileSync(path.join(library.libraryPath, '.serpent', 'stale.txt'), 'utf8')).toBe('old');
    service.refreshManagedAssets(reopened.libraryId);
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true })).toEqual([]);
  });

  it('opens a migrated library again without changes', () => {
    const { parent, service } = fixture();
    const legacy = legacyLibrary(service, parent, 'root');
    service.openLibrary(legacy.libraryPath);
    service.closeAll();
    const record = readFileSync(path.join(legacy.libraryPath, '.keel', 'migration.json'), 'utf8');
    const again = service.openLibrary(legacy.libraryPath);
    expect(again.metaDirMigration).toBeUndefined();
    expect(readFileSync(path.join(legacy.libraryPath, '.keel', 'migration.json'), 'utf8')).toBe(record);
  });

  it('restores trashed assets and exports after the migration', async () => {
    const { parent, service } = fixture();
    let trashedId = '';
    const legacy = legacyLibrary(service, parent, 'root', (_libraryPath, libraryId) => {
      const asset = addTextAsset(service, libraryId, parent, 'trashed.txt');
      trashedId = asset.assetId;
      service.trashAssets({ libraryId, assetIds: [asset.assetId] });
    });
    const reopened = service.openLibrary(legacy.libraryPath);
    service.restoreAssets({ libraryId: reopened.libraryId, assetIds: [trashedId] });
    expect(readFileSync(path.join(legacy.libraryPath, 'trashed.txt'), 'utf8')).toBe('content of trashed.txt');
    const exportPath = path.join(parent, 'exported');
    await service.exportLibraryToFolder({ libraryId: reopened.libraryId, destinationPath: exportPath, includeLinkedContent: false });
    expect(existsSync(path.join(exportPath, '.keel', 'library.db'))).toBe(true);
    expect(existsSync(path.join(exportPath, '.serpent'))).toBe(false);
  });
});
