-- 마지막 로그인 시각 — Settings > Member 테이블에 표시. NULL 허용 (로그인 전 사용자).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
