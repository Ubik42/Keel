import { describe, expect, it } from "vitest";
import { readRendererStyles } from "../support/renderer-styles";

const css = readRendererStyles().replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of `prop` in rules whose selector list targets `> .<pane>-pane` itself, in cascade order. */
function paneDeclarations(pane: string, prop: string): string[] {
  const values: string[] = [];
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(",").map((selector) => selector.trim());
    if (!selectors.some((selector) => new RegExp(String.raw`^\.app-shell\.app-shell > \.${pane}-pane$`).test(selector))) continue;
    for (const declaration of match[2]!.matchAll(new RegExp(String.raw`(?:^|;)\s*${prop}\s*:\s*([^;]+)`, "g"))) values.push(declaration[1]!.trim());
  }
  return values;
}

describe("islands side panels share one surface", () => {
  it("derives --island-side from the theme profile pane token", () => {
    expect(css).toMatch(/--island-side:\s*var\(--ui-surface-pane\)/);
  });

  it("paints sidebar and inspector with the same token, opaque, as the last word", () => {
    for (const pane of ["navigation", "inspector"]) {
      expect(paneDeclarations(pane, "background").at(-1), pane).toBe("var(--island-side)");
      expect(paneDeclarations(pane, "backdrop-filter").at(-1), pane).toBe("none");
    }
  });
});
