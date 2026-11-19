import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Level } from '../content/schema';
import { db, defaultSettings } from '../data/db';
import { updateSettings } from '../data/repo';
import type { UserSettings } from '../data/types';

interface AppCtx {
  settings: UserSettings;
  level: Level;
  setLevel: (l: Level) => Promise<void>;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

const UI_PREFS_KEY = 'ipas-ui-prefs';

function applyUi(s: UserSettings) {
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (s.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  root.style.setProperty('--font-scale', String(s.fontScale));
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ theme: s.theme, highContrast: s.highContrast, fontScale: s.fontScale }));
  } catch {
    /* 私密瀏覽等情況可能無法寫入，忽略 */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  // undefined = 載入中；null = 資料庫沒有設定（或無法使用），改用預設值
  const stored = useLiveQuery(async () => {
    try {
      return (await db.settings.get('user')) ?? null;
    } catch {
      return null;
    }
  }, []);
  const settings = useMemo(() => stored ?? defaultSettings(), [stored]);

  useEffect(() => {
    applyUi(settings);
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const fn = () => applyUi(settings);
    mq?.addEventListener('change', fn);
    return () => mq?.removeEventListener('change', fn);
  }, [settings]);

  const value: AppCtx = {
    settings,
    level: settings.level,
    setLevel: (level) => updateSettings({ level }),
    update: updateSettings,
  };
  // 設定載入前不渲染頁面，避免首次設定視窗與預設級別閃現
  if (stored === undefined)
    return (
      <div role="status" className="p-10 text-center text-muted">
        載入學習紀錄中…
      </div>
    );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp 必須在 AppProvider 內使用');
  return v;
}
