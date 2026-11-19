type Answerable = { correctOptionIds: readonly string[] };

export function isCorrect(q: Answerable, selected: string[] | undefined): boolean {
  if (!selected || selected.length === 0) return false;
  const a = [...new Set(selected)].sort();
  const b = [...q.correctOptionIds].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export interface ScoreSummary {
  /** 題庫中仍存在的有效題數（被移除的題目不計入分母） */
  total: number;
  answered: number;
  unanswered: number;
  correct: number;
  wrong: number;
  /** 得分：答對 / 有效題數 × 100（未作答以不得分計） */
  scorePct: number;
  /** 作答正確率：答對 / 已作答 × 100；未作答時為 null */
  accuracyPct: number | null;
  missingQuestionIds: string[];
}

export function scoreSession(
  questionIds: string[],
  answers: Record<string, string[]>,
  lookup: (id: string) => Answerable | undefined,
): ScoreSummary {
  let total = 0,
    answered = 0,
    correct = 0;
  const missing: string[] = [];
  for (const id of questionIds) {
    const q = lookup(id);
    if (!q) {
      missing.push(id);
      continue;
    }
    total++;
    const sel = answers[id];
    if (sel && sel.length) {
      answered++;
      if (isCorrect(q, sel)) correct++;
    }
  }
  return {
    total,
    answered,
    unanswered: total - answered,
    correct,
    wrong: answered - correct,
    scorePct: total ? Math.round((correct / total) * 1000) / 10 : 0,
    accuracyPct: answered ? Math.round((correct / answered) * 1000) / 10 : null,
    missingQuestionIds: missing,
  };
}

/** 正確率；樣本不足時回傳 null */
export function accuracy(correct: number, total: number, minSample = 1): number | null {
  if (total < minSample || total === 0) return null;
  return Math.round((correct / total) * 1000) / 10;
}
