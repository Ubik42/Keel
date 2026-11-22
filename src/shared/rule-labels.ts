import type { AutomationScriptCommandId } from "./automation-script-api";
import type { RuleTrigger } from "./rules";

/** Display names for rule triggers and run causes (rule list, details, confirmation). */
export const RULE_TRIGGER_LABELS: Record<string, string> = {
  manual: "手动运行",
  "after-import": "导入后",
  "library-change": "资源库变化后",
  schedule: "定时",
  continuous: "持续运行",
  "dry-run": "试运行",
};

export function describeRuleTrigger(trigger: RuleTrigger | undefined): string {
  if (!trigger) return "";
  return trigger.kind === "schedule"
    ? `每 ${trigger.everyMinutes} 分钟`
    : RULE_TRIGGER_LABELS[trigger.kind] ?? trigger.kind;
}

/** What each command a rule may call does, in the user's words. */
export const RULE_PERMISSION_LABELS: Record<AutomationScriptCommandId, string> = {
  "library.create": "新建资源库",
  "file.import": "导入文件",
  "folder.list": "读取文件夹",
  "folder.create": "新建文件夹",
  "asset.list": "列出文件",
  "asset.metadata.get": "读取名称、备注等信息",
  "asset.metadata.set": "修改名称、备注等信息",
  "asset.ai-content.get": "读取 AI 分析结果",
  "asset.extracted-metadata.get": "读取文件内嵌信息",
  "asset.search": "搜索文件",
  "asset.rating.set": "修改评分",
  "asset.paths.copy": "复制文件路径",
  "asset.trash": "移入回收站",
  "asset.content.read": "读取文件内容",
  "asset.content.replace": "替换文件内容",
  "asset.content.stage": "暂存新的文件内容",
  "asset.content.replace-batch": "批量替换文件内容",
  "asset.move": "移动文件",
  "asset.rename-file": "重命名文件",
  "asset.rename-files": "批量重命名文件",
  "asset.list-trash": "读取回收站",
  "asset.restore-if-original-vacant": "从回收站恢复",
  "asset.palette.aggregate-recent": "读取近期颜色统计",
  "library.inspect": "读取资源库信息",
  "library.change-sequence": "读取资源库变化序号",
  "history.status": "读取操作历史",
  "history.undo": "撤销",
  "history.redo": "重做",
  "linked-folder.list": "读取链接文件夹",
  "tag.list": "读取标签",
  "tag.create": "新建标签",
  "tag.assign": "添加标签",
  "tag.remove": "移除标签",
  "media.jobs.list": "读取媒体任务",
  "ai.jobs.status": "读取 AI 任务",
  "ai.enqueue": "排队 AI 分析",
  "ui.notify": "显示通知",
};

const READ_ONLY_PERMISSIONS = new Set<string>([
  "folder.list", "asset.list", "asset.metadata.get", "asset.ai-content.get", "asset.extracted-metadata.get",
  "asset.search", "asset.content.read", "asset.list-trash", "asset.palette.aggregate-recent", "library.inspect",
  "library.change-sequence", "history.status", "linked-folder.list", "tag.list", "media.jobs.list", "ai.jobs.status",
  "ui.notify", "asset.paths.copy",
]);

/** Permission labels split into what only reads and what changes the library. */
export function describeRulePermissions(permissions: readonly string[]): { reads: string[]; writes: string[] } {
  const label = (id: string) => RULE_PERMISSION_LABELS[id as AutomationScriptCommandId] ?? id;
  return {
    reads: permissions.filter((id) => READ_ONLY_PERMISSIONS.has(id)).map(label),
    writes: permissions.filter((id) => !READ_ONLY_PERMISSIONS.has(id)).map(label),
  };
}
