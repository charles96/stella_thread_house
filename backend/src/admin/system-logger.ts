import { ConsoleLogger, LogLevel } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { LogService } from './log.service';

// 파일 로깅 — Docker volume 으로 마운트할 디렉토리. env LOG_DIR 로 오버라이드 가능.
const LOG_DIR = process.env.LOG_DIR ?? '/app/backend/logs';
// 일자별 회전: filename = server-YYYY-MM-DD.log. 한 번 열어두고 자정 넘으면 재오픈.
let logStream: fs.WriteStream | null = null;
let logStreamDate = '';
function getLogStream(): fs.WriteStream | null {
  const today = new Date().toISOString().slice(0, 10);
  if (logStream && logStreamDate === today) return logStream;
  try {
    if (logStream) {
      try {
        logStream.end();
      } catch {
        // ignore
      }
    }
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logStream = fs.createWriteStream(
      path.join(LOG_DIR, `server-${today}.log`),
      { flags: 'a' },
    );
    logStreamDate = today;
    return logStream;
  } catch {
    return null;
  }
}

// NestJS 의 ConsoleLogger 를 그대로 쓰면서 (콘솔 출력 유지) 같은 메시지를
// LogService ring buffer + 파일 로그 양쪽으로 흘려보낸다.
export class SystemLogger extends ConsoleLogger {
  constructor(private readonly logs: LogService) {
    super();
    // 모든 레벨 명시적 활성화 — NestJS 기본은 debug/verbose 가 비활성일 수 있어
    // this.logger.debug()/verbose() 호출이 SystemLogger 에 도달하기도 전에 잘릴 수 있음.
    // 게이트는 LogService.push() 단계에서 수행 → 모든 레벨을 일단 다 받게.
    this.setLogLevels(['error', 'warn', 'log', 'debug', 'verbose']);
  }

  private capture(level: 'log' | 'error' | 'warn' | 'debug' | 'verbose', ...args: unknown[]) {
    // 마지막 인자가 문자열이면 NestJS context (e.g. "RoutesResolver"), 아니면 undefined.
    let ctx: string | undefined;
    let msgParts = args;
    if (
      args.length > 1 &&
      typeof args[args.length - 1] === 'string' &&
      !/\n/.test(args[args.length - 1] as string)
    ) {
      ctx = args[args.length - 1] as string;
      msgParts = args.slice(0, -1);
    }
    const msg = msgParts
      .map((p) => {
        if (p instanceof Error) return p.stack ?? p.message;
        if (typeof p === 'string') return p;
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .join(' ');
    const ts = new Date().toISOString();
    try {
      this.logs.push({ ts, level, ctx, msg });
    } catch {
      // ignore — 절대 logger 가 죽으면 안 됨.
    }
    // 파일에도 항상 기록 — LogService 의 debug 게이트와 무관하게 영속.
    // (디버깅·post-mortem 용. ring buffer 와 다르게 일자별 회전 + 자동 누적.)
    try {
      const stream = getLogStream();
      if (stream) {
        stream.write(
          `${ts} [${level.toUpperCase()}]${ctx ? ` [${ctx}]` : ''} ${msg}\n`,
        );
      }
    } catch {
      // ignore — 파일 쓰기 실패해도 콘솔/ring buffer 는 정상 동작.
    }
  }

  override log(message: unknown, ...rest: unknown[]) {
    this.capture('log', message, ...rest);
    super.log(message as never, ...(rest as never[]));
  }
  override error(message: unknown, ...rest: unknown[]) {
    this.capture('error', message, ...rest);
    super.error(message as never, ...(rest as never[]));
  }
  override warn(message: unknown, ...rest: unknown[]) {
    this.capture('warn', message, ...rest);
    super.warn(message as never, ...(rest as never[]));
  }
  override debug(message: unknown, ...rest: unknown[]) {
    this.capture('debug', message, ...rest);
    super.debug(message as never, ...(rest as never[]));
  }
  override verbose(message: unknown, ...rest: unknown[]) {
    this.capture('verbose', message, ...rest);
    super.verbose(message as never, ...(rest as never[]));
  }

  override setLogLevels(levels: LogLevel[]) {
    super.setLogLevels(levels);
  }
}
