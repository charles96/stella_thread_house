import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// 키-값 형태의 시스템 설정. 단일 row 기반 ('smtp' 등) — JSONB value 로 자유 스키마.
@Entity({ name: 'system_config' })
export class SystemConfig {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb', default: {} })
  value!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
