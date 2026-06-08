import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AttachmentsService } from './attachments.service';

interface UploadItem {
  name?: string;
  dataUrl?: string;
}

interface UploadDto {
  messageId?: string;
  files?: UploadItem[];
}


@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  // 업로드 — 인증 필요. messageId 폴더 아래에 파일들을 저장하고 결과 URL/파일명 반환.
  @Post('upload')
  @UseGuards(AuthGuard('jwt'))
  upload(@Body() body: UploadDto): {
    files: { name: string; url: string }[];
  } {
    if (!body.messageId || !Array.isArray(body.files)) {
      return { files: [] };
    }
    const out: { name: string; url: string }[] = [];
    for (const f of body.files) {
      if (!f?.dataUrl) continue;
      const name = this.svc.saveDataUrl(
        body.messageId,
        f.name ?? 'image.jpg',
        f.dataUrl,
      );
      out.push({
        name,
        url: `/attachments/${body.messageId}/${encodeURIComponent(name)}`,
      });
    }
    return { files: out };
  }

  // 단일 파일 삭제 — Image Edit 모달에서 사용자가 직접 업로드한 이미지 제거 시 사용.
  @Delete(':messageId/:fileName')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  deleteFile(
    @Param('messageId') messageId: string,
    @Param('fileName') fileName: string,
  ) {
    const decoded = decodeURIComponent(fileName);
    this.svc.deleteFile(messageId, decoded);
    return { ok: true };
  }

  // 첨부 이미지 물리 회전 — 인증 필요. degrees(90/180/270) 만큼 시계방향 회전 후 같은 파일에 덮어쓴다.
  @Post('rotate')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async rotate(
    @Body() body: { messageId?: string; fileName?: string; degrees?: number },
  ) {
    if (
      !body.messageId ||
      !body.fileName ||
      typeof body.degrees !== 'number'
    ) {
      throw new BadRequestException('messageId, fileName, degrees 필요');
    }
    await this.svc.rotate(
      body.messageId,
      decodeURIComponent(body.fileName),
      body.degrees,
    );
    return { ok: true };
  }

  // 파일 서빙 — UUIDv7 messageId + 파일명. UUID 가 추측 어려운 식별자라 별도 인증 게이트는 생략.
  // 필요 시 AuthGuard 추가 가능.
  @Get(':messageId/:fileName')
  serve(
    @Param('messageId') messageId: string,
    @Param('fileName') fileName: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const decoded = decodeURIComponent(fileName);
    const { stream, size, mime, mtimeMs } = this.svc.read(messageId, decoded);
    // 회전 시 파일이 in-place 로 덮어써지므로, 캐시는 항상 재검증(no-cache)하되
    // Last-Modified 로 변경 없으면 304 를 주어 대역폭을 아낀다.
    const lastMod = new Date(Math.floor(mtimeMs / 1000) * 1000);
    res.setHeader('Last-Modified', lastMod.toUTCString());
    res.setHeader('Cache-Control', 'private, no-cache');
    const ims = req.headers['if-modified-since'];
    if (ims && new Date(ims).getTime() >= lastMod.getTime()) {
      stream.destroy();
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(size));
    stream.pipe(res);
  }
}
