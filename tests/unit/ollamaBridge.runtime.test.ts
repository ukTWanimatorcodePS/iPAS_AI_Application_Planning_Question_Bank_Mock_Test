/**
 * 實際執行網站產生的轉接程式腳本（不是只檢查字串），驗證安全行為（Codex 複查 F1–F4）。
 *
 * - 上游是本測試啟動的假 HTTP 服務（不是 Ollama），轉接程式、紀錄檔都用隨機連接埠與暫存資料夾，
 *   不碰使用者真正的 11434／11435，也不讀寫使用者 TEMP 下的紀錄檔。
 * - 只在 Windows 預設執行（轉接程式目前只提供 Windows 版）；其他平台設定 BRIDGE_RUNTIME=1 且有 pwsh 時才跑。
 * - 每個測試結束都停止自己啟動的程式。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRIDGE_EXPIRES_HEADER, BRIDGE_MAX_BODY, bridgeScript } from '../../src/ai/byok/bridge';

// BRIDGE_SHELL 可指定 pwsh（PowerShell 7）重跑同一組測試
const SHELL = process.env.BRIDGE_SHELL || (process.platform === 'win32' ? 'powershell.exe' : process.env.BRIDGE_RUNTIME ? 'pwsh' : '');
const available = !!SHELL && spawnSync(SHELL, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const ORIGIN = 'http://localhost:4174';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** 假上游：記錄收到的請求；/v1/chat/completions 可設定為慢速串流 */
interface Seen {
  path: string;
  headers: http.IncomingHttpHeaders;
  bytes: number;
  closedEarly?: boolean;
}
function fakeUpstream(stream: { events: number; gapMs: number; headerDelayMs?: number }) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const rec: Seen = { path: req.url ?? '', headers: req.headers, bytes: 0 };
    seen.push(rec);
    req.on('data', (c: Buffer) => (rec.bytes += c.length));
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        res.on('close', () => {
          if (!res.writableEnded) rec.closedEarly = true;
        });
        // headerDelayMs：模擬模型載入中，遲遲沒有回應（測試「等待第一個回應」時中止）
        if (stream.headerDelayMs) {
          const wait = setTimeout(() => !res.destroyed && res.end(), stream.headerDelayMs);
          res.on('close', () => clearTimeout(wait));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let i = 0;
        const timer = setInterval(() => {
          if (i < stream.events) res.write(`data: {"choices":[{"delta":{"content":"${i++}"}}]}\n\n`);
          else {
            clearInterval(timer);
            res.end('data: [DONE]\n\n');
          }
        }, stream.gapMs);
        res.on('close', () => clearInterval(timer));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return {
    seen,
    start: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port))),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

interface Bridge {
  port: number;
  dir: string;
  proc: ChildProcess;
  out: () => string;
}
const dirs: string[] = [];
const procs: ChildProcess[] = [];

/** 寫成 UTF-8（含 BOM，Windows PowerShell 5.1 才會正確讀中文）並執行 */
function runPs(file: string, content: string): ChildProcess {
  writeFileSync(file, '\uFEFF' + content, 'utf8');
  const p = spawn(SHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  return p;
}
async function runPsToEnd(file: string, content: string): Promise<{ code: number | null; out: string }> {
  const p = runPs(file, content);
  let out = '';
  p.stdout?.on('data', (d) => (out += d));
  p.stderr?.on('data', (d) => (out += d));
  const code = await new Promise<number | null>((r) => p.on('exit', r));
  return { code, out };
}

async function startBridge(target: string, opts: { lifetimeMs?: number; port?: number; dir?: string } = {}): Promise<Bridge> {
  const port = opts.port ?? (await freePort());
  const dir = opts.dir ?? mkdtempSync(path.join(os.tmpdir(), 'ipas-bridge-test-'));
  if (!opts.dir) dirs.push(dir);
  const script = bridgeScript(ORIGIN, 5, { port, target, stateDir: dir, lifetimeMs: opts.lifetimeMs ?? 120_000 });
  const proc = runPs(path.join(dir, `bridge-${Date.now()}.ps1`), script);
  let out = '';
  proc.stdout?.on('data', (d) => (out += d));
  proc.stderr?.on('data', (d) => (out += d));
  const state = path.join(dir, 'ipas-ollama-bridge.json');
  for (let i = 0; i < 80; i++) {
    if (existsSync(state)) {
      try {
        if (JSON.parse(readFileSync(state, 'utf8').replace(/^\uFEFF/, '')).port === port) break;
      } catch {
        // 寫入中
      }
    }
    if (proc.exitCode !== null) throw new Error(`轉接程式沒有啟動：${out}`);
    await sleep(250);
  }
  return { port, dir, proc, out: () => out };
}

interface Reply {
  status?: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  error?: string;
  ms: number;
}
/** 送出請求；可指定連線的 IP（測試區網位址）與 Host、Origin、本文、分塊上傳 */
function request(o: { port: number; ip?: string; path?: string; method?: string; host?: string; origin?: string | null; body?: Buffer; chunked?: Buffer[]; headers?: Record<string, string> }): Promise<Reply> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const headers: Record<string, string> = { host: o.host ?? `localhost:${o.port}`, ...(o.headers ?? {}) };
    if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
    if (o.body) headers['content-length'] = String(o.body.length);
    if (o.body || o.chunked) headers['content-type'] = 'application/json';
    const req = http.request({ host: o.ip ?? '127.0.0.1', port: o.port, path: o.path ?? '/v1/models', method: o.method ?? (o.body || o.chunked ? 'POST' : 'GET'), headers, agent: false });
    let done = false;
    const finish = (r: Omit<Reply, 'ms'>) => {
      if (!done) {
        done = true;
        resolve({ ...r, ms: Date.now() - t0 });
      }
    };
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', (e) => finish({ status: res.statusCode, headers: res.headers, body, error: e.message }));
      res.on('aborted', () => finish({ status: res.statusCode, headers: res.headers, body, error: 'aborted' }));
    });
    req.on('error', (e) => finish({ headers: {}, body: '', error: e.message }));
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
    if (o.body) req.end(o.body);
    else if (o.chunked) {
      (async () => {
        for (const c of o.chunked!) {
          if (req.destroyed || done) return;
          req.write(c);
          await sleep(5);
        }
        req.end();
      })();
    } else req.end();
  });
}

const lanIPv4 = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 測試清理用：寫入紀錄中的停止代碼（與「再次啟動」請舊轉接程式結束的方式相同），由轉接程式自己結束。
 * 網站不再提供停止指令；使用者是在視窗按 Ctrl+C（見 R2-1 的 Ctrl+C 測試）。
 */
async function requestStop(b: Bridge): Promise<void> {
  const state = path.join(b.dir, 'ipas-ollama-bridge.json');
  try {
    const st = JSON.parse(readFileSync(state, 'utf8').replace(/^\uFEFF/, '')) as { token: string };
    writeFileSync(path.join(b.dir, 'ipas-ollama-bridge.stop'), st.token);
  } catch {
    // 已經結束
  }
  for (let i = 0; i < 24 && b.proc.exitCode === null; i++) await sleep(250);
}

afterAll(() => {
  for (const p of procs) if (p.exitCode === null) p.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!available)('轉接程式實際執行（假上游、隨機連接埠）', () => {
  const up = fakeUpstream({ events: 3, gapMs: 20 });
  let upPort = 0;
  let b: Bridge;
  const chatCount = () => up.seen.filter((s) => s.path === '/v1/chat/completions').length;

  beforeAll(async () => {
    upPort = await up.start();
    b = await startBridge(`http://127.0.0.1:${upPort}`);
  }, 30_000);
  afterAll(async () => {
    await requestStop(b);
    await up.stop();
  }, 30_000);

  it('本站來源：200、附 CORS 與到期標頭；不轉送 Authorization、Cookie、Origin', async () => {
    const r = await request({ port: b.port, headers: { authorization: 'Bearer FAKE-TEST', cookie: 'a=b' } });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(Number(r.headers[BRIDGE_EXPIRES_HEADER.toLowerCase()])).toBeGreaterThan(Date.now());
    const last = up.seen.at(-1)!;
    expect(last.path).toBe('/v1/models');
    expect(last.headers.authorization).toBeUndefined();
    expect(last.headers.cookie).toBeUndefined();
    expect(last.headers.origin).toBeUndefined();
  });

  it('其他來源、缺少來源、大小寫不同的來源：403，不轉送', async () => {
    const n = up.seen.length;
    for (const origin of ['https://evil.example', null, ORIGIN.toUpperCase()]) expect((await request({ port: b.port, origin })).status).toBe(403);
    expect(up.seen.length).toBe(n);
  });

  it('F1：Host 不是 localhost:連接埠 → 拒絕；以區網位址連線（即使帶 Host: localhost）→ 拒絕，不轉送', async () => {
    const n = up.seen.length;
    for (const host of ['evil.invalid', `127.0.0.1:${b.port}`, `localhost:${b.port + 1}`]) {
      const r = await request({ port: b.port, host });
      expect(r.status === undefined || r.status >= 400).toBe(true);
    }
    if (lanIPv4) {
      const r = await request({ port: b.port, ip: lanIPv4, host: `localhost:${b.port}` });
      // Windows 的 HttpListener 會收下區網連線，由轉接程式回 403；其他平台可能根本連不上。兩種都不能轉送
      expect(r.status === undefined || r.status === 403).toBe(true);
    }
    expect(up.seen.length).toBe(n);
  });

  it('只轉送允許的路徑：/api/pull 等 404，不轉送', async () => {
    const n = up.seen.length;
    expect((await request({ port: b.port, path: '/api/pull', body: Buffer.from('{}') })).status).toBe(404);
    expect((await request({ port: b.port, path: '/V1/MODELS' })).status).toBe(404);
    expect(up.seen.length).toBe(n);
  });

  it('F3：分塊上傳超過 2 MiB → 拒絕且不轉送；Content-Length 超過 → 413；小型分塊上傳照常轉送', async () => {
    const n = chatCount();
    const big = Array.from({ length: Math.ceil((BRIDGE_MAX_BODY + 65_536) / 65_536) }, () => Buffer.alloc(65_536, 0x20));
    const r1 = await request({ port: b.port, path: '/v1/chat/completions', chunked: big });
    expect(r1.status === 413 || r1.status === undefined).toBe(true);
    const r2 = await request({ port: b.port, path: '/v1/chat/completions', body: Buffer.alloc(BRIDGE_MAX_BODY + 1, 0x20) });
    expect(r2.status === 413 || r2.status === undefined).toBe(true);
    expect(chatCount()).toBe(n);
    const ok = await request({ port: b.port, path: '/v1/chat/completions', chunked: [Buffer.from('{"model":"m",'), Buffer.from('"messages":[]}')] });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('[DONE]');
    expect(up.seen.at(-1)!.bytes).toBe('{"model":"m","messages":[]}'.length);
  });
});

/**
 * 模擬使用者按 Ctrl+C：在同一個 PowerShell 程序裡用 runspace 執行轉接腳本，再呼叫 Stop()
 * （與 Ctrl+C 相同，會在腳本中引發管線中止）；PowerShell 程序本身保持開著，就像回到提示字元的視窗。
 */
async function startBridgeInRunspace(target: string): Promise<Bridge & { trigger: string; stoppedFlag: string }> {
  const port = await freePort();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ipas-bridge-test-'));
  dirs.push(dir);
  const scriptFile = path.join(dir, 'bridge.ps1');
  writeFileSync(scriptFile, '\uFEFF' + bridgeScript(ORIGIN, 5, { port, target, stateDir: dir, lifetimeMs: 120_000 }), 'utf8');
  const trigger = path.join(dir, 'ctrl-c');
  const stoppedFlag = path.join(dir, 'stopped');
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  const harness = [
    `$code = Get-Content -Raw -Encoding UTF8 ${q(scriptFile)}`,
    '$ps = [powershell]::Create()',
    '[void]$ps.AddScript($code)',
    '$h = $ps.BeginInvoke()',
    `while (-not (Test-Path ${q(trigger)})) { Start-Sleep -Milliseconds 100 }`,
    '$ps.Stop()',
    `Set-Content -Path ${q(stoppedFlag)} -Value 'x'`,
    'Start-Sleep -Seconds 60',
  ].join('\n');
  const proc = runPs(path.join(dir, 'harness.ps1'), harness);
  let out = '';
  proc.stdout?.on('data', (d) => (out += d));
  proc.stderr?.on('data', (d) => (out += d));
  const state = path.join(dir, 'ipas-ollama-bridge.json');
  for (let i = 0; i < 80 && !existsSync(state); i++) {
    if (proc.exitCode !== null) throw new Error(`轉接程式沒有啟動：${out}`);
    await sleep(250);
  }
  return { port, dir, proc, out: () => out, trigger, stoppedFlag };
}

describe.skipIf(!available)('Codex 第二輪 R2-1：按 Ctrl+C 中止後（視窗仍開著）一定取消送往上游的請求', () => {
  for (const phase of ['串流中', '等待第一個回應時'] as const) {
    it(`${phase}按 Ctrl+C：上游連線立即被關閉，不必等關掉 PowerShell`, async () => {
      const up = fakeUpstream(phase === '串流中' ? { events: 200, gapMs: 200 } : { events: 1, gapMs: 10, headerDelayMs: 60_000 });
      const upPort = await up.start();
      try {
        const b = await startBridgeInRunspace(`http://127.0.0.1:${upPort}`);
        const pending = request({ port: b.port, path: '/v1/chat/completions', body: Buffer.from('{"model":"m","messages":[]}') });
        for (let i = 0; i < 40 && !up.seen.some((x) => x.path === '/v1/chat/completions'); i++) await sleep(100);
        await sleep(800); // 串流已在進行／上游正在處理
        expect(up.seen.find((x) => x.path === '/v1/chat/completions')?.closedEarly).toBeUndefined();
        writeFileSync(b.trigger, 'x');
        for (let i = 0; i < 40 && !existsSync(b.stoppedFlag); i++) await sleep(100);
        expect(existsSync(b.stoppedFlag)).toBe(true);
        // 3 秒內上游就被關閉，而 PowerShell 程序仍在執行（模擬回到提示字元的視窗）
        for (let i = 0; i < 30 && !up.seen.find((x) => x.path === '/v1/chat/completions')?.closedEarly; i++) await sleep(100);
        expect(up.seen.find((x) => x.path === '/v1/chat/completions')?.closedEarly).toBe(true);
        expect(b.proc.exitCode).toBeNull();
        const r = await pending;
        expect(r.body).not.toContain('[DONE]');
        expect(existsSync(path.join(b.dir, 'ipas-ollama-bridge.json'))).toBe(false);
        b.proc.kill();
      } finally {
        await up.stop();
      }
    }, 40_000);
  }
});

describe.skipIf(!available)('轉接程式到期與停止（實際執行）', () => {
  it('F2：到期時中斷進行中的串流（不送完）、中斷送往上游的請求，並關閉', async () => {
    const up = fakeUpstream({ events: 40, gapMs: 300 }); // 完整送完需 12 秒
    const upPort = await up.start();
    try {
      const b = await startBridge(`http://127.0.0.1:${upPort}`, { lifetimeMs: 4_000 });
      const r = await request({ port: b.port, path: '/v1/chat/completions', body: Buffer.from('{"model":"m","messages":[]}') });
      expect(r.body).not.toContain('[DONE]');
      expect(r.ms).toBeLessThan(8_000);
      await sleep(500);
      expect(up.seen.find((s) => s.path === '/v1/chat/completions')?.closedEarly).toBe(true);
      // 轉接程式已關閉：連接埠不再接受連線，紀錄已清除
      for (let i = 0; i < 20 && b.proc.exitCode === null; i++) await sleep(250);
      expect(b.proc.exitCode).not.toBeNull();
      expect((await request({ port: b.port })).error).toBeDefined();
      expect(existsSync(path.join(b.dir, 'ipas-ollama-bridge.json'))).toBe(false);
    } finally {
      await up.stop();
    }
  }, 30_000);

  it('停止代碼：只有紀錄中的代碼能讓轉接程式自己結束並清除紀錄；其他內容沒有作用', async () => {
    const up = fakeUpstream({ events: 1, gapMs: 10 });
    const upPort = await up.start();
    try {
      const b = await startBridge(`http://127.0.0.1:${upPort}`);
      writeFileSync(path.join(b.dir, 'ipas-ollama-bridge.stop'), 'not-the-token');
      await sleep(1500);
      expect(b.proc.exitCode).toBeNull();
      expect((await request({ port: b.port })).status).toBe(200);
      await requestStop(b);
      expect(b.proc.exitCode).not.toBeNull();
      expect(existsSync(path.join(b.dir, 'ipas-ollama-bridge.json'))).toBe(false);
      expect((await request({ port: b.port })).error).toBeDefined();
    } finally {
      await up.stop();
    }
  }, 30_000);

  it('F4：再次啟動時，紀錄指向無關的 PowerShell（啟動時間不符或相符）都不會結束它', async () => {
    const up = fakeUpstream({ events: 1, gapMs: 10 });
    const upPort = await up.start();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ipas-bridge-test-'));
    dirs.push(dir);
    const victim = runPs(path.join(dir, 'victim.ps1'), 'Start-Sleep -Seconds 60');
    try {
      await sleep(1500);
      const state = path.join(dir, 'ipas-ollama-bridge.json');
      // 1) 啟動時間不符（例如 PID 被重用）：當作過期紀錄，新的轉接程式照常啟動
      writeFileSync(state, JSON.stringify({ pid: victim.pid, start: 1, token: 'stale', port: 1 }));
      const b = await startBridge(`http://127.0.0.1:${upPort}`, { dir });
      expect(alive(victim.pid!)).toBe(true);
      expect((await request({ port: b.port })).status).toBe(200);
      await requestStop(b);
      // 2) PID 與啟動時間都相符，但它不是轉接程式（不會讀停止代碼）：新的轉接程式等待後放棄啟動，仍不結束它
      await runPsToEnd(
        path.join(dir, 'forge.ps1'),
        `$p = Get-Process -Id ${victim.pid}; @{ pid = $p.Id; start = $p.StartTime.ToUniversalTime().Ticks; token = 'forged'; port = 1 } | ConvertTo-Json -Compress | Set-Content -Path '${state.replace(/'/g, "''")}'`,
      );
      const port = await freePort();
      const second = await runPsToEnd(path.join(dir, 'second.ps1'), bridgeScript(ORIGIN, 5, { port, target: `http://127.0.0.1:${upPort}`, stateDir: dir, lifetimeMs: 60_000 }));
      expect(second.code).not.toBeNull();
      expect(alive(victim.pid!)).toBe(true);
      expect((await request({ port })).error).toBeDefined(); // 沒有接手、沒有開始轉接
      expect(JSON.parse(readFileSync(state, 'utf8').replace(/^\uFEFF/, '')).token).toBe('forged');
    } finally {
      victim.kill();
      await up.stop();
    }
  }, 40_000);

  it('再次啟動：請舊的轉接程式自己結束後，新的才接手同一個連接埠', async () => {
    const up = fakeUpstream({ events: 1, gapMs: 10 });
    const upPort = await up.start();
    try {
      const a = await startBridge(`http://127.0.0.1:${upPort}`);
      const b = await startBridge(`http://127.0.0.1:${upPort}`, { port: a.port, dir: a.dir });
      for (let i = 0; i < 24 && a.proc.exitCode === null; i++) await sleep(250);
      expect(a.proc.exitCode).not.toBeNull();
      let status: number | undefined;
      for (let i = 0; i < 20 && status !== 200; i++) {
        status = (await request({ port: b.port })).status;
        if (status !== 200) await sleep(250);
      }
      expect(status).toBe(200);
      await requestStop(b);
      expect(b.proc.exitCode).not.toBeNull();
    } finally {
      await up.stop();
    }
  }, 40_000);
});
