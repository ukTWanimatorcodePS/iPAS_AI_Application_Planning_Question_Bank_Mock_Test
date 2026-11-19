import Dexie, { type Table } from 'dexie';
import { curriculum } from '../content';
import { DEFAULT_INTERVALS } from '../lib/review';
import type {
  AnswerAttempt,
  CurriculumSource,
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
  }
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
