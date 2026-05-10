import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ConversationsModule } from './conversations/conversations.module';
import { DbModule } from './db/db.module';
import { MailModule } from './mail/mail.module';
import { PageModule } from './page/page.module';

@Module({
  imports: [
    DbModule,
    MailModule,
    AdminModule,
    ConversationsModule,
    ChatModule,
    AuthModule,
    PageModule,
    AttachmentsModule,
  ],
})
export class AppModule {}
