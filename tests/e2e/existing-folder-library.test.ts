import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { KeelLibraryApi } from '../../src/shared/library-api';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

test('turns an existing folder into a library and automatically indexes its original files', async () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'serpent-existing-ui-'));
  const folder = path.join(parent, '原有照片');
  mkdirSync(path.join(folder, '2026'), { recursive: true });
  const source = path.join(folder, '2026', '原始照片.txt');
  writeFileSync(source, 'original file');
  const sourceMtime = statSync(source).mtimeMs;
  const applicationDirectory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [applicationDirectory],
    cwd: applicationDirectory,
    env: { ...process.env, KEEL_E2E: '1', KEEL_E2E_USER_DATA_PATH: path.join(parent, 'profile'),
      KEEL_E2E_CREATE_PARENT_PATH: folder },
  });
  try {
    await application.evaluate(({ dialog }, selectedFolder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] });
    }, folder);
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('combobox', { name: '创建方式' }).selectOption('existing');
    await expect(window.getByRole('combobox', { name: '素材存放位置' })).toHaveCount(0);
    await expect(window.getByText(/直接将所选文件夹设为资源库/)).toBeVisible();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('日常记录');
    await window.screenshot({ path: test.info().outputPath('existing-folder-create.png') });
    await window.getByRole('button', { name: '选择文件夹并创建', exact: true }).click();
    await expect(window.getByText('日常记录', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    const library = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { keel: { library: KeelLibraryApi } }).keel.library;
      const result = await api.listOpen();
      if (!result.ok) throw new Error('Could not list open libraries');
      return result.value[0]!;
    });
    expect(library.displayPath).toBe(folder);
    expect(library.storageLayout).toBe('root');
    await expect.poll(async () => window.evaluate(async (libraryId) => {
      const api = (globalThis as typeof globalThis & { keel: { library: KeelLibraryApi } }).keel.library;
      const result = await api.listAssets({ libraryId, recursive: true });
      return result.ok ? result.value.map((asset) => asset.relativeFilePath) : [];
    }, library.libraryId), { timeout: 20_000 }).toEqual(['2026/原始照片.txt']);
    expect(existsSync(path.join(folder, '.keel', 'library.db'))).toBe(true);
    expect(existsSync(path.join(folder, '日常记录'))).toBe(false);
    expect(existsSync(path.join(folder, 'Assets'))).toBe(false);
    expect(readFileSync(source, 'utf8')).toBe('original file');
    expect(statSync(source).mtimeMs).toBe(sourceMtime);
    await window.screenshot({ path: test.info().outputPath('existing-folder-library.png') });
  } finally {
    await application.close();
    removePathWithSyncRetry(parent);
  }
});
