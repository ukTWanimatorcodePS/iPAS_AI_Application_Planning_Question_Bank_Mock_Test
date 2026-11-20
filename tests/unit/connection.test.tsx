/**
 * AI 導師連線狀態與 30 分鐘連線時限、本機 AI 自動判斷。
 * 金鑰都是假字串，fetch 全部攔截，不會連線。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

vi.mock('../../src/app/AppContext', () => ({ useApp: () => ({ level: 'junior', settings: {} }) }));
vi.mock('../../src/ai/byok/retrieval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ai/byok/retrieval')>()),
  questionRelevance: () => Promise.resolve(10),
}));
import { ByokError, rejectsTokenParam, safeDetail, streamChat, verifyConnection } from '../../src/ai/byok/client';
import {
  SESSION_MS,
  __resetConnectionForTests,
  __setConnectionClockForTests,
  beginConnection,
  formatRemaining,
  getConnection,
  hasActiveSession,
  isExpired,
} from '../../src/ai/byok/connection';
import { clearByok, credentialId, loadByok, saveByok, type ByokConfig } from '../../src/ai/byok/config';
import { setChatUi } from '../../src/ai/byok/chatUi';
import { setChatContext } from '../../src/ai/byok/context';
import { TutorChat } from '../../src/components/TutorChat';
import { detectLocal, diagnoseLocal, orderModels } from '../../src/ai/byok/diagnose';
import { ByokSettings } from '../../src/components/ByokSettings';
import { ConnectionIndicator, SessionTimer } from '../../src/components/ConnectionIndicator';

const cfg: ByokConfig = { presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false };
const KEY = 'FAKE-CONNECTION-KEY';
const ollama: ByokConfig = { presetId: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', rememberKey: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const models = (...ids: string[]) => json({ data: ids.map((id) => ({ id })) });
const sse = () => new Response('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const state = () => screen.getByTestId('ai-connection').getAttribute('data-state');

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  clearByok();
  saveByok(cfg, KEY);
  __resetConnectionForTests();
});
afterEach(() => {
  cleanup();
  __resetConnectionForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('30 分鐘連線', () => {
  it('第一次成功開始 30 分鐘；之後的成功不延長；時間到轉為「已到時」並擋下送出', () => {
    vi.useFakeTimers();
    __setConnectionClockForTests(() => clock);
    render(<ConnectionIndicator config={cfg} apiKey={KEY} />);
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    expect(state()).toBe('online');
    const { expiresAt } = getConnection();
    expect(expiresAt).toBe(clock + SESSION_MS);
    clock += 20 * 60_000;
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    expect(getConnection().expiresAt).toBe(expiresAt); // 沒有延長
    expect(hasActiveSession(cfg, KEY)).toBe(true);
    clock += 10 * 60_000;
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(state()).toBe('expired');
    expect(isExpired(cfg, KEY)).toBe(true);
    expect(hasActiveSession(cfg, KEY)).toBe(false);
  });

  it('到時後重新連線，開始新的 30 分鐘', async () => {
    vi.useFakeTimers();
    __setConnectionClockForTests(() => clock);
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    clock += SESSION_MS;
    act(() => vi.advanceTimersByTime(SESSION_MS));
    expect(getConnection().phase).toBe('expired');
    await act(async () => {
      await verifyConnection(cfg, KEY, async () => models('test'));
    });
    expect(getConnection().phase).toBe('online');
    expect(getConnection().expiresAt).toBe(clock + SESSION_MS);
  });

  it('計時器只在連線時顯示，剩不到 5 分鐘改為提醒樣式', () => {
    vi.useFakeTimers();
    __setConnectionClockForTests(() => Date.now());
    render(<SessionTimer config={cfg} apiKey={KEY} />);
    expect(screen.queryByTestId('tutor-session-timer')).toBeNull();
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    expect(screen.getByRole('timer')).toHaveTextContent('30:00');
    act(() => vi.advanceTimersByTime(26 * 60_000));
    expect(screen.getByRole('timer')).toHaveTextContent('04:00');
    expect(screen.getByRole('timer')).toHaveAccessibleName(/即將到時/);
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(screen.queryByTestId('tutor-session-timer')).toBeNull();
    expect(formatRemaining(61_500)).toBe('01:02');
  });

  it('中止請求恢復原本的連線，不會變成未連線', () => {
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    const before = getConnection();
    const finish = beginConnection(cfg, KEY);
    expect(getConnection().phase).toBe('checking');
    expect(getConnection().expiresAt).toBe(before.expiresAt); // 請求中仍顯示同一段計時
    finish({ phase: 'aborted' });
    expect(getConnection()).toEqual(before);
  });

  it('晚到的結果不套用：有更新的請求，或已換金鑰', () => {
    const first = beginConnection(cfg, KEY);
    const second = beginConnection(cfg, KEY);
    first({ phase: 'offline', message: 'x' });
    expect(getConnection().phase).toBe('checking');
    second({ phase: 'online' });
    expect(getConnection().phase).toBe('online');
    const late = beginConnection(cfg, KEY);
    saveByok(cfg, 'FAKE-OTHER-KEY'); // 換金鑰＝另一個連線對象
    late({ phase: 'online' });
    expect(getConnection().phase).toBe('idle');
  });

  it('儲存同一個對象保留連線與計時；換模型或金鑰則各自獨立', () => {
    const view = render(<ConnectionIndicator config={cfg} apiKey={KEY} />);
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    const before = getConnection();
    act(() => saveByok(cfg, KEY));
    expect(getConnection()).toEqual(before);
    view.rerender(<ConnectionIndicator config={{ ...cfg, model: 'other' }} apiKey={KEY} />);
    expect(state()).toBe('idle');
    view.rerender(<ConnectionIndicator config={cfg} apiKey="FAKE-ANOTHER" />);
    expect(state()).toBe('idle');
  });

  it('回答成功也會開始連線；失敗顯示紅燈與原因', async () => {
    await streamChat({ config: cfg, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: async () => sse() });
    expect(getConnection().phase).toBe('online');
    await expect(
      streamChat({ config: cfg, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: async () => json({}, 401) }),
    ).rejects.toBeInstanceOf(ByokError);
    expect(getConnection().phase).toBe('offline');
    expect(getConnection().message).toContain('金鑰');
  });
});

describe('設定表單', () => {
  it('「儲存並連線」只讀模型清單（不產生回答），成功顯示綠燈與計時', async () => {
    const fetch = vi.fn(async () => models('test', 'gpt-x'));
    vi.stubGlobal('fetch', fetch);
    render(<ByokSettings />);
    expect(state()).toBe('idle');
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(state()).toBe('online'));
    // 連線狀態與表單狀態文字是兩次更新，等文字也更新完（Codex 提問引導 r2 S1：首跑偶發時序失敗）
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已連線'));
    expect(screen.getByRole('timer')).toHaveTextContent(/^\s*\d\d:\d\d/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://api.openai.com/v1/models');
    fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: 'another-model' } });
    expect(state()).toBe('idle');
  });

  it('「只測試，不儲存」成功後再儲存，沿用同一段連線', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => models('test')));
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-test'));
    await waitFor(() => expect(state()).toBe('online'));
    const { expiresAt } = getConnection();
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已儲存。已連線'));
    expect(getConnection().expiresAt).toBe(expiresAt);
  });

  it('連線失敗顯示紅燈與原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-test'));
    await waitFor(() => expect(state()).toBe('offline'));
    expect(screen.getByRole('status')).toHaveTextContent('連線失敗');
  });

  it('等待中改了金鑰，晚到的成功不能點亮綠燈', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-test'));
    fireEvent.change(screen.getByTestId('byok-key'), { target: { value: 'FAKE-CHANGED-KEY' } });
    await act(async () => resolve(models('test')));
    expect(state()).toBe('idle');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('自動偵測本機 AI（macOS／Linux：直接連線）：先顯示結果，不覆蓋已儲存的雲端設定與金鑰；確認後才套用並連線', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36');
    onTestFinished(() => ua.mockRestore());
    const fetch = vi.fn(async (url: string) => (String(url).startsWith('http://localhost:11434/v1/models') ? models('nomic-embed-text', 'llama3.2:3b') : Promise.reject(new TypeError('Failed to fetch'))));
    vi.stubGlobal('fetch', fetch);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-detect'));
    const panel = await screen.findByTestId('byok-detected');
    expect(panel).toHaveTextContent('llama3.2:3b');
    expect(panel).toHaveTextContent('會取代目前已儲存的「OpenAI（雲端）」設定');
    // 還沒確認：原本的雲端設定與金鑰都在
    expect(loadByok().config?.presetId).toBe('openai');
    expect(loadByok().key).toBe(KEY);
    fireEvent.click(screen.getByTestId('byok-detect-apply'));
    await waitFor(() => expect(state()).toBe('online'));
    expect(loadByok().config).toMatchObject({ presetId: 'ollama', model: 'llama3.2:3b' });
    expect(screen.getByRole('status')).toHaveTextContent('已套用 Ollama');
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) expect(JSON.stringify(init?.headers ?? {})).not.toContain(KEY);
  });

  it('偵測結果按「取消」：什麼都不改', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('http://localhost:1234/v1/models') ? models('llama3.2:3b') : Promise.reject(new TypeError('x')))));
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-detect'));
    await screen.findByTestId('byok-detected');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByTestId('byok-detected')).toBeNull();
    expect(loadByok().config?.presetId).toBe('openai');
    expect(state()).toBe('idle');
  });

  it('本機連接埠有程式回應但擋下本站：寫成可能原因，並展開設定步驟（含本站網址與「不會撤回」說明）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.mode === 'no-cors' && String(url).startsWith('http://localhost:11434')) return new Response(null, { status: 200 });
        throw new TypeError('Failed to fetch');
      }),
    );
    saveByok(ollama, '');
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(state()).toBe('offline'));
    expect(screen.getByRole('status')).toHaveTextContent('不允許本站讀取');
    expect(screen.getByRole('status')).toHaveTextContent('最常見的原因');
    const guide = screen.getByTestId('local-setup-guide');
    expect(guide).toHaveAttribute('open');
    expect(guide).toHaveTextContent(window.location.origin);
    // v1.2.x：不再提供永久設定；說明本站計時不會改變電腦設定，且網頁無法替使用者重新授權（Ollama 403 需求）
    expect(screen.getByTestId('local-setup-persistence')).toHaveTextContent('不會');
    expect(screen.getByTestId('local-setup-persistence')).toHaveTextContent('無法替你重新授權');
    expect(guide).not.toHaveTextContent('setx');
  });

  it('雲端服務連線成功時，不宣稱所選模型已可回答', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => models('gpt-x')));
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(state()).toBe('online'));
    expect(screen.getByRole('status')).toHaveTextContent('第一次提問時確認');
  });
});

describe('Codex 複查 30 分鐘連線的回歸測試', () => {
  it('P1：請求進行中（checking）過了截止時間也會到期，晚到的成功不套用', () => {
    vi.useFakeTimers();
    __setConnectionClockForTests(() => clock);
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    const finish = beginConnection(cfg, KEY);
    expect(getConnection().phase).toBe('checking');
    clock += SESSION_MS;
    act(() => vi.advanceTimersByTime(SESSION_MS));
    expect(getConnection().phase).toBe('expired');
    finish({ phase: 'online' });
    expect(getConnection().phase).toBe('expired');
  });

  it('P1：計時器延遲（背景分頁）時以截止時間判斷，提問不會自動開始新的一段', async () => {
    __setConnectionClockForTests(() => clock);
    beginConnection(cfg, KEY)({ phase: 'online' });
    clock += SESSION_MS + 1; // 時間已過，但計時器還沒觸發
    expect(getConnection().phase).toBe('online');
    const fetch = vi.fn(async () => sse());
    await expect(streamChat({ config: cfg, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: fetch })).rejects.toMatchObject({ kind: 'expired' });
    expect(fetch).not.toHaveBeenCalled();
    expect(getConnection().phase).toBe('expired');
    expect(isExpired(cfg, KEY)).toBe(true);
  });

  it('P1：對話框串流中到期，回答被中止並提示重新連線', async () => {
    HTMLElement.prototype.scrollTo = () => {};
    let offset = 0;
    __setConnectionClockForTests(() => Date.now() + offset);
    setChatContext({ kind: 'none' });
    setChatUi({ enabled: true, size: 'normal' });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        // 只送一段就停住，模擬很長的回答
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
            signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    render(
      <MemoryRouter>
        <TutorChat />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是監督式學習？' } });
    fireEvent.click(screen.getByTestId('tutor-chat-send'));
    await waitFor(() => expect(screen.getByTestId('tutor-chat-log')).toHaveTextContent('第一段'));
    offset = SESSION_MS; // 時間到（30 分鐘的計時器還沒觸發）
    await waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('tutor-connection-notice')).toHaveAttribute('data-state', 'expired'));
    expect(screen.getByTestId('tutor-chat-log')).toHaveTextContent('已中止');
    expect(screen.getByTestId('tutor-chat-send')).toBeDisabled();
    expect(screen.getByTestId('tutor-reconnect')).toHaveTextContent('重新連線');
  });

  it('P2：本機服務回傳空清單或不是模型清單，不能亮綠燈', async () => {
    await expect(verifyConnection(ollama, '', async () => models())).rejects.toMatchObject({ diagnosis: { problem: 'no-models' } });
    expect(getConnection().phase).toBe('offline');
    await expect(verifyConnection(ollama, '', async () => json({ ok: true }))).rejects.toBeInstanceOf(ByokError);
    expect(getConnection().phase).toBe('offline');
    await expect(verifyConnection(cfg, KEY, async () => json({ ok: true }))).rejects.toBeInstanceOf(ByokError);
    expect(getConnection().phase).toBe('offline');
  });

  it('P2：金鑰識別碼不會碰撞；同一把金鑰得到同一個代號', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const k = `FAKE-KEY-${i}`;
      const a = credentialId(k);
      expect(credentialId(k)).toBe(a);
      ids.add(a);
    }
    expect(ids.size).toBe(2000);
    expect(credentialId(KEY)).toBe(credentialId(` ${KEY} `));
    expect(credentialId('')).toBe('');
  });

  it('Codex 第二輪建議：已儲存與連線中的金鑰識別碼固定保留，打字產生大量識別碼也不會誤變未連線', () => {
    // 已儲存的金鑰（beforeEach 已存 KEY）連線中
    const view = render(<ConnectionIndicator config={cfg} apiKey={KEY} />);
    act(() => beginConnection(cfg, KEY)({ phase: 'online' }));
    const savedId = credentialId(KEY);
    for (let i = 0; i < 40; i++) credentialId(`FAKE-TYPING-${'x'.repeat(i)}`);
    expect(credentialId(KEY)).toBe(savedId);
    view.rerender(<ConnectionIndicator config={cfg} apiKey={KEY} />);
    expect(state()).toBe('online');
    // 尚未儲存、只測試成功的金鑰（連線中）也保留
    const unsaved = 'FAKE-UNSAVED-KEY';
    act(() => beginConnection(cfg, unsaved)({ phase: 'online' }));
    const unsavedId = credentialId(unsaved);
    for (let i = 0; i < 40; i++) credentialId(`FAKE-MORE-${i}`);
    expect(credentialId(unsaved)).toBe(unsavedId);
    expect(credentialId(KEY)).toBe(savedId);
    view.rerender(<ConnectionIndicator config={cfg} apiKey={unsaved} />);
    expect(state()).toBe('online');
    // 不再固定保留的金鑰照常淘汰（之後拿到新代號，只會是未連線）
    const transient = 'FAKE-TRANSIENT';
    const tId = credentialId(transient);
    for (let i = 0; i < 40; i++) credentialId(`FAKE-LATER-${i}`);
    expect(credentialId(transient)).not.toBe(tId);
  });

  it('偵測：Ollama 沒有模型時繼續找 LM Studio', async () => {
    const f = async (url: string) => {
      if (String(url).startsWith('http://localhost:11434/v1/models')) return models();
      if (String(url).startsWith('http://localhost:1234/v1/models')) return models('qwen2.5-7b-instruct');
      throw new TypeError('x');
    };
    expect((await detectLocal(f as typeof fetch)).found?.presetId).toBe('lmstudio');
    const g = async (url: string) => (String(url).includes('11434/v1/models') ? models() : Promise.reject(new TypeError('x')));
    expect((await detectLocal(g as typeof fetch)).found).toEqual({ presetId: 'ollama', baseUrl: 'http://localhost:11434/v1', models: [] });
  });
});

describe('本機 AI 自動判斷', () => {
  const failAll = async () => {
    throw new TypeError('Failed to fetch');
  };
  it('服務沒開', async () => {
    expect((await diagnoseLocal(ollama, undefined, failAll))?.problem).toBe('not-running');
  });
  it('服務有開但擋下本站（no-cors 成功）', async () => {
    const f = async (_u: string, init?: RequestInit) => (init?.mode === 'no-cors' ? new Response(null) : failAll());
    expect((await diagnoseLocal(ollama, undefined, f as typeof fetch))?.problem).toBe('cors');
  });
  it('模型沒下載：列出服務回報的全部模型（疑似向量模型排後面，不隱藏）', async () => {
    const d = await diagnoseLocal(ollama, 404, async () => models('bge-m3', 'llama3.2:3b'));
    expect(d?.problem).toBe('model-missing');
    expect(d?.installed).toEqual(['llama3.2:3b', 'bge-m3']);
  });
  it('一個模型都沒有', async () => {
    expect((await diagnoseLocal(ollama, 404, async () => models()))?.problem).toBe('no-models');
  });
  it('雲端服務不做本機判斷', async () => {
    expect(await diagnoseLocal(cfg, undefined, failAll)).toBeNull();
  });
  it('「連線」時本機模型不存在：說明可改選的模型', async () => {
    await expect(verifyConnection(ollama, '', async () => models('llama3.2:3b'))).rejects.toMatchObject({ diagnosis: { problem: 'model-missing' } });
    expect(getConnection().phase).toBe('offline');
  });
  it('偵測：Ollama 擋下、LM Studio 可用', async () => {
    const f = async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://localhost:1234/v1/models')) return models('qwen2.5-7b-instruct');
      if (init?.mode === 'no-cors' && String(url).startsWith('http://localhost:11434')) return new Response(null);
      return failAll();
    };
    const r = await detectLocal(f as typeof fetch);
    expect(r.found?.presetId).toBe('lmstudio');
    expect(r.blocked).toEqual(['ollama']);
  });
  it('模型排序不隱藏任何名稱（自訂別名不一定照慣例命名）', () => {
    expect(orderModels(['nomic-embed-text', 'qwen3:8b', 'bge-m3', 'llama3.2', 'my-embedder-chat'])).toEqual(['llama3.2', 'qwen3:8b', 'bge-m3', 'my-embedder-chat', 'nomic-embed-text']);
  });
});

describe('各家服務都適用（不以單一本機環境為準）', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://llm.example-provider.com/v1', model: 'some-model', rememberKey: false };
  const customLocal: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'http://localhost:8080/v1', model: 'local-model', rememberKey: false };
  const openrouter: ByokConfig = { presetId: 'openrouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model', rememberKey: false };
  const ask = (config: ByokConfig, fetchImpl: typeof fetch, onText: (d: string) => void = () => {}) =>
    streamChat({ config, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText, fetchImpl });
  const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

  it('回答長度參數：OpenAI 官方用 max_completion_tokens，其他相容服務用 max_tokens', async () => {
    const seen: Record<string, unknown>[] = [];
    const f = (async (_u: string, init?: RequestInit) => (seen.push(bodyOf(init)), sse())) as unknown as typeof fetch;
    await ask(cfg, f);
    await ask(openrouter, f);
    await ask(customLocal, f);
    expect(seen.map((b) => [b.max_completion_tokens !== undefined, b.max_tokens !== undefined])).toEqual([
      [true, false],
      [false, true],
      [false, true],
    ]);
  });

  it('服務不接受長度參數名稱時，自動改用另一個名稱重送一次', async () => {
    const seen: Record<string, unknown>[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const b = bodyOf(init);
      seen.push(b);
      if (b.max_tokens !== undefined) return json({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }, 400);
      return sse();
    }) as unknown as typeof fetch;
    let text = '';
    await ask(custom, f, (d) => (text += d));
    expect(text).toBe('好');
    expect(seen).toHaveLength(2);
    expect(seen[1].max_completion_tokens).toBeDefined();
  });

  it('其他錯誤不重送，並附上服務自己的說明', async () => {
    const f = vi.fn(async () => json({ error: { message: 'The model `some-model` does not exist' } }, 400));
    const err = await ask(custom, f as unknown as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ByokError);
    expect(f).toHaveBeenCalledTimes(1);
    expect((err as ByokError).message).toContain('服務回覆：The model `some-model` does not exist');
  });

  it('Codex r4 P2：錯誤說明回顯金鑰（完整、拆段或遮一部分）或提到憑證時整段隱藏', async () => {
    const half = Math.floor(KEY.length / 2);
    for (const echoed of [
      `model not found for ${KEY}`,
      `bad request from ${KEY.slice(0, half)}...${KEY.slice(half)}`,
      'Incorrect API key provided: sk-ab************************wxyz',
      'invalid credential for this project',
    ]) {
      const err = (await ask(custom, (async () => json({ error: { message: echoed } }, 400)) as unknown as typeof fetch).catch((e: unknown) => e)) as ByokError;
      expect(err.message).toContain('為了安全不顯示');
      expect(err.message).not.toContain(KEY.slice(0, 6));
      expect(err.message).not.toContain(KEY.slice(half, half + 6));
      expect(err.message).not.toContain('wxyz');
    }
    expect(safeDetail(`x ${KEY.slice(3, 10)} y`, KEY).shown).not.toContain(KEY.slice(3, 10));
  });

  it('Codex r4 P2：非 JSON 錯誤頁（HTML／純文字）只顯示通用說明', async () => {
    for (const body of ['<html><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>', 'upstream connect error or disconnect/reset before headers']) {
      const err = (await ask(custom, (async () => new Response(body, { status: 502 })) as unknown as typeof fetch).catch((e: unknown) => e)) as ByokError;
      expect(err.message).toBe('AI 服務暫時無法回應（HTTP 502），請稍後再試。');
    }
  });

  it('Codex r4 P2：只有明確「不支援參數名稱」才重送；內容太長等其他 400 只送一次', async () => {
    const f = vi.fn(async () => json({ error: { message: 'Input tokens plus max_tokens exceed the context window. Reduce the input.' } }, 400));
    await expect(ask(custom, f as unknown as typeof fetch)).rejects.toBeInstanceOf(ByokError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(rejectsTokenParam("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", 'max_tokens')).toBe(true);
    expect(rejectsTokenParam('Unrecognized request argument supplied: max_completion_tokens', 'max_completion_tokens')).toBe(true);
    expect(rejectsTokenParam('max_tokens is too large: 100000. This model supports at most 4096 completion tokens', 'max_tokens')).toBe(false);
    expect(rejectsTokenParam('max_tokens: invalid value', 'max_tokens')).toBe(false);
    expect(rejectsTokenParam("Unsupported parameter: 'max_tokens'", 'max_completion_tokens')).toBe(false);
  });

  it('重送成功後記住這個位址與模型接受的參數，下次不再試錯', async () => {
    const lb: ByokConfig = { ...custom, baseUrl: 'https://learn.example-provider.com/v1' };
    const seen: Record<string, unknown>[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const b = bodyOf(init);
      seen.push(b);
      if (b.max_tokens !== undefined) return json({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }, 400);
      return sse();
    }) as unknown as typeof fetch;
    await ask(lb, f);
    await ask(lb, f);
    expect(seen).toHaveLength(3);
    expect(seen[2].max_completion_tokens).toBeDefined();
  });

  it('服務忽略串流、直接回傳完整 JSON 時也能取得回答', async () => {
    let text = '';
    const r = await ask(custom, (async () => json({ choices: [{ message: { content: '完整回答' }, finish_reason: 'stop' }] })) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('完整回答');
    expect(r.truncated).toBe(false);
    expect(getConnection().phase).toBe('online');
  });

  it('自訂服務沒有模型清單端點（404／405／501）：顯示無法事先確認、維持未連線，第一次提問成功才開始計時', async () => {
    for (const status of [404, 405, 501]) {
      __resetConnectionForTests();
      const r = await verifyConnection(custom, KEY, async () => new Response('', { status }));
      expect(r.verified).toBe(false);
      expect(getConnection().phase).toBe('idle');
      expect(getConnection().message).toContain('沒有提供模型清單');
    }
    await ask(custom, (async () => sse()) as unknown as typeof fetch);
    expect(getConnection().phase).toBe('online');
    expect(getConnection().expiresAt).toBeDefined();
  });

  it('Codex r4：清單端點能力不看服務選單：同一代理回 405，選 OpenAI 或自訂結果相同（無法事先確認，不亮紅燈）', async () => {
    const proxy = 'https://proxy.example-provider.com/v1';
    for (const presetId of ['openai', 'custom']) {
      __resetConnectionForTests();
      const r = await verifyConnection({ ...custom, presetId, baseUrl: proxy }, KEY, async () => new Response('', { status: 405 }));
      expect(r.verified).toBe(false);
      expect(getConnection().phase).toBe('idle');
    }
    // 其他錯誤（例如金鑰被拒）仍是失敗
    await expect(verifyConnection(cfg, KEY, async () => json({}, 401))).rejects.toBeInstanceOf(ByokError);
    expect(getConnection().phase).toBe('offline');
  });

  it('Codex r4 P2：不依 content-type 判斷格式；SSE 標成 JSON、JSON 標成純文字都能取得回答', async () => {
    const sseBody = 'data: {"choices":[{"delta":{"content":"串流"}}]}\n\ndata: [DONE]\n\n';
    let text = '';
    await ask(custom, (async () => new Response(sseBody, { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('串流');
    text = '';
    await ask(custom, (async () => new Response(JSON.stringify({ choices: [{ message: { content: '完整' } }] }), { headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('完整');
  });

  it('Codex r4 P2：標準的多行 data: SSE 事件可正確合併解析', async () => {
    const body = 'event: message\ndata: {"choices":[{"delta":\ndata: {"content":"多行"}}]}\n\n: 註解\ndata: [DONE]\n\n';
    let text = '';
    await ask(custom, (async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('多行');
  });

  it('Codex r4 P2：沒有任何可顯示內容不算成功、不亮綠燈；HTTP 200 內含錯誤時顯示安全的服務說明', async () => {
    for (const body of ['data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n', '{"ok":true}', '']) {
      __resetConnectionForTests();
      await expect(ask(custom, (async () => new Response(body)) as unknown as typeof fetch)).rejects.toBeInstanceOf(ByokError);
      expect(getConnection().phase).toBe('offline');
    }
    const err = (await ask(custom, (async () => json({ error: { message: 'Model is overloaded' } })) as unknown as typeof fetch).catch((e: unknown) => e)) as ByokError;
    expect(err.message).toContain('服務回覆：Model is overloaded');
    expect(getConnection().phase).toBe('offline');
  });

  it('雲端連線成功不宣稱金鑰有效（有的服務不用金鑰也能讀模型清單）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => models('some/model')));
    saveByok(openrouter, KEY);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(state()).toBe('online'));
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('金鑰與所選模型是否能回答，會在第一次提問時確認');
    expect(text).not.toContain('金鑰有效');
  });

  it('自訂的本機程式（不是 Ollama／LM Studio）也有設定說明與失敗原因判斷', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.mode === 'no-cors' && String(url).startsWith('http://localhost:8080')) return new Response(null);
        throw new TypeError('Failed to fetch');
      }),
    );
    saveByok(customLocal, '');
    render(<ByokSettings />);
    expect(screen.getByTestId('local-setup-guide')).toHaveTextContent('讓本站連到這個本機程式');
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(state()).toBe('offline'));
    expect(screen.getByRole('status')).toHaveTextContent('localhost:8080 有程式回應');
    expect(screen.getByTestId('local-setup-guide')).toHaveAttribute('open');
  });
});

describe('Codex 第五輪邊界缺口的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const ask = (config: ByokConfig, fetchImpl: typeof fetch, onText: (d: string) => void = () => {}) =>
    streamChat({ config, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText, fetchImpl });
  /** 依指定區塊送出的回應；記錄是否被取消 */
  const chunked = (chunks: string[], status = 200, keepOpen = false) => {
    const st = { cancelled: false };
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
        else if (!keepOpen) c.close(); // keepOpen：模擬服務還在傳送、連線仍開著
      },
      cancel() {
        st.cancelled = true;
      },
    });
    return { st, res: new Response(body, { status }) };
  };
  const errOf = async (config: ByokConfig, f: typeof fetch) => (await ask(config, f).catch((e: unknown) => e)) as ByokError;

  it('1：「Invalid token」與每 5 字以空白切開的金鑰回顯都隱藏；驗證失敗（401／403）一律不附服務說明', async () => {
    const pieces = KEY.match(/.{1,5}/g)!.join(' ');
    for (const message of [`Invalid token: ${pieces}`, `request rejected for ${pieces}`, `token=${KEY.toLowerCase()}`]) {
      const err = await errOf(custom, (async () => json({ error: { message } }, 400)) as unknown as typeof fetch);
      expect(err.message).toContain('為了安全不顯示');
      expect(err.message).not.toContain(pieces);
    }
    const auth = await errOf(custom, (async () => json({ error: { message: 'Your organization is not allowed' } }, 403)) as unknown as typeof fetch);
    expect(auth.message).toBe('API 金鑰無效或沒有權限，請到設定檢查金鑰。');
    // 一般的長度說明仍會顯示
    for (const message of ['Input tokens plus max_tokens exceed the context window. Reduce the input.', 'This model maximum context length is 8192 tokens']) {
      const err = await errOf(custom, (async () => json({ error: { message } }, 400)) as unknown as typeof fetch);
      expect(err.message).toContain(`服務回覆：${message}`);
    }
  });

  it('2：參數「值」錯誤不重送；明確的未知欄位才重送', async () => {
    const f = vi.fn(async () => json({ error: { message: "Invalid parameter 'max_tokens': must be a positive integer" } }, 400));
    await expect(ask(custom, f as unknown as typeof fetch)).rejects.toBeInstanceOf(ByokError);
    expect(f).toHaveBeenCalledTimes(1);
    for (const raw of ["Invalid parameter 'max_tokens': must be a positive integer", 'max_tokens must be less than or equal to 4096', "Unsupported value: 'max_tokens' does not support 0"])
      expect(rejectsTokenParam(raw, 'max_tokens')).toBe(false);
    for (const raw of [
      "[{'type': 'extra_forbidden', 'loc': ('body', 'max_completion_tokens'), 'msg': 'Extra inputs are not permitted'}]",
      'Unknown parameter: max_completion_tokens',
      "Unsupported parameter: 'max_tokens' is not supported with this model.",
    ])
      expect(rejectsTokenParam(raw, raw.includes('completion') ? 'max_completion_tokens' : 'max_tokens')).toBe(true);
  });

  it('3a：\r 與 \n 被切在不同區塊時，仍當成一個換行（多行 data 不被拆壞）', async () => {
    const { res } = chunked(['data: {"choices":[{"delta":\r', '\ndata: {"content":"跨區塊"}}]}\r', '\n\r', '\ndata: [DONE]\r\n\r\n']);
    let text = '';
    await ask(custom, (async () => res) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('跨區塊');
  });

  it('3b：回應總量超過上限（單一區塊也算）會拒絕、取消讀取、不亮綠燈', async () => {
    const big = JSON.stringify({ choices: [{ message: { content: 'x'.repeat(2_000_100) } }] });
    const { st, res } = chunked([big], 200, true);
    const err = await errOf(custom, (async () => res) as unknown as typeof fetch);
    expect(err.message).toContain('回應過大');
    expect(st.cancelled).toBe(true);
    expect(getConnection().phase).toBe('offline');
  });

  it('3c：串流中收到 error 事件時取消仍開啟的回應', async () => {
    const { st, res } = chunked(['data: {"choices":[{"delta":{"content":"一半"}}]}\n\n', 'data: {"error":{"message":"Model is overloaded"}}\n\n', 'data: {"choices":[{"delta":{"content":"不該出現"}}]}\n\n']);
    let text = '';
    const err = (await ask(custom, (async () => res) as unknown as typeof fetch, (d) => (text += d)).catch((e: unknown) => e)) as ByokError;
    expect(err.message).toContain('服務回覆：Model is overloaded');
    expect(text).toBe('一半');
    expect(st.cancelled).toBe(true);
  });

  it('3d：每行一個 JSON 的回應遇到 [DONE] 就停止', async () => {
    const body = '{"choices":[{"delta":{"content":"A"}}]}\n[DONE]\n{"choices":[{"delta":{"content":"B"}}]}\n';
    let text = '';
    await ask(custom, (async () => new Response(body)) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('A');
  });

  it('第五點：已知本機服務拿不到模型清單時提示可能漏填 /v1；雲端自訂服務不提示、也不自動補', async () => {
    const r = await verifyConnection({ ...ollama, baseUrl: 'http://localhost:11434' }, '', async () => new Response('', { status: 404 }));
    expect(r.verified).toBe(false);
    expect(getConnection().message).toContain('可能漏填 /v1（預設是 http://localhost:11434/v1）');
    __resetConnectionForTests();
    const seen: string[] = [];
    const c = await verifyConnection({ ...custom, baseUrl: 'https://edge.example-provider.com/api' }, KEY, async (u) => (seen.push(String(u)), new Response('', { status: 404 })));
    expect(c.hint).toBe('');
    expect(seen).toEqual(['https://edge.example-provider.com/api/models']);
  });
});

describe('Codex 第六輪（docs/AUDIT_2026-11-20_connection-30min_r6.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const ask = (config: ByokConfig, fetchImpl: typeof fetch, onText: (d: string) => void = () => {}) =>
    streamChat({ config, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText, fetchImpl });

  it('R6-1：一則錯誤同時有其他欄位未知與長度值不合法時，不重送', async () => {
    const raw = 'Unknown parameter: stream, max_tokens must be a positive integer';
    expect(rejectsTokenParam(raw, 'max_tokens')).toBe(false);
    expect(rejectsTokenParam('Unknown parameter: stream. max_tokens is fine', 'max_tokens')).toBe(false);
    const f = vi.fn(async () => json({ error: { message: raw } }, 400));
    await expect(ask(custom, f as unknown as typeof fetch)).rejects.toBeInstanceOf(ByokError);
    expect(f).toHaveBeenCalledTimes(1);
    // 合法的重送情況維持不變
    expect(rejectsTokenParam("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", 'max_tokens')).toBe(true);
    expect(rejectsTokenParam("[{'type': 'extra_forbidden', 'loc': ('body', 'max_completion_tokens'), 'msg': 'Extra inputs are not permitted'}]", 'max_completion_tokens')).toBe(true);
    expect(rejectsTokenParam('Unknown parameter: stream, unknown parameter: max_tokens', 'max_tokens')).toBe(true);
  });

  it('R6-2：每行一個 JSON，收到 [DONE] 立即結束並取消仍開著的連線', async () => {
    const st = { cancelled: false };
    const enc = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(enc.encode('{"choices":[{"delta":{"content":"回答"}}]}\n[DONE]\n'));
        } // 之後不關閉：模擬服務沒有結束連線
      },
      cancel() {
        st.cancelled = true;
      },
    });
    let text = '';
    const r = await Promise.race([
      ask(custom, (async () => new Response(body)) as unknown as typeof fetch, (d) => (text += d)),
      new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 1000)),
    ]);
    expect(r).not.toBe('timeout');
    expect(text).toBe('回答');
    expect(st.cancelled).toBe(true);
  });

  it('R6-2：多行排版的單一完整 JSON 仍在讀完後正確解析', async () => {
    const pretty = JSON.stringify({ choices: [{ message: { content: '完整回答' } }] }, null, 2);
    let text = '';
    await ask(custom, (async () => new Response(pretty)) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('完整回答');
  });
});

describe('Codex 第七輪（docs/AUDIT_2026-11-20_connection-30min_r7.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const ask = (config: ByokConfig, fetchImpl: typeof fetch, onText: (d: string) => void = () => {}) =>
    streamChat({ config, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText, fetchImpl });

  it('R7-1：否定詞修飾的是其他欄位、或目前參數只出現在 input 值中，不重送', async () => {
    for (const raw of [
      'Unknown parameter: stream but max_tokens is valid',
      'Unknown parameter: stream (max_tokens is supported)',
      "{'type':'extra_forbidden','loc':['body','stream'],'input':'max_tokens'}",
    ])
      expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    const f = vi.fn(async () => json({ error: { message: 'Unknown parameter: stream but max_tokens is valid' } }, 400));
    await expect(ask(custom, f as unknown as typeof fetch)).rejects.toBeInstanceOf(ByokError);
    expect(f).toHaveBeenCalledTimes(1);
    // 直接修飾目前參數的寫法仍重送
    for (const raw of [
      'Unsupported parameter, max_tokens',
      "The 'max_tokens' parameter is not supported for this model",
      '{"error":{"type":"invalid_request_error","param":"max_tokens","message":"Unsupported parameter"}}',
      "{'type':'extra_forbidden','loc':['body','max_tokens'],'input':100}",
    ])
      expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(true);
  });

  for (const [name, lead] of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['多個空白行', '\n  \n\t\r\n'],
  ] as const)
    it(`R7-2：逐行 JSON 前有空白行（${name}），收到 [DONE] 仍立即結束並取消連線`, async () => {
      const st = { cancelled: false };
      const enc = new TextEncoder();
      const parts = [lead, '{"choices":[{"delta":{"content":"回答"}}]}\n', '[DONE]\n'];
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (i < parts.length) c.enqueue(enc.encode(parts[i++])); // 之後不關閉
        },
        cancel() {
          st.cancelled = true;
        },
      });
      let text = '';
      const r = await Promise.race([
        ask(custom, (async () => new Response(body)) as unknown as typeof fetch, (d) => (text += d)),
        new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 1000)),
      ]);
      expect(r).not.toBe('timeout');
      expect(text).toBe('回答');
      expect(st.cancelled).toBe(true);
    });

  it('R7-2：前導空白行加多行排版的單一 JSON，仍在讀完後正確解析', async () => {
    const pretty = '\n\n' + JSON.stringify({ choices: [{ message: { content: '完整回答' } }] }, null, 2);
    let text = '';
    await ask(custom, (async () => new Response(pretty)) as unknown as typeof fetch, (d) => (text += d));
    expect(text).toBe('完整回答');
  });
});

describe('Codex 第八輪（docs/AUDIT_2026-11-20_connection-30min_r8.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const ask = (config: ByokConfig, fetchImpl: typeof fetch) => streamChat({ config, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl });
  const callsFor = async (message: string) => {
    const f = vi.fn(async () => json({ error: { message } }, 400));
    await ask(custom, f as unknown as typeof fetch).catch(() => {});
    return f.mock.calls.length;
  };

  it('R8-1：結構化的值錯誤，即使 input 寫著 unknown field／unsupported，也不重送', async () => {
    const cases = [
      '{"type":"int_parsing","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":"unknown field"}',
      '{"type":"greater_than","loc":["body","max_tokens"],"msg":"Input should be greater than 0","input":"unsupported parameter"}',
      "{'type':'int_type','loc':('body','max_tokens'),'msg':'Input should be a valid integer','input':'extra_forbidden'}",
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    expect(await callsFor(cases[0])).toBe(1);
  });

  it('R8-2：「改用另一個名稱」限定其他模型／端點／版本或附條件時，不套用到目前請求', async () => {
    const cases = [
      'max_tokens: invalid value; use max_completion_tokens instead for other models',
      'Use max_completion_tokens instead on newer endpoints',
      'If you are using reasoning models, use max_completion_tokens instead',
      'max_tokens must be at most 4096. Use max_completion_tokens instead for other API versions',
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    expect(await callsFor(cases[0])).toBe(1);
  });

  it('針對目前請求的明確替代與名稱不被接受，仍重送一次', async () => {
    const cases = [
      'Unsupported parameter: max_tokens. Use max_completion_tokens instead.',
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      'Use max_completion_tokens instead.',
      '{"error":{"type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter","message":"Unsupported parameter"}}',
      "[{'type': 'extra_forbidden', 'loc': ('body', 'max_tokens'), 'msg': 'Extra inputs are not permitted'}]",
      '{"error":{"message":"Unknown parameter: max_tokens"}}',
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(true);
    expect(await callsFor(cases[0])).toBe(2);
  });
});

describe('Codex 第九輪（docs/AUDIT_2026-11-20_connection-30min_r9.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const callsFor = async (message: string) => {
    const f = vi.fn(async () => json({ error: { message } }, 400));
    await streamChat({ config: custom, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: f as unknown as typeof fetch }).catch(() => {});
    return f.mock.calls.length;
  };

  it('R9-1：被拒資料（input）裡的物件不被當成錯誤紀錄', async () => {
    const cases = [
      '{"type":"int_type","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":{"type":"extra_forbidden","loc":["body","max_tokens"]}}',
      '{"detail":[{"type":"int_type","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":{"type":"unknown field","param":"max_tokens"}}]}',
      '{"type":"int_type","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":"{\\"type\\":\\"extra_forbidden\\"}"}',
      "{'type': 'int_type', 'loc': ('body', 'max_tokens'), 'msg': 'Input should be a valid integer', 'input': {'type': 'extra_forbidden'}}",
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    expect(await callsFor(cases[0])).toBe(1);
  });

  it('R9-2：冠詞、跨句條件、換端點／模型的說法都視為限定範圍，不重送', async () => {
    const cases = [
      'Use max_completion_tokens instead for a different model.',
      'If you switch to a newer endpoint. Use max_completion_tokens instead.',
      'Use max_completion_tokens instead for the other API versions.',
      'When migrating to reasoning models; use max_completion_tokens instead.',
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    expect(await callsFor(cases[1])).toBe(1);
  });

  it('目前請求的合法替代與名稱不被接受仍重送（含 with this model、pydantic、巢狀 error 容器）', () => {
    for (const raw of [
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      'Use max_completion_tokens instead.',
      '{"error":{"type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter","message":"Unsupported parameter"}}',
      "[{'type': 'extra_forbidden', 'loc': ('body', 'max_tokens'), 'msg': 'Extra inputs are not permitted'}]",
      '{"detail":[{"type":"extra_forbidden","loc":["body","max_tokens"],"msg":"Extra inputs are not permitted","input":100}]}',
    ])
      expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(true);
  });
});

describe('Codex 第十輪（docs/AUDIT_2026-11-20_connection-30min_r10.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  const callsFor = async (message: string) => {
    const f = vi.fn(async () => json({ error: { message } }, 400));
    await streamChat({ config: custom, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: f as unknown as typeof fetch }).catch(() => {});
    return f.mock.calls.length;
  };

  it('R10-1：「只有其他模型／端點或某條件下不支援」不套用到目前請求，連名稱不被接受的判斷也不重送', async () => {
    const cases = [
      'For a different model, max_tokens is not supported. Use max_completion_tokens instead.',
      'If you switch to a newer endpoint, max_tokens is not supported. Use max_completion_tokens instead.',
      'Unknown parameter: max_tokens when using legacy deployments',
      '{"error":{"param":"max_tokens","code":"unsupported_parameter","message":"For other models, max_tokens is not supported"}}',
    ];
    for (const raw of cases) expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(false);
    expect(await callsFor(cases[0])).toBe(1);
    expect(await callsFor(cases[1])).toBe(1);
  });

  it('沒有範圍限定的目前請求仍重送一次', async () => {
    for (const raw of [
      'Unsupported parameter: max_tokens with this model. Use max_completion_tokens instead.',
      'max_tokens is not supported. Use max_completion_tokens instead.',
      '{"error":{"type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter","message":"Unsupported parameter"}}',
    ])
      expect(rejectsTokenParam(raw, 'max_tokens'), raw).toBe(true);
    expect(await callsFor('max_tokens is not supported. Use max_completion_tokens instead.')).toBe(2);
  });
});

describe('Codex 第十一輪（docs/AUDIT_2026-11-20_connection-30min_r11.md）的回歸測試', () => {
  const custom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'https://edge.example-provider.com/v1', model: 'm', rememberKey: false };
  it('R11-1：子層 detail 繼承父層的範圍限定，不重送；input 裡的限定字句不影響合法錯誤', async () => {
    const scoped = JSON.stringify({ message: 'The following applies only for other models.', detail: [{ param: 'max_tokens', code: 'unsupported_parameter' }] });
    expect(rejectsTokenParam(scoped, 'max_tokens')).toBe(false);
    const nested = JSON.stringify({ error: { message: 'When using legacy deployments:', errors: [{ param: 'max_tokens', code: 'unsupported_parameter' }] } });
    expect(rejectsTokenParam(nested, 'max_tokens')).toBe(false);
    const f = vi.fn(async () => json({ error: { message: scoped } }, 400));
    await streamChat({ config: custom, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: f as unknown as typeof fetch }).catch(() => {});
    expect(f).toHaveBeenCalledTimes(1);
    // 被拒資料（input）裡的限定字句不會傳給子層：合法的名稱錯誤仍重送
    const legit = JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'max_tokens'], msg: 'Extra inputs are not permitted', input: 'only for other models' }] });
    expect(rejectsTokenParam(legit, 'max_tokens')).toBe(true);
    expect(rejectsTokenParam(JSON.stringify({ message: 'Request failed', detail: [{ param: 'max_tokens', code: 'unsupported_parameter' }] }), 'max_tokens')).toBe(true);
  });
});
