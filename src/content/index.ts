/**
 * 靜態內容載入器：課綱、講義、題庫一律經由此處載入並以 Zod 驗證。
 * 內容檔案隨網站一起打包，不依賴任何執行期伺服器。
 */
import rawCurriculum from './curriculum.json';
import {
  curriculumSchema,
  questionFileSchema,
  type Competency,
  type Level,
  type Question,
  type Subject,
  type SubjectCode,
  type Topic,
} from './schema';

export const curriculum = curriculumSchema.parse(rawCurriculum);

export interface CompetencyRef extends Competency {
  level: Level;
  subject: Subject;
  topic: Topic;
  /** 該級別學習順序中的索引 */
  order: number;
}

const competencyIndex = new Map<string, CompetencyRef>();
for (const lv of curriculum.levels) {
  let order = 0;
  for (const subject of lv.subjects)
    for (const topic of subject.topics)
      for (const c of topic.competencies) {
        if (competencyIndex.has(c.code)) throw new Error(`課綱代碼重複：${c.code}`);
        competencyIndex.set(c.code, { ...c, level: lv.id, subject, topic, order: order++ });
      }
}

export function getCompetency(code: string): CompetencyRef | undefined {
  return competencyIndex.get(code);
}
export function allCompetencies(level?: Level): CompetencyRef[] {
  const all = [...competencyIndex.values()];
  return level ? all.filter((c) => c.level === level) : all;
}
export function subjectsOf(level: Level): Subject[] {
  return curriculum.levels.find((l) => l.id === level)!.subjects;
}
export function getSubject(code: SubjectCode): Subject {
  for (const lv of curriculum.levels) {
    const s = lv.subjects.find((x) => x.code === code);
    if (s) return s;
  }
  throw new Error(`未知科目 ${code}`);
}

/* ---------- 講義（Markdown，懶載入） ---------- */
const lessonLoaders = import.meta.glob<string>('./lessons/**/*.md', { query: '?raw', import: 'default' });
const lessonPathByCode = new Map<string, string>();
for (const path of Object.keys(lessonLoaders)) {
  const m = path.match(/(L[12]\d{4})\.md$/);
  if (m) lessonPathByCode.set(m[1], path);
}

export function hasLesson(code: string): boolean {
  return lessonPathByCode.has(code);
}
export async function loadLesson(code: string): Promise<string | null> {
  const path = lessonPathByCode.get(code);
  if (!path) return null;
  return lessonLoaders[path]();
}
export function lessonCodes(): string[] {
  return [...lessonPathByCode.keys()].sort();
}

/* ---------- 題庫（JSON，打包時載入並驗證） ---------- */
const questionModules = import.meta.glob<unknown>('./questions/**/*.json', { eager: true, import: 'default' });

function buildQuestionBank(): Question[] {
  const list: Question[] = [];
  const seen = new Set<string>();
  for (const [path, data] of Object.entries(questionModules)) {
    const parsed = questionFileSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`題庫檔案 ${path} 驗證失敗：\n${parsed.error.issues.map((i) => i.message).join('\n')}`);
    }
    for (const q of parsed.data) {
      if (seen.has(q.id)) throw new Error(`題目 ID 重複：${q.id}`);
      if (!competencyIndex.has(q.competencyCode)) throw new Error(`${q.id} 對應不存在的細項 ${q.competencyCode}`);
      seen.add(q.id);
      list.push(q);
    }
  }
  return list;
}

/** 全部題目（含草稿），供驗證與管理使用 */
export const allQuestions: Question[] = buildQuestionBank();
/** 已釋出、可在練習中使用的題目（排除 draft 與 retired；retired 仍可由 getQuestion 取得以顯示歷史紀錄） */
export const releasedQuestions: Question[] = allQuestions.filter((q) => q.reviewStatus !== 'draft' && q.reviewStatus !== 'retired');
const questionById = new Map(allQuestions.map((q) => [q.id, q]));

export function getQuestion(id: string): Question | undefined {
  return questionById.get(id);
}
export function questionsFor(filter: {
  level?: Level;
  subject?: SubjectCode;
  topic?: string;
  competencyCode?: string;
}): Question[] {
  return releasedQuestions.filter(
    (q) =>
      (!filter.level || q.level === filter.level) &&
      (!filter.subject || q.subject === filter.subject) &&
      (!filter.topic || q.topic === filter.topic) &&
      (!filter.competencyCode || q.competencyCode === filter.competencyCode),
  );
}
