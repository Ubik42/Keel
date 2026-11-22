import { describe, expect, it } from "vitest";

import {
  filterDirectoryEntriesByName,
  type UnifiedDirectoryNavEntry,
} from "../../../src/renderer/folders/unified-directory-nav";

function folder(
  folderId: string,
  name: string,
  parentFolderId: string | null,
  depth: number,
): UnifiedDirectoryNavEntry {
  return {
    kind: "managed",
    folderId,
    name,
    depth,
    parentFolderId,
    directAssetCount: 0,
  };
}

describe("filterDirectoryEntriesByName", () => {
  const entries = [
    folder("root", "Parent", null, 0),
    folder("child", "Child", "root", 1),
    folder("other", "Sibling", null, 0),
  ];

  it("keeps the match and its ancestors", () => {
    expect(filterDirectoryEntriesByName(entries, "chi").map((entry) => entry.folderId)).toEqual([
      "root",
      "child",
    ]);
  });

  it("returns every row for a blank query", () => {
    expect(filterDirectoryEntriesByName(entries, "  ")).toEqual(entries);
  });
});
