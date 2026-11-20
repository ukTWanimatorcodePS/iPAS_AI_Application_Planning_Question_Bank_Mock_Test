import { checkEndpoint, normalizeBaseUrl, presetById, type ByokConfig } from './config';
import { beginConnection, isExpired } from './connection';
import { BRIDGE_PORT, bridgeExpiresOf, isBridgeRequest, isBridgeUrl } from './bridge';
import { diagnoseLocal, type Diagnosis } from './diagnose';

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
    readonly kind: 'auth' | 'rate' | 'network' | 'config' | 'refusal' | 'server' | 'expired' | 'other',
    /** 服務有回應時的 HTTP 狀態 */
    readonly status?: number,
    /** 本機服務的自動判斷結果（服務沒開、未允許本站、模型沒下載…） */
    readonly diagnosis?: Diagnosis,
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

/** 服務的錯誤說明含金鑰或憑證相關內容時，整段不顯示 */
const HIDDEN_DETAIL = '\u0000hidden';

/** Ollama（或本站轉接程式）回 403：最可能是拒絕本站來源（Ollama 預設只允許本機網頁） */
export const LOCAL_FORBIDDEN_MESSAGE =
  '本機的 Ollama 拒絕了本站的連線（HTTP 403）。最可能的原因是 Ollama 預設只允許本機網頁連線，本站還沒有取得許可。請到設定頁展開「本機暫時許可」，按「啟動」執行轉接程式，再按「重新連線」。';

/** 其他本機程式回 403：各程式有自己的來源或權限規則，不做單一斷言 */
export const LOCAL_OTHER_FORBIDDEN_MESSAGE =
  '本機 AI 程式拒絕了這次請求（HTTP 403）。可能是該程式只允許特定網頁來源，或有自己的權限或金鑰設定；請查看該程式的說明。';

export type LocalKind = false | 'ollama' | 'other';

/** 本機位址屬於 Ollama（預設連接埠或本站轉接程式）還是其他本機程式；不是本機回傳 false */
export function localKindOf(config: Pick<ByokConfig, 'presetId' | 'baseUrl'>): LocalKind {
  const c = checkEndpoint(config.baseUrl);
  if (!c.ok || !c.local) return false;
  if (config.presetId === 'ollama' || config.presetId === 'ollama-bridge' || c.url.port === '11434' || c.url.port === String(BRIDGE_PORT)) return 'ollama';
  return 'other';
}

function statusError(status: number, detail = '', local: LocalKind = false): ByokError {
  // 各家服務的錯誤說明不同，附上服務自己的說明（安全檢查後、限制長度），方便對照該服務的文件
  const tail = detail === HIDDEN_DETAIL ? '（服務的說明含金鑰或憑證相關內容，為了安全不顯示）' : detail ? `（服務回覆：${detail}）` : '';
  // 驗證失敗的說明最可能回顯金鑰：一律不附服務說明
  if (local === 'ollama' && status === 403) return new ByokError(LOCAL_FORBIDDEN_MESSAGE, 'config', status);
  if (local === 'other' && status === 403) return new ByokError(LOCAL_OTHER_FORBIDDEN_MESSAGE, 'config', status);
  if (status === 401 || status === 403) return new ByokError('API 金鑰無效或沒有權限，請到設定檢查金鑰。', 'auth', status);
  if (status === 404) return new ByokError(`找不到這個 API 位址或模型名稱，請檢查設定。${tail}`, 'config', status);
  if (status === 429) return new ByokError(`超過服務的使用量或速率限制，請稍後再試，或到服務後台檢查額度。${tail}`, 'rate', status);
  if (status >= 500) return new ByokError(`AI 服務暫時無法回應（HTTP ${status}），請稍後再試。${tail}`, 'server', status);
  return new ByokError(`AI 服務拒絕了這次請求（HTTP ${status}），請檢查模型名稱與設定。${tail}`, 'other', status);
}

/**
 * 提到金鑰、憑證或驗證資訊的說明：可能回顯（部分）金鑰，整段不顯示（寧可多藏）。
 * 「token」只在像憑證的用法才算（invalid token、token: …），一般的 max_tokens、input tokens 等長度說明不受影響。
 */
const CREDENTIAL_WORDS = [
  /api[\s_-]?key|x-api-key|access[\s_-]?token|auth[\s_-]?token|id[\s_-]?token|refresh[\s_-]?token|bearer|secret|password|passwd|credential|authori[sz]|authenticat|unauthori[sz]ed|forbidden|金鑰|密鑰|憑證|密碼|權杖/i,
  /\b(invalid|incorrect|expired|revoked|missing|malformed|bad|wrong|unknown|provided)\s+(api\s+)?(token|key)s?\b/i,
  /\b(token|key)s?\s*(is\s+)?(invalid|incorrect|expired|revoked|missing|malformed|not valid)\b/i,
  /\b(token|key)\s*[:=]/i,
];

/** 去掉所有分隔符號、統一大小寫：服務可能把金鑰切段、用空白／點／連字號接起來回顯 */
const compact = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

/** 說明中是否出現金鑰的任何一段（忽略分隔符號後比對；金鑰的任何連續 6 個英數字出現就算） */
function echoesKey(s: string, apiKey: string): boolean {
  const k = compact(apiKey);
  if (!k) return false;
  const m = compact(s);
  if (k.length <= 6) return m.includes(k);
  for (let i = 0; i + 6 <= k.length; i++) if (m.includes(k.slice(i, i + 6))) return true;
  return false;
}

/**
 * 服務的錯誤說明，分成兩份：
 * - raw：只在程式內判斷用（例如是否不支援某個參數），不顯示
 * - shown：可以顯示的版本。只取 JSON 的 error.message／message／detail；不是 JSON（例如 HTML 錯誤頁）就不顯示；
 *   提到金鑰／憑證、或出現金鑰任何一段時整段隱藏；壓成一行、最多 160 字
 */
export function safeDetail(msg: unknown, apiKey: string): { raw: string; shown: string } {
  const raw = (typeof msg === 'string' ? msg : '').replace(/\s+/g, ' ').trim();
  if (!raw) return { raw, shown: '' };
  if (/<[a-z!/][^>]*>/i.test(raw)) return { raw, shown: '' }; // HTML 片段：不顯示雜亂的錯誤頁
  if (CREDENTIAL_WORDS.some((r) => r.test(raw)) || echoesKey(raw, apiKey)) return { raw, shown: HIDDEN_DETAIL };
  const s = raw.replace(/\b(sk|pk|rk|AIza|gsk|xai)[-_A-Za-z0-9]{12,}/g, '••••');
  return { raw, shown: s.length > 160 ? `${s.slice(0, 160)}…` : s };
}

/** 從 JSON 物件取出錯誤說明（各家格式：error.message、error 字串、message、detail） */
function errorMessageOf(j: unknown): string {
  if (!j || typeof j !== 'object') return '';
  const o = j as { error?: unknown; message?: unknown; detail?: unknown };
  const e = o.error;
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : e;
  for (const v of [m, o.message, o.detail]) if (typeof v === 'string' && v.trim()) return v;
  return '';
}

async function readError(res: Response, apiKey: string): Promise<{ raw: string; shown: string }> {
  let text: string;
  try {
    text = (await res.text()).slice(0, 8000);
  } catch {
    return { raw: '', shown: '' };
  }
  try {
    return safeDetail(errorMessageOf(JSON.parse(text)), apiKey);
  } catch {
    return { raw: text.replace(/\s+/g, ' ').slice(0, 500), shown: '' }; // 不是 JSON：不顯示原文
  }
}

/**
 * 本機服務失敗時自動判斷原因，換成具體可照做的說明（服務沒開、未允許本站、模型沒下載）。
 * 雲端服務或判斷不出來時，維持原本的錯誤。
 */
async function explain(e: unknown, config: ByokConfig, fetchImpl?: typeof fetch): Promise<unknown> {
  if (!(e instanceof ByokError) || e.diagnosis) return e;
  const check = checkEndpoint(config.baseUrl);
  if (!check.ok || !check.local) return e;
  // 本站轉接程式連不到：沒有啟動，或許可時間已到（轉接程式到期會自動關閉）
  if (e.kind === 'network' && isBridgeUrl(config.baseUrl))
    return new ByokError('連不到本機轉接程式：可能還沒啟動，或許可時間已到而自動關閉。請到設定頁展開「本機暫時許可」按「啟動」，再按「重新連線」。', 'network');
  if (e.kind !== 'network' && e.status !== 404 && e.status !== 400) return e;
  const d = await diagnoseLocal(config, e.kind === 'network' ? undefined : e.status, fetchImpl);
  return d ? new ByokError(d.message, e.kind, e.status, d) : e;
}

function networkError(e: unknown, local: boolean): ByokError {
  if (e instanceof DOMException && e.name === 'AbortError') throw e;
  return new ByokError(
    local
      ? '連不到本機 AI 服務。請確認服務已啟動、網址與連接埠正確，並已允許本站網域的跨來源連線（CORS）。'
      : '連不到 AI 服務。可能是網路問題，或這個服務不允許網頁直接連線（CORS）：服務能用程式呼叫 API，不代表允許瀏覽器直接連線，這類服務無法在本站使用。',
    'network',
  );
}

/**
 * 依 SSE 規範把文字切成事件：同一事件的多行 data: 以換行合併，空行結束一個事件；
 * 忽略註解（: 開頭）與其他欄位（event:、id:、retry:）。
 */
class SseParser {
  private buf = '';
  private data: string[] = [];
  feed(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buf.search(/\r\n|\r|\n/)) >= 0) {
      // 區塊最後是 \r：可能是被切開的 \r\n，等下一個區塊再判斷，避免算成兩個換行
      if (this.buf[nl] === '\r' && nl === this.buf.length - 1) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + (this.buf.startsWith('\r\n', nl) ? 2 : 1));
      this.line(line, out);
    }
    return out;
  }
  end(): string[] {
    const out: string[] = [];
    if (this.buf.endsWith('\r')) this.buf = this.buf.slice(0, -1);
    if (this.buf) this.line(this.buf, out);
    this.buf = '';
    this.line('', out);
    return out;
  }
  private line(line: string, out: string[]) {
    if (line === '') {
      if (this.data.length) out.push(this.data.join('\n'));
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
  }
}

/** 解析 Server-Sent Events：逐一取出每個事件的 data 內容（多行 data 合併） */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.feed(decoder.decode(value, { stream: true }));
    }
    yield* parser.feed(decoder.decode());
    yield* parser.end();
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

type TokenParam = 'max_tokens' | 'max_completion_tokens';
/** 一次回應最多接收的字元數（避免異常回應占用大量記憶體） */
const MAX_RESPONSE_CHARS = 2_000_000;
/** 每個「位址＋模型」實際接受的長度參數名稱（只在記憶體）：成功一次後就直接用，不再試錯 */
const tokenParamLearned = new Map<string, TokenParam>();

/**
 * 回答長度上限參數名稱的預設值：OpenAI 官方 API 用 max_completion_tokens（新模型只接受這個），
 * 其他 OpenAI 相容服務普遍用 max_tokens。這只是預設；代理或個別模型不同時，依服務的明確回覆改用另一個。
 */
function defaultTokenParam(baseUrl: string): TokenParam {
  const c = checkEndpoint(baseUrl);
  return c.ok && c.url.hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
}

/** 解析結構化錯誤：合法 JSON 或受限轉換的 Python 表示法。不是結構化格式回傳 null；看起來是結構化但無法解析回傳空陣列（保守不重送） */
/**
 * 錯誤紀錄＋從父層錯誤容器繼承的說明文字（type／code／msg／message）。
 * 子層（detail、errors）要繼承父層的範圍限定，例如父層說「以下只適用其他模型」（第十一輪 R11-1）。
 */
export interface ErrorRecord {
  rec: Record<string, unknown>;
  inherited: string;
}

function structuredErrorRecords(raw: string): ErrorRecord[] | null {
  const t = raw.trim();
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const body = t.slice(start);
  // 只有整段（或冒號後的整段）是物件／陣列時才視為結構化；一般英文句子中的括號不算
  if (start > 0 && !/[:=]\s*$/.test(t.slice(0, start))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Python repr（pydantic 等）：單引號、tuple、None／True／False。含跳脫或撇號等無法可靠轉換時放棄
    if (/\\|\w'\w/.test(body)) return [];
    const converted = body
      .replace(/'/g, '"')
      .replace(/\(/g, '[')
      .replace(/\)/g, ']')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');
    try {
      parsed = JSON.parse(converted);
    } catch {
      return [];
    }
  }
  const out: ErrorRecord[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const ERROR_KEYS = ['type', 'code', 'msg', 'message', 'loc', 'param', 'parameter', 'field'];
  // 只走錯誤容器：根層級、error、errors、detail；不進入 input、body 等被拒資料
  const ownText = (v: Record<string, unknown>) =>
    ['type', 'code', 'msg', 'message']
      .map((k) => v[k])
      .filter((x): x is string => typeof x === 'string')
      .join(' ');
  const visit = (v: unknown, depth: number, inherited: string) => {
    if (depth > 4) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1, inherited));
    if (!isObj(v)) return;
    if (ERROR_KEYS.some((k) => k in v)) out.push({ rec: v, inherited });
    // 只把錯誤容器本身的說明欄位往下傳；input、body 等被拒資料不會進入
    const next = `${inherited} ${ownText(v)}`.trim();
    for (const k of ['error', 'errors', 'detail']) if (k in v) visit(v[k], depth + 1, next);
  };
  visit(parsed, 0, '');
  return out;
}

/**
 * 服務是否「明確表示不支援這個參數名稱」：只有這種情況才換另一個名稱重送。
 * 內容太長（例如「input tokens plus max_tokens exceed the context window」）等其他 400 不重送。
 */
export function rejectsTokenParam(raw: string, param: TokenParam): boolean {
  const p = param.replace('_', '[_ ]?');
  const other = param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
  const q = String.raw`['"\x60]`;
  const hasParam = new RegExp(String.raw`\b${p}\b`, 'i');
  const isParam = (v?: string) => !!v && new RegExp(String.raw`^${p}$`, 'i').test(v.trim());
  // 參數名稱是對的、只是「值」不對的說法
  const VALUE = /must be|should be|expected|integer|number|positive|negative|greater|less than|at most|at least|maximum|minimum|range|exceed|too (large|small|long|high|low)|limit|invalid|parsing|_type\b/i;
  // 「名稱不被接受」的說法
  const NAME_REJECTED = /extra_forbidden|extra inputs|unrecognized|unsupported|unknown (field|parameter|argument|key)|not (supported|allowed|permitted|recognized)|additional propert/i;
  // 文字：否定詞必須直接修飾目前的參數名稱（第七輪 R7-1）
  const NEG = String.raw`(unknown|unrecognized|unsupported|unexpected|extra)`;
  const KIND = String.raw`(request\s+)?(parameter|field|argument|key|input|property)s?(\s+supplied)?`;
  const before = new RegExp(String.raw`\b${NEG}\s+${KIND}\s*[:=,]?\s*${q}?${p}\b`, 'i');
  const after = new RegExp(String.raw`\b${p}${q}?\s+(${KIND}\s+)?(is|are)\s+(not\s+(supported|allowed|permitted|recognized)|unsupported|unrecognized|unknown)`, 'i');
  const namesParam = (t: string) => before.test(t) || after.test(t);
  // 範圍限定或條件：只對其他模型／端點／版本，或在某條件下才成立（第九、十輪）。出現時一律不重送
  const SCOPED =
    /\b(for|with|on|in|to)\s+(an?\s+|the\s+)?(other|different|some|older|newer|legacy|certain|specific|another)\b|\bother\s+(models?|endpoints?|versions?|apis?)\b|\b(switch|switching|migrate|migrating|upgrade|upgrading|move|moving|change|changing)\s+to\b|\b(if|when|unless|depending)\b/i;

  // 1. 結構化錯誤（JSON、pydantic 等）：真正解析後，只從明確的錯誤容器取出錯誤紀錄
  //    （根層級、error、errors、detail；不進入 input／body 等被拒資料，第九輪 R9-1）。
  //    錯誤種類只看 type／code／msg／message，指向哪個欄位只看 loc 最後一項／param／parameter／field／name。
  //    是結構化錯誤、卻沒有明確指出「目前參數名稱不被接受」，或無法可靠解析：保守不重送。
  const records = structuredErrorRecords(raw);
  if (records !== null) {
    for (const { rec: r, inherited } of records) {
      const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined);
      const loc = Array.isArray(r.loc) ? r.loc.filter((x): x is string => typeof x === 'string') : [];
      const kindText = ['type', 'code', 'msg', 'message'].map(str).filter(Boolean).join(' ');
      const located = isParam(loc[loc.length - 1]) || ['param', 'parameter', 'field', 'name'].some((k) => isParam(str(k))) || namesParam(kindText);
      // invalid_request_error 等通用錯誤類別不代表「值不對」，判斷值錯誤前先去掉
      const kindForValue = kindText.replace(/\b(invalid_request_error|bad_request|api_error|request_error)\b/gi, '');
      // 自身或任何父層錯誤容器的說明帶範圍限定：不算目前請求的名稱錯誤
      if (located && NAME_REJECTED.test(kindText) && !VALUE.test(kindForValue) && !SCOPED.test(`${inherited} ${kindText}`)) return true;
    }
    return false;
  }

  // 2. 文字敘述：依句子切開
  const clauses = raw
    .split(/[.;\n]/)
    .map((c) => c.trim())
    .filter(Boolean);
  const rejected = clauses.some(namesParam);
  const valueProblem = clauses.some((c) => hasParam.test(c) && VALUE.test(c));

  // 3. 「改用另一個名稱」的建議：只套用於目前請求。限定其他模型／端點／版本或附條件時不套用（第八輪 R8-2）；
  //    目前參數只是值不對（沒有說名稱不被接受）時也不套用。
  const instead = new RegExp(String.raw`use ${q}?${other}${q}? instead|replace[^.;]{0,30}with ${q}?${other}`, 'i');
  const insteadClause = clauses.find((c) => instead.test(c));
  // 限定範圍或條件出現在整則訊息的任何一句（包含前一句的條件），都不套用到目前請求（第九輪 R9-2）
  if (SCOPED.test(raw)) return false;
  if (insteadClause && (rejected || !valueProblem)) return true;

  // 4. 名稱本身沒問題、只是值不對：不重送；其他情況只在否定詞直接修飾目前參數時重送
  if (valueProblem) return false;
  return rejected;
}

function isJson(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

type Completion = { choices?: { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }[] };

async function streamOpenAiCompatible(o: StreamOptions, local: boolean): Promise<ChatResult> {
  const f = o.fetchImpl ?? fetch;
  const url = `${normalizeBaseUrl(o.config.baseUrl)}/chat/completions`;
  const learnKey = `${url}\n${o.config.model.trim()}`;
  const messages = [{ role: 'system', content: o.system }, ...trimHistory(o.messages)];
  const send = async (param: TokenParam) => {
    try {
      return await f(url, requestInit(o.apiKey, { model: o.config.model, stream: true, [param]: MAX_OUTPUT_TOKENS, messages }, o.signal));
    } catch (e) {
      throw networkError(e, local);
    }
  };
  let param = tokenParamLearned.get(learnKey) ?? defaultTokenParam(o.config.baseUrl);
  let res = await send(param);
  if (res.status === 400) {
    const err = await readError(res, o.apiKey);
    // 只有服務明確表示「不支援這個參數名稱」才換另一個名稱重送一次（是否計費依各服務而定）
    if (!rejectsTokenParam(err.raw, param)) throw statusError(400, err.shown);
    param = param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    res = await send(param);
  }
  if (!res.ok) throw statusError(res.status, (await readError(res, o.apiKey)).shown, local ? localKindOf(o.config) : false);
  if (!res.body) throw new ByokError('AI 服務沒有回傳回答內容，請檢查模型名稱與設定。', 'server');
  tokenParamLearned.set(learnKey, param);

  let full = '';
  let truncated = false;
  const take = (evt: Completion & { error?: unknown }) => {
    const msg = errorMessageOf(evt);
    if (evt.error !== undefined && evt.error !== null) {
      const d = safeDetail(msg, o.apiKey).shown;
      throw new ByokError(
        `AI 服務回傳錯誤，請檢查模型名稱與額度。${d === HIDDEN_DETAIL ? '（服務的說明含金鑰或憑證相關內容，為了安全不顯示）' : d ? `（服務回覆：${d}）` : ''}`,
        'server',
      );
    }
    const c = evt.choices?.[0];
    const piece = c?.delta?.content ?? c?.message?.content;
    if (typeof piece === 'string' && piece) {
      full += piece;
      o.onText(piece);
    }
    if (c?.finish_reason === 'length') truncated = true;
  };
  const takeText = (data: string): boolean => {
    if (data.trim() === '[DONE]') return true;
    let evt: unknown;
    try {
      evt = JSON.parse(data);
    } catch {
      return false;
    }
    if (evt && typeof evt === 'object') take(evt as Completion);
    return false;
  };

  // 不依 content-type 判斷格式（各家標示不一）：看回應的第一個字元。
  // { 或 [ 開頭＝完整 JSON（或每行一個 JSON）；其他＝SSE 串流
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseParser();
  // json＝完整 JSON（可能是多行排版，讀完才解析）；ndjson＝每行一個 JSON（逐行處理，遇到 [DONE] 立即結束）
  let mode: 'unknown' | 'sse' | 'json' | 'ndjson' = 'unknown';
  let pending = '';
  let total = 0;
  let finished = false; // 收到 [DONE]
  let completed = false; // 正常讀完
  const tooLarge = () => new ByokError('AI 服務的回應過大，已停止接收。請確認 API 位址與模型設定。', 'server');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
      total += text.length;
      if (total > MAX_RESPONSE_CHARS) throw tooLarge();
      if (mode === 'unknown') {
        pending += text;
        const t = pending.trimStart();
        if (t) mode = t[0] === '{' || t[0] === '[' ? 'json' : 'sse';
        if (mode === 'sse') {
          for (const d of sse.feed(pending)) if ((finished = takeText(d))) break;
          pending = '';
        }
      } else if (mode === 'json' || mode === 'ndjson') pending += text;
      else for (const d of sse.feed(text)) if ((finished = takeText(d))) break;
      // 第一行本身就是完整 JSON：判定為每行一個 JSON，逐行處理（第六輪 R6-2：收到 [DONE] 不再等連線關閉）
      if (mode === 'json') {
        // 略過開頭的空白行，以第一個非空白的完整行判斷（第七輪 R7-2）
        const body = pending.replace(/^(?:[ \t]*\r?\n)+/, '');
        const nl = body.indexOf('\n');
        if (nl >= 0 && isJson(body.slice(0, nl))) {
          mode = 'ndjson';
          pending = body;
        }
      }
      if (mode === 'ndjson') {
        let nl: number;
        while (!finished && (nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl).replace(/\r$/, '');
          pending = pending.slice(nl + 1);
          if (line.trim()) finished = takeText(line);
        }
      }
      if (done || finished) break;
    }
    if (mode === 'ndjson' && !finished && pending.trim()) finished = takeText(pending);
    if (mode === 'sse' && !finished) for (const d of sse.end()) if ((finished = takeText(d))) break;
    if (mode === 'json') {
      let whole: unknown;
      try {
        whole = JSON.parse(pending);
      } catch {
        whole = undefined;
      }
      if (whole !== undefined) {
        if (whole && typeof whole === 'object') take(whole as Completion);
      } else for (const line of pending.split(/\r?\n/)) if (line.trim() && (finished = takeText(line))) break; // 每行一個 JSON，遇到 [DONE] 停止
    }
    completed = !finished;
  } finally {
    // 收到結束標記、超過上限、服務回報錯誤或其他例外：取消仍開啟的回應；正常讀完才只釋放
    if (completed) reader.releaseLock();
    else void reader.cancel().catch(() => {});
  }
  if (!full.trim()) {
    // 沒有任何可顯示的內容：不算問答成功（不亮綠燈）
    throw new ByokError(
      truncated
        ? '回答在產生內容前就達到長度上限（推理模型可能把額度用在思考），請改用其他模型或稍後再試。'
        : 'AI 服務沒有回傳任何回答內容。請確認模型名稱，以及 API 位址是 OpenAI Chat Completions 相容介面（通常以 /v1 結尾）。',
      'server',
    );
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
    if (!full.trim())
      throw new ByokError(
        final.stop_reason === 'max_tokens' ? '回答在產生內容前就達到長度上限，請改用其他模型或稍後再試。' : 'AI 服務沒有回傳任何回答內容，請確認模型名稱。',
        'server',
      );
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

/**
 * 包一層 fetch，記下轉接程式回應的到期時間（網站倒數以它為準）。
 * 只信任「設定就是本站轉接位址、且請求確實送往轉接程式」的回應；雲端服務或其他本機程式帶同名標頭一律忽略，
 * 不能用來延長網站的 30 分鐘。
 */
function trackBridge(fetchImpl: typeof fetch | undefined, config: ByokConfig): { fetch: typeof fetch; expires: () => number | undefined } {
  const base = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  if (!isBridgeUrl(config.baseUrl)) return { fetch: base, expires: () => undefined };
  let expires: number | undefined;
  const wrapped = (async (...a: Parameters<typeof fetch>) => {
    const res = await base(...a);
    const input = a[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isBridgeRequest(url)) expires = bridgeExpiresOf(res) ?? expires;
    return res;
  }) as typeof fetch;
  return { fetch: wrapped, expires: () => expires };
}

/** 串流取得回答。錯誤一律轉成不含金鑰的 ByokError（使用者中止時丟出 AbortError） */
export async function streamChat(o: StreamOptions): Promise<ChatResult> {
  const check = checkEndpoint(o.config.baseUrl);
  if (!check.ok) throw new ByokError(check.message, 'config');
  if (!o.config.model.trim()) throw new ByokError('請先在設定中填寫模型名稱。', 'config');
  // 連線已滿 30 分鐘：提問不能自動開始新的一段，必須由使用者按「重新連線」
  if (isExpired(o.config, o.apiKey))
    throw new ByokError(
      isBridgeUrl(o.config.baseUrl)
        ? '本機轉接程式的許可時間已到，已自動中斷。請在設定頁「本機暫時許可」按「啟動」再執行一次，再按「重新連線」。'
        : '本次連線已滿 30 分鐘，已自動中斷。請按「重新連線」開始新的 30 分鐘。',
      'expired',
    );
  const finish = beginConnection(o.config, o.apiKey);
  const bridge = trackBridge(o.fetchImpl, o.config);
  try {
    const result = await (o.config.kind === 'anthropic' ? streamAnthropic(o) : streamOpenAiCompatible({ ...o, fetchImpl: bridge.fetch }, check.local));
    finish({ phase: 'online', localExpiresAt: bridge.expires() });
    return result;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      finish({ phase: 'aborted' });
      throw e;
    }
    const err = await explain(e, o.config, o.fetchImpl);
    finish({ phase: 'offline', message: err instanceof ByokError ? err.message : '連線失敗。' });
    throw err;
  }
}

/** 取得模型清單（OpenAI 相容服務的 GET /models；Claude 用 SDK 的 models.list）。不改變連線狀態 */
export async function listModels(config: ByokConfig, apiKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
  try {
    return await listModelsRequest(config, apiKey, fetchImpl);
  } catch (e) {
    throw await explain(e, config, fetchImpl);
  }
}

export interface VerifyResult {
  /** 是否已確認連線（false＝這個服務沒有提供模型清單，只能在第一次提問時確認） */
  verified: boolean;
  models: string[];
  /** 無法確認時的額外提示（例如可能漏填 /v1） */
  hint?: string;
}

/** 沒有提供模型清單端點時常見的狀態碼 */
const NO_MODELS_ENDPOINT = new Set([404, 405, 501]);

/**
 * 「連線」：用取得模型清單確認服務可連線；不產生回答，所以不消耗 token。
 * 成功後開始一段最長 30 分鐘的連線（見 connection.ts）。
 * - 本機服務：清單必須有所選模型，空清單或格式不對都算失敗（並自動判斷原因）。
 * - 雲端服務：清單格式與是否需要金鑰各家不同（例如有的服務不用金鑰也能讀清單），
 *   只能確認服務有回應；金鑰與所選模型是否能回答，要到第一次提問才知道。
 * - 模型清單端點回 404／405／501（沒有提供，或位址不對）時，不論選哪個服務都不判為失敗：回傳 verified: false，
 *   維持未連線並說明，第一次提問成功後才開始計時（位址真的不對時，提問會顯示錯誤）。
 */
export async function verifyConnection(config: ByokConfig, apiKey: string, fetchImpl?: typeof fetch): Promise<VerifyResult> {
  const check = checkEndpoint(config.baseUrl);
  if (!check.ok) throw new ByokError(check.message, 'config');
  if (!config.model.trim()) throw new ByokError('請先填寫模型名稱（可按「取得模型清單」）。', 'config');
  const finish = beginConnection(config, apiKey);
  const bridge = trackBridge(fetchImpl, config);
  let listed = false;
  try {
    const models = await listModelsRequest(config, apiKey, config.kind === 'anthropic' ? fetchImpl : bridge.fetch);
    listed = true;
    const model = config.model.trim();
    if (check.local && !models.includes(model)) throw new ByokError(`這個服務沒有模型「${model}」，請從模型清單選擇。`, 'config', 404);
    finish({ phase: 'online', localExpiresAt: bridge.expires() });
    return { verified: true, models };
  } catch (e) {
    // 依端點實際能力判斷，不依服務選單：同一個代理不論選哪個服務，結果都一樣
    if (!listed && e instanceof ByokError && e.status !== undefined && NO_MODELS_ENDPOINT.has(e.status)) {
      const preset = presetById(config.presetId);
      // 已知的本機服務一定有模型清單：拿不到時最可能是位址少了 /v1（不自動補上，各家路徑不同）
      const pathHint =
        check.local && (preset.local || !/\/v1\/?$/.test(check.url.pathname))
          ? `請確認 API 基底位址，可能漏填 /v1${preset.local ? `（預設是 ${preset.baseUrl}）` : ''}。`
          : '';
      finish({ phase: 'unverified', message: `這個服務沒有提供模型清單，無法事先確認連線。${pathHint}可以直接提問；第一次回答成功後會顯示已連線並開始 30 分鐘計時。` });
      return { verified: false, models: [], hint: pathHint };
    }
    const err = await explain(e, config, fetchImpl);
    finish({ phase: 'offline', message: err instanceof ByokError ? err.message : '連線失敗，請確認服務位址與模型名稱。' });
    throw err;
  }
}

async function listModelsRequest(config: ByokConfig, apiKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
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
  if (!res.ok) throw statusError(res.status, (await readError(res, apiKey)).shown, localKindOf(config));
  let json: { data?: unknown };
  try {
    json = (await res.json()) as { data?: unknown };
  } catch {
    json = {};
  }
  // 不是模型清單（例如位址指到其他程式）：不能當成連線成功
  if (!json || !Array.isArray(json.data)) throw new ByokError('這個位址的回應不是 AI 服務的模型清單，請確認 API 位址（通常以 /v1 結尾）與連接埠。', 'config');
  return (json.data as { id?: unknown }[]).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
}
