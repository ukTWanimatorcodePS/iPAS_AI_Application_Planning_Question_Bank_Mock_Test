import { beforeEach, describe, expect, it } from 'vitest';
import { getProvider, mockProvider, remoteProvider } from '../../src/ai';
import { buildMockTutor, pickReinforcement } from '../../src/ai/mockProvider';
import { questionsFor } from '../../src/content';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, recordTutorAttempt, setAnswer, submitSession } from '../../src/data/repo';

const q = questionsFor({ competencyCode: 'L11101' })[0];
const wrong = q.options.find((o) => !q.correctOptionIds.includes(o.id))!.id;

describe('AI 導師（示範模式）', () => {
  it('補強題來自同一細項、不是原題，且「再出一題」會換題', () => {
    const r1 = pickReinforcement(q)!;
    expect(r1.competencyCode).toBe(q.competencyCode);
    expect(r1.id).not.toBe(q.id);
    const r2 = pickReinforcement(q, [r1.id])!;
    expect(r2.id).not.toBe(r1.id);
  });

  it('詳細教學包含核心考點、選錯原因、重新教學、觀念比較，並標示非即時 AI', async () => {
    const r = await buildMockTutor({ question: q, selected: [wrong], mode: 'detailed' });
    expect(r.provider).toBe('mock');
    expect(r.label).toContain('並非即時 AI 生成');
    expect(r.sections.map((s) => s.kind)).toEqual(['core', 'why-wrong', 'reteach', 'compare']);
    const why = r.sections.find((s) => s.kind === 'why-wrong')!.body;
    // 引用的是已審核的選項解析，不另外編造
    expect(why).toContain(q.explanation.optionRationales[wrong]);
    expect(why).toContain(q.explanation.correctRationale);
    expect(r.reinforcementQuestionId).toBeTruthy();
  });

  it('各模式輸出不同內容；「再出一題」只給補強題', async () => {
    const simple = await buildMockTutor({ question: q, selected: [wrong], mode: 'simple' });
    const another = await buildMockTutor({ question: q, selected: [wrong], mode: 'another' });
    expect(simple.sections.map((s) => s.kind)).toEqual(['core', 'why-wrong']);
    expect(another.sections).toEqual([]);
    expect(another.reinforcementQuestionId).toBeTruthy();
  });

  it('未設定後端代理時，遠端模式不可用並自動退回示範模式', () => {
    expect(remoteProvider.isAvailable()).toBe(false);
    expect(getProvider('remote')).toBe(mockProvider);
  });
});

describe('補強題結果影響錯題排程', () => {
  let n = 0;
  beforeEach(async () => {
    __setDb(new PrepDB(`tutor-${++n}`));
    await ensureInitialized();
    const id = await createSession({ level: 'junior', mode: 'test', subject: 'L11', scopeLabel: 't', competencyCodes: [q.competencyCode], questionIds: [q.id] });
    await setAnswer(id, q.id, [wrong]);
    await submitSession(id, 5);
  });

  it('補強題答錯：補強題收錄錯題本，原題改為今天到期', async () => {
    const rq = pickReinforcement(q)!;
    const rw = rq.options.find((o) => !rq.correctOptionIds.includes(o.id))!.id;
    const before = (await db.reviewItems.get(q.id))!.nextDueAt!;
    const r = await recordTutorAttempt({ originalQuestionId: q.id, questionId: rq.id, selected: [rw], timeMs: 1000 });
    expect(r?.correct).toBe(false);
    expect(await db.reviewItems.get(rq.id)).toBeTruthy();
    const after = (await db.reviewItems.get(q.id))!.nextDueAt!;
    expect(new Date(after).getTime()).toBeLessThan(new Date(before).getTime());
    const tutorAttempts = (await db.attempts.toArray()).filter((a) => a.mode === 'tutor');
    expect(tutorAttempts).toHaveLength(1);
    expect(tutorAttempts[0].sessionId).toBe(`tutor:${q.id}`);
  });

  it('補強題答對：不會讓原題直接變成已掌握', async () => {
    const rq = pickReinforcement(q)!;
    await recordTutorAttempt({ originalQuestionId: q.id, questionId: rq.id, selected: rq.correctOptionIds, timeMs: 1000 });
    expect((await db.reviewItems.get(q.id))!.masteryStatus).toBe('unresolved');
    expect(await db.reviewItems.get(rq.id)).toBeUndefined();
  });
});
