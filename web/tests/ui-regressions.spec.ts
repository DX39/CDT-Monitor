import { expect, test } from '@playwright/test'

const config = {
  traffic_threshold: 95,
  enable_schedule_notification: false,
  shutdown_mode: 'KeepCharging',
  threshold_action: 'stop_and_notify',
  keep_alive: false,
  api_interval: 600,
  enable_billing: true,
  timezone: 'Asia/Shanghai',
  notifications: {
    email: { enabled: false, to: '', host: '', port: 465, username: '', password_configured: false, security: 'ssl' },
    telegram: { enabled: false, token_configured: false, chat_id: '', proxy_type: 'none', proxy_url: '', proxy_ip: '', proxy_port: '', proxy_user: '', proxy_password_configured: false },
    webhook: { enabled: false, url: '', method: 'GET', request_type: 'JSON', body: '' },
  },
  accounts: [{
    id: 1,
    access_key_id: 'LTAI5test',
    secret_configured: true,
    region_id: 'cn-hongkong',
    instance_id: 'i-test',
    max_traffic: 200,
    schedule_enabled: false,
    start_time: '08:00',
    stop_time: '23:30',
    remark: '香港测试节点',
    site_type: 'china',
  }],
}

test('login brand is positioned above the authentication card', async ({ page }, testInfo) => {
  await page.route('**/api/v1/system/init-status', (route) => route.fulfill({ json: { initialized: true } }))
  await page.route('**/api/v1/status', (route) => route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: '需要登录' } } }))
  await page.route('**/api/v1/config', (route) => route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: '需要登录' } } }))

  await page.goto('/')
  const brand = page.locator('.login-brand')
  const card = page.locator('.auth-card')
  await expect(page.getByText('阿里云 CDT 流量与实例自动化控制台')).toBeVisible()
  await expect(brand.locator('.brand-mark')).toBeVisible()
  const brandBox = await brand.boundingBox()
  const cardBox = await card.boundingBox()
  expect(brandBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(brandBox!.y + brandBox!.height).toBeLessThanOrEqual(cardBox!.y)
  await page.screenshot({ path: testInfo.outputPath('login-brand-desktop.png'), fullPage: true })
})

test('mobile settings, billing, API keys and selects remain usable', async ({ page }, testInfo) => {
  await page.route('**/api/v1/system/init-status', (route) => route.fulfill({ json: { initialized: true } }))
  await page.route('**/api/v1/status', (route) => route.fulfill({ json: {
    accounts: [{
      id: 1,
      account: 'LTAI5te***',
      remark: '香港测试节点',
      region: 'cn-hongkong',
      region_name: '中国香港',
      flow_total: 200,
      flow_used: 12.5,
      percentage: 6.25,
      threshold: 95,
      over_threshold: false,
      instance_status: 'Running',
      last_updated: new Date().toISOString(),
      stale: false,
    }],
    system_last_run: new Date().toISOString(),
  } }))
  await page.route('**/api/v1/config', (route) => route.fulfill({ json: config }))
  await page.route('**/api/v1/api-keys', (route) => route.fulfill({ json: {
    keys: [{ id: 1, name: '旧版 Key', scopes: null, created_at: new Date().toISOString() }],
  } }))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('本月费用')).toBeVisible()
  await expect(page.getByText('账单数据将在实例刷新后显示')).toBeVisible()

  await page.getByRole('button', { name: '菜单' }).click()
  await page.getByRole('button', { name: '设置' }).click()
  const panel = page.locator('.settings-panel')
  await expect(panel).toBeVisible()
  const panelBox = await panel.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(panelBox!.x).toBeGreaterThan(0)
  expect(panelBox!.y).toBeGreaterThan(0)
  expect(panelBox!.x + panelBox!.width).toBeLessThan(390)
  expect(panelBox!.y + panelBox!.height).toBeLessThan(844)
  expect(await panel.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe('0px')

  const refreshSelect = page.getByLabel('API 刷新间隔')
  await expect(refreshSelect).toBeVisible()
  expect(await refreshSelect.evaluate((element) => getComputedStyle(element).appearance)).toBe('none')
  expect(await refreshSelect.locator('..').evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe('0px')

  await page.getByRole('button', { name: 'API Key' }).click()
  await expect(page.getByRole('heading', { name: 'API Key' })).toBeVisible()
  await expect(page.getByText('旧版 Key')).toBeVisible()
  await expect(page.getByText('未配置权限')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('settings-api-key-mobile.png'), fullPage: true })
})
