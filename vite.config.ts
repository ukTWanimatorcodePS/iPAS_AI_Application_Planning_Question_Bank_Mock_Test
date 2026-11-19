/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
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

export default defineConfig({
  base: resolveBase(),
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 700,
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
