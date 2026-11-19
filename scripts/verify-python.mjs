#!/usr/bin/env node
/**
 * 程式題正確性檢查：實際執行題庫中帶有 verification（python-stdout）的程式片段，比對標準輸出。
 *
 * 執行引擎
 *   --engine=pyodide（預設）：使用 devDependency 的 Pyodide（WebAssembly 版 CPython），本機不需安裝 Python，
 *                            版本固定、可重現；pandas／NumPy／scikit-learn 由 Pyodide 套件庫載入。
 *   --engine=cpython        ：使用系統 Python 3（`python -I` 隔離模式、獨立暫存目錄、逾時限制）。
 * 其他參數
 *   --stamp   ：驗證通過的題目寫回 verification.status = "verified"、runtime、packages、verifiedAt。
 *   --strict  ：任何題目失敗或無法執行即以非零結束（CI 使用）。
 *
 * 只執行「本專案題庫內」的程式碼；前端網站從不執行任何 Python。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const stamp = args.includes('--stamp');
const engine = (args.find((a) => a.startsWith('--engine=')) ?? '--engine=pyodide').split('=')[1];
const root = join(process.cwd(), 'src/content/questions');
const today = new Date().toLocaleDateString('sv-SE'); // 本地日期 YYYY-MM-DD

const MODULE_TO_PACKAGE = { sklearn: 'scikit-learn', pandas: 'pandas', numpy: 'numpy', scipy: 'scipy', matplotlib: 'matplotlib' };
function importsOf(code) {
  const mods = new Set();
  for (const m of code.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w]*)/gm)) mods.add(m[1]);
  return [...mods].filter((m) => MODULE_TO_PACKAGE[m]);
}

/** @type {{file:string, list:any[]}[]} */
const files = [];
for (const subject of readdirSync(root))
  for (const file of readdirSync(join(root, subject))) {
    const path = join(root, subject, file);
    files.push({ file: path, list: JSON.parse(readFileSync(path, 'utf8')) });
  }
const questions = files.flatMap((f) => f.list).filter((q) => q.verification?.kind === 'python-stdout');

async function makePyodideRunner() {
  const { loadPyodide } = await import('pyodide');
  const py = await loadPyodide();
  const loaded = new Set();
  const pyVersion = py.runPython('import sys; sys.version.split()[0]');
  return {
    runtime: `Pyodide ${py.version}（CPython ${pyVersion}）`,
    /** 只做語法檢查（compile），不執行 */
    async syntax(code) {
      try {
        py.globals.set('__src', code);
        py.runPython('compile(__src, "<lesson>", "exec")');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message ?? e).split('\n').slice(-2).join('\n') };
      }
    },
    async run(code) {
      const pkgs = importsOf(code).map((m) => MODULE_TO_PACKAGE[m]);
      const need = pkgs.filter((p) => !loaded.has(p));
      if (need.length) {
        await py.loadPackage(need, { messageCallback: () => {} });
        need.forEach((p) => loaded.add(p));
      }
      let out = '';
      py.setStdout({ batched: (t) => (out += t + '\n') });
      try {
        // 每題使用獨立的命名空間，避免變數互相影響
        await py.runPythonAsync(code, { globals: py.toPy({}) });
        const versions = {};
        for (const m of importsOf(code)) versions[MODULE_TO_PACKAGE[m]] = py.runPython(`import ${m}; ${m}.__version__`);
        return { ok: true, out, versions };
      } catch (e) {
        return { ok: false, out, error: String(e.message ?? e).split('\n').slice(-3).join('\n') };
      }
    },
  };
}

function makeCpythonRunner() {
  const cmd = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find((c) => {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    return r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`);
  });
  if (!cmd) return null;
  const ver = spawnSync(cmd, ['-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8' }).stdout.trim();
  return {
    runtime: `CPython ${ver}`,
    async syntax(code) {
      const dir = mkdtempSync(join(tmpdir(), 'ipas-py-'));
      try {
        const file = join(dir, 'snippet.py');
        writeFileSync(file, code, 'utf8');
        const r = spawnSync(cmd, ['-I', '-c', 'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")', file], { encoding: 'utf8', timeout: 15_000 });
        return r.status === 0 ? { ok: true } : { ok: false, error: r.stderr };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    async run(code) {
      const dir = mkdtempSync(join(tmpdir(), 'ipas-py-'));
      try {
        const file = join(dir, 'snippet.py');
        const mods = importsOf(code);
        const probe = mods.length ? `\nimport sys as _s\nprint("@@VER@@" + ";".join(f"{m}={__import__(m).__version__}" for m in ${JSON.stringify(mods)}), file=_s.stderr)` : '';
        writeFileSync(file, code + probe, 'utf8');
        const r = spawnSync(cmd, ['-I', '-X', 'utf8', file], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 20_000,
          env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? '', PYTHONIOENCODING: 'utf-8' },
        });
        const versions = {};
        const line = (r.stderr ?? '').split('\n').find((l) => l.startsWith('@@VER@@'));
        if (line) for (const kv of line.slice(7).split(';')) { const [m, v] = kv.split('='); versions[MODULE_TO_PACKAGE[m]] = v.trim(); }
        return r.status === 0 ? { ok: true, out: r.stdout, versions } : { ok: false, out: r.stdout, error: (r.stderr ?? '') + (r.error?.message ?? '') };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

const runner = engine === 'cpython' ? makeCpythonRunner() : await makePyodideRunner();
if (!runner) {
  console.error('✖ 找不到 Python 3（--engine=cpython）。可改用預設的 Pyodide 引擎。');
  process.exit(strict ? 1 : 0);
}

let pass = 0,
  fail = 0;
for (const q of questions) {
  const r = await runner.run(q.code);
  const out = r.out.replace(/\r\n/g, '\n').trim();
  const expected = q.verification.expectedStdout.trim();
  if (r.ok && out === expected) {
    pass++;
    console.log(`✔ ${q.id} → ${out}`);
    if (stamp) Object.assign(q.verification, { status: 'verified', runtime: runner.runtime, packages: r.versions, verifiedAt: today });
  } else {
    fail++;
    console.error(`✖ ${q.id}\n  預期：${expected}\n  實際：${out}\n  ${r.error ?? ''}`);
    if (stamp) Object.assign(q.verification, { status: 'pending', runtime: null, packages: {}, verifiedAt: null });
  }
}
if (stamp) for (const f of files) writeFileSync(f.file, JSON.stringify(f.list, null, 2) + '\n');
console.log(`\n程式題驗證（${runner.runtime}）：通過 ${pass}、失敗 ${fail}，共 ${questions.length} 題${stamp ? '；已寫回驗證紀錄' : ''}`);

/* ---------- 講義中的 Python 範例 ----------
 * 執行每個 ```python 區塊，並檢查「print(...)  # 註解」：實際輸出必須出現在註解文字中。
 * 註解含「約」者視為近似值不比對。
 * 使用 matplotlib 的區塊以無視窗後端（Agg）實際執行；環境沒有 matplotlib 時改做 compile() 語法檢查，並分開計數。 */
let lpass = 0,
  lfail = 0,
  lplot = 0,
  lsyntax = 0;
const lroot = join(process.cwd(), 'src/content/lessons');
for (const s of readdirSync(lroot))
  for (const f of readdirSync(join(lroot, s))) {
    const md = readFileSync(join(lroot, s, f), 'utf8');
    const blocks = [...md.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]);
    for (const [i, code] of blocks.entries()) {
      const tag = `${f.replace('.md', '')}#${i + 1}`;
      const isPlot = /matplotlib/.test(code);
      const r = await runner.run(isPlot ? 'import matplotlib\nmatplotlib.use("Agg")\n' + code : code);
      if (isPlot && !r.ok && /No module named .?matplotlib/.test(r.error ?? '')) {
        const sx = await runner.syntax(code);
        if (sx.ok) {
          lsyntax++;
          console.log(`△ 講義 ${tag} 含繪圖；此環境沒有 matplotlib，僅通過語法檢查`);
        } else {
          lfail++;
          console.error(`✖ 講義 ${tag} 語法錯誤：${sx.error}`);
        }
        continue;
      }
      const outLines = r.out.replace(/\r\n/g, '\n').trimEnd().split('\n');
      const printComments = code
        .split('\n')
        .filter((l) => /^\s*print\(/.test(l))
        .map((l) => (l.match(/#\s*(.+)$/) ?? [])[1] ?? null);
      const problems = [];
      if (!r.ok) problems.push(`執行錯誤：${r.error}`);
      printComments.forEach((c, k) => {
        if (!c || c.includes('約')) return;
        if (outLines[k] === undefined || !c.includes(outLines[k].trim())) problems.push(`第 ${k + 1} 個 print：輸出「${outLines[k]}」不在註解「${c}」中`);
      });
      if (problems.length) {
        lfail++;
        console.error(`✖ 講義 ${tag}\n  ${problems.join('\n  ')}`);
      } else {
        lpass++;
        if (isPlot) lplot++;
        console.log(`✔ 講義 ${tag}${isPlot ? '（含繪圖，以 Agg 後端執行）' : ''}`);
      }
    }
  }
console.log(`講義範例驗證：實際執行通過 ${lpass}（其中繪圖 ${lplot}）、僅語法檢查 ${lsyntax}、略過 0、失敗 ${lfail}`);
if (strict && lsyntax > 0) console.warn('⚠ 有講義範例只做了語法檢查，未實際執行。');
if ((fail > 0 || lfail > 0) && (strict || stamp)) process.exit(1);
