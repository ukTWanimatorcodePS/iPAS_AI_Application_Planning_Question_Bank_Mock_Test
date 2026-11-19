# AI 導師：架構、安全與部署說明

AI 導師是**選用功能**。網站預設使用「示範模式（離線）」，完全不呼叫外部服務；原本的靜態解析不受任何影響。

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

- **前端絕不持有 API 金鑰**：不寫在程式碼、不存 localStorage、不放在公開 repo、不使用 `VITE_` 前綴的環境變數（所有 `VITE_` 變數都會被打包進前端）。
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
