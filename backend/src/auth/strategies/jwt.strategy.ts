import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../../db/entities/user.entity';

interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  role?: 'admin' | 'member';
}

function cookieExtractor(req: Request): string | null {
  const reqWithCookies = req as Request & { cookies?: Record<string, string> };
  return reqWithCookies.cookies?.['stella_token'] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey:
        process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload) {
    // 모든 인증 요청에서 계정 상태를 확인 — 관리자가 비활성화한 사용자는
    // 토큰이 아직 유효해도 즉시 거부(401). 삭제된 사용자도 동일.
    // PK lookup 이라 비용이 작고, AdminGuard 도 동일하게 매 요청 조회한다.
    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: { id: true, role: true, isDeactivated: true },
    });
    if (!user) throw new UnauthorizedException('Account not found.');
    if (user.isDeactivated) {
      throw new UnauthorizedException('This account is deactivated.');
    }
    // sub은 AdminGuard 등 다른 곳에서 DB lookup용으로 사용.
    return {
      sub: payload.sub,
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      role: user.role,
    };
  }
}
