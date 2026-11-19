/**
 * 從題目文字中移除「程式碼字面值」，供 LaTeX 檢查使用。
 *
 * 移除的內容：
 * - 反引號程式碼片段：`…`、``…``（開頭與結尾的反引號數量相同）。
 * - Python 字串字面值：無前綴或合法前綴（r、u、b、f 及 rb、br、fr、rf，不分大小寫），
 *   單引號、雙引號與三引號；處理反斜線跳脫（raw 字串中 \" 也不會結束字串）；三引號可跨行。
 *
 * 保守原則：沒有成對結束的引號或反引號一律「不移除」，交給後續檢查，避免整段公式被吞掉。
 * 這是作者內容的格式檢查，不是完整的 Python 語法解析器，也不是安全防線。
 */
const PREFIXES = new Set(['', 'r', 'u', 'b', 'f', 'rb', 'br', 'fr', 'rf']);
const isIdent = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** 從 start（引號位置）掃描 Python 字串，回傳結束位置（不含）；沒有結束引號時回傳 -1 */
function scanPythonString(text: string, start: number): number {
  const q = text[start];
  const triple = text.startsWith(q.repeat(3), start);
  const close = triple ? q.repeat(3) : q;
  let i = start + close.length;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2; // 跳脫字元：下一個字元（含引號）不結束字串；raw 字串的規則相同
      continue;
    }
    if (!triple && c === '\n') return -1;
    if (text.startsWith(close, i)) return i + close.length;
    i++;
  }
  return -1;
}

export function stripCodeLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // 反引號程式碼片段
    if (c === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = text.indexOf(fence, i + n);
      if (end > i && text[end + n] !== '`') {
        out += ' ';
        i = end + n;
        continue;
      }
      out += fence;
      i += n;
      continue;
    }
    // Python 字串（含前綴）：前綴前面不能接識別字元，避免把 it's、don't 當成字串開頭
    if (c === '"' || c === "'" || /[rRuUbBfF]/.test(c)) {
      let p = i;
      while (p < text.length && p - i < 2 && /[rRuUbBfF]/.test(text[p])) p++;
      const prefix = text.slice(i, p).toLowerCase();
      const quote = text[p];
      if ((quote === '"' || quote === "'") && PREFIXES.has(prefix) && !isIdent(text[i - 1])) {
        const end = scanPythonString(text, p);
        if (end > 0) {
          out += ' ';
          i = end;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}
