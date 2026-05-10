import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { FoldersService } from './folders.service';

@Controller('folders')
@UseGuards(AuthGuard('jwt'))
export class FoldersController {
  constructor(private readonly service: FoldersService) {}

  private uid(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  @Get()
  list(@Req() req: Request) {
    return this.service.listForUser(this.uid(req));
  }

  @Post()
  create(
    @Req() req: Request,
    @Body()
    body: {
      id?: string;
      name: string;
      kind?: 'thread' | 'chat';
      expanded?: boolean;
    },
  ) {
    return this.service.create(this.uid(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: string; expanded?: boolean },
  ) {
    return this.service.update(this.uid(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Req() req: Request, @Param('id') id: string) {
    await this.service.delete(this.uid(req), id);
  }
}
