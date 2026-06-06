import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmService } from '../llm/llm.service';
import { OllamaProvider } from '../llm/providers/ollama.provider';
import { OpenAICompatibleProvider } from '../llm/providers/openai-compatible.provider';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SystemConfig } from '../db/entities/system-config.entity';
import { PageModule } from '../page/page.module';

@Module({
  imports: [
    PageModule,
    AttachmentsModule,
    AuthModule,
    ConversationsModule,
    TypeOrmModule.forFeature([SystemConfig]),
  ],
  controllers: [ChatController],
  providers: [ChatService, LlmService, OllamaProvider, OpenAICompatibleProvider],
})
export class ChatModule {}
