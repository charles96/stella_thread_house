-- Postgres 18+ 에서 uuidv7() 가 빌트인. 별도 extension 불필요.

CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT uuidv7(),
  -- google_id 는 SSO 연동 후에만 채워짐. email/password 가입자는 NULL.
  google_id     TEXT,
  email         TEXT         NOT NULL,
  name          TEXT,
  picture       TEXT,
  -- bcrypt 해시. Google SSO only 사용자는 NULL.
  password_hash TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- google_id 가 NULL 이 아닐 때만 unique. (NULL 들끼리는 충돌 없음)
CREATE UNIQUE INDEX users_google_id_uidx ON users (google_id) WHERE google_id IS NOT NULL;
-- 이메일은 case-insensitive 로 unique.
CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));

CREATE TABLE folders (
  id          UUID         PRIMARY KEY DEFAULT uuidv7(),
  user_id     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  -- 'thread' / 'chat' — conversations.kind 와 동일 도메인. 사이드바에서 섹션별로 노출.
  kind        TEXT         NOT NULL DEFAULT 'thread'
                            CHECK (kind IN ('thread', 'chat')),
  expanded    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX folders_user_idx ON folders (user_id);

CREATE TABLE conversations (
  id                          UUID         PRIMARY KEY DEFAULT uuidv7(),
  user_id                     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  folder_id                   UUID         REFERENCES folders (id) ON DELETE SET NULL,
  -- 'thread' = 해시태그/Summary/그래프 등 풀 기능 / 'chat' = 단순 채팅 (메타 생성 없음)
  kind                        TEXT         NOT NULL DEFAULT 'thread'
                                            CHECK (kind IN ('thread', 'chat')),
  title                       TEXT         NOT NULL DEFAULT '',
  model                       TEXT,
  summary                     TEXT,
  summary_message_count       INTEGER,
  summary_updated_at          TIMESTAMPTZ,
  -- 누적 요약 (Summary 패널용)
  running_summary             TEXT,
  running_summary_answer_count INTEGER,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX conversations_user_idx ON conversations (user_id);
CREATE INDEX conversations_folder_idx ON conversations (folder_id);
CREATE INDEX conversations_user_updated_idx ON conversations (user_id, updated_at DESC);

-- 메시지는 별도 테이블로 분리해 keyset 페이지네이션. UUIDv7 자체가 시간순이라
-- (conversation_id, id DESC) 인덱스만으로 "최근 N개" 와 "특정 id 이전 N개" 조회가 가능.
CREATE TABLE messages (
  id              UUID         PRIMARY KEY DEFAULT uuidv7(),
  conversation_id UUID         NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            TEXT         NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT         NOT NULL DEFAULT '',
  thinking        TEXT,
  -- images, searchImages, sources, readPages, hashtags, replySummary, followup,
  -- metric, status, time, visionContext 등 가변/선택 필드를 통째로 저장.
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX messages_conv_id_desc_idx ON messages (conversation_id, id DESC);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
