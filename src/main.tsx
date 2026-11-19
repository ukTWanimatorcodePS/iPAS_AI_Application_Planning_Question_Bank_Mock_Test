import 'katex/dist/katex.min.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ensureInitialized } from './data/db';

const root = createRoot(document.getElementById('root')!);

ensureInitialized()
  .catch((err) => {
    console.error(err);
    // IndexedDB 無法使用（例如部分私密瀏覽模式）時仍可瀏覽，但進度不會保存
    (window as unknown as { __storageError?: string }).__storageError = String(err);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
