import { describe, expect, it } from 'vitest';
import { addDays, applyAttempt, isDue, sanitizeIntervals } from '../../src/lib/review';
import type { ReviewItem } from '../../src/data/types';

const base = { questionId: 'original-L11101-0001', level: 'junior' as const, subject: 'L11' as const, competencyCode: 'L11101' };
const at = (iso: string, correct: boolean) => ({ ...base, correct, answeredAt: iso });
const T0 = '2026-11-01T10:00:00.000Z';

describe('錯題排程 1/3/7/14', () => {
  it('答錯建立項目，1 天後到期', () => {
    const r = applyAttempt(undefined, at(T0, false))!;
    expect(r.masteryStatus).toBe('unresolved');
    expect(r.mistakeCount).toBe(1);
    expect(r.nextDueAt).toBe(addDays(T0, 1));
  });

  it('從未答錯且答對 → 不建立項目', () => {
    expect(applyAttempt(undefined, at(T0, true))).toBeUndefined();
  });

  it('未到期就答對：改為待複習但不累計，不會答對一次就消失', () => {
    const r1 = applyAttempt(undefined, at(T0, false))!;
    const r2 = applyAttempt(r1, at(T0, true))!;
    expect(r2.masteryStatus).toBe('reviewing');
    expect(r2.correctStreak).toBe(0);
    expect(r2.nextDueAt).toBe(r1.nextDueAt);
  });

  it('每次到期都答對，完成全部間隔才轉為已掌握', () => {
    let t = T0;
    let r = applyAttempt(undefined, at(t, false))!;
    const seen: number[] = [];
    for (const gap of [1, 3, 7]) {
      t = addDays(t, gap);
      r = applyAttempt(r, at(t, true))!;
      seen.push(r.intervalDays);
      expect(r.masteryStatus).toBe('reviewing');
    }
    expect(seen).toEqual([3, 7, 14]);
    t = addDays(t, 14);
    r = applyAttempt(r, at(t, true))!;
    expect(r.masteryStatus).toBe('mastered');
    expect(r.nextDueAt).toBeNull();
    expect(isDue(r, new Date(addDays(t, 100)))).toBe(false);
  });

  it('中途答錯：連續正確歸零、錯誤次數累加、回到第一個間隔', () => {
    let r = applyAttempt(undefined, at(T0, false))!;
    r = applyAttempt(r, at(addDays(T0, 1), true))!;
    expect(r.correctStreak).toBe(1);
    r = applyAttempt(r, at(addDays(T0, 2), false))!;
    expect(r).toMatchObject({ correctStreak: 0, mistakeCount: 2, intervalDays: 1, masteryStatus: 'unresolved' });
  });

  it('已掌握後再答錯 → 回到尚未訂正', () => {
    const mastered: ReviewItem = { ...applyAttempt(undefined, at(T0, false))!, masteryStatus: 'mastered', nextDueAt: null, correctStreak: 4 };
    const r = applyAttempt(mastered, at(addDays(T0, 30), false))!;
    expect(r.masteryStatus).toBe('unresolved');
  });

  it('可自訂間隔，非法值會被清除', () => {
    expect(sanitizeIntervals([2, -1, 0, 5, NaN])).toEqual([2, 5]);
    expect(sanitizeIntervals([])).toEqual([1, 3, 7, 14]);
    let r = applyAttempt(undefined, at(T0, false), [2, 4])!;
    expect(r.intervalDays).toBe(2);
    r = applyAttempt(r, at(addDays(T0, 2), true), [2, 4])!;
    r = applyAttempt(r, at(addDays(T0, 6), true), [2, 4])!;
    expect(r.masteryStatus).toBe('mastered');
  });
});
