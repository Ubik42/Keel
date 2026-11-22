import { renderedLibrary } from "../shared/app-shared";
import { type LinkedFolderRule } from "../../../shared/asset-types";
import { type BrowseMembershipChange } from "../../filters/browse-filter-membership";
import { useLocale, useT } from "../../i18n";
import { createLibraryTransitionLock } from "../../library/library-transition-lock";
import { useLocalConfirmation } from "../../common/local-confirmation";
import { browseFields, useBrowseField } from "../../stores/browse-store";
import { dialogsFields, useDialogField } from "../../stores/dialogs-store";
import { navigationFields, useNavigationField } from "../../stores/navigation-store";
import { usePrefsStore } from "../../stores/prefs-store";
import { useSelectionField } from "../../stores/selection-store";
import { sessionFields, useSessionField } from "../../stores/session-store";
import { createTrackedLibraryApi } from "../../library/tracked-library-api";
import { useNativeDragReadyIds } from "../../browse/use-native-drag-readiness";
import { useScrollbarActivity } from "../../workbench/collection/use-scrollbar-activity";
import { useShortcutRuntimeVersion } from "../../workbench/shortcuts/shortcut-provider";
import { IS_MAC_PLATFORM, LIBRARY_LOADING_DISPLAY_DELAY_MS, type RendererWindow, useDelayedVisibility } from "../shared/app-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Extracted from AppInner (P4); the statements run in the same order as before. */
export function useCoreState() {
  const setCanvasPrefs = usePrefsStore((state) => state.setCanvas);
  const setLibraryRecoveryDialogOpen = sessionFields.setterFor("libraryRecoveryDialogOpen");
  const localConfirmation = useLocalConfirmation();
  const shortcutRuntimeVersion = useShortcutRuntimeVersion();
  const t = useT();
  const { locale } = useLocale();
  const rawLibraryApi = (window as RendererWindow).keel?.library;
  const nativeAssetDragEnabled = !(window as RendererWindow).keel?.e2e
    || Boolean((window as RendererWindow).keel?.e2e?.useNativeAssetDrag);
  const shellApi = (window as RendererWindow).keel?.shell;

  useEffect(() => {
    document.body.classList.toggle("platform-darwin", IS_MAC_PLATFORM);
  }, []);

  useScrollbarActivity();

  // Library / folder / assets (existing)
  const [library, setLibrary] = useSessionField("library");
  renderedLibrary.current = library;
  const nativeDragReadyIds = useNativeDragReadyIds(rawLibraryApi, library?.libraryId);
  const setRecentLibraries = sessionFields.setterFor("recentLibraries");
  const [folders, setFolders] = useNavigationField("folders");
  const [linkedFolders, setLinkedFolders] = useNavigationField("linkedFolders");
  const [linkedRulesEditor, setLinkedRulesEditor] = useState<{
    folderId: string;
    name: string;
    rules: LinkedFolderRule[];
  } | null>(null);
  const [convertLinkedDialog, setConvertLinkedDialog] = useDialogField("convertLinkedDialog");
  const [assets, setAssets] = useBrowseField("assets");
  const setFindSimilarSource = navigationFields.setterFor("findSimilarSource");
  const findSimilarTokenRef = useRef(0);
  const syncBrowseFilterMembershipRef = useRef<
    (change: BrowseMembershipChange) => void
  >(() => undefined);
  const [browseLayout, setBrowseLayout] = useBrowseField("browseLayout");
  const [virtualBrowseLayout, setVirtualBrowseLayout] = useBrowseField("virtualBrowseLayout");
  const setLayoutThumbnailArtifacts = browseFields.setterFor("layoutThumbnailArtifacts");
  const [assetScope, setAssetScope] = useNavigationField("assetScope");
  // REQ-FOLDER-001/002/003/010: direct child folder cards shown above assets
  // when the current browse parent is a managed folder or the managed root.
  const [folderBrowseEntries, setFolderBrowseEntries] = useBrowseField("folderBrowseEntries");
  const [folderNavigationCovers, setFolderNavigationCovers] = useBrowseField("folderNavigationCovers");
  const setFolderCustomCoverIds = browseFields.setterFor("folderCustomCoverIds");
  const [folderCoverPicker, setFolderCoverPicker] = useState<{
    folderIds: string[];
    assetId: string;
  } | null>(null);
  // Serpent-d0nv: bump to re-fetch folder browse entries when a cover
  // candidate's thumbnail becomes ready (progressive cover refresh).
  const [folderBrowseRefreshToken, setFolderBrowseRefreshToken] = useBrowseField("folderBrowseRefreshToken");
  const folderCoverCandidateAssetIdsRef = useRef<ReadonlySet<string>>(new Set());
  /** Full trash tombstone list for hierarchy browse (Serpent-6pcd). */
  const [trashedFolders, setTrashedFolders] = useNavigationField("trashedFolders");
  const [trashBrowseTombstoneId, setTrashBrowseTombstoneId] = useBrowseField("trashBrowseTombstoneId");
  const [masonryGridWidth, setMasonryGridWidth] = useState(0);
  const assetGridRef = useRef<HTMLDivElement | null>(null);
  const setFatalDialogTitle = dialogsFields.setterFor("fatalDialogTitle");
  const setFatalAlertAlreadyOpen = dialogsFields.setterFor("fatalAlertAlreadyOpen");
  const pendingAlreadyOpenPathRef = useRef<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useSelectionField("selectedFolderIds");
  const managedImportTargetFolderIdRef = useRef<string | undefined>(undefined);
  const [allAssetCount, setAllAssetCount] = useBrowseField("allAssetCount");
  const setRootAssetCount = browseFields.setterFor("rootAssetCount");
  const [selectedAssetId, setSelectedAssetId] = useSelectionField("selectedAssetId");
  const [selectedAssetIds, setSelectedAssetIds] = useSelectionField("selectedAssetIds");
  const selectedNativeDragReady = useMemo(
    () => selectedAssetIds.every((id) => nativeDragReadyIds.has(id)),
    [nativeDragReadyIds, selectedAssetIds],
  );
  // Session persistence must wait until the startup restore has applied the
  // saved scope and selection; otherwise the initial empty React state can
  // overwrite the last browsed asset in localStorage.
  const [browserSessionReady, setBrowserSessionReady] = useSessionField("browserSessionReady");
  const [uiState, setUiState] = useSessionField("uiState");
  const [libraryLoading, setLibraryLoading] = useSessionField("libraryLoading");
  const libraryLoadingVisible = useDelayedVisibility(
    libraryLoading !== null,
    LIBRARY_LOADING_DISPLAY_DELAY_MS,
  );
  const busy = [
    "booting",
    "creating",
    "opening",
    "closing",
    "loading",
    "importing",
  ].includes(uiState);
  const libraryTransitionLockRef = useRef<ReturnType<typeof createLibraryTransitionLock> | null>(null);
  const libraryTransitionLock =
    libraryTransitionLockRef.current ??
    (libraryTransitionLockRef.current = createLibraryTransitionLock());
  const libraryTransitionInlineOpeningRef = useRef<
    "open-eagle" | "open-billfish" | null
  >(null);
  const libraryWriteDepthRef = useRef(0);
  const libraryWriteInFlightRef = useRef(false);
  const [, forceLibraryWriteState] = useState(false);
  const beginLibraryWrite = useCallback(() => {
    libraryWriteDepthRef.current += 1;
    libraryWriteInFlightRef.current = true;
    forceLibraryWriteState(true);
  }, []);
  const endLibraryWrite = useCallback(() => {
    libraryWriteDepthRef.current = Math.max(0, libraryWriteDepthRef.current - 1);
    const active = libraryWriteDepthRef.current > 0;
    libraryWriteInFlightRef.current = active;
    forceLibraryWriteState(active);
  }, []);
  const api = useMemo(
    () =>
      rawLibraryApi
        ? createTrackedLibraryApi(
            rawLibraryApi,
            beginLibraryWrite,
            endLibraryWrite,
            libraryTransitionLock.runWrite,
          )
        : undefined,
    [beginLibraryWrite, endLibraryWrite, libraryTransitionLock, rawLibraryApi],
  );
  const audioPreviewPrefersCover = usePrefsStore((state) => state.audioPreviewPrefersCover);
  const applyAudioPreviewPreference = usePrefsStore((state) => state.setAudioPreviewPrefersCover);
  const bakeImageRotation = usePrefsStore((state) => state.bakeImageRotation);
  const applyBakeImageRotation = usePrefsStore((state) => state.setBakeImageRotation);
  const libraryIdForAudioPreview = library?.libraryId;
  useEffect(() => {
    if (!api || !libraryIdForAudioPreview) return;
    void api.setAudioPreviewPreference({
      libraryId: libraryIdForAudioPreview,
      preferCover: audioPreviewPrefersCover,
    });
  }, [api, audioPreviewPrefersCover, libraryIdForAudioPreview]);
  return { api, library, t, setFatalAlertAlreadyOpen, setFatalDialogTitle, pendingAlreadyOpenPathRef, setLibraryRecoveryDialogOpen, linkedFolders, assetScope, setTrashBrowseTombstoneId, setAssets, setBrowseLayout, setVirtualBrowseLayout, browseLayout, virtualBrowseLayout, selectedAssetIds, syncBrowseFilterMembershipRef, shellApi, folders, setFindSimilarSource, libraryWriteInFlightRef, selectedAssetId, assets, trashedFolders, trashBrowseTombstoneId, busy, locale, folderBrowseEntries, masonryGridWidth, assetGridRef, setMasonryGridWidth, setSelectedAssetIds, setSelectedAssetId, selectedFolderIds, setSelectedFolderIds, setFolderBrowseEntries, folderBrowseRefreshToken, folderCoverCandidateAssetIdsRef, folderNavigationCovers, setCanvasPrefs, setAllAssetCount, setRootAssetCount, setFolders, setLinkedFolders, setTrashedFolders, setFolderNavigationCovers, setFolderCustomCoverIds, setLibraryLoading, setLibrary, setAssetScope, setBrowserSessionReady, managedImportTargetFolderIdRef, setUiState, browserSessionReady, libraryTransitionInlineOpeningRef, libraryTransitionLock, setLayoutThumbnailArtifacts, setFolderBrowseRefreshToken, findSimilarTokenRef, setRecentLibraries, allAssetCount, setFolderCoverPicker, folderCoverPicker, setLinkedRulesEditor, linkedRulesEditor, convertLinkedDialog, setConvertLinkedDialog, uiState, libraryLoadingVisible, localConfirmation, libraryLoading, shortcutRuntimeVersion, nativeAssetDragEnabled, selectedNativeDragReady, nativeDragReadyIds, bakeImageRotation, audioPreviewPrefersCover, applyAudioPreviewPreference, applyBakeImageRotation };
}
