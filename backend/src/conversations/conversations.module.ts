import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../db/entities/conversation.entity';
import { Folder } from '../db/entities/folder.entity';
import { Message } from '../db/entities/message.entity';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Folder, Message])],
  controllers: [ConversationsController, FoldersController],
  providers: [ConversationsService, FoldersService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
