/**
 * 自備 API（BYOK, bring your own key）設定與金鑰保管。
 *
 * 安全原則（詳見 docs/AI_TUTOR.md）：
 * - 本站程式碼與公開 repo 不含任何金鑰；金鑰只由使用者在自己的瀏覽器輸入。
 * - 金鑰不寫入 IndexedDB，因此不會出現在學習紀錄、JSON 備份或 CSV 匯出中。
 * - 預設只存在這個分頁（sessionStorage，關閉分頁即清除）；使用者勾選「記住」才存到這台裝置（localStorage）。
 * - 金鑰只送往使用者選定、通過檢查的 API 位址：必須是 https，或本機（localhost／127.0.0.1）的 http。
 * - 不把金鑰放進網址、不寫進 console、不放進錯誤訊息。
 */

export type ByokKind = 'anthropic' | 'openai-compatible';

export interface ByokPreset {
  id: string;
  label: string;
  kind: ByokKind;
  baseUrl: string;
  /** 本機服務：金鑰可留空 */
  local: boolean;
  needsKey: boolean;
  defaultModel: string;
  hint: string;
}

export const BYOK_PRESETS: ByokPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude（雲端）',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    local: false,
    needsKey: true,
    defaultModel: 'claude-opus-5-5',
    hint: '到 Anthropic Console 建立 API 金鑰。用量依 Anthropic 計費，建議在 Console 設定花費上限。',
  },
  {
    id: 'openai',
    label: 'OpenAI（雲端）',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
    needsKey: true,
    defaultModel: '',
    hint: '到 OpenAI 平台建立 API 金鑰；模型名稱可按「取得模型清單」選擇。用量依 OpenAI 計費。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini（雲端，OpenAI 相容介面）',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    local: false,
    needsKey: true,
    defaultModel: '',
    hint: '到 Google AI Studio 建立 API 金鑰。是否允許瀏覽器直接連線以 Google 服務為準，可先按「測試連線」。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（雲端，多家模型）',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    local: false,
    needsKey: true,
    defaultModel: '',
    hint: '到 OpenRouter 建立 API 金鑰，可設定金鑰的花費上限。',
  },
  {
    id: 'ollama',
    label: 'Ollama（本機）',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    local: true,
    needsKey: false,
    defaultModel: '',
    hint: '在自己電腦執行 Ollama。需允許本站網域連線：啟動前設定環境變數 OLLAMA_ORIGINS（例如本站網址的來源）。資料不離開你的電腦。',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本機）',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    local: true,
    needsKey: false,
    defaultModel: '',
    hint: '在 LM Studio 開啟本機伺服器並啟用 CORS。資料不離開你的電腦。',
  },
  {
    id: 'custom',
    label: '其他 OpenAI 相容服務（自訂網址）',
    kind: 'openai-compatible',
    baseUrl: '',
    local: false,
    needsKey: false,
    defaultModel: '',
    hint: '輸入服務提供的 OpenAI 相容 API 位址（通常以 /v1 結尾）。請確認網址來自你信任的服務：金鑰會送到這個位址。',
  },
];

export function presetById(id: string | undefined): ByokPreset {
  return BYOK_PRESETS.find((p) => p.id === id) ?? BYOK_PRESETS[0];
}

/** 不含金鑰的設定（可存在 localStorage） */
export interface ByokConfig {
  presetId: string;
  kind: ByokKind;
  baseUrl: string;
  model: string;
  /** 是否把金鑰記在這台裝置（localStorage）；否則只存在這個分頁 */
  rememberKey: boolean;
}

export const CONFIG_KEY = 'ipas-ai-byok-config';
export const KEY_STORAGE_KEY = 'ipas-ai-byok-key';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const KNOWN_HOSTS = new Set(['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'openrouter.ai']);

export type EndpointCheck = { ok: true; url: URL; local: boolean; known: boolean } | { ok: false; message: string };

/** 檢查 API 位址：只允許 https，或本機的 http；不允許網址內含帳密、查詢字串或片段 */
export function checkEndpoint(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: '請輸入完整網址，例如 https://api.example.com/v1' };
  }
  if (url.username || url.password) return { ok: false, message: '網址不可包含帳號或密碼。金鑰請填在「API 金鑰」欄位。' };
  if (url.search || url.hash) return { ok: false, message: '網址不可包含 ? 或 # 之後的參數（避免把金鑰或資料放進網址）。' };
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol === 'http:' && !local)
    return { ok: false, message: '為了保護金鑰，只允許 https 網址；只有本機（localhost、127.0.0.1）可以使用 http。' };
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, message: '只支援 https（或本機 http）網址。' };
  return { ok: true, url, local, known: KNOWN_HOSTS.has(url.hostname) };
}

/** 去掉結尾斜線，方便組合路徑 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // 私密模式或被封鎖時，金鑰只留在記憶體
  }
}

/**
 * 金鑰與它所屬的服務一起保存：{ key, presetId, origin }。
 * 讀取時只有「綁定的服務與來源」和目前設定完全相同才會回傳金鑰，
 * 因此任何讀取路徑都不可能把某個服務的金鑰配上另一個服務的設定（Codex r2 R1）。
 */
interface KeyRecord {
  key: string;
  presetId: string;
  origin: string;
}

/** 'unloaded' 表示尚未從儲存區讀取；null 表示沒有金鑰 */
let memoryRecord: KeyRecord | null | 'unloaded' = 'unloaded';
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}

// 其他分頁修改設定或金鑰時（localStorage 的 storage 事件），丟掉記憶體中的快取並通知畫面重新讀取
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === CONFIG_KEY || e.key === KEY_STORAGE_KEY) {
      memoryRecord = 'unloaded';
      emit();
    }
  });
}
export function subscribeByok(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function byokVersion(): number {
  return version;
}

export function loadConfig(): ByokConfig | null {
  try {
    const raw = safeStorage('local')?.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<ByokConfig>;
    if (typeof c.baseUrl !== 'string' || typeof c.model !== 'string' || (c.kind !== 'anthropic' && c.kind !== 'openai-compatible')) return null;
    return { presetId: String(c.presetId ?? 'custom'), kind: c.kind, baseUrl: c.baseUrl, model: c.model, rememberKey: c.rememberKey === true };
  } catch {
    return null;
  }
}

function parseKeyRecord(raw: string | null | undefined): KeyRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<KeyRecord>;
    if (typeof r.key === 'string' && typeof r.presetId === 'string' && typeof r.origin === 'string' && r.key) return { key: r.key, presetId: r.presetId, origin: r.origin };
  } catch {
    // 舊格式（只有金鑰字串、沒有綁定服務）：無法確認屬於哪個服務，一律不沿用，請使用者重新輸入
  }
  return null;
}

function loadKeyRecord(): KeyRecord | null {
  if (memoryRecord !== 'unloaded') return memoryRecord;
  const rec = parseKeyRecord(safeStorage('session')?.getItem(KEY_STORAGE_KEY)) ?? parseKeyRecord(safeStorage('local')?.getItem(KEY_STORAGE_KEY));
  memoryRecord = rec;
  return rec;
}

/** 金鑰是否綁定在這份設定的服務與來源上 */
function keyFor(config: ByokConfig | null, rec: KeyRecord | null): string {
  if (!config || !rec) return '';
  const origin = endpointOrigin(config.baseUrl);
  return origin && rec.presetId === config.presetId && rec.origin === origin ? rec.key : '';
}

export interface ByokSnapshot {
  config: ByokConfig | null;
  /** 只會是綁定在 config 這個服務與來源上的金鑰；不相符時是空字串 */
  key: string;
  /** 讀取當下的設定版本；任何儲存、清除或其他分頁的變更都會讓版本增加 */
  version: number;
}

/**
 * 同步讀取「設定＋金鑰」同一份快照。需要金鑰的地方一律用這個函式，
 * 不要分開呼叫 loadConfig 與 loadKey 再自行組合（Codex r2 R1）。
 */
export function loadByok(): ByokSnapshot {
  const config = loadConfig();
  return { config, key: keyFor(config, loadKeyRecord()), version };
}

/** 目前設定對應的金鑰（等同 loadByok().key） */
export function loadKey(): string {
  return loadByok().key;
}

/** 儲存設定與金鑰。金鑰和這份設定的服務、來源綁在一起，依 rememberKey 決定存放位置，並清掉另一處的舊值 */
export function saveByok(config: ByokConfig, key: string): void {
  safeStorage('local')?.setItem(CONFIG_KEY, JSON.stringify(config));
  const k = key.trim();
  const origin = endpointOrigin(config.baseUrl);
  const rec: KeyRecord | null = k && origin ? { key: k, presetId: config.presetId, origin } : null;
  memoryRecord = rec;
  const local = safeStorage('local');
  const session = safeStorage('session');
  local?.removeItem(KEY_STORAGE_KEY);
  session?.removeItem(KEY_STORAGE_KEY);
  if (rec) (config.rememberKey ? local : session)?.setItem(KEY_STORAGE_KEY, JSON.stringify(rec));
  emit();
}

/** 清除金鑰與設定（「清除金鑰」按鈕、清除所有資料時使用） */
export function clearByok(): void {
  memoryRecord = null;
  for (const s of [safeStorage('local'), safeStorage('session')]) {
    s?.removeItem(KEY_STORAGE_KEY);
    s?.removeItem(CONFIG_KEY);
  }
  emit();
}

/** 測試用：模擬重新載入頁面（清掉記憶體快取） */
export function __resetByokMemoryForTests(): void {
  memoryRecord = 'unloaded';
}

/** 遮罩顯示金鑰：只露出最後 4 碼 */
export function maskKey(key: string): string {
  if (!key) return '（未設定）';
  return `••••••••${key.slice(-4)}`;
}

export function isConfigured(config: ByokConfig | null, key: string): config is ByokConfig {
  if (!config || !config.model.trim()) return false;
  const check = checkEndpoint(config.baseUrl);
  if (!check.ok) return false;
  const preset = presetById(config.presetId);
  return !!key || !preset.needsKey;
}

/** API 位址的來源（scheme＋host＋port）；網址不合法時回傳 null */
export function endpointOrigin(raw: string): string | null {
  const c = checkEndpoint(raw);
  return c.ok ? c.url.origin : null;
}

/**
 * 已儲存的金鑰是否可用於目前表單上的服務：必須是同一個服務、同一個來源。
 * 切換服務或改網址時不沿用舊金鑰，避免把某家服務的金鑰送到另一個服務（Codex F1）。
 */
export function savedKeyApplies(saved: ByokConfig | null, current: Pick<ByokConfig, 'presetId' | 'baseUrl'>): boolean {
  if (!saved) return false;
  const a = endpointOrigin(saved.baseUrl);
  return !!a && saved.presetId === current.presetId && a === endpointOrigin(current.baseUrl);
}

/**
 * 任何會連線到 API 位址的動作（取得模型清單、測試連線、儲存後對話）都要先通過：網址合法，
 * 且不是已知服務或本機時，使用者已勾選信任。回傳錯誤訊息；可以連線時回傳 null。
 */
export function endpointGate(baseUrl: string, trusted: boolean): string | null {
  const c = checkEndpoint(baseUrl);
  if (!c.ok) return c.message;
  if (!c.known && !c.local && !trusted) return '這不是已知的 AI 服務網址。請確認是你信任的服務後，勾選下方的確認方塊。';
  return null;
}
