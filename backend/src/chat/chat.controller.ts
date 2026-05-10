import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChatMessage, ChatService } from './chat.service';

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  visionModel?: string;
  useVision?: boolean;
  endpoint?: string;
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

interface HashtagsRequest {
  text: string;
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
  constructor(private readonly chatService: ChatService) {}

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

  @Post('hashtags')
  @ApiOperation({ summary: '답변 텍스트에서 해시태그 + 한 줄 요약 추출' })
  async hashtags(@Body() body: HashtagsRequest) {
    if (!body.text || !body.text.trim()) {
      throw new BadRequestException('text가 필요합니다');
    }
    try {
      return await this.chatService.generateHashtags(body.text, body.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '해시태그 실패';
      throw new BadRequestException(msg);
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
  @ApiOperation({
    summary: '대화 스트리밍 (SSE)',
    description:
      'text/event-stream으로 content/thinking/search/pages/status/metric 이벤트를 push.',
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

    // 클라이언트가 연결을 끊거나 Stop 버튼을 누르면 fetch 도 함께 끊는다.
    const ctrl = new AbortController();
    req.on('close', () => {
      // eslint-disable-next-line no-console
      console.log('[chat/stream] client disconnected → abort signal fired');
      ctrl.abort();
    });

    try {
      for await (const part of this.chatService.streamChat(body.messages, {
        model: body.model,
        visionModel: body.visionModel,
        useVision: body.useVision,
        endpoint: body.endpoint,
        signal: ctrl.signal,
      })) {
        if (ctrl.signal.aborted) break;
        res.write(`data: ${JSON.stringify(part)}\n\n`);
      }
      if (!ctrl.signal.aborted) {
        res.write('data: [DONE]\n\n');
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const message = err instanceof Error ? err.message : 'unknown error';
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
