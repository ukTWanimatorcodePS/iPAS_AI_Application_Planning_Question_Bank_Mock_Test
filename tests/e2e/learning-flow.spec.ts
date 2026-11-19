import { expect, test } from '@playwright/test';
import { choose, currentQuestion, expectNoHorizontalOverflow, isMobile, loadBank, skipOnboarding } from './helpers';

const bank = loadBank();

test('完整學習閉環：講義 → 完成 → 練習 → 答錯 → 錯題本 → 再測 → 重新整理仍保留', async ({ page }) => {
  await skipOnboarding(page);

  // 首頁 → L11101 講義
  await page.getByTestId('continue-learning').click();
  await expect(page.getByRole('heading', { level: 1, name: /L11101/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '學習目標' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 標記完成
  await page.getByTestId('toggle-complete').click();
  await expect(page.getByText('已標記完成！')).toBeVisible();

  // 開始練習（練習模式：每題提交後看解析）
  await page.getByTestId('start-quiz-5').click();
  await expect(page.locator('#q-stem')).toBeVisible();

  const answered: string[] = [];
  for (let i = 0; i < 3; i++) {
    const q = await currentQuestion(page, bank);
    answered.push(q.id);
    await choose(page, q, i !== 0); // 第一題故意答錯
    const reveal = page.getByTestId('reveal').filter({ visible: true });
    await reveal.click();
    await expect(page.getByTestId(`explanation-${q.id}`)).toBeVisible();
    // 已提交：重複點擊不應再出現提交鈕
    await expect(page.getByTestId('reveal').filter({ visible: true })).toHaveCount(0);
    if (i === 0) await expect(page.getByTestId(`explanation-${q.id}`).getByText('答錯', { exact: true })).toBeVisible();
    if (i < 2) await page.getByTestId('next').filter({ visible: true }).click();
  }

  // 交卷（剩下題目未作答 → 確認框提示）
  if (isMobile(page)) {
    await page.getByRole('button', { name: '開啟題號導覽' }).click();
    await page.getByRole('dialog', { name: '題號導覽' }).getByRole('button', { name: '交卷' }).click();
  } else {
    await page.locator('aside').getByRole('button', { name: '交卷' }).click();
  }
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '測驗結果' })).toBeVisible();
  await expect(page.getByText(/未作答以不得分計|全部作答/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 錯題本
  await page.goto('./#/review');
  await expect(page.getByRole('tab', { name: /尚未訂正（1）/ })).toBeVisible();
  const wrongStem = (await currentStemOnReview(page)).trim();
  expect(bank.get(wrongStem)?.id).toBe(answered[0]);

  // 再做一次（錯題重測）並答對
  await page.getByRole('button', { name: '重測此題' }).click();
  const q = await currentQuestion(page, bank);
  await choose(page, q, true);
  await page.getByTestId('submit').filter({ visible: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '測驗結果' })).toBeVisible();

  // 重新整理後仍保留：錯題移到「待複習」，不會答對一次就消失
  await page.goto('./#/review');
  await page.reload();
  await expect(page.getByRole('tab', { name: /待複習（1）/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /已掌握（0）/ })).toBeVisible();

  await page.goto('./#/');
  await page.reload();
  await expect(page.getByText('累計作答題數').locator('..')).toContainText('4');
  await expect(page.getByText(/已讀 1\/9/)).toBeVisible();
});

async function currentStemOnReview(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"] article h2').first().innerText();
}

test('初級／中級切換並保存', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('radio', { name: '中級' }).click();
  await expect(page.getByTestId('continue-learning')).toContainText('L21101');
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: '切換級別' }).getByRole('radio', { name: '中級' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '先跳過' })).toHaveCount(0);
  await page.goto('./#/courses');
  await expect(page.getByRole('heading', { name: /L22 大數據處理分析與應用/ })).toBeVisible();
  await page.getByRole('radio', { name: '初級' }).click();
  await expect(page.getByRole('heading', { name: /L11 人工智慧基礎概論/ })).toBeVisible();
});

test('未完成測驗可在重新整理後恢復', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/practice');
  await page.getByRole('radio', { name: /測驗模式/ }).check();
  await page.getByRole('button', { name: '開始練習' }).click();
  const q = await currentQuestion(page, bank);
  await choose(page, q, true);
  await page.reload();
  await expect(page.locator('#q-stem')).toHaveText(q.stem);
  await expect(page.locator('label.opt input:checked')).toHaveCount(1);
  await page.goto('./#/');
  await expect(page.getByText('你有一份未完成的測驗')).toBeVisible();
  await page.getByRole('link', { name: '繼續作答' }).click();
  await expect(page.locator('#q-stem')).toHaveText(q.stem);
});

test('中級講義顯示公式、必考核心觀念與對應練習題入口；不存在的細項顯示找不到頁面', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/courses/L22102');
  await expect(page.getByRole('heading', { name: '必考核心觀念' })).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '對應練習題入口' })).toBeVisible();
  await expect(page.getByTestId('start-quiz-5')).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await page.goto('./#/courses/L99999');
  await expect(page.getByText('找不到這個頁面')).toBeVisible();
});

test('深連結直接進站與重新整理（GitHub Pages 子路徑）', async ({ page }) => {
  await page.goto('./#/courses/L11101');
  await expect(page.getByRole('heading', { level: 1, name: /L11101/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /L11101/ })).toBeVisible();
  await page.goto('./#/does-not-exist');
  await expect(page.getByText('找不到這個頁面')).toBeVisible();
});

test('主要頁面在此視窗寬度沒有橫向溢出', async ({ page }) => {
  await skipOnboarding(page);
  for (const path of ['#/', '#/courses', '#/courses/L11101', '#/practice', '#/past-exams', '#/mock', '#/review', '#/stats', '#/settings', '#/me', '#/search?q=AI']) {
    await page.goto(`./${path}`);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});

test('手機版顯示底部導覽、桌面版顯示側欄', async ({ page }) => {
  await skipOnboarding(page);
  if (isMobile(page)) {
    const nav = page.getByRole('navigation', { name: '主要導覽（行動版）' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(5);
    const box = await nav.getByRole('link', { name: '首頁' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  } else {
    await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主要導覽（行動版）' })).toBeHidden();
  }
});
