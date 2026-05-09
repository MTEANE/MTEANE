import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_RATE_LIMIT, parseRateLimit } from './rateLimit';

const envSchema = z.object({
  PORT: z.string()
    .optional()
    .transform((str = '3000') => {
      const num = Number.parseInt(str, 10);
      if (Number.isNaN(num) || num < 1 || num > 65535) {
        throw new Error('PORT must be between 1 and 65535');
      }
      return num;
    }),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  API_KEY_SECRET: z.string().min(32, 'API_KEY_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional().default('info'),
  RATE_LIMIT: z.string()
    .optional()
    .transform((str = DEFAULT_RATE_LIMIT) => parseRateLimit(str)),
  WORKER_CONCURRENCY: z.string()
    .optional()
    .transform((str = '5') => {
      const num = Number.parseInt(str, 10);
      if (Number.isNaN(num) || num < 1 || num > 100) {
        throw new Error('WORKER_CONCURRENCY must be between 1 and 100');
      }
      return num;
    }),

  // SMTP — optional; required only when using the email action executor
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string()
    .optional()
    .transform((str = '587') => Number.parseInt(str, 10)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional().default('noreply@triggrr.io'),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const errors = envResult.error.issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Environment validation failed. Check your .env file:\n${errors}`,
  );
}

export const config = envResult.data;
