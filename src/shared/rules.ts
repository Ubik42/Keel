import { z } from "zod";

import { automationScriptCommandIdSchema } from "./automation-script-api";

/**
 * Rules (docs/进度.md 3.5): a rule is a script plus a manifest, stored as
 * files under `<library>/.keel/rules/<ruleId>/`. The database keeps only the
 * switch, the order and the run history.
 */
export const RULE_API_VERSION = 1;
export const RULES_DIRECTORY = "rules";
export const RULE_MANIFEST_FILE = "rule.json";
export const RULE_DEFAULT_SCRIPT = "rule.ts";

export const ruleTriggerSchema = z.discriminatedUnion("kind", [
  /** Only when run from the rule list, MCP or the command line. */
  z.strictObject({ kind: z.literal("manual") }),
  /** After an import into the library finishes. */
  z.strictObject({ kind: z.literal("after-import") }),
  /** After any change to the library: imports, edits, files changed on disk. */
  z.strictObject({ kind: z.literal("library-change") }),
  /** Every N minutes while the library is open. */
  z.strictObject({ kind: z.literal("schedule"), everyMinutes: z.number().int().min(5).max(7 * 24 * 60) }),
]);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

export const ruleScopeSchema = z.strictObject({
  /** Managed folder the rule works on; null for the whole library. */
  folderId: z.string().min(1).nullable(),
  recursive: z.boolean(),
});
export type RuleScope = z.infer<typeof ruleScopeSchema>;

export const ruleManifestSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(1000),
  trigger: ruleTriggerSchema,
  scope: ruleScopeSchema,
  /** Commands the script may call; any other command fails. */
  permissions: z.array(automationScriptCommandIdSchema).max(64),
  script: z.string().regex(/^[\w.-]+\.(ts|js)$/u),
  /** Set when the rule was converted from an automatic task (migration 63). */
  legacyTaskId: z.string().uuid().optional(),
});
export type RuleManifest = z.infer<typeof ruleManifestSchema>;

export const ruleRunStatusSchema = z.enum(["succeeded", "failed", "cancelled"]);
export const ruleRunTriggerSchema = z.enum(["manual", "after-import", "library-change", "schedule", "dry-run"]);

export const ruleRunChangeSchema = z.strictObject({
  commandId: z.string(),
  assetIds: z.array(z.string()).max(10_000),
  summary: z.string().max(500),
});

export const ruleRunSchema = z.strictObject({
  runId: z.string().uuid(),
  ruleId: z.string().uuid(),
  ruleVersion: z.string(),
  trigger: ruleRunTriggerSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  status: ruleRunStatusSchema,
  dryRun: z.boolean(),
  filesProcessed: z.number().int().nonnegative(),
  changes: z.array(ruleRunChangeSchema).max(500),
  output: z.array(z.string()).max(200),
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    line: z.number().int().positive().optional(),
  }).nullable(),
  historyEntryId: z.string().nullable(),
});
export type RuleRun = z.infer<typeof ruleRunSchema>;

export const ruleSummarySchema = z.strictObject({
  manifest: ruleManifestSchema,
  source: z.string(),
  /** sha256 of manifest + script, recorded with each run. */
  version: z.string(),
  enabled: z.boolean(),
  lastRun: ruleRunSchema.nullable(),
});
export type RuleSummary = z.infer<typeof ruleSummarySchema>;

/** A rule directory that could not be read; shown so the author can fix it. */
export const ruleProblemSchema = z.strictObject({
  directory: z.string(),
  message: z.string(),
});
export type RuleProblem = z.infer<typeof ruleProblemSchema>;

export const ruleLayoutSchema = z
  .strictObject({
    groups: z.array(z.strictObject({
      groupId: z.string().uuid(),
      name: z.string().trim().min(1).max(255),
      ruleIds: z.array(z.string().uuid()).max(10_000),
    })).max(200),
    ungroupedRuleIds: z.array(z.string().uuid()).max(10_000),
  })
  .refine((layout) => {
    const ids = [...layout.ungroupedRuleIds, ...layout.groups.flatMap((g) => g.ruleIds)];
    return new Set(ids).size === ids.length && new Set(layout.groups.map((g) => g.groupId)).size === layout.groups.length;
  }, "Rule and group identities must be unique");
export type RuleLayout = z.infer<typeof ruleLayoutSchema>;

export const ruleListResultSchema = z.strictObject({
  rules: z.array(ruleSummarySchema),
  /** Priority order: groups in order, then rules inside each group. */
  layout: ruleLayoutSchema,
  problems: z.array(ruleProblemSchema),
  rulesDirectory: z.string(),
});
export type RuleListResult = z.infer<typeof ruleListResultSchema>;

/** Rules in priority order (list order decides which runs first). */
export function rulesInPriorityOrder(result: RuleListResult): RuleSummary[] {
  const byId = new Map(result.rules.map((rule) => [rule.manifest.id, rule]));
  const ordered: RuleSummary[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const rule = byId.get(id);
    if (rule && !seen.has(id)) {
      seen.add(id);
      ordered.push(rule);
    }
  };
  for (const group of result.layout.groups) group.ruleIds.forEach(push);
  result.layout.ungroupedRuleIds.forEach(push);
  for (const rule of result.rules) push(rule.manifest.id);
  return ordered;
}

/** Migration 66. */
export const RULES_SQL = `
CREATE TABLE IF NOT EXISTS rule_state (
 rule_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_layout (
 id INTEGER PRIMARY KEY CHECK(id=1), layout_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_runs (
 run_id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, started_at TEXT NOT NULL, run_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_runs_rule ON rule_runs(rule_id, started_at DESC);
`;

/** Runs kept per rule; older ones are dropped when a run is recorded. */
export const RULE_RUNS_KEPT = 200;

/** Renderer → Main rule actions (one IPC channel, validated in Main). */
export const ruleIpcRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), libraryId: z.string().min(1) }),
  z.strictObject({ action: z.literal("set-enabled"), libraryId: z.string().min(1), ruleId: z.string().uuid(), enabled: z.boolean() }),
  z.strictObject({ action: z.literal("set-layout"), libraryId: z.string().min(1), layout: ruleLayoutSchema }),
  z.strictObject({ action: z.literal("run"), libraryId: z.string().min(1), ruleId: z.string().uuid(), dryRun: z.boolean() }),
  z.strictObject({ action: z.literal("history"), libraryId: z.string().min(1), ruleId: z.string().uuid() }),
  z.strictObject({ action: z.literal("delete"), libraryId: z.string().min(1), ruleId: z.string().uuid() }),
  z.strictObject({ action: z.literal("reveal"), libraryId: z.string().min(1), ruleId: z.string().uuid().nullable() }),
  z.strictObject({ action: z.literal("copy-for-ai"), libraryId: z.string().min(1), ruleId: z.string().uuid().nullable() }),
  z.strictObject({ action: z.literal("create"), libraryId: z.string().min(1), name: z.string().trim().min(1).max(120) }),
]);
export type RuleIpcRequest = z.infer<typeof ruleIpcRequestSchema>;

export type RuleIpcResult =
  | { ok: true; list?: RuleListResult; run?: RuleRun; runs?: RuleRun[] }
  | { ok: false; message: string };

/** The prompt "复制给 AI" puts on the clipboard. */
export function ruleAiPrompt(input: { rulesDirectory: string; rule: RuleSummary | null }): string {
  const lines = [
    `这是 Keel 资源库的规则目录：${input.rulesDirectory}`,
    `先读 ${input.rulesDirectory}/AGENTS.md（写法与约束）、keel-rule-api.d.ts（可用 API）和 rule.schema.json（清单格式）。`,
  ];
  if (input.rule) {
    const dir = `${input.rulesDirectory}/${input.rule.manifest.id}`;
    lines.push(
      `要修改的规则：${dir}`,
      `名称：${input.rule.manifest.name}`,
      `用途：${input.rule.manifest.purpose || "（未填写）"}`,
      "",
      "当前 rule.json：",
      "```json",
      JSON.stringify(input.rule.manifest, null, 2),
      "```",
      "",
      `当前 ${input.rule.manifest.script}：`,
      "```ts",
      input.rule.source.trimEnd(),
      "```",
    );
    if (input.rule.lastRun?.error) {
      lines.push("", `最近一次运行失败：${input.rule.lastRun.error.code} ${input.rule.lastRun.error.message}${input.rule.lastRun.error.line ? `（第 ${input.rule.lastRun.error.line} 行）` : ""}`);
    }
  } else {
    lines.push("要新建一条规则：在目录下新建 <UUID>/rule.json 与 rule.ts。");
  }
  lines.push("", "改完后用 rule.validate 和 rule.dry-run 检查；新规则默认关闭，由我在 Keel 中打开。");
  return lines.join("\n");
}
