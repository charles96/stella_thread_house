import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface UserSettings {
  tavilyTopRead?: number;
  hashtagThreshold?: number;
}

@Entity('users')
export class User {
  // Postgres 18 빌트인 uuidv7() 로 DB가 생성. INSERT 시 id 미지정.
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  // SSO 연동 후에만 채워짐. email/password 가입 직후엔 NULL.
  @Column({ name: 'google_id', type: 'text', nullable: true })
  googleId?: string | null;

  @Index()
  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', nullable: true })
  name?: string | null;

  @Column({ type: 'text', nullable: true })
  picture?: string | null;

  // bcrypt 해시. Google SSO only 사용자는 NULL.
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null;

  @Column({ type: 'text', default: 'member' })
  role!: 'admin' | 'member';

  // 마지막 로그인 시각. 로그인 전엔 NULL.
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: 'jsonb', default: {} })
  settings!: UserSettings;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
