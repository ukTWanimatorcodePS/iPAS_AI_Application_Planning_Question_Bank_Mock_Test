import { Download, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { CardHead, ConfirmDialog, PageHead } from '../components/ui';
import { curriculum } from '../content';
import { activeRules, RULES_DISCLAIMER } from '../config/examRules';
import { downloadText, exportBackup, parseBackup, restoreBackup, type Backup } from '../data/backup';
import { clearAllData, updateDailyMinutes } from '../data/repo';
import { ensureInitialized } from '../data/db';
import type { ThemePref, Track } from '../data/types';
import { sanitizeIntervals } from '../lib/review';
import { remoteProvider } from '../ai';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function SettingsPage() {
  const { settings, update } = useApp();
  // 每日最少大於最多時自動對調（與首次設定的處理一致），避免學習計畫的預算自相矛盾
  const normalizeMinutes = () => updateDailyMinutes('normalize');
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [clearStep, setClearStep] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [intervals, setIntervals] = useState(settings.reviewIntervals.join(', '));
  const rules = activeRules();

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseBackup(await f.text());
    if (!r.ok) setMsg({ ok: false, text: `匯入失敗：${r.error}` });
    else setPending(r.backup);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <PageHead kicker="Settings" title="設定" desc="學習計畫、顯示偏好與資料備份。資料只保存在這台裝置的瀏覽器。" />
      {msg && (
        <p className={`notice mb-4 ${msg.ok ? '!bg-ok-soft !text-ok' : ''}`} role="status">
          {msg.text}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card" aria-labelledby="set-plan">
          <CardHead title={<span id="set-plan">學習計畫</span>} />
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-bold">初級目標考期</span>
                <input className="field" maxLength={40} value={settings.studyGoal.junior} onChange={(e) => update({ studyGoal: { ...settings.studyGoal, junior: e.target.value } })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">中級目標考期</span>
                <input className="field" maxLength={40} value={settings.studyGoal.middle} onChange={(e) => update({ studyGoal: { ...settings.studyGoal, middle: e.target.value } })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-bold">初級考試日期（自行設定）</span>
                <input
                  className="field"
                  type="date"
                  value={settings.examDate.junior ?? ''}
                  onChange={(e) => update({ examDate: { ...settings.examDate, junior: e.target.value || null } })}
                  data-testid="exam-date-junior"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">中級考試日期（自行設定）</span>
                <input
                  className="field"
                  type="date"
                  value={settings.examDate.middle ?? ''}
                  onChange={(e) => update({ examDate: { ...settings.examDate, middle: e.target.value || null } })}
                />
              </label>
            </div>
            <p className="-mt-2 text-xs text-muted">用於產生每日學習計畫。2027 年官方考期尚未公告，請依簡章公布後自行填入。</p>
            <label className="text-sm">
              <span className="mb-1 block font-bold">中級獲證路線</span>
              <select className="field" value={settings.track} onChange={(e) => update({ track: e.target.value as Track })}>
                <option value="data">數據分析（L21＋L22）</option>
                <option value="ml">機器學習（L21＋L23）</option>
                <option value="both">兩條路線都讀</option>
              </select>
            </label>
            <fieldset>
              <legend className="mb-1 text-sm font-bold">可讀日（未勾選為休息日）</legend>
              <div className="flex flex-wrap gap-2">
                {WEEK.map((w, i) => {
                  const rest = settings.restDays.includes(i);
                  return (
                    <label key={i} className="opt !w-auto !min-h-[44px] !px-3 !py-2">
                      <input
                        type="checkbox"
                        checked={!rest}
                        onChange={() => update({ restDays: rest ? settings.restDays.filter((d) => d !== i) : [...settings.restDays, i].sort() })}
                      />
                      <span>週{w}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-bold">每日最少（分）</span>
                <input className="field" type="number" min={0} max={600} value={settings.dailyMinutes.min} onChange={(e) => updateDailyMinutes({ min: Math.max(0, Number(e.target.value)) })} onBlur={normalizeMinutes} aria-describedby="minutes-hint" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">每日最多（分）</span>
                <input className="field" type="number" min={0} max={600} value={settings.dailyMinutes.max} onChange={(e) => updateDailyMinutes({ max: Math.max(0, Number(e.target.value)) })} onBlur={normalizeMinutes} aria-describedby="minutes-hint" />
              </label>
            </div>
            {settings.dailyMinutes.min > settings.dailyMinutes.max && (
              <p id="minutes-hint" className="text-sm text-bad" role="alert" data-testid="minutes-invalid">
                每日最少不能大於每日最多；離開欄位時會自動對調。
              </p>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-bold">單元測驗建議門檻（%）</span>
              <input className="field" type="number" min={0} max={100} value={settings.passThreshold} onChange={(e) => update({ passThreshold: Math.max(0, Math.min(100, Number(e.target.value))) })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">錯題複習間隔（天，以逗號分隔）</span>
              <input
                className="field"
                value={intervals}
                onChange={(e) => setIntervals(e.target.value)}
                onBlur={() => {
                  const v = sanitizeIntervals(intervals.split(/[,，\s]+/).map(Number));
                  setIntervals(v.join(', '));
                  update({ reviewIntervals: v });
                }}
              />
              <span className="mt-1 block text-xs text-muted">需在每個間隔到期時答對，完成全部間隔才算「已掌握」。預設 1, 3, 7, 14。</span>
            </label>
          </div>
        </section>

        <section className="card" aria-labelledby="set-ui">
          <CardHead title={<span id="set-ui">顯示</span>} />
          <div className="grid gap-4">
            <label className="text-sm">
              <span className="mb-1 block font-bold">主題</span>
              <select className="field" value={settings.theme} onChange={(e) => update({ theme: e.target.value as ThemePref })}>
                <option value="system">跟隨系統</option>
                <option value="light">淺色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="opt">
              <input type="checkbox" checked={settings.highContrast} onChange={(e) => update({ highContrast: e.target.checked })} />
              <span>高對比模式</span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">全站字級：{Math.round(settings.fontScale * 100)}%</span>
              <input
                type="range"
                className="w-full"
                min={0.9}
                max={1.3}
                step={0.05}
                value={settings.fontScale}
                onChange={(e) => update({ fontScale: Number(e.target.value) })}
                aria-valuetext={`${Math.round(settings.fontScale * 100)}%`}
              />
            </label>
          </div>
        </section>

        <section className="card" aria-labelledby="set-data">
          <CardHead title={<span id="set-data">資料備份</span>} />
          <p className="mb-3 text-sm text-muted">
            學習紀錄存在本裝置瀏覽器的 IndexedDB。<strong>手機與電腦不會自動同步</strong>；換裝置請先匯出 JSON，再到另一台匯入。清除瀏覽器網站資料會刪除紀錄。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={async () => downloadText(`AI備考室_備份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportBackup(), null, 2))}
            >
              <Download size={16} /> 匯出 JSON
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> 匯入 JSON
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label="選擇備份檔" onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-input" />
          </div>
          <hr className="my-5 border-line" />
          <button type="button" className="btn btn-secondary" onClick={() => setClearStep(1)}>
            <Trash2 size={16} /> 清除這台裝置的所有學習紀錄
          </button>
        </section>

        <section className="card" aria-labelledby="set-ai">
          <CardHead title={<span id="set-ai">AI 導師</span>} />
          <fieldset className="grid gap-2">
            <legend className="sr-only">AI 導師來源</legend>
            <label className="opt">
              <input type="radio" name="tutor" checked={settings.tutorProvider === 'mock'} onChange={() => update({ tutorProvider: 'mock' })} />
              <span>
                <strong>示範模式（離線，預設）</strong>
                <span className="block text-xs text-muted">由本站已審核的解析與講義重新組合教學內容，不呼叫外部 AI、不需金鑰。</span>
              </span>
            </label>
            <label className={`opt ${remoteProvider.isAvailable() ? '' : 'opacity-70'}`}>
              <input
                type="radio"
                name="tutor"
                disabled={!remoteProvider.isAvailable()}
                checked={settings.tutorProvider === 'remote'}
                onChange={() => update({ tutorProvider: 'remote' })}
              />
              <span>
                <strong>遠端 AI（經後端代理）</strong>
                <span className="block text-xs text-muted">
                  {remoteProvider.isAvailable()
                    ? '由網站管理者設定的後端代理提供，需登入並受使用量限制；內容標示為 AI 生成。'
                    : '此網站尚未設定後端代理，無法使用。'}
                </span>
              </span>
            </label>
          </fieldset>
          <p className="mt-3 text-xs text-muted">
            本站不會要求你輸入任何 AI 服務的 API 金鑰。真實 AI 只能透過保管金鑰、驗證使用者、限制用量的後端代理提供（說明見專案 docs/AI_TUTOR.md）。
          </p>
        </section>

        <section className="card text-sm" aria-labelledby="set-src">
          <CardHead title={<span id="set-src">來源說明</span>} />
          <ul className="grid gap-2">
            <li>
              課綱：官方評鑑內容範圍 {curriculum.curriculumVersion} 版（{curriculum.publishedAt}），最後核對 {curriculum.lastVerifiedAt}。{' '}
              <a href={curriculum.sourceUrl} target="_blank" rel="noopener noreferrer">
                官方 PDF
              </a>
            </li>
            <li>
              考試規則：{rules.year} 年度設定{rules.isProvisional ? '（暫定）' : ''}，最後核對 {rules.lastVerifiedAt}。{RULES_DISCLAIMER}
            </li>
            <li>講義與題目：本站自編，由 AI 協助撰寫並經自動檢查，標示審核狀態；未收錄官方原題。</li>
            <li>AI 即時導師、跨裝置同步：尚未啟用（需另建後端，詳見 README）。</li>
            <li>本站為獨立學習工具，非 iPAS 官方平台，與主辦單位無關。</li>
          </ul>
        </section>
      </div>

      <ConfirmDialog
        open={!!pending}
        title="以備份覆蓋本機資料？"
        confirmLabel="覆蓋並匯入"
        danger
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const b = pending!;
          setPending(null);
          try {
            await restoreBackup(b);
            setMsg({ ok: true, text: `匯入完成：${b.data.attempts.length} 筆作答、${b.data.quizSessions.length} 份測驗、${b.data.reviewItems.length} 題錯題。` });
          } catch (e) {
            setMsg({ ok: false, text: `匯入失敗，原資料未變更：${(e as Error).message}` });
          }
        }}
      >
        備份檔匯出於 {pending && new Date(pending.exportedAt).toLocaleString('zh-TW')}，包含 {pending?.data.attempts.length} 筆作答紀錄。目前裝置上的紀錄將被取代。
      </ConfirmDialog>
      <ConfirmDialog
        open={clearStep === 1}
        title="確定清除所有學習紀錄？"
        confirmLabel="下一步"
        danger
        onCancel={() => setClearStep(0)}
        onConfirm={() => setClearStep(2)}
      >
        這會刪除講義進度、測驗、作答與錯題紀錄，且無法復原。建議先匯出備份。
      </ConfirmDialog>
      <ConfirmDialog
        open={clearStep === 2}
        title="請再次確認"
        confirmLabel="永久清除"
        danger
        onCancel={() => setClearStep(0)}
        onConfirm={async () => {
          setClearStep(0);
          await clearAllData();
          await ensureInitialized();
          setMsg({ ok: true, text: '已清除這台裝置的所有學習紀錄。' });
        }}
      >
        真的要永久清除這台裝置上的所有學習進度嗎？
      </ConfirmDialog>
    </>
  );
}
