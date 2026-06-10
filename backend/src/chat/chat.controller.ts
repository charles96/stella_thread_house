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
  // 명시적 Stop(취소)된 assistant 메시지 id 집합 — 스트림 finally 가 저장 대신 삭제하도록.
  // 취소가 초기 저장(appendMessages)보다 먼저 와도 안전하도록 stream 쪽에서도 확인.
  private readonly cancelledTurns = new Set<string>();
  // 진행 중인 stream 의 abort 컨트롤러 + 종료 신호(done).
  // cancel 이 stream 을 즉시 끊고, finally 의 저장/삭제가 끝날 때까지 기다린 뒤 삭제를
  // 확정한다 → 'finally 저장'과 'cancel 삭제'가 경합해도 삭제가 항상 마지막 쓰기가 된다.
  private readonly activeStreams = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationsService: ConversationsService,
    private readonly authService: AuthService,
  ) {}

  // Stop 버튼 = 이번 turn 완전 취소. user/assistant 메시지를 삭제하고,
  // 진행 중인 stream 의 finally 가 최종 저장하지 않도록 취소 플래그를 남긴다.
  // (우발적 disconnect 는 이 엔드포인트를 호출하지 않으므로 서버 보존 로직 유지)
  @Post('cancel')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: '진행 중 발화 취소 — 해당 turn 메시지 삭제' })
  async cancel(
    @Req() req: Request,
    @Body()
    body: {
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
    },
  ): Promise<{ ok: boolean }> {
    const userId = (req.user as { sub: string } | undefined)?.sub;
    if (!userId || !body?.conversationId) return { ok: false };
    // 플래그 — 동시에 도는 stream 의 finally 가 저장을 건너뛰고 삭제하도록.
    this.cancelledTurns.add(body.assistantMessageId);
    // 진행 중인 stream 을 즉시 끊고, 그 finally(저장 또는 삭제)가 끝날 때까지 대기한다.
    // 프론트가 SSE 연결을 먼저 끊으면 stream finally 가 부분 응답을 '저장'할 수 있는데,
    // 아래 deleteMessages 를 done 이후에 실행해 삭제가 항상 저장보다 나중이 되도록 보장한다.
    const active = this.activeStreams.get(body.assistantMessageId);
    if (active) {
      active.abort.abort();
      try {
        await active.done;
      } catch {
        /* stream 종료 대기 실패는 무시하고 삭제로 진행 */
      }
    }
    // 삭제를 마지막에 — stream finally 가 부분 응답을 저장했더라도 여기서 제거.
    try {
      await this.conversationsService.deleteMessages(userId, body.conversationId, [
        body.userMessageId,
        body.assistantMessageId,
      ]);
    } catch (e) {
      this.logger.warn(
        `[chat/cancel] delete failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // 플래그 정리 — save 경로로 끝난 turn 은 finally 가 플래그를 지우지 않으므로 여기서 정리.
    this.cancelledTurns.delete(body.assistantMessageId);
    return { ok: true };
  }

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
  @ApiOperation({ summary: '사용 가능한 모델 목록' })
  @ApiQuery({ name: 'endpoint', required: false })
  @ApiQuery({ name: 'kind', required: false, enum: ['reasoning', 'vision'] })
  async models(
    @Query('endpoint') endpoint?: string,
    @Query('kind') kind?: string,
  ) {
    try {
      const group = kind === 'vision' ? 'vision' : 'reasoning';
      const models = await this.chatService.listModels(group, endpoint);
      return {
        defaultModel: this.chatService.getDefaultModel(),
        models,
      };
    } catch (e) {
      // 잘못된 endpoint/API 키 등 provider 오류는 500 으로 터뜨리지 않고
      // 빈 목록 + 사유를 200 으로 반환 → Settings 가 인라인 에러로 안내(설정 변경 중 흔함).
      const message =
        e instanceof Error ? e.message : '모델 목록을 불러오지 못했습니다';
      this.logger.warn(`[chat/models] failed: ${message}`);
      return {
        defaultModel: this.chatService.getDefaultModel(),
        models: [],
        error: message,
      };
    }
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

    // cancel 이 이 stream 을 즉시 끊고 finally 완료를 기다릴 수 있도록 등록.
    // (assistant placeholder id 를 키로 사용 — appendMessages 이전이라도 cancel 이 찾을 수 있게 미리 등록)
    let resolveStreamDone: () => void = () => {};
    const streamDone = new Promise<void>((r) => {
      resolveStreamDone = r;
    });
    const turnKey = body.persist?.assistantMessageId;
    if (turnKey) {
      this.activeStreams.set(turnKey, { abort: abortCtrl, done: streamDone });
    }

    // persist 가 있으면 user 메시지 + assistant placeholder 를 즉시 저장.
    const userId = (req.user as { sub: string } | undefined)?.sub;
    type PersistCtx = {
      userId: string;
      convId: string;
      userMessageId: string;
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
          userMessageId: userMessage.id,
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

    // 생성 중 에러(타임아웃/모델 오류 등)를 finally 가 영속하도록 캡처.
    // 에러 턴은 '실패' 답변으로 저장해 새로고침 후에도 보이게 한다(디버깅·피드백용).
    let streamError: { message: string; code?: string } | null = null;

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
        // 알려진 에러는 code 를 함께 전달 → 프론트가 UI 언어로 재번역(언어 전환 반응).
        const errorCode = (err as Error & { code?: string })?.code;
        streamError = { message, code: errorCode };
        writeIfConnected(
          `data: ${JSON.stringify({ error: message, errorCode })}\n\n`,
        );
        this.logger.warn(`[chat/stream] error during generation: ${message}`);
      }
    } finally {
      clearInterval(heartbeat);
      // 명시적 Stop(취소)된 turn — 최종 저장하지 않고 user/assistant 메시지를 삭제(완전 취소).
      // 취소 신호가 초기 저장보다 먼저 도착했을 수 있으므로 여기서도 삭제를 보장한다.
      if (persistCtx && this.cancelledTurns.has(persistCtx.assistantId)) {
        const ctx = persistCtx;
        this.cancelledTurns.delete(ctx.assistantId);
        try {
          await this.conversationsService.deleteMessages(ctx.userId, ctx.convId, [
            ctx.userMessageId,
            ctx.assistantId,
          ]);
        } catch (e) {
          this.logger.warn(
            `[chat/stream] cancel cleanup failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        this.conversationsService.emitStreamEnd(
          ctx.userId,
          ctx.convId,
          ctx.assistantId,
        );
      } else if (persistCtx && streamError) {
        // 에러로 끝난 turn — '실패' 답변으로 저장(메타 isError) → 새로고침 후에도 보임.
        // 빈 메시지로 남겨 "준비 중…"이 박히는 일이 없도록, 에러 문구를 content 로 채운다.
        const ctx = persistCtx;
        try {
          await this.conversationsService.updateMessage(
            ctx.userId,
            ctx.convId,
            ctx.assistantId,
            {
              content: ctx.content || streamError.message,
              thinking: ctx.thinking || null,
              metadata: {
                isError: true,
                ...(streamError.code ? { errorCode: streamError.code } : {}),
              },
            },
          );
        } catch (e) {
          this.logger.error(
            `[chat/stream] error persist failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        this.conversationsService.emitStreamEnd(
          ctx.userId,
          ctx.convId,
          ctx.assistantId,
        );
      } else if (persistCtx && persistCtx.content.trim().length === 0) {
        // 빈 turn(에러도 아니고 본문도 없음) — 완료가 아니므로 user/assistant 모두 롤백 삭제.
        // (모델이 아무것도 못 만든 경우. "완료된 답변만 영속" 정책)
        const ctx = persistCtx;
        try {
          await this.conversationsService.deleteMessages(ctx.userId, ctx.convId, [
            ctx.userMessageId,
            ctx.assistantId,
          ]);
          this.logger.log('[chat/stream] empty turn rolled back (no content)');
        } catch (e) {
          this.logger.warn(
            `[chat/stream] empty turn rollback failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        this.conversationsService.emitStreamEnd(
          ctx.userId,
          ctx.convId,
          ctx.assistantId,
        );
      } else if (persistCtx) {
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
        // 저장 직후 cancel 이 도착했다면(취소 플래그) 해시태그 생성을 건너뛰어
        // cancel 이 done 을 빨리 기다린 뒤 삭제하도록 한다.
        if (
          !this.cancelledTurns.has(ctx.assistantId) &&
          ctx.content.trim().length > 0
        ) {
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

      // stream 의 저장/삭제가 모두 끝남 — 대기 중인 cancel 을 깨워 삭제를 확정하게 한다.
      if (turnKey) this.activeStreams.delete(turnKey);
      resolveStreamDone();

      // 모든 작업 완료 후 연결 종료.
      writeIfConnected('data: [DONE]\n\n');
      if (clientConnected) {
        try { res.end(); } catch { /* ignore */ }
        clientConnected = false;
      }
    }
  }
}
