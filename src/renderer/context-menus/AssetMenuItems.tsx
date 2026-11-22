import type { AppLocale } from "../i18n/types";
import type { ContextMenuDescriptor } from "../workbench/menu/context-menu";
import type { PluginMenuHostPlacement } from "../plugins/plugin-menu-contributions";
import type { TranslateFn } from "../i18n/LocaleProvider";
import { useAssetContextMenuActions } from "./menu-shared";
import { LOCAL_SEMANTIC_ENCODE_MODALITIES, embeddingInputModalitiesForAdapter } from "../../shared/embedding/modalities";
import { isSemanticSearchModelId } from "../../shared/embedding/profile";
import { assetParentFolderCoverTarget } from "../../shared/folder-cover-target";
import { ColorSpaceSubmenuItems } from "../viewer/ColorSpacePickerMenu";
import { type AssetCommandContext } from "../commands/asset-commands";
import { canFindSimilarForAsset } from "../ai/find-similar";
import { Icon } from "../common/Icons";
import { type PluginMenuDescriptor } from "../plugins/plugin-menu-contributions";
import { type NavigationState } from "../stores/navigation-store";
import { TagPickerEntry, TagPickerMenu } from "../tags/TagPickerMenu";
import { ContextMenuItem, ContextMenuSection, ContextMenuSubmenu } from "../workbench/menu/context-menu";
import { PluginMenuCommandsSection, PluginMenuItems, assetCommandRegistry, isMac, pluginItemsAtHostAnchor, pluginItemsForHostGroup, pluginItemsOutsideHostGroups } from "./menu-shared";

export interface AssetMenuItemsProps {
  activeContextMenu: NonNullable<{ descriptor: ContextMenuDescriptor; position: { x: number; y: number; }; } | null>;
  assets: { assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "ready" | "pending" | "failed" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[];
  pasteTargetFolderId: string | null | undefined;
  locale: AppLocale;
  canAnalyze: boolean;
  t: TranslateFn;
  pluginAssetMenuPlacement: PluginMenuHostPlacement;
  runPluginCommand: (item: PluginMenuDescriptor, context: { assetIds?: string[]; folderIds?: string[]; }) => void;
  tags: NavigationState["tags"];
  aiDisconnected: boolean;
}

/** Extracted from AssetContextMenu (P4); renders the same elements. */
export function AssetMenuItems({ activeContextMenu, assets, pasteTargetFolderId, locale, canAnalyze, t, pluginAssetMenuPlacement, runPluginCommand, tags, aiDisconnected }: AssetMenuItemsProps) {
  const { embeddingSelectionId = null, embeddingAdapter = null, embeddingModalities = null, semanticSearchEnabled, onViewAsset, onOpenExternal, onRevealInFolder, onShowInLibraryFolder, onFindSimilar, onCopyAssetFiles, onPasteIntoFolder, onCopyFilePath, onRenameAssetFile, onAnalyze, onClearAiContent, onTrash, onDeleteFromDisk, onMoveToFolder, onRelink, onRestore, onPermanentDelete, onSetAssetColorSpace, openWithPrograms = [], onOpenWithProgram, onOpenWithPicker, onUseAssetAsFolderCover, onSetImageSequenceFps, onDissolveImageSequence, onSetIgnore, onAssignTag } = useAssetContextMenuActions();
  return (
<>
{activeContextMenu.descriptor.type === "asset" &&
          (() => {
            const {
              assetId,
              displayName,
              locationKind,
              isAvailable,
              isDeleted,
            } = activeContextMenu.descriptor;
            const singleManaged = locationKind === "managed";
            const singleAsset = assets.find((asset) => asset.assetId === assetId);
            const parentFolderCoverId = !isDeleted && singleAsset
              ? assetParentFolderCoverTarget(singleAsset)
              : null;
            const resolvedPasteTarget =
              pasteTargetFolderId ??
              (singleManaged ? singleAsset?.managedFolderId ?? null : null);
            // 0015-B: 静态项的标题/快捷键/可见性/禁用原因由注册表 resolveMenu
            // 求值；此处把 descriptor 与 props 组装成 AssetCommandContext。
            // 动态行（外部目录、合集、标签）与汇总/提示块保持内联不变。
            const sourceModalities = !embeddingSelectionId
              ? []
              : isSemanticSearchModelId(embeddingSelectionId)
                ? LOCAL_SEMANTIC_ENCODE_MODALITIES
                : embeddingAdapter
                  ? embeddingInputModalitiesForAdapter(embeddingAdapter, embeddingModalities ?? ["text"])
                  : [];
            const sourceSupported = Boolean(singleAsset && semanticSearchEnabled
              && canFindSimilarForAsset(singleAsset, sourceModalities));
            const commandContext: AssetCommandContext = {
              surface: "asset-single",
              locale,
              platform: isMac ? "mac" : "windows",
              selectedAssetIds: [assetId],
              primaryAssetId: assetId,
              assetScope: "single",
              trashMode: isDeleted,
              locationKind,
              assetAvailable: isAvailable,
              assetDeleted: isDeleted,
              aiCanAnalyze: canAnalyze,
              pasteTargetFolderId: resolvedPasteTarget,
              semanticSearchEnabled,
              similarSourceSupported: sourceSupported,
              actions: {
                view: onViewAsset,
                openExternal: onOpenExternal,
                revealInFolder: onRevealInFolder,
                showInLibraryFolder: onShowInLibraryFolder,
                findSimilar: onFindSimilar,
                copyFiles: onCopyAssetFiles,
                pasteIntoFolder: onPasteIntoFolder,
                copyFilePath: onCopyFilePath,
                rename: onRenameAssetFile,
                aiAnalyze: onAnalyze,
                clearAiContent: onClearAiContent,
                moveToTrash: onTrash,
                deleteFromDisk: onDeleteFromDisk,
                moveToFolder: onMoveToFolder,
                relink: onRelink,
                restore: onRestore,
                deletePermanent: onPermanentDelete,
              },
            };
            const resolvedById = new Map(
              assetCommandRegistry
                .resolveMenu(commandContext)
                .map((item) => [item.id, item]),
            );
            const runAssetCommand = (id: string) => {
              const item = resolvedById.get(id);
              if (!item || item.disabled) return;
              void assetCommandRegistry.get(id)?.run(commandContext);
            };
            const restoreItem = resolvedById.get("asset.restore");
            const deletePermanentItem = resolvedById.get(
              "asset.delete-permanent",
            );
            const openExternalItem = resolvedById.get("asset.open-external");
            const viewItem = resolvedById.get("asset.view");
            const revealInFolderItem = resolvedById.get(
              "asset.reveal-in-folder",
            );
            const showInLibraryFolderItem = resolvedById.get(
              "asset.show-in-library-folder",
            );
            const findSimilarItem = resolvedById.get("asset.find-similar");
            const relinkItem = resolvedById.get("asset.relink");
            const moveToFolderItem = resolvedById.get("asset.move-to-folder");
            const copyItem = resolvedById.get("asset.copy");
            const pasteItem = resolvedById.get("asset.paste");
            const copyFilePathItem = resolvedById.get("asset.copy-file-path");
            const renameItem = resolvedById.get("asset.rename");
            const aiAnalyzeItem = resolvedById.get("asset.ai-analyze");
            const clearAiContentItem = resolvedById.get("asset.clear-ai-content");
            const moveToTrashItem = resolvedById.get("asset.move-to-trash");
            const deleteFromDiskItem = resolvedById.get(
              "asset.delete-from-disk",
            );
            return (
              <>
                <div className="context-menu-selection-summary">
                  {t("common.selectedCount", { count: 1 })}
                </div>
                {isDeleted ? (
                  <ContextMenuSection label={t("command.group.trashActions")}>
                    {restoreItem && (
                      <ContextMenuItem
                        icon={<Icon name="upload" size={14} />}
                        label={restoreItem.label}
                        onAction={() => runAssetCommand("asset.restore")}
                      />
                    )}
                    {deletePermanentItem && (
                      <ContextMenuItem
                        icon={<Icon name="trash" size={14} />}
                        label={deletePermanentItem.label}
                        danger
                        onAction={() =>
                          runAssetCommand("asset.delete-permanent")
                        }
                      />
                    )}
                  </ContextMenuSection>
                ) : (
                  <>
                <ContextMenuSection label={t("command.group.open")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "open", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {viewItem && (
                    <ContextMenuItem
                      icon={<Icon name="file" size={14} />}
                      label={viewItem.label}
                      shortcut={viewItem.shortcutLabel ?? undefined}
                      disabled={viewItem.disabled}
                      disabledReason={viewItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.view")}
                    />
                  )}
                  {singleAsset && (singleAsset.mediaType === "image" || singleAsset.mediaType === "video") && (
                    <ContextMenuSubmenu
                      icon={<Icon name="sliders" size={14} />}
                      label={t("menu.colorSpace")}
                    >
                      <ColorSpaceSubmenuItems
                        onPick={(colorSpace) =>
                          onSetAssetColorSpace(assetId, colorSpace)
                        }
                      />
                    </ContextMenuSubmenu>
                  )}
                  {openExternalItem && (
                    <ContextMenuItem
                      icon={<Icon name="upload" size={14} />}
                      label={openExternalItem.label}
                      shortcut={openExternalItem.shortcutLabel ?? undefined}
                      disabled={openExternalItem.disabled}
                      disabledReason={
                        openExternalItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.open-external")}
                    />
                  )}
                  {openExternalItem && !openExternalItem.disabled && (
                    <ContextMenuSubmenu
                      icon={<Icon name="external-link" size={14} />}
                      label={t("menu.openWith")}
                    >
                      <ContextMenuItem
                        label={t("menu.openWithViewer")}
                        onAction={() => onViewAsset(assetId)}
                      />
                      <ContextMenuItem
                        label={t("menu.openWithSystem")}
                        onAction={() => onOpenExternal(assetId)}
                      />
                      {openWithPrograms.map((program) => (
                        <ContextMenuItem
                          key={program.programId}
                          label={program.name}
                          onAction={() => onOpenWithProgram?.(assetId, program.programId)}
                        />
                      ))}
                      {onOpenWithPicker && (
                        <ContextMenuItem
                          label={t("menu.openWithOther")}
                          onAction={() => onOpenWithPicker(assetId)}
                        />
                      )}
                    </ContextMenuSubmenu>
                  )}
                  {revealInFolderItem && (
                    <ContextMenuItem
                      icon={<Icon name="folder" size={14} />}
                      label={revealInFolderItem.label}
                      shortcut={revealInFolderItem.shortcutLabel ?? undefined}
                      disabled={revealInFolderItem.disabled}
                      disabledReason={
                        revealInFolderItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runAssetCommand("asset.reveal-in-folder")
                      }
                    />
                  )}
                  {showInLibraryFolderItem && (
                    <ContextMenuItem
                      icon={<Icon name="folder-tree" size={14} />}
                      label={showInLibraryFolderItem.label}
                      shortcut={showInLibraryFolderItem.shortcutLabel ?? undefined}
                      disabled={showInLibraryFolderItem.disabled}
                      disabledReason={
                        showInLibraryFolderItem.disabledReason ?? undefined
                      }
                      onAction={() =>
                        runAssetCommand("asset.show-in-library-folder")
                      }
                    />
                  )}
                  {findSimilarItem && (
                    <ContextMenuItem
                      icon={<Icon name="scan-qr-code" size={14} />}
                      label={findSimilarItem.label}
                      disabled={findSimilarItem.disabled}
                      disabledReason={findSimilarItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.find-similar")}
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "open", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                {pluginItemsOutsideHostGroups(pluginAssetMenuPlacement).length > 0 && (
                  <PluginMenuCommandsSection
                    items={pluginItemsOutsideHostGroups(pluginAssetMenuPlacement)}
                    label={t("contextMenu.pluginCommands")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                )}
                <ContextMenuSection label={t("command.group.organize")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "organize", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {parentFolderCoverId ? (
                    <ContextMenuItem
                      icon={<Icon name="file" size={14} />}
                      label={t("command.asset.useAsFolderCover")}
                      onAction={() => onUseAssetAsFolderCover(assetId, parentFolderCoverId)}
                    />
                  ) : null}
                  {singleAsset?.sequence ? (
                    <ContextMenuItem
                      icon={<Icon name="sliders" size={14} />}
                      label={t("menu.setImageSequenceFps")}
                      onAction={() =>
                        onSetImageSequenceFps(
                          singleAsset.sequence!.sequenceId,
                          singleAsset.sequence!.frameCount,
                          singleAsset.sequence!.fps,
                        )
                      }
                    />
                  ) : null}
                  {singleAsset?.sequence ? (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={t("menu.dissolveImageSequence")}
                      onAction={() =>
                        onDissolveImageSequence(
                          singleAsset.sequence!.sequenceId,
                        )
                      }
                    />
                  ) : null}
                  {relinkItem && (
                    <ContextMenuItem
                      icon={<Icon name="search" size={14} />}
                      label={relinkItem.label}
                      onAction={() => runAssetCommand("asset.relink")}
                    />
                  )}
                  {moveToFolderItem && (
                    <ContextMenuItem
                      icon={<Icon name="folder" size={14} />}
                      label={moveToFolderItem.label}
                      onAction={() => runAssetCommand("asset.move-to-folder")}
                    />
                  )}
                  {copyItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={copyItem.label}
                      shortcut={copyItem.shortcutLabel ?? undefined}
                      disabled={copyItem.disabled}
                      disabledReason={copyItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.copy")}
                    />
                  )}
                  {pasteItem && (
                    <ContextMenuItem
                      icon={<Icon name="clipboard" size={14} />}
                      label={pasteItem.label}
                      shortcut={pasteItem.shortcutLabel ?? undefined}
                      onAction={() => runAssetCommand("asset.paste")}
                    />
                  )}
                  {copyFilePathItem && (
                    <ContextMenuItem
                      icon={<Icon name="file" size={14} />}
                      label={copyFilePathItem.label}
                      shortcut={copyFilePathItem.shortcutLabel ?? undefined}
                      disabled={copyFilePathItem.disabled}
                      disabledReason={
                        copyFilePathItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.copy-file-path")}
                    />
                  )}
                  {renameItem && (
                    <>
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginAssetMenuPlacement, "asset.rename", "before")}
                      onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                    />
                    <ContextMenuItem
                      icon={<Icon name="edit" size={14} />}
                      label={renameItem.label}
                      shortcut={renameItem.shortcutLabel ?? undefined}
                      disabled={renameItem.disabled}
                      disabledReason={renameItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.rename")}
                    />
                    <PluginMenuItems
                      items={pluginItemsAtHostAnchor(pluginAssetMenuPlacement, "asset.rename", "after")}
                      onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                    />
                    </>
                  )}
                  <ContextMenuItem
                    icon={<Icon name="close" size={14} />}
                    label={t("menu.ignore")}
                    onAction={() => {
                      const relativePath = singleAsset?.relativeFilePath;
                      if (!relativePath) return;
                      onSetIgnore({
                        locationKind,
                        linkedFolderId: singleAsset?.locationKind === "linked"
                          ? singleAsset.linkedFolderId
                          : null,
                        relativePath,
                        pathKind: "asset",
                        ignored: true,
                        name: displayName,
                      });
                    }}
                  />
                  {singleAsset?.relativeFilePath?.includes(".") && (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={t("menu.ignoreExtension", {
                        extension: singleAsset.relativeFilePath.split(".").pop()?.toLowerCase() ?? "",
                      })}
                      onAction={() => {
                        const extension = singleAsset.relativeFilePath.split(".").pop()?.toLowerCase();
                        if (!extension) return;
                        onSetIgnore({
                          locationKind,
                          linkedFolderId: singleAsset.locationKind === "linked" ? singleAsset.linkedFolderId : null,
                          relativePath: extension,
                          pathKind: "extension",
                          ignored: true,
                          name: extension,
                        });
                      }}
                    />
                  )}
                  {tags.length > 0 && (
                    <TagPickerEntry
                      icon={<Icon name="tag" size={14} />}
                      label={t("command.asset.addTags")}
                    >
                      {() => (
                        <TagPickerMenu
                          mode="assign"
                          onPick={(tagId) => onAssignTag(assetId, tagId)}
                          tags={tags}
                        />
                      )}
                    </TagPickerEntry>
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "organize", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                <ContextMenuSection label={t("command.group.metadata")}>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "metadata", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
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
                      onAction={() => runAssetCommand("asset.ai-analyze")}
                    />
                  )}
                  {clearAiContentItem && (
                    <ContextMenuItem
                      icon={<Icon name="close" size={14} />}
                      label={clearAiContentItem.label}
                      disabled={clearAiContentItem.disabled}
                      disabledReason={clearAiContentItem.disabledReason ?? undefined}
                      onAction={() => runAssetCommand("asset.clear-ai-content")}
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "metadata", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                <ContextMenuSection>
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "delete", "before")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                  {moveToTrashItem && (
                    <ContextMenuItem
                      icon={<Icon name="trash" size={14} />}
                      label={moveToTrashItem.label}
                      shortcut={moveToTrashItem.shortcutLabel ?? undefined}
                      danger
                      disabled={moveToTrashItem.disabled}
                      disabledReason={
                        moveToTrashItem.disabledReason ?? undefined
                      }
                      onAction={() => runAssetCommand("asset.move-to-trash")}
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
                      onAction={() =>
                        runAssetCommand("asset.delete-from-disk")
                      }
                    />
                  )}
                  <PluginMenuItems
                    items={pluginItemsForHostGroup(pluginAssetMenuPlacement, "delete", "after")}
                    onRun={(item) => runPluginCommand(item, { assetIds: [assetId] })}
                  />
                </ContextMenuSection>
                  </>
                )}
              </>
            );
          })()}
</>
  );
}
