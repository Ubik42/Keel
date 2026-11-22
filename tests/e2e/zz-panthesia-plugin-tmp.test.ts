// Temporary acceptance run for the Panthesia plugin (deleted after the run).
import { cpSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import {
  assetCard,
  chooseStandardOption,
  electronLaunchEnv,
  openAppSettingsDialog,
  openLinkedFolderImportMenu,
  openPluginAdvancedInstallDialog,
  openPluginSettingsTab,
  resolveElectronExecutablePath,
  waitForLibraryLoadingToFinish,
} from './electron-test-helpers';

test.describe.configure({ timeout: 300_000 });

const OUT = process.env.PANTHESIA_ACCEPT_OUT ?? tmpdir();
const SONGS = process.env.PANTHESIA_ACCEPT_SONGS ?? '';

test('panthesia plugin in keel', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'panthesia-keel-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  mkdirSync(sourceRoot);
  for (const name of readdirSync(SONGS)) copyFileSync(path.join(SONGS, name), path.join(sourceRoot, name));
  const packageDirectory = path.join(temporaryRoot, 'panthesia-plugin');
  cpSync('D:/Music/_tools/Panthesia/integrations/keel-plugin', packageDirectory, { recursive: true });
  const libraryName = 'Panthesia验收';

  const application = await electron.launch({
    args: [process.cwd()],
    cwd: process.cwd(),
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      KEEL_E2E: '1',
      KEEL_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      KEEL_E2E_CREATE_PARENT_PATH: temporaryRoot,
      KEEL_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, libraryName),
      KEEL_E2E_LINKED_SOURCE: sourceRoot,
      KEEL_E2E_PLUGIN_PACKAGE: packageDirectory,
      PANTHESIA_EXE: process.env.PANTHESIA_EXE ?? '',
    }),
  });
  const window = await application.firstWindow();
  const log: string[] = [];
  window.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  window.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  try {
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await waitForLibraryLoadingToFinish(window);

    const dialog = await openAppSettingsDialog(application, window);
    await openPluginSettingsTab(dialog);
    const installDialog = await openPluginAdvancedInstallDialog(window, dialog);
    await chooseStandardOption(installDialog.getByLabel('安装范围'), 'library');
    await installDialog.getByRole('button', { name: '安装文件夹' }).click();
    await expect(dialog.getByText(/Panthesia\s*-\s*v0\.2\.0/)).toBeVisible({ timeout: 30_000 });
    await dialog.locator('label.plugin-settings-enable-toggle').click({ force: true });
    await window.locator('#local-confirmation-dialog .ui-button--primary').click();
    await expect(dialog.getByRole('checkbox', { name: '启用插件' })).toBeChecked();
    await dialog.getByRole('button', { name: '关闭' }).click();

    await openLinkedFolderImportMenu(application, window);
    await expect(window.getByRole('button', { name: 'source', exact: true })).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'source', exact: true }).click();
    const song = 'oz BPM76.mid';
    await expect(assetCard(window, song)).toBeVisible({ timeout: 15_000 });

    await window.waitForTimeout(40_000);
    await window.screenshot({ path: path.join(OUT, 'keel-grid.png') });
    await assetCard(window, song).click();
    await window.waitForTimeout(3_000);
    await window.screenshot({ path: path.join(OUT, 'keel-inspector.png') });
    const open = window.getByRole('button', { name: '查看歌曲信息' });
    await open.click();
    await window.waitForTimeout(8_000);
    await window.screenshot({ path: path.join(OUT, 'keel-song-card.png') });
    for (const frame of window.frames()) {
      log.push(`FRAME ${frame.url()}`);
      log.push(String(await frame.evaluate(() => document.body?.innerText?.slice(0, 400)).catch((e) => `ERR ${e}`)));
    }
  } finally {
    writeFileSync(path.join(OUT, 'keel-console.txt'), log.join('\n'));
    await window.screenshot({ path: path.join(OUT, 'keel-final.png') }).catch(() => {});
    await application.close();
  }
});

