# v1.1.0 第三輪複查

日期：2026-11-20（Asia/Taipei）。稽核者：Codex。

依 `REVIEW_REQUEST_v1.1.0.md` 第 6 節、第二輪報告及工作區實際程式確認 R1、R2、S3、S4。基準仍為 `HEAD = origin/main = 55ca6c626e1114bb620b205606345ff13b6847c6`；檢查未提交改動，包含新檔。

**結論：同意本次已複查的 v1.1.0 工作區改動提交並推送上線。** 第二輪的兩項必修均已修復，本輪沒有發現新的阻擋上線問題。另列一項非阻擋的離題規則建議。此為驗收意見，本輪沒有實際提交或推送。

## 一、修正驗收

### R1：通過——設定與金鑰綁定、使用同一份快照

- `src/ai/byok/config.ts` 的 KeyRecord 保存 key、presetId、origin；loadByok 同步讀取設定、已綁定金鑰與版本，不匹配則不回傳金鑰。loadKey 也經此邊界，不再獨立取出無所屬的字串。
- `src/components/ByokSettings.tsx` 不再將已儲存金鑰放入長期元件 state；需要時讀 loadByok，與當前表單服務／origin 比對。兩個真實表單並存與另一表單更新設定的回歸測試通過。
- 切換服務／origin 清空未儲存金鑰；同 origin 改路徑保留可接受：這是同一服務來源的 API 路徑調整，不是把秘密交給另一 origin。信任確認仍存在。不同 origin 時等待中的結果失效，避免錯誤顯示為新服務成功。
- `src/components/TutorChat.tsx:151–165,200–202` 在 send 開頭捕捉 sendConfig＋sendKey；之後不重新混入另一份金鑰。stillValid 檢查 byokVersion；設定變更的 effect 中止進行中請求。原「檢索等待中換服務／清除金鑰」案例不再送出。
- 額外實測已進入串流的情況：先收到「開始回答」，再切換供應商，原 fetch signal 從 aborted=false 變 true，總請求仍為 1，沒有偷偷重送新服務。中止此串流的設計合理；它不保證供應商免除已計算用量，文件已保留這個限制。
- storage 事件丟棄記憶體快取並增加版本的測試通過；本輪以模擬事件驗證，沒有宣稱逐個真實多分頁交錯時序皆測過。
- 搜尋 src 的 loadConfig／loadKey／loadByok 使用點，沒有發現剩餘網路入口把兩次獨立讀取的設定與金鑰混合。ByokSettings 的 initialConfig 只讀非機密表單預設值，屬合理用途。

**舊金鑰格式**：只有字串、沒有服務綁定時拒絕沿用是合理的安全處理。BYOK 尚未正式上線，不要求替舊開發格式猜測所屬服務；重新輸入即可。這不影響既有學習紀錄或備份。

### R2：通過——備份精確保存最後選項順序

- `src/data/backup.ts:142–160,180–210` 新增選填 data.lastOptionOrders；匯出採單一唯讀交易，與 quizSessions／attempts 等取得一致快照。
- `restoredLastOptionOrders`（約 229 行）先以歷史資料盡力重建，再由備份中的合法精確排列覆蓋。不存在題目、不是本題完整排列的資料不採用；同題重複主鍵、非法代號等格式錯誤在匯入前拒絕。
- 同毫秒、主鍵順序相反的測驗案例，現在還原保留真正最後排列，不再退回第一份。補強題已顯示但尚未作答也能精確保存。對應回歸測試通過；原 r2 缺陷斷言均不再成立。
- 缺少新欄位的舊備份仍可匯入並重建；損毀的精確排列退回合法歷史排列，沒有清除歷史作答來換取通過。保留備份格式 v3 並新增選填欄位可接受，與 IndexedDB v4 是不同版本軸。
- 原 v1／v2 資料庫升級、v3→v4 回填及 v1／v2／v3 備份相容性測試均隨完整單元測試通過。本輪未修改舊版資料庫定義，也未發現為解決順序而重新修改 startAt 的情況。

### S3：指定案例通過；仍有非阻擋改善建議

`請評估今晚餐廳哪家好吃` 現在回傳 `{ok:false}`，即使相關度給 20 也會擋下；`機器學習怎麼推薦電影` 則 `{ok:true}`。強主題詞／泛用詞的拆分確實修正原例，既有正例保留並通過。

### S4：通過

`tests/unit/audit-v1-compat.test.ts:19` 已改成 current version (v4)，migration.test.ts 也區分目前 IndexedDB v4 與備份 v3；未刪除資料保存斷言。tutorRace 的假模組仍包含 nextOptionOrder，原競態斷言維持。

## 二、非阻擋建議

### N1［建議／P2］強主題詞仍可能漏掉合法的推薦系統問句

- 檔案行號：`src/ai/byok/check.ts:49–50,76–79`。
- 實際輸入（hasPageContext=true，relevance=20）：
  - `協同過濾如何推薦電影？` → `{ok:false}`。
  - `用矩陣分解做電影推薦的原理是什麼？` → `{ok:false}`。
  - 對照 `機器學習怎麼推薦電影` → `{ok:true}`。
- 原因：電影命中 CHITCHAT，但協同過濾／矩陣分解不是強主題詞，高相關度也不能解除阻擋。矩陣分解用於推薦系統是本站 L23102 已有內容，因此第二句明確是學習問題。
- 建議：把課綱對應的專業詞（推薦系統、協同過濾、矩陣分解等）納入可維護的強主題判斷，或對明確技術組合採用相關度與上下文，補上正例。不要只把「電影」全面放行，造成閒聊回歸。
- 判定：這是規則式離題過濾的可用性限制，不會外洩金鑰、不會破壞考試流程，也沒有讓已修復的 R1／R2 重新成立；可後續改善，不阻擋本次上線。使用者可明示「機器學習」後提問。

## 三、實際測試與工具驗證

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint | 通過；新增稽核檔案後再次通過 |
| validate:content | 835 題、0 錯誤、0 警告 |
| npm run test | 20 檔、341 項通過，包含 auditV110r2.test.tsx 的 17 項 |
| verify:python -- --strict --engine=cpython | CPython 3.14.10：程式題 80/80、講義範例 18/18 |
| verify:python -- --strict | Pyodide 314.0.8：程式題 80/80、講義範例 18/18 |
| build | 通過 |
| 完整 test:e2e | 52 通過、2 選用截圖略過；Edge 桌面／手機，Pages 子路徑與 CSP |
| r2 原探測 | 342 通過、5 失敗，共 347；這五項斷言是「舊缺陷應存在」，現在失敗代表無法重現，屬預期 |
| 本輪額外探測 | 原 341 加 2 項，共 343 通過；串流取消及離題案例觀察 |

日誌：`docs/audit-v110-r3-typecheck.log`、`-lint.log`、`-final-lint.log`、`-validate-content.log`、`-test.log`、`-cpython.log`、`-pyodide.log`、`-build.log`、`-e2e.log`、`-r2-probes.log`、`-extra.log`。

額外證據：`docs/audit-v110-r3.config.mts`、`docs/audit-v110-r3-extra.test.tsx`、`docs/audit-v110-r3-observations.jsonl`。

E2E 沿用上輪稽核專用設定 `docs/audit-v110-r2.playwright.config.mts`，在獨立 4187 連接埠執行完整相同測試：`npm run test:e2e -- --config docs/audit-v110-r2.playwright.config.mts`。沒有修改正式 Playwright 設定或略過失敗案例。

所有測試金鑰皆為假字串，API fetch 攔截；未用付費金鑰。沒有重新宣稱雲端 CORS／帳號權限／實際計費通過，也沒有將自動測試等同於題庫內容的專業人工審核。

## 四、上線意見與操作紀錄

**同意已複查的 v1.1.0 改動提交並推送上線。** R1、R2 阻擋已解除；N1 可列後續改善。此意見不涵蓋本報告後的新修改，也不授權把所有未追蹤稽核紀錄一起上傳。

本輪只新增稽核報告、探測及執行紀錄，未修改正式程式或題庫；未提交、推送、重置或刪除未追蹤檔案，未操作或推送 backup/printable-local-commits 分支。後續提交應明確選取預期產品與文件檔案，維持列印講義不上傳。
