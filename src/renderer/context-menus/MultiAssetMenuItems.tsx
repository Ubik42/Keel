import type { AppLocale } from "../i18n/types";
import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { PluginMenuHostPlacement } from "../plugins/plugin-menu-contributions";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { Dispatch, SetStateAction } from "react";
import { useAssetContextMenuActions } from "./menu-shared";
import { parseLinkedVirtualFolderId } from "../../shared/linked-folder-tree";
import { type AssetMultiCommandContext } from "../commands/asset-multi-commands";
import { AppearanceSubmenu } from "../appearance/AppearanceSubmenu";
import { planFolderBatch } from "../folders/folder-batch-actions";
import { Icon } from "../common/Icons";
import { canCreateImageSequenceFromSelection } from "../import/image-sequence-selection";
import { buildMultiAssetMenuSkipReport, formatMultiAssetMenuSkipFooter } from "../jobs/menu-skip-report";
import { placeMultiAssetPluginMenuItems, type PluginMenuDescriptor } from "../plugins/plugin-menu-contributions";
import { type BrowseState } from "../stores/browse-store";
import { type NavigationState } from "../stores/navigation-store";
import { TagPickerEntry, TagPickerMenu } from "../tags/TagPickerMenu";
import { ContextMenuItem, ContextMenuSection } from "../workbench/menu/context-menu";
import { FolderCoverMenuItems, PluginMenuCommandsSection, PluginMenuItems, assetMultiCommandRegistry, isMac, pluginItemsOutsideHostGroups, type TagPickerState } from "./menu-shared";

export interface MultiAssetMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  assets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  linkedFolders: NavigationState["linkedFolders"];
  managedFolders: NavigationState["folders"];
  locale: AppLocale;
  pluginAssetMenuPlacement: PluginMenuHostPlacement;
  aiPendingAssetIds: readonly string[];
  pasteTargetFolderId: string | null | undefined;
  setTagPicker: Dispatch<SetStateAction<TagPickerState | null>>;
  t: TranslateFn;
  canAnalyze: boolean;
  aiDisconnected: boolean;
  runPluginCommand: (item: PluginMenuDescriptor, context: { assetIds?: string[]; folderIds?: string[]; }) => void;
  tags: NavigationState["tags"];
  customFolderCoverIds: BrowseState["folderCustomCoverIds"];
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function MultiAssetMenuItems({ activeContextMenu, assets, linkedFolders, managedFolders, locale, pluginAssetMenuPlacement, aiPendingAssetIds, pasteTargetFolderId, setTagPicker, t, canAnalyze, aiDisconnected, runPluginCommand, tags, customFolderCoverIds }: MultiAssetMenuItemsProps) {
  const { menuSkipScope, onCopyAssetFiles, onPasteIntoFolder, onMoveToFolder, onTrash, onDeleteFromDisk, onRestore, onPermanentDelete, onClearSelection, onAnalyze, onClearAiContent, onSetEntityAppearance, onSetIgnore, onCreateImageSequence, onDissolveImageSequences, onBatchAssignTag, onBatchRemoveTag, onChooseFolderCover, onChooseFolderCoverFromLibrary, onClearFolderCover } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "multi-asset" &&
          (() => {
            const descriptor = activeContextMenu.descriptor;
            const targetAssetIds = [...descriptor.assetIds];
            const targetFolderIds = [...(descriptor.folderIds ?? [])];
            const targetIdSet = new Set(targetAssetIds);
            const targetAssets = assets.filter((asset) =>
              targetIdSet.has(asset.assetId),
            );
            // REQ-MENU-004: process/skip counts + reasons from a
            // pure module (folders join trash/disk-delete; move skips them).
            const skipReport = buildMultiAssetMenuSkipReport(
              targetAssetIds,
              targetAssets,
              targetFolderIds,
              menuSkipScope,
            );
            const trashAssetIds = [...skipReport.trash.processAssetIds];
            const linkedIdSet = new Set(
              targetAssets
                .filter((asset) => asset.locationKind === "linked")
                .map((asset) => asset.assetId),
            );
            const linkedAssetIds = trashAssetIds.filter((assetId) =>
              linkedIdSet.has(assetId),
            );
            const managedAssetIds = trashAssetIds.filter(
              (assetId) => !linkedIdSet.has(assetId),
            );
            const availableManagedAssetIds = [
              ...skipReport.move.processAssetIds,
            ];
            const loadedAvailableIds = targetAssets
              .filter((asset) => asset.availability === "available")
              .map((asset) => asset.assetId);
            const loadedAvailableSet = new Set(loadedAvailableIds);
            const availableAssetIds = [
              ...loadedAvailableIds,
              ...availableManagedAssetIds.filter(
                (assetId) => !loadedAvailableSet.has(assetId),
              ),
            ];
            const processFolderIds = [...skipReport.trash.processFolderIds];
            const moveFolderIds = [...skipReport.move.processFolderIds];
            // 多选文件夹的「设置图标 / 忽略」资格与跳过原因由
            // folder-batch-actions 统一计算（链接子目录、资源库根等会被跳过）。
            const linkedRootFolders = linkedFolders.map((folder) => ({
              folderId: folder.folderId,
              name: folder.displayName,
              relativePath: folder.relativePath ?? "",
            }));
            const appearancePlan = planFolderBatch({
              folderIds: targetFolderIds,
              managedFolders,
              linkedFolders: linkedRootFolders,
              action: "appearance",
            });
            const coverPlan = planFolderBatch({
              folderIds: targetFolderIds,
              managedFolders,
              linkedFolders: linkedRootFolders,
              action: "cover",
            });
            const ignorePlan = planFolderBatch({
              folderIds: targetFolderIds,
              managedFolders,
              linkedFolders: linkedRootFolders,
              action: "ignore",
            });
            const allTrashed = skipReport.allTrashed;
            const canCreateImageSequence = canCreateImageSequenceFromSelection({
              selectedCount: targetAssetIds.length,
              loadedSelectedAssets: targetAssets,
            });
            const sequenceIdsToDissolve = targetAssets
              .map((asset) => asset.sequence?.sequenceId)
              .filter((sequenceId): sequenceId is string => sequenceId !== undefined);
            const canDissolveImageSequences =
              targetAssets.length === targetAssetIds.length &&
              targetAssets.length > 0 &&
              sequenceIdsToDissolve.length === targetAssets.length;
            const skipFooter = formatMultiAssetMenuSkipFooter(
              skipReport,
              locale,
            );
            const multiAssetPluginPlacement = placeMultiAssetPluginMenuItems(
              pluginAssetMenuPlacement,
            );

            // 0015-C: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把每次打开时算出的集合与 props 组装成
            // AssetMultiCommandContext。动态行（批量合集、外部目录）保持内联；
            // 跳过报告由 menu-skip-report 生成简洁页脚。
            const commandContext: AssetMultiCommandContext = {
              surface: "asset-multi",
              locale,
              platform: isMac ? "mac" : "windows",
              selectedAssetIds: targetAssetIds,
              primaryAssetId: null,
              assetScope: "multi",
              trashMode: allTrashed,
              selectionCount: skipReport.selectionCount,
              aiPendingAssetIds,
              managedCount: managedAssetIds.length,
              availableManagedCount: availableManagedAssetIds.length,
              linkedCount: linkedAssetIds.length,
              linkedAssetIds,
              folderCount: moveFolderIds.length,
              processFolderIds: moveFolderIds,
              trashedAll: allTrashed,
              managedAssetIds,
              availableManagedAssetIds,
              availableAssetIds,
              pasteTargetFolderId,
              appearanceFolderTargets: appearancePlan.targets,
              ignoreFolderTargets: ignorePlan.targets,
              actions: {
                openAssignTagPicker: (assetIds) =>
                  setTagPicker({ mode: "assign", assetIds, single: false }),
                openRemoveTagPicker: (assetIds) =>
                  setTagPicker({ mode: "remove", assetIds, single: false }),
                copyFiles: onCopyAssetFiles,
                pasteIntoFolder: onPasteIntoFolder,
                moveToFolder: onMoveToFolder,
                moveToTrash: (assetIds, folderIds) =>
                  onTrash(assetIds, folderIds ?? processFolderIds),
                deleteFromDisk: (assetIds, folderIds) =>
                  onDeleteFromDisk(assetIds, folderIds ?? processFolderIds),
                restore: onRestore,
                deletePermanent: onPermanentDelete,
                clearSelection: onClearSelection,
                aiAnalyze: (assetIds) => {
                  const primary = assetIds[0];
                  if (!primary) return;
                  onAnalyze(primary, assetIds);
                },
                clearAiContent: onClearAiContent,
                setFolderAppearance: (targets, appearance) => {
                  for (const target of targets) {
                    onSetEntityAppearance(
                      { kind: target.kind, id: target.folderId },
                      appearance,
                    );
                  }
                },
                ignoreSelection: ({ assetIds, folderTargets }) => {
                  const assetById = new Map(
                    assets.map((asset) => [asset.assetId, asset]),
                  );
                  for (const assetId of assetIds) {
                    const asset = assetById.get(assetId);
                    if (!asset) continue;
                    onSetIgnore({
                      locationKind: asset.locationKind,
                      linkedFolderId: asset.linkedFolderId ?? null,
                      relativePath: asset.relativeFilePath,
                      pathKind: "asset",
                      ignored: true,
                      name: asset.displayName,
                    });
                  }
                  for (const target of folderTargets) {
                    const linkedRef = parseLinkedVirtualFolderId(target.folderId);
                    onSetIgnore({
                      locationKind:
                        target.kind === "linked-folder" ? "linked" : "managed",
                      linkedFolderId:
                        target.kind === "linked-folder"
                          ? linkedRef?.linkedFolderId ?? target.folderId
                          : null,
                      relativePath: target.relativePath,
                      pathKind: "folder",
                      ignored: true,
                      name: target.name,
                    });
                  }
                },
              },
            };
            const resolvedById = new Map(
              assetMultiCommandRegistry
                .resolveMenu(commandContext)
                .map((item) => [item.id, item]),
            );
            const runMultiCommand = (id: string) => {
              const item = resolvedById.get(id);
              if (!item || item.disabled) return;
              void assetMultiCommandRegistry.get(id)?.run(commandContext);
            };
            const restoreItem = resolvedById.get("assets.restore");
            const deletePermanentItem = resolvedById.get(
              "assets.delete-permanent",
            );
            const assignTagItem = resolvedById.get("assets.assign-tag");
            const removeTagItem = resolvedById.get("assets.remove-tag");
            const aiAnalyzeMissingItem = resolvedById.get("assets.ai-analyze-pending");
            const aiAnalyzeItem = resolvedById.get("assets.ai-analyze");
            const clearAiContentItem = resolvedById.get("assets.clear-ai-content");
            const moveToFolderItem = resolvedById.get("assets.move-to-folder");
            const appearanceItem = resolvedById.get("assets.appearance");
            const ignoreItem = resolvedById.get("assets.ignore");
            const copyItem = resolvedById.get("assets.copy");
            const pasteItem = resolvedById.get("assets.paste");
            const moveToTrashItem = resolvedById.get("assets.move-to-trash");
            const deleteFromDiskItem = resolvedById.get(
              "assets.delete-from-disk",
            );
            const clearSelectionItem = resolvedById.get(
              "assets.clear-selection",
            );

            return (
              <>
                <div className="context-menu-selection-summary">
                  {t("common.selectedCount", {
                    count: skipReport.selectionCount,
                  })}
                </div>
                {allTrashed ? (
                  <ContextMenuSection label={t("command.group.trashActions")}>
                    {restoreItem && (
                      <ContextMenuItem
                        icon={<Icon name="upload" size={14} />}
                        label={restoreItem.label}
                        onAction={() => runMultiCommand("assets.restore")}
                      />
                    )}
                    {deletePermanentItem && (
                      <ContextMenuItem
                        icon={<Icon name="trash" size={14} />}
                        label={deletePermanentItem.label}
                        danger
                        onAction={() =>
                          runMultiCommand("assets.delete-permanent")
                        }
                      />
                    )}
                  </ContextMenuSection>
                ) : (
                  <>
                {skipFooter && (
                  <div className="context-menu-scope-note" role="note">
                    {skipFooter}
                  </div>
                )}
            {(targetAssetIds.length > 0 &&
              (aiAnalyzeMissingItem || aiAnalyzeItem || clearAiContentItem)) && (
              <ContextMenuSection label={t("command.group.metadata")}>
                {aiAnalyzeMissingItem && (
                  <ContextMenuItem
                    icon={<Icon name="smart" size={14} />}
                    label={
                      !canAnalyze
                        ? `${aiAnalyzeMissingItem.label}${t("command.reason.aiDisconnectedSuffix")}`
                        : aiAnalyzeMissingItem.label
                    }
                    disabled={aiAnalyzeMissingItem.disabled || !canAnalyze}
                    disabledReason={
                      !canAnalyze
                        ? t("command.reason.aiSetupHint")
                        : (aiAnalyzeMissingItem.disabledReason ?? undefined)
                    }
                    onAction={() => runMultiCommand("assets.ai-analyze-pending")}
                  />
                )}
                {aiAnalyzeItem && (
                  <ContextMenuItem
                    icon={
                      <Icon
                        name={aiDisconnected ? "link-off" : "smart"}
                        size={14}
                      />
                    }
                    label={
                      !canAnalyze
                        ? `${aiAnalyzeItem.label}${t("command.reason.aiDisconnectedSuffix")}`
                        : aiAnalyzeItem.label
                    }
                    disabled={aiAnalyzeItem.disabled || !canAnalyze}
                    disabledReason={
                      !canAnalyze
                        ? t("command.reason.aiSetupHint")
                        : (aiAnalyzeItem.disabledReason ?? undefined)
                    }
                    onAction={() => runMultiCommand("assets.ai-analyze")}
                  />
                )}
                {clearAiContentItem && (
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={clearAiContentItem.label}
                    disabled={clearAiContentItem.disabled}
                    disabledReason={clearAiContentItem.disabledReason ?? undefined}
                    onAction={() => runMultiCommand("assets.clear-ai-content")}
                  />
                )}
              </ContextMenuSection>
            )}
            {pluginItemsOutsideHostGroups(pluginAssetMenuPlacement).length > 0 && (
              <PluginMenuCommandsSection
                items={pluginItemsOutsideHostGroups(pluginAssetMenuPlacement)}
                label={t("contextMenu.pluginCommands")}
                onRun={(item) => runPluginCommand(item, { assetIds: targetAssetIds })}
              />
            )}
            {/* 只选文件夹卡片时同样要有组织区（移动到文件夹 /
                设置图标 / 忽略）；资产专属项（复制、粘贴、标签、合集、AI）各自
                另有闸门，不会因为放宽这一层而冒出来。 */}
            {(targetAssetIds.length > 0 || targetFolderIds.length > 0) && (
            <ContextMenuSection label={t("command.group.organize")}>
              <PluginMenuItems
                items={multiAssetPluginPlacement.organizeBefore}
                onRun={(item) => runPluginCommand(item, { assetIds: targetAssetIds })}
              />
              <ContextMenuItem
                icon={<Icon name="collection" size={14} />}
                label={t("menu.createImageSequence")}
                disabled={!canCreateImageSequence}
                onAction={() => onCreateImageSequence(targetAssetIds)}
              />
              {canDissolveImageSequences && (
                <ContextMenuItem
                  icon={<Icon name="close" size={14} />}
                  label={t("menu.dissolveImageSequencesCount", {
                    count: sequenceIdsToDissolve.length,
                  })}
                  onAction={() => onDissolveImageSequences(sequenceIdsToDissolve)}
                />
              )}
            {tags.length > 0 && assignTagItem && removeTagItem && (
              <ContextMenuSection label={t("command.group.batchTags")}>
                <TagPickerEntry
                  icon={<Icon name="tag" size={14} />}
                  label={assignTagItem.label}
                >
                  {() => (
                    <TagPickerMenu
                      mode="assign"
                      onPick={(tagId) => onBatchAssignTag(tagId, targetAssetIds)}
                      tags={tags}
                    />
                  )}
                </TagPickerEntry>
                <TagPickerEntry
                  icon={<Icon name="close" size={14} />}
                  label={removeTagItem.label}
                >
                  {() => (
                    <TagPickerMenu
                      mode="remove"
                      onPick={(tagId) => onBatchRemoveTag(tagId, targetAssetIds)}
                      tags={tags}
                    />
                  )}
                </TagPickerEntry>
              </ContextMenuSection>
            )}
              {moveToFolderItem && (
                <ContextMenuItem
                  icon={<Icon name="folder" size={14} />}
                  label={moveToFolderItem.label}
                  disabled={moveToFolderItem.disabled}
                  disabledReason={moveToFolderItem.disabledReason ?? undefined}
                  onAction={() => runMultiCommand("assets.move-to-folder")}
                />
              )}
              {appearanceItem && (
                <AppearanceSubmenu
                  label={appearanceItem.label}
                  value={null}
                  onChange={(appearance) =>
                    commandContext.actions.setFolderAppearance?.(
                      commandContext.appearanceFolderTargets,
                      appearance,
                    )
                  }
                />
              )}
              {coverPlan.targets.length > 0 ? (
                <FolderCoverMenuItems
                  folderIds={coverPlan.targets.map((target) => target.folderId)}
                  customFolderCoverIds={customFolderCoverIds}
                  onChooseFromFile={onChooseFolderCover}
                  onChooseFromLibrary={onChooseFolderCoverFromLibrary}
                  onClear={onClearFolderCover}
                />
              ) : null}
              <PluginMenuItems
                items={multiAssetPluginPlacement.organizeAfter}
                onRun={(item) => runPluginCommand(item, { assetIds: targetAssetIds })}
              />
              <ContextMenuItem
                icon={<Icon name="close" size={14} />}
                label={ignoreItem?.label ?? t("menu.ignore")}
                disabled={ignoreItem?.disabled ?? false}
                disabledReason={ignoreItem?.disabledReason ?? undefined}
                onAction={() => runMultiCommand("assets.ignore")}
              />
                  {copyItem && targetAssetIds.length > 0 && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={copyItem.label}
                      shortcut={copyItem.shortcutLabel ?? undefined}
                      disabled={copyItem.disabled}
                      disabledReason={copyItem.disabledReason ?? undefined}
                      onAction={() => runMultiCommand("assets.copy")}
                    />
                  )}
                  {pasteItem && targetAssetIds.length > 0 && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={pasteItem.label}
                      shortcut={pasteItem.shortcutLabel ?? undefined}
                      onAction={() => runMultiCommand("assets.paste")}
                    />
                  )}
            </ContextMenuSection>
            )}
            <ContextMenuSection>
              {moveToTrashItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={moveToTrashItem.label}
                  shortcut={moveToTrashItem.shortcutLabel ?? undefined}
                  danger
                  disabled={moveToTrashItem.disabled}
                  disabledReason={moveToTrashItem.disabledReason ?? undefined}
                  onAction={() => runMultiCommand("assets.move-to-trash")}
                />
              )}
              {deleteFromDiskItem && (
                <ContextMenuItem
                  icon={<Icon name="trash" size={14} />}
                  label={deleteFromDiskItem.label}
                  shortcut={deleteFromDiskItem.shortcutLabel ?? undefined}
                  danger
                  disabled={deleteFromDiskItem.disabled}
                  disabledReason={
                    deleteFromDiskItem.disabledReason ?? undefined
                  }
                  onAction={() => runMultiCommand("assets.delete-from-disk")}
                />
              )}
            </ContextMenuSection>
                  </>
                )}
            {clearSelectionItem && (
              <ContextMenuItem
                icon={<Icon name="close" size={14} />}
                label={clearSelectionItem.label}
                onAction={() => runMultiCommand("assets.clear-selection")}
              />
            )}
              </>
            );
          })()}
</>
  );
}
