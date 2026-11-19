/**
 * 已知錯誤說法清單（回歸檢查）。
 *
 * 來源：
 * - 2026-11-19 Codex 複查發現的錯誤（docs/REVIEW_2026-11-19.md）
 * - 官方學習指引勘誤表：初級 11404、中級 1150410
 *
 * 這不是全面的內容審查，也不是語意驗證：只能攔下「已確認過的錯誤」的固定寫法與已測試過的常見改寫，
 * 換句話說的錯誤仍可能漏過。題目的錯誤選項（誘答）本來就是錯誤說法，掃描時不檢查。新增項目時請附上依據。
 */
export interface Misconception {
  id: string;
  pattern: RegExp;
  message: string;
  source: string;
}

export const MISCONCEPTIONS: Misconception[] = [
  {
    id: 'cv-controls-overfitting',
    pattern:
      /(正則化|提早停止)[^。；\n]{0,4}[、，與和及]\s*交叉驗證[^。；\n]{0,12}(控制|改善|降低|手段)|交叉驗證[^。；\n]{0,10}(控制|降低|改善|減少)[^。；\n]{0,4}過擬合|(正則化|提早停止)、交叉驗證、(提早停止|正則化)/,
    message: '交叉驗證是評估與選擇模型的工具，不應列為直接控制過擬合的方法（正則化、提早停止、限制容量才會直接約束模型）。',
    source: 'Codex 複查 2026-11-19；scikit-learn Cross-validation 說明',
  },
  {
    id: 'nested-cv-unbiased',
    pattern: /巢狀[^。\n]{0,30}不偏|不偏的效能估計/,
    message: '巢狀交叉驗證能降低調參造成的樂觀偏差，但不保證「不偏」。',
    source: 'Codex 複查 2026-11-19；scikit-learn Nested versus non-nested cross-validation',
  },
  {
    id: 'four-fifths-typo',
    pattern: /四五分之四/,
    message: '應為「五分之四規則（four-fifths rule）」，分母為正向結果比例最高的群體。',
    source: 'EEOC Uniform Guidelines Q&A',
  },
  {
    id: 'disparate-impact-minority-majority',
    pattern: /弱勢群體正向結果比例\s*÷\s*優勢群體/,
    message: '差異影響比的分母是「正向結果比例最高的群體」，不是籠統的「優勢群體」。',
    source: 'EEOC Uniform Guidelines Q&A',
  },
  {
    id: 'dpia-any-automated-scoring',
    pattern: /自動化評分）?前進行\s*DPIA|或自動化評分前/,
    message: 'GDPR 第 35 條以「可能造成高度風險」為準；自動化評估須為系統性且廣泛、並據以作出具法律效果或類似重大影響的決定，不是任何自動化評分都必須做 DPIA。',
    source: 'GDPR Art. 35(1), 35(3)',
  },
  {
    id: 'convex-unique-minimum',
    // 只攔「（非嚴格）凸函數…只有／僅有一個…最小」，以及凸 vs. 非凸比較表中的「唯一全域最小值」欄位。
    // 「嚴格凸函數只有一個全域最小值」「x² 有唯一全域最小值」是正確敘述，不可攔；中間出現否定或「嚴格」時也不算。
    pattern:
      /(?<!嚴格)凸函數(?:(?!不一定|未必|不只|並非|不是|嚴格)[^。；\n]){0,8}(只有|僅有|只會有)一個[^。；\n]{0,6}最小|(?:^|\|)(?:(?!嚴格)[^。；\n|])*凸[^。；\n|]*\|\s*唯一的?全域最小值\s*\|/m,
    message: '凸函數的局部最小值都是全域最小值，但最小點可以不只一個；嚴格凸且最小值存在時，最小點才唯一。',
    source: 'Codex 複查 2026-11-19（docs/AUDIT_c464dd5.md）；Boyd & Vandenberghe, Convex Optimization §4.2',
  },
  {
    id: 'gap-always-overfitting',
    // 把「差距大」或「訓練好、驗證／測試／新資料差」直接斷定為過擬合；中間有「常見、可能、多半、徵兆」等限定時不算
    pattern:
      /(差距大|訓練(表現)?好[、，,\s]*(驗證|測試|新資料)(表現)?差)(?:(?!常見|可能|多半|通常|最常|徵兆|典型|不一定|未必)[^。；\n]){0,6}(＝|=|→|就是|即是|即|代表|是|等於)\s*過擬合(?!的?(典型|常見)?(徵兆|症狀|現象))|新資料(表現)?差(?:(?!常見|可能|多半|通常|最常|徵兆|典型|不一定|未必)[^。；\n]){0,12}（過擬合）/,
    message: '訓練與驗證差距大最常見是過擬合，但也可能是資料分佈不同、標籤品質或評估流程問題，不可一律斷定。',
    source: 'Codex 複查 2026-11-19（docs/AUDIT_c464dd5.md）',
  },
  {
    id: 'bootstrap-632-unconditional',
    pattern: /(固定|每次|一定|必定)[^。；\n（(]{0,8}63\.2\s*%|63\.2\s*%[^。\n]{0,10}(會被抽到|被抽中)/,
    message: 'Bootstrap 的 63.2% 是「從 n 筆有放回抽 n 次、n 很大時」每筆至少被抽到的機率，即預期不同樣本比例，不是每次固定的比例。',
    source: 'Codex 複查 2026-11-19（docs/AUDIT_c464dd5.md）；Efron & Tibshirani, An Introduction to the Bootstrap',
  },
  {
    id: 'distribution-shift-as-concept-drift',
    pattern: /分[佈布][^。；，,\n（(]{0,8}(改變|變化|偏移)[^。；，,\n（(]{0,3}(就是|即是|即|＝|=|稱為|叫做|屬於|是)\s*概念漂移|分[佈布][^。；，,\n]{0,8}(改變|變化)（概念漂移）/,
    message: '輸入分佈改變是資料漂移；輸入與目標的關係改變才是概念漂移。',
    source: 'Codex 複查 2026-11-19（docs/AUDIT_c464dd5.md）',
  },
  {
    id: 'genai-text-only',
    pattern: /生成式\s*(AI|模型)[^。；，,\n]{0,4}(只能|僅能|只會|只用於|只適用於|只處理)[^。；\n]{0,6}文字|文字生成與理解才考慮生成式/,
    message: '生成式 AI 也用於影像、音訊、程式碼等；文字理解任務也不一定需要生成式模型。',
    source: 'Codex 複查 2026-11-19（docs/AUDIT_c464dd5.md）',
  },
  {
    id: 'clt-unconditional',
    pattern: /不論母體(分佈)?(形狀)?[，,]\s*只要樣本數夠大|樣本數夠大時，不論母體形狀/,
    message: '中央極限定理需樣本獨立、母體變異數有限；n ≥ 30 只是經驗法則，母體越偏斜需要越多樣本，柯西分佈等變異數不存在者不適用。',
    source: 'Codex 全範圍稽核 2026-11-19（docs/CODEX_FULL_AUDIT_2026-11-19.md）；NIST/SEMATECH e-Handbook, Cauchy Distribution',
  },
  {
    id: 'auc-without-ties',
    pattern: /給正例較高分數的機率(?![^。；\n]{0,3}（[^）]{0,10}同分)/,
    message: 'ROC-AUC 的機率解釋需處理同分：P(正例分數 > 負例分數) + 0.5 × P(同分)。',
    source: 'Codex 全範圍稽核 2026-11-19；scikit-learn roc_auc_score',
  },
  {
    id: 'ml-supervised-only-definition',
    pattern: /機器學習(是|：|由|從)?\s*「?資料\s*[＋+與和及]\s*答案/,
    message: '「資料＋答案 → 規則」只描述監督式學習；機器學習的總定義是從資料學出規律，非監督式學習沒有答案。',
    source: 'Codex 全範圍稽核 2026-11-19；scikit-learn Unsupervised learning',
  },
  {
    id: 'p-value-without-extreme',
    pattern: /p\s*值[^。\n]{0,20}觀察到(目前)?結果的機率/,
    message: 'p 值定義需包含「至少與觀察到的檢定統計量同樣極端」。',
    source: 'ASA Statement on p-Values',
  },
  {
    id: 'recall-formula',
    pattern: /(Recall|召回率)\s*[=＝][^。，\n]{0,20}TP\s*\+\s*FP/,
    message: '召回率 = TP / (TP + FN)，不是 TP / (TP + FP)。',
    source: '中級學習指引勘誤表 1150410（5-21）',
  },
  {
    id: 'type-two-alpha',
    pattern: /Type\s*II\s*錯誤\s*（\s*α\s*）|型二錯誤（α）/,
    message: '型一錯誤對應 α，型二錯誤對應 β。',
    source: '初級學習指引勘誤表 11404（3-27）',
  },
  {
    id: 'alpha-as-actual-error-rate',
    pattern: /犯型一錯誤的機率(為|是)\s*5\s*%|5\s*%\s*的機率犯型一錯誤/,
    message: '顯著水準 0.05 是容許的型一錯誤機率上限，並非這次實際犯錯的機率。',
    source: '初級學習指引勘誤表 11404（3-32）',
  },
  {
    id: 'chatgtp-typo',
    pattern: /ChatGTP/,
    message: '應為 ChatGPT。',
    source: '中級學習指引勘誤表 1150410',
  },
  {
    id: 'logreg-linear-separability',
    pattern: /邏輯迴歸[^。\n]{0,20}假設[^。\n]{0,10}線性可分/,
    message: '邏輯迴歸的假設是「對數勝算（log-odds）與特徵呈線性關係」，不是資料線性可分。',
    source: '中級學習指引勘誤表 1150410（4-27）',
  },
];

/** 命中片段若明確是否定或指出錯誤（例如「誤當成」「不會」「並非」「❌」），視為警告學習者的說明而非錯誤說法 */
// 注意：不可只用「誤」，否則「錯誤」本身就會被當成否定
const NEGATION = /誤當|誤以為|誤認|誤解|不會|不是|並非|不應|不能|❌|而非/;

export function findMisconceptions(text: string): Misconception[] {
  return MISCONCEPTIONS.filter((m) => {
    const re = new RegExp(m.pattern.source, m.pattern.flags.includes('g') ? m.pattern.flags : m.pattern.flags + 'g');
    for (const hit of text.matchAll(re)) {
      const start = Math.max(0, (hit.index ?? 0) - 6);
      const context = text.slice(start, (hit.index ?? 0) + hit[0].length);
      if (!NEGATION.test(context)) return true;
    }
    return false;
  });
}
