import { CheckCircle2, Circle, FileQuestion, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { CardHead, PageHead, ProgressBar } from '../components/ui';
import { curriculum, hasLesson, questionsFor, subjectsOf } from '../content';
import { useLessonProgress } from '../data/hooks';
import { subjectsForTrack } from '../lib/learningPath';

export function CoursesIndex() {
  const { level, settings } = useApp();
  const progress = useLessonProgress(level);
  const [q, setQ] = useState('');
  const trackSubjects = subjectsForTrack(level, settings.track);
  const kw = q.trim().toLowerCase();

  return (
    <>
      <PageHead
        kicker="Courses"
        title="課程講義"
        desc={`依官方評鑑內容範圍 ${curriculum.curriculumVersion} 版（${curriculum.publishedAt}）安排；最後核對 ${curriculum.lastVerifiedAt}。`}
      />
      <div className="relative mb-5 max-w-md">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
        <input
          className="field !pl-9"
          type="search"
          aria-label="篩選課綱代碼或名稱"
          placeholder="篩選代碼或名稱，例如 L113、隱私"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="grid gap-5">
        {subjectsOf(level).map((s) => {
          const comps = s.topics.flatMap((t) => t.competencies);
          const done = comps.filter((c) => progress?.get(c.code)?.completedAt).length;
          const inTrack = trackSubjects.includes(s.code);
          return (
            <section key={s.code} className="card" aria-labelledby={`sub-${s.code}`}>
              <CardHead
                title={
                  <span id={`sub-${s.code}`}>
                    <span className="text-primary">{s.code}</span> {s.name}
                  </span>
                }
                right={
                  <span className="flex gap-2">
                    {level === 'middle' && !inTrack && <span className="pill">非目前路線</span>}
                    <span className="pill pill-blue">
                      已讀 {done}/{comps.length}
                    </span>
                  </span>
                }
              />
              <ProgressBar value={(done / comps.length) * 100} label={`${s.name} 完成度`} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {s.topics.map((t) => {
                  const visible = t.competencies.filter(
                    (c) => !kw || `${c.code} ${c.name} ${t.code} ${t.name}`.toLowerCase().includes(kw),
                  );
                  if (!visible.length) return null;
                  return (
                    <div key={t.code} className="rounded-xl border border-line p-3">
                      <h3 className="mb-2 text-sm font-bold">
                        <span className="text-primary">{t.code}</span> {t.name}
                      </h3>
                      <ul className="grid gap-1">
                        {visible.map((c) => {
                          const p = progress?.get(c.code);
                          const ready = hasLesson(c.code);
                          const qn = questionsFor({ competencyCode: c.code }).length;
                          return (
                            <li key={c.code}>
                              <Link
                                to={`/courses/${c.code}`}
                                className="flex min-h-[48px] items-center gap-3 rounded-lg px-2 py-2 text-ink no-underline hover:bg-soft"
                              >
                                {p?.completedAt ? (
                                  <CheckCircle2 size={18} className="shrink-0 text-ok" aria-label="已完成" />
                                ) : (
                                  <Circle size={18} className="shrink-0 text-muted" aria-label="未完成" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold">
                                    {c.code} {c.name}
                                  </span>
                                  <span className="flex flex-wrap gap-x-2 text-[0.72rem] text-muted">
                                    <span>{ready ? '講義已收錄' : '講義尚未收錄'}</span>
                                    <span className="inline-flex items-center gap-0.5">
                                      <FileQuestion size={12} aria-hidden /> {qn ? `${qn} 題` : '尚無題目'}
                                    </span>
                                    {p?.lastPosition && !p.completedAt && <span>閱讀中</span>}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
