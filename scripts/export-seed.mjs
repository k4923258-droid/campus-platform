import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const root=path.resolve(import.meta.dirname,'..')
const temp=path.join(root,'node_modules/.cache/campus-seed')
fs.mkdirSync(temp,{recursive:true})
for(const file of ['types','seed']){let text=ts.transpileModule(fs.readFileSync(path.join(root,`src/domain/${file}.ts`),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;text=text.replace("from './types'","from './types.mjs'");fs.writeFileSync(path.join(temp,file+'.mjs'),text)}
const {seed}=await import('file:///'+path.join(temp,'seed.mjs').replaceAll('\\','/'));const state=await seed();delete state.now
fs.writeFileSync(path.join(root,'backend/src/main/resources/seed.json'),JSON.stringify(state,null,2))
