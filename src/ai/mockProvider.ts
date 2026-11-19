import { getCompetency, loadLesson, questionsFor } from '../content';
import type { Question } from '../content/schema';
import { bulletsOf, sectionBody, tableRowsOf } from '../lib/lessonOutline';
import type { TutorProvider, TutorRequest, TutorResponse, TutorSection } from './types';

/**
 * 示範模式（離線）AI 導師：不呼叫任何外部服務。
 * 內容完全由「題目的已審核解析」與「對應講義段落」重新組合而成，因此不會產生與標準答案矛盾的新說法。
 */
export const MOCK_LABEL = '示範模式：內容由本站題目解析與講義重新組合，並非即時 AI 生成；標準答案以題目解析為準。';

/** 選出補強題：同一細項、不同題目，優先不同題型（換一個情境） */
export function pickReinforcement(q: Question, excludeIds: string[] = []): Question | null {
  const pool = questionsFor({ competencyCode: q.competencyCode }).filter((x) => x.id !== q.id && !excludeIds.includes(x.id));
  if (!pool.length) return null;
  const differentType = pool.filter((x) => x.questionType !== q.questionType);
  const candidates = differentType.length ? differentType : pool;
  // 依題目 ID 與排除數量決定，讓「再出一題」每次換題且結果可重現
  const seed = [...(q.id + excludeIds.length)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return candidates[seed % candidates.length];
}

function optionText(q: Question, id: string) {
  return q.options.find((o) => o.id === id)?.text ?? id;
}

export async function buildMockTutor(req: TutorRequest, excludeIds: string[] = []): Promise<TutorResponse> {
  const { question: q, selected, mode } = req;
  const comp = getCompetency(q.competencyCode);
  const md = (await loadLesson(q.explanation.lessonAnchor)) ?? '';
  const core = bulletsOf(sectionBody(md, '必考核心觀念'));
  const cases = bulletsOf(sectionBody(md, '不同領域的實際案例'));
  const traps = bulletsOf(sectionBody(md, '常見考試陷阱'));
  const compareRows = tableRowsOf(sectionBody(md, '容易混淆的觀念比較'));
  const correct = q.correctOptionIds.map((id) => `${id}. ${optionText(q, id)}`).join('、');
  const wrongPicked = selected.filter((s) => !(q.correctOptionIds as string[]).includes(s));

  const coreSection: TutorSection = {
    kind: 'core',
    title: `核心考點：${comp?.code ?? ''} ${comp?.name ?? ''}`,
    body: [q.explanation.summary, ...(mode === 'simple' ? [] : core.slice(0, 3).map((c) => `- ${c}`))].join('\n'),
  };
  const whyWrong: TutorSection = {
    kind: 'why-wrong',
    title: '為什麼這樣選會錯',
    body: wrongPicked.length
      ? [
          ...wrongPicked.map((id) => `- 你選了 **${id}. ${optionText(q, id)}**：${q.explanation.optionRationales[id]}`),
          `- 正確答案是 **${correct}**：${q.explanation.correctRationale}`,
        ].join('\n')
      : `- 你沒有作答或已答對。正確答案是 **${correct}**：${q.explanation.correctRationale}`,
  };
  const reteach: TutorSection = {
    kind: 'reteach',
    title: '換個例子重新理解',
    body: [q.explanation.example, ...cases.slice(0, mode === 'example' ? 3 : 1)].filter(Boolean).map((x) => `- ${x}`).join('\n') || '- 本題尚未收錄額外案例，請回講義「不同領域的實際案例」段落。',
  };
  const compare: TutorSection = {
    kind: 'compare',
    title: '正確觀念 vs. 常見誤解',
    body: [
      `- 常見誤解：${q.explanation.commonTrap}`,
      ...compareRows.slice(0, mode === 'compare' ? 4 : 2).map((r) => `- **${r[0]}**：${r[1]} ／ ${r[2]}${r[3] ? `（判斷重點：${r[3]}）` : ''}`),
      ...traps.slice(0, 1).map((t) => `- 考試陷阱：${t.replace(/^❌\s*/, '')}`),
    ].join('\n'),
  };

  const byMode: Record<typeof mode, TutorSection[]> = {
    simple: [coreSection, whyWrong],
    detailed: [coreSection, whyWrong, reteach, compare],
    example: [coreSection, reteach],
    compare: [whyWrong, compare],
    another: [],
  };
  const reinforcement = pickReinforcement(q, excludeIds);
  return { provider: 'mock', label: MOCK_LABEL, sections: byMode[mode], reinforcementQuestionId: reinforcement?.id ?? null };
}

export const mockProvider: TutorProvider = {
  id: 'mock',
  name: '示範模式（離線）',
  isAvailable: () => true,
  teach: (req, opts) => buildMockTutor(req, opts?.excludeIds),
};
