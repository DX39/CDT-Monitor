import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.CDT_E2E_URL || 'http://127.0.0.1:43212',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    colorScheme: 'light',
  },
})
