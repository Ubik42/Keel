import type { TagSummary } from '../../shared/asset-types';

export function descendantTagIds(tags: readonly TagSummary[], tagId: string): string[] {
  const children = new Map<string, string[]>();
  for (const tag of tags) if (tag.parentTagId) { const siblings = children.get(tag.parentTagId) ?? []; siblings.push(tag.tagId); children.set(tag.parentTagId, siblings); }
  const result: string[] = [];
  const seen = new Set<string>();
  const pending = [tagId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id); result.push(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}

export function tagTreeRows(tags: readonly TagSummary[], query: string, collapsed: ReadonlySet<string>) {
  const byId = new Map(tags.map((tag) => [tag.tagId, tag]));
  const children = new Map<string | null, TagSummary[]>();
  for (const tag of tags) {
    const parent = tag.parentTagId && byId.has(tag.parentTagId) ? tag.parentTagId : null;
    const siblings = children.get(parent) ?? []; siblings.push(tag); children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const needle = query.trim().toLocaleLowerCase();
  const matches = new Set<string>();
  if (needle) for (const tag of tags) {
    if (!tag.name.toLocaleLowerCase().includes(needle)) continue;
    let current: TagSummary | undefined = tag;
    const seen = new Set<string>();
    while (current && !seen.has(current.tagId)) {
      seen.add(current.tagId); matches.add(current.tagId);
      current = current.parentTagId ? byId.get(current.parentTagId) : undefined;
    }
  }
  const rows: Array<{ tag: TagSummary; depth: number; hasChildren: boolean; expanded: boolean }> = [];
  const visited = new Set<string>();
  function walk(tag: TagSummary, depth: number) {
    if (visited.has(tag.tagId) || (needle && !matches.has(tag.tagId))) return;
    visited.add(tag.tagId);
    const nested = children.get(tag.tagId) ?? [];
    const expanded = Boolean(needle) || !collapsed.has(tag.tagId);
    rows.push({ tag, depth, hasChildren: nested.length > 0, expanded });
    if (expanded) for (const child of nested) walk(child, depth + 1);
  }
  for (const tag of children.get(null) ?? []) walk(tag, 0);
  return rows;
}
