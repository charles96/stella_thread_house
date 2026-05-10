import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../db/entities/user.entity';
import { AdminGuard } from './admin.guard';

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminUserController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get()
  async list() {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    // google_id 등 민감 필드 제외
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      picture: u.picture,
      role: u.role,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }));
  }

  // 사용자 role 변경 — admin/member 토글.
  // 자기 자신을 강등하면 admin 0명 위험 → 자기 자신 강등 금지.
  // 마지막 admin 을 강등하면 시스템에 admin 이 없어지므로 차단.
  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() body: { role: 'admin' | 'member' },
    @Req() req: Request,
  ) {
    const role = body?.role;
    if (role !== 'admin' && role !== 'member') {
      throw new BadRequestException('role 값이 잘못되었습니다.');
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    const requesterId = (req.user as { sub: string }).sub;
    if (id === requesterId && role === 'member') {
      throw new ForbiddenException('자기 자신을 강등할 수 없습니다.');
    }
    if (user.role === 'admin' && role === 'member') {
      const adminCount = await this.users.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        throw new ForbiddenException(
          '마지막 관리자는 강등할 수 없습니다. 다른 사용자를 먼저 admin 으로 승격하세요.',
        );
      }
    }

    user.role = role;
    const saved = await this.users.save(user);
    return {
      id: saved.id,
      email: saved.email,
      name: saved.name,
      picture: saved.picture,
      role: saved.role,
      lastLoginAt: saved.lastLoginAt,
      createdAt: saved.createdAt,
    };
  }
}
