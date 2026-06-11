[![Docker Hub](https://img.shields.io/github/v/tag/charles96/stella_thread_house?sort=semver&logo=docker&logoColor=white&label=Docker%20Hub&color=2496ED)](https://hub.docker.com/r/charles1031/stella-th)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs)](https://nestjs.com/)
[![Tavily](https://img.shields.io/badge/Tavily-Search-FF6B35)](https://tavily.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

- [English](./README.md)

# Stella's Thread House
![intro](./assets/imgs/content_screen.png)
* 제니의 빅팬입니다. 저작권에 문제가 있다면 삭제하도록 하겠습니다.
## 개요
AI에게 정보를 획득하여 별도의 문서로 옮겨 관리하기 보다 응답 자체를 문서화하여 지식을 항구적으로 관리할순 없을까? 현재 문서와 다른 문서간에 연관성을 고려하여 관계된 문서를 자동으로 연결하여 정보의 탐색을 용이하게 할 순 없을까? 라는 단순한 물음에서 본 서비스를 만들게 되었습니다. 

## 동작에 대한 설명
사용자가 LLM에게 한 질문은 곧 소제목이 될수 있습니다. 예를 들어 "우리나라의 근대사에 대해 알려줘"라는 요청 메시지는 곧 "우리나라의 근대사"라는 제목으로 변경할 수 있을 것입니다. 또한 이를 통해 생성된 답변을 기반으로 hashtag를 AI를 통해 자동생성하여 다른 문서에서 작성된 hashtag와의 일치성을 기준으로 문서 간에 연관성(Related documents)을 맺을 수 있을 것입니다. 물론 hashtag는 동형이의어가 존재합니다. 따라서 한개의 hashtag 연결보다 복수개가 연결 되었을때 더욱 근접한 문서가 될 것입니다. 그리고 웹 검색을 통해 LLM이 응답을 하면 참조한 문서(Reference documents)를 시각화하고 해당 웹 문서를 넘버링화 하여 답변에서 어떤 문서를 기반으로 응답했는지를 표기하게 하였습니다. 위를 내용을 바탕으로 미약하지만 제텔카스텐 기법을 적용하였습니다.
## 기능 상세
### 사용 모드
Thread, Chat 두 모드가 존재합니다. Thread로 작성을 하면 hashtag를 자동으로 생성하여 문서들간에 연결합니다. 캐주얼하게 가볍게 질문을 하고 싶다면 Chat을 사용하면 됩니다. 하지만 Chat 모드는 AI 발화 처리에 있어 베이스 엔진은 동일하나 hashtag 연결을 통한 관련 문서 연결 및 발화 메시지 수정에 대해서는 제공하지 않습니다.
### Thread 모드
1. Reference documents
  - AI가 답변을 위해 웹 검색을 하면 실제 참조한 웹 리스트가 넘버링되며 바로 위에는 웹 검색을 통해 나온 이미지등의 컨텐츠들이 자리를 잡게 됩니다. 이때 문서와 관련된 핵심 이미지나 youtube의 경우 pin을 사용하여 화면에 고정시킬 수 있습니다. 또한 컨텐츠 에디터를 통해 불필요한 이미지를 삭제할 수 있으며 이미지의 위치 또한 조정이 가능합니다. 
2. 사용자 발화 -> 소제목 변경
  - 사용자 발화 메시지 클릭을 통해 제목으로 수정이 가능합니다.
3. 우측 메뉴
  - 소제목 기준 위 아래 순서 조정 및 이동 기능
  - 소제목 기준 문서 세트(질의,응답)를 삭제 기능
  - AI가 생성한 hashtag 관리 (추가,삭제 기능)
  - Related Documents
    - hashtag로 연결된 관련된 문서를 탐색합니다.
### 대시보드
- 최신 작성 글 탐색 및 hashtag 생성 정보 
![dashboard_main](./assets/imgs/dashboard_main.png)
- 전체 문서의 연결된 정보 시각화 제공 
![dashboard_graph](./assets/imgs/dashboard_graph.png)

## 응용방법
저는 이렇게 씁니다.
1. 유튜브의 링크를 주고 요약 요청, pip모드로 재생하며 중간중간 궁금증에 대해 질의를 하며 공부
2. 책에 대해 웹검색을 통한 요약, 책 내용 촬영하여 요약 또는 궁금한 부분을 질의 하여 문서화
3. 특정 주제에 맞는 웹 링크를 주며 내용 정리

## 필수사항
Ollama/LMStudio를 기반으로 gemma4, oss-20b 모델을 중점적으로 테스트 하였습니다.
**API Endpoint의 경우 반드시 끝에 /v1을 붙여주세요!**
- ex) http://ollama:11434 -> http://100.78.190.8:11434/v1

|구분|용도|
|--|--|
|Local LLM|OpenAI 호환 엔드 포인트 주소|
|Tavily API Key|웹 검색 용|

## 테스트 완료 AI 모델
openai gpt 호환 스펙 모드로 개발되었습니다. 아래는 테스트 완료 모델 리스트 입니다.

|구분|모델|용도|
|--|--|--|
|Ollama|Gemma4:26b|Reasoning Model|
|Ollama|Gemma4:26b|Vison Model|
|OpenAI|gpt-4o|Reasoning Model|
|OpenAI|gpt-4o|Vision Model|

# Deploy

## 빠른 시작
- **관리자 계정 + AI 엔드포인트 + Tavily 키**만 있으면 됩니다.

**`.env`**
```env
TH_ADMIN_EMAIL_ID=admin@example.com         # 관리자 로그인 이메일 아이디
TH_ADMIN_PASSWORD=changeme1234              # 관리자 로그인 비밀번호
OPENAI_BASE_URL=https://api.openai.com/v1   # AI Endpoint Url
OPENAI_API_KEY=sk-xxxxxxxx                  # OpenAI Key (인증 불필요한 Local LLM 서버면 필요 없음)
TAVILY_API_KEY=tvly-xxxxxxxx                # 웹 검색 (없으면 검색 비활성)
```

**`docker-compose.yml`**
```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: stella
      POSTGRES_USER: stella
      POSTGRES_PASSWORD: stella
    volumes:
      - pgdata:/var/lib/postgresql/18/docker

  app:
    image: charles1031/stella-th:latest
    restart: unless-stopped          # Postgres 준비될 때까지 재시도
    ports:
      - "3100:3100"                  # 웹 (프론트)
      - "4100:4100"                  # API (백엔드)
    env_file: .env
    environment:
      DATABASE_URL: postgres://stella:stella@postgres:5432/stella
    depends_on:
      - postgres

volumes:
  pgdata:
```

```bash
docker compose up -d
```
**http://localhost:3100** 접속 → 위 관리자 계정으로 로그인. AI 모델은 **Settings → AI** 에서 지정/조정.

> 커스텀 포트·호스트 볼륨·헬스체크·리버스 프록시가 필요하면 아래 전체 설정을 참고하세요.

## 1. `.env` 파일 작성

```env
# ── 필수 ──────────────────────────────────────────
# 최초 부팅 시 생성되는 관리자 계정
TH_ADMIN_EMAIL_ID=admin@example.com
TH_ADMIN_PASSWORD=changeme1234

# 리버스 프록시가 가리키는 웹(프론트) 공개 포트. 포트 충돌 시 변경.
TH_PORT=3100

# AI 공급자 — OpenAI 호환 base URL(/v1 포함) + API 키
#   OpenAI 클라우드: https://api.openai.com/v1
#   로컬 런타임(vLLM/LM Studio 등): http://host.docker.internal:11434/v1
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx   # 로컬 서버(인증 불필요)면 비워둠

# ── 선택 ──────────────────────────────────────────
# 웹 검색 기능 (없으면 웹 검색 비활성)
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxxx

# DB 계정 (기본값 사용 시 생략 가능)
# POSTGRES_USER=stella
# POSTGRES_PASSWORD=stella_dev_pass
# POSTGRES_DB=stella
```

## 2. `docker-compose.yml` 작성

```yaml
services:
  postgres:
    image: postgres:18-alpine
    container_name: stella-th-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-stella}
      POSTGRES_USER: ${POSTGRES_USER:-stella}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-stella_dev_pass}
    volumes:
      - postgres-data:/var/lib/postgresql/18/docker
    networks:
      - stella-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-stella} -d ${POSTGRES_DB:-stella}"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 10s

  app:
    image: charles1031/stella-th:1.1.0   # Docker Hub — 최신 태그로 교체
    container_name: stella-th-app
    restart: unless-stopped
    ports:
      - "4100:4100"   # backend (NestJS)
      - "${TH_PORT:-3100}:3100"   # 웹(프론트) — 포트 충돌 시 .env 의 TH_PORT 변경
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-stella}:${POSTGRES_PASSWORD:-stella_dev_pass}@postgres:5432/${POSTGRES_DB:-stella}
      UPLOAD_DIR: /app/backend/uploads
      LOG_DIR: /app/backend/logs
    volumes:
      - attachments-data:/app/backend/uploads
      - logs-data:/app/backend/logs
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - stella-net

networks:
  stella-net:
    driver: bridge

volumes:
  postgres-data:
  attachments-data:
  logs-data:
```

## 3. 실행

```bash
docker compose up -d
```

## 4. 접속
- http://localhost:3100
