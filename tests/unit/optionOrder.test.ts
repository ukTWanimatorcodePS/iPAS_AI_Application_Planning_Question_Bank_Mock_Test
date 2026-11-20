import { beforeEach, describe, expect, it } from 'vitest';
import { buildMockTutor } from '../../src/ai/mockProvider';
import { allQuestions } from '../../src/content';
import { exportBackup, parseBackup, restoreBackup } from '../../src/data/backup';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, recordTutorAttempt, revealQuestion, setAnswer, submitSession } from '../../src/data/repo';
import { displayOptions, lettersOf, orderFor, shuffleOrder } from '../../src/lib/optionOrder';

let n = 0;
beforeEach(async () => {
  __setDb(new PrepDB(`option-order-${++n}`));
  await ensureInitialized();
});

const q = allQuestions.find((x) => x.level === 'junior' && x.reviewStatus !== 'retired')!;
const ids = q.options.map((o) => o.id);
const isCorrectId = (x: { correctOptionIds: readonly string[] }, id: string) => x.correctOptionIds.includes(id);
const correctPos = (order: string[]) => order.findIndex((id) => isCorrectId(q, id));
const authoredPos = ids.findIndex((id) => q.correctOptionIds.includes(id));

/** 可重現的亂數 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('選項打亂（每次出題 A～D 內容都要變）', () => {
  it('產生的是原選項的一種排列，正確答案位置和題庫原始位置不同', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const order = shuffleOrder(q, null, seeded(seed));
      expect([...order].sort()).toEqual([...ids].sort());
      expect(correctPos(order)).not.toBe(authoredPos);
    }
  });

  it('正確答案位置一定和上一次不同；連續出題時每個位置都會出現，不會固定在某個字母', () => {
    let prev: string[] | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const next = shuffleOrder(q, prev, seeded(i + 7));
      if (prev) expect(correctPos(next)).not.toBe(correctPos(prev));
      seen.add(correctPos(next));
      prev = next;
    }
    expect(seen.size).toBe(ids.length);
  });

  it('亂數一直撞到同一位置時，仍以平移保證正確答案換位置', () => {
    const stuck = () => 0.999999; // Fisher–Yates 每次都選自己 → 得到原始順序
    const order = shuffleOrder(q, null, stuck);
    expect(correctPos(order)).not.toBe(authoredPos);
  });

  it('全題庫任一題都能打亂且正確答案換位置（四選項、單選）', () => {
    for (const x of allQuestions) {
      const xs = x.options.map((o) => o.id);
      const order = shuffleOrder(x, null, seeded(xs.length + x.id.length));
      expect([...order].sort()).toEqual([...xs].sort());
      expect(order.findIndex((id) => isCorrectId(x, id))).not.toBe(xs.findIndex((id) => isCorrectId(x, id)));
    }
  });

  it('畫面代號依顯示位置標 A～D；原始 ID 可對回畫面代號', () => {
    const order = [ids[2], ids[0], ids[3], ids[1]];
    const shown = displayOptions(q, order);
    expect(shown.map((s) => s.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(shown.map((s) => s.option.id)).toEqual(order);
    expect(lettersOf(q, order, [ids[0]])).toEqual(['B']);
    expect(lettersOf(q, order, [ids[1], ids[2]])).toEqual(['A', 'D']);
  });

  it('舊資料或損毀的順序退回題庫原始順序', () => {
    expect(orderFor(q, undefined)).toEqual(ids);
    expect(orderFor(q, [ids[0], ids[0], ids[1], ids[2]])).toEqual(ids);
    expect(orderFor(q, [ids[0], ids[1]])).toEqual(ids);
    expect(orderFor(q, ['A', 'B', 'C', 'Z'])).toEqual(ids);
  });

  it('題庫沒有依賴固定位置的選項（「以上皆是」「A 與 B 皆正確」「選項 A」等），打亂不會改變題意', () => {
    const bad = /以上皆|以上都|以上均|皆非|皆是|都對|都不對|選項\s*[（(]?[A-F](?![A-Za-z])|[（(][A-F][）)]\s*(與|和|及|、)\s*[（(][A-F][）)]/;
    const hits = allQuestions.filter((x) => x.options.some((o) => bad.test(o.text)) || Object.values(x.explanation.optionRationales).some((r) => /選項\s*[（(]?[A-F](?![A-Za-z])/.test(r)));
    expect(hits.map((x) => x.id)).toEqual([]);
  });
});

describe('測驗資料：記錄顯示順序、作答仍存原始選項 ID', () => {
  const make = () => createSession({ level: q.level, mode: 'practice', subject: q.subject, scopeLabel: 't', competencyCodes: [q.competencyCode], questionIds: [q.id] });

  it('建立測驗時每題都有打亂後的順序；同一題再出一次，正確答案位置換掉', async () => {
    let prevPos = authoredPos;
    for (let i = 0; i < 12; i++) {
      const id = await make();
      const order = (await db.quizSessions.get(id))!.optionOrders![q.id];
      expect([...order].sort()).toEqual([...ids].sort());
      expect(correctPos(order)).not.toBe(prevPos);
      prevPos = correctPos(order);
    }
  });

  it('作答紀錄存原始選項 ID 與當下順序；計分不受打亂影響', async () => {
    const id = await make();
    await setAnswer(id, q.id, q.correctOptionIds);
    await revealQuestion(id, q.id, 1000);
    const s = (await db.quizSessions.get(id))!;
    const [a] = await db.attempts.toArray();
    expect(a.selectedIds).toEqual(q.correctOptionIds);
    expect(a.correct).toBe(true);
    expect(a.optionOrder).toEqual(s.optionOrders![q.id]);
    const done = await submitSession(id, 5);
    expect(done?.rawScore).toBe(1);
  });

  it('備份匯出再匯入後保留顯示順序', async () => {
    const id = await make();
    await setAnswer(id, q.id, q.correctOptionIds);
    await submitSession(id, 5);
    const before = (await db.quizSessions.get(id))!.optionOrders;
    const text = JSON.stringify(await exportBackup());
    __setDb(new PrepDB(`option-order-restore-${n}`));
    await ensureInitialized();
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await restoreBackup(parsed.backup);
    expect((await db.quizSessions.get(id))!.optionOrders).toEqual(before);
    expect((await db.attempts.toArray())[0].optionOrder).toEqual(before![q.id]);
  });

  it('沒有顯示順序的舊備份仍可匯入', async () => {
    const id = await make();
    await setAnswer(id, q.id, q.correctOptionIds);
    await submitSession(id, 5);
    const backup = await exportBackup();
    for (const s of backup.data.quizSessions) delete (s as { optionOrders?: unknown }).optionOrders;
    for (const a of backup.data.attempts) delete (a as { optionOrder?: unknown }).optionOrder;
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
  });

  it('AI 導師補強題記錄當下順序', async () => {
    const other = allQuestions.find((x) => x.competencyCode === q.competencyCode && x.id !== q.id && x.reviewStatus !== 'retired')!;
    const order = shuffleOrder(other);
    await recordTutorAttempt({ originalQuestionId: q.id, questionId: other.id, selected: other.correctOptionIds, timeMs: 10, attemptKey: 'k', optionOrder: order });
    expect((await db.attempts.toArray())[0].optionOrder).toEqual(order);
  });
});

describe('AI 導師文字使用畫面上的代號', () => {
  it('選錯與正確答案的代號依作答當下的顯示順序', async () => {
    const order = shuffleOrder(q, null, seeded(3));
    const wrong = order.find((id) => !isCorrectId(q, id))!;
    const r = await buildMockTutor({ question: q, selected: [wrong], mode: 'detailed', optionOrder: order });
    const why = r.sections.find((s) => s.kind === 'why-wrong')!.body;
    const text = (id: string) => q.options.find((o) => o.id === id)!.text;
    expect(why).toContain(`你選了 **${lettersOf(q, order, [wrong])[0]}. ${text(wrong)}**`);
    expect(why).toContain(`正確答案是 **${lettersOf(q, order, q.correctOptionIds)[0]}. ${text(q.correctOptionIds[0])}**`);
  });
});
