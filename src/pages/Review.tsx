import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, CalendarClock, ClipboardList, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { Explanation } from '../components/Explanation';
import { TutorPanel } from '../components/TutorPanel';
import { EmptyState, PageHead } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import { getCompetency, getQuestion, subjectsOf } from '../content';
import { db } from '../data/db';
import { useReviewItems } from '../data/hooks';
import { startReviewQuiz } from '../data/quizFactory';
import { rescheduleReview, setMistakeReason } from '../data/repo';
import { MASTERY_LABEL, REASON_LABEL, type MasteryStatus, type MistakeReason, type ReviewItem } from '../data/types';
import { isDue } from '../lib/review';
import { lettersOf } from '../lib/optionOrder';

const TABS: MasteryStatus[] = ['unresolved', 'reviewing', 'mastered'];

export function ReviewPage() {
  const { level, settings } = useApp();
  const items = useReviewItems(level);
  const nav = useNavigate();
  const [tab, setTab] = useState<MasteryStatus>('unresolved');
  const [subject, setSubject] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const since = days ? Date.now() - Number(days) * 86_400_000 : 0;
    return (items ?? [])
      .filter((r) => (!subject || r.competencyCode.startsWith(subject)) && (!reason || r.reason === reason) && new Date(r.lastWrongAt).getTime() >= since)
      .sort((a, b) => (a.nextDueAt ?? '9').localeCompare(b.nextDueAt ?? '9'));
  }, [items, subject, reason, days]);

  const dueCount = (items ?? []).filter((r) => r.masteryStatus === 'unresolved' || isDue(r)).length;
  const counts = Object.fromEntries(TABS.map((t) => [t, filtered.filter((r) => r.masteryStatus === t).length]));
  const list = filtered.filter((r) => r.masteryStatus === tab);

  const retest = async (ids?: string[]) => {
    const r = await startReviewQuiz(level, ids);
    if (r.ok) nav(`/quiz/${r.sessionId}`);
    else setMsg(r.message);
  };

  return (
    <>
      <PageHead
        kicker="Review"
        title="錯題本"
        desc={`答錯的題目會自動收錄，依 ${settings.reviewIntervals.join('／')} 天間隔安排複習；到期答對才累計，完成所有間隔才會轉為「已掌握」。`}
        actions={
          <button type="button" className="btn" onClick={() => retest()} disabled={!dueCount} data-testid="start-review">
            <RotateCcw size={16} /> 錯題重測（{dueCount} 題）
          </button>
        }
      />
      {msg && <p className="notice mb-4" role="status">{msg}</p>}

      <div className="card mb-4 grid gap-3 !p-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-bold">科目／細項</span>
          <select className="field" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">全部</option>
            {subjectsOf(level).map((s) => (
              <optgroup key={s.code} label={`${s.code} ${s.name}`}>
                <option value={s.code}>{s.code} 全科</option>
                {s.topics.flatMap((t) => t.competencies).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">錯誤原因</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">全部</option>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">最近答錯時間</span>
          <select className="field" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">全部</option>
            <option value="7">7 天內</option>
            <option value="30">30 天內</option>
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="錯題狀態" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-soft p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-bold whitespace-nowrap ${tab === t ? 'bg-surface text-primary shadow-sm' : 'text-muted'}`}
          >
            {MASTERY_LABEL[t]}（{counts[t]}）
          </button>
        ))}
      </div>

      <div role="tabpanel" className="grid gap-3">
        {items === undefined ? (
          <p className="text-muted">載入中…</p>
        ) : list.length === 0 ? (
          <div className="card">
            <EmptyState icon={<ClipboardList size={30} />} title={items.length ? '此分類沒有題目' : '目前沒有錯題'} action={<Link className="btn" to="/practice">開始練題</Link>}>
              {items.length ? '試試切換分類或篩選條件。' : '完成練習或測驗後，答錯的題目會自動收錄在這裡。'}
            </EmptyState>
          </div>
        ) : (
          list.map((r) => <ReviewCard key={r.questionId} item={r} onRetest={() => retest([r.questionId])} />)
        )}
      </div>
    </>
  );
}

function ReviewCard({ item, onRetest }: { item: ReviewItem; onRetest: () => void }) {
  const q = getQuestion(item.questionId);
  const history = useLiveQuery(() => db.attempts.where('questionId').equals(item.questionId).sortBy('answeredAt'), [item.questionId]);
  const [open, setOpen] = useState(false);
  if (!q) return <div className="card text-sm text-muted">題目 {item.questionId} 已自題庫移除，紀錄保留。</div>;
  const due = isDue(item);
  const last = history?.[history.length - 1];
  return (
    <article className="card" aria-labelledby={`rv-${q.id}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="pill pill-blue">{q.competencyCode} {getCompetency(q.competencyCode)?.name}</span>
        <span className="pill pill-red">累計答錯 {item.mistakeCount} 次</span>
        {item.masteryStatus !== 'mastered' && (
          <span className={`pill ${due ? 'pill-warn' : ''}`}>
            <CalendarClock size={12} /> {due ? '今天到期' : `下次複習 ${item.nextDueAt ? formatDate(item.nextDueAt) : '—'}`}
          </span>
        )}
        <span className="pill">連續到期答對 {item.correctStreak}</span>
      </div>
      <h2 id={`rv-${q.id}`} className="text-[0.98rem] font-bold">
        {q.stem}
      </h2>
      <p className="mt-1 text-xs text-muted">
        最近一次：{last ? `${formatDateTime(last.answeredAt)}・${last.correct ? '答對' : '答錯'}` : '—'}
      </p>

      {history && history.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">作答歷史（{history.length} 次）</summary>
          <ol className="mt-1 ml-4 list-decimal">
            {history.map((h) => (
              <li key={h.id}>
                {formatDateTime(h.answeredAt)}：選 {lettersOf(q, h.optionOrder, h.selectedIds).join('、') || '—'}，{h.correct ? '答對' : '答錯'}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={onRetest}>
          <RotateCcw size={14} /> 重測此題
        </button>
        <Link className="btn btn-secondary btn-sm" to={`/courses/${q.explanation.lessonAnchor}`}>
          <BookOpen size={14} /> 回講義
        </Link>
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '收合解析' : '查看解析'}
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs">
          原因
          <select className="field !min-h-[36px] !w-auto !py-1 text-xs" value={item.reason} onChange={(e) => setMistakeReason(q.id, e.target.value as MistakeReason)}>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          排程
          <select
            className="field !min-h-[36px] !w-auto !py-1 text-xs"
            value=""
            onChange={(e) => e.target.value && rescheduleReview(q.id, Number(e.target.value))}
            aria-label="調整下次複習日"
          >
            <option value="">調整…</option>
            <option value="0">改為今天</option>
            <option value="1">1 天後</option>
            <option value="3">3 天後</option>
            <option value="7">7 天後</option>
          </select>
        </label>
      </div>
      {open && <Explanation q={q} selected={last?.selectedIds} order={last?.optionOrder} showActions={false} showTutor={false} />}
      <div className="mt-3">
        <TutorPanel q={q} selected={last && !last.correct ? last.selectedIds : []} order={last?.optionOrder} />
      </div>
    </article>
  );
}
