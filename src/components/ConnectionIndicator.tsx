import { Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ByokConfig } from '../ai/byok/config';
import { CONNECTION_LABEL, SESSION_WARN_MS, connectionNow, formatRemaining, isExpired, useConnection } from '../ai/byok/connection';

/**
 * 連線狀態燈：連線中黃燈（閃爍）、已連線綠燈、連線失敗紅燈、未連線或已到時灰燈。
 * 不只靠顏色：一律附文字說明（aria-label；showLabel 時直接顯示）。
 */
export function ConnectionIndicator({ config, apiKey, showLabel = false }: { config: ByokConfig | null; apiKey: string; showLabel?: boolean }) {
  const { phase } = useConnection(config, apiKey);
  const label = CONNECTION_LABEL[phase];
  const dot =
    phase === 'online'
      ? 'bg-emerald-500 text-emerald-600'
      : phase === 'checking'
        ? 'animate-pulse bg-amber-400 text-amber-600'
        : phase === 'offline'
          ? 'bg-rose-500 text-rose-600'
          : 'bg-slate-400 text-slate-500';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 align-middle" title={label} data-testid="ai-connection" data-state={phase}>
      <span role="img" aria-label={`AI 連線狀態：${label}`} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-current ${dot}`} />
      {showLabel && <span>{label}</span>}
    </span>
  );
}

/** 剩餘時間的每秒更新；只有連線中才跑，不發出任何網路請求 */
function useRemaining(expiresAt: number | undefined): number | null {
  const [now, setNow] = useState(() => connectionNow());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(connectionNow());
    const id = setInterval(() => setNow(connectionNow()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, expiresAt - now) : null;
}

/** 對話框內的 30 分鐘連線計時器：剩餘不到 5 分鐘時改為提醒樣式 */
export function SessionTimer({ config, apiKey }: { config: ByokConfig | null; apiKey: string }) {
  const { phase, expiresAt } = useConnection(config, apiKey);
  const remaining = useRemaining(phase === 'online' || phase === 'checking' ? expiresAt : undefined);
  // 倒數到 0 但到期計時器還沒觸發（背景分頁延遲）：以截止時間結束連線
  useEffect(() => {
    if (remaining === 0) isExpired(config, apiKey);
  }, [remaining, config, apiKey]);
  if (remaining === null) return null;
  const warn = remaining <= SESSION_WARN_MS;
  const text = formatRemaining(remaining);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-mono text-[0.68rem] tabular-nums ${warn ? 'bg-warn-soft font-semibold text-warn' : 'bg-soft text-muted'}`}
      role="timer"
      aria-label={`本次連線剩餘 ${text}${warn ? '，即將到時' : ''}`}
      title="每次連線最長 30 分鐘，時間到會自動中斷；可按「重新連線」繼續。"
      data-testid="tutor-session-timer"
    >
      <Timer size={11} aria-hidden /> {text}
    </span>
  );
}
