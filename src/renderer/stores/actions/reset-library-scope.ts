import { browseFields } from '../browse-store';
import { dialogsFields } from '../dialogs-store';
import { inspectorFields } from '../inspector-store';
import { jobsFields } from '../jobs-store';
import { navigationFields } from '../navigation-store';
import { selectionFields } from '../selection-store';
import { sessionFields } from '../session-store';
import { transfersFields } from '../transfers-store';

/**
 * Reset every store field scoped to the open library (docs/进度.md 3.2).
 * Refs, timers and workspace tabs stay with their owners in App.
 */
export function resetLibraryScope(): void {
  jobsFields.setterFor("pluginJobs")(null);
  jobsFields.setterFor("hiddenPluginJobActivityId")(null);
  navigationFields.setterFor("folders")([]);
  navigationFields.setterFor("linkedFolders")([]);
  browseFields.setterFor("assets")([]);
  navigationFields.setterFor("findSimilarSource")(null);
  browseFields.setterFor("browseLayout")([]);
  browseFields.setterFor("virtualBrowseLayout")(null);
  browseFields.setterFor("layoutThumbnailArtifacts")({ libraryId: "", ids: new Map() });
  browseFields.setterFor("folderBrowseEntries")([]);
  navigationFields.setterFor("trashedFolders")([]);
  browseFields.setterFor("trashBrowseTombstoneId")(null);
  browseFields.setterFor("allAssetCount")(0);
  browseFields.setterFor("rootAssetCount")(0);
  navigationFields.setterFor("assetScope")("all");
  navigationFields.setterFor("showTrash")(false);
  navigationFields.setterFor("showTagManagement")(false);
  navigationFields.setterFor("activePluginSidebarViewId")(null);
  browseFields.setterFor("trashedAssets")([]);
  browseFields.setterFor("trashedAssetCount")(0);
  navigationFields.setterFor("tags")([]);
  navigationFields.setterFor("activeTagId")(null);
  selectionFields.setterFor("selectedFolderIds")([]);
  selectionFields.setterFor("selectedAssetId")(undefined);
  selectionFields.setterFor("selectedAssetIds")([]);
  inspectorFields.setterFor("assetMetadata")(null);
  inspectorFields.setterFor("versionConflict")(false);
  inspectorFields.setterFor("descriptionIsAi")(false);
  inspectorFields.setterFor("aiContent")(null);
  browseFields.setterFor("searchTotal")(null);
  browseFields.setterFor("searchOffset")(0);
  browseFields.setterFor("searchSnippets")(new Map());
  browseFields.setterFor("thumbnailFailures")(new Map());
  sessionFields.setterFor("operationHistory")(null);
  browseFields.setterFor("folderNavigationCovers")([]);
  browseFields.setterFor("folderCustomCoverIds")(new Set());
  dialogsFields.setterFor("restoreDialog")(null);
  dialogsFields.setterFor("moveDialog")(null);
  dialogsFields.setterFor("imageSequenceDialog")(null);
  transfersFields.setterFor("imageSequenceImportOffer")(null);
  transfersFields.setterFor("imageSequenceImportError")(null);
  transfersFields.setterFor("batchRelinkPreview")(null);
}
