/**
 * 手機版 AI 導師設定（使用者回報：手機上不能點「自動偵測本機 AI」）。
 * 手機的 localhost 是手機自己，連不到電腦上的本機 AI；手機版改以雲端服務為主。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { __resetConnectionForTests } from '../../src/ai/byok/connection';
import { clearByok, saveByok, type ByokConfig } from '../../src/ai/byok/config';
import { KEY_PAGES, isMobileDevice } from '../../src/ai/byok/device';
import { ByokSettings } from '../../src/components/ByokSettings';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const asDevice = (ua: string, touch = 0) => {
  const u = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  // jsdom 沒有 maxTouchPoints：直接定義，測完移除
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => touch });
  onTestFinished(() => {
    u.mockRestore();
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  });
};
const serviceIds = () => [...(screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement).options].map((o) => o.value);
const cloud: ByokConfig = { presetId: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: '', rememberKey: false };

beforeEach(() => {
  clearByok();
  __resetConnectionForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('判斷手機或平板', () => {
  it('Android、iPhone、以 Mac 字串回報的 iPad（有觸控）算手機／平板；Windows 與一般 Mac 不算', () => {
    expect(isMobileDevice(ANDROID, 5)).toBe(true);
    expect(isMobileDevice(IPHONE, 5)).toBe(true);
    expect(isMobileDevice(IPAD_AS_MAC, 5)).toBe(true);
    expect(isMobileDevice(IPAD_AS_MAC, 0)).toBe(false);
    expect(isMobileDevice(WIN, 0)).toBe(false);
    expect(isMobileDevice(WIN, 10)).toBe(false); // 觸控筆電仍是電腦
  });
});

describe('手機版設定', () => {
  for (const [name, ua, touch] of [
    ['Android', ANDROID, 5],
    ['iPhone', IPHONE, 5],
    ['iPad', IPAD_AS_MAC, 5],
  ] as const) {
    it(`${name}：預設雲端服務並說明原因；第一次使用展開教學；不顯示自動偵測；服務選單只列雲端與自訂`, () => {
      asDevice(ua, touch);
      render(<ByokSettings compact />);
      const note = screen.getByTestId('byok-mobile-note');
      expect(note).toHaveTextContent('手機上預設使用雲端服務');
      expect(note).toHaveTextContent('localhost 指向手機本身');
      // Codex M2：不宣稱本機服務一律只能同機使用；保留自訂網址的說明
      expect(note).not.toHaveTextContent('只能在執行它的那台電腦上使用');
      expect(note).toHaveTextContent('其他 OpenAI 相容服務');
      expect(screen.getByTestId('byok-mobile-guide')).toHaveAttribute('open');
      expect(screen.getByTestId('byok-mobile-guide')).toHaveTextContent('長按');
      expect((screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement).value).toBe('anthropic');
      expect(screen.queryByTestId('byok-detect')).toBeNull();
      const ids = serviceIds();
      expect(ids).toEqual(expect.arrayContaining(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']));
      for (const local of ['ollama', 'ollama-bridge', 'lmstudio']) expect(ids).not.toContain(local);
    });
  }

  it('Codex M3：手機上已儲存本機服務：保留選項與設定，不顯示指向電腦版功能的指引，改說明並提供改選入口；教學收合', () => {
    asDevice(ANDROID, 5);
    for (const saved of [
      { presetId: 'ollama-bridge', baseUrl: 'http://localhost:11435/v1' },
      { presetId: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      { presetId: 'lmstudio', baseUrl: 'http://localhost:1234/v1' },
    ]) {
      cleanup();
      saveByok({ ...saved, kind: 'openai-compatible', model: 'm', rememberKey: false }, '');
      render(<ByokSettings />);
      expect(serviceIds()).toContain(saved.presetId);
      expect(screen.queryByTestId('local-bridge-panel')).toBeNull();
      expect(screen.queryByTestId('local-setup-guide')).toBeNull();
      expect(screen.getByTestId('byok-mobile-local')).toHaveTextContent('指向手機本身');
      // Codex 手機複查 R2-1：整個表單（含服務選單下方的提示）都不出現手機做不到的電腦版步驟
      const hint = screen.getByTestId('byok-service-hint');
      expect(hint).toHaveTextContent('在手機上請看下方說明');
      const form = screen.getByTestId('byok-settings');
      for (const desktopOnly of ['本機暫時許可', 'PowerShell', '啟用 CORS', '讓本站連到 Ollama', '自動偵測本機 AI」或']) expect(form).not.toHaveTextContent(desktopOnly);
      expect(screen.getByTestId('byok-mobile-guide')).not.toHaveAttribute('open');
      fireEvent.click(screen.getByTestId('byok-mobile-custom'));
      expect((screen.getByRole('combobox', { name: /^AI 服務/ }) as HTMLSelectElement).value).toBe('custom');
      expect(JSON.parse(localStorage.getItem('ipas-ai-byok-config')!).presetId).toBe(saved.presetId); // 沒有被刪除或改存
    }
  });

  it('手機上用已存的本機服務連線失敗：說明位址指向手機本身，不指向手機上看不到的步驟', async () => {
    asDevice(ANDROID, 5);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    saveByok({ presetId: 'ollama-bridge', kind: 'openai-compatible', baseUrl: 'http://localhost:11435/v1', model: 'm', rememberKey: false }, '');
    render(<ByokSettings />);
    fireEvent.click(screen.getByTestId('byok-save'));
    await screen.findByText(/指向手機本身，不會連到電腦上的服務/);
    expect(screen.getByRole('status')).not.toHaveTextContent('本機暫時許可');
  });

  it('電腦版不受影響：仍有自動偵測與本機服務選項', () => {
    asDevice(WIN, 0);
    render(<ByokSettings />);
    expect(screen.queryByTestId('byok-mobile-note')).toBeNull();
    expect(screen.getByTestId('byok-detect')).toBeTruthy();
    expect(serviceIds()).toContain('ollama-bridge');
  });
});

describe('取得金鑰的連結與雲端模型選擇', () => {
  it('每個雲端服務都有「建立金鑰」連結（新分頁、不帶來源資訊）；自訂服務沒有', () => {
    render(<ByokSettings />);
    for (const id of Object.keys(KEY_PAGES)) {
      fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: id } });
      const link = screen.getByTestId('byok-key-page').querySelector('a')!;
      expect(link.href).toBe(KEY_PAGES[id].url);
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
      expect(link.rel).toContain('noreferrer');
    }
    fireEvent.change(screen.getByRole('combobox', { name: /^AI 服務/ }), { target: { value: 'custom' } });
    expect(screen.queryByTestId('byok-key-page')).toBeNull();
  });

  it('雲端服務模型空白時「取得模型清單」不自動選第一個（字母排序常是舊模型），改請使用者從選單選', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'babbage-002' }, { id: 'gpt-x' }] }), { headers: { 'content-type': 'application/json' } })));
    saveByok(cloud, 'FAKE-KEY');
    render(<ByokSettings />);
    fireEvent.click(screen.getByRole('button', { name: '取得模型清單' }));
    const select = (await screen.findByTestId('byok-model-select')) as HTMLSelectElement;
    expect((screen.getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe('');
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe('（請選擇模型）');
    expect(screen.getByRole('status')).toHaveTextContent('請從「模型」下方的選單選擇要用的模型');
    fireEvent.change(select, { target: { value: 'gpt-x' } });
    expect((screen.getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe('gpt-x');
  });
});
