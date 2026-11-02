param([switch]$SkipBuild)
# Delegate Windows PowerShell to the PowerShell 7 runtime used by these scripts.
if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwshCommand = Get-Command pwsh.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $pwshPath = if ($pwshCommand) { $pwshCommand.Source } else { $null }
  if (-not $pwshPath) {
    $bundledPwsh = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    if (Test-Path -LiteralPath $bundledPwsh) { $pwshPath = $bundledPwsh }
  }
  if (-not $pwshPath) { throw 'PowerShell 7 is required. Install it and run this script with pwsh.exe.' }
  $forwardArgs = @('-NoProfile', '-File', $PSCommandPath)
  if ($SkipBuild) { $forwardArgs += '-SkipBuild' }
  & $pwshPath @forwardArgs
  if ($LASTEXITCODE -ne 0) { throw ('PowerShell 7 startup failed (exit ' + $LASTEXITCODE + ').') }
  return
}
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  # PowerShell scripts signal failure by throwing; LASTEXITCODE belongs to native commands.
  & './scripts/local-db.ps1' start
  $cfg=Get-Content -LiteralPath 'backend/data/local-db.json' -Raw | ConvertFrom-Json
  $env:MYSQL_PWD=$cfg.rootPassword
  try {
    "CREATE DATABASE IF NOT EXISTS campus_v05_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON campus_v05_local.* TO 'campus'@'127.0.0.1';" | & 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe' --protocol=TCP --host=127.0.0.1 --port=3307 --user=root
    if($LASTEXITCODE -ne 0){throw '独立测试库准备失败'}
  } finally {Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue}
  $mailpit=Join-Path $projectRoot '.tools/mailpit/mailpit.exe'
  if(-not(Test-Path -LiteralPath $mailpit)) {
    New-Item -ItemType Directory -Force -Path '.tools/mailpit' | Out-Null
    $release=Invoke-RestMethod 'https://api.github.com/repos/axllent/mailpit/releases/tags/v1.33.0'
    $asset=$release.assets | Where-Object name -eq 'mailpit-windows-amd64.zip'
    & curl.exe --fail --location --retry 2 --silent --show-error --output '.tools/mailpit/mailpit.zip' $asset.browser_download_url
    if($LASTEXITCODE -ne 0){throw 'Mailpit官方下载失败'}
    $hash=(Get-FileHash -LiteralPath '.tools/mailpit/mailpit.zip' -Algorithm SHA256).Hash.ToLowerInvariant()
    if(-not $asset.digest -or $asset.digest -ne ('sha256:'+$hash)){throw 'Mailpit官方摘要校验失败'}
    Expand-Archive -LiteralPath '.tools/mailpit/mailpit.zip' -DestinationPath '.tools/mailpit' -Force
  }
  $mailListening=Get-NetTCPConnection -LocalPort 8025 -State Listen -ErrorAction SilentlyContinue
  if(-not $mailListening) {
    Start-Process -FilePath $mailpit -ArgumentList '--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --disable-version-check --database backend/data/mailpit.db' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput 'backend/data/mailpit.out.log' -RedirectStandardError 'backend/data/mailpit.err.log' | Out-Null
  }
  if(-not $SkipBuild){& './scripts/package-server.ps1'}
  $env:CAMPUS_DB_URL='jdbc:mysql://127.0.0.1:3307/campus_v05_local?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai'
  $env:CAMPUS_DB_USER=$cfg.user;$env:CAMPUS_DB_PASSWORD=$cfg.password
  $env:CAMPUS_DEMO='false';$env:CAMPUS_IDENTITY_MODE='local-mail';$env:CAMPUS_MAIL_ENABLED='true'
  $env:SPRING_PROFILES_ACTIVE='local';$env:SERVER_PORT='8085';$env:CAMPUS_FILES=Join-Path $projectRoot 'backend/data/files-v05'
  Write-Output '本地网站 http://127.0.0.1:8085/；测试收件箱 http://127.0.0.1:8025/；使用独立campus_v05_local数据库。'
  & java -jar 'backend/target/campus-platform-0.5.0.jar'
  if($LASTEXITCODE -ne 0){throw '本地服务退出，请检查日志'}
} finally {Pop-Location}
