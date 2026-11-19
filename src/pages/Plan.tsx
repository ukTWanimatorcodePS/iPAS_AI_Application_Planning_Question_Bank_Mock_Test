import { BookOpen, CalendarDays, ClipboardList, Flame, NotebookPen, Shuffle, Timer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, PageHead, ProgressBar, Stat } from '../components/ui';
import { useAttempts, useLessonProgress, useReviewItems, useSessions } from '../data/hooks';
import { startQuiz, startReviewQuiz } from '../data/quizFactory';
import { orderedCompetencies, subjectsForTrack } from '../lib/learningPath';
import { progressMetrics } from '../lib/stats';
import { buildStudyPlan, type DayPlan, type PlanTask } from '../lib/studyPlan';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const PHASE: Record<DayPlan['phase'], string> = { learn: '學習期', sprint: '衝刺期', rest: '休息日', after: '考試後' };

export function PlanPage() {
  const { settings, level } = useApp();
  const nav = useNavigate();
  const progress = useLessonProgress(level);
  const reviews = useReviewItems(level) ?? [];
  const attempts = useAttempts(level) ?? [];
  const sessions = useSessions(level) ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const examDate = level === 'junior' ? settings.examDate.junior : settings.examDate.middle;
  const plan = buildStudyPlan({ settings, examDate, ordered: orderedCompetencies(level, settings.track), progress, reviews });
  const metrics = progressMetrics({ lessons: [...(progress?.values() ?? [])], sessions, reviews, attempts });
  const maxTrend = Math.max(1, ...metrics.trend.map((t) => t.total));

  const run = async (fn: () => Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>) => {
    if (busy) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) nav(`/quiz/${r.sessionId}`);
    else setMsg(r.message);
  };

  const action = (t: PlanTask): ReactNode => {
    switch (t.kind) {
      case 'lesson':
        return <Link className="btn btn-secondary btn-sm" to={`/courses/${t.code}`}><BookOpen size={14} /> 讀講義</Link>;
      case 'practice':
        return (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => startQuiz({ level, mode: 'practice', count: t.count, competencyCodes: [t.code] }))}>
            <NotebookPen size={14} /> 練習
          </button>
        );
      case 'review':
        return (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => startReviewQuiz(level))}>
            <ClipboardList size={14} /> 重測
          </button>
        );
      case 'weak':
        return <Link className="btn btn-secondary btn-sm" to="/sprint"><Flame size={14} /> 弱點</Link>;
      case 'mixed':
        return (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => run(() => startQuiz({ level, mode: 'test', count: t.count, subjects: subjectsForTrack(level, settings.track), scopeLabel: '全範圍混合測驗' }))}
          >
            <Shuffle size={14} /> 開始
          </button>
        );
      case 'mock':
        return <Link className="btn btn-secondary btn-sm" to="/mock"><Timer size={14} /> 模考</Link>;
    }
  };
  const label = (t: PlanTask) =>
    t.kind === 'lesson' ? `閱讀 ${t.code} ${t.name}` : t.kind === 'practice' ? `${t.code} 單元練習 ${t.count} 題` : t.kind === 'review' ? `到期錯題重測 ${t.count} 題` : t.kind === 'weak' ? `個人弱點補強 ${t.count} 題` : t.kind === 'mixed' ? `全範圍混合測驗 ${t.count} 題` : '限時自訂模考';

  const today = plan.days[0];

  return (
    <>
      <PageHead
        kicker="Study plan"
        title="學習計畫"
        desc={`依${plan.examDate ? `你設定的考試日期 ${plan.examDate}` : '每日可用時間'}、課綱範圍與目前完成度產生；考試日期為自行設定，非官方公告。`}
        actions={<Link className="btn btn-secondary btn-sm" to="/settings">調整考期與讀書時間</Link>}
      />
      {msg && <p className="notice mb-4" role="status">{msg}</p>}
      {plan.messages.map((m) => (
        <p key={m} className={`notice mb-3 ${plan.feasible ? '' : '!border-bad'}`} role="note">
          {m}
        </p>
      ))}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="距離考試" value={plan.daysLeft === null ? '未設定' : `${plan.daysLeft} 天`} note={plan.studyDaysLeft !== null ? `其中學習日 ${plan.studyDaysLeft} 天` : '請到設定填入日期'} />
        <Stat label="剩餘講義細項" value={<>{plan.remainingLessons}<span className="text-sm text-muted">/{plan.totalLessons}</span></>} note="依目前路線" />
        <Stat label="每學習日進度" value={`${plan.lessonsPerStudyDay} 細項`} note={`約 ${plan.requiredMinutesPerDay} 分鐘`} />
        <Stat label="衝刺期開始" value={<span className="text-xl">{plan.sprintStart ?? '—'}</span>} note="考前 14 天" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          <section className="card" aria-labelledby="today-plan" data-testid="today-plan">
            <CardHead title={<span id="today-plan">今天（{today.date}，週{WEEK[today.weekday]}）</span>} right={<span className="pill pill-blue">{PHASE[today.phase]}・約 {today.minutes} 分</span>} />
            {today.tasks.length === 0 ? (
              <p className="text-sm text-muted">{today.phase === 'rest' ? '今天是休息日，沒有到期錯題。好好休息！' : '今天沒有安排任務。'}</p>
            ) : (
              <ul className="grid gap-2">
                {today.tasks.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                    <span className="min-w-0 text-sm">
                      {label(t)} <span className="text-xs text-muted">・約 {t.minutes} 分</span>
                    </span>
                    {action(t)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="week-plan">
            <CardHead title={<span id="week-plan" className="inline-flex items-center gap-1.5"><CalendarDays size={16} /> 接下來 6 天</span>} />
            <ol className="grid gap-2">
              {plan.days.slice(1).map((d) => (
                <li key={d.date} className="rounded-lg border border-line p-3">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong>
                      {d.date}（週{WEEK[d.weekday]}）
                    </strong>
                    <span className={`pill ${d.phase === 'sprint' ? 'pill-warn' : d.phase === 'rest' ? '' : 'pill-blue'}`}>
                      {PHASE[d.phase]}{d.minutes ? `・約 ${d.minutes} 分` : ''}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{d.tasks.length ? d.tasks.map(label).join('；') : '無安排'}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="grid content-start gap-5">
          <section className="card" aria-labelledby="progress-card" data-testid="progress-card">
            <CardHead title={<span id="progress-card">學習進度</span>} />
            <ul className="grid gap-3 text-sm">
              <li>
                <div className="flex justify-between">
                  <span>已讀講義</span>
                  <strong>
                    {metrics.lessonsRead}/{plan.totalLessons}
                  </strong>
                </div>
                <ProgressBar value={(metrics.lessonsRead / Math.max(1, plan.totalLessons)) * 100} label="已讀講義比例" />
              </li>
              <li className="flex justify-between">
                <span>完成測驗</span>
                <strong>{metrics.quizzesCompleted} 次</strong>
              </li>
              <li>
                <div className="flex justify-between">
                  <span>錯題訂正率</span>
                  <strong>{metrics.correctionRate === null ? '尚無錯題' : `${metrics.correctionRate}%`}</strong>
                </div>
                {metrics.correctionRate !== null && <ProgressBar value={metrics.correctionRate} label="錯題訂正率" tone="ok" />}
              </li>
              <li className="flex justify-between">
                <span>已掌握錯題</span>
                <strong>{metrics.masteredRate === null ? '—' : `${metrics.masteredRate}%`}</strong>
              </li>
              <li className="flex justify-between">
                <span>今日待複習</span>
                <strong>{metrics.pendingReviews} 題</strong>
              </li>
            </ul>
            <h3 className="mt-4 mb-2 text-sm font-bold">近 14 天作答量</h3>
            <div className="flex h-24 items-end gap-1" role="img" aria-label={`近 14 天每日作答題數：${metrics.trend.map((t) => t.total).join('、')}`}>
              {metrics.trend.map((t) => (
                <div key={t.date} className="flex h-full flex-1 flex-col justify-end" title={`${t.date}：${t.total} 題，答對 ${t.correct}`}>
                  <div className="rounded-t bg-primary-soft" style={{ height: `${(t.total / maxTrend) * 100}%` }}>
                    <div className="rounded-t" style={{ height: t.total ? `${(t.correct / t.total) * 100}%` : 0, background: 'var(--c-ok-bar)' }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[0.7rem] text-muted">淺色為作答數、綠色為答對比例。</p>
          </section>
        </aside>
      </div>
    </>
  );
}
