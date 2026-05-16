-- 인덱스 최적화 2차 — 실제 쿼리 패턴 조사 결과 반영.
-- 모든 변경은 IF EXISTS / IF NOT EXISTS 라 신규/기존 DB 모두 안전.

-- 1) Activity heatmap (conversations.service.ts:464) — user-role 메시지를 conversation_id+date 로 집계.
--    role='user' 만 partial 로 잡아 인덱스 크기 최소화. assistant 행 누적되어도 인덱스 크기는 user 행에만 비례.
CREATE INDEX IF NOT EXISTS messages_user_role_created_idx
  ON messages (conversation_id, created_at DESC)
  WHERE role = 'user';

-- 2) Thread graph 조회 (conversations.service.ts:413) — kind='thread' 만 partial.
--    사용자당 thread 만 다수면 user_idx 후 kind 필터링이 필요했음 → partial 로 정확히 thread 만 인덱싱.
CREATE INDEX IF NOT EXISTS conversations_user_thread_idx
  ON conversations (user_id)
  WHERE kind = 'thread';

-- 3) Admin guard / count (user.controller.ts:63, admin.guard.ts) — admin 행은 보통 1~소수.
--    선택도 매우 높은 partial → 거의 lookup-only 비용.
CREATE INDEX IF NOT EXISTS users_role_admin_idx
  ON users (id)
  WHERE role = 'admin';

-- 4) 중복 인덱스 정리: users_email_lower_idx 는 users_email_lower_uidx (UNIQUE) 와 동일 컬럼.
--    UNIQUE 인덱스가 모든 equality lookup 을 커버 → non-unique 사본은 dead weight.
DROP INDEX IF EXISTS users_email_lower_idx;

-- 5) Obsolete 인덱스 정리: messages_metadata_gin_idx 는 hashtag 가 message.metadata 에 저장되던
--    이전 구조 전용. 현재는 conversations.hashtags 컬럼이 단일 출처라 더 이상 ? 연산자가 사용되지 않음.
--    GIN 유지비(INSERT/UPDATE 시 인덱스 갱신) 가 효익을 초과 → 제거.
DROP INDEX IF EXISTS messages_metadata_gin_idx;
