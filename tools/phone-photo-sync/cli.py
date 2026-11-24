"""Clickable-launcher entry point; all phone access is read-only and serial."""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from core import Archive, MEDIA, is_cache, meta_dir


PROJECT = Path(__file__).resolve().parents[2]


def keel_running():
    """Keel windows (packaged or dev Electron from this project) holding a library open."""
    script = ("Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Keel' -or "
              "($_.ProcessName -eq 'electron' -and $_.Path -like '" + str(PROJECT) + "*') } | Measure-Object | "
              "Select-Object -ExpandProperty Count")
    probe = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, text=True, check=False)
    return probe.stdout.strip() not in {'', '0'}


def wait_for_keel_closed(report=print, limit=1800):
    # Isolated trial libraries are never open in Keel.
    if os.environ.get('KEEL_PHONE_SYNC_IGNORE_RUNNING') == '1' or not keel_running():
        return
    report('Keel 正在运行。请关闭 Keel 窗口，导入会在关闭后自动继续。')
    deadline = time.monotonic() + limit
    while keel_running():
        if time.monotonic() > deadline:
            raise RuntimeError('等待关闭 Keel 超时；照片已暂存的部分下次会重新读取。')
        time.sleep(2)


def keel_importer(root, meta, tag):
    def run(items, tag_refs):
        wait_for_keel_closed()
        manifest = meta / 'import-manifest.json'
        result_path = meta / 'import-result.json'
        manifest.write_text(json.dumps({'tag':tag,'items':items,'tagRefs':tag_refs},ensure_ascii=False),encoding='utf-8')
        if result_path.exists():
            result_path.unlink()
        command = ['node', str(PROJECT/'scripts'/'run-phone-catalog.mjs'), str(root), str(manifest), str(result_path)]
        completed = subprocess.run(command, cwd=PROJECT, check=False)
        if not result_path.exists():
            message = f'Keel 导入未完成（退出码 {completed.returncode}）'
            return {'imported':{}, 'errors':{item['hash']:message for item in items}}
        return json.loads(result_path.read_text(encoding='utf-8'))
    return run


def scan(phone, config, errors):
    def visit(oid, prefix):
        try:
            ids = phone.children(oid)
        except Exception as exc:
            errors.append({'path':prefix,'error':str(exc)})
            return
        for oid in ids:
            try:
                entry = phone.info(oid)
                entry['path'] = prefix + '/' + entry['name']
                if entry['folder']:
                    if not is_cache(entry['path']):
                        yield from visit(oid, entry['path'])
                elif Path(entry['name']).suffix.lower() in MEDIA and not is_cache(entry['path']):
                    yield entry
            except Exception as exc:
                errors.append({'parent':prefix,'error':str(exc)})
    seen = set()
    for root in config['scan_roots']:
        if any(root == previous or root.startswith(previous + '/') for previous in seen):
            continue
        seen.add(root)
        try:
            folder = phone.find(root)
        except FileNotFoundError:
            continue  # An uninstalled application's optional save folder can disappear.
        except Exception as exc:
            errors.append({'path':root,'error':str(exc)})
            continue
        yield from visit(folder['id'], root)


def main():
    parser = argparse.ArgumentParser(description='将手机新增照片导入 Keel 资源库并打来自手机标签')
    parser.add_argument('--library', required=True, type=Path)
    parser.add_argument('--dry-run', action='store_true', help='检查变化，不复制照片')
    parser.add_argument('--verify', action='store_true', help='重新读取手机文件并核验内容')
    args = parser.parse_args()
    root = args.library.resolve()
    settings = meta_dir(root) / 'phone-sync' / 'config.json'
    config = json.loads(settings.read_text(encoding='utf-8-sig'))
    print('手机照片更新 — ' + str(root), flush=True)
    print('请连接并解锁手机，在 USB 用途里选择“文件传输”。', flush=True)
    from wpd_backend import Phone
    phone = None
    archive = None
    started = time.monotonic()
    try:
        phone = Phone(expected_serial=config.get('binding', {}).get('serial'))
        expected_model = config.get('binding', {}).get('model')
        if expected_model and phone.model != expected_model:
            raise RuntimeError('此手机与资源库绑定的型号不同，请检查连接设备。')
        if not phone.serial and not config.get('binding', {}).get('serial') and not expected_model:
            raise RuntimeError('请先为资源库绑定手机。')
        archive = Archive(root, config)
        archive.refresh_local_index()
        errors = []
        result = archive.update(scan(phone, config, errors),
                                lambda item, target: phone.download(item['id'], target, item['bytes']),
                                keel_importer(root, archive.meta, config.get('tag', '来自手机')),
                                verify=args.verify, dry_run=args.dry_run)
        result['enumerationErrors'] = errors
        result['seconds'] = round(time.monotonic() - started, 1)
        phone.close()
        phone = None
        print(f"完成检查 {result['scanned']} 项：未变化 {result['unchanged']}，新增内容 {result['newContent']}，复用已有内容 {result['reusedContent']}。",flush=True)
        print(f"读取 {result['downloadedBytes']/2**20:.1f} MiB，用时 {result['seconds']:.1f} 秒。",flush=True)
        failures = len(result['errors']) + len(errors)
        if failures:
            print(f'有 {failures} 项未完成，已保存成功进度；下次更新会继续补齐。',flush=True)
        elif args.dry_run:
            print('预览完成，照片文件保持原样。',flush=True)
        else:
            print('照片已导入资源库，并按拍摄年月归档。手机上的照片保持原样。',flush=True)
        return 2 if failures else 0
    except Exception as exc:
        print('本次更新未完成：' + str(exc),file=sys.stderr,flush=True)
        print('已保存的照片保持原样。连接恢复后可再次双击更新。',file=sys.stderr,flush=True)
        return 1
    finally:
        if phone is not None:
            phone.close()
        if archive is not None:
            archive.close()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
