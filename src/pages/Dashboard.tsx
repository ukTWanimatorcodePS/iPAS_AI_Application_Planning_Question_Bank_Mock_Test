import { ArrowRight, BookOpen, CalendarDays, ClipboardList, NotebookPen, PlayCircle, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, EmptyState, OfficialDisclaimer, PageHead, ProgressBar, Stat } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { Onboarding } from '../components/Onboarding';
import { allCompetencies, getCompetency, getSubject, hasLesson } from '../content';
import { RULES_DISCLAIMER } from '../config/examRules';
import { latestUnfinished } from '../data/repo';
import { useAttempts, useLessonProgress, useReviewItems, useSessions } from '../data/hooks';
import type { QuizSession } from '../data/types';
import { MODE_LABEL } from '../data/types';
import { lastVisitedLesson, nextLesson, subjectsForTrack } from '../lib/learningPath';
import { isDue } from '../lib/review';
import { accuracy } from '../lib/scoring';
import { competencyStats } from '../lib/stats';

export function Dashboard() {
  const { settings, level } = useApp();
  const progress = useLessonProgress(level);
  const attempts = useAttempts(level);
  const reviews = useReviewItems(level);
  const sessions = useSessions(level);
  const [unfinished, setUnfinished] = useState<QuizSession | undefined>();

  useEffect(() => {
    latestUnfinished(level).then(setUnfinished);
  }, [level, sessions]);

  const comps = allCompetencies(level);
  const done = comps.filter((c) => progress?.get(c.code)?.completedAt).length;
  const next = nextLesson(level, settings.track, progress);
  const last = lastVisitedLesson(progress);
  const lastComp = last && !last.completedAt ? getCompetency(last.code) : undefined;
  const resume = lastComp ?? next;
  const correct = attempts?.filter((a) => a.correct).length ?? 0;
  const acc = accuracy(correct, attempts?.length ?? 0);
  const dueCount = reviews?.filter((r) => isDue(r)).length ?? 0;
  const unresolved = reviews?.filter((r) => r.masteryStatus === 'unresolved').length ?? 0;
  const recent = (sessions ?? []).filter((s) => s.submittedAt).slice(0, 4);
  const today = new Date().getDay();
  const isRest = settings.restDays.includes(today);
  const weak = competencyStats(attempts ?? [], 3)
    .filter((s) => s.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, 3);
  const goal = level === 'junior' ? settings.studyGoal.junior : settings.studyGoal.middle;

  return (
    <>
      {!settings.onboarded && <Onboarding />}
      <PageHead
        kicker="Learning dashboard"
        title="準備好，繼續朝考照目標前進。"
        desc={`依官方評鑑範圍（115.06 版）建立課程架構。${RULES_DISCLAIMER.split('。')[0]}。`}
      />

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="grid min-w-0 content-start gap-5 xl:col-span-8">
          {unfinished && (
            <div className="card flex flex-col gap-3 border-primary sm:flex-row sm:items-center sm:justify-between" role="status">
              <div>
                <div className="text-sm font-bold">你有一份未完成的測驗</div>
                <div className="text-xs text-muted">
                  {MODE_LABEL[unfinished.mode]}・{unfinished.scopeLabel}・已作答 {Object.keys(unfinished.answers).length}/{unfinished.questionIds.length}
                </div>
              </div>
              <Link className="btn" to={`/quiz/${unfinished.sessionId}`}>
                <PlayCircle size={18} aria-hidden /> 繼續作答
              </Link>
            </div>
          )}

          <section className="hero" aria-labelledby="hero-title">
            <div className="text-xs font-bold text-white/80">
              你的學習目標・{goal}｜{level === 'junior' ? '初級' : '中級'}
            </div>
            <h2 id="hero-title" className="mt-2 max-w-xl text-xl leading-snug font-extrabold md:text-2xl">
              {resume ? `${lastComp ? '接著讀' : '下一步'}：${resume.code} ${resume.name}` : '從基本觀念開始。'}
            </h2>
            <p className="mt-2 mb-5 max-w-xl text-sm text-white/85">先讀講義，再做單元測驗；錯題會保留並依間隔提醒複習。</p>
            {resume && (
              <Link
                to={`/courses/${resume.code}`}
                className="btn relative z-10 !border-white !bg-white !text-[#3442b0]"
                data-testid="continue-learning"
              >
                繼續學習 {resume.code} <ArrowRight size={18} aria-hidden />
              </Link>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="已完成講義細項" value={<>{done}<span className="text-sm text-muted">/{comps.length}</span></>} note="依官方細項代碼計算" />
            <Stat label="累計作答題數" value={attempts?.length ?? 0} note="含練習與測驗" />
            <div className="col-span-2 md:col-span-1">
              <Stat label="累計正確率" value={acc === null ? '—' : `${acc}%`} note={attempts?.length ? '依實際作答紀錄' : '尚無作答紀錄'} />
            </div>
          </div>

          <section className="card" aria-labelledby="progress-title">
            <CardHead title={<span id="progress-title">各科進度</span>} right={<Link className="link" to="/courses">查看所有課程 <ArrowRight size={15} /></Link>} />
            {subjectsForTrack(level, 'both').map((code) => {
              const s = getSubject(code);
              const list = comps.filter((c) => c.subject.code === code);
              const d = list.filter((c) => progress?.get(c.code)?.completedAt).length;
              const pct = list.length ? (d / list.length) * 100 : 0;
              const lessonsReady = list.filter((c) => hasLesson(c.code)).length;
              return (
                <div key={code} className="my-4 flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-soft text-sm font-extrabold text-primary">{code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <strong className="text-sm">{s.name}</strong>
                      <span className="text-[0.72rem] text-muted">
                        已讀 {d}/{list.length}・講義收錄 {lessonsReady}/{list.length}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={pct} label={`${s.name} 完成度`} />
                    </div>
                  </div>
                  <span className="w-10 text-right text-xs font-extrabold text-primary">{Math.round(pct)}%</span>
                </div>
              );
            })}
          </section>
        </div>

        <div className="grid min-w-0 content-start gap-5 xl:col-span-4">
          <section className="card" aria-labelledby="today-title">
            <CardHead title={<span id="today-title">今日任務</span>} right={<span className="pill pill-blue">{isRest ? '休息日' : '學習日'}</span>} />
            {isRest && <p className="mb-2 text-sm text-muted">今天是你設定的休息日，可以只做到期錯題或輕鬆複習。</p>}
            <TaskRow icon={<CalendarDays size={18} />} title="查看今日學習計畫" desc={(level === 'junior' ? settings.examDate.junior : settings.examDate.middle) ? '依考試日期倒數安排' : '設定考試日期可產生倒數計畫'} to="/plan" />
            <TaskRow icon={<BookOpen size={18} />} title="閱讀下一個單元" desc={next ? `${next.code} ${next.name}` : '已全部完成'} to={next ? `/courses/${next.code}` : '/courses'} />
            <TaskRow icon={<NotebookPen size={18} />} title="單元練習" desc="從已讀單元挑 5～10 題" to="/practice" />
            <TaskRow icon={<ClipboardList size={18} />} title="到期錯題複習" desc={`${dueCount} 題到期・${unresolved} 題尚未訂正`} to="/review" />
          </section>

          <section className="card" aria-labelledby="goal-title">
            <CardHead title={<span id="goal-title">考點掌握度</span>} right={<Link className="link" to="/stats">分析</Link>} />
            {weak.length === 0 ? (
              <p className="text-sm text-muted">每個細項至少作答 3 題後，才會顯示掌握度，避免樣本太少造成誤判。</p>
            ) : (
              weak.map((w) => (
                <div key={w.code} className="mb-3">
                  <div className="flex justify-between text-sm">
                    <span>{w.code} {getCompetency(w.code)?.name}</span>
                    <span className="font-bold">{w.accuracy}%</span>
                  </div>
                  <ProgressBar value={w.accuracy ?? 0} label={`${w.code} 正確率`} tone={(w.accuracy ?? 0) >= settings.passThreshold ? 'ok' : 'bad'} />
                </div>
              ))
            )}
          </section>

          <section className="card" aria-labelledby="recent-title">
            <CardHead title={<span id="recent-title">最近測驗</span>} right={<Link className="link" to="/stats">查看成績</Link>} />
            {recent.length === 0 ? (
              <EmptyState title="尚無測驗紀錄">完成第一次測驗後，就會看到成績。</EmptyState>
            ) : (
              <ul>
                {recent.map((s) => {
                  const pct = s.validCount ? Math.round(((s.rawScore ?? 0) / s.validCount) * 100) : 0;
                  return (
                    <li key={s.sessionId} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-0">
                      <Link to={`/results/${s.sessionId}`} className="min-w-0 text-ink no-underline">
                        <strong className="block truncate text-sm">{s.scopeLabel}</strong>
                        <small className="text-muted">{MODE_LABEL[s.mode]}・{formatDateTime(s.submittedAt!)}</small>
                      </Link>
                      <span className={`pill ${pct >= settings.passThreshold ? 'pill-green' : 'pill-red'}`}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" aria-label="考試資訊">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Target size={16} aria-hidden /> 目標考期：{goal}
            </div>
            <p className="text-xs text-muted">官方尚未公告 2027 確切考試日期時，本站不顯示日期。{RULES_DISCLAIMER}</p>
          </section>
          <OfficialDisclaimer compact />
        </div>
      </div>
    </>
  );
}

function TaskRow({ icon, title, desc, to }: { icon: React.ReactNode; title: string; desc: string; to: string }) {
  return (
    <Link to={to} className="flex min-h-[56px] items-center gap-3 border-b border-line py-3 text-ink no-underline last:border-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-soft text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm">{title}</strong>
        <span className="block truncate text-xs text-muted">{desc}</span>
      </span>
      <span className="link">前往</span>
    </Link>
  );
}
