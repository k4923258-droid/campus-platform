import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// This suite is deliberately restricted to the separately created local-mail database.
const root = path.resolve(import.meta.dirname, '..')
const base = process.env.IDENTITY_TEST_URL || 'http://127.0.0.1:8085'
assert.equal(new URL(base).hostname, '127.0.0.1')
const mailBase = 'http://127.0.0.1:8025'
const cfg = JSON.parse(
  fs.readFileSync(path.join(root, 'backend/data/local-db.json'), 'utf8').replace(/^\uFEFF/, ''),
)
const results = []
const runId = Date.now().toString().slice(-9)
const number = (n) => `2026${runId}${n}`
const address = (n) => `${number(n)}@stu.neu.edu.cn`
const password = 'LocalTest123!'
const sql = (text) =>
  execFileSync(
    'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
    [
      '--protocol=TCP',
      '--host=127.0.0.1',
      '--port=3307',
      `--user=${cfg.user}`,
      '--database=campus_v05_local',
      '--batch',
      '--skip-column-names',
      '--default-character-set=utf8mb4',
      '--execute',
      text,
    ],
    { env: { ...process.env, MYSQL_PWD: cfg.password }, encoding: 'utf8' },
  ).trim()
const literal = (value) => {
  assert.match(value, /^[A-Za-z0-9@._+-]+$/)
  return `'${value}'`
}
class Client {
  cookies = new Map()
  async call(route, method = 'GET', body) {
    if (method !== 'GET' && !this.cookies.has('XSRF-TOKEN')) await this.call('/csrf')
    const headers = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET')
      headers['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies.get('XSRF-TOKEN') || '')
    const r = await fetch(base + '/api/v1' + route, {
      method,
      headers,
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    })
    for (const cookie of r.headers.getSetCookie()) {
      const first = cookie.split(';')[0],
        i = first.indexOf('=')
      this.cookies.set(first.slice(0, i), first.slice(i + 1))
    }
    const data = await r.json().catch(() => ({}))
    return { status: r.status, data, retryAfter: r.headers.get('Retry-After') }
  }
  post(route, body) {
    return this.call(route, 'POST', body)
  }
  async login(login, pw = password) {
    const r = await this.post('/session', { studentNo: login, password: pw })
    ok(r)
    return this
  }
  async view() {
    const r = await this.call('/snapshot')
    ok(r)
    return r.data
  }
}
function ok(r, status = 200) {
  assert.equal(r.status, status, r.data.message || `HTTP ${r.status}`)
  return r.data
}
async function test(name, action) {
  const start = Date.now()
  try {
    await action()
    results.push({ name, passed: true, ms: Date.now() - start })
    console.log('PASS ' + name)
  } catch (e) {
    results.push({ name, passed: false, ms: Date.now() - start, message: e.message })
    throw e
  }
}
async function otp(email, purpose = 'register', client = new Client(), extra = {}) {
  const c = ok(await client.post('/auth/email/challenges', { email, purpose, ...extra }))
  assert.ok(!('code' in c) && !('digest' in c), '接口不得返回验证码或摘要')
  for (let i = 0; i < 30; i++) {
    const inbox = await fetch(mailBase + '/api/v1/messages').then((r) => r.json())
    const message = inbox.messages?.find((m) => m.To.some((t) => t.Address === email))
    if (message) {
      const detail = await fetch(mailBase + '/api/v1/message/' + message.ID).then((r) => r.json())
      const match = detail.Text?.match(/验证码：(\d{6})/)
      if (match) return { ...c, code: match[1], email }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Mailpit 未收到预期验证码邮件')
}
function elapsed(email) {
  sql(`UPDATE email_challenge SET created_at=created_at-60001 WHERE email=${literal(email)}`)
}
async function register(n, domain = 'stu.neu.edu.cn') {
  const email = `${number(n)}@${domain}`,
    c = await otp(email)
  const response = ok(
    await new Client().post('/auth/register', { ...c, name: '本地模拟用户', password }),
  )
  return { email, no: number(n), id: response.id, c }
}
let providers
try {
  providers = ok(await new Client().call('/auth/providers'))
  assert.equal(providers.mode, 'local-mail')
  assert.equal(providers.emailAvailable, true)
  let first, second, one, two, manager, admin, pending
  await test('TC-ID-015 学校认证未配置，发起与回调均不可用', async () => {
    assert.equal(providers.schoolAvailable, false)
    ok(await new Client().call('/auth/login/neu'), 503)
    ok(await new Client().call('/auth/callback/neu?ticket=fake'), 503)
  })
  await test('TC-ID-001 精确邮箱域名白名单', async () => {
    for (const email of ['x@other.edu.cn', 'x@neu.edu.cn.evil.example', 'x@sub.stu.neu.edu.cn'])
      ok(await new Client().post('/auth/email/challenges', { email, purpose: 'register' }), 422)
  })
  await test('TC-ID-002/003/011 SMTP收件、可信学号及普通用户权限', async () => {
    const email = address(1),
      c = await otp(email)
    ok(
      await new Client().post('/auth/register', {
        ...c,
        studentNo: '20260001',
        name: '测试',
        password,
      }),
      422,
    )
    first = {
      id: ok(
        await new Client().post('/auth/register', {
          ...c,
          name: '本地模拟用户',
          password,
          roles: ['admin'],
          orgIds: ['photo'],
        }),
      ).id,
      email,
      no: number(1),
      c,
    }
    one = await new Client().login(first.email)
    const me = (await one.view()).me
    assert.equal(me.studentNo, first.no)
    assert.deepEqual(me.roles, ['student'])
    assert.deepEqual(me.orgIds, [])
    assert.equal(me.identitySource, 'local-mail')
    assert.ok(!JSON.stringify(await one.view()).includes(first.email))
  })
  await test('TC-ID-005 验证码一次性，不接受重放', async () => {
    ok(await new Client().post('/auth/register', { ...first.c, name: '重复', password }), 422)
  })
  await test('TC-ID-006 重发60秒限制及重发后旧申请失效', async () => {
    const email = address(2),
      old = await otp(email)
    ok(await new Client().post('/auth/email/challenges', { email, purpose: 'register' }), 429)
    elapsed(email)
    const current = await otp(email)
    ok(await new Client().post('/auth/register', { ...old, name: '旧申请', password }), 422)
    second = {
      email,
      no: number(2),
      id: ok(
        await new Client().post('/auth/register', { ...current, name: '第二位模拟用户', password }),
      ).id,
    }
    two = await new Client().login(second.email)
  })
  await test('TC-ID-005 过期验证码被拒绝（隔离库时间夹具）', async () => {
    const c = await otp(address(3))
    sql(`UPDATE email_challenge SET expires_at=0 WHERE id=${literal(c.challengeId)}`)
    ok(await new Client().post('/auth/register', { ...c, name: '过期', password }), 422)
  })
  await test('TC-ID-006 校验失败次数真实落库且第五次后锁定', async () => {
    const c = await otp(address(4))
    for (let i = 0; i < 5; i++)
      ok(
        await new Client().post('/auth/register', { ...c, code: 'wrong', name: '失败', password }),
        422,
      )
    assert.equal(
      sql(`SELECT attempts FROM email_challenge WHERE id=${literal(c.challengeId)}`),
      '5',
    )
    ok(await new Client().post('/auth/register', { ...c, name: '正确码仍锁定', password }), 422)
  })
  await test('TC-ID-004 映射未确认账号只允许公开浏览', async () => {
    pending = await register(5, 'mails.neu.edu.cn')
    const c = await new Client().login(pending.email),
      view = await c.view()
    assert.equal(view.me.accountStatus, 'pending')
    assert.equal(view.me.studentNo, '')
    assert.deepEqual(view.applications, [])
    ok(
      await c.post('/commands/application.save', {
        activityId: 'photo-fall',
        answers: { intro: '材料', grade: '大一' },
      }),
      403,
    )
    ok(await c.post('/commands/grant.apply', { orgId: 'math', reason: '模拟申请' }), 403)
    ok(
      await c.post('/files', {
        name: 'x.pdf',
        mime: 'application/pdf',
        size: 1,
        data: 'data:application/pdf;base64,WA==',
      }),
      403,
    )
  })
  await test('TC-ID-007 同一申请并发注册只形成一个身份', async () => {
    const c = await otp(address(6)),
      payload = { ...c, name: '并发', password }
    const r = await Promise.all([
      new Client().post('/auth/register', payload),
      new Client().post('/auth/register', payload),
    ])
    assert.equal(r.filter((v) => v.status === 200).length, 1)
    assert.equal(
      sql(`SELECT COUNT(*) FROM account_identity WHERE email=${literal(address(6))}`),
      '1',
    )
  })
  await test('REQ-F-102 旧注册命令拒绝免验证建号', async () => {
    ok(
      await new Client().post('/commands/register', {
        studentNo: number(7),
        name: '绕过',
        password,
      }),
      403,
    )
  })
  await test('TC-ID-009 未注册成员拒绝，成员解析仅返回必要字段', async () => {
    ok(
      await one.post('/commands/application.save', {
        activityId: 'innovation-team',
        memberNos: [number(8)],
        answers: { proposal: '模拟项目' },
      }),
      422,
    )
    const m = ok(
      await one.post('/activities/innovation-team/team-members/resolve', { studentNo: second.no }),
    )
    assert.deepEqual(Object.keys(m).sort(), ['id', 'name', 'studentNo'])
    assert.equal(m.id, second.id)
  })
  let teamId
  await test('REQ-F-028/031 团队按用户ID建立、全员通知', async () => {
    ok(
      await one.post('/commands/application.save', {
        activityId: 'innovation-team',
        memberUserIds: [second.id],
        answers: { proposal: '模拟团队' },
      }),
    )
    const row = (await one.view()).applications.find((r) => r.activityId === 'innovation-team')
    teamId = row.id
    assert.deepEqual(row.memberUserIds, [first.id, second.id])
    assert.ok((await two.view()).notices.some((n) => n.activityId === 'innovation-team'))
  })
  await test('TC-ID-010 无关联用户不能查看团队、读取附件或退出', async () => {
    const outsider = await new Client().login('20260003', 'Demo123!')
    assert.ok(!(await outsider.view()).applications.some((r) => r.id === teamId))
    ok(await outsider.post('/commands/application.exit', { id: teamId }), 403)
    const file = ok(
      await one.post('/files', {
        name: 'audit.txt.zip',
        mime: 'application/zip',
        size: 22,
        data: 'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
      }),
    )
    ok(await outsider.call('/files/' + file.id), 403)
  })
  await test('REQ-F-033 队员退出释放占用，低于下限暂停流转', async () => {
    ok(await two.post('/commands/application.exit', { id: teamId }))
    assert.ok(!(await two.view()).applications.some((r) => r.id === teamId))
    const row = (await one.view()).applications.find((r) => r.id === teamId)
    assert.equal(row.memberUserIds.length, 1)
    ok(await one.post('/commands/application.withdraw', { id: teamId }))
  })
  await test('REQ-N-040 MySQL并发成员占用仅一队成功', async () => {
    const shared = await register(11)
    const payload = {
      activityId: 'innovation-team',
      memberUserIds: [shared.id],
      answers: { proposal: '争抢成员' },
    }
    const r = await Promise.all([
      one.post('/commands/application.save', payload),
      two.post('/commands/application.save', payload),
    ])
    assert.equal(r.filter((v) => v.status === 200).length, 1)
    assert.equal(r.filter((v) => v.status === 409).length, 1)
    assert.equal(
      sql(
        `SELECT COUNT(*) FROM registration_member WHERE activity_id='innovation-team' AND user_id=${literal(shared.id)}`,
      ),
      '1',
    )
  })
  await test('UC-02/03/04/05 发布→报名→草稿→确认→抢时段→录取更正', async () => {
    manager = await new Client().login('20240001', 'Demo123!')
    admin = await new Client().login('admin', 'Demo123!')
    const template = (await manager.view()).activities.find((a) => a.id === 'photo-fall')
    const end = Date.now() + 8000
    const p = {
      ...template,
      id: undefined,
      title: 'v0.5真实接口主线-' + runId,
      start: new Date(Date.now() - 60000).toISOString(),
      end: new Date(end).toISOString(),
    }
    ok(await manager.post('/commands/activity.save', p))
    const activity = (await manager.view()).activities.find((a) => a.title === p.title)
    ok(
      await manager.post('/commands/slot.save', {
        activityId: activity.id,
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 5400000).toISOString(),
        place: '本地测试',
        capacity: 1,
        cancelled: false,
      }),
    )
    const slot = (await manager.view()).slots.find((v) => v.activityId === activity.id)
    const ids = []
    for (const c of [one, two]) {
      ok(
        await c.post('/commands/application.save', {
          activityId: activity.id,
          answers: { intro: '模拟材料', grade: '大一' },
        }),
      )
      const r = (await c.view()).applications.find((r) => r.activityId === activity.id)
      ids.push(r.id)
      ok(
        await manager.post('/commands/review.save', {
          id: r.id,
          version: 1,
          stage: 'initial',
          commit: false,
          passed: true,
        }),
      )
      assert.equal((await c.view()).applications.find((v) => v.id === r.id).status, 'initial')
      ok(
        await manager.post('/commands/review.save', {
          id: r.id,
          version: 1,
          stage: 'initial',
          commit: true,
          passed: true,
        }),
      )
      ok(
        await manager.post('/commands/review.save', {
          id: r.id,
          version: 0,
          stage: 'interview',
          commit: true,
          passed: true,
        }),
        409,
      )
    }
    const booked = await Promise.all([
      one.post('/commands/slot.book', { id: ids[0], slotId: slot.id }),
      two.post('/commands/slot.book', { id: ids[1], slotId: slot.id }),
    ])
    assert.equal(booked.filter((v) => v.status === 200).length, 1)
    assert.equal(booked.filter((v) => v.status === 409).length, 1)
    assert.equal(
      sql(`SELECT COUNT(*) FROM slot_reservation WHERE slot_id=${literal(slot.id)}`),
      '1',
    )
    for (const id of ids)
      ok(
        await manager.post('/commands/review.save', {
          id,
          version: 1,
          stage: 'interview',
          commit: true,
          passed: true,
        }),
      )
    if (Date.now() < end) await new Promise((r) => setTimeout(r, end - Date.now() + 50))
    ok(
      await manager.post('/commands/result.publish', {
        activityId: activity.id,
        admittedIds: [ids[0]],
      }),
    )
    assert.equal((await one.view()).applications.find((v) => v.id === ids[0]).status, 'admitted')
    ok(await manager.post('/commands/result.withdraw', { activityId: activity.id }), 422)
    ok(
      await manager.post('/commands/result.withdraw', {
        activityId: activity.id,
        reason: '本地核对名单',
      }),
    )
    ok(await manager.post('/commands/result.publish', { activityId: activity.id, admittedIds: [] }))
    assert.equal((await one.view()).applications.find((v) => v.id === ids[0]).status, 'unselected')
  })
  await test('TC-ID-008 管理员核验冲突，不继承原管理权限或团队', async () => {
    const legacyId = 'legacy-' + runId,
      no = number(9)
    sql(
      `INSERT INTO campus_users(id,body) SELECT ${literal(legacyId)},JSON_SET(body,'$.id',${literal(legacyId)},'$.studentNo',${literal(no)},'$.email','','$.accountStatus','pending','$.bindingStatus','unbound') FROM campus_users WHERE id='manager'`,
    )
    const sem = (await admin.view()).semesters[0]
    ok(await admin.post('/commands/semester.save', sem))
    const claimant = await register(9),
      c = await new Client().login(claimant.email)
    assert.equal((await c.view()).me.bindingStatus, 'conflict')
    const list = ok(await admin.call('/auth/identity-conflicts')).items,
      item = list.find((v) => v.claimant_id === claimant.id)
    assert.ok(item)
    ok(await c.call('/auth/identity-conflicts'), 403)
    ok(
      await admin.post(`/auth/identity-conflicts/${item.id}/resolve`, {
        reason: '本地测试已核对校邮与旧账号凭据，不迁移历史报名',
        transferApplicationIds: [],
      }),
    )
    assert.equal((await c.call('/session')).data.me, null)
    await c.login(claimant.email)
    const view = await c.view()
    assert.deepEqual(view.me.roles, ['student'])
    assert.deepEqual(view.me.orgIds, [])
    assert.deepEqual(view.applications, [])
  })
  await test('TC-ID-012 密码恢复撤销两个既有会话，旧密码与验证码失效', async () => {
    const otherSession = await new Client().login(first.email)
    elapsed(first.email)
    const c = await otp(first.email, 'password-reset')
    ok(await new Client().post('/auth/password/reset', { ...c, password: 'UpdatedLocal123!' }))
    assert.equal(ok(await one.call('/session')).me, null)
    assert.equal(ok(await otherSession.call('/session')).me, null)
    ok(await new Client().post('/session', { studentNo: first.email, password }), 401)
    ok(await new Client().post('/auth/password/reset', { ...c, password: 'Again123!' }), 422)
    one = await new Client().login(first.email, 'UpdatedLocal123!')
  })
  await test('TC-ID-013 换绑须当前密码、校验新邮箱与原学号对应', async () => {
    ok(
      await new Client().post('/auth/email/challenges', {
        email: address(10),
        purpose: 'email-change',
        password: 'wrong',
      }),
      401,
    )
    ok(
      await one.post('/auth/email/challenges', {
        email: address(10),
        purpose: 'email-change',
        password: 'wrong',
      }),
      403,
    )
    const c = await otp(address(10), 'email-change', one, { password: 'UpdatedLocal123!' })
    ok(await one.post('/auth/email/change', { ...c, password: 'UpdatedLocal123!' }), 409)
    assert.equal((await one.view()).me.studentNo, first.no)
  })
  await test('TC-ID-013 既有邮箱换绑成功，原邮箱收到安全通知，旧会话失效', async () => {
    // A pre-existing bound alias is a database fixture, NOT a new-domain naming rule.
    const previousEmail = `${first.no}@mails.neu.edu.cn`
    sql(
      `UPDATE account_identity SET email=${literal(previousEmail)} WHERE user_id=${literal(first.id)}`,
    )
    sql(
      `UPDATE campus_users SET body=JSON_SET(body,'$.email',${literal(previousEmail)}) WHERE id=${literal(first.id)}`,
    )
    ok(await admin.post('/commands/semester.save', (await admin.view()).semesters[0]))
    elapsed(first.email)
    const c = await otp(first.email, 'email-change', one, { password: 'UpdatedLocal123!' })
    ok(await one.post('/auth/email/change', { ...c, password: 'UpdatedLocal123!' }))
    assert.equal(ok(await one.call('/session')).me, null)
    one = await new Client().login(first.email, 'UpdatedLocal123!')
    const inbox = await fetch(mailBase + '/api/v1/messages').then((r) => r.json())
    assert.ok(
      inbox.messages.some(
        (m) => m.To.some((t) => t.Address === previousEmail) && m.Subject.includes('换绑通知'),
      ),
    )
  })
  await test('REQ-F-103/104 待映射用户补充可信绑定，不继承管理权限', async () => {
    const c = await new Client().login(pending.email)
    const challenge = await otp(`${pending.no}@stu.neu.edu.cn`, 'bind', c, { password })
    ok(await c.post('/auth/identity/bind', { ...challenge, password }))
    assert.equal(ok(await c.call('/session')).me, null)
    await c.login(`${pending.no}@stu.neu.edu.cn`)
    assert.equal((await c.view()).me.bindingStatus, 'bound')
    assert.deepEqual((await c.view()).me.roles, ['student'])
  })
  await test('TC-ID-014 登录防刷返回429、明确重试时间及Retry-After', async () => {
    const unknown = number(42)
    for (let i = 0; i < 15; i++)
      ok(
        await new Client().post('/session', { studentNo: unknown, password: 'NeverAssigned123!' }),
        401,
      )
    const limited = await new Client().post('/session', {
      studentNo: unknown,
      password: 'NeverAssigned123!',
    })
    ok(limited, 429)
    assert.ok(Number(limited.retryAfter) > 0)
    assert.match(limited.data.message, /秒后重试/)
  })
} catch (error) {
  console.error('FAIL ' + error.message)
  process.exitCode = 1
} finally {
  fs.writeFileSync(
    path.join(root, 'artifacts/v05-identity-results.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: providers?.mode,
        database: 'campus_v05_local',
        conditions:
          'MySQL8.4; real Java API; local SMTP/Mailpit; expiration/resend use isolated database time fixtures; no real school mailbox or SSO',
        cases: results,
      },
      null,
      2,
    ),
  )
  console.log(
    `${results.filter((r) => r.passed).length}/${results.length} local identity checks passed`,
  )
}
