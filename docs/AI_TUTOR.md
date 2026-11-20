# AI 導師：架構、安全與部署說明

AI 導師是**選用功能**，有兩種：

1. **解析頁的「重新教我這個觀念」**：預設「示範模式（離線）」，完全不呼叫外部服務；也可選擇管理者部署的後端代理（第 2～6 節）。
2. **對話型 AI 導師（自備 API，v1.1.0 起）**：使用者用自己的雲端或本機 AI 服務，與懸浮視窗對話（第 0 節）。

原本的靜態解析不受任何影響。

## 0. 對話型 AI 導師（自備 API）

### 使用方式
- **預設關閉**。在「設定 → AI 導師」勾選開啟後，畫面角落才出現圖示；取消勾選或按視窗的 ✕ 即隱藏。
- 視窗可收合成圖示、標準大小、放大（手機為全螢幕）。
- 支援的服務：Anthropic Claude（官方 SDK `@anthropic-ai/sdk`，鎖定 1.4.0，只在選用 Claude 時才載入）、OpenAI、Google Gemini（OpenAI 相容介面）、OpenRouter、Ollama／LM Studio（本機）與其他 OpenAI 相容服務。
- 本機服務需允許本站網域的跨來源連線（Ollama：`OLLAMA_ORIGINS`；LM Studio：啟用 CORS）。建議使用 Chrome／Edge。

### 不送出就不產生用量
- 連線與 30 分鐘時限（本機待發布，`src/ai/byok/connection.ts`）：
  - 連線對象＝服務＋位址＋模型＋金鑰識別碼（`config.ts` 的 `credentialId`：記憶體內配發的流水號，不同金鑰一定不同；只保留最近 16 把；已儲存的金鑰與目前連線使用的金鑰固定保留，其他淘汰後再出現會拿到新代號＝視為未連線，不會誤亮綠燈）。任一項不同就是另一個連線，狀態不沿用。
  - 到期一律以截止時間判斷：連線中重新請求（checking）也排定到期；`isExpired` 比對時間，計時器延遲（背景分頁）也擋得住；`streamChat` 在到時後拒絕送出（不會自動開始新的一段），對話框在每次等待後、每段串流時都再檢查；到期時作廢進行中請求的結果。
  - 「儲存並連線」「只測試，不儲存」、對話框的「連線／重新連線」都用 `verifyConnection`：只讀取模型清單，不產生回答、不消耗 token。成功回答提問也算連線成功。
  - 第一次成功開始最長 30 分鐘的連線，之後的成功不延長。時間到轉為「已到時」：中止進行中的回答、停用送出，按「重新連線」開始新的 30 分鐘。計時只在記憶體，重新整理頁面就回到「未連線」。
  - 狀態燈：綠＝已連線、黃（閃爍）＝連線中、紅＝失敗、灰＝未連線或已到時；一律附文字。中止請求恢復原本狀態；晚到或屬於舊設定的結果一律丟棄。沒有背景輪詢或自動重連。
- 本機 AI 自動判斷（`src/ai/byok/diagnose.ts`）：連線失敗後，對本機服務根目錄送一個不帶金鑰、不讀內容的 no-cors 請求，推測較可能的原因（訊息一律寫成「可能原因」：no-cors 成功只代表該連接埠有程式回應，也可能是其他程式；失敗也可能是瀏覽器拒絕本機網路權限）；404／400 或空清單時讀模型清單判斷模型是否已下載；回應不是模型清單（`data` 不是陣列）一律視為失敗。「自動偵測本機 AI」依序嘗試 Ollama（11434）與 LM Studio（1234）的預設位址，沒有對話模型時會繼續找下一個；找到後先顯示結果，使用者確認才儲存。只對 localhost／127.0.0.1 發出，不帶金鑰。
- 不以單一環境為準（使用者用的服務百百種，設定一律由使用者自己選）：
  - 回答長度參數：預設 `api.openai.com` 用 `max_completion_tokens`、其他用 `max_tokens`（網域只是預設）。回 400 時用 `rejectsTokenParam()` 判斷服務是否**明確**表示不支援該參數名稱（unsupported／unrecognized／not permitted… 或「use X instead」），是才換另一個名稱重送一次；參數「值」錯誤（must be、integer、range、exceed…）與內容太長等其他 400 不重送。成功後記住「位址＋模型」接受的名稱（記憶體）。是否對被拒絕的請求計費依各服務而定。
  - 錯誤說明：`readError()`／`safeDetail()` 只取 JSON 的 `error.message`／`error`／`message`／`detail`；非 JSON（HTML、純文字）不顯示原文；含 HTML 標籤不顯示；提到金鑰／憑證／驗證字詞（含 invalid token、token: … 等憑證用法；一般 max_tokens、input tokens 長度說明不受影響），或忽略分隔符號與大小寫後出現金鑰任何連續 6 個英數字，整段隱藏並註明「為了安全不顯示」；401／403 一律不附服務說明；其他壓成一行、最多 160 字。
  - 回應解析不看 content-type：第一個非空白字元是 `{`／`[` → 完整 JSON（失敗再試每行一個 JSON）；否則依 WHATWG SSE 規範解析（多行 `data:` 合併、空行結束事件、忽略註解與其他欄位）。跨區塊切開的 `

` 視為一個換行；每行一個 JSON 時遇到 `[DONE]` 停止；回應總量超過 200 萬字元即拒絕。收到結束標記、超過上限、服務回報錯誤或任何例外時都取消仍開啟的回應。HTTP 200 內含 `error` 時顯示安全的服務說明。沒有任何可顯示內容時丟錯（不亮綠燈）；只因長度上限而沒有內容時另有說明。Claude 路徑同樣檢查空回答。
  - `verifyConnection` 回傳 `{ verified, models }`：依端點能力判斷，模型清單請求回 404／405／501 時不論選哪個服務都 `verified: false`，狀態維持 idle 並附說明；本機位址（已知本機服務，或路徑不是 /v1 結尾）另提示「可能漏填 /v1」，但不自動補上（各家路徑不同）。其他錯誤（401、網路等）仍算失敗。
  - 模型清單：`orderModels()` 只把名稱像向量模型的排後面，不隱藏。
  - 支援條件（設定說明與安全說明中顯示）：OpenAI Chat Completions 相容（`/chat/completions`）或 Claude；金鑰以 `Authorization: Bearer` 傳送（不支援其他驗證標頭）；服務須允許瀏覽器跨來源直連；http 只限本機，區網 http 不支援。
  - 雲端連線成功的文字不宣稱金鑰有效（OpenRouter 等的模型清單不需金鑰）。
  - 自訂本機位址（`custom` 且為 localhost）顯示通用 CORS 說明；本機判斷（`diagnose.ts`）對任何本機位址都適用。自動偵測只檢查 Ollama（11434）與 LM Studio（1234）預設位址，不掃描其他連接埠。
- 允許本站的設定步驟（`src/components/LocalSetupGuide.tsx`，依 Ollama 官方 FAQ）：Windows 結束 Ollama → `setx OLLAMA_ORIGINS "<本站網址>"` → 重新開啟；macOS `launchctl setenv`（重開機後需再執行）；Linux 用 systemd `Environment=`。指令只允許本站網址，不用 `*`；已設定其他網址時以逗號附加。
- 只有使用者按「送出」才會呼叫 AI 服務。開啟視窗、換頁、輸入、點快捷提問（只會填入輸入框）都不會發出請求；沒有背景請求、自動摘要或預先載入。
- 送出流程從按下送出就建立可中止的請求；每個等待步驟之後、發出請求之前都重新確認功能仍開啟、視窗未收合、頁面未鎖定。收合、關閉或進入測驗鎖定時會中止。**中止只停止接收與尚未發出的請求，已開始計算的部分仍可能由 AI 服務計費。**

### 省 token 設計
| 項目 | 設定（`src/ai/byok/client.ts`、`retrieval.ts`） |
| --- | --- |
| 回答長度 | 單次最多 2,048 tokens；提示要求預設 300 字內，被要求才寫長 |
| 對話紀錄 | 只帶最近 6 則；較早的 AI 回答截短到 600 字 |
| 依據資料 | 每次最多約 3,000 字（官方 2、講義 3、題庫 2 段），只附在當次提問，之後的回合不重複送出 |
| Claude 思考量 | 支援的模型送 `output_config.effort: "low"` |
| 介面 | 顯示本次已送出的請求次數與約略字數，可隨時中止、清除對話 |

### 離題提問不送出
送出前在瀏覽器內檢查（`src/ai/byok/check.ts` 的 `topicVerdict`）：打招呼、常見閒聊（天氣、餐廳、寫詩、請假信、股票、你是誰等，且未出現學習用語），以及提問字詞完全不在本站資料中的訊息，直接以本機訊息回覆提醒，**不呼叫 AI、不產生用量**。在題目或講義頁指向目前內容的問句（「這題為什麼」「給我提示」）放行。漏網送出的閒聊，系統規則要求只回一句婉拒、不展開。

### 回答要有依據
送出時在瀏覽器內（不呼叫 AI、不耗用量）從本站資料檢索相關段落，編號 [S1]、[S2]… 附在提問中：
- **官方資料**：`curriculum.json` 逐字收錄的 115.06 版評鑑內容、`official-sources.json` 的官方網站核對紀錄
- **本站講義**：依「## 小節」切段
- **本站題庫**：已釋出題目的題幹、正確敘述與標準解析
- **官方學習指引位置**：`official-guide-index.json`（Codex 依官方 PDF 目錄整理，只有檔名、版本碼、章節與頁碼，不含正文；初級為上位主題章節範圍）。目前細項的指引頁碼一律附上，本站資料不足時 AI 只能指引使用者去讀官方原文

檢索以使用者提問為主，不混入單元名稱（實測：混入後在 L11301 頁問「特徵工程」找不到 L11202 的段落）；題目頁只有指向題目的問句才把題幹一起查。官方評鑑範圍段落相關度不到最高分一半時不附，節省 token。

回答完成後在瀏覽器內檢查（`checkGrounding`）：段落含數字卻沒有依據編號、說「本站資料沒有涵蓋」卻又補上未附依據的數字、或引用本回合不存在的依據編號時，在回答下方顯示警示，提醒不要採信。這是啟發式提醒，不能自動判定內容真偽。

系統提示要求：每個重點標出依據編號；依據沒有涵蓋時直接說「本站資料沒有涵蓋」，不得自行補充法條、數據、考試規定；舉例要標「（舉例）」且不得與依據矛盾；依據不一致時官方優先。每則回答下方列出依據清單（講義可點回原文），讓使用者自行核對。
**本機實測（2026-11-20，Ollama qwen3:14b，正式建置＋CSP）**：設定頁取得模型清單、測試連線成功；講義頁提問「過擬合與泛化」「訓練／測試資料為何分開」「特徵工程」皆依本站講義與題解作答並標依據，內容與講義一致；「AI 產品與系統評測項目」答出 10 項，與講義逐項一致；超出範圍的「歐盟 AI 法第 52 條罰款」第一次測試時模型說沒有涵蓋卻自行補上錯誤金額，因此加強規則並加上回答檢查，重測後只指出官方指引頁碼；閒聊在本機擋下不送出。每次請求約 2,000～2,400 字。小型本機模型偶爾出現簡體字，已在規則中明確要求繁體字。

**限制**：官方學習指引與公告試題全文因版權未收錄，不在依據內；講義與題庫為 AI 檢查的自編內容，未經專業人工審核；模型仍可能出錯，介面標示「標準答案以題目解析為準」。

### 不破壞考試流程
- 測驗模式、模擬考、錯題重測**交卷前鎖定**，不送出題目內容。
- 練習模式**提交前**：只送題幹與選項，排除該題自己的解析，並要求只給提示、不說答案。
- 解析顯示後（練習提交後、結果頁、錯題本），可按「問 AI 導師」把該題標準解析作為依據；選項代號依使用者畫面上的打亂順序。

### 金鑰與資訊安全
- 本站程式碼與公開 repo **不含任何金鑰**，也沒有自己的伺服器；金鑰由使用者在自己的瀏覽器輸入，直接送往其選擇的服務。
- 預設只存在這個分頁（sessionStorage，關閉即清除）；勾選「記住」才存到 localStorage，並提醒共用電腦不要勾選。可隨時「清除金鑰」；「清除所有學習紀錄」也會一併清除。
- 金鑰不寫入 IndexedDB，因此**不會出現在 JSON 備份或 CSV 匯出**（單元測試驗證）。
- API 位址只允許 https，或本機 localhost／127.0.0.1 的 http；不允許網址內含帳密、查詢字串；非已知服務的網址須使用者勾選「我信任此服務」，**儲存、測試連線、取得模型清單三個會連線的動作都要先通過**（`endpointGate`）。
- 已儲存的金鑰只用於同一個服務、同一個來源（`savedKeyApplies`）；換服務或改網址就要重新輸入，不會把某家服務的金鑰送到另一個服務。
- 請求只在標頭帶金鑰，`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`cache: 'no-store'`（OpenAI 相容 fetch 與 Anthropic SDK 的 `fetchOptions` 共用 `SAFE_FETCH_OPTIONS`）；錯誤訊息不含金鑰或回應原文；輸入欄位為密碼欄並關閉自動完成。
- AI 回覆視為不可信內容：不渲染原始 HTML、不載入圖片（避免以圖片網址外傳對話）、只允許 https 連結且另開分頁、不帶來源。
- 正式建置加入內容安全政策（CSP）：只允許本站腳本與以雜湊核可的主題初始化腳本，禁止 `eval` 與外部腳本、`object-src 'none'`；`connect-src` 允許 https 與本機 http 以連到使用者自選的服務；圖片只允許本站與 data:。
- 提醒使用者：在服務後台為金鑰設定花費上限或建立專用金鑰；不要在對話中輸入個人資料。

## 1. 使用流程

答錯題目後點「重新教我這個觀念」（解析頁或錯題本）：

1. 核心考點（細項代碼、概念重點、講義「必考核心觀念」）
2. 為什麼這樣選會錯（逐一引用所選選項的已審核解析，並對照正確答案）
3. 換個例子重新理解（題目案例＋講義「不同領域的實際案例」）
4. 正確觀念 vs. 常見誤解（題目陷阱＋講義「容易混淆的觀念比較」表）
5. 補強題：同一細項、不同題目，優先選不同題型（換情境）
6. 依補強題結果：
   - 答對：記錄作答，原題仍依 1／3／7／14 天排程，**不會因此直接標為已掌握**
   - 答錯：補強題收錄錯題本，原題改為今天到期，並建議回講義對應段落

可切換模式：簡單解釋、詳細教學、舉例說明、比較易混淆觀念、再出一題。

## 2. Provider 架構

```
src/ai/
  types.ts           TutorProvider 介面、請求與回應型別
  mockProvider.ts    示範模式：只重組已審核的題目解析與講義段落
  remoteProvider.ts  遠端模式：呼叫後端代理（需建置時設定 VITE_AI_TUTOR_ENDPOINT）
  index.ts           依使用者偏好選擇；遠端不可用時自動退回示範模式
```

新增其他 Provider（例如本機模型）時，實作 `TutorProvider` 介面並加入 `providers` 陣列即可。

## 3. 安全原則（必須遵守）

- **本站自己的金鑰絕不放在前端**：不寫在程式碼、不放在公開 repo、不使用 `VITE_` 前綴的環境變數（所有 `VITE_` 變數都會被打包進前端）。使用者自備的金鑰只依第 0 節的方式保管於其瀏覽器，與本節的後端代理無關。
- 前端只送出 `questionId`、`selected`、`mode`、`exclude`，**不送任何個人資料**。
- 後端代理負責：
  1. **使用者驗證**：例如 Cloudflare Access、Supabase Auth 或自建登入，以 HttpOnly Cookie 維持工作階段（前端呼叫時使用 `credentials: 'include'`）。
  2. **速率與額度限制**：每位使用者每日次數上限（例如 30 次），超過回傳 HTTP 429。
  3. **成本控制**：每月總預算上限，達上限時停用並回傳 503；限制輸入與輸出 Token 長度。
  4. **CORS**：只允許本站網域。
  5. **內容依據**：後端自行讀取題庫中的題目與「已審核解析」作為提示依據，要求模型不得與標準答案矛盾。
  6. **輸出驗證**：只回傳固定 JSON 結構；補強題 ID 必須是題庫中同細項的既有題目（前端也會再次檢查）。
  7. **紀錄**：記錄使用量與錯誤，不記錄個人資料。
- 前端顯示「AI 生成內容，可能有錯誤，標準答案以題目解析為準」。

## 4. 後端代理介面

`POST {VITE_AI_TUTOR_ENDPOINT}/tutor`

請求：
```json
{ "questionId": "original-L11101-0001", "selected": ["A"], "mode": "detailed", "exclude": [] }
```

回應（200）：
```json
{
  "sections": [{ "kind": "core", "title": "核心考點", "body": "- ..." }],
  "reinforcementQuestionId": "original-L11101-0007"
}
```

錯誤：401 未登入、429 超過額度、503 預算用盡或服務暫停。

## 5. 參考實作（Cloudflare Workers，示意）

以下僅為設計參考，未包含在網站建置中；部署前請依實際服務補上登入驗證與測試。

```ts
// workers/ai-tutor/src/index.ts（示意）
export interface Env {
  AI_API_KEY: string;          // 以 `wrangler secret put AI_API_KEY` 設定，只存在伺服器端
  ALLOWED_ORIGIN: string;      // 例如 https://<user>.github.io
  QUOTA: KVNamespace;          // 每日用量計數
  MONTHLY_BUDGET_USD: string;  // 例如 "20"
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Credentials': 'true' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });

    const user = await verifySession(req);           // 依所選登入方案實作；失敗回傳 401
    if (!user) return new Response('unauthorized', { status: 401, headers: cors });

    const key = `q:${user.id}:${new Date().toISOString().slice(0, 10)}`;
    const used = Number((await env.QUOTA.get(key)) ?? 0);
    if (used >= 30) return new Response('quota exceeded', { status: 429, headers: cors });
    if (await monthlySpend(env) >= Number(env.MONTHLY_BUDGET_USD)) return new Response('budget', { status: 503, headers: cors });

    const { questionId, selected, mode } = await req.json();
    const q = await loadQuestion(questionId);       // 從本站建置產物或題庫副本讀取；找不到回傳 404
    const prompt = buildGroundedPrompt(q, selected, mode); // 內含已審核解析，要求不得與標準答案矛盾、輸出固定 JSON

    const out = await callModel(env.AI_API_KEY, prompt, { maxOutputTokens: 800 });
    const parsed = validateTutorJson(out, q.competencyCode); // 結構與補強題 ID 檢查
    await env.QUOTA.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 });
    return Response.json(parsed, { headers: cors });
  },
};
```

## 6. 啟用步驟

1. 部署後端代理並完成登入、額度、預算設定。
2. 在 GitHub repository 的 **Settings → Secrets and variables → Actions → Variables** 新增 `VITE_AI_TUTOR_ENDPOINT`（只是公開網址，不是金鑰），並在 workflow 的 build 步驟加入 `env: VITE_AI_TUTOR_ENDPOINT: ${{ vars.VITE_AI_TUTOR_ENDPOINT }}`。
3. 重新部署後，「設定 → AI 導師」即可選擇遠端模式；未設定時該選項自動停用。

> 目前狀態：本專案**尚未部署任何後端代理**，網站只提供示範模式。

## 本機 Ollama 403 與轉接程式（2026-11-21，未發布）

- Ollama 預設只允許本機網頁來源；本站（GitHub Pages）的請求會得到 HTTP 403。本機位址的 403 改顯示「拒絕本站來源」說明（`LOCAL_FORBIDDEN_MESSAGE`），不再當成金鑰錯誤。
- 使用者選擇方案 C（本機轉接程式），不提供永久設定。`src/ai/byok/bridge.ts` 產生 PowerShell 腳本：
  - 登記 `http://localhost:11435/`。HttpListener 的 localhost 前綴只比對 Host 名稱，所以每個請求另外檢查：連線來源與本機端點都是 loopback（IPv4 對應位址先轉回 IPv4）、Host 必須是 `localhost:11435`，否則 403（Codex F1：區網／VPN 位址帶 `Host: localhost` 曾可使用）。只接受 Origin 與本站完全相符（大小寫相符）的請求；只轉送 `/v1/models`、`/v1/chat/completions`、`/api/tags`、`/api/version`；轉送時不帶 Authorization、Cookie、Origin，不跟隨重新導向（Ollama 視為本機請求，不必改設定、不重啟）。
  - 請求本文以有上限的迴圈實際讀取並累計，最多 2 MiB；`Content-Length` 超過或分塊上傳累計超過都回 413，且不轉送（Codex F3）。
  - 回應附 `X-IPAS-Bridge-Expires`（毫秒，經 `Access-Control-Expose-Headers` 公開）；預檢回 `Access-Control-Allow-Private-Network: true`。
  - 5～120 分鐘是絕對截止：等待連線、讀取上傳、等待 Ollama 回應、串流讀寫都以非同步工作搭配 250 毫秒輪詢檢查期限，到期立即 `Abort()` 送往 Ollama 的請求與目前的回應，再關閉 listener；送往 Ollama 的逾時也縮到剩餘時間（Codex F2）。取消放在每個請求的 `finally`：按 Ctrl+C 中止（視窗仍開著）也一定取消上游，不會讓 Ollama 在背後繼續產生回答（Codex 第二輪 R2-1）；提早結束的訊息為中性的「已中止」。
  - 停止與重新啟動不強制結束任何程式（Codex F4）：啟動時在 TEMP 寫入紀錄（PID、行程啟動時間、隨機停止代碼）。停止指令先確認紀錄的 PID 與啟動時間都相符，才寫入停止代碼；轉接程式自己讀到代碼後結束並清除紀錄。紀錄對不上（程式已不在、PID 被重用）時只清除紀錄；轉接程式沒回應時請使用者自行關閉視窗。
  - 單執行緒依序處理請求：一則串流回答進行中時，其他請求（例如重新連線）排隊。手動停止且網站閒置時，網站不會在背景偵測，要到下一次連線或提問才知道。
- 網站只能複製指令，無法執行本機程式。`verifyConnection`／`streamChat` 讀到期標頭後，連線倒數改用該時間（超過 120 分鐘或已過期不採用）；只有設定為 `http://localhost:11435/v1`、且請求確實送往該來源的回應才讀取這個標頭，`connection.ts` 也再確認一次（Codex F5：雲端回應曾可把計時延長為 90 分鐘）。轉接程式連不到時顯示專屬說明。
- 403 說明分開：Ollama（preset、11434 或轉接連接埠）說明最可能是來源未獲許可；其他本機程式只說可能原因（來源、權限或金鑰設定），不斷言不是金鑰問題。
- 2026-11-21 本機實測（測完即停止，未變更 Ollama 設定）：本站來源 200 並帶標頭；其他來源與無來源 403；預檢 204；非允許路徑 404；串流到 [DONE]；正式建置在瀏覽器經轉接程式連線成功，倒數跟著 5 分鐘許可，問答成功；停止後顯示「連不到本機轉接程式」。

