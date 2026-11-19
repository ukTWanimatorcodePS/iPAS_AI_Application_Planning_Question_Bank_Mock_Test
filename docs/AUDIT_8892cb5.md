# 8892cb5：八項功能修正複查

日期：2026-11-19；執行者：Codex。HEAD 與本機 `v1.0.0^{}` 均指向 `8892cb5aa17031bd953e84d75f83f93d991c1ef3`。

## 結論

原 X1～X5 驗收全部轉綠，19項回歸測試與原全套亦通過。但新增驗收仍重現 **兩類問題**：B1 提交期間切換內容的競態、B2 舊驗證紀錄重做丟失 unseenOnly。未修改正式程式、題庫、既有測試或tag，未提交、未推送。

## F1［P2］補強題A的晚到回應會批改尚未作答的B

位置：`src/components/TutorPanel.tsx` 的教學 effect `.then()` 與 `submit()`。

新 submitting ref 確實防止同一次連點，attemptKey 也確實使相同提交冪等。但切換模式或點上方「再出一題」仍可在提交中執行；新教學回應重設 result、pick、attemptKey 及 submitting。舊 submit 沒有核對它屬於哪一代補強題，完成時直接 setResult。

獨立元件驗收使用真正 TutorPanel、隔離 mock provider 與延遲提交 Promise：

1. 顯示同細項補強題A，選一個選項並提交，暫不完成資料層Promise。
2. 分別測「簡單解釋」及「再出一題」tab，provider 回傳另一題B，確認B題幹已出現。
3. B尚未作答，讓A的Promise回傳 `{correct:false}`。
4. B畫面出現 **「補強題答錯。」**，選項被鎖定，結果／解析卻屬B。

兩條路徑都失敗。這是受控延遲元件測試，不是假稱真實後端延遲已實測；但資料庫等待期間也存在相同非同步路徑。

建議：提交時禁止切換或取新題，或用不可變 attempt generation／question ID 驗證晚到結果，只更新其所屬題目。資料層已正確防連點，不需取消這項保護。

證據：`docs/audit-8892cb5-race.test.ts`。這和「新顯示的補強題用新key可再次作答」不同，後者本來就是合理的再次練習。

## F2［P2／舊版相容性］舊驗證測驗仍會重做已曝光題

位置：`src/pages/Results.tsx` 的 `unseenOnly: session.unseenOnly`；備份／DB未補舊紀錄辨識。

輸入：以既有v1備份樣本建立一份已交卷test session，細項L11101、題目包含該細項全部20題，標題 `L11101 驗證測驗（未看過的題目）`，**沒有 unseenOnly**。經 parseBackup、restoreBackup、exportBackup 後，用 Results.retry 同等參數重做。

實測：`ok:true,count:5`，全20題都已曝光，因此5題必然都看過，標題卻仍保留「未看過」。期望是拒絕或只抽真正新題。既有備份的選填欄位維持 undefined，不會自動修好此問題。

新建驗證測驗有旗標時已正確，本問題只指舊紀錄／舊備份路徑。建議以可靠舊標題／模式規則辨識並恢復語意，或明確將舊驗證重做改名為普通複習；不要無聲延續不實標題。新增欄位本身不必為此破壞舊DB版本。

證據：`docs/audit-8892cb5-edge.test.ts` 的 B2。

## 八項結果與額外邊界

| 項目 | 結果與證據 |
|---|---|
| B1 | **部分通過**：同key連點僅1筆，新key可再記錄；新舊tutor sessionId共存仍計入曝光。提交中換模式／再出一題有上述競態 |
| B2 | **部分通過**：新session及備份保留unseenOnly；舊備份驗證重做仍失守 |
| B3 | **本次驗收通過**：原E2E覆蓋上下限顛倒提示與離焦對調。Onboarding原本即儲存時排序；Settings編輯期間可暫時顛倒，離焦才排序，兩者不是每一刻完全相同 |
| X1 | **通過**：考前無可讀日、重複休息日值均不可行；相同條件講義已讀完對照可行 |
| X2 | **通過**：lessonProgress、quizSessions、reviewItems、studyTime重複主鍵拒絕，錯誤含「重複」與欄位路徑；正常備份仍可往返。attempts同題多次作答、tutorLogs多筆歷史並非主鍵衝突，不應誤刪 |
| X3 | **通過**：2024／2000閏日、月底有效；2026／2100閏日、4月31日、0月無效；以本地日期解析避免UTC日期位移 |
| X4 | **通過**：週一排除上週日及未來日；月初排除上月末；相同邊界驗收在Asia/Taipei與America/Los_Angeles兩個獨立程序均通過 |
| X5 | **通過**：原反例轉綠；新增不存在ID、retired題、不同細項均回傳null；後端回應使用mock，不宣稱真實服務已串接 |

### B1資料相容性詳情

獨立測試先寫一筆舊無key導師作答，再以同一新key並發寫入另一題，總計2筆；兩題均由 exposedQuestionIds 排除於驗證題池。換新key再練可增至3筆，匯出備份也可解析。判斷是按attempts.questionId等資料，不依賴精確比對舊 sessionId，所以沒有觀察到統計／曝光判斷倒退。

沒有attemptKey的舊呼叫不具冪等，屬相容介面；目前TutorPanel會傳key。日後新增呼叫點亦應傳每次互動的穩定key。

### B3空白／非數字與日期輸入的範圍限制

程式審查：兩入口均用 type=number；空白 `Number('')` 轉0；Settings以Math.max(0, …)下限處理，離焦排序；Onboarding儲存排序。瀏覽器通常會將不合法數字值清成空白，不能將任意程式呼叫的NaN視為一般使用者必然可輸入。沒有新增NaN故障的實測證據。

設定日期亦是date input，真正的無效備份由新增schema與parseLocalDate防守。本輪對逐欄輸入、空白、非數字、日期選擇器沒有另外窮舉所有瀏覽器鍵盤序列；已跑整套設定E2E及程式審查，不把這項限制寫成全部人工UI驗收完成。

## 測試結果

| 執行 | 結果 |
|---|---|
| typecheck | 通過 |
| lint | 通過；新增稽核檔案後再次通過 |
| validate:content | 835題、0錯誤、0警告 |
| npm test | 14檔、268項通過 |
| 原 docs/cross-audit.probe.ts | 5/5通過；合併原套件共273項通過 |
| crossAudit＋migration＋audit-v1-compat | 3檔29項通過；其中crossAudit為19項 |
| CPython | 80/80題、18/18講義範例，含繪圖；失敗／略過／僅語法均0 |
| Pyodide | 80/80題、18/18講義範例，含繪圖；失敗／略過／僅語法均0 |
| build | 通過 |
| Edge E2E | 44通過、2 skipped；含新增連點及分鐘設定 |
| 新增獨立邊界驗收 | 8項中5通過、3失敗（B2一項、B1兩條切換路徑） |

獨立設定會合併原套件，因此最後輸出是 **273通過、3失敗，共276**；不能把原套件全綠當作兩個新問題已修好，也沒有刪除失敗測試。重現指令：

```text
npx vitest run --config docs/audit-8892cb5.config.mts
```

CPython3.14.10使用本機.venv；Pyodide314.0.8／CPython3.14.2；沒有使用--stamp。

舊版IndexedDB與v1/v2/v3備份相容性原有測試均通過；本輪新增舊驗證備份案例揭露的是重做語意漏修，不是整份備份無法匯入。

## 文件與交付

PROGRESS共14個二級章節，名稱亦為14個不重複值，結構沒有整份重複插入。本次只在既有章節追加註記。tag正確指向8892cb5。A1、A2題庫品質改善仍未在此commit完成，未將其算成此次八項功能修正的倒退。

日誌前綴 `docs/audit-8892cb5-`：typecheck、lint、content、unit、build、cpython、pyodide、original、e2e、targeted、edge、taipei、losangeles、final-lint（.log）。額外程式為同前綴config.mts、edge.test.ts、race.test.ts。

本次只新增稽核證據、報告與進度註記；沒有修改正式程式、題庫、既有測試、版本號或tag，未提交、未推送、未觸發遠端部署。
