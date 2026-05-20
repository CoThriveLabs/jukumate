import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import Anthropic from '@anthropic-ai/sdk';
import { DiagnoseRequestSchema, ParentReportRequestSchema } from './schemas';
import { SYSTEM_PROMPT, OFFTOPIC_MARKERS } from './prompt';
import { PARENT_REPORT_SYSTEM_PROMPT } from './parent-report-prompt';
import type { Bindings } from './types';

const ALLOWED_ORIGINS = [
  'https://jukumate.pages.dev',
  'http://localhost:4321',
  'http://localhost:4323',
];
const PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.jukumate\.pages\.dev$/;

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (ALLOWED_ORIGINS.includes(origin)) return origin;
      if (PREVIEW_ORIGIN_RE.test(origin)) return origin;
      return null;
    },
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  })
);

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

// ───── 共通ヘルパー ─────────────────────────────────

type ErrStatus = 400 | 422 | 429 | 502 | 503;

function respondError(
  c: Context,
  code: string,
  message: string,
  status: ErrStatus
) {
  return c.json({ error: code, message }, status);
}

/** YYYY-MM 形式の月キー（KV 上の月間カウンタ用） */
function getCurrentMonthKey(): string {
  return `month:${new Date().toISOString().slice(0, 7)}`;
}

/**
 * 月間上限を確認し、未達なら現カウンタ値を返す。上限到達時は null を返す（呼び出し側で 503 を返す）。
 */
async function readMonthlyCount(kv: KVNamespace, monthKey: string): Promise<number> {
  return parseInt((await kv.get(monthKey)) ?? '0', 10);
}

/** 月間カウンタ +1（非同期、35 日 TTL） */
function incrementMonthly(
  kv: KVNamespace,
  monthKey: string,
  current: number
): Promise<void> {
  return kv.put(monthKey, String(current + 1), {
    expirationTtl: 60 * 60 * 24 * 35,
  });
}

interface AnthropicCallArgs {
  client: Anthropic;
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
}

/**
 * Anthropic Messages API 呼び出し共通化。
 * 戻り値: text コンテンツ。空 or 非 text 種別なら空文字。
 * 例外はそのまま投げる（呼び出し側で 502 にラップ）。
 */
async function callAnthropic(args: AnthropicCallArgs): Promise<string> {
  const res = await args.client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: [
      {
        type: 'text',
        text: args.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: args.messages,
  });
  const first = res.content[0];
  return first && first.type === 'text' ? first.text : '';
}

// ───── /api/diagnose ───────────────────────────────

app.post(
  '/api/diagnose',
  zValidator('json', DiagnoseRequestSchema, (result, c) => {
    if (!result.success) {
      return respondError(c, 'invalid_request', 'リクエスト形式が不正です。', 400);
    }
  }),
  async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';

    // 層 1: IP レート制限
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return respondError(
        c,
        'rate_limited',
        'リクエストが多すぎます。少し時間をおいてお試しください。',
        429
      );
    }

    const body = c.req.valid('json');

    // 層 2: セッション × ターン上限
    const turn = Math.floor(body.history.length / 2);
    if (turn >= parseInt(c.env.MAX_TURNS, 10)) {
      return respondError(c, 'turn_limit_exceeded', '5 ターンの上限に達しました。', 422);
    }

    // 層 3: 月間グローバル上限
    const monthKey = getCurrentMonthKey();
    const current = await readMonthlyCount(c.env.MONTHLY_COUNTER, monthKey);
    if (current >= parseInt(c.env.MONTHLY_LIMIT, 10)) {
      return respondError(
        c,
        'monthly_limit_reached',
        '月間ご利用上限に達しました。来月以降にお試しください。',
        503
      );
    }

    // Anthropic 呼び出し
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    const messages = [
      ...body.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: body.message },
    ];

    let reply: string;
    try {
      reply = await callAnthropic({
        client,
        model: c.env.ANTHROPIC_MODEL,
        system: SYSTEM_PROMPT,
        messages,
        maxTokens: 600,
      });
    } catch (err) {
      console.error('[diagnose] upstream error:', err);
      return respondError(
        c,
        'upstream_error',
        'AI サービスから応答が得られませんでした。',
        502
      );
    }

    // 月間カウンタを非同期で +1
    c.executionCtx.waitUntil(incrementMonthly(c.env.MONTHLY_COUNTER, monthKey, current));

    // off-topic 判定（プロンプトと 1 ソース化したマーカーで判定）
    const isOfftopicRefusal = OFFTOPIC_MARKERS.some((m) => reply.includes(m));

    const nextTurn = turn + 1;
    return c.json({
      reply,
      done: nextTurn >= parseInt(c.env.MAX_TURNS, 10),
      isOfftopicRefusal,
      showCta: nextTurn >= 4,
      turnRemaining: parseInt(c.env.MAX_TURNS, 10) - nextTurn,
    });
  }
);

// ───── /api/parent-report ──────────────────────────

app.post(
  '/api/parent-report',
  zValidator('json', ParentReportRequestSchema, (result, c) => {
    if (!result.success) {
      return respondError(c, 'invalid_request', 'リクエスト形式が不正です。', 400);
    }
  }),
  async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';

    // 層 1: IP レート制限（診断と共通の binding を使用）
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return respondError(
        c,
        'rate_limited',
        'リクエストが多すぎます。少し時間をおいてお試しください。',
        429
      );
    }

    const body = c.req.valid('json');

    // 層 3: 月間グローバル上限（保護者レポート専用カウンタ）
    const monthKey = getCurrentMonthKey();
    const current = await readMonthlyCount(
      c.env.MONTHLY_COUNTER_PARENT_REPORT,
      monthKey
    );
    if (current >= parseInt(c.env.MONTHLY_LIMIT_PARENT_REPORT, 10)) {
      return respondError(
        c,
        'monthly_limit_reached',
        '月間ご利用上限に達しました。来月以降にお試しください。',
        503
      );
    }

    // Anthropic 呼び出し
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    let reply: string;
    try {
      reply = await callAnthropic({
        client,
        model: c.env.ANTHROPIC_MODEL,
        system: PARENT_REPORT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body.input }],
        maxTokens: 700,
      });
    } catch (err) {
      console.error('[parent-report] upstream error:', err);
      return respondError(
        c,
        'upstream_error',
        'AI サービスから応答が得られませんでした。',
        502
      );
    }

    // 月間カウンタ +1（非同期）
    c.executionCtx.waitUntil(
      incrementMonthly(c.env.MONTHLY_COUNTER_PARENT_REPORT, monthKey, current)
    );

    return c.json({ reply });
  }
);

export default app;
