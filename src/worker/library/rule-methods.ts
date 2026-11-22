import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { automaticTaskConfigSchema, automaticTaskLayoutSchema } from "../../shared/automatic-tasks";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import {
  RULE_DEFAULT_SCRIPT,
  RULE_MANIFEST_FILE,
  RULE_RUNS_KEPT,
  RULE_CHANGED_ASSETS_BATCH,
  RULES_DIRECTORY,
  ruleLayoutSchema,
  ruleManifestSchema,
  ruleRunSchema,
  type RuleChangeCursor,
  type RuleLayout,
  type RuleScope,
  type RuleListResult,
  type RuleManifest,
  type RuleProblem,
  type RuleRun,
  type RuleSummary,
} from "../../shared/rules";
import type { LibraryService, OpenLibrary } from "../library-service";
import { LibraryServiceError } from "../library-service";
import { hasTable } from "./lenient-columns";
import { RULE_DOCS } from "./rule-docs";

/** LibraryService methods defined in this module (PL / PR). */
export interface RuleMethods {
  listRules(...args: Parameters<typeof listRules>): ReturnType<typeof listRules>;
  saveRule(...args: Parameters<typeof saveRule>): ReturnType<typeof saveRule>;
  deleteRule(...args: Parameters<typeof deleteRule>): ReturnType<typeof deleteRule>;
  setRuleEnabled(...args: Parameters<typeof setRuleEnabled>): ReturnType<typeof setRuleEnabled>;
  setRuleLayout(...args: Parameters<typeof setRuleLayout>): ReturnType<typeof setRuleLayout>;
  recordRuleRun(...args: Parameters<typeof recordRuleRun>): ReturnType<typeof recordRuleRun>;
  listRuleRuns(...args: Parameters<typeof listRuleRuns>): ReturnType<typeof listRuleRuns>;
  rulesDirectoryFor(...args: Parameters<typeof rulesDirectoryFor>): ReturnType<typeof rulesDirectoryFor>;
  listRuleChangedAssets(...args: Parameters<typeof listRuleChangedAssets>): ReturnType<typeof listRuleChangedAssets>;
}

export function rulesDirectoryFor(this: LibraryService, openLibrary: OpenLibrary): string {
  return libraryMetaDir(openLibrary.summary.libraryPath, RULES_DIRECTORY);
}

function ruleVersion(manifestText: string, source: string): string {
  return createHash("sha256").update(manifestText).update("\0").update(source).digest("hex").slice(0, 16);
}

function hasRuleTables(openLibrary: OpenLibrary): boolean {
  return hasTable(openLibrary.connection, "rule_state") && hasTable(openLibrary.connection, "rule_runs");
}

/** Write the rule-writing guide, schema, API declarations and examples (always current). */
function ensureRuleDocs(directory: string): void {
  mkdirSync(path.join(directory, "examples"), { recursive: true });
  const write = (name: string, contents: string) => {
    const target = path.join(directory, name);
    try {
      if (existsSync(target) && readFileSync(target, "utf8") === contents) return;
      writeFileSync(target, contents);
    } catch {
      // Docs are a convenience; a read-only or busy file must not block rules.
    }
  };
  write("AGENTS.md", RULE_DOCS.agents);
  write("rule.schema.json", `${JSON.stringify(z.toJSONSchema(ruleManifestSchema), null, 2)}\n`);
  write("keel-rule-api.d.ts", RULE_DOCS.declarations);
  for (const [name, contents] of Object.entries(RULE_DOCS.examples)) write(path.join("examples", name), contents);
}

function legacyRuleScript(name: string, queryDefinitionJson: string, tagIds: string[]): string {
  return `// Converted from the automatic task "${name.replace(/\n/gu, " ")}".
// Adds the tags below to every asset that matches the saved query. It only
// adds tags; it never removes a tag an asset already has.
const definition = ${queryDefinitionJson};
const tagIds: string[] = ${JSON.stringify(tagIds)};

const matched: string[] = [];
for (let offset = 0; ; offset += 200) {
  const page = await keel.assets.search({ definition, scope: rule.scope, limit: 200, offset });
  for (const asset of page.items) matched.push(asset.id);
  if (!page.hasMore || page.items.length === 0) break;
}
let assigned = 0;
for (let index = 0; index < matched.length; index += 64) {
  const result = await keel.tags.assign(matched.slice(index, index + 64), tagIds);
  assigned += result.assignedCount ?? 0;
}
return { matched: matched.length, assigned };
`;
}

/** Turn automatic tasks (migration 63/64) into script rules once per task. */
function convertLegacyAutomaticTasks(openLibrary: OpenLibrary, directory: string): void {
  const db = openLibrary.connection;
  if (openLibrary.readOnly || !hasTable(db, "automatic_tasks") || !hasTable(db, "legacy_group_migrations")) return;
  const rows = db.prepare("SELECT task_id, config_json FROM automatic_tasks ORDER BY rowid").all() as Array<{ task_id: string; config_json: string }>;
  const converted = db.prepare("SELECT 1 FROM legacy_group_migrations WHERE kind='task-rule' AND legacy_id=?");
  const record = db.prepare("INSERT OR IGNORE INTO legacy_group_migrations(kind,legacy_id,tag_id,task_id) VALUES('task-rule',?,'',?)");
  let changed = false;
  for (const row of rows) {
    if (converted.get(row.task_id)) continue;
    const config = automaticTaskConfigSchema.safeParse(JSON.parse(row.config_json));
    if (!config.success) continue;
    const manifest: RuleManifest = {
      $schema: "../rule.schema.json",
      version: 1,
      id: row.task_id,
      name: config.data.name,
      purpose: "从自动任务转换：为匹配查询的资源补加标签，不移除已有标签。",
      trigger: { kind: config.data.trigger === "library-change" ? "library-change" : "manual" },
      scope: { folderId: config.data.folderId ?? null, recursive: config.data.recursive },
      permissions: ["asset.search", "tag.assign"],
      script: RULE_DEFAULT_SCRIPT,
      legacyTaskId: row.task_id,
    };
    writeRuleFiles(directory, manifest, legacyRuleScript(config.data.name, config.data.queryDefinitionJson, config.data.action.tagIds));
    db.prepare("INSERT OR REPLACE INTO rule_state(rule_id, enabled, created_at) VALUES(?,?,?)")
      .run(row.task_id, config.data.enabled ? 1 : 0, new Date().toISOString());
    record.run(row.task_id, row.task_id);
    changed = true;
  }
  if (!changed) return;
  // The task order (migration 64) becomes the rule priority.
  const stored = hasTable(db, "automatic_task_layout")
    ? (db.prepare("SELECT layout_json FROM automatic_task_layout WHERE id=1").get() as { layout_json: string } | undefined)
    : undefined;
  const taskLayout = stored ? automaticTaskLayoutSchema.safeParse(JSON.parse(stored.layout_json)) : null;
  const existing = readLayout(openLibrary);
  if (taskLayout?.success && existing.groups.length === 0 && existing.ungroupedRuleIds.length === 0) {
    writeLayout(openLibrary, {
      groups: taskLayout.data.groups.map((g) => ({ groupId: g.groupId, name: g.name, ruleIds: g.taskIds })),
      ungroupedRuleIds: taskLayout.data.ungroupedTaskIds,
    });
  }
}

function writeRuleFiles(directory: string, manifest: RuleManifest, source: string): void {
  const ruleDir = path.join(directory, manifest.id);
  mkdirSync(ruleDir, { recursive: true });
  writeFileSync(path.join(ruleDir, RULE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(ruleDir, manifest.script), source);
}

function readLayout(openLibrary: OpenLibrary): RuleLayout {
  const row = openLibrary.connection.prepare("SELECT layout_json FROM rule_layout WHERE id=1").get() as { layout_json: string } | undefined;
  const parsed = row ? ruleLayoutSchema.safeParse(JSON.parse(row.layout_json)) : null;
  return parsed?.success ? parsed.data : { groups: [], ungroupedRuleIds: [] };
}

function writeLayout(openLibrary: OpenLibrary, layout: RuleLayout): void {
  openLibrary.connection.prepare("INSERT INTO rule_layout(id, layout_json) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET layout_json=excluded.layout_json")
    .run(JSON.stringify(ruleLayoutSchema.parse(layout)));
}

/** Layout restricted to existing rules; rules missing from it go last. */
function normalizedLayout(layout: RuleLayout, ruleIds: readonly string[]): RuleLayout {
  const ids = new Set(ruleIds);
  const placed = new Set<string>();
  const keep = (values: string[]) => values.filter((id) => {
    if (!ids.has(id) || placed.has(id)) return false;
    placed.add(id);
    return true;
  });
  const groups = layout.groups.map((g) => ({ ...g, ruleIds: keep(g.ruleIds) }));
  const ungroupedRuleIds = keep(layout.ungroupedRuleIds);
  for (const id of ruleIds) if (!placed.has(id)) ungroupedRuleIds.push(id);
  return { groups, ungroupedRuleIds };
}

function readRule(directory: string, entry: string, enabled: Map<string, boolean>, lastRuns: Map<string, RuleRun>): RuleSummary {
  const ruleDir = path.join(directory, entry);
  const manifestText = readFileSync(path.join(ruleDir, RULE_MANIFEST_FILE), "utf8");
  const manifest = ruleManifestSchema.parse(JSON.parse(manifestText));
  if (manifest.id !== entry) throw new Error(`rule.json id ${manifest.id} does not match the directory name.`);
  const source = readFileSync(path.join(ruleDir, manifest.script), "utf8");
  return {
    manifest,
    source,
    version: ruleVersion(manifestText, source),
    enabled: enabled.get(manifest.id) ?? false,
    lastRun: lastRuns.get(manifest.id) ?? null,
  };
}

export function listRules(this: LibraryService, libraryId: string): RuleListResult {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const directory = this.rulesDirectoryFor(openLibrary);
  if (!hasRuleTables(openLibrary)) return { rules: [], layout: { groups: [], ungroupedRuleIds: [] }, problems: [], rulesDirectory: directory };
  if (!openLibrary.readOnly) {
    mkdirSync(directory, { recursive: true });
    ensureRuleDocs(directory);
    convertLegacyAutomaticTasks(openLibrary, directory);
  }
  const db = openLibrary.connection;
  const enabled = new Map((db.prepare("SELECT rule_id, enabled FROM rule_state").all() as Array<{ rule_id: string; enabled: number }>)
    .map((r) => [r.rule_id, r.enabled === 1]));
  const lastRuns = new Map<string, RuleRun>();
  for (const row of db.prepare(
    `SELECT r.rule_id, r.run_json FROM rule_runs r
      WHERE r.started_at = (SELECT MAX(started_at) FROM rule_runs x WHERE x.rule_id = r.rule_id)`,
  ).all() as Array<{ rule_id: string; run_json: string }>) {
    const run = ruleRunSchema.safeParse(JSON.parse(row.run_json));
    if (run.success) lastRuns.set(row.rule_id, run.data);
  }
  const rules: RuleSummary[] = [];
  const problems: RuleProblem[] = [];
  const entries = existsSync(directory) ? readdirSync(directory) : [];
  for (const entry of entries) {
    const ruleDir = path.join(directory, entry);
    if (entry === "examples" || !statSync(ruleDir).isDirectory()) continue;
    if (!existsSync(path.join(ruleDir, RULE_MANIFEST_FILE))) continue;
    try {
      rules.push(readRule(directory, entry, enabled, lastRuns));
    } catch (error) {
      problems.push({ directory: entry, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // A rule written by hand (or by an AI) starts disabled until it is switched on.
  if (!openLibrary.readOnly) {
    const insert = db.prepare("INSERT OR IGNORE INTO rule_state(rule_id, enabled, created_at) VALUES(?, 0, ?)");
    for (const rule of rules) if (!enabled.has(rule.manifest.id)) insert.run(rule.manifest.id, new Date().toISOString());
  }
  const layout = normalizedLayout(readLayout(openLibrary), rules.map((r) => r.manifest.id));
  return { rules, layout, problems, rulesDirectory: directory };
}

export function saveRule(this: LibraryService, input: { libraryId: string; manifest: RuleManifest; source: string; enabled?: boolean }): RuleListResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  if (!hasRuleTables(openLibrary)) throw new LibraryServiceError("LIBRARY_NOT_WRITABLE");
  const manifest = ruleManifestSchema.parse({ ...input.manifest, id: input.manifest.id || randomUUID() });
  const directory = this.rulesDirectoryFor(openLibrary);
  writeRuleFiles(directory, manifest, input.source);
  const db = openLibrary.connection;
  db.prepare(`INSERT INTO rule_state(rule_id, enabled, created_at) VALUES(?, ?, ?)
    ON CONFLICT(rule_id) DO UPDATE SET enabled = COALESCE(?, enabled)`)
    .run(manifest.id, input.enabled ? 1 : 0, new Date().toISOString(), input.enabled === undefined ? null : input.enabled ? 1 : 0);
  return this.listRules(input.libraryId);
}

export function deleteRule(this: LibraryService, input: { libraryId: string; ruleId: string }): RuleListResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  const ruleDir = path.join(this.rulesDirectoryFor(openLibrary), input.ruleId);
  if (!/^[0-9a-f-]{36}$/u.test(input.ruleId)) throw new LibraryServiceError("INVALID_SELECTION");
  rmSync(ruleDir, { recursive: true, force: true });
  openLibrary.connection.prepare("DELETE FROM rule_state WHERE rule_id=?").run(input.ruleId);
  openLibrary.connection.prepare("DELETE FROM rule_runs WHERE rule_id=?").run(input.ruleId);
  return this.listRules(input.libraryId);
}

export function setRuleEnabled(this: LibraryService, input: { libraryId: string; ruleId: string; enabled: boolean }): RuleListResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  openLibrary.connection.prepare(`INSERT INTO rule_state(rule_id, enabled, created_at) VALUES(?, ?, ?)
    ON CONFLICT(rule_id) DO UPDATE SET enabled=excluded.enabled`)
    .run(input.ruleId, input.enabled ? 1 : 0, new Date().toISOString());
  return this.listRules(input.libraryId);
}

export function setRuleLayout(this: LibraryService, input: { libraryId: string; layout: RuleLayout }): RuleListResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  this.assertLibraryWritable(openLibrary);
  writeLayout(openLibrary, ruleLayoutSchema.parse(input.layout));
  return this.listRules(input.libraryId);
}

export function recordRuleRun(this: LibraryService, input: { libraryId: string; run: RuleRun }): void {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (openLibrary.readOnly || !hasRuleTables(openLibrary)) return;
  const run = ruleRunSchema.parse(input.run);
  const db = openLibrary.connection;
  db.prepare("INSERT OR REPLACE INTO rule_runs(run_id, rule_id, started_at, run_json) VALUES(?,?,?,?)")
    .run(run.runId, run.ruleId, run.startedAt, JSON.stringify(run));
  db.prepare(`DELETE FROM rule_runs WHERE rule_id=? AND run_id NOT IN
    (SELECT run_id FROM rule_runs WHERE rule_id=? ORDER BY started_at DESC LIMIT ?)`)
    .run(run.ruleId, run.ruleId, RULE_RUNS_KEPT);
}

export function listRuleRuns(this: LibraryService, input: { libraryId: string; ruleId: string; limit?: number }): RuleRun[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (!hasRuleTables(openLibrary)) return [];
  return (openLibrary.connection.prepare("SELECT run_json FROM rule_runs WHERE rule_id=? ORDER BY started_at DESC LIMIT ?")
    .all(input.ruleId, Math.min(input.limit ?? 50, RULE_RUNS_KEPT)) as Array<{ run_json: string }>)
    .flatMap((row) => {
      const run = ruleRunSchema.safeParse(JSON.parse(row.run_json));
      return run.success ? [run.data] : [];
    });
}

/**
 * Files added or changed after `after`, oldest first, for a continuous rule
 * (at most RULE_CHANGED_ASSETS_BATCH). Trashed files are left out; a folder
 * scope keeps the files of that managed folder (and its subfolders).
 */
export function listRuleChangedAssets(this: LibraryService, input: {
  libraryId: string;
  after: RuleChangeCursor;
  scope: RuleScope;
}): { assetIds: string[]; cursor: RuleChangeCursor | null } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const params: unknown[] = [input.after.updatedAt, input.after.assetId];
  let scopeSql = "";
  if (input.scope.folderId !== null) {
    scopeSql = input.scope.recursive
      ? `AND managed_folder_id IN (
          WITH RECURSIVE descendants(folder_id) AS (
            SELECT folder_id FROM managed_folders WHERE folder_id = ?
            UNION ALL
            SELECT child.folder_id FROM managed_folders child
              JOIN descendants parent ON child.parent_folder_id = parent.folder_id
          )
          SELECT folder_id FROM descendants)`
      : "AND managed_folder_id = ?";
    params.push(input.scope.folderId);
  }
  params.push(RULE_CHANGED_ASSETS_BATCH);
  const rows = openLibrary.connection.prepare(
    `SELECT asset_id, updated_at FROM assets
      WHERE (updated_at, asset_id) > (?, ?) AND deleted_at IS NULL ${scopeSql}
      ORDER BY updated_at, asset_id LIMIT ?`,
  ).all(...params) as Array<{ asset_id: string; updated_at: string }>;
  const last = rows.at(-1);
  return {
    assetIds: rows.map((row) => row.asset_id),
    cursor: last ? { updatedAt: last.updated_at, assetId: last.asset_id } : null,
  };
}
