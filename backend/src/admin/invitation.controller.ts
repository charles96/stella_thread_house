import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { InvitationService } from './invitation.service';

@Controller('admin/invitations')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class InvitationController {
  constructor(private readonly service: InvitationService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Req() req: Request, @Body() body: { email: string }) {
    const sub = (req.user as { sub: string }).sub;
    return this.service.create(sub, body.email);
  }

  @Delete(':id')
  async revoke(@Param('id') id: string) {
    await this.service.revoke(id);
    return { ok: true };
  }
}
