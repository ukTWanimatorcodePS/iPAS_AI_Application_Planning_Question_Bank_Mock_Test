/**
 * AI 導師提問受阻的說明與引導（docs/CLAUDE_REQUEST_AI_TUTOR_QUESTION_GUIDANCE_2026-11-20.md）。
 * 本機判斷：原因分類、文案、課綱名詞辨識、延續追問；介面：修改問題與引導按鈕只填草稿、不呼叫 AI。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/app/AppContext', () => ({ useApp: () => ({ level: 'junior', settings: {} }) }));

import { setChatUi } from '../../src/ai/byok/chatUi';
import { BLOCK_REPLY, topicVerdict } from '../../src/ai/byok/check';
import { clearByok, saveByok } from '../../src/ai/byok/config';
import { setChatContext } from '../../src/ai/byok/context';
import { conceptHits, questionRelevance } from '../../src/ai/byok/retrieval';
import { TutorChat } from '../../src/components/TutorChat';

const verdict = async (t: string, page = true, continuing = false) =>
  topicVerdict(t, await questionRelevance('junior', t), page, { concepts: await conceptHits(t), continuing });

describe('本機判斷：原因分類與文案', () => {
  it('各原因有各自的文案；都說明未送出、不產生用量；不教人加關鍵字', () => {
    for (const reply of Object.values(BLOCK_REPLY)) {
      expect(reply).toContain('尚未送給 AI');
      expect(reply).not.toMatch(/關鍵字|加上「?AI|加入「?AI|不相關/);
    }
    expect(BLOCK_REPLY.unclear_topic).toContain('還不確定你想問哪個學習觀念');
    expect(BLOCK_REPLY.unclear_topic).toContain('可能判斷錯誤');
    expect(BLOCK_REPLY.greeting).toContain('你好');
  });

  it('問候、明顯生活請求、無法確認主題分別歸類', async () => {
    expect(await verdict('你好')).toMatchObject({ ok: false, reason: 'greeting' });
    for (const t of ['推薦今晚看什麼電影', '今天天氣如何', '幫我寫一封請假信']) expect(await verdict(t), t).toMatchObject({ ok: false, reason: 'possible_off_topic' });
    expect(await verdict('為什麼天空是藍色')).toMatchObject({ ok: false, reason: 'unclear_topic' });
  });

  it('課綱名詞由講義自動擷取：專業提問即使含生活詞也可送出；同樣生活詞的閒聊仍擋下', async () => {
    expect(await conceptHits('協同過濾如何推薦電影？')).toContain('協同過濾');
    expect(await conceptHits('推薦今晚看什麼電影')).toEqual([]);
    expect((await verdict('協同過濾如何推薦電影？')).ok).toBe(true);
    expect((await verdict('推薦系統怎麼決定要推薦哪部電影', false)).ok).toBe(true);
    expect((await verdict('推薦今晚看什麼電影')).ok).toBe(false);
  });

  it('延續追問：只有呼叫端表示同一情境剛送出學習提問時放行；閒聊不因延續而放行', async () => {
    // 「可以再簡單一點嗎？」本身與講義相關度足夠，不論是否延續都會送出；以下兩句缺乏獨立主題線索，只靠延續放行
    expect((await verdict('可以再白話一點嗎？', true, false)).ok).toBe(false);
    expect((await verdict('可以再白話一點嗎？', true, true)).ok).toBe(true);
    expect((await verdict('可以舉例嗎', true, false)).ok).toBe(false);
    expect((await verdict('可以舉例嗎', true, true)).ok).toBe(true);
    expect((await verdict('那推薦一部電影吧', true, true)).ok).toBe(false);
    expect((await verdict('你好', true, true)).ok).toBe(false);
  });
});

describe('介面：被擋的提問、修改問題與引導按鈕', () => {
  const calls: unknown[] = [];
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = () => {};
    clearByok();
    calls.length = 0;
    window.location.hash = '#/courses/L11301';
    saveByok({ presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false }, 'FAKE-KEY');
    setChatContext({ kind: 'lesson', code: 'L11301', path: '/courses/L11301' });
    setChatUi({ enabled: true, size: 'normal' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('data: {"choices":[{"delta":{"content":"好的 [S1]"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderChat = () =>
    render(
      <MemoryRouter initialEntries={['/courses/L11301']}>
        <TutorChat />
      </MemoryRouter>,
    );
  const ask = async (text: string) => {
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tutor-chat-send'));
    });
  };

  it('被擋的提問：顯示原因與引導；修改問題、引導按鈕只填入輸入框，不呼叫 AI', async () => {
    renderChat();
    await ask('推薦今晚看什麼電影');
    const guide = await screen.findByTestId('tutor-blocked-guide');
    expect(guide.getAttribute('data-reason')).toBe('possible_off_topic');
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByTestId('tutor-edit-question'));
    expect((screen.getByTestId('tutor-chat-input') as HTMLTextAreaElement).value).toBe('推薦今晚看什麼電影');
    fireEvent.click(screen.getByRole('button', { name: /核心觀念/ }));
    expect((screen.getByTestId('tutor-chat-input') as HTMLTextAreaElement).value).toContain('機器學習基本原理');
    expect(calls).toHaveLength(0);
    // 引導按鈕可用鍵盤操作（是原生 button）
    expect(screen.getByTestId('tutor-edit-question').tagName).toBe('BUTTON');
  });

  it('確認送出才呼叫；同一講義可延續追問；換講義或清除對話後不延續', async () => {
    renderChat();
    await ask('什麼是過擬合？');
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('tutor-chat-send')).toBeTruthy());
    await ask('可以再白話一點嗎？');
    await waitFor(() => expect(calls).toHaveLength(2));
    // 換到另一份講義：不延續
    await act(async () => setChatContext({ kind: 'lesson', code: 'L11101', path: '/courses/L11301' }));
    await ask('可以再白話一點嗎？');
    await screen.findAllByTestId('tutor-blocked-guide');
    expect(calls).toHaveLength(2);
    // 回到原講義、但清除對話後也不延續
    await act(async () => setChatContext({ kind: 'lesson', code: 'L11301', path: '/courses/L11301' }));
    fireEvent.click(screen.getByRole('button', { name: /清除對話/ }));
    await ask('可以舉例嗎');
    await screen.findAllByTestId('tutor-blocked-guide');
    expect(calls).toHaveLength(2);
  });
});

describe('Codex 提問引導複查（docs/AUDIT_2026-11-20_question-guidance.md）的回歸測試', () => {
  it('G1：案例段落的角色或產業粗體（出版社、行銷部）不算課綱名詞，生活請求仍擋下；術語表與觀念小標題仍可用', async () => {
    expect(await conceptHits('推薦旅遊書的出版社')).toEqual([]);
    expect(await conceptHits('行銷部今晚聚餐餐廳推薦')).toEqual([]);
    expect(await verdict('推薦旅遊書的出版社')).toMatchObject({ ok: false });
    expect(await verdict('行銷部今晚聚餐餐廳推薦')).toMatchObject({ ok: false, reason: 'possible_off_topic' });
    expect(await conceptHits('協同過濾如何推薦電影？')).toContain('協同過濾'); // 名詞與定義
    expect(await conceptHits('推薦系統怎麼決定要推薦哪部電影')).toContain('推薦系統'); // 原理及運作流程的小標題
    expect((await verdict('推薦系統怎麼決定要推薦哪部電影', false)).ok).toBe(true);
    // 英文術語以整詞比對
    expect(await conceptHits('the overfittingx thing')).not.toContain('Overfitting');
  });
});

describe('G2：離開情境後延續追問資格失效，回到原情境也不恢復', () => {
  const calls: unknown[] = [];
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = () => {};
    clearByok();
    calls.length = 0;
    saveByok({ presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false }, 'FAKE-KEY');
    setChatContext({ kind: 'lesson', code: 'L11301', path: '/courses/L11301' });
    setChatUi({ enabled: true, size: 'normal' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('data: {"choices":[{"delta":{"content":"好的 [S1]"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const ask = async (text: string) => {
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tutor-chat-send'));
    });
  };
  const L11301 = { kind: 'lesson' as const, code: 'L11301', path: '/courses/L11301' };

  for (const [name, away] of [
    ['A→B→A（換講義再回來，不清除）', { kind: 'lesson' as const, code: 'L11101', path: '/courses/L11301' }],
    ['講義→沒有情境→講義', { kind: 'none' as const, path: '/courses/L11301' }],
  ] as const)
    it(name, async () => {
      render(
        <MemoryRouter initialEntries={['/courses/L11301']}>
          <TutorChat />
        </MemoryRouter>,
      );
      await ask('什麼是過擬合？');
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => setChatContext(away));
      await act(async () => setChatContext(L11301));
      await ask('可以再白話一點嗎？');
      await screen.findAllByTestId('tutor-blocked-guide');
      expect(calls).toHaveLength(1);
    });
});

describe('G2-R2：請求等待中 A→B→A，舊請求不可寫回延續資格', () => {
  const calls: unknown[] = [];
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = () => {};
    clearByok();
    calls.length = 0;
    saveByok({ presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false }, 'FAKE-KEY');
    setChatContext({ kind: 'lesson', code: 'L11301', path: '/courses/L11301' });
    setChatUi({ enabled: true, size: 'normal' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('data: {"choices":[{"delta":{"content":"好的 [S1]"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('送出後、檢索完成前切到別的講義再切回來：之後的短追問不延續', async () => {
    render(
      <MemoryRouter initialEntries={['/courses/L11301']}>
        <TutorChat />
      </MemoryRouter>,
    );
    const A = { kind: 'lesson' as const, code: 'L11301', path: '/courses/L11301' };
    const B = { kind: 'lesson' as const, code: 'L11101', path: '/courses/L11301' };
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '什麼是過擬合？' } });
    fireEvent.click(screen.getByTestId('tutor-chat-send')); // 送出流程在本機檢索處等待
    act(() => setChatContext(B));
    act(() => setChatContext(A));
    await waitFor(() => expect(calls).toHaveLength(1)); // 回到 A 後原請求照常完成
    await waitFor(() => expect((screen.getByTestId('tutor-chat-send') as HTMLButtonElement).disabled).toBe(true));
    fireEvent.change(screen.getByTestId('tutor-chat-input'), { target: { value: '可以再白話一點嗎？' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tutor-chat-send'));
    });
    await screen.findAllByTestId('tutor-blocked-guide');
    expect(calls).toHaveLength(1);
  });
});
