import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import sharp from "sharp";

import {
  importFilesThroughBridge,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const MIXED_ASPECT_DIMENSIONS = [
  { width: 320, height: 180 },
  { width: 180, height: 320 },
  { width: 240, height: 240 },
  { width: 360, height: 240 },
  { width: 240, height: 360 },
] as const;

function alphaAssetStem(index: number): string {
  if (index < 26) return String.fromCharCode(97 + index);
  return `a${String.fromCharCode(97 + index - 26)}`;
}

async function writeMixedAspectPng(sourcePath: string, index: number) {
  const dimensions =
    MIXED_ASPECT_DIMENSIONS[index % MIXED_ASPECT_DIMENSIONS.length]!;
  await sharp({
    create: {
      ...dimensions,
      channels: 4,
      background: {
        r: (index * 37) % 255,
        g: (index * 71) % 255,
        b: (index * 109) % 255,
        alpha: 1,
      },
    },
  })
    .png()
    .toFile(sourcePath);
}

async function storedCardSize(window: Page): Promise<number> {
  return window.evaluate(() => {
    const raw = localStorage.getItem("keel.canvas-prefs.v1");
    const parsed = raw ? (JSON.parse(raw) as { cardSize?: unknown }) : null;
    return typeof parsed?.cardSize === "number" ? parsed.cardSize : 160;
  });
}

// ---------------------------------------------------------------------------
// LOCATOR NOTES:
//
// Asset cards are `<button class="asset-card" data-asset-id="...">`.
// When fields.name is TRUE: card has NO aria-label; text content includes
//   filename + size + date, e.g. "automatic.png 70 B · 07/14".
// When fields.name is FALSE: card HAS aria-label=displayName; text content
//   includes only size + date, e.g. "70 B · 07/14".
//
// To locate a card robustly across both states:
//   - getByRole('button', {name: /filename/}) — uses accessible name
//     (aria-label when name hidden, text content when name visible)
//   - locator('.asset-card[data-asset-id="..."]') — precise, always works
//
// Avoid .filter({hasText: filename}) when name may be hidden, because the
// text content won't include the filename.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test 1 — Restart persistence (acceptance criteria #1 and #7)
// ---------------------------------------------------------------------------

test("probe restores canvas preferences after a full restart", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-prefs-restart-"),
  );
  const libraryName = "偏好持久化";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "persist-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.KEEL_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        KEEL_E2E: "1",
        KEEL_E2E_RESTORE_RECENT: "1",
        KEEL_E2E_USER_DATA_PATH: profilePath,
        KEEL_E2E_CREATE_PARENT_PATH: temporaryRoot,
        KEEL_E2E_OPEN_LIBRARY_PATH: libraryPath,
        KEEL_E2E_IMPORT_FILES: sourcePath,
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    // Import the asset
    await importFilesThroughBridge(window);

    // Wait for the asset card to appear (name is ON by default, so hasText works)
    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: "persist-test.png" });
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Capture the card's data-asset-id for robust location after name is hidden
    const cardId = await assetCard.getAttribute("data-asset-id");
    expect(cardId).toBeTruthy();

    // Set masonry mode
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await expect(masonryButton).toHaveAttribute("aria-pressed", "false");
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");

    // The browse slider uses width-aligned discrete stop indexes.
    const sizeSlider = window.getByLabel("资产缩略图大小");
    const persistedSliderIndex = "4";
    await sizeSlider.fill(persistedSliderIndex);
    await expect(sizeSlider).toHaveValue(persistedSliderIndex);

    // Toggle every field independently so restart persistence cannot pass by
    // exercising only one member of the fields object.
    const nameToggle = window.getByRole("button", { name: "文件名" });
    const sizeToggle = window.getByRole("button", { name: "文件大小" });
    const dateToggle = window.getByRole("button", { name: "修改日期" });
    const dimensionsToggle = window.getByRole("button", { name: "分辨率" });
    await expect(nameToggle).toHaveAttribute("aria-pressed", "true");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dimensionsToggle).toHaveAttribute("aria-pressed", "true");

    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

    await sizeToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

    await dateToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "false");

    await dimensionsToggle.click();
    await expect(dimensionsToggle).toHaveAttribute("aria-pressed", "false");

    // Close the app
    await application.close();

    // Re-launch with the same stable profile
    application = await launch();
    window = await application.firstWindow();
    const logs: string[] = [];
    window.on("pageerror", (e) => logs.push("pageerror " + e.message));
    window.on("console", (m) => logs.push(m.type() + " " + m.text().slice(0, 300)));
    await window.waitForTimeout(7000);
    const probe = await window.evaluate(async () => {
      const api = (globalThis as any).keel.library;
      const open = await api.listOpen();
      const id = open.ok ? open.value[0]?.libraryId : null;
      const search = id ? await api.searchAssets({ libraryId: id, query: null, limit: 10, offset: 0 }) : null;
      return { open: open.ok ? open.value.map((l: any) => l.libraryId) : open, total: search?.ok ? search.value.total : search, session: Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes("session") || k.includes("tabs")).map((k) => [k, localStorage.getItem(k)?.slice(0, 600)])) };
    });
    console.log("PROBE " + JSON.stringify(probe));
    console.log("LOGS " + logs.join(" || "));

    // Wait for library to restore
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Locate the card by accessible name (works with name hidden via aria-label)
    const restoredCard = window.getByRole("button", {
      name: /persist-test/,
    });
    await expect(restoredCard).toBeVisible({ timeout: 15_000 });

    // Assert masonry mode restored
    const restoredMasonry = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await expect(restoredMasonry).toHaveAttribute("aria-pressed", "true");

    // Assert the discrete slider position restored.
    const restoredSlider = window.getByLabel("资产缩略图大小");
    await expect(restoredSlider).toHaveValue(persistedSliderIndex);

    // Assert field toggles restored
    const restoredNameToggle = window.getByRole("button", { name: "文件名" });
    const restoredSizeToggle = window.getByRole("button", { name: "文件大小" });
    const restoredDateToggle = window.getByRole("button", { name: "修改日期" });
    const restoredDimensionsToggle = window.getByRole("button", { name: "分辨率" });
    await expect(restoredNameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredSizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredDateToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredDimensionsToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredCard.locator(".asset-caption")).toHaveCount(0);

    // Verify localStorage contains the correct persisted object
    const storedPrefs = await window.evaluate(() => {
      const raw = localStorage.getItem("keel.canvas-prefs.v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedPrefs).toEqual(expect.objectContaining({
      version: 1,
      viewMode: "masonry",
      fields: expect.objectContaining({ name: false, size: false, date: false, dimensions: false }),
    }));
    expect(storedPrefs.cardSize).toBeGreaterThanOrEqual(96);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
