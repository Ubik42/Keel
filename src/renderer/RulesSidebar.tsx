import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import type { RuleLayout, RuleListResult, RuleSummary } from "../shared/rules";
import {
  dissolveAutomaticTaskGroup,
  moveAutomaticTask,
  moveAutomaticTaskGroup,
} from "./automatic-task-layout";
import { RULE_TRIGGER_LABELS, invokeRules, rulesBridge, toRuleLayout, toTaskLayout } from "./rules-bridge";

const DRAG_TYPE = "application/x-keel-rule";
type RuleDrag = { kind: "rule" | "group"; id: string };

function triggerLabel(rule: RuleSummary): string {
  const trigger = rule.manifest.trigger;
  return trigger.kind === "schedule" ? `每 ${trigger.everyMinutes} 分钟` : RULE_TRIGGER_LABELS[trigger.kind] ?? trigger.kind;
}

function lastRunLabel(rule: RuleSummary): string {
  const run = rule.lastRun;
  if (!run) return "尚未运行";
  if (run.error?.code === "NEEDS_CONFIRMATION") return "需要在桌面确认后才会自动运行";
  if (run.status === "failed") return `失败：${run.error?.message ?? "未知错误"}`;
  return `${new Date(run.finishedAt).toLocaleString()} · 处理 ${run.filesProcessed} 个文件`;
}

/**
 * Rules in the sidebar (docs/进度.md 3.5): groups, drag to reorder (order is
 * priority), a switch and the last result per rule. Clicking a rule opens its
 * run history.
 */
export function RulesSidebar(props: {
  libraryId: string;
  onOpenRule: (ruleId: string) => void;
  onOpenRuns: () => void;
  onOpenScripts: () => void;
  systemBusy?: boolean;
}) {
  const { libraryId } = props;
  const operationVersion = useRef(0);
  const writeInFlight = useRef(false);
  const [list, setList] = useState<RuleListResult | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`keel.rule-groups.collapsed.${libraryId}`) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [draft, setDraft] = useState<{ kind: "group" | "rule"; id?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<RuleDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (writeInFlight.current) return;
    const version = operationVersion.current;
    const result = await invokeRules({ action: "list", libraryId });
    if (version !== operationVersion.current) return;
    if (result.ok && result.list) setList(result.list);
    else if (!result.ok) setError(result.message);
  }, [libraryId]);

  useEffect(() => {
    queueMicrotask(() => void load());
    // Rule files can change on disk (an AI edits them); refresh now and then.
    const timer = setInterval(() => void load(), 5000);
    const unsubscribe = rulesBridge()?.onRunRecorded((event) => {
      if (event.libraryId === libraryId) void load();
    });
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [libraryId, load]);

  async function write(request: Parameters<typeof invokeRules>[0]) {
    operationVersion.current++;
    writeInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await invokeRules(request);
      if (!result.ok) throw new Error(result.message);
      if (result.list) setList(result.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      writeInFlight.current = false;
      operationVersion.current++;
      setBusy(false);
    }
  }

  const layout: RuleLayout = list?.layout ?? { groups: [], ungroupedRuleIds: [] };
  const saveLayout = (next: RuleLayout) => write({ action: "set-layout", libraryId, layout: next });
  function toggleGroup(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(`keel.rule-groups.collapsed.${libraryId}`, JSON.stringify([...next]));
    } catch {
      /* Display preference only. */
    }
  }
  function start(event: DragEvent, value: RuleDrag) {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(value));
    event.dataTransfer.effectAllowed = "move";
    setDrag(value);
  }
  function over(event: DragEvent, target: string) {
    if (!busy && event.dataTransfer.types.includes(DRAG_TYPE)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(target);
    }
  }
  function drop(event: DragEvent, groupId: string | null, beforeRuleId?: string, beforeGroupId?: string) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE) || busy) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    setDrag(null);
    try {
      const value = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as RuleDrag;
      const taskLayout = toTaskLayout(layout);
      if (value.kind === "rule" && value.id !== beforeRuleId) {
        void saveLayout(toRuleLayout(moveAutomaticTask(taskLayout, value.id, groupId, beforeRuleId)));
      }
      if (value.kind === "group" && beforeGroupId) {
        void saveLayout(toRuleLayout(moveAutomaticTaskGroup(taskLayout, value.id, beforeGroupId)));
      }
    } catch {
      /* Ignore unrelated drags. */
    }
  }

  const byId = new Map((list?.rules ?? []).map((rule) => [rule.manifest.id, rule]));
  function rows(ids: string[], groupId: string | null) {
    return ids.flatMap((id) => {
      const rule = byId.get(id);
      if (!rule) return [];
      const failed = rule.lastRun?.status === "failed" || rule.lastRun?.error?.code === "NEEDS_CONFIRMATION";
      return [
        <div
          key={id}
          className={`automatic-task-row${dropTarget === id ? " is-drop-target" : ""}`}
          role="listitem"
          data-rule-id={id}
          onDragOver={(e) => over(e, id)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => drop(e, groupId, id)}
        >
          <button
            type="button"
            className="automatic-task-grip"
            draggable={!busy}
            aria-label={`拖动规则：${rule.manifest.name}`}
            title="拖动排序或移入分组；列表顺序就是运行顺序。Alt + ↑/↓ 调整顺序"
            onDragStart={(e) => start(e, { kind: "rule", id })}
            onDragEnd={() => {
              setDrag(null);
              setDropTarget(null);
            }}
            onKeyDown={(e) => {
              if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const next = structuredClone(layout);
              const target = groupId ? next.groups.find((g) => g.groupId === groupId)!.ruleIds : next.ungroupedRuleIds;
              const index = target.indexOf(id);
              const to = index + (e.key === "ArrowUp" ? -1 : 1);
              if (to >= 0 && to < target.length) {
                [target[index], target[to]] = [target[to]!, target[index]!];
                void saveLayout(next);
              }
            }}
          >
            ⠿
          </button>
          <button
            type="button"
            className="automatic-task-name"
            onClick={() => props.onOpenRule(id)}
            title={`${rule.manifest.name}\n${rule.manifest.purpose || "（未填写用途）"}\n${triggerLabel(rule)} · ${lastRunLabel(rule)}`}
          >
            <span className={`automatic-task-status${failed ? " is-error" : rule.enabled ? " is-enabled" : ""}`} aria-hidden="true" />
            <span>{rule.manifest.name}</span>
          </button>
          <input
            type="checkbox"
            role="switch"
            aria-label={`启用规则：${rule.manifest.name}`}
            checked={rule.enabled}
            disabled={busy}
            onChange={() => void write({ action: "set-enabled", libraryId, ruleId: id, enabled: !rule.enabled })}
          />
        </div>,
      ];
    });
  }

  const ruleCount = list?.rules.length ?? 0;
  return (
    <section className="automatic-tasks-sidebar" aria-label="规则列表">
      <div className="automatic-tasks-heading">
        <strong title={props.systemBusy ? "有后台任务正在运行" : undefined}>规则{props.systemBusy ? " ·" : ""}</strong>
        <span className="tag-tree-total">{ruleCount}</span>
        <button className="tiny-action" aria-label="新建规则" title="新建规则" onClick={() => setDraft({ kind: "rule", name: "" })}>
          ＋
        </button>
        <button className="tiny-action" aria-label="新建规则分组" title="新建规则分组" onClick={() => setDraft({ kind: "group", name: "" })}>
          ▱
        </button>
        <button className="tiny-action" aria-label="规则菜单" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          ⋯
        </button>
      </div>
      {menu && (
        <div className="automatic-task-section-menu" role="menu">
          <button role="menuitem" onClick={() => { setMenu(false); void invokeRules({ action: "copy-for-ai", libraryId, ruleId: null }); }}>
            复制给 AI（写新规则）
          </button>
          <button role="menuitem" onClick={() => { setMenu(false); void invokeRules({ action: "reveal", libraryId, ruleId: null }); }}>
            打开规则目录
          </button>
          <button role="menuitem" onClick={() => { setMenu(false); props.onOpenRuns(); }}>
            运行状态
          </button>
          <button role="menuitem" onClick={() => { setMenu(false); props.onOpenScripts(); }}>
            高级脚本工具
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="automatic-task-error">
          {error}
        </p>
      )}
      {list?.problems.map((problem) => (
        <p key={problem.directory} role="alert" className="automatic-task-error" title={problem.message}>
          规则目录 {problem.directory.slice(0, 8)} 无法读取：{problem.message}
        </p>
      ))}
      {draft && (
        <form
          className="automatic-task-group-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.name.trim();
            if (!name) return;
            if (draft.kind === "rule") {
              void write({ action: "create", libraryId, name });
              setDraft(null);
              return;
            }
            if (layout.groups.some((g) => g.name === name && g.groupId !== draft.id)) {
              setError("分组名称已存在");
              return;
            }
            const next = structuredClone(layout);
            if (draft.id) next.groups.find((g) => g.groupId === draft.id)!.name = name;
            else next.groups.push({ groupId: crypto.randomUUID(), name, ruleIds: [] });
            void saveLayout(next);
            setDraft(null);
          }}
        >
          <input
            className="text-field"
            aria-label={draft.kind === "rule" ? "规则名称" : "规则分组名称"}
            placeholder={draft.kind === "rule" ? "规则名称，脚本交给 AI 编写" : undefined}
            autoFocus
            required
            maxLength={draft.kind === "rule" ? 120 : 255}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div>
            <button type="submit" className="secondary-button" disabled={busy}>
              {draft.kind === "rule" ? "新建规则" : "保存分组"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      <div role="list" aria-label="规则（按运行顺序）">
        {layout.groups.map((group) => (
          <div className="automatic-task-group" key={group.groupId} data-rule-group={group.groupId}>
            <div
              className={`automatic-task-group-heading${dropTarget === group.groupId ? " is-drop-target" : ""}`}
              onDragOver={(e) => over(e, group.groupId)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => drop(e, group.groupId, undefined, group.groupId)}
            >
              <button
                className="automatic-task-grip"
                draggable={!busy}
                aria-label={`拖动分组：${group.name}`}
                title="拖动调整分组顺序"
                onDragStart={(e) => start(e, { kind: "group", id: group.groupId })}
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
              >
                ⠿
              </button>
              <button className="automatic-task-group-name" aria-expanded={!collapsed.has(group.groupId)} onClick={() => toggleGroup(group.groupId)}>
                <span>{collapsed.has(group.groupId) ? "›" : "⌄"}</span>
                {group.name}
                <span className="nav-count">{group.ruleIds.length}</span>
              </button>
              <button
                className="tiny-action automatic-task-group-action"
                title="重命名分组"
                aria-label={`重命名分组：${group.name}`}
                onClick={() => setDraft({ kind: "group", id: group.groupId, name: group.name })}
              >
                ✎
              </button>
              <button
                className="tiny-action automatic-task-group-action"
                title="解散分组，保留规则"
                aria-label={`解散分组：${group.name}`}
                onClick={() => void saveLayout(toRuleLayout(dissolveAutomaticTaskGroup(toTaskLayout(layout), group.groupId)))}
              >
                ×
              </button>
            </div>
            {!collapsed.has(group.groupId) && (
              <div className="automatic-task-group-content" onDragOver={(e) => over(e, group.groupId)} onDrop={(e) => drop(e, group.groupId)}>
                {rows(group.ruleIds, group.groupId)}
                {!group.ruleIds.length && <p className="automatic-task-empty-group">拖入规则</p>}
              </div>
            )}
          </div>
        ))}
        <div
          className={`automatic-task-ungrouped${dropTarget === "ungrouped" ? " is-drop-target" : ""}`}
          aria-label="未分组规则"
          onDragOver={(e) => over(e, "ungrouped")}
          onDrop={(e) => drop(e, null)}
        >
          {layout.groups.length > 0 && (layout.ungroupedRuleIds.length > 0 || drag?.kind === "rule") && (
            <div className="automatic-task-ungrouped-heading">未分组</div>
          )}
          {rows(layout.ungroupedRuleIds, null)}
          {list && !ruleCount && !layout.groups.length && <p className="nav-empty">点击 ＋ 新建规则，脚本交给 AI 编写</p>}
        </div>
      </div>
    </section>
  );
}
