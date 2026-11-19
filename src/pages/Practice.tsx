import { NotebookPen } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, PageHead } from '../components/ui';
import { allCompetencies, questionsFor, subjectsOf } from '../content';
import { ORIGIN_LABEL } from '../content/schema';
import { useLessonProgress } from '../data/hooks';
import { startQuiz } from '../data/quizFactory';
import type { QuizMode } from '../data/types';
import { lastVisitedLesson } from '../lib/learningPath';

export function PracticePage() {
  const { level } = useApp();
  const nav = useNavigate();
  const progress = useLessonProgress(level);
  const recent = lastVisitedLesson(progress);
  const comps = allCompetencies(level);
  const [scope, setScope] = useState<string>(''); // '' = 尚未選擇
  const [count, setCount] = useState(5);
  const [mode, setMode] = useState<QuizMode>('practice');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveScope = scope || recent?.code || comps.find((c) => questionsFor({ competencyCode: c.code }).length)?.code || '';
  const codes = effectiveScope.length === 6 ? [effectiveScope] : comps.filter((c) => c.code.startsWith(effectiveScope)).map((c) => c.code);
  const available = questionsFor({ level }).filter((q) => codes.includes(q.competencyCode)).length;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const label = effectiveScope.length === 6 ? undefined : `${effectiveScope} 綜合練習`;
    const r = await startQuiz({ level, mode, count, competencyCodes: codes, scopeLabel: label });
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    nav(`/quiz/${r.sessionId}`);
  };

  const originCounts = Object.entries(
    questionsFor({ level }).reduce<Record<string, number>>((m, q) => ((m[q.origin] = (m[q.origin] ?? 0) + 1), m), {}),
  );

  return (
    <>
      <PageHead kicker="Practice" title="題庫練習" desc="從官方細項代碼選題；題數依實際收錄題目產生，不會重複或補假題。" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card" aria-labelledby="setup-title">
          <CardHead title={<span id="setup-title">練習設定</span>} />
          <label className="mb-4 block text-sm">
            <span className="mb-1 block font-bold">練習範圍</span>
            <select className="field" value={effectiveScope} onChange={(e) => setScope(e.target.value)} aria-describedby="scope-hint">
              {subjectsOf(level).map((s) => (
                <optgroup key={s.code} label={`${s.code} ${s.name}`}>
                  <option value={s.code}>{s.code} 全科（{questionsFor({ subject: s.code }).length} 題）</option>
                  {s.topics.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} {t.name}（{questionsFor({ topic: t.code }).length} 題）
                    </option>
                  ))}
                  {s.topics.flatMap((t) =>
                    t.competencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {"　"}{c.code} {c.name}（{questionsFor({ competencyCode: c.code }).length} 題）
                      </option>
                    )),
                  )}
                </optgroup>
              ))}
            </select>
            <span id="scope-hint" className="mt-1 block text-xs text-muted">
              {recent && !scope ? `預設為最近閱讀的 ${recent.code}。` : ''}此範圍目前可用 {available} 題。
            </span>
          </label>

          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-bold">題數</legend>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 20].map((n) => (
                <label key={n} className="opt !w-auto !min-h-[44px] !py-2">
                  <input type="radio" name="count" checked={count === n} onChange={() => setCount(n)} />
                  <span>{n} 題</span>
                </label>
              ))}
            </div>
            {available > 0 && available < count && (
              <p className="mt-2 text-xs text-bad" role="status">
                此範圍只有 {available} 題，將出 {available} 題（不會重複或補題）。
              </p>
            )}
          </fieldset>

          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-bold">模式</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="opt">
                <input type="radio" name="mode" checked={mode === 'practice'} onChange={() => setMode('practice')} />
                <span>
                  <strong>練習模式</strong>
                  <span className="block text-xs text-muted">每題提交後立即看解析</span>
                </span>
              </label>
              <label className="opt">
                <input type="radio" name="mode" checked={mode === 'test'} onChange={() => setMode('test')} />
                <span>
                  <strong>測驗模式</strong>
                  <span className="block text-xs text-muted">交卷前不顯示答案</span>
                </span>
              </label>
            </div>
          </fieldset>

          {msg && (
            <p className="notice mb-3" role="alert">
              {msg}
            </p>
          )}
          <button type="button" className="btn w-full sm:w-auto" onClick={start} disabled={busy || available === 0}>
            <NotebookPen size={16} /> {available === 0 ? '本範圍尚無可用題目' : '開始練習'}
          </button>
        </section>

        <aside className="card" aria-labelledby="bank-title">
          <CardHead title={<span id="bank-title">題庫概況</span>} />
          <ul className="grid gap-2 text-sm">
            {originCounts.length === 0 && <li className="text-muted">此級別尚未收錄題目。</li>}
            {originCounts.map(([o, n]) => (
              <li key={o} className="flex justify-between">
                <span>{ORIGIN_LABEL[o as keyof typeof ORIGIN_LABEL]}</span>
                <strong>{n} 題</strong>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            目前收錄皆為本站自編題，由 AI 撰寫並通過自動檢查（選項解析齊全、答案一致），尚待人工審核。正式公告原題請見「歷屆試題」頁的官方連結。
          </p>
        </aside>
      </div>
    </>
  );
}
