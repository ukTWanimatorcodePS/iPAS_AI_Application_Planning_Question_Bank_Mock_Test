import { questionsFor, getQuestion } from '../content';
import type { Level, Question, SubjectCode } from '../content/schema';
import { buildQuiz } from '../lib/quizBuilder';
import { isDue } from '../lib/review';
import { db } from './db';
import { createSession, scopeLabelFor } from './repo';
import type { QuizMode } from './types';

export type StartResult = { ok: true; sessionId: string; shortfall: number; count: number } | { ok: false; message: string };

async function history(level: Level) {
  const attempts = await db.attempts.where('level').equals(level).toArray();
  const attempted = new Set(attempts.map((a) => a.questionId));
  const reviews = await db.reviewItems.where('level').equals(level).toArray();
  const wrong = new Set(reviews.filter((r) => r.masteryStatus !== 'mastered').map((r) => r.questionId));
  return { attempted, wrong };
}

export async function startQuiz(opts: {
  level: Level;
  mode: QuizMode;
  count: number;
  competencyCodes?: string[];
  subjects?: SubjectCode[];
  origins?: Question['origin'][];
  scopeLabel?: string;
  timeLimitSec?: number | null;
}): Promise<StartResult> {
  let pool = questionsFor({ level: opts.level });
  if (opts.competencyCodes?.length) pool = pool.filter((q) => opts.competencyCodes!.includes(q.competencyCode));
  if (opts.subjects?.length) pool = pool.filter((q) => opts.subjects!.includes(q.subject));
  if (opts.origins?.length) pool = pool.filter((q) => opts.origins!.includes(q.origin));
  if (pool.length === 0) return { ok: false, message: '本範圍尚無可用題目。請先回講義閱讀，或選擇其他單元。' };

  const { attempted, wrong } = await history(opts.level);
  const built = buildQuiz(pool, opts.count, { attemptedIds: attempted, wrongIds: wrong });
  const subject = opts.subjects?.length === 1 ? opts.subjects[0] : opts.competencyCodes?.length ? (pool[0].subject as SubjectCode) : null;
  const sessionId = await createSession({
    level: opts.level,
    mode: opts.mode,
    subject: opts.subjects && opts.subjects.length > 1 ? null : subject,
    scopeLabel: opts.scopeLabel ?? scopeLabelFor(opts.competencyCodes ?? []),
    competencyCodes: opts.competencyCodes ?? [],
    questionIds: built.questionIds,
    timeLimitSec: opts.timeLimitSec ?? null,
  });
  return { ok: true, sessionId, shortfall: built.shortfall, count: built.questionIds.length };
}

/** 錯題重測：預設只出到期與尚未訂正的題目 */
export async function startReviewQuiz(level: Level, questionIds?: string[]): Promise<StartResult> {
  let ids = questionIds;
  if (!ids) {
    const items = await db.reviewItems.where('level').equals(level).toArray();
    ids = items.filter((r) => r.masteryStatus === 'unresolved' || isDue(r)).map((r) => r.questionId);
  }
  ids = ids.filter((id) => getQuestion(id));
  if (!ids.length) return { ok: false, message: '目前沒有到期或待訂正的錯題。' };
  const sessionId = await createSession({
    level,
    mode: 'review',
    subject: null,
    scopeLabel: `錯題重測（${ids.length} 題）`,
    competencyCodes: [],
    questionIds: ids.slice(0, 30),
  });
  return { ok: true, sessionId, shortfall: 0, count: Math.min(30, ids.length) };
}
