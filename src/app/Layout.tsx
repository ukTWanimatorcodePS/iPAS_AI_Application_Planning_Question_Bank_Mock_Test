import {
  BarChart3,
  CalendarDays,
  Flame,
  BookOpen,
  ClipboardList,
  FileClock,
  Home,
  Menu,
  Moon,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Sun,
  Timer,
  User,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { allCompetencies } from '../content';
import type { Level } from '../content/schema';
import { APP_VERSION } from '../config/project';
import { TutorChat } from '../components/TutorChat';
import { db } from '../data/db';
import { useApp } from './AppContext';

const NAV = [
  { to: '/', label: '首頁', icon: Home, end: true },
  { to: '/plan', label: '學習計畫', icon: CalendarDays },
  { to: '/courses', label: '課程講義', icon: BookOpen },
  { to: '/practice', label: '題庫練習', icon: NotebookPen },
  { to: '/past-exams', label: '歷屆試題', icon: FileClock },
  { to: '/mock', label: '模擬考', icon: Timer },
  { to: '/sprint', label: '考前衝刺', icon: Flame },
  { to: '/review', label: '錯題本', icon: ClipboardList },
  { to: '/stats', label: '成績分析', icon: BarChart3 },
  { to: '/settings', label: '設定', icon: Settings },
];

const MOBILE_NAV = [
  { to: '/', label: '首頁', icon: Home, end: true },
  { to: '/courses', label: '講義', icon: BookOpen },
  { to: '/practice', label: '練題', icon: NotebookPen },
  { to: '/review', label: '錯題', icon: ClipboardList },
  { to: '/me', label: '我的', icon: User },
];

function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`grid shrink-0 place-items-center rounded-xl bg-primary text-white ${small ? 'h-8 w-8' : 'h-10 w-10'}`}
        style={{ background: '#4355dc' }}
        aria-hidden
      >
        <Sparkles size={small ? 17 : 20} />
      </div>
      <div className="min-w-0">
        <div className={`font-extrabold tracking-tight ${small ? 'text-base' : 'text-lg'}`}>AI 備考室</div>
        {!small && <div className="text-[0.7rem] text-muted">依課綱學習・練題・補強</div>}
      </div>
    </div>
  );
}

export function LevelSwitch() {
  const { level, setLevel } = useApp();
  const opts: [Level, string][] = [
    ['junior', '初級'],
    ['middle', '中級'],
  ];
  return (
    <div role="radiogroup" aria-label="切換級別" className="flex rounded-xl bg-soft p-1">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={level === v}
          onClick={() => setLevel(v)}
          className={`min-h-[36px] rounded-lg px-3 text-sm font-bold md:px-4 ${
            level === v ? 'bg-surface text-primary shadow-sm' : 'text-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const { settings, update } = useApp();
  const isDark = document.documentElement.dataset.theme === 'dark';
  return (
    <button
      type="button"
      className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface"
      aria-label={isDark ? '切換為淺色模式' : '切換為深色模式'}
      onClick={() => update({ theme: isDark ? 'light' : 'dark' })}
      data-theme-pref={settings.theme}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function HeaderSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="relative w-full max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        nav(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
      <input
        className="field !min-h-[40px] !pl-9"
        type="search"
        placeholder="搜尋講義、代碼或關鍵字"
        aria-label="全站搜尋"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

function ProgressHint() {
  const { level } = useApp();
  const done = useLiveQuery(
    () => db.lessonProgress.where('level').equals(level).filter((p) => !!p.completedAt).count(),
    [level],
  );
  const total = allCompetencies(level).length;
  return (
    <span className="pill hidden xl:inline-flex" aria-label={`講義完成 ${done ?? 0} / ${total}`}>
      講義完成 {done ?? 0}/{total}
    </span>
  );
}

function NavItem({ to, label, icon: Icon, end, onClick }: { to: string; label: string; icon: typeof Home; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `mb-1 flex min-h-[46px] items-center gap-3 rounded-xl px-4 font-semibold no-underline ${
          isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-soft'
        }`
      }
    >
      <Icon size={19} aria-hidden />
      <span>{label}</span>
    </NavLink>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  const storageError = (window as unknown as { __storageError?: string }).__storageError;
  const inQuiz = loc.pathname.startsWith('/quiz/');

  return (
    <div className="flex min-h-screen">
      {/* HashRouter 下 href="#main" 會被當成路由切換，因此改以程式移動焦點 */}
      <a
        href="#main"
        className="sr-only-focusable btn fixed top-2 left-2 z-[60]"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById('main');
          main?.focus();
          main?.scrollIntoView({ block: 'start' });
        }}
      >
        跳到主要內容
      </a>
      {/* 桌面 Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[var(--sidebar-w)] shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2 pb-6">
          <Brand />
        </div>
        <nav aria-label="主要導覽" className="flex-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="mt-4 rounded-xl bg-soft p-3 text-[0.72rem] text-muted">
          <strong className="mb-1 block text-xs text-ink">獨立學習工具</strong>
          非 iPAS 官方平台。學習紀錄只存在這台裝置的瀏覽器，不會自動跨裝置同步。
        </div>
        <p className="mt-3 px-2 text-[0.72rem] text-muted" data-testid="app-version">
          版本 v{APP_VERSION}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-8 lg:h-[72px]">
            <div className="lg:hidden">
              <Brand small />
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <HeaderSearch />
            </div>
            <div className="flex items-center gap-2">
              <ProgressHint />
              <LevelSwitch />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface lg:hidden"
                aria-label="開啟功能選單"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={20} />
              </button>
            </div>
          </div>
        </header>

        {storageError && (
          <div className="notice m-4" role="alert">
            此瀏覽器無法使用本機資料庫（可能是私密瀏覽模式），學習進度將無法保存。
          </div>
        )}

        <main id="main" className="pb-safe mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 pt-6 md:px-8 md:pt-8" tabIndex={-1}>
          <Outlet />
          {/* 手機與平板：側欄不顯示，版本號放在每頁內容底部，不必打開功能選單也看得到 */}
          <p className="mt-10 mb-2 text-center text-[0.72rem] text-muted lg:hidden" data-testid="app-version-footer">
            版本 v{APP_VERSION}・獨立學習工具，非 iPAS 官方平台
          </p>
        </main>
      </div>

      {/* 手機底部導覽 */}
      {!inQuiz && (
        <nav
          aria-label="主要導覽（行動版）"
          className="bottom-nav fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-surface/95 pt-1.5 backdrop-blur lg:hidden"
        >
          {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[50px] min-w-[60px] flex-col items-center justify-center gap-0.5 text-[0.7rem] font-bold no-underline ${
                  isActive ? 'text-primary' : 'text-muted'
                }`
              }
            >
              <Icon size={21} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      )}

      {/* AI 導師（自備 API）：預設關閉，於設定開啟後才顯示懸浮圖示 */}
      <TutorChat />

      {/* 手機功能選單抽屜 */}
      {menuOpen && (
        <Drawer onClose={() => setMenuOpen(false)} title="功能選單">
          <div className="mb-4">
            <HeaderSearch />
          </div>
          <nav aria-label="完整功能選單">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} onClick={() => setMenuOpen(false)} />
            ))}
          </nav>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-soft p-3 text-sm">
            <span>深色模式</span>
            <ThemeToggle />
          </div>
          <p className="mt-4 text-xs text-muted" data-testid="app-version-mobile">
            版本 v{APP_VERSION}
          </p>
        </Drawer>
      )}
    </div>
  );
}

export function Drawer({ title, onClose, children, side = 'right' }: { title: string; onClose: () => void; children: ReactNode; side?: 'right' | 'left' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute top-0 bottom-0 flex w-[min(340px,88vw)] flex-col overflow-y-auto bg-surface p-4 shadow-xl ${side === 'right' ? 'right-0' : 'left-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" className="grid h-11 w-11 place-items-center rounded-xl" aria-label="關閉" onClick={onClose} autoFocus>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
