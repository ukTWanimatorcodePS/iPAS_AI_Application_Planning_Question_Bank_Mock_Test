import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { choose, currentQuestion, expectNoHorizontalOverflow, isMobile, loadBank, optionLocator, skipOnboarding } from './helpers';

const bank = loadBank();

test('AI 導師：答錯後重新教學、切換模式、補強題作答並影響錯題本', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/courses/L11201');
  await page.getByTestId('start-quiz-5').click();
  const q = await currentQuestion(page, bank);
  await choose(page, q, false);
  await page.getByTestId('reveal').filter({ visible: true }).click();
  await expect(page.getByTestId(`explanation-${q.id}`)).toBeVisible();

  await page.getByTestId(`tutor-open-${q.id}`).click();
  const panel = page.getByTestId('tutor-panel');
  await expect(panel.getByText(/示範模式/).first()).toBeVisible();
  await expect(panel.getByRole('heading', { name: /核心考點/ })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '為什麼這樣選會錯' })).toBeVisible();
  // 原本的標準解析仍在，沒有被覆蓋
  await expect(page.getByTestId(`explanation-${q.id}`).getByText('逐一選項解析')).toBeVisible();

  await panel.getByRole('tab', { name: '簡單解釋' }).click();
  await expect(panel.getByRole('heading', { name: '換個例子重新理解' })).toHaveCount(0);
  await panel.getByRole('tab', { name: '比較易混淆觀念' }).click();
  await expect(panel.getByRole('heading', { name: '正確觀念 vs. 常見誤解' })).toBeVisible();

  const reinforcement = panel.getByTestId('tutor-reinforcement');
  const stem = (await reinforcement.locator('p.font-semibold').innerText()).trim();
  const rq = bank.get(stem)!;
  expect(rq.competencyCode).toBe(q.competencyCode);
  expect(rq.id).not.toBe(q.id);
  const wrongOpt = rq.options.find((o) => !rq.correctOptionIds.includes(o.id))!;
  await optionLocator(reinforcement, wrongOpt).click();
  // 快速連點兩次：只能記錄一次作答（交叉稽核 B1）
  await reinforcement.getByTestId('tutor-submit').dblclick();
  await expect(reinforcement.getByText('補強題答錯。')).toBeVisible();
  const tutorAttempts = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('ipas-ai-prep');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction('attempts').objectStore('attempts').getAll();
          all.onsuccess = () => resolve(all.result.filter((a: { mode: string }) => a.mode === 'tutor').length);
        };
      }),
  );
  expect(tutorAttempts).toBe(1);

  // 補強題答錯 → 補強題也進錯題本，且原題今天到期
  await page.goto('./#/review');
  await expect(page.getByRole('tab', { name: /尚未訂正（2）/ })).toBeVisible();
  await expect(page.getByText('今天到期').first()).toBeVisible();
});

test('學習計畫：設定考試日期後產生倒數、今日任務與學習進度', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/plan');
  await expect(page.getByText(/尚未設定考試日期/)).toBeVisible();
  // 日期以受測瀏覽器的時區為準；CI 的 Node 主機可能是 UTC，瀏覽器則是 Asia/Taipei。
  const examDate = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toLocaleDateString('sv-SE');
  });
  await page.goto('./#/settings');
  await page.getByTestId('exam-date-junior').fill(examDate);
  await page.goto('./#/plan');
  await expect(page.getByText('60 天')).toBeVisible();
  await expect(page.getByTestId('today-plan')).toBeVisible();
  await expect(page.getByTestId('progress-card').getByText('錯題訂正率')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.reload();
  await expect(page.getByText('60 天')).toBeVisible();
});

test('考前衝刺：樣本不足提示、非官方高頻考點聲明、混合測驗可開始', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/sprint');
  await expect(page.getByText(/並非官方公布或經統計證實的高頻考點/)).toBeVisible();
  await expect(page.getByText(/樣本不足/)).toBeVisible();
  await page.getByTestId('sprint-mixed-start').click();
  await expect(page.locator('#q-stem')).toBeVisible();
  await expect(page.getByText('全範圍混合測驗').first()).toBeVisible();
});

test('備份還原：匯出 → 雙重確認清除 → 匯入後紀錄恢復；也能匯入第一階段備份', async ({ page }, info) => {
  await skipOnboarding(page);
  // 先產生一筆作答
  await page.goto('./#/courses/L11101');
  await page.getByTestId('start-quiz-5').click();
  const q = await currentQuestion(page, bank);
  await choose(page, q, false);
  await page.getByTestId('reveal').filter({ visible: true }).click();

  await page.goto('./#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '匯出 JSON' }).click()]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.schemaVersion).toBe(3);
  expect(Array.isArray(json.data.studyTime)).toBe(true);
  expect(json.data.attempts.length).toBe(1);

  await page.getByRole('button', { name: /清除這台裝置/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '永久清除' }).click();
  await expect(page.getByText('已清除這台裝置的所有學習紀錄。')).toBeVisible();
  await page.goto('./#/review');
  await expect(page.getByText('目前沒有錯題')).toBeVisible();

  await page.goto('./#/settings');
  await page.getByTestId('import-input').setInputFiles(file);
  await page.getByRole('button', { name: '覆蓋並匯入' }).click();
  await expect(page.getByText(/匯入完成：1 筆作答/)).toBeVisible();
  await page.goto('./#/review');
  await expect(page.getByRole('tab', { name: /尚未訂正（1）/ })).toBeVisible();

  // 第一階段（schemaVersion 1）備份
  await page.goto('./#/settings');
  await page.getByTestId('import-input').setInputFiles(join(process.cwd(), 'tests/fixtures/backup-v1.json'));
  await page.getByRole('button', { name: '覆蓋並匯入' }).click();
  await expect(page.getByText(/匯入完成：2 筆作答/)).toBeVisible();

  // 不合法的檔案不會寫入
  await page.getByTestId('import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await expect(page.getByText(/匯入失敗/)).toBeVisible();
});

test('版面：深色、高對比、130% 字級下主要頁面不溢出，固定按鈕不遮住底部導覽', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/settings');
  await page.getByLabel('主題').selectOption('dark');
  await page.getByText('高對比模式').click();
  await page.locator('input[type="range"]').fill('1.3');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  for (const p of ['#/', '#/plan', '#/sprint', '#/courses/L23102', '#/courses/L22203', '#/stats', '#/review', '#/settings']) {
    await page.goto(`./${p}`);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
  if (isMobile(page)) {
    await page.goto('./#/courses/L11101');
    const cta = await page.getByRole('button', { name: '開始 5 題小測驗' }).boundingBox();
    const nav = await page.getByRole('navigation', { name: '主要導覽（行動版）' }).boundingBox();
    expect(cta!.y + cta!.height).toBeLessThanOrEqual(nav!.y + 1);
  }
});

test('程式題：長程式碼與輸出選項在畫面內完整換行', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('radiogroup', { name: '切換級別' }).getByRole('radio', { name: '中級' }).click();
  await page.goto('./#/courses/L22203');
  await page.getByTestId('start-quiz-10').click();
  // 逐題前進直到遇到程式題（L22203 共 15 題、其中 8 題程式題：非程式題只有 7 題，10 題練習必定抽到程式題）
  // 依題庫資料判斷，並等待題幹換題後再讀下一題，避免讀到尚未換頁的舊題
  for (let i = 0; i < 10; i++) {
    const q = await currentQuestion(page, bank);
    if (q.code) break;
    await choose(page, q, true);
    await page.getByTestId('reveal').filter({ visible: true }).click();
    await page.getByTestId('next').filter({ visible: true }).click();
    await expect(page.locator('#q-stem')).not.toHaveText(q.stem);
  }
  await expect(page.locator('.code-block').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('鍵盤操作：第一個 Tab 聚焦「跳到主要內容」並可移至主內容', async ({ page }) => {
  await skipOnboarding(page);
  // 重新載入，模擬一般進站（焦點從頁面頂端開始）
  await page.reload();
  await expect(page.getByTestId('continue-learning')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要內容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  // 仍停留在首頁，沒有被當成路由切換
  await expect(page.getByTestId('continue-learning')).toBeVisible();
});

for (const width of [360, 768]) {
  test(`寬度 ${width}px：新增頁面不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await skipOnboarding(page);
    for (const p of ['#/', '#/plan', '#/sprint', '#/courses/L21103', '#/courses/L23303', '#/practice', '#/mock', '#/past-exams', '#/me']) {
      await page.goto(`./${p}`);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    }
  });
}

test('歷屆試題：官方公告試題紀錄可依年度、梯次、科目篩選，且只連到官方下載頁', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/past-exams');
  const box = page.getByTestId('official-papers');
  // 初級：114 第四梯次 2 科 + 115 第一～三次各 2 科
  await expect(box.getByRole('listitem')).toHaveCount(8);
  await box.getByLabel('年度').selectOption('115');
  await expect(box.getByRole('listitem')).toHaveCount(6);
  await box.getByLabel('梯次').selectOption('第二次');
  await expect(box.getByRole('listitem')).toHaveCount(2);
  await box.getByLabel('科目').selectOption('L12');
  await expect(box.getByRole('listitem')).toHaveCount(1);
  const link = box.getByRole('link', { name: /官方學習資源頁下載 115 年第二次 L12/ });
  await expect(link).toHaveAttribute('href', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources');
  await page.getByRole('radiogroup', { name: '切換級別' }).getByRole('radio', { name: '中級' }).click();
  await box.getByLabel('年度').selectOption('');
  await expect(box.getByRole('listitem')).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
});

test('模擬考：顯示 115 年官方題數與時間並可一鍵套用，仍標示為自編', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/mock');
  await expect(page.getByTestId('official-format')).toHaveText('L11：單選題 50 題／75 分鐘');
  await expect(page.getByText('自訂模考・題目為本站自編')).toBeVisible();
  await page.getByTestId('apply-official-format').click();
  await expect(page.getByLabel('題數')).toHaveValue('50');
  await expect(page.getByLabel('時間（分鐘）')).toHaveValue('75');
  await page.getByRole('radiogroup', { name: '切換級別' }).getByRole('radio', { name: '中級' }).click();
  await expect(page.getByTestId('official-format')).toHaveText('L21：單選題 50 題／90 分鐘');
});

test('講義：顯示官方評鑑內容原文、回報錯誤連結；驗證測驗只出沒看過的題目', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/courses/L11102');
  const scope = page.getByTestId('official-scope');
  await expect(scope).toContainText('公部門人工智慧應用參考手冊');
  await expect(scope).toContainText('金融業運用人工智慧');
  await expect(page.getByRole('link', { name: '回報講義錯誤' })).toHaveAttribute('href', /github\.com\/.+\/issues\/new\?.*L11102/);

  // 先練 5 題並全部提交
  await page.getByTestId('start-quiz-5').click();
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const q = await currentQuestion(page, bank);
    seen.add(q.id);
    await choose(page, q, true);
    await page.getByTestId('reveal').filter({ visible: true }).click();
    await expect(page.getByTestId('report-question').first()).toHaveAttribute('href', new RegExp(q.id));
    if (i < 4) {
      await page.getByTestId('next').filter({ visible: true }).click();
      await expect(page.locator('#q-stem')).not.toHaveText(q.stem);
    }
  }

  // 驗證測驗：題目都不在剛才做過的 5 題中
  await page.goto('./#/courses/L11102');
  await page.getByTestId('start-verify').click();
  for (let i = 0; i < 5; i++) {
    const q = await currentQuestion(page, bank);
    expect(seen.has(q.id), `驗證測驗出現已作答題目 ${q.id}`).toBe(false);
    if (i < 4) {
      await page.getByTestId('next').filter({ visible: true }).click();
      await expect(page.locator('#q-stem')).not.toHaveText(q.stem);
    }
  }
});

test('限時模考：切到背景分頁時間照走，回到頁面已逾時就自動交卷', async ({ page }) => {
  await page.clock.install();
  await skipOnboarding(page);
  await page.goto('./#/mock');
  await expect(page.getByTestId('mock-timing-note')).toBeVisible();
  await page.getByLabel('題數').fill('3');
  await page.getByLabel('時間（分鐘）').fill('1');
  await page.getByRole('button', { name: '開始模考' }).click();
  await expect(page).toHaveURL(/#\/quiz\//);
  // 模擬切到背景分頁：分頁不可見期間經過 90 秒
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(90_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page).toHaveURL(/#\/results\//);
  // 等待測驗頁卸載時的計時寫回完成，再讀資料庫：作答時間不可超過 60 秒上限（Codex v1.0.0 複查）
  await page.clock.runFor(2000);
  const readMock = () =>
    page.evaluate(
      () =>
        new Promise<{ durationSec: number; timeLimitSec: number }[]>((resolve, reject) => {
          const req = indexedDB.open('ipas-ai-prep');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const all = req.result.transaction('quizSessions').objectStore('quizSessions').getAll();
            all.onsuccess = () => resolve(all.result.filter((x: { mode: string }) => x.mode === 'mock'));
          };
        }),
    );
  await expect.poll(async () => (await readMock()).length).toBe(1);
  const [saved] = await readMock();
  expect(saved.timeLimitSec).toBe(60);
  expect(saved.durationSec).toBeLessThanOrEqual(60);
});

test('介面顯示版本號 v1.2.1（桌面左下角；手機不必開選單，每頁底部就看得到）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/');
  if (isMobile(page)) {
    const footer = page.getByTestId('app-version-footer');
    await expect(footer).toContainText('版本 v1.2.1');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
    // 不被底部導覽列蓋住
    const fb = (await footer.boundingBox())!;
    const nb = (await page.getByRole('navigation', { name: '主要導覽（行動版）' }).boundingBox())!;
    expect(fb.y + fb.height).toBeLessThanOrEqual(nb.y + 1);
    await page.getByRole('button', { name: '開啟功能選單' }).click();
    await expect(page.getByTestId('app-version-mobile')).toHaveText('版本 v1.2.1');
  } else {
    const v = page.getByTestId('app-version');
    await expect(v).toHaveText('版本 v1.2.1');
    await expect(page.getByTestId('app-version-footer')).toBeHidden();
    const box = (await v.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeLessThan(vp.width / 4);
    expect(box.y).toBeGreaterThan(vp.height / 2);
  }
});

test('設定：每日最少大於最多時提示，離開欄位後自動對調（交叉稽核 B3）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/settings');
  const min = page.getByLabel('每日最少（分）');
  const max = page.getByLabel('每日最多（分）');
  // 預設 60／90。最多改成 30 並離開欄位 → 60 > 30，自動對調為 30／60
  await max.fill('30');
  await expect(page.getByTestId('minutes-invalid')).toBeVisible();
  await max.blur();
  await expect(min).toHaveValue('30');
  await expect(max).toHaveValue('60');
  await expect(page.getByTestId('minutes-invalid')).toBeHidden();
  // 最少改成 120（大於最多 60）→ 提示；離開欄位後對調為 60／120
  await min.fill('120');
  await expect(page.getByTestId('minutes-invalid')).toBeVisible();
  await min.blur();
  await expect(min).toHaveValue('60');
  await expect(max).toHaveValue('120');
  await expect(page.getByTestId('minutes-invalid')).toBeHidden();
  // 重新整理後仍保留
  await page.reload();
  await expect(min).toHaveValue('60');
  await expect(max).toHaveValue('120');
});
