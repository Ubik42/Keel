import type { Dispatch, SetStateAction } from "react";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import { type KeelLibraryApi } from "../../../shared/library-api";
import { LibraryOperationError, toMessage } from "../../common/error-utils";
import { type AppLocale } from "../../i18n";
import { mergeAssetSummaries } from "../../browse/merge-asset-summaries";
import { formatRelinkExamplePath } from "../../folders/RelinkPreview";
import { type BrowseState } from "../../stores/browse-store";
import { type SelectionState } from "../../stores/selection-store";
import { type SessionState } from "../../stores/session-store";
import { type TransfersState } from "../../stores/transfers-store";
import { playTaskCompletionSound } from "../../jobs/task-completion-sound";
import { useCallback } from "react";

export interface UseRelinkOperationsDeps {
  selectedAssetId: SelectionState["selectedAssetId"];
  api: KeelLibraryApi | undefined;
  library: SessionState["library"];
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setAssets: Dispatch<SetStateAction<BrowseState["assets"]>>;
  setNotice: (text: string | null, historyEntryId?: string) => void;
  t: TranslateFn;
  reloadCurrentContent: (options?: { blockingNavigation?: boolean; navigationPriority?: "mutation"; }) => Promise<void>;
  batchRelinkKeepMetadata: TransfersState["batchRelinkKeepMetadata"];
  setBatchRelinkPreview: Dispatch<SetStateAction<TransfersState["batchRelinkPreview"]>>;
  setError: (text: string | null) => void;
  locale: AppLocale;
  batchRelinkPreview: TransfersState["batchRelinkPreview"];
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useRelinkOperations({ selectedAssetId, api, library, setUiState, setAssets, setNotice, t, reloadCurrentContent, batchRelinkKeepMetadata, setBatchRelinkPreview, setError, locale, batchRelinkPreview }: UseRelinkOperationsDeps) {

  // --- Relink operations ---

  async function relinkMissingAsset(assetId = selectedAssetId) {
    if (!api || !library || !assetId) return;
    setUiState("loading");
    try {
      const result = await api.relinkAsset({
        libraryId: library.libraryId,
        assetId,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setAssets((current) =>
        mergeAssetSummaries(current, [result.value.asset]),
      );
      setNotice(t("toast.relinkSuccess"));
      await reloadCurrentContent();

      const preview = await api.relinkBatchPreviewAtRoot({
        libraryId: library.libraryId,
        newRootPath: result.value.batchFollowUpRoot,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!preview.ok) {
        if (preview.error.code === "CANCELLED") return;
        throw new LibraryOperationError(preview.error);
      }
      if (preview.value.matchedCount > 0) {
        setBatchRelinkPreview({
          preview: preview.value,
          priorRestoredCount: 1,
          priorRestoredExamples: [
            {
              relativeFilePath: formatRelinkExamplePath(
                result.value.asset.relativeFilePath,
              ),
              matched: true,
            },
          ],
        });
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.relinkFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function startBatchRelink() {
    if (!api || !library) return;
    setUiState("loading");
    try {
      const result = await api.relinkBatchPreview({
        libraryId: library.libraryId,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!result.ok) {
        if (result.error.code === "CANCELLED") return;
        throw new LibraryOperationError(result.error);
      }
      setBatchRelinkPreview({
        preview: result.value,
        priorRestoredCount: 0,
        priorRestoredExamples: [],
      });
    } catch (caught) {
      setError(toMessage(caught, t("toast.batchRelinkPreviewFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  async function applyBatchRelink() {
    if (!api || !library || !batchRelinkPreview) return;
    const startedAt = Date.now();
    setUiState("loading");
    try {
      const result = await api.relinkBatchApply({
        libraryId: library.libraryId,
        previewId: batchRelinkPreview.preview.previewId,
        keepMetadata: batchRelinkKeepMetadata,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      const priorRestoredCount = batchRelinkPreview.priorRestoredCount;
      setBatchRelinkPreview(null);
      setAssets((current) =>
        mergeAssetSummaries(current, result.value.assets),
      );
      const refresh = await api.refreshAssets({
        libraryId: library.libraryId,
      });
      if (refresh.ok) {
        setAssets((current) =>
          mergeAssetSummaries(current, refresh.value.assets),
        );
      }
      await reloadCurrentContent();
      setNotice(
        t("toast.batchRelinkDone", {
          restored: result.value.restoredCount + priorRestoredCount,
          missing: result.value.unchangedMissingCount,
        }),
      );
      playTaskCompletionSound(startedAt);
    } catch (caught) {
      playTaskCompletionSound(startedAt);
      setBatchRelinkPreview(null);
      setError(toMessage(caught, t("toast.batchRelinkFailed"), locale));
    } finally {
      setUiState("ready");
    }
  }

  const cancelBatchRelink = useCallback(async () => {
    if (!api || !library || !batchRelinkPreview) return;
    const previewId = batchRelinkPreview.preview.previewId;
    setBatchRelinkPreview(null);
    try {
      const result = await api.cancelRelinkBatch({
        libraryId: library.libraryId,
        previewId,
      });
      if (!result.ok && result.error.code !== "CANCELLED") {
        throw new LibraryOperationError(result.error);
      }
    } catch (caught) {
      setError(toMessage(caught, t("toast.cancelBatchRelinkFailed"), locale));
    }
  }, [api, batchRelinkPreview, library, locale, setError, t, setBatchRelinkPreview]);
  return { cancelBatchRelink, startBatchRelink, applyBatchRelink, relinkMissingAsset };
}
