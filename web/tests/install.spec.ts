import { expect, test } from '@playwright/test'

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test('installation and dashboard render on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '创建安全边界' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('setup-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('setup-mobile.png'), fullPage: true })

  await page.setViewportSize({ width: 1440, height: 1000 })
  const passwords = page.locator('input[type="password"]')
  await passwords.nth(0).fill('Visual-Test-Password-42!')
  await passwords.nth(1).fill('Visual-Test-Password-42!')
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('heading', { name: '设定自动化策略' })).toBeVisible()
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('heading', { name: '连接云端实例' })).toBeVisible()
  await page.getByRole('button', { name: '完成安装' }).click()

  await expect(page.getByRole('heading', { name: '资源控制台' })).toBeVisible({ timeout: 30_000 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true })
})

test('secure login renders and authenticates on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('login-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('login-mobile.png'), fullPage: true })

  await page.getByLabel('管理员密码').fill('Visual-Test-Password-42!')
  await page.getByRole('button', { name: '安全登录' }).click()
  await expect(page.getByRole('heading', { name: '资源控制台' })).toBeVisible({ timeout: 30_000 })
})
