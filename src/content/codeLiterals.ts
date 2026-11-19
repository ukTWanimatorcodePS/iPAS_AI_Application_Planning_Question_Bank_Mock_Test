/**
 * 從題目文字中移除「程式碼字面值」，供 LaTeX 檢查使用。
 *
 * 移除的內容：
 * - 反引號程式碼片段：開頭與結尾的連續反引號數量相同（`…`、``…``）；中間長度不同的反引號串會略過，繼續找相同長度的結尾。
 * - Python 字串字面值：無前綴或合法前綴（r、u、b、f 及 rb、br、fr、rf，不分大小寫），單引號、雙引號與三引號；
 *   處理反斜線跳脫（raw 字串中 \" 也不會結束字串）；三引號可跨行。
 * - f-string 的替換欄位 {…}（依 Python 3.12 起的語法）：
 *   {{ }} 字面大括號；欄位內的字串（含與外層相同的引號）、巢狀括號、# 行註解、跨行；
 *   格式規格（: 之後）中的巢狀欄位，以及填充字元可以是引號；反斜線不會跳脫 { 與 }。
 *
 * 失敗時保守（寧可交給後續檢查攔下，也不要吞掉字串外的公式）：
 * - 字串沒有結束（含未關閉的三引號、f-string 欄位沒關、欄位註解到全文結尾都沒換行）：從這裡到全文結尾一律保留原文。
 * - 引號前面緊接識別字元（中文字、英文字母、數字、底線，如 中文"…"、bar"…"、it's）：不是 Python 字串開頭。
 *   這段「看起來像字串」的區域原文保留，並整段跳過，它的結尾引號不會被重新當成新字串的開頭；單獨的撇號只保留到行尾。
 * - 反引號沒有相同長度的結尾：開頭的反引號當一般文字保留（與 Markdown 規則相同）。
 * - 巢狀超過 MAX_DEPTH 層：視為無法辨識，保留原文（避免極端輸入造成堆疊溢位）。
 *
 * 這是作者內容的格式檢查，不是完整的 Python 語法解析器，也不是安全防線；
 * 刻意把公式包進字串或反引號仍會被豁免，屬內容審閱範圍。
 */
const PREFIXES = new Set(['', 'r', 'u', 'b', 'f', 'rb', 'br', 'fr', 'rf']);
const PREFIX_CHAR = /[rRuUbBfF]/;
/** f-string 欄位與字串的巢狀上限；正常內容遠低於此 */
export const MAX_DEPTH = 64;
const isIdent = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isQuote = (c: string | undefined) => c === '"' || c === "'";

/** 回傳緊接在 quotePos 前面的字串前綴（小寫）與前綴起點；前綴前面不能再接識別字元。不是合法前綴時回傳 null */
function prefixBefore(text: string, quotePos: number): { prefix: string; start: number } | null {
  let s = quotePos;
  while (s > 0 && quotePos - s < 2 && PREFIX_CHAR.test(text[s - 1])) s--;
  // 由長到短嘗試：例如 'xrb"' 中 rb 前面接 x 不合法，也不能退成 b（b 前面接 r 是識別字元）
  for (let start = s; start <= quotePos; start++) {
    const prefix = text.slice(start, quotePos).toLowerCase();
    if (PREFIXES.has(prefix) && !isIdent(text[start - 1])) return { prefix, start };
  }
  return null;
}

/**
 * 從 quotePos（引號位置）掃描 Python 字串，回傳結束位置（不含）；沒有結束或無法辨識時回傳 -1。
 * fstring 為 true 時辨識替換欄位。depth 為目前巢狀層數。
 */
function scanString(text: string, quotePos: number, fstring: boolean, depth: number): number {
  if (depth > MAX_DEPTH) return -1;
  const q = text[quotePos];
  const triple = text.startsWith(q.repeat(3), quotePos);
  const close = triple ? q.repeat(3) : q;
  let i = quotePos + close.length;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      // 反斜線跳脫下一個字元（含引號）；raw 字串規則相同。但在 f-string 中，反斜線不會跳脫 { 與 }
      i += fstring && (text[i + 1] === '{' || text[i + 1] === '}') ? 1 : 2;
      continue;
    }
    if (!triple && c === '\n') return -1;
    if (text.startsWith(close, i)) return i + close.length;
    if (fstring && c === '{') {
      if (text[i + 1] === '{') {
        i += 2; // {{ 是字面的大括號
        continue;
      }
      const end = scanReplacementField(text, i + 1, depth + 1);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    i++;
  }
  return -1;
}

/** 掃描 f-string 替換欄位（從 { 之後開始），回傳結尾 } 之後的位置；無法辨識時回傳 -1 */
function scanReplacementField(text: string, start: number, depth: number): number {
  if (depth > MAX_DEPTH) return -1;
  let brackets = 0;
  let inSpec = false; // 格式規格（: 之後）：其中的 {…} 是巢狀欄位，其他字元（含引號）都是字面字元
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (inSpec) {
      if (c === '{') {
        const end = scanReplacementField(text, i + 1, depth + 1);
        if (end < 0) return -1;
        i = end;
        continue;
      }
      if (c === '}') return i + 1;
      if (c === '\n') return -1; // 格式規格不能跨行
      i++;
      continue;
    }
    if (c === '#') {
      // 欄位內的行註解：其中的括號與引號都不算；沒有換行就無法確定結尾
      const eol = text.indexOf('\n', i);
      if (eol < 0) return -1;
      i = eol + 1;
      continue;
    }
    if (isQuote(c)) {
      const p = prefixBefore(text, i);
      const end = scanString(text, i, !!p && p.prefix.includes('f'), depth + 1);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') brackets++;
    else if (c === ')' || c === ']') brackets--;
    else if (c === '}') {
      if (brackets === 0) return i + 1;
      brackets--;
    } else if (c === ':' && brackets === 0) inSpec = true;
    if (brackets < 0 || brackets > MAX_DEPTH) return -1;
    i++;
  }
  return -1;
}

/**
 * 預先找出所有連續反引號串，並為每一串記錄「之後下一個相同長度的串」，
 * 讓配對查詢是 O(1)，避免大量長度不同的反引號造成重複掃描。
 */
function backtickRuns(text: string): Map<number, { len: number; next: number }> {
  const runs: { pos: number; len: number }[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;
    runs.push({ pos: i, len: n });
    i += n;
  }
  const byPos = new Map<number, { len: number; next: number }>();
  const lastByLen = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    const r = runs[k];
    byPos.set(r.pos, { len: r.len, next: lastByLen.get(r.len) ?? -1 });
    lastByLen.set(r.len, r.pos);
  }
  return byPos;
}

export function stripCodeLiterals(text: string): string {
  const runs = text.includes('`') ? backtickRuns(text) : new Map<number, { len: number; next: number }>();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // 反引號程式碼片段：配對下一個相同長度的反引號串
    if (c === '`') {
      const run = runs.get(i);
      if (run && run.next >= 0) {
        out += ' ';
        i = run.next + run.len;
      } else {
        const n = run?.len ?? 1;
        out += text.slice(i, i + n); // 沒有結尾：當一般文字
        i += n;
      }
      continue;
    }

    if (isQuote(c)) {
      const p = prefixBefore(text, i);
      const end = scanString(text, i, !!p && p.prefix.includes('f'), 0);
      if (end < 0) {
        const triple = text.startsWith(c.repeat(3), i);
        if (p || triple) {
          // 合法開頭但沒有結束（或無法辨識）的字串：其後全部保留原文，不再辨識任何字串
          out += text.slice(i);
          break;
        }
        // 不是字串開頭、且到行尾都沒有成對引號（如單獨的 it's）：保留到行尾，下一行重新開始辨識
        const eol = text.indexOf('\n', i);
        const stop = eol < 0 ? text.length : eol;
        out += text.slice(i, stop);
        i = stop;
        continue;
      }
      if (p) {
        // 合法的 Python 字串：連同前綴一起移除（前綴已輸出，退回去）
        out = out.slice(0, out.length - (i - p.start)) + ' ';
      } else {
        // 引號前接識別字元（中文"…"、bar"…"、it's）：不是 Python 字串。原文保留並整段跳過，
        // 避免它的結尾引號被重新當成新字串的開頭，把後面的公式吞掉
        out += text.slice(i, end);
      }
      i = end;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}
