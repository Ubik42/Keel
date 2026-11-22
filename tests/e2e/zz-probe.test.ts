import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { resolveElectronExecutablePath } from "./electron-test-helpers";

test("probe renderer errors through create and import", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "keel-probe-"));
  const sources = path.join(root, "sources");
  mkdirSync(sources);
  const files = [0, 1].map((i) => {
    const f = path.join(sources, `probe-${i}.txt`);
    writeFileSync(f, `probe ${i}`);
    return f;
  });
  const application = await electron.launch({
    args: [process.cwd()],
    cwd: process.cwd(),
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      KEEL_E2E: "1",
      KEEL_E2E_CREATE_PARENT_PATH: root,
      KEEL_E2E_IMPORT_FILES: files.join(path.delimiter),
      KEEL_E2E_USER_DATA_PATH: path.join(root, "profile"),
    },
  });
  const window = await application.firstWindow();
  const errors: string[] = [];
  window.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`.slice(0, 1500)));
  window.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`.slice(0, 800)); });
  try {
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("探针");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    const importButton = window.locator(".empty-actions").getByRole("button", { name: "导入文件", exact: true });
    await expect(importButton).toBeEnabled({ timeout: 30_000 });
    await importButton.click();
    await window.waitForTimeout(8000);
    const cards = await window.locator(".asset-card").count();
    const html = await window.evaluate(() => document.body.innerText.slice(0, 2500));
    console.log("CARDS", cards);
    console.log("ERRORS\n" + errors.join("\n---\n"));
    console.log("HTML\n" + html);
  } finally {
    await application.close();
  }
});
