/**
 * 題庫與講義內容驗證（純函式，無外部相依）。
 * 由 scripts/validate-content.ts（命令列）與 tests/unit/content.test.ts 共用。
 * 注意：自動檢查通過不代表人工審核通過。
 */
import { findMisconceptions } from './misconceptions.ts';

export interface VQuestion {
  id: string;
  level: string;
  subject: string;
  topic: string;
  competencyCode: string;
  type: string;
  stem: string;
  code?: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: { summary: string; correctRationale: string; optionRationales: Record<string, string>; commonTrap: string; lessonAnchor: string };
  difficultyTier?: string;
  questionType?: string;
  lessonSection?: string;
  reviewStatus: string;
  verification?: { status: string; kind?: string; expectedStdout?: string };
}

export interface Issue {
  severity: 'error' | 'warning';
  id: string;
  message: string;
}

export interface ValidateInput {
  questions: VQuestion[];
  competencyCodes: Set<string>;
  /** 細項代碼 → 講義中的 ## / ### 標題 */
  lessonHeadings: Map<string, string[]>;
  /** 曾經釋出的題目 ID（永不刪除） */
  registry: string[];
  /** 細項代碼 → 講義全文（用於已知錯誤說法檢查；可省略） */
  lessonTexts?: Map<string, string>;
}

export const SIMILARITY_ERROR = 0.85;
export const SIMILARITY_WARN = 0.65;

const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

export function bigrams(s: string): Set<string> {
  const t = normalize(s);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 題目「指紋」：題幹＋程式碼＋排序後的選項，用於偵測只換人名、數字的重複題 */
export function fingerprint(q: VQuestion): Set<string> {
  return bigrams(q.stem + (q.code ?? '') + q.options.map((o) => o.text).sort().join('|'));
}

export function validateContent(input: ValidateInput): Issue[] {
  const issues: Issue[] = [];
  const err = (id: string, message: string) => issues.push({ severity: 'error', id, message });
  const warn = (id: string, message: string) => issues.push({ severity: 'warning', id, message });

  const seen = new Map<string, number>();
  for (const q of input.questions) seen.set(q.id, (seen.get(q.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) err(id, `題目 ID 重複 ${n} 次`);

  for (const q of input.questions) {
    if (!input.competencyCodes.has(q.competencyCode)) err(q.id, `無效的課綱細項代碼 ${q.competencyCode}`);
    if (!input.competencyCodes.has(q.explanation.lessonAnchor)) err(q.id, `解析對應的講義代碼無效 ${q.explanation.lessonAnchor}`);
    const optionIds = q.options.map((o) => o.id);
    if (q.options.length !== 4) warn(q.id, `選項數為 ${q.options.length}，規格建議四個選項`);
    if (!q.correctOptionIds.length) err(q.id, '沒有正確答案');
    for (const c of q.correctOptionIds) if (!optionIds.includes(c)) err(q.id, `正確答案 ${c} 不在選項中`);
    if (q.type === 'single-choice' && q.correctOptionIds.length !== 1) err(q.id, '單選題必須恰好一個正確答案');
    if (new Set(q.options.map((o) => o.text.replace(/\s+/g, ''))).size !== q.options.length) err(q.id, '有內容相同的選項');
    for (const o of q.options) {
      const r = q.explanation.optionRationales[o.id];
      if (!r || r.trim().length < 4) err(q.id, `選項 ${o.id} 缺少解析`);
      else if (r.startsWith('正確') !== q.correctOptionIds.includes(o.id)) err(q.id, `選項 ${o.id} 的解析與正確答案不一致`);
      if (/以上皆是|以上皆非/.test(o.text)) warn(q.id, '使用「以上皆是／以上皆非」選項');
    }
    if (q.explanation.correctRationale.trim().length < 8) err(q.id, '正確選項解釋過短');
    if (q.explanation.summary.trim().length < 8) err(q.id, '缺少概念重點');
    const headings = input.lessonHeadings.get(q.explanation.lessonAnchor);
    if (q.reviewStatus !== 'draft' && q.reviewStatus !== 'retired') {
      if (!headings) err(q.id, `對應講義 ${q.explanation.lessonAnchor} 尚未收錄`);
      else if (q.lessonSection && !headings.includes(q.lessonSection)) err(q.id, `對應講義段落「${q.lessonSection}」不存在`);
    }
    if (q.verification && q.verification.status !== 'verified') warn(q.id, '程式題尚未通過實際執行驗證（待驗證）');
    // 程式輸出題：實際執行只比對 expectedStdout，因此正解選項必須與它逐字相同，且其他選項不可相同
    if (q.verification?.kind === 'python-stdout' && q.verification.expectedStdout !== undefined) {
      const expected = q.verification.expectedStdout.trim();
      const matches = q.options.filter((o) => o.text.trim() === expected).map((o) => o.id);
      if (matches.length !== 1 || !q.correctOptionIds.includes(matches[0]))
        err(q.id, `程式預期輸出「${expected}」與正確選項不一致（相同文字的選項：${matches.join('、') || '無'}）`);
    }
  }

  // 相似度：同一細項內兩兩比較（不同細項間只檢查極高相似度）
  const fps = input.questions.map((q) => ({ q, fp: fingerprint(q) }));
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i], b = fps[j];
      const same = a.q.competencyCode === b.q.competencyCode;
      const s = jaccard(a.fp, b.fp);
      if (s >= SIMILARITY_ERROR) err(a.q.id, `與 ${b.q.id} 高度相似（${s.toFixed(2)}），疑似重複題`);
      else if (same && s >= SIMILARITY_WARN) warn(a.q.id, `與 ${b.q.id} 相似度 ${s.toFixed(2)}，請人工確認是否只換了情境或數字`);
    }

  // 題目畫面以純文字顯示（不渲染 Markdown／KaTeX），題幹、選項、解析不可使用 LaTeX 公式，請改用一般文字或 Unicode 符號
  // 兩個 $ 之間出現數學符號（^ _ = \ { }），或 $$ 區塊，或常見 LaTeX 指令，都視為 LaTeX；「售價 $5 與 $6」這類金額不算
  const LATEX = /\$(?=[^$\n]*[\\^_{}=])[^$\n]{1,120}\$|\$\$|\\(frac|dfrac|sqrt|approx|times|cdot|min|max|mu|sigma|sum|log|leq|geq|bar|hat|left|right)\b/;
  for (const q of input.questions) {
    const texts = [q.stem, ...q.options.map((o) => o.text), ...Object.values(q.explanation ?? {}).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'object' && v ? Object.values(v) : []))];
    if (texts.some((t) => typeof t === 'string' && LATEX.test(t))) err(q.id, '題目內容含 LaTeX 公式，但題目畫面不渲染公式；請改用一般文字或 Unicode 符號（如 ÷、×、≈、μ、σ）');
  }

  // 已知錯誤說法（回歸檢查）；錯誤選項（誘答）本來就是錯誤說法，不檢查
  for (const q of input.questions) {
    const scanned = { ...q, options: q.options.filter((o) => q.correctOptionIds.includes(o.id)) };
    for (const m of findMisconceptions(JSON.stringify(scanned))) err(q.id, `已知錯誤說法［${m.id}］：${m.message}`);
  }
  for (const [code, text] of input.lessonTexts ?? [])
    for (const m of findMisconceptions(text)) err(`講義 ${code}`, `已知錯誤說法［${m.id}］：${m.message}`);

  const ids = new Set(input.questions.map((q) => q.id));
  for (const id of input.registry) if (!ids.has(id)) err(id, '已釋出的題目 ID 從題庫消失（應改為 retired，不可刪除）');

  return issues;
}

export interface CoverageRow {
  code: string;
  total: number;
  released: number;
  byTier: Record<string, number>;
  byType: Record<string, number>;
}

export function coverage(questions: VQuestion[], codes: string[]): CoverageRow[] {
  return codes.map((code) => {
    const list = questions.filter((q) => q.competencyCode === code);
    const rel = list.filter((q) => q.reviewStatus !== 'draft' && q.reviewStatus !== 'retired');
    const count = (k: 'difficultyTier' | 'questionType') =>
      rel.reduce<Record<string, number>>((m, q) => ((m[q[k] ?? '?'] = (m[q[k] ?? '?'] ?? 0) + 1), m), {});
    return { code, total: list.length, released: rel.length, byTier: count('difficultyTier'), byType: count('questionType') };
  });
}

export function headingsOf(md: string): string[] {
  const out: string[] = [];
  let inCode = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) inCode = !inCode;
    if (inCode) continue;
    const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m) out.push(m[1].replace(/[*`]/g, ''));
  }
  return out;
}
