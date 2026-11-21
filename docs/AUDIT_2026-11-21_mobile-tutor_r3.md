# 手機版 AI 導師設定：第三輪複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `0ff93a9` 加未提交修改。依 `docs/REVIEW_REQUEST_2026-11-21_mobile-tutor.md`「第三輪」，核對 R2-1、R2-2 與新增教學文字。

## 結論

**同意本批手機設定修正發布。** R2-1、R2-2 已修好，未發現本輪範圍內新的必修問題。這是複查結論，不代表已提交或上線，也不取代實機 Android Chrome／iOS Safari 的驗收。

未修改正式程式或題庫；未提交、推送或 stage。僅新增本機報告、日誌、截圖副本與進度紀錄。未啟動、延長或變更使用者 Ollama 許可；轉接 runtime 測試使用隔離假上游與隨機埠，不使用真正 Ollama 的 11434／11435。沒有使用付費金鑰。

## 修正逐項驗收

### R2-1：服務選單提示——通過

位置：`src/components/ByokSettings.tsx:475–478`。

手機且選中 `ollama`、`ollama-bridge` 或 `lmstudio` 時，原本的桌機 `preset.hint` 已改為：

> 這是電腦用的本機服務；在手機上請看下方說明，改選雲端服務或其他相容服務。

實際重跑三種已存服務案例，上述三者的 `aria-describedby` 關聯內容皆為此手機說明；原本「下方本機暫時許可」「按啟動」「在 LM Studio 開啟本機伺服器」的提示不再出現。隱藏桌機教學與轉接面板、新手機說明存在的斷言也全部通過。

程式分支只替換手機上的上述本機 preset，桌機仍使用原 `preset.hint`。新增的 `byok-service-hint` test id 沒有取代原本的輔助說明關聯。正式單元測試另檢查整個表單不含 PowerShell、啟用 CORS、讓本站連到 Ollama 等桌機指令。

舊設定沒有被自動刪除／改存；「前往 AI 服務選單」在 showPicker 不存在或會丟例外時仍可聚焦服務選單，改選只改表單，localStorage 保留原設定，兩個退回案例通過。

### R2-2：教學展開列 44px——通過

位置：`src/styles/index.css:626–630`、`src/components/MobileSetupGuide.tsx:12`。

同一個上輪失敗探測、相同 Android UA 與 360×800 viewport，讀取教學 summary 的實際邊界：

```json
{"x":65.25,"y":730.515625,"width":229.5,"height":44}
```

上輪為 30px，本輪為 44px；`>=44` 斷言未放寬。CSS 對 AI 設定表單內 summary 加最小高度與上下 padding，沒有移除原生 details／summary 語意或加上會攔截原生操作的事件。其他地方的展開列不受此選擇器影響。

### 四種 profile 與舊流程——通過

原有 `docs/audit-mobile-tutor.browser.spec.ts` 原封不動重跑，5 項全部通過。本輪沒有修改此探測或正式測試。

| profile | viewport | 欄位／原有按鈕 | 金鑰連結／記住金鑰列 | 橫向溢出 |
| --- | --- | --- | --- | --- |
| Android | 360×800 | 44px | 44px | 無 |
| iPhone UA | 390×844 | 44px | 44px | 無 |
| iPad Mac UA＋觸控 | 768×1024 | 44px | 44px | 無 |
| Windows 觸控筆電 | 1440×900 | 44px | 44px | 無 |

四種 profile 的雲端模型清單不亂選驗證仍通過：假模型清單含 `babbage-002`、`chat-a`，原本空白時不選第一個；未選模型儲存會攔下，明選 `chat-a` 才更新。該流程只有一次模型清單請求、零次 chat 請求。手機隱藏本機偵測、桌機保留本機選項亦通過。

以上是系統 Edge／Chromium 在不同 UA、viewport 與觸控條件的實際渲染，不是四台實體裝置或 Safari 測試。

## 教學第 3、4 步的內容審核

### 第 3 步：切回本站——可接受

目前區分 Android Chrome 與 iPhone Safari，沒有再把「網址列旁的數字方框」說成所有手機的唯一介面；也補了不要關閉本站分頁、重新載入後未儲存內容可能要重填，符合表單草稿僅存 React state 的實作。

Android Chrome「通常在網址列旁有分頁按鈕」與 Google 官方的切換分頁說明一致；保留「通常」也避免對所有版本及版面做絕對承諾。[Google Chrome 官方分頁說明](https://support.google.com/chrome/answer/2391819?co=GENIE.Platform%3DAndroid&hl=en)

Safari「若沒看到分頁圖示，先點更多」的方向正確。Apple 的說明為：點 More 後選 All Tabs；Bottom／Top 版面則可直接點 Tabs。現有文字已可接受，**建議但不阻擋**補完整成「點『更多』→『所有分頁』（名稱依語言版本而異），再選本站」。[Apple Safari 官方分頁說明](https://support.apple.com/guide/iphone/open-and-close-tabs-iph489b9313f/ios)

### 第 4 步：貼上金鑰——可接受

「點進欄位，長按後選貼上；沒有出現時使用鍵盤提供的貼上功能」是合理的手機操作引導，且已提供替代方式，沒有要求網站讀取剪貼簿權限，也不會自動讀取或送出金鑰。Apple 官方文件確認文字欄位的編輯選單／貼上操作，並提供其他貼上手勢。[Apple 官方文字編輯說明](https://support.apple.com/guide/iphone/select-edit-and-move-text-iph1a9cae52c/ios)

此判斷是文件與文案審核；未在實體 Android／iPhone 的密碼欄位、原生剪貼簿選單或第三方鍵盤上操作。部分鍵盤沒有專用貼上按鈕，不能把此替代方式當成所有鍵盤皆有的保證；若要再潤飾，可加「若鍵盤有提供」。本輪不列必修。

### 其他採納文字

- 自訂服務沒有官方建鑰連結時，第 2 步已改為向供應者取得位址、模型與金鑰，不再指向不存在的按鈕；`hasKeyPage` 與目前 `KEY_PAGES` 衍生值一致。
- 綠燈已改為「服務有回應」，提問失敗再依錯誤檢查金鑰權限、模型或額度，沒有再保證模型一定可聊天。
- 改名「前往 AI 服務選單」與不支援 showPicker 時只聚焦的行為一致。
- 手機說明已限縮成一般 Ollama／LM Studio 的電腦使用情境，仍保留手機相容服務及可信 HTTPS 的自訂入口。

長教學摘要、開始設定入口、API 位址收進進階、額外貼上按鈕、標題列圖示 44px、實機軟鍵盤／Safari 驗證，維持後續改善，不阻擋本輪修正。

## 工具與程式驗證

| 檢查 | 本輪結果 |
| --- | --- |
| typecheck | 通過 |
| lint | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 25 個檔案、464 項通過，含 Windows 隔離轉接 runtime |
| build | 通過 |
| 正式 test:e2e | 58 通過、6 略過；42.6 秒 |
| `docs/audit-mobile-r2.extra.spec.ts` | 6 通過；7.4 秒，包含原先失敗的 summary、三種本機提示與兩種 picker 退回 |
| 四種 profile＋舊設定探測 | 5 通過；7.2 秒 |

正式 E2E 於 GitHub Pages 子路徑 `/ipas-ai-prep/` 測試，沿用隔離設定 `docs/audit-v110-r2.playwright.config.mts`、系統 Edge、2 workers、`TZ=UTC`。6 略過為 2 個選用截圖測試及新手機測試在不適用 profile 上的 4 個略過；未刪除失敗測試。

採一般 Windows 環境執行，避開上一輪已確認的受限制環境 HttpListener 問題。沒有連真實雲端 API、付費金鑰或使用者 Ollama。未修改題庫與 Python 執行內容，本輪未額外重跑 verify:python。

## 畫面、證據與限制

已檢視 360px 導師視窗的手機教學、已存本機服務的完整設定頁；配合四 profile 幾何量測，未發現本輪新增的橫向溢出。長教學需要垂直捲動；全頁截圖的固定導覽位置不作為原生手機 UI 證據。

- 日誌：`docs/audit-mobile-r3-typecheck.log`、`audit-mobile-r3-lint.log`、`audit-mobile-r3-validate-content.log`、`audit-mobile-r3-test.log`、`audit-mobile-r3-build.log`、`audit-mobile-r3-e2e.log`。
- 探測：`docs/audit-mobile-r3-extra.log`、`audit-mobile-r3-profiles.log`；使用既有兩份探測，未放寬斷言。
- 量測：`docs/audit-mobile-r2-extra.jsonl` 最後四筆為本輪 summary 與三種服務提示；`docs/audit-mobile-tutor-observations.jsonl` 最後五筆為本輪四 profile 與舊設定說明。
- 本輪截圖副本：`docs/audit-mobile-r3-tutorial.png`、`audit-mobile-r3-ollama-bridge.png`、`audit-mobile-r3-android-360.png`。原探測重跑會更新原本 r2／profile 截圖檔名，故另存本輪副本。

原生 Android Chrome／iOS Safari、WebKit、原生選單／剪貼簿與軟鍵盤尚未實機驗證；沒有登入服務建立金鑰或確認帳號額度。發布同意限於本報告列出的手機修正與已驗證範圍，不是整個題庫、所有 API 供應者或所有行動裝置的全面保證。
