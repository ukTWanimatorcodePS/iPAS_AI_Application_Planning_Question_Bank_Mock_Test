import { describe, expect, it } from 'vitest';
import { allQuestions, getQuestion } from '../../src/content';
import type { AnswerAttempt, LessonProgress, ReviewItem } from '../../src/data/types';
import { orderedCompetencies } from '../../src/lib/learningPath';
import { dimensionStats, progressMetrics, weakestCompetencies } from '../../src/lib/stats';
import { buildStudyPlan, localDate, SPRINT_DAYS, UNIT_MINUTES } from '../../src/lib/studyPlan';

const ordered = orderedCompetencies('junior', 'both');
const settings = { restDays: [0, 6], dailyMinutes: { min: 60, max: 90 } };
const monday = new Date(2026, 10, 23); // 2026-11-23（週一）

describe('學習計畫', () => {
  it('有考試日期：計算倒數、學習日、衝刺期，並平均分配剩餘講義', () => {
    const plan = buildStudyPlan({ settings, examDate: '2027-02-01', ordered, progress: new Map(), reviews: [], today: monday });
    expect(plan.daysLeft).toBe(70);
    expect(plan.remainingLessons).toBe(16);
    expect(plan.sprintStart).toBe('2027-01-18');
    expect(plan.lessonsPerStudyDay).toBe(1);
    expect(plan.feasible).toBe(true);
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].tasks.some((t) => t.kind === 'lesson')).toBe(true);
    // 週末為休息日
    expect(plan.days[5].phase).toBe('rest');
    expect(plan.days[6].phase).toBe('rest');
  });

  it('時間不足時標示不可行並說明', () => {
    const plan = buildStudyPlan({ settings, examDate: '2026-12-01', ordered, progress: new Map(), reviews: [], today: monday });
    expect(plan.sprintStart).toBeNull();
    expect(plan.lessonsPerStudyDay * UNIT_MINUTES).toBeGreaterThan(settings.dailyMinutes.max);
    expect(plan.feasible).toBe(false);
    expect(plan.messages.join()).toContain('超過你設定的每日上限');
  });

  it('考前 14 天內進入衝刺：錯題、弱點、混合測驗或模考', () => {
    const plan = buildStudyPlan({ settings, examDate: '2027-02-01', ordered, progress: new Map(), reviews: [], today: new Date(2027, 0, 19) });
    const day = plan.days.find((d) => d.phase === 'sprint')!;
    expect(day.tasks.some((t) => t.kind === 'weak')).toBe(true);
    expect(day.tasks.some((t) => t.kind === 'mixed' || t.kind === 'mock')).toBe(true);
    expect(SPRINT_DAYS).toBe(14);
  });

  it('未設定考試日期時提示，並依每日時間安排；已完成的講義不再排入', () => {
    const progress = new Map<string, LessonProgress>([
      [ordered[0].code, { code: ordered[0].code, level: 'junior', visitedAt: '', completedAt: '2026-11-20T00:00:00Z', lastPosition: null, timeSpentSec: 0 }],
    ]);
    const plan = buildStudyPlan({ settings, examDate: null, ordered, progress, reviews: [], today: monday });
    expect(plan.daysLeft).toBeNull();
    expect(plan.remainingLessons).toBe(15);
    expect(plan.messages.join()).toContain('尚未設定考試日期');
    const first = plan.days[0].tasks.find((t) => t.kind === 'lesson');
    expect(first && 'code' in first ? first.code : null).toBe(ordered[1].code);
  });

  it('今天的計畫包含所有已到期（含逾期）的錯題', () => {
    const r = (due: string): ReviewItem => ({
      questionId: `x-${due}`, level: 'junior', subject: 'L11', competencyCode: 'L11101', mistakeCount: 1, correctStreak: 0, intervalDays: 1,
      nextDueAt: due, masteryStatus: 'unresolved', reason: 'unknown', firstWrongAt: due, lastWrongAt: due, lastAnsweredAt: due,
    });
    const reviews = [r(new Date(2026, 10, 20).toISOString()), r(new Date(2026, 10, 23, 12).toISOString()), r(new Date(2026, 10, 25, 9).toISOString())];
    const plan = buildStudyPlan({ settings, examDate: null, ordered, progress: new Map(), reviews, today: monday });
    expect(plan.days[0].tasks.find((t) => t.kind === 'review')).toMatchObject({ count: 2 });
    expect(plan.days[2].tasks.find((t) => t.kind === 'review')).toMatchObject({ count: 1 });
    expect(localDate(monday)).toBe('2026-11-23');
  });
});

describe('弱點分析與學習進度', () => {
  const mk = (qid: string, correct: boolean, day = 0): AnswerAttempt => {
    const q = getQuestion(qid)!;
    return { questionId: qid, sessionId: 's', level: q.level, subject: q.subject, competencyCode: q.competencyCode, mode: 'test', selectedIds: ['A'], correct, timeMs: 1, answeredAt: new Date(2026, 10, 23 - day, 10).toISOString() };
  };
  const qs = allQuestions.filter((q) => q.competencyCode === 'L11101').slice(0, 6);

  it('依難度與題型分組，樣本不足時正確率為 null', () => {
    const attempts = qs.map((q, i) => mk(q.id, i % 2 === 0));
    const tiers = dimensionStats(attempts, 'difficultyTier', getQuestion, 5);
    expect(tiers.reduce((a, t) => a + t.total, 0)).toBe(6);
    for (const t of tiers) if (t.total < 5) expect(t.accuracy).toBeNull();
    const removed = dimensionStats([{ ...attempts[0], questionId: 'gone' }], 'questionType', getQuestion, 1);
    expect(removed[0].code).toBe('unknown');
  });

  it('個人高錯誤率考點只列入樣本足夠者並由低到高排序', () => {
    const a = [...qs.slice(0, 3).map((q) => mk(q.id, false)), ...allQuestions.filter((q) => q.competencyCode === 'L11102').slice(0, 3).map((q) => mk(q.id, true)), mk(allQuestions.find((q) => q.competencyCode === 'L11201')!.id, false)];
    const weak = weakestCompetencies(a, 3);
    expect(weak.map((w) => w.code)).toEqual(['L11101', 'L11102']);
    expect(weak[0].accuracy).toBe(0);
  });

  it('錯題訂正率、待複習數與 14 天趨勢', () => {
    const today = new Date(2026, 10, 23, 18);
    const m = progressMetrics(
      {
        lessons: [],
        sessions: [],
        reviews: [
          { masteryStatus: 'unresolved', nextDueAt: new Date(2026, 10, 23, 8).toISOString() },
          { masteryStatus: 'reviewing', nextDueAt: new Date(2026, 10, 30).toISOString() },
          { masteryStatus: 'mastered', nextDueAt: null },
          { masteryStatus: 'reviewing', nextDueAt: new Date(2026, 10, 22).toISOString() },
        ],
        attempts: [mk(qs[0].id, true, 0), mk(qs[1].id, false, 0), mk(qs[2].id, true, 3)],
      },
      today,
    );
    expect(m.correctionRate).toBe(75);
    expect(m.masteredRate).toBe(25);
    expect(m.pendingReviews).toBe(2);
    expect(m.trend).toHaveLength(14);
    expect(m.trend[13]).toMatchObject({ total: 2, correct: 1 });
    expect(m.trend[10]).toMatchObject({ total: 1, correct: 1 });
  });
});
