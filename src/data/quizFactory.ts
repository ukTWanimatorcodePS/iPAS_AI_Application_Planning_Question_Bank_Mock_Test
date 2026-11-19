import { questionsFor, getReleasedQuestion } from '../content';
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

/**
 * 已看過答案或解析的題目（驗證測驗要排除）：
 * - 有作答紀錄的題目
 * - 練習模式中已顯示解析的題目（revealed）
 * - 已交卷測驗中的所有題目：結果頁會顯示每題解析，包含交白卷、未作答的題目
 * - AI 導師中已提交的補強題
 * 未交卷的測驗模式題目尚未顯示答案，不算看過。
 */
export async function exposedQuestionIds(level: Level): Promise<Set<string>> {
  const [attempts, sessions, tutorLogs] = await Promise.all([
    db.attempts.where('level').equals(level).toArray(),
    db.quizSessions.where('level').equals(level).toArray(),
    db.tutorLogs.where('level').equals(level).toArray(),
  ]);
  const seen = new Set(attempts.map((a) => a.questionId));
  for (const s of sessions) {
    s.revealed.forEach((id) => seen.add(id));
    if (s.submittedAt) s.questionIds.forEach((id) => seen.add(id));
  }
  for (const t of tutorLogs) if (t.reinforcementQuestionId && t.reinforcementCorrect !== null) seen.add(t.reinforcementQuestionId);
  return seen;
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
  /** 只出從未看過答案或解析的題目（驗證測驗：確認真的懂，而不是記住答案） */
  unseenOnly?: boolean;
}): Promise<StartResult> {
  let pool = questionsFor({ level: opts.level });
  if (opts.competencyCodes?.length) pool = pool.filter((q) => opts.competencyCodes!.includes(q.competencyCode));
  if (opts.subjects?.length) pool = pool.filter((q) => opts.subjects!.includes(q.subject));
  if (opts.origins?.length) pool = pool.filter((q) => opts.origins!.includes(q.origin));
  if (pool.length === 0) return { ok: false, message: '本範圍尚無可用題目。請先回講義閱讀，或選擇其他單元。' };

  const { attempted, wrong } = await history(opts.level);
  if (opts.unseenOnly) {
    const exposed = await exposedQuestionIds(opts.level);
    pool = pool.filter((q) => !exposed.has(q.id));
    if (pool.length === 0)
      return { ok: false, message: '本範圍的題目你都已經作答過或看過解析，沒有可用於驗證的新題目。可改用錯題重測，或到其他單元練習。' };
  }
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
  // 只出仍釋出且屬於本級別的題目；停用（retired）的題目保留歷史紀錄，但不再出題
  ids = ids.filter((id) => getReleasedQuestion(id)?.level === level);
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
