# v1.0.0 獨立複查

日期：2026-11-19；執行者：Codex。

受查 HEAD：`b9a2e86b1e35638e77e2f41efbcb87f41a8d3d27`。`v1.0.0` 為附註標籤，標籤物件 `3e23e17`，`git rev-parse 'v1.0.0^{}'` 解析至同一 commit。`package.json` 為 `1.0.0`。

**結論：既有全套測試通過，但尚不能認定八項全部完成。F1 的最終保存時間、C3 的正確選項仍漏修；F3 原題已修，新增防線仍會漏掉部分 LaTeX。**

本次沒有改動正式功能、講義、題庫、資料結構或標籤；僅新增獨立稽核證據、相容性測試及文件。不提交、不推送。

## 待修項目

### 1.［P2／F1］逾時交卷後，清理程式會把未截斷時間覆寫回資料庫

位置：`src/pages/Quiz.tsx` 計時 effect 的 cleanup（`patchSession(... durationSec: elapsedRef.current)`）；`src/data/repo.ts` 的 `patchSession()`。

`submitSession()` 本身確實將 `durationSec` 截斷至時間上限，背景模考也確實改成牆鐘計時。但 React 離開 Runner 時仍無條件保存未截斷的 `elapsedRef.current`；`patchSession()` 不檢查測驗已交卷。因此前一步的正確值又被覆寫。

獨立 Edge 重現（隔離 context，不碰使用者日常資料）：

1. 建立上限 2 秒、開始時間已過至少 10 秒的未交卷模考。
2. 載入其測驗網址，會立即自動跳到結果頁。
3. 等待清理寫入完成，再讀 IndexedDB。
4. 實測 `submitted: true`、`timeLimitSec: 2`、**`durationSec: 13`**。13 秒含前一個背景案例等待時間，具體數字隨機器速度變動，但穩定超過上限。

另一個剛開始的 2 秒模考，在受控 hidden 可見性分支經過 3.5 秒後已到結果頁，保存 2 秒，證明原先停表問題已修；問題是「逾時恢復／卸載後的最終保存值」。此 hidden 測試是控制 `document.visibilityState` 的分支模擬，非 OS 前景分頁切換。

建議：已交卷紀錄不再接受計時更新，或讓所有 duration 寫入統一套用時間上限並處理交易競態。新增「已逾時開始 → 結果頁 → 等待卸載寫入 → 讀資料庫」驗收，不能只測 `submitSession()` 的回傳值或跳頁。

證據：`docs/audit-v1-browser.mjs`、`docs/audit-v1-browser.log`。

### 2.［P2／C3］L11301-0016 摘要改好了，正確選項 B 仍是過度概括

位置：`src/content/questions/L11/L113.json:1163`；ID `original-L11301-0016`。

正確選項 B 仍為：

> 傳統程式由人寫規則產生答案；機器學習由資料與答案學出規則

題幹問所有機器學習與傳統程式的根本差異，並未限定監督式。解析摘要雖已補非監督式沒有答案，正確選項本身仍把答案當成機器學習的必要輸入，且 B 的解析只說「正確。知識來源不同」。

建議：B 改成從資料學出規律，或題幹明確限定「以監督式學習為例」，同步檢查正確選項的解析。此次全庫搜尋未找到另一處同樣尚未限定的「資料＋答案」總定義；此題就是漏修的位置。

### 3.［P3／F3］原題已修正，但「不得使用 LaTeX」的防線不完整

位置：`src/content/validate.ts:122` 的 `LATEX`。

原題 `original-L11202-0003` 現在實際顯示一般文字公式，已沒有 LaTeX 原碼。新增規則也會擋下含命令的舊案例，但以下反例仍可通過：

| 注入測試題幹 | LaTeX 錯誤數 |
|---|---:|
| `若 $x^2=4$，x 的可能值為何？` | 0 |
| `若 $x=\sqrt{4}$，x 為何？` | 1 |

沒有反斜線命令的單美元公式、部分其他數學分隔符不在規則內。這是驗證器覆蓋缺口，**不是宣稱現有題庫另有這道注入題**。

建議：先明確定義要禁止的公式分隔符及命令範圍，補純數學表達式案例；保留商品價格 `$5`／`$6` 不誤報測試。

證據：`node docs/audit-v1-guard.mjs`，輸出見 `docs/audit-v1-guard.log`。

## 八項逐項結論與版本介面

| 項目 | 結果 | 本次證據 |
|---|---|---|
| F1 限時模考 | **部分通過，仍有保存時間漏洞** | 背景分支繼續計時、到期交卷成功；逾時恢復後 cleanup 覆寫為 13 秒，超過 2 秒上限 |
| F2 每日上限 | 通過原反例及既有超額案例 | 原 `full-audit-probes.mjs`：30 分鐘上限，安排弱點 20 分鐘＋混合 6 題 9 分鐘＝29 分鐘，`feasible: true`；必要任務超額的單元測試亦通過 |
| F3 題目 LaTeX | 原題通過；防線部分通過 | 瀏覽器直接確認文字公式；新增 guard 會擋舊反例，純 `$x^2$` 漏過 |
| F4 每日閱讀時間／相容性 | 通過本次資料集 | 每日統計單元測試、原生 Edge v1／v2 升級、v1／v2／v3 備份還原與再匯出；詳下 |
| C1 CLT | 指定修正通過 | L22102 含同分佈獨立抽樣、有限均值／變異數、30 非保證與 Cauchy；L22102-0008、L23101-0015 的題幹／解析上下文具有限變異數前提 |
| C2 AUC 同分 | 通過 | L23303-0004 明寫同分算半次；全庫搜尋沒有找到另一處漏掉同分的嚴格機率定義 |
| C3 監督式限定 | **部分通過** | L11301 講義與題目摘要已改；L11301-0016 正確選項 B 未改 |
| M1 停用題 | 通過現有靜態題庫出題路徑 | `getReleasedQuestion()` 動態排除 draft／retired；錯題重測另檢查級別；remote 補強題檢查釋出與同細項；mock 經載入時排除停用題的 `questionsFor()`；歷史仍用 `getQuestion()` |
| 版本介面 | 通過 | 桌面左下角／手機功能選單 E2E 均顯示「版本 v1.0.0」，單元測試核對 package.json |

M1 限制：遠端後端未設定，本次未對真實 AI 服務發出請求；驗證的是前端篩選程式與現有測試，不是遠端服務驗收。mock 題池是載入時建立，沒有宣稱它支援在同一執行期熱更新題目的審核狀態。

## F4 資料保存驗證細節

新增 `tests/unit/audit-v1-compat.test.ts`，不修改原測試，補足多表保留的覆蓋。

1. **IndexedDB v1 → v3、v2 → v3**：分別建立舊版 DB、填入設定、講義、測驗、作答、錯題、來源；v2 另填導師紀錄。升級前後逐筆比較資料及自動主鍵；設定允許新增預設欄位但保留原值。全部通過。
2. **原生 Edge 再驗證**：以兩個隔離 context 建立真正的舊 IndexedDB，再載入正式 build 讓 Dexie 升級。所有上述表的舊紀錄與主鍵均保留，新 `studyTime` 為空。原生版本 10／20 → 30 對應 Dexie 1／2 → 3。
3. **舊備份匯入**：v1 使用 repo 既有 fixture；v2 使用該 fixture 加入 v2 的 examDate 與 tutorLogs，v3 再加入 studyTime。三者全部經 `parseBackup → restoreBackup → exportBackup → parseBackup`；講義、測驗、作答、錯題、導師、每日時間逐筆相等。這裡 v2 為依舊格式組成的測試樣本，不是假稱有另一份使用者歷史實機備份。
4. **舊累計閱讀時間**：保留在 lessonProgress，不回填到某一天，避免錯算本期。原有每日統計測試核對往期 600 分鐘、本週 5 分鐘，只計 5 分鐘。統計頁有升級限制說明。
5. 原 `full-audit-probes.mjs` 的統計部分仍使用舊的 lessonProgress 參數格式，不能用其輸出 0 分鐘作為新版統計正確的證明；本次依新版 studyTime 介面測試驗收。

原生瀏覽器腳本：`docs/audit-v1-native-migration.mjs`；輸出 `docs/audit-v1-native-migration.log`。上述是具體測試資料的保留證據，不代表已窮舉所有損毀／超大備份。

## 全套檢查結果

| 指令 | 實際結果 |
|---|---|
| `npm run typecheck` | 通過；新增稽核測試後再次通過 |
| `npm run lint` | 通過；新增稽核檔案後再次檢查 |
| `npm run validate:content` | 835 題，0 錯誤、0 警告 |
| `npm test` | 受查原版 11 檔 154 項通過；新增 6 項獨立稽核測試後 12 檔 **160 項通過** |
| `npm run verify:python -- --strict` | Pyodide：80/80 程式題、18/18 講義範例（含繪圖 1），失敗／略過／僅語法均 0 |
| `npm run verify:python -- --strict --engine=cpython` | 本機 CPython：80/80、18/18（含繪圖 1），失敗／略過／僅語法均 0 |
| `npm run build` | 通過 |
| `PW_CHANNEL=msedge npm run test:e2e` | Pages 子路徑，桌面 1440／手機 390：**42 通過、2 skipped** |

CPython 以本機 `.venv\Scripts\python.exe` 執行；沒有使用 `--stamp`，未覆寫題目驗證紀錄。測試通過不等於前述獨立反例通過；新增的 6 項測試是相容性 5 項及原 LaTeX 錯誤防線 1 項，沒有把錯誤行為改成驗收標準。

執行紀錄：`docs/audit-v1-{typecheck,lint,content,unit,build,cpython,pyodide,e2e}.log`；最後新增測試結果見 `audit-v1-final-unit.log`。來源詞句搜尋結果見 `docs/audit-v1-content-search.log`，僅涵蓋本次 C1–C3 同類說法，不能替代全題庫專業審閱。

## 文件與後續

- PROGRESS 的八項「已全部修正」應以本次結論為準，先修 F1、C3，再補 F3 防線。
- PROGRESS 驗證表仍留有「新增的 47 題只經 Pyodide 驗證」舊列，與本次及前次 80 題 CPython 結果矛盾；應標為歷史紀錄或移至舊報告，避免讀者誤會。
- GitHub Actions 沒有因本次本機測試而執行，不能宣稱 v1.0.0 已在遠端部署。依使用者指示，本次不推送。
- 全部內容仍為 AI 檢查，沒有改為人工審核通過；全站視覺及無障礙完整驗收仍依既有待辦追蹤。
