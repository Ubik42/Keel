import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

test('tag browsing clears on folder navigation while pinned tags remain scoped', async () => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-tag-pin-'));
  const directory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({ executablePath: resolveElectronExecutablePath(),
    args: process.env.SERPENT_E2E_ELECTRON_EXECUTABLE ? [] : [directory], cwd: directory,
    env: { ...process.env, SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: path.join(root, 'profile'), SERPENT_E2E_CREATE_PARENT_PATH: root } });
  try {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, root);
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('固定标签测试');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('固定标签测试', { exact: true }).first()).toBeVisible();
    const folder = path.join(root, '固定标签测试', '目标');mkdirSync(folder);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>';
    writeFileSync(path.join(folder, '带标签.svg'), svg);
    writeFileSync(path.join(folder, '普通.svg'), svg);
    const panel=window.getByRole('region',{name:'标签',exact:true});
    const tree=panel.getByRole('tree',{name:'标签',exact:true});
    await panel.getByRole('button',{name:'新建标签',exact:true}).click();
    await panel.getByRole('textbox',{name:'标签名称',exact:true}).fill('父标签');
    await panel.getByRole('button',{name:'保存',exact:true}).click();
    const parent=tree.getByRole('treeitem',{name:'父标签',exact:true});
    await parent.click({button:'right'});
    await window.getByRole('menuitem',{name:'新增子标签',exact:true}).click();
    await panel.getByRole('textbox',{name:'标签名称',exact:true}).fill('子标签');
    await panel.getByRole('button',{name:'保存',exact:true}).click();
    const child=tree.getByRole('treeitem',{name:'子标签',exact:true});
    await expect(child).toBeVisible();
    await expect(tree.locator('.tag-tree-guide')).toHaveCount(1);
    await expect.poll(async () => window.evaluate(async () => {
      const api=(globalThis as typeof globalThis & {serpent:{library:SerpentLibraryApi}}).serpent.library;
      const open=await api.listOpen();if(!open.ok)return 0;
      const assets=await api.listAssets({libraryId:open.value[0]!.libraryId,recursive:true});
      return assets.ok ? assets.value.length : 0;
    }), {timeout:20000}).toBe(2);
    const assetId=await window.evaluate(async()=>{
      const api=(globalThis as typeof globalThis & {serpent:{library:SerpentLibraryApi}}).serpent.library;
      const open=await api.listOpen();if(!open.ok)throw Error('No library');
      const assets=await api.listAssets({libraryId:open.value[0]!.libraryId,recursive:true});
      if(!assets.ok)throw Error('No assets');return assets.value.find(a=>a.displayName==='带标签.svg')!.assetId;
    });
    const transfer=await window.evaluateHandle(id=>{const d=new DataTransfer();d.setData('application/x-serpent-managed-assets',JSON.stringify([id]));return d;},assetId);
    await child.dispatchEvent('dragover',{dataTransfer:transfer});await child.dispatchEvent('drop',{dataTransfer:transfer});
    await expect(parent.locator('.nav-count')).toHaveText('1');
    const folderRow=window.locator('.navigation-pane button.nav-row[data-nav-folder-kind="managed"][data-hover-tip="目标"]');
    const grid=window.locator('.asset-grid');
    await parent.click();
    await expect(grid.getByText('带标签.svg',{exact:true}).first()).toBeVisible();
    await expect(grid.getByText('普通.svg',{exact:true})).toHaveCount(0);
    await folderRow.click();
    await expect(grid.getByText('普通.svg',{exact:true}).first()).toBeVisible();
    await expect(parent).toHaveAttribute('aria-selected','false');
    await panel.getByRole('button',{name:'固定标签过滤：父标签',exact:true}).click();
    await expect(panel.getByRole('button',{name:'取消固定标签过滤：父标签',exact:true})).toHaveAttribute('aria-pressed','true');
    await folderRow.click();
    await expect(grid.getByText('带标签.svg',{exact:true}).first()).toBeVisible();
    await expect(grid.getByText('普通.svg',{exact:true})).toHaveCount(0);
    await window.screenshot({path:test.info().outputPath('pinned-tag-folder.png')});
    await panel.getByRole('button',{name:'取消固定标签过滤：父标签',exact:true}).click();
    await expect(grid.getByText('普通.svg',{exact:true}).first()).toBeVisible();
  } finally {await app.close();removePathWithSyncRetry(root);}
});
