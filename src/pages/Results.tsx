import { BookOpen, ClipboardList, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useApp } from '../app/AppContext';
import { Explanation } from '../components/Explanation';
import { CodeBlock } from '../components/CodeBlock';
import { EmptyState, PageHead, Stat } from '../components/ui';
import { formatDateTime, formatDuration } from '../lib/format';
import { getCompetency, getQuestion } from '../content';
import { useSession } from '../data/hooks';
import { startQuiz, startReviewQuiz } from '../data/quizFactory';
import { MODE_LABEL, isVerifySession } from '../data/types';
import { isCorrect, scoreSession } from '../lib/scoring';

export function ResultsPage() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const { settings } = useApp();
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session === undefined) return <p className="p-8 text-center text-muted">載入中…</p>;
  if (session === null)
    return (
      <div className="card">
        <EmptyState title="找不到測驗結果" action={<Link className="btn" to="/practice">回到題庫練習</Link>} />
      </div>
    );
  if (!session.submittedAt) return <Navigate to={`/quiz/${session.sessionId}`} replace />;

  const sum = scoreSession(session.questionIds, session.answers, getQuestion);
  const pass = sum.scorePct >= settings.passThreshold;
  const wrongComps = [
    ...new Set(
      session.questionIds
        .map((id) => getQuestion(id))
        .filter((q) => q && !isCorrect(q, session.answers[q.id]))
        .map((q) => q!.competencyCode),
    ),
  ];

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    const r =
      session.mode === 'review'
        ? await startReviewQuiz(session.level)
        : await startQuiz({
            level: session.level,
            mode: session.mode,
            count: session.questionIds.length,
            competencyCodes: session.competencyCodes.length ? session.competencyCodes : undefined,
            subjects: session.competencyCodes.length ? undefined : session.subject ? [session.subject] : undefined,
            scopeLabel: session.scopeLabel,
            timeLimitSec: session.timeLimitSec,
            // 驗證測驗重做時仍只出沒看過的題目；沒有新題目時會顯示提示，不會出現已看過的題目
            unseenOnly: isVerifySession(session),
          });
    setBusy(false);
    if (r.ok) nav(`/quiz/${r.sessionId}`);
    else setMsg(r.message);
  };

  return (
    <>
      <PageHead
        kicker="Your result"
        title="測驗結果"
        desc={`${MODE_LABEL[session.mode]}・${session.scopeLabel}・${formatDateTime(session.submittedAt)}`}
        actions={
          <>
            <Link className="btn btn-ghost" to="/review">
              <ClipboardList size={16} /> 錯題本
            </Link>
            <button type="button" className="btn" onClick={retry} disabled={busy} data-testid="retry">
              <RotateCcw size={16} /> 再做一次
            </button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="本次得分" value={`${sum.scorePct}%`} note={`門檻 ${settings.passThreshold}%`} />
        <Stat label="答對題數" value={`${sum.correct}/${sum.total}`} note={sum.unanswered ? `${sum.unanswered} 題未作答以不得分計` : '全部作答'} />
        <Stat label="作答正確率" value={sum.accuracyPct === null ? '—' : `${sum.accuracyPct}%`} note="只計已作答題目" />
        <Stat label="作答時間" value={<span className="text-xl">{formatDuration(session.durationSec)}</span>} />
      </div>
      {sum.missingQuestionIds.length > 0 && (
        <p className="notice mb-4">有 {sum.missingQuestionIds.length} 題已自題庫移除，不列入計分分母。</p>
      )}
      {msg && <p className="notice mb-4" role="status">{msg}</p>}

      <section className={`card mb-5 ${pass ? '' : 'border-bad'}`} aria-label="學習建議">
        <h2 className="mb-1 text-base font-bold">{pass ? '表現不錯，可以繼續下一單元' : '建議先回講義補強，再做未作過的題目'}</h2>
        <p className="text-sm text-muted">
          {pass
            ? '答錯的題目已收錄到錯題本，系統會依 1／3／7／14 天間隔提醒你複習。'
            : '低於門檻時，先重讀答錯題目對應的考點，再用「再做一次」練習——系統會優先出你還沒做過的題目，避免只背同一題答案。'}
        </p>
        {wrongComps.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {wrongComps.map((c) => (
              <Link key={c} className="btn btn-secondary btn-sm" to={`/courses/${c}`}>
                <BookOpen size={14} /> 重讀 {c} {getCompetency(c)?.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4">
        {session.questionIds.map((id, i) => {
          const q = getQuestion(id);
          if (!q)
            return (
              <section key={id} className="card text-sm text-muted">
                第 {i + 1} 題已自題庫移除。
              </section>
            );
          const ok = isCorrect(q, session.answers[id]);
          return (
            <section key={id} className="card" aria-labelledby={`r-${id}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="pill">第 {i + 1} 題・{q.competencyCode}</span>
                <span className={`pill ${ok ? 'pill-green' : 'pill-red'}`}>{ok ? '✓ 答對' : session.answers[id]?.length ? '✕ 答錯' : '— 未作答'}</span>
              </div>
              <h3 id={`r-${id}`} className="font-bold whitespace-pre-wrap">
                {q.stem}
              </h3>
              {q.code && <CodeBlock code={q.code} language={q.codeLanguage} />}
              <Explanation q={q} selected={session.answers[id]} order={session.optionOrders?.[id]} />
            </section>
          );
        })}
      </div>
    </>
  );
}
