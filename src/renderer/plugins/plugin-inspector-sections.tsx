import { useEffect, useState, type ReactNode } from "react";

import type { KeelPluginManagerApi } from "../../shared/plugin-manager-api";
import type { PluginContributionContext, PluginInvocationAssetSource } from "../../plugins/plugin-context";
import {
  resolvePluginContributionConditions,
  runPluginMenuCommand,
} from "./plugin-menu-contributions";
import { sortPluginSurfaceContributions } from "./plugin-surface-ordering";
import {
  DEFAULT_PLUGIN_INSPECTOR_PLACEMENT,
  INSPECTOR_SECTION_IDS,
  type InspectorSectionId,
} from "../../shared/inspector-sections";

export type PluginInspectorSectionDescriptor = {
  id: string;
  sectionLabel: string;
  actionLabel: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
  disabled: boolean;
  when?: string;
  enablement?: string;
  checked?: boolean;
  /** Built-in section this one follows. */
  placement: InspectorSectionId;
  /** Shown only when every selected file has one of these extensions. */
  extensions?: readonly string[];
};

export function buildPluginInspectorSectionDescriptors(
  contributions: readonly {
    kind: 'inspector-section';
    id: string;
    title: string;
    commandTitle: string;
    commandId: string;
    pluginId: string;
    pluginInstanceId?: string;
    when?: string;
    enablement?: string;
    checked?: string;
    after?: string;
    extensions?: readonly string[];
  }[],
  context?: PluginContributionContext,
): PluginInspectorSectionDescriptor[] {
  return sortPluginSurfaceContributions(contributions)
    .flatMap((contribution) => {
      const conditions = resolvePluginContributionConditions(contribution, context);
      if (!conditions.visible) return [];
      return [{
        id: contribution.id,
        sectionLabel: contribution.title,
        actionLabel: contribution.commandTitle,
        contributionId: contribution.id,
        commandId: contribution.commandId,
        pluginId: contribution.pluginId,
        ...(contribution.when === undefined ? {} : { when: contribution.when }),
        ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
        ...(conditions.checked === undefined ? {} : { checked: conditions.checked }),
        disabled: conditions.disabled,
        placement: (INSPECTOR_SECTION_IDS as readonly string[]).includes(contribution.after ?? "")
          ? contribution.after as InspectorSectionId
          : DEFAULT_PLUGIN_INSPECTOR_PLACEMENT,
        ...(contribution.extensions === undefined ? {} : { extensions: contribution.extensions }),
      }];
    });
}

export function usePluginInspectorSectionContributions(
  pluginApi: KeelPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
  context?: PluginContributionContext,
): PluginInspectorSectionDescriptor[] {
  const [items, setItems] = useState<PluginInspectorSectionDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'inspector.sections',
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const sectionContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'inspector-section' }> => contribution.kind === 'inspector-section',
      );
      setItems(buildPluginInspectorSectionDescriptors(sectionContributions, context));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-inspector-sections-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context, libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Sections whose extension filter matches every selected file. */
export function pluginInspectorSectionsFor(
  items: readonly PluginInspectorSectionDescriptor[],
  placement: InspectorSectionId,
  selectedNames: readonly string[],
): PluginInspectorSectionDescriptor[] {
  return items.filter((item) => item.placement === placement && (
    item.extensions === undefined
    || (selectedNames.length > 0 && selectedNames.every((name) => item.extensions!.includes(extensionOf(name))))
  ));
}

/** The plugin sections placed after one built-in Inspector section. */
export function PluginInspectorSectionList({
  items,
  pluginApi,
  libraryId,
  selectedAssetIds,
  selectedAssets,
  disabled = false,
  context,
}: {
  items: readonly PluginInspectorSectionDescriptor[];
  pluginApi: KeelPluginManagerApi | undefined;
  libraryId: string | undefined;
  selectedAssetIds: readonly string[];
  selectedAssets?: readonly PluginInvocationAssetSource[];
  disabled?: boolean;
  context?: PluginContributionContext;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <section className="inspector-section plugin-inspector-section" key={item.id}>
          <div className="plugin-inspector-section-header">
            <span className="inspector-section-label">{item.sectionLabel}</span>
            <button
              className="plugin-inspector-section-action"
              disabled={disabled || item.disabled}
              aria-pressed={item.checked}
              onClick={() => {
                if (pluginApi === undefined || libraryId === undefined) return;
                void runPluginMenuCommand(pluginApi, libraryId, item, {
                  assetIds: [...selectedAssetIds],
                  ...(selectedAssets === undefined || selectedAssets.length === 0
                    ? {}
                    : { assets: selectedAssets }),
                  contributionContext: context,
                });
              }}
              type="button"
            >
              {item.actionLabel}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
