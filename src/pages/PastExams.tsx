import { ExternalLink, FileClock, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, EmptyState, PageHead } from '../components/ui';
import { getSubject, questionsFor, subjectsOf } from '../content';
import officialSources from '../content/official-sources.json';
import { ORIGIN_LABEL, ORIGINS, type QuestionOrigin, type SubjectCode } from '../content/schema';
import { startQuiz } from '../data/quizFactory';

const OFFICIAL_LINKS = [
  { label: '官方學習資源（公告試題下載）', url: 'https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources' },
  { label: '官方檔案下載', url: 'https://ipd.nat.gov.tw/ipas/certification/AIAP/downloads' },
  { label: '官方考試資訊', url: 'https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info' },
];

interface PaperRecord {
  level: string;
  subject: string;
  year: number;
  rocYear: number;
  session: string;
  announcedAt: string | null;
}

export function PastExamsPage() {
  const { level } = useApp();
  const nav = useNavigate();
  const [origin, setOrigin] = useState<QuestionOrigin | ''>('');
  const [subject, setSubject] = useState<SubjectCode | ''>('');
  const [paperYear, setPaperYear] = useState('');
  const [paperSession, setPaperSession] = useState('');
  const [paperSubject, setPaperSubject] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // 切換級別時重設所有篩選，避免沿用另一個級別的科目或梯次而顯示空清單
  useEffect(() => {
    setPaperYear('');
    setPaperSession('');
    setPaperSubject('');
    setSubject('');
    setOrigin('');
  }, [level]);

  /* ---------- 官方公告試題紀錄（只有中繼資料與官方連結，不含題目內容） ---------- */
  const papers = (officialSources.examPapers as PaperRecord[]).filter((p) => p.level === level);
  const paperYears = [...new Set(papers.map((p) => p.rocYear))].sort((a, b) => b - a);
  const paperSessions = [...new Set(papers.filter((p) => !paperYear || String(p.rocYear) === paperYear).map((p) => p.session))];
  const shownPapers = papers
    .filter((p) => (!paperYear || String(p.rocYear) === paperYear) && (!paperSession || p.session === paperSession) && (!paperSubject || p.subject === paperSubject))
    .sort((a, b) => b.rocYear - a.rocYear || a.session.localeCompare(b.session) || a.subject.localeCompare(b.subject));

  /* ---------- 本站題庫（自編題） ---------- */
  const all = questionsFor({ level });
  const list = useMemo(() => all.filter((q) => (!origin || q.origin === origin) && (!subject || q.subject === subject)), [all, origin, subject]);
  const officialInBank = all.filter((q) => q.origin === 'official-released' || q.origin === 'official-sample');

  const practice = async () => {
    const r = await startQuiz({
      level,
      mode: 'test',
      count: Math.min(20, list.length),
      subjects: subject ? [subject] : undefined,
      origins: origin ? [origin] : undefined,
      scopeLabel: `題源篩選練習${origin ? `（${ORIGIN_LABEL[origin]}）` : ''}`,
    });
    if (r.ok) nav(`/quiz/${r.sessionId}`);
    else setMsg(r.message);
  };

  return (
    <>
      <PageHead
        kicker="Past exams"
        title="歷屆試題與題源"
        desc="官方公告試題依年度、梯次、科目列出並連到官方下載頁；本站自編題另依科目與題源類型篩選。兩者分開標示。"
      />

      <section className="card mb-5" aria-labelledby="papers-title" data-testid="official-papers">
        <CardHead
          title={<span id="papers-title" className="inline-flex items-center gap-2"><FileClock size={18} /> 官方公告試題（{level === 'junior' ? '初級' : '中級'}）</span>}
          right={<span className="pill">{shownPapers.length} 份</span>}
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">年度</span>
            <select className="field" value={paperYear} onChange={(e) => { setPaperYear(e.target.value); setPaperSession(''); }}>
              <option value="">全部</option>
              {paperYears.map((y) => (
                <option key={y} value={y}>
                  {y} 年（{y + 1911}）
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">梯次</span>
            <select className="field" value={paperSession} onChange={(e) => setPaperSession(e.target.value)}>
              <option value="">全部</option>
              {paperSessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">科目</span>
            <select className="field" value={paperSubject} onChange={(e) => setPaperSubject(e.target.value)}>
              <option value="">全部</option>
              {subjectsOf(level).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {shownPapers.length === 0 ? (
          <EmptyState title="此條件下沒有官方公告試題紀錄" />
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {shownPapers.map((p) => (
              <li key={`${p.rocYear}-${p.session}-${p.subject}`} className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 text-sm">
                  <strong>
                    {p.rocYear} 年{p.session}
                  </strong>{' '}
                  {p.subject} {getSubject(p.subject as SubjectCode).name}
                  {p.announcedAt && <span className="block text-xs text-muted">公告日期 {p.announcedAt}</span>}
                </span>
                <a
                  className="btn btn-secondary btn-sm shrink-0"
                  href={officialSources.examPapersPage}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`到官方學習資源頁下載 ${p.rocYear} 年${p.session} ${p.subject} 公告試題`}
                >
                  官方下載頁 <ExternalLink size={13} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          清單依官方學習資源頁整理（最後查核 {officialSources.lastCheckedAt}）。官方以頁內下載按鈕提供 PDF，沒有可直接連結的個別檔案網址，因此每列都連到官方學習資源頁，請在「歷屆考題」分頁下載對應檔案。
        </p>
      </section>

      <section className="card mb-5" aria-labelledby="copyright-title">
        <CardHead title={<span id="copyright-title" className="inline-flex items-center gap-2"><ShieldAlert size={18} /> 官方題目收錄狀態</span>} />
        <p className="text-sm">
          本站題庫<strong>未收錄任何官方公告原題或官方樣題</strong>（{officialInBank.length} 題）。官方試題雖可公開下載，但查核時未見明示允許轉載、重製或改作的條款，
          因此不將官方題幹、選項或圖片複製到本站，只提供官方連結：
        </p>
        <ul className="mt-3 grid gap-2">
          {OFFICIAL_LINKS.map((l) => (
            <li key={l.url}>
              <a className="inline-flex min-h-[40px] items-center gap-1 font-semibold" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label} <ExternalLink size={14} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">取得合法使用依據後，可依 docs/CONTENT_GUIDE.md 流程以 official-released 標記收錄，並註明年份、梯次與來源。</p>
      </section>

      <section className="card" aria-labelledby="filter-title">
        <CardHead title={<span id="filter-title">本站題庫篩選（自編題）</span>} right={<span className="pill">{list.length} 題</span>} />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-bold">科目</span>
            <select className="field" value={subject} onChange={(e) => setSubject(e.target.value as SubjectCode | '')}>
              <option value="">全部</option>
              {subjectsOf(level).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">題源類型</span>
            <select className="field" value={origin} onChange={(e) => setOrigin(e.target.value as QuestionOrigin | '')}>
              <option value="">全部</option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABEL[o]}（{all.filter((q) => q.origin === o).length}）
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mb-3 text-xs text-muted">本站自編題沒有年份與梯次；年份與梯次只適用於上方的官方公告試題紀錄。</p>
        {msg && <p className="notice mb-3">{msg}</p>}
        {list.length === 0 ? (
          <EmptyState icon={<FileClock size={30} />} title="此條件下沒有題目">
            {origin === 'official-released' || origin === 'official-sample' ? '本站未收錄官方題，請使用上方官方連結。' : '請調整篩選條件。'}
          </EmptyState>
        ) : (
          <>
            <ul className="mb-4 grid grid-cols-1 gap-1 text-sm">
              {list.slice(0, 12).map((q) => (
                <li key={q.id} className="flex gap-2 border-b border-line py-2 last:border-0">
                  <span className="pill shrink-0">{ORIGIN_LABEL[q.origin]}</span>
                  <span className="min-w-0 truncate">
                    {q.competencyCode}｜{q.stem}
                  </span>
                </li>
              ))}
            </ul>
            {list.length > 12 && <p className="mb-3 text-xs text-muted">另有 {list.length - 12} 題未列出。</p>}
            <button type="button" className="btn" onClick={practice}>
              以此篩選出題（{Math.min(20, list.length)} 題・測驗模式）
            </button>
          </>
        )}
      </section>
    </>
  );
}
