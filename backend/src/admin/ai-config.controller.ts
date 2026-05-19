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

  // 부팅 시 한 번 — DB 의 'ai' row 가 비어있으면 env (OLLAMA_GEMMA4_URL) 로 시드.
  // 이후 admin 이 Settings 에서 변경 시 DB 값이 우선이 되며 env 는 무시됨.
  async onModuleInit(): Promise<void> {
    const cfg = await this.load();
    const envEndpoint = process.env.OLLAMA_GEMMA4_URL?.trim();
    if (!cfg.endpoint && envEndpoint) {
      const seeded: AiConfig = { ...cfg, endpoint: envEndpoint };
      await this.configs.upsert(
        { key: AI_KEY, value: seeded },
        { conflictPaths: ['key'] },
      );
      this.logger.log(
        `seeded AI Endpoint from OLLAMA_GEMMA4_URL env: ${envEndpoint}`,
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
    };
    await this.configs.upsert(
      { key: AI_KEY, value: next },
      { conflictPaths: ['key'] },
    );
    return next;
  }
}
