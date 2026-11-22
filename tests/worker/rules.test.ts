import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/library/windows-fs-retry';
import { rulesInPriorityOrder, type RuleManifest, type RuleRun } from '../../src/shared/rules';
import { parseSearchExpression } from '../../src/shared/search-expression';

const roots: string[] = [];
const services: LibraryService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) removePathWithSyncRetry(root);
});

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'keel-rules-'));
  roots.push(parent);
  const service = new LibraryService();
  services.push(service);
  const library = service.createLibrary({ displayName: 'Rules', selectedParentPath: parent });
  return { service, library };
}

function manifest(overrides: Partial<RuleManifest> = {}): RuleManifest {
  return {
    version: 1,
    id: randomUUID(),
    name: 'Tag RAW',
    purpose: 'Adds RAW to camera files',
    trigger: { kind: 'after-import' },
    scope: { folderId: null, recursive: true },
    permissions: ['asset.search', 'tag.assign'],
    script: 'rule.ts',
    ...overrides,
  };
}

describe('rules', () => {
  it('writes the guide, schema and declarations into .keel/rules', () => {
    const { service, library } = fixture();
    const result = service.listRules(library.libraryId);
    expect(result.rules).toEqual([]);
    for (const name of ['AGENTS.md', 'rule.schema.json', 'keel-rule-api.d.ts', path.join('examples', 'tag-by-extension.ts')]) {
      expect(existsSync(path.join(result.rulesDirectory, name))).toBe(true);
    }
    expect(JSON.parse(readFileSync(path.join(result.rulesDirectory, 'rule.schema.json'), 'utf8')).properties.trigger).toBeDefined();
  });

  it('saves rules as files, keeps the switch in the database and orders by layout', () => {
    const { service, library } = fixture();
    const first = manifest({ name: 'First' });
    const second = manifest({ name: 'Second' });
    service.saveRule({ libraryId: library.libraryId, manifest: first, source: 'return 1;' });
    let result = service.saveRule({ libraryId: library.libraryId, manifest: second, source: 'return 2;', enabled: true });
    expect(readFileSync(path.join(result.rulesDirectory, first.id, 'rule.ts'), 'utf8')).toBe('return 1;');
    expect(result.rules.find((r) => r.manifest.id === first.id)?.enabled).toBe(false);
    expect(result.rules.find((r) => r.manifest.id === second.id)?.enabled).toBe(true);
    result = service.setRuleLayout({ libraryId: library.libraryId, layout: { groups: [], ungroupedRuleIds: [second.id, first.id] } });
    expect(rulesInPriorityOrder(result).map((r) => r.manifest.name)).toEqual(['Second', 'First']);
    result = service.setRuleEnabled({ libraryId: library.libraryId, ruleId: first.id, enabled: true });
    expect(result.rules.every((r) => r.enabled)).toBe(true);
    result = service.deleteRule({ libraryId: library.libraryId, ruleId: first.id });
    expect(result.rules.map((r) => r.manifest.id)).toEqual([second.id]);
  });

  it('lists a hand-written rule disabled and reports a broken one', () => {
    const { service, library } = fixture();
    const directory = service.listRules(library.libraryId).rulesDirectory;
    const written = manifest();
    mkdirSync(path.join(directory, written.id));
    writeFileSync(path.join(directory, written.id, 'rule.json'), JSON.stringify(written));
    writeFileSync(path.join(directory, written.id, 'rule.ts'), 'return 0;');
    const broken = randomUUID();
    mkdirSync(path.join(directory, broken));
    writeFileSync(path.join(directory, broken, 'rule.json'), '{"version":1}');
    const result = service.listRules(library.libraryId);
    expect(result.rules.map((r) => [r.manifest.id, r.enabled])).toEqual([[written.id, false]]);
    expect(result.problems.map((p) => p.directory)).toEqual([broken]);
  });

  it('records runs and keeps the latest as lastRun', () => {
    const { service, library } = fixture();
    const rule = manifest();
    service.saveRule({ libraryId: library.libraryId, manifest: rule, source: 'return 0;' });
    const run = (startedAt: string, status: RuleRun['status']): RuleRun => ({
      runId: randomUUID(), ruleId: rule.id, ruleVersion: 'v', trigger: 'manual', startedAt, finishedAt: startedAt,
      status, dryRun: false, filesProcessed: 1, changes: [], output: [], error: null, historyEntryId: null,
    });
    service.recordRuleRun({ libraryId: library.libraryId, run: run('2026-11-22T01:00:00.000Z', 'failed') });
    service.recordRuleRun({ libraryId: library.libraryId, run: run('2026-11-22T02:00:00.000Z', 'succeeded') });
    expect(service.listRuleRuns({ libraryId: library.libraryId, ruleId: rule.id }).map((r) => r.status)).toEqual(['succeeded', 'failed']);
    expect(service.listRules(library.libraryId).rules[0]?.lastRun?.status).toBe('succeeded');
  });

  it('converts an automatic task into a script rule once', () => {
    const { service, library } = fixture();
    const tag = service.createTag({ libraryId: library.libraryId, name: 'Shot' });
    const tasks = service.setAutomaticTask({
      libraryId: library.libraryId,
      config: {
        name: 'Tag shots',
        enabled: true,
        trigger: 'library-change',
        queryDefinitionJson: JSON.stringify({ search: parseSearchExpression('name:shot') }),
        folderId: null,
        recursive: true,
        action: { type: 'add-tags', tagIds: [tag.tagId] },
      },
    });
    const taskId = tasks[0]!.taskId;
    let result = service.listRules(library.libraryId);
    const converted = result.rules.find((r) => r.manifest.id === taskId);
    expect(converted?.manifest.legacyTaskId).toBe(taskId);
    expect(converted?.manifest.trigger).toEqual({ kind: 'library-change' });
    expect(converted?.enabled).toBe(true);
    expect(converted?.source).toContain('keel.tags.assign');
    expect(converted?.source).toContain(tag.tagId);
    // Deleting the converted rule must not bring it back.
    service.deleteRule({ libraryId: library.libraryId, ruleId: taskId });
    result = service.listRules(library.libraryId);
    expect(result.rules).toEqual([]);
  });
});
