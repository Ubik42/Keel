import { shouldHandleSecondaryLaunch } from '../shared/startup-preferences';
import { state } from './main-state';
import { BrowserWindow } from 'electron';
import { resolveExtensionSaveRouting } from './extension-save-context';
import { type ListFoldersDisposition, type SaveIntent, type SaveIntentDisposition, type SaveUploadRequest, type SaveUploadDisposition } from './extension-server';
import { readExtensionBrowseFolderIds } from './extension-recent-browse-folders';
import { type WorkerCommand } from '../shared/protocol/requests';
import { enqueueAutoAnalyzeAfterImport } from './ai-queue';
import { publishExtensionSaveCompleted } from './renderer-events';
import { rmSync } from 'node:fs';

/**
 * Browser-extension save requests: folder list, save intent and upload into the focused library (split out of index.ts, P8).
 */
// Maps BrowserWindow.id to the active library/folder context for extension save.
export const focusedContexts = new Map<
  number,
  { libraryId: string | null; selectedFolderId?: string }
>();

export function focusKeelWindow(windowId?: number): boolean {
  if (!shouldHandleSecondaryLaunch({ applicationQuitting: state.applicationQuitting })) return false;
  const target =
    windowId === undefined
      ? state.mainWindow
      : BrowserWindow.getAllWindows().find((window) => window.id === windowId);
  if (!target || target.isDestroyed()) return false;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return true;
}

export function getExtensionSaveRouting() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return resolveExtensionSaveRouting({
    focusedWindowId: focusedWindow?.id ?? null,
    contexts: focusedContexts,
    lastTargetWindowId: state.lastExtensionTargetWindowId ?? null,
    mainWindowId:
      state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.id : null,
  });
}

export function getExtensionSaveContext() {
  return getExtensionSaveRouting().context;
}

export async function handleListFolders(): Promise<ListFoldersDisposition> {
  if (!state.workerClient) {
    return { ok: false, status: 503, reason: "worker unavailable" };
  }

  const saveContext = getExtensionSaveContext();
  if (!saveContext) {
    return { ok: false, status: 503, reason: "no active library" };
  }

  const result = await state.workerClient.request({
    type: "folder.list",
    libraryId: saveContext.libraryId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
      reason: result.error.reason ?? result.error.code,
    };
  }
  if (result.type !== "folder.list") {
    return { ok: false, status: 500, reason: "unexpected worker response" };
  }

  let libraryDisplayName = "Keel";
  const librariesResult = await state.workerClient.request({ type: "library.list" });
  if (librariesResult.ok && librariesResult.type === "library.list") {
    const match = librariesResult.libraries.find(
      (library) => library.libraryId === saveContext.libraryId,
    );
    if (match?.displayName) libraryDisplayName = match.displayName;
  }

  // 链接文件夹与 managed 文件夹并列作为扩展保存目标：worker 的 folder.list
  // 只列 managed，这里额外取 linked-folder.list 并按链接根 displayName 做
  // 命名空间前缀，避免与 managed 的 relativePath 撞树（Serpent-f6f779）。
  let linkedExtensionFolders: Array<{
    folderId: string;
    name: string;
    relativePath: string;
    assetCount: number;
  }> = [];
  const linkedResult = await state.workerClient.request({
    type: "linked-folder.list",
    libraryId: saveContext.libraryId,
  });
  if (linkedResult.ok && linkedResult.type === "linked-folder.list") {
    const rootNames = new Map(
      linkedResult.folders
        .filter((folder) => (folder.relativePath ?? "") === "")
        .map((folder) => [folder.folderId, folder.displayName]),
    );
    linkedExtensionFolders = linkedResult.folders.map((folder) => {
      const rootName =
        (folder.linkedFolderId
          ? rootNames.get(folder.linkedFolderId)
          : undefined) ?? folder.displayName;
      return {
        folderId: folder.folderId,
        name: folder.displayName,
        relativePath:
          (folder.relativePath ?? "") === ""
            ? rootName
            : `${rootName}/${folder.relativePath}`,
        assetCount: folder.assetCount,
      };
    });
  }

  return {
    ok: true,
    libraryDisplayName,
    recentBrowsedFolderIds: (() => {
      let ids = state.extensionBrowseFoldersStorePath
        ? readExtensionBrowseFolderIds(
            state.extensionBrowseFoldersStorePath,
            saveContext.libraryId,
          )
        : [];
      if (saveContext.selectedFolderId) {
        ids = [
          saveContext.selectedFolderId,
          ...ids.filter((id) => id !== saveContext.selectedFolderId),
        ];
      }
      return ids;
    })(),
    folders: [
      ...result.folders.map((folder) => ({
        folderId: folder.folderId,
        name: folder.name,
        relativePath: folder.relativePath,
        assetCount: folder.directAssetCount,
      })),
      ...linkedExtensionFolders,
    ],
  };
}

export async function handleSaveIntent(
  intent: SaveIntent,
): Promise<SaveIntentDisposition> {
  if (!state.workerClient) {
    return { accepted: false, status: 503, reason: "worker unavailable" };
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const saveContext = getExtensionSaveContext();
  if (!saveContext) {
    state.logger?.info(
      "extension-server.save",
      focusedWindow
        ? "No active library in focused window; dropping save intent."
        : "No focused Keel window and no fallback browse context; dropping save intent.",
      {
        focusedWindowId: focusedWindow?.id ?? null,
        lastTargetWindowId: state.lastExtensionTargetWindowId ?? null,
        mainWindowId:
          state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.id : null,
        contextWindowCount: focusedContexts.size,
      },
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const targetFolderId =
    intent.targetFolderId !== undefined
      ? intent.targetFolderId ?? undefined
      : saveContext.selectedFolderId;

  const command: WorkerCommand = {
    type: "extension.save-from-url",
    libraryId: saveContext.libraryId,
    targetFolderId,
    sourcePageUrl: intent.sourcePageUrl,
    mediaUrl: intent.mediaUrl,
    mediaType: intent.mediaType,
  };

  try {
    const result = await state.workerClient.request(command);
    if (!result.ok) {
      state.logger?.error(
        "extension-server.save",
        new Error(`Save failed: ${result.error.message}`),
        {
          code: result.error.code,
          reason: result.error.reason,
        },
      );
      return {
        accepted: false,
        status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
        reason: result.error.reason ?? result.error.code,
      };
    }
    state.logger?.info("extension-server.save", "Asset saved successfully.", {
      type: result.type,
    });
    if (result.type === "extension.asset-saved") {
      void enqueueAutoAnalyzeAfterImport(saveContext.libraryId, [
        result.asset.assetId,
      ]);
    }
    return { accepted: true };
  } catch (error) {
    state.logger?.error("extension-server.save", error);
    throw error;
  }
}

export async function handleSaveUpload(
  upload: SaveUploadRequest,
): Promise<SaveUploadDisposition> {
  if (!state.workerClient) {
    return { accepted: false, status: 503, reason: "worker unavailable" };
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const saveRouting = getExtensionSaveRouting();
  const saveContext = saveRouting.context;
  if (!saveContext) {
    state.logger?.info(
      "extension-server.save-upload",
      focusedWindow
        ? "No active library in focused window; dropping upload."
        : "No focused Keel window and no fallback browse context; dropping upload.",
      {
        focusedWindowId: focusedWindow?.id ?? null,
        lastTargetWindowId: state.lastExtensionTargetWindowId ?? null,
        mainWindowId:
          state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.id : null,
        contextWindowCount: focusedContexts.size,
      },
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const targetFolderId =
    upload.targetFolderId !== undefined
      ? upload.targetFolderId ?? undefined
      : saveContext.selectedFolderId;

  const command: WorkerCommand = {
    type: "extension.save-from-file",
    libraryId: saveContext.libraryId,
    targetFolderId,
    sourcePageUrl: upload.sourcePageUrl,
    mediaUrl: upload.mediaUrl,
    stagedFilePath: upload.stagedFilePath,
    contentType: upload.contentType,
    filename: upload.filename,
  };

  try {
    const result = await state.workerClient.request(command);
    if (!result.ok) {
      state.logger?.error(
        "extension-server.save-upload",
        new Error(`Upload save failed: ${result.error.message}`),
        {
          code: result.error.code,
          reason: result.error.reason,
        },
      );
      return {
        accepted: false,
        status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
        reason: result.error.reason ?? result.error.code,
      };
    }
    if (result.type !== "extension.asset-saved") {
      return { accepted: false, status: 500, reason: "unexpected worker response" };
    }
    state.logger?.info("extension-server.save-upload", "Asset saved successfully.", {
      type: result.type,
      byteLength: upload.byteLength,
      assetId: result.asset.assetId,
    });
    if (upload.focusAppAfterSave) {
      focusKeelWindow(saveRouting.targetWindowId ?? undefined);
    }
    if (upload.revealInLibrary) {
      publishExtensionSaveCompleted(saveRouting.targetWindowId, {
        type: "extension.save.completed",
        libraryId: saveContext.libraryId,
        asset: result.asset,
      });
    }
    void enqueueAutoAnalyzeAfterImport(saveContext.libraryId, [
      result.asset.assetId,
    ]);
    return { accepted: true };
  } catch (error) {
    state.logger?.error("extension-server.save-upload", error);
    throw error;
  } finally {
    try {
      rmSync(upload.stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      state.logger?.error("extension-server.save-upload-cleanup", error);
    }
  }
}
