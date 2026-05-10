import {
  Controller,
  Get,
  MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Observable, map } from 'rxjs';
import { AdminGuard } from './admin.guard';
import { LogService, LogEntry } from './log.service';

@ApiTags('admin/system')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/system')
export class SystemController {
  constructor(private readonly logs: LogService) {}

  // 직전 N건 즉시 반환 — 페이지 처음 열 때 빠르게 채우는 용도.
  // 이후 실제 실시간은 SSE 로 이어붙임.
  @Get('logs/recent')
  recent(): { entries: LogEntry[] } {
    return { entries: this.logs.recent(500) };
  }

  // SSE — 연결 시점에 buffer replay 후 새 로그를 즉시 push.
  // 클라이언트는 EventSource 로 구독.
  @Sse('logs/stream')
  stream(): Observable<MessageEvent> {
    return this.logs
      .observe()
      .pipe(map((entry) => ({ data: entry }) as MessageEvent));
  }
}
