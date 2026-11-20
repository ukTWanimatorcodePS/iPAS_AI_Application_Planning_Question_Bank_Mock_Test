import { Bot, BookOpen, CheckCircle2, ExternalLink, PlusCircle, RotateCcw, XCircle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { setChatContext } from '../ai/byok/context';
import { setChatUi, useChatUi } from '../ai/byok/chatUi';
import { getCompetency } from '../content';
import { AUTHORING_LABEL, DIFFICULTY_LABEL, ORIGIN_LABEL, QTYPE_LABEL, REVIEW_LABEL, type Question } from '../content/schema';
import { db } from '../data/db';
import { startQuiz } from '../data/quizFactory';
import { addToReview } from '../data/repo';
import { isCorrect } from '../lib/scoring';
import { TutorPanel } from './TutorPanel';
import { reportIssueUrl } from '../config/project';
import { displayOptions, lettersOf } from '../lib/optionOrder';

export function OriginBadge({ q }: { q: Question }) {
  const official = q.origin === 'official-released' || q.origin === 'official-sample';
  return (
    <span className={`pill ${official ? 'pill-warn' : ''}`}>
      {ORIGIN_LABEL[q.origin]}
      {q.year ? `・${q.year}${q.session ? ` ${q.session}` : ''}` : ''}
    </span>
  );
}

/** 解析卡：我的答案／正確答案／逐一選項解析／回講義 */
export function Explanation({
  q,
  selected,
  order,
  showActions = true,
  showTutor = true,
}: {
  q: Question;
  selected: string[] | undefined;
  /** 作答當下的選項顯示順序；A～D 代號依此順序標示（沒有時用題庫原始順序） */
  order?: string[];
  showActions?: boolean;
  showTutor?: boolean;
}) {
  const nav = useNavigate();
  const sel = selected ?? [];
  const ok = isCorrect(q, sel);
  const inReview = useLiveQuery(() => db.reviewItems.get(q.id), [q.id]);
  const [msg, setMsg] = useState<string | null>(null);
  const comp = getCompetency(q.explanation.lessonAnchor);
  const label = (ids: string[]) => (ids.length ? lettersOf(q, order, ids).join('、') : '未作答');
  const chatUi = useChatUi();
  const { pathname } = useLocation();
  // 解析已顯示：把這題（含標準解析）交給 AI 導師作為依據，並打開對話視窗。不會自動送出，按「送出」才產生用量
  const askTutor = () => {
    setChatContext({ kind: 'question', question: q, order, selected: sel, answerVisible: true, label: `${q.competencyCode} 的這一題（已看解析）`, path: pathname });
    setChatUi({ size: 'normal' });
  };

  return (
    <div className="mt-4 grid gap-3" data-testid={`explanation-${q.id}`}>
      <div className={`flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm ${ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`} role="status">
        {ok ? <CheckCircle2 size={18} aria-hidden /> : <XCircle size={18} aria-hidden />}
        <strong>{ok ? '答對' : sel.length ? '答錯' : '未作答（不得分）'}</strong>
        <span className="text-ink">
          我的答案：<strong>{label(sel)}</strong>{" ／ "}正確答案：<strong>{label(q.correctOptionIds)}</strong>
        </span>
      </div>

      <div className="rounded-xl border border-line p-4">
        <h4 className="mb-1 text-sm font-bold">概念重點</h4>
        <p className="text-sm">{q.explanation.summary}</p>
        <h4 className="mt-3 mb-1 text-sm font-bold">正確選項為何對</h4>
        <p className="text-sm">{q.explanation.correctRationale}</p>
      </div>

      <div className="rounded-xl border border-line p-4">
        <h4 className="mb-1 text-sm font-bold">逐一選項解析</h4>
        {displayOptions(q, order).map(({ option: o, letter }) => {
          const right = q.correctOptionIds.includes(o.id);
          const picked = sel.includes(o.id);
          return (
            <div key={o.id} className={`answerline ${right ? 'correct' : picked ? 'wrong' : ''}`}>
              <div className="text-sm font-bold">
                {letter}. {o.text}
                {right && <span className="pill pill-green ml-2">正解</span>}
                {picked && !right && <span className="pill pill-red ml-2">你的選擇</span>}
              </div>
              <p className="mt-0.5 text-sm text-muted">{q.explanation.optionRationales[o.id]}</p>
            </div>
          );
        })}
      </div>

      {q.codeWalkthrough && (
        <div className="rounded-xl border border-line p-4">
          <h4 className="mb-1 text-sm font-bold">程式逐行解說</h4>
          <ol className="ml-5 list-decimal text-sm">
            {q.codeWalkthrough.map((line, i) => (
              <li key={i} className="py-0.5">
                {line}
              </li>
            ))}
          </ol>
          {q.verification && (
            <p className="mt-2 text-xs text-muted">
              {q.verification.status === 'verified'
                ? `正確輸出已實際執行驗證：${q.verification.runtime}${Object.keys(q.verification.packages).length ? '，' + Object.entries(q.verification.packages).map(([k, v]) => `${k} ${v}`).join('、') : ''}（${q.verification.verifiedAt}）`
                : '此題程式輸出尚待實際執行驗證。'}
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl bg-warn-soft p-4 text-sm">
        <strong>容易混淆：</strong>
        {q.explanation.commonTrap}
        {q.explanation.example && (
          <p className="mt-2">
            <strong>生活／業務例子：</strong>
            {q.explanation.example}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[0.72rem] text-muted">
        <OriginBadge q={q} />
        <span className="pill">{DIFFICULTY_LABEL[q.difficultyTier]}</span>
        <span className="pill">{QTYPE_LABEL[q.questionType]}</span>
        <span className="pill">{AUTHORING_LABEL[q.authoring]}</span>
        <span className="pill">審核狀態：{REVIEW_LABEL[q.reviewStatus]}</span>
        {q.sourceUrl && (
          <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
            題目來源 <ExternalLink size={12} />
          </a>
        )}
        <span>學習來源：本站 {q.explanation.lessonAnchor} 講義「{q.lessonSection}」</span>
        <a
          href={reportIssueUrl({ kind: 'question', id: q.id })}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1"
          data-testid="report-question"
        >
          回報此題錯誤 <ExternalLink size={12} />
        </a>
      </div>

      {showActions && (
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-secondary btn-sm" to={`/courses/${q.explanation.lessonAnchor}?section=${encodeURIComponent(q.lessonSection)}`}>
            <BookOpen size={15} /> 回 {comp?.code} 講義
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!!inReview}
            onClick={async () => {
              await addToReview(q.id);
              setMsg('已加入錯題本');
            }}
          >
            <PlusCircle size={15} /> {inReview ? '已在錯題本' : '加入錯題本'}
          </button>
          {chatUi.enabled && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={askTutor} data-testid={`ask-tutor-${q.id}`}>
              <Bot size={15} /> 問 AI 導師
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const r = await startQuiz({ level: q.level, mode: 'practice', count: 1, competencyCodes: [q.competencyCode] });
              if (r.ok) nav(`/quiz/${r.sessionId}`);
              else setMsg(r.message);
            }}
          >
            <RotateCcw size={15} /> 再練一題
          </button>
          {msg && (
            <span role="status" className="self-center text-xs text-ok">
              {msg}
            </span>
          )}
        </div>
      )}
      {/* AI 導師：答錯或未作答時提供；為選用功能，不影響上方的標準解析 */}
      {showTutor && !ok && <TutorPanel q={q} selected={sel} order={order} />}
    </div>
  );
}
