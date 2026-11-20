/**
 * Ollama 本機轉接程式（暫時許可，使用者選擇的方案 C）。
 *
 * 為什麼需要：Ollama 預設只允許本機網頁連線，本站（GitHub Pages）的請求會被拒絕（HTTP 403）。
 * 永久設定 OLLAMA_ORIGINS 需要改系統環境變數並重新啟動 Ollama；使用者偏好短期許可。
 *
 * 做法：使用者在 PowerShell 貼上執行本檔產生的腳本，它在 localhost:11435 開一個轉接程式：
 * - 只接受這台電腦本機的連線：每個請求都檢查連線來源與本機端點是 loopback、Host 是 localhost:11435
 *   （HttpListener 的 localhost 前綴只比對主機名稱，區網／VPN 位址帶 Host: localhost 也會進來，所以要另外檢查）
 * - 只接受本站來源（Origin 完全相符），其他一律 403；只轉送 AI 導師會用到的路徑；不轉送 Cookie、Authorization、Origin
 *   （所以 Ollama 看到的是本機請求，不必改 Ollama 設定，也不必重新啟動 Ollama、不會中斷其他程式）
 * - 請求本文實際讀取最多 2 MiB（分塊上傳也一樣），超過就拒絕，不轉送
 * - 到期（5～120 分鐘）是絕對截止：上傳、等待回應、串流中都會檢查，到期立即中斷目前的請求並關閉
 * - 每個回應附上到期時間（X-IPAS-Bridge-Expires，毫秒），網站據此對齊倒數（網站只信任本轉接位址的這個標頭）
 * - 停止：在轉接程式的 PowerShell 視窗按 Ctrl+C（或關閉視窗）。網站只提供「啟動」一個按鈕（使用者決定：
 *   網頁無法直接控制本機程式，就不提供另外的停止／重新啟動指令）。
 * - 再次「啟動」時，若舊的轉接程式還在，會寫入只有它知道的停止代碼請它自己結束（不強制結束任何程式；
 *   紀錄對不上——程式已不在、PID 被其他程式重用——時只當作過期紀錄）
 *
 * 網頁無法執行電腦上的程式；網站上的按鈕只負責複製指令。
 */

export const BRIDGE_PORT = 11435;
export const BRIDGE_BASE_URL = `http://localhost:${BRIDGE_PORT}/v1`;
export const BRIDGE_EXPIRES_HEADER = 'X-IPAS-Bridge-Expires';
export const BRIDGE_MIN_MINUTES = 5;
export const BRIDGE_MAX_MINUTES = 120;
export const BRIDGE_DEFAULT_MINUTES = 30;
/** 請求本文上限（位元組） */
export const BRIDGE_MAX_BODY = 2 * 1024 * 1024;

/**
 * 這台電腦是否該用轉接程式連 Ollama：轉接程式目前只有 Windows 版。
 * Windows 上選 Ollama 或自動偵測到 Ollama，一律直接帶入「透過轉接程式」的設定（使用者要求）；
 * macOS／Linux 維持直接連線（用只對該終端機視窗有效的 OLLAMA_ORIGINS 啟動）。
 */
export function prefersBridge(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Windows NT|Win64|Win32|\bwin32\b/i.test(ua) && !/Android|iPhone|iPad|Windows Phone/i.test(ua);
}

/** 把分鐘數限制在 5～120 的整數 */
export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return BRIDGE_DEFAULT_MINUTES;
  return Math.min(BRIDGE_MAX_MINUTES, Math.max(BRIDGE_MIN_MINUTES, Math.round(n)));
}

/**
 * 是否為本站轉接程式的位址：只認 http://localhost:11435/v1（轉接程式只登記 localhost，
 * 其他寫法連不上；網站也只信任這個位址回報的到期時間）
 */
export function isBridgeUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.trim());
    return u.protocol === 'http:' && u.hostname === 'localhost' && u.port === String(BRIDGE_PORT) && u.pathname.replace(/\/+$/, '') === '/v1' && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** 請求網址是否送往轉接程式（同一個來源） */
export function isBridgeRequest(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === 'localhost' && u.port === String(BRIDGE_PORT);
  } catch {
    return false;
  }
}

/** 從轉接程式的回應讀出到期時間（毫秒）；格式不對時回傳 undefined。呼叫端須先確認回應來自轉接位址 */
export function bridgeExpiresOf(res: Pick<Response, 'headers'>): number | undefined {
  const raw = res.headers.get(BRIDGE_EXPIRES_HEADER);
  if (!raw || !/^\d{12,14}$/.test(raw.trim())) return undefined;
  const ms = Number(raw.trim());
  return Number.isSafeInteger(ms) ? ms : undefined;
}

/** PowerShell 單引號字串（' 要寫成 ''） */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 僅供自動測試：換連接埠、上游、紀錄檔位置與時長（網站產生的指令不使用） */
export interface BridgeTestOptions {
  port?: number;
  target?: string;
  /** 紀錄檔與停止檔所在資料夾（PowerShell 字串運算式，預設 $env:TEMP） */
  stateDir?: string;
  /** 以毫秒指定時長（測試到期用；忽略 minutes） */
  lifetimeMs?: number;
}

const stateDirExpr = (o?: BridgeTestOptions) => (o?.stateDir ? psQuote(o.stateDir) : '$env:TEMP');

/** 啟動：貼到 PowerShell 視窗執行；視窗保持開啟直到到期或按 Ctrl+C。舊的轉接程式若還在，會先請它自己結束 */
export function bridgeScript(origin: string, minutes: number, test?: BridgeTestOptions): string {
  const m = clampMinutes(minutes);
  const port = test?.port ?? BRIDGE_PORT;
  const lifetime = test?.lifetimeMs !== undefined ? `$expires = [DateTimeOffset]::UtcNow.AddMilliseconds(${Math.max(1, Math.round(test.lifetimeMs))})` : '$expires = [DateTimeOffset]::UtcNow.AddMinutes($Minutes)';
  return `# iPAS AI 備考室：Ollama 本機轉接程式（暫時許可 ${m} 分鐘）
# 只允許這台電腦上的 ${origin} 網頁連線；到期自動關閉；不修改 Ollama 設定，也不重新啟動 Ollama。
# 要停止：在這個視窗按 Ctrl+C（或直接關閉視窗）。
& {
$Minutes = ${m}
$Origin = ${psQuote(origin)}
$Port = ${port}
$Target = ${psQuote(test?.target ?? 'http://127.0.0.1:11434')}
$Allowed = @('/v1/models', '/v1/chat/completions', '/api/tags', '/api/version')
$MaxBody = ${BRIDGE_MAX_BODY}
$Dir = ${stateDirExpr(test)}
$StateFile = Join-Path $Dir 'ipas-ollama-bridge.json'
$StopFile = Join-Path $Dir 'ipas-ollama-bridge.stop'
$Token = [guid]::NewGuid().ToString('N')
$MyStart = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks
# 已有轉接程式在執行：請它自己結束（不強制結束任何程式；紀錄對不上就只當作過期紀錄）
$prev = $null
try { $prev = Get-Content $StateFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
if ($prev -and $prev.token -and $prev.token -ne $Token) {
  $p = Get-Process -Id ([int]$prev.pid) -ErrorAction SilentlyContinue
  if ($p -and $p.StartTime.ToUniversalTime().Ticks -eq [long]$prev.start) {
    Set-Content -Path $StopFile -Value $prev.token -NoNewline
    $waited = 0
    while ((Test-Path $StateFile) -and $waited -lt 6000) { Start-Sleep -Milliseconds 250; $waited += 250 }
    if (Test-Path $StateFile) {
      $now = $null
      try { $now = Get-Content $StateFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
      if ($now -and $now.token -eq $prev.token) { Write-Host '舊的轉接程式沒有回應，請先關閉它的 PowerShell 視窗，再重新執行。' -ForegroundColor Red; return }
    }
  }
}
Remove-Item $StopFile -ErrorAction SilentlyContinue
${lifetime}
$expiresMs = $expires.ToUnixTimeMilliseconds()
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "無法使用連接埠 $Port：$($_.Exception.Message)" -ForegroundColor Red; return }
@{ pid = $PID; start = $MyStart; token = $Token; port = $Port } | ConvertTo-Json -Compress | Set-Content -Path $StateFile
# 到期或收到這次轉接程式的停止代碼：立即結束
function Test-Stop {
  if ([DateTimeOffset]::UtcNow -ge $expires) { return $true }
  if (Test-Path $StopFile) { $t = Get-Content $StopFile -Raw -ErrorAction SilentlyContinue; if ($t -and $t.Trim() -eq $Token) { return $true } }
  return $false
}
# 等待非同步工作完成；到期或停止時回傳 $false（呼叫端中斷目前的請求）
function Wait-Task($t) {
  while (-not $t.IsCompleted) { if (Test-Stop) { return $false }; [void]$t.AsyncWaitHandle.WaitOne(250) }
  return $true
}
function Complete-Task($t) {
  if (-not (Wait-Task $t)) { throw 'ipas-bridge-deadline' }
  if ($t.IsFaulted) { throw $t.Exception.InnerException }
  if (Test-Stop) { throw 'ipas-bridge-deadline' } # 完成的同時剛好到期：仍以截止為準
}
Write-Host "轉接程式已啟動：http://localhost:$Port/v1（只允許這台電腦上的 $Origin）" -ForegroundColor Green
Write-Host "將於 $($expires.ToLocalTime().ToString('HH:mm')) 自動關閉。"
Write-Host '要停止轉接程式，請在這個視窗按 Ctrl+C（或直接關閉視窗）。' -ForegroundColor Cyan
# 預設為中性說明：按 Ctrl+C 或發生錯誤提早離開時，不會跑到下面設定原因的程式
$reason = '已中止'
try {
  while (-not (Test-Stop)) {
    $task = $listener.GetContextAsync()
    if (-not (Wait-Task $task)) { break }
    if ($task.IsFaulted) { break }
    $ctx = $task.Result
    $req = $ctx.Request
    $res = $ctx.Response
    $fwd = $null
    $upRes = $null
    $done = $false
    try {
      $res.Headers['Vary'] = 'Origin'
      # 只接受這台電腦本機的連線：區網、VPN 位址即使帶 Host: localhost 也拒絕
      $remote = $req.RemoteEndPoint.Address
      $local = $req.LocalEndPoint.Address
      if ($remote.IsIPv4MappedToIPv6) { $remote = $remote.MapToIPv4() }
      if ($local.IsIPv4MappedToIPv6) { $local = $local.MapToIPv4() }
      $hostOk = "$($req.Headers['Host'])" -eq "localhost:$Port"
      if (-not ([System.Net.IPAddress]::IsLoopback($remote) -and [System.Net.IPAddress]::IsLoopback($local) -and $hostOk)) { $res.StatusCode = 403; $res.KeepAlive = $false; $res.Close(); $done = $true; continue }
      if ($req.Headers['Origin'] -cne $Origin) { $res.StatusCode = 403; $res.KeepAlive = $false; $res.Close(); $done = $true; continue }
      $res.Headers['Access-Control-Allow-Origin'] = $Origin
      $res.Headers['Access-Control-Expose-Headers'] = '${BRIDGE_EXPIRES_HEADER}'
      $res.Headers['${BRIDGE_EXPIRES_HEADER}'] = "$expiresMs"
      if ($req.HttpMethod -eq 'OPTIONS') {
        $res.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        $res.Headers['Access-Control-Allow-Headers'] = 'content-type, authorization'
        $res.Headers['Access-Control-Allow-Private-Network'] = 'true'
        $res.Headers['Access-Control-Max-Age'] = '600'
        $res.StatusCode = 204; $res.Close(); $done = $true; continue
      }
      $path = $req.Url.AbsolutePath
      if (($Allowed -cnotcontains $path) -or ($req.HttpMethod -cnotin @('GET', 'POST'))) { $res.StatusCode = 404; $res.Close(); $done = $true; continue }
      # 請求本文：實際讀取並累計，最多 2 MiB（分塊上傳沒有長度也一樣），超過就拒絕、不轉送
      $body = $null
      if ($req.HasEntityBody) {
        if ($req.ContentLength64 -gt $MaxBody) { $res.StatusCode = 413; $res.KeepAlive = $false; $res.Close(); $done = $true; continue }
        $mem = New-Object System.IO.MemoryStream
        $chunk = New-Object byte[] 65536
        $tooBig = $false
        while ($true) {
          $rt = $req.InputStream.ReadAsync($chunk, 0, $chunk.Length); Complete-Task $rt
          $n = $rt.Result
          if ($n -le 0) { break }
          if ($mem.Length + $n -gt $MaxBody) { $tooBig = $true; break }
          $mem.Write($chunk, 0, $n)
        }
        if ($tooBig) { $res.StatusCode = 413; $res.KeepAlive = $false; $res.Close(); $done = $true; continue }
        $body = $mem.ToArray()
      }
      $left = [int][Math]::Max(1000, [Math]::Min(600000, ($expires - [DateTimeOffset]::UtcNow).TotalMilliseconds))
      $fwd = [System.Net.HttpWebRequest]::Create("$Target$path")
      $fwd.Method = $req.HttpMethod
      $fwd.AllowAutoRedirect = $false
      $fwd.AllowReadStreamBuffering = $false
      $fwd.Timeout = $left
      $fwd.ReadWriteTimeout = $left
      if ($null -ne $body) {
        $fwd.ContentType = $req.ContentType
        $fwd.ContentLength = $body.Length
        $gt = $fwd.GetRequestStreamAsync(); Complete-Task $gt
        $up = $gt.Result
        $wt = $up.WriteAsync($body, 0, $body.Length); Complete-Task $wt
        $up.Close()
      }
      $rt = $fwd.GetResponseAsync()
      if (-not (Wait-Task $rt)) { throw 'ipas-bridge-deadline' }
      $upRes = $null
      if ($rt.IsFaulted) {
        $we = $rt.Exception.InnerException
        if ($we -is [System.Net.WebException] -and $we.Response) { $upRes = $we.Response } else { $res.StatusCode = 502; $res.Close(); $done = $true; continue }
      } else { $upRes = $rt.Result }
      $res.StatusCode = [int]$upRes.StatusCode
      if ($upRes.ContentType) { $res.ContentType = $upRes.ContentType }
      $res.SendChunked = $true
      $in = $upRes.GetResponseStream(); $out = $res.OutputStream
      $buf = New-Object byte[] 8192
      while ($true) {
        $r = $in.ReadAsync($buf, 0, $buf.Length); Complete-Task $r
        $n = $r.Result
        if ($n -le 0) { break }
        $w = $out.WriteAsync($buf, 0, $n); Complete-Task $w
        $f = $out.FlushAsync(); Complete-Task $f
      }
      $in.Close(); $upRes.Close(); $res.Close()
      $done = $true
    } catch {
      # 錯誤、到期或停止：交給下面的 finally 中斷
    } finally {
      # 一定會執行（包含按 Ctrl+C 中止）：這個請求沒有正常完成時，取消送往 Ollama 的請求並中斷目前的回應，
      # 避免 PowerShell 視窗還開著時，Ollama 仍在背後繼續產生回答
      if (-not $done) {
        try { if ($fwd) { $fwd.Abort() } } catch {}
        try { if ($upRes) { $upRes.Close() } } catch {}
        try { $res.Abort() } catch {}
      }
    }
  }
  $reason = if ([DateTimeOffset]::UtcNow -ge $expires) { '許可時間已到' } else { '已收到停止指令' }
} finally {
  try { $listener.Stop(); $listener.Close() } catch {}
  $cur = $null
  try { $cur = Get-Content $StateFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
  if ($cur -and $cur.token -eq $Token) { Remove-Item $StateFile -ErrorAction SilentlyContinue }
  $t = Get-Content $StopFile -Raw -ErrorAction SilentlyContinue
  if ($t -and $t.Trim() -eq $Token) { Remove-Item $StopFile -ErrorAction SilentlyContinue }
  Write-Host "轉接程式已關閉（$reason），本站已無法連到本機 Ollama。" -ForegroundColor Yellow
}
}
`;
}

