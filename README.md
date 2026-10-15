# Limited Library

**有限收藏，无限记忆。** 一个在 Windows 本地运行的个人媒体管理 Web App：精选作品放进限量收藏柜，所有看过、读过的作品完整留在历史清单中。

当前版本：MVP 0.1.0。React + TypeScript + Vite / Fastify / SQLite，npm workspaces。用户已确认 L0 设计，L1–L4 实现、验证结果见 [VALIDATION](docs/VALIDATION.md)。个人数据不上传 GitHub，核心使用不依赖互联网。

## 已实现

- 六类收藏柜、数量／容量／余位、分类入口与可用槽位。
- 完整已看／已读清单，包括柜内和归档作品；可补录、标记收藏、编辑、按标题／原标题搜索、筛选与分页。
- 作品详情编辑、评分、日期、备注、手动封面；封面可留空。
- 归档、恢复、跨分类编辑、明确确认的永久删除。
- Replace Mode：同类候选、归档／删除摘要、最终确认；取消保留草稿，失败整笔回滚。
- 服务端运行时校验、数据库容量守卫、version 冲突、UUID 请求重放。
- 六类容量设置、深色界面、375 / 768 / 1440px 布局与原生弹窗键盘操作。
- 停服备份、新目录恢复、数据库完整性／字段／封面 SHA-256 校验。

## 收藏柜与完整历史

| 分类 | 键 | 默认收藏柜容量 | 历史入口 |
|---|---|---:|---|
| 电视剧 | tv | 10 | 已看电视剧 |
| 电影 | movie | 10 | 已看电影 |
| 动漫 | anime | 10 | 已看动漫 |
| 纪录片 | documentary | 6 | 已看纪录片 |
| 话剧 | theatre | 10 | 已看话剧 |
| 漫画 | comic | 5 | 已读漫画 |

默认合计 51 个位置，各分类独立计数。planned、watching、completed、dropped 都占位；看完不会自动释放位置。归档不占位，恢复／跨类转入重新检查容量。容量可为 0，但须先整理该类柜内作品。

**历史清单不限条数。** “补录已看／已读”默认进入历史，不占柜子，满柜也能记录；未知完成日期可以留空。归档、重看、弃看保留“曾完成”事实。每条记录跨入口共享一份资料，不复制、不重复占位。

“收藏”星标表示喜欢，历史记录也能收藏；“放入收藏柜”是另一个动作，才需要空槽。评分可未填，或 0–10、0.5 步长；0 分与未评分区分。永久删除会同时移除对应已看记录，无法撤销；想保留历史请选择归档。

当前未收到个人片单，正式数据库不会预填演示作品。首版支持手动补录，没有硬盘扫描、第三方抓取、批量导入或每次重看明细。

## Windows 首次运行（PowerShell）

前提：Node 24.x、npm 11.x。本机已通过 Node 24.16.0 / npm 11.13.0，依赖准确版本由 package-lock.json 固定；better-sqlite3 和 sharp 的 Windows 原生加载已实测。不需要 Python 来运行应用。

```powershell
Set-Location -LiteralPath 'C:\Software\Limited Library'
npm ci
npm run build
npm run init-data
npm run start
```

打开 <http://127.0.0.1:3210>。仅监听 127.0.0.1；在终端按 Ctrl+C 正常关闭后再备份。

本项目已安装并构建时，也可以运行 ` .\Start-LimitedLibrary.ps1 `：检查／初始化数据库后启动。脚本不安装全局软件、不修改系统配置。已有库的版本／校验和／完整性不符会停止，绝不会清空重建。

端口被占用时明确失败，不自动切换。需要时在**同一个 PowerShell 会话**显式设置：

```powershell
$env:LL_PORT = '43100'
npm run start
```

访问对应端口即可。生产库首次创建必须使用 init-data；直接 start 不会在缺库时悄悄新建。

## 数据位置与开发

| 模式 | 数据目录 | 地址 |
|---|---|---|
| 生产 | `%LOCALAPPDATA%\LimitedLibrary\` | `http://127.0.0.1:3210` |
| 开发 | 项目 `.local-data\development\` | `http://127.0.0.1:43128`，代理本地 API |
| 自动测试 | 唯一系统临时目录，测试完成后关闭连接并清理 | smoke / UI 自动选择空闲端口 |

数据目录包含 library.sqlite、covers/ 与受控锁文件，与源码分开。LL_DATA_DIR 可显式指定绝对路径；LL_MODE=test 缺路径即拒绝。测试不回落真实库。开发默认不会打开生产库。

```powershell
npm run dev
```

开发采用 43128，是因为本机 5173 已被另一个进程以 Bound 状态占用。可用 LL_WEB_PORT 覆盖；LL_PORT 对应后端端口，两者与本地访问校验同步。生产默认仍为 3210。本机原有占用进程未被修改或终止。

封面仅接受真正解码通过的静态 PNG / JPEG / WebP，最大 5 MiB、单边 8192px、总像素 2000 万；保存副本，不接收任意文件路径。缺失封面显示占位。Host / Origin / Content-Type / 本次会话 token 共同保护写入，CORS 不单独承担保护。

## 验证命令（已实现）

```powershell
npm run test          # 真实 SQLite / API / 幂等 / 并发 / 封面 / 备份恢复
npm run lint
npm run typecheck
npm run build
npm run smoke         # 构建后的生产启动、重启持久化、开发 Vite 代理
npm run test:ui       # 已安装 Edge 中运行关键界面验收；须先 build
```

UI 检查使用项目本地 Playwright CLI 与现有 Edge，不装全局浏览器；所有数据是唯一临时目录中的合成数据，截图在 output/playwright/，不提交私人运行资料。没有 Edge 的机器可先运行其余检查，不能把未运行 UI 称为通过。

L0 的旧设计检查保留：`python .\scripts\check_design.py`，需要 Python 标准库。它检查 SQL 草案，不能代替真实驱动集成验证。

## 备份、恢复与意外退出

必须先停服，复制完整数据目录到新位置。不要在 WAL 活跃时只复制主 .sqlite 文件；本版本没有在线热备份。

```powershell
$dataDirectory = Join-Path $env:LOCALAPPDATA 'LimitedLibrary'
$backupDirectory = Join-Path $env:USERPROFILE ('Documents\LimitedLibraryBackups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm run backup -- --source "$dataDirectory" --destination "$backupDirectory"
```

恢复只写新的独立目录，并检查完整数据库逻辑与文件清单；任何目标已存在即拒绝覆盖。完整操作见 [BACKUP.md](docs/BACKUP.md)。

正常关闭会释放 `.data.lock`。若断电／强制结束后留有锁，先确认服务已退出，再执行：

```powershell
npm run unlock -- --data-dir "$dataDirectory"
```

工具只在记录的 PID 已不存在、锁内容未变化时移除锁；进程仍存在就拒绝，不终止任何进程。不要在服务运行时手动删锁。

## 文件与限制

- [L0 已确认设计](docs/PLAN.md)、[实施记录](docs/IMPLEMENTATION.md)、[实际验证](docs/VALIDATION.md)。
- [正式初始迁移](apps/server/src/db/migrations/001-initial.sql)；[原始 SQL 草案](docs/SCHEMA.sql) 保留可审阅基线。
- [原始任务书](01-Limited-Library-Codex任务书.md) 按原字节保留。

首版无游戏、用户系统、云同步、推荐、社交或外部元数据 API。搜索按文字包含，英文仅承诺 ASCII 大小写行为。取消上传后可能保留未引用封面副本，当前不自动清理；删除作品不删除用户原文件。迁移版本不兼容时停止，后续升级应先备份再编写与验证迁移。未做跨操作系统或超大历史库压力测试；没有配置或宣称远端 CI 通过。
