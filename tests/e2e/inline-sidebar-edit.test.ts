import { _electron as electron, expect, test } from '@playwright/test';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

test.setTimeout(120_000);
test('sidebar searches stay in headings, tags edit in place, and image trash works', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-inline-sidebar-'));
  const source = path.join(root, 'fixture.png');
  writeFileSync(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const appDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.SERPENT_E2E_ELECTRON_EXECUTABLE ? [] : [appDirectory], cwd: appDirectory,
    env: { ...process.env, SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: path.join(root, 'profile'), SERPENT_E2E_CREATE_PARENT_PATH: root, SERPENT_E2E_IMPORT_FILES: source },
  });
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, root);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '创建资源库', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('原位操作');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('原位操作', { exact: true }).first()).toBeVisible({ timeout: 25_000 });
    const panel = page.getByRole('region', { name: '标签', exact: true });
    const tree = panel.getByRole('tree', { name: '标签', exact: true });
    await expect(panel.locator('.tag-tree-heading').getByRole('textbox', { name: '搜索标签' })).toBeVisible();
    const folderSearch = page.locator('.nav-section-heading').getByRole('textbox', { name: '搜索文件夹' });
    await expect(folderSearch).toBeVisible();
    await folderSearch.fill('不存在');
    await folderSearch.press('Escape');
    await expect(folderSearch).toBeVisible();
    await expect(folderSearch).toHaveValue('');
    await panel.getByRole('button', { name: '新建标签', exact: true }).click();
    await expect(tree.getByRole('textbox', { name: '标签名称' })).toBeFocused();
    await tree.getByRole('textbox', { name: '标签名称' }).fill('角色');
    await tree.getByRole('textbox', { name: '标签名称' }).press('Enter');
    const parent = tree.getByRole('treeitem', { name: '角色', exact: true });
    await expect(parent).toBeVisible();
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新增子标签', exact: true }).click();
    const draft = tree.locator('.tag-tree-inline-edit');
    await expect(draft).toHaveCSS('margin-left', '14px');
    expect(await parent.evaluate((el) => Boolean(el.closest('.tag-tree-row')?.nextElementSibling?.matches('.tag-tree-inline-edit')))).toBe(true);
    await draft.getByRole('textbox').fill('NPC');
    await draft.getByRole('button', { name: '保存', exact: true }).click();
    const child = tree.getByRole('treeitem', { name: 'NPC', exact: true });
    await expect(child).toHaveAttribute('aria-level', '2');
    await child.focus();
    await child.press('F2');
    await expect(tree.getByRole('textbox', { name: '标签名称' })).toHaveValue('NPC');
    await tree.getByRole('textbox', { name: '标签名称' }).fill('主角');
    await tree.getByRole('textbox', { name: '标签名称' }).press('Enter');
    await expect(tree.getByRole('treeitem', { name: '主角', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '折叠 角色', exact: true }).click();
    await parent.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新增子标签', exact: true }).click();
    await expect(tree.getByRole('treeitem', { name: '主角', exact: true })).toBeVisible();
    await tree.getByRole('textbox', { name: '标签名称' }).press('Escape');
    await expect(tree.getByRole('textbox', { name: '标签名称' })).toHaveCount(0);
    copyFileSync(source, path.join(root, '原位操作', 'fixture.png'));
    await page.getByRole('button', { name: '所有资产', exact: true }).click();
    const card = page.locator('[data-asset-id]').first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.context-menu-section-label').filter({ hasText: /^删除$/ })).toHaveCount(0);
    const trash = menu.getByRole('menuitem', { name: /^移入回收站/ });
    await expect(trash).toBeVisible();
    await expect(trash).not.toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: 'work/inline-sidebar-menu.png' });
    await trash.click();
    await expect(page.locator('[data-asset-id]')).toHaveCount(0);
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
