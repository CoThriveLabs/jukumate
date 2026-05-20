# jukumate-ai-chat (Cloudflare Workers)

JukuMate LP の AI 診断チャット / 保護者レポート バックエンド。Hono + @anthropic-ai/sdk + Claude Haiku 4.5。

実装の設計逸脱記録: `./DEVIATIONS.md`（`@anthropic-ai/sdk` のバージョン変更 / `nodejs_compat` flag 有効化）

## デプロイ手順サマリ

### 初回セットアップ

```bash
cd worker
pnpm install

# Cloudflare ログイン（ブラウザ認証、運営者作業）
npx wrangler login

# Anthropic API キーを Secrets に登録（Anthropic コンソールから取得した値を貼る）
npx wrangler secret put ANTHROPIC_API_KEY
```

### デプロイ前準備（KV namespace 作成）

```bash
# 月間カウンタ用（診断）
pnpm wrangler kv namespace create MONTHLY_COUNTER
pnpm wrangler kv namespace create MONTHLY_COUNTER --preview

# 保護者レポート専用カウンタ
pnpm wrangler kv namespace create MONTHLY_COUNTER_PARENT_REPORT
pnpm wrangler kv namespace create MONTHLY_COUNTER_PARENT_REPORT --preview
```

両方の namespace `id` / `preview_id` を `wrangler.toml` の対応する `[[kv_namespaces]]` ブロックに反映してください。デプロイ前に必ず両 binding の id を埋めること（プレースホルダのままだと本番反映時にエラー）。

### ローカル開発

```bash
# .dev.vars にローカル用 API キーを記載（gitignore 対象）
# ※下記 sk-ant-api03-... はプレースホルダのため、必ず実値に置き換えてください
echo "ANTHROPIC_API_KEY=sk-ant-api03-..." > .dev.vars

pnpm dev
# http://localhost:8787/api/health で死活確認
```

### 本番デプロイ

```bash
pnpm typecheck
pnpm test
pnpm deploy
# → https://jukumate-ai-chat.<account>.workers.dev
```

### ロールバック

Cloudflare ダッシュボード → Workers & Pages → jukumate-ai-chat → Deployments
→ 直前デプロイの「Rollback」ボタンで即時切替（URL 変わらず）。

## エンドポイント

- `POST /api/diagnose` 1 ターン分のチャット応答
- `POST /api/parent-report` 保護者向けレポート下書き生成
- `GET /api/health` 死活監視

## ユニットテスト (Vitest + @cloudflare/vitest-pool-workers)

Anthropic SDK は `vi.mock` 済みのため、実 API 通信もコストも発生しない。

```bash
cd worker
pnpm test           # 1 回実行
pnpm test:watch     # ファイル変更を監視して再実行
```

### テスト一覧

| ID | 内容 | 期待 |
|---|---|---|
| U-1 | 正常リクエスト + Anthropic mock | 200 / `reply` / `turnRemaining=4` |
| U-2 | sessionId が UUID 形式でない | 400 `invalid_request` |
| U-3 | message が 501 文字 | 400 `invalid_request` |
| U-4 | 5 ターン上限到達 | 422 `turn_limit_exceeded` |
| U-5 | `RATE_LIMITER.limit` が `success:false` | 429 `rate_limited` |
| U-6 | KV カウンタが `MONTHLY_LIMIT` 到達 | 503 `monthly_limit_reached` |
| U-7 | Anthropic SDK 例外 | 502 `upstream_error` |
| U-8 | Origin が allowlist 外 | CORS preflight 拒否 |
| U-9 | `GET /api/health` | 200 + `{ ok: true }` |
| U-10 | 正常時に KV カウンタが +1 | `String(current + 1)` で put |
