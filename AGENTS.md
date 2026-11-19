# 維護指引（Claude Code／Codex 共用）

本專案由 Claude Code 與 Codex 共同維護。開始任何修改前請先讀：

1. `CLAUDE.md`：產品規格與官方依據（正式需求）
2. `README.md`：功能、指令、資料結構、部署
3. `docs/CONTENT_GUIDE.md`：講義與題目的撰寫、審核、授權與年度更新規則
4. 最新的複查紀錄：`docs/REVIEW_*.md`

## 必須遵守

- **題目 ID 永不變更或重用**；淘汰題目改 `reviewStatus: "retired"`，新增題目後執行 `npm run registry:sync`。
- 未經官方文件核實的考試資訊不可寫死；更新前請打開官方簡章或 PDF 原文核對，並記錄在 `src/content/official-sources.json`。
- 不可把官方公告試題的題幹、選項或圖片放進本 repo（官方未明示再利用授權），只提供官方連結。
- 只有具相關專業者實際審閱過的內容才能標為 `human-reviewed`；自動檢查通過只能是 `ai-checked`。
- 發現並確認的錯誤說法，請加入 `src/content/misconceptions.ts` 與 `tests/unit/misconceptions.test.ts`，避免再犯。
- 不可修改 IndexedDB 既有版本定義；資料結構變更請新增 Dexie version 與 migration，並維持備份檔向下相容。
- 前端不可放任何 API 金鑰（AI 導師說明見 `docs/AI_TUTOR.md`）。
- 報告中的數字與覆蓋範圍，請以實際指令輸出為準，並分開列出結構檢查、程式執行驗證與內容審閱。
- 官方評鑑範圍改版時，更新 `curriculum.json` 的 `officialScope`（逐字）與 `scopeTerms`；測試會檢查官方點名的文件、工具與方法都出現在對應講義。
- 參考外部（非官方）網站時只參考做法，內容一律回到官方或原始文件查證後自行撰寫，不複製文字。

## 提交前檢查

```bash
npm run typecheck
npm run lint
npm run validate:content
npm run test
npm run verify:python -- --strict
npm run build
npm run test:e2e
```

推送到 `main` 後，GitHub Actions 會重跑上述檢查並部署到 GitHub Pages：
<https://uktwanimatorcodeps.github.io/iPAS_AI_Application_Planning_Question_Bank_Mock_Test/>
