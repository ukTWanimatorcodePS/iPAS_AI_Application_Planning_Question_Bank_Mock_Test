/**
 * AI 導師的「連線」狀態與 30 分鐘連線時限（只在記憶體，不存金鑰、不寫資料庫、不在背景呼叫 AI）。
 *
 * - 連線對象（target）＝服務＋位址＋模型＋金鑰識別碼。任何一項不同就是另一個連線，舊狀態不會沿用。
 *   金鑰識別碼由設定層在記憶體配發（credentialId），不同金鑰一定不同；金鑰本身不保存在這裡。
 * - 到期一律以截止時間判斷（不只看計時器）：背景分頁的計時器可能延遲，送出前與串流中都會再比對時間。
 * - 第一次成功（按「連線」、測試回答或成功回答提問）時開始一段連線，最長 30 分鐘；之後的成功不會延長。
 *   時間到就結束（expired），不能再送出，需按「重新連線」開始新的 30 分鐘（使用者要求：每個模型最多連線 30 分鐘）。
 * - 失敗就結束連線並記下原因；使用者中止時恢復成請求前的狀態。
 * - 晚到的結果（設定已改、或已有更新的請求）一律丟棄，不會誤亮綠燈。
 */
import { useSyncExternalStore } from 'react';
import { isBridgeUrl } from './bridge';
import { credentialId, loadByok, normalizeBaseUrl, retainCredential, subscribeByok, type ByokConfig } from './config';

/** 每個模型一次連線的最長時間 */
export const SESSION_MS = 30 * 60_000;
/** 剩餘時間少於這個值時，計時器改為提醒樣式 */
export const SESSION_WARN_MS = 5 * 60_000;
/** 本機轉接程式的許可最長 120 分鐘；超過視為不可信，不採用 */
const MAX_LOCAL_MS = 120 * 60_000 + 60_000;

export type Phase = 'idle' | 'checking' | 'online' | 'offline' | 'expired';

export interface ConnectionState {
  target: string;
  phase: Phase;
  /** 這段連線開始與結束的時間（毫秒）；只有 online／checking（連線中重新請求）時才有 */
  startedAt?: number;
  expiresAt?: number;
  /** 失敗原因（顯示給使用者，不含金鑰） */
  message?: string;
}

const IDLE: ConnectionState = { target: '', phase: 'idle' };
let state: ConnectionState = IDLE;
let sequence = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
let now = () => Date.now();

/** 時間到：結束連線，作廢進行中的請求（晚到的結果不套用），不在背景重連 */
function expire(target: string) {
  sequence++;
  publish({ target, phase: 'expired' });
}

function publish(next: ConnectionState) {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  state = next;
  // 已連線、或連線中重新請求（checking 但仍在同一段連線內）都要排定到期
  if ((next.phase === 'online' || next.phase === 'checking') && next.expiresAt) {
    const ms = Math.max(0, next.expiresAt - now());
    expiryTimer = setTimeout(() => {
      if (state === next) expire(next.target);
    }, ms);
  }
  listeners.forEach((l) => l());
}

export function targetOf(config: ByokConfig, key: string): string {
  return JSON.stringify([config.presetId, config.kind, normalizeBaseUrl(config.baseUrl), config.model.trim(), credentialId(key)]);
}

/** 這段連線是否已過截止時間（計時器延遲時也成立） */
function pastDeadline(s: ConnectionState): boolean {
  return !!s.expiresAt && s.expiresAt <= now();
}

/** 目前時間（測試可替換）；畫面倒數也用這個，和到期判斷一致 */
export function connectionNow(): number {
  return now();
}

export function getConnection(): ConnectionState {
  return state;
}

/** 結束目前連線（清除金鑰、改設定、切換服務時） */
export function resetConnection(): void {
  sequence++;
  retainCredential('');
  publish(IDLE);
}

// 已儲存的設定或金鑰改變時（本頁另一個表單、清除金鑰、其他分頁）：
// 儲存的正是目前連線的同一個對象（例如設定頁測試成功後再按「儲存」）就保留連線與計時；
// 否則結束連線，並作廢進行中的請求，晚到的結果不會套到新設定
subscribeByok(() => {
  const snap = loadByok();
  if (state.target && snap.config && targetOf(snap.config, snap.key) === state.target) return;
  resetConnection();
});

/**
 * online 的 localExpiresAt：本機轉接程式回報的許可到期時間（毫秒）。有值時網站倒數以它為準
 * （使用者選擇「網站倒數跟著本機許可走」；許可可設 5～120 分鐘，所以可能超過 30 分鐘）。
 */
export type Outcome =
  | { phase: 'online'; localExpiresAt?: number }
  | { phase: 'offline'; message: string }
  | { phase: 'aborted' }
  | { phase: 'unverified'; message: string };

/**
 * 開始一次會連線到 AI 服務的請求。回傳 finish：請求結束時呼叫一次。
 * 只有「仍是最新一次請求、對象沒變」時結果才會生效。
 */
export function beginConnection(config: ByokConfig, key: string): (o: Outcome) => void {
  const id = ++sequence;
  retainCredential(key); // 連線中的金鑰識別碼固定保留
  // 只有本站轉接位址回報的到期時間可以採用（防禦：雲端或其他本機程式不能藉此延長 30 分鐘）
  const bridge = isBridgeUrl(config.baseUrl);
  const target = targetOf(config, key);
  const prev = state.target === target ? state : null;
  const session = prev && (prev.phase === 'online' || prev.phase === 'checking') && prev.expiresAt && !pastDeadline(prev) ? prev : null;
  publish({ target, phase: 'checking', startedAt: session?.startedAt, expiresAt: session?.expiresAt });
  let done = false;
  return (o) => {
    if (done) return;
    done = true;
    if (id !== sequence || state.target !== target) return; // 晚到的結果：不套用
    if (o.phase === 'aborted') {
      publish(prev && prev.phase !== 'checking' ? prev : session ? { ...session, phase: 'online' } : IDLE);
      return;
    }
    if (o.phase === 'offline') {
      publish({ target, phase: 'offline', message: o.message });
      return;
    }
    if (o.phase === 'unverified') {
      // 無法事先確認（服務沒有模型清單）：仍在有效期內的連線照舊；否則回到未連線（可直接提問，成功後才開始計時）
      publish(session ? { ...session, phase: 'online' } : { target, phase: 'idle', message: o.message });
      return;
    }
    // 成功：本機轉接程式有回報到期時間時以它為準（再次啟動轉接程式會更新）；
    // 否則沿用尚未到期的這段連線（不延長），或開始新的 30 分鐘
    const t = now();
    const startedAt = session?.startedAt ?? t;
    const local = bridge && o.localExpiresAt !== undefined && o.localExpiresAt > t && o.localExpiresAt - t <= MAX_LOCAL_MS ? o.localExpiresAt : undefined;
    const expiresAt = local ?? session?.expiresAt ?? t + SESSION_MS;
    if (expiresAt <= t) publish({ target, phase: 'expired' });
    else publish({ target, phase: 'online', startedAt, expiresAt });
  };
}

/**
 * 這個對象目前是否「已到時」：到時後不能送出，需要按「重新連線」（verifyConnection）開始新的一段。
 * 以截止時間判斷；計時器還沒觸發（背景分頁延遲）但時間已過時，順便把狀態改為已到時。
 */
export function isExpired(config: ByokConfig | null, key: string): boolean {
  if (!config || state.target !== targetOf(config, key)) return false;
  if (state.phase === 'expired') return true;
  if ((state.phase === 'online' || state.phase === 'checking') && pastDeadline(state)) {
    expire(state.target);
    return true;
  }
  return false;
}

/** 這個對象目前是否連線中（已連線且未到期）；正在請求中也算 */
export function hasActiveSession(config: ByokConfig | null, key: string): boolean {
  if (!config || state.target !== targetOf(config, key)) return false;
  return (state.phase === 'online' || state.phase === 'checking') && !!state.expiresAt && !pastDeadline(state);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** 畫面用：只回傳屬於這個對象的狀態；其他對象一律視為「未連線」 */
export function useConnection(config: ByokConfig | null, key: string): ConnectionState {
  const current = useSyncExternalStore(subscribe, () => state);
  return config && current.target === targetOf(config, key) ? current : IDLE;
}

export const CONNECTION_LABEL: Record<Phase, string> = {
  idle: '未連線',
  checking: '連線中…',
  online: '已連線',
  offline: '連線失敗',
  expired: '連線已到時（30 分鐘）',
};

/** 剩餘時間 mm:ss */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 測試用：替換時間來源、重設狀態 */
export function __setConnectionClockForTests(fn: () => number): void {
  now = fn;
}
export function __resetConnectionForTests(): void {
  now = () => Date.now();
  resetConnection();
}
