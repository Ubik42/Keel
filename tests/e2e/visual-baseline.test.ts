import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  electronLaunchEnv,
  openAppSettingsDialog,
  resolveElectronExecutablePath,
  waitForLibraryLoadingToFinish,
} from "./electron-test-helpers";

/**
 * Visual baseline for the refactor (docs/进度.md P0 ④).
 *
 * Captures the main surfaces at a fixed window size and device scale factor
 * for the default theme (light and dark) and three representative themes.
 * Snapshots live next to this file; refresh them only for an intended visual
 * change: `npm run test:visual -- --update-snapshots`.
 */
test.describe.configure({ timeout: 600_000 });

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;

interface ThemeCase {
  readonly name: string;
  readonly preset: string;
  readonly mode: "light" | "dark";
}

const THEMES: readonly ThemeCase[] = [
  { name: "serpent-light", preset: "serpent", mode: "light" },
  { name: "serpent-dark", preset: "serpent", mode: "dark" },
  { name: "vscode-dark", preset: "vscode", mode: "dark" },
  { name: "paper-light", preset: "paper", mode: "light" },
  { name: "midnight-dark", preset: "midnight", mode: "dark" },
];

// ── Deterministic fixture images (solid-color PNG) ──────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SOURCES = [
  { name: "a-wide-red.png", width: 640, height: 360, rgb: [0xc0, 0x39, 0x2b] },
  { name: "b-tall-green.png", width: 360, height: 640, rgb: [0x1e, 0x84, 0x49] },
  { name: "c-square-blue.png", width: 400, height: 400, rgb: [0x2b, 0x62, 0xc4] },
  { name: "d-wide-orange.png", width: 800, height: 450, rgb: [0xd0, 0x7a, 0x1e] },
  { name: "e-tall-purple.png", width: 300, height: 600, rgb: [0x6a, 0x3a, 0xa0] },
  { name: "f-small-gray.png", width: 200, height: 200, rgb: [0x77, 0x7c, 0x79] },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function applyTheme(window: Page, theme: ThemeCase): Promise<void> {
  await window.evaluate((value) => {
    localStorage.setItem("serpent.theme-prefs.v1", JSON.stringify({ version: 1, theme: value.mode }));
    localStorage.setItem(
      "serpent.theme-profile.v3",
      JSON.stringify({ version: 3, preset: value.preset, overrides: {} }),
    );
  }, theme);
  await window.reload();
  await window.waitForLoadState("domcontentloaded");
  await waitForLibraryLoadingToFinish(window);
  await expect(window.locator("html")).toHaveAttribute("data-theme", theme.mode, { timeout: 15_000 });
  await waitForThumbnails(window);
}

async function waitForThumbnails(window: Page): Promise<void> {
  await expect(window.locator(".asset-card")).toHaveCount(SOURCES.length, { timeout: 30_000 });
  await expect
    .poll(
      () =>
        window.locator(".asset-card img").evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function settle(window: Page): Promise<void> {
  // The sidebar marks running background jobs with " ·"; wait until they finish.
  await expect(window.locator(".automatic-tasks-heading strong")).not.toHaveAttribute("title", /.+/, {
    timeout: 60_000,
  });
  await window.mouse.move(WINDOW_WIDTH - 2, WINDOW_HEIGHT - 2);
  await window.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await window.waitForTimeout(400);
}

async function snap(window: Page, name: string, mask: Locator[] = []): Promise<void> {
  await settle(window);
  // Cards and the Inspector show the import date, which changes per run day.
  const dateMask = [
    window.locator(".asset-card span").filter({ hasText: /·\s*\d{1,2}\/\d{1,2}$/ }),
    window.locator(".inspector-meta-part").filter({ hasText: /^·?\s*\d{4}\/\d{1,2}\/\d{1,2}$/ }),
  ];
  mask = [...mask, ...dateMask];
  await expect(window).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    maxDiffPixels: 0,
    mask,
  });
}

async function clearSelection(window: Page): Promise<void> {
  await window.keyboard.press("Escape");
  await window.locator(".workspace-canvas").click({ position: { x: 6, y: 6 } }).catch(() => undefined);
  await window.keyboard.press("Escape");
}

async function captureSurfaces(app: ElectronApplication, window: Page, theme: ThemeCase): Promise<void> {
  const prefix = theme.name;
  const cards = window.locator(".asset-card");
  // Import/modified timestamps change between runs; hide them in the Inspector.
  const timeMask = [window.locator(".inspector-panel time"), window.locator("[data-visual-volatile]")];

  await clearSelection(window);
  await snap(window, `${prefix}-01-grid`);

  await cards.nth(0).click();
  await snap(window, `${prefix}-02-inspector-single`, timeMask);

  await cards.nth(1).click({ modifiers: ["Control"] });
  await snap(window, `${prefix}-03-inspector-multi`, timeMask);

  await cards.nth(0).click({ button: "right" });
  await expect(window.getByRole("menuitem").first()).toBeVisible({ timeout: 5_000 });
  await snap(window, `${prefix}-04-context-menu`, timeMask);
  await window.keyboard.press("Escape");
  await clearSelection(window);

  const tagFilter = window.locator(".dimension-filter-bar").getByRole("button", { name: "标签", exact: true });
  await tagFilter.click();
  await window.waitForTimeout(300);
  await snap(window, `${prefix}-05-filter-popover`);
  await tagFilter.click();
  await window.keyboard.press("Escape");

  await window.getByRole("button", { name: "瀑布流视图" }).click();
  await expect(window.locator(".asset-grid")).toHaveClass(/is-masonry/);
  await waitForThumbnails(window);
  await snap(window, `${prefix}-06-masonry`);
  await window.getByRole("button", { name: "平铺视图" }).click();
  await expect(window.locator(".asset-grid")).not.toHaveClass(/is-masonry/);
  await waitForThumbnails(window);

  const settings = await openAppSettingsDialog(app, window);
  await snap(window, `${prefix}-07-settings`);
  await settings.press("Escape");
  await expect(settings).toBeHidden();
}

// ── Test ────────────────────────────────────────────────────────────────────

test("visual baseline of the main surfaces", async () => {
  // Fixed path: library and file paths shown in the UI stay identical per run.
  const root = path.join(tmpdir(), "serpent-visual-baseline");
  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { recursive: true });
  const sourcePaths = SOURCES.map((source) => {
    const file = path.join(root, "sources", source.name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, solidPng(source.width, source.height, source.rgb));
    return file;
  });

  const appDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: [
      ...(process.env.SERPENT_E2E_ELECTRON_EXECUTABLE ? [] : [appDirectory]),
      "--force-device-scale-factor=1",
    ],
    cwd: appDirectory,
    env: electronLaunchEnv({
      SERPENT_E2E: "1",
      SERPENT_E2E_THEME: "dark",
      SERPENT_E2E_USER_DATA_PATH: path.join(root, "profile"),
      SERPENT_E2E_CREATE_PARENT_PATH: root,
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
      TZ: "UTC",
    }),
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.unmaximize();
      win?.setContentSize(size.width, size.height);
      win?.center();
    }, { width: WINDOW_WIDTH, height: WINDOW_HEIGHT });

    await window.getByRole("button", { name: "创建资源库", exact: true }).click();
    await window.getByRole("textbox", { name: "名称", exact: true }).fill("视觉基线");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await waitForLibraryLoadingToFinish(window);
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    await waitForThumbnails(window);

    for (const theme of THEMES) {
      await test.step(theme.name, async () => {
        await applyTheme(window, theme);
        await captureSurfaces(app, window, theme);
      });
    }
  } finally {
    await app.close().catch(() => undefined);
    rmSync(root, { force: true, recursive: true });
  }
});
