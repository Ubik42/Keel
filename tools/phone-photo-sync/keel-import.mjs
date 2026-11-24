// Phone photo import through Keel's local API (docs/manual/mcp/local-api.md).
//
// Usage: node keel-import.mjs <manifest.json> <result.json>
// Manifest: { libraryId, root, tag, items: [{ hash, file, phonePath, stamp }], tagRefs: [absolutePath] }
// Each item is imported into `<year>/<month>` (capture date: EXIF → file name →
// phone modification time → `_未知时间`) and tagged. tagRefs are existing library
// files whose content is on the phone; they only get the tag.
// Result: { imported: { hash: { path, folder } }, errors: { hash: message }, tagged }
import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectKeel } from '../keel-api/keel-api.mjs';

const PROJECT = path.resolve(import.meta.dirname, '..', '..');
const exifr = createRequire(path.join(PROJECT, 'package.json'))('exifr');
const [manifestPath, resultPath] = process.argv.slice(2);
if (!manifestPath || !resultPath) throw new Error('用法：node keel-import.mjs <清单.json> <结果.json>');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { libraryId, root, tag: tagName } = manifest;

const UNKNOWN_FOLDER = '_未知时间';
const MAX_YEAR = new Date().getFullYear() + 1;
const IMAGE = new Set(['.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.png', '.webp', '.tif', '.tiff', '.dng', '.avif']);
const IMPORT_BATCH = 200; // keel_file_import reports at most 200 assets per call.

const valid = (year, month) => (year >= 2000 && year <= MAX_YEAR && month >= 1 && month <= 12 ? { year, month } : null);

async function exifDate(file) {
  if (!IMAGE.has(path.extname(file).toLowerCase())) return null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    const match = /^(\d{4})[:-](\d{2})/.exec(String(tags?.DateTimeOriginal ?? tags?.CreateDate ?? ''));
    return match ? valid(Number(match[1]), Number(match[2])) : null;
  } catch { return null; }
}

function nameDate(name) {
  // IMG20250408130600, IMG_20260821_170925, Screenshot_2025-04-08-13-06-00, Weixin Image_20260225130930
  const calendar = /(?<!\d)(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d{3})/.exec(name);
  if (calendar) return valid(Number(calendar[1]), Number(calendar[2]));
  // mmexport1700000000000, wx_camera_1700000000000: epoch milliseconds.
  const epoch = /(?<!\d)(1[3-9]\d{11})(?!\d)/.exec(name);
  if (epoch) {
    const date = new Date(Number(epoch[1]));
    return valid(date.getFullYear(), date.getMonth() + 1);
  }
  return null;
}

function stampDate(stamp) {
  // WPD VT_DATE: local wall-clock days since 1899-12-30.
  const days = stamp == null ? NaN : Number(stamp);
  if (!Number.isFinite(days) || days <= 0) return null;
  const date = new Date((days - 25569) * 86_400_000);
  return valid(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/** Reuse an existing `7月` style month folder; otherwise `07`. */
function monthFolder(date) {
  if (!date) return UNKNOWN_FOLDER;
  const year = String(date.year);
  const padded = String(date.month).padStart(2, '0');
  let existing = [];
  try { existing = readdirSync(path.join(root, year)); } catch { /* New year folder. */ }
  const named = `${date.month}月`;
  return `${year}/${existing.includes(padded) || !existing.includes(named) ? padded : named}`;
}

async function connect() {
  try { return await connectKeel({ clientName: 'phone-photo-sync' }); } catch (error) {
    if (error?.code !== 'KEEL_API_UNAVAILABLE') throw error;
  }
  process.stdout.write('正在启动 Keel…\n');
  spawn('cmd.exe', ['/c', path.join(PROJECT, 'Start-Keel.cmd')], { cwd: PROJECT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(2000);
    try { return await connectKeel({ clientName: 'phone-photo-sync' }); } catch (error) {
      if (error?.code !== 'KEEL_API_UNAVAILABLE') throw error;
    }
  }
  throw new Error('无法连接 Keel 本机 API。请启动 Keel，并在 设置 → MCP 中启动服务。');
}

async function pages(keel, tool, args = {}) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const page = await keel.call(tool, { libraryId, ...args, limit: 200, offset });
    items.push(...page.items);
    if (!page.hasMore) return items;
  }
}

const outcome = { imported: {}, errors: {}, tagged: 0 };
const keel = await connect();
try {
  await keel.call('keel_library_open', { libraryId });
  const folders = new Map((await pages(keel, 'keel_folder_list')).map((folder) => [folder.relativePath, folder.folderId]));
  async function ensureFolder(relative) {
    let parent = null;
    let current = '';
    for (const name of relative.split('/')) {
      current = current ? `${current}/${name}` : name;
      if (!folders.has(current)) {
        const create = () => keel.call('keel_folder_create', { libraryId, name, parentFolderId: parent });
        try {
          folders.set(current, (await create()).id);
        } catch (error) {
          if (error?.code === 'FOLDER_ALREADY_EXISTS') {
            // An empty directory on disk is not a Keel folder; let Keel create it properly.
            const directory = path.join(root, ...current.split('/'));
            if (!existsSync(directory) || readdirSync(directory).length) throw error;
            rmdirSync(directory);
            folders.set(current, (await create()).id);
          } else {
            // Builds before the folder.create result fix report AUTOMATION_RESULT_INVALID after creating it.
            if (error?.code !== 'AUTOMATION_RESULT_INVALID') throw error;
            for (const folder of await pages(keel, 'keel_folder_list')) folders.set(folder.relativePath, folder.folderId);
            if (!folders.has(current)) throw error;
          }
        }
      }
      parent = folders.get(current);
    }
    return parent;
  }

  // Plan destinations; rename staged copies whose name is taken so the import never conflicts.
  const groups = new Map();
  const planned = new Set();
  for (const item of manifest.items) {
    const folder = monthFolder(await exifDate(item.file) ?? nameDate(path.basename(item.phonePath)) ?? stampDate(item.stamp));
    let file = item.file;
    const taken = (name) => planned.has(`${folder}/${name}`.toLowerCase()) || existsSync(path.join(root, folder, name));
    if (taken(path.basename(file))) {
      const ext = path.extname(file);
      const renamed = path.join(path.dirname(file), `${path.basename(file, ext)}_${item.hash.slice(0, 12)}${ext}`);
      renameSync(file, renamed);
      file = renamed;
    }
    planned.add(`${folder}/${path.basename(file)}`.toLowerCase());
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ ...item, file });
  }

  const toTag = new Set();
  let done = 0;
  for (const [folder, items] of groups) {
    let targetFolderId;
    try {
      targetFolderId = await ensureFolder(folder);
    } catch (error) {
      for (const item of items) outcome.errors[item.hash] = `文件夹 ${folder}：${error.code ?? ''} ${error.message}`.trim();
      continue;
    }
    for (let start = 0; start < items.length; start += IMPORT_BATCH) {
      const batch = items.slice(start, start + IMPORT_BATCH);
      try {
        const result = await keel.call('keel_file_import', { libraryId, sourceKind: 'files', sourcePaths: batch.map((item) => item.file), targetFolderId });
        if (result.status !== 'completed') throw new Error('Keel 报告导入冲突，本批未导入');
        const byName = new Map(result.completion.assets.map((asset) => [path.posix.basename(asset.relativeFilePath).toLowerCase(), asset]));
        for (const item of batch) {
          const asset = byName.get(path.basename(item.file).toLowerCase());
          if (!asset) { outcome.errors[item.hash] = 'Keel 未返回该文件的导入结果'; continue; }
          toTag.add(asset.assetId);
          outcome.imported[item.hash] = { path: path.join(root, ...asset.relativeFilePath.split('/')), folder };
        }
      } catch (error) {
        for (const item of batch) outcome.errors[item.hash] = `${error.code ?? ''} ${error.message}`.trim();
      }
      done += batch.length;
      process.stdout.write(`已导入 ${done}/${manifest.items.length}\n`);
    }
  }

  // Existing library files whose content is on the phone.
  const folderAssets = new Map();
  for (const absolute of manifest.tagRefs) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const folder = path.posix.dirname(relative);
    const folderId = folders.get(folder);
    if (!folderId) continue;
    if (!folderAssets.has(folder)) folderAssets.set(folder, await pages(keel, 'keel_asset_list', { folderId }));
    const asset = folderAssets.get(folder).find((entry) => entry.relativeFilePath.toLowerCase() === relative.toLowerCase());
    if (asset) toTag.add(asset.assetId);
  }

  const ids = [...toTag];
  if (ids.length) {
    const existing = (await pages(keel, 'keel_tag_list')).find((tag) => tag.name === tagName);
    const tagId = existing?.tagId ?? (await keel.call('keel_tag_create', { libraryId, name: tagName })).id;
    for (let start = 0; start < ids.length; start += 10_000) {
      await keel.call('keel_tag_assign', { libraryId, assetIds: ids.slice(start, start + 10_000), tagIds: [tagId] });
    }
  }
  outcome.tagged = ids.length;
} finally {
  writeFileSync(resultPath, JSON.stringify(outcome, null, 2));
  await keel.close();
}
