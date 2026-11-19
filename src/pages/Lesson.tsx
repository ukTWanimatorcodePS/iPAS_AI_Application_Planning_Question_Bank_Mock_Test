import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ListTree, Minus, NotebookPen, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useApp } from '../app/AppContext';
import { Drawer } from '../app/Layout';
import { Markdown } from '../components/Markdown';
import { EmptyState, ProgressBar } from '../components/ui';
import { formatDate } from '../lib/format';
import { curriculum, getCompetency, hasLesson, loadLesson, questionsFor, subjectsOf } from '../content';
import { db } from '../data/db';
import { useLessonProgress } from '../data/hooks';
import { startQuiz } from '../data/quizFactory';
import { addLessonTime, saveLessonPosition, setLessonCompleted, touchLesson } from '../data/repo';
import { orderedCompetencies } from '../lib/learningPath';
import { PRACTICE_SECTION, headingId, outline, type OutlineItem } from '../lib/lessonOutline';
import { DIFFICULTY_LABEL, DIFFICULTY_TIERS } from '../content/schema';
import { NotFound } from './NotFound';
import { reportIssueUrl } from '../config/project';

const SCALE_KEY = 'ipas-lesson-scale';
const VERIFY_COUNT = 5;
const readScale = () => {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return v >= 0.85 && v <= 1.4 ? v : 1;
  } catch {
    return 1;
  }
};

export default function LessonPage() {
  const { code = '' } = useParams();
  const comp = getCompetency(code);
  if (!comp) return <NotFound />;
  return <Lesson key={code} code={code} />;
}

function Lesson({ code }: { code: string }) {
  const comp = getCompetency(code)!;
  const { level, setLevel } = useApp();
  const nav = useNavigate();
  const progressMap = useLessonProgress(comp.level);
  const progress = useLiveQuery(() => db.lessonProgress.get(code), [code]);
  const [md, setMd] = useState<string | null | undefined>(undefined);
  const [scale, setScale] = useState(readScale);
  const [tocOpen, setTocOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restored = useRef(false);
  const [params] = useSearchParams();
  const targetSection = params.get('section');
  const qList = questionsFor({ competencyCode: code });
  const qCount = qList.length;

  const order = orderedCompetencies(comp.level, 'both');
  const idx = order.findIndex((c) => c.code === code);
  const prev = order[idx - 1];
  const next = order[idx + 1];

  useEffect(() => {
    loadLesson(code).then(setMd);
    touchLesson(code, comp.level);
  }, [code, comp.level]);

  // 閱讀時間：頁面可見時每 15 秒累計
  useEffect(() => {
    let acc = 0;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') acc += 15;
      if (acc >= 30) {
        addLessonTime(code, acc);
        acc = 0;
      }
    }, 15_000);
    return () => {
      clearInterval(t);
      addLessonTime(code, acc);
    };
  }, [code]);

  const items: OutlineItem[] = useMemo(
    () => (md ? [...outline(md), { depth: 2 as const, text: PRACTICE_SECTION, id: headingId(PRACTICE_SECTION) }] : []),
    [md],
  );

  // 還原上次閱讀位置
  useEffect(() => {
    if (!md || restored.current || progress === undefined) return;
    restored.current = true;
    // 從解析頁帶入的 ?section= 優先，其次為上次閱讀位置
    const pos = targetSection ? headingId(targetSection) : progress?.lastPosition;
    if (pos) requestAnimationFrame(() => document.getElementById(pos)?.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }, [md, progress, targetSection]);

  // 追蹤目前段落並儲存閱讀位置
  useEffect(() => {
    if (!md) return;
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!vis) return;
        const id = vis.target.id;
        setActive(id);
        clearTimeout(timer);
        timer = setTimeout(() => saveLessonPosition(code, id), 800);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [md, items, code]);

  const changeScale = (d: number) => {
    const v = Math.round(Math.min(1.4, Math.max(0.85, scale + d)) * 100) / 100;
    setScale(v);
    try {
      localStorage.setItem(SCALE_KEY, String(v));
    } catch {
      /* ignore */
    }
  };

  const jump = useCallback((id: string) => {
    setTocOpen(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.setAttribute('tabindex', '-1');
      el?.focus({ preventScroll: true });
    });
  }, []);

  const begin = async (count: number) => {
    if (busy) return;
    setBusy(true);
    const r = await startQuiz({ level: comp.level, mode: 'practice', count, competencyCodes: [code] });
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    nav(`/quiz/${r.sessionId}`);
  };

  /** 驗證測驗：只出沒看過答案或解析的題目、測驗模式（交卷前不顯示答案） */
  const verify = async () => {
    if (busy) return;
    setBusy(true);
    const r = await startQuiz({
      level: comp.level,
      mode: 'test',
      count: VERIFY_COUNT,
      competencyCodes: [code],
      unseenOnly: true,
      scopeLabel: `${code} 驗證測驗（未看過的題目）`,
    });
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    nav(`/quiz/${r.sessionId}`);
  };

  const completed = !!progress?.completedAt;
  const toggleComplete = async () => {
    await setLessonCompleted(code, comp.level, !completed);
    if (!completed) setMsg(qCount ? `已標記完成！建議進行 5～10 題單元測驗確認理解。` : '已標記完成。本單元尚無可用題目。');
  };

  const chapterTree = (
    <nav aria-label="章節目錄">
      {subjectsOf(comp.level).map((s) => (
        <details key={s.code} open={s.code === comp.subject.code} className="mb-2">
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-1 text-sm font-bold">
            <ChevronRight size={14} className="details-chevron" aria-hidden />
            {s.code} {s.shortName}
          </summary>
          {s.topics.map((t) => (
            <div key={t.code} className="ml-3">
              <div className="mt-1 text-[0.72rem] font-bold text-muted">
                {t.code} {t.name}
              </div>
              {t.competencies.map((c) => (
                <Link
                  key={c.code}
                  to={`/courses/${c.code}`}
                  aria-current={c.code === code ? 'page' : undefined}
                  onClick={() => setTocOpen(false)}
                  className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-2 text-[0.8rem] no-underline ${
                    c.code === code ? 'bg-primary-soft font-bold text-primary' : 'text-ink hover:bg-soft'
                  }`}
                >
                  {progressMap?.get(c.code)?.completedAt ? <CheckCircle2 size={13} className="shrink-0 text-ok" aria-label="已完成" /> : <span className="w-[13px]" />}
                  <span className="truncate">
                    {c.code} {c.name}
                  </span>
                  {!hasLesson(c.code) && <span className="sr-only">（尚未收錄）</span>}
                </Link>
              ))}
            </div>
          ))}
        </details>
      ))}
    </nav>
  );

  const toc = (
    <nav aria-label="本頁段落">
      <ul className="grid gap-0.5">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => jump(i.id)}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-[0.8rem] ${i.depth === 3 ? 'pl-5 text-muted' : 'font-semibold'} ${
                active === i.id ? 'bg-primary-soft text-primary' : 'hover:bg-soft'
              }`}
            >
              {i.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[230px_minmax(0,1fr)_240px]">
      {/* 左側章節樹（桌面） */}
      <aside className="hidden lg:block">
        <div className="card sticky top-[92px] max-h-[calc(100vh-110px)] overflow-y-auto !p-3">
          <div className="mb-2 px-1 text-xs font-bold text-muted">課綱章節</div>
          {chapterTree}
        </div>
      </aside>

      <article className="card min-w-0 !p-5 md:!p-8" aria-labelledby="lesson-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link to="/courses" className="link text-sm">
            <ArrowLeft size={15} /> 課程
          </Link>
          <span className="pill pill-blue">
            {comp.subject.code} · {comp.topic.code} {comp.topic.name}
          </span>
          {completed && (
            <span className="pill pill-green">
              <CheckCircle2 size={13} /> 已完成
            </span>
          )}
        </div>
        <h1 id="lesson-title" className="text-2xl leading-snug font-extrabold md:text-[1.9rem]">
          <span className="text-primary">{comp.code}</span> {comp.name}
        </h1>
        <p className="mt-1 text-xs text-muted">
          對應官方評鑑內容範圍 {curriculum.curriculumVersion} 版。本講義為本站自編，非官方教材。
          <a className="link ml-1" href={reportIssueUrl({ kind: 'lesson', id: comp.code, title: comp.name })} target="_blank" rel="noopener noreferrer">
            回報講義錯誤
          </a>
        </p>
        <div className="mt-3 rounded-xl border border-line p-3 text-sm" data-testid="official-scope">
          <p className="mb-1 text-xs font-bold text-muted">官方評鑑內容（{curriculum.curriculumVersion} 版原文）</p>
          {comp.officialScope ? (
            <p>{comp.officialScope}</p>
          ) : (
            <p className="text-muted">官方評鑑範圍此細項的「評鑑內容」欄未列舉，請依細項名稱準備。</p>
          )}
          <p className="mt-1 text-xs text-muted">官方說明：評鑑範圍僅供參考，實際考題不以所列內容為限。</p>
        </div>

        {comp.level !== level && (
          <div className="notice mt-3">
            這是{comp.level === 'junior' ? '初級' : '中級'}單元，目前首頁級別為{level === 'junior' ? '初級' : '中級'}。
            <button type="button" className="link ml-1" onClick={() => setLevel(comp.level)}>
              切換級別
            </button>
          </div>
        )}

        <div className="sticky top-16 z-20 -mx-5 mt-4 flex flex-wrap items-center gap-2 border-y border-line bg-surface/95 px-5 py-2 backdrop-blur md:-mx-8 md:px-8 lg:top-[72px]">
          <button type="button" className="btn btn-secondary btn-sm 2xl:hidden" onClick={() => setTocOpen(true)} aria-haspopup="dialog">
            <ListTree size={15} /> 目錄
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="字級調整">
            <button type="button" className="btn btn-secondary btn-sm !px-2" onClick={() => changeScale(-0.05)} aria-label="縮小字級">
              <Minus size={14} />
            </button>
            <span className="w-12 text-center text-xs" aria-live="polite">
              {Math.round(scale * 100)}%
            </span>
            <button type="button" className="btn btn-secondary btn-sm !px-2" onClick={() => changeScale(0.05)} aria-label="放大字級">
              <Plus size={14} />
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-sm ${completed ? 'btn-secondary' : ''}`}
            onClick={toggleComplete}
            aria-pressed={completed}
            data-testid="toggle-complete"
          >
            <CheckCircle2 size={15} /> {completed ? '已完成（點擊取消）' : '標記完成'}
          </button>
        </div>

        {msg && (
          <div className="notice mt-4" role="status">
            {msg}
          </div>
        )}

        <div className="prose-lesson mt-4" style={{ ['--lesson-scale' as string]: scale }}>
          {md === undefined && <p className="text-muted">載入講義中…</p>}
          {md === null && (
            <EmptyState icon={<ListTree size={30} />} title="本細項講義尚未收錄">
              課綱架構已建立，內容將分批撰寫與校閱後釋出。你可以先參考
              <a href="https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources" target="_blank" rel="noopener noreferrer">
                官方學習資源
              </a>
              。
            </EmptyState>
          )}
          {md && <Markdown source={md} />}
        </div>

        <section className="mt-8 rounded-2xl bg-soft p-4 md:p-5" aria-labelledby={headingId(PRACTICE_SECTION)}>
          <h2 id={headingId(PRACTICE_SECTION)} className="scroll-mt-24 text-base font-bold">
            {PRACTICE_SECTION}
          </h2>
          <p className="mb-2 text-sm text-muted">
            {qCount ? `本細項已收錄 ${qCount} 題自編練習題；優先出你還沒做過的題目。` : '本單元尚無可用題目，可先回到講義或選擇其他單元練習。'}
          </p>
          {qCount > 0 && (
            <p className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {DIFFICULTY_TIERS.map((t) => (
                <span key={t} className="pill">
                  {DIFFICULTY_LABEL[t]} {qList.filter((q) => q.difficultyTier === t).length} 題
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {[5, 10].map((n) => (
              <button key={n} type="button" className="btn" disabled={!qCount || busy} onClick={() => begin(n)} data-testid={`start-quiz-${n}`}>
                <NotebookPen size={16} /> {n} 題練習{qCount && qCount < n ? `（目前僅 ${qCount} 題）` : ''}
              </button>
            ))}
            <button type="button" className="btn btn-secondary" disabled={!qCount || busy} onClick={verify} data-testid="start-verify">
              <CheckCircle2 size={16} /> 驗證 {VERIFY_COUNT} 題（只出沒看過的題目）
            </button>
          </div>
          {qCount > 0 && (
            <p className="mt-2 text-xs text-muted">
              驗證測驗採測驗模式、交卷前不顯示答案，題目全部是你還沒作答、也沒看過解析的（交白卷後看過解析的題目也會排除），用來確認真的理解，而不是記住答案；沒看過的題目不足 {VERIFY_COUNT} 題時，只出剩下的題目。
            </p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap justify-between gap-2">
          {prev ? (
            <Link className="btn btn-secondary" to={`/courses/${prev.code}`}>
              <ArrowLeft size={16} /> {prev.code}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link className="btn btn-secondary" to={`/courses/${next.code}`}>
              {next.code} <ArrowRight size={16} />
            </Link>
          )}
        </div>
        {progress?.visitedAt && <p className="mt-4 text-[0.72rem] text-muted">上次閱讀：{formatDate(progress.visitedAt)}</p>}
      </article>

      {/* 右側 TOC（寬螢幕） */}
      <aside className="hidden 2xl:block">
        <div className="card sticky top-[92px] !p-3">
          <div className="mb-2 px-1 text-xs font-bold text-muted">本單元段落</div>
          {toc}
          <div className="mt-4 border-t border-line px-1 pt-3">
            <div className="mb-1 text-xs text-muted">本科進度</div>
            <ProgressBar
              value={
                (comp.subject.topics.flatMap((t) => t.competencies).filter((c) => progressMap?.get(c.code)?.completedAt).length /
                  comp.subject.topics.flatMap((t) => t.competencies).length) *
                100
              }
              label="本科完成度"
            />
          </div>
        </div>
      </aside>

      {/* 手機底部測驗 CTA */}
      {qCount > 0 && (
        <div className="fixed-cta fixed inset-x-3 z-30 lg:hidden">
          <button type="button" className="btn w-full shadow-lg" disabled={busy} onClick={() => begin(5)}>
            <NotebookPen size={16} /> 開始 5 題小測驗
          </button>
        </div>
      )}

      {tocOpen && (
        <Drawer title="目錄" onClose={() => setTocOpen(false)} side="left">
          <div className="mb-2 text-xs font-bold text-muted">本單元段落</div>
          {toc}
          <div className="mt-4 mb-2 flex items-center gap-1 text-xs font-bold text-muted">
            <ChevronDown size={13} /> 課綱章節
          </div>
          {chapterTree}
        </Drawer>
      )}
    </div>
  );
}
