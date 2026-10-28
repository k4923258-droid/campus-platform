import http from 'k6/http'
import { check,sleep } from 'k6'
export const options={vus:1000,duration:'10m',thresholds:{http_req_duration:['p(95)<2000'],http_req_failed:['rate<0.01'],checks:['rate>0.99']}}
const base=__ENV.BASE_URL||'http://127.0.0.1:8080'
export default function(){const r=http.get(base+'/api/v1/snapshot');check(r,{'公开信息查询成功':r=>r.status===200,'包含活动':r=>r.json('activities')?.length>0});sleep(1)}
