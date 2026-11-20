import { Bot, Lock, Maximize2, Minimize2, Minus, PlugZap, Send, Settings2, Square, Trash2, X } from 'lucide-react';
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useLocation } from 'react-router';
import { ByokError, MAX_HISTORY, requestChars, streamChat, verifyConnection, type ChatTurn } from '../ai/byok/client';
import { isExpired, useConnection } from '../ai/byok/connection';
import { byokVersion, isConfigured, loadByok, presetById, subscribeByok } from '../ai/byok/config';
import { isBridgeUrl } from '../ai/byok/bridge';
import { contextLabel, effectiveContext, getChatContext, prepareTurn, useChatContext, type ChatContext } from '../ai/byok/context';
import type { RetrievedSource } from '../ai/byok/retrieval';
import { checkGrounding, topicVerdict, type BlockReason } from '../ai/byok/check';
import { conceptHits, questionRelevance } from '../ai/byok/retrieval';
import { useApp } from '../app/AppContext';
import { getCompetency } from '../content';
import { ByokSettings } from './ByokSettings';
import { ConnectionIndicator, SessionTimer } from './ConnectionIndicator';
import { getChatUi, setChatUi, useChatUi } from '../ai/byok/chatUi';

/**
 * 懸浮 AI 導師（自備 API）。
 * - 預設關閉；使用者在設定開啟後才顯示圖示（chatUi.enabled）。
 * - 只有按「送出」才會呼叫 API；開啟視窗、換頁、輸入文字、點快捷提問都不會產生用量。
 * - 三種大小：收合成圖示、標準視窗、放大（手機為全螢幕）。
 */

// AI 回覆一律當成不可信內容：不渲染原始 HTML、不顯示圖片（避免以圖片網址把對話外傳）、連結另開且不帶來源
const MD_COMPONENTS: Components = {
  img: ({ alt }) => <span className="text-muted">［圖片已略過{alt ? `：${alt}` : ''}］</span>,
  a: ({ href, children }) =>
    href && /^https:\/\//.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};
const Reply = memo(function Reply({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const QUICK = ['用簡單的話解釋這個觀念', '舉一個生活或職場的例子', '這題容易和哪些觀念混淆？', '幫我整理成三個重點'];

interface Msg extends ChatTurn {
  error?: boolean;
  /** 在本機產生、沒有送給 AI 的訊息（離題提醒），不列入之後送出的對話 */
  local?: boolean;
  /** AI 回答所附的依據（顯示給使用者核對） */
  sources?: RetrievedSource[];
  truncated?: boolean;
  /** 本機沒有送出的原因與原始提問（顯示引導、修改問題用） */
  blocked?: { reason: BlockReason; original: string };
}

/** 對話情境的識別：同一題、同一份講義才算延續追問 */
function contextKeyOf(c: ChatContext): string {
  if (c.kind === 'question') return `q:${c.question.id}`;
  if (c.kind === 'lesson') return `l:${c.code}`;
  return `${c.kind}:${c.path ?? ''}`;
}

/**
 * 沒有送出的提問：說明原因，並提供只會「填入草稿」的引導（不會呼叫 AI）。
 * 有題目／講義情境時依單元提供建議；沒有情境時引導去選講義，不憑空代選主題。
 */
function BlockedGuide({ blocked, ctx, onDraft }: { blocked: { reason: BlockReason; original: string }; ctx: ChatContext; onDraft: (text: string) => void }) {
  const drafts: string[] = [];
  if (ctx.kind === 'question') drafts.push('這題在考什麼觀念？', '我不懂其中一個選項：');
  else if (ctx.kind === 'lesson') {
    const name = getCompetency(ctx.code)?.name ?? ctx.code;
    drafts.push(`請解釋「${name}」的核心觀念`, `「${name}」可以舉一個生活或職場的例子嗎？`);
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="修改或補充提問（只會填入輸入框，不會送出）" data-testid="tutor-blocked-guide" data-reason={blocked.reason}>
      {blocked.reason !== 'greeting' && (
        <button type="button" className="pill cursor-pointer" onClick={() => onDraft(blocked.original)} data-testid="tutor-edit-question">
          修改問題
        </button>
      )}
      {drafts.map((d) => (
        <button key={d} type="button" className="pill cursor-pointer" onClick={() => onDraft(d)}>
          {d}
        </button>
      ))}
      {drafts.length === 0 && (
        <>
          <Link className="pill" to="/courses">
            去選一份講義
          </Link>
          <button type="button" className="pill cursor-pointer" onClick={() => onDraft('我想了解的觀念是：')}>
            補充想了解的觀念
          </button>
        </>
      )}
    </div>
  );
}

/** 回答完成後檢查：有未標依據的數字，或說「沒有涵蓋」卻仍補充內容時，提醒使用者不要採信 */
function GroundingNote({ text, refs }: { text: string; refs?: string[] }) {
  const w = checkGrounding(text, refs);
  if (!w.uncitedNumbers && !w.answeredDespiteNoSource && !w.unknownRefs) return null;
  return (
    <p role="note" className="mt-2 rounded-lg bg-warn-soft p-2 text-[0.72rem] text-warn" data-testid="tutor-grounding-warning">
      ⚠{' '}
      {w.answeredDespiteNoSource
        ? '這題超出本站資料範圍，AI 補充的內容沒有依據，可能不正確，請不要採信。'
        : w.unknownRefs
          ? '回答引用了這次沒有附上的依據編號，相關內容可能不正確。'
          : '回答中有沒標依據編號的數字或內容，可能不正確。'}
      請以本站講義、題目解析與 iPAS 官方資料為準。
    </p>
  );
}

const KIND_LABEL: Record<RetrievedSource['kind'], string> = { official: '官方', lesson: '講義', question: '題庫' };

function Sources({ sources }: { sources: RetrievedSource[] }) {
  if (!sources.length) return <p className="mt-1 text-[0.7rem] text-muted">這次沒有找到本站依據資料，AI 已被要求不得自行補充。</p>;
  return (
    <details className="mt-2 text-[0.72rem]" data-testid="tutor-sources">
      <summary className="cursor-pointer text-muted">依據（{sources.length}）：回答中的 [S1] 等編號對應下列本站資料</summary>
      <ul className="mt-1 space-y-0.5">
        {sources.map((s) => (
          <li key={s.ref}>
            <strong>[{s.ref}]</strong> <span className="pill !py-0 text-[0.65rem]">{KIND_LABEL[s.kind]}</span>{' '}
            {s.href ? (
              <Link to={s.href}>{s.title}</Link>
            ) : s.externalUrl ? (
              <a href={s.externalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function TutorChat() {
  const { enabled, size } = useChatUi();
  const loc = useLocation();
  const ctx = effectiveContext(useChatContext(), loc.pathname);
  const settingsVersion = useSyncExternalStore(subscribeByok, byokVersion);
  // 畫面顯示用；真正送出時另外在 send 開頭取一份快照，不使用這裡的值
  const { config, key } = loadByok();
  const ready = isConfigured(config, key);
  const conn = useConnection(ready ? config : null, key);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [requests, setRequests] = useState(0);
  const [sentChars, setSentChars] = useState(0);
  const { level } = useApp();
  const abort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  /** 最近一次已送出學習提問的情境（延續追問用）；清除對話時重設 */
  const lastLearningKey = useRef<string | null>(null);
  /** 情境世代：每次情境改變就 +1。等待中的請求只在世代未變時寫入延續資格（A→B→A 時世代已變，G2-R2） */
  const ctxGeneration = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inQuiz = loc.pathname.startsWith('/quiz/');

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);
  // 關閉功能、收合，或目前頁面進入鎖定（測驗交卷前）時，中止進行中或等待中的請求。
  // 中止只停止接收與尚未發出的請求；已開始計算的部分仍可能由 AI 服務計費。
  const ctxLocked = ctx.kind === 'locked';
  // 離開目前情境（換題、換講義、換頁）就讓延續追問資格失效；之後回到原情境也不恢復（A→B→A，G2）
  const ctxKeyNow = contextKeyOf(ctx);
  useEffect(() => {
    lastLearningKey.current = null;
    ctxGeneration.current += 1;
  }, [ctxKeyNow]);
  useEffect(() => {
    if ((!enabled || size === 'closed' || ctxLocked) && abort.current) abort.current.abort();
  }, [enabled, size, ctxLocked]);
  // AI 服務設定或金鑰改變（本頁另一個表單、清除金鑰或其他分頁）時，中止進行中的請求：
  // 尚未發出的不會送出，已在串流的停止接收，避免使用者以為還在用舊服務（Codex r2 R1）
  useEffect(() => {
    abort.current?.abort();
  }, [settingsVersion]);
  // 每次連線最長 30 分鐘：時間到就中止進行中的回答，之後需按「重新連線」
  const expired = conn.phase === 'expired';
  useEffect(() => {
    if (expired) abort.current?.abort();
  }, [expired]);

  if (!enabled) return null;

  const locked = ctx.kind === 'locked';

  /** 目前路徑（HashRouter）：送出流程中每次 await 後重新取得 */
  const currentPath = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/';
  /**
   * 送出一次提問。請求生命週期從按下送出就開始：先建立 AbortController，
   * 之後每一個 await 後、發出網路請求前，都重新確認「還是這一次請求、沒被中止、功能仍開啟、視窗沒收合、目前頁面沒有鎖定」，
   * 任何一項不成立就不送出（Codex F2：檢索期間關閉導師或進入考試，原本仍會送出）。
   */
  const send = async (text: string) => {
    const q = text.trim();
    // 送出當下取一份「設定＋金鑰」快照，整個請求只用這一份（Codex r2 R1 重現 B：不可混用舊設定與之後重新讀取的金鑰）
    const snap = loadByok();
    if (!q || sending.current || locked || !isConfigured(snap.config, snap.key) || isExpired(snap.config, snap.key)) return;
    const sendConfig = snap.config;
    const sendKey = snap.key;
    const reqId = ++requestSeq.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    sending.current = true;
    setStreaming(true);
    const stillValid = () => {
      const u = getChatUi();
      return (
        !ctrl.signal.aborted &&
        reqId === requestSeq.current &&
        byokVersion() === snap.version && // 設定或金鑰在等待期間改變：取消，不用舊快照送到任何地方
        !isExpired(sendConfig, sendKey) && // 等待期間連線到時（以截止時間判斷，背景分頁計時器延遲也擋得住）
        u.enabled &&
        u.size !== 'closed' &&
        effectiveContext(getChatContext(), currentPath()).kind !== 'locked'
      );
    };
    let placeholder = false; // 是否已在畫面加入這次的提問與空白回答
    try {
      // 送出前在本機檢查是否離題：與題庫無關的閒聊直接回覆提醒，不呼叫 AI、不產生用量
      const ctxCheck = effectiveContext(getChatContext(), currentPath());
      // 按下送出當下的情境世代（必須在任何等待之前記下）
      const generation = ctxGeneration.current;
      if (ctxCheck.kind === 'locked') return;
      const focus = ctxCheck.kind === 'question' ? ctxCheck.question.competencyCode : ctxCheck.kind === 'lesson' ? ctxCheck.code : undefined;
      const lv = getCompetency(focus ?? '')?.level ?? level;
      const [relevance, concepts] = await Promise.all([questionRelevance(lv, q), conceptHits(q)]);
      if (!stillValid()) return;
      // 延續追問：只在同一題／同一講義、且上一次已送出的是學習問題時（換題、換頁、清除對話後不延續）
      const ctxKey = contextKeyOf(ctxCheck);
      const verdict = topicVerdict(q, relevance, ctxCheck.kind === 'question' || ctxCheck.kind === 'lesson', { concepts, continuing: lastLearningKey.current === ctxKey });
      if (!verdict.ok) {
        setMessages((ms) => [
          ...ms,
          { role: 'user', content: q, local: true },
          { role: 'assistant', content: verdict.reply, local: true, blocked: { reason: verdict.reason, original: q } },
        ]);
        setInput('');
        return;
      }
      // 送給 AI 的對話排除錯誤與本機回覆；畫面上保留本機回覆。依據資料只附在這一次送出的訊息
      const history: Msg[] = [...messages.filter((m) => !m.error && !m.local), { role: 'user', content: q }];
      setMessages((ms) => [...ms.filter((m) => !m.error), { role: 'user', content: q }, { role: 'assistant', content: '' }]);
      placeholder = true;
      setInput('');
      const turn = await prepareTurn(effectiveContext(getChatContext(), currentPath()), q, level);
      if (!stillValid()) throw new DOMException('aborted', 'AbortError');
      // 這一題／這份講義已有送出的學習提問，之後的短追問可延續。
      // 只在仍停留在同一個情境時記錄：等待期間已離開的舊請求不能寫回過期資格（Codex 提問引導 G2）
      // 單看情境代碼不夠：等待中離開 A、到 B 再回 A 時代碼相同但世代已變，不可寫回（Codex 提問引導 G2-R2）
      if (ctxGeneration.current === generation && contextKeyOf(effectiveContext(getChatContext(), currentPath())) === ctxKey) lastLearningKey.current = ctxKey;
      const outgoing: ChatTurn[] = [...history.slice(0, -1).map(({ role, content }) => ({ role, content })), { role: 'user', content: turn.userMessage }];
      setRequests((n) => n + 1);
      setSentChars((n) => n + requestChars(turn.system, outgoing));
      setMessages((ms) => {
        const next = [...ms];
        next[next.length - 1] = { ...next[next.length - 1], sources: turn.sources };
        return next;
      });
      const result = await streamChat({
        config: sendConfig,
        apiKey: sendKey,
        system: turn.system,
        messages: outgoing,
        signal: ctrl.signal,
        onText: (d) => {
          // 串流中過了截止時間：立即中止（不等計時器）
          if (isExpired(sendConfig, sendKey)) return ctrl.abort();
          setMessages((ms) => {
            const next = [...ms];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + d };
            return next;
          });
        },
      });
      if (result.truncated)
        setMessages((ms) => {
          const next = [...ms];
          next[next.length - 1] = { ...next[next.length - 1], truncated: true };
          return next;
        });
    } catch (e) {
      if (!placeholder) return;
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setMessages((ms) => {
        const next = [...ms];
        const last = next[next.length - 1];
        if (aborted) next[next.length - 1] = { ...last, content: last.content ? `${last.content}

（已中止）` : '（已中止，沒有送出）' };
        else next[next.length - 1] = { role: 'assistant', content: e instanceof ByokError ? e.message : '發生錯誤，請稍後再試。', error: true };
        return next;
      });
    } finally {
      // 只有最新的一次請求可以解除鎖定
      if (reqId === requestSeq.current) {
        setStreaming(false);
        sending.current = false;
        abort.current = null;
      }
    }
  };

  /** 「連線／重新連線」：只讀取模型清單確認可用，不消耗 token；成功後開始新的 30 分鐘 */
  const reconnect = async () => {
    const snap = loadByok();
    if (!isConfigured(snap.config, snap.key) || connecting) return;
    setConnecting(true);
    try {
      await verifyConnection(snap.config, snap.key); // 無法事先確認時維持未連線並顯示原因（見提示列）
    } catch {
      // 失敗原因由連線狀態顯示（紅燈與說明）
    } finally {
      setConnecting(false);
    }
  };

  if (size === 'closed')
    return (
      <button
        type="button"
        className={`tutor-fab ${inQuiz ? 'tutor-fab-quiz' : ''}`}
        onClick={() => setChatUi({ size: 'normal' })}
        aria-label="開啟 AI 導師對話"
        data-testid="tutor-fab"
      >
        <Bot size={24} aria-hidden />
        {locked && <Lock size={12} className="tutor-fab-badge" aria-hidden />}
      </button>
    );

  const provider = config ? presetById(config.presetId).label : '';
  return (
    <section className={`tutor-chat tutor-chat-${size}`} role="dialog" aria-label="AI 導師對話" data-testid="tutor-chat">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Bot size={18} className="text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">AI 導師</h2>
            {ready && config && <SessionTimer config={config} apiKey={key} />}
          </div>
          <p className="truncate text-[0.7rem] text-muted" data-testid="tutor-chat-context">
            {ready && config ? <>{provider}・<ConnectionIndicator config={config} apiKey={key} /> {config.model}</> : '尚未設定 AI 服務'}・{contextLabel(ctx)}
          </p>
        </div>
        <button type="button" className="tutor-icon-btn" onClick={() => setShowSettings((v) => !v)} aria-label="AI 服務設定" aria-pressed={showSettings}>
          <Settings2 size={16} />
        </button>
        <button
          type="button"
          className="tutor-icon-btn"
          onClick={() => setChatUi({ size: size === 'large' ? 'normal' : 'large' })}
          aria-label={size === 'large' ? '縮小視窗' : '放大視窗'}
          data-testid="tutor-resize"
        >
          {size === 'large' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button type="button" className="tutor-icon-btn" onClick={() => setChatUi({ size: 'closed' })} aria-label="收合成圖示" data-testid="tutor-minimize">
          <Minus size={16} />
        </button>
        <button type="button" className="tutor-icon-btn" onClick={() => setChatUi({ enabled: false, size: 'closed' })} aria-label="關閉 AI 導師（可在設定重新開啟）">
          <X size={16} />
        </button>
      </header>

      {showSettings || !ready ? (
        <div className="flex-1 overflow-y-auto p-3">
          {!ready && <p className="mb-3 text-xs text-muted">使用自己的雲端或本機 AI 服務。設定完成前不會送出任何資料。</p>}
          <ByokSettings compact onSaved={() => setShowSettings(false)} />
        </div>
      ) : (
        <>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm" aria-live="polite" data-testid="tutor-chat-log">
            {locked ? (
              <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-xs">
                <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{ctx.reason}</span>
              </p>
            ) : (
              messages.length === 0 && (
                <div className="text-xs text-muted">
                  <p>
                    依目前頁面（{contextLabel(ctx)}）回答你的問題。只有按「送出」才會呼叫 AI 服務、產生用量；沒有對話就不會消耗。
                  </p>
                  {ctx.kind === 'question' && !ctx.answerVisible && <p className="mt-1">這題還沒提交，AI 只會給提示，不會直接說答案。</p>}
                </div>
              )
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'tutor-msg-user' : `tutor-msg-ai ${m.error ? 'text-bad' : ''}`}>
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <>
                    {m.content ? <Reply text={m.content} /> : <p className="text-muted">查閱本站資料並思考中…</p>}
                    {m.truncated && <p className="mt-1 text-[0.7rem] text-muted">（回答已達長度上限。需要時可以請它「繼續」或縮小問題範圍。）</p>}
                    {!m.error && !m.local && m.content && !(streaming && i === messages.length - 1) && <GroundingNote text={m.content} refs={m.sources?.map((s) => s.ref)} />}
                    {m.local && <p className="mt-1 text-[0.68rem] text-muted" data-testid="tutor-local-reply">（本機回覆，未送出、不產生用量）</p>}
                    {m.blocked && !locked && (
                      <BlockedGuide
                        blocked={m.blocked}
                        ctx={ctx}
                        onDraft={(d) => {
                          setInput(d);
                          inputRef.current?.focus();
                        }}
                      />
                    )}
                    {m.sources && !m.error && <Sources sources={m.sources} />}
                  </>
                )}
              </div>
            ))}
          </div>

          {!locked && (
            <div className="border-t border-line p-2">
              {conn.phase !== 'online' && conn.phase !== 'checking' && (
                <div
                  role={conn.phase === 'idle' ? undefined : 'alert'}
                  className={`mb-2 flex flex-wrap items-center gap-2 rounded-lg p-2 text-xs ${conn.phase === 'expired' ? 'bg-warn-soft' : conn.phase === 'offline' ? 'bg-bad-soft text-bad' : 'bg-soft text-muted'}`}
                  data-testid="tutor-connection-notice"
                  data-state={conn.phase}
                >
                  <span className="min-w-0 flex-1">
                    {conn.phase === 'expired'
                      ? (config && isBridgeUrl(config.baseUrl) ? '本機轉接程式的許可時間已到，已自動中斷。請在設定頁「本機暫時許可」按「重新啟動」，再按「重新連線」。' : '本次連線已滿 30 分鐘，已自動中斷。按「重新連線」開始新的 30 分鐘。')
                      : conn.phase === 'offline'
                        ? (conn.message ?? '連線失敗。')
                        : (conn.message ?? '尚未連線。可按「連線」先確認服務（不消耗 token），或直接提問。每次連線最長 30 分鐘。')}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {conn.phase === 'offline' && (
                      <button type="button" className="btn btn-ghost btn-sm !min-h-[32px] !px-2" onClick={() => setShowSettings(true)}>
                        設定
                      </button>
                    )}
                    <button type="button" className="btn btn-sm !min-h-[32px] !px-2" onClick={() => void reconnect()} disabled={connecting || streaming} data-testid="tutor-reconnect">
                      <PlugZap size={13} aria-hidden /> {connecting ? '連線中…' : conn.phase === 'idle' ? '連線' : '重新連線'}
                    </button>
                  </span>
                </div>
              )}
              {messages.length === 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {QUICK.map((t) => (
                    <button key={t} type="button" className="pill cursor-pointer" onClick={() => setInput(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <textarea
                  disabled={expired}
                  className="field !min-h-[44px] flex-1 resize-none !py-2 text-sm"
                  rows={2}
                  maxLength={2000}
                  value={input}
                  placeholder="輸入問題（Enter 送出，Shift+Enter 換行）"
                  aria-label="輸入給 AI 導師的問題"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  ref={inputRef}
                  data-testid="tutor-chat-input"
                />
                {streaming ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => abort.current?.abort()} aria-label="中止回答">
                    <Square size={14} />
                  </button>
                ) : (
                  <button type="submit" className="btn btn-sm" disabled={!input.trim() || expired} aria-label="送出" data-testid="tutor-chat-send">
                    <Send size={14} />
                  </button>
                )}
              </form>
              <div className="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted">
                <span>
                  本次已送出 {requests} 次請求、約 {sentChars.toLocaleString()} 字・只帶最近 {MAX_HISTORY} 則對話
                </span>
                {messages.length > 0 && (
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => { setMessages([]); lastLearningKey.current = null; }} disabled={streaming}>
                    <Trash2 size={12} /> 清除對話
                  </button>
                )}
              </div>
              <p className="mt-1 text-[0.68rem] text-muted">AI 生成內容可能有誤，標準答案以題目解析為準。</p>
            </div>
          )}
        </>
      )}
      {!ready && (
        <p className="border-t border-line px-3 py-2 text-[0.68rem] text-muted">
          也可以在 <Link to="/settings">設定 → AI 導師</Link> 管理。
        </p>
      )}
    </section>
  );
}
