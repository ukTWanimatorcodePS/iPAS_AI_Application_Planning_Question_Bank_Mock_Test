import { checkEndpoint, normalizeBaseUrl, type ByokConfig } from './config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  config: ByokConfig;
  apiKey: string;
  system: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  /** 測試用：替換 fetch */
  fetchImpl?: typeof fetch;
}

/** 顯示給使用者的錯誤：不含金鑰與完整回應內容 */
export class ByokError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'network' | 'config' | 'refusal' | 'server' | 'other',
  ) {
    super(message);
    this.name = 'ByokError';
  }
}

/**
 * 省 token 的設計（使用者要求：不可讓 token 消耗太快）：
 * - 一次回答最多 MAX_OUTPUT_TOKENS；提示中也要求預設 300 字內。
 * - 只帶最近 MAX_HISTORY 則對話；較早的 AI 回答截短到 OLD_REPLY_CHARS 字。
 * - 依據資料只附在當次提問（見 context.ts），舊回合不重複送出。
 * - Claude 使用較低的思考量（effort: low），對話輔導不需要深度推理。
 */
export const MAX_OUTPUT_TOKENS = 2048;
export const MAX_HISTORY = 6;
export const OLD_REPLY_CHARS = 600;

/** 支援 output_config.effort 的 Claude 模型 */
const EFFORT_MODELS = /^claude-(opus-(5-5|5|4-8|4-7|4-6)|sonnet-(5-5|5|4-6)|haiku-5-5|fable-5(-1|-2)?|mythos-5(-1|-2)?)$/;

/** 支援 server-side fallbacks 的 Claude 模型（拒答時由 API 改用其他模型續答） */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export function trimHistory(messages: ChatTurn[]): ChatTurn[] {
  const recent = messages.slice(-MAX_HISTORY);
  // 第一則必須是使用者訊息
  while (recent.length && recent[0].role !== 'user') recent.shift();
  // 最後一則（本次提問）之前的 AI 回答截短，降低每次重送的字數
  return recent.map((m, i) =>
    m.role === 'assistant' && i < recent.length - 1 && m.content.length > OLD_REPLY_CHARS ? { ...m, content: `${m.content.slice(0, OLD_REPLY_CHARS)}…（已截短）` } : m,
  );
}

export interface ChatResult {
  text: string;
  /** 達到回答長度上限而被截斷 */
  truncated: boolean;
}

/** 粗估這次請求送出的字數（顯示給使用者參考用量） */
export function requestChars(system: string, messages: ChatTurn[]): number {
  return system.length + trimHistory(messages).reduce((n, m) => n + m.content.length, 0);
}

function statusError(status: number): ByokError {
  if (status === 401 || status === 403) return new ByokError('API 金鑰無效或沒有權限，請到設定檢查金鑰。', 'auth');
  if (status === 404) return new ByokError('找不到這個 API 位址或模型名稱，請檢查設定。', 'config');
  if (status === 429) return new ByokError('超過服務的使用量或速率限制，請稍後再試，或到服務後台檢查額度。', 'rate');
  if (status >= 500) return new ByokError(`AI 服務暫時無法回應（HTTP ${status}），請稍後再試。`, 'server');
  return new ByokError(`AI 服務拒絕了這次請求（HTTP ${status}），請檢查模型名稱與設定。`, 'other');
}

function networkError(e: unknown, local: boolean): ByokError {
  if (e instanceof DOMException && e.name === 'AbortError') throw e;
  return new ByokError(
    local
      ? '連不到本機 AI 服務。請確認服務已啟動、網址與連接埠正確，並已允許本站網域的跨來源連線（CORS）。'
      : '連不到 AI 服務。可能是網路問題，或這個服務不允許瀏覽器直接連線（CORS）。',
    'network',
  );
}

/** 解析 Server-Sent Events：逐行取出 data: 內容 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trimStart();
      }
    }
    const last = buf.trim();
    if (last.startsWith('data:')) yield last.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

/** 所有對 AI 服務的請求共用：不帶 Cookie、不送出本站網址、不使用快取（OpenAI 相容與 Anthropic SDK 都套用） */
export const SAFE_FETCH_OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' } as const satisfies RequestInit;

function requestInit(apiKey: string, body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal,
    // 金鑰只放在 Authorization 標頭
    ...SAFE_FETCH_OPTIONS,
  };
}

async function streamOpenAiCompatible(o: StreamOptions, local: boolean): Promise<ChatResult> {
  const f = o.fetchImpl ?? fetch;
  const url = `${normalizeBaseUrl(o.config.baseUrl)}/chat/completions`;
  const body = {
    model: o.config.model,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'system', content: o.system }, ...trimHistory(o.messages)],
  };
  let res: Response;
  try {
    res = await f(url, requestInit(o.apiKey, body, o.signal));
  } catch (e) {
    throw networkError(e, local);
  }
  if (!res.ok || !res.body) throw statusError(res.status);
  let full = '';
  let truncated = false;
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') break;
    let evt: { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; error?: { message?: string } };
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    if (evt.error) throw new ByokError('AI 服務回傳錯誤，請檢查模型名稱與額度。', 'server');
    const delta = evt.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      o.onText(delta);
    }
    if (evt.choices?.[0]?.finish_reason === 'length') truncated = true;
  }
  return { text: full, truncated };
}

async function streamAnthropic(o: StreamOptions): Promise<ChatResult> {
  // 只在使用者選用 Claude 時才載入 SDK，不影響其他頁面的載入速度
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey: o.apiKey,
    baseURL: normalizeBaseUrl(o.config.baseUrl),
    // 使用者自備金鑰、在自己的瀏覽器直接呼叫；金鑰不經過本站任何伺服器
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    fetchOptions: { ...SAFE_FETCH_OPTIONS },
    ...(o.fetchImpl ? { fetch: o.fetchImpl } : {}),
  });
  const model = o.config.model.trim();
  const fallback = FALLBACK_MODELS.has(model);
  let full = '';
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: o.system,
        messages: trimHistory(o.messages),
        ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' as const } } : {}),
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: o.signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        full += event.delta.text;
        o.onText(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new ByokError('AI 服務基於安全政策沒有回答這個問題，請換個方式提問。', 'refusal');
    return { text: full, truncated: final.stop_reason === 'max_tokens' };
  } catch (e) {
    if (e instanceof ByokError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new DOMException('aborted', 'AbortError');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw statusError(401);
    if (e instanceof Anthropic.NotFoundError) throw statusError(404);
    if (e instanceof Anthropic.RateLimitError) throw statusError(429);
    if (e instanceof Anthropic.BadRequestError) throw new ByokError('請求格式不被接受，請檢查模型名稱是否正確。', 'config');
    if (e instanceof Anthropic.APIConnectionError) throw networkError(e, false);
    if (e instanceof Anthropic.APIError) throw statusError(e.status ?? 500);
    throw new ByokError('發生未預期的錯誤，請稍後再試。', 'other');
  }
}

/** 串流取得回答。錯誤一律轉成不含金鑰的 ByokError（使用者中止時丟出 AbortError） */
export async function streamChat(o: StreamOptions): Promise<ChatResult> {
  const check = checkEndpoint(o.config.baseUrl);
  if (!check.ok) throw new ByokError(check.message, 'config');
  if (!o.config.model.trim()) throw new ByokError('請先在設定中填寫模型名稱。', 'config');
  return o.config.kind === 'anthropic' ? streamAnthropic(o) : streamOpenAiCompatible(o, check.local);
}

/** 取得模型清單（OpenAI 相容服務的 GET /models；Claude 用 SDK 的 models.list） */
export async function listModels(config: ByokConfig, apiKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const check = checkEndpoint(config.baseUrl);
  if (!check.ok) throw new ByokError(check.message, 'config');
  if (config.kind === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey,
      baseURL: normalizeBaseUrl(config.baseUrl),
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      fetchOptions: { ...SAFE_FETCH_OPTIONS },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    try {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    } catch (e) {
      if (e instanceof Anthropic.APIError && e.status) throw statusError(e.status);
      throw networkError(e, false);
    }
  }
  const f = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${normalizeBaseUrl(config.baseUrl)}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, ...SAFE_FETCH_OPTIONS });
  } catch (e) {
    throw networkError(e, check.local);
  }
  if (!res.ok) throw statusError(res.status);
  const json = (await res.json()) as { data?: { id?: unknown }[] };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
}
