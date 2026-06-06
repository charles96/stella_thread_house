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
  endpoint?: string;
  reasoningModel?: string;
  visionModel?: string;
  // 'ollama' | 'openai-compatible' — 미설정이면 백엔드가 ollama 로 폴백.
  provider?: string;
  // OpenAI 호환 공급자용 API 키 (Ollama 는 무시).
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
  //   - AI_PROVIDER      : 'ollama' | 'openai-compatible'
  //   - OPENAI_BASE_URL  : OpenAI 호환 base URL (예: https://api.openai.com/v1)
  //   - OPENAI_API_KEY   : OpenAI 호환 API 키 (Ollama 는 불필요)
  //   - OLLAMA_BASE_URL  : Ollama base URL (예: http://host:11434)
  //   - OLLAMA_GEMMA4_URL: (레거시 별칭) OLLAMA_BASE_URL 미설정 시 폴백
  async onModuleInit(): Promise<void> {
    const cfg = await this.load();
    const next: AiConfig = { ...cfg };
    let changed = false;

    const envProvider = process.env.AI_PROVIDER?.trim();
    if (!next.provider && envProvider) {
      next.provider = envProvider;
      changed = true;
    }

    const envApiKey = process.env.OPENAI_API_KEY?.trim();
    if (!next.apiKey && envApiKey) {
      next.apiKey = envApiKey;
      changed = true;
    }

    // endpoint(base URL) — OpenAI 호환은 OPENAI_BASE_URL, Ollama 는 OLLAMA_BASE_URL.
    // OLLAMA_GEMMA4_URL 은 레거시 별칭으로 마지막 폴백.
    const envEndpoint =
      process.env.OPENAI_BASE_URL?.trim() ||
      process.env.OLLAMA_BASE_URL?.trim() ||
      process.env.OLLAMA_GEMMA4_URL?.trim();
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
        `seeded AI config from env (provider=${next.provider ?? '-'}, ` +
          `endpoint=${next.endpoint ?? '-'}, apiKey=${next.apiKey ? 'set' : '-'})`,
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
    const next: AiConfig = {
      endpoint: body.endpoint?.trim() || prev.endpoint,
      reasoningModel: body.reasoningModel?.trim() || prev.reasoningModel,
      visionModel: body.visionModel?.trim() || prev.visionModel,
      provider: body.provider?.trim() || prev.provider,
      apiKey: body.apiKey?.trim() || prev.apiKey,
    };
    await this.configs.upsert(
      { key: AI_KEY, value: next },
      { conflictPaths: ['key'] },
    );
    return next;
  }
}
