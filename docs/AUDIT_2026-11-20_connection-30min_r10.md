# AI 導師 30 分鐘連線：第十輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加當前未提交修改，依請求文件最後「第十輪」。

## 發布結論

**暫不同意發布本批未提交改動。** R9-1、R9-2 原始反例已修復，新增解析器也改善了錯誤容器隔離；但範圍限定仍有一項 P2 必修。此結論不撤銷已發布正式版的既有驗收。

未修改正式程式或題庫，未提交、推送或 stage 稽核檔，未變更／延長 Ollama 許可。只新增本機探測、報告及進度紀錄。服務回應全為模擬，無真實 AI 或付費金鑰呼叫。

## 原反例驗收

| 項目 | 實際結果 |
| --- | --- |
| int_type 錯誤的 input 是含 extra_forbidden／loc 的物件 | false，完整 HTTP 400 流程 1 次請求 |
| body 裡含 param＋unsupported_parameter | false，不從 body 取紀錄 |
| `Use max_completion_tokens instead for a different model.` | false，1 次 |
| `If you switch to a newer endpoint. Use max_completion_tokens instead.` | false，1 次 |
| 根層級 JSON、`Error:` JSON、`Error =` detail 陣列的明確名稱錯誤 | true |
| Python repr 額外欄位、tuple loc、None | true |
| 有撇號而無法可靠轉換、損壞物件、body 內的偽錯誤 | false |
| `Unsupported parameter: max_tokens with this model. Use max_completion_tokens instead.` | true，合法替代仍可使用 |

指定 r9 探測：**410 通過、2 失敗**。兩項是斷言原缺陷存在的觀察測試，修復後預期失敗，並非產品倒退；沒有修改原探測來使數字好看。

## 必修 R10-1（P2）：範圍限定只擋替代建議分支，最後仍回傳 rejected

位置：`src/ai/byok/client.ts:355`–`:364`，重送使用處 `:397`。

實際輸入與輸出：

| error.message | predicate | 完整 HTTP 400 請求次數 |
| --- | --- | --- |
| `For a different model, max_tokens is not supported. Use max_completion_tokens instead.` | true | 2 |
| `If you switch to a newer endpoint, max_tokens is not supported. Use max_completion_tokens instead.` | true | 2 |

預期均為 false／1 次：參數名稱的「不支援」本身也屬於其他模型或尚未滿足的端點條件，並非目前請求的名稱拒絕。

原因：SCOPED 正確匹配了限定詞，讓替代建議的 if 不成立，但程式接著走到 `return rejected`，仍使用未考慮作用範圍的 namesParam 結果。因此「限定在整則訊息都不套用」尚未涵蓋最終重送決策。

建議：把「名稱拒絕是否確實描述目前請求」納入共同決策，不只保護 use instead 分支。對上述只有條件式拒絕、無當前請求拒絕證據的情況不重送。不要把所有含 if 的錯誤都無差別當產品失敗；保守不重送可接受，重點是避免其他分支繞過相同範圍判斷。

## 未成立的疑慮：非冒號前綴

追加探測 Validation failed  加 int_type／integer 值錯誤與 input 內的名稱拒絕字句，實際 predicate=false、完整流程只送 1 次。因此本例未重現誤重送，不列必修。最終探測已改為驗證保守結果；第一次使用錯誤預期的日誌仍保留，避免掩蓋驗證過程。

## 對本輪兩個特別確認點的回答

1. **結構化判定及 Python repr 的保守程度**：合法 JSON 優先解析、只走 error／errors／detail、不進 input／body 是正確方向；冒號、等號前綴和 tuple／None 的實測成功。拒絕含跳脫或撇號的受限 repr，屬安全方向相容性代價，可接受。`Error occurred {"param":"max_tokens","code":"unsupported_parameter"}` 實測不重送，也只是漏判；追加的 int_type／integer＋誤導 input 範例也只送 1 次，未證明此處有必修缺陷；任意前綴的相容性仍有限。
2. **整則訊息有 if／when 導致漏判是否可接受**：可以接受保守漏判。例如 `Use max_completion_tokens instead when sending this request.` 實測 false；正常 `with this model` 仍 true。可列文件限制，勿為提高相容率隨意放寬。但 R10-1 顯示，現行保守檢查尚未套用所有能導致重送的路徑。

## 驗證結果

| 指令／探測 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增最終探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 407 通過 |
| build | 通過 |
| 指定 r9 探測＋既有測試 | 410 通過、2 舊缺陷斷言預期失敗 |
| r10 最終探測＋既有測試 | 412 通過；含重現上述缺口的觀察型斷言，不等於產品驗收通過 |
| test:e2e | 54 通過、2 選用略過，exit=0 |

E2E 用 Edge、TZ=UTC，執行 `npm run test:e2e -- --config docs/audit-v110-r2.playwright.config.mts --workers=2`，獨立本機預覽及 `/ipas-ai-prep/` 子路徑。沒有測真實供應商的格式或計費；額外請求是否計費由供應商決定。未逐題內容審閱、未重跑 Python（本輪未改 Python 或題庫，指定命令亦未要求）。

## 本機證據（不 stage）

- `docs/audit-30min-r10.config.mts`、`docs/audit-30min-r10.extra.test.ts`、`docs/audit-30min-r10-observations.jsonl`
- `docs/audit-30min-r10-typecheck.log`、`docs/audit-30min-r10-lint.log`、`docs/audit-30min-r10-final-lint.log`
- `docs/audit-30min-r10-validate-content.log`、`docs/audit-30min-r10-test.log`、`docs/audit-30min-r10-build.log`
- `docs/audit-30min-r10-old-probes.log`、`docs/audit-30min-r10-extra.log`、`docs/audit-30min-r10-extra-final.log`（曾含一項錯誤預期，已更正）、`docs/audit-30min-r10-extra-verified.log`（最終 412 通過）、`docs/audit-30min-r10-e2e.log`

下一步：修正限定判斷的分支繞過，保留已通過案例，再請複查。

