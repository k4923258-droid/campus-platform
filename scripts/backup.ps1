param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$config=Get-Content -LiteralPath (Join-Path $projectRoot 'backend/data/local-db.json') -Raw|ConvertFrom-Json
if(-not $OutputDirectory){$OutputDirectory=Join-Path $projectRoot 'backend/data/backups'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$name=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$target=Join-Path $OutputDirectory $name
New-Item -ItemType Directory -Path $target|Out-Null
$env:MYSQL_PWD=$config.password
try{& 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe' --protocol=TCP --host=127.0.0.1 "--port=$($config.port)" "--user=$($config.user)" --single-transaction --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 "--result-file=$(Join-Path $target 'campus.sql')" campus;if($LASTEXITCODE -ne 0){throw '数据库备份失败'}}finally{Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue}
$files=Join-Path $projectRoot 'backend/data/files'
if(Test-Path -LiteralPath $files){Copy-Item -LiteralPath $files -Destination (Join-Path $target 'files') -Recurse}
@{createdAt=(Get-Date).ToString('o');schema='v0.4';database='campus';note='恢复后必须先执行归档清理再开放服务'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
$resolvedRoot=(Resolve-Path -LiteralPath $OutputDirectory).Path
Get-ChildItem -LiteralPath $OutputDirectory -Directory|Where-Object {$_.Name -match '^\d{8}-\d{6}-\d{3}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json'))}|Sort-Object Name -Descending|Select-Object -Skip 7|ForEach-Object{$candidate=(Resolve-Path -LiteralPath $_.FullName).Path;if(-not $candidate.StartsWith($resolvedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '备份清理路径越界'};Remove-Item -LiteralPath $candidate -Recurse -Force}
Write-Output "备份完成：$target"
