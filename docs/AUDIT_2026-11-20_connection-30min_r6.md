# AI 導師 30 分鐘連線：第六輪複查

日期：2026-11-20。基準 HEAD `aed6b20` 加當前未提交修改。依第六輪複查請求，僅審查與模擬驗證；未修改正式程式或題庫，未提交、推送、stage 稽核檔或變更 Ollama 許可。

## 結論

第五輪的既有反例已修正，但仍有兩項 P2 邊界缺口，建議修正後再驗收本批連線改動。這不撤銷先前已發布 v1.1.0 的驗收，也不代表正式網站已包含這些未提交修改。

## 必修 R6-1：混合驗證訊息把其他欄位錯誤誤認成長度參數錯誤

- 位置：`src/ai/byok/client.ts:271`、`:277`，重送判定處 `:302`。
- 輸入：HTTP 400，`error.message = "Unknown parameter: stream, max_tokens must be a positive integer"`。
- 實際：`rejectsTokenParam(message, 'max_tokens') === true`；模擬服務收到 **2 次**請求。
- 預期：未知欄位是 `stream`，`max_tokens` 是值不合法；不能據此認定需改長度參數名稱，應只送 1 次。
- 原因：unknown 類規則允許 40 字距離，會跨逗號把兩個不同欄位的錯誤連在一起，而且先於數值錯誤排除。
- 建議：將未知／不支援敘述與實際參數名稱做明確結構關聯；有多欄位錯誤、關聯不明時保守不重送。不要單純把數值排除移到最前，以免破壞明確替代參數或結構化 extra_forbidden 的合法案例。
- 風險：不必要的額外請求、延遲及可能的額度消耗；是否計費由供應商決定，本次未驗證計費。

## 必修 R6-2：逐行 JSON 收到 DONE 仍等待 EOF

- 位置：`src/ai/byok/client.ts:366`、`:371`、`:380`。
- 輸入：body 送出以下內容後保持開啟：

```text
{"choices":[{"delta":{"content":"回答"}}]}
[DONE]
```

- 實際：等待 25ms 後 `settled=false`、`canceled=0`；手動關閉 body 後才取得文字「回答」。
- 原因：JSON 模式只累積 `pending`，直到讀取 EOF 才進入逐行 fallback。即使結束標記完整到達，也尚未被解析；這是控制流程限制，不是 25ms 的效能標準。
- 預期：若宣稱支援逐行 JSON，辨識該格式後應增量處理，收到 DONE 即停止、取消仍開啟的 body。
- 建議：在保留完整／多行格式化 JSON 支援的前提下，明確區分逐行 JSON 並增量解析；或者明確取消逐行串流相容承諾，只將它定位為已結束回應的 fallback。
- 範圍：這是額外相容路徑，並非標準 OpenAI SSE；標準 SSE 的 DONE 測試通過。故本項不是所有服務都會遇到。

## 第六輪四項重點

1. **舊探測**：r5 套件 395 通過、6 失敗；六項失敗是「斷言舊缺陷存在」的觀察測試，現在因修復而失敗，並非六項倒退。已核對實際失敗輸出：CRLF 回答恢復、過大回應拒絕、串流錯誤 cancel=1、單純值錯誤 calls=1、憑證不外露、DONE 後僅保留前文。
2. **憑證過濾**：一般 `Input tokens exceed context window`、`Unsupported parameter: max_tokens` 仍可顯示；每 3 字分隔的模擬金鑰會隱藏。`missing key 'messages'` 被隱藏是已知保守代價。未在本輪樣本找到新的憑證外露，不能據此保證所有編碼／變形均安全。
3. **數值排除**：`The max_tokens parameter is not supported for this model; value applies to legacy requests.` 判定不重送。確有相容性漏判，但屬安全方向；列建議，不要求為提高相容率放寬自動重試。另有 R6-1 的不安全方向誤判，須獨立修正。
4. **讀取取消**：標準 SSE DONE 後即使還有 error 資料且 body 未關閉，結果只含「回答」，cancel=1。等待讀取中使用者 abort 保留 AbortError。91 個 UTF-8／CRLF 雙區塊切點全部通過。正常 EOF 的既有完整 JSON 與 SSE 測試通過；未證明每種瀏覽器與代理都具相同行為。逐行 JSON 則仍有 R6-2。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| TypeScript | 通過 |
| ESLint | 通過 |
| 題庫結構驗證 | 835 題，0 錯誤、0 警告 |
| 正式單元測試 | 393 通過 |
| 正式 build | 通過 |
| r5 舊缺陷探測與既有測試 | 395 通過、6 項舊缺陷斷言預期失敗 |
| r6 新探測與既有測試 | 400 通過；其中 2 項觀察型測試證明上述缺口存在 |
| 倒數、到期中止、本機偵測 UI 瀏覽器測試 | 4 通過（桌面與手機） |
| 完整 E2E（獨立子路徑預覽） | 54 通過、2 選用略過 |

本輪沒有變動題庫與 Python，未重跑 Pyodide／CPython，也未逐題重新審閱內容。未使用付費金鑰或真實雲端服務，不將模擬結果宣稱為所有供應商實測成功。

## 證據

- `docs/audit-30min-r6.extra.test.ts`、`docs/audit-30min-r6.config.mts`
- `docs/audit-30min-r6-observations.jsonl`
- `docs/audit-30min-r6-old-probes.log`、`docs/audit-30min-r6-extra.log`
- `docs/audit-30min-r6-typecheck.log`、`docs/audit-30min-r6-lint.log`、`docs/audit-30min-r6-validate-content.log`、`docs/audit-30min-r6-test.log`、`docs/audit-30min-r6-build.log`
- `docs/audit-30min-r6-browser.log`、`docs/audit-30min-r6-e2e.log`

以上稽核檔僅留本機，不加入版本控制。下一步由 Claude 修正 R6-1／R6-2 後請求複查。
