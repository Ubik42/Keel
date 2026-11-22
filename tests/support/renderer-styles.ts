import { readFileSync } from "node:fs";
import path from "node:path";

const STYLES_DIR = path.resolve(__dirname, "../../src/renderer/styles");

/**
 * The renderer stylesheet in cascade order: the files that
 * src/renderer/styles/index.css imports, concatenated (P5 split the former
 * styles.css).
 */
export function readRendererStyles(): string {
  const index = readFileSync(path.join(STYLES_DIR, "index.css"), "utf8");
  return [...index.matchAll(/@import\s+"\.\/([^"]+)";/gu)]
    .map((m) => readFileSync(path.join(STYLES_DIR, m[1]!), "utf8"))
    .join("");
}
