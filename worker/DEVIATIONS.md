# 設計書からの逸脱記録

> ※ このファイルは Worker 実装の設計逸脱記録です。元の設計書は内部資料のため非公開です。実装の意図・判断理由を残すための開発履歴として参照してください。

JukuMate AI チャット Worker の実装で、設計書から逸脱した箇所を記録する。

## 2026-05-19: `@anthropic-ai/sdk` のバージョン変更

### 変更内容

- **設計書 §6-5 指定**: `@anthropic-ai/sdk`: `^0.30.0`
- **実装後の値**: `@anthropic-ai/sdk`: `^0.97.0`

### 理由

設計書 §0-1 No.4 の確定事項「プロンプトキャッシング有効」を守るため。

`@anthropic-ai/sdk@0.30.x` では `cache_control` フィールドが **beta 名前空間** (`client.beta.promptCaching.messages.create`) にしか型定義されておらず、通常の `client.messages.create` の `system: [{ type: 'text', text, cache_control }]` という指定で TS2769 エラーが発生する。

確認した型定義（`node_modules/@anthropic-ai/sdk/resources/messages.d.ts` line 222-225, v0.30.1）:

```typescript
export interface TextBlockParam {
    text: string;
    type: 'text';
    // ← cache_control なし
}
```

API 自体はキャッシングに対応しているため、設計書 §0-1 No.4 のキャッシュ有効化を維持しつつ型エラーを解消するには SDK の最新化が現実的。0.97 系では `cache_control` が GA 化され、設計書 §6-7 サンプルのコードがそのまま型エラーなく通る。

### 影響範囲

- `worker/package.json` の dependencies のみ変更
- `worker/src/index.ts` のコードは設計書サンプルのまま（修正不要）
- 他の dependencies / devDependencies は **設計書通り維持**:
  - `hono`: `^4.6.0`
  - `@hono/zod-validator`: `^0.4.0`
  - `zod`: `^3.23.0`（4 系は破壊的変更が大きいため見送り）
  - `typescript`: `^5.6.0`（6 系は新しすぎる）
  - `vitest`: `^2.1.0`（`@cloudflare/vitest-pool-workers` との互換維持）
  - `@cloudflare/vitest-pool-workers`: `^0.5.0`
  - `@cloudflare/workers-types`: `^4.20260501.0`
  - `wrangler`: `^4.0.0`

### 確認方法

公式ドキュメント（<https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching>）の TypeScript サンプルが以下の書き方を提示しており、設計書 §6-7 の実装と一致:

```typescript
const response = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "...",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [ /* ... */ ]
});
```

---

## 2026-05-19: `nodejs_compat` flag 有効化

### 変更内容

- **設計書 §0-2 J 指定**: `compatibility_flags = []`（nodejs_compat 無効）
- **実装後の値**: `compatibility_flags = ["nodejs_compat"]`

### 理由

上記の `@anthropic-ai/sdk` 0.97 系へのバージョン bump に伴い、SDK 内部で Node.js 標準モジュールへの参照が増えたため。`wrangler dev` 起動時に以下のエラー:

```
service core:user:jukumate-ai-chat: Uncaught Error: No such module "node:fs/promises".
```

加えて以下のモジュールも参照されている（WARNING で確認）:
- `node:readline`
- `node:util`
- `node:stream`
- `node:stream/promises`

これらは Cloudflare Workers では `nodejs_compat` compatibility flag が有効でないと利用不可。

### 影響

- Workers cold start が若干増（数十ms 程度、設計書 §0-2 J の意図は cold start 短縮）
- 機能・コスト・セキュリティへの影響なし

### 代替案（不採用）

- SDK サブモジュールから core のみ import → 設計書サンプル `import Anthropic from '@anthropic-ai/sdk'` を変更する必要があり、設計書からの逸脱が大きい
- SDK バージョンダウン → cache_control 型エラー再発、設計書 §0-1 No.4 が守れない
