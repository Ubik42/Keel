import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { KeelLibraryApi } from "../../src/shared/library-api";
import { resolveElectronExecutablePath } from "./electron-test-helpers";
import { removePathWithSyncRetry } from "../../src/worker/windows-fs-retry";

test("sidebar tasks support switches, persistent drag ordering and groups", async () => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "serpent-task-list-"));
  const directory = process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: process.env.KEEL_E2E_ELECTRON_EXECUTABLE ? [] : [directory],
    cwd: directory,
    env: {
      ...process.env,
      KEEL_E2E: "1",
      KEEL_E2E_USER_DATA_PATH: path.join(root, "profile"),
      KEEL_E2E_CREATE_PARENT_PATH: root,
    },
  });
  try {
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selected],
      });
    }, root);
    const window = await app.firstWindow();
    await window
      .getByRole("button", { name: "创建资源库", exact: true })
      .click();
    await window
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("任务列表");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText("任务列表", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "后台任务", exact: true }),
    ).toHaveCount(0);
    const ids = await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          keel: { library: KeelLibraryApi };
        }
      ).keel.library;
      const open = await api.listOpen();
      if (!open.ok) throw Error("No library");
      const libraryId = open.value[0]!.libraryId;
      const tag = await api.createTag({ libraryId, name: "自动标签" });
      if (!tag.ok) throw Error(tag.error.message);
      for (const name of ["图片整理", "人工复查"]) {
        const r = await api.setAutomaticTask({
          libraryId,
          config: {
            name,
            enabled: false,
            trigger: "manual",
            queryDefinitionJson: JSON.stringify({
              filters: [{ field: "format", values: ["text"], exclude: true }],
            }),
            recursive: true,
            action: { type: "add-tags", tagIds: [tag.value.tagId] },
          },
        });
        if (!r.ok) throw Error(r.error.message);
      }
      const r = await api.listAutomaticTasks({ libraryId });
      if (!r.ok) throw Error("No tasks");
      return r.value.map((t) => ({ id: t.taskId, name: t.name }));
    });
    const sidebar = window.getByRole("region", {
      name: "自动任务列表",
      exact: true,
    });
    await expect(
      sidebar.getByRole("switch", { name: "启用任务：图片整理", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const layout = () =>
      window.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            keel: { library: KeelLibraryApi };
          }
        ).keel.library;
        const open = await api.listOpen();
        if (!open.ok) throw Error("No library");
        const r = await api.getAutomaticTaskLayout({
          libraryId: open.value[0]!.libraryId,
        });
        if (!r.ok) throw Error(r.error.message);
        return r.value;
      });
    for (const name of ["素材整理", "待检查"]) {
      await sidebar
        .getByRole("button", { name: "新建任务分组", exact: true })
        .click();
      await sidebar
        .getByRole("textbox", { name: "任务分组名称", exact: true })
        .fill(name);
      await sidebar
        .getByRole("button", { name: "保存分组", exact: true })
        .click();
      await expect(
        sidebar.locator(".automatic-task-group-name").filter({ hasText: name }),
      ).toBeVisible();
    }
    const data = await layout();
    const group = data.groups.find((g) => g.name === "素材整理")!;
    const other = data.groups.find((g) => g.name === "待检查")!;
    const transfer = async (kind: string, id: string) =>
      window.evaluateHandle(
        ({ kind, id }) => {
          const d = new DataTransfer();
          d.setData(
            "application/x-keel-automatic-task",
            JSON.stringify({ kind, id }),
          );
          return d;
        },
        { kind, id },
      );
    for (const task of ids) {
      const d = await transfer("task", task.id);
      const target = sidebar.locator(
        `[data-task-group="${group.groupId}"] .automatic-task-group-heading`,
      );
      await target.dispatchEvent("dragover", { dataTransfer: d });
      await target.dispatchEvent("drop", { dataTransfer: d });
      await expect
        .poll(async () =>
          (await layout()).groups
            .find((g) => g.groupId === group.groupId)
            ?.taskIds.includes(task.id),
        )
        .toBe(true);
    }
    const reordered = await transfer("task", ids[1]!.id);
    const first = sidebar.locator(`[data-task-id="${ids[0]!.id}"]`);
    await first.dispatchEvent("dragover", { dataTransfer: reordered });
    await first.dispatchEvent("drop", { dataTransfer: reordered });
    await expect
      .poll(
        async () =>
          (await layout()).groups.find((g) => g.groupId === group.groupId)
            ?.taskIds,
      )
      .toEqual([ids[1]!.id, ids[0]!.id]);
    const groupDrag = await transfer("group", other.groupId);
    const target = sidebar.locator(
      `[data-task-group="${group.groupId}"] .automatic-task-group-heading`,
    );
    await target.dispatchEvent("dragover", { dataTransfer: groupDrag });
    await target.dispatchEvent("drop", { dataTransfer: groupDrag });
    await expect
      .poll(async () => (await layout()).groups.map((g) => g.name))
      .toEqual(["待检查", "素材整理"]);
    await sidebar
      .getByRole("switch", { name: "启用任务：图片整理", exact: true })
      .check();
    await expect(
      sidebar.getByRole("switch", { name: "启用任务：图片整理", exact: true }),
    ).toBeChecked();
    await sidebar
      .getByRole("button", { name: "重命名分组：素材整理", exact: true })
      .click();
    await sidebar
      .getByRole("textbox", { name: "任务分组名称", exact: true })
      .fill("视觉素材");
    await sidebar
      .getByRole("button", { name: "保存分组", exact: true })
      .click();
    await expect(
      sidebar
        .locator(".automatic-task-group-name")
        .filter({ hasText: "视觉素材" }),
    ).toBeVisible();
    const out = await transfer("task", ids[0]!.id);
    await sidebar
      .locator(".automatic-task-ungrouped")
      .dispatchEvent("dragover", { dataTransfer: out });
    await sidebar
      .locator(".automatic-task-ungrouped")
      .dispatchEvent("drop", { dataTransfer: out });
    await expect
      .poll(async () => (await layout()).ungroupedTaskIds)
      .toEqual([ids[0]!.id]);
    const saved = await layout();
    await window.reload();
    await expect(
      sidebar.getByRole("switch", { name: "启用任务：图片整理", exact: true }),
    ).toBeChecked({ timeout: 15000 });
    expect(await layout()).toEqual(saved);
    await sidebar
      .getByRole("button", { name: "图片整理", exact: true })
      .click();
    await expect(
      window.getByRole("textbox", { name: "任务名称", exact: true }),
    ).toHaveValue("图片整理");
    await window
      .getByRole("button", { name: "关闭自动任务", exact: true })
      .click();
    await window.screenshot({
      path: test.info().outputPath("task-sidebar-groups.png"),
    });
    await sidebar
      .getByRole("button", { name: "解散分组：视觉素材", exact: true })
      .click();
    await expect
      .poll(async () => (await layout()).ungroupedTaskIds.length)
      .toBe(2);
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
