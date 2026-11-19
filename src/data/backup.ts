/**
 * 進度備份：匯出 / 匯入 JSON。
 * 匯入資料一律視為不可信：限制大小、以 Zod 嚴格驗證、未知欄位會被丟棄，驗證失敗不寫入任何資料。
 */
import { z } from 'zod';
import { parseLocalDate } from '../lib/studyPlan';
import { db, defaultSettings } from './db';

export const BACKUP_APP_ID = 'ipas-ai-prep';
/** v1：第一階段；v2：新增 tutorLogs、settings.examDate；v3：新增 studyTime（講義閱讀時間每日紀錄）。匯入時各版皆接受，缺少的欄位補預設值。 */
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
});

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
  }),
});
export type Backup = z.infer<typeof backupSchema>;

export async function exportBackup(): Promise<Backup> {
  const [settings, lessonProgress, quizSessions, attempts, reviewItems, tutorLogs, studyTime] = await Promise.all([
    db.settings.get('user'),
    db.lessonProgress.toArray(),
    db.quizSessions.toArray(),
    db.attempts.toArray(),
    db.reviewItems.toArray(),
    db.tutorLogs.toArray(),
    db.studyTime.toArray(),
  ]);
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
    },
  };
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
  await db.transaction('rw', [db.settings, db.lessonProgress, db.quizSessions, db.attempts, db.reviewItems, db.tutorLogs, db.studyTime], async () => {
    await Promise.all([db.settings.clear(), db.lessonProgress.clear(), db.quizSessions.clear(), db.attempts.clear(), db.reviewItems.clear(), db.tutorLogs.clear(), db.studyTime.clear()]);
    await db.settings.put({ ...defaultSettings(), ...(backup.data.settings ?? {}), id: 'user', onboarded: true });
    await db.lessonProgress.bulkPut(backup.data.lessonProgress);
    await db.quizSessions.bulkPut(backup.data.quizSessions);
    await db.attempts.bulkAdd(backup.data.attempts);
    await db.reviewItems.bulkPut(backup.data.reviewItems);
    await db.tutorLogs.bulkAdd(backup.data.tutorLogs);
    await db.studyTime.bulkPut(backup.data.studyTime);
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
