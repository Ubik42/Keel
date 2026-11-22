import { randomUUID } from 'node:crypto';

import { getAutomationCommandDescriptor } from '../automation/command-registry';
import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';
import {
  AutomationScriptHostCommandError,
  automationScriptHostFailureFromError,
  createAutomationGatewayError,
} from '../shared/automation-host-command-error';
import { createPublicError } from '../shared/protocol/errors';
import {
  rulesInPriorityOrder,
  type RuleListResult,
  type RuleRun,
  type RuleSummary,
  type RuleTrigger,
} from '../shared/rules';
import type { AppLogger } from './app-logger';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import { normalizeAutomationAssetSearchInput } from './normalize-automation-asset-search-input';
import type { ScriptRuntimeExecutor } from './script-runtime-supervisor';
import type { LibraryWorkerClient } from './worker-client';

/** Why a rule runs; `dry-run` never writes. */
export type RuleRunReason = RuleTrigger['kind'] | 'dry-run';

export interface RuleRunnerOptions {
  workerClient(): LibraryWorkerClient | undefined;
  journal(): AutomationExecutionJournal | undefined;
  gateway(): AutomationCommandGateway | undefined;
  runtime(): ScriptRuntimeExecutor | undefined;
  /** Desktop confirmation for a rule that has not been confirmed in this version. */
  confirmDesktopWrite(rule: { name: string; purpose: string; permissions: readonly string[] }): Promise<boolean>;
  logger(): AppLogger | undefined;
  /** Called after a run is recorded, so the rule list can refresh. */
  onRunRecorded?(libraryId: string, run: RuleRun): void;
}

export interface RuleRunRequest {
  libraryId: string;
  ruleId: string;
  reason: RuleRunReason;
  /** A person started it in the desktop window: ask before the first run of a version. */
  interactive: boolean;
}

const MAX_OUTPUT_LINES = 200;

/** Error line in the rule's own file (the runner adds one line in front). */
function scriptLine(stack: string | undefined): number | undefined {
  const match = stack ? /:(\d+):\d+/u.exec(stack) : null;
  if (!match) return undefined;
  const line = Number(match[1]) - 1;
  return line > 0 ? line : undefined;
}

function assetIdsOf(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const record = input as Record<string, unknown>;
  const ids = record.assetIds ?? (typeof record.assetId === 'string' ? [record.assetId] : undefined);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 10_000) : [];
}

/**
 * Runs rule scripts in the script runtime, through the same Gateway path as
 * the Console: one Automation Execution per run, one history group, the same
 * validation. Only the commands in the manifest's `permissions` are allowed.
 */
export class RuleRunner {
  readonly #options: RuleRunnerOptions;
  /** One queue per library: triggered rules run one after another. */
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(options: RuleRunnerOptions) {
    this.#options = options;
  }

  async listRules(libraryId: string): Promise<RuleListResult | undefined> {
    const response = await this.#options.workerClient()?.request({ type: 'rule.list', libraryId });
    return response?.ok && response.type === 'rule.list.result' ? response.result : undefined;
  }

  /** Run every enabled rule with this trigger, in priority order. */
  runTriggered(libraryId: string, kind: RuleTrigger['kind']): Promise<RuleRun[]> {
    return this.#enqueue(libraryId, async () => {
      const list = await this.listRules(libraryId);
      if (!list) return [];
      const runs: RuleRun[] = [];
      for (const rule of rulesInPriorityOrder(list)) {
        if (!rule.enabled || rule.manifest.trigger.kind !== kind) continue;
        runs.push(await this.#runRule(libraryId, rule, kind, false));
      }
      return runs;
    });
  }

  /** Run one rule now (manual, MCP, dry-run), regardless of its switch. */
  run(request: RuleRunRequest): Promise<RuleRun | undefined> {
    return this.#enqueue(request.libraryId, async () => {
      const list = await this.listRules(request.libraryId);
      const rule = list?.rules.find((candidate) => candidate.manifest.id === request.ruleId);
      if (!rule) return undefined;
      return this.#runRule(request.libraryId, rule, request.reason, request.interactive);
    });
  }

  #enqueue<T>(libraryId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(libraryId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.#queues.set(libraryId, next);
    void next.finally(() => {
      if (this.#queues.get(libraryId) === next) this.#queues.delete(libraryId);
    });
    return next;
  }

  async #runRule(libraryId: string, rule: RuleSummary, reason: RuleRunReason, interactive: boolean): Promise<RuleRun> {
    const dryRun = reason === 'dry-run';
    const startedAt = new Date().toISOString();
    const output: string[] = [];
    const changes: RuleRun['changes'] = [];
    const processed = new Set<string>();
    let historyEntryId: string | null = null;
    const finish = async (status: RuleRun['status'], error: RuleRun['error']): Promise<RuleRun> => {
      const run: RuleRun = {
        runId: randomUUID(),
        ruleId: rule.manifest.id,
        ruleVersion: rule.version,
        trigger: reason,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        dryRun,
        filesProcessed: processed.size,
        changes: changes.slice(0, 500),
        output: output.slice(0, MAX_OUTPUT_LINES),
        error,
        historyEntryId,
      };
      try {
        await this.#options.workerClient()?.request({ type: 'rule.run.record', libraryId, run });
        this.#options.onRunRecorded?.(libraryId, run);
      } catch (recordError) {
        this.#options.logger()?.error('rule.run.record-failed', recordError, { ruleId: run.ruleId });
      }
      return run;
    };

    const journal = this.#options.journal();
    const gateway = this.#options.gateway();
    const runtime = this.#options.runtime();
    if (!journal || !gateway || !runtime) {
      return finish('failed', { code: 'RUNTIME_UNAVAILABLE', message: '脚本运行环境尚未就绪。' });
    }
    const permissions = new Set<AutomationScriptCommandId>(rule.manifest.permissions);
    const descriptors = [...permissions].map((commandId) => getAutomationCommandDescriptor(commandId));
    const isRead = (impact: string | undefined) => impact === 'read' || impact === 'none';
    const capabilities = [...new Set(descriptors
      .filter((d) => d && (!dryRun || isRead(d.impact)))
      .flatMap((d) => d!.requiredCapabilities))];

    // The rule context is one line in front of the script.
    const context = { id: rule.manifest.id, trigger: reason, scope: rule.manifest.scope, dryRun };
    const source = `const rule = Object.freeze(${JSON.stringify(context)});\n${rule.source}`;
    // The grant is keyed by manifest + script, not by this run's context, so
    // one confirmation covers every trigger until the rule is edited.
    const created = journal.create({
      source: 'script',
      libraryId,
      scriptSource: `${JSON.stringify(rule.manifest)}
${rule.source}`,
      declaredCapabilities: capabilities as never,
    });
    const executionId = created.executionId;
    const started = journal.start(executionId);
    if (started?.status === 'awaiting-authorization') {
      // A dry run declares read access only; Main grants it. A real run of a
      // new or edited rule waits for the person in the desktop window.
      const allowed = dryRun || (interactive && await this.#options.confirmDesktopWrite(rule.manifest));
      if (!allowed) {
        journal.cancel(executionId);
        return finish('cancelled', {
          code: 'NEEDS_CONFIRMATION',
          message: '这一版规则还没有在桌面上确认过。请在规则列表中运行一次并确认。',
        });
      }
      const authorized = journal.authorizeFromDesktop({ executionId, persistence: 'saved-script' });
      if (!authorized.ok) {
        journal.cancel(executionId);
        return finish('failed', { code: authorized.code, message: '无法授权这次运行。' });
      }
    }
    const record = journal.resolve(executionId);
    if (!record?.resourceBudget) {
      return finish('failed', { code: 'RUNTIME_UNAVAILABLE', message: '执行记录不可用。' });
    }

    // Label the run's history entry with this rule and version (provenance).
    gateway.setExecutionHistoryRule?.(executionId, { ruleId: rule.manifest.id, name: rule.manifest.name, version: rule.version });
    const completeHistory = async (): Promise<void> => {
      if (gateway.completeExecutionHistoryEntry) {
        historyEntryId = (await gateway.completeExecutionHistoryEntry(executionId)).historyEntryId;
      } else {
        await gateway.completeExecutionHistoryGroup(executionId);
      }
    };

    const execute = async (commandId: AutomationScriptCommandId, rawInput: unknown): Promise<unknown> => {
      if (!permissions.has(commandId)) {
        output.push(`规则没有声明权限 ${commandId}；请把它加入 rule.json 的 permissions。`);
        throw new AutomationScriptHostCommandError(createAutomationGatewayError('AUTOMATION_CAPABILITY_DENIED'));
      }
      const descriptor = getAutomationCommandDescriptor(commandId);
      const ids = assetIdsOf(rawInput);
      if (!isRead(descriptor?.impact)) {
        for (const id of ids) processed.add(id);
        changes.push({ commandId, assetIds: ids, summary: descriptor?.summary ?? commandId });
        if (dryRun) return { dryRun: true };
      }
      const input = commandId === 'asset.search' ? normalizeAutomationAssetSearchInput(rawInput) : rawInput;
      if (input === undefined) throw new AutomationScriptHostCommandError(createPublicError('INVALID_SEARCH_QUERY'));
      const result = await gateway.execute({ apiVersion: 1, commandId, executionId, input });
      if (!result.ok) {
        const error = 'error' in result ? result.error : createPublicError('INTERNAL_ERROR');
        throw new AutomationScriptHostCommandError(error as never);
      }
      return result.result;
    };

    try {
      const result = await runtime.run({
        executionId,
        source,
        signal: record.abortSignal,
        limits: {
          cpuTimeoutMs: record.resourceBudget.maxCpuTimeMs,
          wallTimeoutMs: record.resourceBudget.maxWallTimeMs,
          memoryLimitBytes: record.resourceBudget.maxMemoryBytes,
          maxOutputBytes: record.resourceBudget.maxOutputBytes,
          maxPendingHostCalls: record.resourceBudget.maxConcurrentCommands,
          maxPendingGuestPromises: record.resourceBudget.maxPendingPromises,
        },
        host: { execute },
      });
      await completeHistory();
      if (result.ok) {
        output.push(...result.output);
        if (result.value !== undefined) output.push(`→ ${JSON.stringify(result.value).slice(0, 2000)}`);
        const current = journal.get(executionId);
        journal.complete(executionId, {
          status: current && current.failedCommandCount > 0 ? 'partially-succeeded' : 'succeeded',
          summary: { succeeded: current?.succeededCommandCount ?? 0, failed: current?.failedCommandCount ?? 0 },
        });
        return finish('succeeded', null);
      }
      const current = journal.get(executionId);
      journal.complete(executionId, {
        status: result.error.code === 'WALL_TIMEOUT' ? 'timed-out' : 'failed',
        summary: { succeeded: current?.succeededCommandCount ?? 0, failed: current?.failedCommandCount ?? 0 },
      });
      return finish(result.error.code === 'CANCELLED' ? 'cancelled' : 'failed', {
        code: result.error.code,
        message: result.error.message,
        ...(scriptLine(result.error.guestStack) ? { line: scriptLine(result.error.guestStack)! } : {}),
      });
    } catch (error) {
      this.#options.logger()?.error('rule.run.failed', error, { ruleId: rule.manifest.id });
      await completeHistory().catch(() => undefined);
      const failure = automationScriptHostFailureFromError(error);
      const current = journal.get(executionId);
      if (current?.status === 'running') {
        journal.complete(executionId, { status: 'failed', summary: { succeeded: current.succeededCommandCount, failed: current.failedCommandCount } });
      }
      return finish('failed', { code: failure?.code ?? 'RUNTIME_ERROR', message: failure?.message ?? '规则运行失败。' });
    }
  }
}
