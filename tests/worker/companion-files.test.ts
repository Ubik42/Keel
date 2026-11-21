import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';
import { pairCompanions, renamedCompanionName } from '../../src/worker/companion-files';

const roots: string[] = [];
const services: LibraryService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'keel-companions-'));
  roots.push(parent);
  const service = new LibraryService();
  services.push(service);
  const library = service.createLibrary({ displayName: 'Companions', selectedParentPath: parent });
  mkdirSync(path.join(library.libraryPath, 'shoot'));
  writeFileSync(path.join(library.libraryPath, 'shoot', 'photo.CR3'), 'raw');
  writeFileSync(path.join(library.libraryPath, 'shoot', 'photo.xmp'), 'stem sidecar');
  writeFileSync(path.join(library.libraryPath, 'shoot', 'photo.CR3.xmp'), 'full-name sidecar');
  writeFileSync(path.join(library.libraryPath, 'shoot', 'lonely.xmp'), 'no primary');
  service.refreshManagedAssets(library.libraryId);
  const all = service.listAssets({ libraryId: library.libraryId, recursive: true });
  const byName = new Map(all.map((asset) => [asset.displayName, asset]));
  return { parent, service, library, byName };
}

function visibleNames(service: LibraryService, libraryId: string, trash = false): string[] {
  return service.searchAssets({ libraryId, query: null, ...(trash ? { scope: { kind: 'trash' as const } } : {}) })
    .items.map((asset) => asset.displayName).sort();
}

describe('companion files', () => {
  it('pairs full-name and stem companions with their primary', () => {
    const rows = [
      { asset_id: 'raw', location_kind: 'managed', linked_folder_id: null, relative_file_path: 'a/photo.CR3' },
      { asset_id: 'stem', location_kind: 'managed', linked_folder_id: null, relative_file_path: 'a/photo.xmp' },
      { asset_id: 'full', location_kind: 'managed', linked_folder_id: null, relative_file_path: 'a/photo.CR3.xmp' },
      { asset_id: 'other-dir', location_kind: 'managed', linked_folder_id: null, relative_file_path: 'b/photo.xmp' },
    ];
    expect(Object.fromEntries(pairCompanions(rows, ['xmp']))).toEqual({ stem: 'raw', full: 'raw' });
    expect(renamedCompanionName('photo.xmp', 'photo.CR3', 'sunset.CR3')).toBe('sunset.xmp');
    expect(renamedCompanionName('photo.CR3.xmp', 'photo.CR3', 'sunset.CR3')).toBe('sunset.CR3.xmp');
    expect(renamedCompanionName('other.xmp', 'photo.CR3', 'sunset.CR3')).toBeNull();
  });

  it('hides companions in browsing and keeps a companion without primary visible', () => {
    const { service, library } = fixture();
    expect(visibleNames(service, library.libraryId)).toEqual(['lonely.xmp', 'photo.CR3']);
  });

  it('moves and renames companions with the primary', () => {
    const { service, library, byName } = fixture();
    const target = service.createManagedFolder({ libraryId: library.libraryId, name: 'picked' });
    service.moveAssets({ libraryId: library.libraryId, assetIds: [byName.get('photo.CR3')!.assetId], targetFolderId: target.folderId });
    const picked = path.join(library.libraryPath, 'picked');
    expect(readFileSync(path.join(picked, 'photo.xmp'), 'utf8')).toBe('stem sidecar');
    expect(readFileSync(path.join(picked, 'photo.CR3.xmp'), 'utf8')).toBe('full-name sidecar');
    expect(existsSync(path.join(library.libraryPath, 'shoot', 'lonely.xmp'))).toBe(true);

    service.renameAssetFile({ libraryId: library.libraryId, assetId: byName.get('photo.CR3')!.assetId, newBaseName: 'sunset' });
    expect(existsSync(path.join(picked, 'sunset.CR3'))).toBe(true);
    expect(readFileSync(path.join(picked, 'sunset.xmp'), 'utf8')).toBe('stem sidecar');
    expect(readFileSync(path.join(picked, 'sunset.CR3.xmp'), 'utf8')).toBe('full-name sidecar');
    expect(visibleNames(service, library.libraryId)).toEqual(['lonely.xmp', 'sunset.CR3']);
  });

  it('trashes and restores companions with the primary', () => {
    const { service, library, byName } = fixture();
    const primaryId = byName.get('photo.CR3')!.assetId;
    service.trashAssets({ libraryId: library.libraryId, assetIds: [primaryId] });
    const shoot = path.join(library.libraryPath, 'shoot');
    expect(existsSync(path.join(shoot, 'photo.xmp'))).toBe(false);
    expect(existsSync(path.join(shoot, 'photo.CR3.xmp'))).toBe(false);
    expect(visibleNames(service, library.libraryId, true)).toEqual(['photo.CR3']);

    service.restoreAssets({ libraryId: library.libraryId, assetIds: [primaryId] });
    expect(readFileSync(path.join(shoot, 'photo.xmp'), 'utf8')).toBe('stem sidecar');
    expect(readFileSync(path.join(shoot, 'photo.CR3.xmp'), 'utf8')).toBe('full-name sidecar');
    expect(visibleNames(service, library.libraryId)).toEqual(['lonely.xmp', 'photo.CR3']);
  });

  it('deletes companions from disk with the primary', () => {
    const { service, library, byName } = fixture();
    service.deleteAssetsFromDisk({ libraryId: library.libraryId, assetIds: [byName.get('photo.CR3')!.assetId] });
    const shoot = path.join(library.libraryPath, 'shoot');
    expect(existsSync(path.join(shoot, 'photo.CR3'))).toBe(false);
    expect(existsSync(path.join(shoot, 'photo.xmp'))).toBe(false);
    expect(existsSync(path.join(shoot, 'photo.CR3.xmp'))).toBe(false);
    expect(existsSync(path.join(shoot, 'lonely.xmp'))).toBe(true);
  });
});
