import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // wrangler.toml の vars / KV / unsafe.bindings をテスト環境に取り込む
        wrangler: { configPath: './wrangler.toml' },
        // miniflare 側で KV namespace を ID なしで上書き定義
        // (本番 wrangler.toml の id / preview_id はテストでは不要、毎回クリーンに作る)
        miniflare: {
          kvNamespaces: ['MONTHLY_COUNTER', 'MONTHLY_COUNTER_PARENT_REPORT'],
          compatibilityFlags: ['nodejs_compat'],
          // 本番 secret は wrangler secret put で別管理。テストではダミーを注入
          // (Anthropic SDK は vi.mock 済みなので実通信は発生しない)
          bindings: {
            ANTHROPIC_API_KEY: 'dummy-key',
          },
        },
      },
    },
  },
});
