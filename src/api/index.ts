import Fastify from 'fastify';
import { healthRoutes } from './routes/health';

export const buildApp = async () => {
  const app = Fastify({ logger: true });

  await app.register(healthRoutes);

  return app;
};
