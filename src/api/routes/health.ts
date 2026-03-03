import type { FastifyInstance } from 'fastify';

export const healthRoutes = async (app: FastifyInstance) => {
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });
};
