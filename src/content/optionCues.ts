/**
 * 選項「猜題線索」統計：不看題目內容、只看選項文字就能猜中答案的程度。
 *
 * 背景：交叉稽核（docs/CLAUDE_FULL_AUDIT_17e9cdc.md A1、A2）發現正確選項幾乎都是最長的選項，
 * 每題選最長即可得 81.0%，練習與模考成績會高估真實程度。改寫題目時用這裡的指標監測進度。
 *
 * 注意：指標降低只代表「少了一種猜題線索」，不代表題目效度合格；內容仍需人工審閱。
 */
export interface CueQuestion {
  id: string;
  subject: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  reviewStatus?: string;
  verification?: unknown;
}

const len = (s: string) => [...s].length;

/** 絕對字眼：常見的「錯誤選項」寫法；正確選項很少使用，因此成為猜題線索 */
export const ABSOLUTE_WORDS = /一定|絕對|永遠|完全|所有|只要|必定|只能/;

/** 正確選項長度 ÷ 錯誤選項平均長度 */
export function lengthRatio(q: CueQuestion): number {
  const L = q.options.map((o) => len(o.text));
  const i = q.options.findIndex((o) => q.correctOptionIds.includes(o.id));
  const others = L.filter((_, k) => k !== i);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  return avg ? L[i] / avg : 1;
}

/** 正確選項是唯一最長的選項 */
export function isStrictlyLongest(q: CueQuestion): boolean {
  const L = q.options.map((o) => len(o.text));
  const i = q.options.findIndex((o) => q.correctOptionIds.includes(o.id));
  return L.every((v, k) => k === i || v < L[i]);
}

/** 「每題選最長」策略的期望得分：並列最長時視為在並列者中隨機選一個 */
export function longestStrategyScore(q: CueQuestion): number {
  const L = q.options.map((o) => len(o.text));
  const max = Math.max(...L);
  const tied = q.options.filter((_, k) => L[k] === max);
  return tied.some((o) => q.correctOptionIds.includes(o.id)) ? 1 / tied.length : 0;
}

/**
 * 「每題選第 k 長」策略的期望得分（k = 1 最長 … 4 最短）。
 * 依長度由長到短排序，並列的選項共享它們涵蓋的名次：若某組並列者佔第 a～b 名且 a ≤ k ≤ b，
 * 視為在該組中隨機選一個。k = 1 時與 longestStrategyScore 相同。
 */
export function rankStrategyScore(q: CueQuestion, k: number): number {
  const L = q.options.map((o) => len(o.text));
  const sorted = [...L].sort((a, b) => b - a);
  const target = sorted[k - 1];
  if (target === undefined) return 0;
  const tied = q.options.filter((_, i) => L[i] === target);
  return tied.some((o) => q.correctOptionIds.includes(o.id)) ? 1 / tied.length : 0;
}

/**
 * A2「排除絕對字眼」策略：先刪掉含絕對字眼的選項，在剩下的選項中隨機選一個（全部都含時在四個中隨機選）。
 * thenLongest = true 時改為在剩下的選項中選最長（並列時隨機），模擬兩種線索合用。
 */
export function absoluteEliminationScore(q: CueQuestion, thenLongest = false): number {
  const keep = q.options.filter((o) => !ABSOLUTE_WORDS.test(o.text));
  let pool = keep.length ? keep : q.options;
  if (thenLongest) {
    const max = Math.max(...pool.map((o) => len(o.text)));
    pool = pool.filter((o) => len(o.text) === max);
  }
  return pool.some((o) => q.correctOptionIds.includes(o.id)) ? 1 / pool.length : 0;
}

export interface CueSummary {
  total: number;
  strictlyLongestPct: number;
  avgLengthRatio: number;
  /** 每題選最長的期望得分（%） */
  longestStrategyPct: number;
  /** 長度比 ≥ 2 的題數 */
  ratioAtLeast2: number;
  absoluteInDistractors: number;
  absoluteInCorrect: number;
  /** 排除含絕對字眼的選項後隨機選的期望得分（%） */
  absoluteEliminationPct: number;
  /** 排除含絕對字眼的選項後選最長的期望得分（%） */
  absoluteThenLongestPct: number;
  /** 正確選項的長度名次分布（1 = 最長；並列時算較前的名次）。理想是四個名次大致平均 */
  lengthRank: Record<1 | 2 | 3 | 4, number>;
  /** 每題選第 k 長的期望得分（%）；四者都應接近 25%，避免「選第二長」等新線索 */
  rankStrategyPct: Record<1 | 2 | 3 | 4, number>;
  bySubject: Record<string, { total: number; longestStrategyPct: number; secondStrategyPct: number }>;
}

export function summarizeCues(questions: CueQuestion[]): CueSummary {
  const qs = questions.filter((q) => q.reviewStatus !== 'retired' && q.reviewStatus !== 'draft');
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const bySubject: CueSummary['bySubject'] = {};
  let strict = 0,
    ratio = 0,
    longest = 0,
    r2 = 0,
    absD = 0,
    absC = 0;
  const lengthRank: CueSummary['lengthRank'] = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const rankSum: CueSummary['rankStrategyPct'] = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let absElim = 0,
    absLongest = 0;
  for (const q of qs) {
    absElim += absoluteEliminationScore(q);
    absLongest += absoluteEliminationScore(q, true);
    for (const k of [1, 2, 3, 4] as const) rankSum[k] += rankStrategyScore(q, k);
    if (isStrictlyLongest(q)) strict++;
    const r = lengthRatio(q);
    ratio += r;
    if (r >= 2) r2++;
    const s = longestStrategyScore(q);
    longest += s;
    (bySubject[q.subject] ??= { total: 0, longestStrategyPct: 0, secondStrategyPct: 0 }).total++;
    bySubject[q.subject].longestStrategyPct += s;
    bySubject[q.subject].secondStrategyPct += rankStrategyScore(q, 2);
    if (q.options.some((o) => !q.correctOptionIds.includes(o.id) && ABSOLUTE_WORDS.test(o.text))) absD++;
    if (q.options.some((o) => q.correctOptionIds.includes(o.id) && ABSOLUTE_WORDS.test(o.text))) absC++;
    const L = q.options.map((o) => len(o.text));
    const ci = q.options.findIndex((o) => q.correctOptionIds.includes(o.id));
    const rank = Math.min(4, 1 + L.filter((v) => v > L[ci]).length) as 1 | 2 | 3 | 4;
    lengthRank[rank]++;
  }
  for (const v of Object.values(bySubject)) {
    v.longestStrategyPct = pct(v.longestStrategyPct, v.total);
    v.secondStrategyPct = pct(v.secondStrategyPct, v.total);
  }
  const rankStrategyPct: CueSummary['rankStrategyPct'] = {
    1: pct(rankSum[1], qs.length),
    2: pct(rankSum[2], qs.length),
    3: pct(rankSum[3], qs.length),
    4: pct(rankSum[4], qs.length),
  };
  return {
    total: qs.length,
    strictlyLongestPct: pct(strict, qs.length),
    avgLengthRatio: qs.length ? Math.round((ratio / qs.length) * 100) / 100 : 0,
    longestStrategyPct: pct(longest, qs.length),
    ratioAtLeast2: r2,
    absoluteInDistractors: absD,
    absoluteInCorrect: absC,
    absoluteEliminationPct: pct(absElim, qs.length),
    absoluteThenLongestPct: pct(absLongest, qs.length),
    lengthRank,
    rankStrategyPct,
    bySubject,
  };
}
