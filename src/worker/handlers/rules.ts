import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

/** Rules (docs/进度.md 3.5) and the legacy automatic tasks they replaced. */
export function executeRuleWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): WorkerResult | undefined {
  switch (request.command.type) {
    case 'rule.list':
      return { ok: true, type: 'rule.list.result', result: libraryService.listRules(request.command.libraryId) };
    case 'rule.save':
      return { ok: true, type: 'rule.list.result', result: libraryService.saveRule(request.command) };
    case 'rule.delete':
      return { ok: true, type: 'rule.list.result', result: libraryService.deleteRule(request.command) };
    case 'rule.set-enabled':
      return { ok: true, type: 'rule.list.result', result: libraryService.setRuleEnabled(request.command) };
    case 'rule.layout.set':
      return { ok: true, type: 'rule.list.result', result: libraryService.setRuleLayout(request.command) };
    case 'rule.runs.list':
      return { ok: true, type: 'rule.runs.result', runs: libraryService.listRuleRuns(request.command) };
    case 'rule.run.record':libraryService.recordRuleRun(request.command);return { ok: true, type: 'rule.run.recorded' };
    case 'rule.changed-assets':
      return { ok: true, type: 'rule.changed-assets.result', ...libraryService.listRuleChangedAssets(request.command) };
    case 'automatic-task.layout.get':
      return { ok: true, type: 'automatic-task.layout', layout: libraryService.getAutomaticTaskLayout(request.command.libraryId) };
    case 'automatic-task.layout.set':
      return { ok: true, type: 'automatic-task.layout', layout: libraryService.setAutomaticTaskLayout(request.command) };
    case 'automatic-task.list':
      return { ok: true, type: 'automatic-task.result', tasks: libraryService.listAutomaticTasks(request.command.libraryId) };
    case 'automatic-task.set':
      return { ok: true, type: 'automatic-task.result', tasks: libraryService.setAutomaticTask(request.command) };
    case 'automatic-task.delete':
      return { ok: true, type: 'automatic-task.result', tasks: libraryService.deleteAutomaticTask(request.command) };
    default:
      return undefined;
  }
}
