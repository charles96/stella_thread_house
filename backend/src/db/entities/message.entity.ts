import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('messages')
@Index(['conversationId', 'id'])
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
