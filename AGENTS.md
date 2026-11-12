# 本地开发约定

- 本仓库是 Ubik42/Serpent 的个人版本。默认直接在 main 分支开发并推送 origin；upstream 保留 dolag233/Serpent，用于获取上游更新。
- 工程固定在 D:\manage\_tools\Serpent。开发版使用独立配置目录，启动入口为 Start-Serpent.cmd。
- 新建资源库默认 storageLayout=root，用户可以选择 assets。没有 storage-layout.json 的旧库按 Assets 模式打开。现有库的布局不自动转换。
- useExistingFolder=true 时，在所选现有目录中创建根目录资源库。只创建 .serpent；已有元数据时拒绝覆盖；初始化失败只清理本次创建的元数据。
- 标签层级保存在 tag_hierarchy，父标签筛选通过 includeDescendants 的递归 SQL 包含后代。调整层级沿用 tag.create/tag.rename 的可撤销事务；不得拼接标签路径改写原名，也不得形成循环。
- .serpent 和 .serpentignore 是保留路径。扫描、目录监听、导入、移动与恢复必须保护数据库、缓存和忽略配置。
- 路径改动需要覆盖导入、扫描、监听、回收站恢复及文件夹/ZIP 导出。旧版测试显式选择 assets，新布局由 root-library-layout 测试覆盖。
- 界面使用简体中文，沿用现有组件和样式。说明简洁，先讲行为和影响。
- 用户真实资源库只用于明确授权的操作。开发和测试使用隔离目录。

- 标签外观保存在 tag_appearance（迁移 62），沿用 tag.create/tag.rename 的可撤销事务。新标签缺省随机赋予颜色与图标。
- 界面缩放使用 preload webFrame.setZoomFactor，范围 75%–200%，保存于独立配置；字体大小单独控制。
