import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { InvitationService } from '../admin/invitation.service';
import { User } from '../db/entities/user.entity';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  role: 'admin' | 'member';
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface GoogleProfileInput {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
}

const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly invitations: InvitationService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  // userId → 표시 이름 캐시. AI 호출 시마다 DB 조회를 피하기 위함.
  // updateName 으로 변경되면 즉시 갱신 / TTL 만료 시 다음 조회에서 lazy refetch.
  // 프로세스 재시작 시 cold start — 첫 chat 요청에서만 한번 DB hit.
  private readonly nameCache = new Map<
    string,
    { name: string | null; expiresAt: number }
  >();
  private readonly nameCacheTtlMs = 60 * 60 * 1000; // 1시간

  // AI 시스템 프롬프트용 사용자 이름 조회 (캐시 우선).
  // null = 미설정/탈퇴. 빈 문자열은 미설정으로 취급.
  async getCachedName(userId: string): Promise<string | null> {
    const now = Date.now();
    const hit = this.nameCache.get(userId);
    if (hit && hit.expiresAt > now) return hit.name;
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true, name: true },
    });
    const name = u?.name?.trim() ? u.name.trim() : null;
    this.nameCache.set(userId, { name, expiresAt: now + this.nameCacheTtlMs });
    return name;
  }


  // 부팅 시 admin 가입이 필요한 상태인지 알려준다.
  // - users 가 비어있고 docker-compose 등에서 TH_ADMIN_EMAIL_ID 가 지정돼 있으면 needsAdminSetup=true.
  // - 프론트에서 이 응답으로 등록 폼을 노출.
  async getSetupStatus(): Promise<{
    needsAdminSetup: boolean;
    adminEmail?: string;
  }> {
    const count = await this.users.count();
    if (count > 0) return { needsAdminSetup: false };
    const adminEmail = process.env.TH_ADMIN_EMAIL_ID?.trim();
    if (!adminEmail) return { needsAdminSetup: false };
    return { needsAdminSetup: true, adminEmail };
  }

  // email/password 등록 — 두 시나리오:
  //   1) 첫 부팅 admin: 사용자 0명 + TH_ADMIN_EMAIL_ID/TH_ADMIN_PASSWORD 환경변수와 매칭되면 admin 으로 생성
  //   2) 초대받은 member: 토큰 검증 후 invited 이메일과 일치하면 member 로 생성
  async register(input: {
    email: string;
    password: string;
    token?: string;
  }): Promise<AuthUser> {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password) {
      throw new BadRequestException('email/password 가 필요합니다.');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('비밀번호는 8자 이상이어야 합니다.');
    }
    const exists = await this.users
      .createQueryBuilder('u')
      .where('lower(u.email) = :e', { e: email })
      .getOne();
    if (exists) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    let role: 'admin' | 'member' = 'member';
    const userCount = await this.users.count();
    if (userCount === 0) {
      // 부팅 admin 시나리오 — env 매칭 필수.
      const envEmail = process.env.TH_ADMIN_EMAIL_ID?.trim().toLowerCase();
      const envPass = process.env.TH_ADMIN_PASSWORD;
      if (!envEmail || !envPass) {
        throw new ForbiddenException(
          '관리자 자동 가입이 비활성화 상태입니다. TH_ADMIN_EMAIL_ID/TH_ADMIN_PASSWORD env 를 설정하세요.',
        );
      }
      if (email !== envEmail || input.password !== envPass) {
        throw new ForbiddenException(
          'docker-compose 의 TH_ADMIN_EMAIL_ID/TH_ADMIN_PASSWORD 와 일치해야 첫 관리자로 가입됩니다.',
        );
      }
      role = 'admin';
    } else {
      // 초대 토큰 시나리오.
      if (!input.token) {
        throw new ForbiddenException('초대 토큰이 필요합니다.');
      }
      const invite = await this.invitations.findPendingByToken(input.token);
      if (!invite) {
        throw new ForbiddenException('유효하지 않은 초대 토큰입니다.');
      }
      if (invite.email.trim().toLowerCase() !== email) {
        throw new ForbiddenException(
          '초대된 이메일과 다른 주소로는 가입할 수 없습니다.',
        );
      }
      role = 'member';
    }

    const hash = await bcrypt.hash(input.password, BCRYPT_COST);
    const created = this.users.create({
      email,
      passwordHash: hash,
      role,
    });
    const saved = await this.users.save(created);
    if (role === 'member' && input.token) {
      const invite = await this.invitations.findPendingByToken(input.token);
      if (invite) {
        await this.invitations.acceptByEmail(invite.email, saved.id);
      }
    }
    await this.touchLastLogin(saved.id);
    return this.toAuthUser(saved);
  }

  // 로그인된 사용자의 비밀번호 변경. Google-only 계정(passwordHash 없음)도
  // newPassword 만으로 새로 설정 가능 — 이 경우 currentPassword 검증은 생략.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthUser> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('새 비밀번호는 8자 이상이어야 합니다.');
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.passwordHash) {
      const ok = await bcrypt.compare(currentPassword ?? '', user.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');
      }
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const saved = await this.users.save(user);
    return this.toAuthUser(saved);
  }

  // 사용자 표시 이름(name) 변경. 빈 문자열은 null 로 저장. 캐시도 즉시 갱신.
  async updateName(userId: string, name: string): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const trimmed = name.trim();
    user.name = trimmed.length > 0 ? trimmed : null;
    const saved = await this.users.save(user);
    this.nameCache.set(userId, {
      name: saved.name?.trim() ? saved.name.trim() : null,
      expiresAt: Date.now() + this.nameCacheTtlMs,
    });
    return this.toAuthUser(saved);
  }

  async loginEmail(email: string, password: string): Promise<AuthUser> {
    const e = email.trim().toLowerCase();
    let user = await this.users
      .createQueryBuilder('u')
      .where('lower(u.email) = :e', { e })
      .getOne();

    // 첫 부팅 admin 자동 가입 — 사용자 0명 + TH_ADMIN_EMAIL_ID/TH_ADMIN_PASSWORD 일치 시
    // 별도 가입 폼 없이 로그인 시도만으로 admin 계정을 즉시 생성한다.
    if (!user) {
      const total = await this.users.count();
      if (total === 0) {
        const envEmail = process.env.TH_ADMIN_EMAIL_ID?.trim().toLowerCase();
        const envPass = process.env.TH_ADMIN_PASSWORD;
        if (envEmail && envPass && e === envEmail && password === envPass) {
          const hash = await bcrypt.hash(password, BCRYPT_COST);
          const created = this.users.create({
            email: e,
            // 첫 admin 의 표시 이름 — env 의 TH_ADMIN_EMAIL_ID 값(=이메일) 으로 초기화.
            // 사용자는 Settings 에서 변경 가능.
            name: e,
            passwordHash: hash,
            role: 'admin',
          });
          user = await this.users.save(created);
          await this.touchLastLogin(user.id);
          return this.toAuthUser(user);
        }
      }
    }

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    await this.touchLastLogin(user.id);
    return this.toAuthUser(user);
  }

  // 로그인 성공 시 last_login_at 갱신. 실패해도 로그인은 진행되도록 try/catch.
  private async touchLastLogin(userId: string): Promise<void> {
    try {
      await this.users.update(userId, { lastLoginAt: new Date() });
    } catch {
      // ignore
    }
  }

  // Google 로그인 콜백에서 호출.
  // - 기존 google_id 매칭: 정보 갱신 후 반환
  // - 같은 이메일의 기존 (email/password) 사용자가 있으면 → 자동 SSO 연동
  // - 그 외 신규: pending 초대가 있을 때만 member 가입. 초대 없으면 거부.
  async upsertFromGoogle(input: GoogleProfileInput): Promise<AuthUser> {
    let user = await this.users.findOne({
      where: { googleId: input.googleId },
    });
    if (user) {
      user.email = input.email;
      user.name = input.name ?? null;
      user.picture = input.picture ?? null;
      user = await this.users.save(user);
      await this.touchLastLogin(user.id);
      return this.toAuthUser(user);
    }

    // 같은 이메일의 기존 사용자가 있으면 SSO 연동.
    const byEmail = await this.users
      .createQueryBuilder('u')
      .where('lower(u.email) = :e', { e: input.email.trim().toLowerCase() })
      .getOne();
    if (byEmail) {
      byEmail.googleId = input.googleId;
      byEmail.name = byEmail.name ?? input.name ?? null;
      byEmail.picture = byEmail.picture ?? input.picture ?? null;
      const saved = await this.users.save(byEmail);
      await this.touchLastLogin(saved.id);
      return this.toAuthUser(saved);
    }

    // 신규 가입: 초대 필수.
    const invited = await this.invitations.hasPendingInvite(input.email);
    if (!invited) {
      throw new ForbiddenException('초대받지 않은 계정입니다');
    }

    user = this.users.create({
      googleId: input.googleId,
      email: input.email,
      name: input.name ?? null,
      picture: input.picture ?? null,
      role: 'member',
    });
    user = await this.users.save(user);
    await this.invitations.acceptByEmail(input.email, user.id);
    await this.touchLastLogin(user.id);
    return this.toAuthUser(user);
  }

  // 로그인 한 사용자가 자신의 계정에 Google SSO 를 연결.
  async linkGoogle(
    userId: string,
    input: GoogleProfileInput,
  ): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const owner = await this.users.findOne({
      where: { googleId: input.googleId },
    });
    if (owner && owner.id !== user.id) {
      throw new ConflictException(
        '다른 사용자에게 연결된 Google 계정입니다.',
      );
    }
    user.googleId = input.googleId;
    if (!user.name) user.name = input.name ?? null;
    if (!user.picture) user.picture = input.picture ?? null;
    const saved = await this.users.save(user);
    return this.toAuthUser(saved);
  }

  signToken(user: AuthUser): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
    });
  }

  async getById(id: string): Promise<AuthUser | null> {
    const u = await this.users.findOne({ where: { id } });
    return u ? this.toAuthUser(u) : null;
  }

  private toAuthUser(u: User): AuthUser {
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? undefined,
      picture: u.picture ?? undefined,
      role: u.role,
      hasPassword: !!u.passwordHash,
      hasGoogle: !!u.googleId,
    };
  }
}
