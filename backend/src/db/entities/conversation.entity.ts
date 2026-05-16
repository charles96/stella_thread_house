import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('conversations')
export class Conversation {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ name: 'folder_id', type: 'uuid', nullable: true })
  folderId?: string | null;

  // 'thread' = full features (hashtags, summary, graph) / 'chat' = plain chat only.
  @Column({ type: 'text', default: 'thread' })
  kind!: 'thread' | 'chat';

  @Column({ type: 'text', default: '' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  model?: string | null;

  @Column({ type: 'text', nullable: true })
  summary?: string | null;

  @Column({ name: 'summary_message_count', type: 'int', nullable: true })
  summaryMessageCount?: number | null;

  @Column({
    name: 'summary_updated_at',
    type: 'timestamptz',
    nullable: true,
  })
  summaryUpdatedAt?: Date | null;

  // 누적 요약 (Summary 패널)
  @Column({ name: 'running_summary', type: 'text', nullable: true })
  runningSummary?: string | null;

  @Column({
    name: 'running_summary_answer_count',
    type: 'int',
    nullable: true,
  })
  runningSummaryAnswerCount?: number | null;

  // Thread 단위 통합 hashtag — AI 가 응답 생성 시 누적 union 으로 갱신. 사용자는 우측 패널에서 × 로 제거.
  @Column({
    name: 'hashtags',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  hashtags!: string[];

  // 사용자가 우측 패널 Hashtags 섹션에서 명시적으로 배제한 태그 — AI 가 재추가하지 않도록 blacklist.
  @Column({
    name: 'excluded_hashtags',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  excludedHashtags!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
