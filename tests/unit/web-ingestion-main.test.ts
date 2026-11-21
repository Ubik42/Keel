import { describe, expect, it } from 'vitest';

import { createWebImportCommand } from '../../src/main/web-ingestion';
import { parseRendererRequest, workerCommandSchema } from '../../src/shared/protocol/requests';

describe('Main browser-media import mapping', () => {
  it('maps only typed URL/context fields to the existing secure Worker command', () => {
    const request = parseRendererRequest({
      type: 'asset.import-web.request',
      libraryId: 'library-1',
      targetFolderId: 'folder-1',
      mediaUrl: 'https://cdn.example.com/image.png',
      mediaType: 'image',
    });
    if (request.type !== 'asset.import-web.request') throw new Error('unexpected request');

    expect(workerCommandSchema.parse(createWebImportCommand(request))).toEqual({
      type: 'extension.save-from-url',
      libraryId: 'library-1',
      targetFolderId: 'folder-1',
      mediaUrl: 'https://cdn.example.com/image.png',
      mediaType: 'image',
    });
    expect(JSON.stringify(createWebImportCommand(request))).not.toContain('sourcePath');
  });
});
