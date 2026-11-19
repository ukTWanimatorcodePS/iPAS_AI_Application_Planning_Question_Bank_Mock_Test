# 內容撰寫、審核與更新指南

本文件規範講義與題庫的新增、校閱、授權確認與每年更新流程。原則：**分批產生、逐題校閱、自動測試、清楚標示來源**；不可一次大量生成後宣稱已驗證，也不可把無來源的推測當作官方解答。

## 1. 講義

- 位置：`src/content/lessons/<科目>/<細項代碼>.md`，例如 `lessons/L11/L11101.md`。一個官方細項一個檔案，檔案存在即視為「已收錄」。
- 必備 `##` 段落，**依序**：學習目標 →（選用：先備概念）→ 必考核心觀念 → 名詞與定義 → 原理及運作流程 → 不同領域的實際案例 → 容易混淆的觀念比較 → 常見考試陷阱 → 單元重點整理 →（選用：單元回顧）→ 延伸參考與來源。第 9 項「對應練習題入口」由講義頁自動產生。（`tests/unit/content.test.ts` 會檢查。）
- 專業名詞保留中文與英文（例如「過擬合（Overfitting）」）；以適合非資訊背景考生的語言說明，但不犧牲正確性。
- 案例依觀念選擇最容易理解的情境，避免每一章都用相同產業。
- 講義中的 Python 範例若以 `print(...)  # 註解` 標示輸出，`npm run verify:python` 會實際執行並檢查輸出出現在註解中；近似值請在註解寫「約」。
- 公式使用 KaTeX 語法（`$...$`、`$$...$$`）；程式碼使用 ```` ```python ```` 區塊。
- 「延伸參考與來源」至少附官方評鑑範圍 PDF 連結，以及可靠的公開來源（法規資料庫、標準文件、原始論文、官方技術文件）。
- **不可大量照抄官方學習指引原文**；以自己的話整理並註明出處。
- 每份講義結尾註明「本講義為本站自編整理，非官方教材」。

## 2. 題目

- 位置：`src/content/questions/<科目>/<主題>.json`，例如 `questions/L11/L111.json`。
- Schema 定義在 `src/content/schema.ts`，載入時以 Zod 驗證，不合格會導致建置／測試失敗。
- **ID 規則**：`<origin>-<細項代碼>-<四位流水號>`，例如 `original-L11101-0001`。**ID 一經釋出不得變更或重複使用**，否則使用者的錯題與作答紀錄會失聯。要淘汰題目時把 `reviewStatus` 改為 `retired`（保留以顯示歷史紀錄），不要刪除或改 ID。新增題目後執行 `npm run registry:sync` 把 ID 加入 `src/content/question-registry.json`；驗證器會擋下從題庫消失的已釋出 ID。
- 第二階段必填欄位：`difficultyTier`（`basic` 基礎／`advanced` 進階／`applied` 應用）、`questionType`（`concept` 概念理解／`scenario` 情境應用／`comparison` 比較判斷／`practical` 實務分析）、`lessonSection`（必須是對應講義中存在的 `##` 或 `###` 標題）、`authoring`（`ai-drafted`、`human-written`、`ai-drafted-human-edited`）。
- 每題四個選項、單選題只有一個正解；同一細項的題目不可只換人名、公司名稱或數字（`npm run validate:content` 以字元雙字組相似度檢查，≥ 0.85 視為重複、同細項 ≥ 0.65 提醒人工確認）。
- 每題必須：
  - 有 `explanation.summary`（概念重點）、`correctRationale`（正解為何對）、`optionRationales`（**每個選項**都要有解析；正解的解析以「正確」開頭，其他選項不可以「正確」開頭）、`commonTrap`（容易混淆處），建議附 `example`（生活／業務例子）。
  - `lessonAnchor` 指向已收錄講義的細項代碼，讓解析頁能返回講義。
  - 題幹不可重複；避免「以上皆是／以上皆非」；誘答選項要有教學意義。
- 正解分布：測試會檢查任一選項字母占比 < 40%。撰寫時刻意輪替正解位置。

### 程式題

- 加上 `code`（程式片段）、`codeLanguage: "python"`、`codeWalkthrough`（逐行解說）與 `verification: { "kind": "python-stdout", "expectedStdout": "...", "status": "pending", "runtime": null, "packages": {}, "verifiedAt": null }`。
- 正解選項文字必須**完全等於** `expectedStdout`（schema 會檢查）。
- 執行 `npm run verify:python -- --stamp`：以 Pyodide（固定版本的 WebAssembly CPython，含 NumPy、pandas、scikit-learn）實際執行，通過者寫回 `status: "verified"`、執行環境與套件版本；失敗者維持 `pending`。**未執行驗證的題目不可標示為已驗證**。
- CI 另以 `--engine=cpython`（系統 Python 3.12＋pip 安裝的套件）交叉驗證。
- 前端網站**不執行**任何 Python，只顯示程式碼供閱讀判讀。

## 3. 審核狀態 `reviewStatus`

| 值 | 意義 | 是否出題 |
| --- | --- | --- |
| `draft` | 草稿 | 否 |
| `retired` | 已淘汰；保留以顯示歷史作答紀錄，ID 永不重用 | 否 |
| `ai-checked` | AI 撰寫、通過自動檢查與自我校對，**尚未人工審核** | 是（UI 顯示狀態） |
| `human-reviewed` | 已由具相關專業者人工校閱 | 是 |

人工審核時請確認：觀念正確、題意無歧義、只有一個最佳答案、每個選項解析正確、與講義一致、沒有抄襲。通過後改為 `human-reviewed` 並填 `verifiedAt`（YYYY-MM-DD）。

## 4. 題源與授權

| `origin` | 意義 | 收錄條件 |
| --- | --- | --- |
| `official-released` | 官方公告原題 | 必須取得合法使用依據（授權書、官方明示可再利用條款等），`copyrightStatus` 為 `licensed` 或 `public-domain`，並填 `year`、`session`、`sourceUrl` |
| `official-sample` | 官方樣題 | 同上 |
| `original` | 本站自編練習題 | `copyrightStatus: "original"`，`year` 必須為 `null` |
| `simulated` | 仿考試形式的自編模擬題 | 不可標示年份或冒稱官方題 |

- 「可公開下載」≠「可整批重製到公開 GitHub repo」。版權狀態不明（`unknown`）的官方題**不可收錄**，schema 會拒絕。
- 官方試題圖片有相同限制，不得自動抓取上傳。
- 取得授權後，把授權依據（文件或連結）記錄在 PR 說明與 `docs/` 中。
- 不可虛構年份、梯次或「歷屆題」來源。

## 5. 新增內容的流程（每一批）

1. 開新分支，一次處理一個主題（例如 L221）。
2. 撰寫講義 → 撰寫 3～5 題／細項，依上述規範。
3. 執行 `npm run validate:content`（重複 ID、答案合法性、缺少解析、無效課綱代碼、講義段落、相似度）、`npm run test` 與 `npm run verify:python -- --stamp`，再 `npm run registry:sync`。
4. 抽查：至少逐題閱讀一遍，確認正解與解析邏輯一致，必要時對照講義與參考來源。
5. 開 PR，CI 全綠後合併；合併到 `main` 會自動部署。

## 6. 每年更新

1. 官方公布新年度簡章或評鑑範圍後，更新 `src/config/examRules.ts`（新增年度設定、只填官方明確公告的數值）與 `src/content/curriculum.json`（版本、日期、來源、細項）。
2. 細項新增：補講義與題目。細項刪除：對應題目改為 `retired`，講義可移到 `design/archive/`。細項更名：只改名稱，不改代碼與題目 ID。同時更新 `src/content/official-sources.json` 的文件清單與 `lastCheckedAt`。
3. 更新 README 的「目前內容收錄狀態」與官方依據日期。
4. 執行全部測試後部署。

## 7. 自動檢查的界線

`validate:content`、單元測試與程式執行驗證只能確認**結構與一致性**（欄位齊全、答案存在、解析對應、程式輸出正確、題目不重複），無法確認觀念敘述是否完全正確或題意是否無歧義。自動檢查通過的題目狀態為 `ai-checked`，仍需具專業背景者逐題審閱後才能改為 `human-reviewed`。
