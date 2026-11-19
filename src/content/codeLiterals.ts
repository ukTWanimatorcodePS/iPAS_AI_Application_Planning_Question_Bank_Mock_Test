/**
 * 從題目文字中移除「程式碼字面值」，供 LaTeX 檢查使用。
 *
 * 移除的內容：
 * - 反引號程式碼片段：開頭與結尾的連續反引號數量相同（`…`、``…``）；中間長度不同的反引號串會略過，繼續找相同長度的結尾。
 * - Python 字串字面值：無前綴或合法前綴（r、u、b、f 及 rb、br、fr、rf，不分大小寫），單引號、雙引號與三引號；
 *   處理反斜線跳脫（raw 字串中 \" 也不會結束字串）；三引號可跨行；
 *   f-string 會辨識替換欄位 {…}，其中可以再出現字串（含與外層相同的引號，Python 3.12 起合法）與巢狀括號。
 *
 * 失敗時保守（寧可交給後續檢查攔下，也不要吞掉字串外的公式）：
 * - 字串沒有結束（含未關閉的三引號、f-string 欄位沒關）：從這裡到全文結尾一律保留原文，不再嘗試辨識任何字串。
 * - 引號前面緊接識別字元（中文字、英文字母、數字、底線，如 中文"…"、bar"…"、it's）：不是 Python 字串開頭。
 *   這段「看起來像字串」的區域原文保留，並整段跳過，它的結尾引號不會被重新當成新字串的開頭。
 * - 反引號沒有相同長度的結尾：開頭的反引號當一般文字保留（與 Markdown 規則相同）。
 *
 * 這是作者內容的格式檢查，不是完整的 Python 語法解析器，也不是安全防線；
 * 刻意把公式包進字串或反引號仍會被豁免，屬內容審閱範圍。
 */
const PREFIXES = new Set(['', 'r', 'u', 'b', 'f', 'rb', 'br', 'fr', 'rf']);
const PREFIX_CHAR = /[rRuUbBfF]/;
const isIdent = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isQuote = (c: string | undefined) => c === '"' || c === "'";

/** 回傳緊接在 quotePos 前面的字串前綴（小寫）與前綴起點；前綴前面不能再接識別字元。不是合法前綴時回傳 null */
function prefixBefore(text: string, quotePos: number): { prefix: string; start: number } | null {
  let s = quotePos;
  while (s > 0 && quotePos - s < 2 && PREFIX_CHAR.test(text[s - 1])) s--;
  // 由長到短嘗試：例如 'xrb"' 中 rb 前面接 x 不合法，但也不能退成 b（b 前面接 r 是識別字元）
  for (let start = s; start <= quotePos; start++) {
    const prefix = text.slice(start, quotePos).toLowerCase();
    if (PREFIXES.has(prefix) && !isIdent(text[start - 1])) return { prefix, start };
  }
  return null;
}

/**
 * 從 quotePos（引號位置）掃描 Python 字串，回傳結束位置（不含）；沒有結束時回傳 -1。
 * fstring 為 true 時辨識替換欄位。
 */
function scanString(text: string, quotePos: number, fstring: boolean): number {
  const q = text[quotePos];
  const triple = text.startsWith(q.repeat(3), quotePos);
  const close = triple ? q.repeat(3) : q;
  let i = quotePos + close.length;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2; // 跳脫：下一個字元（含引號）不結束字串；raw 字串的規則相同
      continue;
    }
    if (!triple && c === '\n') return -1;
    if (text.startsWith(close, i)) return i + close.length;
    if (fstring && c === '{') {
      if (text[i + 1] === '{') {
        i += 2; // {{ 是字面的大括號
        continue;
      }
      const end = scanReplacementField(text, i + 1, triple);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    i++;
  }
  return -1;
}

/** 掃描 f-string 替換欄位（從 { 之後開始），回傳結尾 } 之後的位置；無法辨識時回傳 -1 */
function scanReplacementField(text: string, start: number, triple: boolean): number {
  let depth = 0;
  let inSpec = false; // 格式規格（: 之後）：其中的 {…} 是巢狀欄位
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' && !triple) return -1;
    if (inSpec) {
      if (c === '{') {
        const end = scanReplacementField(text, i + 1, triple);
        if (end < 0) return -1;
        i = end;
        continue;
      }
      if (c === '}') return i + 1;
      if (isQuote(c)) return -1; // 規格中出現引號：無法可靠判斷，保守處理
      i++;
      continue;
    }
    if (isQuote(c)) {
      const p = prefixBefore(text, i);
      const end = scanString(text, i, !!p && p.prefix.includes('f'));
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') {
      if (depth === 0) return i + 1;
      depth--;
    } else if (c === ':' && depth === 0) inSpec = true;
    if (depth < 0) return -1;
    i++;
  }
  return -1;
}

/** 從 i 開始的連續反引號長度 */
function runLength(text: string, i: number): number {
  let n = 0;
  while (text[i + n] === '`') n++;
  return n;
}

export function stripCodeLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // 反引號程式碼片段：找長度相同的結尾 run，略過長度不同的 run
    if (c === '`') {
      const n = runLength(text, i);
      let j = i + n;
      let end = -1;
      while (j < text.length) {
        if (text[j] === '`') {
          const m = runLength(text, j);
          if (m === n) {
            end = j;
            break;
          }
          j += m;
        } else j++;
      }
      if (end >= 0) {
        out += ' ';
        i = end + n;
      } else {
        out += text.slice(i, i + n); // 沒有結尾：當一般文字
        i += n;
      }
      continue;
    }

    if (isQuote(c)) {
      const p = prefixBefore(text, i);
      const end = scanString(text, i, !!p && p.prefix.includes('f'));
      if (end < 0) {
        const triple = text.startsWith(c.repeat(3), i);
        if (p || triple) {
          // 合法開頭但沒有結束的字串（含未關閉的三引號）：其後全部保留原文，不再辨識任何字串
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
