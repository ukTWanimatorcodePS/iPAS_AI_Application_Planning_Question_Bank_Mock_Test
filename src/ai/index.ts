import { mockProvider } from './mockProvider';
import { remoteProvider } from './remoteProvider';
import type { TutorProvider } from './types';

export const providers: TutorProvider[] = [mockProvider, remoteProvider];

/** 依使用者偏好選擇 Provider；遠端未設定時一律退回示範模式，不影響原本的靜態解析 */
export function getProvider(preferred: 'mock' | 'remote' | undefined): TutorProvider {
  if (preferred === 'remote' && remoteProvider.isAvailable()) return remoteProvider;
  return mockProvider;
}

export { mockProvider, remoteProvider };
export * from './types';
