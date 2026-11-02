// @vitest-environment node
import { beforeEach, expect, it } from 'vitest'
import { seed } from '../seed'
import { execute, snapshot, advance } from '../engine'
import type { State } from '../types'
let s: State
it('REQ-F-030 校邮与学校认证的正式用户可共同组队，演示身份不混入', async () => {
  s.identityMode = 'formal'
  s.users[0]!.identitySource = 'campus-email'
  s.users[1]!.identitySource = 'school'
  await team('20260002')
  expect(s.applications[0]!.memberUserIds).toEqual(['student', 'member'])
  await expect(
    execute(s, 'student', 'application.save', {
      activityId: 'innovation-team',
      id: s.applications[0]!.id,
      version: 1,
      memberUserIds: ['member2'],
      answers: { proposal: '模拟' },
    }),
  ).rejects.toThrow('核验')
})
it('REQ-N-020 成员停用后不能自动通过或发布录取', async () => {
  await team('20260002')
  const r = s.applications[0]!,
    a = s.activities.find((a) => a.id === r.activityId)!
  s.users.find((u) => u.id === 'member')!.accountStatus = 'disabled'
  a.stages.forEach((st) => {
    st.enabled = true
    st.automatic = true
  })
  r.stageIndex = 0
  advance(s, a, r)
  expect(r.status).toBe('waiting')
  r.status = 'eligible'
  s.now = a.end
  await expect(
    execute(s, 'manager', 'result.publish', { activityId: a.id, admittedIds: [r.id] }),
  ).rejects.toMatchObject({ status: 409 })
})
beforeEach(async () => {
  s = await seed()
})
const team = (no = '20269999') =>
  execute(s, 'student', 'application.save', {
    activityId: 'innovation-team',
    memberNos: [no],
    answers: { proposal: '模拟材料' },
  })
it('REQ-F-028 未注册、未核验、冲突及停用成员不能入队', async () => {
  await expect(team()).rejects.toThrow('核验')
  for (const status of ['pending', 'disabled'] as const) {
    s.users[1]!.accountStatus = status
    await expect(team('20260002')).rejects.toThrow('核验')
  }
  s.users[1]!.accountStatus = 'active'
  s.users[1]!.bindingStatus = 'conflict'
  await expect(team('20260002')).rejects.toThrow('核验')
})
it('REQ-F-030 待核验账号不能报名或申请负责人', async () => {
  s.users[0]!.accountStatus = 'pending'
  s.users[0]!.bindingStatus = 'unbound'
  await expect(
    execute(s, 'student', 'application.save', {
      activityId: 'photo-fall',
      answers: { intro: '材料', grade: '大一' },
    }),
  ).rejects.toMatchObject({ status: 403 })
  await expect(
    execute(s, 'student', 'grant.apply', { orgId: 'math', reason: '申请' }),
  ).rejects.toMatchObject({ status: 403 })
})
it('REQ-F-031/033 同学号但未关联的用户不能查看或退出历史团队', async () => {
  await team('20260002')
  s.users.push({ ...s.users[1]!, id: 'unrelated' })
  expect(snapshot(s, 'unrelated').applications).toEqual([])
  await expect(
    execute(s, 'unrelated', 'application.exit', { id: s.applications[0]!.id }),
  ).rejects.toMatchObject({ status: 403 })
})
it('REQ-F-102 旧注册命令不能绕过校邮核验', async () => {
  await expect(
    execute(s, undefined, 'register', {
      studentNo: '20269999',
      name: '模拟',
      password: 'Password123!',
    }),
  ).rejects.toMatchObject({ status: 403 })
})
it('REQ-N-030 明确字段输出不泄漏邮箱、凭据或后续新增内部字段', () => {
  Object.assign(s.users[0]!, { schoolToken: 'sensitive' })
  const view = snapshot(s, 'student')
  expect(JSON.stringify(view)).not.toContain('passwordHash')
  expect(JSON.stringify(view)).not.toContain('schoolToken')
  expect(JSON.stringify(view)).not.toContain('20260001@stu.neu.edu.cn')
  expect(view.me!.maskedEmail).toBe('2***@stu.neu.edu.cn')
})
it('REQ-F-028/033 按成员ID创建、通知与退出，并释放学号占用', async () => {
  await execute(s, 'student', 'application.save', {
    activityId: 'innovation-team',
    memberUserIds: ['member'],
    answers: { proposal: '项目' },
  })
  const r = s.applications[0]!
  expect(r.memberUserIds).toEqual(['student', 'member'])
  expect(s.notices.some((n) => n.userId === 'member')).toBe(true)
  await execute(s, 'member', 'application.exit', { id: r.id })
  expect(r.memberUserIds).toEqual(['student'])
  expect(snapshot(s, 'member').applications).toEqual([])
})
