import { describe, expect, it } from "vitest";
import { readRendererStyles } from "../support/renderer-styles";

const css = readRendererStyles();

describe("islands side panels share one surface", () => {
  it("derives --island-side from the theme profile pane token", () => {
    expect(css).toMatch(/--island-side:\s*var\(--ui-surface-pane\)/);
  });

  it("paints sidebar and inspector with the same token, opaque, as the last word", () => {
    for (const pane of ["navigation", "inspector"]) {
      const rule = new RegExp(String.raw`\.app-shell\.app-shell > \.${pane}-pane[^{]*\{\s*background: var\(--island-side\);\s*backdrop-filter: none;`, "g");
      const matches = [...css.matchAll(rule)];
      expect(matches.length, pane).toBeGreaterThan(0);
      // No later islands rule may repaint this panel's background.
      const tail = css.slice(matches.at(-1)!.index! + matches.at(-1)![0].length);
      expect(tail).not.toMatch(new RegExp(String.raw`> \.${pane}-pane[^{]*\{[^}]*background(-color)?:`));
    }
  });
});
