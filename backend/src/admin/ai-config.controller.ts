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

// 출력 토큰 기본값 — chat.service 의 AI_MAX_TOKENS 와 동일 출처. GET 응답에서 미설정 그룹에
// 채워 보내, Settings UI 가 '기본값으로 동작 중'임을 빈칸 대신 값으로 보여주도록 한다.
const DEFAULT_MAX_TOKENS =
  Number(process.env.AI_MAX_TOKENS) > 0
    ? Math.floor(Number(process.env.AI_MAX_TOKENS))
    : 16384;

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

  // 부팅 시 한 번 — DB 의 'ai' row 의 '비어있는 필드만' env 로 시드.
  // 이후 admin 이 Settings 에서 변경 시 DB 값이 우선이 되며 env 는 무시됨.
  // Reasoning / Vision 그룹을 각각 endpoint / apiKey / model / maxTokens 로 시드:
  //   - AI_REASONING_ENDPOINT / AI_REASONING_API_KEY / AI_REASONING_MODEL / AI_REASONING_MAX_TOKENS
  //   - AI_VISION_ENDPOINT    / AI_VISION_API_KEY    / AI_VISION_MODEL    / AI_VISION_MAX_TOKENS
  async onModuleInit(): Promise<void> {
    const groups = await this.loadGroups();
    const next: AiGroups = {
      reasoning: { ...groups.reasoning },
      vision: { ...groups.vision },
    };
    let changed = false;

    const env = (k: string): string | undefined =>
      process.env[k]?.trim() || undefined;
    const envNum = (k: string): number | undefined => {
      const n = Number(process.env[k]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    };
    // 비어있는 필드만 채운다(시드). 이미 값이 있으면(=Settings 에서 설정됨) 건드리지 않음.
    const seed = (
      g: AiGroup,
      endpoint?: string,
      apiKey?: string,
      model?: string,
      maxTokens?: number,
    ) => {
      if (!g.endpoint && endpoint) {
        g.endpoint = endpoint;
        changed = true;
      }
      if (!g.apiKey && apiKey) {
        g.apiKey = apiKey;
        changed = true;
      }
      if (!g.model && model) {
        g.model = model;
        changed = true;
      }
      if (!g.maxTokens && maxTokens) {
        g.maxTokens = maxTokens;
        changed = true;
      }
    };

    seed(
      next.reasoning,
      env('AI_REASONING_ENDPOINT'),
      env('AI_REASONING_API_KEY'),
      env('AI_REASONING_MODEL'),
      envNum('AI_REASONING_MAX_TOKENS'),
    );
    seed(
      next.vision,
      env('AI_VISION_ENDPOINT'),
      env('AI_VISION_API_KEY'),
      env('AI_VISION_MODEL'),
      envNum('AI_VISION_MAX_TOKENS'),
    );

    if (changed) {
      await this.save(next);
      // API 키 원문은 로그에 남기지 않음.
      this.logger.log(
        `seeded AI config from env ` +
          `(reasoning: endpoint=${next.reasoning.endpoint ?? '-'}, model=${next.reasoning.model ?? '-'}, apiKey=${next.reasoning.apiKey ? 'set' : '-'}; ` +
          `vision: endpoint=${next.vision.endpoint ?? '-'}, model=${next.vision.model ?? '-'}, apiKey=${next.vision.apiKey ? 'set' : '-'})`,
      );
    }
  }

  private async loadRaw(): Promise<AiConfigValue> {
    const row = await this.configs.findOne({ where: { key: AI_KEY } });
    return (row?.value as AiConfigValue) ?? {};
  }

  // 정규화된 { reasoning, vision } 형태로 로드.
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
    const g = await this.loadGroups();
    // 미설정 maxTokens 는 기본값으로 채워 반환(표시용). 저장된 값은 그대로(비어있음) 유지.
    return {
      reasoning: {
        ...g.reasoning,
        maxTokens: g.reasoning.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
      vision: { ...g.vision, maxTokens: g.vision.maxTokens ?? DEFAULT_MAX_TOKENS },
    };
  }

  @Put()
  async update(@Body() body: AiConfigPatch): Promise<AiGroups> {
    const prev = await this.loadGroups();
    // 필드를 보낸 경우(undefined 아님)에만 갱신 — 빈 문자열로 보내면 '비우기'가 되도록.
    const pick = (v: string | undefined, prevV?: string): string | undefined =>
      v !== undefined ? v.trim() || undefined : prevV;
    // maxTokens — 보낸 경우에만 갱신. 양수 정수가 아니면(0/빈값 등) 비우기(기본값으로 복귀).
    const pickNum = (
      v: number | undefined,
      prevV?: number,
    ): number | undefined => {
      if (v === undefined) return prevV;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    };
    const merge = (patch: Partial<AiGroup> | undefined, base: AiGroup): AiGroup => ({
      endpoint: pick(patch?.endpoint, base.endpoint),
      apiKey: pick(patch?.apiKey, base.apiKey),
      model: pick(patch?.model, base.model),
      maxTokens: pickNum(patch?.maxTokens, base.maxTokens),
    });
    const next: AiGroups = {
      reasoning: merge(body.reasoning, prev.reasoning),
      vision: merge(body.vision, prev.vision),
    };
    await this.save(next);
    return next;
  }
}
