import { defaultFormatFilter } from "../default-format-filter";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeelLibraryApi } from "../../shared/library-api";
import type { TranslateFn } from "../i18n/LocaleProvider";
import type { LibraryTransitionLock } from "../library-transition-lock";
import type { AppLocale } from "../i18n/types";
import { type SearchScope } from "../../shared/asset-types";
import { type LibraryApiResult } from "../../shared/library-api";
import { type RendererLibrarySummary } from "../../shared/protocol/responses";
import { type ClearableFilterId } from "../active-discovery-filters";
import { type CreateLibraryPhase } from "../CreateDialog";
import { LibraryOperationError, libraryOpenBlockingTitleKey, toMessage } from "../error-utils";
import { type DialogsState } from "../stores/dialogs-store";
import { type AssetScope, type NavigationState } from "../stores/navigation-store";
import { type QueryState } from "../stores/query-store";
import { sessionFields, type SessionState } from "../stores/session-store";
import { type TransfersState } from "../stores/transfers-store";
import { type SearchDefinition, renderedLibrary } from "./app-shared";
import { useCallback } from "react";

export interface UseLibraryOpeningDeps {
  api: KeelLibraryApi | undefined;
  t: TranslateFn;
  dialogValue: string;
  useExistingCreateFolder: DialogsState["useExistingCreateFolder"];
  createStorageLayout: DialogsState["createStorageLayout"];
  libraryTransitionLock: LibraryTransitionLock;
  libraryTransitionInlineOpeningRef: RefObject<"open-eagle" | "open-billfish" | null>;
  importProgress: TransfersState["importProgress"];
  confirmLibrarySwitch: (keepDestinationChoice?: boolean) => Promise<boolean>;
  setImportProgress: Dispatch<SetStateAction<TransfersState["importProgress"]>>;
  setDialog: Dispatch<SetStateAction<DialogsState["dialog"]>>;
  showBlockingError: (title: string, message: string, options?: { alreadyOpen?: boolean; }) => void;
  locale: AppLocale;
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  setLibraryTransferKind: Dispatch<SetStateAction<TransfersState["libraryTransferKind"]>>;
  setLibraryTransferName: Dispatch<SetStateAction<TransfersState["libraryTransferName"]>>;
  library: SessionState["library"];
  setError: (text: string | null) => void;
  setUiState: Dispatch<SetStateAction<SessionState["uiState"]>>;
  setLibraryLoading: Dispatch<SetStateAction<SessionState["libraryLoading"]>>;
  beginLibraryTransition: () => Readonly<{ libraryId: string | null; generation: number; }>;
  closeAssetPreview: (restoreBrowsePosition?: boolean, updateHistory?: boolean) => Promise<void>;
  clearLibraryScopedView: () => void;
  setLibrary: Dispatch<SetStateAction<SessionState["library"]>>;
  activateLibraryView: (libraryId: string) => Readonly<{ libraryId: string | null; generation: number; }>;
  loadContent: (activeLibrary: RendererLibrarySummary, scope: AssetScope, opts?: { trashMode?: boolean; discovery?: SearchDefinition; searchScope?: SearchScope; showIgnored?: boolean; refreshSidebar?: boolean; navigationPriority?: "normal" | "library-switch" | "mutation"; blockingLibraryLoad?: boolean; navigationIsCurrent?: () => boolean; folderRecursive?: boolean; deferCommit?: boolean; onPrepared?: (commit: () => void) => void; }) => Promise<{ assetId: string; locationKind: "managed" | "linked"; managedFolderId: string | null; relativeFilePath: string; displayName: string; currentRevisionId: string; byteSize: number; modifiedAt: string; availability: "available" | "missing"; rating: number; favorite: boolean; deletedAt: string | null; trashedFromPath: string | null; trashedFromTombstoneId: string | null; remainingDays: number | null; thumbnailStatus: "failed" | "ready" | "pending" | null; thumbnailArtifactId: string | null; mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other"; width: number | null; height: number | null; durationMs: number | null; linkedFolderId?: string | null | undefined; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; sequence?: { sequenceId: string; fps: number; frameCount: number; frames: { assetId: string; displayName: string; relativeFilePath: string; currentRevisionId: string; frameNumber: number; thumbnailArtifactId: string | null; previewKind?: "source" | null | undefined; previewRevisionId?: string | null | undefined; }[]; } | null | undefined; }[] | undefined>;
  markLibraryClosePending: (libraryId: string) => number;
  setWarning: (text: string | null) => void;
  clearLibraryClosePending: (libraryId: string, generation: number) => void;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  pendingAlreadyOpenPathRef: RefObject<string | null>;
  dismissFatalAlert: () => void;
  setPinnedTagId: Dispatch<SetStateAction<string | null>>;
  setSearchValue: Dispatch<SetStateAction<QueryState["searchValue"]>>;
  setFormatFilter: Dispatch<SetStateAction<QueryState["formatFilter"]>>;
  setExcludeFormatFilter: Dispatch<SetStateAction<QueryState["excludeFormatFilter"]>>;
  setColorFilter: Dispatch<SetStateAction<QueryState["colorFilter"]>>;
  setExcludeColorFilter: Dispatch<SetStateAction<QueryState["excludeColorFilter"]>>;
  setTagFilter: Dispatch<SetStateAction<QueryState["tagFilter"]>>;
  setTagFilterExpression: Dispatch<SetStateAction<QueryState["tagFilterExpression"]>>;
  setTagFilterLastValidExpression: Dispatch<SetStateAction<QueryState["tagFilterLastValidExpression"]>>;
  setTagFilterMode: Dispatch<SetStateAction<QueryState["tagFilterMode"]>>;
  setExcludeTagFilter: Dispatch<SetStateAction<QueryState["excludeTagFilter"]>>;
  setExcludedTagFilter: Dispatch<SetStateAction<QueryState["excludedTagFilter"]>>;
  setIncludeAiTagFilter: Dispatch<SetStateAction<QueryState["includeAiTagFilter"]>>;
  setRatingFilter: Dispatch<SetStateAction<QueryState["ratingFilter"]>>;
  setExcludeRatingFilter: Dispatch<SetStateAction<QueryState["excludeRatingFilter"]>>;
  setIncludeAiRatingFilter: Dispatch<SetStateAction<QueryState["includeAiRatingFilter"]>>;
  setFavoriteFilter: Dispatch<SetStateAction<QueryState["favoriteFilter"]>>;
  setSourceUrlFilter: Dispatch<SetStateAction<QueryState["sourceUrlFilter"]>>;
  setAvailabilityFilter: Dispatch<SetStateAction<QueryState["availabilityFilter"]>>;
  setExcludeAvailabilityFilter: Dispatch<SetStateAction<QueryState["excludeAvailabilityFilter"]>>;
  setWidthRange: Dispatch<SetStateAction<QueryState["widthRange"]>>;
  setHeightRange: Dispatch<SetStateAction<QueryState["heightRange"]>>;
  setAspectRatioRange: Dispatch<SetStateAction<QueryState["aspectRatioRange"]>>;
  setAspectRatioRanges: Dispatch<SetStateAction<QueryState["aspectRatioRanges"]>>;
  setDurationRange: Dispatch<SetStateAction<QueryState["durationRange"]>>;
  setLongEdgeRange: Dispatch<SetStateAction<QueryState["longEdgeRange"]>>;
  hadDiscoveryInput: RefObject<boolean>;
  setActiveTagId: Dispatch<SetStateAction<NavigationState["activeTagId"]>>;
}

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useLibraryOpening({ api, t, dialogValue, useExistingCreateFolder, createStorageLayout, libraryTransitionLock, libraryTransitionInlineOpeningRef, importProgress, confirmLibrarySwitch, setImportProgress, setDialog, showBlockingError, locale, setDialogValue, setCreateLibraryPhase, setLibraryTransferKind, setLibraryTransferName, library, setError, setUiState, setLibraryLoading, beginLibraryTransition, closeAssetPreview, clearLibraryScopedView, setLibrary, activateLibraryView, loadContent, markLibraryClosePending, setWarning, clearLibraryClosePending, refreshRecentLibraries, pendingAlreadyOpenPathRef, dismissFatalAlert, setPinnedTagId, setSearchValue, setFormatFilter, setExcludeFormatFilter, setColorFilter, setExcludeColorFilter, setTagFilter, setTagFilterExpression, setTagFilterLastValidExpression, setTagFilterMode, setExcludeTagFilter, setExcludedTagFilter, setIncludeAiTagFilter, setRatingFilter, setExcludeRatingFilter, setIncludeAiRatingFilter, setFavoriteFilter, setSourceUrlFilter, setAvailabilityFilter, setExcludeAvailabilityFilter, setWidthRange, setHeightRange, setAspectRatioRange, setAspectRatioRanges, setDurationRange, setLongEdgeRange, hadDiscoveryInput, setActiveTagId }: UseLibraryOpeningDeps) {

  async function runLibraryOperation(kind: "create" | "open") {
    if (!api) return;
    if (kind === "open") {
      // Pick the location first (dialog only) so the loading overlay and its
      // timer start with the actual load, never while the picker is open
      // (Serpent-565785 feedback).
      const chosen = await api.chooseLibraryPath();
      if (!chosen.ok || chosen.value === null) return;
      await runLibraryOpenPipeline(
        "opening",
        () => api.open({ libraryPath: chosen.value! }),
        t("toast.libraryOpFailed"),
        undefined,
        null,
        { selectedLibraryPath: chosen.value },
      );
      return;
    }
    await runLibraryOpenPipeline(
      "creating",
      () => api.create({ displayName: dialogValue.trim(), storageLayout: useExistingCreateFolder ? 'root' : createStorageLayout, useExistingFolder: useExistingCreateFolder }),
      t("toast.libraryOpFailed"),
      undefined,
      dialogValue.trim() || null,
    );
  }

  async function runInlineLibraryOpening<T>(
    operation: "open-eagle" | "open-billfish",
    action: () => Promise<T>,
  ): Promise<T> {
    let result!: T;
    await libraryTransitionLock(async () => {
      libraryTransitionInlineOpeningRef.current = operation;
      try {
        result = await action();
      } finally {
        if (libraryTransitionInlineOpeningRef.current === operation) {
          libraryTransitionInlineOpeningRef.current = null;
        }
      }
    });
    return result;
  }

  async function openEagleLibrary() {
    if (!api) return;
    // A real transfer has a Worker importId. The synthetic opening spinner uses
    // an empty id; if it was left behind after a failed destination, allow retry
    // instead of trapping the user on "validating…".
    if (importProgress?.importId) return;
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) return;
    setImportProgress(null);
    setDialog(null);
    const inspect = await runInlineLibraryOpening(
      "open-eagle",
      () => api.inspectEagle(),
    );
    if (!inspect.ok) {
      setImportProgress(null);
      if (inspect.error.code === "CANCELLED") return;
      showBlockingError(
        t("dialog.blockingError.libraryOpenFailed"),
        toMessage(
          new LibraryOperationError(inspect.error),
          t("toast.openRecentFailed"),
          locale,
        ),
      );
      return;
    }
    setDialogValue(inspect.value.displayName);
    setCreateLibraryPhase("eagle");
    setDialog("library");
  }

  function cancelEagleInspectFlow() {
    void api?.cancelInspectEagle();
    setCreateLibraryPhase("start");
  }

  async function submitEagleLibraryName() {
    if (!api) return;
    const displayName = dialogValue.trim();
    if (!displayName) return;
    setDialog(null);
    setLibraryTransferKind("open-eagle");
    setLibraryTransferName(displayName);
    try {
      await runLibraryOpenPipeline(
        "opening",
        () => api.openEagle({ displayName }),
        t("toast.openRecentFailed"),
        "open-eagle",
        displayName,
      );
    } finally {
      setCreateLibraryPhase("start");
    }
  }

  async function openBillfishLibrary() {
    if (!api) return;
    if (importProgress?.importId) return;
    if (libraryTransitionLock.hasTransitionPending() || !(await confirmLibrarySwitch())) return;
    setImportProgress(null);
    setDialog(null);
    const inspect = await runInlineLibraryOpening(
      "open-billfish",
      () => api.inspectBillfish(),
    );
    if (!inspect.ok) {
      setImportProgress(null);
      if (inspect.error.code === "CANCELLED") return;
      showBlockingError(
        t("dialog.blockingError.libraryOpenFailed"),
        toMessage(
          new LibraryOperationError(inspect.error),
          t("toast.openRecentFailed"),
          locale,
        ),
      );
      return;
    }
    // The Main process detached the previous library while it inspected the
    // selected pack. The name form is now user input, not an active load.
    setImportProgress(null);
    setDialogValue(inspect.value.displayName);
    setCreateLibraryPhase("billfish");
    setDialog("library");
  }

  function cancelBillfishInspectFlow() {
    void api?.cancelInspectBillfish();
    setImportProgress(null);
    setCreateLibraryPhase("start");
  }

  async function submitBillfishLibraryName() {
    if (!api) return;
    const displayName = dialogValue.trim();
    if (!displayName) return;
    setDialog(null);
    setLibraryTransferKind("open-billfish");
    setLibraryTransferName(displayName);
    try {
      await runLibraryOpenPipeline(
        "opening",
        () => api.openBillfish({ displayName }),
        t("toast.openRecentFailed"),
        "open-billfish",
        displayName,
      );
    } finally {
      setCreateLibraryPhase("start");
    }
  }

  async function revealRecoveryReport() {
    if (!api || !library) return;
    setError(null);
    const result = await api.revealRecoveryReport({ libraryId: library.libraryId });
    if (!result.ok) {
      setError(toMessage(new LibraryOperationError(result.error), t("library.recoveryOpenReportFailed"), locale));
    }
  }

  const openRecentLibrary = useCallback(
    async (libraryPath: string) => {
      if (!api) return;
      const recent = sessionFields.get("recentLibraries").find(
        (entry) => entry.path === libraryPath,
      );
      await runLibraryOpenPipeline(
        "opening",
        () => api.openRecent({ path: libraryPath }),
        t("toast.openRecentFailed"),
        undefined,
        recent?.name ?? null,
        { selectedLibraryPath: libraryPath },
      );
    },
    // Stable identity: the native menu effect above subscribes once, and the
    // pipeline reads live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, runLibraryOpenPipeline],
  );

  async function runLibraryOpenPipeline(
    busyState: "creating" | "opening",
    action: () => Promise<LibraryApiResult<RendererLibrarySummary>>,
    failureMessage: string,
    inlineOpeningOperation?: "open-eagle" | "open-billfish",
    loadingName?: string | null,
    openOptions?: {
      selectedLibraryPath?: string | null;
      skipSwitchConfirm?: boolean;
    },
  ) {
    if (!api) return;
    // A second library choice is safe to queue behind the current transition;
    // silently dropping it made a fast switch look like a frozen switcher.
    if (!openOptions?.skipSwitchConfirm && !(await confirmLibrarySwitch(true))) return;
    // Opening, closing, and deleting a library all replace the renderer's
    // active identity. Keep their request, UI teardown, and ref updates in one
    // order; otherwise a close clicked while an open is resolving can close
    // the replacement or restore the wrong browse scope.
    await libraryTransitionLock(async () => {
      if (inlineOpeningOperation) {
        libraryTransitionInlineOpeningRef.current = inlineOpeningOperation;
      }
      setError(null);
      setUiState(busyState);
      setLibraryLoading({ name: loadingName ?? null });
      beginLibraryTransition();
      const previousLibraryId = renderedLibrary.current?.libraryId;
      const libraryApi = api;
      let opened = false;
      try {
        const result = await action();
        if (!result.ok) {
          if (result.error.code === "CANCELLED") {
            setImportProgress(null);
            return;
          }
          throw new LibraryOperationError(result.error);
        }
        setLibraryLoading({ name: result.value.displayName });
        // Opening/creating can replace the entire browse scope while a
        // two-frame viewer restoration is still pending. Cancel only after
        // the picker succeeds so cancelling the picker leaves the current
        // viewer untouched.
        await closeAssetPreview(false);
        opened = true;
        clearLibraryScopedView();
        renderedLibrary.current = result.value;
        activateLibraryView(result.value.libraryId);
        setLibrary(result.value);
        api?.setActiveContext(result.value.libraryId);
        // Publish the replacement and queue its first browse request before
        // closing the old handle. The Worker owns SQLite, so the replacement
        // can be read while old-library cleanup drains in parallel; the
        // loading overlay stays up until the new navigation snapshot is ready.
        const firstPagePromise = loadContent(result.value, "all", {
          navigationPriority: "library-switch",
          blockingLibraryLoad: true,
        });
        const previousLibraryWillClose =
          previousLibraryId !== undefined &&
          previousLibraryId !== result.value.libraryId;
        const previousCloseGeneration = previousLibraryWillClose
          ? markLibraryClosePending(previousLibraryId!)
          : undefined;
        const previousClosePromise = previousLibraryWillClose
          ? libraryApi.close({ libraryId: previousLibraryId! })
          : undefined;
        if (previousClosePromise) {
          void previousClosePromise
            .then((closeResult) => {
              if (!closeResult.ok) {
                setWarning(t("toast.previousLibraryCloseFailed"));
              }
            })
            .catch(() => {
              setWarning(t("toast.previousLibraryCloseFailed"));
            })
            .finally(() => {
              if (previousCloseGeneration !== undefined) {
                clearLibraryClosePending(
                  previousLibraryId!,
                  previousCloseGeneration,
                );
              }
            });
        }
        await firstPagePromise;
        await refreshRecentLibraries(result.value.displayPath);
        setImportProgress(null);
        setLibraryTransferKind("import");
        setLibraryTransferName("");
      } catch (caught) {
        setImportProgress(null);
        setLibraryTransferKind("import");
        setLibraryTransferName("");
        const failureCode =
          caught instanceof LibraryOperationError ? caught.code : undefined;
        pendingAlreadyOpenPathRef.current =
          failureCode === "LIBRARY_ALREADY_OPEN"
            ? (openOptions?.selectedLibraryPath ?? null)
            : null;
        showBlockingError(
          busyState === "creating"
            ? t("dialog.blockingError.libraryCreateFailed")
            : t(libraryOpenBlockingTitleKey(failureCode)),
          toMessage(caught, failureMessage, locale),
          { alreadyOpen: failureCode === "LIBRARY_ALREADY_OPEN" },
        );
        // Serpent-s0oq: opening an invalid library removes it from the recent
        // store in Main — refresh so the switcher menu and the no-library
        // create dialog both drop it immediately. Same-catalog identity is
        // not invalid; keep the current recents list as-is.
        if (failureCode !== "LIBRARY_ALREADY_OPEN") {
          void refreshRecentLibraries();
        }
      } finally {
        if (
          inlineOpeningOperation &&
          libraryTransitionInlineOpeningRef.current === inlineOpeningOperation
        ) {
          libraryTransitionInlineOpeningRef.current = null;
        }
        setLibraryLoading(null);
        setUiState(opened ? "ready" : "idle");
        if (!opened) {
          setImportProgress(null);
          setLibraryTransferKind("import");
          setLibraryTransferName("");
        }
      }
    });
  }

  function confirmAlreadyOpenLibrarySwitch() {
    const nextPath = pendingAlreadyOpenPathRef.current;
    pendingAlreadyOpenPathRef.current = null;
    dismissFatalAlert();
    if (!nextPath || !api) return;
    void runLibraryOpenPipeline(
      "opening",
      () => api.open({ libraryPath: nextPath, replaceExisting: true }),
      t("toast.libraryOpFailed"),
      undefined,
      null,
      { selectedLibraryPath: nextPath, skipSwitchConfirm: true },
    );
  }

  function clearDiscoveryControls() {
    setPinnedTagId(null);
    setSearchValue("");
    setFormatFilter(defaultFormatFilter().formatFilter);
    setExcludeFormatFilter(defaultFormatFilter().excludeFormatFilter);
    setColorFilter("");
    setExcludeColorFilter(false);
    setTagFilter("");
    setTagFilterExpression("");
    setTagFilterLastValidExpression("");
    setTagFilterMode("expression");
    setExcludeTagFilter(false);
    setExcludedTagFilter("");
    setIncludeAiTagFilter(true);
    setRatingFilter("");
    setExcludeRatingFilter(false);
    setIncludeAiRatingFilter(true);
    setFavoriteFilter("any");
    setSourceUrlFilter("any");
    setAvailabilityFilter("any");
    setExcludeAvailabilityFilter(false);
    setWidthRange({ min: "", max: "", exclude: false });
    setHeightRange({ min: "", max: "", exclude: false });
    setAspectRatioRange({ min: "", max: "", exclude: false });
    setAspectRatioRanges([]);
    setDurationRange({ min: "", max: "", exclude: false });
    setLongEdgeRange({ min: "", max: "", exclude: false });
    hadDiscoveryInput.current = false;
  }

  function clearDiscoveryFiltersOnly() {
    setPinnedTagId(null);
    setFormatFilter("");
    setExcludeFormatFilter(false);
    setColorFilter("");
    setExcludeColorFilter(false);
    setTagFilter("");
    setTagFilterExpression("");
    setTagFilterLastValidExpression("");
    setTagFilterMode("expression");
    setExcludeTagFilter(false);
    setExcludedTagFilter("");
    setIncludeAiTagFilter(true);
    setRatingFilter("");
    setExcludeRatingFilter(false);
    setIncludeAiRatingFilter(true);
    setFavoriteFilter("any");
    setSourceUrlFilter("any");
    setAvailabilityFilter("any");
    setExcludeAvailabilityFilter(false);
    setWidthRange({ min: "", max: "", exclude: false });
    setHeightRange({ min: "", max: "", exclude: false });
    setAspectRatioRange({ min: "", max: "", exclude: false });
    setAspectRatioRanges([]);
    setDurationRange({ min: "", max: "", exclude: false });
    setLongEdgeRange({ min: "", max: "", exclude: false });
  }

  function clearDiscoveryFilter(id: ClearableFilterId) {
    switch (id) {
      case "all":
        clearDiscoveryFiltersOnly();
        return;
      case "color":
        setColorFilter("");
        setExcludeColorFilter(false);
        return;
      case "format":
        setFormatFilter("");
        setExcludeFormatFilter(false);
        return;
      case "tag":
      case "tag-expression":
        setTagFilter("");
        setTagFilterExpression("");
        setTagFilterLastValidExpression("");
        setExcludeTagFilter(false);
        setExcludedTagFilter("");
        setActiveTagId(null);
        return;
      case "rating":
        setRatingFilter("");
        setExcludeRatingFilter(false);
        return;
      case "favorite":
        setFavoriteFilter("any");
        return;
      case "source_url":
        setSourceUrlFilter("any");
        return;
      case "availability":
        setAvailabilityFilter("any");
        setExcludeAvailabilityFilter(false);
        return;
      case "aspect_ratio":
        setAspectRatioRange({ min: "", max: "", exclude: false });
        setAspectRatioRanges([]);
        return;
      case "long_edge":
        setLongEdgeRange({ min: "", max: "", exclude: false });
        return;
      case "width":
        setWidthRange({ min: "", max: "", exclude: false });
        return;
      case "height":
        setHeightRange({ min: "", max: "", exclude: false });
        return;
      case "duration":
        setDurationRange({ min: "", max: "", exclude: false });
        return;
    }
  }
  return { clearDiscoveryControls, openRecentLibrary, clearDiscoveryFilter, runLibraryOpenPipeline, revealRecoveryReport, cancelEagleInspectFlow, cancelBillfishInspectFlow, submitEagleLibraryName, submitBillfishLibraryName, runLibraryOperation, openEagleLibrary, openBillfishLibrary, confirmAlreadyOpenLibrarySwitch };
}
