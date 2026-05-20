/**
 * sample-students.ts — 5a 退塾予兆 AI ミニデモ用 架空生徒データ
 * 準拠: Phase 3b 設計書 §5-A-1（v1.1 確定）
 *
 * 3 人とも完全な架空人物。出席率・宿題提出率・成績推移はすべて創作値。
 * 実在の生徒・保護者を表すものではありません。
 */

export type RiskLevel = 'high' | 'mid' | 'low';

export interface Trend {
  /** 月 1-6 のいずれか（1 = 6 ヶ月前、6 = 今月） */
  month: number;
  /** 0-100 の偏差値スコア */
  value: number;
}

export interface SampleStudent {
  id: 'a' | 'b' | 'c';
  /** 架空生徒名（ひらがな）。v1.3: 絵文字は使用しない（projects.md L94 準拠）。
   *  UI 側で sprout.svg アイコン + 「（サンプル）」テキストバッジを displayName 右隣に配置 */
  displayName: string;
  grade: string;
  /** 直近 1 ヶ月の出席率（%、0-100） */
  attendance: number;
  /** 直近 1 ヶ月の宿題提出率（%、0-100） */
  homework: number;
  /** 直近 6 ヶ月の成績推移 */
  scoreTrend: Trend[];
  risk: RiskLevel;
  /** AI が出力した想定理由（1-5 行構成、断定回避 + 次アクション提案で締める） */
  reasons: string[];
}

export const sampleStudents: SampleStudent[] = [
  {
    id: 'a',
    displayName: 'あおいさん',
    grade: '中2',
    attendance: 71,
    homework: 54,
    scoreTrend: [
      { month: 1, value: 62 },
      { month: 2, value: 61 },
      { month: 3, value: 59 },
      { month: 4, value: 56 },
      { month: 5, value: 54 },
      { month: 6, value: 52 },
    ],
    risk: 'high',
    reasons: [
      '直近1ヶ月で出席率が92% → 71%に低下しています。',
      '宿題提出率も88% → 54%と並行して落ち込んでおり、',
      '学習リズムに小さなつまずきが出ている可能性があります。',
      '保護者面談や個別声かけのタイミングかもしれません。',
    ],
  },
  {
    id: 'b',
    displayName: 'ひなたくん',
    grade: '中3',
    attendance: 88,
    homework: 82,
    scoreTrend: [
      { month: 1, value: 60 },
      { month: 2, value: 60 },
      { month: 3, value: 61 },
      { month: 4, value: 60 },
      { month: 5, value: 60 },
      { month: 6, value: 60 },
    ],
    risk: 'mid',
    reasons: [
      '定期テストの順位は安定していますが、自習室の滞在時間が',
      '直近3週間で平均45分短くなっています。',
      '授業中の発言頻度もやや減少傾向にあります。',
      '進路への迷いが背景にあるかもしれません。',
      '受験期ならではの揺れに、早めにそっと寄り添う機会を。',
    ],
  },
  {
    id: 'c',
    displayName: 'そらくん',
    grade: '小6',
    attendance: 100,
    homework: 96,
    scoreTrend: [
      { month: 1, value: 62 },
      { month: 2, value: 64 },
      { month: 3, value: 66 },
      { month: 4, value: 68 },
      { month: 5, value: 69 },
      { month: 6, value: 70 },
    ],
    risk: 'low',
    reasons: [
      '出席率100%、宿題提出率96%を維持しています。',
      '直近2ヶ月で算数の正答率も +8 ポイント改善。',
      '学習リズムは安定しており、現在のサポート方針が',
      'うまく機能している状態です。次回保護者会では',
      '具体的なエピソードをそえて、ご家庭にお伝えできると好印象です。',
    ],
  },
];
