import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SystemConfig } from '../db/entities/system-config.entity';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  from?: string;
  secure?: boolean;
}

const SMTP_KEY = 'smtp';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private cachedFrom: string | null = null;

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configs: Repository<SystemConfig>,
  ) {}

  // 관리자 화면에서 SMTP 설정이 갱신되면 호출 → transporter 재생성.
  invalidate(): void {
    this.transporter = null;
    this.cachedFrom = null;
  }

  private async loadConfig(): Promise<SmtpConfig> {
    // DB 값 우선, 없거나 누락된 키는 환경변수로 폴백.
    const row = await this.configs.findOne({ where: { key: SMTP_KEY } });
    const db = (row?.value as SmtpConfig) ?? {};
    return {
      host: db.host ?? process.env.SMTP_HOST,
      port:
        typeof db.port === 'number'
          ? db.port
          : Number(process.env.SMTP_PORT ?? 587),
      user: db.user ?? process.env.SMTP_USER,
      password: db.password ?? process.env.SMTP_PASS,
      from: db.from ?? process.env.SMTP_FROM ?? 'no-reply@stella.local',
      secure:
        typeof db.secure === 'boolean'
          ? db.secure
          : process.env.SMTP_SECURE === '1' ||
            Number(process.env.SMTP_PORT ?? 587) === 465,
    };
  }

  private async getTransporter(): Promise<{
    transporter: nodemailer.Transporter;
    from: string;
  }> {
    if (this.transporter && this.cachedFrom) {
      return { transporter: this.transporter, from: this.cachedFrom };
    }
    const cfg = await this.loadConfig();
    if (!cfg.host) {
      throw new Error(
        'SMTP host 가 설정되지 않았습니다. 관리자 → Settings → General 에서 SMTP 설정을 입력하거나 SMTP_HOST 환경변수를 지정하세요.',
      );
    }
    const port = cfg.port ?? 587;
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure: cfg.secure ?? port === 465,
      auth:
        cfg.user && cfg.password
          ? { user: cfg.user, pass: cfg.password }
          : undefined,
    });
    this.cachedFrom = cfg.from ?? 'no-reply@stella.local';
    return { transporter: this.transporter, from: this.cachedFrom };
  }

  async send(input: SendMailInput): Promise<{ from: string; messageId?: string }> {
    const { transporter, from } = await this.getTransporter();
    this.logger.log(`mail send → to=${input.to} from=${from}`);
    const info = await transporter.sendMail({
      from,
      // 일부 SMTP 서버(Gmail 등) 는 envelope from 을 인증 계정으로 강제 재작성하지만,
      // header from 은 명시적으로 우리가 설정한 값을 유지하도록 sender 도 같이 지정.
      sender: from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    this.logger.log(
      `mail sent to ${input.to}: messageId=${info.messageId} from=${from}`,
    );
    return { from, messageId: info.messageId };
  }
}
