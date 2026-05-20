// site/src/scripts/_dom.ts
// DOM セレクタヘルパー共通切り出し（useContactForm / useDiagnoseChat /
// useParentReportDemo / useChurnRiskDemo で再利用）

/** root（既定: document）から最初の一致要素を返す。なければ null */
export function $<T extends HTMLElement = HTMLElement>(
  sel: string,
  root: ParentNode = document
): T | null {
  return root.querySelector(sel) as T | null;
}

/** root（既定: document）から全一致要素の配列を返す（NodeList ではなく Array） */
export function $$<T extends HTMLElement = HTMLElement>(
  sel: string,
  root: ParentNode = document
): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}
