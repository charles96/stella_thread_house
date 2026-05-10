import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Conversation } from '../db/entities/conversation.entity';
import { Message } from '../db/entities/message.entity';

// 메시지를 제외한 conversation 메타.
export type ConversationDto = {
  id: string;
  userId: string;
  folderId?: string | null;
  kind: 'thread' | 'chat';
  title: string;
  model?: string | null;
  summary?: string | null;
  summaryMessageCount?: number | null;
  summaryUpdatedAt?: number | null;
  runningSummary?: string | null;
  runningSummaryAnswerCount?: number | null;
  updatedAt: number;
  createdAt: number;
  // 누적 해시태그 (메시지 metadata.hashtags 합집합) — 우측 패널 Related Documents 용.
  // listForUser 에서만 채워지고 다른 응답에선 undefined.
  hashtags?: string[];
};

export type MessageDto = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type ConversationUpdate = Partial<{
  folderId: string | null;
  title: string;
  model: string | null;
  summary: string | null;
  summaryMessageCount: number | null;
  summaryUpdatedAt: number | null;
  runningSummary: string | null;
  runningSummaryAnswerCount: number | null;
}>;

export type ConversationCreate = {
  id?: string;
  folderId?: string | null;
  kind?: 'thread' | 'chat';
  title?: string;
  model?: string | null;
};

export type MessageInput = {
  id?: string;
  role: 'user' | 'assistant';
  content?: string;
  thinking?: string | null;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
  ) {}

  private toDto(c: Conversation): ConversationDto {
    return {
      id: c.id,
      userId: c.userId,
      folderId: c.folderId ?? null,
      kind: c.kind ?? 'thread',
      title: c.title,
      model: c.model ?? null,
      summary: c.summary ?? null,
      summaryMessageCount: c.summaryMessageCount ?? null,
      summaryUpdatedAt: c.summaryUpdatedAt
        ? c.summaryUpdatedAt.getTime()
        : null,
      runningSummary: c.runningSummary ?? null,
      runningSummaryAnswerCount: c.runningSummaryAnswerCount ?? null,
      updatedAt: c.updatedAt.getTime(),
      createdAt: c.createdAt.getTime(),
    };
  }

  private msgToDto(m: Message): MessageDto {
    return {
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      thinking: m.thinking ?? null,
      metadata: m.metadata ?? {},
      createdAt: m.createdAt.getTime(),
    };
  }

  async listForUser(userId: string): Promise<ConversationDto[]> {
    const rows = await this.conversations.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    // 메시지 metadata.hashtags 를 conversation 별로 합집합 → 응답에 hashtags 필드로 부착.
    // 페이지 새로고침 직후에도 우측 Related Documents 가 동작하도록.
    const tagRows = (await this.messages
      .createQueryBuilder('m')
      .innerJoin('conversations', 'c', 'c.id = m.conversation_id')
      .where('c.user_id = :userId', { userId })
      .andWhere("m.metadata ? 'hashtags'")
      .select('m.conversation_id', 'conversation_id')
      .addSelect("m.metadata->'hashtags'", 'tags')
      .getRawMany()) as { conversation_id: string; tags: unknown }[];
    const tagsByConv = new Map<string, Set<string>>();
    for (const r of tagRows) {
      const arr = Array.isArray(r.tags) ? (r.tags as unknown[]) : [];
      let set = tagsByConv.get(r.conversation_id);
      if (!set) {
        set = new Set();
        tagsByConv.set(r.conversation_id, set);
      }
      for (const t of arr) {
        if (typeof t === 'string') {
          const k = t.trim();
          if (k) set.add(k);
        }
      }
    }
    return rows.map((r) => {
      const dto = this.toDto(r);
      const tags = tagsByConv.get(r.id);
      dto.hashtags = tags ? Array.from(tags) : [];
      return dto;
    });
  }

  async getOwned(userId: string, id: string): Promise<Conversation> {
    const c = await this.conversations.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (c.userId !== userId) throw new ForbiddenException();
    return c;
  }

  async create(
    userId: string,
    input: ConversationCreate,
  ): Promise<ConversationDto> {
    const c = this.conversations.create({
      id: input.id,
      userId,
      folderId: input.folderId ?? null,
      kind: input.kind ?? 'thread',
      title: input.title ?? '',
      model: input.model ?? null,
    });
    const saved = await this.conversations.save(c);
    return this.toDto(saved);
  }

  async update(
    userId: string,
    id: string,
    patch: ConversationUpdate,
  ): Promise<ConversationDto> {
    const existing = await this.getOwned(userId, id);

    if (patch.title !== undefined) existing.title = patch.title;
    if (patch.model !== undefined) existing.model = patch.model;
    if (patch.folderId !== undefined) existing.folderId = patch.folderId;
    if (patch.summary !== undefined) existing.summary = patch.summary;
    if (patch.summaryMessageCount !== undefined)
      existing.summaryMessageCount = patch.summaryMessageCount;
    if (patch.summaryUpdatedAt !== undefined)
      existing.summaryUpdatedAt = patch.summaryUpdatedAt
        ? new Date(patch.summaryUpdatedAt)
        : null;
    if (patch.runningSummary !== undefined)
      existing.runningSummary = patch.runningSummary;
    if (patch.runningSummaryAnswerCount !== undefined)
      existing.runningSummaryAnswerCount = patch.runningSummaryAnswerCount;

    const saved = await this.conversations.save(existing);
    return this.toDto(saved);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.conversations.findOne({ where: { id } });
    if (!existing) return;
    if (existing.userId !== userId) throw new ForbiddenException();
    await this.conversations.remove(existing);
  }

  // ----- 메시지 -----

  // before 가 없으면 최신 limit 개. 있으면 해당 id 보다 작은(=과거) limit 개.
  // UUIDv7 자체가 시간 정렬이므로 id 비교만으로 keyset 페이지네이션 성립.
  async listMessages(
    userId: string,
    convId: string,
    before: string | null,
    limit: number,
  ): Promise<MessageDto[]> {
    await this.getOwned(userId, convId);
    const cap = Math.min(Math.max(limit, 1), 200);
    const where = before
      ? { conversationId: convId, id: LessThan(before) }
      : { conversationId: convId };
    const rows = await this.messages.find({
      where,
      order: { id: 'DESC' },
      take: cap,
    });
    // 클라이언트에서 시간 오름차순으로 표시하기 쉽게 ASC 로 뒤집어 반환.
    return rows.reverse().map((m) => this.msgToDto(m));
  }

  async appendMessages(
    userId: string,
    convId: string,
    inputs: MessageInput[],
  ): Promise<MessageDto[]> {
    if (inputs.length === 0) return [];
    await this.getOwned(userId, convId);
    const entities = inputs.map((i) =>
      this.messages.create({
        id: i.id,
        conversationId: convId,
        role: i.role,
        content: i.content ?? '',
        thinking: i.thinking ?? null,
        metadata: i.metadata ?? {},
      }),
    );
    const saved = await this.messages.save(entities);
    // 컨버세이션의 updatedAt 도 갱신해 사이드바에서 최신으로 정렬되게.
    await this.conversations.update({ id: convId }, { updatedAt: new Date() });
    return saved.map((m) => this.msgToDto(m));
  }

  // 사용자의 모든 conversation 별 unique hashtag 집합을 모아, 임계값 이상 공유하는 쌍을 edge 로.
  // 노드 = conversation, edge = 공유 태그 수 >= threshold.
  async getGraphData(
    userId: string,
    threshold = 3,
  ): Promise<{
    nodes: { id: string; title: string; tagCount: number }[];
    edges: { a: string; b: string; shared: string[] }[];
  }> {
    // SQL 한 번으로 conversation × hashtag 를 펼친 다음 JS 에서 집합 연산.
    // 메시지 metadata 의 hashtags(배열)만 사용. 작은 conversation 수 기준으로 충분히 빠름.
    const rows = (await this.messages
      .createQueryBuilder('m')
      .innerJoin('conversations', 'c', 'c.id = m.conversation_id')
      .where('c.user_id = :userId', { userId })
      .andWhere("m.metadata ? 'hashtags'")
      .select('m.conversation_id', 'conversation_id')
      .addSelect("m.metadata->'hashtags'", 'tags')
      .getRawMany()) as { conversation_id: string; tags: unknown }[];

    const tagsByConv = new Map<string, Set<string>>();
    for (const r of rows) {
      const arr = Array.isArray(r.tags) ? (r.tags as unknown[]) : [];
      let set = tagsByConv.get(r.conversation_id);
      if (!set) {
        set = new Set();
        tagsByConv.set(r.conversation_id, set);
      }
      for (const t of arr) {
        if (typeof t === 'string') {
          const k = t.trim();
          if (k) set.add(k);
        }
      }
    }

    // 메시지가 없는 conversation 도 노드로는 노출. 단, kind='thread' 만 그래프 대상.
    const convs = await this.conversations.find({
      where: { userId, kind: 'thread' },
      select: ['id', 'title'],
    });
    const nodes = convs.map((c) => ({
      id: c.id,
      title: c.title,
      tagCount: tagsByConv.get(c.id)?.size ?? 0,
    }));

    const edges: { a: string; b: string; shared: string[] }[] = [];
    const ids = convs.map((c) => c.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = tagsByConv.get(ids[i]);
        const B = tagsByConv.get(ids[j]);
        if (!A || !B) continue;
        const shared: string[] = [];
        for (const t of A) if (B.has(t)) shared.push(t);
        if (shared.length >= threshold) {
          edges.push({ a: ids[i], b: ids[j], shared });
        }
      }
    }
    return { nodes, edges };
  }

  // GitHub-style heatmap 데이터 — KST 기준 일자별 사용자 메시지 수, kind 별로 분리.
  // role='user' 만 집계 (assistant 응답은 자동 생성이라 활동량 의미가 약함).
  async getActivityData(
    userId: string,
    days = 365,
  ): Promise<{
    thread: { date: string; count: number }[];
    chat: { date: string; count: number }[];
  }> {
    const safe = Math.max(1, Math.min(days, 730));
    const rows = (await this.messages
      .createQueryBuilder('m')
      .innerJoin('conversations', 'c', 'c.id = m.conversation_id')
      .select(
        "to_char((m.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')",
        'date',
      )
      .addSelect('c.kind', 'kind')
      .addSelect('COUNT(*)::int', 'count')
      .where('c.user_id = :userId', { userId })
      .andWhere("m.role = 'user'")
      .andWhere(
        `m.created_at >= (now() AT TIME ZONE 'Asia/Seoul')::date - (:days || ' days')::interval`,
        { days: safe },
      )
      .groupBy('date')
      .addGroupBy('c.kind')
      .orderBy('date', 'ASC')
      .getRawMany()) as {
      date: string;
      kind: string;
      count: string | number;
    }[];
    const thread: { date: string; count: number }[] = [];
    const chat: { date: string; count: number }[] = [];
    for (const r of rows) {
      const cell = {
        date: r.date,
        count: typeof r.count === 'string' ? parseInt(r.count, 10) : r.count,
      };
      if (r.kind === 'chat') chat.push(cell);
      else thread.push(cell);
    }
    return { thread, chat };
  }

  async deleteMessages(
    userId: string,
    convId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.getOwned(userId, convId);
    await this.messages
      .createQueryBuilder()
      .delete()
      .where('conversation_id = :convId AND id IN (:...ids)', {
        convId,
        ids,
      })
      .execute();
  }

  // 메시지의 content / thinking / metadata 부분 업데이트.
  // metadata 는 jsonb_set 처럼 깊은 머지 대신 통째로 교체 (호출자가 머지 책임).
  async updateMessage(
    userId: string,
    convId: string,
    msgId: string,
    patch: {
      content?: string;
      thinking?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MessageDto> {
    await this.getOwned(userId, convId);
    const m = await this.messages.findOne({
      where: { id: msgId, conversationId: convId },
    });
    if (!m) throw new NotFoundException();
    if (patch.content !== undefined) m.content = patch.content;
    if (patch.thinking !== undefined) m.thinking = patch.thinking;
    if (patch.metadata !== undefined) m.metadata = patch.metadata;
    const saved = await this.messages.save(m);
    return this.msgToDto(saved);
  }
}
