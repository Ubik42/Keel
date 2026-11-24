import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

import { pathToFileURL } from 'node:url';

import type { connectKeel as ConnectKeel } from '../../tools/keel-api/keel-api.mjs';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

test.describe.configure({ timeout: 180_000 });

const FILE_COUNT = 300;

// Playwright compiles tests to CommonJS; load the ES module client natively.
const loadClient = new Function('url', 'return import(url)') as (url: string) => Promise<{ connectKeel: typeof ConnectKeel }>;

test('the local API imports and edits assets in batches through the running desktop', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'keel-local-api-e2e-'));
  const profile = path.join(root, 'profile');
  const source = path.join(root, 'source');
  mkdirSync(profile);
  mkdirSync(source);
  for (let index = 0; index < FILE_COUNT; index += 1) {
    const hue = (index * 37) % 360;
    writeFileSync(
      path.join(source, `item-${String(index).padStart(3, '0')}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="hsl(${hue},70%,50%)"/><!-- ${index} --></svg>`,
    );
  }
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory],
    cwd: directory,
    env: { ...process.env, KEEL_E2E: '1', KEEL_E2E_USER_DATA_PATH: profile, KEEL_E2E_CREATE_PARENT_PATH: root },
  });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('本机接口验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('本机接口验收', { exact: true }).first()).toBeVisible();
    await window.evaluate(async (port) => {
      const api = (globalThis as unknown as { keel: { mcp: { request(input: unknown): Promise<unknown> } } }).keel.mcp;
      await api.request({ type: 'set-port', port });
      await api.request({ type: 'enable', enabled: true });
      await api.request({ type: 'start' });
    }, 43_000 + Math.floor(Math.random() * 2_000));
    await expect.poll(() => readdirSync(profile).includes('mcp-launcher.json'), { timeout: 30_000 }).toBe(true);

    const { connectKeel } = await loadClient(pathToFileURL(path.resolve('tools/keel-api/keel-api.mjs')).href);
    const keel = await connectKeel({ profile });
    try {
      const libraries = await keel.call<{ libraries: Array<{ libraryId: string }> }>('keel_library_list_open');
      const libraryId = libraries.libraries[0]!.libraryId;
      const timings: Record<string, number> = {};
      const time = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
        const started = performance.now();
        const value = await run();
        timings[label] = Math.round(performance.now() - started);
        return value;
      };

      const paths = readdirSync(source).map((name) => path.join(source, name));
      const imported = await time('import', () => keel.call<{ completion: { importedCount: number; assets: Array<{ assetId: string }> } }>('keel_file_import', {
        libraryId, sourceKind: 'files', sourcePaths: paths,
      }));
      expect(imported.completion.importedCount).toBe(FILE_COUNT);
      const assetIds = imported.completion.assets.map((asset) => asset.assetId);
      expect(assetIds).toHaveLength(FILE_COUNT);

      const tag = await keel.call<{ id: string }>('keel_tag_create', { libraryId, name: '本机接口' });
      await time('tag-assign-batch', () => keel.call('keel_tag_assign', { libraryId, assetIds, tagIds: [tag.id] }));
      // One call per asset, sent concurrently over one connection.
      await time('rating-per-asset', () => Promise.all(
        assetIds.map((assetId, index) => keel.call('keel_asset_rating_set', { libraryId, assetIds: [assetId], rating: (index % 5) + 1 })),
      ));
      await time('search-x100', async () => {
        for (let index = 0; index < 100; index += 1) await keel.call('keel_asset_search', { libraryId, query: null, limit: 1 });
      });

      const tagged = await keel.call<{ total: number }>('keel_asset_search', {
        libraryId, query: null, limit: 1, filters: [{ field: 'tag', values: ['本机接口'], exclude: false }],
      });
      expect(tagged.total).toBe(FILE_COUNT);
      console.log('local-api timings (ms)', JSON.stringify(timings));
    } finally {
      await keel.close();
    }
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
