# 本机 API

本机 API 供本机脚本调用 Keel。它的工具与 MCP 相同，但不经过网络：Windows 上使用命名管道，macOS 和 Linux 上使用 Unix 域套接字。批量导入、批量修改时，由一个脚本在一次运行里发出全部调用，不需要 AI 逐条调用工具。

## 与 MCP 的关系

| | MCP（HTTP） | 本机 API（管道） |
| --- | --- | --- |
| 用途 | AI 客户端发现工具、逐条调用 | 脚本批量调用 |
| 传输 | `127.0.0.1` 上的 Streamable HTTP | 命名管道 / Unix 域套接字，不占端口，网页无法访问 |
| 工具、参数、结果 | 相同 | 相同 |
| 权限、确认、历史、撤销 | 相同 | 相同，使用 `Keel.exe --mcp` 的启动器凭据 |

两者都经过同一个自动化网关。本机 API 只是换了一种传输，不另设一套命令。

## 开启

本机 API 与 MCP 服务一起启动和停止：在 **设置 → MCP** 中启用并启动服务。服务运行时，Keel 在用户数据目录的 `mcp-launcher.json` 中写入管道名和令牌，该文件只有当前用户可读。

## 客户端

客户端是单个文件 [`tools/keel-api/keel-api.mjs`](../../../tools/keel-api/keel-api.mjs)，只用 Node.js 自带模块，可以复制到任何位置。它按以下顺序查找用户数据目录：

1. 环境变量 `KEEL_USER_DATA_PATH`；
2. 客户端位于 Keel 仓库内时，仓库的 `.local-profile`（开发版）；
3. 正式版的默认目录（Windows 为 `%APPDATA%\Keel`）。

### 在脚本中使用

```js
import { connectKeel } from './keel-api.mjs';

const keel = await connectKeel();
const { libraries } = await keel.call('keel_library_list_open');
const libraryId = libraries[0].libraryId;

const imported = await keel.call('keel_file_import', {
  libraryId,
  sourceKind: 'files',
  sourcePaths: ['D:/素材/a.png', 'D:/素材/b.png'],
});
const assetIds = imported.completion.assets.map((asset) => asset.assetId);
const tag = await keel.call('keel_tag_create', { libraryId, name: '待整理' });
await keel.call('keel_tag_assign', { libraryId, assetIds, tagIds: [tag.id] });
await keel.close();
```

- `call(工具, 参数)` 返回工具结果；`callRaw` 返回完整应答，含 `historyEntryId`、`undoGroupId`。
- 失败时抛出 `KeelApiError`，`code` 为 Keel 的错误码。
- 一个连接上可以同时发出多个调用；Keel 每个连接最多同时执行 4 条命令，客户端自动排队。
- 工具名与参数见 [API 参考](api-reference.md)，或运行 `node keel-api.mjs tools`。

### 命令行

```powershell
node tools/keel-api/keel-api.mjs tools
node tools/keel-api/keel-api.mjs call keel_library_list_open
node tools/keel-api/keel-api.mjs batch edits.jsonl
```

`batch` 每行读取一个 `{"tool": "…", "args": {…}}`（不给文件时读取标准输入），每完成一条就输出一行 `{"index", "ok", "result" | "code"}`。并发数由 `KEEL_API_CONCURRENCY` 控制，默认 4。

## 写批量脚本的原则

- **能一次调用完成的不要拆开。** `keel_tag_assign`、`keel_asset_rating_set` 等工具一次接受最多 10,000 个资产，`keel_file_import` 一次最多 1,000 个路径。
- **危险操作仍需确认。** 永久删除等工具第一次调用返回 `challengeId`，第二次调用回传后才执行，脚本不能跳过这一步。
- **改动可以撤销。** 每次修改都进入资源库历史，可在 Keel 中撤销。

## 实测（2026-11-23，开发版，SVG 小文件）

| 操作 | 耗时 |
| --- | --- |
| 一次调用导入 300 个文件 | 3.5 s |
| 一次调用给 300 个资产打标签 | 0.35 s |
| 逐个调用 300 次改评分（4 路并发） | 3.2 s，约 10 ms/次 |
| 顺序搜索 100 次 | 1.0 s，约 10 ms/次 |

验收测试：`tests/e2e/local-api.test.ts`。
