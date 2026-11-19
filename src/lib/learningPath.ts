import { allCompetencies, type CompetencyRef } from '../content';
import type { Level, SubjectCode } from '../content/schema';
import type { LessonProgress, Track } from '../data/types';

/** 中級依路線決定要讀的科目 */
export function subjectsForTrack(level: Level, track: Track): SubjectCode[] {
  if (level === 'junior') return ['L11', 'L12'];
  if (track === 'data') return ['L21', 'L22'];
  if (track === 'ml') return ['L21', 'L23'];
  return ['L21', 'L22', 'L23'];
}

/** 預設學習順序：初級 L111 → … → L123；中級 L21 → L22／L23 */
export function orderedCompetencies(level: Level, track: Track): CompetencyRef[] {
  const subjects = subjectsForTrack(level, track);
  return allCompetencies(level)
    .filter((c) => subjects.includes(c.subject.code))
    .sort((a, b) => subjects.indexOf(a.subject.code) - subjects.indexOf(b.subject.code) || a.order - b.order);
}

export function nextLesson(
  level: Level,
  track: Track,
  progress: Map<string, LessonProgress> | undefined,
): CompetencyRef | undefined {
  const list = orderedCompetencies(level, track);
  return list.find((c) => !progress?.get(c.code)?.completedAt) ?? list[0];
}

export function lastVisitedLesson(progress: Map<string, LessonProgress> | undefined): LessonProgress | undefined {
  if (!progress) return undefined;
  return [...progress.values()].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))[0];
}
