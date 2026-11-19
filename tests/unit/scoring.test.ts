import { describe, expect, it } from 'vitest';
import { accuracy, isCorrect, scoreSession } from '../../src/lib/scoring';

const bank: Record<string, { correctOptionIds: string[] }> = {
  a: { correctOptionIds: ['A'] },
  b: { correctOptionIds: ['B'] },
  c: { correctOptionIds: ['A', 'C'] },
  d: { correctOptionIds: ['D'] },
};
const lookup = (id: string) => bank[id];

describe('isCorrect', () => {
  it('單選完全相符才正確', () => {
    expect(isCorrect(bank.a, ['A'])).toBe(true);
    expect(isCorrect(bank.a, ['B'])).toBe(false);
    expect(isCorrect(bank.a, [])).toBe(false);
    expect(isCorrect(bank.a, undefined)).toBe(false);
  });
  it('複選需全對且不可多選，順序與重複不影響', () => {
    expect(isCorrect(bank.c, ['C', 'A'])).toBe(true);
    expect(isCorrect(bank.c, ['A', 'A', 'C'])).toBe(true);
    expect(isCorrect(bank.c, ['A'])).toBe(false);
    expect(isCorrect(bank.c, ['A', 'B', 'C'])).toBe(false);
  });
});

describe('scoreSession', () => {
  it('未作答以不得分計，並分開回報作答正確率', () => {
    const s = scoreSession(['a', 'b', 'd'], { a: ['A'], b: ['C'] }, lookup);
    expect(s).toMatchObject({ total: 3, answered: 2, unanswered: 1, correct: 1, wrong: 1 });
    expect(s.scorePct).toBe(33.3);
    expect(s.accuracyPct).toBe(50);
  });
  it('已自題庫移除的題目不列入分母', () => {
    const s = scoreSession(['a', 'gone'], { a: ['A'], gone: ['A'] }, lookup);
    expect(s.total).toBe(1);
    expect(s.scorePct).toBe(100);
    expect(s.missingQuestionIds).toEqual(['gone']);
  });
  it('沒有任何有效題目時分數為 0、正確率為 null', () => {
    const s = scoreSession([], {}, lookup);
    expect(s.scorePct).toBe(0);
    expect(s.accuracyPct).toBeNull();
  });
});

describe('accuracy', () => {
  it('樣本不足回傳 null', () => {
    expect(accuracy(2, 3, 5)).toBeNull();
    expect(accuracy(4, 5, 5)).toBe(80);
    expect(accuracy(0, 0)).toBeNull();
  });
});
