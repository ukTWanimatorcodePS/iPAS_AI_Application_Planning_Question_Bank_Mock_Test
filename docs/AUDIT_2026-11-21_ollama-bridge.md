# Ollama 403、本機轉接程式與重新連線：複查

日期：2026-11-21（Asia/Taipei）。基準 HEAD `e791868` 加未提交修改；依 `docs/REVIEW_REQUEST_2026-11-21_ollama-bridge.md`。

## 結論

**暫不同意發布本批改動。** 確認五項待修問題：一項 P1（非 loopback 網路介面也能使用轉接），四項 P2（到期未中止正在處理的請求、chunked 上傳繞過大小限制、PID 檔可停止無關 PowerShell、雲端服務的標頭能延長網站計時）。

網站測試通過不能代替產生出的 PowerShell 腳本執行安全驗證；現有腳本單元多以字串包含檢查，無法抓到上述執行行為。

本次沒有修改正式程式或題庫、未提交／推送或 stage 稽核檔。未啟動、延長、重啟或變更使用者的 Ollama 許可。隔離測試完全不向真正的 11434／11435 發請求。

## 隔離實測方式與邊界

由實際 `bridgeScript()` 產生腳本，只在本機稽核副本替換：

- upstream＝`127.0.0.1:18434` 假 HTTP 服務，非 Ollama。
- bridge＝18435（一般測試）／18437（到期測試）。
- PID 檔＝docs 下獨立 audit 檔，不用使用者的正式 TEMP PID 檔。
- 到期由最少 5 分鐘等比例縮短為 50 秒／4 秒，以測試同一計時控制流程；其他請求、listener、轉送與停止邏輯不變。

測試兩次，第二次補齊完整 DONE 與回應大小紀錄。每次 finally 停止所有自己建立的程序與假服務；最終證據 `all_spawned_stopped=true`。另確認 18434、18435、18437 的連線均回 Windows 10061（連接埠已關閉）。未變更防火牆或 Ollama 設定。沒有以另一台實體電腦連入，網路介面測試由同機連向本機 LAN／VPN 位址完成。

## F1 必修（P1）：localhost URL prefix 不等於只接受 loopback 連線

位置：`src/ai/byok/bridge.ts:76`、`:89`–`:102`。

實際：對本機三個非 loopback 的 LAN／VPN IPv4 位址連線，使用：

```http
GET /v1/models HTTP/1.1
Host: localhost:18435
Origin: https://uktwanimatorcodeps.github.io
```

三者均得到 **200**，假上游收到請求。相對地，`Host: evil.invalid:18435` 回 400。這表示 HttpListener 的 localhost prefix 提供主機名稱匹配，沒有落實程式承諾的 loopback 來源限制。

風險：若網路與防火牆允許抵達該 listener，非本機客戶端可以自行填入合法 Host／Origin 使用轉接；Origin 是瀏覽器限制，不是非瀏覽器客戶端的身分驗證。本測試不宣稱已證明 Internet 可達或任何遠端防火牆配置。

建議：在可行的實際 loopback 綁定之外，對每個請求明確驗證 RemoteEndPoint.Address 為 loopback，並驗證有效的本機 Host／port。保留 Origin 比對、路徑白名單，三者不可互相替代。加入同機 LAN IP、IPv6、錯誤 Host、缺少／錯誤 Origin 的執行測試，而非只斷言腳本含 localhost。

## F2 必修（P2）：宣告到期後仍持續轉送串流

位置：`src/ai/byok/bridge.ts:81`–`:83`、`:107`–`:120`。

實測：將測試副本期限縮短為 4 秒，假上游以 0.4 秒間隔送出 20 個 SSE 事件、最後 DONE。請求耗時 **8.07 秒**，回 200，完整 DONE 仍抵達，下游收到 1,024 bytes。整段明顯超過已附在回應標頭的到期時間。

原因：只在接受下一個請求的外層 loop 檢查期限；上傳 CopyTo、等待 GetResponse、Read／Flush 期間沒有截止中止。10 分鐘 timeout 也沒有縮到剩餘許可時間。持續收到資料時，單次讀寫 timeout 不能代替絕對截止時間。

建議：以獨立截止取消機制在到期時 abort 上游請求、關閉當前下游與 listener；上傳、等待首位元組與串流都適用。不能只在每次 Read 後檢查，否則上游靜默時仍卡住。測試到期時活躍串流、無回應、慢上傳等分支。網站自行停止接收不能取代轉接程式的許可截止。

## F3 必修（P2）：2MB 只檢查 Content-Length，chunked 可繞過

位置：`src/ai/byok/bridge.ts:103`、`:111`。

實測：

| 請求 | 結果 |
| --- | --- |
| 已知 Content-Length=2,097,153 bytes | 413，正確 |
| Transfer-Encoding: chunked，33 段×65,536＝2,162,688 bytes | 200；假上游收到完整 2,162,688 bytes |

ContentLength64 在長度未知時不會大於 2MB，接著無上限 CopyTo；因此「2MB」不是實際上傳限制。

建議：以有上限的讀取／轉送迴圈累計實際 bytes，超過 2MiB 立即停止並 abort；若不支援 chunked，可明確拒絕未知長度與該編碼。避免讓未驗證長度的資料先被 HttpWebRequest 緩衝或完整送往上游。請同時保留正常小型 JSON／串流的對照。

## F4 必修（P2）：程序名稱不能證明 PID 屬於轉接程式

位置：`src/ai/byok/bridge.ts:65`–`:72`、`:135`。

隔離重現：建立一個與轉接無關、只做 Start-Sleep 的測試 PowerShell，將它的 PID 寫入獨立 audit PID 檔，再執行僅替換 PID 檔路徑的產生版停止指令。實際 **stopped=true**，無關程序被終止。沒有對任何使用者原有程序做此測試。

原因：只核對 ProcessName 是 powershell／pwsh。舊 PID 檔在非正常關閉後可能殘留，PID 被重用時會終止其他工作；啟動時的停止舊程序邏輯也有相同風險。這不是權限提升主張，而是具體的誤殺／工作遺失風險。

建議：不要只存 PID；使用可確認擁有者／啟動時間／專屬腳本識別的 metadata，或讓已驗證身分的轉接程序自行接收停止訊號。不能任由可改寫的 PID 檔直接決定 kill。測 stale PID、重用 PID、同名非轉接程序、重複啟動以及目前 shell PID；無法確認時應拒絕停止，不先宣稱成功。

## F5 必修（P2）：轉接到期標頭被所有服務信任

位置：`src/ai/byok/client.ts:598`–`:606`、`:623`–`:626`、`:673`–`:680`；`src/ai/byok/connection.ts:138`。

實測：config 為 OpenAI 雲端 `https://api.openai.com/v1`，模擬模型清單回應帶 `X-IPAS-Bridge-Expires = now + 90 分鐘`。verifyConnection 成功後網站 expiresAt 正好採用該值，時長 **5,400,000ms**；普通非轉接連線應維持 **1,800,000ms**。

原因：trackBridge 包裝所有 OpenAI-compatible 請求，沒有檢查 config／實際 URL 是否為可信轉接位址。120＋1 分鐘的數值上限只驗證時間合理性，沒有驗證標頭來源。

建議：只在明確通過轉接位址驗證的本機服務讀取並套用標頭，connection 層也可再做防禦性限制；雲端、一般 localhost、不同 port／path 不得因此延長既定 30 分鐘。加入雲端偽標頭、一般本機偽標頭、真正轉接五分鐘、無／格式錯誤／過期／超上限標頭的對照。

## 已通過與非阻擋觀察

- 本站 Origin 的模型清單 200；其他 Origin 403；缺少 Origin 403；預檢 OPTIONS 204。
- `/api/pull` POST 404，不會轉送；一般不符 Host 的請求 400。本輪未找到直接繞過已列管理路徑白名單的案例。
- 加入假的 Authorization／Cookie 與合法 Origin 後，上游僅看到必要的 Host 等傳輸標頭；三個敏感標頭均未轉送。
- 真正轉接設定的有效五分鐘標頭可對齊倒數；不合理的遠期時間回到普通計時，既有測試通過。這不抵消 F5 的來源問題。
- 「重新連線」是真正按鈕，使用已儲存設定、只讀模型清單；三個轉接控制按鈕只複製指令。現有元件測試通過，沒有因此直接執行電腦程式。
- 本機 403 與雲端 403 的新分支符合目前測試。但所有 localhost 的 403 都斷言「不是金鑰問題」過於概括：其他自訂本機服務可有自己的驗證／權限要求。建議針對已知 Ollama 行為說明為可能來源問題，不對所有本機服務作同一斷言。
- 手動停止轉接且網站閒置時，前端沒有網路事件或背景輪詢，不能保證燈號立刻更新；下一次請求失敗才知道。到期可依既有 deadline 更新。建議文案區分「已知截止時間」與「手動停止後於下次檢查發現」，不要宣稱即時監控。
- 單執行緒可作最小版本限制，但目前長請求會阻塞重連／清單查詢；應說明 busy，並確保 F2 的 deadline 能獨立執行。HttpWebRequest 預設重新導向也應明確評估／限制，避免固定上游與路徑的假設被上游 redirect 改變；本輪未實測此項，不列已重現缺陷。
- macOS／Linux 指令本輪未實測。沒有用真實 Ollama 產生推論，也未做真實手機鍵盤／全套無障礙驗收。

## 指定檢查結果

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（新增探測後再跑） | 通過 |
| validate:content | 835 題，0 錯誤、0 警告 |
| test | 430 通過 |
| build | 通過 |
| test:e2e | 54 通過、2 選用略過 |
| 額外前端探測＋既有測試 | 433 通過；其中雲端標頭測試為確認缺陷存在的觀察型斷言，不等於驗收通過 |
| 隔離腳本實測 | 完成，五項待修的四項腳本問題皆有實測；程序全清理，三個測試 port 已關閉 |

E2E 使用 Edge、TZ=UTC、獨立本機預覽與 `/ipas-ai-prep/` 子路徑；服務由測試模擬。未重跑 Python 題庫雙引擎或逐題內容重審（此次未改題庫、指定命令亦未要求）。隔離測試使用 Python 僅作測試工具，不等同題庫 verify:python。

## 本機證據（不 stage）

- `docs/audit-bridge-generate.mjs`：由實際產生器建立隔離腳本副本。
- `docs/audit-bridge-main.ps1`、`docs/audit-bridge-expiry.ps1`、`docs/audit-bridge-stop.ps1`：只供本機測試，不發布。
- `docs/audit-bridge-runtime.py`、`docs/audit-bridge-runtime.json`、`docs/audit-bridge-runtime.log`；假服務在強制清理／斷線時的 connection reset traceback 不代表測試服務仍在執行。
- `docs/audit-bridge-main-runtime.log`、`docs/audit-bridge-expiry-runtime.log`。
- `docs/audit-bridge.config.mts`、`docs/audit-bridge.extra.test.ts`、`docs/audit-bridge-extra.log`、`docs/audit-bridge-observations.jsonl`。
- `docs/audit-bridge-typecheck.log`、`docs/audit-bridge-lint.log`、`docs/audit-bridge-final-lint.log`、`docs/audit-bridge-validate-content.log`、`docs/audit-bridge-test.log`、`docs/audit-bridge-build.log`、`docs/audit-bridge-e2e.log`。

下一步：修正 F1–F5，將腳本字串存在性測試補成實際安全行為回歸，再請複查。不要在修復前對使用者宣稱現有腳本只接受 loopback、必定到期停止所有請求，或 PID 檔只會停止轉接自己。
