import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { KeelMcpHostTool } from '../mcp/create-keel-mcp-server';
import { automationScriptCommandIdSchema } from '../shared/automation-script-api';
import { RULE_MANIFEST_FILE, ruleManifestSchema, type RuleRun } from '../shared/rules';
import type { RuleRunner } from './rule-runner';
import type { LibraryWorkerClient } from './worker-client';

const libraryRule = {
  type: 'object',
  properties: {
    libraryId: { type: 'string', description: 'Open library id (keel_library_list_open).' },
    ruleId: { type: 'string', description: 'Rule id: the directory name under .keel/rules.' },
  },
  required: ['libraryId', 'ruleId'],
  additionalProperties: false,
} as const;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function runView(run: RuleRun | undefined) {
  if (!run) throw new Error('Rule not found in this library.');
  return run;
}

/**
 * MCP tools for rules (docs/进度.md 3.5): validate, dry-run, run, history,
 * enable / disable. Rules themselves are files the agent edits directly.
 */
export function createRuleMcpTools(options: {
  ruleRunner(): RuleRunner | undefined;
  workerClient(): LibraryWorkerClient | undefined;
}): KeelMcpHostTool[] {
  const runner = () => {
    const value = options.ruleRunner();
    if (!value) throw new Error('The rule runner is not ready.');
    return value;
  };
  const worker = () => {
    const value = options.workerClient();
    if (!value) throw new Error('The library worker is not ready.');
    return value;
  };
  const setEnabled = async (args: Record<string, unknown>, enabled: boolean) => {
    const response = await worker().request({ type: 'rule.set-enabled', libraryId: text(args.libraryId, 'libraryId'), ruleId: text(args.ruleId, 'ruleId'), enabled });
    if (!response.ok) throw new Error(response.error.code);
    return { ruleId: args.ruleId, enabled };
  };
  return [
    {
      name: 'keel_rule_list',
      description: 'List the rules of a library in priority order, with switch, trigger and last run. Also returns the rules directory; read AGENTS.md there before writing a rule.',
      inputSchema: { type: 'object', properties: { libraryId: libraryRule.properties.libraryId }, required: ['libraryId'], additionalProperties: false },
      readOnly: true,
      async call(args) {
        const list = await runner().listRules(text(args.libraryId, 'libraryId'));
        if (!list) throw new Error('Rules are not available for this library.');
        return {
          rulesDirectory: list.rulesDirectory,
          guide: path.join(list.rulesDirectory, 'AGENTS.md'),
          problems: list.problems,
          rules: list.rules.map((rule) => ({
            id: rule.manifest.id,
            name: rule.manifest.name,
            purpose: rule.manifest.purpose,
            trigger: rule.manifest.trigger,
            enabled: rule.enabled,
            version: rule.version,
            lastRun: rule.lastRun && { status: rule.lastRun.status, finishedAt: rule.lastRun.finishedAt, error: rule.lastRun.error },
          })),
        };
      },
    },
    {
      name: 'keel_rule_validate',
      description: 'Check a rule: rule.json against the schema, permission names, and the script for TypeScript syntax errors. Does not run it.',
      inputSchema: libraryRule,
      readOnly: true,
      async call(args) {
        const libraryId = text(args.libraryId, 'libraryId');
        const ruleId = text(args.ruleId, 'ruleId');
        const list = await runner().listRules(libraryId);
        if (!list) throw new Error('Rules are not available for this library.');
        const problems: string[] = [];
        const directory = path.join(list.rulesDirectory, ruleId);
        let manifestJson: unknown;
        try {
          manifestJson = JSON.parse(readFileSync(path.join(directory, RULE_MANIFEST_FILE), 'utf8'));
        } catch (error) {
          return { ok: false, problems: [`rule.json: ${error instanceof Error ? error.message : String(error)}`] };
        }
        const manifest = ruleManifestSchema.safeParse(manifestJson);
        if (!manifest.success) {
          for (const issue of manifest.error.issues) problems.push(`rule.json ${issue.path.join('.') || '(root)'}: ${issue.message}`);
          const permissions = (manifestJson as { permissions?: unknown }).permissions;
          if (Array.isArray(permissions)) {
            for (const permission of permissions) {
              if (!automationScriptCommandIdSchema.safeParse(permission).success) problems.push(`unknown permission: ${String(permission)}`);
            }
          }
          return { ok: false, problems };
        }
        if (manifest.data.id !== ruleId) problems.push('rule.json id must equal the directory name.');
        try {
          const source = readFileSync(path.join(directory, manifest.data.script), 'utf8');
          // TypeScript is loaded only for validation.
          const { transpileQuickJsSandboxPrototypeSource } = await import('../scripting/quickjs-sandbox-prototype');
          transpileQuickJsSandboxPrototypeSource(`const rule = {};\n${source}`, manifest.data.script);
        } catch (error) {
          problems.push(`${manifest.data.script}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { ok: problems.length === 0, problems };
      },
    },
    {
      name: 'keel_rule_dry_run',
      description: 'Run a rule without writing: read commands run, write commands return { dryRun: true } and are listed as planned changes. Returns the run record.',
      inputSchema: libraryRule,
      readOnly: true,
      async call(args) {
        return runView(await runner().run({ libraryId: text(args.libraryId, 'libraryId'), ruleId: text(args.ruleId, 'ruleId'), reason: 'dry-run', interactive: false }));
      },
    },
    {
      name: 'keel_rule_run',
      description: 'Run a rule once now, whether or not it is enabled. A new or edited rule must be confirmed once in the Keel window first; until then this returns NEEDS_CONFIRMATION.',
      inputSchema: libraryRule,
      readOnly: false,
      async call(args) {
        return runView(await runner().run({ libraryId: text(args.libraryId, 'libraryId'), ruleId: text(args.ruleId, 'ruleId'), reason: 'manual', interactive: false }));
      },
    },
    {
      name: 'keel_rule_history',
      description: 'Recent runs of a rule: time, trigger, files processed, changes, log output and error with line.',
      inputSchema: { ...libraryRule, properties: { ...libraryRule.properties, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
      readOnly: true,
      async call(args) {
        const response = await worker().request({
          type: 'rule.runs.list',
          libraryId: text(args.libraryId, 'libraryId'),
          ruleId: text(args.ruleId, 'ruleId'),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        });
        if (!response.ok || response.type !== 'rule.runs.result') throw new Error('Could not read the run history.');
        return { runs: response.runs };
      },
    },
    {
      name: 'keel_rule_enable',
      description: 'Switch a rule on. Automatic triggers still wait until this version of the rule has been confirmed once in the Keel window.',
      inputSchema: libraryRule,
      readOnly: false,
      call: (args) => setEnabled(args, true),
    },
    {
      name: 'keel_rule_disable',
      description: 'Switch a rule off.',
      inputSchema: libraryRule,
      readOnly: false,
      call: (args) => setEnabled(args, false),
    },
  ];
}
