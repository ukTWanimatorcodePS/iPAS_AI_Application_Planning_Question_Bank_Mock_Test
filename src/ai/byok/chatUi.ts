import { useSyncExternalStore } from 'react';

/** AI 導師懸浮視窗的介面偏好（只存 localStorage，不含任何金鑰）：是否開啟功能、視窗大小 */
export const CHAT_UI_KEY = 'ipas-ai-chat-ui';
export type Size = 'closed' | 'normal' | 'large';
export interface ChatUi {
  enabled: boolean;
  size: Size;
}

let ui: ChatUi = readUi();
const uiListeners = new Set<() => void>();
function readUi(): ChatUi {
  try {
    const v = JSON.parse(localStorage.getItem(CHAT_UI_KEY) ?? '{}') as Partial<ChatUi>;
    return { enabled: v.enabled === true, size: v.size === 'normal' || v.size === 'large' ? v.size : 'closed' };
  } catch {
    return { enabled: false, size: 'closed' };
  }
}
export function setChatUi(patch: Partial<ChatUi>): void {
  ui = { ...ui, ...patch };
  try {
    localStorage.setItem(CHAT_UI_KEY, JSON.stringify(ui));
  } catch {
    /* 無法儲存時只影響下次開啟的狀態 */
  }
  uiListeners.forEach((l) => l());
}
/** 非 React 程式（例如送出流程中的檢查）讀取最新狀態 */
export function getChatUi(): ChatUi {
  return ui;
}
export function useChatUi(): ChatUi {
  return useSyncExternalStore(
    (l) => {
      uiListeners.add(l);
      return () => uiListeners.delete(l);
    },
    () => ui,
  );
}

