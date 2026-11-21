import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import {
  assetCard as locateAssetCard,
  chooseStandardOption,
  resolveElectronExecutablePath,
} from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('uses the shared search and tag expressions to filter real asset cards', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-search-expression-e2e-'));
  const profilePath = path.join(temporaryRoot, 'user-data');
  const libraryName = '表达式验收库';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, 'hero.png');
  writeFileSync(sourcePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ));

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: profilePath,
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const assetCard = locateAssetCard(window, 'hero.png');
    await expect(assetCard).toBeVisible();

    const assetId = await assetCard.getAttribute('data-asset-id');
    if (!assetId) throw new Error('Expected the imported asset to have an id.');
    await window.evaluate(async (targetAssetId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        createTag(input: { libraryId: string; name: string }): Promise<{ ok: boolean; value?: { tagId: string } }>;
        assignTags(input: { libraryId: string; assetIds: string[]; tagIds: string[] }): Promise<{ ok: boolean }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error('No open library.');
      const role = await api.createTag({ libraryId, name: '角色' });
      const draft = await api.createTag({ libraryId, name: '临时' });
      if (!role.ok || !role.value || !draft.ok || !draft.value) throw new Error('Could not create tag fixtures.');
      const assigned = await api.assignTags({ libraryId, assetIds: [targetAssetId], tagIds: [role.value.tagId, draft.value.tagId] });
      if (!assigned.ok) throw new Error('Could not assign tag fixtures.');
    }, assetId);

    const searchBox = window.getByLabel('搜索资源库');
    await searchBox.fill('tag=角色 -tag=临时');
    await expect(assetCard).toHaveCount(0);
    await searchBox.fill('tag=角色');
    await expect(assetCard).toBeVisible();
    await expect.poll(() => window.evaluate(() => window.localStorage.getItem('serpent.search-history.v1'))).toContain('tag=角色');
    await searchBox.fill('tag=角');
    await expect(window.locator('.search-history-item').filter({ hasText: 'tag=角色' })).toBeVisible();
    await searchBox.evaluate((input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length));
    await searchBox.press('ArrowLeft');
    await expect.poll(() => searchBox.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
    await searchBox.press('ArrowRight');
    await expect.poll(() => searchBox.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(5);
    await searchBox.press('ArrowDown');
    await expect(searchBox).toHaveAttribute('aria-activedescendant', 'search-history-0');
    await searchBox.press('ArrowLeft');
    await expect(searchBox).not.toHaveAttribute('aria-activedescendant', /search-history-/);
    await searchBox.fill('');

    await window.getByRole('button', { name: '标签', exact: true }).click();
    const tagPanel = window.getByRole('dialog');
    const expression = tagPanel.getByRole('textbox', { name: '标签条件' });
    await expect(expression).toBeVisible();
    await expect(tagPanel.getByRole('button', { name: '标签条件语法' })).toHaveAttribute('data-hover-tip-variant', 'search-syntax');
    await expect(tagPanel.getByRole('textbox')).toHaveCount(1);
    await expression.fill('角');
    await tagPanel.getByRole('button', { name: /角色/ }).click();
    await expect(expression).toHaveValue('"角色" ');
    await expect(assetCard).toBeVisible();
    await tagPanel.locator('.filter-tag-options button').filter({ hasText: '临时' }).click({ button: 'right' });
    await expect(expression).toHaveValue('"角色" -"临时" ');
    await expect(assetCard).toHaveCount(0);
    await expression.fill('角色');
    await expect(assetCard).toBeVisible();
    await window.getByRole('button', { name: '选择标签' }).click();
    await expect(window.getByRole('textbox', { name: '标签过滤' })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('organizes, finds, trashes, and restores an imported asset through the UI', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-organization-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'hero.png');
  const libraryName = '组织搜索验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, Buffer.from('hero-image-content'));

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_E2E_TRASH_DELAY_MS: '750',
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const assetCard = locateAssetCard(window, 'hero.png');
    await expect(assetCard).toBeVisible();
    const assetId = await assetCard.getAttribute('data-asset-id');
    expect(assetId).toBeTruthy();
    const readMetadataVersion = () => window.evaluate(async (selectedAssetId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<{
          ok: boolean;
          value?: { entityVersion: number };
        }>;
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId || !selectedAssetId) throw new Error('No selected asset');
      const metadata = await api.getAssetMetadata({ libraryId, assetId: selectedAssetId });
      return metadata.value?.entityVersion ?? -1;
    }, assetId);
    async function readStableMetadataVersion(): Promise<number> {
      let previousVersion = -1;
      let stableVersion = -1;
      await expect
        .poll(async () => {
          const currentVersion = await readMetadataVersion();
          const isStable = currentVersion === previousVersion;
          previousVersion = currentVersion;
          if (isStable) stableVersion = currentVersion;
          return isStable ? currentVersion : -1;
        })
        .toBeGreaterThanOrEqual(0);
      return stableVersion;
    }

    // The sidebar no longer enumerates or creates tags (REQ-TAG-001); seed
    // the tags through the library API, then use the explicit refresh command
    // because large-library scope navigation intentionally skips sidebar
    // queries.
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        createTag(input: { libraryId: string; name: string }): Promise<{ ok: boolean }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      for (const name of ['角色', '临时']) {
        const created = await api.createTag({ libraryId, name });
        if (!created.ok) throw new Error(`Could not create tag ${name}`);
      }
    });
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await window.getByRole('button', { name: '所有资产', exact: true }).click();

    await expect(assetCard).toBeVisible();

    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '角色' }).click();
    const notice = window.locator('.workspace-notice-item').first();
    await expect(notice).toContainText('标签已添加');
    await expect
      .poll(async () => (await notice.boundingBox())?.height ?? Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(56);
    await expect
      .poll(async () => (await notice.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(280);
    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '临时' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('标签已添加');

    // The sidebar no longer enumerates tags (REQ-TAG-001); enter the
    // tag-filtered view through the retained 标签过滤 entry instead.
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('角色');
    await window.getByRole("option", { name: /角色/ }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    // Close the tag dimension before continuing with other discovery controls.
    await window.getByRole('button', { name: '标签', exact: true }).click();

    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();

    await locateAssetCard(window, 'hero.png').click();
    await window.getByRole('button', { name: '4 星' }).click();
    await expect.poll(readMetadataVersion).toBe(1);
    await window.getByRole('button', { name: '标记喜欢' }).click();
    await expect.poll(readMetadataVersion).toBe(2);

    const descriptionInput = window.getByLabel('描述');
    const sourceUrlInput = window.getByRole('textbox', {
      name: '源链接',
      exact: true,
    });
    await descriptionInput.fill('待清空描述');
    await descriptionInput.blur();
    await expect.poll(readMetadataVersion).toBe(3);
    await sourceUrlInput.fill('javascript:alert(1)');
    await sourceUrlInput.press('Enter');
    await expect(window.getByText('保存源链接失败。原因：请输入不含账号密码的 HTTP(S) 完整链接。')).toBeVisible();
    await expect.poll(readMetadataVersion).toBe(3);
    await sourceUrlInput.fill('https://example.com/source');
    await sourceUrlInput.press('Enter');
    await expect.poll(readMetadataVersion).toBe(4);

    await descriptionInput.fill('');
    await descriptionInput.blur();
    await expect.poll(readMetadataVersion).toBeGreaterThan(4);
    const versionAfterDescriptionClear = await readMetadataVersion();
    await sourceUrlInput.fill('');
    await sourceUrlInput.press('Enter');
    await expect.poll(readMetadataVersion).toBeGreaterThan(versionAfterDescriptionClear);
    const versionAfterSourceClear = await readStableMetadataVersion();
    const clearedMetadata = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listAssets(input: { libraryId: string; folderId?: string; recursive: boolean }): Promise<{ ok: boolean; value?: Array<{ assetId: string }> }>;
        getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<{ ok: boolean; value?: { description: string | null; sourcePageUrl: string | null } }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const assets = await api.listAssets({ libraryId, recursive: true });
      const assetId = assets.value?.[0]?.assetId;
      if (!assetId) throw new Error('No imported asset');
      const metadata = await api.getAssetMetadata({ libraryId, assetId });
      return metadata.value;
    });
    expect(clearedMetadata).toMatchObject({ description: null, sourcePageUrl: null });
    // Leaving the description field and clicking a rating are one user gesture.
    // Both saves must be serialized locally instead of racing with the same version.
    const versionBeforeRapidEdit = versionAfterSourceClear;
    await descriptionInput.fill('快速连续修改的描述');
    await window.getByRole('button', { name: '5 星' }).click();
    // Description blur and the rating click are one gesture. Both commits must
    // land, a repeated identical write must not consume a third version, and
    // the two saves must not surface a version conflict.
    await expect.poll(async () => {
      const version = await readMetadataVersion();
      const metadata = await window.evaluate(async (selectedAssetId) => {
        const api = (globalThis as typeof globalThis & { serpent: { library: {
          getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<{
            ok: boolean;
            value?: { description: string | null; rating: number };
          }>;
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        } } }).serpent.library;
        const open = await api.listOpen();
        const libraryId = open.value?.[0]?.libraryId;
        if (!libraryId || !selectedAssetId) throw new Error('No selected asset');
        const result = await api.getAssetMetadata({ libraryId, assetId: selectedAssetId });
        return result.value ?? null;
      }, assetId);
      return {
        versionDelta: version - versionBeforeRapidEdit,
        description: metadata?.description ?? null,
        rating: metadata?.rating ?? null,
        conflict: await window.getByText('版本冲突', { exact: true }).count(),
      };
    }).toEqual({
      versionDelta: 2,
      description: '快速连续修改的描述',
      rating: 5,
      conflict: 0,
    });

    // Search description text (not the filename) so the snippet line adds
    // context instead of duplicating the primary display name.
    await window.getByLabel('搜索资源库').fill('快速连续');
    await window.getByRole('button', { name: '更多', exact: true }).click();
    await chooseStandardOption(window.getByLabel('喜欢过滤'), 'yes');
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('临时');
    await window.getByRole("option", { name: /临时/ }).click();
    // Search auto-runs on debounce (no 「搜索」 button since c60d890); the
    // auto-search is intentionally silent (Serpent-huvw), so assert on results.
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    await expect(window.locator('.search-snippet')).toBeVisible();
    await expect(window.locator('.search-snippet mark').first()).toBeVisible();

    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    // Let the earlier toast fade so the trash toast below is the
    // current .workspace-notice (the banner is a single reused element).
    await window.waitForFunction(
      () => !document.querySelector('.workspace-notice'),
      { timeout: 10_000 },
    ).catch(() => undefined);
    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    // Serpent-a711e8: Main delays the real asset.trash IPC request in this
    // E2E-only launch, proving that the visible card disappears before the
    // durable Worker mutation resolves. The frozen preload API is never
    // mutated by the test.
    const deletionStartedAt = Date.now();
    await window.getByRole('menuitem', { name: '移入回收站' }).click();
    await expect(locateAssetCard(window, 'hero.png')).toHaveCount(0, { timeout: 600 });
    expect(Date.now() - deletionStartedAt).toBeLessThan(600);
    await expect(window.locator('.workspace-notice')).toContainText('1 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '恢复' }).click();
    const restoreDialog = window.getByRole('dialog');
    await window.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]'))
      || document.querySelector('.workspace-notice')?.textContent?.includes('已恢复'));
    if (await restoreDialog.count()) {
      await chooseStandardOption(restoreDialog.getByLabel('恢复位置'), 'original');
      await chooseStandardOption(restoreDialog.getByLabel('同名冲突'), 'keep-both');
      await restoreDialog.getByRole('button', { name: '确认恢复' }).click();
    }
    await expect(window.locator('.workspace-notice')).toContainText('已恢复 1 项资产');
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('multi-select performs batch organization, trash, restore, and permanent delete', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-batch-organization-e2e-'));
  const firstSource = path.join(temporaryRoot, 'first.txt');
  const secondSource = path.join(temporaryRoot, 'second.txt');
  writeFileSync(firstSource, 'first');
  writeFileSync(secondSource, 'second');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [firstSource, secondSource].join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    const additiveModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill('批量组织验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    // The sidebar no longer creates tags (REQ-TAG-001); seed the tag through
    // the library API, then refresh the sidebar summaries explicitly.
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        createTag(input: { libraryId: string; name: string }): Promise<{ ok: boolean }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const created = await api.createTag({ libraryId, name: '批量标签' });
      if (!created.ok) throw new Error('Could not create tag 批量标签');
    });
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    // Refreshing the library can briefly replace the current result set while
    // the worker reconciles the imported files. Wait for both cards before
    // the batch selection.
    await expect(window.locator('.asset-card')).toHaveCount(2, { timeout: 15_000 });
    await expect(locateAssetCard(window, 'first.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'second.txt')).toBeVisible();

    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click on an already-selected asset to open multi-asset context menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '批量标签' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已为 2 项资产添加标签');

    const counts = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listTags(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; assetCount: number }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const tags = await api.listTags({ libraryId });
      return { tag: tags.value?.find((tag) => tag.name === '批量标签')?.assetCount };
    });
    expect(counts).toEqual({ tag: 2 });

    const searchRequestCount = () => window.evaluate(() => (
      globalThis as typeof globalThis & {
        serpent: { e2e: { getRequestCount(type: 'asset.search.request'): number } };
      }
    ).serpent.e2e.getRequestCount('asset.search.request'));
    const tagSearchCount = await searchRequestCount();
    // The sidebar no longer enumerates tags (REQ-TAG-001); enter the
    // tag-filtered view through the retained 标签过滤 entry instead.
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('批量标签');
    await window.getByRole("option", { name: /批量标签/ }).click();
    await expect.poll(searchRequestCount).toBeGreaterThan(tagSearchCount);
    await expect(window.getByText('正在同步资源库…')).toHaveCount(0);
    // Flush search-result toast before opening context menu
    await window.waitForFunction(
      () => !document.querySelector('.workspace-notice'),
      { timeout: 10_000 },
    );
    // Multi-select first
    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click on first asset to open multi-asset menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移除标签…' }).click();
    await window.getByRole('option', { name: '批量标签' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已为 2 项资产移除标签');
    await expect
      .poll(() => window.locator('.asset-card').count(), { timeout: 15_000 })
      .toBe(0);
    // Clear the tag chip before returning to the library-wide scope.
    await window.getByRole('button', { name: '全部清除' }).click();
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(locateAssetCard(window, 'first.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'second.txt')).toBeVisible();

    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click to open multi-asset context menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    const trashMenuItem = window.getByRole('menuitem', {
      name: /移入回收站（2 项）/,
    });
    await expect(trashMenuItem).toBeVisible({ timeout: 15_000 });
    // Electron's test viewport can retain the menu's pre-resize hit box even
    // after its visible surface is clamped; invoke the same DOM action without
    // making the command depend on that transient geometry.
    await trashMenuItem.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(window.locator('.workspace-notice')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /恢复所选（2 项）/ }).click();
    const batchRestoreDialog = window.getByRole('dialog');
    await window.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]'))
      || document.querySelector('.workspace-notice')?.textContent?.includes('已恢复'));
    if (await batchRestoreDialog.count()) {
      await chooseStandardOption(batchRestoreDialog.getByLabel('恢复位置'), 'root');
      await chooseStandardOption(batchRestoreDialog.getByLabel('同名冲突'), 'skip');
      await batchRestoreDialog.getByRole('button', { name: '确认恢复' }).click();
    }
    await expect(window.locator('.workspace-notice')).toContainText('已恢复 2 项资产');
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window
      .getByRole('menuitem', { name: /移入回收站（2 项）/ })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(window.locator('.workspace-notice')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /永久删除（2 项）/ }).click();
    const permanentDeleteDialog = window.getByRole('dialog', { name: '永久删除这些回收站资产？' });
    await expect(permanentDeleteDialog).toBeVisible({ timeout: 10_000 });
    await permanentDeleteDialog
      .getByRole('button', { name: '永久删除', exact: true })
      .click();
    await expect(window.locator('.workspace-notice')).toContainText('已永久删除 2 项');
    await expect(window.locator('.asset-card')).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('critical confirmation windows focus cancel and require red confirmation', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-dialog-focus-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'focus.txt');
  writeFileSync(sourcePath, 'focus target');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill('对话框焦点验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const asset = locateAssetCard(window, 'focus.txt');
    await expect(asset).toBeVisible();

    await asset.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移入回收站' }).click();
    await window.getByRole('button', { name: /回收站/ }).click();
    const trashedAsset = locateAssetCard(window, 'focus.txt');
    await expect(trashedAsset).toBeVisible();
    await trashedAsset.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '永久删除' }).click();
    const criticalDialog = window.getByRole('dialog', { name: '永久删除这些回收站资产？' });
    await expect(criticalDialog).toBeVisible({ timeout: 10_000 });
    await expect(
      criticalDialog.getByRole('button', { name: '取消', exact: true }),
    ).toBeFocused();
    await expect(criticalDialog.locator('button.ui-button--danger')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(criticalDialog).toBeHidden();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
