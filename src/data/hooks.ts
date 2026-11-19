import { useLiveQuery } from 'dexie-react-hooks';
import type { Level } from '../content/schema';
import { db } from './db';
import type { AnswerAttempt, LessonProgress, QuizSession, ReviewItem, StudyTimeLog } from './types';

export function useLessonProgress(level: Level): Map<string, LessonProgress> | undefined {
  return useLiveQuery(async () => {
    const list = await db.lessonProgress.where('level').equals(level).toArray();
    return new Map(list.map((p) => [p.code, p]));
  }, [level]);
}

/** 講義閱讀時間的每日紀錄（v3 起） */
export function useStudyTime(level: Level): StudyTimeLog[] | undefined {
  return useLiveQuery(() => db.studyTime.where('level').equals(level).toArray(), [level]);
}

export function useAttempts(level: Level): AnswerAttempt[] | undefined {
  return useLiveQuery(() => db.attempts.where('level').equals(level).sortBy('answeredAt'), [level]);
}

export function useReviewItems(level: Level): ReviewItem[] | undefined {
  return useLiveQuery(() => db.reviewItems.where('level').equals(level).toArray(), [level]);
}

export function useSessions(level: Level): QuizSession[] | undefined {
  return useLiveQuery(async () => {
    const list = await db.quizSessions.where('level').equals(level).toArray();
    return list.sort((a, b) => b.startAt.localeCompare(a.startAt));
  }, [level]);
}

export function useSession(id: string | undefined): QuizSession | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.quizSessions.get(id)) ?? null) : null), [id]);
}
