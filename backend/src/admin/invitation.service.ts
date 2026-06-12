import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invitation } from '../db/entities/invitation.entity';
import { User } from '../db/entities/user.entity';
import { MailService } from '../mail/mail.service';

@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  async list(): Promise<Invitation[]> {
    return this.invitations.find({ order: { createdAt: 'DESC' } });
  }

  async create(
    invitedBy: string,
    rawEmail: string,
  ): Promise<Invitation> {
    const email = rawEmail.trim().toLowerCase();
    if (!email || !/^.+@.+\..+$/.test(email)) {
      throw new BadRequestException('Please enter a valid email address.');
    }

    // 이미 가입한 사용자인지 확인
    const existingUser = await this.users
      .createQueryBuilder('u')
      .where('lower(u.email) = :email', { email })
      .getOne();
    if (existingUser) {
      throw new ConflictException('This user is already registered.');
    }

    // 활성 초대가 있는지 확인 (lower-email 기준 부분 unique 인덱스 있음)
    const existing = await this.invitations
      .createQueryBuilder('i')
      .where("i.status = 'pending' AND lower(i.email) = :email", { email })
      .getOne();
    if (existing) {
      throw new ConflictException('An invitation has already been sent.');
    }

    const inviter = await this.users.findOne({ where: { id: invitedBy } });
    const token = this.makeToken();
    const invitation = this.invitations.create({
      email,
      token,
      invitedBy,
      status: 'pending',
    });
    const saved = await this.invitations.save(invitation);

    // 메일 발송 — 실패해도 초대는 유지(관리자가 재발송 가능)
    try {
      const front = (process.env.TH_HOST ?? 'http://localhost:3100').replace(/\/$/, '');
      const inviteUrl = `${front}/login?token=${encodeURIComponent(token)}`;
      const inviterLabel =
        inviter?.name ?? inviter?.email ?? 'Admin';
      await this.mail.send({
        to: email,
        subject: "Invitation to Stella's Thread House",
        text: `${inviterLabel} has invited you to Stella's Thread House. Open the link below to complete sign-up and set your password.\n\n${inviteUrl}`,
        html: `<p><strong>${inviterLabel}</strong> has invited you to Stella's Thread House.</p>
<p>Open the link below to complete sign-up and set your password.</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<p style="color:#888;font-size:11px;">Invited email: <code>${email}</code></p>`,
      });
    } catch (e) {
      (saved as Invitation & { mailError?: string }).mailError =
        e instanceof Error ? e.message : String(e);
    }

    return saved;
  }

  // 16 byte (32 hex) 랜덤 토큰. 충돌 확률 무시 가능.
  private makeToken(): string {
    const arr = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++)
        arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async findPendingByToken(token: string): Promise<Invitation | null> {
    if (!token) return null;
    return this.invitations.findOne({
      where: { token, status: 'pending' },
    });
  }

  async revoke(id: string): Promise<void> {
    const inv = await this.invitations.findOne({ where: { id } });
    if (!inv) throw new NotFoundException('Invitation not found.');
    if (inv.status !== 'pending') {
      throw new BadRequestException('Only pending invitations can be revoked.');
    }
    inv.status = 'revoked';
    await this.invitations.save(inv);
  }

  // 가입 시 호출 — 이메일에 대한 pending 초대를 accepted로 마킹.
  async acceptByEmail(email: string, userId: string): Promise<void> {
    const inv = await this.invitations
      .createQueryBuilder('i')
      .where("i.status = 'pending' AND lower(i.email) = :email", {
        email: email.toLowerCase(),
      })
      .getOne();
    if (!inv) return;
    inv.status = 'accepted';
    inv.acceptedAt = new Date();
    inv.acceptedUserId = userId;
    await this.invitations.save(inv);
  }

  // 초대(pending) 존재 여부 — 가입 게이팅에 사용.
  async hasPendingInvite(email: string): Promise<boolean> {
    const count = await this.invitations
      .createQueryBuilder('i')
      .where("i.status = 'pending' AND lower(i.email) = :email", {
        email: email.toLowerCase(),
      })
      .getCount();
    return count > 0;
  }
}
