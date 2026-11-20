/**
 * 本機 AI（Ollama、LM Studio）連線問題的自動判斷與偵測，讓使用者不必自己除錯。
 *
 * 瀏覽器對「服務沒開」和「服務有開但不允許本站連線（CORS）」回報的是同一種錯誤。
 * 這裡在連線失敗後，對服務根目錄送一個 no-cors 請求，推測較可能的原因（只是推測，訊息一律寫成「可能原因」）：
 * - no-cors 請求成功＝這個連接埠有程式回應，但不允許本站讀取；最常見是 Ollama 還沒允許本站，也可能是其他程式占用連接埠
 * - no-cors 請求也失敗＝服務沒有啟動、連接埠不對，或瀏覽器拒絕本站存取本機網路
 * 這個請求不帶金鑰、不帶 Cookie、不送資料，只在本機位址、且只在連線失敗後才會發出。
 */
import { BYOK_PRESETS, checkEndpoint, normalizeBaseUrl, presetById, type ByokConfig } from './config';

export type LocalProblem = 'not-running' | 'cors' | 'model-missing' | 'no-models';

export interface Diagnosis {
  problem: LocalProblem;
  message: string;
  /** 本機已安裝的模型（判斷得到時） */
  installed?: string[];
}

const PROBE_TIMEOUT_MS = 3000;
const SAFE = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' } as const satisfies RequestInit;

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

/** 本機服務是否有在執行（不管是否允許本站讀取回應） */
export async function isReachable(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const check = checkEndpoint(baseUrl);
  if (!check.ok || !check.local) return false;
  try {
    await fetchImpl(`${check.url.origin}/`, { mode: 'no-cors', method: 'GET', signal: timeoutSignal(PROBE_TIMEOUT_MS), ...SAFE });
    return true;
  } catch {
    return false;
  }
}

/** 不帶金鑰讀取本機服務的模型清單；讀不到時回傳 null */
export async function localModels(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/models`, { signal: timeoutSignal(PROBE_TIMEOUT_MS), ...SAFE });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    if (!json || !Array.isArray(json.data)) return null; // 不是模型清單
    return (json.data as { id?: unknown }[]).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

/**
 * 模型排序：名稱看起來像向量（embedding）模型的排在後面，但不隱藏（使用者自訂的別名不一定照慣例命名）。
 */
export function orderModels(ids: string[]): string[] {
  const looksEmbedding = (id: string) => /embed|bge|e5-/i.test(id);
  return [...ids].sort((a, b) => Number(looksEmbedding(a)) - Number(looksEmbedding(b)) || a.localeCompare(b));
}

function serviceName(config: Pick<ByokConfig, 'presetId'>): string {
  const p = presetById(config.presetId);
  return p.local ? p.label.replace(/（本機）/, '') : '本機 AI 服務';
}

/**
 * 本機服務連線失敗後，判斷是哪一種問題。
 * @param status 服務有回應時的 HTTP 狀態（例如 404 可能是模型沒下載）；網路層失敗時省略
 */
export async function diagnoseLocal(config: ByokConfig, status?: number, fetchImpl: typeof fetch = fetch): Promise<Diagnosis | null> {
  const check = checkEndpoint(config.baseUrl);
  if (!check.ok || !check.local) return null;
  const name = serviceName(config);
  if (status === undefined) {
    if (!(await isReachable(config.baseUrl, fetchImpl)))
      return {
        problem: 'not-running',
        message: `連不到 ${check.url.host}。可能原因：${name} 沒有開啟${config.presetId === 'lmstudio' ? '（或 LM Studio 沒有啟動本機伺服器）' : ''}、連接埠不對，或瀏覽器拒絕本站存取本機網路（請檢查網址列左側的網站權限）。確認後按「重新連線」。`,
      };
    return {
      problem: 'cors',
      message: `${check.url.host} 有程式回應，但不允許本站讀取。最常見的原因是 ${name} 還沒允許本站網址，請依下方步驟檢查並設定一次；若這個連接埠是其他程式，請確認 API 位址。`,
    };
  }
  if (status === 404 || status === 400) {
    const ids = await localModels(config.baseUrl, fetchImpl);
    if (ids && !ids.includes(config.model.trim())) {
      const chat = orderModels(ids);
      if (!chat.length)
        return {
          problem: 'no-models',
          installed: [],
          message: `${name} 沒有回傳任何模型。請先下載一個對話模型${config.presetId === 'ollama' ? '（在終端機執行 ollama pull 模型名稱，例如 ollama pull qwen3:8b）' : ''}，再按「重新連線」。`,
        };
      return {
        problem: 'model-missing',
        installed: chat,
        message: `${name} 沒有模型「${config.model.trim()}」。可改選這個服務回報的模型：${chat.slice(0, 6).join('、')}${chat.length > 6 ? '…' : ''}。`,
      };
    }
  }
  return null;
}

export interface DetectResult {
  /** 找到可以連線的本機服務 */
  found?: { presetId: string; baseUrl: string; models: string[] };
  /** 有在執行、但不允許本站連線的服務 */
  blocked: string[];
}

/** 依序嘗試 Ollama、LM Studio 的預設位址（不帶金鑰），找出可用的本機 AI */
export async function detectLocal(fetchImpl: typeof fetch = fetch): Promise<DetectResult> {
  const blocked: string[] = [];
  let empty: DetectResult['found'];
  for (const p of BYOK_PRESETS.filter((x) => x.local)) {
    const ids = await localModels(p.baseUrl, fetchImpl);
    if (ids) {
      const models = orderModels(ids);
      if (models.length) return { found: { presetId: p.id, baseUrl: p.baseUrl, models }, blocked };
      // 有服務但沒有對話模型：繼續找下一個，都沒有才回報這個
      empty ??= { presetId: p.id, baseUrl: p.baseUrl, models: [] };
      continue;
    }
    if (await isReachable(p.baseUrl, fetchImpl)) blocked.push(p.id);
  }
  return { found: empty, blocked };
}
