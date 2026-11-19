import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

interface Q {
  id: string;
  stem: string;
  competencyCode: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  code?: string;
}

/** 從題庫 JSON 讀出答案（只在測試端使用） */
export function loadBank(): Map<string, Q> {
  const root = join(process.cwd(), 'src/content/questions');
  const map = new Map<string, Q>();
  for (const s of readdirSync(root))
    for (const f of readdirSync(join(root, s))) for (const q of JSON.parse(readFileSync(join(root, s, f), 'utf8')) as Q[]) map.set(q.stem, q);
  return map;
}

export async function skipOnboarding(page: Page) {
  await page.goto('./');
  const skip = page.getByRole('button', { name: '先跳過' });
  await skip.click();
  await expect(skip).toBeHidden();
}

export async function currentQuestion(page: Page, bank: Map<string, Q>): Promise<Q> {
  const stem = (await page.locator('#q-stem').innerText()).trim();
  const q = bank.get(stem);
  if (!q) throw new Error(`題庫找不到題幹：${stem}`);
  return q;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
}

/** 依「選項代號＋完整文字」精確點選，避免「結構化資料」同時命中「非結構化資料」等子字串 */
export function optionLocator(root: Page | Locator, opt: { id: string; text: string }) {
  return root.locator('label.opt').filter({ hasText: new RegExp(`^\\s*${opt.id}\\.\\s*${escapeRegExp(opt.text)}\\s*$`) });
}

export async function choose(page: Page, q: Q, correct: boolean) {
  const opt = correct ? q.options.find((o) => q.correctOptionIds.includes(o.id))! : q.options.find((o) => !q.correctOptionIds.includes(o.id))!;
  await optionLocator(page, opt).first().click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  // 以 clientWidth（版面視窗寬度）比較：行動裝置模擬下 innerWidth 會隨溢出內容放大，無法偵測溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '頁面不應有橫向溢出').toBeLessThanOrEqual(0);
}

export function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1200) < 1024;
}
