param([Parameter(Mandatory)][string]$BackupDirectory)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$config=Get-Content -LiteralPath (Join-Path $projectRoot 'backend/data/local-db.json') -Raw|ConvertFrom-Json
if(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue){throw '请先停止本项目后端（8080端口），再恢复。恢复全过程禁止开放访问。'}
$backup=(Resolve-Path -LiteralPath $BackupDirectory).Path
$sql=Join-Path $backup 'campus.sql'
if(-not(Test-Path -LiteralPath (Join-Path $backup 'manifest.json')) -or -not(Test-Path -LiteralPath $sql)){throw '不是有效的项目备份'}
$fileRoot=Join-Path $projectRoot 'backend/data/files'
New-Item -ItemType Directory -Force -Path $fileRoot|Out-Null
$ledger=Join-Path $fileRoot 'archive-ledger.json'
$current=@();if(Test-Path -LiteralPath $ledger){$current=@(Get-Content -LiteralPath $ledger -Raw|ConvertFrom-Json)}
$backupLedger=Join-Path $backup 'files/archive-ledger.json'
if(Test-Path -LiteralPath $backupLedger){$current+=@(Get-Content -LiteralPath $backupLedger -Raw|ConvertFrom-Json)}
$env:MYSQL_PWD=$config.password
try{('source '+$sql.Replace('\','/')+';')|& 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe' --protocol=TCP --host=127.0.0.1 "--port=$($config.port)" "--user=$($config.user)" --default-character-set=utf8mb4 campus;if($LASTEXITCODE -ne 0){throw '数据库恢复失败'}}finally{Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue}
$backupFiles=Join-Path $backup 'files'
if(Test-Path -LiteralPath $backupFiles){Get-ChildItem -LiteralPath $backupFiles -File|Where-Object Name -Match '^[0-9a-f-]{36}$'|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fileRoot $_.Name) -Force}}
ConvertTo-Json -InputObject @($current|Sort-Object -Unique)|Set-Content -LiteralPath $ledger -Encoding utf8
Write-Output '数据库与附件已恢复，当前归档清理记录已保留。后端启动会先执行清理和迁移，再接受请求。请启动后端后核验。'
