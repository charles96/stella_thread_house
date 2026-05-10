import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../db/entities/invitation.entity';
import { SystemConfig } from '../db/entities/system-config.entity';
import { User } from '../db/entities/user.entity';
import { MailModule } from '../mail/mail.module';
import { AdminGuard } from './admin.guard';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { AiConfigController } from './ai-config.controller';
import { LogService } from './log.service';
import { SmtpController } from './smtp.controller';
import { SystemController } from './system.controller';
import { TavilyController } from './tavily.controller';
import { AdminUserController } from './user.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, SystemConfig, User]),
    MailModule,
  ],
  controllers: [
    InvitationController,
    AdminUserController,
    SmtpController,
    TavilyController,
    AiConfigController,
    SystemController,
  ],
  providers: [InvitationService, AdminGuard, LogService],
  exports: [InvitationService, LogService],
})
export class AdminModule {}
