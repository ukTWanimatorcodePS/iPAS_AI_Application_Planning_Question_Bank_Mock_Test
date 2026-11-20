/**
 * Codex v1.1.0 第二輪複查（docs/AUDIT_v1.1.0_r2.md）R1、R2、S3 的回歸測試。
 * 重現方式沿用 Codex 的探測（docs/audit-v110-r2.probe.test.tsx、docs/audit-v110-r2-lifecycle.test.tsx），
 * 預期結果改為修正後的行為；另補相鄰路徑（其他分頁改設定、舊格式金鑰、等待中換服務的結果）。
 * 所有金鑰都是假字串，fetch 全部攔截，不會連線。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ relevance: () => Promise.resolve(10) as Promise<number>, calls: [] as { url: string; init?: RequestInit }[] }));
vi.mock('../../src/app/AppContext', () => ({ useApp: () => ({ level: 'junior', settings: {} }) }));
vi.mock('../../src/ai/byok/retrieval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ai/byok/retrieval')>()),
  questionRelevance: () => probe.relevance(),
}));

import { setChatUi } from '../../src/ai/byok/chatUi';
import { topicVerdict } from '../../src/ai/byok/check';
import { CONFIG_KEY, KEY_STORAGE_KEY, __resetByokMemoryForTests, byokVersion, clearByok, loadByok, saveByok } from '../../src/ai/byok/config';
import { setChatContext } from '../../src/ai/byok/context';
import { ByokSettings } from '../../src/components/ByokSettings';
import { TutorChat } from '../../src/components/TutorChat';
import { getQuestion } from '../../src/content';
import { backupSchema, exportBackup, parseBackup, restoreBackup, restoredLastOptionOrders, BACKUP_SCHEMA_VERSION } from '../../src/data/backup';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, nextOptionOrder } from '../../src/data/repo';

const QID = 'original-L11101-0001';
const OPENAI = { presetId: 'openai', kind: 'openai-compatible' as const, baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false };
const OPENROUTER = { ...OPENAI, presetId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
const OPENAI_KEY = 'FAKE-OPENAI-KEY';
const OPENROUTER_KEY = 'FAKE-OPENROUTER-KEY';
const correctPos = (order: string[]) => order.findIndex((id) => getQuestion(QID)!.correctOptionIds.includes(id as never));
const sentText = () => JSON.stringify(probe.calls.map((c) => ({ url: c.url, headers: c.init?.headers })));
const sessionInput = { level: 'junior' as const, mode: 'practice' as const, subject: null, scopeLabel: 'r2', competencyCodes: ['L11101'], questionIds: [QID] };

let n = 0;
beforeEach(async () => {
  HTMLElement.prototype.scrollTo = () => {};
  __setDb(new PrepDB(`audit-v110-r2-fix-${++n}`));
  await ensureInitialized();
  localStorage.clear();
  sessionStorage.clear();
  clearByok();
  probe.calls = [];
  probe.relevance = () => Promise.resolve(10);
  window.location.hash = '#/';
  saveByok(OPENAI, OPENAI_KEY);
  setChatContext({ kind: 'none' });
  setChatUi({ enabled: true, size: 'normal' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      probe.calls.push({ url: String(url), init });
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('R1 設定與金鑰是同一份快照（金鑰綁定服務與來源）', () => {
  it('重現 A：另一個表單儲存別的服務後，本表單換到該服務，不會帶原服務的舊金鑰', async () => {
    render(<ByokSettings />);
    // 模擬另一個同時掛載的設定表單（設定頁／導師視窗）儲存 OpenRouter
    act(() => saveByok(OPENROUTER, OPENROUTER_KEY));
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'openrouter' } });
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    expect(probe.calls[0].url).toBe('https://openrouter.ai/api/v1/models');
    expect(sentText()).not.toContain(OPENAI_KEY);
    // 送出的是綁定在 OpenRouter 上的金鑰（屬於同一服務，正確）
    expect(sentText()).toContain(OPENROUTER_KEY);
  });

  it('重現 A（兩個真實表單並存）：第二個表單儲存 OpenRouter 後，第一個表單仍選 OpenAI 時不沿用任何金鑰', async () => {
    render(
      <>
        <div data-testid="form-a">
          <ByokSettings />
        </div>
        <div data-testid="form-b">
          <ByokSettings />
        </div>
      </>,
    );
    const [, selectB] = screen.getAllByRole('combobox', { name: /^AI 服務/ });
    const [, keyB] = screen.getAllByTestId('byok-key');
    const [, saveB] = screen.getAllByTestId('byok-save');
    fireEvent.change(selectB, { target: { value: 'openrouter' } });
    // 模型欄位附有 datalist，無障礙角色是 combobox
    fireEvent.change(screen.getAllByRole('combobox', { name: '模型' })[1], { target: { value: 'test' } });
    fireEvent.change(keyB, { target: { value: OPENROUTER_KEY } });
    fireEvent.click(saveB);
    expect(loadByok().config?.presetId).toBe('openrouter');
    // 「儲存並連線」用 OpenRouter 自己的金鑰確認連線（只讀模型清單）；之後只看第一個表單發出的請求
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    expect(probe.calls[0].url).toBe('https://openrouter.ai/api/v1/models');
    probe.calls = [];
    // 第一個表單仍是 OpenAI：已儲存的金鑰屬於 OpenRouter，不能拿來用
    fireEvent.click(screen.getAllByRole('button', { name: '取得模型清單' })[0]);
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    expect(probe.calls[0].url).toBe('https://api.openai.com/v1/models');
    expect(sentText()).not.toContain(OPENROUTER_KEY);
    expect(sentText()).not.toContain(OPENAI_KEY);
  });

  it('重現 B：檢索等待中儲存另一個服務，原請求取消、不送出任何請求', async () => {
    let release!: (n: number) => void;
    probe.relevance = () => new Promise((r) => (release = r));
    render(
      <MemoryRouter>
        <TutorChat />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是監督式學習？' } });
    fireEvent.click(screen.getByTestId('tutor-chat-send'));
    await act(async () => saveByok(OPENROUTER, OPENROUTER_KEY));
    await act(async () => release(10));
    await new Promise((r) => setTimeout(r, 50));
    expect(probe.calls).toHaveLength(0);
  });

  it('重現 B（變形）：等待中清除金鑰，也不送出', async () => {
    let release!: (n: number) => void;
    probe.relevance = () => new Promise((r) => (release = r));
    render(
      <MemoryRouter>
        <TutorChat />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是監督式學習？' } });
    fireEvent.click(screen.getByTestId('tutor-chat-send'));
    await act(async () => clearByok());
    await act(async () => release(10));
    await new Promise((r) => setTimeout(r, 50));
    expect(probe.calls).toHaveLength(0);
  });

  it('沒有變更時正常送出：網址與金鑰屬於同一個服務', async () => {
    render(
      <MemoryRouter>
        <TutorChat />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是監督式學習？' } });
    fireEvent.click(screen.getByTestId('tutor-chat-send'));
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    expect(probe.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sentText()).toContain(OPENAI_KEY);
  });

  it('重現 C：輸入但未儲存的金鑰，換服務後清空，不會送到新服務', async () => {
    render(<ByokSettings />);
    fireEvent.change(screen.getByTestId('byok-key'), { target: { value: 'FAKE-TYPED-OPENAI-KEY' } });
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'ollama' } });
    expect((screen.getByTestId('byok-key') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    expect(probe.calls[0].url).toBe('http://localhost:11434/v1/models');
    expect(sentText()).not.toContain('FAKE-TYPED-OPENAI-KEY');
    expect(sentText()).not.toContain(OPENAI_KEY);
  });

  it('重現 C（改 API 位址）：換到不同來源時清空未儲存的金鑰；同一來源只改路徑則保留', async () => {
    render(<ByokSettings />);
    const url = screen.getByRole('textbox', { name: 'API 位址' });
    const key = screen.getByTestId('byok-key') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'FAKE-TYPED-KEY' } });
    fireEvent.change(url, { target: { value: 'https://api.openai.com/v1/' } });
    expect(key.value).toBe('FAKE-TYPED-KEY');
    fireEvent.change(url, { target: { value: 'https://other.example/v1' } });
    expect(key.value).toBe('');
  });

  it('等待模型清單時換服務：舊結果不顯示在新服務的表單上', async () => {
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        probe.calls.push({ url: String(url), init });
        return new Promise<Response>((r) => (resolveFetch = r));
      }),
    );
    render(<ByokSettings />);
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'ollama' } });
    await act(async () => resolveFetch(new Response(JSON.stringify({ data: [{ id: 'gpt-old' }] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/找到 1 個模型/)).toBeNull();
    expect(document.querySelector('datalist option[value="gpt-old"]')).toBeNull();
  });

  it('其他分頁改了設定（localStorage）：本分頁記憶中的舊金鑰不會配上新設定', () => {
    expect(loadByok().key).toBe(OPENAI_KEY);
    const before = byokVersion();
    // 其他分頁把設定改成 OpenRouter（本分頁的金鑰仍是 OpenAI 的，存在 sessionStorage）
    localStorage.setItem(CONFIG_KEY, JSON.stringify(OPENROUTER));
    window.dispatchEvent(new StorageEvent('storage', { key: CONFIG_KEY }));
    expect(byokVersion()).toBeGreaterThan(before);
    const snap = loadByok();
    expect(snap.config?.presetId).toBe('openrouter');
    expect(snap.key).toBe('');
  });

  it('金鑰與服務一起儲存；舊格式（只有金鑰字串）或綁定不符時不沿用', () => {
    const stored = JSON.parse(sessionStorage.getItem(KEY_STORAGE_KEY)!);
    expect(stored).toEqual({ key: OPENAI_KEY, presetId: 'openai', origin: 'https://api.openai.com' });
    // 舊格式
    sessionStorage.setItem(KEY_STORAGE_KEY, 'FAKE-LEGACY-KEY');
    __resetByokMemoryForTests();
    expect(loadByok().key).toBe('');
    // 綁定的是別的來源
    sessionStorage.setItem(KEY_STORAGE_KEY, JSON.stringify({ key: 'FAKE-X', presetId: 'openai', origin: 'https://evil.example' }));
    __resetByokMemoryForTests();
    expect(loadByok().key).toBe('');
  });
});

describe('R2 備份保存並精確還原「上一次選項順序」', () => {
  it('重現 A：同毫秒建立兩份測驗（主鍵順序與建立順序相反），還原後下一次正解位置仍與最後一次不同', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('ffffffff-ffff-4fff-8fff-ffffffffffff').mockReturnValueOnce('00000000-0000-4000-8000-000000000000');
    const a = (await db.quizSessions.get(await createSession(sessionInput)))!.optionOrders![QID];
    const b = (await db.quizSessions.get(await createSession(sessionInput)))!.optionOrders![QID];
    expect(a).not.toEqual(b);
    const parsed = parseBackup(JSON.stringify(await exportBackup()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await restoreBackup(parsed.backup);
    expect((await db.lastOptionOrders.get(QID))!.order).toEqual(b);
    const next = (await nextOptionOrder(QID))!;
    expect(correctPos(next)).not.toBe(correctPos(b));
  });

  it('重現 B：補強題顯示後尚未作答，備份還原仍保留這次的順序', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const first = (await db.quizSessions.get(await createSession(sessionInput)))!.optionOrders![QID];
    const tutor = (await nextOptionOrder(QID))!;
    expect(tutor).not.toEqual(first);
    const parsed = parseBackup(JSON.stringify(await exportBackup()));
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreBackup(parsed.backup);
    expect((await db.lastOptionOrders.get(QID))!.order).toEqual(tutor);
  });

  it('匯出含 lastOptionOrders，備份格式仍是 v3', async () => {
    await createSession(sessionInput);
    const backup = await exportBackup();
    expect(backup.schemaVersion).toBe(3);
    expect(BACKUP_SCHEMA_VERSION).toBe(3);
    expect(backup.data.lastOptionOrders?.map((r) => r.questionId)).toEqual([QID]);
  });

  it('舊備份沒有 lastOptionOrders：退回依紀錄重建', async () => {
    const id = await createSession(sessionInput);
    const order = (await db.quizSessions.get(id))!.optionOrders![QID];
    const backup = await exportBackup();
    delete (backup.data as { lastOptionOrders?: unknown }).lastOptionOrders;
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.backup.data.lastOptionOrders).toBeUndefined();
    await restoreBackup(parsed.backup);
    expect((await db.lastOptionOrders.get(QID))!.order).toEqual(order);
  });

  it('不是本題選項排列、或題目不存在的紀錄略過（不採用損毀資料）', async () => {
    const id = await createSession(sessionInput);
    const fromSession = (await db.quizSessions.get(id))!.optionOrders![QID];
    const backup = await exportBackup();
    backup.data.lastOptionOrders = [
      { questionId: QID, order: ['A', 'A', 'B', 'C'] },
      { questionId: 'original-L99999-0001', order: ['A', 'B', 'C', 'D'] },
    ];
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    const rows = restoredLastOptionOrders(parsed.backup);
    // 損毀的那筆略過，該題退回由測驗紀錄重建的順序；不存在的題目不寫入
    expect(rows).toEqual([{ questionId: QID, order: fromSession }]);
  });

  it('同一題重複、選項代號不合法或超過 6 個：整份備份拒絕匯入', async () => {
    await createSession(sessionInput);
    const base = await exportBackup();
    const bad = (rows: unknown) => backupSchema.safeParse({ ...base, data: { ...base.data, lastOptionOrders: rows } }).success;
    expect(bad([{ questionId: QID, order: ['A', 'B', 'C', 'D'] }, { questionId: QID, order: ['B', 'A', 'C', 'D'] }])).toBe(false);
    expect(bad([{ questionId: QID, order: ['A', 'B', 'C', 'Z'] }])).toBe(false);
    expect(bad([{ questionId: QID, order: ['A', 'B', 'C', 'D', 'E', 'A', 'B'] }])).toBe(false);
    expect(bad([{ questionId: QID, order: ['B', 'A', 'C', 'D'] }])).toBe(true);
  });
});

describe('S3 泛用詞不能蓋過閒聊阻擋', () => {
  it('像閒聊的提問只靠「評估、風險、分類」等泛用詞不放行；強主題詞仍放行', () => {
    // 相關度一律給低分（與 Codex 實測的 2.03 同級），只看用詞規則
    for (const t of ['請評估今晚餐廳哪家好吃', '評估台北餐廳的風險', '幫我把電影分類', '推薦好吃的晚餐，順便評估一下'])
      expect(topicVerdict(t, 2, true).ok, t).toBe(false);
    for (const t of ['用生成式 AI 寫一首詩屬於哪種應用？', '機器學習怎麼推薦電影', '用深度學習判斷餐廳評論的情緒'])
      expect(topicVerdict(t, 2, true).ok, t).toBe(true);
    // 不像閒聊時，泛用詞仍可作為學習證據
    expect(topicVerdict('分類模型的評估指標有哪些', 2, false).ok).toBe(true);
  });
});
