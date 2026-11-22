import type { AssetSummary } from "../shared/asset-types";
import type { OpenWithTarget } from "../shared/open-with";
import type { KeelPluginManagerApi } from "../shared/plugin-manager-api";
import { buildPluginMenuDescriptors, runPluginMenuCommand, type PluginMenuDescriptor } from "./plugin-menu-contributions";

export type PluginOpenWithTarget = Extract<OpenWithTarget, { kind: "plugin" }>;

function flatten(items: readonly PluginMenuDescriptor[]): PluginMenuDescriptor[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

/**
 * Asset menu items that plugins put in the "open" group: the choices for a
 * per-extension double-click default (PF). Items with submenus are skipped.
 */
export async function listPluginOpenWithTargets(
  pluginApi: KeelPluginManagerApi | undefined,
  libraryId: string | undefined,
): Promise<PluginOpenWithTarget[]> {
  if (!pluginApi || !libraryId) return [];
  const result = await pluginApi.listPluginContributions({ libraryId, target: "menus.asset" });
  if (!("contributions" in result)) return [];
  const menus = result.contributions.filter(
    (contribution): contribution is Extract<typeof contribution, { kind: "menu" }> => contribution.kind === "menu",
  );
  return flatten(buildPluginMenuDescriptors(menus))
    .filter((item) => item.group === "open" && item.children.length === 0)
    .map((item) => ({ kind: "plugin", pluginId: item.pluginId, contributionId: item.contributionId, itemId: item.id, label: item.label }));
}

/** Run a plugin open-with target on one asset; false when the plugin cannot run it. */
export async function openAssetWithPlugin(
  pluginApi: KeelPluginManagerApi | undefined,
  libraryId: string | undefined,
  target: PluginOpenWithTarget,
  asset: AssetSummary,
): Promise<boolean> {
  if (!pluginApi || !libraryId) return false;
  try {
    await runPluginMenuCommand(pluginApi, libraryId, { contributionId: target.contributionId, id: target.itemId }, {
      assetIds: [asset.assetId],
      assets: [asset],
    });
    return true;
  } catch {
    return false;
  }
}
