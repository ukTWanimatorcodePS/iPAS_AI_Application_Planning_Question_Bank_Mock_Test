import { Timer } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, PageHead } from '../components/ui';
import { questionsFor, subjectsOf } from '../content';
import { activeRules, RULES_DISCLAIMER } from '../config/examRules';
import type { SubjectCode } from '../content/schema';
import { startQuiz } from '../data/quizFactory';
import { subjectsForTrack } from '../lib/learningPath';

export function MockPage() {
  const { level, settings } = useApp();
  const nav = useNavigate();
  const subjects = subjectsOf(level).filter((s) => subjectsForTrack(level, settings.track).includes(s.code));
  const [picked, setSubject] = useState<SubjectCode>(subjects[0].code);
  const subject = subjects.some((s) => s.code === picked) ? picked : subjects[0].code;
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rules = activeRules();
  const available = questionsFor({ subject }).length;
  const officialCount = rules.questionCount[subject];
  const officialMin = rules.durationMinutes[subject];

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const n = Math.min(count, available);
    const r = await startQuiz({
      level,
      mode: 'mock',
      count: n,
      subjects: [subject],
      scopeLabel: `${subject} 自訂模考（${n} 題／${minutes} 分）`,
      timeLimitSec: Math.max(1, minutes) * 60,
    });
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    nav(`/quiz/${r.sessionId}`);
  };

  return (
    <>
      <PageHead
        kicker="Mock exam"
        title="自訂模考"
        desc="依科目、題量與時間自行組卷：計時、跳題、標記待檢、交卷確認；同一份試卷不重複出題。"
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card" aria-labelledby="mock-title">
          <CardHead title={<span id="mock-title">組卷設定</span>} right={<span className="pill pill-warn">自訂模考・題目為本站自編</span>} />
          <label className="mb-4 block text-sm">
            <span className="mb-1 block font-bold">科目</span>
            <select className="field" value={subject} onChange={(e) => setSubject(e.target.value as SubjectCode)}>
              {subjects.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} {s.name}（題庫 {questionsFor({ subject: s.code }).length} 題）
                </option>
              ))}
            </select>
          </label>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">題數</span>
              <input className="field" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">時間（分鐘）</span>
              <input className="field" type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} />
            </label>
          </div>
          {officialCount && officialMin && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mb-4"
              data-testid="apply-official-format"
              onClick={() => {
                setCount(officialCount);
                setMinutes(officialMin);
              }}
            >
              套用 {rules.year - 1911} 年官方題數與時間（{officialCount} 題／{officialMin} 分鐘）
            </button>
          )}
          {available < count && (
            <p className="notice mb-4" role="status">
              題庫目前只有 {available} 題，無法組成 {count} 題的試卷。{available > 0 ? `將以 ${available} 題出題，不會重複或補入假題。` : ''}
            </p>
          )}
          {msg && <p className="notice mb-3" role="alert">{msg}</p>}
          <button type="button" className="btn" onClick={start} disabled={busy || available === 0}>
            <Timer size={16} /> 開始模考
          </button>
          <p className="mt-2 text-xs text-muted" data-testid="mock-timing-note">
            計時依實際經過時間：開始後切換分頁、離開或重新整理頁面，時間都會繼續計算，時間到自動交卷。
          </p>
        </section>
        <aside className="card text-sm" aria-labelledby="rule-title">
          <CardHead title={<span id="rule-title">官方考試規格</span>} right={<span className="pill">{rules.year - 1911} 年（{rules.year}）</span>} />
          <p data-testid="official-format">
            {subject}：{officialCount ? `單選題 ${officialCount} 題` : '題數尚未核實'}／{officialMin ? `${officialMin} 分鐘` : '時間尚未核實'}
          </p>
          {rules.formatNote && <p className="mt-2 text-muted">{rules.formatNote}</p>}
          <p className="mt-2 text-muted">
            以上依 {rules.year - 1911} 年度官方簡章，查核日期 {rules.lastVerifiedAt}；{rules.year - 1910} 年以新簡章為準。本站模考可套用官方題數與時間，但題目為自編，難度與正式考試不一定相同，因此仍標示「自訂模考」。
          </p>
          {level === 'middle' && rules.middle.codingQuestionShareNote && <p className="mt-2 text-muted">{rules.middle.codingQuestionShareNote}</p>}
          <p className="mt-2 text-xs text-muted">{RULES_DISCLAIMER}</p>
          <ul className="mt-2 text-xs">
            {rules.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
