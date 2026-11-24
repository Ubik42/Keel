"""One-off: move a standalone phone-sync library into another Keel library.

Content goes through the same Keel import as the phone updater (capture month
folders, duplicate skip, phone tag). The phone path index moves along, so the
next USB update only reads new photos. The source library stays untouched.
"""
from __future__ import annotations
import argparse
import json
import shutil
import sys
from pathlib import Path
from core import Archive, meta_dir
from cli import keel_importer


def main():
    parser = argparse.ArgumentParser(description='将独立手机同步库迁入目标 Keel 资源库')
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--target', required=True, type=Path)
    parser.add_argument('--tag', default='来自手机')
    parser.add_argument('--limit', type=int, help='只迁移前 N 项（试跑）')
    args = parser.parse_args()
    source_root, target_root = args.source.resolve(), args.target.resolve()
    source_config = json.loads((meta_dir(source_root)/'phone-sync'/'config.json').read_text(encoding='utf-8-sig'))
    old = Archive(source_root, source_config)
    print('核对旧库内容索引…', flush=True)
    old.refresh_local_index()

    target_meta = meta_dir(target_root) / 'phone-sync'
    target_meta.mkdir(parents=True, exist_ok=True)
    config = {k: v for k, v in source_config.items() if k not in {'device_folder', 'shared_roots'}}
    config['tag'] = args.tag
    config['shared_roots'] = {}
    (target_meta/'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    new = Archive(target_root, config)
    print('核对目标库内容索引…', flush=True)
    new.refresh_local_index()

    sources = {}
    for row in old.db.execute('SELECT * FROM sources ORDER BY path'):
        sources.setdefault(row['hash'], []).append(row)
    items, tag_refs, placed = [], set(), {}
    for row in old.db.execute('SELECT hash FROM objects ORDER BY hash'):
        value = row['hash']
        if args.limit is not None and len(items) + len(placed) >= args.limit:
            break
        existing = new.canonical(value)
        if existing is not None:
            tag_refs.add(str(existing))
            placed[value] = existing
            continue
        path = old.canonical(value)
        if path is None:
            continue
        rows = sources.get(value, [])
        stamps = [r['stamp'] for r in rows if r['stamp']]
        phone_path = rows[0]['path'] if rows else path.relative_to(source_root).as_posix() if path.is_relative_to(source_root) else path.name
        items.append({'hash': value, 'file': str(path), 'phonePath': phone_path, 'stamp': max(stamps) if stamps else None})

    print(f'待导入 {len(items)} 项，目标库已有相同内容 {len(placed)} 项。', flush=True)
    result = keel_importer(target_root, new.meta, args.tag)(items, sorted(tag_refs)) if items or tag_refs else {'imported': {}, 'errors': {}}
    for value, outcome in result.get('imported', {}).items():
        placed[value] = Path(outcome['path'])
        new.remember(value, placed[value])
    run = 'migrated-from-' + source_root.name
    moved = 0
    for value in placed:
        for row in sources.get(value, []):
            new.db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,0)', (row['path'], row['size'], row['stamp'], value, run))
            moved += 1
    new.db.commit()
    new.export()
    errors = result.get('errors', {})
    summary = {'imported': len(result.get('imported', {})), 'alreadyInTarget': len(tag_refs), 'phoneSources': moved, 'errors': errors, 'tagged': result.get('tagged', 0)}
    (new.meta/'migration-result.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"导入 {summary['imported']} 项，目标库已有 {summary['alreadyInTarget']} 项，迁移手机路径记录 {moved} 条，打标签 {summary['tagged']} 项，失败 {len(errors)} 项。", flush=True)
    old.close(); new.close()
    return 2 if errors else 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
