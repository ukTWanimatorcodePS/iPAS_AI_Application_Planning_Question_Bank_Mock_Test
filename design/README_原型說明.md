# AI 備考室｜iPAS AI 應用規劃師初級／中級備考平台

這是一套為 Claude Code（Claude Opus 5.5）準備的 **專案規格＋RWD 可互動視覺原型**。

## 內含檔案

- `CLAUDE.md`：正式網站完整開發規格、官方課綱、題庫模型、功能、桌機／手機設計、檢測與 GitHub Pages 部署要求。**請 Claude Code 從這份檔案開始。**
- `index.html`：無須安裝套件即可開啟的靜態互動原型（桌機／手機版同一檔）。
- `介面預覽.html`：與 `index.html` 相同的預覽，便於辨認。
- `desktop.png` / `mobile.png`：桌機與手機的原型首頁截圖。

## 目前互動原型有什麼

- 初級／中級切換（但中級講義尚未填完）
- 首頁與學習進度視覺化
- 初級 L111、L112 自編示範講義
- 5 題自編示範單選題（L111 三題、L112 兩題）
- 單元測驗、交卷、逐一說明四個選項、錯題自動收錄
- 測驗成績、單元進度、瀏覽器本機保存（允許時）
- JSON 學習進度匯出／匯入
- 手機底部導覽、桌機側欄

**注意：** 本原型不是完整正式題庫、不含完整官方講義、沒有即時 AI 導師，也沒有雲端跨裝置同步。所有示範題都是自編，沒有冒稱官方原題。`CLAUDE.md` 是正式開發的驗收規格。

## 直接查看介面

直接用瀏覽器開啟 `index.html`。若某些行動瀏覽器不允許直接開啟本機 HTML，可透過本機 HTTP 伺服器（例如 VS Code Live Server）或將靜態檔案部署至 GitHub Pages。

## 如何交給 Claude Code

1. 將整個資料夾解壓縮、移到你的專案位置，例如 `ipas-ai-prep`。
2. 開啟終端機切換至該資料夾，啟動 `claude`。
3. 在 Claude Code 中確認使用 Opus 5.5（可透過 `/model` 選擇；模型選項依你的帳戶與版本為準）。
4. 貼入這段指令：

```
請先完整閱讀目前資料夾的 CLAUDE.md、README.md 和 index.html。
我要製作可託管在 GitHub Pages 的 iPAS AI 應用規劃師初級＋中級備考網站。
請以 CLAUDE.md 為正式產品需求，以 index.html 為桌機／手機介面視覺參考。
請直接建立可維護的 Vite + React + TypeScript 正式專案，先完成核心學習流程、資料模型、RWD 和本機儲存，執行實際測試，再逐批擴充官方課綱對應講義與原創題庫。
若現有內容只屬示範，請明確標記，勿虛構歷屆題來源、答案或考試規則。
請新增 GitHub Actions 自動部署、README、測試與題庫內容審核流程；以程式碼可運作、手機版可用為交付標準。
不要只輸出開發建議或設計圖片，請實際修改專案檔案，執行 build、test，並逐項列出未完成之處。
```

## 如何將「原型」放在 GitHub Pages（適合先測試外觀）

這份原型不需要 npm build：
1. 在 GitHub 建立公開 repository，例如 `ipas-ai-prep`。
2. 上傳 `index.html`（可一起上傳其他檔案），commit 到 `main`。
3. GitHub repository 的 `Settings → Pages`：選擇 `Deploy from a branch`、`main` 與 `/ (root)`。
4. 部署後網址格式為 `https://你的使用者名稱.github.io/ipas-ai-prep/`。

**正式 React/Vite 專案**完成後，應依 `CLAUDE.md` 與 Vite 官方指引改用 GitHub Actions 編譯後部署，並設定好 Vite `base`；不要把開發伺服器地址當作公開網址。

## 資料保存與進階功能

GitHub Pages 只提供靜態網站。原型的進度儲存在目前裝置／瀏覽器，**同一個網址在手機和電腦可以開，但不代表學習紀錄會自動同步**。要登入與跨裝置同步，需要另外配置 Supabase 或其他後端。要即時呼叫 AI API 解題，應使用安全的後端轉送服務，**不可把 API key 放在公開網站前端**。

## 官方依據（於 2026-11-18 核對）

- 官方評鑑內容範圍 115.06：<https://www.ipas.org.tw/api/proxy/uploads/certification_attachment/8039a24c849c4fb4a6dd7f942576d4f8/AI%E6%87%89%E7%94%A8%E8%A6%8F%E5%8A%83%E5%B8%AB%E8%83%BD%E5%8A%9B%E9%91%91%E5%AE%9A_%E8%A9%95%E9%91%91%E5%85%A7%E5%AE%B9%E7%AF%84%E5%9C%8D%E5%8F%83%E8%80%83_11506_20260602161501.pdf>
- 官方學習資源／公開題目：<https://ipd.nat.gov.tw/ipas/certification/AIAP/learning-resources>
- 官方考試資訊：<https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info>
- 中級程式題公告：<https://ipd.nat.gov.tw/ipas/certification/AIAP/news/ffdba0fcdbda40baadeef2a1bdc0230e>
- Vite GitHub Pages 部署：<https://vite.dev/guide/static-deploy>

2027 年官方簡章一旦公布，請以新版更新考期、合格條件與課綱，不要延續未核實的 2026 設定。官方公開試題的著作權／再利用條件需另外查核，不應將整份 PDF 原題與圖像未經許可複製到公開 GitHub repo。

> 獨立、非官方教育原型。與 iPAS 主辦機關無關，亦不代表官方授權或背書。
