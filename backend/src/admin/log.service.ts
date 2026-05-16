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
// debug=false 일 땐 error 외 레벨을 아예 버려서 메모리/네트워크 모두 절감 + 토글 ON 한 시점부터 기록 시작.
@Injectable()
export class LogService {
  private static readonly BUFFER_MAX = 2000;

  private readonly buffer: LogEntry[] = [];
  private readonly subject = new Subject<LogEntry>();
  private debugEnabled = false;

  isDebug(): boolean {
    return this.debugEnabled;
  }

  setDebug(v: boolean): void {
    const prev = this.debugEnabled;
    this.debugEnabled = v;
    // 사용자 확인용 — 토글 직후 한 줄 push 해서 SSE 에 즉시 신호가 보이게.
    // ON 으로 켤 때만 의미가 있음 (OFF 면 어차피 가려짐).
    if (v && !prev) {
      this.push({
        ts: new Date().toISOString(),
        level: 'log',
        ctx: 'Debug',
        msg: 'Debug logging enabled — recording all levels.',
      });
    }
  }

  push(entry: LogEntry): void {
    // Debug OFF 일 땐 error 외 레벨은 기록 자체를 안 함.
    if (!this.debugEnabled && entry.level !== 'error') return;
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
