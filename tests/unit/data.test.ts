import { beforeEach, describe, expect, it } from 'vitest';
import { allQuestions } from '../../src/content';
import { csvCell, exportBackup, parseBackup, restoreBackup, toCsv } from '../../src/data/backup';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, getSettings, revealQuestion, setAnswer, submitSession, updateSettings } from '../../src/data/repo';

let n = 0;
beforeEach(async () => {
  __setDb(new PrepDB(`test-${++n}`));
  await ensureInitialized();
});

const q = allQuestions[0];
const wrongOption = q.options.find((o) => !q.correctOptionIds.includes(o.id))!.id;

async function makeSession(mode: 'practice' | 'test' = 'test', ids = [q.id]) {
  return createSession({ level: 'junior', mode, subject: 'L11', scopeLabel: 't', competencyCodes: [q.competencyCode], questionIds: ids });
}

describe('測驗流程資料', () => {
  it('交卷具冪等性：連按兩次只記錄一次作答', async () => {
    const id = await makeSession();
    await setAnswer(id, q.id, [wrongOption]);
    await Promise.all([submitSession(id, 30), submitSession(id, 30)]);
    expect(await db.attempts.count()).toBe(1);
    const s = await db.quizSessions.get(id);
    expect(s?.submittedAt).toBeTruthy();
    expect(s?.rawScore).toBe(0);
    expect(s?.validCount).toBe(1);
  });

  it('答錯自動收錄錯題本；交卷後不可再改答案', async () => {
    const id = await makeSession();
    await setAnswer(id, q.id, [wrongOption]);
    await submitSession(id, 10);
    await setAnswer(id, q.id, q.correctOptionIds);
    expect((await db.quizSessions.get(id))?.answers[q.id]).toEqual([wrongOption]);
    const item = await db.reviewItems.get(q.id);
    expect(item?.masteryStatus).toBe('unresolved');
    expect(item?.mistakeCount).toBe(1);
  });

  it('練習模式單題提交可防重複，交卷不重複記錄已提交題目', async () => {
    const id = await makeSession('practice');
    await setAnswer(id, q.id, q.correctOptionIds);
    const results = await Promise.all([revealQuestion(id, q.id, 1000), revealQuestion(id, q.id, 1000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await submitSession(id, 5);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.reviewItems.count()).toBe(0);
  });

  it('未作答題目不寫入作答紀錄，但計入分母', async () => {
    const id = await makeSession('test', [allQuestions[0].id, allQuestions[1].id]);
    await setAnswer(id, allQuestions[0].id, allQuestions[0].correctOptionIds);
    const s = await submitSession(id, 5);
    expect(await db.attempts.count()).toBe(1);
    expect(s?.rawScore).toBe(1);
    expect(s?.validCount).toBe(2);
  });

  it('沒有題目不能建立測驗', async () => {
    await expect(makeSession('test', [])).rejects.toThrow();
  });
});

describe('備份匯出／匯入', () => {
  it('匯出後可完整還原', async () => {
    const id = await makeSession();
    await setAnswer(id, q.id, [wrongOption]);
    await submitSession(id, 10);
    const backup = await exportBackup();
    const text = JSON.stringify(backup);

    __setDb(new PrepDB(`restore-${n}`));
    await ensureInitialized();
    const parsed = parseBackup(text);
    if (!parsed.ok) console.log(parsed.error);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await restoreBackup(parsed.backup);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.reviewItems.count()).toBe(1);
    expect((await db.quizSessions.get(id))?.submittedAt).toBeTruthy();
  });

  it('拒絕非 JSON、錯誤 app、錯誤型別與過大檔案', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: 'other', schemaVersion: 1 })).ok).toBe(false);
    expect(parseBackup('x'.repeat(11 * 1024 * 1024)).ok).toBe(false);
    const bad = {
      app: 'ipas-ai-prep',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: { settings: null, lessonProgress: [], quizSessions: [], attempts: [{ questionId: '<script>', correct: 'yes' }], reviewItems: [] },
    };
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false);
  });

  it('拒絕未來版本的 schema', () => {
    const b = { app: 'ipas-ai-prep', schemaVersion: 99, exportedAt: new Date().toISOString(), data: { settings: null, lessonProgress: [], quizSessions: [], attempts: [], reviewItems: [] } };
    expect(parseBackup(JSON.stringify(b)).ok).toBe(false);
  });

  it('丟棄未知欄位並防止原型污染', () => {
    const text = `{"app":"ipas-ai-prep","schemaVersion":1,"exportedAt":"${new Date().toISOString()}","__proto__":{"polluted":true},"data":{"settings":null,"lessonProgress":[],"quizSessions":[],"attempts":[],"reviewItems":[],"evil":1}}`;
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (r.ok) expect((r.backup.data as Record<string, unknown>).evil).toBeUndefined();
  });

  it('匯入驗證失敗時不會改動既有資料', async () => {
    const id = await makeSession();
    await setAnswer(id, q.id, [wrongOption]);
    await submitSession(id, 10);
    const r = parseBackup('{"app":"ipas-ai-prep"}');
    expect(r.ok).toBe(false);
    expect(await db.attempts.count()).toBe(1);
  });
});

describe('CSV 匯出', () => {
  it('跳脫逗號與引號，並防止試算表公式注入', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(toCsv([{ a: 1, b: null }], ['a', 'b'])).toBe('﻿a,b\r\n1,');
  });
});

describe('設定寫入', () => {
  it('同時送出多筆設定變更不會互相覆寫（深色＋高對比＋字級）', async () => {
    await Promise.all([updateSettings({ theme: 'dark' }), updateSettings({ highContrast: true }), updateSettings({ fontScale: 1.3 })]);
    const s = await getSettings();
    expect(s.theme).toBe('dark');
    expect(s.highContrast).toBe(true);
    expect(s.fontScale).toBe(1.3);
  });
});
