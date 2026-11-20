# AI 導師 30 分鐘連線：第七輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加當前未提交修改；依複查請求最後「第七輪」。

## 發布結論

**暫不同意發布本批未提交改動**：R6-1、R6-2 的原始反例已修好，但各有一項仍可重現的邊界問題（以下 R7-1、R7-2，均 P2／必修）。不涉及撤銷先前正式 v1.1.0 的驗收。

本次只新增稽核證據及報告、更新進度；未修改正式程式或題庫，未提交、推送或 stage 檔案，未變更／延長 Ollama 許可。所有服務回應均為模擬，沒有付費金鑰或真實 AI 呼叫。

## 原修正驗收

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| R6-1 原混合錯誤反例 | 通過 | `Unknown parameter: stream, max_tokens must be a positive integer` 現在只送 1 次，predicate=false |
| R6-2 原無 EOF 的逐行 JSON | 通過 | 不含前導空白行的 JSON＋DONE，25ms 後 settled=true、canceled=1；83 個雙區塊 byte 切點均正常取消並返回「回答」 |
| CONSERVATIVE_FALSE_NEGATIVE 行為改變 | 同意 | `The max_tokens parameter is not supported for this model; value applies to legacy requests.` 現在 predicate=true。前半句明確指出不支援目前參數，後半句的 value 不應否定前半句；在 HTTP 400 下只換參數重送一次合理 |

重跑原 `docs/audit-30min-r6.config.mts`：400 通過、3 失敗。三項分別是原 R6-1 缺陷斷言、原 R6-2 缺陷斷言與舊的保守不重送期望，現在均因預期行為改變失敗；不是三個產品倒退。原探測未被修改來掩蓋結果。

## 必修 R7-1（P2）：同一片段／物件內共現，仍不足以證明參數關聯

位置：`src/ai/byok/client.ts:275`、`:279`、`:284`；HTTP 400 重送判斷在 `:317`。

實測輸入與輸出：

| 輸入 message（param=max_tokens） | 實際 | 預期 |
| --- | --- | --- |
| `Unknown parameter: stream but max_tokens is valid` | true；完整呼叫收到 2 次 HTTP 請求 | false；只送 1 次 |
| `Unknown parameter: stream (max_tokens is supported)` | true | false |
| `{'type':'extra_forbidden','loc':['body','stream'],'input':'max_tokens'}` | true | false |

第一、二例未知欄位是 stream，後面還明說 max_tokens 合法／受支援，但「同一片段」同時含 UNKNOWN 與名稱即被判定重試。第三例物件的 loc 指向 stream，max_tokens 只是被拒輸入值；同一物件共現仍不是錯誤欄位的定位。這些字串作為服務的 error.message 可走目前實際 readError 路徑。

建議：文字要把否定詞實際修飾的欄位與目前參數對應；不明確時不重送。結構化錯誤應解析 loc／param／field 等定位欄位，不能只掃整個物件的任意值。補上「目前參數已支援」及 input 值含名稱的反例。單純新增 but 切分無法處理括號、其他標點及結構化 input。

另觀察 `max_tokens: invalid value; use max_completion_tokens instead for other models` 也回 true：明確替換分支不檢查是否描述當前請求。可一併加入保守判斷；不另計一項必修。以上只證明可能多發請求，不宣稱供應商必然計費。

## 必修 R7-2（P2）：前導空白行使 NDJSON 永遠無法辨識，DONE 又等待 EOF

位置：`src/ai/byok/client.ts:385`–`:387`。

重現：body 先送以下內容（第一行是空白行），然後保持開啟。

```text

{"choices":[{"delta":{"content":"回答"}}]}
[DONE]
```

實際：30ms 後 `settled=false`、`canceled=0`；手動關閉 body 才取得「回答」。不是以 30ms 作效能門檻，而是控制流程持續對 pending 的第一個換行取出空字串，`isJson('')` 永遠 false，無法進入 ndjson。

建議：格式判斷使用第一個非空白完整行，並安全略過串流前導空白行，同時保留多行排版完整 JSON 的辨識。增加前導 LF／CRLF、多個空白行及跨區塊案例。不應只在 EOF fallback 才略過空行。

範圍：標準 SSE 的 DONE 正常；缺口限於程式承諾額外相容的逐行 JSON。若決定不支援帶空白行的相容回應，應明確拒絕並說明，而非讓已完成的回答持續等待。

## 其他邊界與限制

- 正常 NDJSON 的 DONE 後錯誤物件被忽略；中途 error 物件會丟錯、cancel=1，已顯示文字只有 A，後面的 B 不顯示。
- 前導空白的多行排版單一 JSON 仍正確取得「完整」，因此修 R7-2 要保留此行為。
- `Unsupported parameter, max_tokens` 現在不重送：逗號分割產生安全方向漏判，可列相容性建議；不要為此退回不分欄位的寬鬆匹配。
- 第一行完整 JSON 的識別是啟發式，並非任意協定解析器；本輪針對 Chat Completions 形狀及文件承諾的 fallback 驗證，未宣稱支援原生 Ollama NDJSON、Responses API 或任意 JSON 陣列。
- 憑證過濾、91 個 SSE UTF-8／CRLF 分割、SSE DONE 與中止探測仍在舊套件通過；不代表所有第三方錯誤格式均無洩漏。

## 測試結果

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 396 通過 |
| build | 通過 |
| r6 原探測＋既有測試 | 400 通過、3 項舊期望失敗，原因見上文 |
| r7 額外探測＋既有測試 | 401 通過；其中觀察型斷言通過代表成功重現 R7-1／R7-2，不代表產品通過 |
| test:e2e | 54 通過、2 選用略過；Edge 桌面 1440／手機 390，獨立本機預覽及 /ipas-ai-prep/ 子路徑，exit=0 |

本輪沒有改 Python 或題庫，未重跑 Python 兩引擎，也未逐題內容重審；使用者指定的本輪命令未含 verify:python。

## 證據檔（僅本機，不 stage）

- `docs/audit-30min-r7.extra.test.ts`、`docs/audit-30min-r7.config.mts`
- `docs/audit-30min-r7-observations.jsonl`
- `docs/audit-30min-r7-typecheck.log`、`docs/audit-30min-r7-lint.log`、`docs/audit-30min-r7-final-lint.log`
- `docs/audit-30min-r7-validate-content.log`、`docs/audit-30min-r7-test.log`、`docs/audit-30min-r7-build.log`
- `docs/audit-30min-r7-old-probes.log`、`docs/audit-30min-r7-extra.log`、`docs/audit-30min-r7-e2e.log`

原 r6 探測會往自己的 observations JSONL 追加資料；以本輪 log 與新增的 r7 observations 區分，勿混用前一輪結果。
