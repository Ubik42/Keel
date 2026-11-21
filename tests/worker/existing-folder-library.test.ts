import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

const roots: string[] = [];
const services: LibraryService[] = [];
function fixture(options: ConstructorParameters<typeof LibraryService>[0] = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'serpent-existing-folder-'));
  roots.push(parent);
  const folder = path.join(parent, '现有照片');
  mkdirSync(folder);
  const service = new LibraryService(options);
  services.push(service);
  return { parent, folder, service };
}
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});

describe('initialize an existing folder as a library', () => {
  it('indexes existing files in place and keeps their paths, bytes and timestamps', async () => {
    const { folder, service } = fixture();
    mkdirSync(path.join(folder, '2026'));
    const file = path.join(folder, '2026', 'photo.txt');
    writeFileSync(file, 'keep original data');
    const before = statSync(file);
    writeFileSync(path.join(folder, '.keelignore'), '*.tmp');
    writeFileSync(path.join(folder, 'skip.tmp'), 'ignore this');
    const created = service.createLibrary({ displayName: '日常记录', selectedParentPath: folder, useExistingFolder: true });
    expect(created.libraryPath).toBe(folder);
    expect(created.displayName).toBe('日常记录');
    expect(created.storageLayout).toBe('root');
    expect(existsSync(path.join(folder, '日常记录'))).toBe(false);
    expect(existsSync(path.join(folder, 'Assets'))).toBe(false);
    expect(existsSync(path.join(folder, '.keel', 'library.db'))).toBe(true);
    await service.runOpenBackgroundReconciliation(created.libraryId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }).map((asset) => asset.relativeFilePath)).toEqual(['2026/photo.txt']);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    expect(service.resolveAssetPath(created.libraryId, asset.assetId)).toBe(file);
    expect(readFileSync(file, 'utf8')).toBe('keep original data');
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
    expect(readFileSync(path.join(folder, '.keelignore'), 'utf8')).toBe('*.tmp');
    service.closeAll();
    expect(service.openLibrary(folder).libraryId).toBe(created.libraryId);
  });

  it('supports an empty existing folder without a nested library directory', () => {
    const { folder, service } = fixture();
    service.createLibrary({ displayName: 'Empty', selectedParentPath: folder, useExistingFolder: true });
    expect(readdirSync(folder).sort()).toEqual(process.platform === 'win32' ? ['.keel', 'desktop.ini'] : ['.keel']);
  });

  it('refuses existing metadata and leaves every pre-existing file intact', () => {
    const { folder, service } = fixture();
    mkdirSync(path.join(folder, '.keel'));
    const original = path.join(folder, '.keel', 'library.db');
    writeFileSync(original, 'user-owned metadata');
    writeFileSync(path.join(folder, 'original.txt'), 'original');
    expect(() => service.createLibrary({ displayName: 'No overwrite', selectedParentPath: folder, useExistingFolder: true })).toThrowError('LIBRARY_METADATA_EXISTS');
    expect(readFileSync(original, 'utf8')).toBe('user-owned metadata');
    expect(readFileSync(path.join(folder, 'original.txt'), 'utf8')).toBe('original');
    expect(readdirSync(path.join(folder, '.keel'))).toEqual(['library.db']);
  });

  it('rejects repeated initialization while the existing library stays usable', () => {
    const { folder, service } = fixture();
    const created = service.createLibrary({ displayName: 'First', selectedParentPath: folder, useExistingFolder: true });
    expect(() => service.createLibrary({ displayName: 'Second', selectedParentPath: folder, useExistingFolder: true })).toThrowError('LIBRARY_METADATA_EXISTS');
    expect(service.openLibrary(folder).libraryId).toBe(created.libraryId);
  });

  it('rolls back only its newly created metadata when database initialization fails', () => {
    const { folder, service } = fixture({ sqliteBusyTimeoutMsForTests: -1 });
    writeFileSync(path.join(folder, 'original.txt'), 'keep original');
    writeFileSync(path.join(folder, '.keelignore'), '*.tmp');
    expect(() => service.createLibrary({ displayName: 'Failure', selectedParentPath: folder, useExistingFolder: true })).toThrow();
    expect(readdirSync(folder).sort()).toEqual(['.keelignore', 'original.txt']);
    expect(readFileSync(path.join(folder, 'original.txt'), 'utf8')).toBe('keep original');
    expect(readFileSync(path.join(folder, '.keelignore'), 'utf8')).toBe('*.tmp');
  });

  it('rejects Assets mode for an existing folder before writing metadata', () => {
    const { folder, service } = fixture();
    expect(() => service.createLibrary({ displayName: 'Wrong layout', selectedParentPath: folder, useExistingFolder: true, storageLayout: 'assets' })).toThrowError('INVALID_LIBRARY_PATH');
    expect(readdirSync(folder)).toEqual([]);
  });

  it('rejects a missing folder and a regular file without creating either directory', () => {
    const { folder, service } = fixture();
    const missing = path.join(folder, 'missing');
    expect(() => service.createLibrary({ displayName: 'Missing', selectedParentPath: missing, useExistingFolder: true })).toThrow();
    expect(existsSync(missing)).toBe(false);
    const file = path.join(folder, 'file.txt');
    writeFileSync(file, 'original');
    expect(() => service.createLibrary({ displayName: 'File', selectedParentPath: file, useExistingFolder: true })).toThrowError('INVALID_LIBRARY_PATH');
    expect(readFileSync(file, 'utf8')).toBe('original');
  });

  it('rejects a linked folder root and preserves its target', () => {
    const { parent, folder, service } = fixture();
    const link = path.join(parent, 'folder-link');
    symlinkSync(folder, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => service.createLibrary({ displayName: 'Linked', selectedParentPath: link, useExistingFolder: true })).toThrowError('INVALID_LIBRARY_PATH');
    expect(existsSync(path.join(folder, '.keel'))).toBe(false);
  });
});
