-- 추가 인덱스 — 핫패스 쿼리에서 시퀀셜 스캔/추가 정렬을 회피하기 위한 보조 인덱스.
-- IF NOT EXISTS 로 신규 DB / 기존 DB 모두 안전하게 적용 가능.

-- folders.listForUser: WHERE user_id = ? ORDER BY created_at ASC (사이드바 매 로드)
-- 기존 folders_user_idx 만으로는 정렬을 위한 추가 sort 단계가 필요.
CREATE INDEX IF NOT EXISTS folders_user_created_idx
  ON folders (user_id, created_at ASC);

-- users(lower(email)) 표현식 인덱스 — auth/invitation 의 case-insensitive email 매칭에 사용.
-- 기존 users_email_idx 는 lower(email) 매칭에 적용되지 않아 시퀀셜 스캔.
CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users ((lower(email)));

-- messages.metadata 의 hashtags 키 존재 검사 (`m.metadata ? 'hashtags'`) 가속.
-- listForUser 의 hashtag 누적 + getGraphData 양쪽이 사용. GIN with jsonb_path_ops 가
-- ?/?&/?| 연산자에 가장 컴팩트.
CREATE INDEX IF NOT EXISTS messages_metadata_gin_idx
  ON messages USING gin (metadata jsonb_path_ops);
