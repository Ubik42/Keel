import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';
import type { SerpentLibraryApi } from '../../src/shared/library-api';

test.setTimeout(120_000);
test('native multi-image drops add a tag and reverse tag drops affect only the target image', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-two-way-tags-'));
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({ executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory], cwd: directory,
    env: { ...process.env, KEEL_E2E: '1', KEEL_E2E_NATIVE_ASSET_DRAG: '1', KEEL_E2E_USER_DATA_PATH: path.join(root, 'profile'), KEEL_E2E_CREATE_PARENT_PATH: root },
  });
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, root);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '创建资源库', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('双向标签');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('双向标签', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    for (const name of ['一.svg', '二.svg']) writeFileSync(path.join(root, '双向标签', name), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>');
    const panel = page.getByRole('region', { name: '标签', exact: true });
    for (const name of ['批量', '单张']) {
      await panel.getByRole('button', { name: '新建标签', exact: true }).click();
      await panel.getByRole('textbox', { name: '标签名称' }).fill(name);
      await panel.getByRole('textbox', { name: '标签名称' }).press('Enter');
      await expect(panel.getByRole('treeitem', { name, exact: true })).toBeVisible();
    }
    const cards = page.locator('.asset-card[data-asset-id]');
    await expect(cards).toHaveCount(2, { timeout: 20_000 });
    const firstId = await cards.nth(0).getAttribute('data-asset-id');
    const secondId = await cards.nth(1).getAttribute('data-asset-id');
    await cards.nth(0).click();
    await cards.nth(1).click({ modifiers: ['Control'] });
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.nth(0)).toHaveAttribute('draggable', 'true', { timeout: 25_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const state = globalThis as typeof globalThis & { tagDragFiles?: string[] };
      BrowserWindow.getAllWindows()[0]!.webContents.startDrag = (item) => { state.tagDragFiles = item.files ?? [item.file]; };
    });
    await cards.nth(0).dispatchEvent('dragstart');
    const readFiles = () => app.evaluate(() => (globalThis as typeof globalThis & { tagDragFiles?: string[] }).tagDragFiles ?? []);
    await expect.poll(readFiles).toHaveLength(2);
    const files = await readFiles();
    const tag = panel.getByRole('treeitem', { name: '批量', exact: true });
    const bounds = await tag.boundingBox();
    expect(bounds).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    try {
      const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
      const data = { items: [], files, dragOperationsMask: 3 };
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
      await expect(tag.locator('..')).toHaveClass(/is-drop-target/);
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...point, data });
    } finally { await cdp.detach(); }
    await expect(tag.locator('.nav-count')).toHaveText('2');
    // Both images stay selected. A tag dropped onto one card affects that card only.
    await panel.getByRole('treeitem', { name: '单张', exact: true }).dragTo(cards.nth(0));
    const metadata = async (assetId: string) => page.evaluate(async (id) => {
      const api = (window as typeof window & { keel: { library: SerpentLibraryApi } }).keel.library;
      const open = await api.listOpen(); if (!open.ok) throw new Error('No library');
      const result = await api.getAssetMetadata({ libraryId: open.value[0]!.libraryId, assetId: id });
      if (!result.ok) throw new Error('No metadata'); return result.value.tags.map(tag => tag.name).sort();
    }, assetId);
    await expect.poll(() => metadata(firstId!)).toEqual(['单张', '批量']);
    await expect.poll(() => metadata(secondId!)).toEqual(['批量']);
    await panel.getByRole('treeitem', { name: '单张', exact: true }).dragTo(cards.nth(0));
    await expect.poll(() => metadata(firstId!)).toEqual(['单张', '批量']);
    const pin = panel.getByRole('button', { name: '固定标签过滤：批量', exact: true });
    await expect(pin).toHaveText('');
    await expect(pin.locator('svg')).toBeVisible();
    await pin.click();
    await expect(panel.getByRole('button', { name: '取消固定标签过滤：批量', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: 'work/two-way-tag-drag.png' });
  } finally { await app.close(); removePathWithSyncRetry(root); }
});
