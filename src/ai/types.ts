import type { Question } from '../content/schema';
import type { TutorMode } from '../data/types';

/**
 * AI 導師的 Provider 介面。
 * - 遠端模式只送出 questionId、selected、optionOrder（選項顯示順序）、mode、exclude（已出過的補強題 ID），不送出任何個人資料。
 * - 任何真實 AI 服務都必須經由後端代理（保管 API 金鑰、驗證使用者、限制用量）；前端絕不持有金鑰。
 */
export interface TutorRequest {
  question: Question;
  selected: string[];
  mode: TutorMode;
  /** 原題作答當下的選項顯示順序（A～D 代號依此標示；沒有時用題庫原始順序） */
  optionOrder?: string[];
}

export interface TutorSection {
  kind: 'core' | 'why-wrong' | 'reteach' | 'compare' | 'trap';
  title: string;
  /** 純文字或簡單 Markdown（列表、粗體） */
  body: string;
}

export interface TutorResponse {
  provider: 'mock' | 'remote';
  /** 顯示在內容上方的來源標示 */
  label: string;
  sections: TutorSection[];
  /** 補強題（相同考點、不同情境）；沒有可用題目時為 null */
  reinforcementQuestionId: string | null;
}

export interface TutorProvider {
  readonly id: 'mock' | 'remote';
  readonly name: string;
  isAvailable(): boolean;
  teach(req: TutorRequest, opts?: { signal?: AbortSignal; excludeIds?: string[] }): Promise<TutorResponse>;
}

export const TUTOR_MODE_LABEL: Record<TutorMode, string> = {
  simple: '簡單解釋',
  detailed: '詳細教學',
  example: '舉例說明',
  compare: '比較易混淆觀念',
  another: '再出一題',
};
