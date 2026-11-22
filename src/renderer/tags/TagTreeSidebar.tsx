import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { TagSummary } from '../../shared/asset-types';
import { handleTreeItemKey, TreeDisclosure, TreeList } from '../workbench/tree/tree-view';
import { Icon } from '../common/Icons';
import { useT } from '../i18n';
import { isImeKeyboardEvent } from '../workbench/overlay/ime-safe-dismiss';
import { ContextMenu, ContextMenuBackdrop, ContextMenuItem, ContextMenuSection } from '../workbench/menu/context-menu';
import { resolveInternalAssetDropIds, resolveManagedDropEffect, supportsManagedAssetDrag } from '../browse/asset-drag-drop';
import { descendantTagIds, tagTreeRows } from './tag-tree-model';

import { TAG_DRAG_TYPE } from './tag-drag-drop';
import { AppearanceSubmenu } from '../appearance/AppearanceSubmenu';
import { PortaledPopover } from '../workbench/overlay/PortaledPopover';
import { Button } from '../workbench/ui/primitives';
import { AppearanceGlyph, appearanceColorVar } from '../appearance/AppearanceGlyph';
import { randomTagAppearance } from '../../shared/tag-appearance';
import type { EntityAppearance } from '../../shared/entity-appearance';
type Draft = { tagId?: string; parentTagId: string | null; value: string };
export interface TagTreeSidebarProps {
  libraryId: string;
  tags: readonly TagSummary[];
  activeTagId: string | null;
  pinnedTagId: string | null;
  onPin: (tagId: string) => void;
  onChoose: (tagId: string) => void;
  onCreate: (name: string, parentTagId?: string | null) => Promise<boolean>;
  onRename: (tagId: string, name: string) => Promise<boolean>;
  onMove: (tagId: string, parentTagId: string | null) => Promise<boolean>;
  onAppearance: (tagId: string, appearance: EntityAppearance | null) => Promise<boolean>;
  onDelete: (ids: string[]) => Promise<boolean>;
  onAssign: (ids: string[], tagId: string) => Promise<void>;
  getAssetDragIds: () => readonly string[] | null;
  isInternalAssetDrag: () => boolean;
  onResolveManagedAssetDrop: (files: File[]) => Promise<string[] | null>;
}
export function TagTreeSidebar(props: TagTreeSidebarProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const storageKey = `keel.tag-tree.collapsed.${props.libraryId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
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
    if (!draft?.value.trim() || saving || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const success = draft.tagId
        ? await props.onRename(draft.tagId, draft.value.trim())
        : await props.onCreate(draft.value.trim(), draft.parentTagId);
      if (success) { setDraft(null); setQuery(''); if (draft.parentTagId) setCollapsed((previous) => new Set([...previous].filter((id) => id !== draft.parentTagId))); }
    } finally { submitting.current = false; setSaving(false); }
  }
  function beginDraft(next: Draft) {
    setQuery('');
    if (next.parentTagId) setCollapsed((previous) => new Set([...previous].filter((id) => id !== next.parentTagId)));
    setDraft(next);
  }
  function canDrop(event: DragEvent, targetId: string | null) {
    if (saving) return false;
    if (event.dataTransfer.types.includes(TAG_DRAG_TYPE)) return !draggedId || !targetId || !descendantTagIds(props.tags, draggedId).includes(targetId);
    return targetId !== null && (supportsManagedAssetDrag(event.dataTransfer) || Boolean(props.getAssetDragIds()?.length) || (event.dataTransfer.types.includes('Files') && props.isInternalAssetDrag()));
  }
  async function drop(event: DragEvent, targetId: string | null) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const sourceId = event.dataTransfer.getData(TAG_DRAG_TYPE);
    const files = Array.from(event.dataTransfer.files);
    const internalAssetDrag = props.isInternalAssetDrag();
    setDraggedId(null);
    setSaving(true);
    try {
      if (sourceId) await props.onMove(sourceId, targetId);
      else if (targetId) {
        const ids = resolveInternalAssetDropIds(event.dataTransfer, props.getAssetDragIds())
          ?? (internalAssetDrag && files.length ? await props.onResolveManagedAssetDrop(files) : null);
        if (ids?.length) await props.onAssign(ids, targetId);
      }
    } finally { setSaving(false); }
  }
  function renderDraft(depth: number) {
    if (!draft) return null;
    return <form className="tag-tree-inline-edit" style={{ marginLeft: depth * 14 }} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <AppearanceGlyph fallback="tag" size={16} />
      <input autoFocus aria-label={t('tagTree.name')} className="text-field" maxLength={255} disabled={saving} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} onKeyDown={(event) => { if (isImeKeyboardEvent(event)) { if (event.key === 'Enter') event.preventDefault(); return; } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null); } }} />
      <button type="submit" className="tiny-action" aria-label={t('common.save')} title={t('common.save')} disabled={saving || !draft.value.trim()}><Icon name="check" size={14} /></button>
      <button type="button" className="tiny-action" aria-label={t('common.cancel')} title={t('common.cancel')} disabled={saving} onClick={() => setDraft(null)}><Icon name="close" size={14} /></button>
    </form>;
  }
  const menuTag = menu ? byId.get(menu.id) : undefined;
  return <section className="tag-tree-section" aria-label={t('tagTree.title')}>
    <div className="tag-tree-heading">
      <strong>{t('tagTree.title')}</strong><span className="tag-tree-total">{props.tags.length}</span>
      <label className="sidebar-heading-search"><Icon name="search" size={13} /><input aria-label={t('tagTree.search')} placeholder={t('tagTree.search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button className="tiny-action" type="button" aria-label={t('tagTree.expandAll')} title={t('tagTree.expandAll')} onClick={() => setCollapsed(new Set())}><Icon name="chevron" size={13} /></button>
      <button className="tiny-action" type="button" aria-label={t('tagTree.collapseAll')} title={t('tagTree.collapseAll')} onClick={() => setCollapsed(new Set(props.tags.map((tag) => tag.tagId)))}><Icon name="minus" size={13} /></button>
      <button className="tiny-action" type="button" aria-label={t('tagTree.create')} title={t('tagTree.create')} disabled={saving} onClick={() => beginDraft({ parentTagId: null, value: '' })}><Icon name="plus" size={14} /></button>
    </div>
    {confirmDelete && <TagDeleteConfirm
      tagId={confirmDelete}
      name={byId.get(confirmDelete)?.name ?? ''}
      saving={saving}
      onCancel={() => setConfirmDelete(null)}
      onConfirm={() => { setSaving(true); void props.onDelete([confirmDelete]).then((ok) => { if (ok) setConfirmDelete(null); }).finally(() => setSaving(false)); }}
    />}
    <TreeList className="tag-tree-list" label={t('tagTree.title')}>
      {rows.map(({ tag, depth, hasChildren, expanded }) => <Fragment key={tag.tagId}>{draft?.tagId === tag.tagId ? renderDraft(depth) : <div className={`tag-tree-row${dropTarget === tag.tagId ? ' is-drop-target' : ''}`} key={tag.tagId} style={{ paddingLeft: depth * 14 }} onDragOver={(event) => { if (canDrop(event, tag.tagId)) { event.preventDefault(); event.stopPropagation(); setDropTarget(tag.tagId); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(TAG_DRAG_TYPE) ? 'move' : (resolveManagedDropEffect('copy', event.dataTransfer.effectAllowed) ?? 'none'); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => (current === tag.tagId ? null : current)); }} onDrop={(event) => { if (canDrop(event, tag.tagId)) void drop(event, tag.tagId); }}>
        {Array.from({ length: depth }, (_, level) => <span key={level} className="tag-tree-guide" aria-hidden="true" style={{ left: level * 14 + 8 }} />)}
        {hasChildren ? <TreeDisclosure className="tag-tree-disclosure" expandedClassName="is-open" icon="chevron" expanded={expanded} label={t(expanded ? 'tagTree.collapse' : 'tagTree.expand', { name: tag.name })} onToggle={() => toggle(tag.tagId)} /> : <span className="tag-tree-disclosure-spacer" />}
        <button className={`nav-row${props.activeTagId === tag.tagId ? ' is-active' : ''}`} role="treeitem" aria-level={depth + 1} aria-selected={props.activeTagId === tag.tagId} aria-expanded={hasChildren ? expanded : undefined} aria-label={tag.name} title={t('tagTree.rowHelp', { name: tag.name })} data-tag-id={tag.tagId} type="button" draggable={!saving} disabled={saving} onDragStart={(event) => { event.dataTransfer.setData(TAG_DRAG_TYPE, tag.tagId); event.dataTransfer.effectAllowed = 'copyMove'; setDraggedId(tag.tagId); }} onDragEnd={() => { setDraggedId(null); setDropTarget(null); }} onClick={() => props.onChoose(tag.tagId)} onKeyDown={(event) => { if (handleTreeItemKey(event, { hasChildren, expanded, onToggle: () => toggle(tag.tagId) })) return; if (event.key === 'F2') { event.preventDefault(); setDraft({ tagId: tag.tagId, parentTagId: tag.parentTagId ?? null, value: tag.name }); } }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ id: tag.tagId, x: event.clientX, y: event.clientY }); }}>
          <AppearanceGlyph appearance={tag.appearance} fallback="tag" size={16} /><span className="nav-row-label" style={{ color: appearanceColorVar(tag.appearance?.colorId) }}>{tag.name}</span><span className="nav-count" aria-hidden="true">{tag.subtreeAssetCount ?? tag.assetCount}</span>
        </button>
        <button type="button" className={`tag-tree-pin${props.pinnedTagId === tag.tagId ? ' is-pinned' : ''}`} aria-label={`${t(props.pinnedTagId === tag.tagId ? 'tagTree.unpin' : 'tagTree.pin')}：${tag.name}`} aria-pressed={props.pinnedTagId === tag.tagId} title={t(props.pinnedTagId === tag.tagId ? 'tagTree.unpinHelp' : 'tagTree.pinHelp')} onClick={() => props.onPin(tag.tagId)}><Icon name="pin" size={14} /></button>
      </div>}{draft && !draft.tagId && draft.parentTagId === tag.tagId && renderDraft(depth + 1)}</Fragment>)}
      {draft && !draft.tagId && !draft.parentTagId && renderDraft(0)}
    </TreeList>
    {rows.length === 0 && !draft && <p className="tag-tree-empty">{t(query ? 'tagTree.noMatches' : 'tagTree.empty')}</p>}
    {draggedId && <div className={`tag-tree-root-drop${dropTarget === '__root' ? ' is-drop-target' : ''}`} onDragOver={(event) => { if (canDrop(event, null)) { event.preventDefault(); setDropTarget('__root'); } }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => void drop(event, null)}>{t('tagTree.moveToRoot')}</div>}
    {menu && menuTag && <ContextMenuBackdrop onClose={() => setMenu(null)}><ContextMenu position={{ x: menu.x, y: menu.y }} ariaLabel={t('tagTree.menu')}>
      <ContextMenuSection>
        <ContextMenuItem icon={<Icon name="plus" size={14} />} label={t('tagTree.createChild')} onAction={() => { beginDraft({ parentTagId: menuTag.tagId, value: '' }); setMenu(null); }} />
        <ContextMenuItem icon={<Icon name="edit" size={14} />} label={t('tagTree.rename')} onAction={() => { beginDraft({ tagId: menuTag.tagId, parentTagId: menuTag.parentTagId ?? null, value: menuTag.name }); setMenu(null); }} />
        <AppearanceSubmenu label={t('tagTree.appearance')} value={menuTag.appearance ?? null} fallback="tag" onChange={(appearance) => void props.onAppearance(menuTag.tagId, appearance)} randomLabel={t('tagTree.randomAppearance')} onRandom={() => void props.onAppearance(menuTag.tagId, randomTagAppearance())} />
        {menuTag.parentTagId && <ContextMenuItem icon={<Icon name="folder-tree" size={14} />} label={t('tagTree.moveToRoot')} onAction={() => { setMenu(null); setSaving(true); void props.onMove(menuTag.tagId, null).finally(() => setSaving(false)); }} />}
      </ContextMenuSection>
      <ContextMenuSection><ContextMenuItem danger icon={<Icon name="trash" size={14} />} label={t('tagTree.delete')} onAction={() => { setMenu(null); setConfirmDelete(menuTag.tagId); }} /></ContextMenuSection>
    </ContextMenu></ContextMenuBackdrop>}
  </section>;
}

/**
 * Delete confirmation that opens beside the tag's row, like the appearance
 * submenu. Escape or a click outside cancels.
 */
function TagDeleteConfirm({ tagId, name, saving, onCancel, onConfirm }: {
  tagId: string;
  name: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  // The row is already rendered when the menu asks for confirmation.
  const anchorRef = useMemo(() => ({ current: document.querySelector<HTMLElement>(`.tag-tree-row [data-tag-id="${CSS.escape(tagId)}"]`) }), [tagId]);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!surfaceRef.current?.contains(event.target as Node)) onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onCancel]);
  return <PortaledPopover anchorRef={anchorRef} beside className="tag-tree-confirm" role="dialog" aria-label={`${t('tagTree.delete')} · ${name}`}>
    <div ref={surfaceRef}>
      <strong>{t('tagTree.delete')} · {name}</strong><p>{t('tagTree.deleteHelp')}</p>
      <div className="tag-tree-edit-actions"><Button size="sm" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button><Button ref={confirmRef} size="sm" variant="danger" disabled={saving} onClick={onConfirm}>{t('tagTree.delete')}</Button></div>
    </div>
  </PortaledPopover>;
}
