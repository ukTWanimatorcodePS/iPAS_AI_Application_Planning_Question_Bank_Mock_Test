import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../app/AppContext';
import { CardHead, EmptyState, PageHead, ProgressBar, Stat } from '../components/ui';
import { formatDuration } from '../lib/format';
import { getCompetency, getQuestion, getSubject } from '../content';
import { judgeJunior, judgeMiddle, RULES_DISCLAIMER } from '../config/examRules';
import { DIFFICULTY_LABEL, ORIGIN_LABEL, QTYPE_LABEL } from '../content/schema';
import { downloadText, exportBackup, toCsv } from '../data/backup';
import { useAttempts, useLessonProgress, useSessions } from '../data/hooks';
import { MODE_LABEL } from '../data/types';
import { subjectsForTrack } from '../lib/learningPath';
import { MIN_SAMPLE, competencyStats, dimensionStats, mostMissed, planCompletion, sessionPct, subjectStats } from '../lib/stats';

export default function StatsPage() {
  const { level, settings } = useApp();
  const attempts = useAttempts(level) ?? [];
  const sessions = useSessions(level) ?? [];
  const lessons = [...(useLessonProgress(level)?.values() ?? [])];
  const submitted = sessions.filter((s) => s.submittedAt).sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
  const subj = subjectStats(attempts);
  const comp = competencyStats(attempts);
  const weak = comp.filter((c) => c.accuracy !== null).sort((a, b) => a.accuracy! - b.accuracy!).slice(0, 5);
  const missed = mostMissed(attempts);
  const quizTime = submitted.reduce((a, s) => a + s.durationSec, 0);
  const readTime = lessons.reduce((a, l) => a + l.timeSpentSec, 0);
  const week = planCompletion('week', settings, sessions, lessons);
  const month = planCompletion('month', settings, sessions, lessons);

  const trend = submitted.slice(-20).map((s, i) => ({ name: `#${i + 1}`, score: sessionPct(s) ?? 0, label: s.scopeLabel }));
  const subjChart = subj.map((s) => ({ name: s.code, accuracy: s.accuracy ?? 0, insufficient: s.accuracy === null, total: s.total }));

  const byOrigin = attempts.reduce<Record<string, { total: number; correct: number }>>((m, a) => {
    const o = getQuestion(a.questionId)?.origin ?? 'unknown';
    m[o] ??= { total: 0, correct: 0 };
    m[o].total++;
    if (a.correct) m[o].correct++;
    return m;
  }, {});

  // 模擬判定：取各科最近一次「自訂模考」分數
  const latestMock: Record<string, number> = {};
  for (const s of submitted) if (s.mode === 'mock' && s.subject) latestMock[s.subject] = sessionPct(s) ?? 0;
  const mockSubjects = Object.keys(latestMock);

  const exportCsv = () => {
    const rows = attempts.map((a) => ({
      answeredAt: a.answeredAt,
      questionId: a.questionId,
      subject: a.subject,
      competencyCode: a.competencyCode,
      mode: MODE_LABEL[a.mode],
      selected: a.selectedIds.join('|'),
      correct: a.correct ? 1 : 0,
      timeSec: Math.round(a.timeMs / 1000),
    }));
    downloadText(`AI備考室_作答紀錄_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, Object.keys(rows[0] ?? { answeredAt: '' })), 'text/csv');
  };
  const exportJson = async () => downloadText(`AI備考室_備份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportBackup(), null, 2));

  return (
    <>
      <PageHead
        kicker="Analytics"
        title="成績分析"
        desc={`${level === 'junior' ? '初級' : '中級'}學習紀錄。樣本少於 ${MIN_SAMPLE} 題的項目顯示「樣本不足」，避免過度解讀。`}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!attempts.length}>
              <Download size={14} /> CSV
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportJson}>
              <Download size={14} /> JSON
            </button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="完成測驗" value={submitted.length} />
        <Stat label="作答題數" value={attempts.length} />
        <Stat label="測驗時間" value={<span className="text-xl">{formatDuration(quizTime)}</span>} />
        <Stat label="講義閱讀" value={<span className="text-xl">{formatDuration(readTime)}</span>} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card" aria-labelledby="st-subj">
          <CardHead title={<span id="st-subj">科目正確率</span>} />
          {subj.length === 0 ? (
            <EmptyState title="尚無作答紀錄" />
          ) : (
            <>
              <div className="h-56" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                    <XAxis dataKey="name" stroke="var(--c-muted)" />
                    <YAxis domain={[0, 100]} stroke="var(--c-muted)" />
                    <Tooltip />
                    <Bar dataKey="accuracy" name="正確率 %" fill="#4355dc" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 text-sm">
                {subj.map((s) => (
                  <li key={s.code} className="flex justify-between border-b border-line py-1.5 last:border-0">
                    <span>
                      {s.code} {getSubject(s.code as 'L11').shortName}
                    </span>
                    <span>{s.accuracy === null ? `樣本不足（${s.total} 題）` : `${s.accuracy}%（${s.correct}/${s.total}）`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="st-trend">
          <CardHead title={<span id="st-trend">歷次測驗趨勢</span>} right={<span className="pill">最近 20 次</span>} />
          {trend.length < 2 ? (
            <EmptyState title="樣本不足">完成至少 2 次測驗後顯示趨勢。</EmptyState>
          ) : (
            <div className="h-64" aria-label={`最近 ${trend.length} 次測驗分數：${trend.map((t) => t.score).join('、')}`} role="img">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                  <XAxis dataKey="name" stroke="var(--c-muted)" />
                  <YAxis domain={[0, 100]} stroke="var(--c-muted)" />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" name="得分 %" stroke="#19a987" strokeWidth={2.5} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="st-weak">
          <CardHead title={<span id="st-weak">弱點排名（細項正確率最低）</span>} />
          {weak.length === 0 ? (
            <p className="text-sm text-muted">每個細項至少作答 {MIN_SAMPLE} 題後才列入排名。</p>
          ) : (
            weak.map((w, i) => (
              <div key={w.code} className="mb-3">
                <div className="flex justify-between gap-2 text-sm">
                  <span>
                    {i + 1}. {w.code} {getCompetency(w.code)?.name}
                  </span>
                  <strong>{w.accuracy}%</strong>
                </div>
                <ProgressBar value={w.accuracy!} label={`${w.code} 正確率`} tone={w.accuracy! >= settings.passThreshold ? 'ok' : 'bad'} />
              </div>
            ))
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">全部細項正確率</summary>
            <ul className="mt-2">
              {comp.map((c) => (
                <li key={c.code} className="flex justify-between border-b border-line py-1 last:border-0">
                  <span>{c.code}</span>
                  <span>{c.accuracy === null ? `樣本不足（${c.total}）` : `${c.accuracy}%（${c.correct}/${c.total}）`}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="card" aria-labelledby="st-dim" data-testid="stats-dimension">
          <CardHead title={<span id="st-dim">依難度與題型的正確率</span>} />
          {attempts.length === 0 ? (
            <p className="text-sm text-muted">尚無作答紀錄。</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['難度', dimensionStats(attempts, 'difficultyTier', getQuestion), DIFFICULTY_LABEL],
                  ['題型', dimensionStats(attempts, 'questionType', getQuestion), QTYPE_LABEL],
                ] as const
              ).map(([title, rows, labels]) => (
                <div key={title}>
                  <h3 className="mb-1 text-sm font-bold">{title}</h3>
                  <ul className="text-sm">
                    {rows.map((r) => (
                      <li key={r.code} className="flex justify-between gap-2 border-b border-line py-1 last:border-0">
                        <span>{(labels as Record<string, string>)[r.code] ?? '已移除題目'}</span>
                        <span>{r.accuracy === null ? `樣本不足（${r.total}）` : `${r.accuracy}%（${r.correct}/${r.total}）`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">每組至少 {MIN_SAMPLE} 題才計算正確率。</p>
        </section>

        <section className="card" aria-labelledby="st-plan">
          <CardHead title={<span id="st-plan">學習計畫完成率</span>} />
          {[
            ['本週', week],
            ['本月', month],
          ].map(([label, p]) => {
            const v = p as typeof week;
            return (
              <div key={label as string} className="mb-4">
                <div className="flex justify-between text-sm">
                  <span>{label as string}</span>
                  <span>
                    {v.actualMin} / {v.plannedMin} 分鐘{v.pct !== null ? `（${v.pct}%）` : ''}
                  </span>
                </div>
                <ProgressBar value={v.pct ?? 0} label={`${label}計畫完成率`} tone="ok" />
              </div>
            );
          })}
          <p className="text-xs text-muted">計畫 = 可讀日 × 每日最少 {settings.dailyMinutes.min} 分；實際 = 講義閱讀 + 測驗作答時間（頁面可見時才計時）。</p>
        </section>

        <section className="card" aria-labelledby="st-missed">
          <CardHead title={<span id="st-missed">最常錯的題目</span>} />
          {missed.length === 0 ? (
            <p className="text-sm text-muted">尚無錯題。</p>
          ) : (
            <ol className="ml-4 list-decimal text-sm">
              {missed.map((m) => (
                <li key={m.questionId} className="py-1">
                  {getQuestion(m.questionId)?.stem ?? m.questionId}
                  <span className="pill pill-red ml-2">錯 {m.count} 次</span>
                </li>
              ))}
            </ol>
          )}
          <h3 className="mt-4 mb-1 text-sm font-bold">依題源區分</h3>
          <ul className="text-sm">
            {Object.entries(byOrigin).map(([o, v]) => (
              <li key={o} className="flex justify-between">
                <span>{ORIGIN_LABEL[o as keyof typeof ORIGIN_LABEL] ?? '已移除題目'}</span>
                <span>
                  {v.correct}/{v.total}
                </span>
              </li>
            ))}
            {Object.keys(byOrigin).length === 0 && <li className="text-muted">尚無資料</li>}
          </ul>
        </section>

        <section className="card" aria-labelledby="st-pass">
          <CardHead title={<span id="st-pass">模擬及格判定</span>} right={<span className="pill pill-warn">僅供參考</span>} />
          {mockSubjects.length === 0 ? (
            <p className="text-sm text-muted">完成「自訂模考」後，會以各科最近一次模考分數套用 2026 官方及格規則試算。</p>
          ) : level === 'junior' ? (
            (() => {
              const v = judgeJunior(latestMock, true);
              return (
                <p className="text-sm">
                  同次全科報考試算：<strong className={v.passed ? 'text-ok' : 'text-bad'}>{v.passed ? '達標' : '未達標'}</strong>（{v.reason}）
                </p>
              );
            })()
          ) : (
            <ul className="text-sm">
              {judgeMiddle(latestMock)
                .certificates.filter((c) => subjectsForTrack('middle', settings.track).some((s) => c.id === 'data' ? s === 'L22' : s === 'L23'))
                .map((c) => (
                  <li key={c.id}>
                    {c.name}：<strong className={c.passed ? 'text-ok' : 'text-bad'}>{c.passed ? '達標' : `未達標（${c.missing.join('、')} 未達 70 或尚未模考）`}</strong>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            本站題庫為自編題，題量與難度未必等同正式考試，判定結果不代表實際考試結果。{RULES_DISCLAIMER}
          </p>
        </section>
      </div>
    </>
  );
}
