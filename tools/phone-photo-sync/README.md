# 手机照片增量导入

目标资源库为 `D:\Pictures\日常记录`。手机上的新照片和视频经 Keel 标准导入流程进入资源库：按拍摄年月放进 `年/月` 文件夹，打上「来自手机」标签，相同内容只保留一份。桌面的“更新手机照片”快捷方式指向本目录生成的 EXE。

## 日常使用

1. 连接并解锁手机，USB 用途选择“文件传输”。
2. 双击桌面的“更新手机照片”。
3. 有新照片需要导入时，脚本通过 Keel 本机 API 导入；Keel 没有运行时自动启动开发版（`Start-Keel.cmd`）。Keel 的 设置 → MCP 需保持启用和自动启动，本机 API 随 MCP 服务开关。
4. 等待窗口显示完成，查看新增、复用和未完成数量。

## 流程

1. `wpd_backend.py` 只读扫描手机的 DCIM、Pictures、Movies、Download、Android/media 及配置中列出的目录；缩略图、应用缓存和游戏素材按用途排除。
2. `core.py` 按手机路径、大小和修改时间跳过已导入文件，只读取新增或改动的文件，以 SHA-256 判断内容。资源库已有的相同内容不再复制，只补加标签。
3. 新内容暂存在 `.keel/phone-sync/staging/import`，再由 `keel-import.mjs` 通过本机 API（`tools/keel-api`，命名管道）调用正在运行的 Keel 导入，与界面导入使用同一网关，写入资源库历史：
   - 拍摄年月依次取 EXIF 拍摄时间、文件名中的日期或毫秒时间戳、手机修改时间；都没有时放入 `_未知时间`。
   - 年份目录里已有 `7月` 这类月份文件夹时沿用，否则使用 `07`。
   - 目标文件夹里已有同名文件时，暂存副本先改名为 `原名_<哈希前12位>`，导入不产生冲突。
   - 内容去重由 `core.py` 的 SHA-256 索引完成；Keel 若仍报告冲突，该批记为未完成，下次重试。
4. 导入成功后才记录手机路径，失败的文件下次重新读取。

导入经由正在运行的 Keel，不在另一个进程里直接打开资源库，避免两个进程同时写同一个库。手机删除的照片、资源库中的历史照片和本地修改都保留；资源库内移动或整理照片后，下一次更新会重新绑定内容索引。

状态、配置、路径对应表、失败日志与暂存区位于库内 `.keel/phone-sync`。WPD 对象 ID 只用于本次连接；持久状态使用手机相对路径，设备按序列号和型号绑定。传输通过 MTA 和全局互斥锁串行运行。

## 维护入口

- `更新手机照片.exe`：可双击的入口。`launcher.json` 保存本机 Python 路径和目标库路径，留在本机。
- `cli.py --library <库路径> --dry-run`：预览变化。
- `cli.py --library <库路径> --verify`：重新读取手机内容作完整核验。
- `migrate.py --source <旧手机同步库> --target <目标库>`：一次性把独立手机同步库迁入目标库，并带走手机路径索引（2026-11-23 已用于迁移 `D:\Pictures\手机同步`）。`--limit N` 用于试跑。

更新工具依赖本机 Python 3.14、Node.js、项目的 exifr 依赖和 comtypes 1.5.0。本机运行时保存在本目录 `runtime`。

重新构建入口：

```powershell
python -m pip install --target tools/phone-photo-sync/runtime comtypes==1.5.0
& tools/phone-photo-sync/install-launcher.ps1 -LibraryPath 'D:\Pictures\日常记录'
```

运行同步行为检查：

```powershell
python -m unittest discover -s tools/phone-photo-sync/tests -v
```
