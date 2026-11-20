import { ArrowLeft, ArrowRight, Clock, Flag, Grid3X3, LogOut, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { clearChatContext, setChatContext, type ChatContext } from '../ai/byok/context';
import { Drawer } from '../app/Layout';
import { Explanation, OriginBadge } from '../components/Explanation';
import { CodeBlock } from '../components/CodeBlock';
import { ConfirmDialog, EmptyState } from '../components/ui';
import { getQuestion } from '../content';
import { useSession } from '../data/hooks';
import { patchSession, revealQuestion, setAnswer, submitSession } from '../data/repo';
import { MODE_LABEL, type QuizSession } from '../data/types';
import { recordedDuration, wallElapsedSec } from '../lib/timer';
import { displayOptions } from '../lib/optionOrder';

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function QuizPage() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  if (session === undefined) return <p className="p-8 text-center text-muted" role="status">載入測驗中…</p>;
  if (session === null)
    return (
      <div className="card">
        <EmptyState title="找不到這份測驗" action={<a className="btn" href="#/practice">回到題庫練習</a>}>
          測驗可能已被清除或連結錯誤。
        </EmptyState>
      </div>
    );
  if (session.submittedAt) return <Navigate to={`/results/${session.sessionId}`} replace />;
  return <Runner session={session} />;
}

function Runner({ session }: { session: QuizSession }) {
  const nav = useNavigate();
  const [index, setIndex] = useState(Math.min(session.currentIndex, session.questionIds.length - 1));
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 限時模考依實際經過時間（從開始時刻算起）計時：切到其他分頁、離開頁面或重新整理，時間都照走，不能暫停延長。
  // 不限時的練習與測驗則只累計頁面可見的時間，作為學習時間統計。
  const timed = session.timeLimitSec != null;
  const startMs = Date.parse(session.startAt);
  const initialElapsed = timed ? Math.max(session.durationSec, wallElapsedSec(startMs)) : session.durationSec;
  const [elapsed, setElapsed] = useState(initialElapsed);
  const elapsedRef = useRef(initialElapsed);
  const qStart = useRef(Date.now());
  const submitting = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const ids = session.questionIds;
  const qid = ids[index];
  const q = getQuestion(qid);
  const selected = session.answers[qid] ?? [];
  const revealed = session.revealed.includes(qid);
  const isPractice = session.mode === 'practice';
  const answeredCount = ids.filter((id) => session.answers[id]?.length).length;
  const { pathname } = useLocation();

  // AI 導師情境：測驗、模擬考、錯題重測交卷前鎖定；練習模式提交前只給提示，提交後才附上解析
  const answerKey = selected.join(',');
  useEffect(() => {
    const c: ChatContext = !isPractice
      ? { kind: 'locked', reason: '測驗進行中：交卷前不能使用 AI 導師，避免作答時看到答案提示。交卷後可在結果頁對每題「問 AI 導師」。', path: pathname }
      : q
        ? { kind: 'question', question: q, order: session.optionOrders?.[qid], selected, answerVisible: revealed, label: `第 ${index + 1} 題・${q.competencyCode}`, path: pathname }
        : { kind: 'none', path: pathname };
    setChatContext(c);
    return () => clearChatContext(c);
    // selected 以 answerKey 代表，避免每次渲染都重新登記
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid, revealed, isPractice, answerKey, pathname, index]);
  const remaining = session.timeLimitSec ? session.timeLimitSec - elapsed : null;

  const doSubmit = useCallback(async () => {
    if (submitting.current) return; // 防止重複交卷
    submitting.current = true;
    setBusy(true);
    await submitSession(session.sessionId, recordedDuration(elapsedRef.current, session.timeLimitSec));
    nav(`/results/${session.sessionId}`, { replace: true });
  }, [nav, session.sessionId, session.timeLimitSec]);

  // 計時：限時模考依實際時間；其他模式只在頁面可見時累計。每 10 秒寫回
  useEffect(() => {
    const tick = () => {
      if (timed) {
        elapsedRef.current = Math.max(elapsedRef.current, wallElapsedSec(startMs));
      } else {
        if (document.visibilityState !== 'visible') return;
        elapsedRef.current += 1;
      }
      setElapsed(elapsedRef.current);
      if (elapsedRef.current % 10 === 0) patchSession(session.sessionId, { durationSec: elapsedRef.current });
    };
    const t = setInterval(tick, 1000);
    // 回到分頁時立即重算，到期就馬上交卷（背景分頁的計時器可能被瀏覽器延後）
    const onVisible = () => {
      if (timed && document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      patchSession(session.sessionId, { durationSec: elapsedRef.current });
    };
  }, [session.sessionId, timed, startMs]);

  // 模考時間到自動交卷
  useEffect(() => {
    if (remaining !== null && remaining <= 0) doSubmit();
  }, [remaining, doSubmit]);

  // 離開頁面提示（作答已自動儲存）
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, []);

  const go = (i: number) => {
    const n = Math.max(0, Math.min(ids.length - 1, i));
    setIndex(n);
    setNavOpen(false);
    qStart.current = Date.now();
    patchSession(session.sessionId, { currentIndex: n });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      headingRef.current?.focus();
    });
  };

  const choose = (optionId: string) => {
    if (!q || revealed) return;
    const next =
      q.type === 'multiple-choice'
        ? selected.includes(optionId)
          ? selected.filter((x) => x !== optionId)
          : [...selected, optionId].sort()
        : [optionId];
    setAnswer(session.sessionId, qid, next);
  };

  const reveal = async () => {
    if (busy || !selected.length) return;
    setBusy(true);
    await revealQuestion(session.sessionId, qid, Date.now() - qStart.current);
    setBusy(false);
  };

  const toggleFlag = () => {
    const flagged = session.flagged.includes(qid) ? session.flagged.filter((x) => x !== qid) : [...session.flagged, qid];
    patchSession(session.sessionId, { flagged });
  };

  const leave = async () => {
    await patchSession(session.sessionId, { durationSec: elapsedRef.current, currentIndex: index });
    nav('/');
  };

  const navGrid = (
    <div>
      <div className="grid grid-cols-5 gap-2" role="list" aria-label="題號導覽">
        {ids.map((id, i) => {
          const answered = !!session.answers[id]?.length;
          const flagged = session.flagged.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="listitem"
              onClick={() => go(i)}
              aria-current={i === index ? 'step' : undefined}
              aria-label={`第 ${i + 1} 題，${answered ? '已作答' : '未作答'}${flagged ? '，已標記' : ''}`}
              className={`relative grid h-11 place-items-center rounded-lg border text-sm font-bold ${
                i === index ? 'border-primary bg-primary text-white' : answered ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface'
              }`}
            >
              {i + 1}
              {flagged && <Flag size={11} className="absolute top-0.5 right-0.5 text-bad" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[0.72rem] text-muted">
        <span>■ 已作答 {answeredCount}</span>
        <span>□ 未作答 {ids.length - answeredCount}</span>
        <span className="inline-flex items-center gap-1">
          <Flag size={11} /> 待檢 {session.flagged.length}
        </span>
      </div>
    </div>
  );

  const unanswered = ids.length - answeredCount;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="kicker">{MODE_LABEL[session.mode]}</div>
            <div className="truncate text-sm font-bold">{session.scopeLabel}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmLeave(true)}>
            <LogOut size={15} /> 暫時離開
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 lg:hidden">
          <div className="flex-1">
            <div className="mb-1 flex justify-between text-xs">
              <span>
                第 <strong>{index + 1}</strong> / {ids.length} 題
              </span>
              <span>已作答 {answeredCount}</span>
            </div>
            <div className="bar">
              <span style={{ width: `${(answeredCount / ids.length) * 100}%` }} />
            </div>
          </div>
          <span className="pill" aria-label="計時">
            <Clock size={12} /> {remaining !== null ? fmt(remaining) : fmt(elapsed)}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNavOpen(true)} aria-label="開啟題號導覽">
            <Grid3X3 size={16} />
          </button>
        </div>

        <section className="card !p-5 md:!p-7" aria-labelledby="q-stem">
          {!q ? (
            <EmptyState title="此題已自題庫移除">這題不會列入計分。請跳到其他題目。</EmptyState>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="pill pill-blue">
                  第 {index + 1} 題・{q.competencyCode}
                </span>
                <span className="pill">{q.type === 'multiple-choice' ? '複選題' : '單選題'}</span>
                <OriginBadge q={q} />
              </div>
              <h2 id="q-stem" ref={headingRef} tabIndex={-1} className="text-[1.08rem] leading-relaxed font-bold whitespace-pre-wrap">
                {q.stem}
              </h2>
              {q.code && <CodeBlock code={q.code} language={q.codeLanguage} />}
              <fieldset className="mt-4 grid gap-2.5" disabled={revealed}>
                <legend className="sr-only">選項</legend>
                {displayOptions(q, session.optionOrders?.[qid]).map(({ option: o, letter }) => {
                  const state = revealed ? (q.correctOptionIds.includes(o.id) ? 'correct' : selected.includes(o.id) ? 'wrong' : undefined) : undefined;
                  return (
                    <label key={o.id} className="opt" data-state={state} aria-disabled={revealed}>
                      <input
                        type={q.type === 'multiple-choice' ? 'checkbox' : 'radio'}
                        name={`q-${qid}`}
                        checked={selected.includes(o.id)}
                        onChange={() => choose(o.id)}
                      />
                      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <strong>{letter}.</strong> {o.text}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {isPractice && revealed && <Explanation q={q} selected={selected} order={session.optionOrders?.[qid]} />}
            </>
          )}

          <div className="mt-6 hidden flex-wrap items-center justify-between gap-2 lg:flex">
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => go(index - 1)}>
                <ArrowLeft size={16} /> 上一題
              </button>
              <button type="button" className="btn btn-secondary" onClick={toggleFlag} aria-pressed={session.flagged.includes(qid)}>
                <Flag size={16} /> {session.flagged.includes(qid) ? '取消標記' : '標記待檢'}
              </button>
            </div>
            {primaryActions()}
          </div>
        </section>
        <p className="mt-3 text-xs text-muted">
          作答會自動儲存，重新整理或稍後回來都能繼續。{isPractice ? '練習模式：每題提交後即顯示解析。' : '交卷前不會顯示答案。'}
        </p>
      </div>

      <aside className="hidden lg:block">
        <div className="card sticky top-[92px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold">{remaining !== null ? '剩餘時間' : '作答時間'}</span>
            <span className={`text-lg font-extrabold tabular-nums ${remaining !== null && remaining < 60 ? 'text-bad' : ''}`} aria-live="off">
              {remaining !== null ? fmt(remaining) : fmt(elapsed)}
            </span>
          </div>
          {navGrid}
          <button type="button" className="btn mt-4 w-full" onClick={() => setConfirmSubmit(true)} disabled={busy}>
            <Send size={16} /> 交卷
          </button>
        </div>
      </aside>

      {/* 手機固定底部操作列 */}
      <div className="bottom-nav fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-line bg-surface/95 px-3 pt-2 backdrop-blur lg:hidden">
        <button type="button" className="btn btn-secondary !px-3" disabled={index === 0} onClick={() => go(index - 1)} aria-label="上一題">
          <ArrowLeft size={18} />
        </button>
        <button type="button" className="btn btn-secondary !px-3" onClick={toggleFlag} aria-pressed={session.flagged.includes(qid)} aria-label="標記待檢">
          <Flag size={18} className={session.flagged.includes(qid) ? 'text-bad' : ''} />
        </button>
        <div className="flex flex-1">
          {primaryActions(true)}
        </div>
      </div>

      {navOpen && (
        <Drawer title="題號導覽" onClose={() => setNavOpen(false)}>
          {navGrid}
          <button type="button" className="btn mt-4 w-full" onClick={() => setConfirmSubmit(true)} disabled={busy}>
            <Send size={16} /> 交卷
          </button>
        </Drawer>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        title="確定要交卷嗎？"
        confirmLabel="確定交卷"
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => {
          setConfirmSubmit(false);
          doSubmit();
        }}
      >
        <p>
          共 {ids.length} 題，已作答 {answeredCount} 題。
          {unanswered > 0 && <strong className="text-bad">還有 {unanswered} 題未作答，將以不得分計算。</strong>}
          {session.flagged.length > 0 && <span> 有 {session.flagged.length} 題標記待檢。</span>}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmLeave}
        title="暫時離開測驗？"
        confirmLabel="離開"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leave}
      >
        作答紀錄已儲存，可從首頁「繼續作答」回來完成。
      </ConfirmDialog>
    </div>
  );

  function primaryActions(full?: boolean) {
    const last = index === ids.length - 1;
    const cls = full ? 'btn flex-1' : 'btn';
    if (isPractice && q && !revealed)
      return (
        <button type="button" className={cls} disabled={!selected.length || busy} onClick={reveal} data-testid="reveal">
          提交本題
        </button>
      );
    if (last)
      return (
        <button type="button" className={cls} onClick={() => setConfirmSubmit(true)} disabled={busy} data-testid="submit">
          <Send size={16} /> 交卷
        </button>
      );
    return (
      <button type="button" className={cls} onClick={() => go(index + 1)} data-testid="next">
        下一題 <ArrowRight size={16} />
      </button>
    );
  }
}

