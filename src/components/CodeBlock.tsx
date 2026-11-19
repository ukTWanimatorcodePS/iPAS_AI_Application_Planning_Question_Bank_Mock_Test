import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm copy !min-h-[32px]"
      aria-label={done ? '已複製程式碼' : '複製程式碼'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* 剪貼簿不可用 */
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? '已複製' : '複製'}
    </button>
  );
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="code-block">
      <pre aria-label={language ? `${language} 程式碼` : '程式碼'}>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

