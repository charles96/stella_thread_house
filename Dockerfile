# syntax=docker/dockerfile:1
#
# Stella's Thread House — frontend(Next.js) + backend(NestJS) 통합 이미지.
# 컨테이너 안에서 두 프로세스를 동시 실행한다.
#   - backend  : :4100  (NestJS)
#   - frontend : :3100  (Next.js standalone)
# DB(postgres) 는 별도 컨테이너 — docker-compose.yml 참고.
#
# 단독 개발용 Dockerfile 은 backend/Dockerfile, frontend/Dockerfile 에 그대로 남겨둠.

# ---------- 1. Backend build ----------
FROM node:20-alpine AS backend-build
WORKDIR /src

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build

# 런타임용 production deps 만 남김.
RUN npm prune --omit=dev --legacy-peer-deps && \
    # 캐시·문서·소스맵 제거로 추가 다이어트.
    find node_modules \( -name "*.md" -o -name "*.ts" -o -name "*.map" \
      -o -name "LICENSE*" -o -name "CHANGELOG*" -o -name ".github" \
      -o -name "test" -o -name "tests" -o -name "__tests__" \
      -o -name "example" -o -name "examples" -o -name "docs" \) \
      -prune -exec rm -rf {} + 2>/dev/null || true


# ---------- 2. Frontend build ----------
FROM node:20-alpine AS frontend-build
WORKDIR /src

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# next.config.js 의 output:'standalone' 으로 .next/standalone 에 self-contained 번들 생성.
# 브라우저는 /api/* same-origin 호출 → next.config.js 의 rewrites 가 백엔드로 프록시.
RUN npm run build


# ---------- 3. Runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Backend 산출물 + production node_modules
COPY --from=backend-build /src/dist ./backend/dist
COPY --from=backend-build /src/node_modules ./backend/node_modules
COPY --from=backend-build /src/package.json ./backend/package.json

# Frontend standalone — server.js + 최소 node_modules 자급자족
# public/ 은 standalone 번들에 포함되지 않으므로 별도 복사 필수.
COPY --from=frontend-build /src/.next/standalone ./frontend
COPY --from=frontend-build /src/.next/static ./frontend/.next/static
COPY --from=frontend-build /src/public ./frontend/public

# 두 프로세스 동시 실행 + 시그널 전파를 처리하는 작은 launcher 스크립트.
# 이전엔 npm i -g concurrently (~52MB) 로 처리했지만, 단순 BE/FE 두 프로세스라
# busybox sh 의 `wait -n` 한 줄이면 충분 — 이미지 사이즈 대폭 절감.
COPY scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 첨부 이미지 영구 저장 위치 — compose 에서 named volume 마운트.
RUN mkdir -p /app/backend/uploads

EXPOSE 4100 3100

CMD ["/app/start.sh"]
