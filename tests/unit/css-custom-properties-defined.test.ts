import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walk(directory: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(name)) out.push(full);
  }
  return out;
}

const root = path.resolve(process.cwd(), "src/renderer");
const cssFiles = walk(root, (name) => name.endsWith(".css"));
const sourceText = walk(path.resolve(process.cwd(), "src"), (name) => /\.tsx?$/u.test(name))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

describe("CSS custom properties", () => {
  it("are defined somewhere when var() has no fallback", () => {
    const defined = new Set<string>();
    const css = cssFiles.map((file) => [file, readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "")] as const);
    for (const [, text] of css) for (const match of text.matchAll(/(--[\w-]+)\s*:/gu)) defined.add(match[1]!);
    // Set from TypeScript: inline style objects, setProperty, token maps.
    for (const match of sourceText.matchAll(/['"`](--[\w-]+)['"`]/gu)) defined.add(match[1]!);
    for (const match of sourceText.matchAll(/`(--[\w-]+)-\$\{/gu)) defined.add(`${match[1]!}-`);
    const missing: string[] = [];
    for (const [file, text] of css) {
      for (const match of text.matchAll(/var\((--[\w-]+)\s*\)/gu)) {
        const name = match[1]!;
        if (defined.has(name) || [...defined].some((prefix) => prefix.endsWith("-") && name.startsWith(prefix))) continue;
        missing.push(`${path.relative(root, file)}: ${name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
