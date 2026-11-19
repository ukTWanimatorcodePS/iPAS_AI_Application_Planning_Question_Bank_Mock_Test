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

describe('驗證測驗（只出未看過的題目）', () => {
  it('排除已作答的題目；全部作答過時不建立測驗', async () => {
    const { startQuiz } = await import('../../src/data/quizFactory');
    const comp = q.competencyCode;
    const pool = allQuestions.filter((x) => x.competencyCode === comp && x.reviewStatus !== 'retired');
    // 先作答其中一題
    const s1 = await makeSession('test', [pool[0].id]);
    await setAnswer(s1, pool[0].id, [pool[0].correctOptionIds[0]]);
    await submitSession(s1, 10);
    const r = await startQuiz({ level: 'junior', mode: 'test', count: 50, competencyCodes: [comp], unseenOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = await db.quizSessions.get(r.sessionId);
    expect(s!.questionIds).not.toContain(pool[0].id);
    expect(s!.questionIds.length).toBe(pool.length - 1);

    // 全部作答後：沒有可驗證的新題目
    const s2 = await makeSession('test', pool.map((x) => x.id));
    for (const x of pool) await setAnswer(s2, x.id, [x.correctOptionIds[0]]);
    await submitSession(s2, 10);
    const none = await startQuiz({ level: 'junior', mode: 'test', count: 5, competencyCodes: [comp], unseenOnly: true });
    expect(none.ok).toBe(false);
  });

  it('交白卷後看過解析的題目也排除；未交卷的測驗題目不算看過', async () => {
    const { startQuiz, exposedQuestionIds } = await import('../../src/data/quizFactory');
    const comp = q.competencyCode;
    const pool = allQuestions.filter((x) => x.competencyCode === comp && x.reviewStatus !== 'retired');
    // 交白卷：不寫入作答紀錄，但結果頁會顯示解析
    const blank = await makeSession('test', [pool[0].id, pool[1].id]);
    await submitSession(blank, 5);
    expect(await db.attempts.count()).toBe(0);
    // 練習模式已顯示解析
    const prac = await makeSession('practice', [pool[2].id]);
    await setAnswer(prac, pool[2].id, [pool[2].correctOptionIds[0]]);
    await revealQuestion(prac, pool[2].id, 1000);
    // 未交卷的測驗：已選答案但尚未看到答案
    const open = await makeSession('test', [pool[3].id]);
    await setAnswer(open, pool[3].id, [pool[3].correctOptionIds[0]]);

    const seen = await exposedQuestionIds('junior');
    expect([...seen].sort()).toEqual([pool[0].id, pool[1].id, pool[2].id].sort());

    const r = await startQuiz({ level: 'junior', mode: 'test', count: 50, competencyCodes: [comp], unseenOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = (await db.quizSessions.get(r.sessionId))!.questionIds;
    for (const x of pool.slice(0, 3)) expect(ids).not.toContain(x.id);
    expect(ids).toContain(pool[3].id);
  });

  it('AI 導師已提交的補強題也算看過', async () => {
    const { exposedQuestionIds } = await import('../../src/data/quizFactory');
    const other = allQuestions.find((x) => x.level === 'junior' && x.id !== q.id)!;
    await db.tutorLogs.add({
      questionId: q.id,
      competencyCode: q.competencyCode,
      level: 'junior',
      provider: 'mock',
      modes: [],
      reinforcementQuestionId: other.id,
      reinforcementCorrect: true,
      at: new Date().toISOString(),
    });
    expect((await exposedQuestionIds('junior')).has(other.id)).toBe(true);
  });
});

describe('回報錯誤連結', () => {
  it('只帶題目 ID，連到本專案的 GitHub Issues', async () => {
    const { reportIssueUrl, REPO_URL } = await import('../../src/config/project');
    const url = new URL(reportIssueUrl({ kind: 'question', id: q.id }));
    expect(url.href.startsWith(`${REPO_URL}/issues/new?`)).toBe(true);
    expect(url.searchParams.get('title')).toContain(q.id);
    expect(url.searchParams.get('body')).toContain(q.id);
  });
});

describe('停用題目（Codex 稽核 M1）', () => {
  it('錯題轉為 retired 後，歷史仍可查，但錯題重測不再出這題', async () => {
    const { startReviewQuiz } = await import('../../src/data/quizFactory');
    const { getQuestion, getReleasedQuestion } = await import('../../src/content');
    const [a, b] = allQuestions.filter((x) => x.level === 'junior').slice(0, 2);
    const id = await makeSession('test', [a.id, b.id]);
    for (const x of [a, b]) await setAnswer(id, x.id, [x.options.find((o) => !x.correctOptionIds.includes(o.id))!.id]);
    await submitSession(id, 10);
    expect(await db.reviewItems.count()).toBe(2);

    const original = a.reviewStatus;
    (a as { reviewStatus: string }).reviewStatus = 'retired';
    try {
      expect(getQuestion(a.id)).toBeDefined(); // 歷史紀錄仍可顯示
      expect(getReleasedQuestion(a.id)).toBeUndefined();
      const r = await startReviewQuiz('junior');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const ids = (await db.quizSessions.get(r.sessionId))!.questionIds;
      expect(ids).toEqual([b.id]);
      // 指定題目 ID 重測（錯題本勾選）也一樣排除
      const r2 = await startReviewQuiz('junior', [a.id]);
      expect(r2.ok).toBe(false);
    } finally {
      (a as { reviewStatus: string }).reviewStatus = original;
    }
  });

  it('錯題重測只出本級別的題目', async () => {
    const { startReviewQuiz } = await import('../../src/data/quizFactory');
    const mid = allQuestions.find((x) => x.level === 'middle')!;
    const r = await startReviewQuiz('junior', [mid.id]);
    expect(r.ok).toBe(false);
  });
});

describe('限時模考計時（Codex 稽核 F1）', () => {
  it('依牆鐘時間計算，與分頁是否可見無關；交卷時作答時間不超過時間上限', async () => {
    const { wallElapsedSec, recordedDuration } = await import('../../src/lib/timer');
    const start = Date.parse('2026-11-19T10:00:00Z');
    expect(wallElapsedSec(start, start + 90_500)).toBe(90);
    expect(wallElapsedSec(Number.NaN)).toBe(0);
    expect(recordedDuration(7200, 3600)).toBe(3600);
    expect(recordedDuration(100, null)).toBe(100);

    const id = await createSession({ level: 'junior', mode: 'mock', subject: 'L11', scopeLabel: 't', competencyCodes: [], questionIds: [q.id], timeLimitSec: 60 });
    const s = await submitSession(id, 7200);
    expect(s?.durationSec).toBe(60);
  });
});

describe('版本號', () => {
  it('介面顯示的版本與 package.json 一致', async () => {
    const { APP_VERSION } = await import('../../src/config/project');
    const pkg = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
