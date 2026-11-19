import { Children, isValidElement, memo, type ReactNode } from 'react';
import type { Components, Options } from 'react-markdown';
import { CopyButton } from './CodeBlock';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { headingId } from '../lib/lessonOutline';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';

// 只載入講義會用到的語言，避免打包全部 highlight.js 語言
const LANGS = { python, sql, bash, json };

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

// 元件對照與外掛設定必須是穩定的模組層級常數；若每次渲染都建立新物件，React 會重建整棵講義 DOM，
// 導致段落追蹤（IntersectionObserver）與閱讀位置失效。
const REMARK = [remarkGfm, remarkMath];
const REHYPE: Options['rehypePlugins'] = [rehypeKatex, [rehypeHighlight, { detect: false, languages: LANGS }]];
const COMPONENTS: Components = {
  h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(textOf(children))}>{children}</h3>,
  table: ({ children }) => (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="表格（可水平捲動）">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => {
    const external = href?.startsWith('http');
    return (
      <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    const raw = textOf(child);
    return (
      <div className="code-block">
        <pre>{children}</pre>
        <CopyButton text={raw.replace(/\n$/, '')} />
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
      {source}
    </ReactMarkdown>
  );
});
