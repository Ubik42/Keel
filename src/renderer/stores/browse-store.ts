import { createFieldStore } from './create-field-store';
import { type AssetSummary, type BrowseLayoutEntry, type FolderBrowseEntry } from '../../shared/asset-types';
import { type FolderNavigationCover } from '../../shared/library-navigation';
import { type VirtualBrowseLayout } from '../browse/virtual-browse-layout';

export interface BrowseState {
  assets: AssetSummary[];
  browseLayout: BrowseLayoutEntry[];
  virtualBrowseLayout: VirtualBrowseLayout | null;
  layoutThumbnailArtifacts: {
    libraryId: string;
    ids: Map<string, string>;
  };
  folderBrowseEntries: FolderBrowseEntry[];
  folderNavigationCovers: readonly FolderNavigationCover[];
  folderCustomCoverIds: ReadonlySet<string>;
  folderBrowseRefreshToken: number;
  trashBrowseTombstoneId: string | null;
  allAssetCount: number;
  rootAssetCount: number;
  searchOffset: number;
  searchTotal: number | null;
  filteredFolderCountRefreshToken: number;
  searchSnippets: Map<string, string>;
  trashedAssets: AssetSummary[];
  trashedAssetCount: number;
  thumbnailFailures: Map<string, string>;
  searchFolderRealKey: string | null;
  searchFolderRealEntries: FolderBrowseEntry[];
  // @fields
}

export const browseFields = createFieldStore<BrowseState>(() => ({
    assets: [],
    browseLayout: [],
    virtualBrowseLayout: null,
    layoutThumbnailArtifacts: { libraryId: "", ids: new Map() },
    folderBrowseEntries: [],
    folderNavigationCovers: [],
    folderCustomCoverIds: new Set(),
    folderBrowseRefreshToken: 0,
    trashBrowseTombstoneId: null,
    allAssetCount: 0,
    rootAssetCount: 0,
    searchOffset: 0,
    searchTotal: null,
    filteredFolderCountRefreshToken: 0,
    searchSnippets: new Map(),
    trashedAssets: [],
    trashedAssetCount: 0,
    thumbnailFailures: new Map(),
    searchFolderRealKey: null,
    searchFolderRealEntries: [],
    // @initial
}));

export const useBrowseField = browseFields.useField;
