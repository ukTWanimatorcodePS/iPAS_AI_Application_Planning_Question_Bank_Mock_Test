# v1.1.0 工作區複查

日期：2026-11-20（Asia/Taipei）。稽核者：Codex。

基準 `HEAD = origin/main = 55ca6c626e1114bb620b205606345ff13b6847c6`；本報告檢查未提交的工作區，包含 Git diff 不會顯示的新檔。已讀 AGENTS.md、REVIEW_REQUEST_v1.1.0.md 與 AI_TUTOR.md 第 0 節。

**結論：不同意以目前狀態提交並推送上線。** 既有自動檢查全部通過，但額外探測重現下列六項必修問題。這不是要求撤銷 BYOK 設計；使用者自備金鑰的架構可保留，需補上傳送邊界與取消流程。

## 一、必修問題

### F1［必修／P1］模型清單繞過信任確認，且切換服務沿用其他服務的金鑰

- 位置：`src/components/ByokSettings.tsx:37–43,66–71`；傳送端 `src/ai/byok/client.ts:217–239`。
- 重現：先儲存 OpenAI 假金鑰 `FAKE-AUDIT-KEY`，把 API 位址改成 `https://untrusted.example/v1`，保持「我信任此服務」未勾選，按「取得模型清單」。
- 實際攔截輸出：`GET https://untrusted.example/v1/models`，標頭 `authorization: Bearer FAKE-AUDIT-KEY`。未勾選仍送出。`fetchModels()` 只檢查 URL 合法性，未做與儲存／測試一致的信任確認。
- 第二條路徑：同一已儲存金鑰，服務改選 Ollama、不輸入新金鑰，再取得清單；實際請求 `http://localhost:11434/v1/models` 仍帶上述 OpenAI 假金鑰。選取服務與端點後的隱含沿用會把雲端金鑰交給另一個服務。
- 風險：使用者尚未確認信任的自訂服務，或不需要金鑰的本機服務，收到原服務的機密。CSP 允許 HTTPS，不能替代這個檢查。
- 建議：所有三個網路入口共用端點／信任檢查（取得清單不必要求已有模型名稱）；金鑰按服務及 origin 綁定，切換時清空或要求明確確認重新使用。僅輸入新網址不是信任確認。

### F2［必修／P1］檢索期間關閉導師或進入考試，仍會發出請求；鎖定也未中止既有串流

- 位置：`src/components/TutorChat.tsx:119–121,128–164`。
- 重現：送出合法問題「什麼是監督式學習？」；讓 `questionRelevance()` 尚未完成。在此期間分別 (a) 將目前情境設為 `locked`；(b) 將 enabled 設為 false。再讓檢索完成。
- 實際輸出：兩個案例都從 **0 次請求變成 1 次 POST /v1/chat/completions**；signal 未因關閉而預先 abort。證據使用真實 TutorChat 元件及狀態訂閱，延遲本機檢索，替代 prepareTurn 的資料組合，攔截真實 client 的 fetch，不使用付費金鑰。
- 原因：AbortController 到第一次 await 之後才建立；關閉 effect 當時沒有 controller；恢復後未重新檢查 enabled、size、locked。`ctxNow` 即使已 locked 仍會進入 prepareTurn。已開始串流時，effect 也沒有監聽鎖定或路徑變更。
- 建議：一開始就建立可取消的請求生命週期；每個 await 後及網路發送前重新確認請求代號、取消狀態、功能開關與有效情境。進入鎖定頁時取消進行中的回答，prepareTurn／發送層也應拒絕 locked 情境。將離題檢查放入 try/finally，避免載入失敗後 sending 永久鎖住。
- 限制：前端中止只能停止後續傳輸，不能保證供應商退還已開始計算的用量，文件不宜保證「中止後不再產生任何用量」。

### F3［必修／P2］Anthropic 分支未套用宣稱的 credentials／referrerPolicy

- 位置：`src/ai/byok/client.ts:163–170,222`。
- 重現：使用 SDK 1.4.0，以假金鑰及替代 fetch 擷取實際 SDK 產生的請求。
- 實際輸出：`https://api.anthropic.com/v1/messages` 的 RequestInit **沒有 credentials，也沒有 referrerPolicy**（均 undefined）；OpenAI 相容分支則有 `omit`／`no-referrer`。models.list 的 SDK 建構同樣沒有設定。
- 影響：這不代表雲端請求一定夾帶網站 Cookie；跨 origin 的預設 same-origin 通常不會。但它確實沒有達到請求文件與安全說明的承諾，來源資訊使用瀏覽器預設政策，同 origin 自訂端點還會有預設憑證行為。
- 建議：兩個 SDK 建構都明確給 `fetchOptions: { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }`，或共用安全 fetch 包裝器；測試擷取 SDK 實際 RequestInit，不只檢查授權標頭。

### F4［必修／P2］以歷史時間強制遞增，可能把新模考的真正開始時間推到未來

- 位置：`src/data/repo.ts:105–107,136–142`；受影響：`src/pages/Quiz.tsx` 的 startMs／限時計算與 `src/lib/timer.ts:2–4`。
- 重現：保留一筆同級別測驗，startAt 為 `2030-01-01T00:00:00.000Z`（時鐘曾調快、跨裝置備份皆可能出現）；現在建立 60 秒模考。
- 實際輸出：新紀錄 startAt = `2030-01-01T00:00:00.001Z`。這類日期可通過現有備份 iso 驗證。開始時間在未來時，wallElapsedSec 長時間都是 0，模考無法按實際 60 秒截止。
- 建議：startAt 保留實際時鐘時間；另外使用排序序號／建立順序管理顯示排列。若仍要校正同毫秒，只能在很小的合理範圍內處理，不可無上限信任歷史時間。

### F5［必修／P2］離題檢查的 AI 子字串與過寬指示語，放行明顯閒聊

- 位置：`src/ai/byok/check.ts:38–41,55–58`。
- 實際輸入與輸出（relevance = 0、hasPageContext = true）：
  - `請幫我寫一封email請假信` → `{ok:true}`。
  - `推薦Taipei餐廳` → `{ok:true}`。
  - `為什麼天空是藍色` → `{ok:true}`。
- 前兩句把 email／Taipei 裡的 ai 當 AI 學習用語；第三句僅因「為什麼」就被當成指向目前講義。這些會送出模型，與「常見請假信／餐廳在本機擋下」的需求不符。模型最後可能拒絕，但仍消耗一次請求。
- 建議：英文縮寫使用詞界，中文學習詞另外判斷；上下文放行需明確指向「這題／這段」或具有相關度，不能只靠一般問句詞。保留「用生成式 AI 寫詩是哪種應用」等合法學習反例測試。

### F6［必修／P2］「正解位置必與上次不同」在並行建立及補強題不成立

- 位置：`src/data/repo.ts:105–108,136–149`；`src/components/TutorPanel.tsx:75`。
- 並行重現：固定 Date.now 與 Math.random，對真實題 `original-L11101-0001` 同時 Promise.all 兩次 createSession。兩筆都成功，但 startAt 同為 `2026-11-19T23:13:20.000Z`，order 同為 `[A,D,B,C]`。讀取歷史→產生排列→寫入沒有交易保護；跨分頁也有此競爭。
- 補強路徑：TutorPanel 直接 `shuffleOrder(next)`，未提供上次 order；lastOptionOrders 只讀 quizSessions，不讀已記錄 optionOrder 的導師 attempts。因此補強題重現或下一次正式出題，可能仍在前一次看到的位置。一般連續測驗的既有測試無法涵蓋。
- 建議：如果維持「一定不同」的產品承諾，將共用的每題顯示順序讀寫放在跨分頁可序列化的 IndexedDB transaction，涵蓋補強題，並與實際開始時間分離。若只要求隨機，需先修改需求與介面說明，不能宣稱已保證不同。

## 二、建議項目與驗證限制

### S1［建議／P2］依據檢查接受不存在的引用編號

- 位置：`src/ai/byok/check.ts:13,23`；`src/components/TutorChat.tsx:58–63`。
- 輸入 `最高罰款 999999 元 [S999]`，輸出 `{uncitedNumbers:false, answeredDespiteNoSource:false}`，即使本回合根本沒有 S999。中文數字也不在目前檢查範圍。
- 建議：傳入當回合合法 ref 集合，未知引用警示；保留「引用存在也不代表內容正確」的限制。歷史回答的 S1 等也應與當時來源綁定，避免後一回合重新編號後混淆。
- 不把這當成能完整自動驗證真偽的問題；現有規則是啟發式提醒，不能取代人工內容審核。

### S2［建議／P3］補齊雲端實際相容性紀錄

- 位置：`docs/AI_TUTOR.md` 第 0 節、`src/ai/byok/client.ts`。
- 本次沒有使用付費金鑰，也未重做 Ollama 測試。Gemini／OpenRouter 的瀏覽器 CORS、供應商帳號權限、實際計費與完整雲端串流不宣稱通過。保留目前「未實測」說明，將 mock 通過與供應商端通過分列。

## 三、結構、程式與工具驗證

以下命令實際執行，日誌位於 `docs/audit-v110-*.log`：

| 檢查 | 實際結果 |
| --- | --- |
| typecheck | 通過 |
| ESLint | 原改動通過；新增稽核腳本後再次通過（final-lint.log） |
| validate:content | 835 題、0 錯誤、0 警告 |
| npm run test | 18 檔、312 項通過 |
| verify:python -- --strict --engine=cpython | CPython 3.14.10：80/80；講義 18/18 |
| verify:python -- --strict | Pyodide 314.0.8／CPython 3.14.2：80/80；講義 18/18 |
| build | 通過 |
| test:e2e | Edge：52 通過、2 選用截圖略過；桌面 1440／手機 390，Pages `/ipas-ai-prep/` 子路徑 |
| 額外稽核探測 | 原 312 加 8 項觀察測試，共 320 通過；這 8 項是確認缺陷存在，不是功能驗收通過 |

額外證據：`docs/audit-v110.config.mts`、`docs/audit-v110.probe.test.tsx`、`docs/audit-v110-probes.log`、`docs/audit-v110-observations.jsonl`。重跑：`npx vitest run --config docs/audit-v110.config.mts`。觀察檔採追加，包含多次探測；最終並行案例已改用真實完整題目 ID。

探測使用測試專用 IndexedDB、新建元件狀態及假金鑰，不讀取使用者實際憑證。第一次元件探測因 jsdom 沒有 scrollTo 未能執行兩例，補測試環境 stub 後重跑通過；不是網站瀏覽器錯誤。稽核腳本曾有一處空 catch 造成 lint，已只修正稽核腳本並重跑通過。

## 四、其他指定項目的結論

- **選項資料相容性：** 一般流程保留原始 option ID 計分，session.optionOrders／attempt.optionOrder 只影響顯示；Quiz、Results、Explanation、Review 歷史與 mock 導師有依當次 order 換算。舊欄位缺省回原順序，backup schema 保持 v3、欄位選填。既有 optionOrder 與 audit-v1-compat 等測試均納入 312 項。未發現本次修改題庫正文；位置依賴防線通過。保證不同與時鐘問題另見 F4／F6。
- **手機版本號：** package.json、APP_VERSION 同為 1.1.0；桌面、手機頁尾與功能選單均使用 APP_VERSION。E2E 含相關流程。
- **閒置用量：** 未發現開窗、快捷填字、重新整理自動呼叫生成 API 的一般路徑；三個網路入口都是明確按鈕。關閉期間延遲發送的例外見 F2。
- **考試與練習：** 一般未交卷 test/mock/review 情境有 locked；練習未揭示前 questionBlock 不帶答案，retrievalQuery 排除本題 ID。既有 E2E 通過。這不能覆蓋等待期間切頁的 F2，也不等於模型絕不會由概念自行推斷答案。
- **依據與 token：** 提示區分官方、自編內容、例子與無依據時拒答；輸出上限 2048、歷史最近 6 則、舊回答 600 字、檢索約 3000 字且只附當回合。這是字數上限，不能宣稱精確 token 或費用上限。依據與離題防線仍見 F5／S1。
- **SDK：** 安裝版本與鎖檔為 1.4.0；本機原始碼／型別與 mock 串流確認 beta.messages.stream、effort、fallbacks 參數及錯誤類別可用；Authorization Bearer 與錯誤訊息清理測試通過。已對照 [Anthropic 官方 fallback 文件](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#server-side-fallback)，`fallbacks:"default"` 與 beta 標頭本身不是錯誤。SDK transport 隱私缺漏另見 F3；未做付費實測。
- **回覆渲染：** skipHtml、圖片替換為純文字、連結限 https 且 noreferrer／noopener；未見直接 dangerouslySetInnerHTML 路徑。
- **CSP：** dist/index.html 確有 meta，script-src 為 self＋主題腳本 SHA-256，沒有 unsafe-eval；Pages 子路徑與含公式講義的 E2E 通過。connect-src 允許任意 https 是自選 API 的取捨，不是信任審核，也不防 F1。此政策不宣稱消除所有 XSS。
- **官方索引：** guidePointer 只使用檔名／版本／章節／頁碼定位，明確註明未收錄內文；初級標為所屬主題整章、非細項專屬頁碼。本次確認使用方式，未重新下載全部 PDF 或重新審核頁碼。
- **列印講義移出 Git：** git ls-files outputs/printable 與 git ls-files '*.pdf' 均無輸出；git check-ignore 確認 printable 路徑受忽略。未刪除本機講義、未動 backup/printable-local-commits，更未推送該分支。這不代表可任意 git add -f 或推送所有分支；後續應只暫存預期檔案。

## 五、交付與上線判定

本次只新增本報告與本機稽核腳本／紀錄，未修改正式程式、題庫或使用者資料；未提交、推送、重置或刪除未追蹤檔案。

**暫不同意提交並推送 v1.1.0 上線。** 請先處理 F1～F6，保留原測試並加入對應回歸測試，再重跑全套檢查及以上探測。S1、S2 可列後續改善，但不能把現有 heuristic 或 mock 結果當成 AI 內容正確性／真實雲端連線的保證。
