import type { Level, SubjectCode } from '../content/schema';

export type Track = 'data' | 'ml' | 'both';
export type ThemePref = 'light' | 'dark' | 'system';

export interface UserSettings {
  id: 'user';
  level: Level;
  track: Track;
  /** 目標考期（文字，例如「2027 年初」）；不寫死官方日期 */
  studyGoal: { junior: string; middle: string };
  /** 休息日（0 = 週日 … 6 = 週六） */
  restDays: number[];
  dailyMinutes: { min: number; max: number };
  theme: ThemePref;
  highContrast: boolean;
  fontScale: number;
  /** 單元測驗建議門檻（%） */
  passThreshold: number;
  /** 錯題複習間隔（天） */
  reviewIntervals: number[];
  onboarded: boolean;
  /** 使用者自訂的目標考試日期（YYYY-MM-DD；非官方日期，可為 null） */
  examDate: { junior: string | null; middle: string | null };
  /** AI 導師來源：mock＝示範模式（離線，預設）；remote＝經後端代理的 AI（需管理者設定） */
  tutorProvider: 'mock' | 'remote';
  updatedAt: string;
}

export interface LessonProgress {
  code: string;
  level: Level;
  visitedAt: string;
  completedAt: string | null;
  /** 最後閱讀到的段落錨點 id */
  lastPosition: string | null;
  timeSpentSec: number;
}

export type QuizMode = 'practice' | 'test' | 'mock' | 'review' | 'tutor';

export interface QuizSession {
  sessionId: string;
  level: Level;
  mode: QuizMode;
  subject: SubjectCode | null;
  /** 顯示用範圍，例如「L11101 AI 的定義與分類」 */
  scopeLabel: string;
  competencyCodes: string[];
  questionIds: string[];
  answers: Record<string, string[]>;
  /** 練習模式中已提交（已顯示解析）的題目 */
  revealed: string[];
  flagged: string[];
  currentIndex: number;
  startAt: string;
  submittedAt: string | null;
  durationSec: number;
  timeLimitSec: number | null;
  /** 答對題數（交卷後） */
  rawScore: number | null;
  /** 交卷時題庫中仍存在的有效題數 */
  validCount: number | null;
  /** 驗證測驗：只出沒看過答案或解析的題目；「再做一次」時沿用（選填，舊資料沒有此欄位） */
  unseenOnly?: boolean;
  /**
   * 每題選項的顯示順序（原始選項 ID 依畫面 A、B、C、D 的順序排列），建立測驗時打亂。
   * 選填：v1.1.0 以前的測驗沒有此欄位，顯示時沿用題庫原始順序。作答仍記錄原始選項 ID。
   */
  optionOrders?: Record<string, string[]>;
}

/** 每題上一次顯示的選項順序（v1.1.0，IndexedDB v4）：讓下一次出題的正確答案位置一定換掉 */
export interface LastOptionOrder {
  questionId: string;
  order: string[];
}

export interface AnswerAttempt {
  id?: number;
  questionId: string;
  sessionId: string;
  level: Level;
  subject: SubjectCode;
  competencyCode: string;
  mode: QuizMode;
  selectedIds: string[];
  correct: boolean;
  timeMs: number;
  answeredAt: string;
  /** 作答當下的選項顯示順序（選填，v1.1.0 起記錄），錯題本重看解析時用同樣的 A～D 代號 */
  optionOrder?: string[];
}

export type MasteryStatus = 'unresolved' | 'reviewing' | 'mastered';
export type MistakeReason = 'concept' | 'careless' | 'misread' | 'not-learned' | 'unknown';

export interface ReviewItem {
  questionId: string;
  level: Level;
  subject: SubjectCode;
  competencyCode: string;
  mistakeCount: number;
  correctStreak: number;
  intervalDays: number;
  /** 下次到期時間；已掌握時為 null */
  nextDueAt: string | null;
  masteryStatus: MasteryStatus;
  reason: MistakeReason;
  firstWrongAt: string;
  lastWrongAt: string;
  lastAnsweredAt: string;
}

export interface CurriculumSource {
  version: string;
  sourceUrl: string;
  checkedAt: string;
}

export const MASTERY_LABEL: Record<MasteryStatus, string> = {
  unresolved: '尚未訂正',
  reviewing: '待複習',
  mastered: '已掌握',
};

export const REASON_LABEL: Record<MistakeReason, string> = {
  concept: '觀念不清',
  careless: '粗心',
  misread: '題意誤讀',
  'not-learned': '尚未學過',
  unknown: '未分類',
};

/**
 * 是否為驗證測驗（只出沒看過的題目）。
 * 新紀錄有 unseenOnly 欄位；舊紀錄（v1.0.0 前建立）沒有，改以講義頁建立驗證測驗時使用的標題辨識：
 * 「Lxxxxx 驗證測驗（未看過的題目）」與更早的「Lxxxxx 驗證測驗（未作答題目）」。
 */
export const LEGACY_VERIFY_LABEL = /驗證測驗（未(看過的|作答)題目）/;
export function isVerifySession(s: Pick<QuizSession, 'unseenOnly' | 'scopeLabel'>): boolean {
  return s.unseenOnly ?? LEGACY_VERIFY_LABEL.test(s.scopeLabel);
}

export const MODE_LABEL: Record<QuizMode, string> = {
  practice: '練習模式',
  test: '測驗模式',
  mock: '自訂模考',
  review: '錯題重測',
  tutor: '導師補強題',
};

export type TutorMode = 'simple' | 'detailed' | 'example' | 'compare' | 'another';

/** 講義閱讀時間的每日紀錄（v3 起）：用來計算本週／本月實際學習時間。key = 「本地日期|細項代碼」 */
export interface StudyTimeLog {
  key: string;
  /** 本地日期 YYYY-MM-DD */
  date: string;
  code: string;
  level: Level;
  seconds: number;
}

/** AI 導師互動紀錄（補強題結果用於判斷是否需要再複習） */
export interface TutorLog {
  id?: number;
  questionId: string;
  competencyCode: string;
  level: Level;
  provider: 'mock' | 'remote';
  modes: TutorMode[];
  reinforcementQuestionId: string | null;
  reinforcementCorrect: boolean | null;
  at: string;
}
