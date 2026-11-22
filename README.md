> 本仓库为 Ubik42 的个人开发版。新建资源库默认将素材存放在根目录，保留 Assets 布局选项。[个人版说明](README.local.md)

<div align="center">

[🇺🇸 English](README.en.md) | **🇨🇳 简体中文**

</div>

# Keel

<div align="center">

<img src="docs/assets/ui/Serpent-Logo.png" alt="Keel" width="30%" />

</div>

Keel 基于 [dolag233/Serpent](https://github.com/dolag233/Serpent)（MIT）开发，2026-11-21 起独立维护，仓库为 [Ubik42/Keel](https://github.com/Ubik42/Keel)。

开源（MIT）、跨平台（macOS / Windows / Linux）的数字资产管理软件，面向游戏美术、影视后期、平面/动态图形设计师。

[发布页](https://github.com/Ubik42/Keel/releases) · [浏览器扩展](https://github.com/Ubik42/Keel/releases?q=extension) · [使用手册](docs/user-guide/README.md)

## 特性

+ 支持**海量**资产类型。支持大多数视频、图像、音频格式。额外支持3D模型、文本类型资产。
+ 资产管理系统。支持层级标签（标签可设颜色和图标）、打分、描述，以及快速过滤和搜索。
+ 支持工作区标签页。可同时打开多个文件夹、标签或搜索，各自保留浏览位置、搜索和选择。
+ 支持规则。规则是由 AI 编写的脚本，在导入后、资源库变化后、定时或持续运行，例如自动打标签；每次运行都有记录，改动可以撤销。
+ 支持按文件类型设置打开方式，伴生文件（如 `.xmp`）随主文件移动、改名和删除。
+ 支持插件系统。支持用插件扩展Keel功能。
+ 支持脚本、MCP调用。支持使用脚本控制Keel。支持Agent通过MCP连接、控制Keel，以实现自动化管理。
+ 支持AI分析。内置AI分析模块，支持对图像、视频、3D资产进行AI分析。
+ 支持主题。可编辑主题颜色、背景和面板不透明度，界面缩放 75%–200%。
+ 支持语义搜索（实验性）。可按含义查找图片和文本，并查找相似资产。
+ 支持WebDAV云同步。多台设备间双向同步资源库，支持自动同步与可配置的轮询间隔。
+ 支持打开外部资源库。可直接打开 Eagle / Billfish 资源库，转换后无缝浏览与检索。

<div align="center">

<img src="docs/assets/ui/Serpent-Preview.png" alt="Keel" />

</div>

## 安装

从 [GitHub 发布页](https://github.com/Ubik42/Keel/releases) 下载。目前发布页只提供版本说明和浏览器扩展；桌面程序请按下方“本地构建”自行打包（Windows 用 `npm run package`，产物在 `out/Keel-win32-x64/`）。

用发布流程（`npm run release:make`）打出的安装包命名为：macOS `Keel-darwin-arm64-<版本>-package.dmg`，Windows `Keel-win-x86-64-<版本>-setup.zip` 或 `-portable.zip`，Linux `Keel-linux-x86-64-<版本>.AppImage`。未签名版本首次运行时：macOS 右键应用选择「打开」，或执行 `xattr -cr /Applications/Keel.app`；Windows 在 SmartScreen 中选择「更多信息 → 仍要运行」。AppImage 需要 FUSE（`libfuse2`），没有 FUSE 时加 `--appimage-extract-and-run`。安装包内带 `ffmpeg`、`ffprobe` 和 `oiiotool`；可用 `KEEL_FFMPEG_PATH` / `KEEL_OIIO_PATH` 改用其他路径。

**浏览器扩展**：从[发布页的扩展版本](https://github.com/Ubik42/Keel/releases?q=extension)下载 `keel-extension-<版本>.zip`，解压后在 Chrome / Edge 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”。打包的桌面程序也自带一份（`resources/extension`）。配置见[浏览器扩展使用指南](docs/user-guide/browser-extension.md)。

## 本地构建

要求 Node.js 24.15.0（见 `.nvmrc`）。原生开发目标为 macOS arm64、Windows x64 与 Linux x64。不要在 SMB/NAS 挂载目录上构建。

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native   # 对齐 better-sqlite3 与 Electron ABI（校验 FTS5）
npm start
```

常用命令：

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # 单元 + Worker 集成测试
npm run test:e2e         # Playwright E2E
npm run package          # 打包到 out/Keel-<platform>-<arch>/
npm run make             # 按平台生成安装包（macOS dmg / Windows zip；Linux 用 make:appimage）
```

完整的构建、打包、发布流程见[开发者文档](docs/developer/build-packaging.md)。

### Linux（x64 / arm64）

Linux 沿用 Windows 风格的界面：无边框窗口 + Keel 自绘标题栏（最小化 / 最大化 / 关闭、拖动、双击最大化、边缘缩放），用应用内主菜单（≡）代替原生菜单栏；有合成器时显示 Windows 11 风格圆角，没有合成器时自动退回直角。

与 Windows 的差异（当前实现）：

- **无系统托盘**：关闭按钮会退出应用（不会像 Windows 那样隐藏到通知区域）。
- **媒体工具**：`npm start` 不会自带媒体包。未执行 `media:ensure` 时，从 `PATH` 使用 `ffmpeg` / `ffprobe` / `oiiotool`（可用 `KEEL_FFMPEG_PATH` / `KEEL_OIIO_PATH` 覆盖）。linux-x64 的 pinned bundle 已在 `bundle-lock.json` 中就绪，并打进发布用 AppImage。linux-arm64 使用同一路径，但 zip 尚未晋升，发不出现成包。
- **显示协议**：已在 Debian 13（X11 / xfwm4）和嵌套 Wayland 合成器下测试；原生 Wayland 会话仍待专项验收，日常以 X11 / XWayland 为主。x86_64 与 aarch64 相同。

依赖（Debian/Ubuntu）：

```bash
sudo apt install build-essential python3 ffmpeg    # better-sqlite3 需要编译器；未取得媒体包时，npm start 的视频/音频需要系统 ffmpeg/ffprobe
# 可选：同一开发运行下的 openimageio-tools（oiiotool），用于 EXR/RAW/PSD 等专业图像格式
```

然后用 Node.js 24.15.0 执行上面的命令（`npm ci`、`npm run rebuild:native`、`npm start`）。

环境变量：

| 变量 | 作用 |
| --- | --- |
| `KEEL_SOFTWARE_GL=1` | 没有可用 GPU / GL 驱动（虚拟机、远程桌面）时启用软件 WebGL（SwiftShader），让 3D 查看器能渲染 |
| `KEEL_LINUX_ROUNDED_CORNERS=0` / `1` | 强制直角 / 圆角（默认自动：有合成器才用圆角） |

#### AppImage（Linux）

```bash
npm run make:appimage           # 在本机构建 → out/make/appimage/Keel-<version>-x86_64.AppImage 或 -aarch64.AppImage
npm run make:appimage:docker    # 在 Ubuntu 22.04（glibc 2.35 基线）中构建，容器架构跟随宿主机，需要 docker
chmod +x out/make/appimage/Keel-*.AppImage && ./out/make/appimage/Keel-*.AppImage
```

发布管线 `npm run release:make` 会优先 `make:appimage:docker`，并把产物重命名为 `Keel-linux-x86-64-<version>.AppImage` 或 `Keel-linux-arm64-<version>.AppImage`（与 macOS/Windows 资产命名一致）。两条架构的 glibc 基线、FUSE 和 X11/Wayland 限制相同。aarch64 要等媒体 zip 晋升后才能打出发布包。

发布用 AppImage 内置 pinned 媒体工具（`ffmpeg` / `ffprobe` / `oiiotool`），不要求这些程序已经在系统 PATH 上。`KEEL_FFMPEG_PATH` / `KEEL_OIIO_PATH` 仍可覆盖。运行需要 FUSE（`libfuse2`）；没有 FUSE 时加 `--appimage-extract-and-run`。系统不允许非特权 user namespace 时（部分容器、Ubuntu 24.04 的 AppArmor 策略），启动器会自动改用 `--no-sandbox`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/user-guide/README.md) | 安装、导入、浏览、搜索（含实验性语义搜索）、外观、标签、规则、3D 查看、故障排查 |
| [开发者文档](docs/developer/README.md) | 环境搭建、构建打包、架构、测试 |
| [贡献指南](docs/developer/contributing.md) | 开源协作准则、环境准备与 Pull Request 流程 |
| [扩展作者手册](docs/manual/README.md) | 插件 / 脚本 / MCP |
| [产品简报](docs/product-brief.md) | 产品愿景与 MVP 边界 |

## 许可证

MIT。内置媒体组件与资产遵循各自许可（FFmpeg LGPL、OpenImageIO、ufbx MIT、Poly Haven CC0），见各 `resources/` 目录的 LICENSE 文件。
