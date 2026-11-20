import { beforeEach, describe, expect, it } from 'vitest';
import { ByokError, MAX_HISTORY, MAX_OUTPUT_TOKENS, OLD_REPLY_CHARS, sseData, streamChat, trimHistory, type ChatTurn } from '../../src/ai/byok/client';
import { CONFIG_KEY, KEY_STORAGE_KEY, checkEndpoint, clearByok, isConfigured, loadConfig, loadKey, maskKey, saveByok, type ByokConfig } from '../../src/ai/byok/config';
import { BASE_RULES, prepareTurn } from '../../src/ai/byok/context';
import { gramsOf, retrieveSources } from '../../src/ai/byok/retrieval';
import { allQuestions } from '../../src/content';
import { exportBackup } from '../../src/data/backup';
import { PrepDB, __setDb, ensureInitialized } from '../../src/data/db';
import { clearAllData } from '../../src/data/repo';

const SECRET = 'sk-test-THIS-IS-A-FAKE-KEY-1234';
const openai: ByokConfig = { presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test-model', rememberKey: false };
const claude: ByokConfig = { presetId: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', rememberKey: false };

let n = 0;
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearByok();
  __setDb(new PrepDB(`byok-${++n}`));
  await ensureInitialized();
});

function sse(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      // 故意把一行切成兩段送出，確認解析器能處理跨區塊的資料
      for (const l of lines) {
        const s = `${l}\n\n`;
        c.enqueue(enc.encode(s.slice(0, 5)));
        c.enqueue(enc.encode(s.slice(5)));
      }
      c.close();
    },
  });
}

describe('API 位址檢查（保護金鑰）', () => {
  it('允許 https 與本機 http；拒絕其他 http、內含帳密、查詢字串的網址', () => {
    expect(checkEndpoint('https://api.openai.com/v1').ok).toBe(true);
    const local = checkEndpoint('http://localhost:11434/v1');
    expect(local.ok && local.local).toBe(true);
    expect(checkEndpoint('http://127.0.0.1:1234/v1').ok).toBe(true);
    expect(checkEndpoint('http://api.example.com/v1').ok).toBe(false);
    expect(checkEndpoint('https://user:pass@api.example.com/v1').ok).toBe(false);
    expect(checkEndpoint('https://api.example.com/v1?key=abc').ok).toBe(false);
    expect(checkEndpoint('javascript:alert(1)').ok).toBe(false);
    expect(checkEndpoint('不是網址').ok).toBe(false);
  });

  it('標示已知服務；自訂網址需要使用者另外確認', () => {
    const known = checkEndpoint('https://api.anthropic.com');
    const unknown = checkEndpoint('https://llm.example.com/v1');
    expect(known.ok && known.known).toBe(true);
    expect(unknown.ok && unknown.known).toBe(false);
  });
});

describe('金鑰保管', () => {
  it('預設只存在這個分頁（sessionStorage），不寫入 localStorage', () => {
    saveByok(openai, SECRET);
    // 金鑰與所屬服務、來源一起存（Codex r2 R1）
    expect(JSON.parse(sessionStorage.getItem(KEY_STORAGE_KEY)!)).toEqual({ key: SECRET, presetId: openai.presetId, origin: new URL(openai.baseUrl).origin });
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    // 設定本身（不含金鑰）存在 localStorage
    expect(localStorage.getItem(CONFIG_KEY)).not.toContain(SECRET);
    expect(loadConfig()?.model).toBe('test-model');
    expect(loadKey()).toBe(SECRET);
  });

  it('勾選「記住」才存到 localStorage，並清掉分頁內的舊值；清除後兩處都沒有', () => {
    saveByok({ ...openai, rememberKey: true }, SECRET);
    expect(JSON.parse(localStorage.getItem(KEY_STORAGE_KEY)!).key).toBe(SECRET);
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    clearByok();
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(loadKey()).toBe('');
    expect(loadConfig()).toBeNull();
  });

  it('金鑰不會出現在 JSON 備份；清除所有學習紀錄時一併清除金鑰', async () => {
    saveByok({ ...openai, rememberKey: true }, SECRET);
    expect(JSON.stringify(await exportBackup())).not.toContain(SECRET);
    await clearAllData();
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(loadKey()).toBe('');
  });

  it('遮罩只顯示最後 4 碼；雲端服務沒有金鑰視為未設定，本機服務可不填', () => {
    expect(maskKey(SECRET)).toBe('••••••••1234');
    expect(maskKey(SECRET)).not.toContain('FAKE');
    expect(isConfigured(openai, '')).toBe(false);
    expect(isConfigured(openai, SECRET)).toBe(true);
    expect(isConfigured({ ...openai, presetId: 'ollama', baseUrl: 'http://localhost:11434/v1' }, '')).toBe(true);
    expect(isConfigured({ ...openai, baseUrl: 'http://evil.example.com/v1' }, SECRET)).toBe(false);
  });
});

describe('省 token：對話長度與回答上限', () => {
  it('只帶最近幾則、第一則是提問；較早的長回答截短，最後一則保持完整', () => {
    const long = '很長的回答'.repeat(400);
    const msgs: ChatTurn[] = [];
    for (let i = 0; i < 10; i++) msgs.push({ role: 'user', content: `問題${i}` }, { role: 'assistant', content: long });
    msgs.push({ role: 'user', content: '最後的提問' });
    const t = trimHistory(msgs);
    expect(t.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(t[0].role).toBe('user');
    expect(t.at(-1)!.content).toBe('最後的提問');
    for (const m of t.filter((x) => x.role === 'assistant')) expect(m.content.length).toBeLessThanOrEqual(OLD_REPLY_CHARS + 10);
  });

  it('SSE 解析可處理被切開的資料列', async () => {
    const out: string[] = [];
    for await (const d of sseData(sse(['data: {"a":1}', 'event: x', 'data: [DONE]']))) out.push(d);
    expect(out).toEqual(['{"a":1}', '[DONE]']);
  });
});

describe('OpenAI 相容服務', () => {
  it('金鑰只放在 Authorization 標頭、不帶 Cookie 與來源網址；送出系統提示、對話與回答上限', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        sse(['data: {"choices":[{"delta":{"content":"你好"}}]}', 'data: {"choices":[{"delta":{"content":"！"},"finish_reason":"length"}]}', 'data: [DONE]']),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    let text = '';
    const r = await streamChat({ config: openai, apiKey: SECRET, system: '系統', messages: [{ role: 'user', content: '問' }], onText: (d) => (text += d), fetchImpl: fakeFetch });
    expect(text).toBe('你好！');
    expect(r).toEqual({ text: '你好！', truncated: true });
    const c = captured!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.url).not.toContain(SECRET);
    expect((c.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(c.init.credentials).toBe('omit');
    expect(c.init.referrerPolicy).toBe('no-referrer');
    const body = JSON.parse(String(c.init.body));
    // OpenAI 官方 API 的新模型只接受 max_completion_tokens（其他相容服務用 max_tokens，見 connection.test.tsx）
    expect(body.max_completion_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: '系統' });
  });

  it('HTTP 401 轉成不含金鑰的中文錯誤；不允許的網址在送出前就擋下', async () => {
    const fakeFetch = (async () => new Response('bad key ' + SECRET, { status: 401 })) as unknown as typeof fetch;
    const err = await streamChat({ config: openai, apiKey: SECRET, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: fakeFetch }).catch((e) => e);
    expect(err).toBeInstanceOf(ByokError);
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain(SECRET);
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('');
    }) as unknown as typeof fetch;
    const blocked = await streamChat({ config: { ...openai, baseUrl: 'http://evil.example.com/v1' }, apiKey: SECRET, system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: spy }).catch((e) => e);
    expect(blocked).toBeInstanceOf(ByokError);
    expect(called).toBe(false);
  });
});

describe('Anthropic Claude（官方 SDK）', () => {
  it('以標頭帶金鑰呼叫 /v1/messages，使用較低思考量、回答上限與拒答時的 fallbacks', async () => {
    let req: { url: string; headers: Headers; body: Record<string, unknown>; init: RequestInit } | null = null;
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '監督式學習 [S1]' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ] as const;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      req = { url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)), init: init ?? {} };
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const [ev, data] of events) c.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    let text = '';
    const r = await streamChat({ config: claude, apiKey: SECRET, system: '規則', messages: [{ role: 'user', content: '什麼是監督式學習？' }], onText: (d) => (text += d), fetchImpl: fakeFetch });
    expect(text).toBe('監督式學習 [S1]');
    expect(r.truncated).toBe(false);
    const q = req!;
    expect(q.url).toContain('https://api.anthropic.com/v1/messages');
    // SDK 以標頭帶金鑰（此版本為 Authorization: Bearer），不放在網址
    expect(q.headers.get('x-api-key') ?? q.headers.get('authorization')).toContain(SECRET);
    expect(q.url).not.toContain(SECRET);
    expect(q.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(q.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(q.body.model).toBe('claude-opus-5-5');
    expect(q.body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(q.body.output_config).toEqual({ effort: 'low' });
    expect(q.body.fallbacks).toBe('default');
    expect(q.body.system).toBe('規則');
    // Codex F3：SDK 實際發出的請求也不帶 Cookie、不送出本站網址
    expect(q.init.credentials).toBe('omit');
    expect(q.init.referrerPolicy).toBe('no-referrer');
  });
});

describe('依據檢索與教學規則', () => {
  const q = allQuestions.find((x) => x.competencyCode === 'L11101' && x.reviewStatus !== 'retired')!;
  const correctText = q.options.find((o) => q.correctOptionIds.includes(o.id))!.text;

  it('中文以相鄰兩字比對', () => {
    expect([...gramsOf('機器學習')]).toEqual(['機器', '器學', '學習']);
  });

  it('依提問找出官方範圍、講義與題庫依據，總字數受上限控制', async () => {
    const src = await retrieveSources({ level: 'junior', query: '什麼是過擬合？泛化能力', focusCode: 'L11301' });
    expect(src.length).toBeGreaterThan(0);
    expect(src[0].kind).toBe('official');
    expect(src.some((s) => s.kind === 'lesson')).toBe(true);
    expect(src.map((s) => s.ref)).toEqual(src.map((_, i) => `S${i + 1}`));
    expect(src.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(3000);
  });

  it('練習題尚未提交：不附這題的答案與解析，並要求只給提示', async () => {
    const turn = await prepareTurn(
      { kind: 'question', question: q, selected: [], answerVisible: false, label: 't' },
      '這題在問什麼？',
      'junior',
    );
    expect(turn.sources.some((s) => s.questionId === q.id)).toBe(false);
    expect(turn.system).not.toContain('正確答案：');
    expect(turn.system).not.toContain(q.explanation.correctRationale);
    expect(turn.system).toContain('不要直接說出答案');
    expect(turn.system.startsWith(BASE_RULES)).toBe(true);
    // 依據只附在本次提問，不放進系統提示（之後的回合不重複送出）
    expect(turn.userMessage).toContain('【本站依據資料】');
    expect(turn.userMessage).toContain('【提問】這題在問什麼？');
  });

  it('解析已顯示：附上標準解析與正確答案（代號依使用者畫面順序）', async () => {
    const order = [...q.options.map((o) => o.id)].reverse();
    const turn = await prepareTurn({ kind: 'question', question: q, order, selected: [], answerVisible: true, label: 't' }, '為什麼？', 'junior');
    const letter = 'ABCD'[order.indexOf(q.correctOptionIds[0])];
    expect(turn.system).toContain(`正確答案：${letter}`);
    expect(turn.system).toContain(correctText);
    expect(turn.system).toContain(q.explanation.correctRationale);
  });

  it('教學規則要求引用依據、沒有依據時不得自行補充、預設精簡回答', () => {
    expect(BASE_RULES).toContain('[S1]');
    expect(BASE_RULES).toContain('本站資料沒有涵蓋');
    expect(BASE_RULES).toContain('300 字');
  });
});

describe('官方學習指引位置索引', () => {
  it('50 個細項都有索引，只含位置資訊、沒有指引正文', async () => {
    const { allCompetencies } = await import('../../src/content');
    const idx = (await import('../../src/content/official-guide-index.json')).default as { competencies: Record<string, Record<string, unknown>> };
    const codes = allCompetencies().map((c) => c.code).sort();
    expect(Object.keys(idx.competencies).sort()).toEqual(codes);
    // 防止日後把指引正文貼進索引：所有字串欄位都應是短的定位資訊
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(idx);
    expect(Math.max(...strings.map((s) => s.length))).toBeLessThanOrEqual(400);
  });

  it('檢索時附上目前細項的官方指引頁碼，並指向官方下載頁', async () => {
    const src = await retrieveSources({ level: 'junior', query: '什麼是 AI', focusCode: 'L11101' });
    const g = src.find((s) => s.title.startsWith('官方學習指引'));
    expect(g?.text).toContain('3-1');
    expect(g?.text).toContain('不是本細項專屬頁碼');
    expect(g?.externalUrl).toBe('https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources');
  });
});

describe('回答依據檢查', () => {
  it('標出未附依據的數字，以及說「沒有涵蓋」卻仍補充的回答', async () => {
    const { checkGrounding } = await import('../../src/ai/byok/check');
    // 實測案例：本機模型說沒有涵蓋後，仍自行補上罰款金額
    const bad = '本站資料沒有涵蓋這一點。根據 EU AI Act 的罰則規定，違反該法的罰款上限為全球營業額的 6% 或 3,000 萬歐元（以較高者為準），此內容未出現在本站提供的依據資料中。若需確認詳細條文，建議至官方網站下載全文查閱第 52 條。';
    expect(checkGrounding(bad)).toMatchObject({ uncitedNumbers: true, answeredDespiteNoSource: true });
    const good = '評測項目共有 10 項：安全性、可解釋性等 [S3]。\n\n（舉例）像 3 個人分工檢查。';
    expect(checkGrounding(good)).toMatchObject({ uncitedNumbers: false, answeredDespiteNoSource: false });
    const pointer = '本站資料沒有涵蓋這一點。可閱讀官方學習指引第 3.1 節，印刷頁 3-1～3-23 [S2]。';
    expect(checkGrounding(pointer)).toMatchObject({ uncitedNumbers: false, answeredDespiteNoSource: false });
    // 實測案例：模型守規則，只指出閱讀位置（段落內有依據編號）時不應警示
    const realPointer = '本站資料沒有涵蓋這一點。依據 [S3]、[S7] 中提及的歐盟《人工智慧法》內容，僅說明其風險分級架構，但未載明第52條的罰款上限。如需了解具體條文內容，建議參閱 iPAS 官方學習指引初級科目一第3.1節「人工智慧概念」（印刷頁3-1～3-23）。';
    expect(checkGrounding(realPointer)).toMatchObject({ uncitedNumbers: false, answeredDespiteNoSource: false });
    // Codex S1：引用不存在的編號
    expect(checkGrounding('最高罰款 999999 元 [S999]', ['S1', 'S2']).unknownRefs).toBe(true);
    expect(checkGrounding('見 [S2]', ['S1', 'S2']).unknownRefs).toBe(false);
  });
});

describe('離題檢查（送出前在本機擋下，不產生用量）', () => {
  it('閒聊與打招呼擋下；學習提問與題目頁的提示要求放行', async () => {
    const { topicVerdict } = await import('../../src/ai/byok/check');
    const { questionRelevance } = await import('../../src/ai/byok/retrieval');
    const verdict = async (t: string, page = false) => topicVerdict(t, await questionRelevance('junior', t), page).ok;
    for (const t of ['你好', 'hi', '謝謝', '講個笑話', '今天天氣如何', '推薦台北好吃的晚餐', '幫我寫一首詩', '幫我寫一封請假信', '股票會漲嗎', '你是誰'])
      expect(await verdict(t), t).toBe(false);
    for (const t of ['什麼是過擬合？', '監督式學習和非監督式學習差在哪', 'RAG 是什麼', '歐盟AI法有幾個風險等級', '用生成式 AI 寫一首詩屬於哪種應用？', 'pandas groupby 怎麼用'])
      expect(await verdict(t), t).toBe(true);
    // 題目或講義頁：指向目前內容的提問即使字詞少也放行
    expect(await verdict('給我一點提示', true)).toBe(true);
    expect(await verdict('這題為什麼選B', true)).toBe(true);
    expect(await verdict('今天天氣如何', true)).toBe(false);
    // Codex F5：英文字中的 ai、只有「為什麼」的一般問句不能放行
    expect(await verdict('請幫我寫一封email請假信', true)).toBe(false);
    expect(await verdict('推薦Taipei餐廳', true)).toBe(false);
    expect(await verdict('為什麼天空是藍色', true)).toBe(false);
    // 介面的快捷提問與一般學習問句在講義頁放行
    for (const t of ['用簡單的話解釋這個觀念', '舉一個生活或職場的例子', '這題容易和哪些觀念混淆？', '幫我整理成三個重點', '為什麼模型會有偏見', '解釋一下梯度下降'])
      expect(await verdict(t, true), t).toBe(true);
  });
});

describe('檢索以提問為主', () => {
  it('在 L11301 講義頁問「特徵工程」，仍找得到 L11202 的特徵工程段落（實測回歸）', async () => {
    const turn = await prepareTurn({ kind: 'lesson', code: 'L11301' }, '什麼是特徵工程？舉一個例子', 'junior');
    expect(turn.sources.some((s) => s.kind === 'lesson' && s.competencyCode === 'L11202')).toBe(true);
    expect(turn.userMessage).toContain('特徵工程');
  });
});

describe('金鑰只送往原本的服務（Codex F1）', () => {
  it('換服務或改網址就不沿用已儲存的金鑰', async () => {
    const { savedKeyApplies } = await import('../../src/ai/byok/config');
    expect(savedKeyApplies(openai, { presetId: 'openai', baseUrl: 'https://api.openai.com/v1/' })).toBe(true);
    expect(savedKeyApplies(openai, { presetId: 'ollama', baseUrl: 'http://localhost:11434/v1' })).toBe(false);
    expect(savedKeyApplies(openai, { presetId: 'openai', baseUrl: 'https://untrusted.example/v1' })).toBe(false);
    expect(savedKeyApplies(null, { presetId: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe(false);
  });

  it('未勾選信任的自訂網址：取得模型清單、測試連線、儲存都被擋下', async () => {
    const { endpointGate } = await import('../../src/ai/byok/config');
    expect(endpointGate('https://untrusted.example/v1', false)).toContain('信任');
    expect(endpointGate('https://untrusted.example/v1', true)).toBeNull();
    expect(endpointGate('https://api.openai.com/v1', false)).toBeNull();
    expect(endpointGate('http://localhost:11434/v1', false)).toBeNull();
    expect(endpointGate('http://evil.example.com/v1', true)).not.toBeNull();
  });
});
