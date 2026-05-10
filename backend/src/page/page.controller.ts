import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  PageExtractByTitleRequestDto,
  PageExtractByTitleResponseDto,
  PageExtractRequestDto,
  PageExtractResponseDto,
  PageWithImageAnalysisRequestDto,
  PageWithImageAnalysisResponseDto,
} from './page.dto';
import { PageService } from './page.service';

@ApiTags('page')
@Controller('page')
export class PageController {
  constructor(private readonly pageService: PageService) {}

  @Get('extract')
  @ApiOperation({
    summary: '페이지 본문 추출 (GET)',
    description:
      '주어진 URL을 가져와 head의 og/twitter 메타태그, body 텍스트, 이미지 리스트를 반환합니다.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    example: 'https://news.ycombinator.com',
    description: '추출할 웹 페이지 URL (http/https)',
  })
  @ApiResponse({ status: 200, type: PageExtractResponseDto })
  @ApiResponse({ status: 400, description: 'url 누락 / 잘못된 URL / 비-HTML 응답' })
  async extractByQuery(@Query('url') url?: string) {
    return this.run(url);
  }

  @Post('extract')
  @ApiOperation({
    summary: '페이지 본문 추출 (POST)',
    description: 'GET과 동일하지만 URL을 body로 전달.',
  })
  @ApiBody({ type: PageExtractRequestDto })
  @ApiResponse({ status: 200, type: PageExtractResponseDto })
  async extractByBody(@Body() body: PageExtractRequestDto) {
    return this.run(body?.url);
  }

  private async run(url: string | undefined) {
    if (!url || !url.trim()) {
      throw new BadRequestException('url 파라미터가 필요합니다');
    }
    try {
      return await this.pageService.extract(url.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : '페이지 추출 실패';
      throw new BadRequestException(msg);
    }
  }

  @Get('img-proxy')
  @ApiOperation({
    summary: '외부 이미지 바이너리 프록시',
    description:
      'cross-origin-resource-policy: same-origin 등으로 브라우저가 직접 표시하지 못하는 ' +
      'CDN 이미지(예: Instagram)를 백엔드를 거쳐 그대로 스트리밍한다.',
  })
  @ApiQuery({ name: 'url', required: true })
  async imgProxy(@Query('url') url: string | undefined, @Res() res: Response) {
    if (!url || !url.trim()) {
      throw new BadRequestException('url 파라미터가 필요합니다');
    }
    try {
      const { buffer, contentType } = await this.pageService.fetchImageBuffer(
        url.trim(),
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '이미지 프록시 실패';
      throw new BadRequestException(msg);
    }
  }

  @Get('extract-title')
  @ApiOperation({
    summary: '페이지 본문에서 제목 관련 텍스트만 추출 (Ollama)',
    description:
      '/page/extract로 본문을 먼저 가져온 뒤, Ollama (기본 gemma4:26b)로 페이지 제목과 직접 관련된 본문 부분만 골라 반환합니다.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    example: 'https://example.com/article',
  })
  @ApiQuery({
    name: 'model',
    required: false,
    example: 'gemma4:26b',
  })
  @ApiResponse({ status: 200, type: PageExtractByTitleResponseDto })
  async extractTitleByQuery(
    @Query('url') url?: string,
    @Query('model') model?: string,
  ) {
    return this.runTitle(url, model);
  }

  @Post('extract-title')
  @ApiOperation({
    summary: '페이지 본문에서 제목 관련 텍스트만 추출 (Ollama, POST)',
  })
  @ApiBody({ type: PageExtractByTitleRequestDto })
  @ApiResponse({ status: 200, type: PageExtractByTitleResponseDto })
  async extractTitleByBody(@Body() body: PageExtractByTitleRequestDto) {
    return this.runTitle(body?.url, body?.model);
  }

  private async runTitle(
    url: string | undefined,
    model: string | undefined,
  ) {
    if (!url || !url.trim()) {
      throw new BadRequestException('url 파라미터가 필요합니다');
    }
    try {
      return await this.pageService.extractByTitle(url.trim(), {
        model: model?.trim() || undefined,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '제목 기반 본문 추출 실패';
      throw new BadRequestException(msg);
    }
  }

  @Get('extract-with-images')
  @ApiOperation({
    summary: '본문 + 이미지 비전 분석 (제목 기반 관련성 판정)',
    description:
      '/page/extract-title 결과에 더해, 페이지의 상위 N개 이미지를 비전 모델로 읽어 제목과의 관련성(yes/no)과 한 줄 설명을 반환합니다.',
  })
  @ApiQuery({ name: 'url', required: true })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({
    name: 'visionModel',
    required: false,
    description: '비전 분석에 쓸 모델 (이미지 처리 가능 모델)',
  })
  @ApiQuery({
    name: 'maxImages',
    required: false,
    description: '분석할 최대 이미지 개수',
  })
  @ApiResponse({ status: 200, type: PageWithImageAnalysisResponseDto })
  async extractWithImagesByQuery(
    @Query('url') url?: string,
    @Query('model') model?: string,
    @Query('visionModel') visionModel?: string,
    @Query('maxImages') maxImages?: string,
  ) {
    return this.runWithImages(url, model, visionModel, maxImages);
  }

  @Post('extract-with-images')
  @ApiOperation({ summary: '본문 + 이미지 비전 분석 (POST)' })
  @ApiBody({ type: PageWithImageAnalysisRequestDto })
  @ApiResponse({ status: 200, type: PageWithImageAnalysisResponseDto })
  async extractWithImagesByBody(
    @Body() body: PageWithImageAnalysisRequestDto,
  ) {
    return this.runWithImages(
      body?.url,
      body?.model,
      body?.visionModel,
      body?.maxImages != null ? String(body.maxImages) : undefined,
    );
  }

  private async runWithImages(
    url: string | undefined,
    model: string | undefined,
    visionModel: string | undefined,
    maxImages: string | undefined,
  ) {
    if (!url || !url.trim()) {
      throw new BadRequestException('url 파라미터가 필요합니다');
    }
    const max = maxImages != null ? Number(maxImages) : undefined;
    if (max != null && (!Number.isFinite(max) || max < 0)) {
      throw new BadRequestException('maxImages는 0 이상의 정수여야 합니다');
    }
    try {
      return await this.pageService.extractWithImageAnalysis(url.trim(), {
        model: model?.trim() || undefined,
        visionModel: visionModel?.trim() || undefined,
        maxImages: max,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '이미지 포함 추출 실패';
      throw new BadRequestException(msg);
    }
  }
}
