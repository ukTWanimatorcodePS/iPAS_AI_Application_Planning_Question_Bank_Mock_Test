/**
 * Codex v1.1.0 複查（docs/AUDIT_v1.1.0.md）F1～F6 的回歸測試。
 * 重現方式沿用 Codex 的探測（docs/audit-v110.probe.test.tsx），預期結果改為修正後的行為。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ relevance: () => Promise.resolve(10), calls: [] as { url: string; init?: RequestInit }[] }));
vi.mock('../../src/app/AppContext', () => ({ useApp: () => ({ level: 'junior', settings: {} }) }));
vi.mock('../../src/ai/byok/retrieval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ai/byok/retrieval')>()),
  questionRelevance: () => probe.relevance(),
}));

import { setChatUi } from '../../src/ai/byok/chatUi';
import { streamChat } from '../../src/ai/byok/client';
import { clearByok, saveByok } from '../../src/ai/byok/config';
import { prepareTurn, setChatContext } from '../../src/ai/byok/context';
import { ByokSettings } from '../../src/components/ByokSettings';
import { TutorChat } from '../../src/components/TutorChat';
import { getQuestion } from '../../src/content';
import { PrepDB, __setDb, db, ensureInitialized } from '../../src/data/db';
import { createSession, nextOptionOrder } from '../../src/data/repo';

const QID = 'original-L11101-0001';
const KEY = 'FAKE-AUDIT-KEY';
const cfg = { presetId: 'openai', kind: 'openai-compatible' as const, baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false };
const correctPos = (order: string[]) => order.findIndex((id) => getQuestion(QID)!.correctOptionIds.includes(id as never));

let n = 0;
beforeEach(async () => {
  HTMLElement.prototype.scrollTo = () => {};
  __setDb(new PrepDB(`audit-v110-fix-${++n}`));
  await ensureInitialized();
  clearByok();
  probe.calls = [];
  probe.relevance = () => Promise.resolve(10);
  window.location.hash = '#/';
  saveByok(cfg, KEY);
  setChatContext({ kind: 'none' });
  setChatUi({ enabled: true, size: 'normal' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      probe.calls.push({ url, init });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('F1 金鑰只送往確認過的原服務', () => {
  it('未勾選信任的自訂網址：取得模型清單不發出請求', async () => {
    render(<ByokSettings />);
    fireEvent.change(screen.getByRole('textbox', { name: 'API 位址' }), { target: { value: 'https://untrusted.example/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await screen.findByText(/這不是已知的 AI 服務網址/, { selector: '[role=status]' });
    expect(probe.calls).toHaveLength(0);
  });

  it('改選本機服務後取得模型清單，不帶原服務的金鑰', async () => {
    render(<ByokSettings />);
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'ollama' } });
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    const headers = (probe.calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(JSON.stringify(headers)).not.toContain(KEY);
  });
});

describe('F2 等待期間關閉或鎖定，就不送出', () => {
  for (const action of ['lock', 'disable'] as const)
    it(`檢索期間${action === 'lock' ? '進入考試鎖定' : '關閉導師'}：不發出請求`, async () => {
      let release!: (n: number) => void;
      probe.relevance = () => new Promise((r) => (release = r));
      render(
        <MemoryRouter>
          <TutorChat />
        </MemoryRouter>,
      );
      fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是監督式學習？' } });
      fireEvent.click(screen.getByTestId('tutor-chat-send'));
      await act(async () => {
        if (action === 'lock') setChatContext({ kind: 'locked', reason: 'exam' });
        else setChatUi({ enabled: false });
      });
      await act(async () => release(10));
      await new Promise((r) => setTimeout(r, 50));
      expect(probe.calls).toHaveLength(0);
    });

  it('prepareTurn 拒絕鎖定情境', async () => {
    await expect(prepareTurn({ kind: 'locked', reason: 'exam' }, '問題', 'junior')).rejects.toThrow();
  });
});

describe('F3 Anthropic SDK 請求也不帶 Cookie 與來源網址', () => {
  it('實際 RequestInit 帶 credentials: omit、referrerPolicy: no-referrer', async () => {
    const captured: RequestInit[] = [];
    await streamChat({
      config: { ...cfg, kind: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
      apiKey: KEY,
      system: 'test',
      messages: [{ role: 'user', content: 'test' }],
      onText: () => {},
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        captured.push(init ?? {});
        return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch,
    }).catch(() => {});
    expect(captured.length).toBeGreaterThan(0);
    for (const init of captured) {
      expect(init.credentials).toBe('omit');
      expect(init.referrerPolicy).toBe('no-referrer');
    }
  });
});

describe('F4 開始時間不受歷史紀錄影響', () => {
  it('既有測驗的開始時間在未來，新模考仍以現在時間開始', async () => {
    const input = { level: 'junior' as const, mode: 'mock' as const, subject: null, scopeLabel: 't', competencyCodes: ['L11101'], questionIds: [QID], timeLimitSec: 60 };
    const id = await createSession(input);
    await db.quizSessions.update(id, { startAt: '2030-01-01T00:00:00.000Z' });
    const before = Date.now();
    const id2 = await createSession(input);
    const start = Date.parse((await db.quizSessions.get(id2))!.startAt);
    expect(start).toBeGreaterThanOrEqual(before - 5);
    expect(start).toBeLessThanOrEqual(Date.now() + 5);
  });
});

describe('F6 正確答案位置一定和上一次不同', () => {
  it('同時建立兩份測驗（固定時間與亂數）：兩份的正解位置不同', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1795130000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const input = { level: 'junior' as const, mode: 'practice' as const, subject: null, scopeLabel: 't', competencyCodes: ['L11101'], questionIds: [QID] };
    const ids = await Promise.all([createSession(input), createSession(input)]);
    const [a, b] = await db.quizSessions.bulkGet(ids);
    expect(correctPos(a!.optionOrders![QID])).not.toBe(correctPos(b!.optionOrders![QID]));
  });

  it('AI 導師補強題與正式出題共用上一次順序', async () => {
    const id = await createSession({ level: 'junior', mode: 'practice', subject: null, scopeLabel: 't', competencyCodes: ['L11101'], questionIds: [QID] });
    const first = (await db.quizSessions.get(id))!.optionOrders![QID];
    const tutor = (await nextOptionOrder(QID))!;
    expect(correctPos(tutor)).not.toBe(correctPos(first));
    const id2 = await createSession({ level: 'junior', mode: 'practice', subject: null, scopeLabel: 't', competencyCodes: ['L11101'], questionIds: [QID] });
    expect(correctPos((await db.quizSessions.get(id2))!.optionOrders![QID])).not.toBe(correctPos(tutor));
  });
});
