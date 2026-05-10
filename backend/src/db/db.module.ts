import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Folder } from './entities/folder.entity';
import { Invitation } from './entities/invitation.entity';
import { Message } from './entities/message.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        url:
          process.env.DATABASE_URL ??
          'postgres://stella:stella_dev_pass@localhost:5432/stella',
        entities: [
          User,
          Folder,
          Conversation,
          Message,
          Invitation,
          SystemConfig,
        ],
        // 스키마는 db/init/*.sql 로 생성. synchronize 사용 안 함.
        synchronize: false,
        logging: process.env.DB_LOGGING === '1',
      }),
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
