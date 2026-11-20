import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/**
 * 「讓本站連到本機 AI」的暫時做法。使用者偏好短期許可，不提供永久設定（不再教 setx／launchctl／systemd）。
 * - Windows：本機轉接程式（LocalBridgePanel），不修改 Ollama 設定、到期自動關閉
 * - macOS／Linux：只對該終端機視窗有效的 OLLAMA_ORIGINS（依 Ollama 官方 FAQ），關閉視窗即撤回
 * 以前用永久方式設定過的人，仍保留移除說明。
 */
type Os = 'windows' | 'mac' | 'linux';

function guessOs(): Os {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Mac|iPhone|iPad/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'windows';
}

function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-1">
      <code className="min-w-0 flex-1 break-all rounded bg-paper px-1.5 py-1 font-mono text-[0.7rem]">{text}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm !min-h-[32px] shrink-0 !px-2"
        aria-label={`複製${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        <span className="sr-only">{copied ? '已複製' : '複製'}</span>
      </button>
    </div>
  );
}

export function LocalSetupGuide({ presetId, highlight = false }: { presetId: string; highlight?: boolean }) {
  const [os, setOs] = useState<Os>(guessOs);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (presetId === 'lmstudio')
    return (
      <details className={`rounded-lg p-2 text-xs ${highlight ? 'bg-warn-soft' : 'bg-soft'}`} open={highlight} data-testid="local-setup-guide">
        <summary className="cursor-pointer font-semibold">讓本站連到 LM Studio（設定一次即可）</summary>
        <ol className="ml-4 mt-1 list-decimal space-y-1">
          <li>開啟 LM Studio，切到開發者（Developer）頁面，載入一個對話模型。</li>
          <li>啟動本機伺服器（預設連接埠 1234），並在伺服器設定中開啟 CORS（允許跨來源連線）。</li>
          <li>回到這裡按「自動偵測本機 AI」或「儲存並連線」。</li>
        </ol>
        <p className="mt-1 text-muted">瀏覽器若詢問是否允許本站存取「區域網路／本機裝置」，請選允許。</p>
      </details>
    );
  if (presetId === 'generic')
    return (
      <details className={`rounded-lg p-2 text-xs ${highlight ? 'bg-warn-soft' : 'bg-soft'}`} open={highlight} data-testid="local-setup-guide">
        <summary className="cursor-pointer font-semibold">讓本站連到這個本機程式</summary>
        <ol className="ml-4 mt-1 list-decimal space-y-1">
          <li>確認程式已啟動「OpenAI 相容 API 伺服器」，並記下位址與連接埠（通常以 /v1 結尾，例如 http://localhost:8080/v1）。</li>
          <li>
            在程式的設定或啟動參數中，允許本站網址（<code className="font-mono">{origin}</code>）的跨來源連線（CORS）。各程式的設定名稱不同，請查該程式的說明文件。
          </li>
          <li>回到這裡按「儲存並連線」。程式若不提供模型清單，會顯示「無法事先確認」，仍可直接提問測試。</li>
        </ol>
        <p className="mt-1 text-muted">瀏覽器若詢問是否允許本站存取「區域網路／本機裝置」，請選允許。這是該程式自己的設定，本站的 30 分鐘連線時限不會撤回它。</p>
      </details>
    );
  if (presetId !== 'ollama' && presetId !== 'ollama-bridge') return null;
  const steps: Record<Os, { title: string; items: { text: string; copy?: string; label?: string }[] }> = {
    windows: {
      title: 'Windows',
      items: [{ text: '請用上方「本機暫時許可（Windows 轉接程式）」：設定時間後按「啟動」，把指令貼到 PowerShell 執行，API 位址改用轉接程式位址。不修改 Ollama 設定，到期自動關閉。' }],
    },
    mac: {
      title: 'macOS',
      items: [
        { text: '先結束 Ollama（選單列的 Ollama 圖示 → Quit）。' },
        { text: '開啟「終端機」，貼上並執行（只在這個視窗開著時有效，關閉視窗就撤回）：', copy: `OLLAMA_ORIGINS="${origin}" ollama serve`, label: 'macOS 暫時啟動指令' },
      ],
    },
    linux: {
      title: 'Linux',
      items: [
        { text: '先停止背景的 Ollama 服務：', copy: 'sudo systemctl stop ollama', label: 'Linux 停止服務指令' },
        { text: '在終端機貼上並執行（只在這個視窗開著時有效，關閉視窗就撤回）：', copy: `OLLAMA_ORIGINS="${origin}" ollama serve`, label: 'Linux 暫時啟動指令' },
        { text: '用完後關閉視窗，需要時再啟動背景服務：', copy: 'sudo systemctl start ollama', label: 'Linux 啟動服務指令' },
      ],
    },
  };
  const s = steps[os];
  return (
    <details className={`rounded-lg p-2 text-xs ${highlight ? 'bg-warn-soft' : 'bg-soft'}`} open={highlight} data-testid="local-setup-guide">
      <summary className="cursor-pointer font-semibold">讓本站連到 Ollama（暫時許可）</summary>
      <p className="mt-1 text-muted">
        Ollama 預設只允許本機網頁連線，本站（{origin}）會被拒絕（HTTP 403，這不是金鑰問題）。以下做法都是暫時的，不會永久改變電腦設定：
      </p>
      <div className="mt-1 flex gap-1" role="tablist" aria-label="作業系統">
        {(Object.keys(steps) as Os[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={os === k} className={`btn btn-sm !min-h-[32px] !px-2 ${os === k ? '' : 'btn-secondary'}`} onClick={() => setOs(k)}>
            {steps[k].title}
          </button>
        ))}
      </div>
      <ol className="ml-4 mt-2 list-decimal space-y-1.5">
        {s.items.map((it, i) => (
          <li key={i}>
            {it.text}
            {it.copy && <CopyLine text={it.copy} label={it.label ?? '指令'} />}
          </li>
        ))}
        <li>回到這裡按「重新連線」（或「儲存並連線」）。</li>
      </ol>
      <p className="mt-1 text-muted">瀏覽器若詢問是否允許本站存取「區域網路／本機裝置」，請選允許。</p>
      <p className="mt-1 text-muted" data-testid="local-setup-persistence">
        本站的 30 分鐘連線只停止本站的提問，<strong>不會</strong>改變電腦設定；本機許可到期或關閉後，網頁按鈕無法替你重新授權，請在電腦上再啟動一次。
        以前若用永久方式設定過 OLLAMA_ORIGINS，可以這樣移除：
        {os === 'windows' ? '到「編輯您帳戶的環境變數」刪除 OLLAMA_ORIGINS，再重新開啟 Ollama' : os === 'mac' ? '執行 launchctl unsetenv OLLAMA_ORIGINS，再重新開啟 Ollama' : '用 sudo systemctl edit ollama.service 刪除該行，再重新啟動'}。
      </p>
    </details>
  );
}
