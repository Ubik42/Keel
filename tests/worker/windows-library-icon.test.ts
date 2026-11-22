import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

const roots: string[] = [];
const services: LibraryService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-explorer-icon-')); roots.push(root);
  const service = new LibraryService(); services.push(service);
  return { root, service };
}
describe.skipIf(process.platform !== 'win32')('Windows library folder icons', () => {
  it('automatically decorates new libraries with a portable icon', () => {
    const { root, service } = fixture();
    const library = service.createLibrary({ displayName: '新建图库', selectedParentPath: root });
    expect(readFileSync(path.join(library.libraryPath, '.keel', 'library.ico'))).toEqual(readFileSync('assets/icons/app.ico'));
    expect(readFileSync(path.join(library.libraryPath, 'desktop.ini'), 'utf16le')).toContain('IconResource=.keel\\library.ico,0');
    service.refreshManagedAssets(library.libraryId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
  });
  it('backs up a Billfish icon, preserves other settings and skips old caches', () => {
    const { root, service } = fixture();
    mkdirSync(path.join(root, '.bf')); writeFileSync(path.join(root, '.bf', 'preview.jpg'), 'old cache');
    writeFileSync(path.join(root, 'photo.txt'), 'media');
    const previous = '[.ShellClassInfo]\r\nIconFile=.bf/folder.ico\r\nIconIndex=0\r\n[ViewState]\r\nFolderType=Pictures\r\n';
    writeFileSync(path.join(root, 'desktop.ini'), previous);
    execFileSync('attrib.exe', ['+h', '+s', path.join(root, 'desktop.ini')], { windowsHide: true });
    const library = service.createLibrary({ displayName: '旧图库', selectedParentPath: root, useExistingFolder: true });
    expect(readFileSync(path.join(root, '.keel', 'desktop.ini.before-serpent'), 'utf8')).toBe(previous);
    const ini = readFileSync(path.join(root, 'desktop.ini'), 'utf16le');
    expect(ini).toContain('FolderType=Pictures'); expect(ini).not.toContain('IconFile=');
    service.refreshManagedAssets(library.libraryId);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true }).map(asset => asset.displayName)).toEqual(['photo.txt']);
    expect(existsSync(path.join(root, '.bf', 'preview.jpg'))).toBe(true);
    const before = statSync(path.join(root, 'desktop.ini')).mtimeMs;
    service.closeAll(); service.openLibrary(root);
    expect(statSync(path.join(root, 'desktop.ini')).mtimeMs).toBe(before);
    expect(readFileSync(path.join(root, '.keel', 'desktop.ini.before-serpent'), 'utf8')).toBe(previous);
  });
});
