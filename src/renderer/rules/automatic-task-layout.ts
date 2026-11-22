import type { AutomaticTaskLayout } from "../../shared/automatic-tasks";
export function moveAutomaticTask(
  layout: AutomaticTaskLayout,
  taskId: string,
  groupId: string | null,
  beforeTaskId?: string,
): AutomaticTaskLayout {
  const next = structuredClone(layout);
  next.ungroupedTaskIds = next.ungroupedTaskIds.filter((id) => id !== taskId);
  for (const group of next.groups)
    group.taskIds = group.taskIds.filter((id) => id !== taskId);
  const target =
    groupId === null
      ? next.ungroupedTaskIds
      : next.groups.find((g) => g.groupId === groupId)?.taskIds;
  if (!target) return layout;
  const index = beforeTaskId ? target.indexOf(beforeTaskId) : -1;
  if (index < 0) target.push(taskId);
  else target.splice(index, 0, taskId);
  return next;
}
export function moveAutomaticTaskGroup(
  layout: AutomaticTaskLayout,
  groupId: string,
  beforeGroupId: string,
): AutomaticTaskLayout {
  const next = structuredClone(layout);
  const from = next.groups.findIndex((g) => g.groupId === groupId);
  if (from < 0 || groupId === beforeGroupId) return layout;
  const group = next.groups.splice(from, 1)[0]!;
  const target = next.groups.findIndex((g) => g.groupId === beforeGroupId);
  if (target < 0) return layout;
  next.groups.splice(target, 0, group);
  return next;
}
export function dissolveAutomaticTaskGroup(
  layout: AutomaticTaskLayout,
  groupId: string,
): AutomaticTaskLayout {
  const group = layout.groups.find((g) => g.groupId === groupId);
  if (!group) return layout;
  return {
    groups: layout.groups.filter((g) => g.groupId !== groupId),
    ungroupedTaskIds: [...layout.ungroupedTaskIds, ...group.taskIds],
  };
}
