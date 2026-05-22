-- 인덱스 최적화 3차 — 실제 쿼리 패턴 재점검 결과 반영.
-- 모든 변경은 IF EXISTS / IF NOT EXISTS 라 신규/기존 DB 모두 안전.

-- 1) Admin 유저 목록 정렬 인덱스 추가.
--    admin.user.controller 의 find({ order: { createdAt: 'ASC' } }) 가
--    created_at 인덱스 없이 full seq scan + 외부 정렬을 수행.
--    관리자 전용 엔드포인트라 빈도는 낮지만 인덱스 크기가 미미(~20 KB)하여 추가 비용 없음.
CREATE INDEX IF NOT EXISTS users_created_idx
  ON users (created_at ASC);

-- 2) 중복 인덱스 제거: conversations_user_idx (단일 컬럼 user_id).
--    conversations_user_updated_idx (user_id, updated_at DESC) 가 동일 leading column 을 포함하며
--    사이드바 페이지네이션 전체를 커버. 실제 코드에서 ORDER BY 없는 단독 user_id 조회는 존재하지 않음.
--    → 불필요한 BTREE 유지비 및 ~50 KB 절감.
DROP INDEX IF EXISTS conversations_user_idx;

-- 3) 레거시 인덱스 제거: messages_conv_id_desc_idx (conversation_id, id DESC).
--    06_messages_position.sql 에서 position 컬럼 도입 이후 모든 메시지 페이지네이션은
--    messages_conv_position_idx (conversation_id, position ASC) 를 사용.
--    id DESC 기반 정렬 쿼리는 더 이상 존재하지 않으므로 해당 인덱스는 dead weight.
--    → INSERT/UPDATE 시 인덱스 갱신 오버헤드 및 ~150 KB 절감.
DROP INDEX IF EXISTS messages_conv_id_desc_idx;
