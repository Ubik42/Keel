
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRendererStyles } from "../support/renderer-styles";

const css = readRendererStyles();

describe('theme CSS tokens (REQ-THEME-002)', () => {
  it('defines light overrides for core and status tokens', () => {
    expect(css).toContain('[data-theme="light"]');
    for (const token of [
      '--ui-canvas',
      '--ui-pane',
      '--accent',
      '--ui-rating-star',
      '--ui-elev-size',
      '--ui-elev-intensity',
      '--ui-shadow-toolbar',
      '--ui-shadow-pane-east',
      '--ui-shadow-card',
      '--ui-shadow-workspace-tab',
      '--ui-shadow-menu',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('keeps theme-specific exclude filter reds (Serpent-jfi / FILTER-022)', () => {
    // Exclude chips use the status danger token; each theme defines its own red.
    const tokens = readFileSync(resolve(process.cwd(), 'src/renderer/workbench/ui/tokens.css'), 'utf8');
    const reds = [...tokens.matchAll(/--ui-status-danger:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect(new Set(reds).size).toBeGreaterThanOrEqual(2);
    expect(css).not.toMatch(/--filter-exclude:/);
  });

  it('keeps no raw hex colors outside token definition blocks', () => {
    const lines = css.split('\n');
    const hard: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trimStart();
      if (trimmed.startsWith(':root') || trimmed.startsWith('[data-theme=')) {
        let depth = 0;
        while (i < lines.length) {
          const cur = lines[i] ?? '';
          depth += (cur.match(/\{/g) ?? []).length;
          depth -= (cur.match(/\}/g) ?? []).length;
          i += 1;
          if (depth <= 0) break;
        }
        continue;
      }
      if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
        hard.push(`${i + 1}: ${line.trim()}`);
      }
      i += 1;
    }
    expect(hard, hard.join('\n')).toEqual([]);
  });
});
