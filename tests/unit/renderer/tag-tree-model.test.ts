import { expect, it } from 'vitest';
import { descendantTagIds, tagTreeRows } from '../../../src/renderer/tags/tag-tree-model';
import { tagBrowseDefinition } from '../../../src/renderer/tags/tag-browse-definition';
const tags = [{ tagId: 'p', name: '角色', assetCount: 0 }, { tagId: 'c', parentTagId: 'p', name: 'NPC', assetCount: 1 }, { tagId: 'l', parentTagId: 'c', name: '商人', assetCount: 1 }, { tagId: 'other', name: '场景', assetCount: 1 }];
it('builds nested rows and collapses branches', () => {
  expect(tagTreeRows(tags, '', new Set()).find((row) => row.tag.tagId === 'l')?.depth).toBe(2);
  expect(tagTreeRows(tags, '', new Set(['p'])).map((row) => row.tag.tagId)).not.toContain('c');
});
it('keeps matching children and their ancestors visible when searching collapsed trees', () => {
  expect(tagTreeRows(tags, '商人', new Set(['p', 'c'])).map((row) => row.tag.tagId)).toEqual(['p', 'c', 'l']);
});
it('enumerates a subtree without including other roots or looping on corrupt data', () => {
  expect(new Set(descendantTagIds(tags, 'p'))).toEqual(new Set(['p', 'c', 'l']));
  expect(descendantTagIds([{ tagId: 'a', parentTagId: 'b', name: 'A', assetCount: 0 }, { tagId: 'b', parentTagId: 'a', name: 'B', assetCount: 0 }], 'a')).toHaveLength(2);
});
it('uses one recursive tag filter instead of expanding labels into an expression', () => {
  expect(tagBrowseDefinition('角色', {}, true).filters).toEqual([{ field: 'tag', values: ['角色'], exclude: false, includeAi: true, includeDescendants: true }]);
});
