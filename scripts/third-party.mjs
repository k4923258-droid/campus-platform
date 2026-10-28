import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const lines=['# 第三方来源与采用说明','','项目由 create-vue 3.24.0 生成基础工程。业务规则与页面为本项目编写。未复制 Pure Admin、FormCreate 或 Sports Club Manager 的源码；这些仓库仅用于比较布局、表单描述方式及功能组织，不对其运行可靠性作背书。','','|参考|采用范围|版本或来源|','|---|---|---|','|create-vue|项目基础工程|3.24.0 / https://github.com/vuejs/create-vue|','|Pure Admin Thin|管理页面组织思路|https://github.com/pure-admin/pure-admin-thin|','|FormCreate|字段描述与渲染分离思路|https://github.com/xaboy/form-create|','|Sports Club Manager|预约与会员端功能比较|https://github.com/JosephHu04/sports-club-manager|','','## 直接运行依赖','','|包|锁定版本|许可证|','|---|---|---|']
for(const [name,version] of Object.entries(pkg.dependencies)){const p=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8'));lines.push(`|${name}|${version}|${typeof p.license==='string'?p.license:JSON.stringify(p.license)}|`)}
lines.push('','Java依赖与版本见 backend/pom.xml 及其Spring Boot依赖管理。Maven Wrapper 使用 Apache Maven 官方发行包。','所有依赖的完整版本由 package-lock.json 和 Maven 依赖管理固定；更新依赖后重新执行构建、规则及浏览器测试。','ExcelJS 的 UUID 依赖覆盖为11.1.1以消除已知漏洞，表格读写由本项目回归检查。')
fs.writeFileSync(path.join(root,'docs/第三方来源.md'),lines.join('\n')+'\n')
const notices=[]
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'))
for(const location of Object.keys(lock.packages).filter(p=>p.startsWith('node_modules/'))){const dir=path.join(root,location);if(!fs.existsSync(dir))continue;const manifest=path.join(dir,'package.json');if(!fs.existsSync(manifest))continue;const p=JSON.parse(fs.readFileSync(manifest,'utf8'));const licenseFile=fs.readdirSync(dir).find(f=>/^licen[cs]e(?:\.[a-z0-9]+)?$/i.test(f));if(licenseFile&&fs.statSync(path.join(dir,licenseFile)).isFile())notices.push(`\n====== ${p.name} ${p.version} ======\n`+fs.readFileSync(path.join(dir,licenseFile),'utf8'))}
fs.writeFileSync(path.join(root,'docs/THIRD_PARTY_NOTICES.txt'),notices.join('\n'))
