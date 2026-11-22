import type { KeelRulesApi } from "../../preload/bridge/rules";
import type { RuleIpcRequest, RuleIpcResult, RuleLayout } from "../../shared/rules";
import type { AutomaticTaskLayout } from "../../shared/automatic-tasks";

/** window.keel.rules, or undefined outside Electron (tests). */
export function rulesBridge(): KeelRulesApi | undefined {
  return (window as { keel?: { rules?: KeelRulesApi } }).keel?.rules;
}

export async function invokeRules(request: RuleIpcRequest): Promise<RuleIpcResult> {
  const bridge = rulesBridge();
  if (!bridge) return { ok: false, message: "规则服务不可用。" };
  return bridge.invoke(request);
}

/** The drag helpers in automatic-task-layout work on the task layout shape. */
export function toTaskLayout(layout: RuleLayout): AutomaticTaskLayout {
  return {
    groups: layout.groups.map((g) => ({ groupId: g.groupId, name: g.name, taskIds: g.ruleIds })),
    ungroupedTaskIds: layout.ungroupedRuleIds,
  };
}

export function toRuleLayout(layout: AutomaticTaskLayout): RuleLayout {
  return {
    groups: layout.groups.map((g) => ({ groupId: g.groupId, name: g.name, ruleIds: g.taskIds })),
    ungroupedRuleIds: layout.ungroupedTaskIds,
  };
}

export const RULE_TRIGGER_LABELS: Record<string, string> = {
  manual: "手动运行",
  "after-import": "导入后",
  "library-change": "资源库变化后",
  schedule: "定时",
  continuous: "持续运行",
  "dry-run": "试运行",
};
