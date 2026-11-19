#!/usr/bin/env node
/**
 * 選項猜題線索報告：npm run audit:options
 *   列出「每題選最長」的期望得分、正確選項是唯一最長的比例、長度比，以及長度比最高的題目（待改寫）。
 *   --top=N：列出長度比最高的 N 題（預設 20）。
 * 指標降低只代表少了一種猜題線索，不代表題目效度合格。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStrictlyLongest, lengthRatio, summarizeCues, type CueQuestion } from '../src/content/optionCues.ts';

const root = process.cwd();
const top = Number(process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 20);
const questions: CueQuestion[] = [];
const qdir = join(root, 'src/content/questions');
for (const s of readdirSync(qdir)) for (const f of readdirSync(join(qdir, s))) questions.push(...JSON.parse(readFileSync(join(qdir, s, f), 'utf8')));

const s = summarizeCues(questions);
console.log(`題數：${s.total}`);
console.log(`每題選最長的期望得分：${s.longestStrategyPct}%（隨機猜約 25%）`);
console.log(`各科：${Object.entries(s.bySubject).map(([k, v]) => `${k} ${v.longestStrategyPct}%`).join('、')}`);
console.log(`正確選項是唯一最長：${s.strictlyLongestPct}%`);
console.log(`正確選項長度 ÷ 錯誤選項平均：${s.avgLengthRatio} 倍；長度比 ≥ 2 的題目 ${s.ratioAtLeast2} 題`);
const r = s.lengthRank;
console.log(`正確選項的長度名次（1 = 最長，理想各約 25%）：第 1 名 ${r[1]}、第 2 名 ${r[2]}、第 3 名 ${r[3]}、第 4 名 ${r[4]}`);
console.log(`絕對字眼：錯誤選項 ${s.absoluteInDistractors} 題、正確選項 ${s.absoluteInCorrect} 題`);
const worst = questions
  .filter((q) => q.reviewStatus !== 'retired' && isStrictlyLongest(q))
  .map((q) => ({ id: q.id, r: lengthRatio(q) }))
  .sort((a, b) => b.r - a.r)
  .slice(0, top);
console.log(`\n長度比最高的 ${top} 題（待改寫）：`);
for (const w of worst) console.log(`  ${w.id}  ${w.r.toFixed(2)} 倍`);
