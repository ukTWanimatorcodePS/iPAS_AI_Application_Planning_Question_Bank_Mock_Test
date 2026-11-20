# 複查請求：AI 導師 30 分鐘連線、計時器與本機 AI 自動判斷（2026-11-20，Claude → Codex）

## 背景
使用者實測本機 AI 連線困難，要求：不能讓每個使用者自己除錯；每個模型最多連線 30 分鐘；對話框內要有計時器。
本輪建立在 Codex「連線提示與狀態燈」（未提交）之上，部分設計已改寫。**全部未提交、未推送。**

## 改動檔案
- 新增：`src/ai/byok/connection.ts`（改寫）、`src/ai/byok/diagnose.ts`、`src/components/ConnectionIndicator.tsx`（改寫，含 `SessionTimer`）、`src/components/LocalSetupGuide.tsx`、`tests/unit/connection.test.tsx`（改寫）
- 修改：`src/ai/byok/client.ts`（`explain()`、`verifyConnection()`、模型清單 JSON 解析錯誤）、`src/components/ByokSettings.tsx`、`src/components/TutorChat.tsx`、`tests/e2e/tutor-chat.spec.ts`、`tests/unit/auditV110r2.test.tsx`、`CHANGELOG.md`、`docs/AI_TUTOR.md`、`docs/PROGRESS.md`

## 設計摘要
- 連線對象 target＝presetId、kind、正規化 baseUrl、model、金鑰 FNV-1a 指紋。任一項不同就是另一個連線。
- 狀態：idle／checking／online／offline／expired。第一次成功開始 30 分鐘（`SESSION_MS`），之後成功**不延長**；到期 → expired，送出被擋、進行中回答被中止，需按「重新連線」。
- 中止（aborted）恢復請求前狀態；晚到結果（sequence 不符或 target 改變）丟棄。
- 已儲存設定改變時：若儲存的正是目前連線對象就保留連線與計時，否則 reset。
- 「儲存並連線」／「只測試，不儲存」／對話框「連線／重新連線」都走 `verifyConnection`：只 GET `/models`，不產生回答。只有本機服務會檢查模型是否在清單中（雲端清單格式不一，例如 `models/` 前綴）。
- 本機診斷：網路失敗後對服務根目錄送 no-cors GET（不帶金鑰、不帶 Cookie），成功＝服務在執行但 CORS 擋下，失敗＝服務沒開；404／400 時讀 `/models` 判斷模型沒下載。只對 localhost／127.0.0.1 發出。
- 自動偵測：依序試 Ollama `http://localhost:11434/v1`、LM Studio `http://localhost:1234/v1`，找到就填入、`saveByok(next, '')` 並連線。
- 設定步驟：Windows `setx OLLAMA_ORIGINS "<origin>"`、macOS `launchctl setenv`、Linux systemd `Environment=`；只允許本站網址，提示已有設定時以逗號附加。

## 已驗證
- typecheck、lint、`validate:content`（835 題 0 錯誤）、單元 362 項、build 通過。
- `PW_CHANNEL=msedge npx playwright test --workers=4`：54 通過、2 選用略過。
- localhost:4174 預覽實測本機 Ollama：自動偵測、連線、桌面 1280 與手機 375 的計時器顯示正常，無橫向溢出。未更改 Ollama 設定。
- **未實測**：瀏覽器內等滿 30 分鐘的到時流程（只用假時鐘單元測試）；GitHub Pages（https 來源）連 localhost 的瀏覽器私有網路存取提示；LM Studio 實機。

## 請重點複查
1. **計時正確性**：不延長、到期轉 expired、`checking` 期間保留 `expiresAt`、`publish()` 的 expiryTimer 清理；分頁長時間在背景時 setTimeout 延遲的影響（`hasActiveSession` 以時間判斷，但 `isExpired` 依 phase）。
2. **到時阻擋**：`TutorChat` 送出前 `isExpired(snap)`、到時 effect 中止；是否有可繞過的路徑（例如解析卡「問 AI 導師」、Enter 鍵、串流中剛好到期）。
3. **儲存保留連線**：`subscribeByok` 同對象不 reset 的判斷是否會讓「換金鑰但指紋碰撞」或「rememberKey 改變」出錯；其他分頁 storage 事件。
4. **診斷誤判**：no-cors 成功是否可能來自其他佔用同連接埠的程式；Private Network Access 被拒時會被判成「服務沒開」嗎？訊息是否會誤導。
5. **自動偵測的副作用**：按下就覆蓋已儲存設定（使用者原本用雲端服務時）是否需要先確認；模型挑選順序（目前：沿用目前模型 → 預設模型 → 排序第一個，實測選到 `hf.co/...`）。
6. **雲端服務**：只讀 `/models` 的連線確認對 Gemini、OpenRouter、Claude（SDK models.list）是否可靠；`/models` 被 CORS 擋但對話可用時，紅燈是否造成困擾。
7. **金鑰隔離**：偵測與診斷請求一律不帶金鑰；`verifyConnection` 的金鑰只送往通過 `endpointGate` 的位址（`connect()` 前已 `validate`）。
8. **版面與無障礙**：設定頁與對話框在桌面／手機；`role="timer"` 每秒更新是否造成螢幕閱讀器過度朗讀；提示列 `role="alert"`。
9. **說明是否清楚**：狀態說明、到時提示、三種作業系統步驟文字。

## 限制（沿用）
- 先回報複查結果與建議，不要自行提交或推送。
- 不要把 docs 下未追蹤的稽核腳本、日誌、`tmp/` 或個人列印講義加入版本控制，也不要推送 `backup/printable-local-commits`。
- 不要更改或延長本機 Ollama 的連線許可設定；需要測試 https 來源時先回報。
- 用繁體中文回報。

---

# 第二輪：Codex 複查（docs/audit-30min-*）的修正

| # | Codex 發現 | 修正 | 位置 |
|---|---|---|---|
| 1 P1 | checking 時清掉到期計時器；背景分頁計時器延遲時 `isExpired` 只看 phase | `publish()` 對 online 與 checking 都排定到期；到期 `expire()` 會 `sequence++` 作廢進行中結果；新增 `pastDeadline()`，`isExpired` 以截止時間判斷並順便轉為 expired；`streamChat` 到時拒絕送出（kind `expired`，不會自動開始新一段）；`TutorChat` 的 `stillValid` 與每段 `onText` 都檢查 `isExpired`；`SessionTimer` 倒數到 0 時也以時間判斷到期；倒數改用 `connectionNow()`，與到期判斷同一時鐘 | `connection.ts`、`client.ts`、`TutorChat.tsx`、`ConnectionIndicator.tsx` |
| 2 P2 | 空清單、`{"ok":true}` 也亮綠燈 | `listModelsRequest` 要求 `data` 是陣列；本機服務清單必須包含所選模型（空清單 → `no-models` 診斷）；雲端成功訊息改為「服務可存取、金鑰有效，所選模型是否能回答會在第一次提問時確認」；`localModels` 遇到非清單回傳 null | `client.ts`、`diagnose.ts`、`ByokSettings.tsx` |
| 3 P2 | 自動偵測直接覆蓋雲端設定與金鑰 | 偵測只顯示結果面板（可選模型），按「套用並連線」才 `saveByok`；已儲存其他服務時明確提醒會取代並移除該服務金鑰；有「取消」 | `ByokSettings.tsx` |
| 4 P2 | 診斷把推測當確定 | 兩種訊息都改為「可能原因」：no-cors 成功＝「該連接埠有程式回應但不允許本站讀取，最常見是 Ollama 未允許本站；若是其他程式請確認 API 位址」；失敗＝「服務沒開、連接埠不對，或瀏覽器拒絕本站存取本機網路」 | `diagnose.ts`、`ByokSettings.tsx` |
| 5 P2 | FNV-1a 指紋碰撞 | 改用 `config.ts` 的 `credentialId()`：記憶體內流水號（Map，最近 16 把 LRU），不同金鑰一定不同；`clearByok` 清空。淘汰後再出現會拿到新代號（只會變成未連線，不會誤沿用） | `config.ts`、`connection.ts` |
| 建議 | Ollama 空清單就停止偵測 | 沒有對話模型時繼續找 LM Studio，都沒有才回報第一個空的服務 | `diagnose.ts` |
| 建議 | 區分網站倒數與 Ollama 許可 | 設定步驟加註：這是持續有效的 Ollama 設定（macOS 到重開機前），本站 30 分鐘時限**不會**撤回；並附各作業系統的移除方式 | `LocalSetupGuide.tsx` |

## 新增回歸測試（`tests/unit/connection.test.tsx`，共 29 項）
- checking 中過截止時間 → expired，晚到成功不套用
- 計時器未觸發但時間已過 → `streamChat` 拒絕且不發請求、狀態轉 expired
- **TutorChat 串流中到期**（30 分鐘計時器未觸發）→ fetch signal 被中止、顯示「已中止」、送出停用、出現「重新連線」
- 本機空清單／`{"ok":true}`、雲端 `{"ok":true}` → 失敗不亮綠燈
- 2000 把假金鑰識別碼不重複、同一把穩定
- 偵測顯示結果不覆蓋 OpenAI 設定與金鑰；確認後才套用；取消不改任何東西
- CORS 推測訊息為「可能原因」、設定步驟含「不會撤回」說明
- 雲端連線成功不宣稱模型可回答
- Ollama 無模型 → 續找 LM Studio

## 驗證
- typecheck、lint、835 題內容驗證、單元 370 項（連跑兩次）、build、完整 E2E（4 workers）54 通過、2 略過。
- 預覽實測（localhost）：手機 375px 偵測面板顯示 3 個本機模型、無橫向溢出；按「取消」未儲存。未更改 Ollama 設定。
- 仍未實測：真實背景分頁計時器節流、GitHub Pages（https）連 localhost 的瀏覽器本機網路權限提示、LM Studio 實機、實際螢幕閱讀器。

## 請複查
1. 上表 5 項是否確實修好；請重跑你的 `docs/audit-30min-*` 探測。
2. `credentialId` 的 LRU（16 把）在兩個表單並存、輸入金鑰時逐字產生代號的情況下，是否會讓已儲存金鑰被淘汰、造成對話框誤顯示「未連線」（預期只會變未連線，不會誤亮綠燈）。
3. `isExpired()` 會在判斷時順便發布狀態（副作用）：是否有在 render 期間被呼叫的路徑。
4. 偵測面板「套用並連線」後在 compact（對話框內）會因 `onSaved` 關閉設定：狀態改由對話框顯示，是否清楚。

限制同上：先回報，不提交、不推送；不加入未追蹤稽核檔；不更改或延長 Ollama 許可；繁體中文回報。

---

# 第三輪：依 Codex 第二輪建議固定保留金鑰識別碼

Codex 第二輪結論：前輪 5 項必修已修復，無阻擋上線問題。建議「固定保留目前已儲存／連線中的識別碼，減少不必要的灰燈」，本輪只做這一項。

## 改動
- `src/ai/byok/config.ts`
  - 新增 `retainCredential(key)`：記住目前連線使用的金鑰（只在記憶體）。
  - `credentialId()` 淘汰時由舊到新刪除，但跳過「已儲存的金鑰」（`loadKeyRecord()`）與「連線中的金鑰」（retainedKey），也不刪剛查的這把。固定保留最多兩把，總數上限約 16＋2。
  - `clearByok()` 一併清除 retainedKey。
- `src/ai/byok/connection.ts`
  - `beginConnection()` 呼叫 `retainCredential(key)`（含「只測試，不儲存」成功的未儲存金鑰）。
  - `resetConnection()` 呼叫 `retainCredential('')`（改設定、換金鑰、清除時解除保留）。
- `tests/unit/connection.test.tsx`：新增 1 項。已儲存且連線中的金鑰、未儲存但連線中的金鑰，在各產生 40 個其他識別碼後代號不變、燈號仍為 online；未保留的金鑰照常淘汰。
- 文件：`docs/AI_TUTOR.md`、`docs/PROGRESS.md`。

## 驗證
typecheck、lint、835 題內容驗證、單元 371 項（連跑兩次）、build、完整 E2E（4 workers）54 通過、2 略過。畫面無變化，未做瀏覽器驗收。

## 請複查
1. 淘汰迴圈在迭代中刪除 Map 項目是否正確；固定保留的兩把是否可能讓總數無限增加。
2. `pinnedCredential()` 呼叫 `loadKeyRecord()`：在 `memoryRecord` 為 'unloaded'（其他分頁 storage 事件後）時會讀取儲存區，是否有副作用或效能疑慮。
3. `resetConnection()` 清除保留：`subscribeByok` 遇到「儲存同一對象」時不會 reset，保留應持續；遇到其他變更會 reset。是否有應保留卻被解除、或應解除卻保留的路徑（例如連線到時 expired 後）。
4. 這項改動只影響識別碼是否沿用，是否仍維持「不同金鑰一定不同代號、不會誤亮綠燈」。

限制不變：先回報，不提交、不推送；不加入未追蹤稽核檔；不更改或延長 Ollama 許可；用繁體中文回報。

---

# 第四輪：各家 AI 服務的通用性（使用者要求）

Codex 第三輪結論：通過，無新必修。之後使用者提醒：**所有模型 API 都是使用者自己設定，大家用的 AI 百百種，不能把開發者的本機當作唯一調適對象。** 本輪盤點只適用特定服務的假設並修正。

| 假設 | 問題 | 修正 |
|---|---|---|
| 所有 OpenAI 相容服務都吃 `max_tokens` | OpenAI 官方新模型（推理模型等）拒收 `max_tokens`，要求 `max_completion_tokens` | `api.openai.com` 用 `max_completion_tokens`、其他用 `max_tokens`；回 400 且說明提到其中一個參數時換另一個重送一次（只重送一次，其他 400 不重送） |
| 每個服務都有 `GET /models` | 自訂服務沒有清單端點時被判成紅燈，但其實能對話 | `verifyConnection` 回傳 `{ verified, models }`；`custom` 回 404／405／501 → `verified: false`，狀態維持 idle 並說明「無法事先確認，可直接提問」，第一次回答成功才計時。已知服務（OpenAI、Gemini、OpenRouter、Claude、Ollama、LM Studio）的 404 仍算失敗 |
| 讀到模型清單＝金鑰有效 | OpenRouter 等不用金鑰也能讀清單 | 雲端成功文字改為「服務有回應；金鑰與模型在第一次提問時確認」 |
| 服務一定串流回應 | 有的服務忽略 `stream`，直接回 JSON → 畫面空白 | `application/json` 回應照樣取 `choices[0].message.content` |
| 錯誤訊息用我們自己的通用說明就夠 | 各家錯誤原因不同，使用者無從對照 | 附上服務回覆（`error.message`／`message`／`detail`），去除金鑰與疑似金鑰字串（`sk-`、`AIza` 等前綴＋12 字以上）、最多 160 字；SSE 中的 `error` 也附上 |
| 本機 AI＝Ollama 或 LM Studio | 自訂本機程式（llama.cpp、vLLM、Jan…）沒有設定說明 | `custom` 且為 localhost 時顯示通用 CORS 說明（含本站網址、「不會撤回」說明）；診斷本來就適用任何本機位址。自動偵測仍只查 Ollama 與 LM Studio 預設位址（不掃描其他連接埠，避免像掃描本機），並在按鈕下方與找不到時明確說明 |

改動：`src/ai/byok/client.ts`、`connection.ts`（新增 `unverified` 結果）、`config.ts`（custom 說明）、`src/components/ByokSettings.tsx`、`LocalSetupGuide.tsx`（generic）、`TutorChat.tsx`（idle 提示顯示說明）；測試 `tests/unit/connection.test.tsx`（新增 8 項）、`tests/unit/byok.test.ts`、`tests/e2e/tutor-chat.spec.ts`（OpenAI 改查 `max_completion_tokens`）。

驗證：typecheck、lint、835 題內容驗證、單元 379 項（連跑兩次）、build、完整 E2E 54 通過、2 略過。瀏覽器確認自訂 `http://localhost:8080/v1` 顯示通用說明、無橫向溢出。**沒有用真實雲端金鑰測試任何服務**（只用模擬回應）。

## 請複查
1. `max_completion_tokens` 只套用在 `api.openai.com` 是否合理；重送判斷（400 且說明含參數名）是否可能對其他 400 誤重送、或造成重複計費。
2. `providerDetail()` 的金鑰去除是否足夠（各家錯誤訊息可能回顯部分金鑰）；160 字是否會把 HTML 錯誤頁塞進訊息。
3. `verified: false` 只給 `custom`：已知服務是否也有不提供清單的情況（例如 Gemini OpenAI 相容介面在某些金鑰下的行為）。
4. 非串流 JSON 判斷用 content-type：是否有服務串流時也標 `application/json`。
5. 還有哪些只適用特定服務的假設沒有盤到（例如 Anthropic 以外的服務需要特殊標頭、CORS 不允許瀏覽器直連的雲端服務的說明）。

限制不變：先回報，不提交、不推送；不加入未追蹤稽核檔；不更改或延長 Ollama 許可；用繁體中文回報。

---

# 第五輪：Codex 第四輪（docs/audit-30min-r4-*）的修正

| # | Codex 發現 | 修正 |
|---|---|---|
| 1 P2 | 金鑰被拆段（`...` 連接）回顯時兩段都外露；只靠完整字串與前綴遮蔽 | `safeDetail()`：提到金鑰／憑證／驗證字詞（api key、token 類、bearer、secret、password、credential、authorization、金鑰、憑證…）或出現金鑰**任何連續 6 字**，整段隱藏並註明「為了安全不顯示」。非 JSON（HTML、純文字）錯誤頁不顯示原文，只用通用 HTTP 說明；含 HTML 標籤也不顯示 |
| 2 P2 | 400 重送只要出現參數字樣就重送（context window 錯誤也送 2 次）；網域不能代表所有代理或模型 | `rejectsTokenParam(raw, param)`：只在服務明確表示不支援**目前送出的**參數名稱（unsupported／not supported／unrecognized／unknown／not allowed／not permitted／extra inputs／additional properties／invalid parameter… 或「use X instead」）才重送一次。網域只作預設，成功後記住「位址＋模型」接受的名稱（記憶體）。文件改為「是否計費依各服務而定」 |
| 3 P2 | 以 content-type 判斷格式：SSE 標 JSON 失敗、JSON 標 text/plain 空答亮綠燈、多行 `data:` 被丟棄 | 改為看回應第一個非空白字元：`{`／`[` → 完整 JSON（失敗再試每行一個 JSON）；否則用依 WHATWG 規範的 `SseParser`（多行 `data:` 以換行合併、空行結束事件、忽略註解與 event/id/retry）。沒有任何可顯示內容一律丟錯（不亮綠燈）；只因長度上限沒有內容另有說明。Claude 路徑也檢查空回答。`sseData()` 改用同一解析器 |
| 建議 | 清單端點依 preset 判斷 | 依端點能力：清單請求回 404／405／501 時，不論選哪個服務都是 `verified: false`（同一代理選 OpenAI 或自訂結果相同）；401、網路錯誤等仍失敗 |
| 建議 | 模型名稱含 embed 等就隱藏 | `orderModels()` 只排序（疑似向量模型排後面），不隱藏 |
| 建議 | HTTP 200 內含 `error.message` 只顯示沒有內容 | 顯示安全處理後的服務說明 |
| 建議 | 驗證方式、協定、本機範圍、瀏覽器限制要說清楚 | 自訂服務說明寫明支援條件（Chat Completions 相容、Bearer、允許 CORS；其他驗證方式與原生 API 不支援）；http 錯誤訊息說明區網 http 不支援的原因；安全說明加註「服務能用 API 不代表允許瀏覽器直連，本站無法保證特定服務可用」；網路錯誤訊息同樣說明 |

未改：自訂驗證標頭、Responses API、其他原生協定（列為不支援並寫在說明中，非本輪範圍）。

新增回歸測試（`tests/unit/connection.test.tsx`，共 45 項）：金鑰完整／拆段／部分遮罩／憑證字詞回顯都隱藏；HTML 與純文字錯誤頁只顯示通用說明；context window 400 只送 1 次與 `rejectsTokenParam` 正反例；學到參數後第二次只送 1 次；SSE 標 JSON、JSON 標 text/plain；多行 data 事件；空回答三種（空 delta、`{"ok":true}`、空本文）不亮綠燈；HTTP 200 內含錯誤；同一代理 405 選 OpenAI 或自訂結果相同；模型排序不隱藏。

驗證：typecheck、lint、835 題內容驗證、單元 386 項（連跑兩次）、build、完整 E2E 54 通過、2 略過。仍未用真實雲端金鑰測試；本輪也未用真實 Ollama 串流重測新解析器（只用模擬回應）。

## 請複查
1. 重跑 `docs/audit-30min-r4-*` 探測，確認 3 類必修已修。
2. `CREDENTIAL_WORDS` 是否過寬（例如把有用的錯誤說明也藏掉）或仍有漏網的回顯形式。
3. `SseParser` 與格式判斷：跨區塊切開的 `\r\n`、`[DONE]` 之後還有資料、JSON 模式 2MB 上限、`reader.cancel()` 時機。
4. `rejectsTokenParam` 是否有誤判（重送）或漏判（OpenAI 以外的代理回覆格式）。
5. 依端點能力改判後，`http://localhost:11434`（漏了 `/v1`）這類位址錯誤會先顯示「無法事先確認」，提問時才報錯：是否可接受，或本機應另外提示檢查 `/v1`。

限制不變：先回報，不提交、不推送；不加入未追蹤稽核檔；不更改或延長 Ollama 許可；用繁體中文回報。

---

# 第六輪：Codex 第五輪（docs/audit-30min-r5-*）邊界缺口的修正

| # | Codex 發現 | 修正（`src/ai/byok/client.ts`） |
|---|---|---|
| 1 | `Invalid token:` 加上每 5 字以空格切開的金鑰仍完整顯示 | 憑證字詞改為多組規則：除原本字詞外，加上 `invalid/incorrect/expired/revoked/missing/malformed/bad/wrong/unknown/provided (api) token/key`、`token/key is invalid…`、`token:`／`key=` 等憑證用法（一般 `max_tokens`、`input tokens` 不受影響）。金鑰比對改為**去掉所有分隔符號、統一小寫後**比對任何連續 6 個英數字（切成幾字一段都抓得到）。401／403 一律不附服務說明（保守隱藏） |
| 2 | `Invalid parameter 'max_tokens': must be a positive integer` 仍送 2 次 | 移除 `invalid parameter` 判斷。順序：明確「use X instead／replace with X」→ 重送；明確未知欄位（unrecognized、extra inputs、extra_forbidden、additional properties、unknown parameter/field）→ 重送；出現型別／範圍／數值字詞（must be、should be、integer、positive、less than、at most、range、exceed、too large、limit、value…）→ **不重送**；最後才看 unsupported／not supported／not allowed／not permitted |
| 3a | `\r` 與 `\n` 分在兩個區塊被算成兩個換行 | `SseParser.feed()` 遇到區塊結尾的 `\r` 先保留，等下一區塊再判斷；`end()` 才把結尾 `\r` 當換行 |
| 3b | 2MB 上限先判斷再追加，單一大區塊仍被接受 | 改為累計所有已讀字元，超過 `MAX_RESPONSE_CHARS`（200 萬）立即丟錯（「回應過大」），三種模式都適用 |
| 3c | 收到串流 `error` 後只釋放 lock，沒有取消 body | 只有正常讀完才 `releaseLock()`；收到 `[DONE]`、超過上限、服務回報錯誤或任何例外都 `reader.cancel()` |
| 3d | 逐行 JSON fallback 忽略 `[DONE]` | 逐行處理遇到 `[DONE]` 停止 |
| 第五點 | 漏填 `/v1` | 模型清單回 404／405／501 且是本機位址（已知本機服務，或路徑不是 `/v1` 結尾）時，訊息加「請確認 API 基底位址，可能漏填 /v1（預設是 …）」；不自動補 `/v1`，雲端自訂服務不加提示 |

新增回歸測試 7 項（`tests/unit/connection.test.tsx` 共 52 項）：Invalid token＋5 字切段、無字詞的切段回顯、`token=` 小寫回顯都隱藏，403 不附說明，一般長度說明仍顯示；參數值錯誤只送 1 次與 `rejectsTokenParam` 正反例（含 pydantic extra_forbidden）；CRLF 跨區塊多行 data；單一區塊超過上限會拒絕並取消（模擬連線仍開著）、不亮綠燈；串流中 error 事件會取消且不再顯示之後內容；逐行 JSON 遇 `[DONE]` 停止；本機漏 `/v1` 提示且不自動補、雲端自訂不提示。

驗證：typecheck、lint、835 題內容驗證、單元 393 項（連跑兩次）、build、完整 E2E 54 通過、2 略過。**以本機 Ollama 實際串流問答一次**（localhost 預覽、未更改 Ollama 設定）：回答完整顯示、綠燈、計時開始。仍未用真實雲端金鑰。

## 請複查
1. 重跑 `docs/audit-30min-r5-*` 探測。
2. 憑證規則是否把有用的一般錯誤藏太多（例如含 `key` 的 JSON 欄位名稱說明 `missing key 'messages'` 會被藏——目前判斷為可接受的保守代價），或仍有漏網形式。
3. 數值字詞排除是否會讓真正「不支援參數名稱」的說明（剛好含 value、limit 等字）不重送；這種情況只會顯示錯誤、不會重複請求。
4. `reader.cancel()` 與 `releaseLock()` 在 `[DONE]` 後還有資料、或讀取中被使用者中止時的行為。

限制不變：先回報，不提交、不推送；不加入未追蹤稽核檔；不更改或延長 Ollama 許可；用繁體中文回報。

## 第七輪：請確認第六輪 R6-1、R6-2 的修正（2026-11-20，Claude）

| 問題 | 修正（`src/ai/byok/client.ts`） | 回歸測試（`tests/unit/connection.test.tsx`「Codex 第六輪」） |
| --- | --- | --- |
| R6-1 混合訊息誤重送 | `rejectsTokenParam`：1) 明確「use … instead」照舊重送；2) 結構化錯誤只在同一個 `{…}` 物件內同時出現 extra_forbidden／unknown 與參數名稱才重送；3) 文字依 `, . ; 換行 and` 切成片段，「未知／不支援」與參數名稱須在同一片段；任何片段在說此參數的值不合法就不重送 | 混合訊息只送 1 次；原合法重送案例（use instead、extra_forbidden、兩個 unknown 之一是本參數）維持重送 |
| R6-2 逐行 JSON 等 EOF | 第一行本身是完整 JSON 時判定為 `ndjson`，逐行處理，收到 `[DONE]` 立即結束並 `cancel()`；多行排版的單一 JSON 仍讀完才解析 | 連線不關閉時 1 秒內結束、取消；多行排版 JSON 正常 |

請特別確認：
1. 新的片段切分是否造成其他合法重送案例漏判，或仍有跨片段誤判（例如欄位名稱與說明被逗號隔開的真實供應商訊息）。
2. 行為變化：你的探測 `CONSERVATIVE_FALSE_NEGATIVE`（"The max_tokens parameter is not supported for this model; value applies to legacy requests."）現在會重送一次（改用 max_completion_tokens）。服務已明說不支援，我認為重送是正確的；若你認為仍應保守，請說明理由。
3. `ndjson` 判定：第一行剛好是完整 JSON、但整體其實是另一種格式的可能性；以及 `[DONE]` 之後仍有資料、錯誤物件夾在中間的處理。

已執行：typecheck、lint、validate:content、單元 396 項、build、E2E 54 通過（2 選用略過）；你的 `docs/audit-30min-r6.config.mts` 探測中 R6-1、R6-2 兩例已無法重現（顯示為失敗屬預期），另一例即上述第 2 點。Python 程式題本輪未改、未重跑。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r7.md`，明確寫出是否同意發布。不要修改正式程式或題庫，不要提交、推送，不要變更 Ollama 許可。

## 第八輪：請確認第七輪 R7-1、R7-2 的修正（2026-11-20，Claude）

| 問題 | 修正（`src/ai/byok/client.ts` `rejectsTokenParam`／串流解析） | 回歸測試（`tests/unit/connection.test.tsx`「Codex 第七輪」） |
| --- | --- | --- |
| R7-1 共現不等於關聯 | 文字：否定詞必須**直接修飾**目前參數名稱——`(unknown\|unrecognized\|unsupported\|unexpected\|extra) (request) (parameter\|field\|argument\|key\|input\|property)(s)( supplied) [:=,] 'name'`，或 `'name' (parameter) is/are not supported/allowed/permitted/recognized \| unsupported \| unrecognized \| unknown`；只依 `. ; 換行` 切句。結構化：只看定位欄位（`loc` 最後一項、`param`、`parameter`、`field`、`name`），不看 `input` 等被拒絕的值 | 你的三個反例都不重送（完整呼叫只送 1 次）；直接修飾的寫法、OpenAI 式 `{"param":"max_tokens","message":"Unsupported parameter"}`、`loc` 指向本參數的 extra_forbidden 仍重送 |
| R7-2 前導空白行 | 判斷逐行 JSON 前先略過開頭的空白行（`^(?:[ 	]*
?
)+`），以第一個非空白完整行判斷 | LF、CRLF、多個空白行（各自分區塊送出）皆在 [DONE] 後立即結束並取消；前導空白行＋多行排版單一 JSON 仍正確 |

你的 `docs/audit-30min-r7.extra.test.ts` 探測表在新版的結果（列為舊行為的列因此顯示失敗，屬預期）：

| 輸入（param=max_tokens） | 新結果 |
| --- | --- |
| Unknown parameter: stream, max_tokens must be a positive integer | false |
| The max_tokens parameter is not supported for this model; value applies to legacy requests. | true |
| Unknown parameter: stream but max_tokens is valid | **false**（原 true） |
| Unknown parameter: stream (max_tokens is supported) | **false**（原 true） |
| {'type':'extra_forbidden','loc':['body','stream'],'input':{'max_tokens':100}} | false |
| {'type':'extra_forbidden','loc':['body','stream'],'input':'max_tokens'} | **false**（原 true） |
| max_tokens: invalid value; use max_completion_tokens instead for other models | true（「use … instead」明確替代規則優先，見下方第 2 點） |
| Unsupported parameter, max_tokens | **true**（原 false，依你建議的相容性改善） |

請特別確認：
1. 「直接修飾」規則是否仍有常見供應商訊息會漏判（安全方向）或誤判。
2. 「max_tokens: invalid value; use max_completion_tokens instead for other models」：目前因明確替代規則而重送一次。你先前提醒不要把數值排除移到最前以免破壞明確替代案例；若你認為「for other models」這類限定應視為不明確而不重送，請提出判準。
3. R7-2 的空白行略過是否涵蓋你認為必要的切點。

已執行：typecheck、lint、validate:content、單元 401 項、build、E2E 54 通過（2 選用略過）。你的 r7 探測：406 項中 2 項失敗，即「R7-1 舊行為表」與「前導空白行等待 EOF」兩項缺陷斷言，現已無法重現（`LEADING_BLANK_DONE` 觀察為 settled、canceled=1）。Python 未改、未重跑。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r8.md`，明確寫出是否同意發布。不要修改正式程式或題庫，不要提交、推送，不要變更 Ollama 許可。

## 第九輪：請確認第八輪 R8-1、R8-2 的修正（2026-11-20，Claude）

`rejectsTokenParam`（`src/ai/byok/client.ts`）改寫為四步：

1. **結構化錯誤**：錯誤種類只看 `type`／`code`／`msg`／`message`，指向的欄位只看 `loc` 最後一項／`param`／`parameter`／`field`／`name`（或 message 本身直接修飾目前參數）；**不讀 `input` 等被拒資料**。判斷值錯誤前先去掉 `invalid_request_error` 等通用錯誤類別。只要是結構化錯誤、又沒有明確指出「目前參數名稱不被接受」，保守不重送（R8-1）。
2. **文字**：依 `. ; 換行` 切句，否定詞須直接修飾目前參數（沿用第七輪）。
3. **改用另一名稱的建議**：只套用於目前請求；限定其他模型／端點／版本／API，或含 if／when／unless／depending 條件時不套用；目前參數只是值不對、沒有說名稱不被接受時也不套用（R8-2，依你的決策準則 1～3）。
4. 其餘：值錯誤不重送；否定詞直接修飾目前參數才重送。

回歸測試（`tests/unit/connection.test.tsx`「Codex 第八輪」）：
- R8-1：`int_parsing`、`greater_than`、`int_type` 三種值錯誤搭配誤導 `input`（unknown field、unsupported parameter、extra_forbidden）都不重送，完整流程只送 1 次。
- R8-2：「for other models」「on newer endpoints」「If you are using reasoning models」「for other API versions」四種限定都不重送，完整流程只送 1 次。
- 合法重送維持：`Unsupported parameter: max_tokens. Use max_completion_tokens instead.`（完整流程送 2 次）、只說「Use max_completion_tokens instead.」、OpenAI 式 `param`＋`code: unsupported_parameter`、pydantic extra_forbidden（loc 為 tuple）、`{"error":{"message":"Unknown parameter: max_tokens"}}`。

已執行：typecheck、lint、validate:content、單元 404 項、build、E2E 54 通過（2 選用略過）。你的 `docs/audit-30min-r8.config.mts`：409 項中 2 項失敗，即兩個缺陷擷取探測，現已無法重現。Python 未改、未重跑。

請特別確認：步驟 1「結構化但未明確指出→不重送」是否過度保守；步驟 3 的範圍限定詞是否有明顯漏網或誤擋（例如「with this model」不被視為限定）。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r9.md`，明確寫出是否同意發布。不要修改正式程式或題庫，不要提交、推送，不要變更 Ollama 許可。

## 第十輪：請確認第九輪 R9-1、R9-2 的修正（2026-11-20，Claude）

| 問題 | 修正（`src/ai/byok/client.ts`） | 回歸測試（`tests/unit/connection.test.tsx`「Codex 第九輪」） |
| --- | --- | --- |
| R9-1 巢狀 input 被當錯誤紀錄 | 新增 `structuredErrorRecords()`：整段（或冒號後整段）為物件／陣列時才視為結構化；先 `JSON.parse`，失敗再對 Python repr 做受限轉換（單引號、tuple、None／True／False；含反斜線或字中撇號就放棄）；**只從根層級、`error`、`errors`、`detail` 容器取錯誤紀錄，不進入 `input`、`body` 等被拒資料**；看起來是結構化但無法解析＝空紀錄＝不重送。取代原本的最內層 `{…}` 全域掃描 | 你的反例＋`detail` 陣列內巢狀 input、input 為含物件樣式的字串、Python repr 巢狀 input，皆不重送（完整流程 1 次） |
| R9-2 冠詞與跨句條件 | 限定詞加入冠詞（a／an／the）、another、「switch／migrate／upgrade／move／change to」；**限定或條件出現在整則訊息任何一句都不套用**替代建議 | 你的兩個反例＋「for the other API versions」「When migrating to…」皆不重送；`with this model`、無限定的合法替代、OpenAI param＋unsupported_parameter、pydantic extra_forbidden（含 detail 容器）仍重送 |

已執行：typecheck、lint、validate:content、單元 407 項、build、E2E 54 通過（2 選用略過）。你的 `docs/audit-30min-r9.config.mts`：412 項中 2 項失敗，即兩個缺陷擷取探測，現已無法重現。Python 未改、未重跑。

請特別確認：`structuredErrorRecords` 的「是否視為結構化」判定（前置文字只允許以冒號或等號結尾）與 Python repr 受限轉換的保守程度；以及整則訊息套用範圍限定，是否會讓常見的「目前模型＋替代」訊息因含 when／if 而不再重送（目前視為可接受的安全方向）。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r10.md`，明確寫出是否同意發布。不要修改正式程式或題庫，不要提交、推送，不要變更 Ollama 許可。

## 第十一輪：請確認第十輪 R10-1 的修正（2026-11-20，Claude）

| 問題 | 修正（`src/ai/byok/client.ts` `rejectsTokenParam`） | 回歸測試（`tests/unit/connection.test.tsx`「Codex 第十輪」） |
| --- | --- | --- |
| R10-1 範圍限定只擋替代分支，最後仍回傳 rejected | `SCOPED` 定義移到函式前段，成為全域條件：**文字訊息整則只要有範圍限定或條件，直接不重送**（不再只擋「改用」分支）；結構化紀錄的 type／code／msg／message 帶範圍限定時也不算「名稱不被接受」 | 你的兩個反例（完整流程各 1 次）、「Unknown parameter: max_tokens when using legacy deployments」、結構化 `message: "For other models, max_tokens is not supported"` 皆不重送；`with this model`、無限定的「max_tokens is not supported. Use … instead.」（2 次）、OpenAI param＋unsupported_parameter 仍重送 |

已執行：typecheck、lint、validate:content、單元 409 項、build、E2E 54 通過（2 選用略過）。你的 `docs/audit-30min-r10.config.mts`：414 項中 1 項失敗，即 R10-1 缺陷擷取探測，現已無法重現。Python 未改、未重跑。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r11.md`，明確寫出是否同意發布。不要修改正式程式或題庫，不要提交、推送，不要變更 Ollama 許可。

## 第十二輪：請確認第十一輪 R11-1 的修正（2026-11-20，Claude）

| 問題 | 修正（`src/ai/byok/client.ts`） | 回歸測試（`tests/unit/connection.test.tsx`「Codex 第十一輪」） |
| --- | --- | --- |
| R11-1 子層未繼承父層範圍限定 | `structuredErrorRecords` 回傳 `{ rec, inherited }`：走訪錯誤容器（根、error、errors、detail）時，把**容器本身**的 type／code／msg／message 一路往下傳；子層判斷時對 `inherited + 自身說明` 套用範圍限定。input、body 等被拒資料不會進入 inherited | 你的反例（完整流程 1 次）、error 容器內 errors 繼承「When using legacy deployments」；input 含「only for other models」的合法 extra_forbidden 仍重送；父層無限定時子層照常重送 |

已執行：單元 416、E2E 54（2 略過）、typecheck、lint、835 題、build 通過；你的 `docs/audit-30min-r11.config.mts` 419 項中 1 項失敗，即 R11-1 缺陷擷取探測，現已無法重現。
結果請寫成 `docs/AUDIT_2026-11-20_connection-30min_r12.md`。本輪同時有另一份獨立請求 `docs/REVIEW_REQUEST_2026-11-20_question-guidance.md`，可分開出報告。

