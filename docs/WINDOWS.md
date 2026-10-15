# Limited Library Windows 桌面版

用户要求将已完成的本地 Web App 做成 Windows 软件。本版保留原 React/Fastify/SQLite 架构和 schema 1，以 Electron 提供独立桌面窗口和 Windows x64 NSIS 安装包。

## 使用

1. 运行 `Limited-Library-Setup-0.1.0-x64.exe`。默认按当前用户安装，可选择安装目录。
2. 从桌面／开始菜单打开 Limited Library。无需 Node、npm、浏览器或管理员权限。
3. “收藏柜”和“已看 · 已读”保持原有规则：六类精选柜有容量，历史不限条数，历史作品也能标记收藏。
4. 关闭窗口或选择“文件 → 退出”会关闭本程序的本地服务；重复双击会聚焦原窗口。

数据仍在 `%LOCALAPPDATA%\LimitedLibrary\`，和安装目录分开。第一次使用只初始化空目录；已有数据库必须通过版本、迁移 checksum、完整性和外键检查。非空目录缺库时拒绝启动，不会用空库掩盖资料丢失。旧 Web 服务需先正常关闭。

安装包不带个人数据。卸载保留数据目录；以后重装仍使用同一份资料。独立目录版是完整的 `win-unpacked/` 文件夹，不能单独移动 exe。当前未签名；Windows 可能显示发布者未知／信誉提示。本机验证环境是 Windows 11 x64，其他 Windows 版本和 ARM64 未实测。

## 备份与恢复

选择“文件 → 备份资料库…”，先保存正在编辑的内容，再选择备份存放目录。程序短暂停服、checkpoint 并关闭 SQLite，调用已有备份实现，校验独立副本的逻辑内容、封面与文件 SHA-256，然后重新启动服务和刷新界面。目标自动带时间戳，不覆盖已有文件。

也可以退出后完整复制数据文件夹；不要在运行中仅复制 library.sqlite，因为 SQLite 使用 WAL。数据库备份含私人备注，请自行选择保管位置。

恢复仍遵循“先验证到新目录，保留原库”的流程，详见 [备份与独立恢复](BACKUP.md)。桌面版固定打开默认资料目录；需要切换恢复副本时，应先完全退出程序，保留现有目录，并将验证好的完整副本放回默认位置。首版没有覆盖当前库的恢复按钮。意外断电留下的锁需按 README 的 unlock 流程核实处理，程序不会自动删除未知锁或杀死其他进程。

## 开发与打包（PowerShell）

```powershell
npm ci
npm run desktop        # 源码桌面窗口；开发时使用当前 Node 运行后端
npm run desktop:pack   # 完整独立目录 output/windows/win-unpacked/
npm run test:desktop   # 隔离数据验收独立目录 exe
npm run desktop:dist   # 生成中文安装包 output/windows/
```

构建需要 Windows x64、Node 24.x 和 npm 11.x；版本由 package-lock.json 固定，已有业务依赖未升级。首次构建需要下载 Electron／NSIS 资源及 Node 许可证，完成后的程序核心功能可离线使用。应用自身不实现自动更新；源码更新后重新打包安装。

桌面主进程位于 `apps/desktop/main.js`，窗口禁用 Node integration，启用 context isolation 和 sandbox，无 preload 或暴露给网页的桌面 IPC。它只允许自身 127.0.0.1 地址，阻断外部页面、额外窗口、下载和权限请求，并设置 CSP。备份通过主进程菜单和私有父子 IPC 完成，网页不能传入任意文件路径。

为复用已经验证的 better-sqlite3 原生模块，后端由随包提供的 Node 24 运行。`scripts/prepare-desktop.mjs` 根据 npm lock 复制已安装生产依赖，保留嵌套解析结构，并打包 Node 可执行文件、SHA-256 manifest 与官方许可证。Electron Builder 的通用资源映射会排除源根部的 node_modules，因此配置为后端依赖单独提供资源映射；验收逐文件核对包内资源，防止在项目目录下运行时误用开发依赖。构建器有意忽略的 .gitkeep / .DS_Store 元数据不计入运行资源核对。无需更换数据库驱动或为 Electron 重编译现有模块。代价是安装包体积更大。

## 实际验证

- 26 项原生 SQLite/API/并发/封面/备份恢复测试通过。
- 29 项原任务书／L0 设计回归检查通过；任务书和正式迁移 SQL 未改。
- lint、typecheck、生产 build 和生产重启／开发代理 smoke 通过。
- Edge 10 项关键 Web UI 验收通过。
- 真实打包 exe 的 10 项验收通过：包内 3,964 个运行文件 SHA-256 核对；System32-only PATH 启动；沙盒及外部请求限制；单实例；界面补录已看收藏和封面；原生菜单备份；备份后新会话保存；正常退出释放锁及子进程；重启持久化；非空缺库拒绝。

桌面验收仅向唯一系统临时目录内的资料库写合成作品，执行后清理临时资料。验收时应先关闭已运行的桌面程序，以免触发单实例聚焦。`output/desktop-check/results.json` 和截图为本机验收产物，不提交私人运行状态。NSIS 安装包已按当前用户在本机实际安装，安装器返回 0；桌面和开始菜单快捷方式存在，实际安装目录中的 exe 再次通过相同 10 项验收。安装前后默认生产库的逻辑 SHA-256 一致。安装包当前约 156 MB，未签名；文件 SHA-256 记录于同目录 SHA256SUMS.txt。
