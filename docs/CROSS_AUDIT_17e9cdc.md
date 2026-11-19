# 全範圍交叉稽核（Codex）

受查版本：`17e9cdc`／本機 v1.0.0；日期：2026-11-19。本報告獨立於 Claude 的自查，供逐項交叉比對。沒有修改正式功能或內容，沒有提交或推送。

## 結論

既有全套檢查通過，但額外獨立驗收重現 **5 項問題**。這些不是前輪字面值掃描器的重複案例。

重現：`npx vitest run --config docs/cross-audit.config.mts`。此獨立設定會合併原設定，因此輸出是 **249 通過、5 失敗**；失敗的五項正是本報告反例，沒有把錯誤行為寫成應通過條件，也沒有刪除或放寬測試。一般 `npm test` 仍為原來的 249 項。

## X1［P2］沒有任何學習日仍判定計畫可行

- 位置：`src/lib/studyPlan.ts` 的 learnDays、lessonsPerStudyDay、feasible 計算。
- 輸入：所有星期均為休息日，每日 60～90 分鐘，剩 1 份未讀講義，2026-11-23 規劃至 2026-12-01 考試。
- 實測：`studyDaysLeft: 0`、`remainingLessons: 1`、7 天 tasks 全空，卻 `feasible: true`。
- 設定頁允許取消全部可讀日，因此不必手改備份即可出現。
- 原因：分母以 `Math.max(1, learnDays)` 掩蓋 0，且只判時間上限與目前 horizon 超額，不檢查有無可讀日。
- 驗收：沒有可讀日但仍有必要學習任務時回傳不可行並說明；再測全休息日、只有考後可讀日、剩餘課程為零的對照。

## X2［P2］備份允許重複主鍵，還原時靜默覆寫

- 位置：`src/data/backup.ts` 的 backupSchema 與 restoreBackup。
- 反例：在既有 v1 fixture 的 lessonProgress 陣列加入同 code、不同 timeSpentSec 的第二筆。
- 實測：parseBackup 回報成功，restoreBackup 後重新匯出，**輸入 2 筆、輸出 1 筆**。後一筆覆寫前一筆，沒有格式錯誤提示。
- 這是損毀／手改／外部產生的備份樣本，不是聲稱正常匯出一定會產生重複資料。但目前 UI 會以成功驗證的備份覆蓋本機，使用者無從得知資料被丟棄。
- 驗收：依各表的邏輯主鍵檢查唯一性，重複即在清除本機之前拒絕；另補 quizSessions、reviewItems、studyTime 等主鍵表案例。attempts 的同題多次作答不能當作重複紀錄刪除。

## X3［P2］無效考試日期能通過備份驗證，產生無效學習計畫

- 位置：`src/data/backup.ts` settings.examDate 只限制字串長度；`src/lib/studyPlan.ts` parseLocal 沒有有效性判斷。
- 反例：`examDate.junior = "not-a-date"`（10 字元）。
- 實測：parseBackup 成功；同一值傳入計畫，examDate 為 `Invalid Date`，daysLeft 為 NaN（JSON 日誌中顯示 null，另有 finiteDays:false 確認）。
- 驗收：null 或有效 YYYY-MM-DD 日期，含年月日真實存在檢查；無效備份在寫入前拒絕，計畫函式也做防禦性處理。不能只靠 HTML date input，因備份能繞過它。

## X4［P2］未來的學習時間會算入本週／本月

- 位置：`src/lib/stats.ts` planCompletion 只有期間起日下限，沒有今天／now 上限；測驗紀錄亦同。
- 反例：以 2026-11-23 計算本週，傳入 2027-01-01 閱讀 36,000 秒。
- 實測：`actualMin:600`、`pct:100`，應為 0。
- 可能來源：備份匯入、電腦時鐘曾設到未來。它不需要竄改程式，備份格式允許此日期。
- 驗收：每日紀錄限定期間起日至今天；測驗時間限定起日至 now；對未來資料保留歷史原值，但不要算入現在的期間。

## X5［P3／選用功能］遠端導師接受原題／已排除題作為補強題

- 位置：`src/ai/remoteProvider.ts` response 的 reinforcementQuestionId 只查釋出狀態與同細項。
- 反例：mock fetch 回傳原題 ID，且該 ID 已在 excludeIds 中。
- 實測：仍回傳 `original-L11101-0001`，沒有拒絕。
- mock 模式本身有排除原題／已用題，這項是 remote 分支不一致。真實後端目前未設定，本次是模擬回應，不是假稱串接成功。
- 驗收：前端也拒絕原題及 excludeIds 中的 ID，並驗證級別／細項／釋出狀態。不要完全依賴後端遵守請求，否則「再出一題」可能原地重複。

## 範圍與實際證據

| 領域 | 這次完成 | 未證明的事項 |
|---|---|---|
| 學習、作答、交卷、錯題、恢復 | 既有桌面／手機 E2E 全跑，另讀計畫、統計、組卷與資料層並做上述反例 | 並非所有任意操作序列均測過 |
| 保存、migration、備份 | 全跑單元，包括既有 v1／v2 升級、v1／v2／v3 往返；新增重複主鍵及日期反例 | 未窮舉所有損毀／超大備份 |
| 講義、題庫 | 50 份講義／835 題全量結構、覆蓋、公式、已知錯誤說法檢查；80 程式題與18範例雙引擎執行 | 本輪沒有逐字重讀50份全文及835題四個解析，沒有專業人工審核；沒有重新查核所有官方新公告 |
| RWD | 10 主路由＋50講義，四種寬度，240次文件層級水平溢出檢查，0 溢出 | 不等於240張截圖人工逐張驗收，也不含所有字級／主題組合 |
| 無障礙、深色／高對比 | 既有相關 E2E 跑過 | 螢幕閱讀器及全站對比／鍵盤順序的完整人工驗收尚未完成 |
| AI | mock／前端單元與 E2E、remote 回應注入 | 無真實後端帳號、速率／成本上限的端到端驗收 |
| 部署 | 檢視 base 推導與 Actions 依賴；Pages 子路徑 E2E | 未推送，沒有最新遠端部署結果；不宣稱正式站已更新 |

版面腳本：`docs/cross-audit-layout.mjs`，輸出 `cross-audit-layout.log`：60 routes、240 checks、failures:[]。這是讀取 DOM 寬度的結構檢查，不是人工視覺審閱。

既有全套結果：typecheck、lint、validate:content（835題、0錯誤0警告）、單元249項、build通過；CPython與Pyodide各80/80題、18/18範例；E2E42通過、2 skipped。新增稽核程式後 lint 另跑通過。

執行日誌為 `docs/cross-audit-{typecheck,lint,content,unit,build,cpython,pyodide,e2e,final-lint,independent,layout}.log`。獨立測試位於 `docs/cross-audit.probe.ts`，不納入日常 npm test 的 include，需使用上述專用 config 明確執行。

## 交叉比對方式

請 Claude 針對 X1～X5 逐一列「重現／不重現」、受查 commit、實際輸出與修正位置；不重現時附相同輸入的證據。修正後先確認這五項獨立驗收轉綠，再跑原套件，勿只回報既有套件通過。內容逐題專業審閱、完整無障礙驗收仍應獨立追蹤，不可被本輪功能稽核取代。
