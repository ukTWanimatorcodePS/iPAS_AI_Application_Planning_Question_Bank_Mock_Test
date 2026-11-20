import { KeyRound, ListRestart, PlugZap, Radar, ShieldCheck, Trash2 } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ByokError, listModels, verifyConnection } from '../ai/byok/client';
import { resetConnection } from '../ai/byok/connection';
import { detectLocal, type Diagnosis } from '../ai/byok/diagnose';
import { ConnectionIndicator, SessionTimer } from './ConnectionIndicator';
import { LocalSetupGuide } from './LocalSetupGuide';
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
    const p = presetById(id);
    setCfg((c) => ({ ...c, presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.defaultModel }));
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
    if (!cfg.model.trim()) return '請填寫模型名稱（可按「取得模型清單」）。';
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
            ? `${prefix}已連線，模型「${form.model}」可以使用。每次連線最長 30 分鐘，時間到請按「重新連線」。`
            : `${prefix}已連線：服務有回應。金鑰與所選模型是否能回答，會在第一次提問時確認（各家服務的檢查方式不同）。每次連線最長 30 分鐘，時間到請按「重新連線」。`,
      });
    } catch (e) {
      if (seq !== formSeq.current) return;
      const err = e instanceof ByokError ? e : null;
      setDiagnosis(err?.diagnosis ?? null);
      setStatus({ tone: 'bad', text: `${prefix}連線失敗：${err?.message ?? '請確認服務位址與模型名稱。'}` });
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  /** 主要流程：儲存設定，接著確認連線 */
  const save = () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    const next = { ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() };
    saveByok(next, key);
    setKeyInput('');
    onSaved?.();
    void connect(next, key, '已儲存。');
  };

  /** 只測試、不儲存（例如想先確認新金鑰）；成功後再按「儲存並連線」會沿用這段連線與計時，不會重新計時 */
  const test = () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    void connect({ ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() }, key, '（尚未儲存）');
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
      const list = await listModels(form, key);
      if (seq !== formSeq.current) return; // 等待期間換了服務或網址：結果不屬於目前的表單
      setModels(list);
      setStatus({ tone: list.length ? 'ok' : 'info', text: list.length ? `找到 ${list.length} 個模型，可在「模型」欄位選擇。` : '服務沒有回傳模型清單，請手動輸入模型名稱。' });
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
  return (
    <div className="grid gap-3 text-sm" data-testid="byok-settings">
      <div role="note" className="rounded-lg bg-soft p-2 text-xs" data-testid="byok-connection-status">
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionIndicator config={cfg} apiKey={key} showLabel />
          <SessionTimer config={cfg} apiKey={key} />
        </div>
        <p className="mt-1 text-muted">
          按「儲存並連線」確認服務能用（只讀取模型清單，不消耗 token）。綠燈＝已連線，紅燈＝連線失敗，灰燈＝未連線或已到時。每次連線最長 30 分鐘，時間到請按「重新連線」。
        </p>
      </div>
      {(!compact || preset.local) && (
        <button type="button" className="btn btn-secondary btn-sm justify-self-start" onClick={detect} disabled={busy} data-testid="byok-detect">
          <Radar size={14} aria-hidden /> 自動偵測本機 AI
        </button>
      )}
      {(!compact || preset.local) && (
        <p className="-mt-2 text-[0.7rem] text-muted">只檢查 Ollama 與 LM Studio 的預設位址；雲端服務或其他本機程式請直接在下方選擇服務、輸入位址。</p>
      )}
      <label className="grid gap-1">
        <span className="font-semibold">AI 服務</span>
        <select className={field} value={cfg.presetId} onChange={(e) => choosePreset(e.target.value)} aria-describedby={`${uid}-hint`}>
          {BYOK_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span id={`${uid}-hint`} className="text-xs text-muted">
          {preset.hint}
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

      <label className="flex items-start gap-2 text-xs">
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
      {(preset.local || (endpoint.ok && endpoint.local)) && (
        <LocalSetupGuide key={preset.id} presetId={preset.local ? preset.id : 'generic'} highlight={diagnosis?.problem === 'cors'} />
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
