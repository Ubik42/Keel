"""Incremental, one-way photo archive. Phone mutations are deliberately absent."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path

MEDIA = {'.jpg','.jpeg','.jpe','.png','.gif','.webp','.bmp','.heic','.heif','.dng','.raw','.arw','.cr2','.nef','.tif','.tiff','.avif','.mp4','.mov','.m4v','.3gp','.3gpp','.mkv','.webm','.avi','.mts','.m2ts','.ts'}
CACHE = {'.thumbnails','.gs','.stx','.tmfs','.convert_tmp_files','cache','code_cache','assets','templateextra'}


def is_cache(path: str) -> bool:
    return any(p.lower() in CACHE or p.lower().startswith('.gs_fs') for p in path.split('/'))


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as data:
        for block in iter(lambda: data.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def safe_relative(path: str) -> Path:
    parts = path.replace('\\', '/').split('/')
    if any(p in {'', '.', '..'} for p in parts):
        raise ValueError('无效的手机相对路径')
    table = str.maketrans({'<':'＜','>':'＞',':':'：','"':'＂','|':'｜','?':'？','*':'＊'})
    output = []
    for part in parts:
        part = part.translate(table).rstrip(' .') or '_'
        if re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', part.split('.')[0]):
            part = '_' + part
        output.append(part)
    return Path(*output)


class Archive:
    def __init__(self, root: Path, config: dict):
        self.root = root.resolve()
        self.config = config
        self.meta = self.root / '.serpent' / 'phone-sync'
        if not (self.root / '.serpent' / 'library.db').is_file():
            raise ValueError('所选文件夹尚未建立 Serpent 资源库。')
        if (self.root / '.serpent').is_symlink():
            raise ValueError('资源库元数据目录不能是符号链接。')
        if self.meta.exists() and (self.meta.is_symlink() or self.meta.resolve().parent != (self.root/'.serpent').resolve()):
            raise ValueError('同步状态目录越过资源库边界。')
        self.meta.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.meta / 'sync.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS objects (
                hash TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL,
                size INTEGER NOT NULL, verified_mtime INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sources (
                path TEXT PRIMARY KEY, size INTEGER NOT NULL, stamp TEXT,
                hash TEXT NOT NULL, seen TEXT, seeded INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, started TEXT, completed TEXT, result TEXT
            );
        ''')
        self.stats = {}

    def close(self):
        self.db.close()

    def location(self, path: Path):
        real = path.resolve()
        if real.is_relative_to(self.root) and not real.is_relative_to(self.root / '.serpent'):
            return 'library', real.relative_to(self.root).as_posix()
        for name, folder in self.config.get('shared_roots', {}).items():
            parent = Path(folder).resolve()
            if real.is_relative_to(parent) and not real.is_relative_to(parent / '.serpent'):
                return name, real.relative_to(parent).as_posix()
        raise ValueError('照片路径超出资源库及已配置的共享目录')

    def resolve(self, row):
        parent = self.root if row['scope'] == 'library' else Path(self.config['shared_roots'][row['scope']]).resolve()
        path = parent / row['ref']
        if path.is_symlink() or not path.resolve().is_relative_to(parent):
            raise ValueError('照片引用不能越过配置目录')
        return path

    def remember(self, value: str, path: Path):
        scope, ref = self.location(path)
        stat = path.stat()
        self.db.execute('INSERT OR REPLACE INTO objects VALUES (?,?,?,?,?)',
                        (value, scope, ref, stat.st_size, stat.st_mtime_ns))

    def canonical(self, value: str):
        row = self.db.execute('SELECT * FROM objects WHERE hash=?', (value,)).fetchone()
        if row is None:
            return None
        try:
            path = self.resolve(row)
            stat = path.stat()
            if stat.st_size != row['size']:
                return None
            if stat.st_mtime_ns != row['verified_mtime']:
                if digest(path) != value:
                    return None
                self.remember(value, path)
            return path
        except (OSError, KeyError, ValueError):
            return None

    def seed(self, content_index: Path, source_maps: list[Path]):
        if self.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0]:
            return
        for value, row in json.loads(content_index.read_text(encoding='utf-8')).items():
            path = Path(row['path'])
            if path.is_file() and path.stat().st_size == row['bytes'] and digest(path) == value:
                self.remember(value, path)
        for source_map in source_maps:
            for row in json.loads(source_map.read_text(encoding='utf-8')):
                if self.canonical(row['sha256']) is not None:
                    self.db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)',
                                    (row['phonePath'], row['bytes'], None, row['sha256'], 'imported-baseline'))
        self.db.commit()

    def refresh_local_index(self):
        """Rebind originals after users reorganize files through Serpent."""
        by_path = {}
        for row in self.db.execute('SELECT * FROM objects WHERE scope="library"'):
            by_path[str(self.resolve(row)).casefold()] = row
        for directory, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = [name for name in dirs if name not in {'.serpent','.bf','_同步记录','_管理'} and not (Path(directory)/name).is_symlink() and not getattr(Path(directory)/name,'is_junction',lambda:False)()]
            for name in files:
                path = Path(directory) / name
                if path.suffix.lower() not in MEDIA or path.is_symlink():
                    continue
                stat = path.stat()
                previous = by_path.get(str(path.resolve()).casefold())
                if previous and previous['size'] == stat.st_size and previous['verified_mtime'] == stat.st_mtime_ns:
                    continue
                value = digest(path)
                if self.canonical(value) is None:
                    self.remember(value, path)
        self.db.commit()

    def update(self, entries, download, *, verify=False, dry_run=False, report=print):
        run = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:12]
        stats = {'scanned':0,'unchanged':0,'newContent':0,'reusedContent':0,'downloadedBytes':0,'errors':[], 'run':run}
        staging = self.meta / 'staging'
        staging.mkdir(exist_ok=True)
        if staging.is_symlink() or not staging.resolve().is_relative_to(self.meta):
            raise ValueError('暂存目录越过同步状态边界。')
        for entry in entries:
            path, size, stamp = entry['path'], entry['bytes'], entry.get('stamp')
            stats['scanned'] += 1
            try:
                if size is None or size < 0:
                    raise ValueError('手机未返回可用文件大小')
                old = self.db.execute('SELECT * FROM sources WHERE path=?', (path,)).fetchone()
                kept = self.canonical(old['hash']) if old else None
                same = old and old['size'] == size and kept is not None and (
                    (stamp is not None and old['stamp'] == stamp) or bool(old['seeded']))
                if same and not verify:
                    stats['unchanged'] += 1
                    if not dry_run:
                        self.db.execute('UPDATE sources SET stamp=?,seen=?,seeded=0 WHERE path=?', (stamp,run,path))
                        if stats['scanned'] % 100 == 0:
                            self.db.commit()
                    continue
                if dry_run:
                    stats['downloadedBytes'] += size
                    continue
                temporary = staging / (hashlib.sha256(path.encode('utf-8')).hexdigest() + '.data')
                # A stale partial belongs to this transfer, never to an archived original.
                if temporary.exists():
                    temporary.unlink()
                copied = download(entry, temporary)
                value = copied['sha256']
                if temporary.stat().st_size != size or digest(temporary) != value:
                    raise OSError('复制后的文件大小或校验值不一致')
                stats['downloadedBytes'] += size
                kept = self.canonical(value)
                if kept is not None:
                    temporary.unlink()
                    stats['reusedContent'] += 1
                else:
                    device_folder = self.config.get('device_folder', '')
                    relative = (safe_relative(device_folder) if device_folder else Path()) / safe_relative(path)
                    target = self.root / relative
                    if not target.resolve().is_relative_to(self.root):
                        raise ValueError('目标路径超出资源库')
                    if target.exists():
                        # Keep edited local files and old versions intact.
                        target = target.with_name(target.stem + '_' + value[:12] + target.suffix)
                    if target.exists():
                        if digest(target) != value:
                            raise OSError('目标文件冲突')
                        temporary.unlink()
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary.rename(target)
                    self.remember(value, target)
                    stats['newContent'] += 1
                self.db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,0)', (path,size,stamp,value,run))
                self.db.commit()
            except Exception as exc:
                stats['errors'].append({'path':path,'error':str(exc)})
                report('未完成：' + path + ' — ' + str(exc))
            if stats['scanned'] % 100 == 0:
                report(f"已检查 {stats['scanned']} 项，新增 {stats['newContent']}，复用 {stats['reusedContent']}，未完成 {len(stats['errors'])}")
        if not dry_run:
            self.db.execute('UPDATE sources SET seeded=0 WHERE seeded=1')
            self.db.execute('INSERT INTO runs VALUES (?,?,?,?)', (run,run,time.strftime('%Y-%m-%dT%H:%M:%S'),json.dumps(stats,ensure_ascii=False)))
            self.db.commit()
            (self.meta / 'last-result.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2), encoding='utf-8')
            self.export()
        self.stats = stats
        return stats

    def export(self):
        records = self.root / '_管理' / '同步记录' / safe_relative(self.config.get('display_name') or self.config.get('device_folder') or '手机')
        records.mkdir(parents=True, exist_ok=True)
        with (records / '手机照片路径对应表.csv').open('w',encoding='utf-8-sig',newline='') as output:
            writer = csv.writer(output)
            writer.writerow(['手机原路径','电脑唯一文件','字节数','SHA-256'])
            for row in self.db.execute('SELECT * FROM sources ORDER BY path'):
                target = self.canonical(row['hash'])
                writer.writerow([row['path'],str(target) if target else '待恢复',row['size'],row['hash']])
        links = {}
        for row in self.db.execute('SELECT * FROM objects WHERE scope!="library"'):
            if self.canonical(row['hash']) is not None:
                links.setdefault(row['scope'], []).append(row['ref'])
        (self.meta / 'shared-links.json').write_text(json.dumps(links,ensure_ascii=False,indent=2),encoding='utf-8')
        self.db.commit()
