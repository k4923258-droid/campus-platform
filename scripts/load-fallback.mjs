import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
const vus=Number(process.env.VUS||1000),duration=Number(process.env.DURATION_SECONDS||600)
const url=new URL((process.env.BASE_URL||'http://127.0.0.1:8080')+'/api/v1/snapshot')
const agent=new http.Agent({keepAlive:true,maxSockets:vus,maxFreeSockets:vus})
const latencies=[];let errors=0,requests=0,bytes=0,inflight=0,peakInflight=0
const started=Date.now(),until=started+duration*1000
const reporter=setInterval(()=>console.log(JSON.stringify({elapsedSeconds:Math.round((Date.now()-started)/1000),requests,errors,inflight})),30000)
function request(){return new Promise(resolve=>{const start=performance.now();inflight++;peakInflight=Math.max(peakInflight,inflight);let done=false;function finish(ok,size=0){if(done)return;done=true;inflight--;requests++;if(!ok)errors++;bytes+=size;latencies.push(performance.now()-start);resolve()}
 const req=http.get(url,{agent},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{let valid=false;try{valid=Array.isArray(JSON.parse(body).activities)}catch{}finish(res.statusCode===200&&valid,Buffer.byteLength(body))});res.on('error',()=>finish(false))});req.setTimeout(20000,()=>{req.destroy();finish(false)});req.on('error',()=>finish(false))})}
await Promise.all(Array.from({length:vus},async()=>{while(Date.now()<until){await request();await delay(1000)}}))
clearInterval(reporter);agent.destroy();latencies.sort((a,b)=>a-b)
const report={tool:'Node.js HTTP fallback; k6 official distribution unavailable due TLS EOF',at:new Date().toISOString(),node:process.version,cpu:os.cpus()[0]?.model,memoryBytes:os.totalmem(),vus,durationSeconds:duration,actualSeconds:(Date.now()-started)/1000,requests,errors,errorRate:errors/requests,peakInflight,bytes,p95Milliseconds:latencies[Math.floor(latencies.length*.95)],maxMilliseconds:latencies.at(-1),passed:errors/requests<.01&&latencies[Math.floor(latencies.length*.95)]<=2000}
fs.writeFileSync(new URL('../artifacts/load-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1
