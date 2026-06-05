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
  tavilyTopRead?: number;
  locale?: string;
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

    let clientConnected = true;
    const abortCtrl = new AbortController();
    req.on('close', () => {
      clientConnected = false;
      abortCtrl.abort();
      this.logger.log('[chat/stream] client disconnected — LLM stream aborted');
    });

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
        // 실시간 미러링 — 다른 기기/탭에 "응답 생성 시작" 알림 (입력창 streaming 상태 동기화).
        this.conversationsService.emitStreamStart(
          userId,
          conversationId,
          assistantMessageId,
        );
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

    // nginx/프록시의 proxy_read_timeout(기본 60s) 만료 방지.
    // SSE comment(`: ping`)는 클라이언트가 무시하지만 TCP 레벨에서 데이터가 흘러 타임아웃을 리셋한다.
    const heartbeat = setInterval(() => writeIfConnected(': ping\n\n'), 15_000);

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
        signal: abortCtrl.signal,
        kind: body.kind,
        userName,
        tavilyTopRead: body.tavilyTopRead,
        locale: body.locale,
      })) {
        writeIfConnected(`data: ${JSON.stringify(part)}\n\n`);
        // content/thinking 누적 — 클라이언트가 끊겨도 최종 저장을 위해.
        if (persistCtx) {
          if (part.type === 'content' && part.text) {
            persistCtx.content += part.text;
            // 실시간 미러링 — 토큰을 이벤트 버스로도 중계 (다른 기기/탭이 따라 그림).
            this.conversationsService.emitStreamDelta(
              persistCtx.userId,
              persistCtx.convId,
              persistCtx.assistantId,
              'content',
              part.text,
            );
          } else if (part.type === 'thinking' && part.text) {
            persistCtx.thinking += part.text;
            this.conversationsService.emitStreamDelta(
              persistCtx.userId,
              persistCtx.convId,
              persistCtx.assistantId,
              'thinking',
              part.text,
            );
          } else if (part.type === 'metric') {
            // 토큰 사용량 — 다른 기기/탭에도 동기화.
            this.conversationsService.emitStreamMetric(
              persistCtx.userId,
              persistCtx.convId,
              persistCtx.assistantId,
              {
                tokens: part.tokens,
                durationMs: part.durationMs,
                tokensPerSec: part.tokensPerSec,
                promptTokens: part.promptTokens,
              },
            );
          } else if (
            part.type === 'search' ||
            part.type === 'pages' ||
            part.type === 'page_timeout' ||
            part.type === 'image_analyzing_start' ||
            part.type === 'image_analysis' ||
            part.type === 'status'
          ) {
            // 검색 결과/Reference documents/이미지 분석/상태 파트를 그대로 중계.
            this.conversationsService.emitStreamPart(
              persistCtx.userId,
              persistCtx.convId,
              persistCtx.assistantId,
              part,
            );
          }
        }
      }
      // AI 발화 완료 즉시 전송 → 프론트 입력창 바로 열림.
      writeIfConnected(`data: ${JSON.stringify({ type: 'ai_done' })}\n\n`);
    } catch (err) {
      const isAbort =
        abortCtrl.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (!isAbort) {
        const message = err instanceof Error ? err.message : 'unknown error';
        writeIfConnected(`data: ${JSON.stringify({ error: message })}\n\n`);
        this.logger.warn(`[chat/stream] error during generation: ${message}`);
      }
    } finally {
      clearInterval(heartbeat);
      if (persistCtx) {
        const ctx = persistCtx;
        const model = body.model;
        // 1) content/thinking 최종 저장
        try {
          await this.conversationsService.updateMessage(
            ctx.userId,
            ctx.convId,
            ctx.assistantId,
            { content: ctx.content, thinking: ctx.thinking || null },
          );
        } catch (e) {
          this.logger.error(
            `[chat/stream] final persist failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // 실시간 미러링 — "응답 생성 종료" 알림 (다른 기기/탭 입력창 재개).
        this.conversationsService.emitStreamEnd(
          ctx.userId,
          ctx.convId,
          ctx.assistantId,
        );
        // 2) 해시태그 생성 — 연결 유지 중 await, 완료 후 SSE 로 push.
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

      // 모든 작업 완료 후 연결 종료.
      writeIfConnected('data: [DONE]\n\n');
      if (clientConnected) {
        try { res.end(); } catch { /* ignore */ }
        clientConnected = false;
      }
    }
  }
}
