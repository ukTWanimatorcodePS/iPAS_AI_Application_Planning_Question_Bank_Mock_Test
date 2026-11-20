/**
 * 回答的依據檢查（在瀏覽器內執行，不產生用量）。
 * 模型偶爾仍會違反「沒有依據不得補充」的規則（實測：本機小型模型說「本站資料沒有涵蓋」後又自行補上錯誤的罰款金額）。
 * 這裡找出可疑的段落，讓介面提醒使用者不要採信：
 * - 含數字、但沒有任何 [S1] 等依據編號的段落（排除純粹列出依據或頁碼的段落）
 * - 說了「沒有涵蓋」卻仍補上未附依據的數字
 */
export interface GroundingWarning {
  uncitedNumbers: boolean;
  answeredDespiteNoSource: boolean;
  /** 引用了本回合不存在的依據編號（例如只有 S1～S7 卻寫 [S999]） */
  unknownRefs: boolean;
}

const CITE = /\[(S\d+|題目解析)\]/;
const NUMBER = /\d/;

/** @param validRefs 本回合實際附上的依據編號；未提供時不檢查編號是否存在 */
export function checkGrounding(text: string, validRefs?: string[]): GroundingWarning {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  // 「（舉例）」段落允許沒有依據；頁碼（例如 3-1、第 7 頁）不算數據
  const uncitedNumbers = paras.some((p) => {
    if (CITE.test(p) || /（舉例）/.test(p)) return false;
    const stripped = p.replace(/\d+-\d+/g, '').replace(/第\s*\d+\s*[～~-]?\s*\d*\s*[頁節章]/g, '').replace(/S\d+/g, '');
    return NUMBER.test(stripped);
  });
  // 說了沒有涵蓋，卻又出現未附依據的數字（實測的違規型態）；只指出閱讀位置並標了依據的回答不算
  const answeredDespiteNoSource = /本站資料沒有涵蓋/.test(text) && uncitedNumbers;
  const cited = [...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
  const unknownRefs = !!validRefs && cited.some((r) => !validRefs.includes(r));
  return { uncitedNumbers, answeredDespiteNoSource, unknownRefs };
}

/* ---------- 送出前的離題檢查（不呼叫 AI、不產生用量） ---------- */

/** 常見閒聊；若同時出現學習用語則放行（例如「用生成式 AI 寫詩屬於哪種應用？」） */
const CHITCHAT =
  /天氣|晚餐|午餐|早餐|宵夜|好吃|餐廳|美食|笑話|寫(一)?首詩|情書|請假(信|單)?|股票|股市|樂透|彩券|星座|運勢|你是誰|你叫什麼|陪我聊|聊聊天|好無聊|唱歌|電影|追劇|遊戲|旅遊|旅行|感情|失戀/i;
const GREETING = /^(你好|您好|嗨|哈囉|安安|早安|午安|晚安|hi|hello|hey|謝謝|感謝|謝啦|掰掰|再見|ok|好的?|嗯+)[\s!！。.~～?？]*$/i;
/** 英文縮寫以整個詞比對（避免 email、Taipei 裡的 ai 被當成 AI）；中文學習用語另列 */
const STUDY_TERMS_EN = /\b(ai|ml|dl|llm|rag|gpt|nlp|cnn|rnn|prompt|python|pandas|numpy|sql|ipas|no ?code|low ?code|api)\b/i;
/**
 * 強主題詞：幾乎只會在 AI／資料科學學習情境出現。提問同時像閒聊（CHITCHAT）時，只有這類詞能放行，
 * 例如「用生成式 AI 寫一首詩屬於哪種應用？」。
 */
const STUDY_TERMS_ZH_STRONG =
  /人工智慧|機器學習|深度學習|生成式|鑑別式|提示詞|演算法|神經網路|過擬合|欠擬合|監督式|非監督|強化學習|特徵工程|資料前處理|大型語言模型|語言模型|講義|考點|個資法|人工智慧基本法/;
/**
 * 泛用詞：日常也常用（評估、風險、分類、資料…）。只能在「不像閒聊」的提問中當作學習證據，
 * 不能蓋過閒聊阻擋（Codex r2 S3：「請評估今晚餐廳哪家好吃」原本因「評估」被放行）。
 */
const STUDY_TERMS_ZH_GENERAL =
  /模型|資料|數據|題目|選項|答案|考試|法規|法案|治理|風險|統計|機率|程式|導入|評估|特徵|訓練|監督|分類|回歸|隱私|資安/;
/** 明確指向目前題目或講義的問句：在題目／講義頁一律放行 */
const EXPLICIT_REF = /這題|此題|這一題|這段|這節|這個(觀念|概念|選項|名詞|例子|公式)|選項|答案|提示/;
/** 一般問句（為什麼、解釋、舉例…）：在題目／講義頁，且提問本身與本站資料相關時才放行 */
const GENERAL_REF = /解釋|為什麼|為何|例子|舉例|重點|觀念|看不懂|不懂|不太懂|混淆|差別|差在|比較|整理|摘要|怎麼記|再說明|詳細/;
/** 一般問句放行所需的最低相關度（questionRelevance，已排除常見虛詞） */
export const GENERAL_REF_MIN_RELEVANCE = 3;

export type TopicVerdict = { ok: true } | { ok: false; reply: string };

export const OFF_TOPIC_REPLY =
  '我是 iPAS AI 應用規劃師的學習導師，只回答和本站講義、題庫與考試有關的問題。這則訊息沒有送出給 AI，不會產生用量。可以試著問：「什麼是過擬合？」或在題目頁問「給我一點提示」。';

/**
 * @param relevance 提問本身與本站資料的相關度（questionRelevance）
 * @param hasPageContext 目前在題目或講義頁
 */
export function topicVerdict(text: string, relevance: number, hasPageContext: boolean): TopicVerdict {
  const t = text.trim();
  if (GREETING.test(t)) return { ok: false, reply: OFF_TOPIC_REPLY };
  const strong = STUDY_TERMS_EN.test(t) || STUDY_TERMS_ZH_STRONG.test(t);
  const study = strong || STUDY_TERMS_ZH_GENERAL.test(t);
  // 像閒聊時，只有強主題詞能放行；泛用詞（評估、風險、分類…）不足以證明是學習提問
  if (CHITCHAT.test(t) && !strong) return { ok: false, reply: OFF_TOPIC_REPLY };
  if (hasPageContext && EXPLICIT_REF.test(t)) return { ok: true };
  if (study) return { ok: true };
  if (hasPageContext && GENERAL_REF.test(t) && relevance >= GENERAL_REF_MIN_RELEVANCE) return { ok: true };
  if (relevance < GENERAL_REF_MIN_RELEVANCE) return { ok: false, reply: OFF_TOPIC_REPLY };
  return { ok: true };
}
