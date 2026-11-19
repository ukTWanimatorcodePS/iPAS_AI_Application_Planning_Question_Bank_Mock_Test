import type { AnswerAttempt, LessonProgress, QuizSession, StudyTimeLog, UserSettings } from '../data/types';
import { accuracy } from './scoring';

export const MIN_SAMPLE = 5;

export interface GroupStat {
  code: string;
  total: number;
  correct: number;
  /** 樣本數 < minSample 時為 null */
  accuracy: number | null;
}

function group(attempts: AnswerAttempt[], key: (a: AnswerAttempt) => string, minSample: number): GroupStat[] {
  const m = new Map<string, { total: number; correct: number }>();
  for (const a of attempts) {
    const k = key(a);
    const g = m.get(k) ?? { total: 0, correct: 0 };
    g.total++;
    if (a.correct) g.correct++;
    m.set(k, g);
  }
  return [...m.entries()]
    .map(([code, g]) => ({ code, ...g, accuracy: accuracy(g.correct, g.total, minSample) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export const competencyStats = (a: AnswerAttempt[], min = MIN_SAMPLE) => group(a, (x) => x.competencyCode, min);
export const subjectStats = (a: AnswerAttempt[], min = MIN_SAMPLE) => group(a, (x) => x.subject, min);

export function sessionPct(s: QuizSession): number | null {
  if (!s.submittedAt || !s.validCount) return null;
  return Math.round(((s.rawScore ?? 0) / s.validCount) * 1000) / 10;
}

/** 最常錯的題目 */
export function mostMissed(attempts: AnswerAttempt[], limit = 5) {
  const m = new Map<string, number>();
  for (const a of attempts) if (!a.correct) m.set(a.questionId, (m.get(a.questionId) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([questionId, count]) => ({ questionId, count }));
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 週一為一週起點
  x.setDate(x.getDate() - day);
  return x;
}

/** 計畫學習分鐘（依可讀日與每日最少分鐘）與實際學習分鐘（講義閱讀 + 測驗時間） */
export function planCompletion(
  period: 'week' | 'month',
  settings: UserSettings,
  sessions: QuizSession[],
  studyTime: Pick<StudyTimeLog, 'date' | 'seconds'>[],
  now = new Date(),
) {
  const start = period === 'week' ? startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1);
  let plannedDays = 0;
  for (const d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) if (!settings.restDays.includes(d.getDay())) plannedDays++;
  const plannedMin = plannedDays * settings.dailyMinutes.min;
  const quizSec = sessions.filter((s) => s.submittedAt && new Date(s.submittedAt) >= start).reduce((a, s) => a + s.durationSec, 0);
  // 講義閱讀時間依每日紀錄加總（只計入本期內的日期）；升級前的累計閱讀時間無法拆分到日期，不計入
  const startKey = start.toLocaleDateString('sv-SE');
  const lessonSec = studyTime.filter((t) => t.date >= startKey).reduce((a, t) => a + t.seconds, 0);
  const actualMin = Math.round((quizSec + lessonSec) / 60);
  return { plannedMin, actualMin, pct: plannedMin ? Math.min(100, Math.round((actualMin / plannedMin) * 100)) : null };
}

/* ---------- 第二階段：弱點分析與學習進度 ---------- */

type Lookup = (id: string) => { difficultyTier: string; questionType: string } | undefined;

/** 依難度或題型分組的正確率；已移除的題目歸入「unknown」 */
export function dimensionStats(attempts: AnswerAttempt[], dim: 'difficultyTier' | 'questionType', lookup: Lookup, min = MIN_SAMPLE) {
  return group(attempts, (a) => lookup(a.questionId)?.[dim] ?? 'unknown', min);
}

/** 個人錯誤率最高的細項（樣本數不足者不列入）；這是個人弱點，不是官方高頻考點 */
export function weakestCompetencies(attempts: AnswerAttempt[], min = 3, limit = 5) {
  return competencyStats(attempts, min)
    .filter((s) => s.accuracy !== null)
    .sort((a, b) => a.accuracy! - b.accuracy! || b.total - a.total)
    .slice(0, limit);
}

export interface ProgressMetrics {
  lessonsRead: number;
  quizzesCompleted: number;
  reviewTotal: number;
  /** 錯題訂正率：已不是「尚未訂正」的錯題比例；沒有錯題時為 null */
  correctionRate: number | null;
  masteredRate: number | null;
  pendingReviews: number;
  trend: { date: string; total: number; correct: number }[];
}

export function progressMetrics(
  input: { lessons: LessonProgress[]; sessions: QuizSession[]; reviews: { masteryStatus: string; nextDueAt: string | null }[]; attempts: AnswerAttempt[] },
  now = new Date(),
  days = 14,
): ProgressMetrics {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const reviewTotal = input.reviews.length;
  const corrected = input.reviews.filter((r) => r.masteryStatus !== 'unresolved').length;
  const mastered = input.reviews.filter((r) => r.masteryStatus === 'mastered').length;
  const trend: ProgressMetrics['trend'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('sv-SE');
    const list = input.attempts.filter((a) => new Date(a.answeredAt).toLocaleDateString('sv-SE') === key);
    trend.push({ date: key, total: list.length, correct: list.filter((a) => a.correct).length });
  }
  return {
    lessonsRead: input.lessons.filter((l) => l.completedAt).length,
    quizzesCompleted: input.sessions.filter((s) => s.submittedAt).length,
    reviewTotal,
    correctionRate: reviewTotal ? Math.round((corrected / reviewTotal) * 100) : null,
    masteredRate: reviewTotal ? Math.round((mastered / reviewTotal) * 100) : null,
    pendingReviews: input.reviews.filter((r) => r.masteryStatus !== 'mastered' && r.nextDueAt && new Date(r.nextDueAt).getTime() <= endOfToday.getTime()).length,
    trend,
  };
}
