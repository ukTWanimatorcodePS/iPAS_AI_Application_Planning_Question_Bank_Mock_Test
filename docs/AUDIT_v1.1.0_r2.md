# v1.1.0 第二輪複查

日期：2026-11-20（Asia/Taipei）。稽核者：Codex。

基準仍為 `HEAD = origin/main = 55ca6c626e1114bb620b205606345ff13b6847c6`；檢查對象是未提交工作區。已依 AGENTS.md、REVIEW_REQUEST_v1.1.0.md 第 5 節、PROGRESS.md 的「Codex 複查 v1.1.0 的處理結果」及上一輪報告逐項核對。

**結論：暫不同意以目前狀態提交並推送上線。** 原案例多數已修好，但 F1 的金鑰綁定及 F6 的備份還原仍有可重現缺口。既有測試通過與舊缺陷探測「預期失敗」應分開解讀。

## 一、逐項驗收

| 項目 | 結果 | 依據 |
| --- | --- | --- |
| F1 信任確認／金鑰綁定 | **部分通過，仍必修** | 未勾選信任不再送模型清單；單一表單沿用已儲存金鑰後切到 Ollama 也不再帶原金鑰。但多表單、未儲存輸入及等待中換服務仍會錯配，見 R1 |
| F2 送出生命週期 | 原取消／考試鎖定案例通過 | controller 在第一個 await 前建立；每次檢索後檢查 stillValid；鎖定／關閉會 abort；prepareTurn 拒絕 locked；finally 由 requestSeq 保護。設定切換的生命週期仍未處理，歸 R1 |
| F3 SDK 隱私設定 | 通過 | 兩處 SDK 建構都有 SAFE_FETCH_OPTIONS；實際 SDK RequestInit 為 omit／no-referrer／no-store |
| F4 模考開始時間 | 通過 | startAt 使用 nowIso，不再以歷史開始時間遞增；未來歷史不再推遲新模考開始 |
| F5 離題規則 | 原三例通過；另有建議 | email、Taipei 及「為什麼天空是藍色」均被擋；一般概念問句及快捷提問的既有正例通過。一般詞仍可放行閒聊，見 S3 |
| F6 並行／補強題順序 | **一般流程通過，還原仍必修** | createSession 與 nextOptionOrder 共用可序列化交易；同時建立不再取到相同排列。但 v4 狀態未完整保存至備份，見 R2 |
| S1 不存在的引用 | 通過指定修正 | `checkGrounding(text, ['S1'])` 對 `[S999]` 回報 unknownRefs；TutorChat 傳入本則回答的 sources refs 並顯示警示 |

## 二、必修問題

### R1［必修／P1；F1 尚未完整修復］金鑰與服務設定不是同一份快照，仍會傳錯服務

**位置**：

- `src/components/ByokSettings.tsx:29–30,40–47,77`。
- `src/components/TutorChat.tsx:106,151–154,174–186`。

**重現 A：兩個設定表單並存**

1. 儲存 OpenAI 設定與假金鑰 `FAKE-OPENAI-KEY`，掛載第一個 ByokSettings。
2. 在另一個設定入口儲存 OpenRouter 設定及 `FAKE-OPENROUTER-KEY`。網站設定頁與導師視窗可同時有 ByokSettings；探測以呼叫相同的 saveByok 模擬第二表單儲存。
3. 第一個表單改選 OpenRouter，按取得模型清單。
4. 實際輸出：`https://openrouter.ai/api/v1/models`，`authorization: Bearer FAKE-OPENAI-KEY`。

原因：savedKey 是第一表單掛載時的 React state，但 savedKeyApplies 比對的是目前 loadConfig 的全域設定。這會把舊金鑰誤認成新服務的金鑰。補上 endpointGate 並不能保護這條已知服務路徑。

**重現 B：檢索等待中換服務**

1. OpenAI 設定下送出「什麼是監督式學習？」；延遲 questionRelevance。
2. 等待時儲存 OpenRouter 設定及假金鑰 `FAKE-OPENROUTER-KEY`。
3. 讓本機檢索完成。
4. 實際輸出：`POST https://api.openai.com/v1/chat/completions`，授權卻是 `Bearer FAKE-OPENROUTER-KEY`。

原因：send 保留舊 config，真正送出時卻重新 loadKey；stillValid 沒檢查 BYOK 設定版本。此例使用真實 TutorChat 與 client，只有本機檢索／依據組合受控，fetch 完全攔截。

**重現 C：未儲存輸入跟著服務走**

在 OpenAI 金鑰欄輸入 `FAKE-TYPED-OPENAI-KEY`，不儲存就改選 Ollama，按取得模型清單；`http://localhost:11434/v1/models` 仍帶該金鑰。choosePreset 未清空 keyInput；改 API origin 也沒有清空。

**建議修法**：

- 設定與金鑰必須原子讀取並綁定同一服務／origin／版本；表單不能拿目前全域設定認證另一份舊 state 金鑰。
- 服務或 origin 改變時清空未儲存輸入，或要求明確確認重新使用，不可默默沿用。
- 送出流程捕捉同一份 config＋key 快照；設定版本變更就取消尚未發出的請求。不要混合閉包舊 config 與即時新 loadKey。
- 增加雙表單與延遲期間換設定的回歸測試。所有證據均為假金鑰，不涉及真實秘密。

### R2［必修／P2；F6 還原相容性缺口］v4 的最後排列未匯出，靠時間重建會丟失真實順序

**位置**：`src/data/backup.ts:166–189,213–223`；`src/data/db.ts:72–79`。

**重現 A：同毫秒測驗還原後，下一題正解位置與上次相同**

固定時間 `2026-11-20T00:00:00.000Z` 及亂數，用真實題 `original-L11101-0001` 依序建立兩份測驗，第一個 sessionId 以 f 開頭、第二個以 0 開頭。這是合法 UUID，令主鍵順序與建立順序相反。匯出正常備份，parseBackup 通過，再 restoreBackup：

```text
第一份 order a = [A,D,B,C]
第二份 order b = [D,B,C,A]
還原前 lastOptionOrders = b
還原後 lastOptionOrders = a
下一次 nextOptionOrder = b
上一次／下一次正解顯示位置 = 1／1（皆為畫面 B）
```

createSession 的交易確實正確更新為 b；但備份不含該表。測驗匯出按主鍵排序，重建只按 startAt 排序，同毫秒時無法知道真正先後。時鐘回調也可能造成時間順序不同於 v4 交易順序。

**重現 B：未作答的補強題不會被重建**

先建立 a，再 nextOptionOrder 顯示補強題 b，尚未送出答案就匯出／還原。還原前最後順序 b，還原後退回 a。原因是補強題顯示時只寫 lastOptionOrders，還沒有 tutor attempt；重建資料不足。

**影響**：沒有觀察到歷史作答或標準答案遺失；丟失的是 v4 新增的「上次實際顯示順序」狀態，讓修正後承諾的正解換位置在正常備份往返後再次失效。

**建議修法**：備份可選填保存經驗證的 lastOptionOrders（或等價、包含未作答顯示事件的序列狀態）；新備份精確還原，舊 v1／v2／v3 缺欄位時才盡力重建。若調整 schema，維持舊版匯入，並測試同毫秒與補強題未作答案例。不要再以修改實際 startAt 補救。

## 三、建議與限制

### S3［建議／P2］離題規則仍把泛用詞當成充分學習證據

- 位置：`src/ai/byok/check.ts:45–46,66–69`。
- 真實檢索輸入：`請評估今晚餐廳哪家好吃`；relevance = `2.0358209192039456`，低於門檻 3，結果仍 `{ok:true}`。
- 因「評估」命中 STUDY_TERMS_ZH，覆蓋餐廳閒聊的阻擋。建議把泛用詞與「機器學習／RAG」等強主題詞分開；有明顯生活閒聊時，不能只靠「評估／風險／分類」單詞放行。
- 原三個 F5 反例與快捷問句確實已修好，不因這個 heuristic 限制否定那些修正。純規則無法保證所有離題都擋下；文件應繼續明示限制。

### S4［建議／P3］舊測試名稱仍寫升級到 v3

- 位置：`tests/unit/audit-v1-compat.test.ts:18`、`tests/unit/migration.test.ts` 的相容性案例名稱。
- 改 verno 期望為 4 是合理修改，沒有刪除舊資料／主鍵的斷言；名稱建議同步改成「升級到目前版本」或 v4，避免把 IndexedDB 版本與仍為 v3 的備份格式混淆。
- `tutorRace.test.ts:14` 補 nextOptionOrder 假模組合理，仍有「舊提交不得評分新題」斷言；它沒有驗證排列本身，排列由其他測試驗證。

## 四、資料遷移、交易與生命週期的程式核對

- **IndexedDB v4**：舊 v1／v2／v3 定義保留不動；僅新增 lastOptionOrders 表與 upgrade。原資料表沒有清空；v1／v2 保留主鍵的測試及新增 v3→v4 回填測試通過。回填從 sessions 與 tutor attempts 取事件，是舊資料可用的盡力策略，但不能代替新備份精確保存 v4 狀態（R2）。
- **createSession 交易範圍**：`rw [quizSessions,lastOptionOrders]` 正確涵蓋 assignOptionOrders 內的讀寫與測驗新增；nextOptionOrder 使用同一張表的 rw 交易，共用序列化鎖。沒有在交易中呼叫外部網路或計時器。一般並行案例原本相同的排列現在確實不同。
- **備份／清除**：restoreBackup 及 clearAllData 均納入新表；還原仍是單一交易。備份 v1／v2／v3 往返、既有紀錄保存測試通過；新表的還原精確性另見 R2。
- **TutorChat**：關閉／鎖定取消的舊案例不再發送，prepareTurn 本身也拒絕 locked；catch/finally 已涵蓋第一次 await。文件已改成「中止不保證已開始計算的用量免計」。目前仍少「BYOK 設定改變」這個失效條件（R1）。
- **S1**：新參數 validRefs 確實由畫面傳入；原 docs 探測直接呼叫 checkGrounding 而沒傳 validRefs，不能驗收這個新檢查。本輪額外探測及正式單元測試有傳合法引用集合，確認 unknownRefs = true。合法引用仍不代表內容語意正確。

## 五、實際執行結果

| 檢查 | 結果／日誌 |
| --- | --- |
| typecheck | 通過；audit-v110-r2-typecheck.log |
| lint | 通過；新增稽核檔案後再次通過，audit-v110-r2-final-lint.log |
| validate:content | 835 題，0 錯誤、0 警告；audit-v110-r2-validate-content.log |
| test | 19 檔、324 項通過；audit-v110-r2-test.log |
| verify:python -- --strict --engine=cpython | CPython 3.14.10：80/80；講義 18/18；audit-v110-r2-cpython.log |
| verify:python -- --strict | Pyodide 314.0.8／CPython 3.14.2：80/80；講義 18/18；audit-v110-r2-pyodide.log |
| build | 通過；audit-v110-r2-build.log |
| test:e2e | 完整相同測試：52 通過、2 選用略過；audit-v110-r2-e2e-isolated-final.log |
| 原 docs/audit-v110.config.mts | **327 通過、5 失敗**；audit-v110-r2-original-probes.log。五項都在斷言「舊 bug 應存在」，因此失敗表示該反例不再成立，不是五個新增缺陷 |
| 本輪額外探測 | 原 324 加 6 個觀察案例，共 330 通過；audit-v110-r2-additional-final.log。這些觀察測試確認 R1／R2 的缺陷存在，不是驗收通過 |

E2E 執行說明：先直接執行 npm run test:e2e，但 4179 服務無回應；另一輪原設定啟動回報連接埠占用。未終止其他人的服務，僅停止本輪等待中的命令。另建本機稽核設定 `docs/audit-v110-r2.playwright.config.mts`，保留原測試／裝置／Pages 子路徑／CSP，只使用獨立 127.0.0.1:4187；第一次稽核設定因相對 cwd 指向 docs 而建置找不到 index.html，已修正稽核設定 cwd 後重跑完整通過。沒有把環境啟動失敗算成產品缺陷，也沒有略過失敗測試。

本輪新增證據檔：

- `docs/audit-v110-r2.config.mts`
- `docs/audit-v110-r2.probe.test.tsx`
- `docs/audit-v110-r2-lifecycle.test.tsx`
- `docs/audit-v110-r2-observations.jsonl`（可追加，含多次執行）
- 上述日誌與獨立 Playwright 設定。

所有 API 請求使用假金鑰並攔截；沒有付費服務實測，也沒有讀取使用者實際金鑰。單元遷移探測使用測試資料庫，E2E 使用隔離瀏覽器上下文；本報告不宣稱對所有真實舊裝置資料作了逐筆實機遷移。官方 PDF 及題庫正文並非本輪重新內容審閱範圍。

## 六、上線判定與操作紀錄

**不同意目前提交並推送上線。** 請先完成 R1（服務／金鑰配對及等待中設定變更）和 R2（v4 狀態的備份往返），再驗收；S3、S4 可另排改善。

本輪未修改正式程式、題庫、原探測或使用者資料，僅新增稽核文件、腳本與執行紀錄；未提交、推送、重置或刪除未追蹤檔案。列印講義仍被忽略；未操作或推送 backup/printable-local-commits 分支。
