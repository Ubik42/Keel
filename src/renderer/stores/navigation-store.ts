import { createFieldStore } from './create-field-store';
import { loadFeatureHintPreferences } from '../feature-hint-preferences';
import { type LinkedFolderSummary, type ManagedFolderSummary, type TagSummary, type TrashedFolderSummary } from '../../shared/asset-types';
import { type FindSimilarSource } from '../find-similar';
import { loadFolderBrowseCardPreferences } from '../folder-browse-card-preferences';
import { loadFolderRecursivePreferences } from '../folder-recursive-preferences';

export type AssetScope = "all" | "root" | string;

export interface NavigationState {
  folders: ManagedFolderSummary[];
  linkedFolders: LinkedFolderSummary[];
  assetScope: AssetScope;
  trashedFolders: TrashedFolderSummary[];
  tags: TagSummary[];
  activeTagId: string | null;
  folderRecursive: boolean;
  folderRecursivePrefs: ReturnType<typeof loadFolderRecursivePreferences>;
  showFolderCardsWhenRecursive: boolean;
  showTrash: boolean;
  showTagManagement: boolean;
  activePluginSidebarViewId: string | null;
  findSimilarSource: FindSimilarSource | null;
  tagDropTargetId: string | null;
  linkedFolderHintActive: boolean;
  featureHintPrefs: ReturnType<typeof loadFeatureHintPreferences>;
  // @fields
}

export const navigationFields = createFieldStore<NavigationState>(() => ({
    folders: [],
    linkedFolders: [],
    assetScope: "all",
    trashedFolders: [],
    tags: [],
    activeTagId: null,
    folderRecursive: false,
    folderRecursivePrefs: loadFolderRecursivePreferences(),
    showFolderCardsWhenRecursive: loadFolderBrowseCardPreferences().showWhenRecursive,
    showTrash: false,
    showTagManagement: false,
    activePluginSidebarViewId: null,
    findSimilarSource: null,
    tagDropTargetId: null,
    linkedFolderHintActive: false,
    featureHintPrefs: loadFeatureHintPreferences(),
    // @initial
}));

export const useNavigationField = navigationFields.useField;
