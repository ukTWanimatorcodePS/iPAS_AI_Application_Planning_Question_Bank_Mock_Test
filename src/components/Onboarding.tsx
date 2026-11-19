import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { Level } from '../content/schema';
import type { Track } from '../data/types';

/** 首次進入的設定精靈；可跳過直接使用 */
export function Onboarding() {
  const { settings, update } = useApp();
  const [level, setLevel] = useState<Level>(settings.level);
  const [track, setTrack] = useState<Track>(settings.track);
  const [min, setMin] = useState(settings.dailyMinutes.min);
  const [max, setMax] = useState(settings.dailyMinutes.max);
  const [goalJ, setGoalJ] = useState(settings.studyGoal.junior);
  const [goalM, setGoalM] = useState(settings.studyGoal.middle);

  const save = () =>
    update({
      level,
      track,
      dailyMinutes: { min: Math.max(0, Math.min(min, max)), max: Math.max(min, max) },
      studyGoal: { junior: goalJ.slice(0, 40) || '2027 年初', middle: goalM.slice(0, 40) || '2027 年中' },
      onboarded: true,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="ob-title" className="card max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="kicker">歡迎使用</div>
        <h2 id="ob-title" className="mt-1 mb-1 text-xl font-extrabold">先設定你的備考計畫</h2>
        <p className="mb-4 text-sm text-muted">之後都能在「設定」修改。也可以直接跳過開始使用。</p>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-bold">目前要準備的級別</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['junior', 'middle'] as Level[]).map((v) => (
              <label key={v} className="opt !min-h-[44px] !py-2">
                <input type="radio" name="ob-level" checked={level === v} onChange={() => setLevel(v)} />
                <span>{v === 'junior' ? '初級' : '中級'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {level === 'middle' && (
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-bold">中級獲證路線</legend>
            <div className="grid gap-2">
              {(
                [
                  ['data', '數據分析（L21＋L22）'],
                  ['ml', '機器學習（L21＋L23）'],
                  ['both', '兩條路線都讀'],
                ] as [Track, string][]
              ).map(([v, label]) => (
                <label key={v} className="opt !min-h-[44px] !py-2">
                  <input type="radio" name="ob-track" checked={track === v} onChange={() => setTrack(v)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">每日最少（分）</span>
            <input className="field" type="number" min={0} max={600} value={min} onChange={(e) => setMin(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">每日最多（分）</span>
            <input className="field" type="number" min={0} max={600} value={max} onChange={(e) => setMax(Number(e.target.value))} />
          </label>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">初級預計考期</span>
            <input className="field" value={goalJ} maxLength={40} onChange={(e) => setGoalJ(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">中級預計考期</span>
            <input className="field" value={goalM} maxLength={40} onChange={(e) => setGoalM(e.target.value)} />
          </label>
        </div>
        <p className="mb-4 text-xs text-muted">預設平日學習、週末休息；2027 確切考試日期以官方簡章為準。</p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => update({ onboarded: true })}>
            先跳過
          </button>
          <button type="button" className="btn" onClick={save}>
            儲存並開始
          </button>
        </div>
      </div>
    </div>
  );
}
