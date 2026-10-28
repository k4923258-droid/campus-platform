param([switch]$SkipBuild,[switch]$Maintenance)
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
try{if(-not $SkipBuild){& ./mvnw.cmd -B package -DskipTests;if($LASTEXITCODE -ne 0){throw '后端构建失败'}};& java -jar (Join-Path $projectRoot 'backend/target/campus-platform-0.4.0.jar');if($LASTEXITCODE -ne 0){throw 'Java服务启动或运行失败'}}finally{Pop-Location}
