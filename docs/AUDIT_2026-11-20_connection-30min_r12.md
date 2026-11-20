# AI 導師連線：第十二輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加未提交修改；依請求文件最後「第十二輪」。

## 結論

**同意本次已複查的連線修正。** R11-1 已修好，本輪未發現此範圍的新必修問題。本同意不包含另一份提問引導改動，也不授權提交／推送。工作區整批能否發布，仍須看 `docs/AUDIT_2026-11-20_question-guidance.md` 的待修問題。

## R11-1 驗收

位置：`src/ai/byok/client.ts:309`–`:316`、`:352`–`:360`。

- structuredErrorRecords 將父層 type／code／msg／message 經 inherited 傳給 error／errors／detail 子層，陣列保留父層上下文。
- 子紀錄對 inherited＋自身 kindText 檢查限定，因此父層說明其他模型、子層 unsupported_parameter 不再觸發替代。
- 沒有遍歷 input／body，ownText 也只讀錯誤說明白名單，不會把被拒資料加入 inherited。

原反例：

```json
{"message":"The following applies only for other models.","detail":[{"param":"max_tokens","code":"unsupported_parameter"}]}
```

重跑原 r11 探測，觀察輸出 predicate=false、calls=1；原測試期待 calls=2，現在預期失敗。額外對 error／errors／detail 三種容器測試均 false。

對照：父層無限定、子層 param=max_tokens＋unsupported_parameter，且 input 含 `If using other models`，仍回 true；被拒資料沒有污染決策。既有測試含完整合法重送與父層限定單次請求，均通過。

## 共同工作區驗證

本輪兩份請求使用同一工作區快照，以下完整檢查共用一次執行結果，沒有為兩份報告重複計算測試數。

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（加入最終探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 416 通過 |
| build | 通過 |
| test:e2e | 54 通過、2 選用略過 |
| 指定 r11 探測＋既有測試 | 418 通過、1 項舊缺陷斷言預期失敗 |
| 兩份請求的額外探測＋既有測試 | 420 通過；部分觀察型測試重現的是提問引導問題，不是連線失敗 |
| 引導瀏覽器補充 | 2 通過（兩種瀏覽器裝置設定皆固定測 360×800） |

E2E：Edge、TZ=UTC，獨立本機預覽、`/ipas-ai-prep/` 子路徑。沒有真實 AI／付費金鑰測試，也未連線或變更 Ollama。Python 與內容語意未於本輪重審；指定命令沒有要求 verify:python。

## 證據

- `docs/audit-r12-guidance-old-probes.log`（指定 r11 套件）
- `docs/audit-r12-guidance.config.mts`、`docs/audit-r12-guidance.extra.test.tsx`
- `docs/audit-r12-guidance-extra-verified.log`、`docs/audit-r12-guidance-observations.jsonl`
- `docs/audit-r12-guidance-typecheck.log`、`docs/audit-r12-guidance-lint.log`、`docs/audit-r12-guidance-final-lint.log`
- `docs/audit-r12-guidance-validate-content.log`、`docs/audit-r12-guidance-test.log`、`docs/audit-r12-guidance-build.log`、`docs/audit-r12-guidance-e2e.log`

未修改正式程式或題庫、未提交／推送或 stage 稽核檔，未更改／延長 Ollama 許可。
