import type { Question } from '../content/schema';

/**
 * 選項顯示順序：每次出題都把選項打亂，畫面上的 A～D 依「顯示位置」標示。
 * - 作答、計分、錯題本與備份一律記錄題庫裡的原始選項 ID，打亂只影響畫面，舊紀錄不受影響。
 * - 同一題正確答案的顯示位置一定和「上一次看到的位置」不同（第一次出題時，和題庫原始位置不同），
 *   避免記住字母、或全部猜同一個字母就能得分。
 */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

type OptQuestion = Pick<Question, 'options' | 'correctOptionIds'>;

/** 第 i 個顯示位置的代號 */
export function letterAt(i: number): string {
  return OPTION_LETTERS[i] ?? String(i + 1);
}

/** 檢查 order 是否恰好是本題選項 ID 的一種排列；不是就退回題庫原始順序（例如舊資料或損毀的備份） */
export function orderFor(q: Pick<Question, 'options'>, order?: readonly string[] | null): string[] {
  const ids: string[] = q.options.map((o) => o.id);
  if (order && order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id))) return [...order];
  return ids;
}

/** 依顯示順序排好的選項，附上畫面代號 */
export function displayOptions<T extends OptQuestion>(q: T, order?: readonly string[] | null): { option: T['options'][number]; letter: string }[] {
  const byId = new Map<string, T['options'][number]>(q.options.map((o) => [o.id, o]));
  return orderFor(q, order).map((id, i) => ({ option: byId.get(id)!, letter: letterAt(i) }));
}

/** 原始選項 ID → 畫面代號（依顯示順序排序，例如「B、D」） */
export function lettersOf(q: Pick<Question, 'options'>, order: readonly string[] | null | undefined, ids: readonly string[]): string[] {
  const o = orderFor(q, order);
  return ids
    .map((id) => o.indexOf(id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
    .map(letterAt);
}

function correctPositions(order: readonly string[], correct: readonly string[]): string {
  return order
    .map((id, i) => (correct.includes(id) ? i : -1))
    .filter((i) => i >= 0)
    .join(',');
}

/**
 * 產生新的顯示順序。previous 是這題上一次的顯示順序（沒有就用題庫原始順序），
 * 新順序的正確答案位置必須和 previous 不同，因此順序也必然不同。
 */
export function shuffleOrder(q: OptQuestion, previous?: readonly string[] | null, random: () => number = Math.random): string[] {
  const ids: string[] = q.options.map((o) => o.id);
  if (ids.length < 2) return ids;
  const prev = orderFor(q, previous);
  const prevPos = correctPositions(prev, q.correctOptionIds);
  for (let attempt = 0; attempt < 30; attempt++) {
    const next = [...ids];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (correctPositions(next, q.correctOptionIds) !== prevPos) return next;
  }
  // 亂數一直撞到同一位置（機率極低，或測試用的固定亂數）：把上一次的順序整體平移一格，正確答案必然換位置
  return [...prev.slice(1), prev[0]];
}
