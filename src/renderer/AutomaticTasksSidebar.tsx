import {
  ContextMenu,
  ContextMenuBackdrop,
  ContextMenuItem,
} from "./context-menu";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { SerpentLibraryApi } from "../shared/library-api";
import {
  automaticTaskToConfig,
  type AutomaticTask,
  type AutomaticTaskLayout,
} from "../shared/automatic-tasks";
import {
  moveAutomaticTask,
  moveAutomaticTaskGroup,
  dissolveAutomaticTaskGroup,
} from "./automatic-task-layout";
const DRAG_TYPE = "application/x-serpent-automatic-task";
type TaskDrag = { kind: "task" | "group"; id: string };
export function AutomaticTasksSidebar(props: {
  api: SerpentLibraryApi;
  libraryId: string;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onOpenRuns: () => void;
  onOpenScripts: () => void;
  systemBusy?: boolean;
}) {
  const { api, libraryId } = props;
  const operationVersion = useRef(0);
  const writeInFlight = useRef(false);
  const [tasks, setTasks] = useState<AutomaticTask[]>([]);
  const [layout, setLayout] = useState<AutomaticTaskLayout>({
    groups: [],
    ungroupedTaskIds: [],
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem(`keel.task-groups.collapsed.${libraryId}`) ??
            "[]",
        ),
      );
    } catch {
      return new Set();
    }
  });
  const [draft, setDraft] = useState<{ id?: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [taskMenu, setTaskMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [drag, setDrag] = useState<TaskDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (writeInFlight.current) return;
      const version = operationVersion.current;
      try {
        const [a, b] = await Promise.all([
          api.listAutomaticTasks({ libraryId }),
          api.getAutomaticTaskLayout({ libraryId }),
        ]);
        if (!alive || version !== operationVersion.current) return;
        if (a.ok) setTasks(a.value);
        else setError(a.error.message);
        if (b.ok) setLayout(b.value);
        else setError(b.error.message);
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, libraryId]);
  async function save(next: AutomaticTaskLayout) {
    operationVersion.current++;
    writeInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.setAutomaticTaskLayout({ libraryId, layout: next });
      if (!r.ok) throw Error(r.error.message);
      setLayout(r.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      writeInFlight.current = false;
      operationVersion.current++;
      setBusy(false);
    }
  }
  async function toggle(task: AutomaticTask) {
    operationVersion.current++;
    writeInFlight.current = true;
    setBusy(true);
    setError("");
    setTasks((previous) =>
      previous.map((item) =>
        item.taskId === task.taskId
          ? { ...item, enabled: !task.enabled }
          : item,
      ),
    );
    try {
      const r = await api.setAutomaticTask({
        libraryId,
        config: { ...automaticTaskToConfig(task), enabled: !task.enabled },
      });
      if (!r.ok) throw Error(r.error.message);
      setTasks(r.value);
    } catch (e) {
      setTasks((previous) =>
        previous.map((item) =>
          item.taskId === task.taskId
            ? { ...item, enabled: task.enabled }
            : item,
        ),
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      writeInFlight.current = false;
      operationVersion.current++;
      setBusy(false);
    }
  }
  function toggleGroup(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(
        `keel.task-groups.collapsed.${libraryId}`,
        JSON.stringify([...next]),
      );
    } catch {
      /* Display preference only. */
    }
  }
  function start(event: DragEvent, value: TaskDrag) {
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
  function drop(
    event: DragEvent,
    groupId: string | null,
    beforeTaskId?: string,
    beforeGroupId?: string,
  ) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE) || busy) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    setDrag(null);
    try {
      const value = JSON.parse(
        event.dataTransfer.getData(DRAG_TYPE),
      ) as TaskDrag;
      if (
        value.kind === "task" &&
        tasks.some((t) => t.taskId === value.id) &&
        value.id !== beforeTaskId
      )
        void save(moveAutomaticTask(layout, value.id, groupId, beforeTaskId));
      if (value.kind === "group" && beforeGroupId)
        void save(moveAutomaticTaskGroup(layout, value.id, beforeGroupId));
    } catch {
      /* Ignore unrelated drags. */
    }
  }
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  function rows(ids: string[], groupId: string | null) {
    return ids.flatMap((id) => {
      const task = byId.get(id);
      return task
        ? [
            <div
              key={id}
              className={`automatic-task-row${dropTarget === id ? " is-drop-target" : ""}`}
              role="listitem"
              data-task-id={id}
              onDragOver={(e) => over(e, id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => drop(e, groupId, id)}
            >
              <button
                type="button"
                className="automatic-task-grip"
                draggable={!busy}
                aria-label={`拖动任务：${task.name}`}
                title="拖动排序或移入分组；Alt + ↑/↓ 调整顺序"
                onDragStart={(e) => start(e, { kind: "task", id })}
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
                onKeyDown={(e) => {
                  if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key))
                    return;
                  e.preventDefault();
                  const next = structuredClone(layout);
                  const list = groupId
                    ? next.groups.find((g) => g.groupId === groupId)!.taskIds
                    : next.ungroupedTaskIds;
                  const index = list.indexOf(id);
                  const target = index + (e.key === "ArrowUp" ? -1 : 1);
                  if (target >= 0 && target < list.length) {
                    [list[index], list[target]] = [list[target]!, list[index]!];
                    void save(next);
                  }
                }}
              >
                ⠿
              </button>
              <button
                type="button"
                className="automatic-task-name"
                onClick={() => props.onEdit(id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTaskMenu({ id, x: event.clientX, y: event.clientY });
                }}
                title={
                  task.name +
                  "\n" +
                  (task.lastError ??
                    `${task.trigger === "manual" ? "手动运行" : "库变化时运行"}${task.lastRunAt ? " · 上次新增 " + task.lastAdded + " 条关联" : ""}`)
                }
              >
                <span
                  className={`automatic-task-status${task.lastError ? " is-error" : task.enabled ? " is-enabled" : ""}`}
                  aria-hidden="true"
                />
                <span>{task.name}</span>
              </button>
              <input
                type="checkbox"
                role="switch"
                aria-label={`启用任务：${task.name}`}
                checked={task.enabled}
                disabled={busy}
                onChange={() => void toggle(task)}
              />
            </div>,
          ]
        : [];
    });
  }
  return (
    <section className="automatic-tasks-sidebar" aria-label="自动任务列表">
      {taskMenu && (
        <ContextMenuBackdrop onClose={() => setTaskMenu(null)}>
          <ContextMenu
            position={{ x: taskMenu.x, y: taskMenu.y }}
            ariaLabel="任务操作"
          >
            <ContextMenuItem
              label="高级设置"
              onAction={() => {
                props.onEdit(taskMenu.id);
                setTaskMenu(null);
              }}
            />
          </ContextMenu>
        </ContextMenuBackdrop>
      )}
      <div className="automatic-tasks-heading">
        <strong title={props.systemBusy ? "有后台任务正在运行" : undefined}>
          自动任务{props.systemBusy ? " ·" : ""}
        </strong>
        <span className="tag-tree-total">{tasks.length}</span>
        <button
          className="tiny-action"
          aria-label="新建任务"
          title="新建任务"
          onClick={props.onCreate}
        >
          ＋
        </button>
        <button
          className="tiny-action"
          aria-label="新建任务分组"
          title="新建任务分组"
          onClick={() => setDraft({ name: "" })}
        >
          ▱
        </button>
        <button
          className="tiny-action"
          aria-label="任务菜单"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          ⋯
        </button>
      </div>
      {menu && (
        <div className="automatic-task-section-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              props.onOpenRuns();
            }}
          >
            运行状态
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              props.onOpenScripts();
            }}
          >
            高级脚本工具
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="automatic-task-error">
          {error}
        </p>
      )}
      {draft && (
        <form
          className="automatic-task-group-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.name.trim();
            if (!name) return;
            if (
              layout.groups.some(
                (g) => g.name === name && g.groupId !== draft.id,
              )
            ) {
              setError("分组名称已存在");
              return;
            }
            const next = structuredClone(layout);
            if (draft.id)
              next.groups.find((g) => g.groupId === draft.id)!.name = name;
            else
              next.groups.push({
                groupId: crypto.randomUUID(),
                name,
                taskIds: [],
              });
            void save(next);
            setDraft(null);
          }}
        >
          <input
            className="text-field"
            aria-label="任务分组名称"
            autoFocus
            required
            maxLength={255}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div>
            <button type="submit" className="secondary-button" disabled={busy}>
              保存分组
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setDraft(null)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <div role="list" aria-label="任务列表">
        {layout.groups.map((group) => (
          <div
            className="automatic-task-group"
            key={group.groupId}
            data-task-group={group.groupId}
          >
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
                onDragStart={(e) =>
                  start(e, { kind: "group", id: group.groupId })
                }
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
              >
                ⠿
              </button>
              <button
                className="automatic-task-group-name"
                aria-expanded={!collapsed.has(group.groupId)}
                onClick={() => toggleGroup(group.groupId)}
              >
                <span>{collapsed.has(group.groupId) ? "›" : "⌄"}</span>
                {group.name}
                <span className="nav-count">{group.taskIds.length}</span>
              </button>
              <button
                className="tiny-action automatic-task-group-action"
                title="重命名分组"
                aria-label={`重命名分组：${group.name}`}
                onClick={() =>
                  setDraft({ id: group.groupId, name: group.name })
                }
              >
                ✎
              </button>
              <button
                className="tiny-action automatic-task-group-action"
                title="解散分组，保留任务"
                aria-label={`解散分组：${group.name}`}
                onClick={() =>
                  void save(dissolveAutomaticTaskGroup(layout, group.groupId))
                }
              >
                ×
              </button>
            </div>
            {!collapsed.has(group.groupId) && (
              <div
                className="automatic-task-group-content"
                onDragOver={(e) => over(e, group.groupId)}
                onDrop={(e) => drop(e, group.groupId)}
              >
                {rows(group.taskIds, group.groupId)}
                {!group.taskIds.length && (
                  <p className="automatic-task-empty-group">拖入任务</p>
                )}
              </div>
            )}
          </div>
        ))}
        <div
          className={`automatic-task-ungrouped${dropTarget === "ungrouped" ? " is-drop-target" : ""}`}
          aria-label="未分组任务"
          onDragOver={(e) => over(e, "ungrouped")}
          onDrop={(e) => drop(e, null)}
        >
          {layout.groups.length > 0 &&
            (layout.ungroupedTaskIds.length > 0 || drag?.kind === "task") && (
              <div className="automatic-task-ungrouped-heading">未分组</div>
            )}
          {rows(layout.ungroupedTaskIds, null)}
          {!tasks.length && !layout.groups.length && (
            <p className="nav-empty">点击 ＋ 创建任务</p>
          )}
        </div>
      </div>
    </section>
  );
}
