import { useCallback, type MutableRefObject } from "react";

import type { AssetSummary } from "../shared/asset-types";
import type { KeelLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import {
  resolveFolderDrop,
  resolveTrashDrop,
  type DragAssetFact,
  type DragDropMode,
} from "./asset-drag-drop";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";

export type UseAssetDragDropHandlersParams = {
  api: KeelLibraryApi | null;
  library: RendererLibrarySummary | null;
  assets: AssetSummary[];
  assetScope: string;
  setNotice: (message: string, historyEntryId?: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  clearAssetSelection: () => void;
  trashManagedAssets: (assetIds: string[]) => Promise<string | undefined>;
  reloadCurrentContentRef: MutableRefObject<() => Promise<void>>;
};

/**
 * Internal canvas DnD executors (Serpent-uye). Pure drop decisions stay in
 * `asset-drag-drop.ts`; this hook only resolves asset facts and runs commands.
 */
export function useAssetDragDropHandlers({
  api,
  library,
  assets,
  assetScope,
  setNotice,
  setError,
  setUiState,
  clearAssetSelection,
  trashManagedAssets,
  reloadCurrentContentRef,
}: UseAssetDragDropHandlersParams) {
  const t = useT();
  const { locale } = useLocale();

  const dragAssetFacts = useCallback(
    (assetIds: string[]): DragAssetFact[] =>
      assetIds.map((assetId) => {
        const summary = assets.find((candidate) => candidate.assetId === assetId);
        return {
          assetId,
          // Unknown summaries (paged out) fail closed: treated as ineligible.
          locationKind: summary?.locationKind ?? "linked",
          availability: summary?.availability ?? "missing",
          deletedAt: summary?.deletedAt ?? null,
        };
      }),
    [assets],
  );

  const handleAssetsDroppedOnFolder = useCallback(
    (targetFolderId: string | null, assetIds: string[], mode: DragDropMode) => {
      if (!api || !library) return;
      const resolution = resolveFolderDrop({
        targetFolderId,
        // The root row (targetFolderId null) matches the "root" scope; the
        // "all" scope is not a folder and never blocks a drop.
        currentFolderId: assetScope === "root" ? null : assetScope,
        assets: dragAssetFacts(assetIds),
        mode,
      });
      if (resolution.kind === "reject") {
        if (resolution.reason === "same-folder") {
          // Serpent-374266: the asset is already in that folder — nothing
          // changed, so the drop stays silent instead of explaining a no-op.
          return;
        }
        setNotice(t("toast.noMovableAssets"));
        return;
      }
      void (async () => {
        setUiState("loading");
        try {
          const factsById = new Map(
            dragAssetFacts(resolution.assetIds).map((fact) => [fact.assetId, fact]),
          );
          const managedIds = resolution.assetIds.filter(
            (assetId) => factsById.get(assetId)?.locationKind === "managed",
          );
          const linkedIds = resolution.assetIds.filter(
            (assetId) => factsById.get(assetId)?.locationKind === "linked",
          );
          let movedCount = 0;
          let copiedCount = 0;
          let skippedCount = 0;
          let historyEntryId: string | undefined;

          if (managedIds.length > 0) {
            if (resolution.kind === "copy") {
              const result = await api.copyAssets({
                libraryId: library.libraryId,
                assetIds: managedIds,
                targetFolderId,
                conflictStrategy: "keep-both",
              });
              if (!result.ok) throw new LibraryOperationError(result.error);
              copiedCount += result.value.copiedCount;
              skippedCount += result.value.skippedCount;
              historyEntryId ??= result.value.historyEntryId;
            } else {
              const result = await api.moveAssets({
                libraryId: library.libraryId,
                assetIds: managedIds,
                targetFolderId,
                conflictStrategy: "keep-both",
              });
              if (!result.ok) throw new LibraryOperationError(result.error);
              movedCount += result.value.movedCount;
              skippedCount += result.value.skippedCount;
              historyEntryId ??= result.value.historyEntryId;
            }
          }
          if (linkedIds.length > 0) {
            const result = await api.copyAssets({
              libraryId: library.libraryId,
              assetIds: linkedIds,
              targetFolderId,
              conflictStrategy: "keep-both",
            });
            if (!result.ok) throw new LibraryOperationError(result.error);
            copiedCount += result.value.copiedCount;
            skippedCount += result.value.skippedCount;
            historyEntryId ??= result.value.historyEntryId;
          }

          const affectedCount = movedCount + copiedCount;
          const message = resolution.kind === "copy" || linkedIds.length > 0
            ? t("toast.copiedCount", { count: affectedCount })
            : t("toast.movedCount", { count: affectedCount });
          setNotice(
            message +
              (skippedCount
                ? t("toast.conflictSkippedSuffix", { count: skippedCount })
                : "") +
              (resolution.skippedCount
                ? t("toast.unavailableSkippedSuffix", {
                    count: resolution.skippedCount,
                  })
                : "") +
              t("common.sentenceEnd"),
            historyEntryId,
          );
          clearAssetSelection();
          await reloadCurrentContentRef.current();
        } catch (caught) {
          setError(
            toMessage(
              caught,
              resolution.kind === "copy"
                ? t("toast.copyFailed")
                : t("toast.moveFailed"),
              locale,
            ),
          );
        } finally {
          setUiState("ready");
        }
      })();
    },
    [
      api,
      library,
      assetScope,
      dragAssetFacts,
      setNotice,
      setError,
      setUiState,
      clearAssetSelection,
      reloadCurrentContentRef,
      locale,
      t,
    ],
  );

  const handleAssetsDroppedOnTrash = useCallback(
    (assetIds: string[]) => {
      if (!api || !library) return;
      const { assetIds: eligible, skippedCount } = resolveTrashDrop(
        dragAssetFacts(assetIds),
      );
      if (eligible.length === 0) {
        setNotice(t("toast.noTrashableAssets"));
        return;
      }
      void (async () => {
        const historyEntryId = await trashManagedAssets(eligible);
        if (skippedCount > 0) {
          setNotice(
            t("toast.trashedWithSkipped", {
              count: eligible.length,
              skipped: skippedCount,
            }),
            historyEntryId,
          );
        }
      })();
    },
    [api, library, dragAssetFacts, trashManagedAssets, setNotice, t],
  );

  return {
    handleAssetsDroppedOnFolder,
    handleAssetsDroppedOnTrash,
  };
}
