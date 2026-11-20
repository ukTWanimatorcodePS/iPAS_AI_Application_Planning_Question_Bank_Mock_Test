import Dexie, { type Table } from 'dexie';
import { curriculum } from '../content';
import { DEFAULT_INTERVALS } from '../lib/review';
import type {
  AnswerAttempt,
  CurriculumSource,
  LastOptionOrder,
  TutorLog,
  LessonProgress,
  StudyTimeLog,
  QuizSession,
  ReviewItem,
  UserSettings,
} from './types';

export const DB_NAME = 'ipas-ai-prep';

/**
 * IndexedDB 結構。
 * 新增欄位或索引時請「新增一個 version」並在 upgrade 中搬移資料，不可刪除舊版本定義，
 * 以免使用者更新網站後紀錄被清空。
 */
export class PrepDB extends Dexie {
  settings!: Table<UserSettings, string>;
  lessonProgress!: Table<LessonProgress, string>;
  quizSessions!: Table<QuizSession, string>;
  attempts!: Table<AnswerAttempt, number>;
  reviewItems!: Table<ReviewItem, string>;
  sources!: Table<CurriculumSource, string>;
  tutorLogs!: Table<TutorLog, number>;
  studyTime!: Table<StudyTimeLog, string>;
  lastOptionOrders!: Table<LastOptionOrder, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      settings: 'id',
      lessonProgress: 'code, level, completedAt',
      quizSessions: 'sessionId, level, mode, submittedAt, startAt',
      attempts: '++id, questionId, sessionId, level, competencyCode, answeredAt',
      reviewItems: 'questionId, level, masteryStatus, nextDueAt',
      sources: 'version',
    });
    // v2（第二階段）：新增 AI 導師紀錄表；設定補上 examDate。既有資料原封保留。
    this.version(2)
      .stores({ tutorLogs: '++id, questionId, competencyCode, level, at' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Partial<UserSettings>) => {
            s.examDate ??= { junior: null, middle: null };
          });
      });
    // v3：新增講義閱讀時間的每日紀錄。舊版只有累計閱讀時間、無法還原每天讀了多久，因此不回填，
    // 本週／本月統計只計入升級後的閱讀時間；累計值仍保留在 lessonProgress.timeSpentSec。
    this.version(3).stores({ studyTime: 'key, date, level' });
    // v4（v1.1.0）：每題上一次顯示的選項順序。從既有測驗與 AI 導師作答紀錄回填，既有資料原封保留。
    this.version(4)
      .stores({ lastOptionOrders: 'questionId' })
      .upgrade(async (tx) => {
        const rows = rebuildLastOptionOrders(await tx.table('quizSessions').toArray(), await tx.table('attempts').toArray());
        await tx.table('lastOptionOrders').bulkPut(rows);
      });
  }
}

/**
 * 依時間先後從測驗與 AI 導師作答紀錄推出每題最後一次的顯示順序（升級資料庫、匯入備份時使用）。
 * 只用來決定「下一次要避開的位置」；找不到時下一次以題庫原始順序為準。
 */
export function rebuildLastOptionOrders(sessions: QuizSession[], attempts: AnswerAttempt[]): LastOptionOrder[] {
  const events: { at: string; questionId: string; order: string[] }[] = [];
  for (const s of sessions) for (const [questionId, order] of Object.entries(s.optionOrders ?? {})) events.push({ at: s.startAt, questionId, order });
  for (const a of attempts) if (a.mode === 'tutor' && a.optionOrder) events.push({ at: a.answeredAt, questionId: a.questionId, order: a.optionOrder });
  events.sort((x, y) => x.at.localeCompare(y.at));
  const last = new Map<string, string[]>();
  for (const e of events) last.set(e.questionId, e.order);
  return [...last].map(([questionId, order]) => ({ questionId, order }));
}

export let db = new PrepDB();

/** 測試用：切換到全新資料庫 */
export function __setDb(next: PrepDB) {
  db = next;
}

export function defaultSettings(): UserSettings {
  return {
    id: 'user',
    level: 'junior',
    track: 'both',
    studyGoal: { junior: '2027 年初', middle: '2027 年中' },
    restDays: [0, 6],
    dailyMinutes: { min: 60, max: 90 },
    theme: 'system',
    highContrast: false,
    fontScale: 1,
    passThreshold: 80,
    reviewIntervals: [...DEFAULT_INTERVALS],
    onboarded: false,
    examDate: { junior: null, middle: null },
    tutorProvider: 'mock',
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureInitialized(): Promise<UserSettings> {
  const existing = await db.settings.get('user');
  await db.sources.put({
    version: curriculum.curriculumVersion,
    sourceUrl: curriculum.sourceUrl,
    checkedAt: curriculum.lastVerifiedAt,
  });
  if (existing) {
    // 補齊新版本新增的設定欄位，不覆蓋使用者既有值
    const merged = { ...defaultSettings(), ...existing };
    if (JSON.stringify(merged) !== JSON.stringify(existing)) await db.settings.put(merged);
    return merged;
  }
  const s = defaultSettings();
  await db.settings.put(s);
  return s;
}
