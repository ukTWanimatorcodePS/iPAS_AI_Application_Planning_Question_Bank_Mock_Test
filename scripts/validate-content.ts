#!/usr/bin/env node
/**
 * 題庫驗證：npm run validate:content
 *   檢查重複 ID、答案合法性、缺少解析、無效課綱代碼、講義段落、題目相似度、已釋出 ID 是否遺失，
 *   並輸出各細項的題數、難度與題型分布。
 *   --sync-registry：把目前已釋出的題目 ID 加入 question-registry.json（只增不減）。
 *   --report：額外輸出完整覆蓋率表。
 * 自動檢查通過 ≠ 人工審核通過。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coverage, headingsOf, validateContent, type VQuestion } from '../src/content/validate.ts';

const root = process.cwd();
const args = process.argv.slice(2);
const curriculum = JSON.parse(readFileSync(join(root, 'src/content/curriculum.json'), 'utf8'));
const codes: { code: string; level: string }[] = [];
for (const lv of curriculum.levels)
  for (const s of lv.subjects) for (const t of s.topics) for (const c of t.competencies) codes.push({ code: c.code, level: lv.id });

const questions: VQuestion[] = [];
const qdir = join(root, 'src/content/questions');
for (const s of readdirSync(qdir)) for (const f of readdirSync(join(qdir, s))) questions.push(...JSON.parse(readFileSync(join(qdir, s, f), 'utf8')));

const lessonHeadings = new Map<string, string[]>();
const lessonTexts = new Map<string, string>();
const ldir = join(root, 'src/content/lessons');
for (const s of readdirSync(ldir))
  for (const f of readdirSync(join(ldir, s))) {
    const md = readFileSync(join(ldir, s, f), 'utf8');
    lessonHeadings.set(f.replace('.md', ''), headingsOf(md));
    lessonTexts.set(f.replace('.md', ''), md);
  }

const registryPath = join(root, 'src/content/question-registry.json');
const registry: { note: string; ids: string[] } = JSON.parse(readFileSync(registryPath, 'utf8'));

if (args.includes('--sync-registry')) {
  const released = questions.filter((q) => q.reviewStatus !== 'draft').map((q) => q.id);
  registry.ids = [...new Set([...registry.ids, ...released])].sort();
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  console.log(`已同步題目 ID 登錄表：${registry.ids.length} 筆`);
}

const issues = validateContent({ questions, competencyCodes: new Set(codes.map((c) => c.code)), lessonHeadings, lessonTexts, registry: registry.ids });
const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

const cov = coverage(questions, codes.map((c) => c.code));
const lv = (l: string) => cov.filter((r) => codes.find((c) => c.code === r.code)!.level === l);
for (const l of ['junior', 'middle']) {
  const rows = lv(l);
  const total = rows.reduce((a, r) => a + r.released, 0);
  const missingLessons = rows.filter((r) => !lessonHeadings.has(r.code)).length;
  console.log(`\n【${l === 'junior' ? '初級' : '中級'}】已釋出 ${total} 題；講義 ${rows.length - missingLessons}/${rows.length}`);
  if (args.includes('--report'))
    for (const r of rows)
      console.log(
        `  ${r.code}  ${String(r.released).padStart(3)} 題  難度 ${JSON.stringify(r.byTier)}  題型 ${JSON.stringify(r.byType)}${lessonHeadings.has(r.code) ? '' : '  （講義未收錄）'}`,
      );
}

const answerDist = questions.reduce<Record<string, number>>((m, q) => {
  for (const c of q.correctOptionIds) m[c] = (m[c] ?? 0) + 1;
  return m;
}, {});
console.log(`\n正解分布：${JSON.stringify(answerDist)}`);

for (const w of warnings.slice(0, args.includes('--report') ? 500 : 30)) console.warn(`⚠ ${w.id}：${w.message}`);
if (warnings.length > 30 && !args.includes('--report')) console.warn(`…另有 ${warnings.length - 30} 則警告（加 --report 顯示全部）`);
for (const e of errors) console.error(`✖ ${e.id}：${e.message}`);
console.log(`\n驗證結果：${errors.length} 個錯誤、${warnings.length} 則警告，共 ${questions.length} 題。自動檢查通過不代表人工審核通過。`);
process.exit(errors.length ? 1 : 0);
