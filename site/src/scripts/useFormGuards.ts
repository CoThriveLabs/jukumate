/**
 * useFormGuards.ts — 汎用 LP フォームガード関数群
 *
 * 業界標準（Notion / HubSpot / Salesforce / Formspree 等の MA・フォームサービスで
 * デフォルト装備されている）スパム対策パターンを、純粋関数として再利用可能な形に切り出したもの。
 *
 * 設計方針:
 *   - JukuMate 専用ロジックを含めない（フィールド名・ストレージキーは引数で渡す）
 *   - 副作用は localStorage と Date.now() のみ（DI しやすい純関数寄り）
 *   - 各関数はクロージャでステートを保持し、呼び出し側に状態管理を漏らさない
 *
 * カバーする業界標準パターン:
 *   1. createTimingGuard       — ハニーポット ＋ 時間判定の「時間判定」部分。組合せ遮断率 約 99.5%
 *                                 （Reform.app / Ivyforms 等の業界記事合意値）
 *   2. createSubmitRateLimit   — 同一ブラウザ連投防止。フォームサービス（Formspree 等）の標準装備
 *
 * 関連リソース:
 *   - 調査レポート: MyCompany/docs/research/lp_form_security_industry_2026-05-19.md
 *   - playbook 章: saki_memories/playbook.md「LP フォームセキュリティ実装パターン」
 *
 * @module useFormGuards
 */

// =====================================================================
// 1. Timing Guard — 開封から送信までの最低秒数判定
// =====================================================================

/**
 * 表示〜送信までの経過時間が短すぎる場合に bot 判定するガード。
 *
 * ハニーポットと組み合わせると遮断率は約 99.5%（業界統計）。
 * 人間がフォームを認識・入力する時間として、3 秒（短文フォーム）〜
 * 15 秒（長文・複数項目）が目安。
 *
 * @param minMs - 「正常な人間の最低入力時間」のしきい値（ミリ秒）。デフォルト 3000ms
 * @returns ガードオブジェクト
 *
 * @example
 * const guard = createTimingGuard(3000);
 * onModalOpen(() => guard.mark());
 * onSubmit(() => {
 *   if (!guard.check()) return { ok: false, reason: 'too_fast' };
 *   // 通常送信処理
 * });
 */
export function createTimingGuard(minMs: number = 3000) {
  let openedAt = 0;
  return {
    /** フォーム表示時刻を記録（モーダル open 時等に呼ぶ） */
    mark: (): void => {
      openedAt = Date.now();
    },
    /** 経過時間が minMs 以上なら true（= 人間判定）、未満なら false（= bot 疑い） */
    check: (): boolean => Date.now() - openedAt >= minMs,
    /** mark からの経過ミリ秒。ログ・分析用 */
    elapsed: (): number => Date.now() - openedAt,
  };
}

// =====================================================================
// 2. Submit Rate Limit — 同一ブラウザの連投防止
// =====================================================================

/**
 * 同一ブラウザからの送信回数を localStorage で制限するガード。
 *
 * IP ベースのレート制限はサーバ側（Cloudflare Workers / WAF）で実施する想定で、
 * 本ガードは「同一ブラウザの UX 配慮（誤操作含む連投の防止）」を担当する。
 * localStorage が無効・破壊されていても安全に動く（fail-open）。
 *
 * @param storageKey - localStorage のキー識別子（フォーム別に分ける）。
 *                      内部で `formGuard:${storageKey}` として保存される
 * @param maxPerHour - 直近 1 時間あたりの最大送信回数。デフォルト 3
 * @returns ガードオブジェクト
 *
 * @example
 * const limit = createSubmitRateLimit('jukumate_reservation', 3);
 * onSubmit(() => {
 *   if (!limit.canSubmit()) return { ok: false, reason: 'rate_limit' };
 *   limit.record();
 *   // 通常送信処理
 * });
 */
export function createSubmitRateLimit(storageKey: string, maxPerHour: number = 3) {
  const KEY = `formGuard:${storageKey}`;
  const HOUR = 3600 * 1000;

  function getRecords(): number[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'number') : [];
    } catch {
      return [];
    }
  }

  function setRecords(records: number[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(KEY, JSON.stringify(records));
    } catch {
      /* QuotaExceeded / SecurityError は無視（fail-open） */
    }
  }

  return {
    /** 送信可能なら true、レート上限に達していたら false */
    canSubmit: (): boolean => {
      const now = Date.now();
      const recent = getRecords().filter((t) => now - t < HOUR);
      return recent.length < maxPerHour;
    },
    /** 送信が成功したタイミングで呼び出して履歴に追加する */
    record: (): void => {
      const now = Date.now();
      const recent = getRecords().filter((t) => now - t < HOUR);
      recent.push(now);
      setRecords(recent);
    },
    /** テスト・デバッグ用に履歴を全消去する */
    reset: (): void => {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(KEY);
      } catch {
        /* noop */
      }
    },
    /** 残り送信可能回数（0 以上）。UI 表示・ログ用 */
    remaining: (): number => {
      const now = Date.now();
      const recent = getRecords().filter((t) => now - t < HOUR);
      return Math.max(0, maxPerHour - recent.length);
    },
  };
}
