import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './api/app.module';
import { bootstrapApp } from './api/bootstrap';
import { loadRootEnv } from './infra/env';
import { initSentry } from './infra/observability/sentry';
import { initAnalytics, shutdownAnalytics } from './infra/observability/analytics';

async function main(): Promise<void> {
  // spec 004 §2.2 — the root .env first. Every env read happens inside a DI
  // factory, which runs during create(), so this is early enough.
  loadRootEnv();

  // spec 004 §4, §5 — both are inert without credentials, so this is
  // unconditional rather than guarded here.
  initSentry();
  initAnalytics();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  bootstrapApp(app);
  app.enableShutdownHooks();

  // Buffered analytics events are worth a graceful flush; nothing else is.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdownAnalytics().finally(() => process.exit(0));
    });
  }

  await app.listen(Number(process.env.API_PORT ?? 3001));
}

void main();
