# Limited Library｜MVP 实际验证

日期：2026-10-15（Asia/Shanghai）。用户已确认 L0 并要求实现。本节记录当前 MVP；下方 L0 章节保留为当时的历史证据，其中“尚未执行”只描述设计阶段。

## 当前实现与环境

Node 24.16.0 / npm 11.13.0 / Windows；Python 3.13.15 只用于旧设计检查。运行依赖固定在 package-lock.json：React / React DOM 19.3.1、Vite 8.3.4、React plugin 6.1.2、TypeScript 6.0.3、Fastify 5.12.7、static 10.1.6、multipart 10.1.4、better-sqlite3 13.0.3（实际 SQLite 3.53.4）、sharp 0.35.5。选择 TypeScript 6 是因 typescript-eslint 8.71.2 声明 <6.1 支持，未使用不兼容的 TypeScript 7。

npm ci --no-fund --audit=false 已按锁文件重装 204 个包成功，未全局安装软件或改变 PATH。原生驱动在本机完成建库、BEGIN IMMEDIATE 事务、读取；封面库完成实际 PNG / JPEG / WebP 解码。

## 最终检查

以下命令均已在当前最终版本执行通过；检查完成后只追加验证证据。

| 命令 | 状态 |
|---|---|
| npm test | 通过，26 项集成测试，0 失败 |
| npm run lint | 通过，0 错误 |
| npm run typecheck | 通过，contracts / server / web / tests |
| npm run build | 通过，网页与后端生产构建 |
| npm run smoke | 通过，生产 HTML / 深链接 / 重启持久化及开发 Vite 代理 / Origin / token / 正常关闭 |
| npm run test:ui | 10 组关键 UI 检查已通过，无浏览器未处理异常 |
| python scripts/check_design.py | 通过，29 项，原任务书 SHA-256 未变 |

## 已执行的关键证据

- API / 原生 SQLite 集成覆盖六类容量、满位新增、completed / dropped 占位、零容量补录历史、六类完整历史与收藏、归档／重看／未知日期、version 冲突、恢复与跨类限制、缩容、请求幂等重放与参数冲突。
- 故意永久删除候选后，让 incoming 引用不存在的封面触发 FK 失败：候选恢复、保留数不变、失败 requestId 不写成功记录。不是 mock 数据库测试。
- 两个 worker 各自独立原生连接，经屏障同时抢第十个位置：结果一方 committed、一方 CATEGORY_FULL，最终电影 10/10。
- 真实 PNG、JPEG、WebP 上传／读取成功；SVG、伪造 MIME、截断图片和超过 5 MiB 被拒绝。非法 Host / Origin / token（含非 ASCII）阻止写入。
- 停服备份恢复包含合成备注、收藏、评分、完整字段及实际封面；逻辑 SHA-256 一致，原库字节未覆盖；已有目标、嵌套目标、篡改清单和运行中备份被拒绝。
- 当前 Playwright CLI 自动检查的 10 组：历史补录＋收藏＋真实封面＋未知日期；断网草稿与恢复重试；取消替换；其他页面修改候选后的自动刷新；375px 全键盘归档替换；375/768/1440 布局；容量设置；搜索／编辑／收藏切换；永久删除确认／取消；无浏览器未处理异常。
- 手动 CLI 也复核：取消替换时标题未丢，保留总数 7、已看总数 14 未变；键盘替换后电影保持 2/2，旧作品出现在归档。375px 页面 scrollWidth=375，两个嵌套 dialog 的 scrollWidth 与 clientWidth 均为 335；768px 页面 scrollWidth=768。
- UI 自动结果 output/playwright/ui-result.json、cabinet-1440.png、history-375.png、history-768.png、history-1440.png、replace-375.png 均为合成资料库。输出目录忽略，不提交私人运行痕迹。

## 排错与修复记录

1. Windows 测试清理原先先删临时目录、后关连接，导致 EPERM；夹具改为先关闭应用和数据库再删除自己创建的临时目录，26 项全通过。
2. 3218 与 5173 EACCES 经最小 socket 复现。Get-NetTCPConnection 显示 QMUpload.exe 的 Bound 套接字；未修改该进程。43128 已实测可绑定，用作显式开发默认；生产 3210 可绑定；smoke/UI 使用动态空闲端口。
3. 静态目录 index:false 造成根路径 Forbidden；改为显式 index.html，原生产 HTTP smoke 通过，deep link 返回网页。诊断标记已移除。
4. 开发 smoke 查明 Vite 启动器被错误地相对于 web cwd 解析；改为绝对可执行脚本路径，并实际验证代理写入和正常关闭。
5. UI 自动测试原先对双弹窗用单 locator 等待隐藏，触发严格模式；改为等全部 open dialog 数量归零。真实键盘流程和数据检查通过。

代码可读性：本次新建 TS / TSX / CSS / 配置使用一次性 Prettier 3.9.10 整理，不新增运行依赖，未格式化或修改原任务书。格式整理后再次执行相称检查。

并发 UI 回归：实际修改已选候选的 version 后触发冲突，旧实现没有重新 GET 候选而在 3000ms 断言失败；补充 reload 触发读取新列表后，同一草稿可重新选择并成功替换。

## 边界与未验证项

未用私人库做测试；没有预填个人片单、旧库迁移或云同步。首次初始化 schema 1 已验证；未来升级迁移尚无版本，版本／checksum 不匹配会停止。首版不提供在线热备份、自动封面清理、批量片单导入、每次重看明细。仅验证当前 Windows / Node / Edge 组合，未作其他操作系统、所有浏览器或超大历史库压力测试。没有配置或宣称 GitHub CI 通过；本地成功与远端推送分别核验。

---

# Limited Library｜L0 验证记录

日期：2026-10-15（Asia/Shanghai）
阶段：仅设计；等待架构确认。完整已看／已读与收藏能力已纳入设计，未录入个人片单、未实现应用。

## 已完成的环境与基线检查

PowerShell 中读取目录、原任务书、技能脚本及绑定；检查祖先和项目 AGENTS.md、Git 根、工具版本。初始项目仅有任务书，无现存源码、README、依赖、锁文件、构建、测试脚本或 Git 历史。当前使用此目录，不在父目录建立或发布项目。

| 工具 | 实际输出 |
|---|---|
| Node | v24.16.0 |
| npm | 11.13.0 |
| Python | 3.13.15 |
| Python 内置 SQLite | 3.50.4 |
| Git | 2.54.0.windows.1 |
| GitHub CLI | 2.102.0，路径 D:\DevTools\bin\gh.exe |

原始任务书 SHA-256：`AF8808464E6B6B4950E8E6BAEFC9966CC6A2798BABC0A2FE2D65F7DF58847AFD`。

原件保留；未建立真实用户数据库。生产路径仅是设计，不存在本阶段应用写入行为。

## 本阶段检查命令与结果

PowerShell：

```powershell
Set-Location -LiteralPath 'C:\Software\Limited Library'
python .\scripts\check_design.py
```

结果：**29 项 L0 设计检查全部通过，退出码 0**。涵盖六类 seed 与计数、直接 SQL 满位拒绝、同分类编辑、归档保留已看与收藏、零容量补录 120 条历史、六类已看列表、重看与未知日期、恢复／跨类限制、缩容、归档或删除后的失败回滚、去重表事务性与唯一性、乐观锁 SQL 模式、非法字段／真实日期／外键、资产引用、固定身份，以及两个独立连接争抢最后位置。

双连接样例实际结果：一个 committed、一个 CATEGORY_FULL，最终电影 10/10；临时文件库使用 WAL，连接完成后关闭，临时目录由测试夹具清理。文档检查核对原件 SHA-256、分类容量、关键历史字段、本地文件链接和代码围栏。

注意：mutation_requests 测试只验证表的唯一性与回滚，尚未验证未来服务的 hash、重复响应重放或 HTTP 错误映射。实际图片字节没有解码，SQLite 对资产字段的约束不等于封面上传通过。

该脚本仅执行本阶段 SQL 草案与文档检查，全部数据库为内存库或唯一临时目录内的合成 WAL 库。没有测试 HTTP API、前端、原生驱动或用户实际数据。

## 手工设计核对

- 六类容量 10/10/10/6/10/5、合计 51；与 SQL seed、README 一致。
- 任务书所有作品字段、五张表、外键、评分、日期、索引与容量触发器都有映射。
- 新增 has_completed 和 archived_from_status，保持完整已看历史与恢复语义；收藏标记与占位分开。
- 满柜／零容量可补录历史，归档／重看不丢完成事实；未收到作品数据，未生成私人记录。
- Replace Mode 包含新增、恢复、跨类转入、候选 version、同 id 拒绝、幂等请求、事务回滚与取消。
- API、页面、访问保护、封面、备份、失败恢复及 A01–A20 的未来验收阶段均已记录。

手工核对是设计审阅，不能替代 L1–L4 实测。

## GitHub 检查与边界

实际执行技能 Inspect：账号 OldBeer1，目标 OldBeer1/limited-library，同名远端当时不存在。Initialize 已保存 .github-project.json 与未提交到远端的本机开工基线；main、公有、可选源码 ZIP 备份关闭。用户调用 github-project 是当前项目提交与普通推送的授权。

本阶段计划交付任务书、设计、SQL 与检查脚本。发布工具的实际扫描 / 推送 / SHA 核验报告保存在本机 Git 管理目录，最终发布状态另在交付回复说明。此处不提前宣称仓库创建或推送成功。

## 尚未执行与风险

- 未安装 React / Vite / Fastify / better-sqlite3；无 lockfile、无 npm 脚本，Windows 原生驱动兼容性待 L1 实测。
- 未运行应用单元测试、Fastify/API 测试、真实服务的幂等哈希／重放、CSRF 或封面解码验证。
- 未执行 lint、TypeScript 类型检查、应用 build、Windows 生产启动或浏览器 smoke/E2E。
- 未检查 375 / 768 / 1440px 的实际页面与键盘焦点；页面只有设计结构。
- 未执行应用重启持久化或个人数据备份恢复；本次临时 SQL 检查不代表这些验收完成。
- SQL 是新库草案，尚无正式迁移 runner、迁移备份／校验和验证；UTC 时间真实性和 UUID 格式需运行时校验。
- 历史记录无限额；永久删除会从已看清单移除。批量导入、每次重看明细与在线备份不在本次 MVP 默认范围。

下一阶段入口：用户确认 PLAN 集中列出的架构与产品规则后，实施 L1 并在本文件追加实际证据。

## Windows 桌面版追加验收（2026-10-15）

桌面源码 lint / typecheck / build 通过，原 26 项数据库与 API、29 项设计约束、10 项 Edge UI 及启动 smoke 回归通过。目录版与 NSIS 实际安装版各通过 10 项真实 exe 验收，包括 3,964 个运行资源 SHA-256、无系统 Node 的启动、沙盒、单实例、收藏／封面、原生备份、退出及重启持久化、缺库保护。安装器退出码 0，快捷方式存在，安装前后默认生产库逻辑 digest 相同。没有将测试作品写入个人资料库。详见 [WINDOWS.md](WINDOWS.md)。
