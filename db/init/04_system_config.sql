-- 키-값 형태의 시스템 설정 테이블. 현재는 SMTP 설정 한 행 ('smtp') 만 사용.
-- value 는 JSONB 로 자유로운 스키마 — 운영 중에 새 키를 추가해도 마이그레이션 불필요.
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT         PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 트리거 (set_updated_at 함수는 01_schema.sql 에서 생성됨).
DROP TRIGGER IF EXISTS system_config_set_updated_at ON system_config;
CREATE TRIGGER system_config_set_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
