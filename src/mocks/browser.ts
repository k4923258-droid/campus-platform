import { http, HttpResponse } from 'msw'
import { setupWorker } from 'msw/browser'
import localforage from 'localforage'
import { execute, snapshot, tick, DomainError, isAdmin } from '@/domain/engine'
import { seed, hashPassword } from '@/domain/seed'
import { migrateDemoCopy } from '@/domain/demo-copy'
import type { State } from '@/domain/types'
const db = localforage.createInstance({ name: 'campus-platform-v04', storeName: 'demo' })
let state: State
let queue: Promise<unknown> = Promise.resolve()
const sessions = new Map<string, { id: string; expires: number }>(
  JSON.parse(sessionStorage.getItem('demo-sessions') || '[]'),
)
const who = (request: Request) => {
  const token = request.headers.get('X-Demo-Session') || ''
  const session = sessions.get(token)
  if (!session || session.expires < Date.now()) {
    sessions.delete(token)
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
  (f: (request: Request, params: any) => Promise<Response> | Response) =>
  async ({ request, params }: any) => {
    try {
      return await f(request, params)
    } catch (error) {
      const e = error as DomainError
      return HttpResponse.json({ message: e.message || '操作失败' }, { status: e.status || 500 })
    }
  }
export async function startMocks() {
  const defaults = await seed()
  state = (await db.getItem<State>('state')) || defaults
  migrateDemoCopy(state, defaults)
  const worker = setupWorker(
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
        const p = (await request.json()) as any
        const u = state.users.find((v) => v.studentNo === p.studentNo && v.passwordHash)
        if (!u || u.passwordHash !== (await hashPassword(p.password)))
          throw new DomainError('学号或密码错误', 401)
        const token = crypto.randomUUID()
        sessions.set(token, { id: u.id, expires: Date.now() + 30 * 60 * 1000 })
        sessionStorage.setItem('demo-sessions', JSON.stringify([...sessions]))
        return HttpResponse.json({ token })
      }),
    ),
    http.delete(
      '/api/v1/session',
      safe((request) => {
        sessions.delete(request.headers.get('X-Demo-Session') || '')
        return HttpResponse.json({ ok: true })
      }),
    ),
    http.post(
      '/api/v1/commands/:action',
      safe(async (request, params) => {
        const p = await request.json()
        return atomic(async (s) =>
          HttpResponse.json((await execute(s, who(request), String(params.action), p)) as any),
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
          return HttpResponse.json({ ok: true })
        })
      }),
    ),
    http.post(
      '/api/v1/files',
      safe(async (request) => {
        const userId = who(request)
        if (!userId) throw new DomainError('请先登录', 401)
        const p = (await request.json()) as any
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
