# 手机照片固定更新

固定资源库为 `D:\Pictures\手机同步`，手机的 DCIM、Pictures 等照片目录直接放在库根目录。桌面的“更新手机照片”和库内 `_管理` 文件夹的同名快捷方式指向本目录生成的 EXE。

## 日常使用

1. 连接并解锁手机，选择 USB 文件传输。
2. 双击“更新手机照片”。
3. 等待窗口显示完成，查看新增、复用和未完成数量。

更新读取新增或改动文件，以 SHA-256 复用相同内容；未变化文件通过手机路径、大小、修改时间及本地内容索引跳过。首次安装以先前核验过的照片归档建立基线。手机删除的照片、电脑历史照片、用户本地修改后的版本继续保留。无法提供修改时间的手机文件会重新读取以检查内容。

照片来源包含 DCIM、Pictures、Movies、Download、Android/media 及配置中明确保存图片的目录。缩略图、应用缓存和游戏素材按用途排除。更新程序只读手机，提供照片归档功能。

状态、配置、失败日志与暂存区位于库内 `.serpent/phone-sync`，每次成功文件单独落库，中断后可继续。WPD 对象 ID 只用于本次连接；持久状态使用相对路径，设备用序列号绑定。传输通过 MTA 和全局互斥锁串行运行。

电脑重新整理或移动库内照片后，下一次更新会重新绑定内容索引。已存在其他库的少量共享照片通过 Serpent 链接文件夹引用。共享链接使用 `**` 排除全部，再按文件路径逐项包含。

## 维护入口

- `更新手机照片.exe`：可双击的入口。`launcher.json` 保存本机 Python 路径和固定库路径，留在本机。
- `cli.py --library <库路径> --dry-run`：预览变化。
- `cli.py --library <库路径> --verify`：重新读取手机内容作完整核验。
- `core.py`：持久索引、版本保留、内容去重及恢复。
- `wpd_backend.py`：Windows Portable Devices 只读传输；MTA、设备身份校验、串行访问。
- `scripts/run-phone-catalog.mjs`：通过项目自有 LibraryService 更新库索引及共享照片引用。

更新工具依赖本机 Python 3.14、项目 Node/Electron 依赖和 comtypes 1.5.0。本机运行时保存在本目录 `runtime`，与聊天临时目录独立。

重新构建入口：

```powershell
python -m pip install --target tools/phone-photo-sync/runtime comtypes==1.5.0
node scripts/run-phone-catalog.mjs --build
& tools/phone-photo-sync/install-launcher.ps1 -LibraryPath 'D:\Pictures\手机同步'
```

运行同步行为检查：

```powershell
python -m unittest discover -s tools/phone-photo-sync/tests -v
```

库根目录只放照片分类与 `_管理`。更新快捷方式、使用说明和 `同步记录/一加 Ace 5` 集中在 `_管理`，并由 `.serpentignore` 排除。配置 device_folder 为空时直接更新根目录，设备名仅用于管理记录。
