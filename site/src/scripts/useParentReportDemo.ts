// site/src/scripts/useParentReportDemo.ts
// 保護者レポート下書きデモ（1 ターン完結）
//
// - WORKER_URL を必須とし、未設定時はエラー表示
// - 統一エラー文を採用（DiagnoseChat と同等）
// - sessionId は UUID で生成し Worker 側 schema (z.string().uuid()) と整合

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string | undefined) ?? '';
const MAX_CHARS = 800;
const MIN_CHARS = 10;

const UNIFIED_ERROR_MESSAGE =
  '申し訳ありません。AI が少しお休み中のようです。少し時間をおいてもう一度お試しいただくか、' +
  'お急ぎの場合は個別相談 30 分（無料）でも詳しくお伺いできます。';

function init() {
  const form = document.querySelector<HTMLFormElement>('[data-pr-form]');
  if (!form) return;
  const input = form.querySelector<HTMLTextAreaElement>('[data-pr-input]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-pr-submit]')!;
  const counter = form.querySelector<HTMLElement>('[data-pr-counter]')!;
  const loading = document.querySelector<HTMLElement>('[data-pr-loading]')!;
  const result = document.querySelector<HTMLElement>('[data-pr-result]')!;
  const resultText = document.querySelector<HTMLElement>('[data-pr-text]')!;
  const errorBox = document.querySelector<HTMLElement>('[data-pr-error]')!;

  let sessionId: string | null = null;

  input.addEventListener('input', () => {
    const len = input.value.length;
    counter.textContent = `${len} / ${MAX_CHARS} 文字`;
    counter.classList.toggle('text-terracotta-cta-dark', len >= MAX_CHARS - 30);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text.length < MIN_CHARS) {
      showError(`${MIN_CHARS} 文字以上で入力してください`);
      return;
    }
    if (text.length > MAX_CHARS) {
      showError(`${MAX_CHARS} 文字以内で入力してください`);
      return;
    }
    if (!WORKER_URL) {
      showError(UNIFIED_ERROR_MESSAGE);
      return;
    }
    hideError();
    result.hidden = true;
    loading.hidden = false;
    submit.disabled = true;

    try {
      if (!sessionId) sessionId = crypto.randomUUID();
      const res = await fetch(`${WORKER_URL}/api/parent-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, input: text }),
      });
      if (!res.ok) {
        console.warn(`[parent-report] non-ok: ${res.status}`);
        showError(UNIFIED_ERROR_MESSAGE);
        return;
      }
      const data = (await res.json()) as { reply: string };
      resultText.textContent = data.reply;
      result.hidden = false;
    } catch (err) {
      console.warn('[parent-report] fetch failed:', err);
      showError(UNIFIED_ERROR_MESSAGE);
    } finally {
      loading.hidden = true;
      submit.disabled = false;
    }
  });

  function showError(msg: string) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function hideError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
