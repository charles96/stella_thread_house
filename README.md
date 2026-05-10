# Stella's Thread House — 배포 가이드

Ollama 기반 챗봇. Docker Compose 한 번이면 frontend + backend + postgres 가 함께 뜬다.

**Repository**: https://github.com/charles96/stella_thread_house

## 사전 준비

- Docker Desktop (또는 Docker Engine + compose plugin)
- 접근 가능한 Ollama 서버 (예: `http://ai.example.com`)
- (선택) Tavily API key — 웹 검색 / JS 차단 사이트(Instagram 등) 본문 추출용

## 0. 배포 — 3단계 요약

> **CLI 에서 git clone → `.env` 수정 → `docker compose up`**. 그게 전부.

### Step 1. 소스 받기

```bash
git clone https://github.com/charles96/stella_thread_house.git
cd stella_thread_house
```

### Step 2. 환경변수 수정

```bash
cp .env.example .env
$EDITOR .env       # 또는 vi / nano / code .env 등
```

`.env` 안에서 **최소 다음 값만 본인 환경에 맞게 수정**:

| 키 | 필수 | 예시 / 설명 |
|---|---|---|
| `TH_ADMIN_EMAIL_ID` | ✓ | `you@example.com` — 첫 admin 가입 시 일치해야 하는 이메일 |
| `TH_ADMIN_PASSWORD` | ✓ | 강한 비밀번호 (운영에선 반드시 교체) |
| `OLLAMA_URL` | ✓ | `http://your-ollama-host:11434` — Ollama 서버 base URL |
| `TAVILY_API_KEY` | 선택 | `tvly-...` — 웹 검색 / Instagram 등 추출용 |
| `TH_HOST` | 선택 | `https://stella.example.com` — 도메인 뒤에 둘 때 |
| `POSTGRES_*` | 선택 | DB 자격증명. 기본값 사용해도 됨 |

> 위 표 외 다른 값들은 기본값이 자동 적용되니 건들 필요 없음. SMTP / Google OAuth 가 필요하면 `backend/.env` 도 추가 작성 (선택, [§1 참고](#1-환경변수-설정)).

### Step 3. Docker 기동

```bash
docker compose up -d --build
```

상태 확인 — 모두 `(healthy)` 가 되면 준비 완료 (~1분):

```bash
docker compose ps
docker compose logs -f app
```

브라우저로 **http://localhost:3100/login** → `.env` 의 admin 자격으로 첫 로그인 → admin 자동 생성 + 즉시 입장.

---

### 업데이트

```bash
cd stella_thread_house
git pull
docker compose up -d --build
```

데이터(DB / 첨부 이미지) 는 named volume 으로 보존됨.

### 정지 / 재시작 / 초기화

```bash
docker compose stop                    # 일시 정지 (컨테이너 보존)
docker compose start                   # 재기동
docker compose restart app             # app 만 재시작
docker compose down                    # 컨테이너 제거 (데이터 보존)
docker compose down -v                 # 컨테이너 + 볼륨 + 데이터 모두 삭제 (초기화)
```

상세 흐름은 아래 섹션들 참고.

## 1. 환경변수 설정

루트 `.env` (compose substitution 소스). 빈 값은 compose 의 default 가 적용됨.

```bash
cp .env.example .env
$EDITOR .env
```

| 키 | 필수 | 설명 |
|---|---|---|
| `TH_ADMIN_EMAIL_ID` | ✓ | 첫 admin 가입 시 일치해야 하는 이메일 |
| `TH_ADMIN_PASSWORD` | ✓ | 첫 admin 가입 비밀번호. 운영 시 강한 값 |
| `OLLAMA_URL` | ✓ | Ollama 서버 base URL. **첫 부팅 시** DB `system_config.ai` 에 시드 |
| `TAVILY_API_KEY` | 선택 | 웹 검색/추출용. 첫 부팅 시 DB `system_config.tavily` 에 시드 |
| `TH_HOST` | 선택 | 프론트엔드 base URL (CORS / 초대 메일 링크). 기본 `http://localhost:3100` |
| `POSTGRES_*` | 선택 | DB 자격증명 (기본 stella/stella/stella_dev_pass) |

**시드 패턴**: env → 부팅 시 DB row 가 비어있을 때 1회만 시드 → 이후 Settings UI 가 단일 출처 (env 무시).

`backend/.env` 는 추가 비밀값 — SMTP / Google OAuth / SESSION_SECRET 등. 선택사항이며 파일이 없어도 부팅됨.

```ini
# Google OAuth (선택)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URL=http://localhost:3100/api/auth/google/callback

# JWT 서명용 (운영 시 무작위 강한 값으로)
SESSION_SECRET=...

# SMTP (초대 메일 발송 — 미설정 시 메일 비활성. Settings > SMTP 에서 UI 변경 가능)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
SMTP_SECURE=0
```

> **`backend/.env` vs root `.env` 우선순위**: docker-compose 의 `environment:` 블록이 `env_file:` 보다 우선. 같은 키가 양쪽에 있으면 root `.env` 가 이김. SMTP/Google/SESSION 처럼 `environment:` 에 없는 값은 backend/.env 만 영향.

## 2. 빌드 & 기동

```bash
docker compose up -d --build
```

2개 컨테이너:

| 컨테이너 | 역할 | 외부 포트 |
|---|---|---|
| `stella-th-app` | frontend (Next.js :3100) + backend (NestJS :4100) 통합 | 3100, 4100 |
| `stella-th-postgres` | DB | 5432 |

> `app` 컨테이너 안에서 `start.sh` 가 두 프로세스를 동시 실행. 한쪽 종료 시 다른쪽도 종료 → restart policy 가 다시 띄움.

상태 확인:

```bash
docker compose ps
```

모두 `(healthy)` 가 되면 http://localhost:3100 접속. healthcheck 는 `/auth/setup-status` (외부 Ollama 의존 없음) + `/` 두 엔드포인트.

## 3. 첫 admin 가입

1. http://localhost:3100/login 접속
2. `.env` 의 `TH_ADMIN_EMAIL_ID` / `TH_ADMIN_PASSWORD` 입력 → 로그인
3. 사용자 0명 + env 일치 시 자동으로 admin 계정 생성 + 즉시 로그인

이후 추가 멤버는 admin 의 `Settings > Admin > Member > 초대` 로만 가입 가능 (공개 가입 비활성).

## 4. 운영 명령어

```bash
# 로그 (실시간) — 또는 Settings > Admin > System 에서 GUI 로도 가능
docker compose logs -f app

# 코드 변경 후 재시작
docker compose up -d --build app

# 정지 (데이터 유지)
docker compose down

# 정지 + 데이터 완전 삭제
docker compose down -v

# DB 진입
docker exec -it stella-th-postgres psql -U stella -d stella

# 첨부 이미지 디렉토리 진입
docker exec -it stella-th-app sh -c "ls /app/backend/uploads"
```

## 5. 데이터 영속

Named volume 두 개:

| 볼륨 | 컨테이너 경로 | 용도 |
|---|---|---|
| `postgres-data` | `/var/lib/postgresql/18/docker` | DB. Postgres 18 의 PGDATA 변경에 맞춰 새 경로 마운트 |
| `attachments-data` | `/app/backend/uploads` | 첨부 이미지 (`<messageId>/<filename>`) |

`docker compose down` 으론 보존됨. `down -v` 만 삭제.

## 6. 포트 & 외부 접근

| 포트 | 서비스 |
|---|---|
| 3100 | frontend (Next.js) — 브라우저가 직접 접근 |
| 4100 | backend (NestJS, REST + Swagger `/docs`) — `/api/*` 통해 frontend 가 프록시 |
| 5432 | postgres |

브라우저는 항상 same-origin `/api/*` 로 호출 → Next.js 의 `rewrites` 가 backend 로 프록시. 그래서 `NEXT_PUBLIC_API_URL` 같은 build-time URL env 가 필요 없음. CORS 도 사실상 무관.

리버스 프록시 뒤에 둘 경우:
- `TH_HOST` 를 외부 URL 로 (예: `https://stella.example.com`)
- `GOOGLE_REDIRECT_URL` 도 같은 도메인의 `/api/auth/google/callback` 으로 맞추고 Google Cloud Console 에 등록
- 프론트엔드 재빌드 불필요

## 7. 단독 개발 모드 (선택)

Docker 빌드가 부담스러울 때 — backend / frontend 만 npm 으로 직접:

```bash
# 터미널 1 — postgres 만 docker 로
docker compose up -d postgres

# 터미널 2 — backend (watch 모드, 자동 재시작)
cd backend
npm install
npm run start:dev

# 터미널 3 — frontend (HMR)
cd frontend
npm install
npm run dev
```

이 모드에선 `backend/.env` 의 `DATABASE_URL=postgres://stella:stella_dev_pass@localhost:5432/stella` 가 docker postgres 에 그대로 붙음. `TAVILY_API_KEY` 등 비밀값도 backend/.env 에서 dotenv 로 자동 로드.

## 8. Settings UI

admin 으로 로그인 후 좌측 사이드바의 ⚙ Settings 진입:

| 탭 | 설명 |
|---|---|
| **General** | 사용자 이름 / 비밀번호 변경, 언어/테마/타임존 |
| **Admin > AI** | Ollama Endpoint, Reasoning/Vision 모델, Tavily API Key |
| **Admin > SMTP** | 초대 메일 발송 SMTP 설정 + 테스트 발송 |
| **Admin > Member** | 멤버 목록 + 초대 + 권한(admin/member) 변경 |
| **Admin > System** | 서버 로그 실시간 (SSE 스트림) |
