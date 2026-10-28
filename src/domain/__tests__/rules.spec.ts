// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { seed } from '../seed'
import { execute, snapshot, tick, DomainError } from '../engine'
import type { State, Application } from '../types'
let s: State
beforeEach(async () => {
  s = await seed()
})
const apply = (user = 'student', extra: any = {}) =>
  execute(s, user, 'application.save', {
    activityId: 'photo-fall',
    answers: { intro: '我喜欢摄影', grade: '大一' },
    ...extra,
  })
const first = () => s.applications[0]!
const review = (r: Application, commit = true, passed = true) =>
  execute(s, 'manager', 'review.save', {
    id: r.id,
    version: r.version,
    stage: r.status,
    passed,
    commit,
  })
describe('v0.4 核心业务规则', () => {
  it('下架后公开隐藏，报名者仍能查自己的历史并可结项归档', async () => {
    await apply()
    await execute(s, 'admin', 'activity.remove', { activityId: 'photo-fall', reason: '演练下架' })
    expect(snapshot(s).activities.some((a) => a.id === 'photo-fall')).toBe(false)
    expect(snapshot(s, 'student').activities.some((a) => a.id === 'photo-fall')).toBe(true)
    await execute(s, 'manager', 'activity.close', { activityId: 'photo-fall' })
    await execute(s, 'admin', 'activity.archive', {
      activityId: 'photo-fall',
      confirm: s.activities[0]!.title,
    })
    expect(s.applications).toHaveLength(0)
  })
  it('自定义年级字段编号仍按字段含义执行软提示', async () => {
    s.activities[0]!.fields[1]!.id = 'custom-grade'
    await apply('student', { answers: { intro: '摄影', 'custom-grade': '大一' } })
    expect(s.applications).toHaveLength(1)
  })
  it('REQ-F-030 / UC-01 保存报名、进入滚动初审并发送通知', async () => {
    await apply()
    expect(first().status).toBe('initial')
    expect(first().version).toBe(1)
    expect(s.notices[0]?.userId).toBe('student')
  })
  it('REQ-F-031/035 拒绝同一学生重复报名', async () => {
    await apply()
    await expect(apply()).rejects.toMatchObject({ status: 409 })
    expect(s.applications).toHaveLength(1)
  })
  it('REQ-F-005 截止瞬间不能提交', async () => {
    s.now = s.activities[0]!.end
    await expect(apply()).rejects.toMatchObject({ status: 409 })
  })
  it('REQ-F-030 必填缺失拒绝', async () => {
    await expect(apply('student', { answers: { grade: '大一' } })).rejects.toThrow('请填写自我介绍')
    expect(s.applications).toHaveLength(0)
  })
  it('REQ-F-023 软提示需要确认，确认后仍可报名', async () => {
    await expect(apply('student', { answers: { intro: '测试', grade: '大四' } })).rejects.toThrow(
      '软提示',
    )
    await apply('student', { answers: { intro: '测试', grade: '大四' }, confirmSoft: true })
    expect(s.applications).toHaveLength(1)
  })
  it('REQ-F-026 草稿不流转，可修改；正式确认后推进', async () => {
    await apply()
    await review(first(), false)
    expect(first().status).toBe('initial')
    await review(first(), false, false)
    expect(first().reviews).toHaveLength(1)
    await review(first())
    expect(first().status).toBe('interview')
  })
  it('REQ-F-032 修改后版本递增、结论清空、预约释放', async () => {
    await apply()
    await review(first())
    await execute(s, 'student', 'slot.book', { id: first().id, slotId: 'photo-slot-1' })
    await apply('student', { id: first().id, version: 1 })
    expect(first().version).toBe(2)
    expect(first().status).toBe('initial')
    expect(first().reviews).toEqual([])
    expect(first().slotId).toBeUndefined()
  })
  it('REQ-F-041 拒绝旧版本与过时环节的审核', async () => {
    await apply()
    await expect(
      execute(s, 'manager', 'review.save', {
        id: first().id,
        version: 0,
        passed: true,
        commit: true,
      }),
    ).rejects.toMatchObject({ status: 409 })
    await review(first())
    await expect(
      execute(s, 'manager', 'review.save', {
        id: first().id,
        version: 1,
        stage: 'initial',
        passed: true,
        commit: true,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })
  it('REQ-F-011 跨组织负责人不能审核', async () => {
    await apply()
    await expect(
      execute(s, 'other-manager', 'review.save', {
        id: first().id,
        version: 1,
        passed: true,
        commit: true,
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(snapshot(s, 'other-manager').applications).toHaveLength(0)
  })
  it('REQ-F-025 统一审核在截止后触发', async () => {
    await apply('student', { activityId: 'choir-fall' })
    expect(first().status).toBe('waiting')
    s.now = s.activities.find((a) => a.id === 'choir-fall')!.end
    tick(s)
    expect(first().status).toBe('initial')
  })
  it('REQ-F-024/042 全部停用时直接待录取', async () => {
    s.activities[0]!.stages.forEach((st) => (st.enabled = false))
    await apply()
    expect(first().status).toBe('eligible')
  })
  it('REQ-F-026 100分制边界按合格线判定', async () => {
    s.activities[0]!.stages[0]!.mode = 'score'
    await apply()
    await execute(s, 'manager', 'review.save', {
      id: first().id,
      version: 1,
      score: 59,
      commit: true,
    })
    expect(first().status).toBe('rejected')
  })
  it('REQ-F-029 有报名后表单结构锁定，其他字段不受影响', async () => {
    await apply()
    const a = structuredClone(s.activities[0]!)
    a.fields.push({ id: 'new', label: '新字段', type: 'text', required: false, options: [] })
    await expect(execute(s, 'manager', 'activity.save', a)).rejects.toMatchObject({ status: 409 })
  })
  it('REQ-F-051 名额满时失败且原预约保持', async () => {
    await apply()
    await review(first())
    const r1 = first()
    await apply('member')
    const r2 = s.applications[1]!
    await review(r2)
    await execute(s, 'student', 'slot.book', { id: r1.id, slotId: 'photo-slot-2' })
    await execute(s, 'member', 'slot.book', { id: r2.id, slotId: 'photo-slot-1' })
    await expect(
      execute(s, 'member', 'slot.book', { id: r2.id, slotId: 'photo-slot-2' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(r2.slotId).toBe('photo-slot-1')
  })
  it('REQ-F-053 已预约时段变更需原因，并通知重选', async () => {
    await apply()
    await review(first())
    await execute(s, 'student', 'slot.book', { id: first().id, slotId: 'photo-slot-1' })
    await expect(
      execute(s, 'manager', 'slot.save', { ...s.slots[0], place: '新地点' }),
    ).rejects.toThrow('原因')
    await execute(s, 'manager', 'slot.save', { ...s.slots[0], place: '新地点', reason: '场地冲突' })
    expect(first().slotId).toBeUndefined()
  })
  it('REQ-F-033 退出释放成员占用，队伍不足暂停审核', async () => {
    await apply('student', {
      activityId: 'innovation-team',
      answers: { proposal: '节能项目' },
      memberNos: ['20260002'],
    })
    await execute(s, 'member', 'application.exit', { id: first().id })
    expect(first().memberNos).toEqual(['20260001'])
    await expect(review(first())).rejects.toThrow('人数不足')
    await apply('member', {
      activityId: 'innovation-team',
      answers: { proposal: '第二个项目' },
      memberNos: ['20260003'],
    })
    expect(s.applications).toHaveLength(2)
  })
  it('不足团队截止时未通过', async () => {
    await apply('student', {
      activityId: 'innovation-team',
      answers: { proposal: '节能项目' },
      memberNos: ['20260002'],
    })
    await execute(s, 'member', 'application.exit', { id: first().id })
    s.now = s.activities.find((a) => a.id === 'innovation-team')!.end
    tick(s)
    expect(first().status).toBe('rejected')
  })
  it('REQ-F-060/062 发布、撤回更正、再次发布', async () => {
    await apply()
    await review(first())
    await review(first())
    s.now = s.activities[0]!.end
    await execute(s, 'manager', 'result.publish', {
      activityId: 'photo-fall',
      admittedIds: [first().id],
    })
    expect(first().status).toBe('admitted')
    await expect(
      execute(s, 'manager', 'result.withdraw', { activityId: 'photo-fall' }),
    ).rejects.toThrow('原因')
    await execute(s, 'manager', 'result.withdraw', { activityId: 'photo-fall', reason: '核对名单' })
    expect(first().status).toBe('eligible')
    await execute(s, 'manager', 'result.publish', { activityId: 'photo-fall', admittedIds: [] })
    expect(first().status).toBe('unselected')
    expect(s.activities[0]!.resultVersion).toBe(2)
  })
  it('REQ-F-012/013 驳回须理由，通过授予指定组织', async () => {
    await execute(s, 'student', 'grant.apply', { orgId: 'math', reason: '竞赛联络人' })
    const id = s.grants[0]!.id
    await expect(execute(s, 'admin', 'grant.decide', { id, approved: false })).rejects.toThrow(
      '理由',
    )
    await execute(s, 'admin', 'grant.decide', { id, approved: true })
    expect(s.users[0]!.orgIds).toEqual(['math'])
  })
  it('REQ-N-030 游客、其他学生快照没有报名或密码', async () => {
    await apply()
    expect(snapshot(s).applications).toEqual([])
    expect(snapshot(s, 'member').applications).toEqual([])
    expect(JSON.stringify(snapshot(s, 'admin'))).not.toContain('passwordHash')
  })
  it('REQ-N-031 归档删除报名、通知与个人审计，仅保留汇总', async () => {
    await apply()
    s.activities[0]!.closedAt = s.now
    await execute(s, 'admin', 'activity.archive', {
      activityId: 'photo-fall',
      confirm: s.activities[0]!.title,
    })
    expect(s.applications).toEqual([])
    expect(s.notices.filter((n) => n.activityId === 'photo-fall')).toEqual([])
    expect(s.activities[0]!.summary?.total).toBe(1)
    expect(s.audits.filter((v) => v.activityId === 'photo-fall')).toHaveLength(1)
  })
  it('REQ-F-080 目录导入字段与重复名称校验', async () => {
    await expect(
      execute(s, 'admin', 'organization.save', {
        name: '不合法',
        kind: 'club',
        campus: '南湖',
        stars: 7,
      }),
    ).rejects.toThrow('无效')
    await expect(
      execute(s, 'admin', 'organization.save', { ...s.organizations[0], id: '' }),
    ).rejects.toMatchObject({ status: 409 })
  })
})
