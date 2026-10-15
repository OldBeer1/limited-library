# Limited Library｜Codex 独立任务书

版本日期：2026-10-15

请把本文作为完整项目需求开始执行。你是负责该项目的开发工程师；本文无需总览、原附件、其他项目文档或先前聊天上下文。目标是一个主动限制保留作品数量的个人本地媒体管理 Web App。

## 本次执行范围：先完成设计，等待架构确认

保留用户原要求的设计确认边界：本次先检查环境 / 现有项目，完成架构、数据库 schema、页面结构、Replace Mode 业务逻辑，实际写入 docs/PLAN.md 和 README.md 草稿，然后汇报供用户确认。**本次先完成设计，等待用户确认后再实现 MVP。**

工作区约定：如果用户已选中 Limited Library 项目则在该目录工作；如果当前是空白开发目录则新建 limited-library 子目录保存设计。不复用其他媒体管理项目作为必需前提。

本次步骤：

1. 检查目录、现有代码和环境；用本文默认值组织设计，集中列出需要用户确认的产品规则，不在落盘前逐条追问。
2. 在 docs/PLAN.md 写清模块、接口、全部表 / 索引 / 约束、计数、归档恢复、跨分类、容量为 0、失败回滚和并发处理。可将可审阅 SQL 草案放入 docs/SCHEMA.sql；不创建真实用户数据库。
3. 在 README.md 草稿写理念、默认容量、占位规则、拟采用技术、计划中的 PowerShell 命令和数据路径；未实现的命令必须标为计划接口。
4. 对照本文核对字段、六类容量、页面和验收覆盖，说明尚未执行应用测试。
5. 汇报具体文件和设计取舍，集中提出架构 / 规则确认项，停在这个明确的确认点。

本次完成条件：两份文档已实际保存、设计可审阅、核心边界完整、待确认项清楚。仅复述需求或在聊天中再列一个计划不算完成。

用户后续明确确认架构或要求开始实现后，以本文后续章节为完整 MVP 规格，依次执行 L1–L4，无需再提供总览。

## 环境、工作区与操作约束

这些约束完整适用于本任务，无需额外提供共同说明。

1. 默认 Windows，终端优先 PowerShell。使用 CMD 或 Bash 时明确标注；先检查可用工具，不能假设存在 Linux 命令。
2. 开始前检查目标目录、README、适用的 AGENTS.md、依赖与锁文件、配置、构建 / 测试脚本、命名风格和相关实现；若为 Git 仓库先记录工作区状态。理解现有项目后再改。
3. 对空白开发目录按本任务的默认名称新建子目录；对现有同项目优先复用。若当前目录是无关项目，先说明判断依据并请求目标路径，不能往无关项目里硬塞新应用。不要扫描整盘寻找其他项目。
4. 小而完整地修改；保留无关未提交修改。已有项目沿用技术栈、包管理器和结构，不因存在新版本升级依赖，不做任务外重构。
5. 允许在目标项目中创建任务所需的文档、源码、测试、项目级配置与环境。系统软件安装、全局配置 / PATH 修改、真实数据迁移、外部发布另行取得明确授权。
6. 不擅自 push、merge、创建远程仓库、发布 release，或提交当前开发仓库。需要验证 Git 行为时使用临时仓库与测试身份，不更改用户全局 Git 身份。
7. 删除、覆盖、批量移动、权限修改或真实数据迁移前确认范围。文件操作先解析绝对路径并检查边界；Windows 操作使用同一 shell，不跨 shell 拼接删除或移动命令。
8. 进程调用传参数列表、显式 cwd 和超时，优先调用可信的真实可执行文件；不把用户输入拼为 shell 命令。Windows .cmd / .bat 包装器单独处理与实测，不能仅凭 shell=False 宣称安全。
9. 依赖先检查已有方案。新项目选择当时仍受支持且实际兼容的运行时与包版本，写入锁文件和验证记录；不使用未经核验的“最新版”作为可重复构建说明。
10. 执行范围允许实现时，先落盘简短实施计划，再连续完成当前范围内的代码和验证，不在每个小步骤重复询问。常规细节采用本文默认规则；显著改变产品行为或真实高风险操作才询问。
11. 验证按改动选择最小测试 → 相关单元 / 集成 → lint → 类型检查 → build → smoke。由本次修改引入的失败继续定位修复并重测；环境阻碍则说明准确失败位置、未验证项与风险，继续完成不受影响的工作。
12. 所有测试使用临时目录、临时数据库、合成数据和临时仓库；不触碰用户真实库、缓存或源码作为破坏性测试对象。只读分析先检查可能执行的项目脚本。
13. 阶段边界以本文“本次执行范围”为准。仅设计 / 仅审查时，后文的实现阶段和运行验收是未来要求，不能据此越过当前阶段。

## 结果报告与证据

完成当前执行范围后，给出：做了什么、关键文件的绝对路径、实际验证命令及结果、尚未验证内容、剩余问题、下一阶段的明确入口。修改过的文件与测试结果必须对应最终版本。

设计阶段应检查文档、schema 草案和业务边界是否一致；没有执行应用测试就标为未执行。实现阶段将真实工具版本、测试 / 构建 / 启动结果写入 docs/VALIDATION.md；本地成功不等于远端 CI 或发布成功。

任务组织参考 [OpenAI Docs：Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)。该链接仅供查证，本文已经给出执行所需的项目要求。

## 1. 首版范围

必须完成：六类媒体容量、首页槽位展示、作品增改查、删除 / 归档、Replace Mode、标题搜索、分类 / 状态 / 收藏筛选、容量设置、封面手动上传、本地持久化与可恢复备份。

| 分类 | 数据库键 | 默认上限 |
|---|---|---:|
| 电视剧 | tv | 10 |
| 电影 | movie | 10 |
| 动漫 | anime | 10 |
| 纪录片 | documentary | 6 |
| 话剧 | theatre | 10 |
| 漫画 | comic | 5 |

首版不做游戏分类、用户系统、云同步、AI、推荐、社交、外部元数据 API、自动抓取封面、无限滚动。封面可为空，使用安静的占位图。

## 2. 先明确容量的含义

以下是需求未完全定义的部分，本计划采用这些建议作为实现基线：

- **保留数量** = 同分类中 status ≠ archived 的作品数。planned、watching、completed、dropped 均占槽位；看完不会自动释放槽位。
- **归档区**保存历史记录，不占槽位，默认不混入收藏柜。归档独立入口、标题搜索、明确分页。
- 归档作品恢复时重新占槽位；满容量时也须经过替换流程。
- 更改分类时，按目标分类重新判断容量；不能通过编辑绕过限制。
- 满容量只能替换同分类中仍占槽位的旧作品。默认建议归档；永久删除须在确认界面明确说明后果。
- 容量是非负整数。允许设为 0，前提是该分类没有保留作品；此时禁止添加，不显示没有候选项的替换弹窗。
- 评分建议 0–10、0.5 为步长；未评分用 NULL，不能当成 0 分。
- 原标题参与搜索；同名允许存在，但添加时提醒重复，不使用标题唯一约束误伤重制版。
- 归档数量不设上限是历史记录策略。如果希望限制全部历史数量，需另改计数规则，不能混用两种定义。

设计确认时重点确认：归档是否不占位、completed / dropped 是否占位、评分尺度。未确认前这些仍是建议值。

## 3. 技术与架构

推荐 React + TypeScript + Vite 前端，Node.js + Fastify 本地后端，SQLite；新项目用 npm 管理依赖和 workspaces。不优先选 Next.js：本应用没有 SEO、SSR、公开站点或远端部署需求，明确的前后端边界更容易检查本地写入。

Vite 官方提供 React / TypeScript 模板，适合作为 SPA 起点。[Vite 官方指南](https://vite.dev/guide/)

~~~text
limited-library/
  apps/
    web/src/                 页面、表单、卡片、API 客户端
    server/src/
      routes/                参数验证、HTTP 错误映射
      services/              容量与替换事务
      repositories/          参数化 SQL
      db/migrations/         按序迁移、触发器
  packages/contracts/        DTO、枚举、固定请求 schema
  tests/                     集成测试、关键 E2E
  docs/PLAN.md
  docs/VALIDATION.md
  docs/BACKUP.md
  README.md
  package.json
  package-lock.json
~~~

前端不直接操作 SQLite，不以 localStorage 为主数据库。后端独占写入规则；共享 TypeScript 类型不能替代运行时校验。Fastify 使用固定 JSON Schema，不允许上传可执行 schema。[Fastify 参数验证文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

SQLite 驱动优先验证 better-sqlite3；先在目标 Windows / Node 组合安装、建库、执行事务，再固定依赖。失败先查原生模块和运行时兼容性，不自动安装编译工具或换框架。[better-sqlite3 官方仓库](https://github.com/WiseLibs/better-sqlite3)

## 4. 数据库设计

真实数据库与封面位于 %LOCALAPPDATA%\LimitedLibrary\，与源码、构建输出分开。开发和测试通过明确配置使用独立目录，测试绝不默认打开真实库。

### categories

| 字段 | 类型与约束 |
|---|---|
| id | TEXT PRIMARY KEY，固定六个键 |
| name | TEXT NOT NULL |
| capacity | INTEGER NOT NULL，CHECK ≥ 0 |
| sort_order | INTEGER NOT NULL |
| updated_at | UTC 时间字符串 |

### media_items

| API 字段 / DB 字段 | 类型与约束 |
|---|---|
| id | TEXT PRIMARY KEY，应用生成 UUID |
| title | TEXT NOT NULL，trim 后非空 |
| originalTitle / original_title | TEXT，可空 |
| category / category_id | TEXT NOT NULL，外键 categories.id |
| cover / cover_asset_id | TEXT，可空，外键 assets.id |
| status | TEXT NOT NULL，CHECK 五种合法值 |
| rating | REAL，可空，CHECK 0–10 且符合评分步长 |
| dateAdded / date_added | YYYY-MM-DD，本地日历日期 |
| dateCompleted / date_completed | YYYY-MM-DD，可空 |
| notes | TEXT，默认空串 |
| favorite | INTEGER NOT NULL DEFAULT 0，CHECK IN (0,1) |
| createdAt / created_at | UTC 时间字符串 |
| updatedAt / updated_at | UTC 时间字符串 |
| version | INTEGER NOT NULL DEFAULT 1，用于旧页面冲突检测 |

status 严格限定 planned、watching、completed、dropped、archived。dateCompleted 是历史事实，重新开始或归档不自动擦掉；用户可在编辑界面修正。

### assets 与迁移

assets 保存 id、服务生成的相对文件名、mime、size、created_at。数据库只保存受控资产引用，不保存任意用户文件路径。schema_migrations 记录已执行的迁移版本。mutation_requests 保存 request_id 主键、operation、payload_hash、result_json、created_at；与业务写入同事务提交。同一 UUID 对应不同参数时返回 REQUEST_ID_CONFLICT，不复用旧结果。

先建立 (category_id, status) 和必要的外键索引。作品量小，标题包含搜索先用参数化查询；英文大小写按明确归一化规则处理，不承诺 SQLite 默认 LIKE 能处理所有 Unicode 大小写。没有性能证据前不引入全文搜索。

## 5. 容量约束与 Replace Mode

### 数据库兜底

不能只禁用前端“添加”按钮。迁移必须创建：

1. INSERT 守卫：新记录占位且目标分类已满时拒绝。
2. UPDATE 守卫：归档恢复、改变分类等增加目标分类保留数时检查容量；同分类修改不多算自身。
3. categories.capacity UPDATE 守卫：新容量小于该分类保留数时拒绝。
4. 外键与 CHECK；每连接启用 foreign_keys；普通插入不用 INSERT OR REPLACE 偷换记录。

SQLite 触发器可以用 RAISE 拒绝不合法写入；真实数据库测试中直接 SQL 写入也须受保护。[SQLite CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html)

### 用户流程

~~~text
填写新增表单 → 服务端检查容量
  有位置 → 添加成功
  已满 → 返回 CATEGORY_FULL，保留表单 → 选择同分类旧作品
        → 展示“旧作品归档/删除 + 新作品加入”的摘要
        → 一次事务执行 → 成功后刷新收藏柜
  容量为 0 → 告知需要先调整容量
~~~

取消替换不改变任何持久数据。UI 不提前删旧项；请求失败不显示成功；候选已被其他页面修改时要求重新选择。

### 原子事务

~~~text
BEGIN IMMEDIATE
读取最新容量、旧项状态与 version
验证旧项仍在目标分类且占槽位
验证新项或待恢复项合法；两者不能是同一 id
按用户选择归档或删除旧项
插入新项，或者恢复 / 转入已有目标项
重新验证受影响分类不超限
COMMIT
任一步出错 → 显式 ROLLBACK 整个事务
~~~

事务内不等待封面上传或用户确认。上传先生成临时资产，事务仅写引用；失败残留文件之后按受控规则处理。删除记录不顺便删除用户原始封面文件。

SQLite 同时只有一个写事务；BEGIN IMMEDIATE 提前取得写事务，配合有限 busy timeout 与事务内复查，处理双标签页争抢最后一位。[SQLite 事务文档](https://www.sqlite.org/lang_transaction.html)

替换请求带请求 UUID，同事务记录完成结果，重复请求返回原结果；响应丢失后重试不会再归档另一项。此记录仅用于去重，不扩展成事件系统。

## 6. API 与错误契约

| 接口 | 行为 |
|---|---|
| GET /api/summary | 每分类 retained / capacity / remaining |
| GET /api/items | q、category、status、favorite、page；默认排除归档 |
| POST /api/items | 正常新增，满位返回冲突 |
| PATCH /api/items/:id | 修改字段、状态、分类，检查 version 和容量 |
| POST /api/replacements | 原子替换，支持新增或恢复已有项 |
| DELETE /api/items/:id | 用户确认后的永久删除 |
| GET /api/categories | 容量设置 |
| PATCH /api/categories/:id | 更新容量，数据库再次校验 |
| POST /api/assets | 校验并导入封面副本 |

错误统一返回 code、message 和必要信息。建议：400 参数错误、404 不存在、409 CATEGORY_FULL / VERSION_CONFLICT / CAPACITY_TOO_SMALL、503 DATABASE_BUSY。UI 不解析自然语言报错。列表、归档明确分页，没有无限滚动。

## 7. 页面与交互

- **首页 / 收藏柜**：轻量保留总数（排除归档）、六类入口、数量 / 容量 / 余位；进入分类显示封面。进度条辅助表达容量，不增加仪表盘图表。
- **详情 / 编辑**：封面、标题、状态、评分、日期、备注、收藏；归档与删除清楚区分。
- **添加作品**：先选分类，再填信息；满位仍可填写，提交时引导替换。
- **Replace Mode**：新作品摘要、同分类候选、归档 / 删除、最终确认；键盘可操作、取消保留表单。
- **归档区**：次级导航、单独搜索与分页；恢复重新校验容量。
- **设置**：六类容量与当前保留数；低于当前数时说明需先整理作品。

深色优先、低饱和、大留白、少动画。先用 CSS 变量和少量组件，不引入整套后台 UI。375px、768px、1440px 检查布局；表单有标签、焦点可见、弹窗管理焦点，容量不能只用颜色表示。

## 8. 本地运行与数据可靠性

- 生产模式 Node 同源提供页面与 API；默认只绑定 127.0.0.1。
- 校验 Host / Origin，写操作要求正确 Content-Type 与本次本地会话防伪令牌；CORS 不是唯一写入保护。
- 安装完成后核心使用不依赖互联网；SQLite 是数据事实来源。
- 封面首版仅允许实际验证过的 PNG / JPEG / WebP，建议上限 5 MiB；拒绝 SVG、伪造类型、目录穿越，限制尺寸和解码资源。
- MVP 至少交付停服备份恢复：关闭进程、确认连接关闭、复制完整数据目录到新位置、独立目录验证备份后再恢复。
- 开启 WAL 时不能在运行中只复制主 .sqlite 文件当完整备份；在线备份须用已验证的数据库备份接口。
- 迁移前备份；打不开旧库时停止并说明原因，不新建空库冒充正常。
- 封面缺失使用占位；数据库损坏不自动清空；日志不记录私人备注全文。

## 9. 开发阶段与交付门槛

| 阶段 | 任务 | 交付与通过条件 | 参考 |
|---|---|---|---:|
| L0 设计确认 | 冻结计数、归档、评分；架构、schema、页面与替换流程 | docs/PLAN.md、README 草稿可审阅；确认后实现 | 1 日 |
| L1 运行骨架 | 工具链、前后端、迁移、健康检查 | PowerShell 启动；临时库可写可读；兼容版本记录 | 1–2 日 |
| L2 规则与数据 | CRUD、触发器、事务、请求去重、设置 | 直接 SQL 与并发集成测试通过 | 2–3 日 |
| L3 核心界面 | 收藏柜、搜索筛选、替换、归档 | 完整闭环，取消和失败可恢复 | 2–3 日 |
| L4 交付 | 封面、响应式、备份、生产启动 | 构建、smoke test 和验收清单通过 | 2–3 日 |

合计约 8–12 个工作日；阶段区间不代表精确承诺。每次小范围提交，不加入云服务或游戏模块。

## 10. 必须通过的验收场景

| 场景 | 预期 |
|---|---|
| 电影 9/10 新增一项 | 成为 10/10，余位为 0 |
| 电影 10/10 直接新增 | API、数据库均拒绝，不出现第 11 项 |
| 满位归档旧 A、加入新 B | 保留数仍为 10，A 可在归档区找到 |
| 删除 A 后插入 B 失败 | 整体回滚，A 仍在、B 不存在 |
| 取消 Replace Mode | 数据不变，表单可继续编辑 |
| completed / dropped | 仍占位，首页和设置口径一致 |
| 满位恢复归档 / 跨分类转入 | 同样受容量限制 |
| 两个独立连接争抢最后一位 | 最多一个成功；另一个收到可理解的冲突或忙碌提示 |
| 保留 9 项时容量从 10 改为 8 | UI / API / SQL 均拒绝 |
| 容量为 0 | 正常显示禁用，不循环要求替换 |
| 同一请求 UUID 重试 | 不重复创建、不重复归档 |
| 关闭重开 | 数据、容量、封面仍在 |
| 备份恢复到独立目录 | 数量、字段、封面可读，原库未覆盖 |
| 375px 与键盘操作 | 表单无横向溢出，替换可完成 |

验证顺序：容量纯函数 → 真实 SQLite 集成 → API → 关键 UI / E2E → lint → 类型检查 → build → Windows 生产启动。mock 数据库不代替触发器和并发验证。

## 11. README 草稿与最终交付

README 草稿内容：产品理念、默认上限、占位状态、归档恢复、首版范围、Windows 前提、PowerShell 启动、实际数据路径、测试、备份恢复、已知限制。

计划统一脚本接口：npm run dev、npm run test、npm run lint、npm run typecheck、npm run build、npm run start。具体脚本须由 L1 实现并运行后才能标为已验证。

最终交付：可运行仓库、docs/PLAN.md、SQL 迁移与守卫、README.md、docs/BACKUP.md、docs/VALIDATION.md、自动测试、合成数据截图或操作记录。在应用实现与验证之前，不得将这些未来交付物标为已完成。

主要风险：归档理解不一致、前后端计数不一致、事务只回滚一半、Windows 驱动不兼容、错误备份。分别在 L0、L1、L2、L4 设门槛解决。
