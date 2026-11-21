import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  pragma(source: string): unknown;
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-org-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceCode(operation: () => unknown, code: LibraryServiceError['code']): LibraryServiceError {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
  return thrown as LibraryServiceError;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

// ── Helper: create a library with a managed asset via direct DB insertion ──

function createLibraryWithAsset(
  serviceOptions?: ConstructorParameters<typeof LibraryService>[0],
): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
  assetId: string;
} {
  const root = temporaryRoot();
  const service = serviceOptions === undefined ? newService() : newService(serviceOptions);
  const library = service.createLibrary({ storageLayout: 'assets', displayName: 'Org', selectedParentPath: root });

  // Create a managed folder and an asset on disk + in DB so tags can reference it.
  const managedFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Assets' });
  const assetFileName = 'test.png';
  const assetsPath = path.join(library.libraryPath, 'Assets', managedFolder.relativePath);
  mkdirSync(assetsPath, { recursive: true });
  writeFileSync(path.join(assetsPath, assetFileName), 'test content');

  const db = new TestDatabase(path.join(library.libraryPath, '.keel', 'library.db'));
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolder.folderId,
      `${managedFolder.relativePath}/${assetFileName}`,
      `${managedFolder.relativePath}/${assetFileName}`,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 12, now, assetFileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId,
      now,
      assetId,
    );
  } finally {
    db.close();
  }

  return { service, libraryId: library.libraryId, libraryPath: library.libraryPath, assetId };
}

function createSecondAsset(
  libraryPath: string,
  managedFolderRelativePath: string,
  managedFolderId: string,
): string {
  const db = new TestDatabase(path.join(libraryPath, '.keel', 'library.db'));
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  const fileName = `${assetId}.png`;
  try {
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolderId,
      `${managedFolderRelativePath}/${fileName}`,
      `${managedFolderRelativePath}/${fileName}`,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 8, now, fileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId,
      now,
      assetId,
    );
  } finally {
    db.close();
  }
  return assetId;
}

// ── Tags ──────────────────────────────────────────────────────────────

describe('tags', () => {
  it('creates a tag and lists it with assetCount', () => {
    const { service, libraryId } = createLibraryWithAsset();

    const tag = service.createTag({ libraryId, name: '  Character  ' });
    expect(tag).toMatchObject({ name: 'Character', assetCount: 0 });

    const list = service.listTags(libraryId);
    expect(list).toEqual([tag]);
    service.closeAll();
  });

  it('enforces NOCASE-unique tag name per library', () => {
    const { service, libraryId } = createLibraryWithAsset();

    service.createTag({ libraryId, name: 'Hero' });
    expectServiceCode(
      () => service.createTag({ libraryId, name: 'hero' }),
      'FOLDER_ALREADY_EXISTS',
    );
    expectServiceCode(
      () => service.createTag({ libraryId, name: 'HERO' }),
      'FOLDER_ALREADY_EXISTS',
    );
    service.closeAll();
  });

  it('lists the most recently created tag first', () => {
    const { service, libraryId, libraryPath } = createLibraryWithAsset();
    const older = service.createTag({ libraryId, name: 'Older' });
    const newer = service.createTag({ libraryId, name: 'Newer' });
    const db = new TestDatabase(path.join(libraryPath, '.keel', 'library.db'));
    try {
      db.prepare('UPDATE tags SET created_at = ? WHERE tag_id = ?').run(
        '2026-07-15T00:00:00.000Z',
        older.tagId,
      );
      db.prepare('UPDATE tags SET created_at = ? WHERE tag_id = ?').run(
        '2026-07-16T00:00:00.000Z',
        newer.tagId,
      );
    } finally {
      db.close();
    }

    expect(service.listTags(libraryId).map((tag) => tag.tagId)).toEqual([
      newer.tagId,
      older.tagId,
    ]);
    service.closeAll();
  });

  it('isolates tag names across libraries', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const root2 = temporaryRoot();
    const lib2 = service.createLibrary({ storageLayout: 'assets', displayName: 'Lib2', selectedParentPath: root2 });

    service.createTag({ libraryId, name: 'Shared' });
    // Same name in a different library should succeed.
    const tag2 = service.createTag({ libraryId: lib2.libraryId, name: 'Shared' });
    expect(tag2.name).toBe('Shared');

    service.closeAll();
  });

  it('renames a tag with NOCASE-unique check', () => {
    const { service, libraryId } = createLibraryWithAsset();

    service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });

    const renamed = service.renameTag({ libraryId, tagId: beta.tagId, name: '  Gamma  ' });
    expect(renamed).toMatchObject({ tagId: beta.tagId, name: 'Gamma', assetCount: 0 });

    // Cannot rename to an existing name (case-insensitive).
    expectServiceCode(
      () => service.renameTag({ libraryId, tagId: beta.tagId, name: 'ALPHA' }),
      'FOLDER_ALREADY_EXISTS',
    );

    service.closeAll();
  });

  it('emits asset.changed when assigning or renaming a tag on an asset', () => {
    const events: number[] = [];
    const { service, libraryId, assetId } = createLibraryWithAsset({
      onAssetsChanged: (event) => events.push(event.changedCount),
    });
    const tag = service.createTag({ libraryId, name: '可同步' });
    events.length = 0;
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(events.some((count) => count >= 1)).toBe(true);
    events.length = 0;
    service.renameTag({ libraryId, tagId: tag.tagId, name: '已改名' });
    expect(events.some((count) => count >= 1)).toBe(true);
    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when renaming a missing tag', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.renameTag({ libraryId, tagId: 'nonexistent', name: 'Nope' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('deletes a tag and cascades to human_asset_tags', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'ToDelete' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const tagId = service.deleteTag({ libraryId, tagId: tag.tagId });
    expect(tagId).toBe(tag.tagId);

    // The tag should be gone from list.
    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === tag.tagId)).toBeUndefined();

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when deleting a missing tag', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.deleteTag({ libraryId, tagId: 'nonexistent' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('deletes multiple tags in one call', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'BatchA' });
    const beta = service.createTag({ libraryId, name: 'BatchB' });

    const { deletedTagIds } = service.deleteTags({
      libraryId,
      tagIds: [alpha.tagId, beta.tagId],
    });
    expect(deletedTagIds.sort()).toEqual([alpha.tagId, beta.tagId].sort());
    expect(service.listTags(libraryId)).toHaveLength(0);

    service.closeAll();
  });

  it('merges tags into a newly named tag and deduplicates asset links', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'MergeA' });
    const beta = service.createTag({ libraryId, name: 'MergeB' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [alpha.tagId] });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [beta.tagId] });

    const merged = service.mergeTags({
      libraryId,
      sourceTagIds: [alpha.tagId, beta.tagId],
      name: 'Merged',
    });
    expect(merged.name).toBe('Merged');
    expect(merged.assetCount).toBe(1);

    const list = service.listTags(libraryId);
    expect(list).toHaveLength(1);
    expect(list[0]?.tagId).toBe(merged.tagId);
    expect(list.find((tag) => tag.tagId === alpha.tagId)).toBeUndefined();

    service.closeAll();
  });

  it('throws when merging fewer than two tags', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Solo' });
    expectServiceCode(
      () =>
        service.mergeTags({
          libraryId,
          sourceTagIds: [tag.tagId],
          name: 'Nope',
        }),
      'INVALID_FOLDER_NAME',
    );
    service.closeAll();
  });

  it('builds tag co-occurrence graph with weighted edges', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'CoAlpha' });
    const beta = service.createTag({ libraryId, name: 'CoBeta' });
    const solo = service.createTag({ libraryId, name: 'CoSolo' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [alpha.tagId, beta.tagId] });

    const graph = service.getTagCooccurrenceGraph({ libraryId });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(edge.weight).toBe(1);
    expect([edge.sourceTagId, edge.targetTagId].sort()).toEqual(
      [alpha.tagId, beta.tagId].sort(),
    );
    expect(graph.nodes.find((node) => node.tagId === solo.tagId)).toBeUndefined();

    service.closeAll();
  });

  it('respects minWeight when building co-occurrence edges', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'WeightA' });
    const beta = service.createTag({ libraryId, name: 'WeightB' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [alpha.tagId, beta.tagId] });

    const graph = service.getTagCooccurrenceGraph({ libraryId, minWeight: 2 });
    expect(graph.edges).toHaveLength(0);

    service.closeAll();
  });
});

// ── Tag assignment ────────────────────────────────────────────────────

describe('tag assignment', () => {
  it('counts distinct assets across human and AI tag relationships', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Shared source' });
    const db = new TestDatabase(path.join(libraryPath, '.keel', 'library.db'));
    try {
      db.prepare(
        `INSERT INTO ai_asset_tags
           (asset_id, tag_id, revision_id, model_id, model_version)
         VALUES (?, ?, NULL, 'test-model', '1')`,
      ).run(assetId, tag.tagId);
    } finally {
      db.close();
    }

    expect(service.listTags(libraryId).find((item) => item.tagId === tag.tagId)?.assetCount).toBe(1);
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(service.listTags(libraryId).find((item) => item.tagId === tag.tagId)?.assetCount).toBe(1);
    service.closeAll();
  });

  it('assigns tags to assets and counts assignments', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });

    const result = service.assignTags({
      libraryId,
      assetIds: [assetId],
      tagIds: [alpha.tagId, beta.tagId],
    });
    expect(result.assignedCount).toBe(2);
    expect(result.skipped).toEqual([]);

    // Verify assetCount on listed tags.
    const list = service.listTags(libraryId);
    const alphaSummary = list.find((t) => t.tagId === alpha.tagId);
    const betaSummary = list.find((t) => t.tagId === beta.tagId);
    expect(alphaSummary?.assetCount).toBe(1);
    expect(betaSummary?.assetCount).toBe(1);

    service.closeAll();
  });

  it('is idempotent on tag assignment', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Idem' });

    const first = service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(first.assignedCount).toBe(1);

    const second = service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(second.assignedCount).toBe(0);

    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === tag.tagId)?.assetCount).toBe(1);

    service.closeAll();
  });

  it('skips nonexistent assets during assignment and reports them', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Ghost' });

    const result = service.assignTags({
      libraryId,
      assetIds: [assetId, 'nonexistent'],
      tagIds: [tag.tagId],
    });
    expect(result.assignedCount).toBe(1);
    expect(result.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);

    // The valid asset still received the tag.
    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === tag.tagId)?.assetCount).toBe(1);

    service.closeAll();
  });

  it('reports every requested asset as skipped when none exist', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Ghost' });

    const result = service.assignTags({
      libraryId,
      assetIds: ['nonexistent'],
      tagIds: [tag.tagId],
    });
    expect(result.assignedCount).toBe(0);
    expect(result.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);

    // Nothing was assigned anywhere.
    expect(service.listTags(libraryId).find((t) => t.tagId === tag.tagId)?.assetCount).toBe(0);

    service.closeAll();
  });

  it('rejects assignment with nonexistent tag', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.assignTags({ libraryId, assetIds: [assetId], tagIds: ['nonexistent'] }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('removes tags and counts removals', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [alpha.tagId, beta.tagId] });

    const result = service.removeTags({
      libraryId,
      assetIds: [assetId],
      tagIds: [alpha.tagId],
    });
    expect(result.removedCount).toBe(1);
    expect(result.skipped).toEqual([]);

    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === alpha.tagId)?.assetCount).toBe(0);
    expect(list.find((t) => t.tagId === beta.tagId)?.assetCount).toBe(1);

    service.closeAll();
  });

  it('removeTags also clears AI-authored tag links (Serpent-h2i2)', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'AiOnly' });
    const db = new TestDatabase(path.join(libraryPath, '.keel', 'library.db'));
    try {
      db.prepare(
        `INSERT INTO ai_asset_tags
           (asset_id, tag_id, revision_id, model_id, model_version)
         VALUES (?, ?, NULL, 'test-model', '1')`,
      ).run(assetId, tag.tagId);
    } finally {
      db.close();
    }

    const result = service.removeTags({
      libraryId,
      assetIds: [assetId],
      tagIds: [tag.tagId],
    });
    expect(result.removedCount).toBe(1);

    const after = new TestDatabase(path.join(libraryPath, '.keel', 'library.db'));
    try {
      const count = (
        after
          .prepare(
            'SELECT COUNT(*) AS count FROM ai_asset_tags WHERE asset_id = ? AND tag_id = ?',
          )
          .get(assetId, tag.tagId) as { count: number }
      ).count;
      expect(count).toBe(0);
    } finally {
      after.close();
    }

    service.closeAll();
  });

  it('is idempotent on tag removal', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'RemoveMe' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const first = service.removeTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(first.removedCount).toBe(1);

    const second = service.removeTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(second.removedCount).toBe(0);

    service.closeAll();
  });

  it('skips nonexistent assets during removal and reports them', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'RemoveMe' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const result = service.removeTags({
      libraryId,
      assetIds: [assetId, 'nonexistent'],
      tagIds: [tag.tagId],
    });
    expect(result.removedCount).toBe(1);
    expect(result.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);

    // A removal targeting only unknown assets is a no-op, not an error.
    const noop = service.removeTags({
      libraryId,
      assetIds: ['nonexistent'],
      tagIds: [tag.tagId],
    });
    expect(noop.removedCount).toBe(0);
    expect(noop.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);

    service.closeAll();
  });

  it('supports bulk cross-product assignment', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    const t1 = service.createTag({ libraryId, name: 'T1' });
    const t2 = service.createTag({ libraryId, name: 'T2' });

    const result = service.assignTags({
      libraryId,
      assetIds: [assetId, assetId2],
      tagIds: [t1.tagId, t2.tagId],
    });
    // 2 assets x 2 tags = 4 assignments
    expect(result.assignedCount).toBe(4);

    const removeResult = service.removeTags({
      libraryId,
      assetIds: [assetId, assetId2],
      tagIds: [t1.tagId, t2.tagId],
    });
    expect(removeResult.removedCount).toBe(4);

    service.closeAll();
  });
});

// ── Asset Metadata ─────────────────────────────────────────────────────

describe('asset metadata', () => {
  it('returns defaults when no metadata row exists', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    const metadata = service.getAssetMetadata({ libraryId, assetId });
    expect(metadata).toMatchObject({
      assetId,
      description: null,
      rating: 0,
      favorite: false,
      palette: null,
      sourcePageUrl: null,
      author: null,
      entityVersion: 0,
    });
    service.closeAll();
  });

  it('throws ASSET_NOT_FOUND for nonexistent asset', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.getAssetMetadata({ libraryId, assetId: 'nonexistent' }),
      'ASSET_NOT_FOUND',
    );
    service.closeAll();
  });

  it('creates metadata row on first set (expectedVersion=0) and increments version', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    const result = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      description: 'Hero description',
      rating: 4,
      favorite: true,
    });
    expect(result.entityVersion).toBe(1);
    expect(result.description).toBe('Hero description');
    expect(result.rating).toBe(4);
    expect(result.favorite).toBe(true);

    // Second set with expectedVersion=1 should succeed and bump to 2.
    const result2 = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      rating: 5,
    });
    expect(result2.entityVersion).toBe(2);
    expect(result2.rating).toBe(5);
    expect(result2.description).toBe('Hero description'); // unchanged

    service.closeAll();
  });

  it('throws VERSION_CONFLICT on optimistic lock mismatch', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // First write: creates row with entityVersion=1.
    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      description: 'First',
    });

    // Attempt with stale expectedVersion=0.
    const staleConflict = expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 0,
          description: 'Stale',
        }),
      'VERSION_CONFLICT',
    );
    expect(staleConflict.currentEntityVersion).toBe(1);

    // Attempt with wrong expectedVersion (should be 1).
    const futureConflict = expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 2,
          description: 'Wrong',
        }),
      'VERSION_CONFLICT',
    );
    expect(futureConflict.currentEntityVersion).toBe(1);

    service.closeAll();
  });

  it('throws VERSION_CONFLICT when inserting with expectedVersion != 0 and no row exists', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const conflict = expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 1,
          description: 'Bad',
        }),
      'VERSION_CONFLICT',
    );
    expect(conflict.currentEntityVersion).toBe(0);
    service.closeAll();
  });

  it('enforces rating boundary 0-5', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // Valid boundaries.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 0, rating: 0 });
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });

    // Out of bounds rejected at service level.
    expectServiceCode(
      () => service.setAssetMetadata({ libraryId, assetId, expectedVersion: 2, rating: -1 }),
      'INVALID_ASSET_METADATA',
    );
    expectServiceCode(
      () => service.setAssetMetadata({ libraryId, assetId, expectedVersion: 2, rating: 6 }),
      'INVALID_ASSET_METADATA',
    );
    expectServiceCode(
      () => service.setAssetMetadata({ libraryId, assetId, expectedVersion: 2, rating: 1.5 }),
      'INVALID_ASSET_METADATA',
    );

    service.closeAll();
  });

  it('enforces description length at the service boundary', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    expectServiceCode(
      () => service.setAssetMetadata({
        libraryId,
        assetId,
        expectedVersion: 0,
        description: 'a'.repeat(10_001),
      }),
      'INVALID_ASSET_METADATA',
    );

    service.closeAll();
  });

  it('ignores palette writes and leaves stored palette unchanged', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // Serpent-7pg: any palette payload is a no-op for the column / effective view.
    const palette20 = Array.from({ length: 20 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    const first = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      palette: palette20,
    });
    expect(first).toMatchObject({
      palette: null,
      effectivePalette: [],
      paletteSource: null,
      entityVersion: 1,
    });

    const palette21 = Array.from({ length: 21 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    const second = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      palette: palette21,
    });
    expect(second).toMatchObject({
      palette: null,
      effectivePalette: [],
      paletteSource: null,
      entityVersion: 1,
    });

    service.closeAll();
  });

  it('ignores invalid manual palette payloads without rejecting the write', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    let expectedVersion = 0;
    for (const invalidColor of ['red', '#FFF', '#12345G', 'rgb(1, 2, 3)', ' #112233']) {
      const result = service.setAssetMetadata({
        libraryId,
        assetId,
        expectedVersion,
        palette: [invalidColor],
      });
      expect(result).toMatchObject({
        palette: null,
        effectivePalette: [],
        paletteSource: null,
      });
      expectedVersion = result.entityVersion;
    }

    service.closeAll();
  });

  it('accepts only empty or HTTP(S) source-page URLs at the service boundary', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    for (const invalidUrl of [
      'ftp://example.com/source',
      '/relative/source',
      'https://user:secret@example.com/source',
      ' https://example.com/source ',
      '   ',
      `https://example.com/${'a'.repeat(8_193)}`,
    ]) {
      expectServiceCode(
        () => service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 0,
          sourcePageUrl: invalidUrl,
        }),
        'INVALID_ASSET_METADATA',
      );
    }

    const longValidUrl = `https://example.com/${'a'.repeat(300)}`;
    expect(service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      sourcePageUrl: longValidUrl,
    }).sourcePageUrl).toBe(longValidUrl);
    expect(service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      sourcePageUrl: '',
    }).sourcePageUrl).toBeNull();

    service.closeAll();
  });

  it('accepts only non-blank, whitespace-trimmed author values at the service boundary', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    for (const invalidAuthor of [
      ' Jane Doe',
      'Jane Doe ',
      '   ',
      'a'.repeat(256),
    ]) {
      expectServiceCode(
        () => service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 0,
          author: invalidAuthor,
        }),
        'INVALID_ASSET_METADATA',
      );
    }

    const validAuthor = 'a'.repeat(255);
    expect(service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      author: validAuthor,
    }).author).toBe(validAuthor);
    expect(service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      author: '',
    }).author).toBeNull();

    service.closeAll();
  });

  it('sets and reads back author independently of other metadata fields', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    const result = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      author: 'Jane Doe',
      description: 'Hero description',
    });
    expect(result.author).toBe('Jane Doe');
    expect(result.description).toBe('Hero description');

    const fetched = service.getAssetMetadata({ libraryId, assetId });
    expect(fetched.author).toBe('Jane Doe');

    // Updating other fields without touching author must leave it unchanged.
    const untouched = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: result.entityVersion,
      rating: 3,
    });
    expect(untouched.author).toBe('Jane Doe');

    service.closeAll();
  });

  it('backfill is idempotent and fills missing rows', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    // Initially no metadata rows exist.
    const meta1 = service.getAssetMetadata({ libraryId, assetId });
    expect(meta1.entityVersion).toBe(0);

    // First backfill.
    const first = service.backfillAssetMetadata(libraryId);
    expect(first.backfilledCount).toBeGreaterThanOrEqual(2);

    // Second backfill is idempotent.
    const second = service.backfillAssetMetadata(libraryId);
    expect(second.backfilledCount).toBe(0);

    // Both assets now have metadata default rows.
    const metaAfter1 = service.getAssetMetadata({ libraryId, assetId });
    expect(metaAfter1.entityVersion).toBe(1);
    expect(metaAfter1.rating).toBe(0);
    expect(metaAfter1.favorite).toBe(false);

    const metaAfter2 = service.getAssetMetadata({ libraryId, assetId: assetId2 });
    expect(metaAfter2.entityVersion).toBe(1);

    service.closeAll();
  });

  it('AssetSummary reflects rating/favorite after metadata.set', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // Before metadata: defaults.
    const assetsBefore = service.listAssets({ libraryId, recursive: true });
    const before = assetsBefore.find((a) => a.assetId === assetId)!;
    expect(before.rating).toBe(0);
    expect(before.favorite).toBe(false);

    // Set metadata.
    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      rating: 5,
      favorite: true,
    });

    // After metadata: populated.
    const assetsAfter = service.listAssets({ libraryId, recursive: true });
    const after = assetsAfter.find((a) => a.assetId === assetId)!;
    expect(after.rating).toBe(5);
    expect(after.favorite).toBe(true);

    service.closeAll();
  });
});

