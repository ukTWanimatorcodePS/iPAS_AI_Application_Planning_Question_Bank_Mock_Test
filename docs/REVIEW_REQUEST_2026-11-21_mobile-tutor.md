# 複查請求：手機版 AI 導師設定（Claude → Codex，2026-11-21）

基準 `0ff93a9`（v1.2.2 已發布）加未提交修改。全部未提交、未推送。

## 使用者回報與需求
使用者用手機開 AI 導師設定，發現「自動偵測本機 AI」不能點，自己也沒用過手機串接模型 API，請 Claude 與 Codex 優化手機版體驗。

## 原因
1. 對話框內的設定（compact）只在選了本機服務時才顯示「自動偵測本機 AI」，預設是 Claude，所以手機上看不到。
2. 更根本：手機的 `localhost` 是手機自己，連不到電腦上的 Ollama／LM Studio；轉接程式只接受同一台電腦的連線（F1），本站只允許本機 http（區網 http 不支援，保護金鑰）。所以就算顯示，手機上偵測也不會找到。
3. 按鈕 36px，低於規格的 44px。
4. 雲端模型空白時「取得模型清單」自動選清單第一個（依字母排序，例如 OpenAI 可能是舊的或不能對話的模型）。

## 變更
| 檔案 | 內容 |
| --- | --- |
| `src/ai/byok/device.ts`（新） | `isMobileDevice(ua, maxTouchPoints)`、`KEY_PAGES`（Anthropic Console、OpenAI、Google AI Studio、OpenRouter 的建立金鑰頁） |
| `src/components/ByokSettings.tsx` | 手機：說明區塊（`byok-mobile-note`）、不顯示自動偵測與轉接程式區塊、服務選單不列 ollama／ollama-bridge／lmstudio（目前已選的保留，自訂仍可）。所有裝置：雲端服務金鑰欄下方「建立金鑰」連結（新分頁、noopener noreferrer）。雲端模型空白時「取得模型清單」只在預設模型在清單中才填入，否則顯示「（請選擇模型）」並請使用者選 |
| `src/styles/index.css` | `.byok-form` 在 `(pointer: coarse), (max-width: 640px)` 時 `.btn`、`.field` 至少 44px，勾選框放大 |
| `tests/unit/byokMobile.test.tsx`（新，8 項） | 裝置判斷（含以 Mac 字串回報的 iPad、觸控筆電不算）；Android／iPhone／iPad 的說明、無偵測、選單內容；已存本機服務時保留選項但不顯示轉接區塊；電腦版不受影響；四個金鑰連結的網址與 target／rel；雲端模型不自動選第一個 |
| `CHANGELOG.md`、`docs/AI_TUTOR.md` | 尚未發布段落與設計說明 |

## 驗證
- typecheck、lint、validate:content（835 題）、test **463 通過**（Windows；Linux 使用者代理字串設定重跑 463 通過）、build。
- E2E：第一次 53 通過、1 失敗（`learning-flow.spec.ts` 初級／中級切換，desktop-1440，與本次無關；單獨重跑該檔 14 通過）；完整重跑 54 通過、2 略過。
- 預覽（375×812、Android 使用者代理字串）：對話框設定顯示手機說明、服務選單只有雲端與自訂、金鑰連結、所有按鈕 44px、`scrollWidth` 等於視窗寬度。

## 請複查
1. 手機上不提供本機 AI 的做法與說明是否正確、清楚（不宣稱手機上完全不能用本機程式：自訂網址仍可輸入 localhost，例如手機本身執行的伺服器）。
2. `isMobileDevice` 的判斷範圍（平板、折疊機、桌機模式瀏覽器、觸控筆電）。只用來調整畫面，不是安全判斷。
3. 金鑰連結網址是否正確、是否應補其他說明（例如費用或額度以各服務為準）。
4. 雲端模型不自動選的改動是否會讓原本依賴自動填入的流程變差（Anthropic 有預設模型會照常填入）。
5. 44px 樣式只套在 AI 導師設定；其他頁面的手機觸控大小不在本次範圍。
6. 還有哪些手機體驗值得改（例如把「API 位址」收進「進階」、貼上金鑰按鈕），請列建議，不必實作。

結果請寫成 `docs/AUDIT_2026-11-21_mobile-tutor.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可。

---

# 第二輪：Codex 手機複查（docs/AUDIT_2026-11-21_mobile-tutor.md）M1–M3 的修正，以及使用者追加需求（未提交）

使用者在修正期間追加：「手機版下載模型比較不方便，預設使用雲端模型；也要有教學，手機操作和電腦不同。」

| # | Codex 發現 | 修正 |
| --- | --- | --- |
| M1 | 欄位實際仍 40px | 原因：Tailwind v4 的 `!min-h-[40px]` 在 `@layer utilities`，`!important` 時有層的規則勝過沒有層的規則，所以未分層的 44px 規則輸掉。改把手機規則放進 `@layer utilities`，由兩個 class 的選擇器權重勝出。「建立金鑰」改為 `btn btn-sm` 按鈕式連結；「記住金鑰」勾選列加 `.byok-check`（44px、勾選框 1.25rem）。新增 E2E `tests/e2e/tutor-mobile.spec.ts` 在 Pixel 7（390×844）實際量服務選單、API 位址、模型、金鑰、建立金鑰連結、勾選列與五個按鈕的高度 ≥44，並檢查沒有橫向溢出。**變異測試**：把規則移回未分層，該 E2E 失敗（Received 40）；還原後通過 |
| M2 | 說明過度概括 | 改為：「手機上預設使用雲端服務：本機模型要在電腦上下載與執行，而手機的 localhost 指向手機本身，不會連到電腦上的 Ollama 或 LM Studio；本站的自動偵測與 Windows 轉接程式只適用同一台電腦。若你已有在手機本機執行的相容服務，或可信的 HTTPS 位址，可選『其他 OpenAI 相容服務』自行設定。」程式註解同步修正（`device.ts`、`ByokSettings.tsx`），註明是畫面偏好、不是安全邊界 |
| M3 | 手機保留舊本機設定仍指向隱藏的轉接面板 | 手機上目前服務是 ollama／ollama-bridge／lmstudio 時，不顯示 `LocalSetupGuide` 與轉接區塊，改顯示 `byok-mobile-local`：說明這個位址在手機上指向手機本身、電腦版功能在手機上不提供，提供「改選 AI 服務」（聚焦並在支援時 `showPicker()`）與「改用其他相容服務」；不自動刪除或改存設定。手機上用這些服務連線失敗時，訊息改為說明位址指向手機本身，不指向看不到的步驟。自訂 localhost（手機本機服務）仍顯示通用設定說明 |
| 建議 | 金鑰連結補說明 | 加「可能需要登入或設定付款；費用、免費額度與限制以各服務官方說明為準」；Anthropic 連結改為官方新入口 `https://platform.claude.com/settings/keys` |

使用者追加：
- **預設雲端**：手機上沒有任何已存設定時預設 Claude（雲端），選單只列雲端與自訂（原本就是 `BYOK_PRESETS[0]`，本輪加測試確認）。
- **手機設定教學**：新元件 `src/components/MobileSetupGuide.tsx`（`byok-mobile-guide`），六步驟：選雲端服務 → 按「到 … 建立金鑰」（新分頁、登入、建立、複製；金鑰通常只顯示一次）→ 點瀏覽器分頁按鈕切回本站（設定不會消失）→ 在金鑰欄長按「貼上」→「取得模型清單」後從選單選模型 →「儲存並連線」看到綠燈。另說明記住金鑰（自己的手機可勾、共用不要）、費用以官方為準、手機與電腦設定不同步。沒有任何已存設定時預設展開。

## 測試
- 單元 `tests/unit/byokMobile.test.tsx`（9 項）：文案（含不出現「只能在執行它的那台電腦上使用」、提到自訂服務）、教學展開與「長按」、預設 anthropic；M3 三種已存本機服務（保留選項、不顯示 `local-setup-guide`／轉接區塊、顯示說明、教學收合、「改用其他相容服務」切到 custom、localStorage 設定未改）；手機上本機服務連線失敗的訊息。
- E2E `tests/e2e/tutor-mobile.spec.ts`（4 項；手機 3 項、電腦 1 項）。
- typecheck、lint、validate:content（835 題）、test **464 通過**（Windows；Linux 使用者代理字串設定重跑 464 通過）、build、E2E **58 通過、6 略過**（新檔各在另一尺寸略過）。
- 預覽 375×812（Android 使用者代理字串）：首次開啟時說明與教學展開、無橫向溢出。

## 請複查
1. 重跑你的 `docs/audit-mobile-tutor.browser.spec.ts`（四種 profile 的 44px 斷言、舊本機設定指引）。
2. 教學內容是否正確、適合手機新手（分頁切換、長按貼上的描述在 Android Chrome 與 iOS Safari 是否都成立）；有沒有該補的步驟。
3. `byok-mobile-local` 的兩個按鈕是否足夠；`showPicker()` 不支援時只聚焦是否可接受。
4. 你上一輪列的其他建議（API 位址收進「進階」、貼上金鑰按鈕、標題列圖示 44px、實機驗證）本輪未做，請確認是否列為後續即可。

結果請寫成 `docs/AUDIT_2026-11-21_mobile-tutor_r2.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可。

---

# 第三輪：Codex 手機第二輪（docs/AUDIT_2026-11-21_mobile-tutor_r2.md）R2-1、R2-2 的修正（未提交）

| # | Codex 發現 | 修正 |
| --- | --- | --- |
| R2-1 | 手機上已存本機服務時，服務選單下方的 `preset.hint` 仍是電腦版步驟（本機暫時許可、PowerShell、啟用 CORS） | 手機且目前服務為 ollama／ollama-bridge／lmstudio 時，提示改為「這是電腦用的本機服務；在手機上請看下方說明，改選雲端服務或其他相容服務。」（`data-testid="byok-service-hint"`，仍由 `aria-describedby` 關聯）；電腦版維持原提示 |
| R2-2 | 教學展開列 30px | `.byok-form summary` 在觸控／窄螢幕時 `min-height: 44px; padding-block: 0.75rem`（同一 `@layer utilities` 規則內），保留原生 `details／summary` 語意與鍵盤操作；同時套到表單內其他展開列（例如自訂本機服務的通用說明） |

採納的非阻擋建議：
- 教學第 3 步分別說明 Android Chrome（網址列旁顯示數字的分頁按鈕）與 iPhone Safari（開啟分頁總覽；沒看到分頁圖示先點「更多」），並註明請保留本站分頁、重新載入時尚未儲存的內容可能需要重填（不再承諾「不會消失」）。
- 第 4 步：「點進 API 金鑰欄位，長按後選『貼上』；若沒有出現，可使用鍵盤提供的貼上功能」。
- 第 6 步：綠燈表示服務有回應；提問失敗時依錯誤訊息檢查金鑰權限、模型或額度。
- 自訂服務沒有官方金鑰頁時，第 2 步改為「向這個服務的提供者取得 API 位址、模型名稱與金鑰」。
- 「改選 AI 服務」按鈕改名「前往 AI 服務選單」（不支援 `showPicker` 時只聚焦也符合字面）。
- 手機說明改為「一般的 Ollama、LM Studio 要先在電腦上下載模型並執行」。
- 未做（列後續）：長教學在 360px 對話框把欄位往下推的摘要／「開始設定」按鈕、API 位址收進進階、貼上按鈕、標題列圖示 44px、實機 Safari／Chrome 驗證。

## 測試
- 單元 `byokMobile.test.tsx`：三種已存本機服務檢查 `byok-service-hint` 為手機說明，且整個表單不含「本機暫時許可」「PowerShell」「啟用 CORS」「讓本站連到 Ollama」等電腦版步驟。
- E2E `tutor-mobile.spec.ts`：尺寸清單加入教學 `summary`；已存本機服務案例檢查提示與整個表單不含電腦版步驟。
- **變異測試**：還原舊提示 → 單元 1 失敗、E2E 1 失敗；拿掉 summary 的 44px → E2E 尺寸測試失敗；還原後全部通過。
- typecheck、lint、validate:content（835 題）、test **464 通過**（Windows；Linux 使用者代理字串設定重跑 464 通過）、build、E2E **58 通過、6 略過**。

## 請複查
1. 重跑 `docs/audit-mobile-r2.extra.spec.ts`（三種已存本機服務的整個表單提示、教學 summary 尺寸）與四種 profile。
2. 教學第 3、4 步的 Android／iOS 描述是否精確。

結果請寫成 `docs/AUDIT_2026-11-21_mobile-tutor_r3.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可。
