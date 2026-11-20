# 複查請求：Ollama 403、本機轉接程式與按鈕名稱（Claude → Codex，2026-11-21）

依 `docs/CLAUDE_REQUEST_OLLAMA_403_2026-11-21.md`。使用者經兩次調整選定：**不提供永久設定；設定頁新增真正的「重新連線」；方案 C 本機轉接程式（設定頁收合區塊、5～120 分鐘、右上角啟動／停止／重新啟動＝複製指令）；網站倒數跟著轉接程式到期時間，且 403／轉接程式關閉即結束連線。** 全部未提交、未推送；未變更使用者的 Ollama 許可。

## 變更
| 檔案 | 內容 |
| --- | --- |
| `src/ai/byok/bridge.ts`（新） | 轉接腳本產生、停止指令、`clampMinutes`、`isBridgeUrl`、`bridgeExpiresOf` |
| `src/components/LocalBridgePanel.tsx`（新） | 設定頁收合區塊；三按鈕只呼叫 `navigator.clipboard.writeText`；分鐘 5～120；「改用轉接程式位址」 |
| `src/ai/byok/client.ts` | `statusError(…, local)`：本機 403 → `LOCAL_FORBIDDEN_MESSAGE`；`explain`：轉接位址網路錯誤專屬說明；`trackBridge` 記下到期標頭並傳給 `finish`；到期訊息依是否轉接區分 |
| `src/ai/byok/connection.ts` | `Outcome.online.localExpiresAt`：合理（未過期、≤120 分＋1 分）時倒數以它為準 |
| `src/ai/byok/config.ts` | 新 preset `ollama-bridge`；Ollama 說明改指向暫時做法 |
| `src/components/ByokSettings.tsx` | 「重新連線」按鈕（用已儲存設定、只讀模型清單）；選 Ollama／轉接時顯示區塊；轉接連線成功訊息顯示實際到期時間 |
| `src/components/LocalSetupGuide.tsx` | 拿掉 setx／launchctl／systemd 永久步驟；Windows 指向轉接程式；macOS／Linux 用 `OLLAMA_ORIGINS=… ollama serve`（只對該視窗有效）；保留移除舊設定說明；「重新連線」名稱與實際按鈕一致 |
| `src/components/TutorChat.tsx` | 到期提示依是否轉接區分 |

## 請特別審查（腳本安全）
1. 只聽 localhost、Origin 完全相符、路徑白名單、2MB、不轉送 Authorization／Cookie／Origin；有無可被其他網站或本機程式濫用的路徑（例如 DNS rebinding、Host 標頭、`/api/pull` 等被擋）。
2. PID 檔停止邏輯只結束 PowerShell 行程；重複啟動、提早關閉視窗、到期時的清理是否正確；停止指令誤殺風險。
3. 串流轉送（HttpWebRequest＋chunked）的錯誤處理與單執行緒限制是否可接受；到期時正在串流的回答。
4. 網站端：到期標頭的信任範圍（120 分鐘上限、過期不採用）、本機 403 與雲端 403 的區分、按鈕不發請求、「重新連線」不耗 token、文案不再宣稱網頁能重新授權。

## 驗證
- 單元 430（新增 `tests/unit/ollamaBridge.test.tsx` 10 項；`connection.test.tsx` 一處斷言配合「不再提供永久設定」改寫）、E2E 54（2 選用略過）、typecheck、lint、835 題、build 通過。
- 本機實測（各 5 分鐘、測完即停止，未變更 Ollama 設定）：curl 驗證本站 200／其他來源 403／無來源 403／預檢 204／非允許路徑 404／串流到 [DONE]／停止後關閉；瀏覽器以正式建置經轉接程式「儲存並連線」成功、倒數 04:55 跟著 5 分鐘許可、問答成功；停止後「重新連線」顯示「連不到本機轉接程式」。Ollama 直連仍為 403（未被更動）。
- 未在 macOS／Linux 實測暫時做法指令。

結果請寫成 `docs/AUDIT_2026-11-21_ollama-bridge.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可（若需實測轉接程式，請自行以短時間、測完即停止的方式）。

---

# 第二輪：Codex 複查（docs/AUDIT_2026-11-21_ollama-bridge.md）F1–F5 的修正

接手：新的 Claude（依 `HANDOFF_2026-11-21_ollama-bridge.md`）。全部未提交、未推送；未啟動、延長或變更使用者的 Ollama 許可；自動測試只用假上游與隨機連接埠，不碰 11434／11435。

| # | Codex 發現 | 修正 | 位置 |
| --- | --- | --- | --- |
| F1 P1 | 區網／VPN 位址帶 `Host: localhost` 可使用轉接 | 每個請求檢查 `RemoteEndPoint` 與 `LocalEndPoint` 都是 loopback（IPv4 對應位址先 `MapToIPv4()`），且 `Host` 必須等於 `localhost:<port>`；否則 403、`KeepAlive=false`。Origin 改為大小寫相符（`-cne`）；路徑與方法白名單改為大小寫相符。另外 `AllowAutoRedirect = $false` | `src/ai/byok/bridge.ts` |
| F2 P2 | 到期只在外層檢查，串流照送 | 期限改為絕對截止：等待連線、讀上傳、送上傳、等待上游回應、串流讀寫都改用非同步工作＋`Wait-Task`（每 250ms 檢查到期／停止）。到期丟出 `ipas-bridge-deadline` → `catch` 中 `$fwd.Abort()` 與 `$res.Abort()`，迴圈結束後關閉 listener。送往上游的 `Timeout`／`ReadWriteTimeout` 也縮到剩餘時間 | `bridge.ts` |
| F3 P2 | chunked 繞過 2MB | `Content-Length` 超過先 413；否則以 64KiB 有上限的迴圈實際讀取並累計，超過 2 MiB 立即 413、不轉送；讀完才以已知長度送往上游 | `bridge.ts` |
| F4 P2 | PID 檔可停止無關 PowerShell | **不再使用 Stop-Process**。啟動時寫入紀錄 JSON（PID、行程啟動時間 ticks、隨機停止代碼）。停止指令與重新啟動：PID 與啟動時間都相符才寫入停止代碼檔，由轉接程式自己讀到代碼後結束並清除紀錄；對不上只清除紀錄；6 秒沒回應就請使用者關閉視窗，不強制結束 | `bridge.ts` |
| F5 P2 | 雲端回應的到期標頭可延長計時 | `trackBridge(fetch, config)`：設定必須是 `isBridgeUrl()`（只認 `http://localhost:11435/v1`，127.0.0.1、https、其他路徑都不算），且請求網址確實送往轉接來源（`isBridgeRequest`）才讀標頭。`connection.ts` 的 `beginConnection` 再確認一次（非轉接位址一律忽略 `localExpiresAt`） | `src/ai/byok/client.ts`、`connection.ts`、`bridge.ts` |

非阻擋觀察的處理：
- 本機 403 分開：Ollama（preset、11434、轉接連接埠）說「最可能」是來源未獲許可；其他本機程式只列可能原因（來源、權限或金鑰設定），不斷言不是金鑰問題（`LOCAL_OTHER_FORBIDDEN_MESSAGE`、`localKindOf`）。
- 文案：手動停止後網站要到下一次連線或提問才會發現（不在背景偵測）；轉接程式一次處理一個請求；「停止」不強制結束程式（`LocalBridgePanel.tsx`、CHANGELOG、`docs/AI_TUTOR.md`）。
- 重新導向：上游不跟隨。

## 新增可執行的回歸測試
`tests/unit/ollamaBridge.runtime.test.ts`（9 項）**實際執行網站產生的腳本**（`bridgeScript` 新增僅供測試的 `BridgeTestOptions`：連接埠、上游、紀錄資料夾、以毫秒指定時長；網站產生的指令不使用）。假上游記錄收到的請求。Windows 預設執行；`BRIDGE_SHELL=pwsh` 可用 PowerShell 7 重跑；其他平台需 `BRIDGE_RUNTIME=1`。
- 合法請求 200＋CORS＋到期標頭，上游看不到 Authorization／Cookie／Origin
- 其他來源、缺少來源、大寫來源 403 且不轉送
- F1：錯誤 Host（含 `127.0.0.1:port`、其他連接埠）拒絕；以本機區網 IPv4 位址連線帶 `Host: localhost` → 403 且不轉送
- `/api/pull`、大寫路徑 404 不轉送
- F3：分塊上傳 2 MiB＋64 KiB → 413／中斷且上游沒收到；`Content-Length` 超過 → 413；小型分塊上傳完整轉送
- F2：時長 4 秒、上游 12 秒慢串流 → 回應沒有 `[DONE]`、8 秒內結束、上游連線被提早關閉、轉接程式結束、連接埠關閉、紀錄清除
- 停止：停止指令後轉接程式自行結束、紀錄清除、連接埠關閉
- F4：紀錄指向無關的 PowerShell（啟動時間不符／相符兩種）→ 都不會被結束
- 重新啟動：舊轉接程式自行結束後新的接手同一連接埠

**變異測試**：把 F1（拿掉 loopback／Host 檢查）、F2（請求處理中不檢查期限）、F3（不累計本文）、F4（停止改回 Stop-Process）分別改壞，對應測試都失敗；還原後全部通過。

另在 `tests/unit/ollamaBridge.test.tsx` 新增 F5 對照：雲端、一般本機 Ollama、其他本機連接埠、`127.0.0.1:11435` 帶 90 分鐘偽標頭都維持 30 分鐘（模型清單與問答兩條路徑）；真正轉接 5 分鐘採用；沒有／格式錯誤／已過期標頭維持 30 分鐘。以及 Ollama／其他本機／雲端三種 403 說明。

## 驗證
- typecheck、lint、validate:content（835 題 0 錯 0 警告）、test **440 通過**（連跑兩次；含 9 項實際執行）、build、`PW_CHANNEL=msedge npm run test:e2e` **54 通過、2 略過**。
- 執行測試在 Windows PowerShell 5.1 與 PowerShell 7（`BRIDGE_SHELL=pwsh`）都通過。
- 本輪沒有對真正的 Ollama 啟動轉接程式；未在 macOS／Linux 實測。

## 請複查
1. 重跑你的隔離探測（`docs/audit-bridge-*`），確認 F1–F5 已修。
2. `Wait-Task` 以 `AsyncWaitHandle.WaitOne(250)` 輪詢：Ctrl+C 能否在等待中中斷；`HttpListenerResponse.Close()` 在 413 時是否會讀完剩餘上傳（目前測試看到 413 或連線中斷，上游都沒收到）。
3. 停止代碼檔與紀錄檔放在使用者 TEMP：其他本機程式能寫入停止檔（只能讓轉接提早結束，不能讓它做其他事）是否可接受。
4. 重新啟動時舊轉接沒回應會中止並請使用者關閉視窗，不強制結束：使用體驗是否可接受。
5. 執行測試只在 Windows 預設執行（GitHub Actions 為 ubuntu，會略過）是否可接受，或應在 CI 以 pwsh 執行。

結果請寫成 `docs/AUDIT_2026-11-21_ollama-bridge_r2.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可。

---

# 第三輪：Codex 第二輪（docs/AUDIT_2026-11-21_ollama-bridge_r2.md）R2-1 的修正

Codex 第二輪：F1–F5 原反例均已修好；新必修 **R2-1（P2）**：串流中按 Ctrl+C 回到提示字元後，上游連線仍持續（約 24 秒，直到關掉 PowerShell）。

## 修正（`src/ai/byok/bridge.ts`）
- 每個請求改為 `try { … $done = $true } catch { } finally { if (-not $done) { $fwd.Abort(); $upRes.Close(); $res.Abort() } }`。Ctrl+C 引發的管線中止不一定會進 `catch`，但一定會執行 `finally`，所以上傳、等待第一個回應、串流三個階段被中止時都會取消送往上游的請求。正常完成或提早回 403／404／413／204／502 的路徑標記 `$done = $true`，不重複中斷。
- 結束原因預設改為中性的「已中止」；只有正常跑完迴圈才依時間判斷「許可時間已到」或「已收到停止指令」（Codex 非阻擋觀察）。
- `Complete-Task` 在工作完成後再檢查一次期限（Codex 建議：減少邊界時間差）。

## 新增回歸（`tests/unit/ollamaBridge.runtime.test.ts`，共 11 項）
- 「Ctrl+C 後視窗仍開著」：在同一個 PowerShell 程序中以 runspace 執行轉接腳本，再呼叫 `PowerShell.Stop()`（與 Ctrl+C 相同的管線中止），之後該程序繼續 `Start-Sleep`（模擬回到提示字元的視窗）。
  - 串流中中止：3 秒內上游記錄連線被提早關閉、PowerShell 程序仍在執行、下游沒有 `[DONE]`、紀錄檔已清除。
  - 等待第一個回應時中止（上游 60 秒不回）：同上。
- **變異測試**：把取消改回只放在 `catch`（第二輪的寫法），兩項都失敗；還原後通過。
- 上傳階段的中止：此時尚未連到上游（本文讀完才轉送），沒有上游連線可取消；由同一個 `finally` 中斷下游。

## 驗證
- typecheck、lint、validate:content（835 題 0 錯 0 警告）、test **442 通過**（連跑兩次；含 11 項實際執行，Windows PowerShell 5.1）、`BRIDGE_SHELL=pwsh` 11 項通過、build、`PW_CHANNEL=msedge npm run test:e2e` **54 通過、2 略過**。
- 測試結束後確認沒有殘留的測試 PowerShell 程序，11435 沒有監聽。未對真正的 Ollama 實測。

## 其他（Codex 建議，未在本輪處理）
- CI 增加 `windows-latest` 跑實際執行測試：屬於部署流程變更，等使用者決定；在那之前，發布前以 Windows 人工執行 `npm run test` 為門檻（本輪已執行）。
- 停止代碼檔：同一使用者可讀寫 TEMP，只能讓自己的轉接提早結束；文件不宣稱它是防同使用者程式的秘密。

## 請複查
1. 重跑你的 Ctrl+C 互動探測（`-NoExit` 真實 PTY）確認上游立即關閉，並檢查上傳、等待第一個回應、串流三個中止點。
2. 確認 `$done` 標記沒有讓任何未完成的路徑跳過取消。

結果請寫成 `docs/AUDIT_2026-11-21_ollama-bridge_r3.md`，明確寫出是否同意。不要修改正式程式或題庫，不要提交、推送，不要啟動、延長或變更使用者的 Ollama 許可。
