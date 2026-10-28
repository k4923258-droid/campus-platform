// @vitest-environment node
import { it, expect } from 'vitest'
import { seed } from '../seed'
import { execute } from '../engine'
import { migrateDemoCopy, legacyDemoCopy } from '../demo-copy'
it('只迁移原始演示文案，保留报名和配置', async () => {
  const state = await seed()
  await execute(state, 'student', 'application.save', {
    activityId: 'photo-fall',
    answers: { intro: '已有报名', grade: '大一' },
  })
  const applications = structuredClone(state.applications)
  const source = state.activities[0]!
  source.title = legacyDemoCopy[source.id]!.title
  source.body = legacyDemoCopy[source.id]!.body
  source.end = '2027-01-01T00:00:00+08:00'
  const defaults = await seed()
  migrateDemoCopy(state, defaults)
  expect(source.title).toBe(defaults.activities[0]!.title)
  expect(source.body).toBe(defaults.activities[0]!.body)
  expect(source.end).toBe('2027-01-01T00:00:00+08:00')
  expect(state.applications).toEqual(applications)
})
it('保留已由用户编辑的标题和公告正文', async () => {
  const state = await seed()
  state.activities[0]!.title = '组员编辑的活动'
  state.activities[0]!.body = '组员填写的要求'
  migrateDemoCopy(state, await seed())
  expect(state.activities[0]!.title).toBe('组员编辑的活动')
  expect(state.activities[0]!.body).toBe('组员填写的要求')
})
