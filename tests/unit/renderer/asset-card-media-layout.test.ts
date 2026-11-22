import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { readRendererStyles } from "../../support/renderer-styles";

describe("asset-card media fallback layout", () => {
  it("centers a fallback icon inside the preview frame", () => {
    const styles = readRendererStyles();

    expect(styles).toMatch(
      /\.asset-card-media\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;/,
    );
  });

  it("uses a thin pill progress bar for hover scrub", () => {
    const styles = readRendererStyles();
    expect(styles).toMatch(
      /\.asset-card-hover-progress\s*\{[\s\S]*?height:\s*10px;[\s\S]*?background:\s*var\(--ui-white-a35\);/,
    );
    expect(styles).toMatch(
      /\.asset-card-hover-progress-fill\s*\{[\s\S]*?background:\s*var\(--ui-hover-progress-fill\);/,
    );
    expect(styles).toMatch(
      /\[data-theme="light"\] \.asset-card-hover-progress\s*\{[\s\S]*?background:\s*var\(--ui-white-a25\);/,
    );
    // The fill differs by theme through a token: 70% white in dark, 50% in light.
    const tokens = readFileSync(path.resolve(__dirname, "../../../src/renderer/workbench/ui/tokens.css"), "utf8");
    expect(tokens).toMatch(/--ui-hover-progress-fill: var\(--ui-white-a70\);[\s\S]*--ui-hover-progress-fill: var\(--ui-white-a50\);/);
    expect(styles).not.toMatch(/\.asset-card-hover-playhead\s*\{/);
  });

  it("uses the pointing-hand cursor on browse cards", () => {
    const styles = readRendererStyles();
    expect(styles).toMatch(/\.asset-card\s*\{[\s\S]*?cursor:\s*pointer;/);
    expect(styles).toMatch(
      /\.asset-card\[draggable="true"\]\s*\{[\s\S]*?cursor:\s*pointer;/,
    );
  });
});
