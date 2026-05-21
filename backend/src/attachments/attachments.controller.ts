import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
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

  // 파일 서빙 — UUIDv7 messageId + 파일명. UUID 가 추측 어려운 식별자라 별도 인증 게이트는 생략.
  // 필요 시 AuthGuard 추가 가능.
  @Get(':messageId/:fileName')
  serve(
    @Param('messageId') messageId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const decoded = decodeURIComponent(fileName);
    const { stream, size, mime } = this.svc.read(messageId, decoded);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  }
}
