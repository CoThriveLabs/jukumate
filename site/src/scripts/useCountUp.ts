/**
 * useCountUp — カウントアップ共通ユーティリティ
 * 準拠: 設計書 v2 §6-A-2
 *
 * 対象: .count-up クラスを持つ要素
 * data-* 属性:
 *  - data-from   開始値（既定 0）
 *  - data-to     終了値（必須）
 *  - data-duration アニメ時間 ms（既定 1500）
 *  - data-suffix 終了値の後ろに付ける文字（"%" 等）
 *  - data-prefix 開始値の前に付ける文字
 *  - data-decimals 小数点桁数（既定 0）
 *
 * IO で見えた瞬間に発火、1 回限り（unobserve）。
 * prefers-reduced-motion: reduce 時は即時 to を表示。
 */

function formatValue(value: number, decimals: number, prefix: string, suffix: string): string {
  return (
    prefix +
    value.toLocaleString('ja-JP', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }) +
    suffix
  );
}

function animateCount(el: HTMLElement) {
  const from = parseFloat(el.dataset.from ?? '0');
  const to = parseFloat(el.dataset.to ?? '0');
  const duration = parseInt(el.dataset.duration ?? '1500', 10);
  const suffix = el.dataset.suffix ?? '';
  const prefix = el.dataset.prefix ?? '';
  const decimals = parseInt(el.dataset.decimals ?? '0', 10);

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    el.textContent = formatValue(to, decimals, prefix, suffix);
    return;
  }

  const startTs = performance.now();
  function tick(now: number) {
    const t = Math.min((now - startTs) / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    const value = from + (to - from) * eased;
    el.textContent = formatValue(value, decimals, prefix, suffix);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function init() {
  const els = document.querySelectorAll<HTMLElement>('.count-up');
  if (els.length === 0) return;
  const io = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          animateCount(e.target as HTMLElement);
          observer.unobserve(e.target);
        }
      });
    },
    { rootMargin: '-50px 0px', threshold: 0.5 }
  );
  els.forEach((el) => io.observe(el));

  // 5a の生徒切替で count-up を再発火させるためのカスタムイベント（§5-A-4）
  document.addEventListener('countup:retrigger', (e) => {
    const el = e.target as HTMLElement;
    if (!el || !el.classList || !el.classList.contains('count-up')) return;
    animateCount(el);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
