import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, filter, from, of } from 'rxjs';

// 대화 단위 실시간 이벤트 — 같은 thread 를 여러 기기/탭에서 열어둔 경우
// 한쪽의 변경(메시지 추가/수정/삭제/스트리밍)을 다른 쪽에 push 하기 위한 인메모리 pub/sub.
//
// NOTE: 단일 백엔드 인스턴스 전제(인메모리). 다중 인스턴스로 확장하면
//       Subject 대신 Redis pub/sub 등 외부 브로커로 교체해야 한다.
export type ConvEventType =
  | 'messages.appended'
  | 'message.updated'
  | 'message.deleted' // { ids }
  | 'messages.reordered' // { orderedIds } — 목차 드래그 등으로 순서 변경
  // 실시간 스트리밍 미러링 — 다른 기기/탭이 토큰 단위로 따라 그리고 입력창 상태도 동기화.
  | 'message.stream.start' // { messageId }
  | 'message.delta' // { messageId, kind: 'content'|'thinking', text }
  | 'message.part' // { messageId, part } — search/pages/status 등 raw 스트림 파트 (Reference documents·이미지)
  | 'message.metric' // { messageId, tokens, durationMs, tokensPerSec, promptTokens? }
  | 'message.stream.end'; // { messageId }

export interface ConvEvent {
  conversationId: string;
  userId: string;
  type: ConvEventType;
  // payload 는 type 별로 다름 (appended: MessageDto[], updated: MessageDto, deleted: { ids }).
  payload: unknown;
}

// 사이드바(대화 목록/폴더) 단위 이벤트 — 특정 대화에 묶이지 않으므로 user 단위로 브로드캐스트.
export type UserEventType =
  | 'conversation.upsert' // { conversation: ConversationDto } — 생성/제목/폴더이동/핀
  | 'conversation.deleted' // { id }
  | 'folder.upsert' // { folder: FolderDto } — 생성/이름변경/펼침
  | 'folder.deleted' // { id }
  // 어느 thread 가 스트리밍 중인지 user 단위로 알림 → 다른 thread 에 있어도 추적,
  // 네비게이션 시 입력창 중지 상태를 동기적으로 결정(플리커 방지).
  | 'stream.active' // { conversationId, messageId }
  | 'stream.inactive'; // { conversationId }

export interface UserEvent {
  userId: string;
  type: UserEventType;
  payload: unknown;
}

@Injectable()
export class ConversationEventsService {
  private readonly subject = new Subject<ConvEvent>();
  private readonly userSubject = new Subject<UserEvent>();
  // 진행 중인 스트림 추적 — 구독(새로고침/중간 접속) 시점에 stop 상태를 따라잡게 하기 위함.
  // conversationId -> { messageId, userId }
  private readonly active = new Map<
    string,
    { messageId: string; userId: string }
  >();

  emit(event: ConvEvent): void {
    if (event.type === 'message.stream.start') {
      const p = event.payload as { messageId: string };
      this.active.set(event.conversationId, {
        messageId: p.messageId,
        userId: event.userId,
      });
    } else if (event.type === 'message.stream.end') {
      this.active.delete(event.conversationId);
    }
    this.subject.next(event);
  }

  // 특정 대화 + 소유자에게만 흐르는 스트림 (SSE 구독용).
  // 진행 중인 스트림이 있으면 구독 즉시 stream.start 를 1회 재생 → 중간 접속/새로고침도
  // 입력창 stop 상태를 동기화 (이후 delta/최종 updated 로 내용은 따라잡음).
  stream(conversationId: string, userId: string): Observable<ConvEvent> {
    const live = this.subject
      .asObservable()
      .pipe(
        filter(
          (e) => e.conversationId === conversationId && e.userId === userId,
        ),
      );
    const active = this.active.get(conversationId);
    if (active && active.userId === userId) {
      const replay: ConvEvent = {
        conversationId,
        userId,
        type: 'message.stream.start',
        payload: { messageId: active.messageId },
      };
      return concat(of(replay), live);
    }
    return live;
  }

  // ----- 사이드바(user 단위) 이벤트 -----
  emitUser(event: UserEvent): void {
    this.userSubject.next(event);
  }

  userStream(userId: string): Observable<UserEvent> {
    const live = this.userSubject
      .asObservable()
      .pipe(filter((e) => e.userId === userId));
    // 구독(새로고침/신규 접속) 즉시 현재 진행 중인 스트림들을 stream.active 로 재생 →
    // 전역 입력창 중지 상태를 복원 (없으면 새로고침 시 잠금이 풀림).
    const replay: UserEvent[] = [];
    for (const [conversationId, s] of this.active.entries()) {
      if (s.userId === userId) {
        replay.push({
          userId,
          type: 'stream.active',
          payload: { conversationId, messageId: s.messageId },
        });
      }
    }
    return replay.length > 0 ? concat(from(replay), live) : live;
  }
}
