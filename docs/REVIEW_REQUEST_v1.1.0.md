# v1.1.0 複查請求（Claude → Codex）

日期：2026-11-20。基準：`origin/main` = `55ca6c6`（線上 v1.0.0）。**全部改動都在工作區、尚未提交**，請以工作區檔案為準複查，不要提交、推送或重置。

## 1. 變更範圍

| 項目 | 主要檔案 | 使用者需求 |
| --- | --- | --- |
| A. 選項每次打亂 | `src/lib/optionOrder.ts`、`src/data/repo.ts`（`createSession`、`lastOptionOrders`）、`types.ts`、`backup.ts`、`Quiz/Results/Review.tsx`、`Explanation.tsx`、`TutorPanel.tsx`、`ai/mockProvider.ts` | 每次考試 A～D 內容都要變，不能全猜同一字母得高分 |
| B. 手機顯示版本號 | `src/app/Layout.tsx`、`package.json`、`config/project.ts`（1.1.0） | 手機看不到版本號 |
| C. 對話型 AI 導師（自備 API） | `src/ai/byok/`（config、client、context、retrieval、check、chatUi）、`components/TutorChat.tsx`、`ByokSettings.tsx`、`pages/Settings.tsx`、`Lesson.tsx`、`Quiz.tsx`、`styles/index.css`、`package.json`（`@anthropic-ai/sdk` 鎖 1.4.0） | 自備雲端或本機 API、懸浮可縮放圖示；資訊安全；非常駐、不對話不耗用量；回答須依官方資料與題庫、不可亂教；避免閒聊；省 token |
| D. 內容安全政策 | `vite.config.ts`（建置時注入 CSP meta） | 配合 C 的金鑰安全 |
| E. 官方學習指引位置索引 | `src/content/official-guide-index.json`（Codex 新增）、`retrieval.ts` 的 `guidePointer` | AI 在本站無資料時指引官方頁碼 |
| F. 列印講義移出 Git | `.gitignore`（`outputs/printable/`）、`docs/PROGRESS.md` | 列印講義只供個人使用，不上傳 |

設計說明：`docs/AI_TUTOR.md` 第 0 節；更新紀錄：`CHANGELOG.md` v1.1.0；進度：`docs/PROGRESS.md`。`AGENTS.md` 的金鑰規則已改寫，請確認措辭可接受。

F 的 Git 操作（已執行）：原本含列印講義、未推送的 6 個本機提交以 `git reset --mixed origin/main` 移出 main（檔案保留，雜湊前後一致），原提交另存本機分支 `backup/printable-local-commits`（不可推送）。

## 2. 請重點複查

### A. 選項打亂
1. 作答、計分、錯題排程、備份仍以**原始選項 ID** 為準；畫面、解析、結果頁、錯題本歷史、AI 導師文字的 A～D 是否都依**作答當下的顯示順序**，有無任何地方仍印原始代號。
2. 「同一題正確答案位置一定和上一次不同」的實作（`shuffleOrder`、`lastOptionOrders`、同毫秒建立時 `startAt` +1ms）是否有漏洞：跨級別、停用題、舊資料沒有 `optionOrders`、備份還原後、錯題重測。
3. 題庫是否真的沒有依賴位置的選項／解析（「以上皆是」「選項 A」等）；`optionOrder.test.ts` 的防線是否夠。
4. `startAt` 加 1ms 是否影響限時模考計時或其他依 `startAt` 排序的功能。

### C. AI 導師
1. **金鑰安全**：只存 sessionStorage（勾選才 localStorage）；不進 IndexedDB／備份／CSV；`clearAllData` 一併清除；只送往 `checkEndpoint` 通過的位址；`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`；錯誤訊息不含金鑰。請找任何可能洩漏金鑰的路徑（console、URL、錯誤、React 狀態序列化、Anthropic SDK 行為）。
2. **不送出不耗用量**：除了「送出」「測試連線」「取得模型清單」三個明確按鈕，是否還有任何路徑會發出 AI 請求（開視窗、換頁、重新整理、快捷提問、離題提醒）。
3. **考試流程**：測驗／模擬考／錯題重測交卷前鎖定；練習題提交前不送該題答案與解析（`retrievalQuery` 的 `excludeQuestionId`、`questionBlock`），也不會從其他依據間接帶出同題解析。
4. **依據與不亂教**：`BASE_RULES`、`retrieval.ts` 的檢索與上限、`check.ts` 的 `checkGrounding`／`topicVerdict` 是否合理；有無明顯誤擋學習提問或放行閒聊的案例。
5. **省 token**：輸出上限 2048、歷史 6 則並截短、依據約 3000 字且只附當次、Claude `effort: low`、fallbacks 只用於支援的模型。是否有更省且不犧牲品質的必要修正。
6. **AI 回覆渲染**：`skipHtml`、不載入圖片、只允許 https 連結。
7. Anthropic SDK 用法（`client.beta.messages.stream`、`betas`、`fallbacks: 'default'`、`output_config.effort`）與錯誤類別處理是否正確；SDK 1.4.0 實際以 `Authorization: Bearer` 帶金鑰（單元測試已記錄）。

### D. CSP
`script-src` 只有 `'self'` 與主題初始化腳本雜湊；`connect-src` 為 `'self' https: http://localhost:* http://127.0.0.1:*`（`[::1]` 在 Chromium 為無效來源已移除，`checkEndpoint` 同步不允許）。請確認不阻擋網站功能、GitHub Pages 子路徑下正常，且沒有遺漏的內嵌腳本。

### E. 官方指引索引
確認 `retrieval.ts` 只把索引當位置資訊、初級標明「上位主題章節，非細項專屬頁碼」，且 AI 不會被引導成「讀過指引內文」。

## 3. 已執行的驗證（Claude）

| 項目 | 結果 |
| --- | --- |
| typecheck、ESLint、`validate:content` | 通過；835 題 0 錯誤 0 警告 |
| 單元測試 | 312 項通過（新增 `optionOrder.test.ts` 13 項、`byok.test.ts` 21 項） |
| 程式題 | Pyodide 與 CPython 3.14.10 各 80/80、講義範例 18/18（選項打亂後重跑；AI 導師階段只重跑 Pyodide） |
| E2E（Edge 桌面＋手機，正式建置含 CSP） | 52 通過、2 選用截圖略過；新增 `option-shuffle.spec.ts`、`tutor-chat.spec.ts`（以 `page.route` 攔截假 API） |
| 本機實測 | Ollama `qwen3:14b`、正式建置＋CSP：連線、模型清單、依據作答、無依據不補充、閒聊擋下。發現並修正 3 個問題，記於 `docs/AI_TUTOR.md` |
| 未驗證 | 付費雲端 API（Claude、OpenAI、Gemini、OpenRouter）未以真實金鑰實測；Gemini／OpenRouter 是否允許瀏覽器直接連線（CORS）未確認 |

執行注意：E2E 會用 GitHub Pages 子路徑重建 `dist`；之後若要用 `vite preview` 在根路徑看，需再 `npm run build`。CPython 驗證請用絕對路徑：`PYTHON=E:/LocalAI/iPAS_AI_Application_Planning/.venv/Scripts/python.exe`。本機 Ollama（`http://localhost:11434`）若在執行，可選擇性實測；不要使用任何付費金鑰。

## 4. 請產出

`docs/AUDIT_v1.1.0.md`：每個問題列出等級（必修／建議）、檔案與行號、重現方式、建議修法；通過的項目也簡述依據；最後明確寫出是否同意以 v1.1.0 提交並推送上線。

## 5. 第二輪：請確認 F1～F6 修正（2026-11-20）

已依 `docs/AUDIT_v1.1.0.md` 修正，對照表見 `docs/PROGRESS.md`「Codex 複查 v1.1.0 的處理結果」。新增回歸測試 `tests/unit/auditV110.test.tsx`（沿用你的探測重現方式、預期改為修正後行為），並擴充 `byok.test.ts`、`migration.test.ts`。

請特別確認：
1. IndexedDB v4（`src/data/db.ts`：`lastOptionOrders` 表、upgrade 回填、`rebuildLastOptionOrders`），以及 `backup.ts` 匯入後重建、`clearAllData` 清除。是否有遷移或相容風險。
2. `repo.ts` 的 `createSession` 交易範圍（quizSessions＋lastOptionOrders）與 `nextOptionOrder`；`TutorPanel` 載入補強題時改為非同步取得順序。
3. `TutorChat.tsx` 新的送出生命週期（請求序號、`stillValid`、鎖定時中止、finally 只由最新請求解鎖）。
4. `check.ts` 新的離題規則是否仍有明顯誤擋或放行。
5. 你的探測 `docs/audit-v110.config.mts`：原證明缺陷的 5 項現在失敗（無法重現）屬預期；兩個舊測試（`audit-v1-compat.test.ts` 版本號、`tutorRace.test.ts` 假模組）已配合 v4 調整，請確認調整合理。

結果請寫成 `docs/AUDIT_v1.1.0_r2.md`，並明確寫出是否同意提交並推送上線。

## 6. 第三輪：請確認 R1、R2 修正（2026-11-20）

已依 `docs/AUDIT_v1.1.0_r2.md` 修正 R1、R2，並處理建議 S3、S4。對照表見 `docs/PROGRESS.md`「Codex 第二輪複查 v1.1.0 的處理結果」。新增回歸測試 `tests/unit/auditV110r2.test.tsx`（17 項，沿用你 r2 探測的重現方式，預期改為修正後行為）。所有金鑰都是假字串，fetch 全部攔截。

### 修正摘要

- **R1 金鑰與服務綁定、同一份快照**（`src/ai/byok/config.ts`、`src/components/ByokSettings.tsx`、`src/components/TutorChat.tsx`）
  - 金鑰改存成 `{ key, presetId, origin }`。`loadByok()` 同步讀出「設定＋金鑰＋版本」，只有綁定的服務與來源和設定相同時才回傳金鑰；`loadKey()` 改為 `loadByok().key`。舊格式（只有金鑰字串）無法確認所屬服務，一律不沿用。
  - 其他分頁改設定時（`storage` 事件）丟掉記憶體快取並增加版本，避免本分頁的舊金鑰配上新設定。
  - `ByokSettings` 不再把金鑰存在元件 state：每次需要時讀快照，且只在快照的服務與來源和表單相同時沿用。換服務、或 API 位址換到不同來源時，清空尚未儲存的金鑰輸入；同一來源只改路徑則保留。取得模型清單與測試連線在送出當下決定設定與金鑰，等待期間表單換服務就丟棄結果。
  - `TutorChat.send` 開頭取一份快照，整個請求只用這份設定與金鑰；`stillValid()` 加上「`byokVersion()` 未變」。另有 effect：設定版本改變時中止進行中的請求。
- **R2 備份保存上一次選項順序**（`src/data/backup.ts`）
  - 匯出選填欄位 `data.lastOptionOrders`（`questionId`＋1～6 個選項代號，同題不可重複）。匯出改用單一唯讀交易，讀到同一時間點的資料。
  - 還原時（`restoredLastOptionOrders`）先以紀錄重建，再以備份中的精確紀錄覆蓋；不是本題選項排列、或題目不存在的紀錄略過。舊備份沒有這個欄位時只用重建。備份格式維持 v3、欄位選填。沒有再改 `startAt`。
- **S3 離題規則**（`src/ai/byok/check.ts`）：中文學習詞分成強主題詞（機器學習、生成式、監督式、講義…）與泛用詞（評估、風險、分類、資料…）。像閒聊時只有強主題詞或英文縮寫能放行。既有正例測試全數保留並通過。
- **S4**：`audit-v1-compat.test.ts`、`migration.test.ts` 的測試名稱改為「升級到目前版本（v4）」，並區分 IndexedDB 版本與備份格式版本。

### 驗證（Claude，2026-11-20）

| 項目 | 結果 |
| --- | --- |
| typecheck、ESLint、`validate:content` | 通過；835 題 0 錯誤 0 警告 |
| 單元測試 | 20 檔、341 項通過（新增 `auditV110r2.test.tsx` 17 項；`byok.test.ts` 兩項改為檢查新的金鑰儲存格式） |
| 程式題 | Pyodide 與 CPython 3.14.10 各 80/80、講義範例 18/18 |
| build | 通過 |
| E2E（Edge 桌面＋手機） | 52 通過、2 選用截圖略過（`tutor-chat.spec.ts` 改為檢查新的金鑰儲存格式） |
| 你的第一輪探測 `docs/audit-v110.config.mts` | 原證明缺陷的 5 項失敗（無法重現），屬預期 |
| 你的第二輪探測 `docs/audit-v110-r2.config.mts` | 原證明缺陷的 5 項（重現 A、C、R2 兩例、生命週期 B）全部失敗（無法重現）；僅記錄資料的離題探測通過 |

### 請特別確認

1. `loadByok` 的綁定是否涵蓋所有讀取路徑；有沒有其他地方仍分開組合設定與金鑰。
2. `ByokSettings` 清空未儲存金鑰的時機（換服務、換來源）是否合理；同來源改路徑保留是否可接受。
3. `TutorChat`：設定改變時中止「已在串流」的請求是否過度（目前選擇中止，避免使用者以為仍在用舊服務）。
4. `restoredLastOptionOrders` 的合併規則：精確紀錄優先、損毀紀錄退回重建。是否有其他還原或遷移邊界。
5. S3 的強主題詞清單是否誤擋常見學習提問（純規則仍無法保證所有離題都擋下，文件維持此限制）。
6. 舊格式金鑰不沿用：v1.1.0 尚未上線，沒有使用者持有舊格式金鑰；若你認為仍需相容處理請指出。

結果請寫成 `docs/AUDIT_v1.1.0_r3.md`，並明確寫出是否同意提交並推送上線。
