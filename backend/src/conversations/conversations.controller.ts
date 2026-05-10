import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import {
  ConversationCreate,
  ConversationsService,
  ConversationUpdate,
  MessageInput,
} from './conversations.service';

interface AppendMessagesBody {
  messages: MessageInput[];
}

interface DeleteMessagesBody {
  ids: string[];
}

interface UpdateMessageBody {
  content?: string;
  thinking?: string | null;
  metadata?: Record<string, unknown>;
}

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  private uid(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  @Get()
  list(@Req() req: Request) {
    return this.service.listForUser(this.uid(req));
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

  // 메시지 keyset 페이지네이션. before(=과거 방향 cursor)가 없으면 최신 N개.
  @Get(':id/messages')
  async listMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    if (!Number.isFinite(lim) || lim <= 0) {
      throw new BadRequestException('limit 가 잘못되었습니다');
    }
    return this.service.listMessages(this.uid(req), id, before ?? null, lim);
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
