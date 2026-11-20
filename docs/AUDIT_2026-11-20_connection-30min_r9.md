# AI 導師 30 分鐘連線：第九輪複查

日期：2026-11-20（Asia/Taipei）。基準：HEAD `aed6b20` 加當前未提交修改；依請求文件最後「第九輪」。

## 發布結論

**暫不同意發布本批未提交改動。** R8-1、R8-2 的原始反例已修好，但仍有兩項可重現的 P2／必修（R9-1、R9-2）。本結論不涉及已發布正式版的既有驗收。

未修改正式程式或題庫，未提交、推送或 stage 稽核檔，未更改／延長 Ollama 許可。僅建立本機稽核證據、報告與更新進度；服務回應全為模擬，無真實 AI 或付費金鑰呼叫。

## 原修正驗收

| 項目 | 實際結果 |
| --- | --- |
| R8-1 int_parsing，input 字串含 unknown field | false，完整呼叫只送 1 次 |
| R8-2 invalid value；use … instead for other models | false，完整呼叫只送 1 次 |
| `Unsupported parameter: max_tokens with this model. Use max_completion_tokens instead.` | true，合法重送維持 |
| `Use max_completion_tokens instead.` | true，依本輪規格維持 |
| OpenAI 型 param＋unsupported_parameter | true |
| pydantic extra_forbidden、loc tuple 指向 max_tokens | true |
| 結構化 invalid_request_error，只說 Request rejected | false，保守方向正確 |
| greater_than、input 字串含 extra_forbidden | false |

指定的 r8 舊探測為 **407 通過、2 失敗**：兩項均為斷言「舊缺陷仍存在」的觀察測試，修復後預期失敗，不是產品倒退；未修改原探測來消除失敗。

## 必修 R9-1（P2）：巢狀 input 仍會被當作錯誤物件

位置：`src/ai/byok/client.ts:289`、`:297`–`:303`。

服務 error.message 字串輸入：

```json
{"type":"int_type","loc":["body","max_tokens"],"msg":"Input should be a valid integer","input":{"type":"extra_forbidden","loc":["body","max_tokens"]}}
```

實際輸出：`rejectsTokenParam(raw, 'max_tokens') === true`；完整 streamChat 模擬 HTTP 400 流程 **2 次請求**。

預期：false，1 次。外層是整數型別驗證失敗，input 是被拒的物件值，不是供應商對參數名稱的判斷。

原因：`raw.match(/\{[^{}]*\}/g)` 只擷取最內層無大括號物件，忽略外層驗證錯誤，反而解析了 input 內的 type／loc。即使 field() 只讀白名單鍵名，也沒有隔離「這些欄位究竟屬於錯誤紀錄還是被拒資料」。

建議：合法 JSON 優先 JSON.parse，僅從明確錯誤容器（error、detail 的錯誤陣列等）遍歷，禁止遞迴進入 input／body／被拒資料。非 JSON 的 Python dict／tuple 表示法需受限解析或保守不重送，不以最內層 `{…}` 全域掃描當錯誤列表。加入巢狀 input、字串內含物件樣式、父層值錯誤等反例。不要僅增加一條針對此字串的 regex。

## 必修 R9-2（P2）：限定範圍有冠詞或跨句時仍套用替代建議

位置：`src/ai/byok/client.ts:317`–`:320`。

| 實際輸入 | predicate | 完整 HTTP 400 模擬請求次數 | 預期 |
| --- | --- | --- | --- |
| `Use max_completion_tokens instead for a different model.` | true | 2 | false／1 次 |
| `If you switch to a newer endpoint. Use max_completion_tokens instead.` | true | 2 | false／1 次 |

第一例在 for 與 different 中間有 a，因此 SCOPED 漏判；第二例條件在前句，而程式只檢查替代建議所在句。兩例皆不代表目前請求應改名。

建議：限定詞至少涵蓋冠詞（a／an／the），並保留跨句的條件／作用範圍。對整段錯誤存在明確換模型或端點條件、又無證據適用目前請求的情況，保守不重送。保留 `with this model` 的明確當前範圍與無限定的合法替代。

此處不要求理解任意自然語言；若無法可靠分類，停止推測並向使用者顯示錯誤即可。條件式錯誤的額外請求是否計費由供應商決定，本輪未測計費。

## 對文末兩個問題的回答

1. **結構化卻未明確指出名稱不被接受，是否過度保守？** 不認為是阻擋問題。未知錯誤不自動再發送是合理預設；目前 OpenAI param＋unsupported_parameter 與 pydantic 額外欄位的典型案例均通過。可能漏掉只建議 Use … instead 的結構化格式，屬安全方向相容性限制，可另補明確的結構化替代語意，不能回退到掃描 input。真正必修是 R9-1 的容器識別問題。
2. **限定詞是否漏網或誤擋，with this model 呢？** `with this model` 實測不被誤擋；明確拒絕當前參數＋建議替代仍為 true。原 for other models 已修復。但上述冠詞與跨句條件屬明顯漏網，需修正。SCOPED 仍是固定英文詞規則，不應宣稱任意供應商訊息皆可辨識。

## 測試結果

| 指令／探測 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint，新增探測後再跑 | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 404 通過 |
| build | 通過 |
| 指定 r8 探測＋既有測試 | 407 通過、2 舊缺陷斷言預期失敗 |
| r9 新探測＋既有測試 | 409 通過；含確認上述缺口存在的觀察型斷言，不代表產品驗收通過 |
| test:e2e | 54 通過、2 選用略過，exit=0 |

E2E 以 Edge、TZ=UTC，執行 `npm run test:e2e -- --config docs/audit-v110-r2.playwright.config.mts --workers=2`，獨立本機預覽與 `/ipas-ai-prep/` 子路徑。未重跑 Python（本輪未改題庫或 Python，指定指令未要求），未逐題重審內容，也未使用真實雲端供應商或 Ollama。

## 本機證據（不 stage）

- `docs/audit-30min-r9.config.mts`、`docs/audit-30min-r9.extra.test.ts`、`docs/audit-30min-r9-observations.jsonl`
- `docs/audit-30min-r9-typecheck.log`、`docs/audit-30min-r9-lint.log`、`docs/audit-30min-r9-final-lint.log`
- `docs/audit-30min-r9-validate-content.log`、`docs/audit-30min-r9-test.log`、`docs/audit-30min-r9-build.log`
- `docs/audit-30min-r9-old-probes.log`、`docs/audit-30min-r9-extra.log`、`docs/audit-30min-r9-e2e.log`

下一步：以錯誤容器邊界與替代建議適用範圍修正 R9-1／R9-2，保留已通過的典型案例，再請複查。
