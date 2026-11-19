import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allCompetencies, allQuestions, curriculum, getCompetency, hasLesson, lessonCodes, loadLesson } from '../../src/content';
import { questionSchema } from '../../src/content/schema';
import { REQUIRED_SECTIONS, outline } from '../../src/lib/lessonOutline';
import { headingsOf, validateContent } from '../../src/content/validate';
import registry from '../../src/content/question-registry.json';

describe('課綱資料', () => {
  it('包含 115.06 版全部官方細項，代碼唯一', () => {
    const codes = allCompetencies().map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(allCompetencies('junior')).toHaveLength(16);
    expect(allCompetencies('middle')).toHaveLength(34);
    expect(curriculum.curriculumVersion).toBe('115.06');
    expect(curriculum.isProvisional).toBe(true);
  });
  it('細項代碼與所屬主題、科目一致', () => {
    for (const c of allCompetencies()) {
      expect(c.code.startsWith(c.topic.code)).toBe(true);
      expect(c.topic.code.startsWith(c.subject.code)).toBe(true);
    }
  });
});

describe('題庫', () => {
  it('全部題目通過 schema 驗證且 ID 唯一', () => {
    const ids = allQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of allQuestions) expect(questionSchema.safeParse(q).success).toBe(true);
  });

  it('題幹不重複（同題 ID 變動不會造成錯題追蹤失聯）', () => {
    const stems = allQuestions.map((q) => q.stem + (q.code ?? ''));
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('答案與四選項解析一致：每個選項都有解析、正解存在於選項', () => {
    for (const q of allQuestions) {
      const optionIds = q.options.map((o) => o.id).sort();
      expect(Object.keys(q.explanation.optionRationales).sort(), q.id).toEqual(optionIds);
      for (const c of q.correctOptionIds) expect(optionIds, q.id).toContain(c);
      expect(getCompetency(q.competencyCode), q.id).toBeDefined();
    }
  });

  it('已釋出題目對應的講義都已收錄（解析可返回講義）', () => {
    for (const q of allQuestions.filter((x) => x.reviewStatus !== 'draft')) {
      expect(hasLesson(q.explanation.lessonAnchor), `${q.id} → ${q.explanation.lessonAnchor}`).toBe(true);
    }
  });

  it('沒有官方題被標成版權不明，自編題不冒稱官方', () => {
    for (const q of allQuestions) {
      if (q.origin.startsWith('official')) {
        expect(q.copyrightStatus).not.toBe('unknown');
        expect(q.sourceUrl).toBeTruthy();
      } else {
        expect(q.year).toBeNull();
      }
    }
  });

  it('正解選項分布不過度集中（避免出題偏誤）', () => {
    const count: Record<string, number> = {};
    for (const q of allQuestions) for (const c of q.correctOptionIds) count[c] = (count[c] ?? 0) + 1;
    const total = Object.values(count).reduce((a, b) => a + b, 0);
    for (const v of Object.values(count)) expect(v / total).toBeLessThan(0.4);
  });

  it('解析中的「正確」標示與正解一致', () => {
    for (const q of allQuestions) {
      for (const [id, text] of Object.entries(q.explanation.optionRationales)) {
        const marked = text.startsWith('正確');
        expect(marked, `${q.id} 選項 ${id}`).toBe(q.correctOptionIds.includes(id as 'A'));
      }
    }
  });

  it('題目檔案路徑與科目／主題一致', () => {
    const root = join(process.cwd(), 'src/content/questions');
    for (const subject of readdirSync(root)) {
      for (const file of readdirSync(join(root, subject))) {
        const data = JSON.parse(readFileSync(join(root, subject, file), 'utf8')) as { subject: string; topic: string }[];
        for (const q of data) {
          expect(q.subject).toBe(subject);
          expect(q.topic).toBe(file.replace('.json', ''));
        }
      }
    }
  });
});

describe('題庫驗證器（validate:content）', () => {
  it('重複 ID、答案、解析、課綱代碼、講義段落、相似度、已釋出 ID 全部通過', async () => {
    const lessonHeadings = new Map<string, string[]>();
    for (const code of lessonCodes()) lessonHeadings.set(code, headingsOf((await loadLesson(code))!));
    const issues = validateContent({
      questions: allQuestions,
      competencyCodes: new Set(allCompetencies().map((c) => c.code)),
      lessonHeadings,
      registry: registry.ids,
    });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.id}: ${e.message}`)).toEqual([]);
  });

  it('驗證器能偵測問題（防止驗證器失效）', () => {
    const q = allQuestions[0];
    const bad = { ...q, id: q.id, correctOptionIds: ['E'] as never, explanation: { ...q.explanation, optionRationales: { A: 'x' } } };
    const near = { ...q, id: q.id.replace(/\d{4}$/, '9999'), stem: q.stem + '。' };
    const issues = validateContent({
      questions: [q, bad, near],
      competencyCodes: new Set([q.competencyCode]),
      lessonHeadings: new Map([[q.competencyCode, ['原理及運作流程']]]),
      registry: ['original-L11101-9998'],
    });
    const msg = issues.map((i) => i.message).join('\n');
    expect(msg).toContain('ID 重複');
    expect(msg).toContain('不在選項中');
    expect(msg).toContain('缺少解析');
    expect(msg).toContain('高度相似');
    expect(msg).toContain('從題庫消失');
  });

  it('程式輸出題：預期輸出必須逐字等於唯一的正確選項', () => {
    const code = allQuestions.find((x) => x.verification?.kind === 'python-stdout')!;
    const wrongOpt = code.options.find((o) => !code.correctOptionIds.includes(o.id))!;
    const mismatch = { ...code, verification: { ...code.verification!, expectedStdout: wrongOpt.text } };
    const run = (q: typeof code) =>
      validateContent({ questions: [q], competencyCodes: new Set([q.competencyCode]), lessonHeadings: new Map(), registry: [] })
        .map((i) => i.message)
        .filter((m) => m.includes('預期輸出'));
    expect(run(code)).toEqual([]);
    expect(run(mismatch)[0]).toContain('與正確選項不一致');
  });

  it('題目內容使用 LaTeX 公式時報錯（題目畫面不渲染公式；Codex 稽核 F3）', () => {
    const q = allQuestions[0];
    const run = (patch: Partial<typeof q>) =>
      validateContent({ questions: [{ ...q, ...patch }], competencyCodes: new Set([q.competencyCode]), lessonHeadings: new Map(), registry: [] })
        .map((i) => i.message)
        .filter((m) => m.includes('LaTeX'));
    expect(run({ stem: '將某欄位的數值以 $(x-\\min)/(\\max-\\min)$ 轉換' })).toHaveLength(1);
    expect(run({ explanation: { ...q.explanation, summary: '約為 $1 - 1/e \\approx 63.2\\%$' } })).toHaveLength(1);
    expect(run({ stem: '將某欄位的數值以「(x − 最小值) ÷ (最大值 − 最小值)」轉換' })).toEqual([]);
    expect(run({ stem: '商品售價 $5 與 $6 的差' })).toEqual([]);
    // Codex v1.0.0 複查：沒有反斜線指令的 LaTeX 也要攔下
    expect(run({ stem: '若 $x^2=4$，x 的可能值為何？' })).toHaveLength(1);
    expect(run({ stem: '若 $x_1 + x_2 = 3$，求平均' })).toHaveLength(1);
    expect(run({ options: [{ id: 'A', text: '$y=2x$' }, ...q.options.slice(1)] })).toHaveLength(1);
    expect(run({ stem: '$$x$$' })).toHaveLength(1);
    expect(run({ stem: '若 x² = 4，x 的可能值為何？' })).toEqual([]);
  });
});

describe('講義', () => {
  it('每份講義都具備規格要求的段落且順序正確', async () => {
    for (const code of lessonCodes()) {
      const md = (await loadLesson(code))!;
      const h2 = outline(md).filter((o) => o.depth === 2).map((o) => o.text);
      const found = REQUIRED_SECTIONS.map((s) => h2.indexOf(s));
      expect(found.every((i) => i >= 0), `${code} 缺少段落：${REQUIRED_SECTIONS.filter((_, i) => found[i] < 0).join('、')}`).toBe(true);
      expect([...found].sort((a, b) => a - b), `${code} 段落順序`).toEqual(found);
    }
  });

  it('每份講義都附官方來源連結，且對應存在的課綱細項', async () => {
    for (const code of lessonCodes()) {
      expect(getCompetency(code), code).toBeDefined();
      const md = (await loadLesson(code))!;
      expect(md, code).toContain('ipas');
      expect(md.length, code).toBeGreaterThan(1500);
    }
  });

  it('講義檔案放在正確科目資料夾', () => {
    const root = join(process.cwd(), 'src/content/lessons');
    for (const subject of readdirSync(root)) for (const f of readdirSync(join(root, subject))) expect(f.startsWith(subject)).toBe(true);
  });
});

describe('官方評鑑內容（115.06）', () => {
  it('每個細項都記錄官方「評鑑內容」欄（官方留白者為 null）', () => {
    const comps = allCompetencies();
    expect(comps.length).toBe(50);
    for (const c of comps) expect(c.officialScope === null || c.officialScope.length > 2, c.code).toBe(true);
    // 官方留白的細項（依 115.06 PDF）
    const blank = comps.filter((c) => c.officialScope === null).map((c) => c.code);
    expect(blank).toEqual(['L11101', 'L11203', 'L21101', 'L21102', 'L21103', 'L22103', 'L22203', 'L23301']);
  });

  it('每個有官方評鑑內容的細項都設定覆蓋關鍵字；官方留白者不設定', () => {
    const noTerms = allCompetencies().filter((c) => c.officialScope !== null && c.scopeTerms.length === 0).map((c) => c.code);
    expect(noTerms, `有官方評鑑內容但未設定 scopeTerms：${noTerms.join('、')}`).toEqual([]);
    for (const c of allCompetencies()) if (c.officialScope === null) expect(c.scopeTerms, c.code).toEqual([]);
  });

  it('官方點名的文件、工具與方法都出現在對應講義中', async () => {
    const missing: string[] = [];
    for (const c of allCompetencies()) {
      if (!c.scopeTerms.length) continue;
      const md = (await loadLesson(c.code))!;
      for (const t of c.scopeTerms) if (!new RegExp(t, 'i').test(md)) missing.push(`${c.code}：${t}`);
    }
    expect(missing, `講義缺少官方點名項目：\n${missing.join('\n')}`).toEqual([]);
  });
});
