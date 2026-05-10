import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../db/entities/user.entity';

// JwtAuthGuard 통과 후 req.user.sub(=DB UUID)로 role을 조회한다.
// 메모리 캐시는 두지 않음 — 권한 박탈 시 즉시 반영되도록.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const sub: string | undefined = req.user?.sub;
    if (!sub) throw new ForbiddenException('인증 필요');
    const user = await this.users.findOne({ where: { id: sub } });
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('관리자 권한 필요');
    }
    return true;
  }
}
