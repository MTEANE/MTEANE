const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Neon PostgreSQL — set DATABASE_URL in Fly.io secrets
  get databaseUrl() { return requireEnv('DATABASE_URL'); },

  // Upstash Redis — set REDIS_URL in Fly.io secrets (rediss:// for TLS)
  get redisUrl() { return requireEnv('REDIS_URL'); },
} as const;
