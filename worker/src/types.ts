export type Bindings = {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  MAX_TURNS: string;
  // 既存（診断チャット）
  MONTHLY_LIMIT: string;
  MONTHLY_COUNTER: KVNamespace;
  // T-05 / T-19: 保護者レポート用 月間枠分配
  MONTHLY_LIMIT_PARENT_REPORT: string;
  MONTHLY_COUNTER_PARENT_REPORT: KVNamespace;
  RATE_LIMITER: {
    limit: (opts: { key: string }) => Promise<{ success: boolean }>;
  };
};
