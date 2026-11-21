import { KeyRound, ListRestart, PlugZap, Radar, ShieldCheck, Trash2 } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ByokError, listModels, verifyConnection } from '../ai/byok/client';
import { getConnection, resetConnection } from '../ai/byok/connection';
import { detectLocal, orderModels, type Diagnosis } from '../ai/byok/diagnose';
import { ConnectionIndicator, SessionTimer } from './ConnectionIndicator';
import { LocalSetupGuide } from './LocalSetupGuide';
import { LocalBridgePanel } from './LocalBridgePanel';
import { MobileSetupGuide } from './MobileSetupGuide';
import { KEY_PAGES, isMobileDevice } from '../ai/byok/device';
import { BRIDGE_BASE_URL, isBridgeUrl, prefersBridge } from '../ai/byok/bridge';
import {
  BYOK_PRESETS,
  byokVersion,
  checkEndpoint,
  clearByok,
  endpointGate,
  endpointOrigin,
  loadByok,
  loadConfig,
  maskKey,
  presetById,
  saveByok,
  savedKeyApplies,
  subscribeByok,
  type ByokConfig,
} from '../ai/byok/config';

/** 預設位址是 localhost、只在執行它的同一台裝置有效的服務（手機版不列出） */
const LOCAL_ONLY_PRESETS = new Set(['ollama', 'ollama-bridge', 'lmstudio']);

function initialConfig(): ByokConfig {
  const saved = loadConfig();
  if (saved) return saved;
  const p = BYOK_PRESETS[0];
  return { presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.defaultModel, rememberKey: false };
}

/** 自備 API 設定表單：AI 導師對話視窗與設定頁共用 */
export function ByokSettings({ onSaved, compact = false }: { onSaved?: () => void; compact?: boolean }) {
  const uid = useId();
  const [cfg, setCfg] = useState<ByokConfig>(initialConfig);
  const [keyInput, setKeyInput] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 本機 AI 連線失敗時的自動判斷（服務沒開、未允許本站、模型沒下載） */
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  /** 自動偵測找到的本機服務：使用者確認後才套用並儲存（不直接覆蓋現有設定與金鑰） */
  const [detected, setDetected] = useState<{ presetId: string; baseUrl: string; models: string[]; model: string } | null>(null);
  const serviceRef = useRef<HTMLSelectElement>(null);
  /** 開啟服務選單（支援 showPicker 的瀏覽器直接展開；否則移到選單上） */
  const openServicePicker = () => {
    const el = serviceRef.current;
    if (!el) return;
    el.focus();
    try {
      (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // 不支援或不允許時，已移到選單上
    }
  };
  /** 表單上的服務或位址每改一次就加一；等待中的連線結果若不屬於目前的表單內容就丟棄 */
  const formSeq = useRef(0);
  // 另一個表單（設定頁／導師視窗）或其他分頁儲存、清除設定時重新渲染，提示文字跟著更新
  useSyncExternalStore(subscribeByok, byokVersion);

  const preset = presetById(cfg.presetId);
  const endpoint = checkEndpoint(cfg.baseUrl);
  const needsTrust = endpoint.ok && !endpoint.known && !endpoint.local;
  /**
   * 已儲存的金鑰：每次需要時才同步讀取「設定＋金鑰」同一份快照，且只在快照的服務與來源和表單相同時沿用。
   * 不把金鑰存在元件 state，避免另一個表單儲存其他服務後，用舊金鑰配上新設定（Codex r2 R1 重現 A）。
   */
  const savedKeyFor = (form: Pick<ByokConfig, 'presetId' | 'baseUrl'>): string => {
    const snap = loadByok();
    return savedKeyApplies(snap.config, form) ? snap.key : '';
  };
  const displaySaved = savedKeyFor(cfg);
  const anySaved = !!loadByok().key;
  /** 這一刻表單要用的金鑰：新輸入的優先，否則只沿用屬於同一服務與來源的已儲存金鑰 */
  const effectiveKey = () => keyInput.trim() || savedKeyFor(cfg);

  /** 表單內容改變：作廢等待中的結果，結束舊的連線 */
  const invalidate = () => {
    formSeq.current++;
    resetConnection();
    setBusy(false);
    setDiagnosis(null);
    setDetected(null);
  };

  /** 換服務或換來源時，清空尚未儲存的金鑰輸入（Codex r2 R1 重現 C：未儲存的輸入不可跟著換服務） */
  const resetForNewEndpoint = (hadInput: boolean) => {
    invalidate();
    setKeyInput('');
    setModels([]);
    setTrusted(false);
    setStatus(hadInput ? { tone: 'info', text: '已換服務或網址，剛才輸入但尚未儲存的金鑰已清空，請輸入這個服務的金鑰。' } : null);
  };

  const choosePreset = (id: string) => {
    // Windows：選 Ollama 直接帶入透過轉接程式的版本（本站無法直接連 Ollama）
    const p = presetById(id === 'ollama' && prefersBridge() ? 'ollama-bridge' : id);
    setCfg((c) => ({ ...c, presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.defaultModel }));
    resetForNewEndpoint(!!keyInput.trim());
  };

  /** 改用本機轉接程式：保留已選的模型 */
  const useBridge = () => {
    setCfg((c) => ({ ...c, presetId: 'ollama-bridge', kind: 'openai-compatible', baseUrl: BRIDGE_BASE_URL }));
    resetForNewEndpoint(!!keyInput.trim());
  };

  const changeBaseUrl = (value: string) => {
    const before = endpointOrigin(cfg.baseUrl);
    const after = endpointOrigin(value);
    setCfg((c) => ({ ...c, baseUrl: value }));
    if (before !== after) resetForNewEndpoint(!!keyInput.trim());
    else {
      invalidate();
      setTrusted(false);
      setStatus(null);
    }
  };

  /** 換模型（手動輸入或點選已下載的模型） */
  const changeModel = (model: string) => {
    invalidate();
    setStatus(null);
    setCfg((c) => ({ ...c, model }));
  };

  const validate = (key: string): string | null => {
    const gate = endpointGate(cfg.baseUrl, trusted);
    if (gate) return gate;
    // 本機服務的模型名稱可以留空：連線前會自動讀取已下載的模型並填入（見 withModel）
    if (!cfg.model.trim() && !(endpoint.ok && endpoint.local)) return '請填寫模型名稱（可按「取得模型清單」）。';
    if (preset.needsKey && !key) return '請輸入 API 金鑰。';
    return null;
  };

  /**
   * 確認連線：只讀取模型清單，不產生回答、不消耗 token。成功後開始最長 30 分鐘的連線。
   * 失敗時，本機服務會自動判斷原因並顯示可照做的步驟。
   */
  const connect = async (form: ByokConfig, key: string, prefix: string) => {
    const seq = formSeq.current;
    setBusy(true);
    setDiagnosis(null);
    setStatus({ tone: 'info', text: `${prefix}正在連線…` });
    try {
      const r = await verifyConnection(form, key);
      if (seq !== formSeq.current) return;
      if (r.models.length) setModels(r.models);
      if (!r.verified) {
        setStatus({
          tone: 'info',
          text: `${prefix}這個服務沒有提供模型清單，無法事先確認連線（不代表不能用）。${r.hint ?? ''}可以直接提問；第一次回答成功後會顯示已連線並開始 30 分鐘計時。`,
        });
        return;
      }
      const local = checkEndpoint(form.baseUrl);
      setStatus({
        tone: 'ok',
        text:
          local.ok && local.local
            ? isBridgeUrl(form.baseUrl) && getConnection().expiresAt
              ? `${prefix}已連線，模型「${form.model}」可以使用。連線到 ${new Date(getConnection().expiresAt!).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 為止（跟著本機轉接程式的許可時間）；到期請在「本機暫時許可」按「啟動」再執行一次，再按「重新連線」。要提早停止，請在轉接程式的 PowerShell 視窗按 Ctrl+C。`
              : `${prefix}已連線，模型「${form.model}」可以使用。每次連線最長 30 分鐘，時間到請按「重新連線」。`
            : `${prefix}已連線：服務有回應。金鑰與所選模型是否能回答，會在第一次提問時確認（各家服務的檢查方式不同）。每次連線最長 30 分鐘，時間到請按「重新連線」。`,
      });
    } catch (e) {
      if (seq !== formSeq.current) return;
      const err = e instanceof ByokError ? e : null;
      if (isMobileDevice() && LOCAL_ONLY_PRESETS.has(form.presetId)) {
        // 手機上的 Ollama／LM Studio 預設位址指向手機本身：不顯示電腦版的步驟
        setDiagnosis(null);
        setStatus({ tone: 'bad', text: `${prefix}連線失敗：在手機上，${form.baseUrl} 指向手機本身，不會連到電腦上的服務。請改選雲端服務，或若手機本身有相容的服務，改用「其他 OpenAI 相容服務」。` });
        return;
      }
      setDiagnosis(err?.diagnosis ?? null);
      setStatus({ tone: 'bad', text: `${prefix}連線失敗：${err?.message ?? '請確認服務位址與模型名稱。'}` });
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  /** 主要流程：儲存設定，接著確認連線 */
  /**
   * 本機服務沒填模型名稱時，自動讀取已下載的模型（只讀清單，不耗 token）並填入第一個對話模型，免得使用者自己找名稱。
   * 讀不到時顯示原因並回傳 null。
   */
  /** 等待期間設定在別處被清除或改存（另一個表單、其他分頁）時顯示的說明 */
  const STALE_TEXT = '等待期間 AI 設定已在其他地方變更（清除或改存其他服務），已取消這次操作，沒有儲存也沒有連線。請確認目前的設定後再試一次。';

  /**
   * @param stale 送出後 AI 設定是否已在別處變更（Codex r4 R4-1：只看本表單的 formSeq 不夠，
   *   另一個表單或分頁清除金鑰、改存服務時，等待中的舊操作不可再寫回或連線）
   */
  const withModel = async (form: ByokConfig, key: string, stale: () => boolean): Promise<ByokConfig | null> => {
    if (form.model) return form;
    const seq = formSeq.current;
    setBusy(true);
    setStatus({ tone: 'info', text: '正在讀取本機已下載的模型…' });
    try {
      const list = orderModels(await listModels(form, key));
      if (seq !== formSeq.current) return null;
      if (stale()) {
        setStatus({ tone: 'bad', text: STALE_TEXT });
        return null;
      }
      if (!list.length) {
        setStatus({ tone: 'bad', text: '這個本機服務還沒有任何模型。請先下載一個對話模型（例如在終端機執行 ollama pull qwen3:8b），再試一次。' });
        return null;
      }
      const p = presetById(form.presetId);
      const model = list.includes(p.defaultModel) ? p.defaultModel : list[0];
      setModels(list);
      setCfg((c) => ({ ...c, model }));
      return { ...form, model };
    } catch (e) {
      if (seq !== formSeq.current) return null;
      if (stale()) {
        setStatus({ tone: 'bad', text: STALE_TEXT });
        return null;
      }
      setDiagnosis(e instanceof ByokError ? (e.diagnosis ?? null) : null);
      setStatus({ tone: 'bad', text: `無法自動讀取模型：${e instanceof ByokError ? e.message : '請確認本機服務已啟動。'}` });
      return null;
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  /** 儲存並連線（已有模型名稱時立即儲存；本機服務沒填模型時先自動讀取並填入） */
  const save = () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    const form = { ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() };
    const commit = (next: ByokConfig, auto: boolean) => {
      saveByok(next, key);
      setKeyInput('');
      onSaved?.();
      void connect(next, key, auto ? `已自動選用模型「${next.model}」並儲存。` : '已儲存。');
    };
    if (form.model) return commit(form, false);
    // 送出當下的 AI 設定版本：讀取模型清單等待期間若在別處被清除或改存，就不寫回、不連線
    const version = byokVersion();
    const stale = () => byokVersion() !== version;
    void withModel(form, key, stale).then((next) => {
      if (!next) return;
      if (stale()) return setStatus({ tone: 'bad', text: STALE_TEXT });
      commit(next, true);
    });
  };

  /**
   * 重新連線：用已儲存的設定再確認一次（只讀取模型清單，不消耗 token），成功後開始新的一段計時。
   * 本機轉接程式重新啟動後，網站倒數會改用新的到期時間。
   */
  const reconnect = () => {
    const snap = loadByok();
    if (!snap.config) return setStatus({ tone: 'bad', text: '還沒有儲存的設定，請先按「儲存並連線」。' });
    void connect(snap.config, snap.key, '');
  };

  /** 只測試、不儲存（例如想先確認新金鑰）；成功後再按「儲存並連線」會沿用這段連線與計時，不會重新計時 */
  const test = () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    const form = { ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() };
    if (form.model) return void connect(form, key, '（尚未儲存）');
    const version = byokVersion();
    const stale = () => byokVersion() !== version;
    void withModel(form, key, stale).then((f) => {
      if (!f) return;
      if (stale()) return setStatus({ tone: 'bad', text: STALE_TEXT });
      void connect(f, key, `（尚未儲存）已自動選用模型「${f.model}」。`);
    });
  };

  const fetchModels = async () => {
    // 取得模型清單同樣會把金鑰送到這個位址，必須先通過網址與信任檢查
    const gate = endpointGate(cfg.baseUrl, trusted);
    if (gate) return setStatus({ tone: 'bad', text: gate });
    // 在發出請求的同一刻決定設定與金鑰，之後不再重新讀取
    const form = { ...cfg };
    const key = effectiveKey();
    const seq = formSeq.current;
    setBusy(true);
    setStatus({ tone: 'info', text: '正在取得模型清單…' });
    try {
      const raw = await listModels(form, key);
      if (seq !== formSeq.current) return; // 等待期間換了服務或網址：結果不屬於目前的表單
      const list = orderModels(raw);
      setModels(list);
      if (!list.length) return setStatus({ tone: 'info', text: '服務沒有回傳模型清單，請手動輸入模型名稱。' });
      // 自動填入：還沒填模型，或本機服務填的模型不在清單裡（雲端清單格式各家不同，已填的不覆蓋）
      const current = form.model.trim();
      const local = checkEndpoint(form.baseUrl);
      const p = presetById(form.presetId);
      // 本機：空白或清單外時自動填入。雲端：只在有預設模型且在清單裡時填入；清單依字母排序，第一個常是舊模型或不能對話的模型，不自動選
      const isLocal = local.ok && local.local;
      const auto = isLocal
        ? !current || !list.includes(current) ? (list.includes(p.defaultModel) ? p.defaultModel : list[0]) : ''
        : !current && p.defaultModel && list.includes(p.defaultModel) ? p.defaultModel : '';
      if (auto) setCfg((c) => ({ ...c, model: auto }));
      setStatus({
        tone: 'ok',
        text: auto
          ? `找到 ${list.length} 個模型，已自動填入「${auto}」。要用其他模型，請從「模型」下方的選單選擇。`
          : !current
            ? `找到 ${list.length} 個模型，請從「模型」下方的選單選擇要用的模型。`
            : `找到 ${list.length} 個模型，可從「模型」下方的選單選擇。`,
      });
    } catch (e) {
      if (seq !== formSeq.current) return;
      setDiagnosis(e instanceof ByokError ? (e.diagnosis ?? null) : null);
      setStatus({ tone: 'bad', text: e instanceof ByokError ? e.message : '無法取得模型清單。' });
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  /** 自動偵測本機 AI：只讀取本機服務的模型清單（不帶金鑰）。找到後先顯示結果，使用者按「套用並連線」才儲存 */
  const detect = async () => {
    invalidate();
    const seq = formSeq.current;
    setBusy(true);
    setStatus({ tone: 'info', text: '正在尋找這台電腦上的 Ollama 或 LM Studio…' });
    const r = await detectLocal();
    if (seq !== formSeq.current) return;
    setBusy(false);
    const found = r.found;
    // 找到 Ollama（本站無法直接連，或轉接程式還沒啟動）：直接帶入「透過轉接程式」的設定（使用者要求，省去手動切換），
    // 打開下方「本機暫時許可」，按「啟動」執行轉接程式後再「儲存並連線」。不儲存、不動已儲存的設定與金鑰
    const ollamaHere = found?.presetId === 'ollama' ? found : null;
    if (prefersBridge() && (ollamaHere || (!found && r.blocked.includes('ollama')))) {
      const bridge = presetById('ollama-bridge');
      const list = ollamaHere?.models ?? [];
      const current = cfg.model.trim();
      const keep = (cfg.presetId === 'ollama' || cfg.presetId === 'ollama-bridge') && current;
      const model = list.length ? (list.includes(current) ? current : list.includes(bridge.defaultModel) ? bridge.defaultModel : list[0]) : keep ? current : bridge.defaultModel;
      setCfg((c) => ({ ...c, presetId: bridge.id, kind: bridge.kind, baseUrl: bridge.baseUrl, model }));
      setModels(list);
      setKeyInput('');
      setTrusted(false);
      setStatus({
        tone: 'info',
        text: `找到 Ollama${list.length ? `（${list.length} 個模型）` : ''}，已帶入「透過轉接程式」的設定（尚未儲存）。請在下方「本機暫時許可」按「啟動」，貼到 PowerShell 執行後，再按「儲存並連線」。${list.length ? '' : '轉接程式啟動後，可按「取得模型清單」選擇模型。'}`,
      });
      return;
    }
    if (found?.models.length) {
      const p = presetById(found.presetId);
      const current = cfg.model.trim();
      const model = cfg.presetId === p.id && found.models.includes(current) ? current : found.models.includes(p.defaultModel) ? p.defaultModel : found.models[0];
      setDetected({ presetId: p.id, baseUrl: found.baseUrl, models: found.models, model });
      setStatus({ tone: 'info', text: `找到 ${p.label}，有 ${found.models.length} 個對話模型。請確認模型後按「套用並連線」。` });
      return;
    }
    if (found) {
      const p = presetById(found.presetId);
      setDiagnosis({ problem: 'no-models', message: '', installed: [] });
      setStatus({
        tone: 'bad',
        text: `找到 ${p.label}，但還沒有下載對話模型。${p.id === 'ollama' ? '請在終端機執行 ollama pull qwen3:8b（或其他模型），' : '請在 LM Studio 下載並載入一個模型，'}再按一次「自動偵測本機 AI」。`,
      });
      return;
    }
    if (r.blocked.length) {
      // 只切換表單上的服務來顯示設定步驟，不儲存、不動已儲存的設定與金鑰
      const p = presetById(r.blocked[0]);
      setCfg((c) => ({ ...c, presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: c.presetId === p.id ? c.model : p.defaultModel }));
      setKeyInput('');
      setDiagnosis({ problem: 'cors', message: '' });
      setStatus({
        tone: 'bad',
        text: `${new URL(p.baseUrl).host} 有程式回應，但不允許本站讀取。最常見的原因是 ${p.label} 還沒允許本站網址，請照下方步驟檢查並設定一次，再按「自動偵測本機 AI」。`,
      });
      return;
    }
    setStatus({
      tone: 'bad',
      text: '在預設位址沒有找到 Ollama 或 LM Studio。可能原因：程式沒有開啟（或 LM Studio 沒有啟動本機伺服器）、使用了非預設的連接埠，或瀏覽器拒絕本站存取本機網路。自動偵測只檢查這兩個程式的預設位址；使用其他本機程式（例如 llama.cpp、vLLM、Jan）或改過連接埠時，請在「AI 服務」選「其他 OpenAI 相容服務」，輸入它的位址（例如 http://localhost:8080/v1）。',
    });
  };

  /** 使用者確認後套用偵測結果：儲存本機服務設定並連線 */
  const applyDetected = () => {
    if (!detected) return;
    const p = presetById(detected.presetId);
    const next: ByokConfig = { ...cfg, presetId: p.id, kind: p.kind, baseUrl: detected.baseUrl, model: detected.model };
    formSeq.current++;
    setDetected(null);
    setCfg(next);
    setModels(detected.models);
    setKeyInput('');
    setTrusted(false);
    saveByok(next, '');
    onSaved?.();
    void connect(next, '', `已套用 ${p.label}、模型「${detected.model}」並儲存。`);
  };

  const clear = () => {
    clearByok();
    formSeq.current++;
    setKeyInput('');
    setDiagnosis(null);
    const p = BYOK_PRESETS[0];
    setCfg({ presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.defaultModel, rememberKey: false });
    setStatus({ tone: 'ok', text: '已清除這台裝置上的金鑰與 AI 設定。' });
    onSaved?.();
  };

  const key = effectiveKey();
  /** 已儲存的是其他服務（且有金鑰）時，套用偵測結果前要提醒會被取代 */
  const savedSnap = loadByok();
  const savedOther = detected && savedSnap.config && savedSnap.config.presetId !== detected.presetId ? savedSnap.config.presetId : null;
  const field = 'field !min-h-[40px] !py-1.5 text-sm';
  // 手機或平板：localhost 指向手機本身，自動偵測與轉接程式只適用同一台電腦，所以先提供雲端服務（自訂網址仍可設定）
  const mobile = isMobileDevice();
  const LOCAL_ONLY = LOCAL_ONLY_PRESETS;
  const keyPage = KEY_PAGES[preset.id];
  return (
    <div className="byok-form grid gap-3 text-sm" data-testid="byok-settings">
      <div role="note" className="rounded-lg bg-soft p-2 text-xs" data-testid="byok-connection-status">
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionIndicator config={cfg} apiKey={key} showLabel />
          <SessionTimer config={cfg} apiKey={key} />
        </div>
        <p className="mt-1 text-muted">
          按「儲存並連線」確認服務能用（只讀取模型清單，不消耗 token）。綠燈＝已連線，紅燈＝連線失敗，灰燈＝未連線或已到時。每次連線最長 30 分鐘，時間到請按「重新連線」。
        </p>
      </div>
      {mobile ? (
        <div role="note" className="rounded-lg bg-warn-soft p-2 text-xs" data-testid="byok-mobile-note">
          <p className="font-semibold">在手機或平板上使用</p>
          <p className="mt-1">
            手機上預設使用雲端服務：一般的 Ollama、LM Studio 要先在電腦上下載模型並執行，而手機的 localhost 指向手機本身，不會連到電腦上的 Ollama 或 LM Studio；本站的自動偵測與 Windows 轉接程式只適用同一台電腦。若你已有在手機本機執行的相容服務，或可信的 HTTPS 位址，可選「其他 OpenAI 相容服務」自行設定。
          </p>
          <div className="mt-2">
            <MobileSetupGuide presetId={preset.id} open={!anySaved && !loadByok().config} hasKeyPage={!!keyPage} />
          </div>
        </div>
      ) : (
        <>
          {(!compact || preset.local) && (
            <button type="button" className="btn btn-secondary btn-sm justify-self-start" onClick={detect} disabled={busy} data-testid="byok-detect">
              <Radar size={14} aria-hidden /> 自動偵測本機 AI
            </button>
          )}
          {(!compact || preset.local) && (
            <p className="-mt-2 text-[0.7rem] text-muted">只檢查 Ollama 與 LM Studio 的預設位址；雲端服務或其他本機程式請直接在下方選擇服務、輸入位址。</p>
          )}
        </>
      )}
      <label className="grid gap-1">
        <span className="font-semibold">AI 服務</span>
        <select ref={serviceRef} className={field} value={cfg.presetId} onChange={(e) => choosePreset(e.target.value)} aria-describedby={`${uid}-hint`}>
          {BYOK_PRESETS.filter((p) =>
            // Windows 只列「透過轉接程式」的 Ollama；其他系統只列直接連線（轉接程式只有 Windows 版）。目前選中的一律保留
            // 手機不列只能在電腦上用的本機服務（自訂網址仍可輸入）
            p.id === cfg.presetId ? true : mobile && LOCAL_ONLY.has(p.id) ? false : p.id === 'ollama' ? !prefersBridge() : p.id === 'ollama-bridge' ? prefersBridge() : true,
          ).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span id={`${uid}-hint`} className="text-xs text-muted" data-testid="byok-service-hint">
          {/* 手機上的本機服務：電腦版的步驟在手機上做不到，改由下方手機說明處理（Codex 手機複查 R2-1） */}
          {mobile && LOCAL_ONLY.has(preset.id) ? '這是電腦用的本機服務；在手機上請看下方說明，改選雲端服務或其他相容服務。' : preset.hint}
        </span>
      </label>

      <label className="grid gap-1">
        <span className="font-semibold">API 位址</span>
        <input
          className={field}
          value={cfg.baseUrl}
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://api.example.com/v1"
          onChange={(e) => changeBaseUrl(e.target.value)}
        />
        {!endpoint.ok && cfg.baseUrl && <span className="text-xs text-bad">{endpoint.message}</span>}
      </label>
      {!mobile && (preset.id === 'ollama' || preset.id === 'ollama-bridge' || isBridgeUrl(cfg.baseUrl)) && (
        <LocalBridgePanel baseUrl={cfg.baseUrl} onUseBridge={useBridge} open={diagnosis?.problem === 'cors' || preset.id === 'ollama-bridge'} />
      )}
      {needsTrust && (
        <label className="flex items-start gap-2 rounded-lg bg-warn-soft p-2 text-xs">
          <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
          <span>
            這不是已知的 AI 服務網址（{endpoint.ok ? endpoint.url.hostname : ''}）。你的金鑰與提問會送到這個位址，我確認這是我信任的服務。
          </span>
        </label>
      )}

      <label className="grid gap-1">
        <span className="font-semibold">模型</span>
        <input
          className={field}
          value={cfg.model}
          list={`${uid}-models`}
          spellCheck={false}
          autoComplete="off"
          placeholder={preset.kind === 'anthropic' ? 'claude-opus-5-5' : '例如服務提供的模型名稱'}
          onChange={(e) => changeModel(e.target.value)}
        />
        <datalist id={`${uid}-models`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {endpoint.ok && endpoint.local && !models.length && (
        <p className="-mt-2 text-xs text-muted">本機服務的模型可以留空：按「儲存並連線」或「取得模型清單」會自動讀取已下載的模型並填入。</p>
      )}
      {models.length > 0 && (
        <label className="-mt-2 grid gap-1 text-xs">
          <span className="text-muted">從偵測到的 {models.length} 個模型選擇</span>
          <select className={field} value={models.includes(cfg.model.trim()) ? cfg.model.trim() : ''} onChange={(e) => e.target.value && changeModel(e.target.value)} data-testid="byok-model-select">
            {!models.includes(cfg.model.trim()) && <option value="">{cfg.model.trim() ? '（請選擇；目前填的是清單外的名稱）' : '（請選擇模型）'}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="grid gap-1">
        <span className="font-semibold">
          API 金鑰{!preset.needsKey && <span className="font-normal text-muted">（本機服務通常不需要，可留空）</span>}
        </span>
        <input
          className={field}
          type="password"
          value={keyInput}
          autoComplete="off"
          spellCheck={false}
          placeholder={displaySaved ? `已儲存：${maskKey(displaySaved)}（留空表示沿用）` : anySaved ? '已換服務或網址，請重新輸入這個服務的金鑰' : '貼上你的 API 金鑰'}
          onChange={(e) => {
            invalidate();
            setStatus(null);
            setKeyInput(e.target.value);
          }}
          data-testid="byok-key"
        />
      </label>
      {keyPage && (
        <div className="-mt-1 grid gap-1 text-xs text-muted" data-testid="byok-key-page">
          <span>還沒有金鑰？到服務的官方頁面建立，複製後回到這裡貼上：</span>
          <a href={keyPage.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm justify-self-start">
            到 {keyPage.name} 建立金鑰（新分頁）
          </a>
          <span>可能需要登入或設定付款；費用、免費額度與限制以各服務官方說明為準。</span>
        </div>
      )}

      <label className="byok-check flex items-start gap-2 text-xs">
        <input type="checkbox" checked={cfg.rememberKey} onChange={(e) => setCfg((c) => ({ ...c, rememberKey: e.target.checked }))} />
        <span>
          在這台裝置記住金鑰（不勾選時，關閉分頁就會清除）。
          <strong>共用或公用電腦請不要勾選。</strong>
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={save} disabled={busy} data-testid="byok-save">
          <PlugZap size={14} aria-hidden /> 儲存並連線
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={reconnect} disabled={busy || !loadByok().config} data-testid="byok-reconnect">
          重新連線
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={test} disabled={busy} data-testid="byok-test">
          只測試，不儲存
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={fetchModels} disabled={busy}>
          <ListRestart size={14} aria-hidden /> 取得模型清單
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={busy} data-testid="byok-clear">
          <Trash2 size={14} aria-hidden /> 清除金鑰
        </button>
      </div>
      {status && (
        <p role="status" className={`rounded-lg p-2 text-xs ${status.tone === 'ok' ? 'bg-ok-soft text-ok' : status.tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-soft'}`}>
          {status.text}
        </p>
      )}
      {detected && (
        <div className="grid gap-2 rounded-lg border border-line p-2 text-xs" data-testid="byok-detected">
          <label className="grid gap-1">
            <span className="font-semibold">找到 {presetById(detected.presetId).label}，選擇要使用的模型</span>
            <select className={field} value={detected.model} onChange={(e) => setDetected({ ...detected, model: e.target.value })}>
              {detected.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {savedOther && (
            <p className="rounded bg-warn-soft p-1.5">
              套用後會取代目前已儲存的「{presetById(savedOther).label}」設定，這台裝置上該服務的金鑰也會移除。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={applyDetected} data-testid="byok-detect-apply">
              <PlugZap size={14} aria-hidden /> 套用並連線
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDetected(null); setStatus(null); }}>
              取消
            </button>
          </div>
        </div>
      )}
      {diagnosis?.installed && diagnosis.installed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="byok-installed-models">
          <span className="text-muted">改用已下載的模型：</span>
          {diagnosis.installed.slice(0, 8).map((m) => (
            <button key={m} type="button" className="btn btn-ghost btn-sm !min-h-[32px] !px-2 font-mono" onClick={() => changeModel(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
      {mobile && LOCAL_ONLY.has(preset.id) ? (
        <div role="note" className="grid gap-2 rounded-lg bg-warn-soft p-2 text-xs" data-testid="byok-mobile-local">
          <p>
            目前選的是「{preset.label}」（{cfg.baseUrl}）。在手機上，這個位址指向手機本身，不會連到電腦上的服務；電腦版的自動偵測與轉接程式在手機上不提供。
          </p>
          <p>請在上方「AI 服務」改選雲端服務；若手機本身有相容的服務，可改用「其他 OpenAI 相容服務」。原本的設定不會被自動刪除。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={openServicePicker} data-testid="byok-mobile-pick">
              前往 AI 服務選單
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => choosePreset('custom')} data-testid="byok-mobile-custom">
              改用其他相容服務
            </button>
          </div>
        </div>
      ) : (
        (preset.local || (endpoint.ok && endpoint.local)) && (
          <LocalSetupGuide key={preset.id} presetId={preset.local ? preset.id : 'generic'} highlight={diagnosis?.problem === 'cors'} />
        )
      )}

      {!compact && (
        <div className="rounded-lg bg-soft p-3 text-xs text-muted">
          <p className="mb-1 flex items-center gap-1 font-semibold text-ink">
            <ShieldCheck size={14} aria-hidden /> 安全說明
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>金鑰只存在你這台裝置的瀏覽器，直接送到你選的 AI 服務；本站沒有伺服器，不會收到或保存你的金鑰。</li>
            <li>金鑰不會出現在學習紀錄、JSON 備份或 CSV 匯出中；「清除所有學習紀錄」時也會一併清除。</li>
            <li>只接受 https 網址，或這台電腦本機（localhost、127.0.0.1）的 http 網址；區網其他電腦的 http 位址不支援。</li>
            <li>能不能在本站使用，取決於服務是否允許網頁直接連線（CORS）：服務能用程式呼叫 API，不代表允許瀏覽器直連。本站無法保證任何特定服務都能直接使用。</li>
            <li>建議在 AI 服務後台為這把金鑰設定花費上限，或建立專用金鑰，不用時隨時撤銷。</li>
            <li>對話會把你的提問與目前題目、講義內容送給該服務，請不要輸入個人資料或密碼。</li>
            <li>每次連線最長 30 分鐘，到時自動中斷，避免忘記關閉而持續使用；需要時再按「重新連線」。</li>
          </ul>
        </div>
      )}
      {compact && (
        <p className="flex items-center gap-1 text-xs text-muted">
          <KeyRound size={12} aria-hidden /> 金鑰只存在這台裝置的瀏覽器並直接送往你選的服務；完整說明見「設定 → AI 導師」。
        </p>
      )}
    </div>
  );
}
