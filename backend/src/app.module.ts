import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
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
  // 전역 JWT 인증 가드 — 모든 라우트 보호. @Public() 라우트만 예외.
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
