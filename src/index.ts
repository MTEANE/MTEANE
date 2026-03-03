import 'dotenv/config';
import { buildApp } from './api';
import { config } from './shared/config';

const start = async () => {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
