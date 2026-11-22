import { describe, expect, it } from "vitest";

import { resolveFolderBrowseParentId } from "../../src/renderer/browse/folder-browse-canvas";
import type { ManagedFolderSummary } from "../../src/shared/asset-types";

/**
 * toolbar tag *filters* must not behave like chooseTag
 * (activeTagId), or folder cards disappear and the nav looks deselected.
 */
describe("folder browse vs discovery tag filter", () => {
  const folders: ManagedFolderSummary[] = [
    {
      folderId: "folder-a",
      name: "A",
      parentFolderId: null,
      relativePath: "A",
      directAssetCount: 2,
      childFolderCount: 0,
    },
  ];

  it("keeps folder cards when only tagFilter discovery is active (no activeTagId)", () => {
    expect(
      resolveFolderBrowseParentId({
        assetScope: "folder-a",
        showTrash: false,
        activeTagId: null,
        folders,
        searchActive: false,
      }),
    ).toBe("folder-a");
  });

  it("clears folder cards in dedicated tag-browse mode (activeTagId set)", () => {
    expect(
      resolveFolderBrowseParentId({
        assetScope: "folder-a",
        showTrash: false,
        activeTagId: "tag-1",
        folders,
        searchActive: false,
      }),
    ).toBeUndefined();
  });
});
