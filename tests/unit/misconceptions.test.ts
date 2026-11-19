import { describe, expect, it } from 'vitest';
import { allQuestions, lessonCodes, loadLesson } from '../../src/content';
import { findMisconceptions } from '../../src/content/misconceptions';

/** 2026-11-19 Codex 複查發現、已修正的原始錯誤說法（逐字保留，防止再次出現） */
const ORIGINAL_ERRORS: [string, string][] = [
  ['過擬合；使用正則化、交叉驗證、提早停止或簡化模型', 'cv-controls-overfitting'],
  ['模型容量過大易過擬合；正則化、交叉驗證與提早停止是控制手段。', 'cv-controls-overfitting'],
  ['既要調整超參數、又要得到不偏的效能估計時，可以使用哪一種方法？', 'nested-cv-unbiased'],
  ['巢狀交叉驗證把調參與評估分開，估計較不偏。', 'nested-cv-unbiased'],
  ['常以 0.8 作為警示參考（四五分之四規則）。', 'four-fifths-typo'],
  ['差異影響比 = 弱勢群體正向結果比例 ÷ 優勢群體比例。', 'disparate-impact-minority-majority'],
  ['高風險處理（大規模敏感資料、自動化評分）前進行 DPIA。', 'dpia-any-automated-scoring'],
  ['在進行大規模敏感個資處理或自動化評分前，GDPR 等規範要求進行的評估是？', 'dpia-any-automated-scoring'],
  ['→ p 值是在 H₀ 為真下觀察到結果的機率。', 'p-value-without-extreme'],
  // 官方勘誤表中被更正的原文
  ['公式：Recall= TP/(TP+FP)', 'recall-formula'],
  ['拒絕 H0 Type II 錯誤（α）', 'type-two-alpha'],
  ['(D) 我們有 5%的機率犯型一錯誤', 'alpha-as-actual-error-rate'],
  ['5.了解 no code/ low code、ChatGTP、生成式工具。', 'chatgtp-typo'],
];

const CORRECT: string[] = [
  '正則化、提早停止與限制模型容量是直接控制手段，交叉驗證則用來評估泛化表現並協助選擇這些設定（本身不會降低過擬合）。',
  '把「交叉驗證」誤當成會直接降低過擬合的方法；它是評估與選模工具。',
  '巢狀交叉驗證以內層調參、外層評估，可降低樂觀偏差；它是較可靠的估計，但不保證完全不偏。',
  '樣本變異數除以 n−1 為不偏估計。',
  'Precision = TP/(TP+FP)，Recall = TP/(TP+FN)。',
  'p 值是在 H₀ 為真的前提下，得到「至少與觀察到的檢定統計量同樣極端」結果的機率。',
  '並非任何自動化評分都必然需要 DPIA。',
];

describe('已知錯誤說法檢查', () => {
  it.each(ORIGINAL_ERRORS)('偵測到原始錯誤：%s', (text, id) => {
    expect(findMisconceptions(text).map((m) => m.id)).toContain(id);
  });

  it.each(CORRECT)('正確或否定說明不被誤報：%s', (text) => {
    expect(findMisconceptions(text)).toEqual([]);
  });

  it('目前全部題目與講義都沒有已知錯誤說法', async () => {
    const hits: string[] = [];
    for (const q of allQuestions) for (const m of findMisconceptions(JSON.stringify(q))) hits.push(`${q.id}: ${m.id}`);
    for (const code of lessonCodes()) for (const m of findMisconceptions((await loadLesson(code))!)) hits.push(`講義 ${code}: ${m.id}`);
    expect(hits).toEqual([]);
  });
});
