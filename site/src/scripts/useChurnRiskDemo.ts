/**
 * useChurnRiskDemo — 退塾予兆 AI ミニデモの切替ロジック
 *
 * - タブ切替で aria-selected / hidden を更新
 * - 切替時に 2 段ローディング演出（0.0s → 0.4s → 0.8s 結果表示）
 * - count-up 再発火: CustomEvent('countup:retrigger')
 * - bar-grow 再発火: is-active 外してリフロー→再付与
 * - reduced-motion ON ではローディング演出スキップ
 */
function init() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[data-cr-tab]');
  if (tabs.length === 0) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.crTab;
      if (!id) return;

      // タブ aria-selected / 配色 の切替（active/inactive は CSS class に集約）
      tabs.forEach((t) => {
        const active = t.dataset.crTab === id;
        t.setAttribute('aria-selected', String(active));
        t.classList.toggle('cr-tab--active', active);
        t.classList.toggle('cr-tab--inactive', !active);
      });

      // 全パネル hidden の更新
      document.querySelectorAll<HTMLElement>('[data-cr-panel]').forEach((p) => {
        p.hidden = p.dataset.crPanel !== id;
      });

      // 対象パネルのローディング表示 → 0.8 秒後に結果表示
      const panel = document.querySelector<HTMLElement>(`[data-cr-panel="${id}"]`);
      if (!panel) return;

      const loading = panel.querySelector<HTMLElement>('[data-cr-loading]');
      const result = panel.querySelector<HTMLElement>('[data-cr-result]');
      if (!loading || !result) return;

      if (prefersReduced) {
        // reduced-motion 時はローディング演出スキップ、即時表示
        loading.hidden = true;
        result.hidden = false;
        retriggerCountUp(panel);
        retriggerBarGrow(panel);
        return;
      }

      // 通常時: 2 段ローディング表示
      loading.hidden = false;
      result.hidden = true;
      const loadingText = loading.querySelector<HTMLElement>('[data-cr-loading-text]');
      if (loadingText) loadingText.textContent = 'データを読み解いています...';

      window.setTimeout(() => {
        if (loadingText) loadingText.textContent = '生徒の様子を、確かめています...';
      }, 400);
      window.setTimeout(() => {
        loading.hidden = true;
        result.hidden = false;
        retriggerCountUp(panel);
        retriggerBarGrow(panel);
      }, 800);
    });
  });
}

function retriggerCountUp(panel: HTMLElement) {
  panel.querySelectorAll('.count-up').forEach((el) => {
    el.dispatchEvent(new CustomEvent('countup:retrigger', { bubbles: true }));
  });
}

function retriggerBarGrow(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.bar-grow').forEach((el) => {
    el.classList.remove('is-active');
    // 強制リフロー
    void el.offsetWidth;
    el.classList.add('is-active');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
