-- 사용자 역할 추가 — 첫 가입자는 admin, 그 외는 member.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'member'));

-- 초대 테이블
CREATE TABLE IF NOT EXISTS invitations (
  id                  UUID         PRIMARY KEY DEFAULT uuidv7(),
  email               TEXT         NOT NULL,
  -- 초대 메일 링크에 포함되는 일회성 토큰. 가입 시 검증.
  token               TEXT         NOT NULL,
  invited_by          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status              TEXT         NOT NULL DEFAULT 'pending',
  accepted_user_id    UUID         REFERENCES users (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  accepted_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  CONSTRAINT invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked'))
);

-- 같은 이메일로 pending 초대가 중복되지 않게.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email_uidx
  ON invitations (lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS invitations_invited_by_idx
  ON invitations (invited_by);

-- 토큰 검증용 lookup. pending 상태에서만 의미 있음.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_uidx
  ON invitations (token)
  WHERE status = 'pending';
