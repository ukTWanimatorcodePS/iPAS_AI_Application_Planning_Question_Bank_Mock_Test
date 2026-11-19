import { z } from 'zod';

export const LEVELS = ['junior', 'middle'] as const;
export const levelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof levelSchema>;

export const SUBJECT_CODES = ['L11', 'L12', 'L21', 'L22', 'L23'] as const;
export const subjectCodeSchema = z.enum(SUBJECT_CODES);
export type SubjectCode = z.infer<typeof subjectCodeSchema>;

const competencyCode = z.string().regex(/^L[12]\d{4}$/, '細項代碼需為 L + 5 碼，例如 L11101');

/* ---------- 課綱 ---------- */
export const competencySchema = z.object({ code: competencyCode, name: z.string().min(1) });
export const topicSchema = z.object({
  code: z.string().regex(/^L[12]\d{2}$/),
  name: z.string().min(1),
  competencies: z.array(competencySchema).min(1),
});
export const subjectSchema = z.object({
  code: subjectCodeSchema,
  name: z.string().min(1),
  shortName: z.string().min(1),
  topics: z.array(topicSchema).min(1),
});
export const curriculumSchema = z.object({
  curriculumVersion: z.string(),
  publishedAt: z.string(),
  lastVerifiedAt: z.string(),
  sourceUrl: z.url(),
  isProvisional: z.boolean(),
  notes: z.string(),
  levels: z.array(
    z.object({ id: levelSchema, name: z.string(), subjects: z.array(subjectSchema).min(1) }),
  ),
});
export type Curriculum = z.infer<typeof curriculumSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Competency = z.infer<typeof competencySchema>;

/* ---------- 題目 ---------- */
/**
 * official-released：官方公告原題（需有合法使用依據才可收錄）
 * official-sample：官方樣題（同上）
 * original：本站自編原創題
 * simulated：仿考試形式的自編模擬題
 */
export const ORIGINS = ['official-released', 'official-sample', 'original', 'simulated'] as const;
export const originSchema = z.enum(ORIGINS);
export type QuestionOrigin = z.infer<typeof originSchema>;

export const COPYRIGHT = ['original', 'licensed', 'public-domain', 'unknown'] as const;

/**
 * draft：草稿，不會出現在練習中
 * ai-checked：由 AI 撰寫並經自動檢查與自我校對，尚未經人工專家審核
 * human-reviewed：已由人工校閱
 * retired：已淘汰（不再出題，但保留以顯示歷史作答紀錄；ID 永不重用）
 */
export const REVIEW_STATUS = ['draft', 'ai-checked', 'human-reviewed', 'retired'] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUS);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

const optionId = z.enum(['A', 'B', 'C', 'D', 'E']);

/** 難度：基礎、進階、應用 */
export const DIFFICULTY_TIERS = ['basic', 'advanced', 'applied'] as const;
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];
/** 題型：概念理解、情境應用、比較判斷、實務分析 */
export const QUESTION_TYPES = ['concept', 'scenario', 'comparison', 'practical'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
/** 編寫狀態 */
export const AUTHORING = ['ai-drafted', 'human-written', 'ai-drafted-human-edited'] as const;

export const DIFFICULTY_LABEL: Record<DifficultyTier, string> = { basic: '基礎', advanced: '進階', applied: '應用' };
export const QTYPE_LABEL: Record<QuestionType, string> = { concept: '概念理解', scenario: '情境應用', comparison: '比較判斷', practical: '實務分析' };
export const AUTHORING_LABEL: Record<(typeof AUTHORING)[number], string> = {
  'ai-drafted': 'AI 草擬',
  'human-written': '人工撰寫',
  'ai-drafted-human-edited': 'AI 草擬・人工修訂',
};

export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-L[12]\d{4}-\d{4}$/, '題目 ID 格式：<origin>-<細項代碼>-<四位流水號>'),
    level: levelSchema,
    subject: subjectCodeSchema,
    topic: z.string().regex(/^L[12]\d{2}$/),
    competencyCode,
    type: z.enum(['single-choice', 'multiple-choice']),
    origin: originSchema,
    year: z.number().int().nullable(),
    session: z.string().nullable(),
    sourceUrl: z.url().nullable(),
    copyrightStatus: z.enum(COPYRIGHT),
    stem: z.string().min(5),
    /** Python 等程式片段（僅供閱讀，前端不執行） */
    code: z.string().optional(),
    codeLanguage: z.enum(['python']).optional(),
    /** 程式輸出題的驗證資訊：scripts/verify-python.mjs 會實際執行並比對 */
    verification: z
      .object({
        kind: z.literal('python-stdout'),
        expectedStdout: z.string(),
        /** verified：已實際執行比對；pending：尚未執行驗證（不可宣稱已通過） */
        status: z.enum(['verified', 'pending']),
        /** 實際執行時的環境與套件版本 */
        runtime: z.string().nullable(),
        packages: z.record(z.string(), z.string()),
        verifiedAt: z.string().nullable(),
      })
      .optional(),
    /** 程式題逐行解說 */
    codeWalkthrough: z.array(z.string().min(2)).optional(),
    options: z.array(z.object({ id: optionId, text: z.string().min(1) })).min(2).max(5),
    correctOptionIds: z.array(optionId).min(1),
    explanation: z.object({
      summary: z.string().min(5),
      correctRationale: z.string().min(5),
      optionRationales: z.record(z.string(), z.string().min(2)),
      commonTrap: z.string().min(2),
      example: z.string().optional(),
      lessonAnchor: competencyCode,
    }),
    difficulty: z.number().int().min(1).max(5),
    difficultyTier: z.enum(DIFFICULTY_TIERS),
    questionType: z.enum(QUESTION_TYPES),
    /** 對應講義段落標題（必須存在於該細項講義中） */
    lessonSection: z.string().min(2),
    authoring: z.enum(AUTHORING),
    tags: z.array(z.string()),
    reviewStatus: reviewStatusSchema,
    verifiedAt: z.string().nullable(),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `${q.id}: 選項 ID 重複` });
    for (const c of q.correctOptionIds)
      if (!ids.includes(c)) ctx.addIssue({ code: 'custom', message: `${q.id}: 正解 ${c} 不在選項中` });
    if (q.type === 'single-choice' && q.correctOptionIds.length !== 1)
      ctx.addIssue({ code: 'custom', message: `${q.id}: 單選題只能有一個正解` });
    const rationaleKeys = Object.keys(q.explanation.optionRationales).sort();
    if (rationaleKeys.join() !== [...ids].sort().join())
      ctx.addIssue({ code: 'custom', message: `${q.id}: 每個選項都必須有逐一解析` });
    if (!q.competencyCode.startsWith(q.topic) || !q.topic.startsWith(q.subject))
      ctx.addIssue({ code: 'custom', message: `${q.id}: subject/topic/competencyCode 不一致` });
    if (!q.id.includes(q.competencyCode))
      ctx.addIssue({ code: 'custom', message: `${q.id}: ID 需包含細項代碼` });
    const expectLevel = q.subject.startsWith('L1') ? 'junior' : 'middle';
    if (q.level !== expectLevel) ctx.addIssue({ code: 'custom', message: `${q.id}: level 與科目不符` });
    if ((q.origin === 'official-released' || q.origin === 'official-sample') && (!q.sourceUrl || q.year === null))
      ctx.addIssue({ code: 'custom', message: `${q.id}: 官方題必須標明年份與來源` });
    if ((q.origin === 'official-released' || q.origin === 'official-sample') && q.copyrightStatus === 'unknown')
      ctx.addIssue({ code: 'custom', message: `${q.id}: 版權狀態不明的官方題不可收錄` });
    if (q.origin === 'original' && q.copyrightStatus !== 'original')
      ctx.addIssue({ code: 'custom', message: `${q.id}: 自編題 copyrightStatus 應為 original` });
    if (q.verification) {
      const correct = q.options.find((o) => o.id === q.correctOptionIds[0]);
      if (!q.code) ctx.addIssue({ code: 'custom', message: `${q.id}: 有 verification 卻沒有 code` });
      if (correct && correct.text.trim() !== q.verification.expectedStdout.trim())
        ctx.addIssue({ code: 'custom', message: `${q.id}: 正解選項與 expectedStdout 不一致` });
      if (q.verification.status === 'verified' && (!q.verification.runtime || !q.verification.verifiedAt))
        ctx.addIssue({ code: 'custom', message: `${q.id}: 標示已驗證的程式題需記錄執行環境與日期` });
      if (!q.codeWalkthrough?.length) ctx.addIssue({ code: 'custom', message: `${q.id}: 程式題需要逐行解說 codeWalkthrough` });
    }
  });

export type Question = z.infer<typeof questionSchema>;
export const questionFileSchema = z.array(questionSchema);

export const ORIGIN_LABEL: Record<QuestionOrigin, string> = {
  'official-released': '正式公告原題',
  'official-sample': '官方樣題',
  original: '自編練習題',
  simulated: '自編模擬題',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  draft: '草稿（未釋出）',
  'ai-checked': 'AI 撰寫・自動檢查通過・待人工審核',
  'human-reviewed': '已人工審核',
  retired: '已淘汰（保留歷史紀錄）',
};
