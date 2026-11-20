/** Independent release-audit evidence; product code is unchanged. */
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PrepDB, __setDb, ensureInitialized } from '../../src/data/db';
import { exportBackup, parseBackup, restoreBackup } from '../../src/data/backup';
import { allQuestions } from '../../src/content';
import { validateContent } from '../../src/content/validate';

const fixture = JSON.parse(readFileSync('tests/fixtures/backup-v1.json', 'utf8'));
const tutor = { questionId: 'original-L11101-0001', competencyCode: 'L11101', level: 'junior', provider: 'mock', modes: ['simple'], reinforcementQuestionId: null, reinforcementCorrect: null, at: '2026-11-19T00:00:00Z' };
const stores = {
  settings: 'id', lessonProgress: 'code, level, completedAt',
  quizSessions: 'sessionId, level, mode, submittedAt, startAt',
  attempts: '++id, questionId, sessionId, level, competencyCode, answeredAt',
  reviewItems: 'questionId, level, masteryStatus, nextDueAt', sources: 'version',
};

it.each([1, 2])('audit: IndexedDB v%i → current version (v4) preserves every seeded table and primary ID', async (version) => {
  const name = `audit-v1-full-migration-${version}`;
  const old = new Dexie(name);
  old.version(1).stores(stores);
  if (version === 2) old.version(2).stores({ tutorLogs: '++id, questionId, competencyCode, level, at' });
  for (const [table, records] of Object.entries(fixture.data)) {
    await old.table(table).bulkPut(table === 'settings' ? [records] : records as object[]);
  }
  await old.table('sources').put({ version: 'audit-old', sourceUrl: 'https://example.org', checkedAt: '2026-01-01' });
  if (version === 2) await old.table('tutorLogs').add(tutor);
  const snapshots = new Map<string, object[]>();
  for (const table of old.tables) snapshots.set(table.name, await table.toArray());
  old.close();
  const upgraded = new PrepDB(name);
  await upgraded.open();
  try {
    for (const [table, records] of snapshots) {
      const after = await upgraded.table(table).toArray();
      if (table === 'settings') expect(after[0]).toMatchObject(records[0]);
      else expect(after).toEqual(records);
    }
    expect(upgraded.verno).toBe(4);
    expect(await upgraded.studyTime.count()).toBe(0);
    __setDb(upgraded);
    await ensureInitialized();
    expect((await upgraded.settings.get('user'))?.examDate).toEqual({ junior: null, middle: null });
  } finally { await upgraded.delete(); }
});

it.each([1, 2, 3])('audit: backup schema v%i restores all historical records and reexports backup schema v3', async (version) => {
  const raw = structuredClone(fixture);
  raw.schemaVersion = version;
  if (version >= 2) { raw.data.tutorLogs = [tutor]; raw.data.settings.examDate = { junior: '2027-01-01', middle: null }; }
  if (version === 3) raw.data.studyTime = [{ date: '2026-11-19', code: 'L11101', level: 'junior', seconds: 60 }];
  const parsed = parseBackup(JSON.stringify(raw));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const target = new PrepDB(`audit-v1-restore-${version}`);
  __setDb(target);
  try {
    await restoreBackup(parsed.backup);
    const exported = await exportBackup();
    for (const table of ['lessonProgress', 'quizSessions', 'attempts', 'reviewItems', 'tutorLogs', 'studyTime'] as const)
      expect(exported.data[table]).toEqual(parsed.backup.data[table]);
    expect(exported.data.settings).toMatchObject(parsed.backup.data.settings!);
    expect(exported.schemaVersion).toBe(3);
    expect(parseBackup(JSON.stringify(exported)).ok).toBe(true);
  } finally { await target.delete(); }
});

it('audit: original LaTeX regression remains rejected by the content guard', () => {
  const q = { ...allQuestions[0], stem: '若 $x=\\sqrt{4}$，x 為何？' };
  const found = validateContent({ questions: [q], competencyCodes: new Set([q.competencyCode]), lessonHeadings: new Map(), registry: [] });
  expect(found.filter(x => x.message.includes('LaTeX'))).toHaveLength(1);
});
