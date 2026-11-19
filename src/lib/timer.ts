/** 從開始時刻到現在經過的整數秒數（牆鐘時間，不受分頁是否可見影響）。開始時間無效時回傳 0。 */
export function wallElapsedSec(startMs: number, nowMs: number = Date.now()): number {
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/** 限時測驗交卷時記錄的作答時間：不超過時間上限（逾時後才回到頁面，不把離開的時間算成作答時間） */
export function recordedDuration(elapsedSec: number, timeLimitSec: number | null): number {
  return timeLimitSec == null ? elapsedSec : Math.min(elapsedSec, timeLimitSec);
}
