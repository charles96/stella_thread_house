import {
  Body,
  Controller,
  Get,
  Logger,
  OnModuleInit,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from './admin.guard';
import { SystemConfig } from '../db/entities/system-config.entity';

const AI_KEY = 'ai';

type AiConfig = {
  // OpenAI 호환 base URL (예: https://api.openai.com/v1, http://host:11434/v1).
  endpoint?: string;
  reasoningModel?: string;
  visionModel?: string;
  // OpenAI 호환 API 키 (로컬 서버는 비워둬도 됨).
  apiKey?: string;
};

// 관리자 전용 AI 설정 — system_config 'ai' row 에 저장.
// AI Endpoint / Reasoning Model / Vision Model 의 단일 진실 출처.
// env / localStorage 등 별도 폴백은 사용하지 않음.
@ApiTags('admin/ai')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/ai')
export class AiConfigController implements OnModuleInit {
  private readonly logger = new Logger(AiConfigController.name);

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configs: Repository<SystemConfig>,
  ) {}

  // 부팅 시 한 번 — DB 의 'ai' row 의 비어있는 필드만 env 로 시드.
  // 이후 admin 이 Settings 에서 변경 시 DB 값이 우선이 되며 env 는 무시됨.
  //   - OPENAI_BASE_URL  : OpenAI 호환 base URL (예: https://api.openai.com/v1, http://host:11434/v1)
  //   - OPENAI_API_KEY   : OpenAI 호환 API 키 (로컬 서버는 불필요)
  async onModuleInit(): Promise<void> {
    const cfg = await this.load();
    const next: AiConfig = { ...cfg };
    let changed = false;

    const envApiKey = process.env.OPENAI_API_KEY?.trim();
    if (!next.apiKey && envApiKey) {
      next.apiKey = envApiKey;
      changed = true;
    }

    const envEndpoint = process.env.OPENAI_BASE_URL?.trim();
    if (!next.endpoint && envEndpoint) {
      next.endpoint = envEndpoint;
      changed = true;
    }

    if (changed) {
      await this.configs.upsert(
        { key: AI_KEY, value: next },
        { conflictPaths: ['key'] },
      );
      // API 키 원문은 로그에 남기지 않음.
      this.logger.log(
        `seeded AI config from env (endpoint=${next.endpoint ?? '-'}, ` +
          `apiKey=${next.apiKey ? 'set' : '-'})`,
      );
    }
  }

  private async load(): Promise<AiConfig> {
    const row = await this.configs.findOne({ where: { key: AI_KEY } });
    return (row?.value as AiConfig) ?? {};
  }

  @Get()
  async get(): Promise<AiConfig> {
    return this.load();
  }

  @Put()
  async update(@Body() body: AiConfig): Promise<AiConfig> {
    const prev = await this.load();
    // 필드를 보낸 경우(undefined 아님)에만 갱신 — 빈 문자열로 보내면 '비우기'가 되도록.
    // (기존 `|| prev` 방식은 빈 값이 항상 이전 값으로 폴백돼 키를 지울 수 없었음.)
    const pick = (v: string | undefined, prevV?: string): string | undefined =>
      v !== undefined ? v.trim() || undefined : prevV;
    const next: AiConfig = {
      endpoint: pick(body.endpoint, prev.endpoint),
      reasoningModel: pick(body.reasoningModel, prev.reasoningModel),
      visionModel: pick(body.visionModel, prev.visionModel),
      apiKey: pick(body.apiKey, prev.apiKey),
    };
    await this.configs.upsert(
      { key: AI_KEY, value: next },
      { conflictPaths: ['key'] },
    );
    return next;
  }
}
