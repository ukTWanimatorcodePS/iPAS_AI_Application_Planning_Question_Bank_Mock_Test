/**
 * 考試規則設定檔。
 * 每年官方簡章公布後，只需更新本檔（新增一個年度設定並改 ACTIVE_RULE_YEAR），不必改 UI。
 * 注意：未經官方核實的數值一律設為 null，UI 會顯示「尚未公告／自訂」。
 */

export interface ExamRuleSet {
  /** 規則生效年度 */
  year: number;
  /** 是否為暫定（例如沿用前一年度、新簡章尚未公告） */
  isProvisional: boolean;
  lastVerifiedAt: string;
  sources: { label: string; url: string }[];
  notes: string;
  junior: {
    subjects: ['L11', 'L12'];
    /** 同次全科報考：平均分數門檻 */
    allSubjectsAverage: number;
    /** 同次全科報考：單科最低分 */
    allSubjectsMinEach: number;
    /** 非同次全科報考：各科須達分數 */
    singleSubjectPass: number;
  };
  middle: {
    certificates: { id: 'data' | 'ml'; name: string; subjects: string[]; minEach: number }[];
    /** 程式題佔比（官方「預計」數值，僅供參考） */
    codingQuestionShareNote: string | null;
  };
  /** 該年度官方公告的考試日期（已核實才填，否則為空陣列） */
  schedule: { junior: string[]; middle: string[] };
  /** 題型與作答方式說明（依該年度簡章） */
  formatNote: string | null;
  /** 考試日期、題數、時間：只填該年度簡章明確列出的數值，未核實前必須保持 null */
  examDates: { junior: string | null; middle: string | null };
  questionCount: Record<string, number | null>;
  durationMinutes: Record<string, number | null>;
}

const OFFICIAL_EXAM_INFO = 'https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info';
const BROCHURE_115 =
  'https://www.ipas.org.tw/api/proxy/uploads/certification_attachment/8039a24c849c4fb4a6dd7f942576d4f8/115%E5%B9%B4%E5%BA%A6AI%E6%87%89%E7%94%A8%E8%A6%8F%E5%8A%83%E5%B8%AB%E8%83%BD%E5%8A%9B%E9%91%91%E5%AE%9A%E7%B0%A1%E7%AB%A0(%E5%88%9D%E3%80%81%E4%B8%AD%E7%B4%9A)_0410_20260410144503.pdf';
const OFFICIAL_CODING_NEWS = 'https://ipd.nat.gov.tw/ipas/certification/AIAP/news/ffdba0fcdbda40baadeef2a1bdc0230e';

export const EXAM_RULES: Record<number, ExamRuleSet> = {
  2026: {
    year: 2026,
    isProvisional: true,
    lastVerifiedAt: '2026-11-19',
    sources: [
      { label: '官方考試資訊', url: OFFICIAL_EXAM_INFO },
      { label: '115 年度簡章（初、中級）115.04 版 §2.3', url: BROCHURE_115 },
      { label: '官方中級程式題說明', url: OFFICIAL_CODING_NEWS },
    ],
    notes: '依 2026（115 年）官方資料；截至 2026-11-19 官網尚未公告 116 年（2027）簡章，2027 以新簡章為準。',
    junior: { subjects: ['L11', 'L12'], allSubjectsAverage: 70, allSubjectsMinEach: 60, singleSubjectPass: 70 },
    middle: {
      certificates: [
        { id: 'data', name: '數據分析證書', subjects: ['L21', 'L22'], minEach: 70 },
        { id: 'ml', name: '機器學習證書', subjects: ['L21', 'L23'], minEach: 70 },
      ],
      codingQuestionShareNote: 'L22／L23 程式題官方預計約佔整體試題 25%（Python 基本語法、程式邏輯、程式片段判讀）。',
    },
    schedule: { junior: ['2026-03-21', '2026-05-16', '2026-08-15', '2026-11-07'], middle: ['2026-05-23', '2026-11-14'] },
    formatNote:
      '每科目為單選題 50 題，採電腦化測驗；初級每科 75 分鐘、中級每科 90 分鐘。中級科目 2 與科目 3 安排在同一時段，同一梯次擇一應考；科目 2、3 包含程式相關題型。',
    examDates: { junior: null, middle: null },
    // 依 115 年度簡章（115.04 版）§2.3，查核日期 2026-11-19
    questionCount: { L11: 50, L12: 50, L21: 50, L22: 50, L23: 50 },
    durationMinutes: { L11: 75, L12: 75, L21: 90, L22: 90, L23: 90 },
  },
};

export const ACTIVE_RULE_YEAR = 2026;
export const activeRules = (): ExamRuleSet => EXAM_RULES[ACTIVE_RULE_YEAR];

export const RULES_DISCLAIMER = '依 2026 官方資料；2027 以新簡章為準。官方評鑑範圍僅供參考，實際考題不以表列內容為限。';

/* ---------- 及格判定 ---------- */

export type SubjectScores = Partial<Record<string, number>>;

export interface JuniorVerdict {
  mode: 'all-subjects' | 'single-subject';
  passed: boolean;
  average: number | null;
  passedSubjects: string[];
  reason: string;
}

/**
 * 初級判定。
 * - sameSitting = true：同次全科報考 → 平均 ≥ 門檻 且 每科 ≥ 單科最低分
 * - sameSitting = false：各科分別 ≥ singleSubjectPass
 */
export function judgeJunior(scores: SubjectScores, sameSitting: boolean, rules = activeRules()): JuniorVerdict {
  const r = rules.junior;
  const subjects = r.subjects;
  if (sameSitting) {
    const missing = subjects.filter((s) => scores[s] === undefined);
    if (missing.length) {
      return { mode: 'all-subjects', passed: false, average: null, passedSubjects: [], reason: `缺少 ${missing.join('、')} 成績` };
    }
    const vals = subjects.map((s) => scores[s]!);
    const average = vals.reduce((a, b) => a + b, 0) / vals.length;
    const minOk = vals.every((v) => v >= r.allSubjectsMinEach);
    const passed = average >= r.allSubjectsAverage && minOk;
    return {
      mode: 'all-subjects',
      passed,
      average,
      passedSubjects: passed ? [...subjects] : [],
      reason: passed
        ? `平均 ${average.toFixed(1)} ≥ ${r.allSubjectsAverage} 且各科 ≥ ${r.allSubjectsMinEach}`
        : !minOk
          ? `有科目低於 ${r.allSubjectsMinEach} 分`
          : `平均 ${average.toFixed(1)} 未達 ${r.allSubjectsAverage}`,
    };
  }
  const passedSubjects = subjects.filter((s) => (scores[s] ?? -1) >= r.singleSubjectPass);
  return {
    mode: 'single-subject',
    passed: passedSubjects.length === subjects.length,
    average: null,
    passedSubjects,
    reason: `各科需分別 ≥ ${r.singleSubjectPass}；已達標：${passedSubjects.join('、') || '無'}`,
  };
}

export interface MiddleVerdict {
  certificates: { id: 'data' | 'ml'; name: string; passed: boolean; missing: string[] }[];
}

/** 中級判定：L21 + L22 各 ≥ 70 → 數據分析；L21 + L23 各 ≥ 70 → 機器學習 */
export function judgeMiddle(scores: SubjectScores, rules = activeRules()): MiddleVerdict {
  return {
    certificates: rules.middle.certificates.map((c) => {
      const missing = c.subjects.filter((s) => (scores[s] ?? -1) < c.minEach);
      return { id: c.id, name: c.name, passed: missing.length === 0, missing };
    }),
  };
}
