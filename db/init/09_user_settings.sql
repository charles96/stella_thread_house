-- 사용자별 설정 저장 (tavilyTopRead, hashtagThreshold 등).
-- 없는 키는 서버 환경변수 기본값으로 폴백.
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
