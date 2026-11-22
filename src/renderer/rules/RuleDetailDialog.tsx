import { useCallback, useEffect, useState } from "react";

import type { RuleRun, RuleSummary } from "../../shared/rules";
import { RULE_TRIGGER_LABELS, invokeRules, rulesBridge } from "./rules-bridge";
import { DialogShell } from "../workbench/ui/patterns";

function runTitle(run: RuleRun): string {
  const when = new Date(run.startedAt).toLocaleString();
  const status = run.status === "succeeded" ? "完成" : run.status === "cancelled" ? "未运行" : "失败";
  return `${when} · ${RULE_TRIGGER_LABELS[run.trigger] ?? run.trigger} · ${status}`;
}

/**
 * One rule (docs/进度.md 3.5): what it does, its trigger history and the
 * actions — run, dry run, copy for AI, open the files, delete. Rules have no
 * parameter form; the script is edited as a file, usually by an AI.
 */
export function RuleDetailDialog(props: {
  libraryId: string;
  ruleId: string | null;
  open: boolean;
  onClose: () => void;
  onOpenScripts: () => void;
}) {
  const { libraryId, ruleId, open } = props;
  const [rule, setRule] = useState<RuleSummary | null>(null);
  const [runs, setRuns] = useState<RuleRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!ruleId) return;
    const [list, history] = await Promise.all([
      invokeRules({ action: "list", libraryId }),
      invokeRules({ action: "history", libraryId, ruleId }),
    ]);
    if (list.ok && list.list) setRule(list.list.rules.find((r) => r.manifest.id === ruleId) ?? null);
    if (history.ok && history.runs) setRuns(history.runs);
  }, [libraryId, ruleId]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void load());
    return rulesBridge()?.onRunRecorded((event) => {
      if (event.libraryId === libraryId && event.ruleId === ruleId) void load();
    });
  }, [open, load, libraryId, ruleId]);

  async function act(request: Parameters<typeof invokeRules>[0], done?: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await invokeRules(request);
      if (!result.ok) setMessage(result.message);
      else {
        if (result.run) setExpanded(result.run.runId);
        if (done) setMessage(done);
      }
      await load();
      return result;
    } finally {
      setBusy(false);
    }
  }

  if (!open || !ruleId) return null;
  const manifest = rule?.manifest;
  const trigger = manifest?.trigger;
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog automatic-tasks-dialog rule-detail-dialog"
        dialogId="rule-detail"
        title={manifest?.name ?? "规则"}
        description={manifest?.purpose || "这条规则还没有写用途。"}
        headerActions={
          <button className="dialog-close" type="button" aria-label="关闭规则" onClick={props.onClose}>
            ×
          </button>
        }
      >
        {manifest && (
          <dl className="rule-detail-facts">
            <dt>触发</dt>
            <dd>{trigger?.kind === "schedule" ? `每 ${trigger.everyMinutes} 分钟` : RULE_TRIGGER_LABELS[trigger?.kind ?? ""]}</dd>
            <dt>状态</dt>
            <dd>{rule?.enabled ? "已开启" : "已关闭"}</dd>
            <dt>权限</dt>
            <dd>{manifest.permissions.join("、") || "无"}</dd>
            <dt>文件</dt>
            <dd>rules/{manifest.id.slice(0, 8)}…/{manifest.script}</dd>
          </dl>
        )}
        <div className="rule-detail-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void act({ action: "run", libraryId, ruleId, dryRun: true })}>
            试运行
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => void act({ action: "run", libraryId, ruleId, dryRun: false })}>
            立即运行
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => void act({ action: "copy-for-ai", libraryId, ruleId }, "已复制：规则文件路径、当前内容和说明书位置。粘贴给 AI 修改。")}>
            复制给 AI
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => void act({ action: "reveal", libraryId, ruleId })}>
            打开规则文件
          </button>
          <button
            className="secondary-button danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`删除规则“${manifest?.name ?? ""}”？规则文件与运行记录会被删除。`)) return;
              const result = await act({ action: "delete", libraryId, ruleId });
              if (result.ok) props.onClose();
            }}
          >
            删除
          </button>
        </div>
        {message && <p className="automatic-task-error" role="status">{message}</p>}
        <h3 className="rule-detail-heading">触发历史</h3>
        {runs.length === 0 ? (
          <p className="nav-empty">还没有运行记录。先试运行看看将要发生的改动。</p>
        ) : (
          <ol className="rule-run-list">
            {runs.map((run) => (
              <li key={run.runId} className={`rule-run is-${run.status}${run.dryRun ? " is-dry-run" : ""}`}>
                <button className="rule-run-summary" aria-expanded={expanded === run.runId} onClick={() => setExpanded(expanded === run.runId ? null : run.runId)}>
                  <span>{runTitle(run)}</span>
                  <span>处理 {run.filesProcessed} 个文件 · {run.changes.length} 项改动</span>
                </button>
                {expanded === run.runId && (
                  <div className="rule-run-detail">
                    {run.error && (
                      <p className="automatic-task-error">
                        {run.error.code}：{run.error.message}
                        {run.error.line ? `（${manifest?.script ?? "rule.ts"} 第 ${run.error.line} 行）` : ""}
                      </p>
                    )}
                    {run.changes.length > 0 && (
                      <ul className="rule-run-changes">
                        {run.changes.map((change, index) => (
                          <li key={index}>
                            {run.dryRun ? "将要：" : ""}
                            {change.summary}（{change.commandId}，{change.assetIds.length} 个资源）
                          </li>
                        ))}
                      </ul>
                    )}
                    {run.output.length > 0 && <pre className="rule-run-output">{run.output.join("\n")}</pre>}
                    <p className="nav-empty">
                      规则版本 {run.ruleVersion.slice(0, 12)}{rule && run.ruleVersion !== rule.version ? "（之后规则已修改）" : ""}
                      {!run.dryRun && run.historyEntryId ? "。改动已记入操作历史，标注为这条规则，可在“编辑 → 撤销”中撤销。" : ""}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="nav-empty">
          需要直接写脚本时，可以用<button className="link-button" onClick={props.onOpenScripts}>高级脚本工具</button>。
        </p>
      </DialogShell>
    </div>
  );
}
