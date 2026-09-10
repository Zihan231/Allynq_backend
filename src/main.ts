import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const allowedOrigins = [process.env.FRONTEND_URL, process.env.FRONTEND_URL_PROD].filter(
    (origin): origin is string => Boolean(origin),
  );
  app.enableCors({ origin: allowedOrigins, credentials: true });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
