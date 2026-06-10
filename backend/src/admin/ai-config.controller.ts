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
import {
  AiConfigValue,
  AiGroup,
  AiGroups,
  normalizeAiConfig,
} from './ai-config.util';

const AI_KEY = 'ai';

// 부분 갱신용 — Reasoning / Vision 그룹 각각의 일부 필드만 보낼 수 있다.
type AiConfigPatch = {
  reasoning?: Partial<AiGroup>;
  vision?: Partial<AiGroup>;
};

// 관리자 전용 AI 설정 — system_config 'ai' row 에 저장.
// Reasoning / Vision 두 그룹이 각각 endpoint / apiKey / model 을 가진다(단일 진실 출처).
// env / localStorage 등 별도 폴백은 사용하지 않음(부팅 시 env 시드만 1회).
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
    const groups = await this.loadGroups();
    const next: AiGroups = {
      reasoning: { ...groups.reasoning },
      vision: { ...groups.vision },
    };
    let changed = false;

    const envApiKey = process.env.OPENAI_API_KEY?.trim();
    const envEndpoint = process.env.OPENAI_BASE_URL?.trim();
    // 두 그룹 모두 비어있을 때만 env 로 시드(기존 동작 호환 — 단일 endpoint/key).
    for (const g of [next.reasoning, next.vision]) {
      if (!g.apiKey && envApiKey) {
        g.apiKey = envApiKey;
        changed = true;
      }
      if (!g.endpoint && envEndpoint) {
        g.endpoint = envEndpoint;
        changed = true;
      }
    }

    if (changed) {
      await this.save(next);
      // API 키 원문은 로그에 남기지 않음.
      this.logger.log(
        `seeded AI config from env (endpoint=${next.reasoning.endpoint ?? '-'}, ` +
          `apiKey=${next.reasoning.apiKey ? 'set' : '-'})`,
      );
    }
  }

  private async loadRaw(): Promise<AiConfigValue> {
    const row = await this.configs.findOne({ where: { key: AI_KEY } });
    return (row?.value as AiConfigValue) ?? {};
  }

  // 정규화된 { reasoning, vision } 형태로 로드 — 레거시 flat 스키마도 자동 승격.
  private async loadGroups(): Promise<AiGroups> {
    return normalizeAiConfig(await this.loadRaw());
  }

  private async save(groups: AiGroups): Promise<void> {
    await this.configs.upsert(
      { key: AI_KEY, value: groups },
      { conflictPaths: ['key'] },
    );
  }

  @Get()
  async get(): Promise<AiGroups> {
    return this.loadGroups();
  }

  @Put()
  async update(@Body() body: AiConfigPatch): Promise<AiGroups> {
    const prev = await this.loadGroups();
    // 필드를 보낸 경우(undefined 아님)에만 갱신 — 빈 문자열로 보내면 '비우기'가 되도록.
    const pick = (v: string | undefined, prevV?: string): string | undefined =>
      v !== undefined ? v.trim() || undefined : prevV;
    const merge = (patch: Partial<AiGroup> | undefined, base: AiGroup): AiGroup => ({
      endpoint: pick(patch?.endpoint, base.endpoint),
      apiKey: pick(patch?.apiKey, base.apiKey),
      model: pick(patch?.model, base.model),
    });
    const next: AiGroups = {
      reasoning: merge(body.reasoning, prev.reasoning),
      vision: merge(body.vision, prev.vision),
    };
    await this.save(next);
    return next;
  }
}
