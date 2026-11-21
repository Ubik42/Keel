import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { KeelLibraryApi } from '../../src/shared/library-api';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

test('creates root storage by default and offers the compatible Assets layout', async () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'serpent-root-ui-'));
  const applicationDirectory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [applicationDirectory],
    cwd: applicationDirectory,
    env: { ...process.env, KEEL_E2E: '1', KEEL_E2E_USER_DATA_PATH: path.join(parent, 'profile'),
      KEEL_E2E_CREATE_PARENT_PATH: parent },
  });
  try {
    await application.evaluate(({ dialog }, selectedParent) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedParent] });
    }, parent);
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    const layout = window.getByRole('combobox', { name: '素材存放位置' });
    await expect(layout).toHaveValue('root');
    await layout.selectOption('assets');
    await expect(window.getByText('素材统一存放在 Assets 子目录中，兼容原版 Keel 的资源库结构。')).toBeVisible();
    await layout.selectOption('root');
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('日常记录');
    await window.screenshot({ path: test.info().outputPath('root-create.png') });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(760, 720); });
    await expect(layout).toBeVisible();
    await window.screenshot({ path: test.info().outputPath('root-create-narrow.png') });
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('日常记录', { exact: true }).first()).toBeVisible();
    const library = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { keel: { library: KeelLibraryApi } }).keel.library;
      const result = await api.listOpen();
      if (!result.ok) throw new Error('Could not list open libraries');
      return result.value[0]!;
    });
    expect(library.storageLayout).toBe('root');
    const root = path.join(parent, '日常记录');
    expect(existsSync(path.join(root, 'Assets'))).toBe(false);
    writeFileSync(path.join(root, '原位照片.txt'), 'external file');
    await expect.poll(async () => window.evaluate(async (libraryId) => {
      const api = (globalThis as typeof globalThis & { keel: { library: KeelLibraryApi } }).keel.library;
      const result = await api.listAssets({ libraryId, recursive: true });
      return result.ok ? result.value.map((asset) => asset.relativeFilePath) : [];
    }, library.libraryId), { timeout: 20_000 }).toEqual(['原位照片.txt']);
    await window.screenshot({ path: test.info().outputPath('root-library.png') });
  } finally {
    await application.close();
    removePathWithSyncRetry(parent);
  }
});
