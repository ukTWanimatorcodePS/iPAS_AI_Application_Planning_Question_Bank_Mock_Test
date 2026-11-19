import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, PageHead } from '../components/ui';
import { allCompetencies, lessonCodes, loadLesson } from '../content';
import { plainText } from '../lib/lessonOutline';

interface Hit {
  code: string;
  title: string;
  snippet: string;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(q);
  const [texts, setTexts] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    Promise.all(lessonCodes().map(async (c) => [c, plainText((await loadLesson(c)) ?? '')] as const)).then((e) => setTexts(new Map(e)));
  }, []);

  const kw = q.toLowerCase();
  const hits: Hit[] = !kw
    ? []
    : allCompetencies().flatMap((c) => {
        const title = `${c.code} ${c.name}`;
        const body = texts?.get(c.code) ?? '';
        const inTitle = `${title} ${c.topic.code} ${c.topic.name} ${c.subject.name}`.toLowerCase().includes(kw);
        const idx = body.toLowerCase().indexOf(kw);
        if (!inTitle && idx < 0) return [];
        const snippet = idx >= 0 ? `…${body.slice(Math.max(0, idx - 40), idx + 60)}…` : `${c.subject.name} › ${c.topic.name}`;
        return [{ code: c.code, title, snippet }];
      });

  return (
    <>
      <PageHead kicker="Search" title="搜尋" desc="搜尋課綱代碼、名稱與講義內文。" />
      <form
        role="search"
        className="relative mb-5 max-w-lg"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: input.trim() });
        }}
      >
        <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
        <input className="field !pl-9" type="search" aria-label="搜尋關鍵字" value={input} onChange={(e) => setInput(e.target.value)} placeholder="例如：過擬合、L113、個資" />
      </form>
      {!q ? null : !texts ? (
        <p className="text-muted" role="status">搜尋中…</p>
      ) : hits.length === 0 ? (
        <div className="card">
          <EmptyState icon={<SearchIcon size={28} />} title={`找不到「${q}」`}>試試其他關鍵字或課綱代碼。</EmptyState>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label={`共 ${hits.length} 筆結果`}>
          {hits.map((h) => (
            <li key={h.code}>
              <Link to={`/courses/${h.code}`} className="card block text-ink no-underline">
                <strong className="text-primary">{h.title}</strong>
                <p className="mt-1 text-sm text-muted">{h.snippet}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
