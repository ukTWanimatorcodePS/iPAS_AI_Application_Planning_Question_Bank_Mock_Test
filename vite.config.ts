/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages 部署於 https://<user>.github.io/<repo>/，需設定 base。
 * 優先順序：VITE_BASE_PATH > GITHUB_REPOSITORY（Actions 自動提供）> '/'
 */
function resolveBase(): string {
  const explicit = process.env.VITE_BASE_PATH;
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (repo && !repo.endsWith('.github.io')) return `/${repo}/`;
  return '/';
}

/**
 * 正式建置時加入內容安全政策（CSP），降低 XSS 讀取使用者 AI 金鑰的風險：
 * - 只允許本站的腳本，以及 index.html 內以雜湊值核可的主題初始化腳本；不允許 eval 與外部腳本。
 * - 連線（connect-src）允許 https 與本機 http，讓使用者自選的雲端或本機 AI 服務可以連線。
 * - 圖片只允許本站與 data:；AI 回覆中的外部圖片不會被載入。
 * 開發伺服器（HMR 需要內嵌腳本）不套用。
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'ipas-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // 只核可有內容的內嵌腳本（目前只有 index.html 的主題初始化）
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim()).map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        );
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
          "worker-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
      },
    },
  };
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // 最大的是中級題庫資料 chunk（約 710 kB、gzip 約 155 kB，依級別延遲載入）；A1 改寫讓誘答變長後超過原本的 700
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // 題庫依級別獨立成 chunk：題庫更新時，App 主程式的快取不受影響
        codeSplitting: {
          groups: [
            { name: 'questions-junior', test: /src[/\\]content[/\\]questions[/\\]L1/ },
            { name: 'questions-middle', test: /src[/\\]content[/\\]questions[/\\]L2/ },
            { name: 'vendor', test: /node_modules[/\\](react|react-dom|react-router|dexie|dexie-react-hooks|zod)[/\\]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
