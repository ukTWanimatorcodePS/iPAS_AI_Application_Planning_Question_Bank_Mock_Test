/** 專案公開資訊（不含任何個人資料或金鑰） */
export const REPO_URL = 'https://github.com/ukTWanimatorcodePS/iPAS_AI_Application_Planning_Question_Bank_Mock_Test';

/**
 * 產生「回報錯誤」的 GitHub Issue 連結。
 * 只帶入題目 ID／講義代碼與名稱，不帶入使用者的作答紀錄或任何個人資料。
 */
export function reportIssueUrl(target: { kind: 'question' | 'lesson'; id: string; title?: string }): string {
  const label = target.kind === 'question' ? '題目' : '講義';
  const title = `［${label}回報］${target.id}${target.title ? ` ${target.title}` : ''}`;
  const body = [
    `${label}：${target.id}`,
    '',
    '問題描述（哪一句、哪個選項或解析有誤）：',
    '',
    '建議修正與依據（官方文件、教科書或其他可查證來源）：',
    '',
  ].join('\n');
  const q = new URLSearchParams({ title, body });
  return `${REPO_URL}/issues/new?${q.toString()}`;
}
