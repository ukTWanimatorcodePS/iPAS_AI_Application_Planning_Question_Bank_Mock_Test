import { BookOpen, ClipboardList, Flame, Info, Shuffle, Timer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, PageHead, ProgressBar } from '../components/ui';
import { getCompetency } from '../content';
import { useAttempts, useReviewItems } from '../data/hooks';
import { startQuiz, startReviewQuiz } from '../data/quizFactory';
import { subjectsForTrack } from '../lib/learningPath';
import { isDue } from '../lib/review';
import { weakestCompetencies } from '../lib/stats';

export function SprintPage() {
  const { level, settings } = useApp();
  const nav = useNavigate();
  const attempts = useAttempts(level) ?? [];
  const reviews = useReviewItems(level) ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weak = weakestCompetencies(attempts, 3, 6);
  const due = reviews.filter((r) => r.masteryStatus === 'unresolved' || isDue(r)).length;

  const go = async (fn: () => ReturnType<typeof startQuiz>) => {
    if (busy) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) nav(`/quiz/${r.sessionId}`);
    else setMsg(r.message);
  };

  return (
    <>
      <PageHead kicker="Final sprint" title="考前衝刺" desc="集中處理弱點、錯題與全範圍混合練習，最後以限時模考檢驗。" />
      {msg && <p className="notice mb-4" role="status">{msg}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card lg:col-span-2" aria-labelledby="weak-title" data-testid="sprint-weak">
          <CardHead title={<span id="weak-title" className="inline-flex items-center gap-1.5"><Flame size={16} /> 個人高錯誤率考點</span>} />
          <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-warn-soft p-2 text-xs text-warn">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            依你的作答紀錄計算錯誤率最高的細項（每項至少 3 題才列入）。這是個人弱點，並非官方公布或經統計證實的高頻考點。
          </p>
          {weak.length === 0 ? (
            <p className="text-sm text-muted">樣本不足：每個細項至少作答 3 題後才會列入排名。可先做下方的全範圍混合測驗。</p>
          ) : (
            <ul className="grid gap-3">
              {weak.map((w) => (
                <li key={w.code} className="grid gap-2 border-b border-line pb-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <strong>{w.code}</strong> {getCompetency(w.code)?.name}
                      </span>
                      <span className="shrink-0 font-bold">
                        {w.accuracy}%（{w.correct}/{w.total}）
                      </span>
                    </div>
                    <ProgressBar value={w.accuracy ?? 0} label={`${w.code} 正確率`} tone={(w.accuracy ?? 0) >= settings.passThreshold ? 'ok' : 'bad'} />
                  </div>
                  <div className="flex gap-2">
                    <Link className="btn btn-secondary btn-sm" to={`/courses/${w.code}`}>
                      <BookOpen size={14} /> 講義
                    </Link>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => go(() => startQuiz({ level, mode: 'test', count: 10, competencyCodes: [w.code] }))}>
                      練 10 題
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="sprint-review">
          <CardHead title={<span id="sprint-review" className="inline-flex items-center gap-1.5"><ClipboardList size={16} /> 錯題重測</span>} right={<span className="pill pill-red">{due} 題</span>} />
          <p className="mb-3 text-sm text-muted">到期與尚未訂正的錯題。需在到期日答對才累計，完成全部間隔才算已掌握。</p>
          <button type="button" className="btn" disabled={!due || busy} onClick={() => go(() => startReviewQuiz(level))}>
            開始重測
          </button>
        </section>

        <section className="card" aria-labelledby="sprint-mixed">
          <CardHead title={<span id="sprint-mixed" className="inline-flex items-center gap-1.5"><Shuffle size={16} /> 全範圍混合測驗</span>} />
          <p className="mb-3 text-sm text-muted">依目前路線的所有科目隨機出 30 題（測驗模式），優先出未做過的題目。</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="sprint-mixed-start"
            onClick={() => go(() => startQuiz({ level, mode: 'test', count: 30, subjects: subjectsForTrack(level, settings.track), scopeLabel: '全範圍混合測驗' }))}
          >
            開始 30 題
          </button>
        </section>

        <section className="card lg:col-span-2" aria-labelledby="sprint-mock">
          <CardHead title={<span id="sprint-mock" className="inline-flex items-center gap-1.5"><Timer size={16} /> 限時模擬考</span>} />
          <p className="mb-3 text-sm text-muted">自訂題數與時間的計時模考；官方題數與時間未公告前一律標示為「自訂模考」。</p>
          <Link className="btn btn-secondary" to="/mock">
            前往模擬考
          </Link>
        </section>
      </div>
    </>
  );
}
