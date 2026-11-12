import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { TagSummary } from '../shared/asset-types';
import { Icon } from './Icons';
import { useT } from './i18n';
import { isImeKeyboardEvent } from './ime-safe-dismiss';
import { ContextMenu, ContextMenuBackdrop, ContextMenuItem, ContextMenuSection } from './context-menu';
import { resolveInternalAssetDropIds, supportsManagedAssetDrag } from './asset-drag-drop';
import { descendantTagIds, tagTreeRows } from './tag-tree-model';

import { TAG_DRAG_TYPE } from './tag-drag-drop';
import { EntityAppearancePicker } from './EntityAppearancePicker';
import { AppearanceGlyph, appearanceColorVar } from './AppearanceGlyph';
import { randomTagAppearance } from '../shared/tag-appearance';
import type { EntityAppearance } from '../shared/entity-appearance';
type Draft = { tagId?: string; parentTagId: string | null; value: string };
export interface TagTreeSidebarProps {
  libraryId: string;
  tags: readonly TagSummary[];
  activeTagId: string | null;
  onChoose: (tagId: string) => void;
  onCreate: (name: string, parentTagId?: string | null) => Promise<boolean>;
  onRename: (tagId: string, name: string) => Promise<boolean>;
  onMove: (tagId: string, parentTagId: string | null) => Promise<boolean>;
  onAppearance: (tagId: string, appearance: EntityAppearance | null) => Promise<boolean>;
  onDelete: (ids: string[]) => Promise<boolean>;
  onAssign: (ids: string[], tagId: string) => Promise<void>;
  getAssetDragIds: () => readonly string[] | null;
}
export function TagTreeSidebar(props: TagTreeSidebarProps) {
  const t = useT();
  const [appearanceDraft, setAppearanceDraft] = useState<{ id: string; value: EntityAppearance | null } | null>(null);
  const [query, setQuery] = useState('');
  const storageKey = `serpent.tag-tree.collapsed.${props.libraryId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const rows = useMemo(() => tagTreeRows(props.tags, query, collapsed), [props.tags, query, collapsed]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify([...collapsed])); } catch { /* Storage may be unavailable. */ } }, [collapsed, storageKey]);
  const byId = useMemo(() => new Map(props.tags.map((tag) => [tag.tagId, tag])), [props.tags]);

  function toggle(id: string) {
    setCollapsed((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function submit() {
    if (!draft?.value.trim() || saving) return;
    setSaving(true);
    try {
      const success = draft.tagId
        ? await props.onRename(draft.tagId, draft.value.trim())
        : await props.onCreate(draft.value.trim(), draft.parentTagId);
      if (success) { setDraft(null); setQuery(''); if (draft.parentTagId) setCollapsed((previous) => new Set([...previous].filter((id) => id !== draft.parentTagId))); }
    } finally { setSaving(false); }
  }
  function canDrop(event: DragEvent, targetId: string | null) {
    if (saving) return false;
    if (event.dataTransfer.types.includes(TAG_DRAG_TYPE)) return !draggedId || !targetId || !descendantTagIds(props.tags, draggedId).includes(targetId);
    return targetId !== null && (supportsManagedAssetDrag(event.dataTransfer) || Boolean(props.getAssetDragIds()?.length));
  }
  async function drop(event: DragEvent, targetId: string | null) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const sourceId = event.dataTransfer.getData(TAG_DRAG_TYPE);
    setDraggedId(null);
    setSaving(true);
    try {
      if (sourceId) await props.onMove(sourceId, targetId);
      else if (targetId) {
        const ids = resolveInternalAssetDropIds(event.dataTransfer, props.getAssetDragIds());
        if (ids?.length) await props.onAssign(ids, targetId);
      }
    } finally { setSaving(false); }
  }
  const menuTag = menu ? byId.get(menu.id) : undefined;
  return <section className="tag-tree-section" aria-label={t('tagTree.title')}>
    <div className="tag-tree-heading">
      <strong>{t('tagTree.title')}</strong><span className="tag-tree-total">{props.tags.length}</span>
      <button className="tiny-action" type="button" aria-label={t('tagTree.expandAll')} title={t('tagTree.expandAll')} onClick={() => setCollapsed(new Set())}><Icon name="chevron" size={13} /></button>
      <button className="tiny-action" type="button" aria-label={t('tagTree.collapseAll')} title={t('tagTree.collapseAll')} onClick={() => setCollapsed(new Set(props.tags.map((tag) => tag.tagId)))}><Icon name="minus" size={13} /></button>
      <button className="tiny-action" type="button" aria-label={t('tagTree.create')} title={t('tagTree.create')} disabled={saving} onClick={() => setDraft({ parentTagId: null, value: '' })}><Icon name="plus" size={14} /></button>
    </div>
    <input className="text-field tag-tree-search" aria-label={t('tagTree.search')} placeholder={t('tagTree.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
    {draft && <form className="tag-tree-edit" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="tag-tree-name">{draft.tagId ? t('tagTree.rename') : draft.parentTagId ? t('tagTree.createChild') : t('tagTree.create')}</label>
      {draft.parentTagId && <span className="field-help">{byId.get(draft.parentTagId)?.name}</span>}
      <input autoFocus id="tag-tree-name" aria-label={t('tagTree.name')} className="text-field" maxLength={255} disabled={saving} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} onKeyDown={(event) => { if (isImeKeyboardEvent(event)) return; if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); } }} />
      <div className="tag-tree-edit-actions"><button type="button" className="secondary-button" onClick={() => setDraft(null)} disabled={saving}>{t('common.cancel')}</button><button className="primary-button" disabled={saving || !draft.value.trim()} type="submit">{t('common.save')}</button></div>
    </form>}
    {confirmDelete && <div className="tag-tree-confirm" role="alert">
      <strong>{t('tagTree.delete')} · {byId.get(confirmDelete)?.name}</strong><p>{t('tagTree.deleteHelp')}</p>
      <div className="tag-tree-edit-actions"><button className="secondary-button" type="button" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button><button className="danger-button" type="button" disabled={saving} onClick={() => { setSaving(true); void props.onDelete([confirmDelete]).then((ok) => { if (ok) setConfirmDelete(null); }).finally(() => setSaving(false)); }}>{t('tagTree.delete')}</button></div>
    </div>}
    {appearanceDraft && <div className="tag-tree-appearance" role="group" aria-label={t('tagTree.appearance')}>
      <strong>{byId.get(appearanceDraft.id)?.name} · {t('tagTree.appearance')}</strong>
      <div className="tag-tree-appearance-picker"><EntityAppearancePicker value={appearanceDraft.value} onChange={(value) => setAppearanceDraft({ ...appearanceDraft, value })} /></div>
      <div className="tag-tree-edit-actions"><button className="secondary-button" type="button" onClick={() => setAppearanceDraft({ ...appearanceDraft, value: randomTagAppearance() })}>{t('tagTree.randomAppearance')}</button><button className="secondary-button" type="button" onClick={() => setAppearanceDraft(null)}>{t('common.cancel')}</button><button className="primary-button" type="button" disabled={saving} onClick={() => { setSaving(true); void props.onAppearance(appearanceDraft.id, appearanceDraft.value).then((ok) => { if (ok) setAppearanceDraft(null); }).finally(() => setSaving(false)); }}>{t('common.save')}</button></div>
    </div>}
    <div className="tag-tree-list" role="tree" aria-label={t('tagTree.title')} onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement || isImeKeyboardEvent(event)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
      const index = items.indexOf(event.target as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    }}>
      {rows.map(({ tag, depth, hasChildren, expanded }) => <div className={`tag-tree-row${dropTarget === tag.tagId ? ' is-drop-target' : ''}`} key={tag.tagId} style={{ paddingLeft: depth * 14 }} onDragOver={(event) => { if (canDrop(event, tag.tagId)) { event.preventDefault(); event.stopPropagation(); setDropTarget(tag.tagId); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(TAG_DRAG_TYPE) ? 'move' : 'copy'; } }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { if (canDrop(event, tag.tagId)) void drop(event, tag.tagId); }}>
        {hasChildren ? <button className={`tag-tree-disclosure${expanded ? ' is-open' : ''}`} type="button" aria-label={t(expanded ? 'tagTree.collapse' : 'tagTree.expand', { name: tag.name })} onClick={() => toggle(tag.tagId)}><Icon name="chevron" size={12} /></button> : <span className="tag-tree-disclosure-spacer" />}
        <button className={`nav-row${props.activeTagId === tag.tagId ? ' is-active' : ''}`} role="treeitem" aria-level={depth + 1} aria-selected={props.activeTagId === tag.tagId} aria-expanded={hasChildren ? expanded : undefined} aria-label={tag.name} title={t('tagTree.rowHelp', { name: tag.name })} data-tag-id={tag.tagId} type="button" draggable={!saving} disabled={saving} onDragStart={(event) => { event.dataTransfer.setData(TAG_DRAG_TYPE, tag.tagId); event.dataTransfer.effectAllowed = 'move'; setDraggedId(tag.tagId); }} onDragEnd={() => { setDraggedId(null); setDropTarget(null); }} onClick={() => props.onChoose(tag.tagId)} onKeyDown={(event) => { if (event.key === 'ArrowRight' && hasChildren && !expanded) { event.preventDefault(); toggle(tag.tagId); } if (event.key === 'ArrowLeft' && hasChildren && expanded) { event.preventDefault(); toggle(tag.tagId); } if (event.key === 'F2') { event.preventDefault(); setDraft({ tagId: tag.tagId, parentTagId: tag.parentTagId ?? null, value: tag.name }); } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ id: tag.tagId, x: event.clientX, y: event.clientY }); }}>
          <AppearanceGlyph appearance={tag.appearance} fallback="tag" size={16} /><span className="nav-row-label" style={{ color: appearanceColorVar(tag.appearance?.colorId) }}>{tag.name}</span><span className="nav-count" aria-hidden="true">{tag.subtreeAssetCount ?? tag.assetCount}</span>
        </button>
      </div>)}
    </div>
    {rows.length === 0 && <p className="tag-tree-empty">{t(query ? 'tagTree.noMatches' : 'tagTree.empty')}</p>}
    {draggedId && <div className={`tag-tree-root-drop${dropTarget === '__root' ? ' is-drop-target' : ''}`} onDragOver={(event) => { if (canDrop(event, null)) { event.preventDefault(); setDropTarget('__root'); } }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => void drop(event, null)}>{t('tagTree.moveToRoot')}</div>}
    {menu && menuTag && <ContextMenuBackdrop onClose={() => setMenu(null)}><ContextMenu position={{ x: menu.x, y: menu.y }} ariaLabel={t('tagTree.menu')}>
      <ContextMenuSection>
        <ContextMenuItem label={t('tagTree.appearance')} onAction={() => { setAppearanceDraft({ id: menuTag.tagId, value: menuTag.appearance ?? null }); setMenu(null); }} />
        <ContextMenuItem label={t('tagTree.createChild')} onAction={() => { setDraft({ parentTagId: menuTag.tagId, value: '' }); setMenu(null); }} />
        <ContextMenuItem label={t('tagTree.rename')} onAction={() => { setDraft({ tagId: menuTag.tagId, parentTagId: menuTag.parentTagId ?? null, value: menuTag.name }); setMenu(null); }} />
        {menuTag.parentTagId && <ContextMenuItem label={t('tagTree.moveToRoot')} onAction={() => { setMenu(null); setSaving(true); void props.onMove(menuTag.tagId, null).finally(() => setSaving(false)); }} />}
      </ContextMenuSection>
      <ContextMenuSection><ContextMenuItem danger label={t('tagTree.delete')} onAction={() => { setMenu(null); setConfirmDelete(menuTag.tagId); }} /></ContextMenuSection>
    </ContextMenu></ContextMenuBackdrop>}
  </section>;
}
