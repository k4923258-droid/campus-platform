$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try{
 & npm.cmd run type-check
 if($LASTEXITCODE -ne 0){throw '类型检查失败'}
 & npx.cmd --no-install vite build --mode server
 if($LASTEXITCODE -ne 0){throw '前端构建失败'}
 $static=Join-Path $projectRoot 'backend/src/main/resources/static'
 New-Item -ItemType Directory -Force -Path $static|Out-Null
 Copy-Item -Path (Join-Path $projectRoot 'dist/*') -Destination $static -Recurse -Force
 & ./backend/mvnw.cmd -f backend/pom.xml -B package
 if($LASTEXITCODE -ne 0){throw '后端打包失败'}
}finally{Pop-Location}
