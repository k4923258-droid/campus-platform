import type { State, User } from '@/domain/types'
import { DomainError, ensure } from '@/domain/engine'
import { hashPassword } from '@/domain/seed'
import { verified } from '@/domain/identity'

type Challenge = {
  id: string
  email: string
  purpose: string
  hash: string
  expires: number
  attempts: number
  used: boolean
  created: number
}
export type MockMail = { id: string; to: string; purpose: string; text: string; at: string }
type CodeInput = { challengeId: string; code: string; email?: string }
type RegisterInput = CodeInput & {
  password: string
  name: string
  studentNo?: string
  [key: string]: unknown
}
export class DemoIdentity {
  challenges: Challenge[] = []
  mails: MockMail[] = []
  counters = new Map<string, { at: number; count: number }>()
  limit(key: string, max = 60, window = 60000) {
    const old = this.counters.get(key),
      now = Date.now()
    const row = old && now - old.at < window ? old : { at: now, count: 0 }
    ensure(
      row.count++ < max,
      `操作频繁，请在${Math.max(1, Math.ceil((row.at + window - now) / 1000))}秒后重试`,
      429,
    )
    this.counters.set(key, row)
  }
  email(value: string) {
    const [local, domain, ...extra] = value.trim().split('@')
    ensure(
      !extra.length &&
        /^[A-Za-z0-9._+-]{1,64}$/.test(local || '') &&
        ['stu.neu.edu.cn', 'mails.neu.edu.cn'].includes((domain || '').toLowerCase()),
      '请使用允许的校园邮箱域名',
    )
    return `${local}@${domain!.toLowerCase()}`
  }
  no(email: string) {
    return /^\d{6,20}@stu\.neu\.edu\.cn$/.test(email) ? email.split('@')[0]! : ''
  }
  async request(
    s: State,
    p: { email: string; purpose: string; password?: string },
    userId?: string,
  ) {
    const email = this.email(String(p.email || '')),
      purpose = String(p.purpose)
    ensure(['register', 'password-reset', 'bind', 'email-change'].includes(purpose), '验证用途无效')
    if (['bind', 'email-change'].includes(purpose)) {
      const u = s.users.find((u) => u.id === userId)
      ensure(u, '请先登录', 401)
      this.limit('reauth:' + userId, 10, 900000)
      ensure(
        u && u.passwordHash === (await hashPassword(String(p.password || ''))),
        '请重新验证当前密码',
        403,
      )
    }
    this.limit('send-global', 120, 3600000)
    this.limit('send:' + email, 20, 3600000)
    ensure(
      !this.challenges.some((c) => c.email === email && Date.now() - c.created < 60000),
      '请等待60秒后重发',
      429,
    )
    const id = crypto.randomUUID(),
      bytes = new Uint32Array(1)
    do {
      crypto.getRandomValues(bytes)
    } while (bytes[0]! >= 4294000000)
    const code = String(bytes[0]! % 1000000).padStart(6, '0')
    this.challenges
      .filter((c) => c.email === email && c.purpose === purpose)
      .forEach((c) => (c.used = true))
    this.challenges.push({
      id,
      email,
      purpose,
      hash: await hashPassword(`${id}|${email}|${purpose}|${code}`),
      expires: Date.now() + 300000,
      attempts: 0,
      used: false,
      created: Date.now(),
    })
    this.mails.unshift({
      id,
      to: email,
      purpose,
      text: `[浏览器模拟邮件] 验证码：${code}。5分钟有效，一次使用。`,
      at: new Date().toISOString(),
    })
    this.mails = this.mails.slice(0, 100)
    return {
      challengeId: id,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      retryAfter: 60,
    }
  }
  async consume(p: CodeInput, purpose: string) {
    const c = this.challenges.find((c) => c.id === p.challengeId)
    ensure(c, '验证码申请无效或已过期')
    const ok =
      !c.used &&
      c.expires > Date.now() &&
      c.attempts < 5 &&
      c.purpose === purpose &&
      (!p.email || this.email(p.email) === c.email) &&
      c.hash === (await hashPassword(`${c.id}|${c.email}|${purpose}|${p.code}`))
    if (!ok) {
      c.attempts = Math.min(5, c.attempts + 1)
      throw new DomainError('验证码无效、已过期、已使用或尝试超限，请重新申请')
    }
    return c
  }
  password(value: string) {
    ensure(Array.from(value).length >= 8 && Array.from(value).length <= 128, '密码须为8～128个字符')
  }
  async register(s: State, p: RegisterInput) {
    this.limit('register', 60, 3600000)
    this.password(String(p.password || ''))
    ensure(String(p.name || '').trim() && String(p.name).length <= 60, '请填写显示姓名（最多60字）')
    const c = await this.consume(p, 'register'),
      no = this.no(c.email)
    ensure(!p.studentNo || p.studentNo === no, '学号必须来自已验证邮箱的可信映射')
    ensure(!s.users.some((u) => u.email === c.email), '该邮箱已绑定账号，请登录或恢复密码', 409)
    const conflict =
        !!no && s.users.some((u) => u.studentNo === no && u.accountStatus !== 'disabled'),
      ready = !!no && !conflict
    const u: User = {
      id: crypto.randomUUID(),
      studentNo: ready ? no : '',
      name: String(p.name).trim(),
      passwordHash: await hashPassword(p.password),
      email: c.email,
      emailVerifiedAt: new Date().toISOString(),
      bindingStatus: conflict ? 'conflict' : ready ? 'bound' : 'pending',
      accountStatus: ready ? 'active' : 'pending',
      identitySource: 'demo',
      sessionVersion: 0,
      roles: ready ? ['student'] : [],
      orgIds: [],
    }
    s.users.push(u)
    c.used = true
    return {
      id: u.id,
      status: u.bindingStatus,
      message: ready ? '注册成功，请登录' : '邮箱已验证，学号绑定待核验；目前仅可浏览公开信息',
    }
  }
  async reset(s: State, p: CodeInput & { password: string }) {
    this.limit('reset', 60, 3600000)
    this.password(String(p.password || ''))
    const c = await this.consume(p, 'password-reset')
    const u = s.users.find(
      (u) => u.email === c.email && u.emailVerifiedAt && u.accountStatus !== 'disabled',
    )
    ensure(u, '无法恢复该账号，请联系管理员核验')
    u.passwordHash = await hashPassword(p.password)
    u.sessionVersion = (u.sessionVersion || 0) + 1
    this.challenges.filter((v) => v.email === c.email).forEach((v) => (v.used = true))
    return { ok: true }
  }
  async bind(
    s: State,
    p: CodeInput & { password: string },
    userId: string | undefined,
    change: boolean,
  ) {
    this.limit('bind:' + userId, 10, 900000)
    const u = s.users.find((u) => u.id === userId)
    ensure(u, '请先登录', 401)
    ensure(
      change ? verified(u) : !verified(u),
      change ? '请先完成身份绑定' : '已核验账号请使用邮箱换绑入口',
      409,
    )
    ensure(u.passwordHash === (await hashPassword(p.password)), '当前密码错误', 403)
    const c = await this.consume(p, change ? 'email-change' : 'bind'),
      no = this.no(c.email)
    ensure(
      no && (!u.studentNo || u.studentNo === no),
      '新邮箱与学号不匹配或映射待确认，须由管理员核验',
      409,
    )
    ensure(
      !s.users.some(
        (v) =>
          v.id !== u.id &&
          (v.email === c.email || (v.studentNo === no && v.accountStatus !== 'disabled')),
      ),
      '身份存在冲突，请联系管理员',
      409,
    )
    const legacy = !verified(u)
    if (u.email && u.email !== c.email)
      this.mails.unshift({
        id: crypto.randomUUID(),
        to: u.email,
        purpose: 'notice',
        text: '[浏览器模拟邮件] 账号邮箱已变更，如非本人操作请联系管理员。',
        at: new Date().toISOString(),
      })
    Object.assign(u, {
      email: c.email,
      studentNo: no,
      emailVerifiedAt: new Date().toISOString(),
      bindingStatus: 'bound',
      accountStatus: 'active',
      sessionVersion: (u.sessionVersion || 0) + 1,
    })
    if (legacy) {
      u.roles = ['student']
      u.orgIds = []
    }
    c.used = true
    return { ok: true }
  }
}
