/**
 * Ollama 403 與本機轉接程式（docs/CLAUDE_REQUEST_OLLAMA_403_2026-11-21.md；使用者選擇方案 C）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_BASE_URL, BRIDGE_EXPIRES_HEADER, bridgeExpiresOf, bridgeScript, bridgeStopCommand, clampMinutes, isBridgeUrl } from '../../src/ai/byok/bridge';
import { ByokError, streamChat, verifyConnection } from '../../src/ai/byok/client';
import { __resetConnectionForTests, getConnection } from '../../src/ai/byok/connection';
import { clearByok, saveByok, type ByokConfig } from '../../src/ai/byok/config';
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

  it('停止與重新啟動不強制結束任何程式：以 PID＋啟動時間確認身分，再用停止代碼請轉接程式自己結束', () => {
    for (const s of [bridgeStopCommand(), bridgeScript(ORIGIN, 30)]) {
      expect(s).not.toMatch(/Stop-Process|taskkill|\.Kill\(/i);
      expect(s).toContain('StartTime.ToUniversalTime().Ticks');
      expect(s).toContain('ipas-ollama-bridge.stop');
    }
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
  it('三個按鈕只複製指令、不發出網路請求；預設收合；可改用轉接程式位址', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const writes: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } });
    const onUse = vi.fn();
    render(<LocalBridgePanel baseUrl="http://localhost:11434/v1" onUseBridge={onUse} />);
    expect(screen.getByTestId('local-bridge-panel')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByTestId('bridge-start'));
    fireEvent.click(screen.getByTestId('bridge-stop'));
    fireEvent.click(screen.getByTestId('bridge-restart'));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[0]).toContain('$Minutes = 30');
    expect(writes[1]).toContain('ipas-ollama-bridge.stop');
    expect(writes[1]).not.toContain('Stop-Process');
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
