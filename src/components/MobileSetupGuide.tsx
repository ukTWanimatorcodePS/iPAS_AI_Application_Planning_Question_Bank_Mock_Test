import { KEY_PAGES } from '../ai/byok/device';

/**
 * 手機版 AI 導師設定教學（使用者要求：手機的操作和電腦不同，要有教學）。
 * 手機上預設使用雲端服務：一般的 Ollama、LM Studio 要先在電腦上下載模型並執行，手機的 localhost 也不會連到電腦。
 * 第一次設定（還沒有儲存任何 AI 設定）時預設展開。
 */
export function MobileSetupGuide({ presetId, open, hasKeyPage }: { presetId: string; open: boolean; hasKeyPage: boolean }) {
  const page = KEY_PAGES[presetId];
  return (
    <details className="rounded-lg border border-line p-2 text-xs" open={open} data-testid="byok-mobile-guide">
      <summary className="byok-summary cursor-pointer font-semibold">手機設定教學（第一次使用請看）</summary>
      <ol className="ml-4 mt-1 list-decimal space-y-1.5">
        <li>在下方「AI 服務」選一個雲端服務（例如你已經有帳號的那一家）。</li>
        {hasKeyPage ? (
          <li>
            按「到 {page?.name} 建立金鑰」：會開一個新分頁。登入後建立一把 API 金鑰並複製。
            <span className="text-muted">（金鑰通常只顯示一次，建議先存到密碼管理工具。）</span>
          </li>
        ) : (
          <li>向這個服務的提供者取得 API 位址、模型名稱與金鑰（各服務的驗證方式不同），再填到下方欄位。</li>
        )}
        <li>
          回到本站：切換回「AI 備考室」這個分頁。Android 的 Chrome 通常在網址列旁有分頁按鈕（顯示數字的方框）；iPhone 的 Safari 請開啟分頁總覽，若沒看到分頁圖示，先點「更多」。
          <span className="text-muted">請保留本站分頁不要關閉；若手機重新載入網頁，尚未儲存的內容可能需要重填。</span>
        </li>
        <li>點進「API 金鑰」欄位，長按後選「貼上」；若沒有出現，可使用鍵盤提供的貼上功能。</li>
        <li>按「取得模型清單」，再從「模型」下方的選單選一個要用的模型（選單會在讀到清單後出現）。</li>
        <li>
          按「儲存並連線」。看到綠燈表示服務有回應，就可以回到對話開始提問；若提問時失敗，請依錯誤訊息檢查金鑰權限、模型或額度。
        </li>
      </ol>
      <ul className="ml-4 mt-2 list-disc space-y-0.5 text-muted">
        <li>「在這台裝置記住金鑰」：自己的手機可以勾選，之後不用再貼；共用或借來的手機不要勾。</li>
        <li>費用、免費額度與可用的模型以各服務官方說明為準；建議在服務後台設定花費上限。</li>
        <li>手機與電腦的設定不會同步，兩邊要各自設定一次。</li>
      </ul>
    </details>
  );
}
