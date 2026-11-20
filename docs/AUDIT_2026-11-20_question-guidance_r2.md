# AI 導師提問引導：第二輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加當前未提交修改；依複查請求最後「第二輪」。

## 結論

**暫不同意本批提問引導改動發布。** G1 原誤放行案例已修復；G2 的「已完成學習提問後離開再返回」亦修復。但 G2 宣稱的「過期請求不寫回」仍有 A→B→A 等待競態，列為一項 P2 必修 G2-R2。

另正式單元測試首跑有一項連線狀態文案斷言失敗，重跑全套通過；保留兩次日誌並列為穩定性建議，不宣稱首跑全綠，也未修改／刪除正式測試。

## G1 驗收：通過原反例與擷取範圍檢查

程式位置：`src/ai/byok/retrieval.ts:259`–`:280`、conceptHits 的整詞判斷。

- 細項名稱與 scopeTerms 仍收錄；scopeTerms 的 `|` 替代詞分開處理。
- 講義只取「名詞與定義」列表術語，以及指定觀念小節的三級標題，不再全篇掃粗體。
- 案例段落中的出版社／行銷部不再當強依據。
- 英文名詞使用 escapeRe 與詞界，不再用任意字串子片段匹配；正式回歸測試含 overfittingx 不誤中 Overfitting。

重新用真實講義與課綱資料執行：

| 問句 | conceptHits | 判斷 |
| --- | --- | --- |
| 推薦旅遊書的出版社 | [] | possible_off_topic |
| 行銷部今晚聚餐餐廳推薦 | [] | possible_off_topic |
| 協同過濾如何推薦電影？ | 含協同過濾 | 允許 |
| 推薦系統怎麼決定要推薦哪部電影 | 含推薦系統 | 允許 |

原 `docs/audit-r12-guidance.config.mts` 的 G1 是輸出觀察而非失敗斷言；已讀取本輪觀察並在新探測補上正反斷言，不以「舊測試沒有失敗」代替驗收。

範圍限制：從定義／小標題擷取比粗體可靠，但仍是啟發式詞彙判斷，不代表任何術語搭配都是真正學習意圖。此次未證明新的 G1 必修問題。

## G2 驗收：一般切換通過，等待競態未通過

已完成 A 講義的學習提問後切至 B 再返回 A：短問句「可以再白話一點嗎？」被擋、請求數保持 1。原同講義延續、清除對話及 none 情境切換測試均通過。

### 必修 G2-R2（P2）：等待中的 A 請求離開後返回，仍重新寫入資格

位置：`src/components/TutorChat.tsx:182`–`:185`、`:223`、`:245`、`:265`。

實際步驟（只模擬資料檢索的延遲與服務回應）：

1. A＝L11301，送出「什麼是過擬合？」。
2. 在 prepareTurn 等待中停住；目前服務請求數是 0。
3. 切換情境至 B＝L11101，再返回 A；兩次切換各自完成 React 更新。
4. 釋放原 A 的 prepareTurn；舊請求仍送出，請求數變 1。
5. 再送「可以再白話一點嗎？」；請求數變 **2**，沒有被本機擋下。

預期：一旦離開 A，舊請求不應恢復 A 的延續資格；返回 A 後上述短追問應被擋。是否還顯示先前回答可依產品決定，但不能由舊請求重建已失效資格。

原因：useEffect 在 key 改變時清空資格是有效的；但等待結束後只比較「現在 key 是否等於起始 key」。A→B→A 再次相等，因此 `:265` 寫回。stillValid 也沒有情境世代檢查，不能區分「從未離開」與「已離開又返回」。

建議：送出時記錄情境世代／生命週期標記，每次有效情境切換立即使舊世代失效；資格寫入與必要的請求繼續判斷都確認同一世代。可在切換時中止舊流程，但仍要防止已解決的非同步工作再次寫回。不要只增加另一個 key 相等檢查。加入 pending prepareTurn 的 A→B→A 及檢索等待階段的對照，保留背景分頁「未換情境不失效」的既定規則。

證據：`docs/audit-guidance-r2.extra.test.tsx` 的 pending 測試，`docs/audit-guidance-r2-observations.jsonl` 中 `PENDING_ABA: {calls:2}`。該測試斷言重現缺口，通過不代表產品已驗收。

## S1 建議：連線表單測試的非同步文案斷言需穩定化

位置：`tests/unit/connection.test.tsx:157`–`:158`；對應 `src/components/ByokSettings.tsx:127`–`:143`。

正式 test 首跑：418 通過、1 失敗。先 waitFor 連線 store online，再立即期待 role=status 含「已連線」；實際還是「已儲存。正在連線…」。之後不改任何程式或正式測試，重跑全套 419 通過，額外套件內的同項亦通過。

store 更新與表單在 await 返回後的 setStatus 並非同一完成條件，建議測試對實際 status 文案也 waitFor，而非刪斷言或增加任意 sleep。本輪證據不足以認定 UI 永久停留連線中，故不另列產品必修，但不能把偶發測試失敗省略。

## 引導互動與限制回歸

- 重新跑既有補充瀏覽器探測：2 通過；兩種裝置設定均固定 viewport=360×800。
- 修改問題與講義引導只填草稿，鍵盤 Enter 操作可用；請求維持 0，頁面無橫向溢出，引導不遮擋輸入框。
- 到期後點草稿仍不能送出。原考試鎖定元件探測通過，完整 E2E 的練習未提交／考試保護也通過。
- 本輪沒有改原因文案，未發現新增的意圖斷言或教人繞過關鍵字問題。
- 沒有實機軟鍵盤／螢幕閱讀器語音驗收，不能將原生 button 與 aria 標記宣稱為完整無障礙測試。

## 指定檢查結果

| 指令／探測 | 實際結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test 首跑 | 418 通過、1 文案時序斷言失敗（S1） |
| test 不改碼重跑 | 419 通過 |
| build | 通過 |
| test:e2e | 54 通過、2 選用略過 |
| 指定 r12-guidance 探測＋既有測試 | 422 通過、1 舊 A→B→A 缺陷斷言預期失敗 |
| r2 新探測＋既有測試 | 422 通過，含重現 pending 競態的觀察型斷言 |
| 草稿／360px／到期瀏覽器探測 | 2 通過 |

E2E 以 Edge、TZ=UTC、獨立本機預覽及 `/ipas-ai-prep/` 子路徑執行。沒有真實雲端／付費金鑰或 Ollama 測試；沒有重跑 Python、逐題內容重審（指定命令亦未要求）。

## 本機證據（不 stage）

- `docs/audit-guidance-r2.config.mts`、`docs/audit-guidance-r2.extra.test.tsx`、`docs/audit-guidance-r2-observations.jsonl`
- `docs/audit-guidance-r2-typecheck.log`、`docs/audit-guidance-r2-lint.log`、`docs/audit-guidance-r2-final-lint.log`
- `docs/audit-guidance-r2-validate-content.log`、`docs/audit-guidance-r2-test.log`（首跑）、`docs/audit-guidance-r2-test-rerun.log`
- `docs/audit-guidance-r2-build.log`、`docs/audit-guidance-r2-e2e.log`、`docs/audit-guidance-r2-old-probes.log`、`docs/audit-guidance-r2-extra.log`
- `docs/audit-guidance-r2-browser.log`（重跑既有 audit-guidance 瀏覽器設定，其 observation JSONL 會追加、截圖會更新）

未修改正式程式或題庫、未提交／推送或 stage 稽核檔，未更改／延長 Ollama 許可。下一步修正 G2-R2 的世代失效，並處理／記錄 S1 測試時序，再請複查。
