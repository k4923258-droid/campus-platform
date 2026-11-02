import { http, HttpResponse, type PathParams } from 'msw'
import { setupWorker } from 'msw/browser'
import localforage from 'localforage'
import { execute, snapshot, tick, DomainError, isAdmin } from '@/domain/engine'
import { seed, hashPassword } from '@/domain/seed'
import { migrateDemoCopy } from '@/domain/demo-copy'
import type { State } from '@/domain/types'
import { DemoIdentity } from './identity'
import { initializeDemoIdentity, businessUser, verified } from '@/domain/identity'
const db = localforage.createInstance({ name: 'campus-platform-v04', storeName: 'demo' })
let state: State
const identity = new DemoIdentity()
let queue: Promise<unknown> = Promise.resolve()
const sessions = new Map<string, { id: string; expires: number; version: number }>(
  JSON.parse(sessionStorage.getItem('demo-sessions') || '[]'),
)
const who = (request: Request) => {
  const token = request.headers.get('X-Demo-Session') || ''
  const session = sessions.get(token)
  const u = state?.users.find((v) => v.id === session?.id)
  if (
    !session ||
    session.expires < Date.now() ||
    !u ||
    u.accountStatus === 'disabled' ||
    session.version !== (u.sessionVersion || 0)
  ) {
    sessions.delete(token)
    sessionStorage.setItem('demo-sessions', JSON.stringify([...sessions]))
    return undefined
  }
  return session.id
}
async function atomic<T>(work: (draft: State) => Promise<T> | T) {
  const pending = queue.then(async () => {
    const draft = structuredClone(state)
    const result = await work(draft)
    await db.setItem('state', draft)
    state = draft
    return result
  })
  queue = pending.catch(() => {})
  return pending
}
const safe =
  (f: (request: Request, params: PathParams) => Promise<Response> | Response) =>
  async ({ request, params }: { request: Request; params: PathParams }) => {
    try {
      return await f(request, params)
    } catch (error) {
      const e = error as DomainError
      return HttpResponse.json({ message: e.message || '操作失败' }, { status: e.status || 500 })
    } finally {
      await db.setItem('identity', { challenges: identity.challenges, mails: identity.mails })
    }
  }
export async function startMocks() {
  const defaults = await seed()
  state = (await db.getItem<State>('state')) || defaults
  migrateDemoCopy(state, defaults)
  initializeDemoIdentity(state)
  const savedIdentity = await db.getItem<{
    challenges: typeof identity.challenges
    mails: typeof identity.mails
  }>('identity')
  if (savedIdentity) {
    identity.challenges = savedIdentity.challenges
    identity.mails = savedIdentity.mails
  }

  const worker = setupWorker(
    http.get(
      '/api/v1/auth/providers',
      safe(() =>
        HttpResponse.json({
          mode: 'demo',
          emailAvailable: true,
          schoolAvailable: false,
          emailDomains: ['stu.neu.edu.cn', 'mails.neu.edu.cn'],
        }),
      ),
    ),
    http.get(
      '/api/v1/session',
      safe((request) => HttpResponse.json({ me: snapshot(state, who(request)).me || null })),
    ),
    http.get(
      '/api/v1/demo/mail',
      safe(() => HttpResponse.json({ items: identity.mails })),
    ),
    http.get(
      '/api/v1/auth/login/neu',
      safe(() => {
        throw new DomainError('学校统一认证尚未接入，当前不可用', 503)
      }),
    ),
    http.get(
      '/api/v1/auth/callback/neu',
      safe(() => {
        throw new DomainError('学校统一认证尚未接入，当前不可用', 503)
      }),
    ),
    http.post(
      '/api/v1/auth/email/challenges',
      safe(async (request) => {
        const p = await request.json()
        return atomic(async (s) => HttpResponse.json(await identity.request(s, p, who(request))))
      }),
    ),
    http.post(
      '/api/v1/auth/register',
      safe(async (request) => {
        const p = await request.json()
        return atomic(async (s) => HttpResponse.json(await identity.register(s, p)))
      }),
    ),
    http.post(
      '/api/v1/auth/password/reset',
      safe(async (request) => {
        const p = await request.json()
        return atomic(async (s) => HttpResponse.json(await identity.reset(s, p)))
      }),
    ),
    http.post(
      '/api/v1/auth/identity/bind',
      safe(async (request) => {
        const p = await request.json()
        return atomic(async (s) =>
          HttpResponse.json(await identity.bind(s, p, who(request), false)),
        )
      }),
    ),
    http.post(
      '/api/v1/auth/email/change',
      safe(async (request) => {
        const p = await request.json()
        return atomic(async (s) => HttpResponse.json(await identity.bind(s, p, who(request), true)))
      }),
    ),
    http.get(
      '/api/v1/auth/identity-conflicts',
      safe((request) => {
        if (!isAdmin(state.users.find((u) => u.id === who(request))))
          throw new DomainError('需要管理员权限', 403)
        return HttpResponse.json({
          items: state.users
            .filter((u) => u.bindingStatus === 'conflict')
            .map((u) => ({
              id: u.id,
              claimant_id: u.id,
              existing_id: state.users.find(
                (v) => v.id !== u.id && v.studentNo === identity.no(u.email || ''),
              )?.id,
              student_no: identity.no(u.email || ''),
              status: 'pending',
              reason: '',
            })),
        })
      }),
    ),
    http.post(
      '/api/v1/auth/identity-conflicts/:id/resolve',
      safe(async (request, params) => {
        const p = await request.json()
        return atomic((s) => {
          if (!isAdmin(s.users.find((u) => u.id === who(request))))
            throw new DomainError('需要管理员权限', 403)
          const u = s.users.find((u) => u.id === params.id),
            no = identity.no(u?.email || '')
          if (
            !u ||
            u.bindingStatus !== 'conflict' ||
            !no ||
            String(p.reason || '').trim().length < 10
          )
            throw new DomainError('请检查冲突状态并填写至少10字的核验依据')
          const old = s.users.find((v) => v.id !== u.id && v.studentNo === no)
          if (old) {
            old.accountStatus = 'disabled'
            old.sessionVersion = (old.sessionVersion || 0) + 1
            old.roles = []
            old.orgIds = []
          }
          Object.assign(u, {
            studentNo: no,
            bindingStatus: 'bound',
            accountStatus: 'active',
            roles: ['student'],
            orgIds: [],
            sessionVersion: (u.sessionVersion || 0) + 1,
          })
          for (const id of p.transferApplicationIds || []) {
            const r = s.applications.find((r) => r.id === id)
            if (!r || !old || !r.memberUserIds?.includes(old.id))
              throw new DomainError('迁移范围包含未关联的报名')
            r.memberUserIds = r.memberUserIds.map((v) => (v === old.id ? u.id : v))
            if (r.captainId === old.id) r.captainId = u.id
          }
          s.audits.unshift({
            id: crypto.randomUUID(),
            actorId: who(request)!,
            action: '处理身份冲突',
            detail: String(p.reason),
            at: new Date().toISOString(),
          })
          return HttpResponse.json({ ok: true })
        })
      }),
    ),
    http.post(
      '/api/v1/activities/:activityId/team-members/resolve',
      safe(async (request, params) => {
        const actor = state.users.find((u) => u.id === who(request))
        if (!verified(actor)) throw new DomainError('请先完成身份核验', 403)
        identity.limit('member:' + actor!.id)
        const p = await request.json(),
          a = state.activities.find((a) => a.id === params.activityId)
        if (!a?.team || !a.published || a.removed)
          throw new DomainError('活动不存在或未开放团队报名', 404)
        const u = state.users.find((u) => u.studentNo === p.studentNo && verified(u))
        if (!u) throw new DomainError('未找到可加入的已核验账号', 404)
        return HttpResponse.json({ id: u.id, name: u.name, studentNo: u.studentNo })
      }),
    ),

    http.get(
      '/api/v1/snapshot',
      safe(async (request) =>
        atomic((s) => {
          tick(s)
          const view = snapshot(s, who(request))
          return HttpResponse.json({
            ...view,
            slots: view.slots.map((slot) => ({
              ...slot,
              booked: s.applications.filter((r) => r.slotId === slot.id).length,
            })),
          })
        }),
      ),
    ),
    http.post(
      '/api/v1/session',
      safe(async (request) => {
        const p = await request.json()
        identity.limit('login:' + String(p.studentNo).toLowerCase(), 15, 900000)
        const u = state.users.find(
          (v) =>
            (v.studentNo === p.studentNo || v.email === p.studentNo) &&
            v.passwordHash &&
            v.accountStatus !== 'disabled',
        )
        if (!u || u.passwordHash !== (await hashPassword(p.password)))
          throw new DomainError('学号或密码错误', 401)
        await atomic((s) => {
          s.audits.unshift({
            id: crypto.randomUUID(),
            actorId: u.id,
            action: '登录',
            detail: '',
            at: new Date(s.now || Date.now()).toISOString(),
          })
        })
        const token = crypto.randomUUID()
        sessions.set(token, {
          id: u.id,
          expires: Date.now() + 30 * 60 * 1000,
          version: u.sessionVersion || 0,
        })
        sessionStorage.setItem('demo-sessions', JSON.stringify([...sessions]))
        return HttpResponse.json({ token })
      }),
    ),
    http.delete(
      '/api/v1/session',
      safe(async (request) => {
        const userId = who(request)
        if (userId)
          await atomic((s) => {
            s.audits.unshift({
              id: crypto.randomUUID(),
              actorId: userId,
              action: '退出登录',
              detail: '',
              at: new Date(s.now || Date.now()).toISOString(),
            })
          })
        sessions.delete(request.headers.get('X-Demo-Session') || '')
        sessionStorage.setItem('demo-sessions', JSON.stringify([...sessions]))
        return HttpResponse.json({ ok: true })
      }),
    ),
    http.post(
      '/api/v1/commands/:action',
      safe(async (request, params) => {
        const p = await request.json()
        return atomic(async (s) =>
          HttpResponse.json(await execute(s, who(request), String(params.action), p)),
        )
      }),
    ),
    http.post(
      '/api/v1/demo/reset',
      safe(async (request) => {
        if (!isAdmin(state.users.find((u) => u.id === who(request))))
          throw new DomainError('需要管理员权限', 403)
        return atomic(async (s) => {
          Object.assign(s, await seed())
          sessions.clear()
          identity.challenges = []
          identity.mails = []
          return HttpResponse.json({ ok: true })
        })
      }),
    ),
    http.post(
      '/api/v1/files',
      safe(async (request) => {
        const userId = who(request)
        if (!userId) throw new DomainError('请先登录', 401)
        if (!businessUser(state.users.find((u) => u.id === userId)))
          throw new DomainError('请先完成身份核验', 403)
        const p = await request.json()
        const ext = p.name?.split('.').pop()?.toLowerCase()
        const mimes: Record<string, string[]> = {
          png: ['image/png'],
          jpg: ['image/jpeg'],
          jpeg: ['image/jpeg'],
          gif: ['image/gif'],
          webp: ['image/webp'],
          pdf: ['application/pdf'],
          zip: ['application/zip', 'application/x-zip-compressed'],
        }
        if (
          !mimes[ext]?.includes(p.mime) ||
          p.size <= 0 ||
          p.size > 20 * 1024 * 1024 ||
          typeof p.data !== 'string'
        )
          throw new DomainError('仅允许20MB以内的图片、PDF或ZIP')
        const id = crypto.randomUUID()
        return atomic((s) => {
          s.attachments.push({ ...p, id, ownerId: userId })
          return HttpResponse.json({ id })
        })
      }),
    ),
    http.get(
      '/api/v1/files/:id',
      safe((request, params) => {
        const view = snapshot(state, who(request))
        if (!view.attachments.some((f) => f.id === params.id))
          throw new DomainError('无权访问此附件', 403)
        const file = state.attachments.find((f) => f.id === params.id)!
        const bytes = Uint8Array.from(atob(file.data.split(',')[1] || ''), (c) => c.charCodeAt(0))
        return new HttpResponse(bytes, {
          headers: {
            'Content-Type': file.mime,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }),
    ),
  )
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
}
