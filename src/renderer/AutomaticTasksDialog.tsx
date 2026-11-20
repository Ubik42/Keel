import { useEffect, useState, type ReactNode } from "react";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { TagSummary, ManagedFolderSummary } from "../shared/asset-types";
import type {
  AutomaticTask,
  AutomaticTaskConfig,
} from "../shared/automatic-tasks";
import { automaticTaskToConfig } from "../shared/automatic-tasks";
import { DialogShell } from "./ui/patterns";

function describeConditions(value: string): string {
  try {
    const q = JSON.parse(value) as {
      search?: { expressionSource?: string; clauses?: { value: string }[] };
      filters?: { field: string; values?: string[]; exclude?: boolean }[];
    };
    const labels: Record<string, string> = {
      format: "格式",
      tag: "标签",
      tag_expression: "标签表达式",
      rating: "评分",
      favorite: "收藏",
      color: "颜色",
      width: "宽度",
      height: "高度",
      duration: "时长",
      source_url: "来源网址",
      availability: "文件状态",
      long_edge: "长边",
      aspect_ratio: "宽高比",
      byte_size: "文件大小",
      created_at: "创建时间",
      modified_at: "修改时间",
    };
    const values: Record<string, string> = {
      text: "文本",
      unknown: "未识别格式",
    };
    return (
      [
        q.search
          ? `搜索：${q.search.expressionSource || q.search.clauses?.map((c) => c.value).join("、") || "已保存的表达式"}`
          : null,
        ...(q.filters ?? []).map(
          (f) =>
            `${f.exclude ? "排除" : ""}${labels[f.field] ?? f.field}${f.values?.length ? "：" + f.values.map((v) => (f.field === "format" ? (values[v] ?? v) : v)).join("、") : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("；") || "没有筛选条件"
    );
  } catch {
    return "条件无法读取，请重新设置";
  }
}
export function AutomaticTasksDialog(props: {
  api: SerpentLibraryApi;
  libraryId: string;
  open: boolean;
  initialTaskId?: string | null;
  currentQueryJson: string;
  tags: readonly TagSummary[];
  folders: readonly ManagedFolderSummary[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenScripts: () => void;
}): ReactNode {
  const { api, libraryId, open } = props;
  const [tasks, setTasks] = useState<AutomaticTask[]>([]);
  const [draft, setDraft] = useState<AutomaticTaskConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void api.listAutomaticTasks({ libraryId }).then(async (r) => {
      if (!alive) return;
      if (r.ok) {
        setTasks(r.value);
        if (open && props.initialTaskId === null)
          setDraft({
            name: "",
            enabled: true,
            trigger: "library-change",
            queryDefinitionJson: props.currentQueryJson,
            folderId: null,
            recursive: true,
            action: { type: "add-tags", tagIds: [] },
          });
        else if (open && props.initialTaskId) {
          const task = r.value.find((t) => t.taskId === props.initialTaskId);
          if (task) setDraft(automaticTaskToConfig(task));
        }
        await props.onChanged();
      } else setError(r.error.message);
    });
    const timer = setInterval(() => {
      if (open)
        void api.listAutomaticTasks({ libraryId }).then((r) => {
          if (alive && r.ok) setTasks(r.value);
        });
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // Refresh callbacks do not own this library-scoped subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, libraryId, open, props.initialTaskId]);
  async function perform(
    action: () => ReturnType<SerpentLibraryApi["listAutomaticTasks"]>,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await action();
      if (!r.ok) throw Error(r.error.message);
      setTasks(r.value);
      await props.onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog automatic-tasks-dialog"
        dialogId="automatic-tasks"
        title="自动任务"
        description="设置触发方式、筛选条件和执行动作。后台每 30 秒检查库变化，分批执行；关闭 Serpent 后停止。"
        headerActions={
          <button
            className="dialog-close"
            type="button"
            aria-label="关闭自动任务"
            onClick={props.onClose}
          >
            ×
          </button>
        }
      >
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="automatic-task-toolbar">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              setDraft({
                name: "",
                enabled: true,
                trigger: "library-change",
                queryDefinitionJson: props.currentQueryJson,
                folderId: null,
                recursive: true,
                action: { type: "add-tags", tagIds: [] },
              })
            }
          >
            新建任务
          </button>
        </div>
        {draft ? (
          <form
            className="automatic-task-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(() =>
                api.setAutomaticTask({ libraryId, config: draft }),
              ).then((ok) => {
                if (ok) setDraft(null);
              });
            }}
          >
            <label className="field">
              任务名称
              <input
                className="text-field"
                aria-label="任务名称"
                required
                maxLength={255}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="field">
              触发方式
              <select
                className="text-field"
                aria-label="触发方式"
                value={draft.trigger}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    trigger: e.target.value as AutomaticTaskConfig["trigger"],
                  })
                }
              >
                <option value="library-change">库变化时自动运行</option>
                <option value="manual">仅手动运行</option>
              </select>
            </label>
            <label className="field">
              搜索范围
              <select
                className="text-field"
                aria-label="任务搜索范围"
                value={draft.folderId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, folderId: e.target.value || null })
                }
              >
                <option value="">整个资源库</option>
                {props.folders.map((f) => (
                  <option key={f.folderId} value={f.folderId}>
                    {f.relativePath}
                  </option>
                ))}
              </select>
            </label>
            {draft.folderId && (
              <label>
                <input
                  type="checkbox"
                  checked={draft.recursive}
                  onChange={(e) =>
                    setDraft({ ...draft, recursive: e.target.checked })
                  }
                />
                包含子文件夹
              </label>
            )}
            <div className="automatic-task-conditions">
              <strong>筛选条件</strong>
              <p>{describeConditions(draft.queryDefinitionJson)}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    queryDefinitionJson: props.currentQueryJson,
                  })
                }
              >
                使用当前筛选条件
              </button>
              <p className="field-help">
                需要调整条件时，可关闭此窗口，在上方设置筛选后重新编辑任务。
              </p>
            </div>
            <fieldset>
              <legend>执行动作：加入标签</legend>
              <div className="automatic-task-tags">
                {props.tags.length ? (
                  props.tags.map((t) => (
                    <label key={t.tagId}>
                      <input
                        type="checkbox"
                        checked={draft.action.tagIds.includes(t.tagId)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            action: {
                              type: "add-tags",
                              tagIds: e.target.checked
                                ? [...draft.action.tagIds, t.tagId]
                                : draft.action.tagIds.filter(
                                    (id) => id !== t.tagId,
                                  ),
                            },
                          })
                        }
                      />
                      {t.name}
                    </label>
                  ))
                ) : (
                  <p>请先创建目标标签。</p>
                )}
              </div>
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              启用任务
            </label>
            <p className="field-help">
              只为匹配素材补加标签。暂停或删除任务后，已添加的标签继续保留。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消编辑
              </button>
              <button
                className="primary-button"
                disabled={
                  busy || !draft.name.trim() || !draft.action.tagIds.length
                }
                type="submit"
              >
                保存任务
              </button>
            </div>
          </form>
        ) : (
          <div className="automatic-task-list">
            {tasks.length ? (
              tasks.map((task) => (
                <article className="automatic-task-card" key={task.taskId}>
                  <div>
                    <strong>{task.name}</strong>
                    <span className="field-help">
                      {!task.enabled
                        ? "已暂停"
                        : task.trigger === "manual"
                          ? "仅手动"
                          : "库变化时自动运行"}
                    </span>
                  </div>
                  <p>{describeConditions(task.queryDefinitionJson)}</p>
                  <p>
                    加入标签：
                    {task.action.tagIds
                      .map(
                        (id) =>
                          props.tags.find((t) => t.tagId === id)?.name ??
                          "标签已删除",
                      )
                      .join("、")}
                  </p>
                  <p className="field-help">
                    {task.lastRunAt
                      ? `上次执行：${new Date(task.lastRunAt).toLocaleString()}，新增 ${task.lastAdded} 条关联`
                      : "尚未执行"}
                  </p>
                  {task.lastError && <p role="alert">{task.lastError}</p>}
                  <div className="automatic-task-toolbar">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        const config: AutomaticTaskConfig = {
                          taskId: task.taskId,
                          name: task.name,
                          enabled: task.enabled,
                          trigger: task.trigger,
                          queryDefinitionJson: task.queryDefinitionJson,
                          folderId: task.folderId,
                          recursive: task.recursive,
                          action: task.action,
                        };
                        setDraft(config);
                      }}
                    >
                      编辑任务
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api.runAutomaticTask({
                            libraryId,
                            taskId: task.taskId,
                          }),
                        )
                      }
                    >
                      立即运行
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api.setAutomaticTask({
                            libraryId,
                            config: {
                              taskId: task.taskId,
                              name: task.name,
                              enabled: !task.enabled,
                              trigger: task.trigger,
                              queryDefinitionJson: task.queryDefinitionJson,
                              folderId: task.folderId,
                              recursive: task.recursive,
                              action: task.action,
                            },
                          }),
                        )
                      }
                    >
                      {task.enabled ? "暂停任务" : "启用任务"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api.deleteAutomaticTask({
                            libraryId,
                            taskId: task.taskId,
                          }),
                        )
                      }
                    >
                      删除任务
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="nav-empty">
                还没有自动任务。先设置筛选条件，再新建任务选择执行动作。
              </p>
            )}
          </div>
        )}
      </DialogShell>
    </div>
  );
}
