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
  // Codex 複查 c464dd5（docs/AUDIT_c464dd5.md）發現、已修正的原始說法
  ['- 凸函數只有一個全域最小值；神經網路的損失是非凸的，可能停在局部最小值或鞍點。', 'convex-unique-minimum'],
  ['| 凸 vs. 非凸 | 唯一全域最小值 | 可能有多個局部最小值 | 神經網路多為非凸 |', 'convex-unique-minimum'],
  ['前言\n| 凸 vs. 非凸 | 唯一全域最小值 | 可能有多個局部最小值 |', 'convex-unique-minimum'],
  ['{"x":"| 一般凸 vs. 非凸 | 唯一全域最小值 |"}', 'convex-unique-minimum'],
  ['比較訓練與驗證（或測試）表現的差距；差距大代表過擬合。', 'gap-always-overfitting'],
  ['訓練與驗證差距大是過擬合。', 'gap-always-overfitting'],
  ['自助法（Bootstrap）：有放回重抽樣，每次約有 63.2% 的原始樣本會被抽到，用來估計指標的信賴區間。', 'bootstrap-632-unconditional'],
  ['| 速度快（Velocity） | 資料持續流入，分佈會隨時間改變（概念漂移） |', 'distribution-shift-as-concept-drift'],
  ['結構化資料預測常用傳統機器學習；文字生成與理解才考慮生成式 AI；', 'genai-text-only'],
  // Codex 複查 fda6baa（docs/AUDIT_fda6baa.md）：同類錯誤的常見改寫，以及當時仍留在內容中的寫法
  ['差距大＝過擬合。', 'gap-always-overfitting'],
  ['訓練好、驗證差是過擬合。', 'gap-always-overfitting'],
  ['訓練表現好但新資料表現差，代表泛化不佳（過擬合）。', 'gap-always-overfitting'],
  ['- 學習曲線：訓練與驗證都差 → 欠擬合；差距大 → 過擬合。', 'gap-always-overfitting'],
  ['凸函數一定只有一個最小點。', 'convex-unique-minimum'],
  ['Bootstrap 每次固定有 63.2% 的原始樣本出現。', 'bootstrap-632-unconditional'],
  ['輸入分布改變就是概念漂移。', 'distribution-shift-as-concept-drift'],
  ['生成式 AI 只能處理文字。', 'genai-text-only'],
  // Codex 全範圍稽核（docs/CODEX_FULL_AUDIT_2026-11-19.md）發現、已修正的原始說法
  ['不論母體分佈形狀，只要樣本數夠大（經驗上 n ≥ 30），樣本平均近似常態。', 'clt-unconditional'],
  ['樣本數夠大時，不論母體形狀，樣本平均數近似常態分佈。', 'clt-unconditional'],
  ['AUC 是隨機抽一個正例與一個負例時，模型給正例較高分數的機率；0.5 代表沒有區分能力。', 'auc-without-ties'],
  ['- 機器學習是「資料＋答案 → 學出規則」，目標是泛化到沒看過的新資料。', 'ml-supervised-only-definition'],
  ['傳統程式：規則＋資料 → 答案；機器學習：資料＋答案 → 規則（模型）。', 'ml-supervised-only-definition'],
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
  '凸函數的任何局部最小值都是全域最小值（嚴格凸且最小值存在時，最小點才唯一）。',
  '差距大最常見的原因是過擬合，但也要排除資料分佈不同。',
  'n 很大時趨近 1 − 1/e ≈ 63.2%，也就是預期約 63.2% 的原始樣本會出現。',
  '輸入分佈可能隨時間改變（資料漂移），輸入與目標之間的關係也可能改變（概念漂移）',
  '凸函數的局部最小值不一定只有一個點，但函數值都相同。',
  // Codex 複查 9d00439（docs/AUDIT_9d00439.md）：嚴格凸或具體函數的唯一最小值是正確敘述
  '嚴格凸函數只有一個全域最小值（假設最小值存在）。',
  '函數 f(x)=x² 有唯一全域最小值。',
  '凸函數在嚴格凸時只有一個最小點。',
  '| 嚴格凸 vs. 一般凸 | 最小點唯一 | 最小點可能不只一個 |',
  // Codex 複查 c69ae7f（docs/AUDIT_c69ae7f.md）：表格第一欄寫「嚴格凸 vs. 非凸」時，不可從「非凸」的「凸」開始比對
  '| 嚴格凸 vs. 非凸（假設最小值存在） | 唯一全域最小值 | 可能有多個局部最小值 |',
  '嚴格凸 vs. 非凸（假設最小值存在） | 唯一全域最小值 | 可能有多個局部最小值 |',
  '前言\n| 嚴格凸 vs. 非凸 | 唯一全域最小值 | 可能有多個局部最小值 |',
  '訓練好、測試差是過擬合的典型徵兆；也要先排除分佈不同。',
  '差距大 → 多半是過擬合。',
  '訓練表現好但新資料表現差，代表泛化不佳；最常見的原因是過擬合。',
  '也就是一次重抽樣中，預期約 63.2% 的原始樣本會出現（實際比例每次不同）。',
  '資料漂移是輸入分布改變；概念漂移是輸入與目標的關係改變。',
  '生成式 AI 可產生文字、影像、音訊與程式碼。',
  '在此前提下，不論母體分佈形狀，樣本數夠大時，樣本平均的分佈近似常態。',
  '- ❌ 「只要 n ≥ 30，樣本平均數就一定近似常態」→ 30 只是經驗法則。',
  'AUC 等於隨機抽一個正例與一個負例時，模型給正例較高分數的機率（兩者同分時算半次）。',
  '以監督式學習為例，是「資料＋答案（標籤）→ 學出規則」；非監督式學習則沒有答案。',
];

describe('已知錯誤說法檢查', () => {
  it.each(ORIGINAL_ERRORS)('偵測到原始錯誤：%s', (text, id) => {
    expect(findMisconceptions(text).map((m) => m.id)).toContain(id);
  });

  it.each(CORRECT)('正確或否定說明不被誤報：%s', (text) => {
    expect(findMisconceptions(text)).toEqual([]);
  });

  it('目前全部題目與講義都沒有已知錯誤說法（題目的錯誤選項本來就是錯誤說法，不檢查）', async () => {
    const hits: string[] = [];
    for (const q of allQuestions) {
      const scanned = { ...q, options: q.options.filter((o) => q.correctOptionIds.includes(o.id)) };
      for (const m of findMisconceptions(JSON.stringify(scanned))) hits.push(`${q.id}: ${m.id}`);
    }
    for (const code of lessonCodes()) for (const m of findMisconceptions((await loadLesson(code))!)) hits.push(`講義 ${code}: ${m.id}`);
    expect(hits).toEqual([]);
  });
});
