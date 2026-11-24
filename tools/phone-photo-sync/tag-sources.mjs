// Backfill phone source tags for files already in the library.
//
// Usage: node tag-sources.mjs <library root> [--dry-run]
// Reads <root>/.keel/phone-sync/手机照片路径对应表.csv (phone path → library file)
// and tags each library file by where it was on the phone (source-tags.mjs).
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectKeel } from '../keel-api/keel-api.mjs';
import { applyPhoneSourceTags, phoneSourceTags } from './source-tags.mjs';

const PROJECT = path.resolve(import.meta.dirname, '..', '..');
const [root, flag] = process.argv.slice(2);
if (!root) throw new Error('用法：node tag-sources.mjs <资源库根目录> [--dry-run]');
const dryRun = flag === '--dry-run';
const syncDir = path.join(root, '.keel', 'phone-sync');
const config = JSON.parse(readFileSync(path.join(syncDir, 'config.json'), 'utf8'));
const { libraryId } = JSON.parse(readFileSync(path.join(syncDir, 'import-manifest.json'), 'utf8'));
const rows = readFileSync(path.join(syncDir, '手机照片路径对应表.csv'), 'utf8').replace(/^\uFEFF/u, '')
  .trim().split(/\r?\n/u).slice(1).map((line) => line.split(','))
  // Empty files share one hash, so their phone path says nothing about the library file.
  .filter(([phonePath, file, bytes]) => phonePath && file && bytes !== '0');

async function connect() {
  try { return await connectKeel({ clientName: 'phone-source-tags' }); } catch (error) {
    if (error?.code !== 'KEEL_API_UNAVAILABLE') throw error;
  }
  process.stdout.write('正在启动 Keel…\n');
  spawn('cmd.exe', ['/c', path.join(PROJECT, 'Start-Keel.cmd')], { cwd: PROJECT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(2000);
    try { return await connectKeel({ clientName: 'phone-source-tags' }); } catch (error) {
      if (error?.code !== 'KEEL_API_UNAVAILABLE') throw error;
    }
  }
  throw new Error('无法连接 Keel 本机 API。请启动 Keel，并在 设置 → MCP 中启动服务。');
}

const keel = await connect();
try {
  await keel.call('keel_library_open', { libraryId });
  const assets = new Map();
  for (let offset = 0; ; offset += 200) {
    const page = await keel.call('keel_asset_list', { libraryId, recursive: true, limit: 200, offset });
    for (const asset of page.items) assets.set(asset.relativeFilePath.toLowerCase(), asset.assetId);
    if (!page.hasMore) break;
  }
  const entries = [];
  const missing = [];
  for (const [phonePath, file] of rows) {
    const relative = path.relative(root, file).split(path.sep).join('/').toLowerCase();
    const assetId = assets.get(relative);
    if (assetId) entries.push({ assetId, phonePath });
    else missing.push(file);
  }
  process.stdout.write(`对应表 ${rows.length} 行，库内找到 ${entries.length}，未找到 ${missing.length}\n`);
  if (missing.length) process.stdout.write(`未找到示例：${missing.slice(0, 5).join('；')}\n`);
  if (dryRun) {
    const counts = {};
    for (const { phonePath } of entries) {
      const { kind, detail } = phoneSourceTags(phonePath);
      const name = detail ?? kind;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    process.stdout.write(`${JSON.stringify(counts, null, 1)}\n`);
  } else {
    const counts = await applyPhoneSourceTags(keel, libraryId, config.tag ?? '来自手机', entries);
    process.stdout.write(`已打标签：${JSON.stringify(counts)}\n`);
  }
} finally {
  await keel.close();
}
