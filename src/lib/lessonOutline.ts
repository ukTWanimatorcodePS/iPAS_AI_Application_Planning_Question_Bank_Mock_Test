/** 講義必備段落（第二階段規格），內容測試會檢查每份講義皆具備且順序正確 */
export const REQUIRED_SECTIONS = [
  '學習目標',
  '必考核心觀念',
  '名詞與定義',
  '原理及運作流程',
  '不同領域的實際案例',
  '容易混淆的觀念比較',
  '常見考試陷阱',
  '單元重點整理',
  '延伸參考與來源',
] as const;

/** 第 9 項「對應練習題入口」由講義頁面在文末自動產生（依題庫即時計算題數） */
export const PRACTICE_SECTION = '對應練習題入口';

export function headingId(text: string): string {
  return 'h-' + text.trim().replace(/[\s/／]+/g, '-').replace(/[()（）.、,，:：?？「」"'`*]/g, '');
}

export interface OutlineItem {
  depth: 2 | 3;
  text: string;
  id: string;
}

export function outline(md: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let inCode = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) inCode = !inCode;
    if (inCode) continue;
    const m = line.match(/^(##|###)\s+(.+?)\s*$/);
    if (m) {
      const text = m[2].replace(/[*`]/g, '');
      items.push({ depth: m[1].length as 2 | 3, text, id: headingId(text) });
    }
  }
  return items;
}

/** 取出某個 `## 標題` 段落的內文（不含標題） */
export function sectionBody(md: string, heading: string): string | null {
  const start = md.indexOf(`\n## ${heading}\n`);
  const at = start >= 0 ? start + 1 : md.startsWith(`## ${heading}\n`) ? 0 : -1;
  if (at < 0) return null;
  const bodyStart = md.indexOf('\n', at) + 1;
  const next = md.indexOf('\n## ', bodyStart);
  return md.slice(bodyStart, next < 0 ? undefined : next).trim();
}

/** 取出段落中的項目符號清單文字 */
export function bulletsOf(body: string | null): string[] {
  if (!body) return [];
  return body
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? null)
    .filter((x): x is string => !!x);
}

/** 取出 Markdown 表格的資料列（略過表頭與分隔列），每列回傳儲存格陣列 */
export function tableRowsOf(body: string | null): string[][] {
  if (!body) return [];
  const rows = body.split('\n').filter((l) => l.trim().startsWith('|'));
  return rows
    .slice(2)
    .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/[#>*`|_-]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
