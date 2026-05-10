import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

@Entity('invitations')
export class Invitation {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  // 초대 메일 링크에 포함되는 일회성 토큰. 가입 시 검증.
  @Column({ type: 'text' })
  token!: string;

  @Index()
  @Column({ name: 'invited_by', type: 'uuid' })
  invitedBy!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: InvitationStatus;

  @Column({ name: 'accepted_user_id', type: 'uuid', nullable: true })
  acceptedUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt?: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;
}
