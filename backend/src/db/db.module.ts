import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Folder } from './entities/folder.entity';
import { Invitation } from './entities/invitation.entity';
import { Message } from './entities/message.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from './entities/user.entity';
import { SCHEMA_SQL } from './schema.sql';

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
