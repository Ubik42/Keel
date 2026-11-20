import { z } from "zod";
export const automaticTaskConfigSchema = z.strictObject({
  taskId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean(),
  trigger: z.enum(["library-change", "manual"]),
  queryDefinitionJson: z.string().min(2).max(65536),
  folderId: z.string().min(1).nullable().optional(),
  recursive: z.boolean().default(true),
  action: z.strictObject({
    type: z.literal("add-tags"),
    tagIds: z.array(z.string().min(1)).min(1).max(200),
  }),
});
export const automaticTaskSchema = automaticTaskConfigSchema.extend({
  taskId: z.string().uuid(),
  lastRunAt: z.string().nullable(),
  lastAdded: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type AutomaticTaskConfig = z.infer<typeof automaticTaskConfigSchema>;
export type AutomaticTask = z.infer<typeof automaticTaskSchema>;
export const AUTOMATIC_TASKS_SQL = `
CREATE TABLE IF NOT EXISTS automatic_tasks (
 task_id TEXT PRIMARY KEY, config_json TEXT NOT NULL,
 last_run_at TEXT, last_added INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 last_sequence INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS legacy_group_migrations (
 kind TEXT NOT NULL, legacy_id TEXT NOT NULL, tag_id TEXT NOT NULL,
 task_id TEXT, PRIMARY KEY(kind,legacy_id)
);
`;

export const automaticTaskLayoutSchema = z
  .strictObject({
    groups: z
      .array(
        z.strictObject({
          groupId: z.string().uuid(),
          name: z.string().trim().min(1).max(255),
          taskIds: z.array(z.string().uuid()).max(10000),
        }),
      )
      .max(200),
    ungroupedTaskIds: z.array(z.string().uuid()).max(10000),
  })
  .refine((layout) => {
    const ids = [
      ...layout.ungroupedTaskIds,
      ...layout.groups.flatMap((g) => g.taskIds),
    ];
    return (
      new Set(ids).size === ids.length &&
      new Set(layout.groups.map((g) => g.groupId)).size === layout.groups.length
    );
  }, "Task and group identities must be unique");
export type AutomaticTaskLayout = z.infer<typeof automaticTaskLayoutSchema>;
export const AUTOMATIC_TASK_LAYOUT_SQL = `
CREATE TABLE IF NOT EXISTS automatic_task_layout (
 id INTEGER PRIMARY KEY CHECK(id=1), layout_json TEXT NOT NULL
);
`;
export function automaticTaskToConfig(
  task: AutomaticTask,
): AutomaticTaskConfig {
  return {
    taskId: task.taskId,
    name: task.name,
    enabled: task.enabled,
    trigger: task.trigger,
    queryDefinitionJson: task.queryDefinitionJson,
    folderId: task.folderId,
    recursive: task.recursive,
    action: task.action,
  };
}
