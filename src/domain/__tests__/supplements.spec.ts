// @vitest-environment node
import { beforeEach, expect, it } from 'vitest'
import { seed } from '../seed'
import { execute, snapshot, tick } from '../engine'
import { activityStatus, type State } from '../types'
import { isRegistered, reviewCounts, slotFull } from '../history'
import { validateUpload } from '../../api/file-validation'
import { redactSensitive } from '../redact'
let s: State
beforeEach(async () => {
  s = await seed()
  s.now = '2026-10-28T10:00:00+08:00'
})
const apply = () =>
  execute(s, 'student', 'application.save', {
    activityId: 'photo-fall',
    answers: { intro: '旧版表单', grade: '大一' },
  })
const review = (passed = true) =>
  execute(s, 'manager', 'review.save', {
    id: s.applications[0]!.id,
    version: s.applications[0]!.version,
    stage: s.applications[0]!.status,
    passed,
    commit: true,
    note: '正式备注',
  })

it('A-01 公开状态区分审核中、待发布及已结束，不暴露私人报名', async () => {
  await apply()
  s.now = s.activities[0]!.end
  expect(activityStatus(snapshot(s).activities[0]!, new Date(s.now))).toBe('审核中')
  await review()
  await review()
  expect(snapshot(s).applications).toEqual([])
  expect(activityStatus(snapshot(s).activities[0]!, new Date(s.now))).toBe('待发布结果')
  await execute(s, 'manager', 'result.publish', { activityId: 'photo-fall', admittedIds: [] })
  expect(activityStatus(snapshot(s).activities[0]!, new Date(s.now))).toBe('已结束')
})
it('A-03 审核审计保留完整上下文，分数制可记录不通过', async () => {
  s.activities[0]!.stages[0]!.mode = 'score'
  await apply()
  await execute(s, 'manager', 'review.save', {
    id: s.applications[0]!.id,
    version: 1,
    stage: 'initial',
    score: 35,
    commit: true,
    note: '分数不足',
  })
  expect(s.audits[0]!.context).toMatchObject({
    applicationId: s.applications[0]!.id,
    version: 1,
    stage: 'initial',
    beforeStatus: 'initial',
    afterStatus: 'rejected',
    score: 35,
    note: '分数不足',
    actorId: 'manager',
  })
  expect(s.applications[0]!.reviews[0]!.at).toBeTruthy()
})
it('A-04 公告变更保留前后值且游客不能读管理历史', async () => {
  const a = s.activities[0]!
  await execute(s, 'manager', 'activity.save', { ...a, body: '新版公告' })
  expect(a.body).not.toBe('新版公告') // command replaces rather than mutates the old reference
  expect(s.activities[0]!.changeHistory?.[0]?.changes.body).toEqual({
    before: a.body,
    after: '新版公告',
  })
  expect(snapshot(s).activities[0]!.changeHistory).toBeUndefined()
  expect(snapshot(s, 'manager').activities[0]!.changeHistory).toHaveLength(1)
})
it('A-05 两次不同录取名单可重建，学生和游客不可读取名单快照', async () => {
  await apply()
  await review()
  await review()
  s.now = s.activities[0]!.end
  const id = s.applications[0]!.id
  await execute(s, 'manager', 'result.publish', { activityId: 'photo-fall', admittedIds: [id] })
  await execute(s, 'manager', 'result.withdraw', {
    activityId: 'photo-fall',
    reason: '第一次名单有误',
  })
  await execute(s, 'manager', 'result.publish', { activityId: 'photo-fall', admittedIds: [] })
  const versions = s.activities[0]!.resultHistory!
  expect(versions[0]).toMatchObject({
    version: 1,
    admittedIds: [id],
    reason: '第一次名单有误',
    withdrawnBy: 'manager',
  })
  expect(versions[1]).toMatchObject({ version: 2, admittedIds: [], unselectedIds: [id] })
  expect(snapshot(s).activities[0]!.resultHistory).toBeUndefined()
  expect(snapshot(s, 'student').activities[0]!.resultHistory).toBeUndefined()
  expect(s.applications[0]!.statusEvents?.slice(-3).map((v) => v.to)).toEqual([
    'admitted',
    'eligible',
    'unselected',
  ])
})
it('A-06 旧版表单与结论保留，学生不获得历史快照', async () => {
  await apply()
  await review()
  const old = s.applications[0]!
  await execute(s, 'student', 'application.save', {
    id: old.id,
    version: 1,
    activityId: old.activityId,
    answers: { intro: '新版表单', grade: '大一' },
  })
  const row = s.applications[0]!
  expect(row.reviews).toHaveLength(0)
  expect(row.versions?.[0]).toMatchObject({
    version: 1,
    answers: { intro: '旧版表单' },
    reviews: [{ note: '正式备注', committed: true }],
  })
  expect(snapshot(s, 'student').applications[0]!.versions).toBeUndefined()
  expect(snapshot(s, 'manager').applications[0]!.versions).toHaveLength(1)
})
it('A-06 历史附件保留给负责人，归档后删除历史引用与个人审计', async () => {
  s.activities[0]!.fields.push({
    id: 'old',
    label: '旧附件',
    type: 'file',
    required: false,
    options: [],
  })
  await apply()
  const row = s.applications[0]!
  row.answers.old = 'file:old-file'
  s.attachments.push({
    id: 'old-file',
    ownerId: 'student',
    name: 'old.pdf',
    mime: 'application/pdf',
    size: 1,
    data: 'x',
  })
  await execute(s, 'student', 'application.save', {
    id: row.id,
    version: 1,
    activityId: row.activityId,
    answers: { intro: '新', grade: '大一' },
  })
  expect(snapshot(s, 'manager').attachments.some((v) => v.id === 'old-file')).toBe(true)
  s.activities[0]!.closedAt = s.now
  await execute(s, 'admin', 'activity.archive', {
    activityId: 'photo-fall',
    confirm: s.activities[0]!.title,
  })
  expect(s.attachments.some((v) => v.id === 'old-file')).toBe(false)
  expect(s.applications).toHaveLength(0)
  expect(s.activities[0]!.resultHistory).toEqual([])
  expect(s.audits.filter((v) => v.activityId === 'photo-fall')).toHaveLength(1)
})
it('普通文本中的file标记不能授予读取其他用户附件的权限', async () => {
  await apply()
  s.attachments.push({
    id: 'other-private',
    ownerId: 'member',
    name: 'private.pdf',
    mime: 'application/pdf',
    size: 1,
    data: 'x',
  })
  s.applications[0]!.answers.intro = 'file:other-private'
  expect(snapshot(s, 'student').attachments.some((v) => v.id === 'other-private')).toBe(false)
  expect(snapshot(s, 'manager').attachments.some((v) => v.id === 'other-private')).toBe(false)
})
it('A-08 默认通过逐环节通知且定时检查不重复通知', async () => {
  s.activities[0]!.stages.forEach((v) => {
    v.enabled = true
    v.automatic = true
  })
  await apply()
  const count = s.notices.length
  expect(s.applications[0]!.status).toBe('eligible')
  expect(s.notices.filter((v) => v.text.includes('默认通过'))).toHaveLength(3)
  tick(s)
  tick(s)
  expect(s.notices).toHaveLength(count)
})
it('人数不足团队不能经默认通过提前流转', async () => {
  const a = s.activities.find((v) => v.id === 'innovation-team')!
  a.stages.forEach((v) => {
    v.enabled = true
    v.automatic = true
  })
  a.rolling = true
  await execute(s, 'student', 'application.save', {
    activityId: a.id,
    memberNos: ['20260002'],
    answers: { proposal: '团队项目' },
  })
  const r = s.applications[0]!
  await execute(s, 'member', 'application.exit', { id: r.id })
  expect(r.status).toBe('waiting')
  expect(r.reviews).toHaveLength(0)
})
it('A-02 团队统计按实际成员人数，待处理与结论相符', async () => {
  await apply()
  const a = s.activities[0]!
  a.team = true
  s.applications[0]!.memberNos.push('20260002')
  expect(reviewCounts(a, s.applications, 'initial')).toMatchObject({
    total: 2,
    pending: 2,
    passed: 0,
    failed: 0,
    teams: 1,
  })
  await review(false)
  expect(reviewCounts(a, s.applications, 'initial')).toMatchObject({
    total: 2,
    pending: 0,
    failed: 2,
  })
})
it('A-09 负责人可见他人报名时不会被判为自己报名', async () => {
  await apply()
  const rows = snapshot(s, 'manager').applications
  expect(isRegistered(rows, 'photo-fall', '20240001')).toBe(false)
  expect(isRegistered(rows, 'photo-fall', '20260001')).toBe(true)
})
it('A-10 满员时段不可选，但本人原预约不误判为不可用', () => {
  expect(slotFull({ id: 's', capacity: 1, booked: 1 })).toBe(true)
  expect(slotFull({ id: 's', capacity: 1, booked: 1 }, 's')).toBe(false)
})
it('A-07 上传前检查大小、扩展名和MIME的边界', () => {
  expect(() =>
    validateUpload({ name: '证据.PDF', type: 'application/pdf', size: 20 * 1024 * 1024 }),
  ).not.toThrow()
  expect(() =>
    validateUpload({ name: 'a.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 }),
  ).toThrow('20MB')
  expect(() => validateUpload({ name: 'a.exe', type: 'application/pdf', size: 2 })).toThrow('类型')
  expect(() => validateUpload({ name: 'a.png', type: 'application/pdf', size: 2 })).toThrow('类型')
  expect(() =>
    validateUpload({ name: 'a.zip', type: 'application/x-zip-compressed', size: 2 }),
  ).not.toThrow()
  expect(() => validateUpload({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toThrow('0字节')
})
it('A-11 排查材料递归脱敏，不更改原始审计记录', () => {
  const log = {
    detail: '联系13812345678，mail test@example.com',
    context: { note: '13812345678', password: 'secret' },
  }
  const output = JSON.stringify(redactSensitive(log))
  expect(output).not.toContain('13812345678')
  expect(output).not.toContain('test@example.com')
  expect(output).not.toContain('secret')
  expect(log.context.note).toBe('13812345678')
})
