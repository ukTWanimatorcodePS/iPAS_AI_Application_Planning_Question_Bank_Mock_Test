import { z } from 'zod';
import { getReleasedQuestion } from '../content';
import type { TutorProvider, TutorResponse } from './types';

/**
 * 遠端 AI 導師（選用）。
 *
 * 只有在建置時設定 VITE_AI_TUTOR_ENDPOINT（後端代理網址）才會啟用。
 * - 前端不持有、也不輸入任何 AI 服務的 API 金鑰；金鑰只存在後端代理的環境變數中。
 * - 後端負責：使用者驗證、速率與額度限制、成本上限、內容過濾、紀錄。
 * - 前端只送出 questionId、selected（原始選項 ID）、optionOrder（畫面顯示順序，讓回覆用同樣的 A～D 代號）、mode、exclude（本次已出過的補強題 ID），不含個人資料；後端自行從題庫取得題目與標準解析作為依據。
 * - 回應一律標示為 AI 生成，且不得覆蓋題目的標準答案。
 * 參考實作與部署說明：docs/AI_TUTOR.md
 */
const ENDPOINT = (import.meta.env.VITE_AI_TUTOR_ENDPOINT as string | undefined)?.trim() || '';

const responseSchema = z.object({
  sections: z
    .array(z.object({ kind: z.enum(['core', 'why-wrong', 'reteach', 'compare', 'trap']), title: z.string().max(200), body: z.string().max(4000) }))
    .max(8),
  reinforcementQuestionId: z.string().max(80).nullable(),
});

export const REMOTE_LABEL = 'AI 生成內容（經後端代理），可能有錯誤，僅供參考；標準答案以題目解析為準。';

export const remoteProvider: TutorProvider = {
  id: 'remote',
  name: '遠端 AI（需管理者設定後端代理）',
  isAvailable: () => ENDPOINT.startsWith('https://'),
  async teach(req, opts): Promise<TutorResponse> {
    if (!remoteProvider.isAvailable()) throw new Error('尚未設定 AI 導師後端代理');
    const res = await fetch(`${ENDPOINT.replace(/\/$/, '')}/tutor`, {
      method: 'POST',
      // credentials: 'include' 讓後端以自己的登入工作階段（HttpOnly Cookie）驗證使用者；前端不處理任何金鑰
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: req.question.id, selected: req.selected, optionOrder: req.optionOrder, mode: req.mode, exclude: opts?.excludeIds ?? [] }),
      signal: opts?.signal,
    });
    if (res.status === 401) throw new Error('請先登入 AI 導師服務');
    if (res.status === 429) throw new Error('今日 AI 導師使用次數已達上限，請改用示範模式或明天再試');
    if (!res.ok) throw new Error(`AI 導師服務暫時無法使用（${res.status}）`);
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('AI 導師回應格式不正確');
    const rid = parsed.data.reinforcementQuestionId;
    // 補強題必須是題庫中真實存在且同細項的題目，避免顯示未審核的題目
    // 補強題必須是仍釋出的題目（不出 draft／retired）
    // 也不可是原題或本次已出過的補強題（不完全依賴後端遵守 exclude），否則「再出一題」可能原地重複
    const excluded = new Set([req.question.id, ...(opts?.excludeIds ?? [])]);
    const cand = rid && !excluded.has(rid) ? getReleasedQuestion(rid) : undefined;
    const valid = cand && cand.competencyCode === req.question.competencyCode && cand.level === req.question.level ? cand.id : null;
    return { provider: 'remote', label: REMOTE_LABEL, sections: parsed.data.sections, reinforcementQuestionId: valid };
  },
};
