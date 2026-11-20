# AI 導師提問引導複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加未提交修改；依 `docs/REVIEW_REQUEST_2026-11-20_question-guidance.md`。

## 結論

**暫不同意本批提問引導改動發布**。原因分類、文案與只填草稿的互動方向可接受，但確認兩項 P2 必修：一般粗體詞被當成強學習依據，以及離開情境再返回會恢復舊延續資格。連線第十二輪則獨立通過，見另一份報告。

## 必修 G1（P2）：一般粗體詞直接變成強學習依據

位置：`src/ai/byok/retrieval.ts:251`、`:269`；`src/ai/byok/check.ts:104`。

實際輸入與輸出（使用真正講義、conceptHits、questionRelevance，非手動塞入概念）：

| 提問 | conceptHits | verdict |
| --- | --- | --- |
| 推薦旅遊書的出版社 | [出版社] | ok=true |
| 行銷部今晚聚餐餐廳推薦 | [行銷部] | ok=true |
| 協同過濾如何推薦電影？ | [協同過濾] | ok=true，合理 |
| 推薦今晚看什麼電影 | [] | possible_off_topic，合理 |

資料來源：`src/content/lessons/L12/L12201.md:91` 的 **出版社**、`src/content/lessons/L12/L12102.md:70` 的 **行銷部** 是案例產業／角色，不是課綱專業名詞。

原因：粗體僅代表排版強調，字數大於 2 不能證明是專業詞。concepts 非空直接變 strong，使普通詞蓋過生活請求判斷。這會讓明顯生活問題發出不必要的模型請求；即使模型最後拒答，也沒有滿足本機先擋下且不耗用量的目標。

建議：將自動擷取結果當「候選學習線索」，區分術語定義、單元標題與案例角色；通用詞不能單獨推翻明顯生活請求。可保留附來源與分類的可維護術語表，搭配學習意圖／依據檢索，而不是一直補黑名單。增加以上正反例，不能為修本項重新擋住推薦系統的合法問題。

## 必修 G2（P2）：A→B→A 恢復舊的延續追問資格

位置：`src/components/TutorChat.tsx:169`、`:240`–`:241`、`:258`；目前只有清除對話按鈕 `:501` 重設 lastLearningKey。

實測步驟：

1. 講義 L11301 問「什麼是過擬合？」；模擬服務收到 1 次請求。
2. 切換講義情境至 L11101，再返回 L11301，中間沒有送出新的學習問題，也沒有按清除。
3. 問「可以再白話一點嗎？」。

實際：請求次數變 2。該短問句在沒有延續資格時原本會被擋下，故此測試確認沿用了離開前的資格。

原因：lastLearningKey 只保存最後送出的 key；情境變更沒有清空。返回 A 時 key 又相等，等於恢復了舊情境。原測試只測 A→B，返回 A 前先清除對話，沒有涵蓋這個路徑。

建議：在有效情境切換／離開時使延續資格失效，並確保等待檢索中的舊請求不能再次寫回過期資格。可使用情境世代或同等生命週期處理；加入 A→B→A（不清除）、lesson→question→lesson、none→lesson 等案例。切換後若允許恢復舊對話，需明確改產品規則與使用者提示，不能仍聲稱「換頁後不延續」。

## 第 4 節四點逐項回報

1. **課綱名詞**：協同過濾合法問題已可通過，推薦今晚電影仍被擋；但 G1 誤放行重現。英文名詞目前用 substring includes，缺少詞界，另列非阻擋建議，未在本輪樣本證明具體誤放行，不當成必修。此擷取需針對產業／角色與短詞維護品質，不能把排版來源當權威術語來源。
2. **情境鍵與生命週期**：question／lesson 的 q:、l: 前綴有區分；同一路徑切換不同講義會擋下延續，清除對話也會重設。但 G2 返回舊情境的問題已重現。背景分頁本身不等同換題，不能宣稱需要一律清空；未看到延續資格時間上限，若產品需要「最近」的明確時間定義可另補需求。
3. **文案與手機版**：greeting／unclear_topic／possible_off_topic 分開，說明尚未送出與可能誤判，沒有教使用者塞 AI 關鍵字；可接受。建議將 possible_off_topic 更中性地寫成「目前無法確認與學習主題的關聯」，但現有「看起來」與誤判提醒已降低斷言，非必修。360px 實測無橫向溢出、引導下緣不碰輸入框；截圖目視文字與按鈕可讀，沒有遮擋。未測真實手機軟鍵盤、螢幕閱讀器語音或所有字級／主題，不宣稱完整無障礙驗收。
4. **限制繞過**：引導 onDraft 只有 setInput＋focus，不呼叫 API。滑鼠與鍵盤操作後請求維持 0；到期後仍不能送出。新增元件測試確認鎖定考試情境後引導及輸入框消失、請求維持 0。既有 E2E 涵蓋考試鎖定、練習未提交及設定／生命週期保護；程式碼中送出仍重新取設定快照並檢查 locked／expired／stillValid。未發現引導新增的答案或設定安全繞過。僅變更草稿時可見按鈕不代表可以越過送出限制。

## 驗證結果

與連線第十二輪共用同一工作區快照的完整測試批次；兩份報告沒有把同一批結果算兩次。

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（最終探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 416 通過 |
| build | 通過 |
| test:e2e | 54 通過、2 選用略過 |
| 共同額外探測＋既有測試 | 420 通過；其中觀察型斷言重現 G1／G2，不代表本功能通過驗收 |
| 提問引導瀏覽器探測 | 2 通過，兩種裝置設定皆固定 360×800 |

瀏覽器觀察：requests=0、overflow=false；guideBottom=551.5625，小於 inputTop=697.875。原生 button 使用 Enter 觸發能還原原問題，講義引導能填入草稿。連線到期後，按修改仍未使 disabled 的輸入框／送出恢復。

完整 E2E 使用 Edge、TZ=UTC、獨立 `/ipas-ai-prep/` 子路徑預覽。沒有使用真實 AI／付費金鑰，沒有變更 Ollama 許可。Python 與內容語意本輪未重審。

## 本機證據（不 stage）

- `docs/audit-r12-guidance.config.mts`、`docs/audit-r12-guidance.extra.test.tsx`、`docs/audit-r12-guidance-observations.jsonl`
- `docs/audit-r12-guidance-extra-verified.log`、`docs/audit-r12-guidance-typecheck.log`、`docs/audit-r12-guidance-final-lint.log`
- `docs/audit-r12-guidance-validate-content.log`、`docs/audit-r12-guidance-test.log`、`docs/audit-r12-guidance-build.log`、`docs/audit-r12-guidance-e2e.log`
- `docs/audit-guidance.playwright.config.mts`、`docs/audit-guidance.browser.spec.ts`、`docs/audit-guidance-browser.log`、`docs/audit-guidance-browser-observations.jsonl`
- `docs/audit-guidance-desktop-1440.png`、`docs/audit-guidance-mobile-390.png`：檔名沿用 project 名稱，實際 viewport 都是 360×800，不是 1440／390 寬的截圖。

未修改正式程式或題庫、未提交或推送，未 stage 未追蹤稽核檔。下一步修 G1、G2 後再請複查；不要因連線修正獨立通過就把整個工作區視為可發布。
