import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { LibraryService } from "../../src/worker/library-service";
import type { AutomaticTaskConfig } from "../../src/shared/automatic-tasks";
const roots: string[] = [];
const services: LibraryService[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "serpent-auto-task-"));
  roots.push(root);
  const service = new LibraryService({
    observerFactory: () => ({ close() {} }),
  });
  services.push(service);
  const library = service.createLibrary({
    displayName: "tasks",
    selectedParentPath: root,
  });
  return { root, service, library };
}
afterEach(() => {
  for (const s of services.splice(0)) s.closeAll();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function rule(
  tagId: string,
  patch: Partial<AutomaticTaskConfig> = {},
): AutomaticTaskConfig {
  return {
    name: "自动文本标签",
    enabled: true,
    trigger: "library-change",
    queryDefinitionJson: JSON.stringify({
      filters: [{ field: "format", values: ["text"], exclude: false }],
    }),
    recursive: true,
    action: { type: "add-tags", tagIds: [tagId] },
    ...patch,
  };
}
describe("independent automatic tasks", () => {
  it("adds matching tags, keeps manual labels, skips unchanged libraries and processes new files", async () => {
    const { service, library } = fixture();
    const id = library.libraryId;
    for (const name of ["a.md", "b.txt", "c.svg"])
      writeFileSync(path.join(library.libraryPath, name), name);
    service.refreshManagedAssets(id);
    const tag = service.createTag({ libraryId: id, name: "文本" });
    const manual = service.createTag({ libraryId: id, name: "人工" });
    const assets = service.listAssets({ libraryId: id, recursive: true });
    service.assignTags({
      libraryId: id,
      assetIds: [assets[0]!.assetId],
      tagIds: [manual.tagId],
    });
    const task = service.setAutomaticTask({
      libraryId: id,
      config: rule(tag.tagId),
    })[0]!;
    await service.runAutomaticTasks(id);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(2);
    expect(
      service.listTags(id).find((t) => t.tagId === manual.tagId)?.assetCount,
    ).toBe(1);
    expect(service.listAutomaticTasks(id)[0]!.lastAdded).toBe(2);
    const time = service.listAutomaticTasks(id)[0]!.lastRunAt;
    await service.runAutomaticTasks(id);
    expect(service.listAutomaticTasks(id)[0]!.lastRunAt).toBe(time);
    writeFileSync(path.join(library.libraryPath, "new.md"), "new");
    service.refreshManagedAssets(id);
    await service.runAutomaticTasks(id);
    expect(service.listAutomaticTasks(id)[0]!.lastAdded).toBe(1);
    service.setAutomaticTask({
      libraryId: id,
      config: rule(tag.tagId, { taskId: task.taskId, enabled: false }),
    });
    writeFileSync(path.join(library.libraryPath, "paused.md"), "new");
    service.refreshManagedAssets(id);
    await service.runAutomaticTasks(id);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(3);
    await service.runAutomaticTasks(id, task.taskId, true);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(4);
    service.deleteAutomaticTask({ libraryId: id, taskId: task.taskId });
    expect(service.listAutomaticTasks(id)).toEqual([]);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(4);
  });
  it("captures every query page before tagging can change query membership", async () => {
    const { service, library } = fixture();
    const id = library.libraryId;
    for (let i = 0; i < 230; i++)
      writeFileSync(path.join(library.libraryPath, `${i}.txt`), "x");
    service.refreshManagedAssets(id);
    const tag = service.createTag({ libraryId: id, name: "已处理" });
    service.setAutomaticTask({
      libraryId: id,
      config: rule(tag.tagId, {
        queryDefinitionJson: JSON.stringify({
          filters: [{ field: "tag", values: [tag.name], exclude: true }],
        }),
      }),
    });
    await service.runAutomaticTasks(id);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(230);
    await service.runAutomaticTasks(id, undefined, true);
    expect(service.listAutomaticTasks(id)[0]!.lastAdded).toBe(0);
  });
  it("limits a manual task to the selected folder", async () => {
    const { service, library } = fixture();
    const id = library.libraryId;
    const folder = service.createManagedFolder({ libraryId: id, name: "目标" });
    mkdirSync(path.join(library.libraryPath, "目标", "子目录"));
    for (const name of ["outside.txt", "目标/in.txt", "目标/子目录/nested.txt"])
      writeFileSync(path.join(library.libraryPath, name), "x");
    service.refreshManagedAssets(id);
    const tag = service.createTag({ libraryId: id, name: "范围" });
    const task = service.setAutomaticTask({
      libraryId: id,
      config: rule(tag.tagId, {
        trigger: "manual",
        folderId: folder.folderId,
        recursive: false,
      }),
    })[0]!;
    await service.runAutomaticTasks(id);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(0);
    await service.runAutomaticTasks(id, task.taskId, true);
    expect(
      service.listTags(id).find((t) => t.tagId === tag.tagId)?.assetCount,
    ).toBe(1);
  });
  it("persists missing-target errors without removing existing tags", async () => {
    const { service, library } = fixture();
    const id = library.libraryId;
    const tag = service.createTag({ libraryId: id, name: "目标" });
    const task = service.setAutomaticTask({
      libraryId: id,
      config: rule(tag.tagId),
    })[0]!;
    service.deleteTag({ libraryId: id, tagId: tag.tagId });
    await service.runAutomaticTasks(id, task.taskId, true);
    expect(service.listAutomaticTasks(id)[0]!.lastError).toContain(
      "目标标签已删除",
    );
  });
  it("stops subsequent batches when the task is paused during execution", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-task-pause-"));
    roots.push(root);
    let taskId = "";
    let armed = false;
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onAssetsChanged: (event) => {
        if (armed && event.changedCount > 0) {
          armed = false;
          service.setAutomaticTask({
            libraryId: event.libraryId,
            config: { ...config, taskId, enabled: false },
          });
        }
      },
    });
    services.push(service);
    const library = service.createLibrary({
      displayName: "paused",
      selectedParentPath: root,
    });
    for (let i = 0; i < 130; i++)
      writeFileSync(path.join(library.libraryPath, `${i}.txt`), "x");
    service.refreshManagedAssets(library.libraryId);
    const tag = service.createTag({
      libraryId: library.libraryId,
      name: "批量",
    });
    const config = rule(tag.tagId);
    taskId = service.setAutomaticTask({
      libraryId: library.libraryId,
      config,
    })[0]!.taskId;
    armed = true;
    await service.runAutomaticTasks(library.libraryId);
    expect(service.listAutomaticTasks(library.libraryId)[0]!.enabled).toBe(
      false,
    );
    expect(
      service.listTags(library.libraryId).find((t) => t.tagId === tag.tagId)
        ?.assetCount,
    ).toBe(64);
  });
  it("migrates group members and hierarchy once and creates paused independent tasks from saved queries", () => {
    const { service, library } = fixture();
    const id = library.libraryId;
    writeFileSync(path.join(library.libraryPath, "a.txt"), "a");
    service.refreshManagedAssets(id);
    const asset = service.listAssets({ libraryId: id, recursive: true })[0]!;
    const parent = service.createCollection({ libraryId: id, name: "项目" });
    const child = service.createCollection({
      libraryId: id,
      name: "选片",
      parentId: parent.collectionId,
    });
    service.addCollectionAssets({
      libraryId: id,
      collectionId: child.collectionId,
      assetIds: [asset.assetId],
    });
    service.createSmartCollection({
      libraryId: id,
      name: "文本条件",
      queryDefinitionJson: JSON.stringify({
        filters: [{ field: "format", values: ["text"], exclude: false }],
      }),
    });
    const tasks = service.listAutomaticTasks(id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.enabled).toBe(false);
    const tags = service.listTags(id);
    const p = tags.find((t) => t.name === "项目")!;
    expect(tags.find((t) => t.name === "选片")).toMatchObject({
      parentTagId: p.tagId,
      assetCount: 1,
    });
    service.listAutomaticTasks(id);
    expect(service.listTags(id)).toHaveLength(3);
    service.closeLibrary(id);
    service.openLibrary(library.libraryPath);
    expect(service.listAutomaticTasks(id)).toHaveLength(1);
  });
  it("persists task grouping and execution order without changing rules or existing labels", () => {
    const { service, library } = fixture();
    const libraryId = library.libraryId;
    const tag = service.createTag({ libraryId, name: "目标" });
    const first = service.setAutomaticTask({
      libraryId,
      config: rule(tag.tagId, { name: "一", enabled: false }),
    })[0]!;
    const second = service
      .setAutomaticTask({
        libraryId,
        config: rule(tag.tagId, { name: "二", trigger: "manual" }),
      })
      .find((t) => t.name === "二")!;
    const groupId = "00000000-0000-4000-8000-000000000001";
    const layout = {
      groups: [
        { groupId, name: "整理", taskIds: [second.taskId, first.taskId] },
      ],
      ungroupedTaskIds: [],
    };
    expect(service.setAutomaticTaskLayout({ libraryId, layout })).toEqual(
      layout,
    );
    expect(service.listAutomaticTasks(libraryId).map((t) => t.name)).toEqual([
      "二",
      "一",
    ]);
    service.closeLibrary(libraryId);
    service.openLibrary(library.libraryPath);
    expect(service.getAutomaticTaskLayout(libraryId)).toEqual(layout);
    expect(
      service
        .listAutomaticTasks(libraryId)
        .find((t) => t.taskId === first.taskId)?.enabled,
    ).toBe(false);
    expect(() =>
      service.setAutomaticTaskLayout({
        libraryId,
        layout: {
          groups: [
            { groupId, name: "整理", taskIds: [first.taskId, first.taskId] },
          ],
          ungroupedTaskIds: [],
        },
      }),
    ).toThrow();
    expect(service.getAutomaticTaskLayout(libraryId)).toEqual(layout);
    service.deleteAutomaticTask({ libraryId, taskId: second.taskId });
    expect(
      service.getAutomaticTaskLayout(libraryId).groups[0]!.taskIds,
    ).toEqual([first.taskId]);
    expect(service.listAutomaticTasks(libraryId)[0]!.action.tagIds).toEqual([
      tag.tagId,
    ]);
  });
});
