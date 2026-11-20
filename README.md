# AI 備考室｜iPAS AI 應用規劃師備考平台

依 iPAS AI 應用規劃師**官方評鑑內容範圍（115.06 版）**建立的繁體中文備考網站：講義 → 單元練習 → 逐選項解析 → AI 導師補強 → 錯題複習 → 學習計畫 → 考前衝刺與模擬考 → 成績分析。可部署在 GitHub Pages，手機與電腦開網址即可使用，不需登入。

## 🔗 立即使用

**網站：<https://uktwanimatorcodeps.github.io/iPAS_AI_Application_Planning_Question_Bank_Mock_Test/>**

手機與電腦皆可直接開啟，不需登入；學習紀錄只保存在你目前使用的瀏覽器（可在「設定」匯出／匯入備份）。

目前版本：**v1.2.1**。更新內容見 [CHANGELOG.md](CHANGELOG.md)；目前進度與待修事項見 [docs/PROGRESS.md](docs/PROGRESS.md)。

> **獨立學習工具，非 iPAS 官方平台**，與主辦單位無關。講義與題目為本站自編；考試規則以[官方考試資訊](https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info)為準。

## 目前內容收錄狀態（2026-11-19）

| 範圍 | 講義 | 題目 | 程式題（實際執行驗證） |
| --- | --- | --- | --- |
| 初級 L11（9 細項） | 9／9 | 187 題 | — |
| 初級 L12（7 細項） | 7／7 | 137 題 | — |
| 中級 L21（9 細項） | 9／9 | 135 題 | — |
| 中級 L22（13 細項） | 13／13 | 195 題 | 42 題 |
| 中級 L23（12 細項） | 12／12 | 181 題 | 38 題 |
| **合計** | **50／50** | **835 題** | **80 題＋講義範例 18 段（含 1 段繪圖）** |

- 初級每個細項 19～20 題（L11102 為 27 題）；中級每個細項 15 題（L23201 為 16 題），其中「應用」難度 148 題。擴充紀錄見 [docs/EXPANSION_2026-11-19.md](docs/EXPANSION_2026-11-19.md)。
- 每題含：穩定 ID、課綱代碼、四個選項、正確選項完整解釋、其他三個選項各自的錯誤原因、容易混淆處、對應講義段落、難度（基礎／進階／應用）、題型（概念理解／情境應用／比較判斷／實務分析）、題源、編寫狀態與審核狀態。
- 所有題目 `reviewStatus` 為 `ai-checked`：AI 草擬、通過自動檢查，**尚未經人工專家審核**。
- Python 程式題以 Pyodide（CPython 3.14.2、pandas 3.0.2、NumPy 2.4.6、scikit-learn 1.8.0）實際執行比對輸出，並將執行環境與套件版本記錄在題目資料中；另以本機 CPython 3.14.10 與 CI 的 CPython 3.12 交叉驗證。題庫驗證會檢查程式預期輸出是否逐字等於唯一的正確選項。
- 未收錄任何官方原題（官方未明示再利用授權，見 `src/content/official-sources.json`）。

## 功能

- **學習閉環**：講義（必考核心觀念、名詞與定義、原理流程、案例、易混淆比較、考試陷阱、重點整理、對應練習題入口）→ 練習 → 交卷 → 逐選項解析 → 錯題自動收錄 → 回講義對應段落重讀 → 再練。
- **AI 導師**（選用）：答錯時「重新教我這個觀念」：核心考點、為什麼選錯、換例子重教、正確觀念 vs. 常見誤解、同考點不同情境的補強題，並依補強題結果調整錯題排程。預設為**示範模式（離線）**，只重組已審核的解析與講義；真實 AI 需另建後端代理（見 [docs/AI_TUTOR.md](docs/AI_TUTOR.md)），前端不放任何 API 金鑰。
- **學習計畫**：依自行設定的考試日期、每週休息日、每日讀書時間與完成度，產生每日任務與倒數；考前 14 天自動轉為衝刺安排；時間不足時提示。
- **弱點分析**：依科目、細項、難度、題型的正確率，樣本不足時標示；個人高錯誤率考點（明確標示**不是官方高頻考點**）。
- **考前衝刺**：個人弱點補強、錯題重測、全範圍混合測驗、限時自訂模考。
- **學習進度**：已讀講義、完成測驗、錯題訂正率、已掌握比例、待複習數、近 14 天作答趨勢。
- **錯題排程**：1／3／7／14 天（可調整）；到期答對才累計，完成全部間隔才「已掌握」。
- **資料保存**：IndexedDB（Dexie，含版本化 migration）、JSON 備份匯出匯入（v2，向下相容 v1）、CSV 匯出。
- **RWD 與無障礙**：桌面側欄、手機底部導覽與固定作答按鈕、深色與高對比模式、字級調整、跳到主要內容、鍵盤操作與 ARIA 標記。

## 安裝與開發

需求：Node.js 22 以上（開發使用 24）。

```bash
npm install
npm run dev              # 開發伺服器
npm run typecheck        # 型別檢查（app、測試、設定檔）
npm run lint             # ESLint
npm run validate:content # 題庫驗證：重複 ID、答案、解析、課綱代碼、講義段落、相似度、已釋出 ID
npm run test             # 單元測試（Vitest + fake-indexeddb）
npm run verify:python    # 程式題與講義 Python 範例實際執行驗證（預設 Pyodide，不需本機 Python）
npm run test:e2e         # E2E（Playwright，以 /ipas-ai-prep/ 子路徑建置後測試）
npm run build            # 產出 dist/
```

- `npm run validate:content -- --report`：列出每個細項的題數、難度與題型分布。
- `npm run registry:sync`：新增題目後，把已釋出的題目 ID 加入登錄表（只增不減）。
- `npm run verify:python -- --stamp`：驗證通過的程式題寫回執行環境、套件版本與日期；`--engine=cpython` 改用系統 Python。
- 本機沒有 Playwright 瀏覽器時：`PW_CHANNEL=msedge npm run test:e2e`（PowerShell：`$env:PW_CHANNEL='msedge'; npm run test:e2e`）。

## 專案結構

```
src/
  ai/                AI 導師 Provider 介面、示範模式、遠端代理模式
  app/               App 外框、路由（HashRouter）、全域設定 Context
  pages/             首頁、學習計畫、課程、講義、練習、作答、結果、錯題本、歷屆試題、模考、考前衝刺、成績、設定、搜尋
  components/        共用 UI、解析卡、AI 導師面板、Markdown（KaTeX＋程式碼高亮）
  config/examRules.ts      考試規則（年度、門檻、2026 考期、來源；未核實值為 null）
  content/
    curriculum.json        官方課綱（版本、來源、核對日期）
    official-sources.json  官方文件、學習指引、公告試題清單與查核結果（只存連結與中繼資料）
    question-registry.json 已釋出題目 ID 登錄表
    schema.ts / validate.ts / index.ts
    lessons/L11/L11101.md …   講義（每個官方細項一檔）
    questions/L11/L111.json … 題庫（每個主題一檔）
  data/              IndexedDB（Dexie v2）、資料存取、備份匯出匯入
  lib/               計分、錯題排程、組卷、統計、學習路徑、學習計畫
tests/
  unit/              計分、及格判定、排程、組卷、題庫與講義驗證、資料流程、備份防護、migration、AI 導師、學習計畫
  e2e/               學習閉環、AI 導師、學習計畫、考前衝刺、備份還原、RWD（360／390／768／1440）、深色高對比、鍵盤
  fixtures/          第一階段（v1）備份檔
scripts/             validate-content.ts、verify-python.mjs
docs/                PROGRESS.md（進度總覽）、CONTENT_GUIDE.md、AI_TUTOR.md、PHASE2_REPORT.md、screenshots/
design/              原始視覺原型與規格參考（不參與建置）
```

### 資料結構與相容性

| 型別 | 存放 | 欄位重點 |
| --- | --- | --- |
| `UserSettings` | `settings` | level、track、studyGoal、examDate、restDays、dailyMinutes、theme、highContrast、fontScale、passThreshold、reviewIntervals、tutorProvider |
| `LessonProgress` | `lessonProgress` | code、visitedAt、completedAt、lastPosition、timeSpentSec |
| `QuizSession` | `quizSessions` | sessionId、mode、questionIds、answers、revealed、flagged、durationSec、rawScore、validCount |
| `AnswerAttempt` | `attempts` | questionId、selectedIds、correct、mode（含 tutor）、answeredAt |
| `ReviewItem` | `reviewItems` | mistakeCount、correctStreak、intervalDays、nextDueAt、masteryStatus、reason |
| `TutorLog` | `tutorLogs`（v2 新增） | questionId、provider、modes、reinforcementQuestionId、reinforcementCorrect |

- IndexedDB：`version(1)` 保留不動，`version(2)` 新增 `tutorLogs` 並以 `upgrade()` 補上設定欄位；單元測試驗證 v1 資料庫升級後紀錄完整保留。
- 備份：`schemaVersion` 2；匯入時接受 v1（缺少的欄位補預設值），拒絕未來版本與格式不符的檔案，驗證失敗不寫入任何資料。
- 題目淘汰時改 `reviewStatus: "retired"`（不再出題但仍可顯示歷史紀錄），**不可刪除或重用 ID**；`question-registry.json` 與驗證器會擋下遺失的已釋出 ID。

## 部署到 GitHub Pages

1. 在 GitHub 建立 repository（例如 `ipas-ai-prep`）。
2. 推送程式碼到 `main`：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<使用者名稱>/<倉庫名稱>.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
4. 每次 push 到 `main`，`.github/workflows/deploy.yml` 依序執行：`npm ci` → typecheck → lint → 題庫驗證 → 單元測試 → 程式題驗證（Pyodide 與 CPython 交叉驗證）→ E2E → build → 部署。
5. 網址：`https://<使用者名稱>.github.io/<倉庫名稱>/`

`vite.config.ts` 依序採用 `VITE_BASE_PATH` → `GITHUB_REPOSITORY` 推導的 `/<倉庫名稱>/` → `/`。路由使用 HashRouter，深連結與重新整理都可運作。

目前部署：<https://uktwanimatorcodeps.github.io/iPAS_AI_Application_Planning_Question_Bank_Mock_Test/>（repository：`ukTWanimatorcodePS/iPAS_AI_Application_Planning_Question_Bank_Mock_Test`）。維護規則見 [AGENTS.md](AGENTS.md)。

## 2027 年課綱與規則更新方式

1. 官方公布 116 年（2027）簡章或新版評鑑範圍後，先閱讀官方文件並更新 `src/content/official-sources.json`（文件、查核日期、發現）。
2. **考試規則**：`src/config/examRules.ts` 新增 2027 設定（只填官方明確公告的數值），把 `ACTIVE_RULE_YEAR` 改為 2027。
3. **課綱**：更新 `src/content/curriculum.json`；細項刪除時對應題目改為 `retired`，不改 ID。
4. 執行 `npm run validate:content` 與 `npm run test`。詳見 [docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md)。

## 進階功能（尚未啟用）

- **跨裝置同步**：GitHub Pages 為靜態託管，**手機與電腦的進度不會自動同步**；需另接 Supabase 等後端。目前請用「設定 → 匯出／匯入 JSON」搬移進度。
- **真實 AI 導師**：需部署後端代理（使用者驗證、用量限制、成本上限），並以 `VITE_AI_TUTOR_ENDPOINT` 指定網址。詳見 [docs/AI_TUTOR.md](docs/AI_TUTOR.md)。
- **PWA 離線快取**：已有 manifest，尚未加入 Service Worker。

## 官方依據與版權

- 評鑑內容範圍（115.06，2026-06-02）、學習指引、勘誤表、115 年簡章與已公告試題清單：見 `src/content/official-sources.json`（最後查核 2026-11-19）。
- 官方學習資源與公告試題：<https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources>
- 官方考試資訊：<https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info>
- 截至 2026-11-19，官網尚未公告 116 年（2027）簡章；網站顯示「依 2026 官方資料；2027 以新簡章為準」。
- 官方公告試題可公開下載，但查核頁面未見明示允許轉載、重製或改作的授權條款，因此**本 repo 不收錄官方題幹、選項或圖片**，只提供官方連結。

原始互動原型與規格參考保存在 `design/`。
