import { ConsoleLogger, LogLevel } from '@nestjs/common';
import type { LogService } from './log.service';

// NestJS 의 ConsoleLogger 를 그대로 쓰면서 (콘솔 출력 유지) 같은 메시지를
// LogService ring buffer 에도 push — admin/system 에서 실시간 조회용.
export class SystemLogger extends ConsoleLogger {
  constructor(private readonly logs: LogService) {
    super();
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
    try {
      this.logs.push({
        ts: new Date().toISOString(),
        level,
        ctx,
        msg,
      });
    } catch {
      // ignore — 절대 logger 가 죽으면 안 됨.
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
