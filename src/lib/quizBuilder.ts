import type { Question } from '../content/schema';

export interface BuildResult {
  questionIds: string[];
  /** 要求題數 − 實際可用題數；> 0 代表題量不足 */
  shortfall: number;
  available: number;
}

/** 可注入亂數，方便測試 */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 依實際題庫組卷：不重複、不補假題。
 * 優先順序：未作答過 → 曾答錯 → 其他已作答過。
 */
export function buildQuiz(
  pool: Question[],
  count: number,
  opts: { attemptedIds?: Set<string>; wrongIds?: Set<string>; rand?: () => number } = {},
): BuildResult {
  const rand = opts.rand ?? Math.random;
  const attempted = opts.attemptedIds ?? new Set<string>();
  const wrong = opts.wrongIds ?? new Set<string>();
  const unique = [...new Map(pool.map((q) => [q.id, q])).values()];
  const unseen = shuffle(unique.filter((q) => !attempted.has(q.id)), rand);
  const wrongOnes = shuffle(unique.filter((q) => attempted.has(q.id) && wrong.has(q.id)), rand);
  const rest = shuffle(unique.filter((q) => attempted.has(q.id) && !wrong.has(q.id)), rand);
  const ordered = [...unseen, ...wrongOnes, ...rest];
  const n = Math.max(0, Math.min(count, ordered.length));
  return { questionIds: ordered.slice(0, n).map((q) => q.id), shortfall: Math.max(0, count - unique.length), available: unique.length };
}
