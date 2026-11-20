import { KeyRound, ListRestart, PlugZap, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ByokError, listModels, streamChat } from '../ai/byok/client';
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

  /** 換服務或換來源時，清空尚未儲存的金鑰輸入（Codex r2 R1 重現 C：未儲存的輸入不可跟著換服務） */
  const resetForNewEndpoint = (hadInput: boolean) => {
    formSeq.current++;
    setKeyInput('');
    setModels([]);
    setTrusted(false);
    setBusy(false);
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
    else setTrusted(false);
  };

  const validate = (key: string): string | null => {
    const gate = endpointGate(cfg.baseUrl, trusted);
    if (gate) return gate;
    if (!cfg.model.trim()) return '請填寫模型名稱（可按「取得模型清單」）。';
    if (preset.needsKey && !key) return '請輸入 API 金鑰。';
    return null;
  };

  const save = () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    const next = { ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() };
    saveByok(next, key);
    setKeyInput('');
    setStatus({ tone: 'ok', text: next.rememberKey ? '已儲存。金鑰記在這台裝置的瀏覽器，可隨時按「清除金鑰」。' : '已儲存。金鑰只保留到你關閉這個分頁。' });
    onSaved?.();
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
      setStatus({ tone: 'bad', text: e instanceof ByokError ? e.message : '無法取得模型清單。' });
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  const test = async () => {
    const key = effectiveKey();
    const err = validate(key);
    if (err) return setStatus({ tone: 'bad', text: err });
    const form = { ...cfg, baseUrl: cfg.baseUrl.trim(), model: cfg.model.trim() };
    const seq = formSeq.current;
    setBusy(true);
    setStatus({ tone: 'info', text: '測試中…' });
    try {
      let text = '';
      await streamChat({
        config: form,
        apiKey: key,
        system: '你是連線測試助手。只回覆「連線成功」四個字。',
        messages: [{ role: 'user', content: '請回覆：連線成功' }],
        onText: (d) => (text += d),
      });
      if (seq !== formSeq.current) return;
      setStatus({ tone: 'ok', text: `連線成功。AI 回覆：「${text.trim().slice(0, 40) || '（空白）'}」。記得按「儲存」。` });
    } catch (e) {
      if (seq !== formSeq.current) return;
      setStatus({ tone: 'bad', text: e instanceof ByokError ? e.message : '連線失敗。' });
    } finally {
      if (seq === formSeq.current) setBusy(false);
    }
  };

  const clear = () => {
    clearByok();
    formSeq.current++;
    setKeyInput('');
    const p = BYOK_PRESETS[0];
    setCfg({ presetId: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.defaultModel, rememberKey: false });
    setStatus({ tone: 'ok', text: '已清除這台裝置上的金鑰與 AI 設定。' });
    onSaved?.();
  };

  const field = 'field !min-h-[40px] !py-1.5 text-sm';
  return (
    <div className="grid gap-3 text-sm" data-testid="byok-settings">
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
          onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
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
          onChange={(e) => setKeyInput(e.target.value)}
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
          <Save size={14} /> 儲存
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={test} disabled={busy} data-testid="byok-test">
          <PlugZap size={14} /> 測試連線
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={fetchModels} disabled={busy}>
          <ListRestart size={14} /> 取得模型清單
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={busy} data-testid="byok-clear">
          <Trash2 size={14} /> 清除金鑰
        </button>
      </div>
      {status && (
        <p role="status" className={`rounded-lg p-2 text-xs ${status.tone === 'ok' ? 'bg-ok-soft text-ok' : status.tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-soft'}`}>
          {status.text}
        </p>
      )}

      {!compact && (
        <div className="rounded-lg bg-soft p-3 text-xs text-muted">
          <p className="mb-1 flex items-center gap-1 font-semibold text-ink">
            <ShieldCheck size={14} aria-hidden /> 安全說明
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>金鑰只存在你這台裝置的瀏覽器，直接送到你選的 AI 服務；本站沒有伺服器，不會收到或保存你的金鑰。</li>
            <li>金鑰不會出現在學習紀錄、JSON 備份或 CSV 匯出中；「清除所有學習紀錄」時也會一併清除。</li>
            <li>只接受 https 網址，或本機（localhost）的 http 網址。</li>
            <li>建議在 AI 服務後台為這把金鑰設定花費上限，或建立專用金鑰，不用時隨時撤銷。</li>
            <li>對話會把你的提問與目前題目、講義內容送給該服務，請不要輸入個人資料或密碼。</li>
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
