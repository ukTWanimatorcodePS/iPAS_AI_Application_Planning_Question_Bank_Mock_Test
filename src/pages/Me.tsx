import { BarChart3, BookOpen, CalendarDays, FileClock, Flame, Settings, Timer } from 'lucide-react';
import { Link } from 'react-router';
import { useApp } from '../app/AppContext';
import { OfficialDisclaimer, PageHead } from '../components/ui';

const LINKS = [
  { to: '/plan', label: '學習計畫', desc: '每日任務、倒數與學習進度', icon: CalendarDays },
  { to: '/sprint', label: '考前衝刺', desc: '個人弱點、錯題重測、混合測驗', icon: Flame },
  { to: '/stats', label: '成績分析', desc: '科目正確率、趨勢、弱點排名', icon: BarChart3 },
  { to: '/mock', label: '自訂模考', desc: '計時、跳題、標記待檢', icon: Timer },
  { to: '/past-exams', label: '歷屆試題與題源', desc: '官方資源連結與題源篩選', icon: FileClock },
  { to: '/courses', label: '課程講義', desc: '依官方 L 代碼瀏覽', icon: BookOpen },
  { to: '/settings', label: '設定與備份', desc: '學習計畫、深色模式、匯出匯入', icon: Settings },
];

export function MePage() {
  const { settings, level } = useApp();
  return (
    <>
      <PageHead
        kicker="Me"
        title="我的"
        desc={`目前級別：${level === 'junior' ? '初級' : '中級'}・目標 ${level === 'junior' ? settings.studyGoal.junior : settings.studyGoal.middle}`}
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {LINKS.map(({ to, label, desc, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="card flex min-h-[72px] items-center gap-3 text-ink no-underline">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden>
                <Icon size={20} />
              </span>
              <span>
                <strong className="block">{label}</strong>
                <span className="text-xs text-muted">{desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <OfficialDisclaimer />
      </div>
    </>
  );
}
