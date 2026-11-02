import { test, expect, type Page } from '@playwright/test'
async function login(page: Page, no: string) {
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('textbox').first().fill(no)
  await d.getByRole('button', { name: '登录', exact: true }).click()
  await expect(d).not.toBeVisible()
}
test('同源打包版 / 登录、负责人发布、学生报名与数据库持久化', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.locator('main')).toContainText('活动信息')
  await expect(page.locator('.demo-bar')).toContainText(/课程演示环境|本地邮件测试环境/)
  await login(page, '20240001')
  await page.getByRole('link', { name: '负责人工作台' }).click()
  await page.getByRole('button', { name: '新建活动' }).click()
  await page.getByRole('dialog').locator('.el-select__wrapper').first().click()
  await page.getByRole('option', { name: '光影摄影协会', exact: true }).click()
  const title = '浏览器真实接口-' + test.info().project.name + '-' + Date.now()
  await page.getByRole('dialog').getByRole('textbox', { name: '活动名称', exact: true }).fill(title)
  await page.getByRole('dialog').getByRole('button', { name: '发布活动', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: '退出登录' }).click()
  await login(page, '20260001')
  await page.locator('.activity-card').filter({ hasText: title }).click()
  await page.getByRole('button', { name: '我要报名' }).click()
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: '自我介绍' })
    .fill('使用真实Java接口提交的模拟报名')
  await page.getByRole('dialog').getByRole('button', { name: '确认提交报名' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: '我的报名', exact: true }).click()
  await expect(page.locator('.application-card').filter({ hasText: title })).toContainText('初审中')
  await page.reload()
  await expect(page.locator('.application-card').filter({ hasText: title })).toContainText('初审中')
  await page.screenshot({ path: `artifacts/${test.info().project.name}-my.png`, fullPage: true })
  expect(errors).toEqual([])
})

test('UC-07/14 校邮注册、真实SMTP验证码与登录，375像素也可操作', async ({ page, request }) => {
  const provider = await request.get('/api/v1/auth/providers').then((r) => r.json())
  test.skip(provider.mode !== 'local-mail', '只在独立本地邮件环境执行，避免发送真实邮件')
  const email = `2026${Date.now().toString().slice(-10)}${test.info().project.name.length}@stu.neu.edu.cn`
  const password = 'BrowserIdentity123!'
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '校园邮箱注册', exact: true }).click()
  await dialog.getByRole('textbox', { name: '校园邮箱', exact: true }).fill(email)
  await dialog.getByRole('textbox', { name: '显示姓名', exact: true }).fill('浏览器模拟用户')
  await dialog.locator('input[type=password]').fill(password)
  await dialog.getByRole('button', { name: '发送验证码', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /秒后重发/ })).toBeDisabled()
  let code = ''
  await expect
    .poll(async () => {
      const inbox = await request.get('http://127.0.0.1:8025/api/v1/messages').then((r) => r.json())
      const mail = inbox.messages.find((m: { ID: string; To: { Address: string }[] }) =>
        m.To.some((v: { Address: string }) => v.Address === email),
      )
      if (!mail) return ''
      const detail = await request
        .get('http://127.0.0.1:8025/api/v1/message/' + mail.ID)
        .then((r) => r.json())
      code = detail.Text.match(/验证码：(\d{6})/)?.[1] || ''
      return code
    })
    .toMatch(/^\d{6}$/)
  await dialog.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill(code)
  await dialog.getByRole('button', { name: '验证并注册', exact: true }).click()
  await expect(page.getByText('注册成功，请登录', { exact: true })).toBeVisible()
  dialog = page.getByRole('dialog', { name: '登录平台', exact: true })
  await dialog.locator('input[type=password]').fill(password)
  await dialog.getByRole('button', { name: '登录', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link', { name: '我的报名', exact: true }).click()
  await expect(page.getByText(/账号已完成本环境的身份绑定/)).toBeVisible()
  await expect(page.getByRole('button', { name: '账号核验与邮箱', exact: true })).toBeVisible()
  await page.goto('/#/activities/innovation-team')
  await page.getByRole('button', { name: '我要报名', exact: true }).click()
  const team = page.getByRole('dialog')
  await team.getByRole('textbox', { name: /队员学号/ }).fill('20260003')
  await team.getByRole('button', { name: '核验队员账号', exact: true }).click()
  await expect(team.locator('.el-tag')).toContainText(['20260003'])
  await team.getByRole('textbox', { name: /队员学号/ }).fill('99999999999999999999')
  await team.getByRole('button', { name: '核验队员账号', exact: true }).click()
  await expect(page.getByText('未找到可加入的已核验账号', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
})
