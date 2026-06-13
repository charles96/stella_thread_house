import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Folder } from './entities/folder.entity';
import { Invitation } from './entities/invitation.entity';
import { Message } from './entities/message.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from './entities/user.entity';
import { SCHEMA_SQL, VECTOR_EXTENSION_SQL } from './schema.sql';

const logger = new Logger('DbModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const entities = [
          User,
          Folder,
          Conversation,
          Message,
          Invitation,
          SystemConfig,
        ];
        const base = {
          type: 'postgres' as const,
          entities,
          synchronize: false,
          logging: process.env.DB_LOGGING === '1',
        };
        // DATABASE_URL 이 명시돼 있으면 그대로 사용(로컬 dev 등).
        // 없으면 개별 POSTGRES_* 필드로 접속 — 비밀번호에 @ 등 특수문자가 있어도
        // URL 인코딩이 필요 없어 안전(운영 권장).
        const url = process.env.DATABASE_URL?.trim();
        if (url) {
          return { ...base, url };
        }
        return {
          ...base,
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          username: process.env.POSTGRES_USER ?? 'stella',
          password: process.env.POSTGRES_PASSWORD ?? 'stella_dev_pass',
          database: process.env.POSTGRES_DB ?? 'stella',
        };
      },
      // DataSource 연결 직후 스키마 초기화 — 다른 모듈의 onModuleInit 보다 먼저 실행됨.
      dataSourceFactory: async (options) => {
        const dataSource = new DataSource(options!);
        await dataSource.initialize();
        logger.log('Initializing database schema...');
        await dataSource.query(SCHEMA_SQL);
        logger.log('Database schema ready.');
        // RAG 준비용 pgvector 확장만 활성화 — 없으면 경고만 남기고 진행(앱 동작 보장).
        try {
          await dataSource.query(VECTOR_EXTENSION_SQL);
          logger.log('pgvector extension ready.');
        } catch (e) {
          logger.warn(
            `pgvector extension unavailable — skipped: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
        return dataSource;
      },
    }),
    TypeOrmModule.forFeature([
      User,
      Folder,
      Conversation,
      Message,
      Invitation,
      SystemConfig,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DbModule {}
