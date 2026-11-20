import { BookOpen, GraduationCap, Info, RefreshCw, Send } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { getProvider, mockProvider, TUTOR_MODE_LABEL, type TutorResponse } from '../ai';
import { getQuestion } from '../content';
import type { Question } from '../content/schema';
import { logTutor, nextOptionOrder, recordTutorAttempt } from '../data/repo';
import type { TutorMode } from '../data/types';
import { isCorrect } from '../lib/scoring';
import { displayOptions, lettersOf } from '../lib/optionOrder';
import { CodeBlock } from './CodeBlock';

const MODES: TutorMode[] = ['simple', 'detailed', 'example', 'compare', 'another'];

/** 只處理「- 清單」與「**粗體**」的簡易渲染，避免把完整 Markdown 套件載入作答頁 */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}
function MiniMd({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean);
  const items = lines.filter((l) => l.startsWith('- '));
  const paras = lines.filter((l) => !l.startsWith('- '));
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} className="text-sm">
          {inline(p)}
        </p>
      ))}
      {items.length > 0 && (
        <ul className="mt-1 ml-5 list-disc text-sm">
          {items.map((l, i) => (
            <li key={i} className="py-0.5">
              {inline(l.slice(2))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function TutorPanel({ q, selected, order }: { q: Question; selected: string[]; order?: string[] }) {
  const { settings, level } = useApp();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TutorMode>('detailed');
  const [resp, setResp] = useState<TutorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forceMock, setForceMock] = useState(false);
  const [used, setUsed] = useState<string[]>([]);
  const [modesUsed, setModesUsed] = useState<TutorMode[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  // 補強題的選項顯示順序：每次載入新的補強題都重新打亂
  const [rqOrder, setRqOrder] = useState<string[] | undefined>(undefined);
  const started = useRef(Date.now());
  // 每次顯示的補強題一個識別碼：資料層以它防止重複記錄；submitting 防止送出中再次點擊
  const attemptKey = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const provider = forceMock ? mockProvider : getProvider(settings.tutorProvider);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    provider
      .teach({ question: q, selected, mode, optionOrder: order }, { signal: ctrl.signal, excludeIds: used })
      .then(async (r) => {
        // 補強題與正式出題共用「上一次顯示順序」紀錄：正確答案位置一定和上次不同
        const order = r.reinforcementQuestionId ? await nextOptionOrder(r.reinforcementQuestionId) : undefined;
        if (ctrl.signal.aborted) return;
        setRqOrder(order);
        setResp(r);
        setPick([]);
        setResult(null);
        started.current = Date.now();
        attemptKey.current = crypto.randomUUID();
        submitting.current = false;
        setModesUsed((m) => (m.includes(mode) ? m : [...m, mode]));
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // used 僅在「再出一題」時更新，此時同時會改變 mode 或觸發重新載入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, q.id, provider, used.length]);

  const rq = resp?.reinforcementQuestionId ? getQuestion(resp.reinforcementQuestionId) : undefined;

  const submit = async () => {
    if (!rq || !pick.length || result !== null || submitting.current) return;
    submitting.current = true; // await 之前就鎖定，快速連點只會送出一次
    // 先固定這次提交所屬的補強題：等待期間若切換模式或「再出一題」，畫面已換成另一題
    const key = attemptKey.current;
    const target = rq;
    const provider0 = resp!.provider;
    const modes0 = modesUsed;
    const r = await recordTutorAttempt({ originalQuestionId: q.id, questionId: target.id, selected: pick, timeMs: Date.now() - started.current, attemptKey: key, optionOrder: rqOrder });
    const ok = r?.correct ?? isCorrect(target, pick);
    // 晚到的結果只屬於原本那一題：畫面已換題時不更新目前畫面（作答紀錄已正確寫入原題）
    if (attemptKey.current === key) setResult(ok);
    await logTutor({
      questionId: q.id,
      competencyCode: q.competencyCode,
      level,
      provider: provider0,
      modes: modes0,
      reinforcementQuestionId: target.id,
      reinforcementCorrect: ok,
    });
  };

  const another = () => {
    if (rq) setUsed((u) => [...u, rq.id]);
    if (mode !== 'another') setMode('another');
  };

  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-testid={`tutor-open-${q.id}`}>
        <GraduationCap size={15} /> 重新教我這個觀念
      </button>
    );

  return (
    <section className="rounded-xl border-2 border-primary-soft p-4" aria-label="AI 導師" data-testid="tutor-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold">
          <GraduationCap size={16} aria-hidden /> AI 導師・{provider.name}
        </h4>
        <button type="button" className="link text-xs" onClick={() => setOpen(false)}>
          收合
        </button>
      </div>
      <div role="tablist" aria-label="教學模式" className="mb-3 flex gap-1 overflow-x-auto">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => (m === 'another' ? another() : setMode(m))}
            className={`min-h-[36px] shrink-0 rounded-lg px-3 text-xs font-bold whitespace-nowrap ${mode === m ? 'bg-primary text-white' : 'bg-soft text-muted'}`}
          >
            {TUTOR_MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-muted" role="status">
          整理教學內容中…
        </p>
      )}
      {error && (
        <div className="notice mb-2" role="alert">
          {error}
          <button type="button" className="link ml-2" onClick={() => setForceMock(true)}>
            改用示範模式
          </button>
        </div>
      )}
      {resp && !loading && (
        <div role="tabpanel" className="grid gap-3">
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-soft p-2 text-xs text-warn">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden /> {resp.label}
          </p>
          {resp.sections.map((s, i) => (
            <div key={i}>
              <h5 className="mb-1 text-sm font-bold">{s.title}</h5>
              <MiniMd text={s.body} />
            </div>
          ))}
          <Link className="link text-sm" to={`/courses/${q.explanation.lessonAnchor}?section=${encodeURIComponent(q.lessonSection)}`}>
            <BookOpen size={14} /> 回講義「{q.lessonSection}」段落
          </Link>

          <div className="rounded-lg bg-soft p-3" data-testid="tutor-reinforcement">
            <h5 className="mb-1 text-sm font-bold">補強題：同一考點、不同情境</h5>
            {!rq ? (
              <p className="text-sm text-muted">此細項目前沒有其他可用題目。</p>
            ) : (
              <>
                <p className="text-sm font-semibold whitespace-pre-wrap">{rq.stem}</p>
                {rq.code && <CodeBlock code={rq.code} language={rq.codeLanguage} />}
                <fieldset className="mt-2 grid gap-2" disabled={result !== null}>
                  <legend className="sr-only">補強題選項</legend>
                  {displayOptions(rq, rqOrder).map(({ option: o, letter }) => {
                    const state = result === null ? undefined : rq.correctOptionIds.includes(o.id) ? 'correct' : pick.includes(o.id) ? 'wrong' : undefined;
                    return (
                      <label key={o.id} className="opt !min-h-[44px] !py-2 text-sm" data-state={state}>
                        <input type="radio" name={`tutor-${rq.id}`} checked={pick.includes(o.id)} onChange={() => setPick([o.id])} />
                        <span className="[overflow-wrap:anywhere]">
                          <strong>{letter}.</strong> {o.text}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                {result === null ? (
                  <button type="button" className="btn btn-sm mt-2" disabled={!pick.length} onClick={submit} data-testid="tutor-submit">
                    <Send size={14} /> 提交補強題
                  </button>
                ) : (
                  <div className={`mt-2 rounded-lg p-2 text-sm ${result ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`} role="status">
                    <strong>{result ? '補強題答對！' : '補強題答錯。'}</strong>{' '}
                    {result
                      ? '這個觀念已初步建立；原題仍會依排程在到期日再測一次，確認真正掌握。'
                      : '建議先回講義對應段落重讀，原題已改為今天到期，稍後可在錯題本重測。'}
                    <p className="mt-1 text-ink">
                      正確答案：{lettersOf(rq, rqOrder, rq.correctOptionIds).join('、')}。{rq.explanation.correctRationale}
                    </p>
                    <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={another}>
                      <RefreshCw size={14} /> 再出一題
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
