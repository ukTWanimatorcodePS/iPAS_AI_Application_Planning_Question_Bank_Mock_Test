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

/**
 * 本機判斷沒有送出的原因。這是規則判斷結果，不是對使用者意圖的斷言：
 * - greeting：打招呼
 * - unclear_topic：系統目前無法確認想問的學習主題
 * - possible_off_topic：看起來像學習範圍以外的請求（生活、娛樂等）
 */
export type BlockReason = 'greeting' | 'unclear_topic' | 'possible_off_topic';

export type TopicVerdict = { ok: true } | { ok: false; reason: BlockReason; reply: string };

const NOT_SENT = '這則訊息尚未送給 AI，不會產生模型用量。';
const MAY_ERR = '（這是本機的自動判斷，可能判斷錯誤。）';
export const BLOCK_REPLY: Record<BlockReason, string> = {
  greeting: `你好！你可以先選一份講義，或直接告訴我你想了解的觀念。${NOT_SENT}`,
  unclear_topic: `我目前還不確定你想問哪個學習觀念。${NOT_SENT}請補充單元、觀念名稱，或指出題目中不懂的部分，例如：「這題中，為什麼 A 不適合？」${MAY_ERR}`,
  possible_off_topic: `這則訊息看起來不是 iPAS AI 應用規劃師的學習問題，所以${NOT_SENT}AI 導師只協助本站講義、題庫與考試相關的學習；如果你其實是在問學習觀念，請說明和哪個單元或觀念有關。${MAY_ERR}`,
};
/** 舊名稱相容：明顯離題時的回覆 */
export const OFF_TOPIC_REPLY = BLOCK_REPLY.possible_off_topic;

/** 延續追問（「再簡單一點」「可以舉例嗎」）：短、指向剛才的說明，且不像閒聊 */
const FOLLOW_UP = /再|簡單|白話|舉例|例子|為什麼|為何|怎麼說|什麼意思|意思|不懂|不太懂|詳細|換個|說明|還有呢|然後呢|差別|比較|整理|重點|總結/;
export const FOLLOW_UP_MAX_CHARS = 30;

export interface TopicOptions {
  /** 提問中出現的本站課綱名詞（由講義粗體名詞與細項名稱自動擷取，見 retrieval.ts conceptHits） */
  concepts?: string[];
  /** 同一題／同一講義、剛問過已送出的學習問題（延續追問） */
  continuing?: boolean;
}

/**
 * @param relevance 提問本身與本站資料的相關度（questionRelevance）
 * @param hasPageContext 目前在題目或講義頁
 */
export function topicVerdict(text: string, relevance: number, hasPageContext: boolean, opts: TopicOptions = {}): TopicVerdict {
  const t = text.trim();
  const block = (reason: BlockReason): TopicVerdict => ({ ok: false, reason, reply: BLOCK_REPLY[reason] });
  if (GREETING.test(t)) return block('greeting');
  // 學習依據：專業縮寫、強主題詞，或本站講義中出現的課綱名詞（不是手寫白名單）
  const strong = STUDY_TERMS_EN.test(t) || STUDY_TERMS_ZH_STRONG.test(t) || (opts.concepts?.length ?? 0) > 0;
  const study = strong || STUDY_TERMS_ZH_GENERAL.test(t);
  // 像閒聊時，只有強學習依據能放行（「協同過濾如何推薦電影？」可以；「推薦今晚看什麼電影」不行）
  if (CHITCHAT.test(t) && !strong) return block('possible_off_topic');
  if (hasPageContext && EXPLICIT_REF.test(t)) return { ok: true };
  // 延續剛才同一題／同一講義的學習對話；換題、換頁、清除對話後不延續（由呼叫端決定 continuing）
  if (opts.continuing && t.length <= FOLLOW_UP_MAX_CHARS && FOLLOW_UP.test(t)) return { ok: true };
  if (study) return { ok: true };
  if (hasPageContext && GENERAL_REF.test(t) && relevance >= GENERAL_REF_MIN_RELEVANCE) return { ok: true };
  if (relevance < GENERAL_REF_MIN_RELEVANCE) return block('unclear_topic');
  return { ok: true };
}
