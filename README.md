<div align="center">

<img src="assets/icons/app.png" alt="Keel" width="120" />

# Keel

**本地优先的通用文件库**：把散落各处的文件收进一个资源库，找得到、看得见、理得清，并让规则替你做重复的整理。

[🇺🇸 English](README.en.md) | **🇨🇳 简体中文**

[发布页](https://github.com/Ubik42/Keel/releases) · [浏览器扩展](https://github.com/Ubik42/Keel/releases?q=extension) · [使用手册](docs/user-guide/README.md) · [开发者文档](docs/developer/README.md)

</div>

> **Keel 源自 [Serpent](https://github.com/dolag233/Serpent)。**
> Keel 的起点是 dolag233 与 Serpent 贡献者开发的开源数字资产管理软件 Serpent（MIT）。资源库、导入与预览管线、插件和自动化框架等基础都来自 Serpent，在此向作者与贡献者致谢。
> 2026-11-21 起，Keel 独立开发，不再合并上游。Keel 有自己的设计理念（见下文），因此会逐步重做大部分功能与结构，不追求与 Serpent 保持一致。Serpent 的资源库可以直接在 Keel 中打开（元数据目录 `.serpent` 自动迁移为 `.keel`）；迁移后不能再用 Serpent 打开。

## 设计理念

1. **一个通用文件库，不只是图片库。** 任何类型的文件都能入库。图片、视频、音频、PDF、字体、3D 模型由内置功能处理；其他类型由插件提供元数据、缩略图、预览和检查器分区。专用软件不并入 Keel，而是作为外部的"打开方式"配合：例如 MIDI 文件用 Panthesia 打开练习。
2. **文件就是资源库。** 新建资源库默认把素材直接放在资源库目录里，保留你自己的文件夹结构；已有的文件夹也可以原位变成资源库，不复制文件。Keel 的数据库、缩略图和回收站集中在 `.keel` 目录。数据跟着文件走：`.xmp` 等伴生文件随主文件一起移动、改名和删除。
3. **整理交给规则，规则交给 AI。** 规则只有一种形态：一份清单加一个 TypeScript 脚本，以文件形式保存在 `.keel/rules/`，可以 diff，也可以放进 Git。规则目录自带说明书、类型声明和示例，AI 打开目录就能写规则，不需要读 Keel 的源码。规则运行前可以试运行；首次运行需要确认；每次运行都有记录，改动可以撤销。
4. **人的决定优先。** 人工填写的内容与 AI 生成的内容分开保存，AI 不覆盖人工内容；整理操作都可以撤销；永久删除等高风险操作需要确认。
5. **本地优先。** 数据保存在本机，不依赖账号和云服务。需要多台设备同步时，可以选用 WebDAV。
6. **一个软件，结构清楚。** 不拆成多个包，也不为假想的其他使用者设计通用框架。代码按领域分层，依赖方向和样式 token 由 lint 规则检查。

## 现在能做什么

- **资源库**：根目录或 `Assets` 子目录两种布局；原位接管已有文件夹；打开 Eagle、Billfish 资源库并转换；链接外部文件夹并按路径规则筛选；多个资源库之间切换。
- **浏览与查看**：平铺和瀑布流；工作区多标签页，各自保留位置、搜索和选择；查看器支持图片（含 RAW、EXR、PSD、TIFF）、视频、音频、GIF、序列帧、PDF、字体、文本、压缩包和 3D 模型（含 HDRI 环境光）。
- **组织**：层级标签，可设颜色和图标，父标签筛选包含子标签；评分、喜欢、描述、作者、源链接；文件夹封面；回收站与操作撤销。
- **搜索**：高级搜索语法；按标签、评分、格式、颜色、尺寸、时长等维度过滤；实验性语义搜索，可按含义查找并查找相似资产。
- **规则**：在导入后、资源库变化后、定时或持续运行；侧栏列表的排序即优先级；可通过 MCP 和命令行（`Keel.exe --rule …`）校验、试运行和查看历史。
- **打开方式与伴生文件**：按扩展名设置默认打开方式（系统程序、指定程序、Keel 查看器或插件）；伴生文件随主文件处理，并在检查器中作为附件列出。
- **AI 分析**：为图片、视频和 3D 资产生成描述和标签，支持多个服务配置。
- **扩展**：带权限声明的插件、自动化脚本、内嵌 MCP 服务（供 AI 客户端连接）。
- **同步与采集**：WebDAV 双向同步；浏览器扩展可把网页上的图片和视频保存到资源库。
- **外观**：多套主题与自定义主题；界面缩放 75%–200%；字体大小和圆角可调；简体中文与英文界面。

## 当前状态

- 版本 0.4.0（预发布）。日常使用与测试只在 **Windows** 上进行；macOS 和 Linux 的构建脚本保留，但没有验证。
- 发布页目前提供版本说明和浏览器扩展，桌面程序需按下方[本地构建](#本地构建)打包。
- 使用手册的部分章节和截图仍是 Serpent 时期的内容，会逐步更新。

## 路线

完整计划与进度记录见 [docs/进度.md](docs/进度.md)。

### 已完成（2026-11 独立以来）

- 改名为 Keel，自动迁移旧资源库的元数据。
- 删除不用的功能：合集与智能合集，以及指向上游的自动更新和在线插件目录。
- 新增：文件类型插件接口、按类型的打开方式、伴生文件；规则系统；层级标签与标签外观；根目录资源库布局与原位接管。
- 重构：渲染层状态改用 zustand，并组件化（`App.tsx` 从 17,673 行降到 17 行）；后端按领域拆分（`library-service.ts` 从 52,331 行降到 686 行）；主进程拆分；样式整理为 token，并加入 Stylelint 约束。
- 性能：打开 2 万资源的资源库到出现第一张卡片，从 15.9 秒降到 0.9 秒；浏览跳转 p95 从 2,454 ms 降到 181 ms。

### 计划中

- **设计 token 收尾**：剩余的按主题覆盖的组件样式改为 token；行高和控件尺寸随字号变化（目前大字号下个别标题行偏挤）。
- **与 Panthesia 配合**：Panthesia 提供 Keel 插件，包括 MIDI / MusicXML 的元数据与钢琴卷帘缩略图、`.panthesia` 伴生文件，以及"用 Panthesia 练习"打开方式。
- **发布安装包**：在发布页提供 Windows 安装包与便携版。
- **文档**：按 Keel 的现状重写使用手册和截图。

### 不打算做

- **合集与智能合集**：已删除，由层级标签代替；旧资源库中的合集会一次性转为标签，智能合集转为暂停的规则。
- **可视化的规则编辑器**，以及"结构规则""识别器"等其他规则形态：规则只有脚本一种，由 AI 编写。
- **应用内自动更新与在线插件目录**：插件从本地安装。
- **旧版界面布局**：只保留现在的界面。
- **移动端**，以及账号与云服务。
- **拆分成多个 npm 包**，或为其他宿主程序做通用框架。
- **为性能改写成原生模块（Rust / napi-rs）**：2026-11 实测，现有瓶颈来自操作系统的进程创建和磁盘写入，不是 JS 计算。只有测量证明某个环节由 JS 计算拖慢、且纯 JS 改法无效时才会考虑。

## 技术路线

| 层 | 选择 |
| --- | --- |
| 桌面外壳 | Electron 43，electron-forge 与 Vite 8 多入口构建 |
| 界面 | React 19，zustand 状态，TypeScript 6；样式只引用 `tokens.css` 中的 token |
| 数据 | 每个资源库一个 SQLite 数据库（better-sqlite3），FTS5 trigram 全文检索，sqlite-vec 向量检索；迁移只增不改，新版本必须能打开旧库 |
| 媒体 | sharp、FFmpeg / ffprobe、OpenImageIO、pdf.js、ufbx（WASM）与 three.js；媒体工具随安装包提供 |
| 扩展 | 插件声明权限，分为标准与受信两种宿主；脚本与规则运行在 QuickJS 沙箱中，经自动化网关调用，与界面操作走同一套校验和撤销；内嵌 MCP 服务 |
| 质量 | ESLint（含目录依赖方向规则）、Stylelint（token 规则）、vitest（单元与 Worker 集成测试）、Playwright E2E（后台运行，不弹窗、不抢焦点） |

**进程结构**：主进程负责窗口、对话框、自定义协议、插件与规则的调度和 MCP 服务；Library Worker 独占 SQLite 和文件系统，负责导入、扫描、搜索和缩略图；渲染进程只负责界面；插件和脚本在独立宿主中运行。

**原则**：先测量再优化；后端保持 Node，原生模块只在满足 [docs/进度.md 第 5 节](docs/进度.md) 的全部条件时引入；新功能沿用现有组件与模式，不重复造轮子。

架构详情见 [docs/developer/architecture.md](docs/developer/architecture.md)。

## 本地构建

要求 Node.js 24（见 `.nvmrc`）。不要在 SMB / NAS 挂载目录上构建。

```bash
npm ci
npm run rebuild:native   # 对齐 better-sqlite3 与 Electron ABI
npm start                # 开发运行（配置保存在工程的 .local-profile）
npm run package          # 打包到 out/Keel-<平台>-<架构>/
```

常用命令：

```bash
npm run lint             # ESLint 与 Stylelint
npm run typecheck        # TypeScript 检查
npm test                 # 单元与 Worker 集成测试
npm run test:e2e         # Playwright E2E
```

打包、安装包与多平台说明见 [构建与打包](docs/developer/build-packaging.md)。Windows 上打包后，可用工程根目录的 `Start-Keel.exe` 无控制台启动。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/user-guide/README.md) | 安装、导入、浏览、搜索、同步、AI、插件、自动化、故障排查 |
| [Keel 新增功能说明](README.local.md) | 根目录布局、原位接管、层级标签、标签外观等 Keel 新增的功能 |
| [开发者文档](docs/developer/README.md) | 环境搭建、架构、测试、构建打包 |
| [扩展作者手册](docs/manual/README.md) | 插件、脚本、MCP |
| [计划与进度](docs/进度.md) | 长期计划、阶段、决定和进度记录 |

## 许可证

MIT，见 [LICENSE](LICENSE)：保留 Serpent contributors 的原版权声明，并加上 Keel 的版权行。内置媒体组件与资源遵循各自的许可（FFmpeg LGPL、OpenImageIO、ufbx MIT、Poly Haven CC0），见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `resources/` 下的 LICENSE 文件。
