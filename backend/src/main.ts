import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { LogService } from './admin/log.service';
import { SystemLogger } from './admin/system-logger';

async function bootstrap() {
  // bufferLogs — useLogger() 호출 전까지 로그를 버퍼링했다가 새 logger 로 재실행.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // SystemLogger — 콘솔 출력 + LogService ring buffer + 파일 양쪽으로 흘림.
  // admin/system 의 SSE 스트림이 ring buffer 를 그대로 노출.
  app.useLogger(new SystemLogger(app.get(LogService)));
  // Service 들이 쓰는 new Logger(name).log/.debug/.verbose 가 static logLevels 필터에
  // 막혀 SystemLogger 까지 도달 못 하는 케이스 방지 — 모든 레벨 명시.
  // 실제 게이트는 LogService.push() 에서 debug 토글로 수행.
  Logger.overrideLogger(['error', 'warn', 'log', 'debug', 'verbose']);
  app.enableCors({
    origin: process.env.TH_HOST ?? 'http://localhost:3100',
    credentials: true,
  });
  app.use(cookieParser());
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  const config = new DocumentBuilder()
    .setTitle('Stella Book API')
    .setDescription('OpenAI 호환 챗봇 백엔드 — chat, page extraction, auth')
    .setVersion('0.2.0')
    .addTag('page', '웹 페이지 본문/이미지/OG 태그 추출')
    .addTag('chat', '대화 스트리밍 및 보조 기능')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 4100;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/docs`);
}
bootstrap();
