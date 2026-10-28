$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$jarPath=[IO.Path]::GetFullPath((Join-Path $projectRoot 'backend/target/campus-platform-0.4.0.jar'))
$listeners=Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
foreach($listener in $listeners){$process=Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)";if($process.Name -ne 'java.exe' -or -not $process.CommandLine.Contains($jarPath)){throw '8080监听进程不符合本项目JAR路径，已拒绝停止。'};Stop-Process -Id $process.ProcessId}
Write-Output '本项目后端已停止。数据库需另用 local-db.ps1 stop 停止。'
