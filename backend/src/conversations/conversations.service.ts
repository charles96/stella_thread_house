import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Conversation } from '../db/entities/conversation.entity';
import { Message } from '../db/entities/message.entity';
import { AttachmentsService } from '../attachments/attachments.service';
import { ConversationEventsService } from './conversation-events.service';

export type ConversationPageDto = {
  data: ConversationDto[];
  nextCursor: string | null;
  hasMore: boolean;
};

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
  // 사용자가 명시적으로 배제한 hashtag — 그래프/통합표시에서 제외.
  excludedHashtags?: string[];
  pinned?: boolean;
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
  hashtags: string[];
  excludedHashtags: string[];
  pinned: boolean;
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
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    private readonly attachments: AttachmentsService,
    private readonly events: ConversationEventsService,
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
      hashtags: Array.isArray(c.hashtags) ? c.hashtags : [],
      excludedHashtags: Array.isArray(c.excludedHashtags)
        ? c.excludedHashtags
        : [],
      pinned: c.pinned ?? false,
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
      // TypeORM 의 save() 가 UPDATE 케이스에선 createdAt 을 채워주지 않음 →
      // 방어적으로 fallback (이론상 매핑 직후 DB refetch 로 채워지지만 안전망).
      createdAt:
        m.createdAt instanceof Date ? m.createdAt.getTime() : Date.now(),
    };
  }

  async listForUser(
    userId: string,
    cursor?: string,
    limit = 50,
  ): Promise<ConversationPageDto> {
    const cap = Math.min(Math.max(limit, 1), 200);
    const qb = this.conversations
      .createQueryBuilder('c')
      .where('c.user_id = :userId', { userId })
      .orderBy('c.updated_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(cap + 1);

    if (cursor) {
      const [tsStr, cursorId] = cursor.split('|');
      if (tsStr && cursorId) {
        qb.andWhere(
          '(c.updated_at < :ts OR (c.updated_at = :ts AND c.id < :cid))',
          { ts: new Date(tsStr), cid: cursorId },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > cap;
    if (hasMore) rows.pop();

    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.updatedAt.toISOString()}|${last.id}`
        : null;

    return { data: rows.map((r) => this.toDto(r)), nextCursor, hasMore };
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
    const dto = this.toDto(saved);
    // 사이드바 동기화 — 다른 기기/탭에 새 thread/chat 추가.
    this.events.emitUser({
      userId,
      type: 'conversation.upsert',
      payload: { conversation: dto },
    });
    return dto;
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
    if (patch.hashtags !== undefined) existing.hashtags = patch.hashtags;
    if (patch.excludedHashtags !== undefined)
      existing.excludedHashtags = patch.excludedHashtags;
    if (patch.pinned !== undefined) existing.pinned = patch.pinned;

    const saved = await this.conversations.save(existing);
    const dto = this.toDto(saved);
    // 사이드바 동기화 — 제목 변경/폴더 이동/핀 등을 다른 기기/탭에 반영.
    this.events.emitUser({
      userId,
      type: 'conversation.upsert',
      payload: { conversation: dto },
    });
    return dto;
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.conversations.findOne({ where: { id } });
    if (!existing) return;
    if (existing.userId !== userId) throw new ForbiddenException();
    // 1) 메시지들에 첨부된 파일을 먼저 디스크에서 삭제 (CASCADE 로 행이 사라지면 messageId 를 잃어버리므로 선행).
    try {
      const rows = (await this.messages.query(
        `SELECT id FROM messages WHERE conversation_id = $1`,
        [id],
      )) as { id: string }[];
      for (const r of rows) {
        try {
          this.attachments.deleteForMessage(r.id);
        } catch (e) {
          this.logger.warn(
            `[delete] attachment cleanup failed for message ${r.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `[delete] failed to enumerate message attachments: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // 2) DB 행 삭제 — messages 는 ON DELETE CASCADE 로 동반 삭제.
    await this.conversations.remove(existing);
    // 사이드바 동기화 — 다른 기기/탭에서 thread/chat 제거.
    this.events.emitUser({
      userId,
      type: 'conversation.deleted',
      payload: { id },
    });
  }

  // ----- 메시지 -----

  // before 가 없으면 최신 limit 개. 있으면 해당 id 보다 작은(=과거 position) limit 개.
  // after 가 있으면 해당 id 보다 큰(=미래 position) limit 개 — Thread 문서 순방향 페이지네이션.
  // after='__start__' 는 position > -1 (전체 처음부터) 을 의미하는 sentinel.
  async listMessages(
    userId: string,
    convId: string,
    before: string | null,
    after: string | null,
    limit: number,
  ): Promise<MessageDto[]> {
    await this.getOwned(userId, convId);
    const cap = Math.min(Math.max(limit, 1), 200);

    if (after !== null) {
      // 순방향(오래된→새로운) 페이지네이션
      let cursorPos = -1;
      if (after !== '__start__') {
        const ref = await this.messages.findOne({
          where: { id: after, conversationId: convId },
          select: ['position'],
        });
        if (ref) cursorPos = ref.position;
      }
      const rows = await this.messages
        .createQueryBuilder('m')
        .where('m.conversation_id = :convId', { convId })
        .andWhere('m.position > :pos', { pos: cursorPos })
        .orderBy('m.position', 'ASC')
        .take(cap)
        .getMany();
      return rows.map((m) => this.msgToDto(m));
    }

    // 역방향(새로운→오래된) 페이지네이션 — 기존 동작
    let cursorPos: number | null = null;
    if (before) {
      const ref = await this.messages.findOne({
        where: { id: before, conversationId: convId },
        select: ['position'],
      });
      if (ref) cursorPos = ref.position;
    }
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :convId', { convId })
      .orderBy('m.position', 'DESC')
      .take(cap);
    if (cursorPos !== null) {
      qb.andWhere('m.position < :pos', { pos: cursorPos });
    }
    const rows = await qb.getMany();
    // 클라이언트에서 시간 오름차순으로 표시하기 쉽게 ASC 로 뒤집어 반환.
    return rows.reverse().map((m) => this.msgToDto(m));
  }

  async appendMessages(
    userId: string,
    convId: string,
    inputs: MessageInput[],
  ): Promise<MessageDto[]> {
    if (inputs.length === 0) return [];
    const conv = await this.getOwned(userId, convId);
    // 새 메시지는 conversation 의 가장 큰 position + 1, +2, ... 로 부여.
    const maxRow = (await this.messages.query(
      `SELECT COALESCE(MAX(position), -1) AS max FROM messages WHERE conversation_id = $1`,
      [convId],
    )) as { max: number | string }[];
    const base = Number(maxRow?.[0]?.max ?? -1);
    const entities = inputs.map((i, idx) =>
      this.messages.create({
        id: i.id,
        conversationId: convId,
        role: i.role,
        content: i.content ?? '',
        thinking: i.thinking ?? null,
        metadata: i.metadata ?? {},
        position: base + 1 + idx,
      }),
    );
    const saved = await this.messages.save(entities);
    // 컨버세이션의 updatedAt 도 갱신해 사이드바에서 최신으로 정렬되게.
    await this.conversations.update({ id: convId }, { updatedAt: new Date() });
    // 사용자 발화 수를 활동 로그에 누적 — conversation/message 삭제와 독립적으로 보존.
    const userMsgCount = inputs.filter((i) => i.role === 'user').length;
    if (userMsgCount > 0) {
      try {
        await this.conversations.query(
          `INSERT INTO activity_log (user_id, date, kind, count)
           VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, $2, $3)
           ON CONFLICT (user_id, date, kind)
           DO UPDATE SET count = activity_log.count + EXCLUDED.count`,
          [userId, conv.kind ?? 'thread', userMsgCount],
        );
      } catch (e) {
        this.logger.warn(
          `activity_log upsert 실패(무시): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    // save() 가 UPDATE 케이스에선 createdAt 등 DB-생성 컬럼을 entity 에 채워주지 않으므로
    // 재조회로 완전한 값 확보. 입력 순서 보존.
    const ids = saved.map((m) => m.id);
    const refreshed = await this.messages.find({
      where: { id: In(ids), conversationId: convId },
    });
    const byId = new Map(refreshed.map((m) => [m.id, m]));
    const dtos = ids
      .map((id) => byId.get(id))
      .filter((m): m is Message => !!m)
      .map((m) => this.msgToDto(m));
    // 실시간 동기화 — 같은 thread 를 연 다른 기기/탭에 새 메시지 push.
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'messages.appended',
      payload: dtos,
    });
    return dtos;
  }

  // 클라이언트가 보낸 id 배열 순서대로 position 을 0, 1, 2... 로 재할당.
  // 누락된 메시지는 그대로 두면 position 충돌 → 같은 conversation 의 모든 메시지를
  // 한 번에 받아야 안전. 트랜잭션으로 전체 update.
  async reorderMessages(
    userId: string,
    convId: string,
    orderedIds: string[],
  ): Promise<void> {
    await this.getOwned(userId, convId);
    if (orderedIds.length === 0) return;
    // 무결성 검사 — conversation 의 실제 메시지 id 집합과 일치해야 함.
    const existing = await this.messages.find({
      where: { conversationId: convId },
      select: ['id'],
    });
    const existingIds = new Set(existing.map((m) => m.id));
    if (existingIds.size !== orderedIds.length) {
      throw new BadRequestException(
        `Reorder count mismatch: received ${orderedIds.length}, actual ${existingIds.size}.`,
      );
    }
    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Unknown message id: ${id}`);
      }
    }
    // 1-pass UPDATE — CASE WHEN 으로 각 id 에 position 매핑.
    // 큰 conversation 도 한 쿼리로 끝나도록 VALUES 절 사용.
    await this.messages.manager.transaction(async (mgr) => {
      const valuesSql = orderedIds
        .map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::int)`)
        .join(', ');
      const params: unknown[] = [];
      orderedIds.forEach((id, i) => {
        params.push(id, i);
      });
      await mgr.query(
        `UPDATE messages SET position = v.pos
         FROM (VALUES ${valuesSql}) AS v(id, pos)
         WHERE messages.id = v.id AND messages.conversation_id = $${params.length + 1}`,
        [...params, convId],
      );
    });
    // 실시간 동기화 — 목차(TOC) 드래그 등으로 바뀐 순서를 다른 기기/탭에 반영.
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'messages.reordered',
      payload: { orderedIds },
    });
  }

  // Bipartite graph: 노드 = thread conversation + hashtag, edge = thread → hashtag.
  // threshold = 두 thread 가 공통으로 가져야 하는 최소 hashtag 수.
  // 조건을 만족하는 쌍의 공통 hashtag 를 노드로, thread→hashtag 방향 edge 로 표현 (bipartite).
  async getGraphData(
    userId: string,
    threshold = 2,
  ): Promise<{
    nodes: { id: string; label: string; type: 'thread' | 'hashtag'; tagCount?: number }[];
    edges: { a: string; b: string }[];
  }> {
    const convs = await this.conversations.find({
      where: { userId, kind: 'thread' },
      select: ['id', 'title', 'hashtags', 'excludedHashtags'],
    });

    // 각 thread 의 유효 hashtag 집합 (excluded 제외)
    const tagsByConv = new Map<string, Set<string>>();
    for (const c of convs) {
      const excluded = new Set(
        (c.excludedHashtags ?? []).map((t) => t.toLowerCase()),
      );
      const set = new Set<string>();
      for (const t of c.hashtags ?? []) {
        const k = (t ?? '').trim();
        if (!k || excluded.has(k.toLowerCase())) continue;
        set.add(k);
      }
      tagsByConv.set(c.id, set);
    }

    const convIds = [...tagsByConv.keys()];
    const visibleHashtags = new Set<string>();
    const connectedThreadIds = new Set<string>();

    // 모든 thread 쌍(A, B) — 공통 hashtag 수 >= threshold 인 쌍의 공통 hashtag 만 노드로.
    for (let i = 0; i < convIds.length; i++) {
      for (let j = i + 1; j < convIds.length; j++) {
        const idA = convIds[i];
        const idB = convIds[j];
        const tagsA = tagsByConv.get(idA)!;
        const tagsB = tagsByConv.get(idB)!;
        const shared = [...tagsA].filter((t) => tagsB.has(t));
        if (shared.length >= threshold) {
          connectedThreadIds.add(idA);
          connectedThreadIds.add(idB);
          for (const tag of shared) visibleHashtags.add(tag);
        }
      }
    }

    const threadNodes = convs
      .map((c) => ({
        id: c.id,
        label: c.title,
        type: 'thread' as const,
        tagCount: tagsByConv.get(c.id)?.size ?? 0,
      }));

    const hashtagNodes = [...visibleHashtags].map((tag) => ({
      id: tag,
      label: tag,
      type: 'hashtag' as const,
    }));

    // thread → hashtag 엣지 (중복 제거)
    const edgeSet = new Set<string>();
    const edges: { a: string; b: string }[] = [];
    for (const convId of connectedThreadIds) {
      for (const tag of tagsByConv.get(convId) ?? []) {
        if (!visibleHashtags.has(tag)) continue;
        const key = `${convId}:${tag}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ a: convId, b: tag });
        }
      }
    }

    return { nodes: [...threadNodes, ...hashtagNodes], edges };
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
    // activity_log 에서 직접 조회 — conversation/message 삭제와 독립적으로 활동 내역 보존.
    const rows = (await this.conversations.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, count
       FROM activity_log
       WHERE user_id = $1
         AND date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - ($2 || ' days')::interval)
       ORDER BY date ASC`,
      [userId, safe],
    )) as {
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
    // 삭제된 메시지들의 첨부 파일도 디스크에서 정리.
    for (const id of ids) {
      try {
        this.attachments.deleteForMessage(id);
      } catch (e) {
        this.logger.warn(
          `[deleteMessages] attachment cleanup failed for ${id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    // 실시간 동기화 — 다른 기기/탭에서 해당 메시지(질문/답변)를 즉시 제거.
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.deleted',
      payload: { ids },
    });
  }

  // 메시지 metadata 만 partial-merge — 기존 키는 유지하고 partial 의 키로 덮어씀.
  // 백엔드 후처리(해시태그 생성 등) 가 frontend 와 race 해도 다른 키 값을 보존하기 위해 사용.
  async mergeMessageMetadata(
    userId: string,
    convId: string,
    msgId: string,
    partial: Record<string, unknown>,
  ): Promise<void> {
    await this.getOwned(userId, convId);
    const m = await this.messages.findOne({
      where: { id: msgId, conversationId: convId },
    });
    if (!m) throw new NotFoundException();
    m.metadata = { ...(m.metadata ?? {}), ...partial };
    await this.messages.save(m);
  }

  // 메시지의 content / thinking / metadata 부분 업데이트.
  // metadata 는 jsonb_set 처럼 깊은 머지 대신 통째로 교체 (호출자가 머지 책임).
  // ----- 실시간 스트리밍 미러링 emit 헬퍼 (chat.controller 가 호출) -----
  emitStreamStart(userId: string, convId: string, messageId: string): void {
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.stream.start',
      payload: { messageId },
    });
    // user 단위로도 알림 → 다른 thread/메뉴에 있어도 "응답 중"을 추적해 입력창 전역 중지.
    this.events.emitUser({
      userId,
      type: 'stream.active',
      payload: { conversationId: convId, messageId },
    });
  }
  emitStreamDelta(
    userId: string,
    convId: string,
    messageId: string,
    kind: 'content' | 'thinking',
    text: string,
  ): void {
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.delta',
      payload: { messageId, kind, text },
    });
  }
  // search/pages/page_timeout/image_*/status 등 raw 스트림 파트를 그대로 중계 →
  // 다른 기기/탭이 Reference documents·팝콘 이미지 UI 를 동일하게 점진 렌더.
  emitStreamPart(
    userId: string,
    convId: string,
    messageId: string,
    part: unknown,
  ): void {
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.part',
      payload: { messageId, part },
    });
  }
  emitStreamMetric(
    userId: string,
    convId: string,
    messageId: string,
    metric: {
      tokens: number;
      durationMs: number;
      tokensPerSec: number;
      promptTokens?: number;
    },
  ): void {
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.metric',
      payload: { messageId, ...metric },
    });
  }
  emitStreamEnd(userId: string, convId: string, messageId: string): void {
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.stream.end',
      payload: { messageId },
    });
    this.events.emitUser({
      userId,
      type: 'stream.inactive',
      payload: { conversationId: convId, messageId },
    });
  }

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
    const dto = this.msgToDto(saved);
    // 실시간 동기화 — 어시스턴트 최종 답변/편집을 다른 기기/탭에 push.
    this.events.emit({
      conversationId: convId,
      userId,
      type: 'message.updated',
      payload: dto,
    });
    return dto;
  }
}
