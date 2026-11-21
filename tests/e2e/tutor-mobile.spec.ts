import { expect, test, type Locator, type Page } from '@playwright/test';
import { isMobile, skipOnboarding } from './helpers';

/**
 * 手機版 AI 導師設定（Codex 手機複查 M1–M3）：在實際渲染的瀏覽器量觸控尺寸，
 * 並檢查手機說明、教學、已存本機服務時的指引。mobile-390 為 Pixel 7（Android 使用者代理字串）。
 */
async function openSettings(page: Page) {
  await page.goto('./#/settings');
  await page.getByTestId('tutor-enable').check();
  return page.getByTestId('byok-settings').first();
}
const height = async (l: Locator) => (await l.boundingBox())!.height;

test('手機：設定的欄位、按鈕、建立金鑰連結與勾選列實際高度都至少 44px', async ({ page }) => {
  test.skip(!isMobile(page), '只在手機尺寸檢查');
  await skipOnboarding(page);
  const form = await openSettings(page);
  await form.getByRole('combobox', { name: /^AI 服務/ }).selectOption('openai');
  const targets: Locator[] = [
    form.getByRole('combobox', { name: /^AI 服務/ }),
    form.getByRole('textbox', { name: 'API 位址' }),
    form.locator('input[list]'),
    form.getByTestId('byok-key'),
    form.getByTestId('byok-key-page').getByRole('link'),
    form.locator('.byok-check'),
    form.getByTestId('byok-save'),
    form.getByTestId('byok-test'),
    form.getByRole('button', { name: '取得模型清單' }),
    form.getByTestId('byok-clear'),
    form.getByTestId('byok-mobile-guide').locator('summary'), // Codex 手機複查 R2-2
  ];
  for (const t of targets) expect(await height(t), await t.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('手機：預設雲端服務、說明與第一次使用的教學；不顯示自動偵測與只適用電腦的本機服務', async ({ page }) => {
  test.skip(!isMobile(page), '只在手機尺寸檢查');
  await skipOnboarding(page);
  const form = await openSettings(page);
  await expect(form.getByTestId('byok-mobile-note')).toContainText('手機上預設使用雲端服務');
  await expect(form.getByTestId('byok-mobile-guide')).toHaveAttribute('open', '');
  await expect(form.getByTestId('byok-detect')).toHaveCount(0);
  const service = form.getByRole('combobox', { name: /^AI 服務/ });
  await expect(service).toHaveValue('anthropic');
  const ids = await service.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(ids).not.toContain('ollama');
  expect(ids).not.toContain('ollama-bridge');
  expect(ids).not.toContain('lmstudio');
  expect(ids).toContain('custom');
});

test('手機：已存本機服務時不指向看不到的電腦版功能，提供改選入口；原設定不被刪除', async ({ page }) => {
  test.skip(!isMobile(page), '只在手機尺寸檢查');
  await skipOnboarding(page);
  await page.evaluate(() =>
    localStorage.setItem('ipas-ai-byok-config', JSON.stringify({ presetId: 'ollama-bridge', kind: 'openai-compatible', baseUrl: 'http://localhost:11435/v1', model: 'm', rememberKey: false })),
  );
  const form = await openSettings(page);
  await expect(form.getByTestId('byok-mobile-local')).toContainText('指向手機本身');
  await expect(form.getByTestId('byok-service-hint')).toContainText('在手機上請看下方說明');
  for (const desktopOnly of ['本機暫時許可', 'PowerShell']) await expect(form).not.toContainText(desktopOnly);
  await expect(form.getByTestId('local-setup-guide')).toHaveCount(0);
  await expect(form.getByTestId('local-bridge-panel')).toHaveCount(0);
  await expect(form.getByTestId('byok-mobile-guide')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ipas-ai-byok-config')!).presetId)).toBe('ollama-bridge');
  await form.getByTestId('byok-mobile-custom').click();
  await expect(form.getByRole('combobox', { name: /^AI 服務/ })).toHaveValue('custom');
});

test('電腦版不受影響：有自動偵測，沒有手機說明', async ({ page }) => {
  test.skip(isMobile(page), '只在電腦尺寸檢查');
  await skipOnboarding(page);
  const form = await openSettings(page);
  await expect(form.getByTestId('byok-detect')).toBeVisible();
  await expect(form.getByTestId('byok-mobile-note')).toHaveCount(0);
});
