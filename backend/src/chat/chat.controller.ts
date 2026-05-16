import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChatMessage, ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AuthService } from '../auth/auth.service';

// 스트림 시작 전 user 메시지/assistant placeholder 를 DB 에 즉시 저장하고,
// 스트림 종료 시 최종 assistant content/thinking 을 업데이트하기 위한 메타데이터.
// 프론트가 stream 도중 disconnect 해도 백엔드가 끝까지 처리 + 저장.
interface ChatPersistPayload {
  conversationId: string;
  userMessage: {
    id: string;
    content: string;
    images?: string[];
    imageNames?: string[];
  };
  assistantMessageId: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  visionModel?: string;
  useVision?: boolean;
  endpoint?: string;
  kind?: 'chat' | 'thread';
  persist?: ChatPersistPayload;
}

interface SummaryRequest {
  messages: ChatMessage[];
  model?: string;
}

interface SummaryIncrementalRequest {
  prevSummary?: string;
  latestAnswer: string;
  model?: string;
}

interface FollowupsRequest {
  userMessage: string;
  assistantReply: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

interface AssessClarityRequest {
  userMessage: string;
  history?: ChatMessage[];
  model?: string;
}

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationsService: ConversationsService,
    private readonly authService: AuthService,
  ) {}

  @Get('image-proxy')
  @ApiOperation({ summary: '외부 이미지를 data URL로 프록시' })
  @ApiQuery({ name: 'url', required: true })
  async imageProxy(@Query('url') url?: string) {
    if (!url) throw new BadRequestException('url 파라미터가 필요합니다');
    try {
      return await this.chatService.fetchImageAsDataUrl(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '이미지 가져오기 실패';
      throw new BadRequestException(msg);
    }
  }

  @Get('models')
  @ApiOperation({ summary: 'Ollama에서 사용 가능한 모델 목록' })
  @ApiQuery({ name: 'endpoint', required: false })
  async models(@Query('endpoint') endpoint?: string) {
    const models = await this.chatService.listModels(endpoint);
    return {
      defaultModel: this.chatService.getDefaultModel(),
      models,
    };
  }

  @Get('defaults')
  @ApiOperation({
    summary: '기본 모델명 (AI Endpoint 는 admin/ai 에서 관리)',
  })
  defaults() {
    return {
      defaultModel: this.chatService.getDefaultModel(),
    };
  }

  @Post('assess-clarity')
  @ApiOperation({ summary: '질문이 모호하면 재질문 후보 생성' })
  async assessClarity(@Body() body: AssessClarityRequest) {
    if (!body.userMessage || !body.userMessage.trim()) {
      return { needs: false, options: [] as string[] };
    }
    try {
      return await this.chatService.assessClarity(
        body.userMessage,
        Array.isArray(body.history) ? body.history : [],
        body.model,
      );
    } catch {
      return { needs: false, options: [] as string[] };
    }
  }

  @Post('followups')
  @ApiOperation({ summary: '답변 직후 후속 질문 후보 생성' })
  async followups(@Body() body: FollowupsRequest) {
    if (!body.userMessage || !body.assistantReply) {
      return { options: [] as string[] };
    }
    try {
      const r = await this.chatService.generateFollowups(
        body.userMessage,
        body.assistantReply,
        body.history ?? [],
        body.model,
      );
      return r;
    } catch {
      return { options: [] as string[] };
    }
  }


  @Post('summary')
  @ApiOperation({ summary: '대화 전체를 짧게 요약' })
  async summary(@Body() body: SummaryRequest) {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new BadRequestException('messages가 필요합니다');
    }
    try {
      const text = await this.chatService.summarize(body.messages, body.model);
      return { summary: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '요약 실패';
      throw new BadRequestException(msg);
    }
  }

  @Post('summary/incremental')
  @ApiOperation({
    summary: '누적 요약 SSE 스트리밍 (이전 요약 + 새 답변)',
    description:
      'AI 답변이 끝날 때마다 호출. prevSummary + latestAnswer 를 합친 누적 요약을 ' +
      'text/event-stream 으로 점진적으로 push.',
  })
  async summaryIncremental(
    @Req() req: Request,
    @Body() body: SummaryIncrementalRequest,
    @Res() res: Response,
  ) {
    if (!body || typeof body.latestAnswer !== 'string' || !body.latestAnswer.trim()) {
      throw new BadRequestException('latestAnswer 가 필요합니다');
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort());

    try {
      for await (const part of this.chatService.summarizeIncrementalStream(
        body.prevSummary ?? '',
        body.latestAnswer,
        body.model,
        ctrl.signal,
      )) {
        if (ctrl.signal.aborted) break;
        res.write(`data: ${JSON.stringify(part)}\n\n`);
      }
      if (!ctrl.signal.aborted) res.write('data: [DONE]\n\n');
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : '누적 요약 실패';
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  @Post('stream')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '대화 스트리밍 (SSE)',
    description:
      'text/event-stream으로 content/thinking/search/pages/status/metric 이벤트를 push. ' +
      'persist 가 있으면 user 메시지 + assistant placeholder 를 즉시 DB 저장하고, ' +
      '스트림 종료 시 최종 content/thinking 을 업데이트 → 클라이언트가 disconnect 해도 보존.',
  })
  async stream(
    @Req() req: Request,
    @Body() body: ChatRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 클라이언트 연결 상태만 추적 — abort signal 과 분리.
    // disconnect 해도 백엔드 처리는 끝까지 진행 → 메시지 보존.
    let clientConnected = true;
    req.on('close', () => {
      clientConnected = false;
      this.logger.log(
        '[chat/stream] client disconnected — continuing in background',
      );
    });
    // 명시적 abort 가 필요한 외부 의존(Tavily/Ollama) 호출은 자체 timeout 사용 — 여기선 결코 abort 되지 않는 신호를 넘김.
    const noopCtrl = new AbortController();

    // persist 가 있으면 user 메시지 + assistant placeholder 를 즉시 저장.
    const userId = (req.user as { sub: string } | undefined)?.sub;
    type PersistCtx = {
      userId: string;
      convId: string;
      assistantId: string;
      content: string;
      thinking: string;
    };
    let persistCtx: PersistCtx | null = null;
    if (body.persist && userId) {
      const { conversationId, userMessage, assistantMessageId } = body.persist;
      try {
        await this.conversationsService.appendMessages(userId, conversationId, [
          {
            id: userMessage.id,
            role: 'user',
            content: userMessage.content,
            metadata: {
              ...(userMessage.images?.length
                ? { images: userMessage.images }
                : {}),
              ...(userMessage.imageNames?.length
                ? { imageNames: userMessage.imageNames }
                : {}),
            },
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            metadata: {},
          },
        ]);
        persistCtx = {
          userId,
          convId: conversationId,
          assistantId: assistantMessageId,
          content: '',
          thinking: '',
        };
      } catch (e) {
        // 저장 실패해도 스트리밍 자체는 계속 (사용자 경험 우선).
        this.logger.error(
          `[chat/stream] initial persist failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const writeIfConnected = (data: string) => {
      if (clientConnected) {
        try {
          res.write(data);
        } catch {
          clientConnected = false;
        }
      }
    };

    // 사용자 이름은 캐시에서 조회 — 매 요청 DB hit 회피.
    const userName = userId
      ? await this.authService.getCachedName(userId)
      : null;

    try {
      for await (const part of this.chatService.streamChat(body.messages, {
        model: body.model,
        visionModel: body.visionModel,
        useVision: body.useVision,
        endpoint: body.endpoint,
        signal: noopCtrl.signal,
        kind: body.kind,
        userName,
      })) {
        writeIfConnected(`data: ${JSON.stringify(part)}\n\n`);
        // content/thinking 누적 — 클라이언트가 끊겨도 최종 저장을 위해.
        if (persistCtx) {
          if (part.type === 'content' && part.text) {
            persistCtx.content += part.text;
          } else if (part.type === 'thinking' && part.text) {
            persistCtx.thinking += part.text;
          }
        }
      }
      writeIfConnected('data: [DONE]\n\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      writeIfConnected(`data: ${JSON.stringify({ error: message })}\n\n`);
      this.logger.warn(`[chat/stream] error during generation: ${message}`);
    } finally {
      // persist + hashtag 를 await 한 뒤 hashtags SSE 이벤트로 푸시 → 프론트 우측 패널 실시간 갱신.
      // 연결은 hashtag push 후 닫는다 — Stop 버튼/pending 해제는 약간 지연되지만,
      // "답변 완료 시 hashtag 가 즉시 보인다"는 UX 우선.
      if (persistCtx) {
        const ctx = persistCtx;
        const model = body.model;
        // 1) content/thinking 최종 저장
        try {
          await this.conversationsService.updateMessage(
            ctx.userId,
            ctx.convId,
            ctx.assistantId,
            {
              content: ctx.content,
              thinking: ctx.thinking || null,
            },
          );
        } catch (e) {
          this.logger.error(
            `[chat/stream] final persist failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // 2) hashtag 생성 → Thread(conversation) 단위 통합 hashtags 에 누적 union.
        //    완료 후 클라이언트로 SSE 'hashtags' 이벤트 push → 새로고침 없이 우측 패널 실시간 반영.
        if (ctx.content.trim().length > 0) {
          try {
            const tagResult = await this.chatService.generateHashtags(
              ctx.content,
              model,
            );
            if (tagResult.summary) {
              await this.conversationsService.mergeMessageMetadata(
                ctx.userId,
                ctx.convId,
                ctx.assistantId,
                { replySummary: tagResult.summary },
              );
            }
            if (tagResult.hashtags.length > 0) {
              const conv = await this.conversationsService.getOwned(
                ctx.userId,
                ctx.convId,
              );
              const excluded = new Set(
                (conv.excludedHashtags ?? []).map((t) => t.toLowerCase()),
              );
              const existing = new Set(
                (conv.hashtags ?? []).map((t) => t.toLowerCase()),
              );
              const merged = [...(conv.hashtags ?? [])];
              for (const t of tagResult.hashtags) {
                const k = t.toLowerCase();
                if (existing.has(k) || excluded.has(k)) continue;
                merged.push(t);
                existing.add(k);
              }
              await this.conversationsService.update(
                ctx.userId,
                ctx.convId,
                { hashtags: merged },
              );
              writeIfConnected(
                `data: ${JSON.stringify({
                  type: 'hashtags',
                  conversationId: ctx.convId,
                  tags: merged,
                })}\n\n`,
              );
            }
          } catch (e) {
            this.logger.warn(
              `[chat/stream] hashtag generation failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }

      // 모든 백그라운드 작업 완료 후 연결 종료 → 프론트 reader done=true.
      if (clientConnected) {
        try {
          res.end();
        } catch {
          // ignore — 이미 닫혔을 수 있음
        }
        clientConnected = false;
      }
    }
  }
}
