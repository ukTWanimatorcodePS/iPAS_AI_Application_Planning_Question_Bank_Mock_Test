# AI 導師 30 分鐘連線：第十一輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加當前未提交修改；依複查請求最後「第十一輪」。

## 發布結論

**暫不同意發布本批未提交改動**。R10-1 的文字反例及單一結構化紀錄反例已修復，但結構化父層的範圍限定未作用到子層錯誤，仍可重送，列為一項 P2 必修 R11-1。

本次未修改正式程式或題庫，未提交、推送、stage 稽核檔，未更改／延長 Ollama 許可。僅新增本機探測、報告及進度紀錄。所有服務回應均為模擬，無真實 AI 或付費金鑰呼叫。

## R10-1 修正驗收

| 實際輸入 | 結果 |
| --- | --- |
| `For a different model, max_tokens is not supported. Use max_completion_tokens instead.` | false，完整 HTTP 400 流程 1 次 |
| `If you switch to a newer endpoint, max_tokens is not supported. Use max_completion_tokens instead.` | false，1 次 |
| `{"param":"max_tokens","message":"For other models, max_tokens is not supported"}` | false，1 次 |
| `Unsupported parameter: max_tokens with this model. Use max_completion_tokens instead.` | true，2 次，合法替代維持 |
| `{"param":"max_tokens","code":"unsupported_parameter","input":"For other models only"}` | true，2 次；正確忽略被拒資料的限定詞 |

指定 `docs/audit-30min-r10.config.mts` 重跑：**413 通過、1 失敗**。失敗項是原本斷言 R10-1 缺陷存在的觀察測試，修復後預期失敗，不是產品倒退。沒有修改原探測消除失敗。

## 必修 R11-1（P2）：父層錯誤說明的範圍限定未繼承到子層

位置：`src/ai/byok/client.ts:296`–`:302` 的容器收集，以及 `:336`–`:343` 的逐筆限定檢查。

服務 error.message 字串輸入：

```json
{
  "message": "The following applies only for other models.",
  "detail": [
    { "param": "max_tokens", "code": "unsupported_parameter" }
  ]
}
```

實際輸出：`rejectsTokenParam(raw, 'max_tokens') === true`，完整 streamChat 模擬 HTTP 400 流程 **2 次請求**。

預期：false，1 次請求。外層明確說明以下內容只適用其他模型，內層不能被當成目前模型拒絕名稱的證據。

原因：structuredErrorRecords 把父層與 detail 子層攤平成獨立紀錄。父層沒有參數定位，跳過；子層有 unsupported_parameter 和 param，但 kindText 不含父層的限定說明，便 return true。文字路徑的全域 SCOPED 不會執行到，因為結構化分支已返回。

建議：保留錯誤容器的上下文，讓子層繼承父層 type／code／msg／message 中的條件／範圍限定；或者依本輪全域保守政策，先彙整「錯誤容器內白名單說明欄位」的限定，再決定是否重送。不能直接對整段 JSON 做 SCOPED 掃描，否則 input／body 裡的字句會再度污染決策；本輪已加入 input 含限定詞、合法錯誤仍可重送的對照測試。

增加父層 message＋detail、error＋errors 等上下文案例，保留單一紀錄限定、一般文字限定、當前模型合法替代與 input 隔離的既有測試。

## 限制與判斷

- 文字訊息的所有重送出口已受整則限定檢查保護；本輪未重現原文字分支繞過。
- 含 when／if 的合法當前請求可能因此不自動重送，仍屬可接受的安全方向相容性代價。
- R11-1 是同一結構化錯誤的父子作用範圍缺口，不是要求理解任意供應商自然語言。
- 額外請求是否計費由供應商決定；本輪只測請求次數，未宣稱實際重複計費。
- 無真實雲端或 Ollama 測試；未逐題內容重審、未重跑 Python（本輪未改 Python 或題庫，指定命令也未要求）。

## 驗證結果

| 指令／探測 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint，新增探測後再跑 | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 409 通過 |
| build | 通過 |
| 指定 r10 探測＋既有測試 | 413 通過、1 舊缺陷斷言預期失敗 |
| r11 新探測＋既有測試 | 412 通過；含確認 R11-1 存在的觀察型斷言，不等於產品驗收通過 |
| test:e2e | 54 通過、2 選用略過，exit=0 |

E2E 使用 Edge、TZ=UTC，執行 `npm run test:e2e -- --config docs/audit-v110-r2.playwright.config.mts --workers=2`，獨立本機預覽及 `/ipas-ai-prep/` 子路徑，不連接真實 AI。

## 本機證據（不 stage）

- `docs/audit-30min-r11.config.mts`、`docs/audit-30min-r11.extra.test.ts`、`docs/audit-30min-r11-observations.jsonl`
- `docs/audit-30min-r11-typecheck.log`、`docs/audit-30min-r11-lint.log`、`docs/audit-30min-r11-final-lint.log`
- `docs/audit-30min-r11-validate-content.log`、`docs/audit-30min-r11-test.log`、`docs/audit-30min-r11-build.log`
- `docs/audit-30min-r11-old-probes.log`、`docs/audit-30min-r11-extra.log`、`docs/audit-30min-r11-e2e.log`

下一步：修正結構化錯誤的父層範圍繼承，保留 input 隔離，再請複查。
