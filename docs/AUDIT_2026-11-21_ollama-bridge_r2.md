# Ollama 轉接程式：第二輪複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `e791868` 加未提交修改；依請求文件文末「第二輪」。

## 結論

**暫不同意發布本批改動。** F1–F5 原反例均已修復，新增實際執行測試有效；但本輪要求確認的 Ctrl+C 互動流程仍有一項 P2 必修 R2-1：返回 PowerShell 提示字元後，上游串流未被取消。

未修改正式程式或題庫，未提交、推送或 stage 稽核檔，未啟動、延長、重啟或變更使用者的 Ollama 許可。測試僅使用自建假上游、獨立連接埠及隔離狀態資料夾；測完均停止。

## F1–F5 原修正驗收

| 問題 | 檢查與實測結果 | 判定 |
| --- | --- | --- |
| F1 非 loopback 可用轉接 | 三個本機 LAN／VPN IPv4 位址搭配合法 Host／Origin 現在均 403；錯 Host 拒絕；其他、缺少及大小寫不同的 Origin 拒絕；上游沒有收到被拒請求 | 通過原反例 |
| F2 到期串流未中止 | 原隔離串流探測在約 3.94 秒中止、不含 DONE；正式 runtime 測試另驗證上游 closedEarly、程序結束、port 關閉、狀態清除 | 通過原到期反例；Ctrl+C 邊界見 R2-1 |
| F3 chunked 超過 2MiB | 2,162,688 bytes 的 chunked 上傳回 413；已知超長 Content-Length 也 413；上游沒有收到超限內容。正式 runtime 對照的小型 chunked 能完整送出並收到 DONE | 通過 |
| F4 誤殺 PowerShell | 舊隔離探測指向自建無關 PowerShell，現在 stopped=false；正式 runtime 另測啟動時間不符、PID＋啟動時間皆相符但不處理停止碼，均不終止無關程序。正常停止及重新啟動皆通過 | 通過 |
| F5 任意服務可延長計時 | 雲端、一般 localhost、127.0.0.1:11435、錯誤轉接 path，模型清單與問答兩條路徑帶90分鐘標頭均維持約30分鐘；connection 層直接套用雲端 localExpiresAt 也忽略；真正轉接五分鐘正確對齊 | 通過 |

F5 邊界：沒有／格式錯誤／已過期／不合理遠期標頭回到普通計時；不代表替本機重新授權。isBridgeUrl 與實際請求來源檢查均有套用，非只依 preset 名稱判斷。

重跑舊前端 `docs/audit-bridge.config.mts`：442 通過、1 失敗。唯一失敗是原本斷言「雲端能採用90分鐘」的缺陷觀察測試，修復後預期失敗；未改原檔來消除它。新版正向前端探測443通過，包含既有440項。

舊腳本產生探測依賴上一版的字串替換與 PID 檔格式；直接原樣重跑可能寫到正式 TEMP 狀態，故改用新 BridgeTestOptions 建立隔離副本，保留相同安全輸入與假上游測試流程。這是探測介面更新，不是修改正式腳本邏輯。

## 必修 R2-1（P2）：互動 Ctrl+C 只清理 listener，沒有取消上游

位置：`src/ai/byok/bridge.ts:225`–`:228`（catch 內 Abort），`:232`–`:239`（finally 僅清理 listener／狀態）。

### 重現方式

1. 以真實 bridgeScript＋測試參數產生轉接，使用獨立18439、假上游18434、隔離stateDir、120秒期限，不碰11434／11435。
2. 在獨立互動 Windows PowerShell 5.1 執行（`-NoExit -File`，模擬使用者貼上腳本後仍留在同一PowerShell程序）。
3. 假上游每200ms送一個SSE事件，測試客戶端經轉接讀取；確認已收到串流。
4. 在該獨立PTY送Ctrl+C，讓它返回提示字元，保持PowerShell開啟。

### 實際觀察

- 下游關閉，listener不再服務，狀態檔刪除，畫面顯示「轉接程式已關閉」。
- 但假上游**沒有收到連線關閉**；在下游關閉約20.4秒後查核，`upstreamClosed=false`、`downstreamClosed=true`、`stateFilePresent=false`。
- 之後主動退出這個**測試**PowerShell，上游才記錄closed。從下游關閉到上游關閉約 **23.9秒**。
- 期限為120秒，這是在原期限之前手動中止，不能當作自然到期。

證據：`docs/audit-bridge-r2-ctrlc-stream.json` 的事件時間、`docs/audit-bridge-r2-ctrlc-unclosed.json` 的中途查核。測完已退出自建互動PowerShell並呼叫假上游的測試shutdown，沒有留下轉接或假服務。

### 原因與建議修法

Ctrl+C 的 PowerShell pipeline 中止會進入 finally，但此實測沒有完成 catch 內的 `$fwd.Abort()`。finally 關 listener 並不等於取消獨立的 HttpWebRequest；互動shell仍活著時，未結束的上游工作也還活著。一般 `-File` 程序結束會關閉socket，容易掩蓋這個缺陷。

請將目前上游請求的 Abort、上游response／stream及下游的釋放放入所有退出路徑必定執行的finally，保留獨立try保護並先取消尚未完成的上游非同步工作。補一個「Ctrl+C後shell仍存活」的回歸，確定上游立即closed，而不是kill整個PowerShell後才宣稱清理成功。也檢查等待首回應、上傳及串流三種中止點。

這項不推翻正常到期與停止代碼的通過結果，而是本輪特別要求確認的手動中止路徑。真實Ollama可能因而繼續處理已開始的推論；本輪只證明連線未取消，沒有使用真實模型測其計算行為。

## 文末五個複查重點

1. **隔離重跑**：原F1–F5皆通過，含新的Windows PowerShell5.1實際腳本測試與PowerShell7的9項對照。來源／路徑大小寫比對、敏感標頭不轉送與禁止上游redirect均有確認。應用層loopback拒絕已落實，不把HTTP.sys URL prefix誤稱為底層socket只綁loopback；此處以每請求endpoint檢查保障。
2. **Wait-Task、Ctrl+C與413**：等待接收請求時Ctrl+C可離開並清狀態；有活躍上游時則有R2-1。另送Content-Length=3,000,000但只傳1 byte且保持socket開啟，仍收到413，約3.92秒的測試期限內程序退出；未發現此次413讓程序無限等剩餘上傳。未把此一樣本推廣為所有HTTP framing都已窮盡。
3. **TEMP停止代碼**：同一使用者可讀寫其TEMP、因而讓自己的轉接提早結束，屬可接受的本機可用性風險；同一使用者本來可停止自己的程序。停止碼不是防同使用者惡意程序的認證秘密，不能宣稱「只有轉接知道」。目前沒有把停止碼內容執行成命令、也沒有因此擴大可轉送API。建議以使用者專屬目錄／ACL、避免要求系統管理員執行，維持此威脅邊界。
4. **六秒無回應後不強殺**：可接受且較舊版安全。回報使用者手動關閉視窗，優於為便利而kill無法驗證的同名程序；重啟未成功時不應宣稱可用。正常restart與無關程序測試均通過。
5. **CI略過runtime**：目前ubuntu部署workflow沒有BRIDGE_RUNTIME設定，9項Windows腳本回歸會略過，不應以CI綠燈宣稱已測Windows腳本。建議增加windows-latest的必要檢查job；Linux＋pwsh可補跨平台相容性，但不能取代Windows HttpListener行為。本輪已在Windows5.1＋7實跑，CI缺口列建議而非另一個產品必修；後續發布至少應保留明確Windows人工執行門檻，直到自動化落地。

## 其他非阻擋觀察

- Ctrl+C提早結束仍印「許可時間已到」，因reason預設值未在中止路徑更新。應改為中止／手動關閉的中性說明，與R2-1清理一起修正。
- 正常SSE不是等整段結束才顯示：假上游每300ms送一段，首段約391ms抵達，完整DONE約3,501ms，合法轉送未因deadline檢查變成全量緩衝。
- 新增403文案區分Ollama／其他本機／雲端，並以「最可能」描述來源原因，比原本一律說不是金鑰問題精確。手動停止要到下次請求才發現、按鈕只複製指令等限制已有說明。
- Wait-Task目前在task未完成時輪詢；可考慮完成後再確認一次截止以減少邊界時間差，但本輪沒有重現新的到期繞過，不列必修。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835題，0錯誤、0警告 |
| test | 440通過，包含9項Windows PowerShell5.1實際執行；未略過runtime |
| PowerShell7 runtime單獨重跑 | 9通過 |
| build | 通過 |
| test:e2e | 54通過、2選用略過 |
| 舊前端探測＋既有測試 | 442通過、1舊缺陷斷言預期失敗 |
| 新F5正向探測＋既有測試 | 443通過 |
| 自建隔離腳本探測 | F1–F5原反例修復；活躍串流互動Ctrl+C重現R2-1 |

E2E使用Edge、TZ=UTC及獨立 `/ipas-ai-prep/` 子路徑預覽。未實測macOS／Linux暫時許可指令、未重新執行Python題庫雙引擎或內容語意審閱。假上游測試中的Python只是測試工具，不等於verify:python。

## 清理與本機證據（不stage）

最終18434、18435、18437、18438、18439均已確認不接受連線，見`docs/audit-bridge-r2-cleanup.json`；runtime記錄`all_spawned_stopped=true`。程式碼中的11434／11435在前端探測僅是mock設定值，沒有真的向使用者Ollama發請求。

- `docs/audit-bridge-r2-generate.mjs`、`docs/audit-bridge-r2-{main,expiry,slow,ctrlc}.ps1`與隔離state資料夾。
- `docs/audit-bridge-r2-runtime.py`、`docs/audit-bridge-r2-runtime.json`、`docs/audit-bridge-r2-runtime.log`。
- `docs/audit-bridge-r2-stream.mjs`、`docs/audit-bridge-r2-stream.json`（正常逐段輸出對照）。
- `docs/audit-bridge-r2-ctrlc.json`（等待中斷）、`docs/audit-bridge-r2-ctrlc-stream.mjs`、`docs/audit-bridge-r2-ctrlc-stream.json`、`docs/audit-bridge-r2-ctrlc-unclosed.json`（活躍上游）。
- `docs/audit-bridge-r2.config.mts`、`docs/audit-bridge-r2.extra.test.ts`、`docs/audit-bridge-r2-observations.jsonl`。
- `docs/audit-bridge-r2-{typecheck,lint,final-lint,validate-content,test,build,e2e,pwsh,old-front,extra}.log`。

下一步：修R2-1的finally上游取消與互動shell回歸，再請複查。不要因F1–F5原反例修復而略過Ctrl+C留下的上游工作。
