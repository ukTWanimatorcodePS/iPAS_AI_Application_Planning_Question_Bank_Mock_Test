export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });
}
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)} 小時 ${m % 60} 分`;
  return m ? `${m} 分 ${s} 秒` : `${s} 秒`;
}
