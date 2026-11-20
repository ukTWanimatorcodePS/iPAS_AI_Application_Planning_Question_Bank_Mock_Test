# AI 導師 30 分鐘連線：第八輪複查

日期：2026-11-20（Asia/Taipei）。範圍：HEAD `aed6b20` 加當前未提交修改，依請求文件最後「第八輪」。

## 發布結論

**暫不同意發布本批未提交連線改動**。R7-1 的三個原始誤判及 R7-2 已修復，但自動重送仍有以下兩項 P2 必修。這個結論只針對本次未提交內容，不撤銷既有正式版的驗收。

未修改正式程式或題庫，未提交、推送、stage 稽核檔，未變更或延長 Ollama 許可。服務回應全為模擬，不含真實／付費金鑰與 AI 呼叫。

## 修正驗收

| 項目 | 結果 |
| --- | --- |
| R7-1 `Unknown parameter: stream but max_tokens is valid` | false，原誤判修復 |
| R7-1 `Unknown parameter: stream (max_tokens is supported)` | false，原誤判修復 |
| R7-1 loc 指向 stream、input 是 max_tokens | false，原誤判修復 |
| `Unsupported parameter, max_tokens` | true；合法相容性改善 |
| `The max_tokens parameter is not supported for this model; value applies to legacy requests.` | true；維持第七輪同意的合理重送行為 |
| R7-2 前導 LF／CRLF／多個空白行 | 265 個雙區塊 byte 分割切點全部取得「回答」、cancel=1；DONE 後錯誤資料不顯示 |
| 前導空白行＋多行排版單一 JSON | 正常取得「完整」 |

第七輪原探測重新執行：404 通過、2 失敗。兩項是斷言「舊誤判表」及「前導空白行仍等待 EOF」的觀察測試，因修復而失敗，並非兩項產品倒退；原檔案未修改。

## 必修 R8-1（P2）：結構化錯誤的分類仍會讀到 input 值

- 位置：`src/ai/byok/client.ts:277`–`:285`，尤其 `:278`。
- 實際輸入（作為服務 error.message 字串）：

```json
{"type":"int_parsing","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":"unknown field"}
```

- 實際輸出：`rejectsTokenParam(raw, 'max_tokens') === true`；完整 streamChat 模擬 HTTP 400 流程收到 **2 次**請求。
- 預期：false，1 次請求。這是已知欄位的整數解析失敗，並非未知欄位或參數名稱不支援；更換參數名稱無法合理修復被拒的值。
- 原因：定位名稱雖已限縮到 loc 等欄位，但「是否屬於未知／額外欄位」仍對整個物件做 regex。`input` 中的 unknown field 觸發分類，接著 loc 正好是 max_tokens，便在數值排除之前回 true。
- 建議：同時限制錯誤分類的來源與定位欄位；依 type／code 及必要的 msg 判斷「不支援名稱」，不得用 input 等被拒資料作為分類依據。能解析的 JSON 應結構化處理；不明確格式保守不重送。補上 int_parsing、greater_than 等值錯誤搭配誤導 input 的反例。

## 必修 R8-2（P2）：替代建議限定其他模型，仍強制套用目前請求

- 位置：`src/ai/byok/client.ts:273`。
- 輸入：`max_tokens: invalid value; use max_completion_tokens instead for other models`。
- 實際輸出：predicate=true；模擬 HTTP 400 完整流程送出 **2 次**請求。
- 預期：false，1 次請求。
- 原因：無條件匹配 use … instead 並最先 return true，忽略「for other models」的適用範圍與前文 invalid value。

### 對請求文件第 2 點的回答與判準

**本例不應重送。**「明確出現替代字樣」不等於「明確要求目前請求採用替代」。本例只建議其他模型使用替代參數，並未說目前模型拒絕原參數名稱，反而指出原參數值有誤。

建議的決策準則：

1. 當訊息明確表示**本次請求／目前模型**不接受目前參數名稱，並指定替代，允許換參數重送一次。例如 `Unsupported parameter: max_tokens. Use max_completion_tokens instead.`。
2. 當建議明確限定其他模型、其他端點、不同 API 版本或未滿足條件，不自動套用。無法確定適用範圍時只顯示錯誤，交由使用者調整。
3. 不要把所有數值排除簡單移到最前；針對當前請求的明確名稱替代仍應保留。需要判斷的是建議與目前請求的關聯，而非只調整 regex 優先順序。

此項是對第七輪曾列為附帶觀察、而本輪明確要求裁決的行為給出必修結論；不是 R7-1 三個已修反例再次失敗。

## 其他相容性評估

- 直接修飾規則比共現規則可靠；仍是有限英文樣式比對，不能宣稱支援所有供應商錯誤格式。
- 未涵蓋如 `max_tokens not supported`（沒有 is）等簡略寫法，可能安全方向漏判；此類應列相容性改善，不能以增加誤重送為代價。
- 前導空白行只要求 LF／CRLF 與空格、tab；本輪已覆蓋 UTF-8 分段及 CRLF 分段。未把任意原生協定或任意 Unicode 分隔符視為本站承諾支援範圍。
- 本輪未逐題審閱內容，也未重跑 Python；題庫結構驗證不等於人工審核。未使用真實雲端服務驗證供應商格式或計費；額外請求是否計費由供應商決定。

## 驗證結果

| 指令／探測 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint；新增稽核後再跑一次 | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 401 通過 |
| build | 通過 |
| 指定 r7 探測＋既有測試 | 404 通過、2 舊缺陷斷言預期失敗 |
| r8 新探測＋既有測試 | 406 通過；包含重現上述缺口的觀察型斷言，不能當成產品已驗收 |
| test:e2e | 54 通過、2 選用略過，exit=0 |

E2E 使用 `npm run test:e2e -- --config docs/audit-v110-r2.playwright.config.mts --workers=2`，Edge、TZ=UTC，獨立本機預覽及 `/ipas-ai-prep/` 子路徑，沒有連接真實 AI。

## 本機證據（不 stage）

- `docs/audit-30min-r8.config.mts`、`docs/audit-30min-r8.extra.test.ts`
- `docs/audit-30min-r8-observations.jsonl`
- `docs/audit-30min-r8-typecheck.log`、`docs/audit-30min-r8-lint.log`、`docs/audit-30min-r8-final-lint.log`
- `docs/audit-30min-r8-validate-content.log`、`docs/audit-30min-r8-test.log`、`docs/audit-30min-r8-build.log`
- `docs/audit-30min-r8-old-probes.log`、`docs/audit-30min-r8-extra.log`、`docs/audit-30min-r8-e2e.log`

下一步：修正 R8-1、R8-2 並保留原有合法替代與 NDJSON 通過案例，再請複查。
