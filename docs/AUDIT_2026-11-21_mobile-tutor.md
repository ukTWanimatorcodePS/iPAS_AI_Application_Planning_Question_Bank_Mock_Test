# 手機版AI導師設定：複查

日期：2026-11-21（Asia/Taipei）。基準HEAD `0ff93a9`（已發布v1.2.2）加未提交修改；依 `docs/REVIEW_REQUEST_2026-11-21_mobile-tutor.md`。

## 結論

**暫不同意發布本批手機優化。** 手機服務篩選、官方金鑰入口與雲端模型不亂選的方向合理，但確認三項P2必修：欄位未達44px、手機說明過度概括、已存本機設定仍顯示指向隱藏功能的桌機指引。

未修改正式程式或題庫、未提交／推送或stage稽核檔，未啟動、延長或變更使用者Ollama許可。瀏覽器API全部mock，僅使用假金鑰；官方連結只作公開頁面查核，沒有登入、建立金鑰或付費呼叫。

## M1 必修（P2）：44px只落到按鈕，欄位仍是40px

位置：`src/styles/index.css:612`–`:619`、`src/components/ByokSettings.tsx` 的field類別（含 `!min-h-[40px]`）。

在實際Edge渲染四種設定，皆測得：

| profile／實際viewport | 最小按鈕高 | API／模型／金鑰／下拉欄位高 | 金鑰連結高 | 記住金鑰的label高 |
| --- | --- | --- | --- | --- |
| Android UA，360×800，touch=5 | 44 | 40 | 16 | 30 |
| iPhone UA，390×844，touch=5 | 44 | 40 | 16 | 30 |
| iPad回報Mac UA，768×1024，touch=5 | 44 | 40 | 16 | 18.75 |
| Windows觸控筆電UA，1440×900，touch=10 | 44 | 40 | 16 | 18.75 |

本輪CSS在coarse pointer或窄螢幕下承諾field至少44，但實際沒有覆蓋既有40px的重要utility。新增4個實際尺寸斷言均失敗（expected ≥44，received 40），不是只看CSS檔有44這個字串就當通過。

建議：處理Tailwind層級／important優先序，或直接調整對應觸控欄位class，讓computed min-height及實際bounding box均≥44；加入rendered-browser回歸。新增的「建立金鑰」是重要操作入口，也建議改成44px的inline-flex按鈕式連結，並擴大勾選label的點擊範圍。必修核心是明確承諾的field44未生效；不把所有正文inline連結一律要求44px。

## M2 必修（P2）：手機說明把本站預設連線限制寫成軟體普遍限制

位置：`src/components/ByokSettings.tsx:419`–`:422`。

畫面目前說「本機AI只能在執行它的那台電腦上使用」「手機連不到電腦上的本機AI」「想用本機模型，請改在電腦上開啟本站」。這過度概括：手機localhost確實指向手機自己，本站預設轉接也只接受同機連線；但不能據此說所有本機模型服務永遠只能同機存取。Ollama官方也有網路及代理部署的說明。[Ollama官方FAQ](https://docs.ollama.com/faq#how-can-i-expose-ollama-on-my-network)

本站仍保留自訂位址，手機本身執行相容伺服器，或使用者已有可信且允許CORS的HTTPS服務，都不應被文字宣稱為不可能。此處不是要求新增遠端存取功能，也不是建議開放區網明文HTTP或放寬轉接安全限制。

建議文案：

> 手機的localhost指向手機本身，不會連到電腦上的Ollama或LM Studio。本站預設的本機偵測與Windows轉接只適用同一台電腦，因此這裡先提供雲端服務。若你已有手機本機的相容服務或可信HTTPS位址，可選「其他OpenAI相容服務」自行設定。

這也應同步修正程式註解中「只能在電腦上用」等敘述，避免後續維護者把UI偏好誤當能力或安全邊界。

## M3 必修（P2）：保留已存本機服務後，指引仍要求操作被隱藏的轉接面板

位置：`src/components/ByokSettings.tsx:611`（未依mobile調整LocalSetupGuide）、`src/components/LocalSetupGuide.tsx` 的Windows暫時許可步驟。

實際重現：

1. Android UA，390×844，儲存已有ollama-bridge設定（測試只寫假設定，沒有啟動服務）。
2. 開啟AI導師→設定；確認local-bridge-panel=0，自動偵測也不顯示。
3. 展開「讓本站連到Ollama（暫時許可）」。

畫面仍顯示Windows頁籤，並說「請用上方『本機暫時許可（Windows轉接程式）』：設定時間後按『啟動』…貼到PowerShell執行」。但上方功能已因mobile被隱藏。這會再次造成使用者找不到指示中的按鈕。

建議：保留已選服務避免破壞設定，但在手機情境改顯示針對該舊設定的移轉／選擇說明，或隱藏不適用的桌機指引，直接提供切換雲端／自訂的入口。不要在手機重新顯示Windows轉接來遷就舊指引，也不能自動刪除使用者設定。LM Studio已存設定也應以同樣原則測試，避免提示按已隱藏的自動偵測。

證據：`docs/audit-mobile-saved-local.png` 與observations中 `saved-local-phone` 的完整guideText。該探測期待錯誤指引仍存在，通過代表成功重現，不代表產品通過驗收。

## 六個複查重點

### 1. 手機預設不提供本機偵測

隱藏指向電腦localhost的偵測／轉接合理，不改checkEndpoint安全限制，自訂仍可選，沒有破壞已有設定。必修是M2的文字精確性及M3的舊設定指引，不要求手機直接控制電腦Ollama。

### 2. 手機／平板判斷

Android（含未寫Mobile的平板UA）、iPhone／iPad，以及Macintosh＋多點觸控的iPad方案合理；Windows觸控筆電不被當手機，實際瀏覽器及單元測試通過。一般Android折疊機仍含Android會判為mobile。

完全桌機模式若隱藏Android／Mobile並使用Linux桌機UA，現有規則無法知道它其實是手機。這是非阻擋限制：不能為了攔此情況就將所有觸控筆電視為手機；建議提供手動「手機／電腦介面」覆寫，僅影響呈現，不改來源與HTTPS檢查。所有本輪iPhone／iPad結果都是Chromium引擎下的UA／touch模擬，不是Safari或實體硬體驗證。

### 3. 官方金鑰連結

2026-11-21公開頁面查核：

| 連結 | 結果／限制 |
| --- | --- |
| `https://console.anthropic.com/settings/keys` | 導向 `https://platform.claude.com/settings/keys`，頁面有API keys／Create key；舊入口仍可用，可日後更新為官方新入口 |
| `https://platform.openai.com/api-keys` | 官方金鑰頁；公開抓取內容為動態空殼，另由官方說明確認入口 |
| `https://aistudio.google.com/apikey` | 進Google登入；官方API key文件直接指向此頁 |
| `https://openrouter.ai/keys` | 導向官方登入，return URL為workspace keys，非404 |

依據：[Claude平台金鑰頁](https://platform.claude.com/settings/keys)、[OpenAI官方說明](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)、[Google官方API key文件](https://aistudio.google.com/docs/api-key)、[OpenRouter金鑰入口](https://openrouter.ai/keys)。未登入建鑰，也不宣稱完整帳號流程均驗證。href固定，沒有把使用者金鑰附在網址；target=_blank、rel=noopener noreferrer均正確。

建議補「可能需要登入、帳戶權限或額度；費用與限制依服務官方為準」，不承諾免費、不寫死價格或暗示只要建鑰就必定可用。觸控面積見M1。

### 4. 雲端模型不自動選第一個

通過：四個實際瀏覽器profile以清單babbage-002／chat-a測試，模型輸入仍空白、下拉顯示「請選擇模型」；未選時按儲存顯示要求填模型，沒有第二次模型清單請求或問答。明確選chat-a後輸入同步。Anthropic「預設值在清單中才自動填」保留於程式分支與既有預設行為；不把未驗證的任意模型排第一當推薦。

此改動讓雲端初次設定多一步明確選擇，屬合理改善；應補模型相容性／費用說明，否則新手面對混合用途清單仍可能選到不支援對話的模型。不要僅憑模型名稱強行隱藏所有自訂別名。

### 5. 44px範圍

本次只量ByokSettings裡的按鈕與field，未將其他頁面列為本次失敗。按鈕實際44，field40是M1。AI導師標題列圖示仍是36px（不在byok-form），列下一節體驗建議，不偽稱本輪已變大。

### 6. 其他手機體驗建議（未實作）

1. 標準服務將API位址收進「進階」，自訂服務才預設展開；減少首次設定要理解的欄位。
2. 初次流程按「選服務→建立／貼上金鑰→選模型→測試」排列，手機說明縮短為兩句，詳細限制放可展開說明。
3. 建立金鑰入口改大尺寸按鈕，清楚說明會開新分頁及如何返回；保留非秘密的服務／模型草稿，但不要為了保留流程而未經選擇儲存金鑰。
4. 可提供明確操作的貼上／暫時顯示金鑰按鈕；剪貼簿讀取只能由使用者主動觸發，不在背景自動讀，讀取失敗時保留原生貼上方式。
5. 對模型清單提供搜尋與「請選支援對話、且帳戶可使用的模型」提示；有可靠能力資料才標籤，不以字母序或名稱猜測價格／用途。
6. 標題列設定、放大、收合、關閉圖示升到44px；記住金鑰的整段label也至少44px，避免誤觸與難點。
7. 實機驗證Android Chrome及iOS Safari鍵盤彈出、橫向、瀏覽器工具列變化與safe-area；檢查金鑰欄及主要按鈕可捲到，而非只用桌機resize視為完整手機驗收。
8. 手機若保留不適用的舊localhost設定，先給「這個位址指向本裝置」及切換服務入口，勿只在按儲存失敗後才顯示桌機教學。

## 測試與畫面證據

| 檢查 | 結果 |
| --- | --- |
| typecheck | 通過 |
| lint（補充探測後再跑） | 通過 |
| validate:content | 835題，0錯誤、0警告 |
| test（含Windows隔離runtime） | 463通過 |
| build | 通過 |
| 正式test:e2e | 54通過、2選用略過 |
| 新手機／平板／觸控筆電瀏覽器尺寸探測 | 4失敗，皆expected ≥44／received 40（同一M1在四個profile） |
| 舊本機設定手機指引觀察探測 | 1通過，代表重現M3 |

focused探測已在斷言前記錄全部尺寸、完成模型選擇及截圖，再保留44px失敗斷言；沒有刪除失敗測試讓它轉綠。頁面與form都沒有橫向溢出；但「不溢出」不等於觸控尺寸合格。

已目視Android360頂部、iPhone390金鑰／下拉、舊本機設定指引的實際瀏覽器畫面。沒有實體手機、WebKit、系統軟鍵盤或完整螢幕閱讀器驗證，不能宣稱所有手機情境正常。E2E使用Edge、TZ=UTC、獨立 `/ipas-ai-prep/` 子路徑預覽；沒有真實模型API呼叫或Ollama許可變更。未重跑Python題庫雙引擎或逐題語意審查。

## 本機檔案（不stage）

- `docs/audit-mobile-tutor.playwright.config.mts`、`docs/audit-mobile-tutor.browser.spec.ts`。
- `docs/audit-mobile-tutor-observations.jsonl`（重跑追加；以最後一組profile紀錄為準）。
- `docs/audit-mobile-{android-360,iphone-390,ipad-768}-{top,key}.png`、`docs/audit-mobile-windows-touch-1440-key.png`、`docs/audit-mobile-saved-local.png`。
- `docs/audit-mobile-tutor-{typecheck,lint,final-lint,validate-content,test,build,e2e}.log`。
- `docs/audit-mobile-tutor-browser.log`（初跑）、`docs/audit-mobile-tutor-browser-verified.log`（補齊畫面與模型互動後，仍保留四項尺寸失敗）。

下一步修正M1–M3再請複查。使用者額外要求的體驗建議已分開列出，沒有藉複查自行實作或擴大正式修改。
