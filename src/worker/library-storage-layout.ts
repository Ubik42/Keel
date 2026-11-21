import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LibraryStorageLayout } from '../shared/library-storage-layout';
import { libraryMetaDir } from '../shared/library-meta-dir';

const FILE_NAME = 'storage-layout.json';

/** Libraries without a marker retain the upstream Assets layout. */
export function readStorageLayout(libraryPath: string): LibraryStorageLayout {
  const metadataPath = libraryMetaDir(libraryPath);
  if (existsSync(metadataPath) && lstatSync(metadataPath).isSymbolicLink()) {
    throw new Error('Library metadata must be a real directory.');
  }
  const markerPath = path.join(metadataPath, FILE_NAME);
  if (!existsSync(markerPath)) return 'assets';
  if (!lstatSync(markerPath).isFile() || lstatSync(markerPath).isSymbolicLink()) {
    throw new Error('Invalid library storage layout marker.');
  }
  const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (!marker || typeof marker !== 'object'
    || !('version' in marker) || marker.version !== 1
    || !('storageLayout' in marker)
    || (marker.storageLayout !== 'root' && marker.storageLayout !== 'assets')) {
    throw new Error('Unsupported library storage layout.');
  }
  return marker.storageLayout;
}

export function writeStorageLayout(libraryPath: string, storageLayout: LibraryStorageLayout): void {
  writeFileSync(libraryMetaDir(libraryPath, FILE_NAME),
    JSON.stringify({ version: 1, storageLayout }, null, 2) + '\n', { flag: 'wx' });
}

export function managedStoragePath(libraryPath: string, layout = readStorageLayout(libraryPath)): string {
  return layout === 'root' ? libraryPath : path.join(libraryPath, 'Assets');
}
