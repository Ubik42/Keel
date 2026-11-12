import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { executeBoundedWriteWorkerCommand } from '../../src/worker/bounded-write-command';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';
const roots: string[] = [];
const services: LibraryService[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-tag-tree-')); roots.push(root);
  const service = new LibraryService(); services.push(service);
  const library = service.createLibrary({ displayName: 'Tags', selectedParentPath: root });
  const libraryId = library.libraryId;
  const create = (name: string, parentTagId?: string) => service.createTag({ libraryId, name, parentTagId });
  return { root, service, library, libraryId, create };
}
afterEach(() => { for (const service of services.splice(0)) service.closeAll(); for (const root of roots.splice(0)) removePathWithSyncRetry(root); });
async function bounded(service: LibraryService, command: WorkerCommand & { libraryId: string }) {
  const result = await service.runBoundedWrite(command.libraryId, () => executeBoundedWriteWorkerCommand(service, command, { source: 'desktop', sourceReference: null }));
  if (!result?.ok || !('historyEntryId' in result) || !result.historyEntryId) throw new Error('Missing history receipt');
  return result.historyEntryId;
}
describe('persistent tag hierarchy', () => {
  it('creates nested tags without changing their names and retains the tree on reopen', () => {
    const { service, library, libraryId, create } = fixture();
    const parent = create('角色'); const child = create('NPC', parent.tagId); const leaf = create('商人', child.tagId);
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)).toMatchObject({ name: 'NPC', parentTagId: parent.tagId });
    service.closeAll(); service.openLibrary(library.libraryPath);
    expect(service.listTags(libraryId).find((tag) => tag.tagId === leaf.tagId)?.parentTagId).toBe(child.tagId);
  });
  it('rejects self-parenting and descendant cycles without changing names or edges', () => {
    const { service, libraryId, create } = fixture();
    const a = create('A'); const b = create('B', a.tagId); const c = create('C', b.tagId);
    expect(() => service.renameTag({ libraryId, tagId: a.tagId, name: 'changed', parentTagId: c.tagId })).toThrow('TAG_HIERARCHY_CYCLE');
    expect(() => service.renameTag({ libraryId, tagId: b.tagId, name: 'B', parentTagId: b.tagId })).toThrow('TAG_HIERARCHY_CYCLE');
    expect(service.listTags(libraryId).find((tag) => tag.tagId === a.tagId)?.name).toBe('A');
    expect(service.listTags(libraryId).find((tag) => tag.tagId === b.tagId)?.parentTagId).toBe(a.tagId);
  });
  it('checks the parent exists before committing a newly created tag', () => {
    const { service, libraryId, create } = fixture();
    expect(() => create('invalid', 'missing')).toThrow('FOLDER_NOT_FOUND');
    expect(service.listTags(libraryId)).toEqual([]);
  });
  it('counts unique assets and filters a whole subtree while excluding unrelated tags', () => {
    const { service, libraryId, library, create } = fixture();
    const parent = create('角色'); const child = create('NPC', parent.tagId); const other = create('场景');
    writeFileSync(path.join(library.libraryPath, 'npc.txt'), 'npc'); writeFileSync(path.join(library.libraryPath, 'scene.txt'), 'scene');
    service.refreshManagedAssets(libraryId);
    const assets = service.listAssets({ libraryId, recursive: true });
    const npc = assets.find((asset) => asset.displayName === 'npc.txt')!;
    const scene = assets.find((asset) => asset.displayName === 'scene.txt')!;
    service.assignTags({ libraryId, assetIds: [npc.assetId], tagIds: [parent.tagId, child.tagId] });
    service.assignTags({ libraryId, assetIds: [scene.assetId], tagIds: [other.tagId] });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === parent.tagId)?.subtreeAssetCount).toBe(1);
    const results = service.searchAssets({ libraryId, filters: [{ field: 'tag', values: ['角色'], exclude: false, includeDescendants: true }], limit: 100 });
    expect(results.items.map((asset) => asset.assetId)).toEqual([npc.assetId]);
    // Removing the direct parent tag still leaves it visible through its child.
    service.removeTags({ libraryId, assetIds: [npc.assetId], tagIds: [parent.tagId] });
    expect(service.searchAssets({ libraryId, filters: [{ field: 'tag', values: ['角色'], exclude: false, includeDescendants: true }], limit: 100 }).items).toHaveLength(1);
    expect(service.searchAssets({ libraryId, filters: [{ field: 'tag', values: ['角色'], exclude: false }], limit: 100 }).items).toHaveLength(0);
  });
  it('undoes and redoes a hierarchy move', async () => {
    const { service, libraryId, create } = fixture();
    const a = create('A'); const b = create('B'); const child = create('child', a.tagId);
    const id = await bounded(service, { type: 'tag.rename', libraryId, tagId: child.tagId, name: child.name, parentTagId: b.tagId });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBe(b.tagId);
    await service.undoOperationHistory({ libraryId, expectedHistoryEntryId: id });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBe(a.tagId);
    await service.redoOperationHistory({ libraryId, expectedHistoryEntryId: id });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBe(b.tagId);
  });
  it('promotes children on parent deletion and restores links when undoing it', async () => {
    const { service, libraryId, create } = fixture();
    const parent = create('parent'); const child = create('child', parent.tagId);
    const id = await bounded(service, { type: 'tag.delete', libraryId, tagId: parent.tagId });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBeUndefined();
    await service.undoOperationHistory({ libraryId, expectedHistoryEntryId: id });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBe(parent.tagId);
    await service.redoOperationHistory({ libraryId, expectedHistoryEntryId: id });
    expect(service.listTags(libraryId).find((tag) => tag.tagId === child.tagId)?.parentTagId).toBeUndefined();
  });
});
