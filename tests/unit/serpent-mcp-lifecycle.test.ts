import { describe, expect, it } from 'vitest';

import {
  createAutomationCommandGateway,
  type AutomationExecutionResolver,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import { callSerpentMcpTool } from '../../src/mcp/call-tool';
import { listSerpentMcpTools } from '../../src/mcp/tool-catalog';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';
import { mcpContext, writeExposure } from './serpent-mcp-test-fixtures';

/**
 * Serpent 接管（另一个 agent 的 MCP 生命周期 WIP）：新命令的执行层覆盖。
 * 每个命令验证：MCP 工具暴露 + 输入经 gateway 路由到正确的 worker 命令。
 * Worker 结果用各命令 workerResultSchema 的最小合法 shape。
 */

class RecordingWorker implements AutomationWorkerClient {
  readonly commands: WorkerCommand[] = [];

  constructor(private readonly nextResult: WorkerResult) {}

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    return this.nextResult;
  }
}

function resolver(): AutomationExecutionResolver {
  return {
    resolve: (executionId) => executionId === 'mcp-execution'
      ? mcpContext(writeExposure)
      : undefined,
  };
}

const folderSummary = (id: string) => ({
  folderId: id,
  parentFolderId: null,
  name: `folder-${id}`,
  relativePath: `folder-${id}`,
  directAssetCount: 0,
  childFolderCount: 0,
});

const tagSummary = (id: string) => ({ tagId: id, name: `tag-${id}`, assetCount: 0 });

const assetSummary = (id: string) => ({
  assetId: id,
  locationKind: 'managed' as const,
  managedFolderId: null,
  relativeFilePath: `${id}.png`,
  displayName: `${id}.png`,
  currentRevisionId: `rev-${id}`,
  byteSize: 1,
  modifiedAt: '2026-08-12T00:00:00.000Z',
  availability: 'available' as const,
  rating: 0,
  favorite: false,
  deletedAt: null,
  trashedFromPath: null,
  trashedFromTombstoneId: null,
  remainingDays: null,
  thumbnailStatus: null,
  thumbnailArtifactId: null,
  mediaType: 'image' as const,
  width: null,
  height: null,
  durationMs: null,
});

const linkedFolderSummary = (id: string) => ({
  folderId: id,
  displayName: `linked-${id}`,
  status: 'available' as const,
  assetCount: 0,
  absoluteRootPath: '/external/assets',
  relativePath: '',
  parentFolderId: null,
});

async function callTool(
  worker: RecordingWorker,
  toolName: string,
  arguments_: Record<string, unknown>,
) {
  const gateway = createAutomationCommandGateway(worker, resolver(), {
    filePlanApprovalHandler: { prepareAndApprove: async () => undefined },
  });
  return callSerpentMcpTool({
    toolName,
    arguments: arguments_,
    context: mcpContext(writeExposure),
    exposure: writeExposure,
    gateway,
  });
}

describe('MCP lifecycle commands: folder (Serpent-dcb1)', () => {
  it('exposes rename/move/delete-empty tools', () => {
    const names = listSerpentMcpTools(writeExposure).tools.map((tool) => tool.name);
    expect(names).toContain('keel_folder_rename');
    expect(names).toContain('keel_folder_move');
    expect(names).toContain('keel_folder_delete_empty');
  });

  it('routes folder.rename to the worker with the new name', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'folder.renamed',
      folder: folderSummary('folder-1'),
    });
    const result = await callTool(worker, 'keel_folder_rename', {
      libraryId: 'library-1',
      folderId: 'folder-1',
      newName: 'Renamed',
    });
    expect(result).toMatchObject({ ok: true, commandId: 'folder.rename' });
    expect(worker.commands).toEqual([
      { type: 'folder.rename', libraryId: 'library-1', folderId: 'folder-1', newName: 'Renamed' },
    ]);
  });

  it('routes folder.move with target parent and conflict strategy', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'folder.moved',
      movedCount: 1,
      skippedCount: 0,
      folders: [folderSummary('folder-1')],
    });
    const result = await callTool(worker, 'keel_folder_move', {
      libraryId: 'library-1',
      folderIds: ['folder-1'],
      targetParentFolderId: 'folder-2',
    });
    expect(result).toMatchObject({ ok: true, commandId: 'folder.move' });
    expect(worker.commands).toEqual([
      {
        type: 'folder.move',
        libraryId: 'library-1',
        folderIds: ['folder-1'],
        targetParentFolderId: 'folder-2',
        conflictStrategy: 'keep-both',
      },
    ]);
  });

  it('routes folder.delete-empty', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'folder.empty-deleted',
      deletedFolderIds: ['folder-1'],
    });
    const result = await callTool(worker, 'keel_folder_delete_empty', {
      libraryId: 'library-1',
      folderIds: ['folder-1'],
    });
    expect(result).toMatchObject({ ok: true, commandId: 'folder.delete-empty' });
    expect(worker.commands[0]).toMatchObject({
      type: 'folder.delete-empty',
      libraryId: 'library-1',
    });
  });
});

describe('MCP lifecycle commands: library (Serpent-96ys)', () => {
  it('exposes list-recent/close/rename/export/import/delete tools', () => {
    const names = listSerpentMcpTools(writeExposure).tools.map((tool) => tool.name);
    for (const name of [
      'keel_library_list_recent',
      'keel_library_close',
      'keel_library_rename',
      'keel_library_export',
      'keel_library_import_folder',
      'keel_library_import_zip',
      'keel_library_delete_from_disk',
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it('routes library.rename with the display name', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.renamed',
      library: {
        libraryId: '00000000-0000-4000-8000-0000000000aa',
        displayName: 'New Name',
        libraryPath: '/libraries/new-name',
      },
    });
    const result = await callTool(worker, 'keel_library_rename', {
      libraryId: '00000000-0000-4000-8000-0000000000aa',
      displayName: 'New Name',
    });
    expect(result).toMatchObject({ ok: true, commandId: 'library.rename' });
    expect(worker.commands).toEqual([
      {
        type: 'library.rename',
        libraryId: '00000000-0000-4000-8000-0000000000aa',
        displayName: 'New Name',
      },
    ]);
  });

  it('routes library.close', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.closed',
      libraryId: '00000000-0000-4000-8000-0000000000aa',
    });
    const result = await callTool(worker, 'keel_library_close', {
      libraryId: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(result).toMatchObject({ ok: true, commandId: 'library.close' });
    expect(worker.commands).toEqual([
      { type: 'library.close', libraryId: '00000000-0000-4000-8000-0000000000aa' },
    ]);
  });
});

describe('MCP lifecycle commands: tag (Serpent-j9n2)', () => {
  it('routes tag.rename/delete/merge', async () => {
    const renamed = new RecordingWorker({
      ok: true,
      type: 'tag.renamed',
      tag: tagSummary('tag-1'),
    });
    const renameResult = await callTool(renamed, 'keel_tag_rename', {
      libraryId: 'library-1',
      tagId: 'tag-1',
      name: 'New Tag',
    });
    expect(renameResult, JSON.stringify(renameResult)).toMatchObject({ ok: true, commandId: 'tag.rename' });
    expect(renamed.commands[0]).toMatchObject({ type: 'tag.rename', tagId: 'tag-1', name: 'New Tag' });

    const deleted = new RecordingWorker({
      ok: true,
      type: 'tag.deleted',
      tagId: 'tag-1',
    });
    const deleteResult = await callTool(deleted, 'keel_tag_delete', {
      libraryId: 'library-1',
      tagId: 'tag-1',
    });
    expect(deleteResult).toMatchObject({ ok: true, commandId: 'tag.delete' });

    const merged = new RecordingWorker({
      ok: true,
      type: 'tag.merged',
      tag: tagSummary('tag-keep'),
      mergedTagIds: ['tag-1', 'tag-2'],
    });
    const mergeResult = await callTool(merged, 'keel_tag_merge', {
      libraryId: 'library-1',
      sourceTagIds: ['tag-1', 'tag-2'],
      name: 'tag-keep',
    });
    expect(mergeResult).toMatchObject({ ok: true, commandId: 'tag.merge' });
    expect(merged.commands[0]).toMatchObject({
      type: 'tag.merge',
      sourceTagIds: ['tag-1', 'tag-2'],
    });
  });
});

describe('MCP lifecycle commands: linked folder (Serpent-eyus)', () => {
  it('routes linked-folder.create with the explicit source root', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import-linked.completed',
      linkedFolder: linkedFolderSummary('lf-1'),
    });
    const result = await callTool(worker, 'keel_linked_folder_create', {
      libraryId: 'library-1',
      sourceRootPath: '/external/assets',
      displayName: 'Assets',
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, commandId: 'linked-folder.create' });
    expect(worker.commands[0]).toMatchObject({
      type: 'asset.import-linked',
      libraryId: 'library-1',
      sourceRootPath: '/external/assets',
    });
  });
});

describe('MCP lifecycle commands: asset helpers (Serpent-uup6)', () => {
  it('routes asset.copy with target folder', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.copied',
      copiedCount: 1,
      skippedCount: 0,
      operationId: null,
      assets: [assetSummary('asset-1')],
    });
    const result = await callTool(worker, 'keel_asset_copy', {
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      targetFolderId: 'folder-9',
    });
    expect(result).toMatchObject({ ok: true, commandId: 'asset.copy' });
    expect(worker.commands[0]).toMatchObject({
      type: 'asset.copy',
      libraryId: 'library-1',
      targetFolderId: 'folder-9',
    });
  });

  it('reads thumbnail and preview artifact status', async () => {
    const thumb = new RecordingWorker({
      ok: true,
      type: 'media.thumbnail-artifact',
      artifactId: 'thumb-1',
      filePath: 'thumb-1.webp',
      width: 512,
      height: 512,
    });
    const thumbResult = await callTool(thumb, 'keel_asset_thumbnail_get', {
      libraryId: 'library-1',
      assetId: 'asset-1',
    });
    expect(thumbResult, JSON.stringify(thumbResult)).toMatchObject({ ok: true, commandId: 'asset.thumbnail.get' });
    expect(thumb.commands[0]).toMatchObject({ type: 'media.get-thumbnail-artifact' });

    const preview = new RecordingWorker({
      ok: true,
      type: 'media.preview-artifact',
      assetId: 'asset-1',
      mediaType: 'image',
      status: 'ready',
      kind: 'thumbnail',
      artifactId: 'thumb-1',
      mimeType: 'image/webp',
    });
    const previewResult = await callTool(preview, 'keel_asset_preview_get', {
      libraryId: 'library-1',
      assetId: 'asset-1',
    });
    expect(previewResult).toMatchObject({ ok: true, commandId: 'asset.preview.get' });
    expect(preview.commands[0]).toMatchObject({ type: 'media.get-preview-artifact' });
  });
});
