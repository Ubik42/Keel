import { state } from './main-state';
import { type LibraryChangedEvent } from '../shared/protocol/responses';

/**
 * When rules run: after import, on library change, continuously and on schedule (split out of index.ts, P8).
 */
export const ruleTriggerSequence = new Map<string, number>();

export const ruleLibraryChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const ruleContinuousTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const ruleScheduleLastRun = new Map<string, number>();

/**
 * PR: run the enabled rules of one trigger. Changes made by those rules do
 * not trigger "library-change" rules again: events up to the change sequence
 * seen after the batch are ignored.
 */
export async function runRulesFor(libraryId: string, kind: 'after-import' | 'library-change' | 'schedule' | 'continuous'): Promise<void> {
  if (!state.ruleRunner || !state.workerClient) return;
  try {
    const runs = kind === 'continuous'
      ? await state.ruleRunner.runContinuous(libraryId)
      : await state.ruleRunner.runTriggered(libraryId, kind);
    if (runs.length === 0) return;
    const sequence = await state.workerClient.request({ type: 'library.change-sequence', libraryId });
    if (sequence.ok && 'changeSequence' in sequence && typeof sequence.changeSequence === 'number') {
      ruleTriggerSequence.set(libraryId, sequence.changeSequence);
    }
  } catch (error) {
    state.logger?.error('rule.trigger-failed', error, { libraryId, kind });
  }
}

export function scheduleLibraryChangeRules(event: LibraryChangedEvent): void {
  if ((ruleTriggerSequence.get(event.libraryId) ?? -1) >= event.changeSequence) return;
  const pending = ruleLibraryChangeTimers.get(event.libraryId);
  if (pending) clearTimeout(pending);
  ruleLibraryChangeTimers.set(event.libraryId, setTimeout(() => {
    ruleLibraryChangeTimers.delete(event.libraryId);
    void runRulesFor(event.libraryId, 'library-change');
  }, 2_000));
  // Continuous rules keep up sooner: 1 second after the changes settle.
  const continuous = ruleContinuousTimers.get(event.libraryId);
  if (continuous) clearTimeout(continuous);
  ruleContinuousTimers.set(event.libraryId, setTimeout(() => {
    ruleContinuousTimers.delete(event.libraryId);
    void runRulesFor(event.libraryId, 'continuous');
  }, 1_000));
}

/** Once a minute: run "schedule" rules whose interval has passed. */
export async function runScheduledRules(): Promise<void> {
  if (!state.ruleRunner || !state.pluginActivationCoordinator) return;
  for (const libraryId of state.pluginActivationCoordinator.trackedOpenLibraryIds()) {
    const list = await state.ruleRunner.listRules(libraryId).catch(() => undefined);
    const due = list?.rules.some((rule) => {
      if (!rule.enabled || rule.manifest.trigger.kind !== 'schedule') return false;
      const last = ruleScheduleLastRun.get(rule.manifest.id) ?? (rule.lastRun ? Date.parse(rule.lastRun.startedAt) : 0);
      return Date.now() - last >= rule.manifest.trigger.everyMinutes * 60_000;
    });
    if (!due || !list) continue;
    // A schedule batch runs every due rule once, in priority order.
    for (const rule of list.rules) {
      if (rule.enabled && rule.manifest.trigger.kind === 'schedule') ruleScheduleLastRun.set(rule.manifest.id, Date.now());
    }
    await runRulesFor(libraryId, 'schedule');
  }
}
