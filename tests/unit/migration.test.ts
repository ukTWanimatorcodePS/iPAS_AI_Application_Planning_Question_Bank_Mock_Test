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
    // 再匯出為 v2，可再次匯入
    const again = parseBackup(JSON.stringify(await exportBackup()));
    expect(again.ok && again.backup.schemaVersion).toBe(2);
  });

  it('IndexedDB v1 → v2 升級不遺失既有紀錄，並補上新設定欄位', async () => {
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
    expect(upgraded.verno).toBe(2);
  });
});
