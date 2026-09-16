import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());

  // Collect configured origins from environment variables
  const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URL_PROD,
    process.env.ALLOWED_ORIGINS,
  ]
    .filter((origin): origin is string => Boolean(origin))
    .flatMap((origin) => origin.split(',').map((o) => o.trim()));

  // Standard development and production frontend origins
  const defaultOrigins = [
    'https://allync.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];

  const allowedOrigins = Array.from(
    new Set([...defaultOrigins, ...configuredOrigins]),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (mobile apps, Postman, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // Allow exact matches or Vercel preview deployments (e.g., https://allync-git-xxx.vercel.app)
      const isAllowed =
        allowedOrigins.includes(origin) ||
        /^https:\/\/.*allync.*\.vercel\.app$/.test(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy error: Origin ${origin} is not allowed`));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With',
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend server is running on port ${port}`);
}
await bootstrap();
