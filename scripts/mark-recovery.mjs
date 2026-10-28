import fs from 'node:fs'
const fixture=JSON.parse(fs.readFileSync(new URL('../artifacts/restore-fixture.json',import.meta.url),'utf8'))
const manifest=JSON.parse(fs.readFileSync(fixture.backupDirectory+'/manifest.json','utf8').replace(/^\uFEFF/,''))
fs.writeFileSync(new URL('../artifacts/recovery-timing.json',import.meta.url),JSON.stringify({outageStart:new Date().toISOString(),backupAt:manifest.createdAt},null,2))
