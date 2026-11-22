import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';

import type { RuleIpcRequest, RuleIpcResult, RuleManifest } from '../../src/shared/rules';
import { resolveElectronExecutablePath } from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';

test.describe.configure({ timeout: 120_000 });

const run = promisify(execFile);

test('the rule command line lists, validates and dry-runs rules through the running desktop', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'keel-rule-cli-e2e-'));
  const profile = path.join(root, 'profile');
  mkdirSync(profile);
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const executablePath = resolveElectronExecutablePath();
  const appArgs = process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory];
  const app = await electron.launch({
    executablePath,
    args: appArgs,
    cwd: directory,
    env: {
      ...process.env,
      KEEL_E2E: '1',
      KEEL_E2E_USER_DATA_PATH: profile,
      KEEL_E2E_CREATE_PARENT_PATH: root,
    },
  });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('命令行验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText('命令行验收', { exact: true }).first()).toBeVisible();

    const libraryId = await window.evaluate(async () => {
      const api = (globalThis as unknown as { keel: { library: { listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }> } } }).keel.library;
      return (await api.listOpen()).value![0]!.libraryId;
    });
    const created = await window.evaluate(
      (input) => (globalThis as unknown as { keel: { rules: { invoke(r: RuleIpcRequest): Promise<RuleIpcResult> } } }).keel.rules.invoke(input),
      { action: 'create', libraryId, name: '统计文件' } as RuleIpcRequest,
    );
    const list = created.ok ? created.list! : undefined;
    const rule = list!.rules.find((candidate) => candidate.manifest.name === '统计文件')!;
    const manifest: RuleManifest = { ...rule.manifest, trigger: { kind: 'manual' }, permissions: ['asset.search'] };
    const ruleDir = path.join(list!.rulesDirectory, rule.manifest.id);
    writeFileSync(path.join(ruleDir, 'rule.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(ruleDir, 'rule.ts'), [
      'const page = await keel.assets.search({ query: null, limit: 1 });',
      'console.log(`共 ${page.total} 个文件`);',
      'return page.total;',
      '',
    ].join('\n'));

    const cliEnv: NodeJS.ProcessEnv = { ...process.env, KEEL_USER_DATA_PATH: profile };
    delete cliEnv.ELECTRON_RUN_AS_NODE;
    const cli = async (...args: string[]) => {
      try {
        const { stdout } = await run(executablePath, [...appArgs, '--rule', ...args], {
          cwd: directory,
          env: cliEnv,
          timeout: 60_000,
        });
        return { code: 0, stdout };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return { code: failure.code ?? 1, stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
      }
    };

    // Enable the MCP server on a free port of its own (not the installed
    // Keel's), then start it.
    await window.evaluate(async (port) => {
      const api = (globalThis as unknown as { keel: { mcp: { request(input: unknown): Promise<unknown> } } }).keel.mcp;
      await api.request({ type: 'set-port', port });
      await api.request({ type: 'enable', enabled: true });
      await api.request({ type: 'start' });
    }, 41_000 + Math.floor(Math.random() * 2_000));
    // The desktop writes the launcher connection once its MCP server runs;
    // wait for it so the command line never starts a second desktop.
    await expect.poll(() => readdirSync(profile).includes('mcp-launcher.json'), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await cli('list')).stdout, { timeout: 30_000 }).toContain('统计文件');
    // A rule directory path works as well as the id.
    const validated = await cli('validate', ruleDir);
    expect(validated).toEqual({ code: 0, stdout: expect.stringContaining('检查通过') });
    const dryRun = await cli('dry-run', manifest.id, '--json');
    expect(dryRun.code).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({ status: 'succeeded', dryRun: true, output: ['"共 0 个文件"', '→ 0'] });
    const history = await cli('history', manifest.id);
    expect(history.stdout).toContain('dry-run');
    const usage = await cli('bogus');
    expect(usage.code).toBe(2);
    expect(usage.stdout).toContain('用法');
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
