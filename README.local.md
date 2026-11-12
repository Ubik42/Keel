# Serpent 个人开发版

基于 dolag233/Serpent，维护仓库为 https://github.com/Ubik42/Serpent 。直接在 `main` 开发；`origin` 指向个人 fork，`upstream` 指向原版。

## 资源库布局

创建资源库时可以选择素材存放位置：

- **资源库根目录（默认）**：素材直接放在资源库中，保留自己的文件夹结构。外部放入的文件由目录监听或“刷新磁盘变化”加入索引。
- **Assets 子目录**：沿用原版结构，导入的素材存放在 `Assets`。

数据库、缩略图、回收站和操作记录仍存放在 `.serpent`。布局保存在 `.serpent/storage-layout.json`，版本为 1。没有布局标记的旧库按 `Assets` 模式打开，现有素材和路径保持原样。现有库的布局转换需要单独开发。

根目录布局由此个人版支持；与原版交换资源库时，使用 Assets 布局。`.serpent` 与 `.serpentignore` 为保留路径，排除在素材扫描和用户文件操作之外。

## 本机使用

源码目录：`D:\manage\_tools\Serpent`。

双击 `Start-Serpent.cmd` 打开打包后的程序，或使用桌面的“Serpent 开发版”快捷方式。配置单独保存在工程的 `.local-profile`，自动更新关闭。原发行版的配置保持独立。

```powershell
npm ci
npm run rebuild:native
npm run package
```

日常调试可使用 `npm start`；需要独立配置时设置 `SERPENT_USER_DATA_PATH` 为绝对路径，并设置 `SERPENT_DISTRIBUTION=development`。

## 验证

新增 `tests/worker/root-library-layout.test.ts`，覆盖默认布局、粘贴文件、保留路径、导入、回收站恢复、忽略、监听、数据库恢复及文件夹/ZIP 导出。

新增 `tests/e2e/root-library-layout.test.ts`，验证中文创建界面、默认选择、可选布局、布局传递，以及根目录外部文件的自动识别。

原版 Worker 测试显式使用 `storageLayout: 'assets'`，保留其原有路径断言。既有库可用性检查继续使用 `npm run test:library-availability`。
