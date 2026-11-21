import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

test('hides text by default and reveals it when the format filter is cleared', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-text-filter-'));
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({ executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory], cwd: directory,
    env: { ...process.env, KEEL_E2E: '1', KEEL_E2E_USER_DATA_PATH: path.join(root, 'profile'), KEEL_E2E_CREATE_PARENT_PATH: root } });
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, root);
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('文本筛选');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('文本筛选', { exact: true }).first()).toBeVisible();
    writeFileSync(path.join(root, '文本筛选', '说明.md'), '# notes');
    writeFileSync(path.join(root, '文本筛选', '设置.json'), '{}');
    writeFileSync(path.join(root, '文本筛选', '图片.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>');
    await expect.poll(async () => window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { keel: { library: SerpentLibraryApi } }).keel.library;
      const open = await api.listOpen(); if (!open.ok) throw Error('No library');
      const assets = await api.listAssets({ libraryId: open.value[0]!.libraryId, recursive: true });
      return assets.ok ? assets.value.length : 0;
    }), { timeout: 20000 }).toBe(3);
    const grid = window.locator('.asset-grid');
    await expect(grid.getByText('图片.svg', { exact: true }).first()).toBeVisible();
    await expect(grid.getByText('说明.md', { exact: true })).toHaveCount(0);
    await expect(grid.getByText('设置.json', { exact: true })).toHaveCount(0);
    await window.screenshot({ path: test.info().outputPath('default-text-hidden.png') });
    await window.getByRole('button', { name: '全部清除', exact: true }).click();
    await expect(grid.getByText('说明.md', { exact: true }).first()).toBeVisible();
    await expect(grid.getByText('设置.json', { exact: true }).first()).toBeVisible();
  } finally { await app.close(); removePathWithSyncRetry(root); }
});
