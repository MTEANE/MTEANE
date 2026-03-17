import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  API_KEY_SECRET: z.string().min(1, 'API_KEY_SECRET is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
  throw new Error(`Invalid environment variables:\n${missing}`);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  apiKeySecret: env.API_KEY_SECRET,
} as const;
