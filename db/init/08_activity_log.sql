-- 활동 로그 — heatmap 용 일자별 user-message 카운트.
-- conversation/message 가 삭제돼도 활동 내역은 보존되도록 별도 테이블로 분리.
-- user 삭제 시에만 CASCADE 로 동반 삭제.
CREATE TABLE IF NOT EXISTS activity_log (
  user_id  UUID  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date     DATE  NOT NULL,
  -- 'thread' / 'chat' — conversations.kind 와 동일 도메인.
  kind     TEXT  NOT NULL CHECK (kind IN ('thread', 'chat')),
  count    INT   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, kind)
);

-- heatmap 조회는 (user_id, date DESC) 패턴 — PK 의 leading column 으로 cover 되지만
-- 별도 인덱스로 ORDER BY date DESC 도 최적화.
CREATE INDEX IF NOT EXISTS activity_log_user_date_idx
  ON activity_log (user_id, date DESC);
