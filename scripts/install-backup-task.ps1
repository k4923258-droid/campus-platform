$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$script=Join-Path $PSScriptRoot 'backup.ps1'
$powerShellPath=(Get-Command pwsh.exe -ErrorAction Stop).Source
$action=New-ScheduledTaskAction -Execute $powerShellPath -Argument ('-NoProfile -WindowStyle Hidden -File "'+$script+'"') -WorkingDirectory $projectRoot
$trigger=New-ScheduledTaskTrigger -Daily -At '02:00'
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'CampusPlatform-v04-LocalBackup' -Action $action -Trigger $trigger -Settings $settings -Description '课程原型独立数据库每日备份，保留最近7份' -Force|Out-Null
Write-Output '已配置每日02:00备份；关机时错过的任务将在可用时补执行。'
