import { Check, Play } from 'lucide-react';
import { useState } from 'react';
import { BRIDGE_BASE_URL, BRIDGE_DEFAULT_MINUTES, BRIDGE_MAX_MINUTES, BRIDGE_MIN_MINUTES, bridgeScript, clampMinutes, isBridgeUrl } from '../ai/byok/bridge';

/**
 * 本機暫時許可（Ollama 轉接程式，Windows PowerShell）。設定頁 API 欄位下方，預設收合。
 * 右上角只有「啟動」：複製指令，使用者貼到 PowerShell 執行（網頁不能執行電腦上的程式）。
 * 停止＝在該 PowerShell 視窗按 Ctrl+C；要再用就再按「啟動」（舊的會先自行結束）。
 * 不會發出任何網路請求；連線確認請按「重新連線」或「儲存並連線」。
 */
export function LocalBridgePanel({ baseUrl, onUseBridge, open = false }: { baseUrl: string; onUseBridge: () => void; open?: boolean }) {
  const [minutes, setMinutes] = useState(String(BRIDGE_DEFAULT_MINUTES));
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const m = clampMinutes(Number(minutes));
  const usingBridge = isBridgeUrl(baseUrl);

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500);
  };
  const actions = [
    { id: 'start', label: '啟動', icon: Play, text: () => bridgeScript(origin, m), desc: `複製「啟動 ${m} 分鐘」的 PowerShell 指令` },
  ] as const;

  return (
    <details className="rounded-lg border border-line p-2 text-xs" open={open} data-testid="local-bridge-panel">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className="font-semibold">本機暫時許可（Windows 轉接程式）</span>
        <span className="ml-auto flex flex-wrap gap-1" role="group" aria-label="轉接程式指令（只複製，不會執行）">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn btn-secondary btn-sm !min-h-[30px] !px-2"
              aria-label={a.desc}
              title={a.desc}
              data-testid={`bridge-${a.id}`}
              onClick={(e) => {
                e.preventDefault(); // 不展開／收合
                copy(a.id, a.text());
              }}
            >
              {copied === a.id ? <Check size={13} aria-hidden /> : <a.icon size={13} aria-hidden />} {a.label}
            </button>
          ))}
        </span>
      </summary>
      <div className="mt-2 grid gap-2">
        <p className="text-muted" aria-live="polite" data-testid="bridge-copy-status">
          {copied ? '已複製。請開啟 PowerShell，貼上後按 Enter 執行。' : '按右上角的「啟動」會複製指令（網頁無法直接執行電腦上的程式），再貼到 PowerShell 執行。'}
        </p>
        <label className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">許可時間</span>
          <input
            type="number"
            className="field !min-h-[32px] !w-24 !py-1 text-xs"
            min={BRIDGE_MIN_MINUTES}
            max={BRIDGE_MAX_MINUTES}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => setMinutes(String(m))}
            aria-describedby="bridge-minutes-hint"
          />
          <span id="bridge-minutes-hint" className="text-muted">
            分鐘（{BRIDGE_MIN_MINUTES}～{BRIDGE_MAX_MINUTES}），到期自動關閉。
          </span>
        </label>
        {!usingBridge && (
          <p className="rounded bg-warn-soft p-2">
            轉接程式的位址是 <code className="font-mono">{BRIDGE_BASE_URL}</code>。
            <button type="button" className="btn btn-sm !min-h-[30px] ml-1" onClick={onUseBridge} data-testid="bridge-use">
              改用轉接程式位址
            </button>
          </p>
        )}
        <ol className="ml-4 list-decimal space-y-1">
          <li>設定許可時間，按右上角「啟動」複製指令。</li>
          <li>開啟 PowerShell，貼上並按 Enter。看到「轉接程式已啟動」後保持視窗開著。</li>
          <li>API 位址使用 {BRIDGE_BASE_URL}，回到這裡按「重新連線」（或「儲存並連線」）。</li>
          <li>
            要停止：在那個 PowerShell 視窗按 <kbd className="rounded border border-line px-1 font-mono">Ctrl</kbd>+<kbd className="rounded border border-line px-1 font-mono">C</kbd>（或直接關閉視窗）。
          </li>
        </ol>
        <ul className="ml-4 list-disc space-y-0.5 text-muted">
          <li>只接受這台電腦上的本站（{origin}）網頁連線（區網或其他網站都會被拒絕），只轉送 AI 導師需要的路徑；不修改 Ollama 設定，也不會重新啟動 Ollama 或中斷其他程式。</li>
          <li>網站的倒數會跟著轉接程式的到期時間，到期時轉接程式會中斷進行中的回答並關閉。若是按 Ctrl+C 提早停止或關閉視窗，本站要到下一次連線或提問才會發現（不會在背景偵測）。要繼續使用，再按「啟動」執行一次（舊的轉接程式會先自行結束）。</li>
          <li>轉接程式一次處理一個請求：回答產生中時，其他請求（例如重新連線）會等它結束。</li>
          <li>網頁按鈕無法替你重新授權本機，也無法替你停止轉接程式。</li>
          <li>目前只提供 Windows 版；macOS／Linux 請看下方「讓本站連到 Ollama」的暫時做法。</li>
        </ul>
        <details>
          <summary className="cursor-pointer text-muted">檢視指令內容（{m} 分鐘）</summary>
          <pre className="mt-1 max-h-60 overflow-auto rounded bg-paper p-2 font-mono text-[0.65rem] whitespace-pre-wrap" data-testid="bridge-script">
            {bridgeScript(origin, m)}
          </pre>
        </details>
      </div>
    </details>
  );
}
