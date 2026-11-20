# Ollama 轉接程式：第三輪複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `e791868` 加未提交修改；依請求文件最後「第三輪」，確認R2-1與 `$done` 的取消路徑。

## 結論

**同意本次已複查的轉接程式修正發布。** 真實PTY、Windows PowerShell5.1、`-NoExit` 的三個中止點均通過；R2-1不再重現，沒有發現新的必修問題。此驗收不構成提交／推送授權，也不包含之後的新修改或本機未追蹤稽核檔。

沒有修改正式程式或題庫、未提交／推送或stage稽核檔，未啟動、延長、重啟或變更使用者的Ollama許可。測試只用假上游、獨立連接埠及隔離狀態資料夾，沒有向11434／11435發實際請求。

## R2-1：真實Ctrl+C互動驗收通過

### 方法

使用目前 `bridgeScript()` 加僅供測試的參數產生三個腳本：假上游 `127.0.0.1:19434`，轉接各為19439／19440／19441，120秒期限，docs下各自stateDir。不修改產生出的控制流程。

每例均在獨立PTY執行：

```text
powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File <隔離測試腳本>
```

確認到達指定中止點後送出真實Ctrl+C，**先不退出PowerShell**，記錄上下游事件、PowerShell程序仍存在與狀態檔清除。完成查核後才輸入exit，再停止假上游。與只呼叫runspace Stop或直接kill整個程序的測試不同，不會靠程序退出掩蓋socket未取消。

### 三個中止點

| 中止點 | Ctrl+C前已確認 | Ctrl+C後、退出shell前的結果 |
| --- | --- | --- |
| 上傳中 | 宣告Content-Length=1,048,576，只傳8 bytes、不結束本文；橋接正在等待剩餘上傳；上游未收到請求 | 客戶端socket關閉、上游仍無請求；shellStillAlive=true、statePresent=false |
| 等待第一個回應 | 假上游已收到完整請求，但刻意不傳回應標頭 | 上游連線關閉、客戶端socket關閉；shellStillAlive=true、statePresent=false |
| 串流中 | 假上游每200ms送SSE，客戶端已收到首段資料 | 上游與下游均關閉；shellStillAlive=true、statePresent=false |

等待首回應時上下游關閉事件相隔約1ms，串流時相隔約2ms；這是事件間距，不將工具送鍵往返延遲誤當成模型或網路處理時間。三例都在120秒期限之前手動中止，畫面顯示「已中止」，沒有把自然到期當作Ctrl+C成功。

第二輪的缺陷是「shell仍活著時，上游超過20秒沒有關閉，退出shell才關閉」。本輪在退出shell前就觀察到上游closed，因此確實修正該缺陷。上傳階段尚未建立上游連線，驗收對象是下游中止與不轉送半截資料。

## `$done` 控制流程：通過

位置：`src/ai/byok/bridge.ts:154`、`:163`–`:214`、`:228`–`:239`。

- 每個請求先初始化 `$done = $false`、`$fwd = $null`、`$upRes = $null`，不沿用上一個請求的完成狀態。
- 403（來源／端點）、204（預檢）、404（路徑／方法）、413（已知或實際本文超限）都在關閉下游回應之後才設true，且尚未建立上游請求。
- 502的true分支限於GetResponseAsync已fault、沒有可轉送上游response，並在下游關閉後設定；沒有看到仍在等待的上游任務被此分支誤標完成。
- 正常串流只有讀到EOF、上游stream／response及下游均Close後才設true；不是收到首段資料或送出請求時就標完成。
- 在讀上傳、取得request stream、寫上傳、等待response、讀／寫串流任何一步中止或出錯時，true尚未設定，請求層finally便會Abort上游、Close上游response、Abort下游。
- Ctrl+C可跳過catch，但不能跳過本輪實測的finally；取消不再只依賴catch。

`Complete-Task()`完成後再查截止已加入，減少工作完成時剛好到期的邊界。中止原因預設「已中止」，正常外層退出才改為到期或停止碼，修正第二輪的誤導文案。

以上是控制流程檢查，加上三點真實PTY及正式runtime回歸，不宣稱已列舉每一種作業系統例外或強制終止程序的情況。

## 回歸與限制

- 新增的11項runtime測試實際執行產生腳本，包含原F1–F4、停止／重新啟動、runspace停止時保留程序的上游清理；本輪Windows5.1與PowerShell7均通過。
- F5及403、重新連線按鈕、到期標頭的既有前端測試通過，未見本次修改造成倒退。
- 正常停止碼與deadline仍可關閉轉接；不使用Stop-Process來停止不確定身分的使用者程序。
- 既有Windows CI缺口仍是非阻擋建議：ubuntu預設會略過Windows腳本執行測試。本次已在Windows人工執行，後續發布應維持此門檻，建議另加windows-latest必要檢查。Linux＋pwsh不能完全取代Windows網路行為。
- 未在真實Ollama產生推論，未實測macOS／Linux指令；沒有為了驗證重新授權任何使用者服務。Ctrl+C可取消上游連線，不保證每一種供應商實作都會立即停止其內部計算。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增稽核後再跑） | 通過 |
| validate:content | 835題，0錯誤、0警告 |
| test（含11項Windows5.1 runtime） | 442通過 |
| PowerShell7 runtime單獨重跑 | 11通過 |
| build | 通過 |
| test:e2e | 54通過、2選用略過，exit=0 |
| 真實PTY／NoExit／Ctrl+C | 上傳、等待首回應、串流三例通過，查核時shell仍在執行 |

E2E使用Edge、TZ=UTC及獨立 `/ipas-ai-prep/` 子路徑預覽，模型服務由測試模擬。未重新執行Python題庫雙引擎或逐題內容審查；此次未改題庫。隔離資料整理用的Python不是verify:python。

## 清理與證據（僅本機，不stage）

- `docs/audit-bridge-r3-generate.mjs`、`docs/audit-bridge-r3-pty-fixture.mjs`。
- `docs/audit-bridge-r3-{upload,waiting,stream}.ps1` 及隔離state資料夾。
- `docs/audit-bridge-r3-{upload,waiting,stream}-before.json`、對應after.json與events.json：查核發生在退出PowerShell前；不要把之後清理假服務的事件當作Ctrl+C證據。
- `docs/audit-bridge-r3-results.json`、`docs/audit-bridge-r3-cleanup.json`。
- `docs/audit-bridge-r3-{typecheck,lint,final-lint,validate-content,test,pwsh,build,e2e}.log`。

三個測試shell與假上游均已自行退出／停止；四個固定測試port（19434、19439、19440、19441）完成關閉查核。沒有讀寫使用者正式TEMP轉接狀態。

下一步可由使用者決定是否授權整理與發布；提交清單應排除docs下稽核腳本、日誌、暫存狀態與其他未追蹤資料。
