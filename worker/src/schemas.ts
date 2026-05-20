import { z } from 'zod';

export const DiagnoseRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      })
    )
    .max(8),
});

export type DiagnoseRequest = z.infer<typeof DiagnoseRequestSchema>;

// Phase B 案 B: 保護者レポート下書き生成（1 ターン完結）
// 入力: 講師が記入する生徒の 1 週間の様子・データ（10-800 文字）
export const ParentReportRequestSchema = z.object({
  sessionId: z.string().uuid(),
  input: z.string().min(10).max(800),
});
export type ParentReportRequest = z.infer<typeof ParentReportRequestSchema>;
