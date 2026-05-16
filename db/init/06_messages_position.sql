-- 기존 messages 테이블에 position 컬럼이 없으면 추가하고 conversation 별 id 순서로 backfill.
-- init/*.sql 은 데이터 디렉토리가 비어있을 때(=신규 설치) 만 실행되므로
-- 기존 배포 DB 는 backend ConversationsService 의 런타임 마이그레이션이 동일 작업 수행.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'position'
  ) THEN
    ALTER TABLE messages ADD COLUMN position INT NOT NULL DEFAULT 0;
    -- conversation 별로 id(uuidv7 시간 정렬) 순서대로 0,1,2... 부여.
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY id) - 1 AS pos
      FROM messages
    )
    UPDATE messages m SET position = r.pos FROM ranked r WHERE m.id = r.id;
    CREATE INDEX IF NOT EXISTS messages_conv_position_idx ON messages (conversation_id, position ASC);
  END IF;
END $$;
