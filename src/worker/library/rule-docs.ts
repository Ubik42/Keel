/**
 * Files written into `<library>/.keel/rules/` so an AI (or a person) can write
 * rules without reading Keel's source (docs/进度.md 3.5).
 */
const agents = `# Keel 规则

本目录保存这个资源库的规则。一条规则 = 一个目录：

\`\`\`
rules/<规则 id>/
  rule.json   清单：名称、用途、触发、范围、权限（格式见 rule.schema.json）
  rule.ts     脚本：TypeScript（或 .js），在 Keel 的隔离沙箱中运行
\`\`\`

## 写一条规则

1. 新建目录，名字是一个新的 UUID（与 rule.json 的 \`id\` 相同）。
2. 写 \`rule.json\`：

\`\`\`json
{
  "$schema": "../rule.schema.json",
  "version": 1,
  "id": "<与目录名相同的 UUID>",
  "name": "给 RAW 照片加标签",
  "purpose": "导入后为 .cr3/.nef 照片补加 RAW 标签",
  "trigger": { "kind": "after-import" },
  "scope": { "folderId": null, "recursive": true },
  "permissions": ["asset.search", "tag.list", "tag.create", "tag.assign"],
  "script": "rule.ts"
}
\`\`\`

3. 写 \`rule.ts\`。脚本是一段函数体，可以直接 \`await\`，最后可以 \`return\` 一个结果对象：

\`\`\`ts
const page = await keel.assets.search({ query: "name:.cr3 | name:.nef", scope: rule.scope, limit: 200 });
const tags = await keel.tags.list({ limit: 200 });
const raw = tags.items.find((tag) => tag.name === "RAW") ?? (await keel.tags.create("RAW"));
await keel.tags.assign(page.items.map((asset) => asset.id), [raw.id]);
return { tagged: page.items.length };
\`\`\`

4. 新规则默认关闭。用 \`rule.validate\` 检查、用 \`rule.dry-run\` 试运行，确认后在规则列表中打开开关，或调用 \`rule.enable\`。

## 触发

| \`trigger.kind\` | 时机 |
| --- | --- |
| \`manual\` | 只在规则列表、MCP 或命令行中手动运行 |
| \`after-import\` | 每次导入完成后 |
| \`library-change\` | 资源库发生任何变化后（导入、编辑、磁盘上的文件变化） |
| \`schedule\` | 资源库打开期间每 \`everyMinutes\` 分钟一次（最少 5） |
| \`continuous\` | 持续运行：资源库打开期间，文件新增或改动约 1 秒后运行；\`rule.changedAssetIds\` 是这一批文件（每批最多 2000 个，更多时分几次运行）。启用后只处理之后的变化，已有文件需手动运行一次 |

同一时机触发多条规则时，按规则列表的顺序（分组顺序，再组内顺序）依次运行；后运行的规则能看到前面规则的结果。

## 运行环境

- 全局 \`keel\`：领域 API，签名见 \`keel-rule-api.d.ts\`。每次调用都经过与界面操作相同的校验、记录和撤销。
- 全局 \`rule\`：\`{ id, trigger, scope, dryRun, changedAssetIds? }\`。\`rule.scope\` 可直接传给 \`keel.assets.search\` 的 \`scope\`。\`changedAssetIds\` 只在持续运行时提供，可传给 \`keel.assets.list({ assetIds })\`。
- \`console.log / info / warn / error\`：写入这次运行的日志。
- 没有 \`import\`、\`require\`、Node 内置模块、文件系统、网络或 \`globalThis\`。

## 约束

- **权限**：脚本只能调用 \`permissions\` 中列出的命令；其他命令会失败并记入运行历史。读取类命令也需要列出。
- **幂等**：同一规则重复运行，结果应不变。先查询，只对还没有处理的资源写入（例如加标签前先看是否已有该标签，或依赖 \`tags.assign\` 本身只补加）。
- **只补加**：规则不要删除用户已有的数据（标签、评分、描述），除非这正是规则的用途且在 \`purpose\` 中写明。
- **试运行**：\`rule.dryRun\` 为 true 时，写入类命令不会执行，返回 \`{ dryRun: true }\`；读取类命令照常返回。运行历史会列出将要发生的改动。
- **撤销**：一次运行的改动是一组操作历史，可以在界面中撤销。

## 验证与运行（MCP / 命令行）

- \`rule.validate\`：检查 rule.json 格式、脚本语法、权限名称。
- \`rule.dry-run\`：在当前资源库上试运行，返回将要发生的改动，不写入。
- \`rule.run\`：立即运行一次（不论开关）。
- \`rule.history\`：最近的运行记录（时间、触发原因、处理文件数、改动、日志、错误位置）。
- \`rule.enable\` / \`rule.disable\`：打开或关闭。

MCP 工具名为 \`keel_rule_validate\`、\`keel_rule_dry_run\` 等。命令行连接正在运行的 Keel（未运行时在后台启动），需要在设置 → MCP 中启用：

\`\`\`
Keel.exe --rule list
Keel.exe --rule validate <规则 id 或规则目录>
Keel.exe --rule dry-run <规则 id> [--library <资源库名称>] [--json]
Keel.exe --rule run | history | enable | disable <规则 id>
\`\`\`

Keel.exe 是图形程序，直接在终端运行时看不到输出；通过管道读取（例如 \`Keel.exe --rule list | Out-String\`）。退出码：0 成功，1 规则失败或检查不通过，2 参数错误。

## 示例

见 \`examples/\`。
`;

const declarations = `// Keel rule API (generated). Scripts run as a function body: top-level await and return are allowed.

interface KeelPage<T> { items: T[]; total: number; offset: number; limit: number; hasMore: boolean }

interface KeelAsset {
  id: string;
  name: string;
  mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other";
  relativeFilePath: string;
  rating: number;
  favorite: boolean;
  width: number | null;
  height: number | null;
  byteSize: number;
  modifiedAt: string;
  [key: string]: unknown;
}

interface KeelTag { id: string; name: string; [key: string]: unknown }

interface KeelRuleScope { folderId: string | null; recursive: boolean }

interface KeelSearchInput {
  /** Toolbar search syntax, e.g. "tag:抽象 -name:draft"; null for every asset. */
  query?: string | null;
  /** A saved structured query (search + filters), as automatic tasks stored it. */
  definition?: unknown;
  /** Limit to a managed folder; pass rule.scope for the rule's own scope. */
  scope?: KeelRuleScope | null;
  limit?: number;
  offset?: number;
}

declare const rule: {
  readonly id: string;
  readonly trigger: "manual" | "after-import" | "library-change" | "schedule" | "continuous" | "dry-run";
  readonly scope: KeelRuleScope;
  readonly dryRun: boolean;
  /** Continuous runs only: the files added or changed in this batch. */
  readonly changedAssetIds?: readonly string[];
};

declare const keel: {
  assets: {
    search(input: KeelSearchInput): Promise<KeelPage<KeelAsset>>;
    list(input?: { folderId?: string; recursive?: boolean; assetIds?: readonly string[]; limit?: number; offset?: number }): Promise<KeelPage<KeelAsset>>;
    getMetadata(assetId: string): Promise<{ assetId: string; description: string | null; rating: number; favorite: boolean; sourcePageUrl: string | null; author: string | null; entityVersion: number; tags?: KeelTag[]; [key: string]: unknown }>;
    setMetadata(input: { assetId: string; expectedVersion: number; description?: string | null; rating?: number; favorite?: boolean; sourcePageUrl?: string | null; author?: string | null }): Promise<unknown>;
    setRating(assetIds: readonly string[], rating: 0 | 1 | 2 | 3 | 4 | 5): Promise<{ updatedCount: number; skipped: unknown[] }>;
    getExtractedMetadata(assetId: string): Promise<unknown>;
    getAiContent(assetId: string): Promise<unknown>;
    moveToFolder(assetIds: readonly string[], targetFolderId: string | null, options?: { conflictStrategy?: "keep-both" | "replace" | "skip" }): Promise<{ movedCount: number; skippedCount: number }>;
    renameFile(assetId: string, newBaseName: string): Promise<unknown>;
    moveToTrash(assetIds: readonly string[]): Promise<{ trashedCount: number }>;
  };
  tags: {
    list(input?: { limit?: number; offset?: number }): Promise<KeelPage<KeelTag>>;
    create(name: string, options?: { parentTagId?: string | null }): Promise<KeelTag>;
    /** Adds tags; never removes existing ones. */
    assign(assetIds: readonly string[], tagIds: readonly string[]): Promise<{ assignedCount: number; [key: string]: unknown }>;
    remove(assetIds: readonly string[], tagIds: readonly string[]): Promise<{ removedCount: number; [key: string]: unknown }>;
  };
  folders: {
    list(input?: { limit?: number; offset?: number }): Promise<KeelPage<{ id: string; name: string; parentFolderId: string | null; [key: string]: unknown }>>;
    create(name: string, options?: { parentFolderId?: string | null }): Promise<{ id: string; name: string }>;
  };
  library: {
    inspect(): Promise<unknown>;
    changeSequence(): Promise<{ sequence: number }>;
  };
  ui: {
    notify(input: { message: string; level?: "info" | "success" | "warning" | "error" }): Promise<void>;
  };
};
`;

const exampleTagByExtension = `// examples/tag-by-extension.ts
// manifest: trigger after-import; permissions asset.search, tag.list, tag.create, tag.assign
const extensions = ["cr3", "nef", "arw", "dng"];
const query = extensions.map((ext) => \`name:.\${ext}\`).join(" | ");
const tags = await keel.tags.list({ limit: 200 });
const raw = tags.items.find((tag) => tag.name === "RAW") ?? (rule.dryRun ? null : await keel.tags.create("RAW"));
let tagged = 0;
for (let offset = 0; ; offset += 200) {
  const page = await keel.assets.search({ query, scope: rule.scope, limit: 200, offset });
  if (raw && page.items.length) tagged += (await keel.tags.assign(page.items.map((a) => a.id), [raw.id])).assignedCount ?? 0;
  if (!page.hasMore) break;
}
return { tagged };
`;

const exampleRateLarge = `// examples/rate-large-images.ts
// manifest: trigger library-change; permissions asset.search, asset.rating.set
// Gives unrated images of at least 4000 px on the long edge a rating of 3.
const candidates: string[] = [];
for (let offset = 0; ; offset += 200) {
  const page = await keel.assets.search({ query: null, scope: rule.scope, limit: 200, offset });
  for (const asset of page.items) {
    const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
    if (asset.mediaType === "image" && asset.rating === 0 && longEdge >= 4000) candidates.push(asset.id);
  }
  if (!page.hasMore) break;
}
if (candidates.length) await keel.assets.setRating(candidates, 3);
console.log(\`rated \${candidates.length} images\`);
return { rated: candidates.length };
`;

const exampleContinuous = `// examples/favorite-new-gifs.ts
// manifest: trigger continuous; permissions asset.list, asset.metadata.get, asset.metadata.set
// Marks new or changed GIF files as favorites, batch by batch.
const ids = rule.changedAssetIds ?? [];
let marked = 0;
for (let offset = 0; offset < ids.length; offset += 200) {
  const page = await keel.assets.list({ assetIds: ids.slice(offset, offset + 200), limit: 200 });
  for (const asset of page.items) {
    if (asset.favorite || !asset.name.toLowerCase().endsWith(".gif")) continue;
    const metadata = await keel.assets.getMetadata(asset.id);
    await keel.assets.setMetadata({ assetId: asset.id, expectedVersion: metadata.entityVersion, favorite: true });
    marked += 1;
  }
}
console.log(\`marked \${marked} of \${ids.length} changed files\`);
return { marked };
`;

export const RULE_DOCS = {
  agents,
  declarations,
  examples: {
    "tag-by-extension.ts": exampleTagByExtension,
    "rate-large-images.ts": exampleRateLarge,
    "favorite-new-gifs.ts": exampleContinuous,
  } as Record<string, string>,
};
