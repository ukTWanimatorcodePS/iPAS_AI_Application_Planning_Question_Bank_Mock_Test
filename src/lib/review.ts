import type { AnswerAttempt, ReviewItem } from '../data/types';

export const DEFAULT_INTERVALS = [1, 3, 7, 14];
const DAY = 86_400_000;

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY).toISOString();
}

function endOfLocalDay(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 以「日」為單位判斷是否到期：到期日當天任何時間都算到期 */
export function isDue(item: ReviewItem, now = new Date()): boolean {
  if (item.masteryStatus === 'mastered' || !item.nextDueAt) return false;
  return new Date(item.nextDueAt).getTime() <= endOfLocalDay(now);
}

export function sanitizeIntervals(intervals: number[]): number[] {
  const clean = intervals.filter((n) => Number.isFinite(n) && n >= 1 && n <= 365).map((n) => Math.round(n));
  return clean.length ? clean : DEFAULT_INTERVALS;
}

/**
 * 依一次作答更新錯題複習排程（純函式）。
 * 規則：
 * - 答錯：錯誤次數 +1、連續正確歸零、排定 intervals[0] 天後複習，狀態「尚未訂正」。
 * - 答對但尚未到期：若原為「尚未訂正」改為「待複習」（已訂正），但不累計連續正確，避免答對一次就消失。
 * - 到期後答對：連續正確 +1，排下一個間隔；完成所有間隔才轉為「已掌握」。
 */
export function applyAttempt(
  item: ReviewItem | undefined,
  attempt: Pick<AnswerAttempt, 'questionId' | 'level' | 'subject' | 'competencyCode' | 'correct' | 'answeredAt'>,
  intervalsInput: number[] = DEFAULT_INTERVALS,
): ReviewItem | undefined {
  const intervals = sanitizeIntervals(intervalsInput);
  const now = attempt.answeredAt;
  if (!attempt.correct) {
    return {
      questionId: attempt.questionId,
      level: attempt.level,
      subject: attempt.subject,
      competencyCode: attempt.competencyCode,
      mistakeCount: (item?.mistakeCount ?? 0) + 1,
      correctStreak: 0,
      intervalDays: intervals[0],
      nextDueAt: addDays(now, intervals[0]),
      masteryStatus: 'unresolved',
      reason: item?.reason ?? 'unknown',
      firstWrongAt: item?.firstWrongAt ?? now,
      lastWrongAt: now,
      lastAnsweredAt: now,
    };
  }
  if (!item) return undefined; // 從未答錯，不進錯題本
  if (item.masteryStatus === 'mastered') return { ...item, lastAnsweredAt: now };

  if (isDue(item, new Date(now))) {
    const streak = item.correctStreak + 1;
    if (streak >= intervals.length) {
      return { ...item, correctStreak: streak, masteryStatus: 'mastered', nextDueAt: null, lastAnsweredAt: now };
    }
    const next = intervals[streak];
    return {
      ...item,
      correctStreak: streak,
      intervalDays: next,
      nextDueAt: addDays(now, next),
      masteryStatus: 'reviewing',
      lastAnsweredAt: now,
    };
  }
  return { ...item, masteryStatus: 'reviewing', lastAnsweredAt: now };
}

/** 手動調整下次複習日 */
export function reschedule(item: ReviewItem, days: number, nowIso = new Date().toISOString()): ReviewItem {
  return { ...item, nextDueAt: addDays(nowIso, Math.max(0, days)), masteryStatus: item.masteryStatus === 'mastered' ? 'reviewing' : item.masteryStatus };
}
