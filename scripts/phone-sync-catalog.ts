/**
 * Phone photo import into a Keel library (tools/phone-photo-sync).
 *
 * Input manifest (JSON):
 *   { tag: string, items: [{ hash, file, phonePath, stamp }], tagRefs: [absolutePath] }
 * Every item goes through the standard managed import into `<year>/<month>`
 * (capture date: EXIF → file name → phone modification time → `_未知时间`).
 * Suspected duplicates are skipped and the existing asset is tagged instead.
 * The result maps each content hash to the absolute library path that holds it.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import exifr from 'exifr';
import { LibraryService } from '../src/worker/library-service';
import { libraryMetaDir } from '../src/shared/library-meta-dir';
import { sha256FileAtPath } from '../src/worker/library/library-fs';

type Item = { hash: string; file: string; phonePath: string; stamp: string | null };
type Manifest = { tag: string; items: Item[]; tagRefs: string[] };
type Outcome = { path: string; folder: string; duplicate: boolean };

const [rootArg, manifestArg, resultArg] = process.argv.slice(2);
if (!rootArg || !manifestArg || !resultArg) throw new Error('用法：catalog.cjs <资源库> <清单.json> <结果.json>');
const root = path.resolve(rootArg);
const resultPath: string = resultArg;
const manifest = JSON.parse(readFileSync(manifestArg, 'utf8')) as Manifest & { createLibrary?: boolean };
if (!existsSync(libraryMetaDir(root, 'library.db')) && !manifest.createLibrary) throw new Error('所选文件夹尚未建立 Keel 资源库：' + root);

const UNKNOWN_FOLDER = '_未知时间';
const MAX_YEAR = new Date().getFullYear() + 1;
const IMAGE = new Set(['.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.png', '.webp', '.tif', '.tiff', '.dng', '.avif']);

function valid(year: number, month: number): { year: number; month: number } | null {
  return year >= 2000 && year <= MAX_YEAR && month >= 1 && month <= 12 ? { year, month } : null;
}

async function exifDate(file: string) {
  if (!IMAGE.has(path.extname(file).toLowerCase())) return null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false }) as Record<string, unknown> | undefined;
    const raw = String(tags?.DateTimeOriginal ?? tags?.CreateDate ?? '');
    const match = /^(\d{4})[:-](\d{2})/.exec(raw);
    return match ? valid(Number(match[1]), Number(match[2])) : null;
  } catch { return null; }
}

function nameDate(name: string) {
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

function stampDate(stamp: string | null) {
  // WPD VT_DATE: local wall-clock days since 1899-12-30.
  const days = stamp === null ? NaN : Number(stamp);
  if (!Number.isFinite(days) || days <= 0) return null;
  const date = new Date((days - 25569) * 86_400_000);
  return valid(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/** Reuse an existing `7月` style month folder; otherwise `07`. */
function monthFolder(date: { year: number; month: number } | null): string {
  if (!date) return UNKNOWN_FOLDER;
  const year = String(date.year);
  const padded = String(date.month).padStart(2, '0');
  let existing: string[] = [];
  try { existing = readdirSync(path.join(root, year)); } catch { /* New year folder. */ }
  const named = `${date.month}月`;
  return `${year}/${existing.includes(padded) || !existing.includes(named) ? padded : named}`;
}

async function main(): Promise<void> {
const service = new LibraryService();
const outcome: { imported: Record<string, Outcome>; errors: Record<string, string>; tagged: number } = { imported: {}, errors: {}, tagged: 0 };
try {
  const library = existsSync(libraryMetaDir(root, 'library.db'))
    ? service.openLibrary(root)
    : service.createLibrary({ displayName: path.basename(root), selectedParentPath: root, useExistingFolder: true });
  const libraryId = library.libraryId;
  const open = service.requireOpenLibrary(libraryId);
  const tag = service.findOrCreateTagByName(open, manifest.tag);
  const toTag = new Set<string>();
  const sameSize = open.connection.prepare(
    `SELECT a.asset_id, a.relative_file_path FROM assets a
       JOIN revisions r ON r.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL AND a.location_kind = 'managed' AND r.byte_size = ?`,
  );
  const findByHash = (hash: string, size: number) => {
    for (const row of sameSize.all(size) as Array<{ asset_id: string; relative_file_path: string }>) {
      const absolute = service.folderPath(open, row.relative_file_path);
      try { if (sha256FileAtPath(absolute) === hash) return { assetId: row.asset_id, absolute }; } catch { /* Missing file. */ }
    }
    return null;
  };

  let done = 0;
  for (const item of manifest.items) {
    try {
      const folder = monthFolder(await exifDate(item.file) ?? nameDate(path.basename(item.phonePath)) ?? stampDate(item.stamp));
      const targetFolderId = service.ensureManagedFolderIdForRelativeDir(open, libraryId, folder);
      const prepared = service.prepareOrExecuteImport({ libraryId, sourceKind: 'files', sourcePaths: [item.file], targetFolderId });
      const completion = service.finishImportWithoutUserDecision(prepared, { suspectedDuplicate: 'skip', nameConflict: 'keep-both' });
      const created = completion.assets[0];
      if (created) {
        toTag.add(created.assetId);
        outcome.imported[item.hash] = { path: service.folderPath(open, created.relativeFilePath), folder, duplicate: false };
      } else {
        const existing = findByHash(item.hash, statSync(item.file).size);
        if (!existing) throw new Error('导入被跳过，且库中未找到相同内容');
        toTag.add(existing.assetId);
        outcome.imported[item.hash] = { path: existing.absolute, folder: path.dirname(existing.absolute), duplicate: true };
      }
    } catch (error) {
      outcome.errors[item.hash] = error instanceof Error ? error.message : String(error);
    }
    done += 1;
    if (done % 50 === 0 || done === manifest.items.length) console.log(`已导入 ${done}/${manifest.items.length}`);
  }

  const byPath = open.connection.prepare(
    `SELECT asset_id FROM assets WHERE deleted_at IS NULL AND location_kind = 'managed' AND relative_file_path = ?`,
  );
  const assetsRoot = service.assetsPath(open);
  for (const absolute of manifest.tagRefs) {
    const relative = path.relative(assetsRoot, absolute).split(path.sep).join('/');
    const row = byPath.get(relative) as { asset_id: string } | undefined;
    if (row) toTag.add(row.asset_id);
  }
  const ids = [...toTag];
  for (let start = 0; start < ids.length; start += 500) {
    service.assignTags({ libraryId, assetIds: ids.slice(start, start + 500), tagIds: [tag.tagId] });
  }
  outcome.tagged = ids.length;
} finally {
  writeFileSync(resultPath,JSON.stringify(outcome, null, 2));
  service.closeAll();
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
