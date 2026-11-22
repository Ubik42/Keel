import { describe, expect, it } from "vitest";
import { readRendererStyles } from "../../support/renderer-styles";

const css = readRendererStyles();

/** Slice from the a27 marker so earlier mute rules cannot confuse assertions. */
const a27 = (() => {
  const idx = css.lastIndexOf("/* ==== a27:");
  expect(idx).toBeGreaterThan(0);
  return css.slice(idx);
})();

function lastAssignment(source: string, prop: string): string | null {
  const re = new RegExp(`${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`, "g");
  const matches = [...source.matchAll(re)];
  return matches.at(-1)?.[1]?.trim() ?? null;
}

describe("islands accent budget + Codex transfer tokens (a27/a28)", () => {
  it("ships the bold a28 redesign block", () => {
    expect(css).toMatch(/\/\* ==== a28:/);
  });

  it("defines loud / soft / neutral-on accent budget tokens", () => {
    expect(lastAssignment(a27, "--island-accent-loud")).toBe("var(--ui-action-accent)");
    // a28 demotes soft accent to content secondary (accent almost only loud roles).
    expect(lastAssignment(a27, "--island-accent-soft")).toMatch(
      /var\(--ui-action-accent\)|var\(--island-accent-loud\)|var\(--ui-content-secondary\)/,
    );
    expect(lastAssignment(a27, "--island-pressed-wash")).toMatch(/ui-content-primary|white/);
  });

  it("keeps a72 softened hairlines and a custom-theme border pin", () => {
    const a72Start = a27.indexOf("/* ==== a72:");
    const customStart = a27.indexOf("/* ── a93: custom-theme islands");
    expect(a72Start).toBeGreaterThan(0);
    expect(customStart).toBeGreaterThan(a72Start);
    const design = a27.slice(a72Start, customStart);
    expect(lastAssignment(design, "--island-hairline-w")).toMatch(/^(0\.5|1)px$/);
    expect(lastAssignment(design, "--island-border")).toMatch(/6%/);
    expect(lastAssignment(design, "--ui-island-hairline")).toMatch(/4%/);
    expect(a27.slice(customStart)).toMatch(/--island-border:\s*var\(--ui-island-border\)/);
  });

  it("defines a soft surface mix for chips and secondary plates", () => {
    expect(lastAssignment(a27, "--island-surface-soft")).toMatch(/88%|90%|94%/);
  });

  it("keeps selected card ring on loud accent (not pressed-wash)", () => {
    // The last rule for the selected card decides its ring (earlier layers are overridden).
    const rules = [...css.matchAll(/(?:^|\n)\.app-shell\.app-shell \.asset-card\.is-selected,[^{]*\{([^}]*)\}/g)];
    // Since a87 the ring is an outline on the whole card; the border stays transparent.
    const ring = rules.map((m) => /outline:\s*([^;]+);/.exec(m[1] ?? "")?.[1]).filter(Boolean).at(-1);
    expect(ring).toMatch(/solid var\(--(island-accent-loud|accent)\)/);
  });

  it("keeps applied filter segments on loud accent", () => {
    expect(a27).toMatch(/\.dimension-filter-btn\.is-active[\s\S]{0,280}--island-accent-loud/);
  });

  it("routes canvas-controls pressed state through pressed-wash", () => {
    // The rule that styles the pressed canvas control paints the pressed wash.
    const rule = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].find(
      (match) => match[1]!.includes('.canvas-controls .tool-button[aria-pressed="true"]') && match[2]!.includes("var(--island-pressed-wash)"),
    );
    expect(rule).toBeDefined();
  });

  it("paints islands primary CTAs with content ink, not action accent fill", () => {
    expect(a27).toMatch(
      /\.empty-library \.primary-button,\s*\n\.app-shell\.app-shell \.empty-state \.primary-button/,
    );
    const blockStart = a27.indexOf(".empty-library .primary-button,");
    const block = a27.slice(blockStart, blockStart + 700);
    expect(block).toMatch(/background:\s*var\(--ui-content-primary\)/);
    expect(block).not.toMatch(/background:\s*var\(--ui-action-accent\)/);
  });

  it("still shares one opaque --island-side for sidebar + inspector", () => {
    expect(css).toMatch(/--island-side:\s*var\(--ui-surface-pane\)/);
  });
});
