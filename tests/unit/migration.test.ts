import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportBackup, parseBackup, restoreBackup } from '../../src/data/backup';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';

const v1Text = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v1.json'), 'utf8');

describe('舊版相容性', () => {
  it('第一階段（schemaVersion 1）備份可匯入，缺少的欄位補預設值', async () => {
    __setDb(new PrepDB('mig-backup-v1'));
    await ensureInitialized();
    const r = parseBackup(v1Text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.tutorLogs).toEqual([]);
    expect(r.backup.data.settings?.examDate).toEqual({ junior: null, middle: null });
    await restoreBackup(r.backup);
    expect(await db.attempts.count()).toBe(2);
    expect((await db.reviewItems.get('original-L11101-0001'))?.masteryStatus).toBe('unresolved');
    expect((await db.lessonProgress.get('L11101'))?.completedAt).toBeTruthy();
    expect(r.backup.data.studyTime).toEqual([]);
    // 再匯出為目前的備份格式（v3；IndexedDB 已是 v4，兩者版本號不同），可再次匯入
    const again = parseBackup(JSON.stringify(await exportBackup()));
    expect(again.ok && again.backup.schemaVersion).toBe(3);
  });

  it('IndexedDB v1 → 目前版本升級不遺失既有紀錄，並補上新設定欄位', async () => {
    const name = 'mig-idb-v1';
    const old = new Dexie(name);
    old.version(1).stores({
      settings: 'id',
      lessonProgress: 'code, level, completedAt',
      quizSessions: 'sessionId, level, mode, submittedAt, startAt',
      attempts: '++id, questionId, sessionId, level, competencyCode, answeredAt',
      reviewItems: 'questionId, level, masteryStatus, nextDueAt',
      sources: 'version',
    });
    const v1 = JSON.parse(v1Text);
    await old.table('settings').put(v1.data.settings);
    await old.table('attempts').bulkAdd(v1.data.attempts);
    await old.table('reviewItems').bulkPut(v1.data.reviewItems);
    old.close();

    const upgraded = new PrepDB(name);
    __setDb(upgraded);
    const s = await ensureInitialized();
    expect(s.onboarded).toBe(true);
    expect(s.examDate).toEqual({ junior: null, middle: null });
    expect(await db.attempts.count()).toBe(2);
    expect(await db.reviewItems.count()).toBe(1);
    expect(await db.tutorLogs.count()).toBe(0);
    expect(await db.studyTime.count()).toBe(0);
    expect(upgraded.verno).toBe(4);
  });

  it('IndexedDB v2 → 目前版本（v4）：保留累計閱讀時間，新增每日閱讀紀錄表（舊累計不回填到日期）', async () => {
    const name = 'mig-idb-v2';
    const old = new Dexie(name);
    old.version(1).stores({
      settings: 'id',
      lessonProgress: 'code, level, completedAt',
      quizSessions: 'sessionId, level, mode, submittedAt, startAt',
      attempts: '++id, questionId, sessionId, level, competencyCode, answeredAt',
      reviewItems: 'questionId, level, masteryStatus, nextDueAt',
      sources: 'version',
    });
    old.version(2).stores({ tutorLogs: '++id, questionId, competencyCode, level, at' });
    await old.table('lessonProgress').put({ code: 'L11101', level: 'junior', visitedAt: '2026-10-01T00:00:00Z', completedAt: null, lastPosition: null, timeSpentSec: 36_000 });
    old.close();

    const upgraded = new PrepDB(name);
    __setDb(upgraded);
    await ensureInitialized();
    expect(upgraded.verno).toBe(4);
    expect((await db.lessonProgress.get('L11101'))?.timeSpentSec).toBe(36_000);
    expect(await db.studyTime.count()).toBe(0);
  });

  it('備份格式 v3 含每日閱讀紀錄，可匯出再匯入；不合理的秒數會被拒絕', async () => {
    __setDb(new PrepDB('mig-backup-v3'));
    await ensureInitialized();
    await db.lessonProgress.put({ code: 'L11101', level: 'junior', visitedAt: '2026-11-19T00:00:00Z', completedAt: null, lastPosition: null, timeSpentSec: 0 });
    const { addLessonTime } = await import('../../src/data/repo');
    await addLessonTime('L11101', 300, new Date(2026, 10, 19, 10));
    await addLessonTime('L11101', 120, new Date(2026, 10, 19, 21));
    const text = JSON.stringify(await exportBackup());
    const r = parseBackup(text);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    if (!r.ok) return;
    expect(r.backup.data.studyTime).toEqual([{ key: '2026-11-19|L11101', date: '2026-11-19', code: 'L11101', level: 'junior', seconds: 420 }]);
    __setDb(new PrepDB('mig-backup-v3-restore'));
    await ensureInitialized();
    await restoreBackup(r.backup);
    expect((await db.studyTime.get('2026-11-19|L11101'))?.seconds).toBe(420);
    const bad = JSON.parse(text);
    bad.data.studyTime[0].seconds = 999_999;
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('IndexedDB v4：每題上一次選項順序', () => {
  it('IndexedDB v3 → v4 升級時，從既有測驗與 AI 導師紀錄回填，取時間最新的一筆', async () => {
    const name = 'mig-idb-v3-to-v4';
    const old = new Dexie(name);
    old.version(3).stores({
      settings: 'id',
      lessonProgress: 'code, level, completedAt',
      quizSessions: 'sessionId, level, mode, submittedAt, startAt',
      attempts: '++id, questionId, sessionId, level, competencyCode, answeredAt',
      reviewItems: 'questionId, level, masteryStatus, nextDueAt',
      sources: 'version',
      tutorLogs: '++id, questionId, competencyCode, level, at',
      studyTime: 'key, date, level',
    });
    await old.open();
    const base = { level: 'junior', mode: 'practice', subject: 'L11', scopeLabel: 't', competencyCodes: [], answers: {}, revealed: [], flagged: [], currentIndex: 0, submittedAt: null, durationSec: 0, timeLimitSec: null, rawScore: null, validCount: null };
    await old.table('quizSessions').bulkPut([
      { ...base, sessionId: 's1', questionIds: ['q1'], startAt: '2026-11-01T00:00:00.000Z', optionOrders: { q1: ['A', 'B', 'C', 'D'] } },
      { ...base, sessionId: 's2', questionIds: ['q1'], startAt: '2026-11-03T00:00:00.000Z', optionOrders: { q1: ['D', 'C', 'B', 'A'] } },
      { ...base, sessionId: 's0', questionIds: ['q2'], startAt: '2026-11-02T00:00:00.000Z' },
    ]);
    await old.table('attempts').add({ questionId: 'q1', sessionId: 'tutor:x', level: 'junior', subject: 'L11', competencyCode: 'L11101', mode: 'tutor', selectedIds: ['A'], correct: true, timeMs: 1, answeredAt: '2026-11-02T00:00:00.000Z', optionOrder: ['B', 'A', 'C', 'D'] });
    old.close();
    const upgraded = new PrepDB(name);
    await upgraded.open();
    expect(await upgraded.quizSessions.count()).toBe(3);
    expect((await upgraded.lastOptionOrders.get('q1'))?.order).toEqual(['D', 'C', 'B', 'A']);
    expect(await upgraded.lastOptionOrders.get('q2')).toBeUndefined();
    upgraded.close();
  });
});
