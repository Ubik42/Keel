import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { resolveElectronExecutablePath } from "./electron-test-helpers";
import { removePathWithSyncRetry } from "../../src/worker/windows-fs-retry";

test("independent automatic tasks replace group entries and apply tags manually and in background", async () => {
  test.setTimeout(100000);
  const root = mkdtempSync(path.join(tmpdir(), "serpent-automatic-ui-"));
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
      .fill("独立任务");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText("独立任务", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      window.locator(".navigation-pane").getByText("合集", { exact: true }),
    ).toHaveCount(0);
    await expect(
      window.locator(".navigation-pane").getByText("智能合集", { exact: true }),
    ).toHaveCount(0);
    const panel = window.getByRole("region", { name: "标签", exact: true });
    await panel.getByRole("button", { name: "新建标签", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "标签名称", exact: true })
      .fill("自动分类");
    await panel.getByRole("button", { name: "保存", exact: true }).click();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>';
    writeFileSync(path.join(root, "独立任务", "图片.svg"), svg);
    writeFileSync(path.join(root, "独立任务", "说明.md"), "notes");
    const tagCount = async () =>
      window.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            keel: { library: SerpentLibraryApi };
          }
        ).keel.library;
        const opened = await api.listOpen();
        if (!opened.ok) return -1;
        const tags = await api.listTags({
          libraryId: opened.value[0]!.libraryId,
        });
        return tags.ok
          ? (tags.value.find((t) => t.name === "自动分类")?.assetCount ?? -1)
          : -1;
      });
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & {
                keel: { library: SerpentLibraryApi };
              }
            ).keel.library;
            const opened = await api.listOpen();
            if (!opened.ok) return 0;
            const a = await api.listAssets({
              libraryId: opened.value[0]!.libraryId,
              recursive: true,
            });
            return a.ok ? a.value.length : 0;
          }),
        { timeout: 20000 },
      )
      .toBe(2);
    await window.getByRole("button", { name: "新建任务", exact: true }).click();
    const dialog = window.getByRole("dialog", {
      name: "自动任务",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "新建任务", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "任务名称", exact: true })
      .fill("图片自动打标");
    await dialog
      .getByRole("checkbox", { name: "自动分类", exact: true })
      .check();
    await dialog.getByRole("button", { name: "保存任务", exact: true }).click();
    await expect(
      dialog.getByText("图片自动打标", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "立即运行", exact: true }).click();
    await expect.poll(tagCount).toBe(1);
    await expect(dialog.getByText(/新增 1 条关联/)).toBeVisible();
    await dialog.getByRole("button", { name: "编辑任务", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "任务名称", exact: true })
      .fill("视觉素材自动归类");
    await dialog.getByRole("button", { name: "保存任务", exact: true }).click();
    await expect(
      dialog.getByText("视觉素材自动归类", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "暂停任务", exact: true }).click();
    await expect(dialog.getByText("已暂停", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "启用任务", exact: true }).click();
    writeFileSync(path.join(root, "独立任务", "新增.svg"), svg);
    await expect
      .poll(tagCount, { timeout: 45000, intervals: [500, 1000, 2000] })
      .toBe(2);
    await window.screenshot({
      path: test.info().outputPath("independent-automatic-tasks.png"),
    });
    await dialog.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(
      dialog.getByText(
        "还没有自动任务。先设置筛选条件，再新建任务选择执行动作。",
      ),
    ).toBeVisible();
    await expect.poll(tagCount).toBe(2);
  } finally {
    await app.close();
    removePathWithSyncRetry(root);
  }
});
