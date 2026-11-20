/**
 * 進度備份：匯出 / 匯入 JSON。
 * 匯入資料一律視為不可信：限制大小、以 Zod 嚴格驗證、未知欄位會被丟棄，驗證失敗不寫入任何資料。
 */
import { z } from 'zod';
import { getQuestion } from '../content';
import { parseLocalDate } from '../lib/studyPlan';
import { db, defaultSettings, rebuildLastOptionOrders } from './db';
import { isVerifySession, type AnswerAttempt, type LastOptionOrder, type QuizSession } from './types';

export const BACKUP_APP_ID = 'ipas-ai-prep';
/**
 * v1：第一階段；v2：新增 tutorLogs、settings.examDate；v3：新增 studyTime（講義閱讀時間每日紀錄）。匯入時各版皆接受，缺少的欄位補預設值。
 * v1.1.0 起 v3 另有選填欄位 quizSessions[].optionOrders、attempts[].optionOrder、data.lastOptionOrders；
 * 舊程式匯入時會忽略未知欄位，因此格式版本維持 3。
 */
export const BACKUP_SCHEMA_VERSION = 3;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

const iso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), '日期格式錯誤');
const isoOrNull = iso.nullable();
const level = z.enum(['junior', 'middle']);
const subject = z.enum(['L11', 'L12', 'L21', 'L22', 'L23']);
const shortStr = z.string().max(200);
const code = z.string().regex(/^L[12]\d{4}$/);
const qid = z.string().max(80).regex(/^[A-Za-z0-9-]+$/);
const optId = z.string().regex(/^[A-E]$/);
const mode = z.enum(['practice', 'test', 'mock', 'review', 'tutor']);

/** 考試日期：null 或真實存在的 YYYY-MM-DD 日期 */
const examDateValue = z
  .string()
  .max(10)
  .nullable()
  .refine((v) => v === null || parseLocalDate(v) !== null, '考試日期需為有效的 YYYY-MM-DD 日期');

const settingsSchema = z.object({
  id: z.literal('user'),
  level,
  track: z.enum(['data', 'ml', 'both']),
  studyGoal: z.object({ junior: shortStr, middle: shortStr }),
  restDays: z.array(z.number().int().min(0).max(6)).max(7),
  dailyMinutes: z.object({ min: z.number().min(0).max(1440), max: z.number().min(0).max(1440) }),
  theme: z.enum(['light', 'dark', 'system']),
  highContrast: z.boolean(),
  fontScale: z.number().min(0.8).max(1.5),
  passThreshold: z.number().min(0).max(100),
  reviewIntervals: z.array(z.number().int().min(1).max(365)).min(1).max(10),
  onboarded: z.boolean(),
  examDate: z
    .object({ junior: examDateValue, middle: examDateValue })
    .default({ junior: null, middle: null }),
  tutorProvider: z.enum(['mock', 'remote']).default('mock'),
  updatedAt: iso,
});

const lessonSchema = z.object({
  code,
  level,
  visitedAt: iso,
  completedAt: isoOrNull,
  lastPosition: z.string().max(120).nullable(),
  timeSpentSec: z.number().min(0).max(10_000_000),
});

const sessionSchema = z.object({
  sessionId: z.string().max(80),
  level,
  mode,
  subject: subject.nullable(),
  scopeLabel: shortStr,
  competencyCodes: z.array(code).max(100),
  questionIds: z.array(qid).max(500),
  answers: z.record(qid, z.array(optId).max(5)),
  revealed: z.array(qid).max(500),
  flagged: z.array(qid).max(500),
  currentIndex: z.number().int().min(0).max(500),
  startAt: iso,
  submittedAt: isoOrNull,
  durationSec: z.number().min(0).max(10_000_000),
  timeLimitSec: z.number().min(0).max(100_000).nullable(),
  rawScore: z.number().int().min(0).nullable(),
  validCount: z.number().int().min(0).nullable(),
  unseenOnly: z.boolean().optional(),
  // v1.1.0 起：每題選項顯示順序（選填；舊備份沒有，顯示時退回題庫原始順序）
  optionOrders: z.record(qid, z.array(optId).max(6)).optional(),
})
  // 舊備份的驗證測驗沒有 unseenOnly：依標題補上，避免還原後「再做一次」出現已看過的題目
  .transform((s) => (s.unseenOnly === undefined && isVerifySession(s) ? { ...s, unseenOnly: true } : s));

const attemptSchema = z.object({
  questionId: qid,
  sessionId: z.string().max(80),
  level,
  subject,
  competencyCode: code,
  mode,
  selectedIds: z.array(optId).max(5),
  correct: z.boolean(),
  timeMs: z.number().min(0).max(100_000_000),
  answeredAt: iso,
  optionOrder: z.array(optId).max(6).optional(),
});

const reviewSchema = z.object({
  questionId: qid,
  level,
  subject,
  competencyCode: code,
  mistakeCount: z.number().int().min(0).max(100_000),
  correctStreak: z.number().int().min(0).max(100),
  intervalDays: z.number().min(0).max(365),
  nextDueAt: isoOrNull,
  masteryStatus: z.enum(['unresolved', 'reviewing', 'mastered']),
  reason: z.enum(['concept', 'careless', 'misread', 'not-learned', 'unknown']),
  firstWrongAt: iso,
  lastWrongAt: iso,
  lastAnsweredAt: iso,
});

const tutorLogSchema = z.object({
  questionId: qid,
  competencyCode: code,
  level,
  provider: z.enum(['mock', 'remote']),
  modes: z.array(z.enum(['simple', 'detailed', 'example', 'compare', 'another'])).max(20),
  reinforcementQuestionId: qid.nullable(),
  reinforcementCorrect: z.boolean().nullable(),
  at: iso,
});

const studyTimeSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    code,
    level,
    seconds: z.number().int().min(0).max(86_400),
  })
  .transform((t) => ({ ...t, key: `${t.date}|${t.code}` }));

/** 每題上一次實際顯示的選項順序（v1.1.0，IndexedDB v4）。還原時再逐題確認是本題選項的排列 */
const lastOptionOrderSchema = z.object({
  questionId: qid,
  order: z.array(optId).min(1).max(6),
});

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.number().int().min(1).max(BACKUP_SCHEMA_VERSION),
  exportedAt: iso,
  data: z.object({
    settings: settingsSchema.nullable(),
    lessonProgress: z.array(lessonSchema).max(1000),
    quizSessions: z.array(sessionSchema).max(20_000),
    attempts: z.array(attemptSchema).max(200_000),
    reviewItems: z.array(reviewSchema).max(20_000),
    tutorLogs: z.array(tutorLogSchema).max(50_000).default([]),
    studyTime: z.array(studyTimeSchema).max(100_000).default([]),
    // 選填：v1.1.0 起匯出。舊備份沒有這個欄位時，還原改由測驗與作答紀錄盡力重建
    lastOptionOrders: z.array(lastOptionOrderSchema).max(20_000).optional(),
  }).superRefine((d, ctx) => {
    // 主鍵不可重複：還原時後一筆會靜默覆寫前一筆，使用者無從得知資料被丟棄，因此在清除本機資料前就拒絕。
    // attempts 是同一題的多次作答，本來就可以重複，不檢查
    const unique = (name: keyof typeof d, keys: string[]) => {
      const seen = new Set<string>();
      keys.forEach((k, i) => {
        if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [name, i], message: `重複的紀錄（${k}）` });
        seen.add(k);
      });
    };
    unique('lessonProgress', d.lessonProgress.map((x) => x.code));
    unique('quizSessions', d.quizSessions.map((x) => x.sessionId));
    unique('reviewItems', d.reviewItems.map((x) => x.questionId));
    unique('studyTime', d.studyTime.map((x) => x.key));
    if (d.lastOptionOrders) unique('lastOptionOrders', d.lastOptionOrders.map((x) => x.questionId));
  }),
});
export type Backup = z.infer<typeof backupSchema>;

export async function exportBackup(): Promise<Backup> {
  // 單一唯讀交易：匯出的是同一時間點的一致資料（避免讀到一半時另一個分頁剛好出題，造成順序與測驗不一致）
  const [settings, lessonProgress, quizSessions, attempts, reviewItems, tutorLogs, studyTime, lastOptionOrders] = await db.transaction(
    'r',
    [db.settings, db.lessonProgress, db.quizSessions, db.attempts, db.reviewItems, db.tutorLogs, db.studyTime, db.lastOptionOrders],
    () =>
      Promise.all([
        db.settings.get('user'),
        db.lessonProgress.toArray(),
        db.quizSessions.toArray(),
        db.attempts.toArray(),
        db.reviewItems.toArray(),
        db.tutorLogs.toArray(),
        db.studyTime.toArray(),
        db.lastOptionOrders.toArray(),
      ]),
  );
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings: settings ?? null,
      lessonProgress,
      quizSessions,
      attempts: attempts.map(({ id: _id, ...rest }) => rest),
      reviewItems,
      tutorLogs: tutorLogs.map(({ id: _id, ...rest }) => rest),
      studyTime: studyTime.map(({ key: _key, ...rest }) => ({ ...rest, key: `${rest.date}|${rest.code}` })),
      lastOptionOrders: lastOptionOrders.map(({ questionId, order }) => ({ questionId, order: [...order] })),
    },
  };
}

/** order 是否恰好是這題選項 ID 的一種排列（題目不存在或排列不合法時回傳 false） */
function isPermutationOf(questionId: string, order: readonly string[]): boolean {
  const q = getQuestion(questionId);
  if (!q) return false;
  const ids: readonly string[] = q.options.map((o) => o.id);
  return order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id));
}

/**
 * 還原時的「上一次選項順序」：
 * - 新備份（有 lastOptionOrders）：逐筆精確還原；不是本題選項排列的紀錄略過（損毀或題目已改版）。
 * - 舊備份（沒有這個欄位）：才從測驗與 AI 導師作答紀錄依時間盡力重建（Codex r2 R2：同毫秒測驗、
 *   尚未作答的補強題無法重建，所以新備份必須直接保存）。
 * 精確紀錄略過的題目，仍以重建結果補上，盡量讓下一次換位置。
 */
export function restoredLastOptionOrders(backup: Backup): LastOptionOrder[] {
  const rebuilt = rebuildLastOptionOrders(backup.data.quizSessions as QuizSession[], backup.data.attempts as AnswerAttempt[]);
  const result = new Map<string, string[]>(rebuilt.filter((r) => isPermutationOf(r.questionId, r.order)).map((r) => [r.questionId, r.order]));
  for (const r of backup.data.lastOptionOrders ?? []) if (isPermutationOf(r.questionId, r.order)) result.set(r.questionId, [...r.order]);
  return [...result].map(([questionId, order]) => ({ questionId, order }));
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/** 解析並驗證備份文字；不寫入資料庫 */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: '檔案過大（上限 10 MB）' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的 JSON 檔案' };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `備份格式不符：${first.path.join('.') || '(root)'} ${first.message}` };
  }
  return { ok: true, backup: parsed.data };
}

/** 以備份覆蓋本機資料（單一交易，失敗時不會留下半套資料） */
export async function restoreBackup(backup: Backup): Promise<void> {
  await db.transaction('rw', [db.settings, db.lessonProgress, db.quizSessions, db.attempts, db.reviewItems, db.tutorLogs, db.studyTime, db.lastOptionOrders], async () => {
    await Promise.all([db.settings.clear(), db.lessonProgress.clear(), db.quizSessions.clear(), db.attempts.clear(), db.reviewItems.clear(), db.tutorLogs.clear(), db.studyTime.clear(), db.lastOptionOrders.clear()]);
    await db.settings.put({ ...defaultSettings(), ...(backup.data.settings ?? {}), id: 'user', onboarded: true });
    await db.lessonProgress.bulkPut(backup.data.lessonProgress);
    await db.quizSessions.bulkPut(backup.data.quizSessions);
    await db.attempts.bulkAdd(backup.data.attempts);
    await db.reviewItems.bulkPut(backup.data.reviewItems);
    await db.tutorLogs.bulkAdd(backup.data.tutorLogs);
    await db.studyTime.bulkPut(backup.data.studyTime);
    // 每題上一次的選項順序：新備份精確還原，舊備份才重建（見 restoredLastOptionOrders）
    await db.lastOptionOrders.bulkPut(restoredLastOptionOrders(backup));
  });
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** CSV 欄位跳脫，並防止試算表公式注入 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  return '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\r\n');
}
