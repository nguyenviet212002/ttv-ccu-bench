import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { json } from 'express';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });

  app.use(helmet());
  app.use(json({ limit: '512kb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.info(`[worker:${process.pid}] API listening on :${port}`);
}

bootstrap().catch(err => {
  logger.error(err, 'Failed to start API');
  process.exit(1);
});
