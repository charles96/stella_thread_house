import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from '../db/entities/system-config.entity';
import { MailService } from './mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
