/** DB 스키마 초기화 SQL — IF NOT EXISTS / DO 블록으로 멱등. */
export const SCHEMA_SQL = `
-- ── 01 core tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuidv7(),
  google_id     TEXT,
  email         TEXT        NOT NULL,
  name          TEXT,
  picture       TEXT,
  password_hash TEXT,
  role          TEXT        NOT NULL DEFAULT 'member',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'settings'
  ) THEN
    ALTER TABLE users ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deactivated BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_uidx
  ON users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx
  ON users (lower(email));

CREATE TABLE IF NOT EXISTS folders (
  id         UUID        PRIMARY KEY DEFAULT uuidv7(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  kind       TEXT        NOT NULL DEFAULT 'thread' CHECK (kind IN ('thread', 'chat')),
  expanded   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS folders_user_idx         ON folders (user_id);
CREATE INDEX IF NOT EXISTS folders_user_created_idx ON folders (user_id, created_at ASC);

CREATE TABLE IF NOT EXISTS conversations (
  id                           UUID        PRIMARY KEY DEFAULT uuidv7(),
  user_id                      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  folder_id                    UUID        REFERENCES folders (id) ON DELETE SET NULL,
  kind                         TEXT        NOT NULL DEFAULT 'thread' CHECK (kind IN ('thread', 'chat')),
  title                        TEXT        NOT NULL DEFAULT '',
  model                        TEXT,
  summary                      TEXT,
  summary_message_count        INTEGER,
  summary_updated_at           TIMESTAMPTZ,
  running_summary              TEXT,
  running_summary_answer_count INTEGER,
  hashtags                     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  excluded_hashtags            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS conversations_user_idx         ON conversations (user_id);
CREATE INDEX IF NOT EXISTS conversations_folder_idx       ON conversations (folder_id);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_user_thread_idx  ON conversations (user_id) WHERE kind = 'thread';

CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT uuidv7(),
  conversation_id UUID        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL DEFAULT '',
  thinking        TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  position        INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conv_id_desc_idx      ON messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_conv_position_idx     ON messages (conversation_id, position ASC);
CREATE INDEX IF NOT EXISTS messages_user_role_created_idx ON messages (conversation_id, created_at DESC) WHERE role = 'user';

-- ── 02 triggers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS conversations_set_updated_at ON conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 03 invitations ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id               UUID        PRIMARY KEY DEFAULT uuidv7(),
  email            TEXT        NOT NULL,
  token            TEXT        NOT NULL,
  invited_by       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'pending',
  accepted_user_id UUID        REFERENCES users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  CONSTRAINT invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email_uidx
  ON invitations (lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invitations_invited_by_idx ON invitations (invited_by);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_uidx
  ON invitations (token) WHERE status = 'pending';

-- ── 04 system_config ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS system_config_set_updated_at ON system_config;
CREATE TRIGGER system_config_set_updated_at
  BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 05 activity_log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('thread', 'chat')),
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, kind)
);

CREATE INDEX IF NOT EXISTS activity_log_user_date_idx ON activity_log (user_id, date DESC);

-- ── 06 admin index ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS users_role_admin_idx ON users (id) WHERE role = 'admin';
`;

// ── pgvector 확장 ────────────────────────────────────────────────────────────
// RAG 준비를 위한 vector 확장만 활성화한다(테이블/스키마 모델링은 RAG 구현 시 별도 설계).
// 코어 스키마(SCHEMA_SQL)와 분리해, pgvector 가 없는 환경에서도 앱이 정상 동작하도록
// db.module 이 이 SQL 을 try/catch 로 실행한다(없으면 경고만 남기고 건너뜀).
export const VECTOR_EXTENSION_SQL = `CREATE EXTENSION IF NOT EXISTS vector;`;
