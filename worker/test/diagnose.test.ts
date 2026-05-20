// Workers ユニットテスト (Vitest + @cloudflare/vitest-pool-workers)
// 設計書 §8-2 U-1 〜 U-10 に対応
//
// モック方針:
//   - Anthropic SDK: vi.mock でファイルトップに hoist し、テスト毎に挙動を変える
//   - RATE_LIMITER  : env binding を直接 vi.spyOn で差し替え
//   - MONTHLY_COUNTER (KV): miniflare のローカル KV を beforeEach でクリア
//   - 実 API 呼び出しは一切発生しない（ANTHROPIC_API_KEY は dummy で OK）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SELF,
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../src/index';

// ---- Anthropic SDK モック ---------------------------------------------------
// 既定では「モック応答」というテキストを返す。テスト毎に mockCreate.mockXxx で上書き。
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(_opts: unknown) {}
    },
  };
});

// ---- ユーティリティ ---------------------------------------------------------
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ALLOWED_ORIGIN = 'https://jukumate.vercel.app';

function diagnoseUrl() {
  return 'https://jukumate-ai-chat/api/diagnose';
}

function buildBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    sessionId: VALID_UUID,
    message: 'テスト',
    history: [],
    ...overrides,
  });
}

function monthKey() {
  return `month:${new Date().toISOString().slice(0, 7)}`;
}

// ---- 共通セットアップ -------------------------------------------------------
beforeEach(async () => {
  // Anthropic mock を既定挙動にリセット
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: 'モック応答' }],
  });

  // RATE_LIMITER は既定で常に success: true
  // (env.RATE_LIMITER は wrangler.toml の unsafe.bindings で定義されているが、
  //  pool-workers ローカルでは挙動が不安定なため明示的に上書きする)
  (env as any).RATE_LIMITER = {
    limit: vi.fn().mockResolvedValue({ success: true }),
  };

  // KV をクリーン（month キーのみ）
  await env.MONTHLY_COUNTER.delete(monthKey());
});

afterEach(async () => {
  await env.MONTHLY_COUNTER.delete(monthKey());
});

// ---- テスト本体 -------------------------------------------------------------
describe('POST /api/diagnose', () => {
  // U-1
  it('U-1: 正常リクエストで 200 + reply / done / showCta / turnRemaining を返す', async () => {
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody(),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      reply: string;
      done: boolean;
      showCta: boolean;
      turnRemaining: number;
      isOfftopicRefusal: boolean;
    };
    expect(data.reply).toBe('モック応答');
    expect(data.done).toBe(false);
    expect(data.showCta).toBe(false);
    expect(data.turnRemaining).toBe(4);
    expect(data.isOfftopicRefusal).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // U-2
  it('U-2: sessionId が UUID 形式でない場合 400 invalid_request', async () => {
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody({ sessionId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('invalid_request');
  });

  // U-3
  it('U-3: message が 501 文字の場合 400 invalid_request', async () => {
    const longMessage = 'あ'.repeat(501);
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody({ message: longMessage }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('invalid_request');
  });

  // U-4
  it('U-4: history.length === 8 (turn>=MAX_TURNS) で 422 turn_limit_exceeded', async () => {
    // schemas の history は max(8) のため、length=10 は zod 段階で 400 になる。
    // 設計書 §8-2 U-4 の「turn_limit_exceeded を返す」を満たすため、
    // テスト専用 env を組み立てて MAX_TURNS=4 / history.length=8 (turn=4) で発火させる。
    //
    // SELF.fetch では env への上書きが Worker 実行 isolate に反映されない場合がある
    // (pool-workers の挙動)。そのため worker.fetch を直接呼んで env を完全制御する。
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `履歴${i}`,
    }));
    const req = new Request(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody({ history }),
    });
    const testEnv = {
      ...env,
      MAX_TURNS: '4',
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    } as any;
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('turn_limit_exceeded');
  });

  // U-5
  it('U-5: RATE_LIMITER.limit が success:false の場合 429 rate_limited', async () => {
    // unsafe.bindings 由来の RATE_LIMITER は pool-workers では本物の no-op スタブが
    // 注入されており、SELF.fetch 経由の env 上書きでは差し替わらない。
    // worker.fetch を直接呼んで env を完全制御することで、確実にモックを刺す。
    const req = new Request(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody(),
    });
    const limitMock = vi.fn().mockResolvedValue({ success: false });
    const testEnv = {
      ...env,
      RATE_LIMITER: { limit: limitMock },
    } as any;
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(429);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('rate_limited');
    expect(limitMock).toHaveBeenCalledTimes(1);
    // Anthropic は呼ばれない
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // U-6
  it('U-6: KV カウンタが MONTHLY_LIMIT (5000) 到達で 503 monthly_limit_reached', async () => {
    await env.MONTHLY_COUNTER.put(monthKey(), '5000');
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody(),
    });
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('monthly_limit_reached');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // U-7
  it('U-7: Anthropic SDK が例外を throw した場合 502 upstream_error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody(),
    });
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('upstream_error');
  });

  // U-8
  it('U-8: Origin が allowlist 外の場合 CORS preflight が拒否される', async () => {
    // preflight (OPTIONS) で allow-origin ヘッダが返らないことを確認
    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    // Hono cors() は不許可 origin に対して Access-Control-Allow-Origin を付けない
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  // U-9
  it('U-9: GET /api/health が 200 + { ok: true } を返す', async () => {
    const res = await SELF.fetch('https://jukumate-ai-chat/api/health');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; ts: number };
    expect(data.ok).toBe(true);
    expect(typeof data.ts).toBe('number');
  });

  // U-10
  it('U-10: 正常時に KV カウンタが +1 される', async () => {
    // 初期値 42 を入れておく
    await env.MONTHLY_COUNTER.put(monthKey(), '42');

    const res = await SELF.fetch(diagnoseUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: buildBody(),
    });
    expect(res.status).toBe(200);

    // waitUntil で非同期に書かれるため、わずかに待つ
    // (cloudflare:test では executionCtx の完了を fetch 戻り時点で保証してくれる
    //  実装が入っているが、念のためマイクロタスクを 1 周期回す)
    await new Promise((r) => setTimeout(r, 50));

    const after = await env.MONTHLY_COUNTER.get(monthKey());
    expect(after).toBe('43');
  });
});
