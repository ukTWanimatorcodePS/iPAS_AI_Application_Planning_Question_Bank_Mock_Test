import type { CompetencyRef } from '../content';
import type { LessonProgress, ReviewItem, UserSettings } from '../data/types';
import { isDue } from './review';

/** 規劃用的時間估計（分鐘）；只是預設值，實際依個人速度調整 */
export const MINUTES = { lesson: 30, practicePerUnit: 15, reviewPerItem: 2, weakPerItem: 2, mixedPerItem: 1.5, mock: 60 } as const;
/** 選做任務（弱點、混合測驗）至少要能做幾題才排入；時間不夠就不排 */
const MIN_OPTIONAL_ITEMS = 5;
export const UNIT_MINUTES = MINUTES.lesson + MINUTES.practicePerUnit;
/** 考前衝刺期：考前 14 天 */
export const SPRINT_DAYS = 14;

export type PlanTask =
  | { kind: 'lesson'; code: string; name: string; minutes: number }
  | { kind: 'practice'; code: string; count: number; minutes: number }
  | { kind: 'review'; count: number; minutes: number }
  | { kind: 'weak'; count: number; minutes: number }
  | { kind: 'mixed'; count: number; minutes: number }
  | { kind: 'mock'; minutes: number };

export interface DayPlan {
  date: string;
  weekday: number;
  phase: 'learn' | 'sprint' | 'rest' | 'after';
  tasks: PlanTask[];
  minutes: number;
}

export interface StudyPlan {
  examDate: string | null;
  daysLeft: number | null;
  studyDaysLeft: number | null;
  remainingLessons: number;
  totalLessons: number;
  sprintStart: string | null;
  lessonsPerStudyDay: number;
  requiredMinutesPerDay: number;
  feasible: boolean;
  messages: string[];
  days: DayPlan[];
}

const DAY = 86_400_000;
export function localDate(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function parseLocal(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export interface PlanInput {
  settings: Pick<UserSettings, 'restDays' | 'dailyMinutes'>;
  examDate: string | null;
  /** 依建議順序排列的本級別（與路線）細項 */
  ordered: CompetencyRef[];
  progress: Map<string, LessonProgress> | undefined;
  reviews: ReviewItem[];
  today?: Date;
  horizon?: number;
}

/**
 * 依剩餘時間、課綱範圍與完成度產生學習計畫（純函式，方便測試）。
 * - 有考試日期：扣除休息日後平均分配剩餘講義；考前 14 天為衝刺期（錯題、弱點、混合測驗、模擬考）。
 * - 未設定考試日期：依每日最少可用時間安排進度，並提示設定日期。
 */
export function buildStudyPlan(input: PlanInput): StudyPlan {
  const today = startOfDay(input.today ?? new Date());
  const horizon = input.horizon ?? 7;
  const { restDays, dailyMinutes } = input.settings;
  const remaining = input.ordered.filter((c) => !input.progress?.get(c.code)?.completedAt);
  const messages: string[] = [];

  let exam: Date | null = input.examDate ? parseLocal(input.examDate) : null;
  if (exam && exam.getTime() <= today.getTime()) {
    messages.push('設定的考試日期已過或為今天，請到設定更新考試日期。');
    exam = null;
  }

  const isStudyDay = (d: Date) => !restDays.includes(d.getDay());
  let daysLeft: number | null = null;
  let studyDaysLeft: number | null = null;
  let sprintStart: Date | null = null;
  let learnDays: number;

  if (exam) {
    daysLeft = Math.round((exam.getTime() - today.getTime()) / DAY);
    studyDaysLeft = 0;
    for (let t = today.getTime(); t < exam.getTime(); t += DAY) if (isStudyDay(new Date(t))) studyDaysLeft++;
    sprintStart = daysLeft > SPRINT_DAYS + 7 ? new Date(exam.getTime() - SPRINT_DAYS * DAY) : null;
    learnDays = 0;
    const learnEnd = sprintStart ?? exam;
    for (let t = today.getTime(); t < learnEnd.getTime(); t += DAY) if (isStudyDay(new Date(t))) learnDays++;
    if (!sprintStart) messages.push('距離考試不足三週，已直接進入衝刺安排：講義與錯題、模擬考並行。');
  } else {
    learnDays = Math.max(1, Math.ceil(remaining.length / Math.max(1, Math.floor(dailyMinutes.min / UNIT_MINUTES))));
    messages.push('尚未設定考試日期，以下依每日最少可用時間安排；到「設定」填入考試日期可產生倒數計畫。');
  }

  const lessonsPerStudyDay = remaining.length === 0 ? 0 : Math.max(1, Math.ceil(remaining.length / Math.max(1, learnDays)));
  const requiredMinutesPerDay = lessonsPerStudyDay * UNIT_MINUTES;
  const lessonPaceOk = requiredMinutesPerDay <= dailyMinutes.max || remaining.length === 0;
  if (!lessonPaceOk)
    messages.push(`依目前進度，每個學習日需讀 ${lessonsPerStudyDay} 個細項（約 ${requiredMinutesPerDay} 分鐘），超過你設定的每日上限 ${dailyMinutes.max} 分鐘。建議增加學習時間、減少休息日，或優先讀較弱的細項。`);
  if (remaining.length === 0) messages.push('本級別講義已全部讀完，計畫以錯題複習、弱點補強與模擬考為主。');

  // 到期錯題分配：今天處理全部已到期（含逾期），之後每天只列當天到期的
  const dueOn = (d: Date) =>
    input.reviews.filter((r) => r.masteryStatus !== 'mastered' && r.nextDueAt && localDate(new Date(r.nextDueAt)) === localDate(d));

  const days: DayPlan[] = [];
  let cursor = 0;
  let studyIndex = 0;
  for (let i = 0; i < horizon; i++) {
    const d = new Date(today.getTime() + i * DAY);
    const date = localDate(d);
    const tasks: PlanTask[] = [];
    if (exam && d.getTime() >= exam.getTime()) {
      days.push({ date, weekday: d.getDay(), phase: 'after', tasks, minutes: 0 });
      continue;
    }
    const due = i === 0 ? input.reviews.filter((r) => isDue(r, d)).length : dueOn(d).length;
    if (!isStudyDay(d)) {
      if (due) tasks.push({ kind: 'review', count: due, minutes: due * MINUTES.reviewPerItem });
      days.push({ date, weekday: d.getDay(), phase: 'rest', tasks, minutes: sum(tasks) });
      continue;
    }
    // 距考試不足三週時沒有獨立衝刺期，整段都以「壓縮衝刺」安排：講義與衝刺任務並行
    const compressed = !!exam && !sprintStart;
    const inSprint = sprintStart ? d.getTime() >= sprintStart.getTime() : compressed;
    // 必要任務：到期錯題與依進度必須讀的講義
    if (due) tasks.push({ kind: 'review', count: due, minutes: due * MINUTES.reviewPerItem });
    for (let k = 0; k < lessonsPerStudyDay && cursor < remaining.length; k++, cursor++) {
      const c = remaining[cursor];
      tasks.push({ kind: 'lesson', code: c.code, name: c.name, minutes: MINUTES.lesson });
      tasks.push({ kind: 'practice', code: c.code, count: 5, minutes: MINUTES.practicePerUnit });
    }
    // 選做任務：只在每日上限剩餘的時間內安排，題數依剩餘時間縮減，絕不讓當天總時間超過上限
    let budget = dailyMinutes.max - sum(tasks);
    const addWeak = (count: number) => {
      const n = Math.min(count, Math.floor(budget / MINUTES.weakPerItem));
      if (n >= MIN_OPTIONAL_ITEMS) {
        const minutes = n * MINUTES.weakPerItem;
        tasks.push({ kind: 'weak', count: n, minutes });
        budget -= minutes;
      }
    };
    const addMixed = (count: number) => {
      const n = Math.min(count, Math.floor(budget / MINUTES.mixedPerItem));
      if (n >= MIN_OPTIONAL_ITEMS) {
        const minutes = Math.ceil(n * MINUTES.mixedPerItem);
        tasks.push({ kind: 'mixed', count: n, minutes });
        budget -= minutes;
      }
    };
    if (inSprint) {
      addWeak(10);
      const mockDay = studyIndex % (compressed ? 2 : 3) === (compressed ? 1 : 2);
      if (mockDay && budget >= MINUTES.mock) {
        tasks.push({ kind: 'mock', minutes: MINUTES.mock });
        budget -= MINUTES.mock;
      } else addMixed(compressed ? 20 : 30);
    } else {
      if (cursor >= remaining.length && !tasks.some((t) => t.kind === 'lesson')) addMixed(20);
      // 每 6 個學習日安排一次階段混合測驗，避免只練單一細項
      else if (studyIndex % 6 === 5) addMixed(20);
    }
    studyIndex++;
    days.push({ date, weekday: d.getDay(), phase: inSprint ? 'sprint' : 'learn', tasks, minutes: sum(tasks) });
  }

  // 必要任務（到期錯題＋依進度的講義）超過每日上限的學習日；選做任務已依上限縮減，不會造成超額
  const over = days.filter((d) => (d.phase === 'learn' || d.phase === 'sprint' || d.phase === 'rest') && d.minutes > dailyMinutes.max);
  if (over.length && lessonPaceOk)
    messages.push(`接下來 ${days.length} 天中有 ${over.length} 天的必要任務（講義與到期錯題）超過每日上限 ${dailyMinutes.max} 分鐘，最多約 ${Math.max(...over.map((d) => d.minutes))} 分鐘。建議先處理到期錯題，或提高每日上限。`);
  const feasible = lessonPaceOk && over.length === 0;

  return {
    examDate: exam ? localDate(exam) : null,
    daysLeft,
    studyDaysLeft,
    remainingLessons: remaining.length,
    totalLessons: input.ordered.length,
    sprintStart: sprintStart ? localDate(sprintStart) : null,
    lessonsPerStudyDay,
    requiredMinutesPerDay,
    feasible,
    messages,
    days,
  };
}

function sum(tasks: PlanTask[]) {
  return tasks.reduce((a, t) => a + t.minutes, 0);
}
