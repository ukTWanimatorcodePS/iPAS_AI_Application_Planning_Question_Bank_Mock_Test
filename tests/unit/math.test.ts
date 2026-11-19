import katex from 'katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { lessonCodes, loadLesson } from '../../src/content';

/** 用與網站相同的 remark-gfm + remark-math 解析，取出講義中的所有公式 */
function mathIn(md: string): string[] {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(md);
  const out: string[] = [];
  visit(tree, (node) => {
    if (node.type === 'inlineMath' || node.type === 'math') out.push((node as unknown as { value: string }).value);
  });
  return out;
}

/** 常見 LaTeX 指令；在公式中以英文單字出現（缺反斜線）會被渲染成一串斜體字母 */
const COMMANDS = ['approx', 'times', 'cdot', 'frac', 'dfrac', 'sqrt', 'sum', 'prod', 'log', 'exp', 'mu', 'sigma', 'lambda', 'theta', 'alpha', 'beta', 'leq', 'geq', 'neq', 'infty', 'partial', 'nabla', 'hat', 'bar'];
const BARE = new RegExp(`(^|[^\\\\a-zA-Z])(${COMMANDS.join('|')})(?![a-zA-Z])`);

describe('講義公式', () => {
  it('所有公式都能以 KaTeX 嚴格模式渲染，且沒有缺少反斜線的指令', async () => {
    const problems: string[] = [];
    let count = 0;
    for (const code of lessonCodes()) {
      for (const tex of mathIn((await loadLesson(code))!)) {
        count++;
        try {
          // 把「% 被當成註解」等警告變成錯誤；公式中的中文字 KaTeX 可正常顯示，不算錯誤
          katex.renderToString(tex, { throwOnError: true, strict: (code: string) => (code === 'unicodeTextInMathMode' ? 'ignore' : 'error') });
        } catch (e) {
          problems.push(`${code}：$${tex}$ → ${(e as Error).message.split('\n')[0]}`);
        }
        const m = tex.match(BARE);
        if (m) problems.push(`${code}：$${tex}$ → 「${m[2]}」缺少反斜線`);
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('能抓到缺反斜線與未跳脫的百分號', () => {
    expect(() => katex.renderToString('1 - 1/e \\approx 63.2%', { throwOnError: true, strict: 'error' })).toThrow();
    expect('1 - 1/e approx 63.2').toMatch(BARE);
    expect('1 - 1/e \\approx 63.2\\%').not.toMatch(BARE);
    expect(mathIn('程式碼 `$x$` 不是公式，$a+b$ 才是')).toEqual(['a+b']);
  });
});
