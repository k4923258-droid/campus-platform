$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$outputRoot=Join-Path (Split-Path $projectRoot -Parent) 'output'
New-Item -ItemType Directory -Force -Path $outputRoot|Out-Null
$target=Join-Path $outputRoot 'campus-platform-v0.4-source.zip'
if(Test-Path -LiteralPath $target){$target=Join-Path $outputRoot ('campus-platform-v0.4-source-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip')}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Push-Location $projectRoot
try{
 $files=@(& git -c core.quotepath=false ls-files --cached --others --exclude-standard)
 if($LASTEXITCODE -ne 0){throw '读取源码清单失败'}
 $zip=[IO.Compression.ZipFile]::Open($target,[IO.Compression.ZipArchiveMode]::Create)
 try{foreach($file in ($files|Sort-Object -Unique)){if($file -match '(^|/)(node_modules|data|target|\.git|\.tools)/'){throw '源码包包含应排除的本地运行目录'};[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $projectRoot $file),('campus-platform/'+$file.Replace('\','/')),[IO.Compression.CompressionLevel]::Optimal)|Out-Null}}finally{$zip.Dispose()}
}finally{Pop-Location}
Write-Output "源码包已生成：$target"
