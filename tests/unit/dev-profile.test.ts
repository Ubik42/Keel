import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDevUserDataPath } from "../../scripts/dev-profile.mjs";

const root = path.resolve("/repo/serpent");

describe("resolveDevUserDataPath", () => {
  it("defaults to the repository .local-profile", () => {
    expect(resolveDevUserDataPath(root, {})).toEqual({
      path: path.join(root, ".local-profile"),
      source: "default",
    });
  });

  it("keeps an explicit absolute SERPENT_USER_DATA_PATH", () => {
    const explicit = path.resolve("/elsewhere/profile");
    expect(
      resolveDevUserDataPath(root, { SERPENT_USER_DATA_PATH: explicit }),
    ).toEqual({ path: explicit, source: "env" });
  });

  it("ignores a relative SERPENT_USER_DATA_PATH", () => {
    expect(
      resolveDevUserDataPath(root, { SERPENT_USER_DATA_PATH: "relative" })
        .source,
    ).toBe("default");
  });
});
