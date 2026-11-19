import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 以「GitHub Pages 子路徑」建置後的靜態檔測試，確認資產、路由與重新整理都正常。
 * 本機若未安裝 Playwright 瀏覽器，可設定 PW_CHANNEL=msedge 使用系統 Edge。
 */
const BASE_PATH = '/ipas-ai-prep/';
const PORT = 4179;
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(channel ? { channel } : {}) } },
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: `npx vite build --base ${BASE_PATH} && npx vite preview --base ${BASE_PATH} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
