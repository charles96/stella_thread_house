import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Observable, from, interval, map, merge, mergeMap } from 'rxjs';
import {
  ConversationCreate,
  ConversationsService,
  ConversationUpdate,
  MessageInput,
  ConversationPageDto,
} from './conversations.service';
import { ConversationEventsService } from './conversation-events.service';

interface AppendMessagesBody {
  messages: MessageInput[];
}

interface DeleteMessagesBody {
  ids: string[];
}

interface ReorderMessagesBody {
  orderedIds: string[];
}

interface UpdateMessageBody {
  content?: string;
  thinking?: string | null;
  metadata?: Record<string, unknown>;
}

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly events: ConversationEventsService,
  ) {}

  private uid(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  // 사이드바(user 단위) 실시간 동기화 — 대화/폴더 추가·삭제·이름변경·이동·핀.
  // 경로 'events/user' 는 2-segment 라 @Get(':id') / ':id/...' 와 충돌 없음.
  @Sse('events/user')
  userEvents(@Req() req: Request): Observable<MessageEvent> {
    const userId = this.uid(req);
    const ping = interval(25000).pipe(
      map(() => ({ type: 'ping', data: '' }) as MessageEvent),
    );
    return merge(
      ping,
      this.events
        .userStream(userId)
        .pipe(map((e) => ({ data: e }) as MessageEvent)),
    );
  }

  // 실시간 동기화 — 같은 thread 를 다른 기기/탭에서 열어둔 클라이언트가 EventSource 로 구독.
  // 메시지 추가/수정이 발생하면 push (messages.appended / message.updated).
  // 25초 heartbeat 로 idle proxy timeout 방지.
  @Sse(':id/events')
  streamEvents(
    @Req() req: Request,
    @Param('id') id: string,
  ): Observable<MessageEvent> {
    const userId = this.uid(req);
    const ping = interval(25000).pipe(
      map(() => ({ type: 'ping', data: '' }) as MessageEvent),
    );
    // getOwned 로 소유권 검증 후 구독 — 실패하면 stream 이 에러로 종료됨.
    return from(this.service.getOwned(userId, id)).pipe(
      mergeMap(() =>
        merge(
          ping,
          this.events
            .stream(id, userId)
            .pipe(map((e) => ({ data: e }) as MessageEvent)),
        ),
      ),
    );
  }

  @Get()
  list(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationPageDto> {
    const lim = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    return this.service.listForUser(this.uid(req), cursor, lim);
  }

  @Get('graph')
  getGraph(@Req() req: Request, @Query('threshold') threshold?: string) {
    const t = threshold ? parseInt(threshold, 10) : 3;
    const safe = Number.isFinite(t) && t > 0 ? t : 3;
    return this.service.getGraphData(this.uid(req), safe);
  }

  @Get('activity')
  getActivity(@Req() req: Request, @Query('days') days?: string) {
    const d = days ? parseInt(days, 10) : 365;
    const safe = Number.isFinite(d) && d > 0 ? d : 365;
    return this.service.getActivityData(this.uid(req), safe);
  }

  @Post()
  create(@Req() req: Request, @Body() body: ConversationCreate) {
    return this.service.create(this.uid(req), body);
  }

  @Get(':id')
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.service.getOwned(this.uid(req), id);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ConversationUpdate,
  ) {
    return this.service.update(this.uid(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Req() req: Request, @Param('id') id: string) {
    await this.service.delete(this.uid(req), id);
  }

  // 메시지 keyset 페이지네이션.
  // before: 역방향(과거) cursor. after: 순방향(미래) cursor. after='__start__' 는 처음부터.
  @Get(':id/messages')
  async listMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    if (!Number.isFinite(lim) || lim <= 0) {
      throw new BadRequestException('limit 가 잘못되었습니다');
    }
    return this.service.listMessages(this.uid(req), id, before ?? null, after ?? null, lim);
  }

  @Post(':id/messages')
  appendMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: AppendMessagesBody,
  ) {
    if (!body || !Array.isArray(body.messages)) {
      throw new BadRequestException('messages 배열이 필요합니다');
    }
    return this.service.appendMessages(this.uid(req), id, body.messages);
  }

  @Delete(':id/messages')
  @HttpCode(204)
  async deleteMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: DeleteMessagesBody,
  ) {
    if (!body || !Array.isArray(body.ids)) {
      throw new BadRequestException('ids 배열이 필요합니다');
    }
    await this.service.deleteMessages(this.uid(req), id, body.ids);
  }

  // 메시지 재정렬 — orderedIds 배열 순서대로 position 을 0,1,2... 로 일괄 갱신.
  // conversation 의 모든 메시지를 빠짐없이 보내야 함 (서비스에서 무결성 검사).
  // ':msgId' 와의 매칭 우선순위 때문에 이 라우트를 먼저 선언.
  @Patch(':id/messages/reorder')
  @HttpCode(204)
  async reorderMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ReorderMessagesBody,
  ) {
    if (!body || !Array.isArray(body.orderedIds)) {
      throw new BadRequestException('orderedIds 배열이 필요합니다');
    }
    await this.service.reorderMessages(this.uid(req), id, body.orderedIds);
  }

  @Patch(':id/messages/:msgId')
  updateMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('msgId') msgId: string,
    @Body() body: UpdateMessageBody,
  ) {
    return this.service.updateMessage(this.uid(req), id, msgId, body ?? {});
  }
}
