import { describe, expect, it } from 'vitest';
import { EXAM_RULES, activeRules, judgeJunior, judgeMiddle } from '../../src/config/examRules';

describe('初級及格判定（2026 規則）', () => {
  it('同次全科：平均 ≥ 70 且各科 ≥ 60 → 及格', () => {
    expect(judgeJunior({ L11: 80, L12: 60 }, true).passed).toBe(true);
    expect(judgeJunior({ L11: 70, L12: 70 }, true).passed).toBe(true);
  });
  it('同次全科：平均達標但有科目 < 60 → 不及格', () => {
    const v = judgeJunior({ L11: 90, L12: 59 }, true);
    expect(v.passed).toBe(false);
    expect(v.reason).toContain('60');
  });
  it('同次全科：各科 ≥ 60 但平均 < 70 → 不及格', () => {
    expect(judgeJunior({ L11: 65, L12: 70 }, true).passed).toBe(false);
  });
  it('同次全科：缺科目成績 → 不及格並說明', () => {
    const v = judgeJunior({ L11: 90 }, true);
    expect(v.passed).toBe(false);
    expect(v.reason).toContain('L12');
  });
  it('非同次：各科需分別 ≥ 70', () => {
    const v = judgeJunior({ L11: 75, L12: 65 }, false);
    expect(v.passed).toBe(false);
    expect(v.passedSubjects).toEqual(['L11']);
    expect(judgeJunior({ L11: 70, L12: 70 }, false).passed).toBe(true);
  });
});

describe('中級兩路線判定', () => {
  it('L21 + L22 各 ≥ 70 → 數據分析證書', () => {
    const v = judgeMiddle({ L21: 70, L22: 80, L23: 50 });
    expect(v.certificates.find((c) => c.id === 'data')!.passed).toBe(true);
    expect(v.certificates.find((c) => c.id === 'ml')!.passed).toBe(false);
    expect(v.certificates.find((c) => c.id === 'ml')!.missing).toEqual(['L23']);
  });
  it('L21 + L23 各 ≥ 70 → 機器學習證書；L21 不足兩張都沒有', () => {
    expect(judgeMiddle({ L21: 71, L23: 90 }).certificates.find((c) => c.id === 'ml')!.passed).toBe(true);
    const v = judgeMiddle({ L21: 69, L22: 100, L23: 100 });
    expect(v.certificates.every((c) => !c.passed)).toBe(true);
  });
});

describe('考試規則設定', () => {
  it('115 年題數與時間依官方簡章 §2.3；未公告的考試日期保持 null', () => {
    const r = activeRules();
    expect(r.year).toBe(2026);
    expect(Object.values(r.questionCount)).toEqual([50, 50, 50, 50, 50]);
    expect(r.durationMinutes).toEqual({ L11: 75, L12: 75, L21: 90, L22: 90, L23: 90 });
    expect(r.formatNote).toContain('單選題 50 題');
    expect(r.sources.some((s) => s.label.includes('簡章'))).toBe(true);
    // 使用者的目標考期不寫死；116 年（2027）規則尚未公告，不應存在
    expect(r.examDates.junior).toBeNull();
    expect(r.examDates.middle).toBeNull();
    expect(EXAM_RULES[2027]).toBeUndefined();
  });
});
