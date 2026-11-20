import { expect, test, type Page, type Request } from '@playwright/test';
import { choose, currentQuestion, isMobile, loadBank, skipOnboarding } from './helpers';

const bank = loadBank();
const FAKE_KEY = 'sk-e2e-FAKE-KEY-0000';

test('AI 連線：儲存並連線亮綠燈與 30 分鐘計時（不產生回答），失敗紅燈，設定與對話框一致', async ({ page }) => {
  const calls = await mockApi(page);
  await skipOnboarding(page);
  await enableAndConfigure(page);
  const form = page.getByTestId('byok-settings').first();
  // 連線只讀模型清單，不送出提問
  await expect(form.getByTestId('ai-connection')).toHaveAttribute('data-state', 'online');
  await expect(form.getByRole('timer')).toContainText(/^\s*(30:00|29:\d\d)/);
  expect(calls).toHaveLength(0);
  await page.getByTestId('tutor-fab').click();
  const chat = page.getByTestId('tutor-chat');
  await expect(chat.getByTestId('tutor-chat-context').getByTestId('ai-connection')).toHaveAttribute('data-state', 'online');
  await expect(chat.getByTestId('tutor-session-timer')).toBeVisible();
  await expect(chat.getByTestId('tutor-connection-notice')).toHaveCount(0);
  await page.getByTestId('tutor-minimize').click();
  await page.unroute('https://api.openai.com/**');
  await page.route('https://api.openai.com/**', route => route.fulfill({ status: 503, body: '{}' }));
  await form.getByTestId('byok-test').click();
  await expect(form.getByRole('status')).toContainText('連線失敗');
  await expect(form.getByTestId('ai-connection')).toHaveAttribute('data-state', 'offline');
  await page.getByTestId('tutor-fab').click();
  await expect(chat.getByTestId('tutor-connection-notice')).toHaveAttribute('data-state', 'offline');
  await expect(chat.getByTestId('tutor-reconnect')).toBeVisible();
});

/** 攔截 OpenAI 相容 API：記錄每一次請求，回傳串流回答 */
async function mockApi(page: Page) {
  const calls: Request[] = [];
  await page.route('https://api.openai.com/**', async (route) => {
    // 「連線」只讀模型清單：回傳模型，不計入提問次數
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [{ id: 'test-model' }] }) });
    calls.push(route.request());
    const chunks = ['監督式學習用「有標準答案」的資料訓練 [S1]。', '（舉例）像用標好垃圾郵件的信件教模型分辨。'];
    const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
  });
  return calls;
}

async function enableAndConfigure(page: Page) {
  await page.goto('./#/settings');
  await page.getByTestId('tutor-enable').check();
  const form = page.getByTestId('byok-settings').first();
  await form.getByRole('combobox', { name: /^AI 服務/ }).selectOption('openai');
  await form.getByRole('combobox', { name: /^模型/ }).fill('test-model');
  await form.getByTestId('byok-key').fill(FAKE_KEY);
  await form.getByTestId('byok-save').click();
  await expect(form.getByRole('status')).toContainText('已儲存。已連線');
}

test('AI 導師預設關閉；開啟後只有按「送出」才呼叫 API，回答附依據', async ({ page }) => {
  const calls = await mockApi(page);
  await skipOnboarding(page);
  await expect(page.getByTestId('tutor-fab')).toHaveCount(0);

  await enableAndConfigure(page);
  // 金鑰預設只存在這個分頁
  expect(await page.evaluate(() => localStorage.getItem('ipas-ai-byok-key'))).toBeNull();
  // 金鑰與所屬服務、來源一起存（Codex r2 R1）
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('ipas-ai-byok-key')))!)).toEqual({
    key: 'sk-e2e-FAKE-KEY-0000',
    presetId: 'openai',
    origin: 'https://api.openai.com',
  });

  await page.goto('./#/courses/L11301');
  const fab = page.getByTestId('tutor-fab');
  await expect(fab).toBeVisible();
  if (isMobile(page)) {
    // 不擋住底部導覽列
    const fb = (await fab.boundingBox())!;
    const nb = (await page.getByRole('navigation', { name: '主要導覽（行動版）' }).boundingBox())!;
    expect(fb.y + fb.height).toBeLessThanOrEqual(nb.y);
  }
  await fab.click();
  const chat = page.getByTestId('tutor-chat');
  await expect(chat).toBeVisible();
  await expect(page.getByTestId('tutor-chat-context')).toContainText('L11301');

  // 開啟視窗、點快捷提問、輸入文字：都不呼叫 API
  await chat.getByRole('button', { name: '舉一個生活或職場的例子' }).click();
  await expect(page.getByTestId('tutor-chat-input')).toHaveValue('舉一個生活或職場的例子');
  await page.getByTestId('tutor-chat-input').fill('什麼是監督式學習？');
  expect(calls).toHaveLength(0);

  await page.getByTestId('tutor-chat-send').click();
  await expect(page.getByTestId('tutor-chat-log')).toContainText('監督式學習用「有標準答案」的資料訓練');
  expect(calls).toHaveLength(1);
  const req = calls[0];
  await expect(chat.getByTestId('ai-connection')).toHaveAttribute('data-state', 'online');
  expect(req.url()).toBe('https://api.openai.com/v1/chat/completions');
  expect(req.url()).not.toContain(FAKE_KEY);
  expect(req.headers()['authorization']).toBe(`Bearer ${FAKE_KEY}`);
  const body = req.postDataJSON() as { messages: { role: string; content: string }[]; max_completion_tokens: number };
  expect(body.max_completion_tokens).toBeLessThanOrEqual(2048);
  expect(body.messages[0].role).toBe('system');
  expect(body.messages.at(-1)!.content).toContain('【本站依據資料】');
  expect(body.messages.at(-1)!.content).toContain('什麼是監督式學習？');
  // 依據清單可展開核對
  await page.getByTestId('tutor-sources').locator('summary').click();
  await expect(page.getByTestId('tutor-sources')).toContainText('[S1]');

  // 離題閒聊：在本機回覆提醒，不呼叫 API
  await page.getByTestId('tutor-chat-input').fill('今天天氣如何');
  await page.getByTestId('tutor-chat-send').click();
  await expect(page.getByTestId('tutor-local-reply')).toBeVisible();
  expect(calls).toHaveLength(1);

  // 縮放：放大、縮小、收合成圖示
  await page.getByTestId('tutor-resize').click();
  await expect(chat).toHaveClass(/tutor-chat-large/);
  await page.getByTestId('tutor-resize').click();
  await expect(chat).toHaveClass(/tutor-chat-normal/);
  await page.getByTestId('tutor-minimize').click();
  await expect(chat).toHaveCount(0);
  await expect(fab).toBeVisible();

  // 換頁不會自動送出任何請求
  await page.goto('./#/courses/L11101');
  await page.goto('./#/');
  expect(calls).toHaveLength(1);
});

test('測驗模式交卷前鎖定 AI 導師；練習題提交前不把答案送給 AI', async ({ page }) => {
  const calls = await mockApi(page);
  await skipOnboarding(page);
  await enableAndConfigure(page);

  await page.goto('./#/practice');
  await page.getByRole('radio', { name: /測驗模式/ }).check();
  await page.getByRole('button', { name: '開始練習' }).click();
  await expect(page.locator('#q-stem')).toBeVisible();
  await page.getByTestId('tutor-fab').click();
  await expect(page.getByTestId('tutor-chat')).toContainText('測驗進行中');
  await expect(page.getByTestId('tutor-chat-input')).toHaveCount(0);
  await page.getByTestId('tutor-minimize').click();

  await page.goto('./#/courses/L11101');
  await page.getByTestId('start-quiz-5').click();
  const q = await currentQuestion(page, bank);
  const correctText = q.options.find((o) => q.correctOptionIds.includes(o.id))!.text;
  await page.getByTestId('tutor-fab').click();
  await page.getByTestId('tutor-chat-input').fill('給我一點提示');
  await page.getByTestId('tutor-chat-send').click();
  await expect(page.getByTestId('tutor-chat-log')).toContainText('監督式學習');
  const sys = (calls[0].postDataJSON() as { messages: { content: string }[] }).messages[0].content;
  expect(sys).toContain('不要直接說出答案');
  expect(sys).not.toContain('正確答案：');
  expect(sys).toContain(correctText); // 選項本身可見，但沒有標示哪個正確
  await page.getByTestId('tutor-minimize').click();

  // 提交後，解析卡可「問 AI 導師」，此時才附上標準解析
  await choose(page, q, false);
  await page.getByTestId('reveal').filter({ visible: true }).click();
  await page.getByTestId(`ask-tutor-${q.id}`).click();
  await page.getByTestId('tutor-chat-input').fill('為什麼我錯了？');
  await page.getByTestId('tutor-chat-send').click();
  await expect.poll(() => calls.length).toBe(2);
  const sys2 = (calls[1].postDataJSON() as { messages: { content: string }[] }).messages[0].content;
  expect(sys2).toContain('正確答案：');
});

test('內容安全政策（CSP）已套用，且不阻擋本站講義、公式與題目', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await skipOnboarding(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self' 'sha256-");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).toContain("object-src 'none'");
  // 主題初始化腳本（內嵌、以雜湊核可）有執行
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toMatch(/light|dark/);
  await page.goto('./#/courses/L22102'); // 含 KaTeX 公式
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.goto('./#/courses/L11101');
  await page.getByTestId('start-quiz-5').click();
  await expect(page.locator('#q-stem')).toBeVisible();
  expect(violations).toEqual([]);
});
