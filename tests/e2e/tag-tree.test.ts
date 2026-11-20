import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';
test.setTimeout(120_000);
test('tag tree creates children, filters descendants, assigns assets and moves tags', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-tag-tree-ui-'));
  const appDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({ executablePath: resolveElectronExecutablePath(),
    args: process.env.SERPENT_E2E_ELECTRON_EXECUTABLE ? [] : [appDirectory], cwd: appDirectory,
    env: { ...process.env, SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: path.join(root, 'profile'), SERPENT_E2E_CREATE_PARENT_PATH: root } });
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, root);
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('标签树测试');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('标签树测试', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    const panel = window.getByRole('region', { name: '标签', exact: true });
    const tree = panel.getByRole('tree', { name: '标签', exact: true });
    async function createTag(name: string) {
      await panel.getByRole('button', { name: '新建标签', exact: true }).click();
      await panel.getByRole('textbox', { name: '标签名称', exact: true }).fill(name);
      await panel.getByRole('button', { name: '保存', exact: true }).click();
      await expect(tree.getByRole('treeitem', { name, exact: true })).toBeVisible();
    }
    await createTag('角色');
    const parent = tree.getByRole('treeitem', { name: '角色', exact: true });
    await parent.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '新增子标签', exact: true }).click();
    await panel.getByRole('textbox', { name: '标签名称', exact: true }).fill('NPC');
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    const child = tree.getByRole('treeitem', { name: 'NPC', exact: true });
    await expect(child).toHaveAttribute('aria-level', '2');
    await createTag('场景');
    await panel.getByRole('button', { name: '折叠 角色', exact: true }).click();
    await expect(child).toHaveCount(0);
    await panel.getByRole('textbox', { name: '搜索标签', exact: true }).fill('NPC');
    await expect(child).toBeVisible(); await expect(parent).toBeVisible();
    await panel.getByRole('textbox', { name: '搜索标签', exact: true }).fill('');
    await panel.getByRole('button', { name: '展开 角色', exact: true }).click();
    writeFileSync(path.join(root, '标签树测试', 'npc.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
    writeFileSync(path.join(root, '标签树测试', 'scene.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>');
    const libraryId = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const result = await api.listOpen(); if (!result.ok) throw new Error('No library'); return result.value[0]!.libraryId;
    });
    const catalog = async () => window.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const result = await api.listAssets({ libraryId: id, recursive: true }); if (!result.ok) throw new Error('No assets'); return result.value;
    }, libraryId);
    await expect.poll(async () => (await catalog()).length, { timeout: 20_000 }).toBe(2);
    const npcId = (await catalog()).find((asset) => asset.displayName === 'npc.svg')!.assetId;
    const transfer = await window.evaluateHandle((id) => { const data = new DataTransfer(); data.setData('application/x-serpent-managed-assets', JSON.stringify([id])); return data; }, npcId);
    await child.dispatchEvent('dragover', { dataTransfer: transfer });
    await child.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(parent.locator('.nav-count')).toHaveText('1');
    await parent.click();
    await expect(window.locator('.asset-grid').getByText('npc.svg', { exact: true }).first()).toBeVisible();
    await expect(window.locator('.asset-grid').getByText('scene.svg', { exact: true })).toHaveCount(0);
    await window.screenshot({ path: test.info().outputPath('tag-tree-linked-assets.png') });
    const childId = await child.getAttribute('data-tag-id');
    const scene = tree.getByRole('treeitem', { name: '场景', exact: true });
    const tagTransfer = await window.evaluateHandle((id) => { const data = new DataTransfer(); data.setData('application/x-serpent-tag', id!); return data; }, childId);
    await child.dispatchEvent('dragstart', { dataTransfer: tagTransfer });
    await scene.dispatchEvent('dragover', { dataTransfer: tagTransfer });
    await scene.dispatchEvent('drop', { dataTransfer: tagTransfer });
    await expect(parent.locator('.nav-count')).toHaveText('0');
    await expect(scene.locator('.nav-count')).toHaveText('1');
    await scene.click();
    await expect(window.locator('.asset-grid').getByText('npc.svg', { exact: true }).first()).toBeVisible();
    await child.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '重命名标签', exact: true }).click();
    await panel.getByRole('textbox', { name: '标签名称', exact: true }).fill('商人NPC');
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    const renamed = tree.getByRole('treeitem', { name: '商人NPC', exact: true });
    await expect(renamed).toBeVisible();
    await renamed.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移至标签根层级', exact: true }).click();
    await expect(renamed).toHaveAttribute('aria-level', '1');
    await renamed.click();
    await window.getByRole('button', { name: /^标签 ·/ }).click();
    await expect(window.locator('.asset-grid').getByText('npc.svg', { exact: true }).first()).toBeVisible();
    await expect(window.locator('.asset-grid').getByText('scene.svg', { exact: true }).first()).toBeVisible();
    expect(existsSync(path.join(root, '标签树测试', 'npc.svg'))).toBe(true);
    await window.screenshot({ path: test.info().outputPath('tag-tree-management.png') });
  } finally { await app.close(); removePathWithSyncRetry(root); }
});
