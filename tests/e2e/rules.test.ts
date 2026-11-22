import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

import type { RuleIpcRequest, RuleIpcResult, RuleManifest } from '../../src/shared/rules';
import { importFilesThroughBridge, resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

test.describe.configure({ timeout: 120_000 });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('a rule written as files dry-runs, runs after confirmation and reacts to library changes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'keel-rules-e2e-'));
  const sources = path.join(root, 'sources');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(sources);
  const first = path.join(sources, 'first.png');
  writeFileSync(first, PNG);
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory],
    cwd: directory,
    env: {
      ...process.env,
      KEEL_E2E: '1',
      KEEL_E2E_AUTOMATION_CONFIRM: '1',
      KEEL_E2E_USER_DATA_PATH: path.join(root, 'profile'),
      KEEL_E2E_CREATE_PARENT_PATH: root,
      KEEL_E2E_IMPORT_FILES: first,
    },
  });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('规则验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('规则验收', { exact: true }).first()).toBeVisible();
    await importFilesThroughBridge(window);

    const invoke = (request: RuleIpcRequest) => window.evaluate(
      (input) => (globalThis as unknown as { keel: { rules: { invoke(r: RuleIpcRequest): Promise<RuleIpcResult> } } }).keel.rules.invoke(input),
      request,
    );
    const libraryId = await window.evaluate(async () => {
      const api = (globalThis as unknown as { keel: { library: { listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }> } } }).keel.library;
      return (await api.listOpen()).value![0]!.libraryId;
    });
    const tagCount = () => window.evaluate(async (id) => {
      const api = (globalThis as unknown as { keel: { library: { listTags(i: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; assetCount: number }> }> } } }).keel.library;
      const tags = await api.listTags({ libraryId: id });
      return tags.value?.find((tag) => tag.name === 'PNG')?.assetCount ?? 0;
    }, libraryId);

    // The sidebar shows the (empty) rule list, then a new rule.
    await expect(window.getByRole('region', { name: '规则列表' })).toBeVisible();
    const created = await invoke({ action: 'create', libraryId, name: '给 PNG 加标签' });
    expect(created.ok).toBe(true);
    const list = created.ok ? created.list! : undefined;
    const rule = list!.rules.find((r) => r.manifest.name === '给 PNG 加标签')!;
    expect(rule.enabled).toBe(false);
    await expect(window.getByRole('button', { name: '给 PNG 加标签', exact: true })).toBeVisible();

    // An AI edits the rule files.
    const manifest: RuleManifest = {
      ...rule.manifest,
      purpose: '为 PNG 图片补加 PNG 标签',
      trigger: { kind: 'library-change' },
      permissions: ['asset.search', 'tag.list', 'tag.create', 'tag.assign'],
    };
    const ruleDir = path.join(list!.rulesDirectory, rule.manifest.id);
    writeFileSync(path.join(ruleDir, 'rule.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(ruleDir, 'rule.ts'), [
      'const page = await keel.assets.search({ query: "name:.png", scope: rule.scope, limit: 200 });',
      'const tags = await keel.tags.list({ limit: 200 });',
      'let tag = tags.items.find((t) => t.name === "PNG");',
      'if (!tag) tag = await keel.tags.create("PNG");',
      'if (page.items.length && tag && !rule.dryRun) await keel.tags.assign(page.items.map((a) => a.id), [tag.id]);',
      'console.log(`png: ${page.items.length}`);',
      'return { png: page.items.length };',
      '',
    ].join('\n'));

    const dry = await invoke({ action: 'run', libraryId, ruleId: rule.manifest.id, dryRun: true });
    expect(dry.ok && dry.run?.status).toBe('succeeded');
    expect(dry.ok && dry.run?.dryRun).toBe(true);
    expect(dry.ok && dry.run?.changes.map((c) => c.commandId)).toContain('tag.create');
    expect(await tagCount()).toBe(0);

    const real = await invoke({ action: 'run', libraryId, ruleId: rule.manifest.id, dryRun: false });
    expect(real.ok && real.run?.status).toBe('succeeded');
    expect(real.ok && real.run?.output.join('\n')).toContain('png: 1');
    await expect.poll(tagCount).toBe(1);

    // Switched on, the rule runs again when a file appears in the library.
    await invoke({ action: 'set-enabled', libraryId, ruleId: rule.manifest.id, enabled: true });
    copyFileSync(first, path.join(root, '规则验收', 'second.png'));
    await expect.poll(tagCount, { timeout: 30_000 }).toBe(2);

    const history = await invoke({ action: 'history', libraryId, ruleId: rule.manifest.id });
    expect(history.ok && history.runs!.map((run) => run.trigger)).toEqual(expect.arrayContaining(['dry-run', 'manual', 'library-change']));
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
