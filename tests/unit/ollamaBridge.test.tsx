/**
 * Ollama 403 與本機轉接程式（docs/CLAUDE_REQUEST_OLLAMA_403_2026-11-21.md；使用者選擇方案 C）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { BRIDGE_BASE_URL, BRIDGE_EXPIRES_HEADER, bridgeExpiresOf, bridgeScript, clampMinutes, isBridgeUrl, prefersBridge } from '../../src/ai/byok/bridge';
import { ByokError, streamChat, verifyConnection } from '../../src/ai/byok/client';
import { __resetConnectionForTests, getConnection } from '../../src/ai/byok/connection';
import { clearByok, loadByok, saveByok, type ByokConfig } from '../../src/ai/byok/config';
import { ByokSettings } from '../../src/components/ByokSettings';
import { LocalBridgePanel } from '../../src/components/LocalBridgePanel';

const ORIGIN = 'https://uktwanimatorcodeps.github.io';
const ollama: ByokConfig = { presetId: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:14b', rememberKey: false };
const bridge: ByokConfig = { ...ollama, presetId: 'ollama-bridge', baseUrl: BRIDGE_BASE_URL };
const cloud: ByokConfig = { presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'test', rememberKey: false };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ask = (config: ByokConfig, f: typeof fetch) => streamChat({ config, apiKey: '', system: 's', messages: [{ role: 'user', content: 'q' }], onText: () => {}, fetchImpl: f });

beforeEach(() => {
  clearByok();
  __resetConnectionForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('轉接程式腳本', () => {
  it('只允許本站、只聽 localhost、路徑白名單、到期自動關閉；不轉送 Authorization、Cookie、Origin', () => {
    const s = bridgeScript(ORIGIN, 30);
    expect(s).toContain(`$Origin = '${ORIGIN}'`);
    expect(s).toContain('$Minutes = 30');
    expect(s).toContain('http://localhost:$Port/');
    expect(s).not.toMatch(/http:\/\/\+:|http:\/\/\*:/); // 不聽所有介面
    expect(s).toContain("$Allowed = @('/v1/models', '/v1/chat/completions', '/api/tags', '/api/version')");
    expect(s).toContain("if ($req.Headers['Origin'] -cne $Origin) { $res.StatusCode = 403");
    // 每個請求檢查 loopback 與 Host（實際行為見 ollamaBridge.runtime.test.ts）
    expect(s).toContain('[System.Net.IPAddress]::IsLoopback($remote)');
    expect(s).toContain('"localhost:$Port"');
    expect(s).toContain('Access-Control-Allow-Private-Network');
    expect(s).toContain(BRIDGE_EXPIRES_HEADER);
    expect(s).toContain('$MaxBody = 2097152');
    expect(s).toContain('$fwd.AllowAutoRedirect = $false');
    // 轉送的請求只設定方法、Content-Type 與內容
    expect(s).not.toMatch(/\$fwd\.Headers|Authorization'\]\s*=|\$fwd\.CookieContainer/);
    // 不改 Ollama 設定、不重新啟動 Ollama
    expect(s).not.toMatch(/OLLAMA_ORIGINS|setx|Stop-Process[^\n]*ollama/i);
  });

  it('停止方式是在視窗按 Ctrl+C（啟動畫面最後一行就說明）；再次啟動不強制結束任何程式', () => {
    const s = bridgeScript(ORIGIN, 30);
    const hostLines = s.split('\n').filter((l) => /^Write-Host /.test(l));
    expect(hostLines.at(-1)).toContain('Ctrl+C'); // 啟動後畫面最後顯示的一行
    expect(s).toContain('# 要停止：在這個視窗按 Ctrl+C');
    expect(s).not.toMatch(/Stop-Process|taskkill|\.Kill\(/i);
    expect(s).toContain('StartTime.ToUniversalTime().Ticks');
    expect(s).toContain('ipas-ollama-bridge.stop');
  });

  it('許可時間限制在 5～120 分鐘；單引號正確跳脫', () => {
    expect(clampMinutes(1)).toBe(5);
    expect(clampMinutes(200)).toBe(120);
    expect(clampMinutes(Number('abc'))).toBe(30);
    expect(bridgeScript(ORIGIN, 999)).toContain('$Minutes = 120');
    expect(bridgeScript("https://a'b.example", 30)).toContain("$Origin = 'https://a''b.example'");
  });

  it('位址判斷與到期標頭解析', () => {
    expect(isBridgeUrl('http://localhost:11435/v1')).toBe(true);
    expect(isBridgeUrl('http://localhost:11434/v1')).toBe(false);
    // 轉接程式只登記 localhost:11435/v1；其他寫法不算（也不信任它們的到期標頭）
    for (const u of ['http://127.0.0.1:11435/v1', 'https://localhost:11435/v1', 'http://localhost:11435/other', 'http://localhost:11435/v1?x=1', 'https://api.openai.com/v1'])
      expect(isBridgeUrl(u)).toBe(false);
    expect(bridgeExpiresOf(new Response(null, { headers: { [BRIDGE_EXPIRES_HEADER]: '1795193902387' } }))).toBe(1795193902387);
    expect(bridgeExpiresOf(new Response(null, { headers: { [BRIDGE_EXPIRES_HEADER]: 'soon' } }))).toBeUndefined();
    expect(bridgeExpiresOf(new Response(null))).toBeUndefined();
  });
});

describe('403 與轉接程式的錯誤說明', () => {
  it('Ollama 403：說明最可能是來源未獲許可、不當成金鑰錯誤；其他本機程式只列可能原因；雲端 403 仍是金鑰／權限', async () => {
    const local = (await ask(ollama, (async () => json({ error: 'forbidden' }, 403)) as unknown as typeof fetch).catch((e) => e)) as ByokError;
    expect(local.message).toContain('Ollama');
    expect(local.message).toContain('最可能');
    expect(local.message).toContain('重新連線');
    expect(local.kind).not.toBe('auth');
    expect(getConnection().phase).toBe('offline'); // 被拒絕：結束連線
    const remote = (await ask(cloud, (async () => json({ error: { message: 'forbidden' } }, 403)) as unknown as typeof fetch).catch((e) => e)) as ByokError;
    expect(remote.kind).toBe('auth');
    // 其他本機程式（例如有自己權限設定的伺服器）：不斷言不是金鑰問題，也不叫人去開 Ollama 轉接程式
    const other: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'http://localhost:8080/v1', model: 'm', rememberKey: false };
    const o = (await ask(other, (async () => json({ error: 'forbidden' }, 403)) as unknown as typeof fetch).catch((e) => e)) as ByokError;
    expect(o.message).toContain('可能是');
    expect(o.message).toContain('權限或金鑰');
    expect(o.message).not.toContain('Ollama');
  });

  it('轉接程式連不到（未啟動或已到期）：明確說明並指向啟動與重新連線', async () => {
    const err = (await ask(bridge, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch).catch((e) => e)) as ByokError;
    expect(err.message).toContain('連不到本機轉接程式');
    expect(err.message).toContain('啟動');
  });
});

describe('網站倒數對齊轉接程式的到期時間', () => {
  it('重新連線讀到到期標頭時，倒數以它為準（可超過 30 分鐘）；沒有標頭時維持 30 分鐘', async () => {
    const expires = Date.now() + 45 * 60_000;
    await verifyConnection(bridge, '', (async () => json({ data: [{ id: 'qwen3:14b' }] }, 200, { [BRIDGE_EXPIRES_HEADER]: String(expires) })) as unknown as typeof fetch);
    expect(getConnection().expiresAt).toBe(expires);
    __resetConnectionForTests();
    const before = Date.now();
    await verifyConnection(ollama, '', (async () => json({ data: [{ id: 'qwen3:14b' }] })) as unknown as typeof fetch);
    const e = getConnection().expiresAt!;
    expect(e - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(e - before).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('Codex F5：只有轉接位址的到期標頭可以採用；雲端、一般本機、其他連接埠帶同名標頭都維持 30 分鐘', async () => {
    const forged = String(Date.now() + 90 * 60_000);
    const cases: ByokConfig[] = [
      cloud,
      ollama,
      { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'http://localhost:8080/v1', model: 'qwen3:14b', rememberKey: false },
      { ...bridge, baseUrl: 'http://127.0.0.1:11435/v1' },
    ];
    for (const c of cases) {
      __resetConnectionForTests();
      const before = Date.now();
      const f = (async () => json({ data: [{ id: 'qwen3:14b' }, { id: 'test' }] }, 200, { [BRIDGE_EXPIRES_HEADER]: forged })) as unknown as typeof fetch;
      await verifyConnection(c, c === cloud ? 'FAKE' : '', f);
      expect(getConnection().phase).toBe('online');
      expect(getConnection().expiresAt! - before).toBeLessThanOrEqual(30 * 60_000 + 1000);
      __resetConnectionForTests();
      await ask(c, (async () => new Response('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', { headers: { [BRIDGE_EXPIRES_HEADER]: forged } })) as unknown as typeof fetch);
      expect(getConnection().expiresAt! - before).toBeLessThanOrEqual(30 * 60_000 + 1000);
    }
    // 對照：真正的轉接位址，5 分鐘、沒有標頭、格式錯誤、已過期
    __resetConnectionForTests();
    const five = Date.now() + 5 * 60_000;
    await verifyConnection(bridge, '', (async () => json({ data: [{ id: 'qwen3:14b' }] }, 200, { [BRIDGE_EXPIRES_HEADER]: String(five) })) as unknown as typeof fetch);
    expect(getConnection().expiresAt).toBe(five);
    for (const h of [undefined, 'soon', String(Date.now() - 1000)]) {
      __resetConnectionForTests();
      const before = Date.now();
      await verifyConnection(bridge, '', (async () => json({ data: [{ id: 'qwen3:14b' }] }, 200, h ? { [BRIDGE_EXPIRES_HEADER]: h } : {})) as unknown as typeof fetch);
      expect(Math.abs(getConnection().expiresAt! - before - 30 * 60_000)).toBeLessThanOrEqual(1000);
    }
  });

  it('不合理的到期時間（超過 120 分鐘或已過）不採用', async () => {
    await verifyConnection(bridge, '', (async () => json({ data: [{ id: 'qwen3:14b' }] }, 200, { [BRIDGE_EXPIRES_HEADER]: String(Date.now() + 10 * 3600_000) })) as unknown as typeof fetch);
    expect(getConnection().expiresAt! - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });
});

describe('設定頁：轉接程式區塊與重新連線', () => {
  it('只有「啟動」一個按鈕：只複製指令、不發出網路請求；預設收合；說明用 Ctrl+C 停止；可改用轉接程式位址', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const writes: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } });
    const onUse = vi.fn();
    render(<LocalBridgePanel baseUrl="http://localhost:11434/v1" onUseBridge={onUse} />);
    expect(screen.getByTestId('local-bridge-panel')).not.toHaveAttribute('open');
    expect(screen.getByRole('group', { name: /轉接程式指令/ }).querySelectorAll('button')).toHaveLength(1);
    expect(screen.queryByTestId('bridge-stop')).toBeNull();
    expect(screen.queryByTestId('bridge-restart')).toBeNull();
    expect(screen.getByTestId('local-bridge-panel')).toHaveTextContent('Ctrl+C');
    fireEvent.click(screen.getByTestId('bridge-start'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('$Minutes = 30');
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('bridge-use'));
    expect(onUse).toHaveBeenCalled();
  });

  it('選 Ollama 時出現轉接程式區塊；「重新連線」只讀模型清單（不產生回答、不耗 token）', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return json({ data: [{ id: 'qwen3:14b' }] });
      }),
    );
    saveByok(ollama, '');
    render(<ByokSettings />);
    expect(screen.getByTestId('local-bridge-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('byok-reconnect'));
    await waitFor(() => expect(getConnection().phase).toBe('online'));
    expect(seen.every((u) => u.endsWith('/models'))).toBe(true);
    expect(seen.some((u) => u.includes('/chat/completions'))).toBe(false);
  });
});

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const asOs = (ua: string) => {
  const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  onTestFinished(() => spy.mockRestore());
};
const ollamaModels = (...ids: string[]) => json({ data: ids.map((id) => ({ id })) });

describe('Windows：本機 Ollama 一律帶入轉接程式版本（使用者要求）', () => {
  it('判斷是否為 Windows 桌面', () => {
    expect(prefersBridge(WIN)).toBe(true);
    expect(prefersBridge(MAC)).toBe(false);
    expect(prefersBridge('Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile')).toBe(false);
    expect(prefersBridge('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });

  it('Windows 的服務選單只列「透過轉接程式」的 Ollama；選它就帶入轉接位址與說明區塊。macOS 只列直接連線', () => {
    asOs(WIN);
    const { unmount } = render(<ByokSettings />);
    const select = screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement;
    const ids = [...select.options].map((o) => o.value);
    expect(ids).toContain('ollama-bridge');
    expect(ids).not.toContain('ollama');
    fireEvent.change(select, { target: { value: 'ollama-bridge' } });
    expect((screen.getByRole('textbox', { name: 'API 位址' }) as HTMLInputElement).value).toBe(BRIDGE_BASE_URL);
    expect(screen.getByTestId('local-bridge-panel')).toHaveAttribute('open');
    unmount();
    cleanup();
    vi.restoreAllMocks();
    asOs(MAC);
    render(<ByokSettings />);
    const ids2 = [...(screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement).options].map((o) => o.value);
    expect(ids2).toContain('ollama');
    expect(ids2).not.toContain('ollama-bridge');
  });

  it('自動偵測：Ollama 被本站擋下（403）時，直接帶入轉接程式版本並打開「本機暫時許可」，不儲存、不動原本的設定', async () => {
    asOs(WIN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.mode === 'no-cors' && String(url).startsWith('http://localhost:11434')) return new Response(null);
        throw new TypeError('Failed to fetch');
      }),
    );
    saveByok(cloud, 'FAKE-CLOUD-KEY');
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-detect'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已帶入「透過轉接程式」的設定'));
    expect((screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement).value).toBe('ollama-bridge');
    expect((screen.getByRole('textbox', { name: 'API 位址' }) as HTMLInputElement).value).toBe(BRIDGE_BASE_URL);
    expect(screen.getByTestId('local-bridge-panel')).toHaveAttribute('open');
    expect(loadByokConfig()).toBe('openai');
  });

  it('自動偵測：轉接程式已在執行時優先找到它，列出模型，確認後一鍵套用並連線', async () => {
    asOs(WIN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).startsWith('http://localhost:11435/v1/models') ? ollamaModels('qwen3:14b', 'llama3.2:3b') : Promise.reject(new TypeError('x')))),
    );
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-detect'));
    const panel = await screen.findByTestId('byok-detected');
    expect(panel).toHaveTextContent('qwen3:14b');
    fireEvent.click(screen.getByTestId('byok-detect-apply'));
    await waitFor(() => expect(getConnection().phase).toBe('online'));
    expect(loadByokConfig()).toBe('ollama-bridge');
  });
});

describe('模型名稱自動填入與下拉選單', () => {
  it('本機服務模型留空按「儲存並連線」：自動讀取已下載的模型、填入第一個對話模型並連線', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaModels('nomic-embed-text', 'qwen3:14b')));
    saveByok({ ...bridge, model: '' }, '');
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(getConnection().phase).toBe('online'));
    expect((screen.getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe('qwen3:14b');
    expect(screen.getByRole('status')).toHaveTextContent('已自動選用模型「qwen3:14b」');
    expect(loadByokModel()).toBe('qwen3:14b');
  });

  it('本機服務還沒有模型、或讀不到清單：說明原因，不儲存空模型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaModels()));
    render(<ByokSettings />);
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'lmstudio' } });
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('還沒有任何模型'));
    expect(loadByokConfig()).not.toBe('lmstudio');
  });

  it('雲端服務仍須填模型名稱（不自動猜）', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    saveByok({ ...cloud, model: '' }, 'FAKE');
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    expect(screen.getByRole('status')).toHaveTextContent('請填寫模型名稱');
    expect(f).not.toHaveBeenCalled();
  });

  it('「取得模型清單」自動填入模型，並出現下拉選單可改選其他模型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaModels('llama3.2:3b', 'qwen3:14b')));
    saveByok({ ...bridge, model: '' }, '');
    render(<ByokSettings />);
    expect(screen.queryByTestId('byok-model-select')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    const select = (await screen.findByTestId('byok-model-select')) as HTMLSelectElement;
    const input = screen.getByRole('combobox', { name: '模型' }) as HTMLInputElement;
    expect(input.value).toBe('llama3.2:3b');
    expect([...select.options].map((o) => o.value)).toEqual(['llama3.2:3b', 'qwen3:14b']);
    expect(screen.getByRole('status')).toHaveTextContent('已自動填入「llama3.2:3b」');
    fireEvent.change(select, { target: { value: 'qwen3:14b' } });
    expect(input.value).toBe('qwen3:14b');
  });

  it('雲端服務已填的模型不被清單覆蓋（只在空白時填入）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ollamaModels('gpt-a', 'gpt-b')));
    saveByok({ ...cloud, model: 'my-custom-alias' }, 'FAKE');
    render(<ByokSettings />);
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    await screen.findByTestId('byok-model-select');
    expect((screen.getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe('my-custom-alias');
  });
});

function loadByokConfig(): string | undefined {
  return JSON.parse(localStorage.getItem('ipas-ai-byok-config') ?? 'null')?.presetId;
}
function loadByokModel(): string | undefined {
  return JSON.parse(localStorage.getItem('ipas-ai-byok-config') ?? 'null')?.model;
}

describe('Codex 第四輪 R4-1：自動讀取模型等待中，設定在別處被清除或改存時，舊操作不寫回、不連線', () => {
  const localCustom: ByokConfig = { presetId: 'custom', kind: 'openai-compatible', baseUrl: 'http://localhost:18888/v1', model: '', rememberKey: true };
  const FAKE = 'FAKE-LOCAL-KEY-R4';
  /** 第一次模型清單請求等待中，由測試決定何時回傳 */
  const pendingFetch = () => {
    const calls: string[] = [];
    let release!: () => void;
    const fetchMock = vi.fn((url: string) => {
      calls.push(String(url));
      if (calls.length === 1) return new Promise<Response>((r) => (release = () => r(ollamaModels('model-auto'))));
      return Promise.resolve(ollamaModels('model-auto'));
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls, release: () => release() };
  };

  it('重現 A：等待中另一個表單清除金鑰 → 不恢復設定與金鑰、不再連線', async () => {
    const f = pendingFetch();
    saveByok(localCustom, FAKE);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    clearByok(); // 另一個表單／分頁按「清除金鑰」
    await act(async () => f.release());
    await new Promise((r) => setTimeout(r, 30));
    expect(loadByok().config).toBeNull();
    expect(loadByok().key).toBe('');
    expect(f.calls).toHaveLength(1); // 沒有再發出連線請求
    expect(getConnection().phase).toBe('idle');
    expect(screen.getByRole('status')).toHaveTextContent('已取消這次操作');
  });

  it('重現 B：等待中另一個表單改存其他服務 → 保留較新的設定，不被覆蓋', async () => {
    const f = pendingFetch();
    saveByok(localCustom, FAKE);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    saveByok({ ...cloud, model: 'newer-user-choice' }, 'FAKE-NEWER-KEY');
    await act(async () => f.release());
    await new Promise((r) => setTimeout(r, 30));
    expect(loadByok().config).toMatchObject({ presetId: 'openai', model: 'newer-user-choice' });
    expect(loadByok().key).toBe('FAKE-NEWER-KEY');
    expect(f.calls).toHaveLength(1);
  });

  it('「只測試，不儲存」等待中設定被清除 → 不啟動舊連線', async () => {
    const f = pendingFetch();
    saveByok(localCustom, FAKE);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-test'));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    clearByok();
    await act(async () => f.release());
    await new Promise((r) => setTimeout(r, 30));
    expect(f.calls).toHaveLength(1);
    expect(getConnection().phase).toBe('idle');
  });

  it('對照：等待中沒有其他變更 → 照常自動填入、儲存並連線（自己儲存不算外部變更）', async () => {
    const f = pendingFetch();
    saveByok(localCustom, FAKE);
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    await act(async () => f.release());
    await waitFor(() => expect(getConnection().phase).toBe('online'));
    expect(loadByok().config).toMatchObject({ presetId: 'custom', model: 'model-auto' });
    expect(loadByok().key).toBe(FAKE);
    expect(f.calls).toHaveLength(2);
  });
});
