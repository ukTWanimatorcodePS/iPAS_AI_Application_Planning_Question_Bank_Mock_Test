/**
 * 是否為手機或平板（只用來調整畫面與說明，不是安全判斷）。
 *
 * 手機上的 localhost 指向手機本身，不會連到電腦上的 Ollama／LM Studio；本站的自動偵測與 Windows 轉接程式
 * 只適用同一台電腦（區網 http 也不支援，保護金鑰）。所以手機版先提供雲端服務，不顯示這兩項；
 * 手機本機的相容服務或可信的 HTTPS 位址，仍可用「其他 OpenAI 相容服務」設定。這是畫面偏好，不是安全邊界。
 * iPadOS 的 Safari 會用 Mac 的使用者代理字串，另外以觸控點數判斷。
 */
export function isMobileDevice(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0,
): boolean {
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

/** 各雲端服務建立 API 金鑰的官方頁面（在新分頁開啟） */
export const KEY_PAGES: Record<string, { name: string; url: string }> = {
  anthropic: { name: 'Claude Console', url: 'https://platform.claude.com/settings/keys' },
  openai: { name: 'OpenAI 平台', url: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/keys' },
};
