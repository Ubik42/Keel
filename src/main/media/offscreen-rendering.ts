import path from 'node:path';
import { state } from '../main-state';
import { createOffscreenThumbnailRenderer, resolveOffscreenPageUrl, packagedRendererOutDir } from './offscreen-thumbnail-renderer';
import { BrowserWindow, ipcMain } from 'electron';
import { logRendererConsoleMessage } from '../window/renderer-diagnostics';
import { OFFSCREEN_THUMBNAIL_FRAME_CHANNEL } from '../../shared/protocol/channels';
import { registerModelThumbnailSourceAuthorizations, clearModelThumbnailSourceAuthorizations } from './model-thumbnail-source-cache';

/**
 * Offscreen rendering of model, document and HTML thumbnails requested by the worker (split out of startApplication, P8).
 */
export function registerOffscreenRendering() {
  if (!state.workerClient) throw new Error('The library worker must start before offscreen rendering.');
  // Slice E (Serpent-hnmg): Main owns the shared offscreen window that renders
  // model thumbnails. The worker enqueues model jobs and asks Main to render;
  // Main replies with PNG bytes (or a typed failure) that the worker persists
  // as the standard `thumbnail` artifact.
  state.offscreenThumbnailRenderer = createOffscreenThumbnailRenderer({
    createWindow: (options) => {
      const offscreenWindow = new BrowserWindow(options);
      offscreenWindow.webContents.on(
        "console-message",
        (_event, level, message, line, sourceId) => {
          logRendererConsoleMessage(state.logger, level, message, line, sourceId);
        },
      );
      offscreenWindow.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          state.logger?.error(
            "offscreen-thumbnail.page-load-failed",
            new Error(`${errorCode}: ${errorDescription}`),
            { errorCode, validatedURL, isMainFrame },
          );
        },
      );
      offscreenWindow.webContents.on("did-finish-load", () => {
        state.logger?.info(
          "offscreen-thumbnail.page-finished-load",
          "Offscreen renderer page finished loading.",
        );
        void offscreenWindow.webContents
          .executeJavaScript(
            "({ readyState: document.readyState, body: document.body.innerHTML, hasBridge: Boolean(window.offscreenThumbnail), debug: window.__keelOffscreenThumbnailDebug })",
          )
          .then((state) => {
            state.logger?.info(
              "offscreen-thumbnail.page-state",
              "Inspected offscreen renderer page state.",
              { state },
            );
          })
          .catch((error: unknown) => {
            state.logger?.error("offscreen-thumbnail.page-state", error);
          });
      });
      return offscreenWindow;
    },
    onFrameMessage: (listener) => {
      const onFrameMessage = (_event: Electron.IpcMainEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcMain.on(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
      return () =>
        ipcMain.removeListener(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
    },
    logger: {
      error: (scope, error, context) => state.logger?.error(scope, error, context),
      info: (scope, message, context) => state.logger?.info(scope, message, context),
    },
    pageUrl: resolveOffscreenPageUrl({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL ?? null,
      rendererOutDir: packagedRendererOutDir(),
    }),
    preloadPath: path.join(__dirname, "offscreen.js"),
  });
  state.workerClient.onModelThumbnailRenderRequest((request, sourceAuthorizations) => {
    const renderer = state.offscreenThumbnailRenderer;
    if (!renderer) {
      return Promise.resolve({
        status: "failed" as const,
        errorCode: "MODEL_WINDOW_FAILED",
        reason: "offscreen thumbnail renderer unavailable",
      });
    }
    registerModelThumbnailSourceAuthorizations(sourceAuthorizations);
    return renderer.renderModelThumbnail(request).finally(() => {
      clearModelThumbnailSourceAuthorizations(sourceAuthorizations);
    });
  });
  state.workerClient.onModelThumbnailRenderCancel((requestId) => {
    state.offscreenThumbnailRenderer?.cancelModelThumbnail(requestId);
  });
}
