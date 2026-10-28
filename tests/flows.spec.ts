import { test, expect, type Page } from '@playwright/test'
test('活动信息 / 校区、搜索、空结果和竞赛切换', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('活动信息')
  const toggle = page.getByRole('button', { name: '展开筛选', exact: false })
  if (await toggle.isVisible()) await toggle.click()
  await page
    .getByRole('group', { name: '校区筛选', exact: true })
    .getByRole('button', { name: '浑南校区', exact: false })
    .click()
  await expect(page.locator('.activity-card')).toHaveCount(1)
  await expect(page.locator('.activity-card')).toContainText('合唱团')
  await page
    .getByRole('group', { name: '校区筛选', exact: true })
    .getByRole('button', { name: '全部校区', exact: false })
    .click()
  await page.getByRole('textbox', { name: '搜索活动或组织' }).fill('不存在的活动')
  await expect(page.getByText('没有符合条件的活动', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选条件', exact: true }).click()
  await page.getByRole('button', { name: '竞赛信息', exact: false }).click()
  await expect(page.locator('.activity-card')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({
    path: `artifacts/redesign-${test.info().project.name}-contests.png`,
    fullPage: true,
  })
})
async function login(page: Page, no: string) {
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill(no)
  await dialog.getByRole('button', { name: '登录', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
test('UC-01 / 学生浏览、报名、查看进度与刷新', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('活动信息')
  await page.screenshot({
    path: `artifacts/${test.info().project.name}-explore.png`,
    fullPage: true,
  })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await login(page, '20260001')
  await page.locator('.activity-card').first().click()
  await page.getByRole('button', { name: '我要报名', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '自我介绍' }).fill('我希望学习校园摄影并参与采风。')
  await dialog.getByText('大一', { exact: true }).click()
  await dialog.getByRole('button', { name: '确认提交报名' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link', { name: '我的报名', exact: true }).click()
  await expect(page.locator('.application-card')).toContainText('初审中')
  await page.reload()
  await expect(page.locator('.application-card')).toContainText('初审中')
  expect(errors).toEqual([])
})
test('UC-02 / 负责人配置活动与草稿', async ({ page }) => {
  await page.goto('/')
  await login(page, '20240001')
  await page.getByRole('link', { name: '负责人工作台' }).click()
  await page.getByRole('button', { name: '新建活动' }).click()
  await expect(page.getByRole('dialog')).toContainText('报名表字段')
  await expect(page.getByRole('dialog')).toContainText('审核环节')
  await page.getByRole('dialog').getByRole('button', { name: '添加字段' }).click()
  await expect(
    page.getByRole('dialog').locator('input[placeholder="字段名称"]').last(),
  ).toHaveValue('新字段')
})

test('UC-01～05 / 报名、评分草稿、面试预约、录取与通知主线', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await login(page, '20260001')
  await page.locator('.activity-card').first().click()
  await page.getByRole('button', { name: '我要报名', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '自我介绍' }).fill('完整主线演示报名')
  await dialog.getByText('大一', { exact: true }).click()
  await dialog.getByRole('button', { name: '确认提交报名' }).click()
  await expect(dialog).not.toBeVisible()
  async function switchUser(no: string) {
    await page.getByRole('button', { name: '退出登录' }).click()
    await login(page, no)
  }
  await switchUser('20240001')
  await page.getByRole('link', { name: '负责人工作台' }).click()
  await page.getByRole('button', { name: '查看 / 审核' }).first().click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '保存评分草稿' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: '查看 / 审核' }).first().click()
  await expect(page.getByRole('dialog')).toContainText('草稿')
  await page.getByRole('dialog').getByRole('button', { name: '确认并流转' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await switchUser('20260001')
  await page.getByRole('link', { name: '我的报名', exact: true }).click()
  await page.getByRole('button', { name: '选择面试时段', exact: true }).click()
  await page
    .getByRole('dialog')
    .locator('.slot-row')
    .first()
    .getByRole('button', { name: '选择', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.application-card')).toContainText('面试安排')
  await switchUser('20240001')
  await page.getByRole('link', { name: '负责人工作台' }).click()
  await page.getByRole('button', { name: '查看 / 审核' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: '确认并流转' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await switchUser('admin')
  await page.evaluate(async () => {
    const token = sessionStorage.getItem('demo-session') || ''
    const response = await fetch('/api/v1/commands/demo.time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Session': token },
      body: JSON.stringify({ now: '2026-11-11T10:00:00+08:00' }),
    })
    if (!response.ok) throw Error('演示时间设置失败')
  })
  await switchUser('20240001')
  await page.getByRole('link', { name: '负责人工作台' }).click()
  await page.getByRole('tab', { name: '录取结果' }).click()
  await page.locator('.el-checkbox__label').filter({ hasText: '林知夏' }).click()
  await page.getByRole('button', { name: '发布录取结果', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤回并更正结果' })).toBeVisible()
  await switchUser('20260001')
  await page.getByRole('link', { name: '我的报名', exact: true }).click()
  await expect(page.locator('.application-card')).toContainText('已录取')
  await page.getByRole('button', { name: '站内信' }).click()
  await expect(page.locator('.notice-item').filter({ hasText: '结果已发布' })).toBeVisible()
  await page.screenshot({
    path: `artifacts/${test.info().project.name}-result.png`,
    fullPage: true,
  })
})
