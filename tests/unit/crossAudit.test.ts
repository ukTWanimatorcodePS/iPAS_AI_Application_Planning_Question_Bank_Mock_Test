/**
 * 交叉稽核（版本 17e9cdc）發現問題的回歸測試。
 * Claude：B1～B3（docs/CLAUDE_FULL_AUDIT_17e9cdc.md）；Codex：X1～X5（docs/CROSS_AUDIT_17e9cdc.md，原始驗收測試在 docs/cross-audit.probe.ts）。
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allQuestions } from '../../src/content';
import { exportBackup, parseBackup, restoreBackup } from '../../src/data/backup';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, recordTutorAttempt, submitSession } from '../../src/data/repo';
import { planCompletion } from '../../src/lib/stats';
import { buildStudyPlan, parseLocalDate } from '../../src/lib/studyPlan';

const fixture = () => JSON.parse(readFileSync('tests/fixtures/backup-v1.json', 'utf8'));
const monday = new Date(2026, 10, 23);
const oneLesson = [{ code: 'L11101', name: 'AI' }] as never;

let n = 0;
beforeEach(async () => {
  __setDb(new PrepDB(`cross-${++n}`));
  await ensureInitialized();
});

describe('B1 AI 導師補強題連點', () => {
  it('同一次補強題同時送出兩次，只記錄一次作答、錯誤次數只加一', async () => {
    const [a, b] = allQuestions.filter((q) => q.level === 'junior');
    const wrong = b.options.find((o) => !b.correctOptionIds.includes(o.id))!.id;
    const input = { originalQuestionId: a.id, questionId: b.id, selected: [wrong], timeMs: 1, attemptKey: 'k1' };
    const [r1, r2] = await Promise.all([recordTutorAttempt(input), recordTutorAttempt(input)]);
    expect(await db.attempts.count()).toBe(1);
    expect((await db.reviewItems.get(b.id))?.mistakeCount).toBe(1);
    expect(r1).toEqual(r2);
    // 下一次（新的識別碼）照常記錄
    await recordTutorAttempt({ ...input, attemptKey: 'k2' });
    expect(await db.attempts.count()).toBe(2);
  });
});

describe('B2 驗證測驗的「再做一次」', () => {
  it('驗證測驗的 session 記錄 unseenOnly，並可透過備份保留', async () => {
    const { startQuiz } = await import('../../src/data/quizFactory');
    const code = allQuestions[0].competencyCode;
    const r = await startQuiz({ level: 'junior', mode: 'test', count: 5, competencyCodes: [code], unseenOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await db.quizSessions.get(r.sessionId))?.unseenOnly).toBe(true);
    const back = parseBackup(JSON.stringify(await exportBackup()));
    expect(back.ok && back.backup.data.quizSessions[0].unseenOnly).toBe(true);
  });

  it('全部看過後，帶 unseenOnly 重做會被拒絕，不會出現看過的題目', async () => {
    const { startQuiz } = await import('../../src/data/quizFactory');
    const code = allQuestions[0].competencyCode;
    const pool = allQuestions.filter((q) => q.competencyCode === code && q.reviewStatus !== 'retired');
    const id = await createSession({ level: 'junior', mode: 'test', subject: 'L11', scopeLabel: 't', competencyCodes: [code], questionIds: pool.map((q) => q.id) });
    await submitSession(id, 1); // 交白卷：全部題目都看過解析
    const again = await startQuiz({ level: 'junior', mode: 'test', count: 5, competencyCodes: [code], unseenOnly: true });
    expect(again.ok).toBe(false);
  });
});

describe('B3 每日最少大於最多', () => {
  it('學習計畫會對調，以較大的值當每日上限', () => {
    const plan = buildStudyPlan({ settings: { restDays: [], dailyMinutes: { min: 120, max: 30 } }, examDate: '2026-12-01', ordered: oneLesson, progress: new Map(), reviews: [], today: monday });
    for (const d of plan.days) expect(d.minutes).toBeLessThanOrEqual(120);
    expect(plan.feasible).toBe(true);
  });
});

describe('X1 沒有學習日', () => {
  it('全部設為休息日且有未讀講義：不可行並說明', () => {
    const plan = buildStudyPlan({ settings: { restDays: [0, 1, 2, 3, 4, 5, 6], dailyMinutes: { min: 60, max: 90 } }, examDate: '2026-12-01', ordered: oneLesson, progress: new Map(), reviews: [], today: monday });
    expect(plan.feasible).toBe(false);
    expect(plan.messages.join()).toContain('沒有任何學習日');
  });

  it('沒有考期但每天都休息：不可行；講義都讀完時不受影響', () => {
    const all = { restDays: [0, 1, 2, 3, 4, 5, 6], dailyMinutes: { min: 60, max: 90 } };
    const plan = buildStudyPlan({ settings: all, examDate: null, ordered: oneLesson, progress: new Map(), reviews: [], today: monday });
    expect(plan.feasible).toBe(false);
    expect(plan.messages.join()).toContain('每天都設為休息日');
    const done = new Map([['L11101', { code: 'L11101', level: 'junior', visitedAt: '', completedAt: '2026-11-20', lastPosition: null, timeSpentSec: 0 }]]) as never;
    expect(buildStudyPlan({ settings: all, examDate: null, ordered: oneLesson, progress: done, reviews: [], today: monday }).feasible).toBe(true);
  });

  it('考前的日子全是休息日（只有考後才有學習日）：不可行', () => {
    // 2026-11-23（一）→ 2026-11-25（三）考試，週一、週二休息
    const plan = buildStudyPlan({ settings: { restDays: [1, 2], dailyMinutes: { min: 60, max: 90 } }, examDate: '2026-11-25', ordered: oneLesson, progress: new Map(), reviews: [], today: monday });
    expect(plan.studyDaysLeft).toBe(0);
    expect(plan.feasible).toBe(false);
  });
});

describe('X2 備份重複主鍵', () => {
  it.each(['lessonProgress', 'quizSessions', 'reviewItems'])('%s 有重複主鍵時拒絕，且不寫入任何資料', async (table) => {
    const raw = fixture();
    const list = raw.data[table] as object[];
    if (!list.length) return;
    list.push({ ...list[0] });
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('重複');
  });

  it('studyTime 同日同細項重複時拒絕；同一題的多次作答（attempts）不算重複', () => {
    const raw = fixture();
    raw.schemaVersion = 3;
    raw.data.studyTime = [
      { date: '2026-11-19', code: 'L11101', level: 'junior', seconds: 60 },
      { date: '2026-11-19', code: 'L11101', level: 'junior', seconds: 90 },
    ];
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
    const ok = fixture();
    ok.data.attempts.push({ ...ok.data.attempts[0] });
    expect(parseBackup(JSON.stringify(ok)).ok).toBe(true);
  });

  it('正常匯出的備份仍可還原再匯出', async () => {
    const r = parseBackup(readFileSync('tests/fixtures/backup-v1.json', 'utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await restoreBackup(r.backup);
    expect(parseBackup(JSON.stringify(await exportBackup())).ok).toBe(true);
  });
});

describe('X3 無效考試日期', () => {
  it.each(['not-a-date', '2026-02-30', '2026-13-01', '26-1-1'])('備份中的 %s 被拒絕', (bad) => {
    const raw = fixture();
    raw.data.settings.examDate = { junior: bad, middle: null };
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it('有效日期與 null 可接受；學習計畫遇到無效日期時提示並當作未設定', () => {
    const raw = fixture();
    raw.data.settings.examDate = { junior: '2027-03-01', middle: null };
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(true);
    expect(parseLocalDate('2024-02-29')).not.toBeNull();
    expect(parseLocalDate('2026-02-29')).toBeNull();
    const plan = buildStudyPlan({ settings: { restDays: [], dailyMinutes: { min: 60, max: 90 } }, examDate: 'not-a-date', ordered: [], progress: new Map(), reviews: [], today: monday });
    expect(plan.examDate).toBeNull();
    expect(plan.daysLeft).toBeNull();
    expect(plan.messages.join()).toContain('格式不正確');
  });
});

describe('X4 未來日期的學習時間', () => {
  it('不算入本週／本月；本週已發生的仍計入', () => {
    const s = { restDays: [], dailyMinutes: { min: 30, max: 90 } } as never;
    const now = new Date(2026, 10, 23, 12);
    const studyTime = [{ date: '2027-01-01', seconds: 36_000 }, { date: '2026-11-24', seconds: 600 }, { date: '2026-11-23', seconds: 300 }];
    expect(planCompletion('week', s, [], studyTime, now).actualMin).toBe(5);
    expect(planCompletion('month', s, [], studyTime, now).actualMin).toBe(5);
    const future = { submittedAt: '2027-01-01T00:00:00Z', durationSec: 3600 } as never;
    expect(planCompletion('week', s, [future], [], now).actualMin).toBe(0);
  });
});

describe('X5 遠端導師補強題', () => {
  it('拒絕原題、已排除的題目與不同級別的題目', async () => {
    vi.stubEnv('VITE_AI_TUTOR_ENDPOINT', 'https://example.invalid');
    const q = allQuestions[0];
    const same = allQuestions.find((x) => x.competencyCode === q.competencyCode && x.id !== q.id)!;
    let reply = q.id;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sections: [], reinforcementQuestionId: reply }), { status: 200 })));
    try {
      const { remoteProvider } = await import('../../src/ai/remoteProvider');
      const ask = (excludeIds: string[]) => remoteProvider.teach({ question: q, selected: [], mode: 'another' }, { excludeIds });
      expect((await ask([])).reinforcementQuestionId).toBeNull(); // 原題
      reply = same.id;
      expect((await ask([same.id])).reinforcementQuestionId).toBeNull(); // 已排除
      expect((await ask([])).reinforcementQuestionId).toBe(same.id); // 合法
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
