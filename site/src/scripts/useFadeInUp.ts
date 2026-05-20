/**
 * useFadeInUp — IntersectionObserver 共通ユーティリティ
 * 準拠: 設計書 v2 §6-A-1
 * v1.5 (Phase 3c-1): PageEdge 廃止に伴い .line-grow-x / .dome-rise セレクタを削除
 * v1.6 (2026-05-19): SectionLabel 廃止に伴い .line-grow セレクタを削除
 *
 * 対象セレクタ:
 *  - .js-fadeInUp
 *  - .bar-grow
 *  - #problems .mask-up, #solution .mask-up, #features .mask-up
 *    （Hero 内 .mask-up は §B-1 で直接発火するため除外）
 *
 * prefers-reduced-motion: reduce 時は即時 .is-active 付与で最終状態を表示。
 */

type IoConfig = { selector: string; rootMargin: string; threshold: number };

const configs: IoConfig[] = [
  // v1.10 (T-10): 「各セクションが画面中央に来たとき」発火に変更（仕様変更）
  // 上下それぞれ viewport 高の 30% をカット → 中央 40% に entry が一部でも入ったときに intersect
  { selector: '.js-fadeInUp', rootMargin: '-30% 0px -30% 0px', threshold: 0 },
  { selector: '.bar-grow', rootMargin: '-30% 0px -30% 0px', threshold: 0 },
  {
    selector:
      '#problems .mask-up, #solution .mask-up, #features .mask-up, #ai-experience .mask-up, #pricing .mask-up, #faq .mask-up, #beta .mask-up',
    rootMargin: '-30% 0px -30% 0px',
    threshold: 0,
  },
];

/**
 * /privacy や /terms から `/#features` 等のハッシュ付き URL でトップに戻った際、
 * 対象セクション内のアニメ要素を即時 .is-active で表示する。
 * IO はページ読込時に既に viewport 内にある要素を発火しないケースがあるための保険。
 */
function activateHashTarget(observers: IntersectionObserver[]) {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return;

  // CSS.escape で安全にセレクタ化（数字始まり・特殊文字対応）
  let target: Element | null = null;
  try {
    target = document.querySelector(hash);
  } catch {
    return;
  }
  if (!target) return;

  // 対象セクション内の全アニメ対象セレクタを集約して即発火
  const sel = configs.map((c) => c.selector).join(', ');
  const animEls = target.querySelectorAll(sel);
  animEls.forEach((el) => {
    el.classList.add('is-active');
    // 既存 IO から監視解除（二重発火防止）
    observers.forEach((io) => io.unobserve(el));
  });
}

function init() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    configs.forEach(({ selector }) => {
      document.querySelectorAll(selector).forEach((el) => el.classList.add('is-active'));
    });
    return;
  }

  const observers: IntersectionObserver[] = [];

  configs.forEach(({ selector, rootMargin, threshold }) => {
    const els = document.querySelectorAll(selector);
    if (els.length === 0) return;
    // ★初回1回だけ発火: 一度 .is-active を付与したら observer.unobserve で監視解除し、
    //   以降スクロールで画面を行き来しても再アニメしない。
    const io = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-active');
            observer.unobserve(e.target);
          }
        });
      },
      { rootMargin, threshold }
    );
    els.forEach((el) => io.observe(el));
    observers.push(io);
  });

  // hash 付き読込時は対象セクションを即時発火（IO 取りこぼし対策）
  if (document.readyState === 'complete') {
    activateHashTarget(observers);
  } else {
    window.addEventListener('load', () => activateHashTarget(observers), { once: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
