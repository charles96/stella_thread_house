import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, from } from 'rxjs';

export interface LogEntry {
  ts: string;            // ISO timestamp
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose';
  ctx?: string;          // NestJS context (예: "RoutesResolver")
  msg: string;
}

// 인메모리 ring buffer + SSE subject. NestJS Logger 가 push() 호출.
// 새 클라이언트는 observe() 로 — 직전 buffer 를 replay 한 뒤 실시간 stream 으로 이어간다.
@Injectable()
export class LogService {
  private static readonly BUFFER_MAX = 2000;

  private readonly buffer: LogEntry[] = [];
  private readonly subject = new Subject<LogEntry>();

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > LogService.BUFFER_MAX) {
      this.buffer.splice(0, this.buffer.length - LogService.BUFFER_MAX);
    }
    this.subject.next(entry);
  }

  observe(): Observable<LogEntry> {
    return concat(from([...this.buffer]), this.subject.asObservable());
  }

  recent(limit = 200): LogEntry[] {
    return this.buffer.slice(-limit);
  }
}
