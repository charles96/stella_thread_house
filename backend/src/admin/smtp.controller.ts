import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { SystemConfig } from '../db/entities/system-config.entity';
import { User } from '../db/entities/user.entity';
import { MailService } from '../mail/mail.service';

const SMTP_KEY = 'smtp';

// 관리자 전용 SMTP 설정 — system_config 테이블의 'smtp' row 에 저장.
// password 는 응답에선 마스킹하고, 빈 값 PUT 시엔 기존 값 유지.
type SmtpConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  from?: string;
  secure?: boolean;
};

type SmtpConfigDto = Omit<SmtpConfig, 'password'> & {
  // 비밀번호 설정 여부만 응답 (값 자체는 절대 보내지 않음).
  passwordSet: boolean;
};

@ApiTags('admin/smtp')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/smtp')
export class SmtpController {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configs: Repository<SystemConfig>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  private async load(): Promise<SmtpConfig> {
    const row = await this.configs.findOne({ where: { key: SMTP_KEY } });
    return (row?.value as SmtpConfig) ?? {};
  }

  @Get()
  async get(): Promise<SmtpConfigDto> {
    const cfg = await this.load();
    // DB 값이 비어있는 항목은 docker-compose 등에서 주입된 환경변수 SMTP_* 로 폴백.
    // 프론트엔드에서 초기 값을 보여줄 수 있도록.
    const envPort = Number(process.env.SMTP_PORT ?? 587);
    return {
      host: cfg.host ?? process.env.SMTP_HOST ?? '',
      port: cfg.port ?? (Number.isFinite(envPort) ? envPort : 587),
      user: cfg.user ?? process.env.SMTP_USER ?? '',
      from: cfg.from ?? process.env.SMTP_FROM ?? '',
      secure:
        cfg.secure ??
        (process.env.SMTP_SECURE === '1' || envPort === 465),
      passwordSet:
        (!!cfg.password && cfg.password.length > 0) ||
        (!!process.env.SMTP_PASS && process.env.SMTP_PASS.length > 0),
    };
  }

  @Put()
  async update(@Body() body: Partial<SmtpConfig>): Promise<SmtpConfigDto> {
    const prev = await this.load();
    // password 는 빈 문자열/undefined 면 기존 값 유지. 명시적으로 다른 값 들어오면 갱신.
    const next: SmtpConfig = {
      host: body.host?.trim() || undefined,
      port:
        typeof body.port === 'number' && Number.isFinite(body.port)
          ? body.port
          : prev.port,
      user: body.user?.trim() || undefined,
      password:
        typeof body.password === 'string' && body.password.length > 0
          ? body.password
          : prev.password,
      from: body.from?.trim() || undefined,
      secure: typeof body.secure === 'boolean' ? body.secure : prev.secure,
    };
    await this.configs.upsert(
      { key: SMTP_KEY, value: next },
      { conflictPaths: ['key'] },
    );
    // MailService 의 transporter 캐시 무효화 → 다음 발송부터 새 설정 사용.
    this.mail.invalidate();
    return {
      host: next.host ?? '',
      port: next.port ?? 587,
      user: next.user ?? '',
      from: next.from ?? '',
      secure: next.secure ?? false,
      passwordSet: !!next.password,
    };
  }

  // 테스트 발송 — 현재 SMTP 설정으로 메일 1통을 admin 의 이메일(또는 body.to)로 발송.
  @Post('test')
  async test(
    @Req() req: Request,
    @Body() body: { to?: string },
  ): Promise<{ ok: true; sentTo: string; from: string }> {
    const sub = (req.user as { sub: string }).sub;
    let to = body?.to?.trim();
    if (!to) {
      const u = await this.users.findOne({ where: { id: sub } });
      to = u?.email;
    }
    if (!to) throw new BadRequestException('Could not determine the recipient email.');
    const { from } = await this.mail.send({
      to,
      subject: "Stella's Thread House — SMTP Test",
      text: 'Your SMTP configuration is working correctly.',
      html: `<p>Your SMTP configuration is working correctly.</p><p style="color:#888;font-size:12px;">Sent at: ${new Date().toISOString()}</p>`,
    });
    return { ok: true, sentTo: to, from };
  }
}
