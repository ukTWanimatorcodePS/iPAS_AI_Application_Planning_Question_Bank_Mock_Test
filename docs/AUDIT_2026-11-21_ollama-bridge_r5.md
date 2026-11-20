# Ollama轉接簡化：第五輪複查

日期：2026-11-21（Asia/Taipei）。基準HEAD `460c86c` 加當前未提交修改；依複查請求文末「第五輪」。

## 結論

**同意本次已複查的R4-1修正發布。** 原本兩項過期儲存反例均無法再重現；跨分頁事件、只測試及正常自動填入對照也通過。盤點其他等待後的路徑，未發現另一個未保護的自動全域設定寫入點。

此結論不是提交／推送授權，也不包含之後的新修改或本機未追蹤稽核檔。本次沒有修改正式程式或題庫、未提交／推送或stage稽核檔，未啟動、延長、重啟或變更使用者Ollama許可。

## R4-1修正驗收

位置：`src/components/ByokSettings.tsx:173`–`:203`、`:228`–`:234`、`:254`–`:260`。

- 空白模型的非同步save／test路徑，在等待前記錄byokVersion。
- withModel成功或失敗返回時，先確認本表單formSeq，再查全域版本；過期則顯示取消，不套用模型／設定。
- Promise結果消費、真正commit／connect之前再查一次版本。
- 自己的saveByok只在檢查通過之後執行，因此其版本遞增不會反過來取消正常儲存。
- config.ts的clear／save及相關storage事件都會通知版本變更；本輪有獨立storage事件對照。

### 原反例重跑

原檔 `docs/audit-bridge-r4.extra.test.tsx` 未修改，透過其原config重跑：**456通過、2失敗**。兩項失敗皆是原缺陷測試等待第二次請求，但現在只收到一次，屬修復後預期失敗，並非兩項產品倒退。

新增正向驗收的輸入與實際結果：

| 情境 | 實際結果 |
| --- | --- |
| 模型清單等待中，另一操作clearByok，再讓清單成功返回 | calls=1，config=null、key空白、phase=idle，顯示取消；未恢復假金鑰 |
| 等待中另存OpenAI＋newer-user-choice | calls=1，保留新服務、新模型及新的假金鑰 |
| 「只測試，不儲存」等待中被清除 | calls=1、phase=idle，不開始舊連線 |
| storage事件通知設定已清除 | calls=1，取消且沒有寫回 |
| 模型清單失敗前設定已清除 | 保持config=null／key空白／phase=idle，顯示取消；無舊設定儲存或verifyConnection |
| 無外部變更 | model-auto正常填入、儲存與連線，calls=2、phase=online |

所有金鑰均為自造假值，服務回應由測試mock。沒有向測試設定文字中的localhost:18888或雲端URL發實際請求。

## 等待後寫入全域設定的路徑盤點

全src搜尋saveByok／設定儲存呼叫，非config.ts本身的呼叫只有ByokSettings兩處：

| 路徑 | 是否等待後自動寫全域設定 | 判斷 |
| --- | --- | --- |
| save→withModel→commit，`:221`／`:230` | 是；本輪修正對象 | 具全域版本與formSeq檢查，通過 |
| 已有模型名稱的save→commit | 否，使用者按下當次同步儲存 | 維持既有行為，沒有本輪的等待窗口 |
| 自動偵測detect | await後只更新本表單cfg／detected／提示 | 不會直接saveByok；未見自動覆蓋全域設定 |
| applyDetected「套用並連線」，`:375` | 使用者再次明確點選後同步儲存 | 是新的確認操作，不是舊等待結果自動commit；不應僅因先前偵測有await就當成同一缺陷 |
| fetchModels「取得模型清單」 | 只更新models／本地cfg／提示 | 沒有全域設定寫入；未按儲存不持久化 |
| test／reconnect／connect | 只確認服務並更新連線狀態 | 不是設定儲存；新增空白模型test分支已加版本守門 |
| TutorChat送出／重新連線 | 讀設定快照，不呼叫saveByok | 未發現其他設定寫入點 |

applyDetected的保存會以使用者當次按鈕操作作為授權；本輪不要求取消這個明確的新操作。若將來把偵測結果改成自動保存，必須加入同樣的版本／操作世代保護。

本輪版本驗證以收到的設定變更與storage事件為依據；沒有宣稱localStorage具跨分頁交易或任意多分頁寫入的完全序列化能力。

## 失敗分支診斷請求的區分

新增失敗清單測試初稿曾把所有fetch都當作後續連線，預期總數1而失敗。追蹤URL後確認第二次是既有的本機錯誤診斷：

```text
http://localhost:18888/v1/models  （原清單請求，故意失敗）
http://localhost:18888/           （不帶金鑰的本機可達性診斷）
```

它不是verifyConnection、不是模型問答，也沒有設定寫入，phase保持idle。已將新增探測改為確認URL、取消文案與持久資料不變，並保留最初失敗日誌；沒有修改正式測試去隱藏產品失敗。

現有「已取消、沒有儲存也沒有連線」應理解為沒有後續設定保存／連線階段，並非保證已發出的清單與診斷HTTP都被撤回。若要讓文案更精確，可改「已取消儲存與後續連線」；此為非阻擋建議。這次任務重點是阻止過期寫回，不是替所有清單診斷新增AbortSignal。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835題，0錯誤、0警告 |
| test（含11項Windows PowerShell隔離runtime） | 455通過 |
| build | 通過 |
| test:e2e | 54通過、2選用略過 |
| 指定r4原探測＋既有測試 | 456通過、2舊缺陷斷言預期失敗 |
| r5正向探測＋既有測試 | 461通過（新增6項） |
| Windows360px模型下拉／啟動只複製補充瀏覽器 | 1通過 |

補充瀏覽器沿用前輪測試，僅mock模型清單與剪貼簿，沒有執行轉接指令。完整E2E使用Edge、TZ=UTC、獨立 `/ipas-ai-prep/` 子路徑預覽。沒有對真實Ollama或付費AI實測，也沒有重新做未變動的Ctrl+C真實PTY三點測試；正式runtime的既有安全／取消回歸仍通過。未重跑Python題庫雙引擎或逐題內容語意審閱。

## 本機證據（不stage）

- `docs/audit-bridge-r5.config.mts`、`docs/audit-bridge-r5.extra.test.tsx`、`docs/audit-bridge-r5-observations.jsonl`。
- `docs/audit-bridge-r5-extra.log`（初稿把診斷算成舊連線的錯誤預期）、`docs/audit-bridge-r5-extra-verified.log`（最終461通過）。
- `docs/audit-bridge-r5-old-probes.log`（原r4套件）。
- `docs/audit-bridge-r5-{typecheck,lint,final-lint,validate-content,test,build,e2e,browser}.log`。

本輪未發現新的必修問題。下一步可由使用者決定是否授權整理發布；待提交清單仍應排除本機稽核、日誌及暫存檔。
