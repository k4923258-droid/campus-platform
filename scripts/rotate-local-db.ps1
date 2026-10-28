$ErrorActionPreference='Stop'
$runtimeFile=Join-Path (Split-Path $PSScriptRoot -Parent) 'backend/data/local-db.json'
$config=Get-Content -LiteralPath $runtimeFile -Raw|ConvertFrom-Json
$rootPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$env:MYSQL_PWD=$config.rootPassword
try{
 $sql="ALTER USER 'campus'@'127.0.0.1' IDENTIFIED BY '$password'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword';"
 $sql|& 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe' --protocol=TCP --host=127.0.0.1 --port=3307 --user=root
 if($LASTEXITCODE -ne 0){throw '本项目数据库凭据轮换失败'}
 $config.password=$password;$config.rootPassword=$rootPassword
 $config|ConvertTo-Json|Set-Content -LiteralPath $runtimeFile -Encoding utf8
}finally{Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue}
Write-Output '本项目数据库凭据已轮换，未输出新值。'
