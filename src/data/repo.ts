/**
 * 資料存取：所有寫入 IndexedDB 的操作集中於此，元件不直接操作資料表。
 */
import { getCompetency, getQuestion } from '../content';
import type { Level, SubjectCode } from '../content/schema';
import { applyAttempt, reschedule } from '../lib/review';
import { isCorrect, scoreSession } from '../lib/scoring';
import { db, defaultSettings } from './db';
import type { AnswerAttempt, MistakeReason, QuizMode, QuizSession, TutorLog, UserSettings } from './types';
import { recordedDuration } from '../lib/timer';

const nowIso = () => new Date().toISOString();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- 設定 ---------- */
export async function getSettings(): Promise<UserSettings> {
  return (await db.settings.get('user')) ?? defaultSettings();
}
export async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  // 讀取與寫入放在同一個交易中：連續快速變更（例如先切深色再切高對比）時，避免後一筆以舊資料覆寫前一筆
  await db.transaction('rw', db.settings, async () => {
    const cur = await getSettings();
    await db.settings.put({ ...cur, ...patch, id: 'user', updatedAt: nowIso() });
  });
}

/**
 * 只更新每日分鐘的其中一欄（或對調）：在同一個交易中讀取目前值再合併。
 * 畫面上的設定值可能還是舊的，若以畫面值展開整個 dailyMinutes，快速連續修改兩欄時，後一筆會把前一筆蓋回去。
 */
export async function updateDailyMinutes(patch: Partial<UserSettings['dailyMinutes']> | 'normalize'): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = await getSettings();
    let next = { ...cur.dailyMinutes, ...(patch === 'normalize' ? {} : patch) };
    if (patch === 'normalize' && next.min > next.max) next = { min: next.max, max: next.min };
    await db.settings.put({ ...cur, dailyMinutes: next, id: 'user', updatedAt: nowIso() });
  });
}

/* ---------- 講義進度 ---------- */
export async function touchLesson(code: string, level: Level): Promise<void> {
  const cur = await db.lessonProgress.get(code);
  await db.lessonProgress.put({
    code,
    level,
    visitedAt: nowIso(),
    completedAt: cur?.completedAt ?? null,
    lastPosition: cur?.lastPosition ?? null,
    timeSpentSec: cur?.timeSpentSec ?? 0,
  });
}
export async function saveLessonPosition(code: string, anchor: string | null): Promise<void> {
  await db.lessonProgress.update(code, { lastPosition: anchor, visitedAt: nowIso() });
}
/** 累加講義閱讀時間，並記到當天（本地日期）的每日紀錄，供本週／本月統計使用 */
export async function addLessonTime(code: string, seconds: number, now = new Date()): Promise<void> {
  const sec = Math.round(seconds);
  if (sec <= 0) return;
  await db.transaction('rw', [db.lessonProgress, db.studyTime], async () => {
    const cur = await db.lessonProgress.get(code);
    if (!cur) return;
    await db.lessonProgress.update(code, { timeSpentSec: cur.timeSpentSec + sec });
    const date = localDateKey(now);
    const key = `${date}|${code}`;
    const log = await db.studyTime.get(key);
    await db.studyTime.put({ key, date, code, level: cur.level, seconds: (log?.seconds ?? 0) + sec });
  });
}

/** 本地日期 YYYY-MM-DD */
export function localDateKey(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}
export async function setLessonCompleted(code: string, level: Level, completed: boolean): Promise<void> {
  const cur = await db.lessonProgress.get(code);
  await db.lessonProgress.put({
    code,
    level,
    visitedAt: cur?.visitedAt ?? nowIso(),
    lastPosition: cur?.lastPosition ?? null,
    timeSpentSec: cur?.timeSpentSec ?? 0,
    completedAt: completed ? nowIso() : null,
  });
}

/* ---------- 測驗 ---------- */
export async function createSession(input: {
  level: Level;
  mode: QuizMode;
  subject: SubjectCode | null;
  scopeLabel: string;
  competencyCodes: string[];
  questionIds: string[];
  timeLimitSec?: number | null;
  unseenOnly?: boolean;
}): Promise<string> {
  if (input.questionIds.length === 0) throw new Error('沒有可用題目，無法建立測驗');
  const sessionId = newId();
  await db.quizSessions.put({
    sessionId,
    level: input.level,
    mode: input.mode,
    subject: input.subject,
    scopeLabel: input.scopeLabel,
    competencyCodes: input.competencyCodes,
    questionIds: input.questionIds,
    answers: {},
    revealed: [],
    flagged: [],
    currentIndex: 0,
    startAt: nowIso(),
    submittedAt: null,
    durationSec: 0,
    timeLimitSec: input.timeLimitSec ?? null,
    ...(input.unseenOnly ? { unseenOnly: true } : {}),
    rawScore: null,
    validCount: null,
  });
  return sessionId;
}

/**
 * 更新未交卷測驗的進度（作答位置、標記、計時）。
 * 已交卷的測驗不再接受更新：頁面卸載時的計時寫回可能晚於交卷，不可覆寫交卷時記錄的作答時間。
 * 限時測驗的作答時間一律不超過時間上限。
 */
export async function patchSession(sessionId: string, patch: Partial<QuizSession>): Promise<void> {
  await db.transaction('rw', db.quizSessions, async () => {
    const s = await db.quizSessions.get(sessionId);
    if (!s || s.submittedAt) return;
    const next = { ...patch };
    if (next.durationSec !== undefined) next.durationSec = recordedDuration(next.durationSec, s.timeLimitSec);
    await db.quizSessions.update(sessionId, next);
  });
}

export async function setAnswer(sessionId: string, questionId: string, selected: string[]): Promise<void> {
  await db.transaction('rw', db.quizSessions, async () => {
    const s = await db.quizSessions.get(sessionId);
    if (!s || s.submittedAt || s.revealed.includes(questionId)) return; // 已交卷／已提交的題目不可再改
    await db.quizSessions.update(sessionId, { answers: { ...s.answers, [questionId]: selected } });
  });
}

async function recordAttempt(s: QuizSession, questionId: string, selected: string[], timeMs: number): Promise<AnswerAttempt | null> {
  const q = getQuestion(questionId);
  if (!q) return null;
  const attempt: AnswerAttempt = {
    questionId,
    sessionId: s.sessionId,
    level: q.level,
    subject: q.subject,
    competencyCode: q.competencyCode,
    mode: s.mode,
    selectedIds: selected,
    correct: isCorrect(q, selected),
    timeMs,
    answeredAt: nowIso(),
  };
  await db.attempts.add(attempt);
  const settings = await getSettings();
  const item = await db.reviewItems.get(questionId);
  const next = applyAttempt(item, attempt, settings.reviewIntervals);
  if (next) await db.reviewItems.put(next);
  return attempt;
}

/**
 * 練習模式：提交單題並顯示解析。具冪等性，重複點擊不會重複記錄。
 */
export async function revealQuestion(sessionId: string, questionId: string, timeMs: number): Promise<boolean> {
  return db.transaction('rw', [db.quizSessions, db.attempts, db.reviewItems, db.settings], async () => {
    const s = await db.quizSessions.get(sessionId);
    if (!s || s.submittedAt || s.revealed.includes(questionId)) return false;
    const selected = s.answers[questionId] ?? [];
    if (!selected.length) return false;
    await db.quizSessions.update(sessionId, { revealed: [...s.revealed, questionId] });
    await recordAttempt(s, questionId, selected, timeMs);
    return true;
  });
}

/**
 * 交卷：計分並把尚未記錄的題目寫入作答紀錄。具冪等性（重複呼叫只會計一次）。
 * 未作答題目不寫入作答紀錄、不列入錯題本，但在分數中以不得分計並於結果頁說明。
 */
export async function submitSession(sessionId: string, elapsedSec: number): Promise<QuizSession | undefined> {
  return db.transaction('rw', [db.quizSessions, db.attempts, db.reviewItems, db.settings], async () => {
    const s = await db.quizSessions.get(sessionId);
    if (!s) return undefined;
    if (s.submittedAt) return s;
    const avgMs = s.questionIds.length ? Math.round((elapsedSec * 1000) / s.questionIds.length) : 0;
    for (const id of s.questionIds) {
      if (s.revealed.includes(id)) continue;
      const sel = s.answers[id];
      if (sel && sel.length) await recordAttempt(s, id, sel, avgMs);
    }
    const summary = scoreSession(s.questionIds, s.answers, getQuestion);
    const patch: Partial<QuizSession> = {
      submittedAt: nowIso(),
      // 限時模考的作答時間不超過時間上限（逾時後才回到頁面，離開的時間不算作答時間）
      durationSec: recordedDuration(Math.max(s.durationSec, Math.round(elapsedSec)), s.timeLimitSec),
      rawScore: summary.correct,
      validCount: summary.total,
    };
    await db.quizSessions.update(sessionId, patch);
    return { ...s, ...patch };
  });
}

export async function discardSession(sessionId: string): Promise<void> {
  const s = await db.quizSessions.get(sessionId);
  if (s && !s.submittedAt) await db.quizSessions.delete(sessionId);
}

export async function latestUnfinished(level: Level): Promise<QuizSession | undefined> {
  const list = await db.quizSessions.where('level').equals(level).toArray();
  return list.filter((s) => !s.submittedAt).sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
}

/* ---------- 錯題 ---------- */
export async function setMistakeReason(questionId: string, reason: MistakeReason): Promise<void> {
  await db.reviewItems.update(questionId, { reason });
}
export async function rescheduleReview(questionId: string, days: number): Promise<void> {
  const item = await db.reviewItems.get(questionId);
  if (item) await db.reviewItems.put(reschedule(item, days));
}
/** 一鍵加入錯題（例如答對但沒把握） */
export async function addToReview(questionId: string): Promise<void> {
  const q = getQuestion(questionId);
  if (!q || (await db.reviewItems.get(questionId))) return;
  const now = nowIso();
  const settings = await getSettings();
  await db.reviewItems.put({
    questionId,
    level: q.level,
    subject: q.subject,
    competencyCode: q.competencyCode,
    mistakeCount: 0,
    correctStreak: 0,
    intervalDays: settings.reviewIntervals[0] ?? 1,
    nextDueAt: now,
    masteryStatus: 'unresolved',
    reason: 'unknown',
    firstWrongAt: now,
    lastWrongAt: now,
    lastAnsweredAt: now,
  });
}

/* ---------- 清除 ---------- */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.settings, db.lessonProgress, db.quizSessions, db.attempts, db.reviewItems, db.tutorLogs, db.studyTime], async () => {
    await Promise.all([db.settings.clear(), db.lessonProgress.clear(), db.quizSessions.clear(), db.attempts.clear(), db.reviewItems.clear(), db.tutorLogs.clear(), db.studyTime.clear()]);
  });
}

export function scopeLabelFor(codes: string[]): string {
  if (codes.length === 1) {
    const c = getCompetency(codes[0]);
    return c ? `${c.code} ${c.name}` : codes[0];
  }
  return codes.join('、');
}

/* ---------- AI 導師 ---------- */

/**
 * 記錄導師補強題的作答（不屬於任何測驗），並依結果更新錯題排程：
 * - 補強題答錯：補強題本身收錄錯題本，原題排程改為今天到期，提醒立即複習。
 * - 補強題答對：維持原題排程（仍需在到期日答對才累計，不會因補強題而直接「已掌握」）。
 */
export async function recordTutorAttempt(input: {
  originalQuestionId: string;
  questionId: string;
  selected: string[];
  timeMs: number;
  /** 這一次顯示的補強題識別碼；同一個識別碼只記錄一次（防止連點重複記錄） */
  attemptKey?: string;
}): Promise<{ correct: boolean } | null> {
  const q = getQuestion(input.questionId);
  if (!q || !input.selected.length) return null;
  const sessionId = input.attemptKey ? `tutor:${input.originalQuestionId}:${input.attemptKey}` : `tutor:${input.originalQuestionId}`;
  return db.transaction('rw', [db.attempts, db.reviewItems, db.settings], async () => {
    if (input.attemptKey) {
      const prev = await db.attempts.where('sessionId').equals(sessionId).filter((a) => a.questionId === q.id).first();
      if (prev) return { correct: prev.correct };
    }
    const attempt: AnswerAttempt = {
      questionId: q.id,
      sessionId,
      level: q.level,
      subject: q.subject,
      competencyCode: q.competencyCode,
      mode: 'tutor',
      selectedIds: input.selected,
      correct: isCorrect(q, input.selected),
      timeMs: input.timeMs,
      answeredAt: nowIso(),
    };
    await db.attempts.add(attempt);
    const settings = await getSettings();
    const next = applyAttempt(await db.reviewItems.get(q.id), attempt, settings.reviewIntervals);
    if (next) await db.reviewItems.put(next);
    if (!attempt.correct) {
      const orig = await db.reviewItems.get(input.originalQuestionId);
      if (orig && orig.masteryStatus !== 'mastered') await db.reviewItems.put(reschedule(orig, 0));
    }
    return { correct: attempt.correct };
  });
}

export async function logTutor(log: Omit<TutorLog, 'id' | 'at'>): Promise<void> {
  await db.tutorLogs.add({ ...log, at: nowIso() });
}
