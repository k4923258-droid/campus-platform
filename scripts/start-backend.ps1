param([switch]$SkipBuild,[switch]$Maintenance)
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
  if ($Maintenance) { $forwardArgs += '-Maintenance' }
  & $pwshPath @forwardArgs
  if ($LASTEXITCODE -ne 0) { throw ('PowerShell 7 startup failed (exit ' + $LASTEXITCODE + ').') }
  return
}
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'local-db.ps1') start
$config=Get-Content -LiteralPath (Join-Path $projectRoot 'backend/data/local-db.json') -Raw|ConvertFrom-Json
$env:CAMPUS_DB_USER=$config.user
$env:CAMPUS_DB_PASSWORD=$config.password
$env:CAMPUS_DEMO='true'
$env:CAMPUS_FILES=Join-Path $projectRoot 'backend/data/files'
$env:CAMPUS_MAINTENANCE=if($Maintenance){'true'}else{'false'}
Push-Location (Join-Path $projectRoot 'backend')
try{if(-not $SkipBuild){& ./mvnw.cmd -B package -DskipTests;if($LASTEXITCODE -ne 0){throw '后端构建失败'}};& java -jar (Join-Path $projectRoot 'backend/target/campus-platform-0.5.0.jar');if($LASTEXITCODE -ne 0){throw 'Java服务启动或运行失败'}}finally{Pop-Location}
