# 手機版 AI 導師設定：第二輪複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `0ff93a9` 加未提交修改，依 `docs/REVIEW_REQUEST_2026-11-21_mobile-tutor.md`「第二輪」。

## 結論

**暫不同意發布本批修改。** 原本的欄位 40px、金鑰連結與勾選列尺寸問題已修好；預設雲端、保留舊設定、手機替代入口與雲端模型不亂選均通過。但仍有兩項 P2 必修：舊本機服務的 `preset.hint` 仍指向隱藏的桌機功能；新增教學的展開列只有 30px。

未修改正式程式或題庫；僅寫入本機稽核文件、探測、截圖、日誌及進度紀錄。未提交、推送、stage，未啟動、延長或變更使用者的 Ollama 許可。瀏覽器連線使用假 API／假金鑰；Windows 單元測試的轉接程式只連隔離的假上游與隨機埠，不使用真正的 11434／11435。

## 必修問題

### R2-1［P2］M3 仍有遺漏：服務選單下方仍叫手機使用者操作桌機功能

位置：`src/components/ByokSettings.tsx:475–477`，仍不分裝置直接輸出 `{preset.hint}`；提示文字來源為 `src/ai/byok/config.ts` 的本機 presets。

重現：Android 390×844，預先保存三種本機服務的正常預設位址，進入「設定 → AI 導師」。`LocalSetupGuide` 與轉接面板確實已隱藏，`byok-mobile-local` 也有顯示，但「AI 服務」下方、由 `aria-describedby` 關聯的提示仍是：

| 已存服務 | 實際提示摘錄 |
| --- | --- |
| `ollama-bridge` | 先在下方「本機暫時許可」按「啟動」，把指令貼到 PowerShell 執行轉接程式 |
| `ollama` | Windows 請改用下方「本機暫時許可」的轉接程式，macOS／Linux 請看「讓本站連到 Ollama」 |
| `lmstudio` | 在 LM Studio 開啟本機伺服器並啟用 CORS。資料不離開你的電腦 |

影響：在新手機說明與替代按鈕之前，使用者仍會看到不可完成的桌機步驟。Ollama 兩項是原本 M3 的直接漏改；LM Studio 同樣保留了不適合此手機流程的桌機提示。不能僅靠 `local-setup-guide` 的數量為零就判定所有指引已修完。

建議修法：手機且選中上述本機 preset 時，讓服務提示改用手機專用說明，或移除該桌機提示、交由 `byok-mobile-local` 說明；保留原設定與目前已選選項，不自動改存。桌機仍使用原提示。回歸測試應檢查整個表單，包含選單的輔助說明，而不只是教學元件是否存在。

證據：`docs/audit-mobile-r2-extra.jsonl` 的三筆 `hint`、`docs/audit-mobile-r2-ollama-bridge.png` 等三張截圖；額外探測三案皆失敗，原因皆為提示仍存在。

### R2-2［P2］新增手機教學展開列只有 30px

位置：`src/components/MobileSetupGuide.tsx:12`；現有 `.byok-form .btn/.field` 與 `.byok-check` 的 44px 規則沒有套到 `summary`。

實際輸入：Android UA、觸控裝置、360×800，第一次啟用 AI 導師，讀取 `byok-mobile-guide > summary` 的邊界。

實際輸出：`{ x:65.25, y:730.515625, width:229.5, height:30 }`；斷言預期 `>=44`，收到 `30`。

影響：原本欄位與按鈕的 M1 已修正，但本次新增的教學收合／展開控制仍低於本專案的 44px 手機觸控目標。這是專案要求的缺口，不宣稱單憑 30px 就一定違反所有無障礙標準。

建議修法：在 AI 導師設定的觸控／窄螢幕範圍內，讓該 `summary` 至少 44px，保留原生 `details/summary` 的鍵盤操作與展開語意；將教學展開列加入實際尺寸 E2E。不要只擴大圖示而不擴大可點範圍。

## 前輪項目與本輪四個重點

### M1–M3 與預設雲端

| 項目 | 結果 | 依據 |
| --- | --- | --- |
| 原 M1：欄位、按鈕尺寸 | 通過 | 下表四種 profile 的原有欄位與按鈕均為 44px |
| 原 M1：金鑰入口與記住金鑰勾選列 | 通過 | 兩者外層可點高度均為 44px；勾選框圖形本身不要求 44px |
| 新教學觸控目標 | 未通過 | R2-2，summary 30px |
| M2：本機／localhost 說明 | 通過本輪核心修正 | 已明說手機 localhost 指手機自身，並保留手機本機相容服務及可信 HTTPS 的 custom 入口；不再使用前輪「只能在執行它的那台電腦」的絕對說法 |
| M3：移除桌機教學元件、保留設定 | 通過 | 轉接面板及 LocalSetupGuide 不存在，新手機說明存在，localStorage 的舊 preset 不變 |
| M3：整個表單的提示 | 部分修正 | R2-1，preset.hint 仍漏改 |
| 無已存設定時預設雲端 | 通過 | 初始 anthropic，手機服務清單僅雲端與 custom；已存本機設定不強制改寫 |
| 雲端模型不隨便選第一個 | 通過 | 假清單 `[babbage-002, chat-a]` 下空白維持空白；未選模型儲存被攔；明選 chat-a 才更新 |

實際 Edge／Chromium 量測（使用 UA 與觸控模擬，不是四台實體裝置）：

| profile | viewport | 欄位高 | 原有按鈕高 | 金鑰連結高 | 記住金鑰列高 | 橫向溢出 |
| --- | --- | --- | --- | --- | --- | --- |
| Android | 360×800 | 44 | 44 | 44 | 44 | 無 |
| iPhone UA | 390×844 | 44 | 44 | 44 | 44 | 無 |
| iPad Mac UA＋觸控 | 768×1024 | 44 | 44 | 44 | 44 | 無 |
| Windows 觸控筆電 | 1440×900 | 44 | 44 | 44 | 44 | 無 |

### 重點 1：原探測重跑

先原封不動重跑前輪 `docs/audit-mobile-tutor.browser.spec.ts`：四種 profile 皆通過；第五項原本是「確認舊錯誤教學仍存在」的觀察探測，因元件已移除而找不到 summary，故 4 通過、1 失敗。此失敗是舊觀察預期已過時，不能算產品倒退。

保留原探測快照 `docs/audit-mobile-r2-original.spec.txt` 與原日誌後，只將該項改為驗證「桌機教學不存在、新說明存在、舊設定不被刪除」，同檔重跑 **5 通過**。四種尺寸斷言與雲端模型驗證未刪除。另新增獨立探測查整個服務提示與新教學尺寸，得到 **4 失敗、2 通過**；失敗斷言保留，沒有為了過關而放寬門檻。

### 重點 2：Android Chrome／iOS Safari 的教學

六步驟的主流程合理：選雲端 → 官方金鑰頁 → 回本站 → 貼上 → 選模型 → 儲存並連線。新分頁連結有 `noopener noreferrer`，不附加金鑰；費用、額度及手機／電腦設定不同步的提醒也合理。

分頁切換方面，Android Chrome 官方文件確實教使用網址列旁的切換分頁按鈕；現有文字適用此常見版面。[Google Chrome 官方說明](https://support.google.com/chrome/answer/2391819?co=GENIE.Platform%3DAndroid&hl=en)

iOS Safari 不宜只描述「網址列旁的數字或方框」：Apple 提供 Compact、Bottom、Top 等版面，Compact 的控制列還有 More 按鈕。建議教學補「Safari 請開啟分頁總覽；若沒看到分頁圖示，先點『更多』」，避免把單一版面說成所有手機的固定位置。[Apple Safari 版面說明](https://support.apple.com/en-gb/guide/iphone/ipha9ffea1a3/26/ios/26)、[Apple 瀏覽 Safari 說明](https://support.apple.com/guide/iphone/browse-the-web-iph1fbef4daa/ios)

在欄位貼上是合理的手機操作；iPhone 也有選取、編輯選單及其他貼上手勢，不必把長按說成唯一方法。建議文字為「點進金鑰欄，再長按選『貼上』；若沒有出現，可使用鍵盤提供的貼上功能」。Apple 文件確認文字欄位與貼上操作，但本輪沒有實測原生剪貼簿或密碼欄位的手機選單。[Apple 文字編輯說明](https://support.apple.com/guide/iphone/select-edit-and-move-text-iph1a9cae52c/ios)

「設定內容不會因為切換分頁而消失」應限縮為一般未重新載入的情況：`ByokSettings` 的尚未儲存表單、keyInput 在 React state，沒有未儲存草稿還原機制。建議補「請保留本站分頁；若手機重新載入網頁，未儲存內容可能需要重填」，並保留先把金鑰存密碼管理工具的提醒。這是防止過度承諾的建議，不要求為此把未儲存金鑰另存。

上述跨版本引導列為建議改善；本輪發布阻擋是 R2-1、R2-2。**沒有實體 Android Chrome 或 iOS Safari／WebKit 測試證據，不能把 iPhone UA 的 Edge 測試當作 Safari 通過。**

### 重點 3：兩個替代按鈕及 showPicker 退回

「改選 AI 服務」與「改用其他相容服務」足以提供不破壞原設定的入口。另測 `showPicker` 不存在、以及呼叫會丟例外的兩案：按鈕皆讓服務 select 取得焦點，仍可選雲端服務，原 localStorage 保持舊 preset，**2 通過**。

只聚焦可作為漸進式退回，不必阻擋發布；但不等於所有手機瀏覽器會直接展開選單。建議文案補「已移到上方選單，請點選服務」，或按鈕叫「前往 AI 服務選單」。`showPicker()` 並非所有主要瀏覽器均支援，現有 feature detection 加 try/catch 的方向正確。[MDN showPicker 文件](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement/showPicker)

### 重點 4：其他建議是否可留後續

可以。API 位址收進進階、額外貼上按鈕、整個導師標題列圖示 44px、實機軟鍵盤與 Safari 驗證，可分後續改善；與本批明確新增且未達目標的教學 summary 分開處理。

其他非阻擋建議：

- 第一次預設展開的長教學，在 360px 對話視窗會把服務欄位推到下方；可加簡短摘要或「開始設定」帶至服務欄位，保留完整教學可重開。
- 自訂服務沒有「到官方頁面建立金鑰」按鈕，教學目前仍產生此通用步驟；可改提示向該服務供應者取得位址、模型與驗證方式。
- 綠燈只表示連線檢查有回應，不必承諾金鑰／所選模型一定可聊天；可沿用現有狀態訊息，教學第六步加「若提問時失敗，再依錯誤訊息檢查權限或額度」。
- 「本機模型要在電腦下載與執行」仍可改「一般電腦版 Ollama／LM Studio 需要先在電腦執行」，與同段承認手機本身可有相容服務更一致。

## 工具與程式驗證

| 項目 | 本輪結果 |
| --- | --- |
| typecheck | 通過 |
| lint | 通過；探測新增後另重跑通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test（一般 Windows） | 25 個檔案、464 項全通過，含 11 項隔離轉接 runtime |
| build | 通過 |
| 正式 test:e2e | 58 通過、6 略過；44.2 秒；GitHub Pages 子路徑 `/ipas-ai-prep/` |
| 前輪原探測 | 4 通過、1 過時觀察預期失敗，已保留原檔與日誌 |
| 前輪探測調整為修復後元件預期 | 5 通過；8.0 秒 |
| 新增邊界探測 | 4 失敗、2 通過；12.3 秒；對應兩類 P2 與兩種 picker 退回 |

6 個正式 E2E 略過＝2 項選用截圖＋新測試在不適用的桌機／手機 profile 合計 4 項，非刪除失敗案例。

首次受限制執行環境的 `test` 出現 `HttpListener ... Operation is not supported on this platform`，使 runtime 6 失敗、5 略過，其餘 453 通過；原始日誌保留。切換一般 Windows 執行環境後完整 464 項通過。首次受限制環境的 E2E 卡在預覽服務可達性，已中止該次，再於一般 Windows 重跑通過。未修改測試或 production code 來避開這些環境問題。

正式 E2E 使用現有隔離設定 `docs/audit-v110-r2.playwright.config.mts`、系統 Edge、2 workers；設 `TZ=UTC` 維持既有日期測試條件。真實服務能力、帳號登入／建鑰、付款、Safari 原生選單、手機剪貼簿及軟鍵盤均未實測。題庫及 Python 執行內容未改，本輪未額外重跑 verify:python。

## 畫面與證據

已檢視 360px 導師初始畫面、390px 模型／金鑰區、完整新教學與舊本機設定畫面；表單無橫向溢出。全頁截圖中的固定導覽位置不作為手機原生 UI 證據。

- `docs/audit-mobile-r2-typecheck.log`、`audit-mobile-r2-lint.log`、`audit-mobile-r2-final-lint.log`
- `docs/audit-mobile-r2-validate-content.log`、`audit-mobile-r2-test.log`、`audit-mobile-r2-test-native.log`、`audit-mobile-r2-build.log`
- `docs/audit-mobile-r2-e2e.log`、`audit-mobile-r2-e2e-native.log`
- `docs/audit-mobile-r2-original-browser-native.log`、`audit-mobile-r2-browser-regression.log`
- `docs/audit-mobile-r2.extra.spec.ts`、`audit-mobile-r2.extra.config.mts`、`audit-mobile-r2-extra.log`、`audit-mobile-r2-extra.jsonl`
- `docs/audit-mobile-tutor-observations.jsonl`：本輪最後四筆 profile 實際幾何資料，以及 `saved-local-phone-r2`
- `docs/audit-mobile-r2-tutorial.png`、`audit-mobile-r2-ollama-bridge.png`、`audit-mobile-r2-ollama.png`、`audit-mobile-r2-lmstudio.png`、`audit-mobile-r2-saved-local.png`
- `docs/audit-mobile-android-360-top.png`、`audit-mobile-iphone-390-key.png`：本輪重跑後的 compact 實際畫面

處理 R2-1、R2-2 後，建議重跑新增失敗探測與四種 profile，再決定發布。本報告本身不授權提交、推送或變更本機 AI 許可。
