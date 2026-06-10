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
      useFactory: () => ({
        type: 'postgres' as const,
        url:
          process.env.DATABASE_URL ??
          'postgres://stella:stella_dev_pass@localhost:5432/stella',
        entities: [User, Folder, Conversation, Message, Invitation, SystemConfig],
        synchronize: false,
        logging: process.env.DB_LOGGING === '1',
      }),
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
