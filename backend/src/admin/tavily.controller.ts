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

const TAVILY_KEY = 'tavily';

type TavilyConfig = { apiKey?: string };
type TavilyConfigDto = { apiKeySet: boolean };

// 관리자 전용 Tavily 검색 API key — system_config 'tavily' row 가 단일 진실 출처.
// 부팅 시 env TAVILY_API_KEY 가 있으면 DB 가 비어있을 때 한해 seed.
// 이후 admin 이 Settings 에서 변경하면 DB 값이 우선이 되며 env 는 무시됨.
@ApiTags('admin/tavily')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/tavily')
export class TavilyController implements OnModuleInit {
  private readonly logger = new Logger(TavilyController.name);

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configs: Repository<SystemConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = await this.load();
    const envKey = process.env.TAVILY_API_KEY?.trim();
    if (!cfg.apiKey && envKey) {
      const seeded: TavilyConfig = { ...cfg, apiKey: envKey };
      await this.configs.upsert(
        { key: TAVILY_KEY, value: seeded },
        { conflictPaths: ['key'] },
      );
      this.logger.log('seeded Tavily API key from TAVILY_API_KEY env');
    }
  }

  private async load(): Promise<TavilyConfig> {
    const row = await this.configs.findOne({ where: { key: TAVILY_KEY } });
    return (row?.value as TavilyConfig) ?? {};
  }

  @Get()
  async get(): Promise<TavilyConfigDto> {
    const cfg = await this.load();
    return { apiKeySet: !!cfg.apiKey && cfg.apiKey.length > 0 };
  }

  @Put()
  async update(
    @Body() body: { apiKey?: string },
  ): Promise<TavilyConfigDto> {
    const prev = await this.load();
    const next: TavilyConfig = {
      apiKey:
        typeof body.apiKey === 'string' && body.apiKey.length > 0
          ? body.apiKey.trim()
          : prev.apiKey,
    };
    await this.configs.upsert(
      { key: TAVILY_KEY, value: next },
      { conflictPaths: ['key'] },
    );
    return { apiKeySet: !!next.apiKey && next.apiKey.length > 0 };
  }
}
