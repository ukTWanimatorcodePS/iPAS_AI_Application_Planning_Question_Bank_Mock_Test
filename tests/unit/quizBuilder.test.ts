import { describe, expect, it } from 'vitest';
import { buildQuiz } from '../../src/lib/quizBuilder';
import type { Question } from '../../src/content/schema';

const mk = (id: string) => ({ id }) as Question;
const pool = ['q1', 'q2', 'q3', 'q4', 'q5'].map(mk);
let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe('buildQuiz', () => {
  it('不重複、不超過題庫數量並回報不足', () => {
    const r = buildQuiz([...pool, mk('q1')], 10, { rand });
    expect(r.questionIds).toHaveLength(5);
    expect(new Set(r.questionIds).size).toBe(5);
    expect(r.shortfall).toBe(5);
  });
  it('優先出未作答過的題目，其次是曾答錯的題目', () => {
    const r = buildQuiz(pool, 3, { attemptedIds: new Set(['q1', 'q2', 'q3']), wrongIds: new Set(['q3']), rand });
    expect(r.questionIds.slice(0, 2).sort()).toEqual(['q4', 'q5']);
    expect(r.questionIds[2]).toBe('q3');
  });
  it('題庫為空時回傳空陣列', () => {
    expect(buildQuiz([], 5).questionIds).toEqual([]);
  });
});
