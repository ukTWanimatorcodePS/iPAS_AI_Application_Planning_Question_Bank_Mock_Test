# Ollama 轉接程式簡化：第四輪複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `460c86c`（含已發布v1.2.1紀錄）加當前未提交修改；依複查請求文末「第四輪」。

## 結論

**暫不同意發布本批簡化改動。** 只留啟動、Ctrl+C停止、Windows選項與主要模型填入流程符合說明；但新增非同步自動模型儲存可覆蓋另一表單較新的操作，甚至恢復已清除金鑰，列一項P2必修R4-1。

沒有修改正式程式或題庫、未提交／推送或stage稽核檔，未啟動、延長、重啟或變更使用者Ollama許可。模型API均為測試mock；腳本執行回歸只用假上游、隨機port與隔離狀態。

## 必修 R4-1（P2）：自動填模型等待中，舊操作可恢復已清除金鑰／覆蓋新設定

位置：`src/components/ByokSettings.tsx:50`、`:172`–`:195`、`:205`–`:212`。

### 重現A：清除後復活

1. 儲存一份本機OpenAI相容服務設定（mock URL `http://localhost:18888/v1`），model空白、rememberKey=true、使用**自造假金鑰**。
2. 在ByokSettings按「儲存並連線」，讓第一次模型清單請求等待。
3. 呼叫公開的clearByok，模擬另一個設定表單／分頁清除；即時確認config=null、key為空。
4. 讓原模型清單回傳model-auto。

實際：舊commit重新儲存設定與假金鑰，並再次發出連線請求。觀察：

```json
{"restoredConfig":true,"restoredCredential":true,"model":"model-auto","calls":2}
```

預期：較新的清除應作廢舊的等待操作，不恢復設定或金鑰，也不再開始舊連線。

### 重現B：覆蓋新服務

相同等待中，另一操作改存OpenAI＋newer-user-choice；原清單返回後，實際儲存又變回custom＋model-auto。不是使用者後來再按了一次舊表單儲存，而是先前尚未完成的操作自動寫回。

### 原因與建議

withModel只檢查本元件formSeq；useSyncExternalStore雖因全域設定變更重新渲染，沒有令舊formSeq失效。commit仍使用送出時閉包中的舊form與key，且沒有在非同步結果消費／寫入前比對byokVersion。

請在開始等待時記錄全域設定版本／操作世代，模型結果套用及commit前都確認未變；另一表單儲存／清除、其他分頁變更應使舊操作失效。自己正常saveByok造成的版本改變需與外部變更區分，不能修成所有正常儲存都被中止。也檢查「只測試，不儲存」的withModel延遲分支，避免外部設定已更新後仍啟動舊連線。

加入等待中跨表單清除、較新儲存、正常自動填入的對照。勿只擴充當前表單changeModel／changeBaseUrl的formSeq，因本例未改該元件欄位。

證據：`docs/audit-bridge-r4.extra.test.tsx` 前兩項、`docs/audit-bridge-r4-observations.jsonl`。測試斷言重現舊設定被寫回，通過代表重現成功，不是產品驗收通過。本輪沒有使用真實金鑰或傳送到真實服務。

## 文末四個重點

1. **移除停止後的再次啟動與F4**：通過目前回歸。正式runtime已改用停止碼清理，並實測啟動時間不符的無關程序不被終止；時間相符但不回應停止碼時，新轉接放棄啟動，不強殺；正常再次啟動可交接同port。錯誤停止碼不會停止。正式腳本沒有重新引入Stop-Process；本次差異沒有修改第三輪已驗收的Ctrl+C finally取消邏輯。UI／腳本啟動畫面末行均指向Ctrl+C，沒有停止／重新啟動按鈕。
2. **prefersBridge與UA**：Windows Chrome、Edge、Firefox樣式與Windows ARM64實測true；Android、iPad、Windows Phone、macOS樣式false。這適合作預設UI選擇，不是安全判斷。隱私瀏覽器／UA偽裝仍可能無法推測實際OS；目前選中的服務保留，且直接Ollama仍可用「改用轉接程式位址」手動處理，沒有必要以架構名稱另設排除。不能宣稱所有Windows瀏覽器都保證UA可辨識。
3. **模型填入與使用者意圖**：空白本機模型先讀清單；已有名稱時儲存流程不主動換名，符合說明。使用者明確按「取得模型清單」且本機名稱不在清單時，會填入清單模型，畫面清楚指出已自動填入，且未按儲存前不持久化；雲端已有名稱不覆蓋、清單外別名可保留。這個既定產品行為可接受，可加更明確的覆蓋提示。核心缺陷是R4-1的跨操作過期寫回，而非本機不在清單時的明示自動替換。另orderModels僅靠名稱把疑似embedding排後面，不代表可證實對話能力；若只有向量模型，建議不要文案保證它是「對話模型」。此為相容性／文案建議，非新增必修。
4. **偵測只換表單、未啟動就儲存**：已有Ollama但403時，Windows會帶入bridge並提示「尚未儲存、先啟動、再儲存並連線」；已運作bridge優先偵測。未啟動就按儲存，清單讀取或連線失敗訊息指向「連不到本機轉接程式、可能未啟動或到期」，不要求無意義補API key；沒有假裝網頁能啟動本機程式。LM Studio保留直接連線，未被改指向只轉送Ollama的轉接程式。

## 介面補充實測

獨立Edge預覽、Windows UA、實際viewport=360×800：

- 轉接面板只有bridge-start，bridge-stop／bridge-restart均0個。
- 點啟動只把指令寫入mock剪貼簿，內容含Ctrl+C；沒有執行腳本或增加模型請求。
- 模型清單回alpha-chat／beta-chat，空白自動填alpha-chat，下拉改選beta-chat會同步輸入框。
- 從頭到尾只有1次模擬清單請求；頁面scrollWidth不大於viewport，截圖目視按鈕與模型欄位可讀。未做真實手機軟鍵盤或完整無障礙驗收。

補充探測初跑錯將同一Windows專用操作放到Pixel7（Android UA），因該平台正確不列Windows轉接選項而timeout；不是產品錯誤。保留原失敗日誌後，依測試目的限定Windows project重跑，1項通過。截圖檔名desktop-1440沿用project名稱，實際寬度是360，不宣稱是1440畫面。

## 指定檢查結果

| 檢查 | 實際結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增稽核後再跑） | 通過 |
| validate:content | 835題，0錯誤、0警告 |
| test（含11項Windows PowerShell隔離runtime） | 451通過 |
| build | 通過 |
| test:e2e | 54通過、2選用略過 |
| 額外競態／UA探測＋既有測試 | 454通過；含成功重現R4-1的觀察型斷言 |
| Windows 360px補充瀏覽器 | 1通過；初次錯套Android的探測失敗另保留 |

E2E使用Edge、TZ=UTC、獨立 `/ipas-ai-prep/` 子路徑預覽。未對真正Ollama啟動轉接、未修改其許可，沒有重跑Python題庫雙引擎或逐題語意審閱。本輪沒有再做三點真實PTY Ctrl+C，因取消控制流程未變；正式runtime仍保留第三輪新增的管線停止回歸並通過，不將兩者混稱。

## 本機證據（不stage）

- `docs/audit-bridge-r4.config.mts`、`docs/audit-bridge-r4.extra.test.tsx`、`docs/audit-bridge-r4-observations.jsonl`、`docs/audit-bridge-r4-extra.log`。
- `docs/audit-bridge-r4-{typecheck,lint,final-lint,validate-content,test,build,e2e}.log`。
- `docs/audit-bridge-r4.playwright.config.mts`、`docs/audit-bridge-r4.browser.spec.ts`。
- `docs/audit-bridge-r4-browser.log`（初始平台選取失誤）、`docs/audit-bridge-r4-browser-windows.log`（正確Windows驗收）、`docs/audit-bridge-r4-browser-observations.jsonl`、`docs/audit-bridge-r4-desktop-1440.png`。

下一步：修正R4-1的全域版本／操作失效判斷，保留同步已有模型的行為與正常自動填入，再請複查。未修改正式程式或題庫、未提交／推送，未stage稽核檔。
