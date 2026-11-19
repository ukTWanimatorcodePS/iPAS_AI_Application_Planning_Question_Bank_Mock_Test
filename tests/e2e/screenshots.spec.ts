import { test } from '@playwright/test';
import { choose, currentQuestion, expectNoHorizontalOverflow, loadBank, skipOnboarding } from './helpers';

/**
 * 產生文件用截圖：SCREENSHOTS=1 npm run test:e2e -- screenshots
 * 一般測試時略過。
 */
test.skip(!process.env.SCREENSHOTS, '只在 SCREENSHOTS=1 時產生截圖');

const bank = loadBank();

test('文件截圖', async ({ page }, info) => {
  const tag = info.project.name;
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${tag}-${name}.png`, fullPage: false });
  await skipOnboarding(page);
  await page.waitForTimeout(300);
  await shot('home');

  await page.goto('./#/courses/L11302');
  await page.getByRole('heading', { name: '原理及運作流程' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('lesson');

  await page.goto('./#/courses/L11101');
  await page.getByTestId('start-quiz-5').click();
  const q = await currentQuestion(page, bank);
  await choose(page, q, false);
  await shot('quiz');
  await page.getByTestId('reveal').filter({ visible: true }).click();
  await page.getByTestId(`explanation-${q.id}`).scrollIntoViewIfNeeded();
  await shot('explanation');
  await page.getByTestId(`tutor-open-${q.id}`).click();
  await page.getByTestId('tutor-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('tutor');
  await page.getByTestId('tutor-reinforcement').scrollIntoViewIfNeeded();
  await shot('tutor-reinforcement');

  await page.goto('./#/review');
  await page.waitForTimeout(300);
  await shot('review');

  const d = new Date();
  d.setDate(d.getDate() + 75);
  await page.goto('./#/settings');
  await page.getByTestId('exam-date-junior').fill(d.toLocaleDateString('sv-SE'));
  await page.goto('./#/plan');
  await page.waitForTimeout(300);
  await shot('plan');
  await page.goto('./#/sprint');
  await page.waitForTimeout(300);
  await shot('sprint');
  await page.goto('./#/settings');
  await page.getByLabel('主題').selectOption('dark');
  await page.goto('./#/courses/L23102');
  await page.getByRole('heading', { name: '原理及運作流程' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('dark-lesson');
  await page.goto('./#/settings');
  await page.getByLabel('主題').selectOption('light');

  // 360px 最窄寬度溢出檢查
  if (tag.startsWith('mobile')) {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const p of ['#/', '#/courses/L22101', '#/stats', '#/settings']) {
      await page.goto(`./${p}`);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    }
    await page.goto('./#/courses/L22101');
    await page.getByRole('heading', { name: '原理及運作流程' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/screenshots/mobile-360-lesson-math.png` });
  }
});
