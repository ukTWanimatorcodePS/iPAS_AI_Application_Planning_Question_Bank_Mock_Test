import { describe, expect, it } from 'vitest';
import { allQuestions } from '../../src/content';
import { absoluteEliminationScore, isStrictlyLongest, lengthRatio, longestStrategyScore, rankStrategyScore, summarizeCues } from '../../src/content/optionCues';

/**
 * A1 題庫改寫的進度鎖：每改完一批就把上限調低到當時的實測值，之後新增或修改題目都不能讓猜題線索回升。
 * 起點（17e9cdc）：選最長 80.9%、唯一最長 76.8%。
 */
const CEILING = { longestStrategyPct: 28.7, strictlyLongestPct: 17.8, secondStrategyPct: 33.6, absoluteEliminationPct: 27.4, absoluteThenLongestPct: 32.5 };

describe('選項猜題線索（A1）', () => {
  it('計算方式：唯一最長、並列時的期望得分、長度比', () => {
    const q = (texts: string[], correct = 'A') => ({ id: 'x', subject: 'L11', correctOptionIds: [correct], options: texts.map((text, i) => ({ id: 'ABCD'[i], text })) });
    expect(isStrictlyLongest(q(['很長的正確答案', '短', '短', '短']))).toBe(true);
    expect(isStrictlyLongest(q(['一樣長', '一樣長', '短', '短']))).toBe(false);
    expect(longestStrategyScore(q(['一樣長', '一樣長', '短', '短']))).toBe(0.5);
    expect(longestStrategyScore(q(['短', '很長的錯誤選項', '短', '短']))).toBe(0);
    expect(lengthRatio(q(['四個字的', '兩字', '兩字', '兩字']))).toBe(2);
  });

  it('選第 k 長的期望得分：並列者共享名次', () => {
    const q = (texts: string[], correct = 'A') => ({ id: 'x', subject: 'L11', correctOptionIds: [correct], options: texts.map((text, i) => ({ id: 'ABCD'[i], text })) });
    const four = q(['二二', '四四四四', '一', '三三三']);
    expect([1, 2, 3, 4].map((k) => rankStrategyScore(four, k))).toEqual([0, 0, 1, 0]);
    expect(rankStrategyScore(q(['一樣長', '一樣長', '短', '短']), 1)).toBe(0.5);
    expect(rankStrategyScore(q(['一樣長', '一樣長', '短', '短']), 2)).toBe(0.5);
    expect(rankStrategyScore(q(['一樣長', '一樣長', '短', '短']), 3)).toBe(0);
    expect(rankStrategyScore(q(['短', '一樣長', '一樣長', '短']), 4)).toBe(0.5);
    for (const t of [['甲', '乙乙', '丙丙丙', '丁丁丁丁'], ['同長', '同長', '同長', '同長']]) {
      const total = [1, 2, 3, 4].reduce((a, k) => a + rankStrategyScore(q(t), k), 0);
      expect(total).toBeCloseTo(1);
    }
  });

  it('排除絕對字眼的策略：刪掉含絕對字眼的選項後隨機選或選最長', () => {
    const q = (texts: string[], correct = 'A') => ({ id: 'x', subject: 'L11', correctOptionIds: [correct], options: texts.map((text, i) => ({ id: 'ABCD'[i], text })) });
    expect(absoluteEliminationScore(q(['正解', '一定錯', '所有錯', '只能錯']))).toBe(1);
    expect(absoluteEliminationScore(q(['正解', '誘答', '一定錯', '絕對錯']))).toBe(0.5);
    expect(absoluteEliminationScore(q(['一定對', '完全錯', '永遠錯', '只要錯']))).toBe(0.25);
    expect(absoluteEliminationScore(q(['正解', '比較長的誘答', '一定錯', '絕對錯']), true)).toBe(0);
    expect(absoluteEliminationScore(q(['比較長的正解', '誘答', '一定錯', '絕對錯']), true)).toBe(1);
  });

  it('「每題選最長」得分與「正確選項是唯一最長」比例不高於目前上限', () => {
    const s = summarizeCues(allQuestions);
    expect(s.longestStrategyPct, `選最長得分 ${s.longestStrategyPct}%`).toBeLessThanOrEqual(CEILING.longestStrategyPct);
    expect(s.strictlyLongestPct, `唯一最長 ${s.strictlyLongestPct}%`).toBeLessThanOrEqual(CEILING.strictlyLongestPct);
    expect(s.absoluteEliminationPct, `排除絕對字眼後隨機 ${s.absoluteEliminationPct}%`).toBeLessThanOrEqual(CEILING.absoluteEliminationPct);
    expect(s.absoluteThenLongestPct, `排除絕對字眼後選最長 ${s.absoluteThenLongestPct}%`).toBeLessThanOrEqual(CEILING.absoluteThenLongestPct);
    expect(s.rankStrategyPct[2], `選第二長 ${s.rankStrategyPct[2]}%`).toBeLessThanOrEqual(CEILING.secondStrategyPct);
  });
});
