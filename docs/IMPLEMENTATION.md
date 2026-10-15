# Limited Library｜MVP 实施记录

用户于 2026-10-15 确认 L0 并要求实现，授权沿用 main 与 OldBeer1/limited-library 继续交付。开工工作区干净，保留原任务书及 L0 SQL 草案。

- [x] L1：npm workspaces、兼容依赖与锁文件；正式初始迁移；真实 better-sqlite3 Windows 临时库与事务验证。
- [x] L2：CRUD、完整历史、收藏、容量守卫、version 冲突、UUID 重放、原子替换、SQL / API / 双连接并发测试。
- [x] L3：深色收藏柜、六类历史、搜索分页、详情编辑、归档恢复、替换弹窗、容量设置、375px 键盘操作。
- [x] L4：三种格式真实封面解码、同源访问保护、停服备份与独立恢复、生产构建、生产重启／开发代理 smoke、文档。

实施细节与设计一致；以下明确了落地选择：

1. 开发 Web 默认端口从候选 5173 改为 43128：最小 socket 重现和 Get-NetTCPConnection 证实本机 5173 被既有进程 Bound，占用者未修改。生产仍默认 3210；验收动态选空闲端口。
2. Replace incoming 的 restore / move 编辑字段统一放入 changes，避免状态字段散落在多处。
3. 初始迁移带 checksum，已有不兼容版本停止，不做未验证的升级迁移；无旧库数据时首次初始化无需声称迁移备份发生过。
4. 详情与新增以原生 dialog 显示，支持 /items/:id 与 /items/new 深链接。归档分类可通过 /archive/:category 直达。
5. 封面采用受控副本；未引用副本保留，首版不做自动垃圾回收。备份保留这些副本并校验清单。
6. 本地自动 UI 验收通过项目 Playwright CLI 与现有 Edge 执行，结果和截图仅写 output/playwright/，不上传私人运行记录。

验证仅使用唯一临时目录与合成数据；最终命令结果见 [VALIDATION.md](VALIDATION.md)。GitHub 发布报告在本机 Git 管理目录，由最终交付回复给出准确状态。
