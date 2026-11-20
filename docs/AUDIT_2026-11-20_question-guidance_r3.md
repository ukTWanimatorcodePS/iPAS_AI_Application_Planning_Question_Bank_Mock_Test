# AI 導師提問引導：第三輪複查

日期：2026-11-20（Asia/Taipei）。基準 HEAD `aed6b20` 加當前未提交修改；依請求文件最後「第三輪」。

## 結論

**同意本次已複查的提問引導修正發布。** G2-R2 與 S1 通過，本輪未發現新的必修問題。這是針對目前已查核程式與測試的驗收結論，不是提交／推送授權，也不涵蓋之後新增的修改、未追蹤稽核檔或其他未驗收內容。

## G2-R2：通過

程式位置：`src/components/TutorChat.tsx:171`、`:187`、`:243`、`:271`。

- 有效情境鍵改變時清空延續資格並增加 ctxGeneration。
- 送出流程在第一個 await 之前記錄 generation。
- 延續資格寫入同時檢查情境 key 與世代；離開 A 再回 A 即使 key 相同，世代仍不同。

重新執行第二輪原探測：

1. A＝L11301 送出「什麼是過擬合？」。
2. 在 prepareTurn 等待中停住，切至 B＝L11101，再返回 A。
3. 釋放原檢索；依本輪既定產品規則，舊提問仍可完成，模型請求數是 1。
4. 再問「可以再白話一點嗎？」：被本機阻擋，請求維持 **1**，未恢復延續資格。

原探測期待舊缺陷的 calls=2，現在因修復預期失敗；未修改原檔掩蓋結果。

新增正向驗收探測另確認：

- 完成的學習對話在 A→B→A 後，短追問仍被擋。
- 等待中的請求沒有切換情境，完成後短追問正常送出，累計 2 次；世代機制沒有一律阻擋延續。
- 出版社／行銷部生活案例的 conceptHits=[]，仍是 possible_off_topic；協同過濾與推薦系統的合法提問仍可通過。

本輪驗收的是「舊請求不重建已失效資格」，不是要求離開任何講義都取消已發出的模型請求；該產品規則與本輪請求一致。

## S1：通過

位置：`tests/unit/connection.test.tsx:157`–`:159`。

連線 store online 的等待仍保留，接著對 role=status 的「已連線」文字也使用 waitFor。沒有刪除／放寬文案、模型清單請求次數、計時器等驗證，沒有加入固定 sleep。

本輪正式 test 全套 420 通過；指定舊探測套件及新探測套件所包含的既有測試也未重現先前的文案時序失敗。這不保證任何機器上永遠零偶發，但已針對先前失敗的不同更新時點做適當等待。

## 驗證結果

| 指令／探測 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 420 通過 |
| build | 通過 |
| 指定 r2 探測＋既有測試 | 422 通過、1 舊缺陷斷言預期失敗 |
| r3 正向驗收探測＋既有測試 | 424 通過 |
| test:e2e | 54 通過、2 選用略過，exit=0 |
| 引導草稿／360px／到期補充瀏覽器 | 2 通過，exit=0 |

完整 E2E 使用 Edge、TZ=UTC，獨立本機預覽及 `/ipas-ai-prep/` 子路徑；補充瀏覽器測試固定 360×800，驗證鍵盤及滑鼠只填草稿、0 次模型請求、無頁面橫向溢出、引導不遮擋輸入框、到期不能繞過。

本輪以模擬服務回應測試，未使用真實 AI／付費金鑰或 Ollama，未測任意雲端服務格式。未重跑 Python 或逐題內容重審（指定命令未要求、題庫未變動）。不把本次回歸宣稱為所有對話意圖、實機鍵盤或完整螢幕閱讀器驗收。

## 本機證據（不 stage）

- `docs/audit-guidance-r3.config.mts`、`docs/audit-guidance-r3.extra.test.tsx`、`docs/audit-guidance-r3-observations.jsonl`
- `docs/audit-guidance-r3-typecheck.log`、`docs/audit-guidance-r3-lint.log`、`docs/audit-guidance-r3-final-lint.log`
- `docs/audit-guidance-r3-validate-content.log`、`docs/audit-guidance-r3-test.log`、`docs/audit-guidance-r3-build.log`
- `docs/audit-guidance-r3-old-probes.log`、`docs/audit-guidance-r3-extra.log`、`docs/audit-guidance-r3-e2e.log`、`docs/audit-guidance-r3-browser.log`

未修改正式程式或題庫、未提交或推送、未 stage 未追蹤稽核檔，未變更／延長 Ollama 許可。下一步由使用者決定是否授權整理與發布；發布前仍應確認待提交清單只含驗收範圍。
