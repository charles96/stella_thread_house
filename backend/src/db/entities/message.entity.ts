import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('messages')
@Index(['conversationId', 'id'])
@Index(['conversationId', 'position'])
export class Message {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'text' })
  role!: 'user' | 'assistant';

  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ type: 'text', nullable: true })
  thinking?: string | null;

  // images, searchImages, sources, readPages, hashtags, replySummary, followup,
  // metric, status, time, visionContext 등 가변/선택 필드.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  // 명시적 정렬 순서 — 사용자가 Message Navigator 에서 재정렬 시 갱신.
  // 0 부터 시작, conversation 별로 증가. id(uuidv7) 시간 정렬 대신 이걸로 ORDER BY.
  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
