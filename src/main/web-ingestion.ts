import type { RendererRequest, WorkerCommand } from '../shared/protocol/requests';

type WebImportRequest = Extract<RendererRequest, { type: 'asset.import-web.request' }>;

export function createWebImportCommand(request: WebImportRequest): Extract<WorkerCommand, { type: 'extension.save-from-url' }> {
  return {
    type: 'extension.save-from-url',
    libraryId: request.libraryId,
    targetFolderId: request.targetFolderId,
    mediaUrl: request.mediaUrl,
    mediaType: request.mediaType,
  };
}
