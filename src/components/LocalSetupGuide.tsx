import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/**
 * 「讓本站連到本機 AI」的一次性設定步驟（依 Ollama 官方 FAQ：設定 OLLAMA_ORIGINS 後重新啟動 Ollama）。
 * 只允許本站網址（不是全部網站），設定一次即可，之後不用每次調整。
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
  if (presetId !== 'ollama') return null;
  const steps: Record<Os, { title: string; items: { text: string; copy?: string; label?: string }[] }> = {
    windows: {
      title: 'Windows',
      items: [
        { text: '在工作列右下角的 Ollama 圖示按右鍵，選擇結束（Quit）。' },
        { text: '開啟 PowerShell，貼上並執行下面這一行（只允許本站，不是所有網站）：', copy: `setx OLLAMA_ORIGINS "${origin}"`, label: 'Windows 設定指令' },
        { text: '從開始功能表重新開啟 Ollama。' },
      ],
    },
    mac: {
      title: 'macOS',
      items: [
        { text: '開啟「終端機」，貼上並執行：', copy: `launchctl setenv OLLAMA_ORIGINS "${origin}"`, label: 'macOS 設定指令' },
        { text: '結束 Ollama 再重新開啟。電腦重新開機後，若又連不上，再執行一次上面的指令。' },
      ],
    },
    linux: {
      title: 'Linux',
      items: [
        { text: '執行下面的指令，在 [Service] 下方加入一行：', copy: 'sudo systemctl edit ollama.service', label: 'Linux 編輯服務指令' },
        { text: '要加入的那一行：', copy: `Environment="OLLAMA_ORIGINS=${origin}"`, label: 'Linux 設定內容' },
        { text: '存檔後重新啟動：', copy: 'sudo systemctl daemon-reload && sudo systemctl restart ollama', label: 'Linux 重新啟動指令' },
      ],
    },
  };
  const s = steps[os];
  return (
    <details className={`rounded-lg p-2 text-xs ${highlight ? 'bg-warn-soft' : 'bg-soft'}`} open={highlight} data-testid="local-setup-guide">
      <summary className="cursor-pointer font-semibold">讓本站連到 Ollama（設定一次即可）</summary>
      <p className="mt-1 text-muted">Ollama 預設只允許本機網頁連線。要從本站使用，需要把本站網址（{origin}）加入允許清單：</p>
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
        <li>回到這裡按「重新連線」。</li>
      </ol>
      <p className="mt-1 text-muted">
        已經為其他網址設定過 OLLAMA_ORIGINS 的話，請用英文逗號把本站網址加在後面，不要覆蓋原本的設定。瀏覽器若詢問是否允許本站存取「區域網路／本機裝置」，請選允許。
      </p>
      <p className="mt-1 text-muted" data-testid="local-setup-persistence">
        注意：這是 Ollama 的設定，{os === 'mac' ? '在重新開機前' : '會一直保留（重新開機也有效）'}，直到你自己移除。本站的 30 分鐘連線時限只會中斷本站的連線，<strong>不會</strong>撤回這個允許設定。
        不想再讓本站連線時，{os === 'windows' ? '請到「編輯您帳戶的環境變數」刪除 OLLAMA_ORIGINS，再重新開啟 Ollama' : os === 'mac' ? '請執行 launchctl unsetenv OLLAMA_ORIGINS，再重新開啟 Ollama' : '請用 sudo systemctl edit ollama.service 刪除那一行，再重新啟動'}。
      </p>
    </details>
  );
}
