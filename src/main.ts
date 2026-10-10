import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  process.env.DATABASE_URL ||= 'postgresql://propia:propia_local_dev@127.0.0.1:5432/propia';
  process.env.JWT_SECRET ||= 'propia-local-dev-secret-change-me';
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: ['http://localhost:3001', 'http://127.0.0.1:3001'],
    credentials: true,
  });
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`PROPIA API en http://localhost:${port}`);
}

bootstrap();
