/**
 * useDiagnoseChat — 5b AI 診断チャットのクライアント JS
 *
 * - WORKER_URL を必須とし、未設定時はエラー表示
 * - 統一エラー文（UNIFIED_ERROR_MESSAGE）採用
 * - 5 ターン上限、500 文字上限
 */

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string | undefined) ?? '';
const MAX_TURNS = 5;
const MAX_CHARS = 500;

// エラー文を 1 種に統一（クライアント指示 / v1.x 仕様）
const UNIFIED_ERROR_MESSAGE =
  '申し訳ありません。AI が少しお休み中のようです。少し時間をおいてもう一度お試しいただくか、' +
  'お急ぎの場合は個別相談 30 分（無料）でも詳しくお伺いできます。';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DiagnoseResponse {
  reply: string;
  done?: boolean;
  isOfftopicRefusal?: boolean;
}

function init() {
  const form = document.querySelector<HTMLFormElement>('[data-dc-form]');
  if (!form) return;

  const input = form.querySelector<HTMLTextAreaElement>('[data-dc-input]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-dc-submit]')!;
  const counter = form.querySelector<HTMLElement>('[data-dc-counter]')!;
  const log = document.querySelector<HTMLElement>('[data-dc-log]')!;
  const turnCounter = document.querySelector<HTMLElement>('[data-dc-turn]')!;
  const errorBox = document.querySelector<HTMLElement>('[data-dc-error]')!;
  const ctaBox = document.querySelector<HTMLElement>('[data-dc-cta]')!;

  let history: ChatMessage[] = [];
  let turnsUsed = 0;
  // Worker 側 schemas で sessionId が必須。初回送信時に生成
  let sessionId: string | null = null;

  // 文字数カウント
  input.addEventListener('input', () => {
    const len = input.value.length;
    counter.textContent = `${len} / ${MAX_CHARS} 文字`;
    counter.classList.toggle('text-terracotta-cta-dark', len >= MAX_CHARS - 20);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();

    // バリデーション（フォーム側の簡易フィードバックは統一文言の対象外）
    if (!text) {
      showError('メッセージを入力してください');
      return;
    }
    if (text.length > MAX_CHARS) {
      showError(`${MAX_CHARS} 文字以内で入力してください`);
      return;
    }
    if (turnsUsed >= MAX_TURNS) {
      showCta();
      return;
    }
    if (!WORKER_URL) {
      showError(UNIFIED_ERROR_MESSAGE);
      return;
    }

    hideError();
    appendBubble('user', text);
    input.value = '';
    counter.textContent = `0 / ${MAX_CHARS} 文字`;
    submit.disabled = true;

    // ローディング bubble
    const loadingBubble = appendBubble('assistant', '…考えています…', true);

    try {
      if (!sessionId) {
        sessionId = crypto.randomUUID();
      }
      const res = await fetch(`${WORKER_URL}/api/diagnose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, history }),
      });

      if (!res.ok) {
        loadingBubble.remove();
        console.warn(`[diagnose] non-ok response: ${res.status}`);
        showError(UNIFIED_ERROR_MESSAGE);
        showCta();
        submit.disabled = false;
        return;
      }

      const data = (await res.json()) as DiagnoseResponse;

      loadingBubble.remove();
      appendBubble('assistant', data.reply);

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: data.reply });
      turnsUsed++;
      turnCounter.textContent = `残り ${MAX_TURNS - turnsUsed} ターン / ${MAX_TURNS}`;

      if (data.done || turnsUsed >= MAX_TURNS) {
        showCta();
        if (turnsUsed >= MAX_TURNS) {
          input.disabled = true;
          submit.disabled = true;
        } else {
          submit.disabled = false;
        }
      } else {
        submit.disabled = false;
      }
    } catch (err) {
      console.warn('[diagnose] fetch failed:', err);
      loadingBubble.remove();
      showError(UNIFIED_ERROR_MESSAGE);
      showCta();
      submit.disabled = false;
    }
  });

  function appendBubble(
    role: 'user' | 'assistant',
    text: string,
    isLoading = false
  ): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${role} chat-bubble-in flex gap-3 ${
      role === 'user' ? 'flex-row-reverse' : ''
    }`;

    const avatar = document.createElement('span');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.className =
      'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full font-display text-[12px] font-bold';
    avatar.style.cssText =
      role === 'assistant'
        ? 'background-color: var(--color-sage); color: var(--color-cream);'
        : 'background-color: var(--color-terracotta-cta); color: var(--color-cream);';
    avatar.textContent = role === 'assistant' ? 'JM' : 'You';

    const p = document.createElement('p');
    p.className = `bg-white rounded-[12px] px-4 py-3 text-[14px] md:text-[15px] leading-[1.85] text-ink max-w-[80%]${
      isLoading ? ' text-ink-soft italic' : ''
    }`;
    p.textContent = text;

    bubble.appendChild(avatar);
    bubble.appendChild(p);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function showError(msg: string) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function hideError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }
  function showCta() {
    ctaBox.hidden = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
