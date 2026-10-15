# Run from PowerShell; no global configuration or installation is changed.
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps\server\dist\index.js'))) { throw '请先在本目录执行 npm ci 和 npm run build。' }
$env:LL_MODE = 'production'
& $nodePath (Join-Path $projectRoot 'apps\server\dist\index.js') --init
if ($LASTEXITCODE -ne 0) { throw '初始化／现有数据库校验失败，未启动。' }
$appPort = if ($env:LL_PORT) { $env:LL_PORT } else { '3210' }
Write-Host "启动后请打开 http://127.0.0.1:$appPort；按 Ctrl+C 正常关闭后再备份。"
& $nodePath (Join-Path $projectRoot 'apps\server\dist\index.js')
