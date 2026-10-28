param([ValidateSet('start','stop')][string]$Action='start')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$runtimeRoot=Join-Path $projectRoot 'backend/data'
$dataRoot=Join-Path $runtimeRoot 'mysql'
$mysqlRoot='C:/Program Files/MySQL/MySQL Server 8.4'
$mysqld=Join-Path $mysqlRoot 'bin/mysqld.exe'
$mysql=Join-Path $mysqlRoot 'bin/mysql.exe'
$runtimeFile=Join-Path $runtimeRoot 'local-db.json'
if($Action -eq 'stop'){
 if(Test-Path -LiteralPath $runtimeFile){$config=Get-Content -LiteralPath $runtimeFile -Raw|ConvertFrom-Json;$env:MYSQL_PWD=$config.rootPassword;try{& (Join-Path $mysqlRoot 'bin/mysqladmin.exe') --protocol=TCP --host=127.0.0.1 --port=3307 --user=root shutdown;if($LASTEXITCODE -ne 0){throw '数据库停止失败'}}finally{Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue}}
 exit
}
if(-not(Test-Path -LiteralPath $mysqld)){throw '未找到 MySQL 8.4，请先安装并配置 mysqlRoot。'}
New-Item -ItemType Directory -Force -Path $runtimeRoot|Out-Null
$port=Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue
if($port){if(Test-Path -LiteralPath $runtimeFile){Write-Output '项目数据库端口3307已监听。';exit};throw '3307端口已被其他程序占用。'}
if(-not(Test-Path -LiteralPath (Join-Path $dataRoot 'mysql'))){& $mysqld --no-defaults --initialize-insecure "--basedir=$mysqlRoot" "--datadir=$dataRoot";if($LASTEXITCODE -ne 0){throw '初始化项目独立数据库失败'}}
$arguments=@('--no-defaults',('"--basedir='+$mysqlRoot+'"'),('"--datadir='+$dataRoot+'"'),'--port=3307','--bind-address=127.0.0.1','--mysqlx=OFF',('"--log-error='+(Join-Path $runtimeRoot 'mysql.log')+'"'))
$process=Start-Process -FilePath $mysqld -ArgumentList $arguments -WindowStyle Hidden -PassThru
$ready=$false
for($n=0;$n -lt 60;$n++){if(Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue){$ready=$true;break};Start-Sleep -Milliseconds 500}
if(-not $ready){throw '项目数据库未在30秒内就绪，请检查 backend/data/mysql.log。'}
if(-not(Test-Path -LiteralPath $runtimeFile)){
 $rootPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
 $password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
 $sql="CREATE DATABASE IF NOT EXISTS campus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'campus'@'127.0.0.1' IDENTIFIED BY '$password'; GRANT ALL PRIVILEGES ON campus.* TO 'campus'@'127.0.0.1'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword';"
 $sql|& $mysql --protocol=TCP --host=127.0.0.1 --port=3307 --user=root --default-character-set=utf8mb4
 if($LASTEXITCODE -ne 0){throw '创建本地课程数据库账号失败'}
 @{user='campus';password=$password;rootPassword=$rootPassword;port=3307;pid=$process.Id}|ConvertTo-Json|Set-Content -LiteralPath $runtimeFile -Encoding utf8
 & icacls.exe $runtimeFile /inheritance:r /grant:r "$($env:USERNAME):(F)" 'SYSTEM:(F)'|Out-Null
}
Write-Output '项目独立 MySQL 已启动：127.0.0.1:3307。凭据保存在忽略提交的 backend/data/local-db.json。'
