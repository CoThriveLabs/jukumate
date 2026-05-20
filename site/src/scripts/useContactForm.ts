/**
 * useContactForm.ts — 動的予約フォーム クライアントロジック
 *
 * 役割:
 *   1. モーダル open/close 制御（focus trap + scroll lock + ESC キー対応）
 *   2. flatpickr 初期化（multiple mode、上限 3、平日のみ、翌々日以降、disableMobile:true）
 *   3. submit ハンドラ: バリデーション → fetch（preflight 回避: text/plain）→ 状態遷移
 *   4. 状態管理: idle / submitting / success / error
 *   5. ハニーポット値はそのままサーバへ送る（クライアントで弾かない）
 *
 * 既存資産との関係:
 *   - 既存 MobileMenu のスクロールロック機構（html[data-scroll-lock="true"]）を流用
 *   - global.css `.contact-modal` / `.cf-*` クラスに依存
 */

import flatpickr from 'flatpickr';
import { Japanese } from 'flatpickr/dist/l10n/ja.js';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';
import { createTimingGuard, createSubmitRateLimit } from './useFormGuards';
import { $, $$ } from './_dom';

// ====== 設定値（設計書 §3-3-b） ======

const MAX_CANDIDATES = 3;
const MIN_DAYS_AHEAD = 2;

// 環境変数経由で GAS Web App URL を取得（設計書 §10-1）
// `PUBLIC_` プレフィックスで Astro がクライアントバンドルに含める
const GAS_URL = (import.meta.env.PUBLIC_GAS_URL as string | undefined) ?? '';

// 列挙値ガード（GAS 側 validate と同じ）
const ALLOWED_TARGETS = ['chuju', 'koju', 'daiju', 'sogo'] as const;
const ALLOWED_SLOTS = ['morning', 'afternoon', 'evening'] as const;
const ALLOWED_COUNTS = ['〜30', '31-80', '81-150', '151-300', '301〜'] as const;

type CfState = 'idle' | 'submitting' | 'success' | 'error';

// ====== セキュリティ: Turnstile token + Guards ======

// Turnstile JS が成功時に呼ぶグローバルコールバック。TurnstileWidget の
// data-callback="onTurnstileSuccess" と対応。モックモードでは MOCKED_TOKEN_FOR_LOCAL_DEV が来る。
let turnstileToken: string | null = null;

interface TurnstileApi {
  getResponse?: () => string | undefined;
  reset?: () => void;
}

declare global {
  interface Window {
    onTurnstileSuccess?: (token: string) => void;
    /** Playwright 等のテストから最新トークンを参照するためのフック */
    __LAST_TURNSTILE_TOKEN__?: string;
    turnstile?: TurnstileApi;
  }
}

/** 内部・外部双方の Turnstile token 受領経路を 1 箇所に集約 */
function setTurnstileToken(token: string) {
  turnstileToken = token;
  window.__LAST_TURNSTILE_TOKEN__ = token;
}

if (typeof window !== 'undefined') {
  window.onTurnstileSuccess = (token: string) => {
    setTurnstileToken(token);
  };
}

// 時間判定（モーダル open 〜 submit までの最低 3 秒）
const timingGuard = createTimingGuard(3000);
// 同一ブラウザの連投制限（1 時間あたり最大 3 回）
const SUBMIT_RATE_MAX_PER_HOUR = 3;
const rateLimit = createSubmitRateLimit('jukumate_reservation', SUBMIT_RATE_MAX_PER_HOUR);

// ====== モーダル制御 ======

let fpInstance: FlatpickrInstance | null = null;
let lastFocusBeforeOpen: HTMLElement | null = null;
let savedScrollY = 0;

function setState(form: HTMLFormElement, state: CfState) {
  form.setAttribute('data-cf-state', state);

  const submitBtn = $<HTMLButtonElement>('[data-contact-submit]', form);
  const submitLabel = submitBtn ? $('.cf-btn-label', submitBtn) : null;

  if (submitBtn) {
    submitBtn.disabled = state === 'submitting' || state === 'success';
    if (submitLabel) {
      if (state === 'submitting') {
        submitLabel.innerHTML = '<span class="cf-spinner" aria-hidden="true"></span> 送信中...';
      } else {
        submitLabel.textContent = '送信する';
      }
    }
  }

  // 閉じるボタンの無効化（送信中のみ）
  $$('[data-contact-modal-close]').forEach((btn) => {
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = state === 'submitting';
    }
  });

  if (state === 'success') {
    // 完了画面にフォーカス移動（スクリーンリーダー読み上げのため）
    const successEl = $('[data-cf-success]', form);
    if (successEl instanceof HTMLElement) {
      successEl.focus();
    }
  }
}

function openModal() {
  const modal = $('#contact-modal');
  if (!modal) return;

  lastFocusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  modal.removeAttribute('hidden');
  modal.setAttribute('aria-modal', 'true');

  // 既存 MobileMenu のスクロールロック機構を流用（position:fixed + scrollY 保存）
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${savedScrollY}px`;
  document.documentElement.setAttribute('data-scroll-lock', 'true');

  // フォームをリセット（前回の入力残しを消す）
  const form = $<HTMLFormElement>('[data-contact-form]', modal);
  if (form) {
    form.reset();
    setState(form, 'idle');
    clearAllErrors(form);
  }

  // flatpickr 初期化（初回のみ。再 open でも残す）
  initFlatpickrIfNeeded();
  if (fpInstance) {
    fpInstance.clear();
  }
  renderCandidatesSummary([]);

  // 開封タイムスタンプを記録（submit 時に最低秒数判定に使う）
  timingGuard.mark();

  // 最初のフォーカス可能要素にフォーカス
  requestAnimationFrame(() => {
    const firstInput = $<HTMLInputElement>('#cf-juku-name', modal);
    if (firstInput) firstInput.focus();
  });
}

function closeModal(force = false) {
  const modal = $('#contact-modal');
  if (!modal) return;

  const form = $<HTMLFormElement>('[data-contact-form]', modal);
  // 送信中は強制でない限り閉じない
  if (!force && form?.getAttribute('data-cf-state') === 'submitting') {
    return;
  }

  modal.setAttribute('hidden', '');
  modal.removeAttribute('aria-modal');
  document.documentElement.removeAttribute('data-scroll-lock');
  // body の固定を解除 + スクロール位置を復元
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);

  // フォーカスを呼び出し元へ戻す
  if (lastFocusBeforeOpen && document.contains(lastFocusBeforeOpen)) {
    lastFocusBeforeOpen.focus();
  }
}

// ====== focus trap（Tab / Shift+Tab） ======

function getFocusable(modal: HTMLElement): HTMLElement[] {
  return $$<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    modal
  ).filter((el) => {
    // visible のものだけ（display:none 等は除外）
    return el.offsetParent !== null || el === document.activeElement;
  });
}

function handleTabTrap(e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const modal = $('#contact-modal');
  if (!modal || modal.hasAttribute('hidden')) return;

  const focusable = getFocusable(modal);
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (e.shiftKey) {
    if (active === first || !modal.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ====== flatpickr ======

function renderCandidatesSummary(dates: Date[]) {
  const summaryEl = $('[data-cf-candidates-summary]');
  if (!summaryEl) return;

  if (dates.length === 0) {
    summaryEl.innerHTML = '';
    return;
  }

  const fmt = new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const items = dates
    .map((d, i) => `<li>第 ${i + 1} 候補: ${fmt.format(d)}</li>`)
    .join('');
  summaryEl.innerHTML = `<ol>${items}</ol>`;
}

function initFlatpickrIfNeeded() {
  if (fpInstance) return;
  const input = $<HTMLInputElement>('#cf-candidates');
  if (!input) return;

  const minDate = new Date();
  minDate.setHours(0, 0, 0, 0);
  minDate.setDate(minDate.getDate() + MIN_DAYS_AHEAD);

  fpInstance = flatpickr(input, {
    mode: 'multiple',
    locale: Japanese,
    dateFormat: 'Y-m-d',
    minDate,
    disableMobile: true,
    allowInput: false,
    // 平日のみ（土日 disable）
    disable: [(date: Date) => date.getDay() === 0 || date.getDay() === 6],
    onChange: (selectedDates: Date[], _dateStr: string, instance: FlatpickrInstance) => {
      let dates = selectedDates;
      if (dates.length > MAX_CANDIDATES) {
        // 直近の選択を切り詰め
        dates = dates.slice(0, MAX_CANDIDATES);
        instance.setDate(dates, false);
        showInlineErrorFor('candidates', `希望日時は最大 ${MAX_CANDIDATES} 候補までです。`);
      } else {
        clearInlineErrorFor('candidates');
      }
      renderCandidatesSummary(dates);
    },
  }) as FlatpickrInstance;
}

// ====== バリデーション（クライアント側） ======

interface FormPayload {
  juku_name: string;
  contact_name: string;
  email: string;
  student_count: string;
  target: string;
  existing_saas: string;
  candidates: string[];
  time_slot: string;
  consent: boolean;
  website: string;
  origin: string;
  /** Cloudflare Turnstile token（モック時は MOCKED_TOKEN_FOR_LOCAL_DEV） */
  turnstileToken: string;
}

function getTrimmed(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '').trim();
}

function collectPayload(form: HTMLFormElement): FormPayload {
  const fd = new FormData(form);
  const selectedDates = fpInstance ? fpInstance.selectedDates : [];
  const candidates = selectedDates.map((d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  return {
    juku_name: getTrimmed(fd, 'juku_name'),
    contact_name: getTrimmed(fd, 'contact_name'),
    email: getTrimmed(fd, 'email'),
    student_count: String(fd.get('student_count') ?? ''),
    target: String(fd.get('target') ?? ''),
    existing_saas: getTrimmed(fd, 'existing_saas'),
    candidates,
    time_slot: String(fd.get('time_slot') ?? ''),
    consent: fd.get('consent') === 'on',
    website: String(fd.get('website') ?? ''),
    origin: window.location.origin,
    turnstileToken: turnstileToken ?? '',
  };
}

// 簡易メール正規表現（GAS validate と同じ）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidationError {
  field: string;
  message: string;
}

function validatePayload(p: FormPayload): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!p.juku_name) errors.push({ field: 'juku_name', message: '塾名をご入力ください。' });
  else if (p.juku_name.length > 80) errors.push({ field: 'juku_name', message: '塾名は 80 文字以内でご入力ください。' });

  if (!p.contact_name) errors.push({ field: 'contact_name', message: 'ご担当者名をご入力ください。' });
  else if (p.contact_name.length > 40) errors.push({ field: 'contact_name', message: 'ご担当者名は 40 文字以内でご入力ください。' });

  if (!p.email) errors.push({ field: 'email', message: 'メールアドレスをご入力ください。' });
  else if (!EMAIL_RE.test(p.email) || p.email.length > 200) errors.push({ field: 'email', message: 'メールアドレスをご確認ください。' });

  if (!(ALLOWED_COUNTS as readonly string[]).includes(p.student_count))
    errors.push({ field: 'student_count', message: '生徒数をご選択ください。' });

  if (!(ALLOWED_TARGETS as readonly string[]).includes(p.target))
    errors.push({ field: 'target', message: '対象学年帯をご選択ください。' });

  if (p.existing_saas && p.existing_saas.length > 200)
    errors.push({ field: 'existing_saas', message: '既存の塾管理ソフトは 200 文字以内でご入力ください。' });

  if (p.candidates.length < 1 || p.candidates.length > 3)
    errors.push({ field: 'candidates', message: '希望日時を 1〜3 候補ご選択ください。' });

  if (!(ALLOWED_SLOTS as readonly string[]).includes(p.time_slot))
    errors.push({ field: 'time_slot', message: '希望時間帯をご選択ください。' });

  if (p.consent !== true) errors.push({ field: 'consent', message: '個人情報の取扱方針への同意が必要です。' });

  return errors;
}

function showInlineErrorFor(field: string, message: string) {
  const errEl = $(`[data-cf-error-for="${field}"]`);
  if (errEl) errEl.textContent = message;

  // 入力要素に aria-invalid="true" を立てる
  const inputs = $$<HTMLElement>(`[name="${field}"]`);
  inputs.forEach((el) => el.setAttribute('aria-invalid', 'true'));
}

function clearInlineErrorFor(field: string) {
  const errEl = $(`[data-cf-error-for="${field}"]`);
  if (errEl) errEl.textContent = '';
  const inputs = $$<HTMLElement>(`[name="${field}"]`);
  inputs.forEach((el) => el.removeAttribute('aria-invalid'));
}

function clearAllErrors(form: HTMLFormElement) {
  $$('[data-cf-error-for]', form).forEach((el) => {
    el.textContent = '';
  });
  $$<HTMLElement>('[aria-invalid="true"]', form).forEach((el) => {
    el.removeAttribute('aria-invalid');
  });
}

// GAS 応答の error コード → 表示メッセージ
const GAS_ERROR_MESSAGES: Record<string, { field?: string; message: string }> = {
  invalid_juku_name:
    { field: 'juku_name', message: '塾名を 1〜80 文字でご入力ください。' },
  invalid_contact_name:
    { field: 'contact_name', message: 'ご担当者名を 1〜40 文字でご入力ください。' },
  invalid_email:
    { field: 'email', message: 'メールアドレスをご確認ください。' },
  invalid_student_count:
    { field: 'student_count', message: '生徒数をご選択ください。' },
  invalid_target:
    { field: 'target', message: '対象学年帯をご選択ください。' },
  invalid_existing_saas:
    { field: 'existing_saas', message: '既存の塾管理ソフトは 200 文字以内でご入力ください。' },
  invalid_candidates:
    { field: 'candidates', message: '希望日時を 1〜3 候補ご選択ください。' },
  invalid_time_slot:
    { field: 'time_slot', message: '希望時間帯をご選択ください。' },
  consent_required:
    { field: 'consent', message: '個人情報の取扱方針への同意が必要です。' },
  invalid_origin:
    { message: '送信元エラーが発生しました。ページを再読み込みしてお試しください。' },
  // サーバ verifyTurnstileToken 系
  turnstile_missing_token:
    { message: 'セキュリティ確認が完了していません。少し待ってから再度お試しください。' },
  turnstile_failed:
    { message: 'セキュリティ確認に失敗しました。ページを再読み込みしてお試しください。' },
  turnstile_invalid_response:
    { message: 'セキュリティ確認の応答が不正でした。時間をおいて再度お試しください。' },
  turnstile_network_error:
    { message: 'セキュリティ確認の通信に失敗しました。時間をおいて再度お試しください。' },
};

const FALLBACK_SERVER_ERROR =
  '送信に失敗しました。時間をおいて再度お試しください。';

/**
 * GAS から返ったエラーコードを field エラー or バナー or 汎用エラーへ振り分け。
 * field 指定があればインラインに、なければバナーに表示する。
 */
function applyServerError(form: HTMLFormElement, code: string) {
  const entry = GAS_ERROR_MESSAGES[code];
  if (!entry) {
    showBannerError(form, FALLBACK_SERVER_ERROR);
    return;
  }
  if (entry.field) {
    showInlineErrorFor(entry.field, entry.message);
    setState(form, 'idle');
    const target = $<HTMLElement>(`[name="${entry.field}"]`);
    if (target) target.focus();
    return;
  }
  showBannerError(form, entry.message);
}

// ====== submit ハンドラ ======

function showBannerError(form: HTMLFormElement, message: string) {
  setState(form, 'error');
  const banner = $<HTMLElement>('[data-cf-error-banner]', form);
  if (banner) banner.textContent = message;
}

async function handleSubmit(e: SubmitEvent) {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;

  // 二重送信ガード
  if (form.getAttribute('data-cf-state') === 'submitting') return;

  clearAllErrors(form);

  // ====== セキュリティガード（バリデーション前に弾く） ======
  // 1. 時間判定: モーダル開封から 3 秒未満 = bot 疑い
  if (!timingGuard.check()) {
    showBannerError(form, '送信が早すぎます。内容をご確認のうえ、もう一度お試しください。');
    return;
  }

  // 2. 連投制限: 同一ブラウザの 1 時間あたり送信上限
  if (!rateLimit.canSubmit()) {
    showBannerError(
      form,
      `送信回数の上限に達しました（1 時間あたり ${SUBMIT_RATE_MAX_PER_HOUR} 回まで）。時間をおいて再度お試しください。`
    );
    return;
  }

  // 3. Turnstile token 必須（モック時は MOCKED_TOKEN_FOR_LOCAL_DEV が入っている想定）
  //    window.onTurnstileSuccess が定義される前に Cloudflare 公式 JS が token を発火すると
  //    token がロストするため、submit 時に turnstile.getResponse() で pull 取得を試行。
  if (!turnstileToken) {
    const turnstileApi = window.turnstile;
    if (turnstileApi && typeof turnstileApi.getResponse === 'function') {
      const fallbackToken = turnstileApi.getResponse();
      if (fallbackToken) {
        setTurnstileToken(fallbackToken);
      }
    }
  }
  if (!turnstileToken) {
    showBannerError(form, 'セキュリティ確認を完了してください。');
    return;
  }

  const payload = collectPayload(form);

  // クライアント側バリデーション
  const errors = validatePayload(payload);
  if (errors.length > 0) {
    errors.forEach((err) => showInlineErrorFor(err.field, err.message));
    // 最初のエラー要素にフォーカス
    const firstField = errors[0].field;
    const target = $<HTMLElement>(`[name="${firstField}"]`);
    if (target) target.focus();
    return;
  }

  setState(form, 'submitting');

  // GAS_URL 未設定時はモック扱い（テスト時にも有用）
  if (!GAS_URL || GAS_URL.includes('REPLACE_WITH')) {
    // eslint-disable-next-line no-console
    console.warn('[useContactForm] PUBLIC_GAS_URL is not configured. Submission would be sent to:', GAS_URL);
    showBannerError(form, '送信先が未設定です。サイト管理者へお問い合わせください。');
    return;
  }

  try {
    // ★ CORS preflight 回避: Content-Type を text/plain にして simple request 化
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    // GAS は HTTP 200 + JSON ボディで ok/ng 判定（設計書 §2-2 / §4-5）
    const raw = await res.text();
    let json: { ok?: boolean; error?: string } = {};
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error('invalid_response_format');
    }

    if (json.ok === true) {
      // 送信成功時のみレート履歴へ記録（失敗時に再試行を妨げない）
      rateLimit.record();
      setState(form, 'success');
      return;
    }

    // フィールド別 / 全体エラー応答処理
    applyServerError(form, json.error ?? 'unknown_error');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[useContactForm] submit failed:', err);
    showBannerError(form, FALLBACK_SERVER_ERROR);
  }
}

// ====== グローバル初期化 ======

function init() {
  // トリガボタン（複数あっても全てバインド）
  $$<HTMLElement>('[data-form-trigger]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  });

  // 閉じる系
  $$<HTMLElement>('[data-contact-modal-close]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  });

  // 背景クリックで閉じる（ダイアログ外クリック）
  const modal = $('#contact-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const dialog = $('[data-contact-modal-dialog]', modal);
      if (dialog && !dialog.contains(target) && target === modal) {
        closeModal();
      }
    });
  }

  // ESC キーで閉じる + Tab トラップ
  document.addEventListener('keydown', (e) => {
    const m = $('#contact-modal');
    if (!m || m.hasAttribute('hidden')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    } else if (e.key === 'Tab') {
      handleTabTrap(e);
    }
  });

  // submit
  const form = $<HTMLFormElement>('[data-contact-form]');
  if (form) {
    form.addEventListener('submit', handleSubmit);

    // 入力時にインラインエラーをクリア
    form.addEventListener('input', (e) => {
      const target = e.target as HTMLElement;
      const name = target.getAttribute('name');
      if (name) clearInlineErrorFor(name);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
