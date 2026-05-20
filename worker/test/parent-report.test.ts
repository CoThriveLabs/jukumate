// T-05: POST /api/parent-report ユニットテスト
//
// モック方針は diagnose.test.ts と同じ:
//   - Anthropic SDK: vi.mock でファイルトップに hoist
//   - RATE_LIMITER  : env binding を直接 vi.spyOn で差し替え
//   - MONTHLY_COUNTER_PARENT_REPORT (KV): miniflare のローカル KV を beforeEach でクリア

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SELF,
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../src/index';

// ---- Anthropic SDK モック ---------------------------------------------------
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
const VALID_INPUT =
  '中学2年生・男子。数学の小テストで先週より大きく伸び、英語の宿題提出率も 100% でした。来週は期末テスト前の集中演習です。';

function reportUrl() {
  return 'https://jukumate-ai-chat/api/parent-report';
}

function buildBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    sessionId: VALID_UUID,
    input: VALID_INPUT,
    ...overrides,
  });
}

function monthKey() {
  return `month:${new Date().toISOString().slice(0, 7)}`;
}

// ---- 共通セットアップ -------------------------------------------------------
beforeEach(async () => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: '保護者の皆様、いつもお世話になっております。今週の学習の様子をご報告します。\n\n（モック応答）' }],
  });

  (env as any).RATE_LIMITER = {
    limit: vi.fn().mockResolvedValue({ success: true }),
  };

  await env.MONTHLY_COUNTER_PARENT_REPORT.delete(monthKey());
});

afterEach(async () => {
  await env.MONTHLY_COUNTER_PARENT_REPORT.delete(monthKey());
});

// ---- テスト本体 -------------------------------------------------------------
describe('POST /api/parent-report', () => {
  // PR-1: 正常リクエスト
  it('PR-1: 正常リクエストで 200 + reply 文字列を返す', async () => {
    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody(),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { reply: string };
    expect(typeof data.reply).toBe('string');
    expect(data.reply.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // PR-2: input が 10 文字未満 → 400
  it('PR-2: input が 10 文字未満の場合 400 invalid_request', async () => {
    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody({ input: '短すぎ' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('invalid_request');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PR-3: input が 800 文字超 → 400
  it('PR-3: input が 800 文字超の場合 400 invalid_request', async () => {
    const longInput = 'あ'.repeat(801);
    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody({ input: longInput }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('invalid_request');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PR-4: 月間上限到達 → 503
  it('PR-4: MONTHLY_LIMIT_PARENT_REPORT (2000) 到達で 503 monthly_limit_reached', async () => {
    await env.MONTHLY_COUNTER_PARENT_REPORT.put(monthKey(), '2000');
    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody(),
    });
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('monthly_limit_reached');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PR-5: レート制限ヒット → 429
  it('PR-5: RATE_LIMITER.limit が success:false の場合 429 rate_limited', async () => {
    const req = new Request(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
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
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PR-6: Anthropic SDK 例外 → 502 upstream_error（補助ケース）
  it('PR-6: Anthropic SDK が例外を throw した場合 502 upstream_error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody(),
    });
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('upstream_error');
  });

  // PR-7: 正常時に KV カウンタ +1（補助ケース）
  it('PR-7: 正常時に MONTHLY_COUNTER_PARENT_REPORT が +1 される', async () => {
    await env.MONTHLY_COUNTER_PARENT_REPORT.put(monthKey(), '17');

    const res = await SELF.fetch(reportUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: buildBody(),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    const after = await env.MONTHLY_COUNTER_PARENT_REPORT.get(monthKey());
    expect(after).toBe('18');
  });
});
