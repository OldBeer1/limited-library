# Limited Library｜停服备份与独立恢复

适用于 MVP schema 1。源码 GitHub 交付不包含个人数据库、封面或备份。

## Windows 桌面菜单

桌面版可直接选择“文件 → 备份资料库…”。菜单在用户确认后短暂停服，复用本文同一份备份及校验逻辑，完成后重启并刷新界面。请先保存正在编辑的内容。详情见 [WINDOWS.md](WINDOWS.md)。以下命令仍供源码运行及独立恢复使用。

## 先关闭应用

桌面版关闭窗口并等待进程退出；Web 版在运行应用的终端按 Ctrl+C，等待退出。开发模式会关闭后端及其 Vite 子进程。所有写入者都须停止；工具发现 `.data.lock` 就拒绝，不杀进程。意外退出的锁先用 README 的 unlock 入口核实处理。

SQLite 使用 WAL。运行中只复制 library.sqlite 不能当完整备份。本版本仅支持停服复制整个目录，没有热备份能力。

## PowerShell 备份

在项目根目录、依赖已安装时执行。源与目标必须是绝对路径；目标必须不存在，源／目标不能互相包含。

```powershell
Set-Location -LiteralPath 'C:\Software\Limited Library'
$dataDirectory = Join-Path $env:LOCALAPPDATA 'LimitedLibrary'
$backupDirectory = Join-Path $env:USERPROFILE ('Documents\LimitedLibraryBackups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm run backup -- --source "$dataDirectory" --destination "$backupDirectory"
```

工具取得同一数据目录维护锁，检查路径无 symlink / junction、库可读、schema 版本与校验和、integrity_check、foreign_key_check、六类容量及封面文件。然后复制整个目录（不复制执行锁和旧备份清单），在独立副本再次检查。

backup-manifest.json 包含数据库所有表字段的逻辑 SHA-256 与全部文件 SHA-256。逻辑内容覆盖 categories、assets、media_items、schema_migrations、mutation_requests，包含备注、收藏、完成事实、归档前状态与版本。源目录保持不变。

结果 JSON 中 items / covers / files 表示实际验证数量；仅看到目标目录存在不能视为备份成功。失败副本保留供检查，不自动删除用户文件。清单不是加密，也不防止有权限者同时改写备份和清单；备份中包含私人备注，请自行选择保管位置。

## PowerShell 恢复到新目录

```powershell
$restoreDirectory = Join-Path $env:LOCALAPPDATA ('LimitedLibrary-Restored-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm run restore -- --source "$backupDirectory" --destination "$restoreDirectory"
```

恢复先检查文件列表、每个文件 SHA-256、数据库逻辑 SHA-256、schema、外键与封面，再复制并复核。原生产目录不被覆盖，已存在的恢复目标也拒绝。封面缺失或清单被改动会失败，不把部分副本当正常数据。

验证成功后，明确选择该副本运行：

```powershell
$env:LL_DATA_DIR = $restoreDirectory
npm run start
```

此选择只影响当前 PowerShell 会话。应用使用恢复副本写入，原库保留。不要同时以不同路径打开同一目录的 junction / 符号链接；工具主动拒绝这类路径。

## 当前验证范围

实际自动检查使用唯一临时目录与合成作品、备注、评分、收藏及封面；备份、恢复、逻辑一致、原库未覆盖、已有目标拒绝、文件篡改拒绝、运行中备份拒绝均纳入测试。详见 [VALIDATION.md](VALIDATION.md)。没有使用真实私人数据做破坏性测试。
