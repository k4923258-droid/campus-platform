// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { seed, hashPassword } from '../seed'
import { DemoIdentity } from '../../mocks/identity'
import type { State } from '../types'
let s: State, a: DemoIdentity
beforeEach(async () => {
  s = await seed()
  a = new DemoIdentity()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const request = (email = '20269999@stu.neu.edu.cn', purpose = 'register') =>
  a.request(s, { email, purpose })
const code = () => a.mails[0]!.text.match(/\d{6}/)![0]
it('TC-ID-001 精确域名白名单', async () => {
  for (const email of ['x@other.edu.cn', 'x@neu.edu.cn.evil.example', 'x@sub.stu.neu.edu.cn'])
    await expect(request(email)).rejects.toThrow('校园邮箱')
})
it('TC-ID-002/011 校邮注册只分配普通用户，忽略伪造角色', async () => {
  const c = await request()
  const r = await a.register(s, {
    ...c,
    code: code(),
    name: '模拟用户',
    password: 'Password123!',
    roles: ['admin'],
    orgIds: ['photo'],
  })
  const u = s.users.find((u) => u.id === r.id)!
  expect(u.studentNo).toBe('20269999')
  expect(u.roles).toEqual(['student'])
  expect(u.orgIds).toEqual([])
  expect(JSON.stringify(c)).not.toContain('code')
})
it('TC-ID-003 验证邮箱不能绑定任意学号', async () => {
  const c = await request()
  await expect(
    a.register(s, {
      ...c,
      code: code(),
      studentNo: '20260001',
      name: '模拟',
      password: 'Password123!',
    }),
  ).rejects.toThrow('映射')
})
it('TC-ID-004 新域映射未确认不激活', async () => {
  const c = await request('20269999@mails.neu.edu.cn')
  const r = await a.register(s, { ...c, code: code(), name: '模拟', password: 'Password123!' })
  const u = s.users.find((u) => u.id === r.id)!
  expect(u.studentNo).toBe('')
  expect(u.accountStatus).toBe('pending')
  expect(u.roles).toEqual([])
})
it('TC-ID-005 过期与一次性使用', async () => {
  const c = await request(),
    otp = code()
  vi.advanceTimersByTime(300000)
  await expect(
    a.register(s, { ...c, code: otp, name: '模拟', password: 'Password123!' }),
  ).rejects.toThrow('过期')
  vi.advanceTimersByTime(1)
  const d = await request()
  const payload = { ...d, code: code(), name: '模拟', password: 'Password123!' }
  await a.register(s, payload)
  await expect(a.register(s, payload)).rejects.toThrow('已使用')
})
it('TC-ID-006 重发间隔、旧码失效和五次失败上限', async () => {
  const c = await request(),
    old = code()
  await expect(request()).rejects.toMatchObject({ status: 429 })
  vi.advanceTimersByTime(60000)
  const d = await request(),
    good = code()
  await expect(a.consume({ ...c, code: old }, 'register')).rejects.toThrow('验证码')
  for (let i = 0; i < 5; i++)
    await expect(a.consume({ ...d, code: 'wrong' }, 'register')).rejects.toThrow('验证码')
  await expect(a.consume({ ...d, code: good }, 'register')).rejects.toThrow('超限')
})
it('TC-ID-008 重复学号不自动接管旧账号', async () => {
  s.users[0]!.email = 'legacy@stu.neu.edu.cn'
  const c = await request('20260001@stu.neu.edu.cn')
  const r = await a.register(s, { ...c, code: code(), name: '申请者', password: 'Password123!' })
  expect(s.users.find((u) => u.id === r.id)!.bindingStatus).toBe('conflict')
  expect(s.users[0]!.id).toBe('student')
})
it('TC-ID-012 重置改变密码与全部会话版本，用途不能互用', async () => {
  const c = await request('20260001@stu.neu.edu.cn', 'password-reset'),
    otp = code()
  await expect(a.consume({ ...c, code: otp }, 'register')).rejects.toThrow('验证码')
  await a.reset(s, { ...c, code: otp, password: 'Changed123!' })
  expect(s.users[0]!.passwordHash).toBe(await hashPassword('Changed123!'))
  expect(s.users[0]!.sessionVersion).toBe(1)
  await expect(a.reset(s, { ...c, code: otp, password: 'Changed456!' })).rejects.toThrow('验证码')
})
