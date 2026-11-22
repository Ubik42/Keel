import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { readRendererStyles } from "../support/renderer-styles";

const css = readRendererStyles();

describe("workspace navigation hold", () => {
  it("does not capture pointer events while a folder switch is pending", () => {
    expect(css).toMatch(
      /\.workspace-navigation-hold\s*\{[^}]*pointer-events:\s*none;/,
    );
    expect(css).toContain(
      ".workspace-canvas-host.is-navigating:not(.is-viewing)",
    );
  });
});
