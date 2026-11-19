import { describe, expect, it } from 'vitest';
import { allQuestions } from '../../src/content';
import { isStrictlyLongest, lengthRatio, longestStrategyScore, summarizeCues } from '../../src/content/optionCues';

/**
 * A1 題庫改寫的進度鎖：每改完一批就把上限調低到當時的實測值，之後新增或修改題目都不能讓猜題線索回升。
 * 起點（17e9cdc）：選最長 80.9%、唯一最長 76.8%。
 */
const CEILING = { longestStrategyPct: 68.2, strictlyLongestPct: 62.2 };

describe('選項猜題線索（A1）', () => {
  it('計算方式：唯一最長、並列時的期望得分、長度比', () => {
    const q = (texts: string[], correct = 'A') => ({ id: 'x', subject: 'L11', correctOptionIds: [correct], options: texts.map((text, i) => ({ id: 'ABCD'[i], text })) });
    expect(isStrictlyLongest(q(['很長的正確答案', '短', '短', '短']))).toBe(true);
    expect(isStrictlyLongest(q(['一樣長', '一樣長', '短', '短']))).toBe(false);
    expect(longestStrategyScore(q(['一樣長', '一樣長', '短', '短']))).toBe(0.5);
    expect(longestStrategyScore(q(['短', '很長的錯誤選項', '短', '短']))).toBe(0);
    expect(lengthRatio(q(['四個字的', '兩字', '兩字', '兩字']))).toBe(2);
  });

  it('「每題選最長」得分與「正確選項是唯一最長」比例不高於目前上限', () => {
    const s = summarizeCues(allQuestions);
    expect(s.longestStrategyPct, `選最長得分 ${s.longestStrategyPct}%`).toBeLessThanOrEqual(CEILING.longestStrategyPct);
    expect(s.strictlyLongestPct, `唯一最長 ${s.strictlyLongestPct}%`).toBeLessThanOrEqual(CEILING.strictlyLongestPct);
  });
});
