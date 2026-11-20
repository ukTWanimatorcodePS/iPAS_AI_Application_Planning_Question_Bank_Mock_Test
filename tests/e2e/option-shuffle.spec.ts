import { expect, test, type Page } from '@playwright/test';
import { choose, currentQuestion, loadBank, skipOnboarding } from './helpers';

const bank = loadBank();
type Q = NonNullable<ReturnType<typeof bank.get>>;

/** 讀出畫面上的選項：代號與對應的題庫原始選項 ID（依顯示順序） */
async function shownOptions(page: Page, q: Q) {
  const texts = (await page.locator('fieldset label.opt').allInnerTexts()).map((t) => t.trim());
  return texts.map((t) => {
    const m = t.match(/^([A-F])\.\s*([\s\S]*)$/)!;
    const opt = q.options.find((o) => o.text.trim() === m[2].trim());
    expect(opt, `找不到選項文字：${t}`).toBeTruthy();
    return { letter: m[1], id: opt!.id };
  });
}

test('選項每次打亂：A～D 依位置標示，正解不在題庫原始位置，解析的代號與作答畫面一致', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/courses/L11101');
  await page.getByTestId('start-quiz-5').click();

  const firstRound = new Map<string, string>();
  for (let i = 0; i < 3; i++) {
    const q = await currentQuestion(page, bank);
    const shown = await shownOptions(page, q);
    expect(shown.map((s) => s.letter)).toEqual(['A', 'B', 'C', 'D']);
    const correctLetter = shown.find((s) => q.correctOptionIds.includes(s.id))!.letter;
    const authoredLetter = q.options.find((o) => q.correctOptionIds.includes(o.id))!.id;
    expect(correctLetter, '正確答案不應停在題庫原始的字母').not.toBe(authoredLetter);
    firstRound.set(q.id, correctLetter);

    await choose(page, q, false);
    // choose(…, false) 點的是題庫原始順序中第一個錯誤選項
    const wrongId = q.options.find((o) => !q.correctOptionIds.includes(o.id))!.id;
    const myLetter = shown.find((s) => s.id === wrongId)!.letter;
    await page.getByTestId('reveal').filter({ visible: true }).click();
    const exp = page.getByTestId(`explanation-${q.id}`);
    await expect(exp.getByRole('status').first()).toContainText(`我的答案：${myLetter}`);
    await expect(exp.getByRole('status').first()).toContainText(`正確答案：${correctLetter}`);
    // 逐一選項解析的順序與代號和作答畫面相同
    const lines = (await exp.locator('.answerline > div:first-child').allInnerTexts()).map((t) => t.trim());
    expect(lines.map((t) => t[0])).toEqual(['A', 'B', 'C', 'D']);
    for (const [k, s] of shown.entries()) expect(lines[k]).toContain(q.options.find((o) => o.id === s.id)!.text);
    if (i < 2) await page.getByTestId('next').filter({ visible: true }).click();
  }

  // 再出同一批題目（錯題重測）：同一題的正確答案換到不同字母
  await page.goto('./#/review');
  await page.getByRole('button', { name: /錯題重測/ }).click();
  await expect(page.locator('#q-stem')).toBeVisible();
  for (let i = 0; i < firstRound.size; i++) {
    const q = await currentQuestion(page, bank);
    if (firstRound.has(q.id)) {
      const shown = await shownOptions(page, q);
      expect(shown.find((s) => q.correctOptionIds.includes(s.id))!.letter, `${q.id} 再出題時正確答案應換位置`).not.toBe(firstRound.get(q.id));
    }
    if (i < firstRound.size - 1) await page.getByTestId('next').filter({ visible: true }).click();
  }
});
