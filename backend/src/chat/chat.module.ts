import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AttachmentsModule } from '../attachments/attachments.module';
import { SystemConfig } from '../db/entities/system-config.entity';
import { PageModule } from '../page/page.module';

@Module({
  imports: [
    PageModule,
    AttachmentsModule,
    TypeOrmModule.forFeature([SystemConfig]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
