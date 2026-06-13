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

  @Index()
  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', nullable: true })
  name?: string | null;

  @Column({ type: 'text', nullable: true })
  picture?: string | null;

  // bcrypt 해시.
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null;

  @Column({ type: 'text', default: 'member' })
  role!: 'admin' | 'member';

  // 관리자가 비활성화한 계정. true 면 로그인/모든 인증 요청이 401 로 거부됨.
  @Column({ name: 'is_deactivated', type: 'boolean', default: false })
  isDeactivated!: boolean;

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
