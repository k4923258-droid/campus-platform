import fs from 'node:fs'
import assert from 'node:assert/strict'
const base='http://127.0.0.1:8080/api/v1',cookies=new Map()
async function req(method,path,body){const headers={'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')};if(cookies.has('XSRF-TOKEN'))headers['X-XSRF-TOKEN']=decodeURIComponent(cookies.get('XSRF-TOKEN'));const start=performance.now();const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});for(const value of response.headers.getSetCookie()){const first=value.split(';')[0],i=first.indexOf('=');cookies.set(first.slice(0,i),first.slice(i+1))}const data=await response.json();return{status:response.status,data,ms:performance.now()-start}}
await req('GET','/csrf');assert.equal((await req('POST','/session',{studentNo:'20260001',password:'Demo123!'})).status,200)
const publicData=(await req('GET','/snapshot')).data;const a=publicData.activities.find(a=>a.id==='photo-fall')
const form={activityId:a.id,answers:{intro:'重复提交压测',grade:'大一'}}
const latencies=[],statuses={};let cursor=0
await Promise.all(Array.from({length:10},async()=>{while(cursor++<100){const r=await req('POST','/commands/application.save',form);latencies.push(r.ms);statuses[r.status]=(statuses[r.status]||0)+1}}))
latencies.sort((a,b)=>a-b)
const after=(await req('GET','/snapshot')).data;const count=after.applications.filter(r=>r.activityId===a.id&&r.memberNos.includes('20260001')).length
const result={at:new Date().toISOString(),tool:'Node HTTP',scenario:'10并发、100次同一报名重试；与1000虚拟用户查询负载同机运行',requests:latencies.length,statuses,p95Milliseconds:latencies[Math.floor(latencies.length*.95)],duplicateRecords:count,passed:count===1&&latencies[Math.floor(latencies.length*.95)]<=3000&&Object.keys(statuses).every(s=>['200','409'].includes(s))}
fs.writeFileSync(new URL('../artifacts/submission-load.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1
