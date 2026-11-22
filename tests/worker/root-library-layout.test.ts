import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService, type AssetObserverEvent } from '../../src/worker/library-service';
import { normalizeRelativeAssetPath } from '../../src/worker/library/library-rules';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

const roots: string[] = [];
const services: LibraryService[] = [];
function fixture(options: ConstructorParameters<typeof LibraryService>[0] = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'serpent-root-layout-'));
  roots.push(parent);
  const service = new LibraryService(options);
  services.push(service);
  return { parent, service };
}
function anotherService() {
  const service = new LibraryService();
  services.push(service);
  return service;
}
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});

describe('root library storage', () => {
  it('defaults to root storage and discovers pasted files without indexing metadata', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: '日常记录', selectedParentPath: parent });
    expect(library.storageLayout).toBe('root');
    expect(existsSync(path.join(library.libraryPath, 'Assets'))).toBe(false);
    mkdirSync(path.join(library.libraryPath, '2026'));
    writeFileSync(path.join(library.libraryPath, '2026', '照片.txt'), 'original');
    writeFileSync(path.join(library.libraryPath, '.keel', 'cache.txt'), 'private');
    writeFileSync(path.join(library.libraryPath, '.keelignore'), '*.tmp');
    service.refreshManagedAssets(library.libraryId);
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets.map((a) => a.relativeFilePath)).toEqual(['2026/照片.txt']);
    expect(service.resolveAssetPath(library.libraryId, assets[0]!.assetId)).toBe(path.join(library.libraryPath, '2026', '照片.txt'));
    service.closeAll();
    const reopened = service.openLibrary(library.libraryPath);
    expect(reopened.storageLayout).toBe('root');
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true })).toHaveLength(1);
  });

  it('imports into the root and creates folders beside the metadata directory', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Root import', selectedParentPath: parent });
    const source = path.join(parent, 'sample.txt');
    writeFileSync(source, 'keep these bytes');
    service.prepareOrExecuteImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    expect(readFileSync(path.join(library.libraryPath, 'sample.txt'), 'utf8')).toBe('keep these bytes');
    const imported = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    service.trashAssets({ libraryId: library.libraryId, assetIds: [imported.assetId] });
    expect(existsSync(path.join(library.libraryPath, 'sample.txt'))).toBe(false);
    service.restoreAssets({ libraryId: library.libraryId, assetIds: [imported.assetId] });
    expect(readFileSync(path.join(library.libraryPath, 'sample.txt'), 'utf8')).toBe('keep these bytes');
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: '参考' });
    expect(existsSync(path.join(library.libraryPath, folder.relativePath))).toBe(true);
    expect(() => service.createManagedFolder({ libraryId: library.libraryId, name: '.keel' })).toThrow();
    expect(() => normalizeRelativeAssetPath('.keel/library.db')).toThrow();
    expect(() => normalizeRelativeAssetPath('.SERPENT/library.db')).toThrow();
    expect(() => normalizeRelativeAssetPath('.keelignore')).toThrow();
  });

  it('retains Assets layout for explicit choice and upstream libraries without a marker', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Upstream', selectedParentPath: parent, storageLayout: 'assets' });
    service.closeAll();
    rmSync(path.join(library.libraryPath, '.keel', 'storage-layout.json'));
    writeFileSync(path.join(library.libraryPath, 'outside.txt'), 'not managed');
    writeFileSync(path.join(library.libraryPath, 'Assets', 'inside.txt'), 'managed');
    const reopened = service.openLibrary(library.libraryPath);
    expect(reopened.storageLayout).toBe('assets');
    service.refreshManagedAssets(reopened.libraryId);
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((a) => a.relativeFilePath)).toEqual(['inside.txt']);
  });

  it('applies root-relative ignore rules and UI ignore actions', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Ignores', selectedParentPath: parent });
    mkdirSync(path.join(library.libraryPath, '2026'));
    writeFileSync(path.join(library.libraryPath, '2026', 'hidden.txt'), 'hidden');
    writeFileSync(path.join(library.libraryPath, 'visible.txt'), 'visible');
    writeFileSync(path.join(library.libraryPath, '.keelignore'), '/2026/');
    service.refreshManagedAssets(library.libraryId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true }).map((a) => a.relativeFilePath)).toEqual(['visible.txt']);
    service.setIgnore({ libraryId: library.libraryId, locationKind: 'managed', relativePath: 'visible.txt', pathKind: 'asset', ignored: true });
    expect(readFileSync(path.join(library.libraryPath, '.keelignore'), 'utf8')).not.toContain('Assets/');
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toHaveLength(0);
  });

  it('filters metadata watcher events while accepting external root file changes', () => {
    let emit: ((event?: AssetObserverEvent) => void) | undefined;
    const pending: Array<() => void> = [];
    const { parent, service } = fixture({
      observerFactory: (_root, onEvent) => { emit = onEvent; return { close() {} }; },
      scheduler: { schedule(callback) { pending.push(callback); return callback; }, cancel() {} },
    });
    service.createLibrary({ displayName: 'Watcher', selectedParentPath: parent });
    const before = pending.length;
    emit?.({ eventType: 'change', filename: '.keel\\library.db-wal' });
    emit?.({ eventType: 'change', filename: '.keel/artifacts/cache.webp' });
    expect(pending).toHaveLength(before);
    emit?.({ eventType: 'rename', filename: 'new.txt' });
    expect(pending.length).toBeGreaterThan(before);
  });

  it('recovers a damaged database while retaining root file paths', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Recovery', selectedParentPath: parent });
    writeFileSync(path.join(library.libraryPath, 'photo.txt'), 'keep original');
    service.refreshManagedAssets(library.libraryId);
    service.closeAll();
    writeFileSync(path.join(library.libraryPath, '.keel', 'library.db'), 'damaged database');
    const recovered = service.openLibrary(library.libraryPath);
    expect(recovered.storageLayout).toBe('root');
    service.refreshManagedAssets(recovered.libraryId);
    expect(service.listAssets({ libraryId: recovered.libraryId, recursive: true }).map((a) => a.relativeFilePath)).toEqual(['photo.txt']);
    expect(readFileSync(path.join(library.libraryPath, 'photo.txt'), 'utf8')).toBe('keep original');
  });

  it('rejects unknown layout versions without reinterpreting root files', () => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Future', selectedParentPath: parent });
    service.closeAll();
    const marker = path.join(library.libraryPath, '.keel', 'storage-layout.json');
    writeFileSync(marker, JSON.stringify({ version: 99, storageLayout: 'root' }));
    expect(() => service.openLibrary(library.libraryPath)).toThrow();
    expect(JSON.parse(readFileSync(marker, 'utf8')).version).toBe(99);
  });

  it.each(['folder', 'zip'] as const)('round-trips a root library through %s export', async (kind) => {
    const { parent, service } = fixture();
    const library = service.createLibrary({ displayName: 'Export root', selectedParentPath: parent });
    mkdirSync(path.join(library.libraryPath, '2026'));
    writeFileSync(path.join(library.libraryPath, '2026', 'photo.txt'), 'preserved');
    service.refreshManagedAssets(library.libraryId);
    const output = path.join(parent, kind === 'folder' ? 'exported' : 'exported.zip');
    if (kind === 'folder') await service.exportLibraryToFolder({ libraryId: library.libraryId, destinationPath: output, includeLinkedContent: false });
    else await service.exportLibraryToZip({ libraryId: library.libraryId, destinationPath: output, includeLinkedContent: false });
    const other = anotherService();
    let importedPath = output;
    if (kind === 'zip') {
      const destination = path.join(parent, 'unpacked');
      mkdirSync(destination);
      importedPath = (await other.importLibraryFromZip({ sourceZipPath: output, destinationParentPath: destination })).libraryPath;
    }
    const reopened = other.openLibrary(importedPath);
    expect(reopened.storageLayout).toBe('root');
    other.refreshManagedAssets(reopened.libraryId);
    expect(readFileSync(path.join(importedPath, '2026', 'photo.txt'), 'utf8')).toBe('preserved');
    expect(other.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((a) => a.relativeFilePath)).toEqual(['2026/photo.txt']);
    expect(existsSync(path.join(importedPath, 'Assets'))).toBe(false);
  });
});
