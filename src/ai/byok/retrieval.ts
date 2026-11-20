import officialSources from '../../content/official-sources.json';
import guideIndex from '../../content/official-guide-index.json';
import { allCompetencies, curriculum, getCompetency, loadLesson, releasedQuestions } from '../../content';
import type { Level } from '../../content/schema';

/**
 * AI 導師的依據檢索（在使用者的瀏覽器內執行，不呼叫任何 AI 服務、不產生用量）。
 * 每次按「送出」時，從本站資料找出和提問最相關的段落，連同編號交給 AI，要求回答必須引用這些依據：
 * - 官方資料：課綱「評鑑內容範圍參考」逐字收錄的評鑑內容、本站核對官方網站的考試制度紀錄（official-sources.json）
 * - 本站自編講義：依官方文件與原始資料撰寫的 50 份講義，依「## 小節」切段
 * - 本站自編題庫：已釋出題目的題幹、正確選項與標準解析
 * - 官方學習指引位置索引（official-guide-index.json）：只有檔名、章節與頁碼，讓 AI 指引使用者去讀官方原文
 * 官方學習指引與公告試題的全文因版權未收錄於本站，因此不在依據之內。
 */

export type SourceKind = 'official' | 'lesson' | 'question';

export interface SourceChunk {
  kind: SourceKind;
  /** 顯示用標題，例如「本站講義 L11101〈必考核心觀念〉」 */
  title: string;
  text: string;
  competencyCode?: string;
  /** 站內連結（講義） */
  href?: string;
  /** 外部官方網址（官方學習指引下載頁） */
  externalUrl?: string;
  questionId?: string;
}

export interface RetrievedSource extends SourceChunk {
  /** 提示中的編號，例如 S1 */
  ref: string;
}

const MAX_CHUNK = 500;
const LIMITS: Record<SourceKind, number> = { official: 2, lesson: 3, question: 2 };
/** 每次附上的依據總字數上限：兼顧依據充足與 token 用量 */
const MAX_TOTAL_CHARS = 3000;

/** 中文取相鄰兩字、英數取整個詞，作為比對單位 */
export function gramsOf(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const w of t.match(/[a-z0-9][a-z0-9.+-]*/g) ?? []) if (w.length > 1) out.add(w);
  for (const run of t.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

function clip(s: string, n = MAX_CHUNK): string {
  const t = s.replace(/\s+\n/g, '\n').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 把講義依「## 小節」切段；過長的小節再依段落切開 */
export function lessonChunks(code: string, md: string): SourceChunk[] {
  const name = getCompetency(code)?.name ?? '';
  const out: SourceChunk[] = [];
  const parts = md.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = nl < 0 ? '' : part.slice(nl + 1).trim();
    if (!body || /延伸參考|參考來源/.test(heading)) continue;
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ kind: 'lesson', title: `本站講義 ${code} ${name}〈${heading}〉`, text: clip(buf), competencyCode: code, href: `/courses/${code}` });
      buf = '';
    };
    for (const para of body.split(/\n{2,}/)) {
      if (buf.length + para.length > MAX_CHUNK) flush();
      buf += `${para}\n\n`;
    }
    flush();
  }
  return out;
}

interface GuideEntry {
  subjectCode: string;
  sectionNumber: string;
  sectionTitle: string;
  versionCode: string | null;
  pageRange: { printedStart: string; printedEnd: string; pdfStart: number; pdfEnd: number };
  mappingGranularity: string;
  downloadPageUrl: string;
}
const GUIDE_SUBJECT: Record<string, string> = { L11: '初級科目一', L12: '初級科目二', L21: '中級科目一', L22: '中級科目二', L23: '中級科目三' };

/** 官方學習指引的閱讀位置（不含正文） */
export function guidePointer(code: string): SourceChunk | null {
  const g = (guideIndex.competencies as Record<string, GuideEntry>)[code];
  if (!g) return null;
  const p = g.pageRange;
  const version = g.versionCode ? ` ${g.versionCode} 版` : '';
  const scope = g.mappingGranularity === 'parent_topic_section' ? '（此為所屬主題的整章範圍，不是本細項專屬頁碼）' : '';
  return {
    kind: 'official',
    title: `官方學習指引 ${GUIDE_SUBJECT[g.subjectCode] ?? g.subjectCode}${version} §${g.sectionNumber}「${g.sectionTitle}」`,
    text: `與 ${code} 相關的官方學習指引位置：${GUIDE_SUBJECT[g.subjectCode] ?? g.subjectCode}第 ${g.sectionNumber} 節「${g.sectionTitle}」，印刷頁 ${p.printedStart}～${p.printedEnd}（PDF 第 ${p.pdfStart}～${p.pdfEnd} 頁）${scope}。本站未收錄指引內文，需要原文時請使用者到 iPAS 官方學習資源頁下載閱讀。`,
    competencyCode: code,
    externalUrl: g.downloadPageUrl,
  };
}

function officialChunks(level: Level): SourceChunk[] {
  const out: SourceChunk[] = [];
  for (const c of allCompetencies(level)) {
    out.push({
      kind: 'official',
      title: `官方評鑑內容範圍 ${curriculum.curriculumVersion} 版・${c.code} ${c.name}`,
      text: c.officialScope ? `評鑑內容：${c.officialScope}` : '官方評鑑內容欄為空白（只列細項名稱）。',
      competencyCode: c.code,
    });
  }
  const findings = (officialSources as { lastCheckedAt?: string; findings?: string[] }).findings ?? [];
  findings.forEach((f, i) =>
    out.push({
      kind: 'official',
      title: `本站核對官方網站的考試制度紀錄（${(officialSources as { lastCheckedAt?: string }).lastCheckedAt ?? ''}）#${i + 1}`,
      text: clip(f),
    }),
  );
  out.push({ kind: 'official', title: `官方評鑑範圍說明（${curriculum.curriculumVersion} 版）`, text: curriculum.notes });
  return out;
}

function questionChunks(level: Level): SourceChunk[] {
  return releasedQuestions
    .filter((q) => q.level === level)
    .map((q) => {
      const correct = q.options.filter((o) => q.correctOptionIds.includes(o.id)).map((o) => o.text).join('；');
      return {
        kind: 'question' as const,
        title: `本站題庫 ${q.id} 的標準解析`,
        text: clip(`題目：${q.stem}\n正確敘述：${correct}\n解析：${q.explanation.summary} ${q.explanation.correctRationale}`),
        competencyCode: q.competencyCode,
        questionId: q.id,
      };
    });
}

interface Indexed extends SourceChunk {
  grams: Set<string>;
}
const cache = new Map<Level, Promise<{ chunks: Indexed[]; df: Map<string, number> }>>();

async function buildIndex(level: Level) {
  const lessons = await Promise.all(allCompetencies(level).map(async (c) => lessonChunks(c.code, (await loadLesson(c.code)) ?? '')));
  const chunks: Indexed[] = [...officialChunks(level), ...lessons.flat(), ...questionChunks(level)].map((c) => ({ ...c, grams: gramsOf(`${c.title}\n${c.text}`) }));
  const df = new Map<string, number>();
  for (const c of chunks) for (const g of c.grams) df.set(g, (df.get(g) ?? 0) + 1);
  return { chunks, df };
}

function indexFor(level: Level) {
  let p = cache.get(level);
  if (!p) {
    p = buildIndex(level);
    cache.set(level, p);
  }
  return p;
}

/**
 * 依提問找出依據段落。
 * @param focusCode 目前頁面的細項代碼（同細項的資料加分）
 * @param excludeQuestionId 尚未提交的題目：排除它自己的解析，避免把答案透露給 AI
 */
export async function retrieveSources(opts: { level: Level; query: string; focusCode?: string; excludeQuestionId?: string }): Promise<RetrievedSource[]> {
  const { chunks, df } = await indexFor(opts.level);
  const q = gramsOf(opts.query);
  const n = chunks.length;
  const scored = chunks
    .filter((c) => !opts.excludeQuestionId || c.questionId !== opts.excludeQuestionId)
    .map((c) => {
      let s = 0;
      for (const g of q) if (c.grams.has(g)) s += Math.log(1 + n / (df.get(g) ?? 1));
      if (opts.focusCode && c.competencyCode === opts.focusCode) s *= 1.6;
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  const picked: SourceChunk[] = [];
  const used: Record<SourceKind, number> = { official: 0, lesson: 0, question: 0 };
  let total = 0;
  // 目前細項的官方評鑑內容一律附上（若有），讓 AI 知道官方範圍
  const focusOfficial = opts.focusCode ? chunks.find((c) => c.kind === 'official' && c.competencyCode === opts.focusCode) : undefined;
  if (focusOfficial) {
    picked.push(focusOfficial);
    used.official++;
    total += focusOfficial.text.length;
  }
  // 目前細項的官方學習指引位置（約 150 字），讓 AI 在本站資料不足時指引使用者閱讀官方原文
  const guide = opts.focusCode ? guidePointer(opts.focusCode) : null;
  if (guide) {
    picked.push(guide);
    total += guide.text.length;
  }
  const top = scored[0]?.s ?? 0;
  for (const { c, s } of scored) {
    if (picked.includes(c) || used[c.kind] >= LIMITS[c.kind] || total + c.text.length > MAX_TOTAL_CHARS) continue;
    // 官方評鑑範圍每段都很短、容易因共同字詞被選中；相關度不到最高分的一半就不附，節省 token
    if (c.kind === 'official' && s < top * 0.5) continue;
    picked.push(c);
    used[c.kind]++;
    total += c.text.length;
  }
  return picked.map(({ kind, title, text, competencyCode, href, externalUrl, questionId }, i) => ({ kind, title, text, competencyCode, href, externalUrl, questionId, ref: `S${i + 1}` }));
}

/**
 * 只看使用者提問本身與本站資料的相關度（不含目前題目的題幹），用來在送出前擋下與題庫無關的閒聊。
 * 回傳最高的檢索分數；0 表示提問中沒有任何字詞出現在本站資料。
 */
/** 問句常見、沒有主題意義的字詞：不列入離題判斷的相關度 */
const STOP_GRAMS = new Set(['什麼', '為什', '麼是', '是什', '怎麼', '如何', '一個', '一下', '可以', '請問', '我們', '你們', '這個', '那個', '哪些', '哪個', '有沒', '沒有', '是不', '不是', '幫我', '告訴', '訴我', '給我', '一點', '多少', '幾個', '為何', '麼天', '的是']);

export async function questionRelevance(level: Level, userText: string): Promise<number> {
  const { chunks, df } = await indexFor(level);
  const q = new Set([...gramsOf(userText)].filter((g) => !STOP_GRAMS.has(g)));
  const n = chunks.length;
  let best = 0;
  for (const c of chunks) {
    let s = 0;
    for (const g of q) if (c.grams.has(g)) s += Math.log(1 + n / (df.get(g) ?? 1));
    if (s > best) best = s;
  }
  return best;
}

/**
 * 本站課綱名詞（辨識學習意圖用，不是手寫白名單）。只取「定義或觀念」層級的來源：
 * - 講義「名詞與定義」小節的術語（例如「協同過濾（Collaborative Filtering）」）
 * - 觀念說明小節（必考核心觀念、原理及運作流程、容易混淆的觀念比較）的 ### 小標題（例如「推薦系統」）
 * - 細項名稱與課綱的範圍詞（scopeTerms）
 * 不取「不同領域的實際案例」等段落的粗體：那裡的「出版社」「行銷部」是案例角色，不是專業術語（Codex 提問引導 G1）。
 * 只收中文 3 字以上或英文 4 字母以上的名詞。
 */
const CONCEPT_SECTIONS = /^(必考核心觀念|原理及運作流程|容易混淆的觀念比較)$/;
let conceptCache: Promise<string[]> | null = null;
/** 初級與中級合併：辨識學習意圖不受目前級別限制（初級頁面問「協同過濾」也算學習提問） */
async function conceptVocabulary(): Promise<string[]> {
  let p = conceptCache;
  if (!p) {
    p = (async () => {
      const terms = new Set<string>();
      const add = (raw: string) => {
        for (const part of raw.split(/[（）()、，,／/：:]/)) {
          const t = part.replace(/^\d+[.、]\s*/, '').trim();
          if (/^L[12]\d{4}$/.test(t)) continue;
          if (/^[㐀-鿿]{3,12}$/.test(t) || /^[A-Za-z][A-Za-z -]{3,30}$/.test(t)) terms.add(t);
        }
      };
      for (const c of allCompetencies()) {
        add(c.name);
        for (const term of c.scopeTerms ?? []) for (const alt of term.split('|')) add(alt);
        const md = (await loadLesson(c.code)) ?? '';
        let section = '';
        for (const line of md.split(/\r?\n/)) {
          const h2 = line.match(/^##\s+(.+)$/);
          if (h2) {
            section = h2[1].trim();
            continue;
          }
          if (section === '名詞與定義') {
            const m = line.match(/^\s*[-*]\s+\*\*([^*]{2,40})\*\*/);
            if (m) add(m[1]);
          } else if (CONCEPT_SECTIONS.test(section)) {
            const h3 = line.match(/^###\s+(.+)$/);
            if (h3) add(h3[1]);
          }
        }
      }
      return [...terms].sort((x, y) => y.length - x.length);
    })();
    conceptCache = p;
  }
  return p;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 提問中出現的本站課綱名詞（英文以整詞比對，避免字串片段誤中） */
export async function conceptHits(text: string): Promise<string[]> {
  const t = text.toLowerCase();
  return (await conceptVocabulary()).filter((term) =>
    /^[A-Za-z]/.test(term) ? new RegExp(String.raw`\b${escapeRe(term.toLowerCase())}\b`).test(t) : t.includes(term.toLowerCase()),
  );
}

export function sourcesBlock(sources: RetrievedSource[]): string {
  if (!sources.length) return '【本站依據資料】（這次沒有找到相關資料）';
  return ['【本站依據資料】', ...sources.map((s) => `[${s.ref}]（${s.title}）\n${s.text}`)].join('\n\n');
}
