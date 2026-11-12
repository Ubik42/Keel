# 本地开发约定

- 本仓库是 Ubik42/Serpent 的个人版本。默认直接在 main 分支开发并推送 origin；upstream 保留 dolag233/Serpent，用于获取上游更新。
- 工程固定在 D:\manage\_tools\Serpent。开发版使用独立配置目录，启动入口为 Start-Serpent.cmd。
- 新建资源库默认 storageLayout=root，用户可以选择 assets。没有 storage-layout.json 的旧库按 Assets 模式打开。现有库的布局不自动转换。
- .serpent 和 .serpentignore 是保留路径。扫描、目录监听、导入、移动与恢复必须保护数据库、缓存和忽略配置。
- 路径改动需要覆盖导入、扫描、监听、回收站恢复及文件夹/ZIP 导出。旧版测试显式选择 assets，新布局由 root-library-layout 测试覆盖。
- 界面使用简体中文，沿用现有组件和样式。说明简洁，先讲行为和影响。
- 用户真实资源库只用于明确授权的操作。开发和测试使用隔离目录。
