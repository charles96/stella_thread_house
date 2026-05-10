import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

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
  constructor() {
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
    // sub은 AdminGuard 등 다른 곳에서 DB lookup용으로 사용.
    return {
      sub: payload.sub,
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      role: payload.role ?? 'member',
    };
  }
}
