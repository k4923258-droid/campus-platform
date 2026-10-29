import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.BASE_URL || 'http://127.0.0.1:18089/api/v1'
const checks = []
function client() {
  const cookies = new Map()
  return async (method, path, body) => {
    const headers = {
      'Content-Type': 'application/json',
      Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
    }
    if (cookies.has('XSRF-TOKEN'))
      headers['X-XSRF-TOKEN'] = decodeURIComponent(cookies.get('XSRF-TOKEN'))
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const value of response.headers.getSetCookie()) {
      const first = value.split(';')[0],
        i = first.indexOf('=')
      cookies.set(first.slice(0, i), first.slice(i + 1))
    }
    const raw = await response.text()
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      data = raw
    }
    assert.equal(response.status, 200, path + ': ' + JSON.stringify(data))
    return data
  }
}
const manager = client(),
  student = client(),
  visitor = client(),
  admin = client()
const pass = (name) => {
  checks.push({ name, passed: true })
  console.log('PASS ' + name)
}
try {
  for (const [c, no] of [
    [manager, '20240001'],
    [student, '20260001'],
    [admin, 'admin'],
  ]) {
    await c('GET', '/csrf')
    await c('POST', '/session', { studentNo: no, password: 'Demo123!' })
  }
  const source = (await manager('GET', '/snapshot')).activities.find((a) => a.id === 'photo-fall')
  const title = '补充历史接口-' + Date.now()
  await manager('POST', '/commands/activity.save', {
    ...source,
    id: undefined,
    title,
    start: new Date(Date.now() - 600000).toISOString(),
    end: new Date(Date.now() + 600000).toISOString(),
    softGrade: '',
  })
  let a = (await manager('GET', '/snapshot')).activities.find((a) => a.title === title)
  await student('POST', '/commands/application.save', {
    activityId: a.id,
    answers: { intro: '旧版答案', grade: '大一' },
  })
  let row = (await manager('GET', '/snapshot')).applications.find((r) => r.activityId === a.id)
  const review = async () => {
    await manager('POST', '/commands/review.save', {
      id: row.id,
      version: row.version,
      stage: row.status,
      passed: true,
      commit: true,
      note: '审核版本记录',
    })
    row = (await manager('GET', '/snapshot')).applications.find((r) => r.id === row.id)
  }
  await review()
  await student('POST', '/commands/application.save', {
    id: row.id,
    version: row.version,
    activityId: a.id,
    answers: { intro: '新版答案', grade: '大一' },
  })
  row = (await manager('GET', '/snapshot')).applications.find((r) => r.id === row.id)
  assert.equal(row.versions[0].answers.intro, '旧版答案')
  assert.equal(row.versions[0].reviews[0].note, '审核版本记录')
  pass('真实接口保留旧版报名和正式结论')
  const audit = (await manager('GET', '/snapshot')).audits.find(
    (v) => v.action === 'review.save' && v.activityId === a.id,
  )
  assert.equal(audit.context.applicationId, row.id)
  assert.equal(audit.context.beforeStatus, 'initial')
  assert.equal(audit.context.afterStatus, 'interview')
  assert(audit.context.actorId && audit.context.at)
  assert.equal(
    (await student('GET', '/snapshot')).applications.find((r) => r.id === row.id).versions,
    undefined,
  )
  pass('结构化审核审计及历史管理权限')
  await review()
  await review()
  a = (await manager('GET', '/snapshot')).activities.find((v) => v.id === a.id)
  await manager('POST', '/commands/activity.save', {
    ...a,
    body: '调整公告',
    end: new Date(Date.now() - 1000).toISOString(),
  })
  const publicActivity = (await visitor('GET', '/snapshot')).activities.find((v) => v.id === a.id)
  assert.equal(publicActivity.lifecycleStatus, '待发布结果')
  assert.equal(publicActivity.changeHistory, undefined)
  assert(
    (await manager('GET', '/snapshot')).activities
      .find((v) => v.id === a.id)
      .changeHistory.some((c) => c.changes.body?.after === '调整公告'),
  )
  pass('公开生命周期状态和私有公告差异记录')
  await manager('POST', '/commands/result.publish', { activityId: a.id, admittedIds: [row.id] })
  await manager('POST', '/commands/result.withdraw', {
    activityId: a.id,
    reason: '第二版改为未录取',
  })
  await manager('POST', '/commands/result.publish', { activityId: a.id, admittedIds: [] })
  const history = (await manager('GET', '/snapshot')).activities.find(
    (v) => v.id === a.id,
  ).resultHistory
  assert.deepEqual(history[0].admittedIds, [row.id])
  assert.equal(history[0].reason, '第二版改为未录取')
  assert.deepEqual(history[1].unselectedIds, [row.id])
  assert.equal(
    (await visitor('GET', '/snapshot')).activities.find((v) => v.id === a.id).resultHistory,
    undefined,
  )
  pass('两版名单与更正原因留存，公开投影隐藏')
  await manager('POST', '/commands/activity.close', { activityId: a.id })
  await admin('POST', '/commands/activity.archive', { activityId: a.id, confirm: title })
  const after = await admin('GET', '/snapshot')
  const archived = after.activities.find((v) => v.id === a.id)
  assert.equal(archived.resultHistory, undefined)
  assert.equal(archived.changeHistory, undefined)
  assert(!after.applications.some((r) => r.activityId === a.id))
  assert(!after.audits.some((v) => v.activityId === a.id && v.action === 'review.save'))
  pass('归档清理新增历史、名单和审核敏感审计')
} catch (e) {
  checks.push({ name: '执行中断', passed: false, error: String(e) })
  console.error(String(e))
  process.exitCode = 1
} finally {
  fs.writeFileSync(
    new URL('../artifacts/history-server-checks.json', import.meta.url),
    JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
  )
}
