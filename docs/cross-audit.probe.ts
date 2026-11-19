import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { buildStudyPlan } from '../src/lib/studyPlan';
import { planCompletion } from '../src/lib/stats';
import { parseBackup, restoreBackup, exportBackup } from '../src/data/backup';
import { PrepDB, __setDb } from '../src/data/db';
import { allQuestions } from '../src/content';
const fixture = () => JSON.parse(readFileSync('tests/fixtures/backup-v1.json', 'utf8'));

it('X1 no study days cannot complete an unread lesson', () => {
  const plan = buildStudyPlan({ settings: { restDays: [0,1,2,3,4,5,6], dailyMinutes: {min:60,max:90} }, examDate:'2026-12-01', today:new Date(2026,10,23), ordered:[{code:'L11101',name:'AI'}] as never, progress:new Map(),reviews:[] });
  console.log('X1',JSON.stringify({feasible:plan.feasible,studyDays:plan.studyDaysLeft,remaining:plan.remainingLessons,tasks:plan.days.map(d=>d.tasks)}));
  expect(plan.feasible).toBe(false);
});
it('X2 duplicate backup primary keys must not silently overwrite records', async () => {
  const raw=fixture();
  raw.data.lessonProgress.push({...raw.data.lessonProgress[0],timeSpentSec:999});
  const r=parseBackup(JSON.stringify(raw));
  if(r.ok){
    const db=new PrepDB('cross-audit-duplicates');__setDb(db);
    await restoreBackup(r.backup);
    const after=await exportBackup();
    console.log('X2',JSON.stringify({input:raw.data.lessonProgress.length,output:after.data.lessonProgress.length}));
    await db.delete();
  }
  expect(r.ok).toBe(false);
});
it('X3 invalid exam dates must be rejected before restore', () => {
  const raw=fixture();raw.data.settings.examDate={junior:'not-a-date',middle:null};
  const plan=buildStudyPlan({settings:{restDays:[],dailyMinutes:{min:60,max:90}},examDate:'not-a-date',today:new Date(2026,10,23),ordered:[],progress:new Map(),reviews:[]});
  console.log('X3',JSON.stringify({examDate:plan.examDate,daysLeft:plan.daysLeft,finiteDays:Number.isFinite(plan.daysLeft)}));
  expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
});
it('X4 future readings must not count toward this week', () => {
  const stats=planCompletion('week',{restDays:[],dailyMinutes:{min:30,max:90}} as never,[],[{date:'2027-01-01',seconds:36000}],new Date(2026,10,23,12));
  console.log('X4',JSON.stringify(stats));expect(stats.actualMin).toBe(0);
});
it('X5 remote reinforcement must reject original or excluded question', async () => {
  vi.stubEnv('VITE_AI_TUTOR_ENDPOINT','https://example.invalid');
  const q=allQuestions[0];
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({sections:[],reinforcementQuestionId:q.id}),{status:200})));
  try{
    const {remoteProvider}=await import('../src/ai/remoteProvider');
    const response=await remoteProvider.teach({question:q,selected:[],mode:'another'},{excludeIds:[q.id]});
    console.log('X5',response.reinforcementQuestionId);expect(response.reinforcementQuestionId).toBeNull();
  } finally {vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
