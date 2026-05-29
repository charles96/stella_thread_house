#!/bin/bash
# NAS 에 미리 준비된 compose 로 app 이미지를 pull 하고 갱신한다.
# repo 안의 docker-compose.yml / docker-compose.prod.yml 은 사용하지 않는다.
#   - 단일 소스 = NAS 의 $COMPOSE_FILE (postgres + app, build 없음).
#   - app 이미지는 레지스트리에서 받아오고(${APP_IMAGE}), postgres 는 stock 이미지 그대로.
# GoCD deploy stage에서 실행됨.
set -euo pipefail
export DOCKER_API_VERSION=1.43
export DOCKER_CONFIG=$(mktemp -d)

# ── 1. 배포 버전(이미지 태그) 결정 ──────────────────────────────────────────
# DEPLOY_VERSION 이 비어 있으면 (SCM auto-trigger 등 GitHub Actions 경유 아닐 때)
# HEAD 의 git tag 를 읽어 fallback — ci-build.sh 와 동일한 로직.
if [ -z "${DEPLOY_VERSION:-}" ]; then
  git fetch --tags --force 2>/dev/null || true
fi
GIT_TAG="${DEPLOY_VERSION:-$(git describe --tags --exact-match HEAD 2>/dev/null || echo "")}"

if [ -z "$GIT_TAG" ]; then
  echo "ERROR: DEPLOY_VERSION 미설정 + HEAD 에 git tag 없음."
  echo "  현재 HEAD: $(git rev-parse HEAD)"
  echo "  근처 태그: $(git describe --tags 2>/dev/null || echo '없음')"
  exit 1
fi

IMAGE_TAG="${GIT_TAG#v}"
# NAS compose 의 ${APP_IMAGE} 가 이 값으로 치환됨.
# (shell 환경변수는 compose interpolation 에서 .env 보다 우선하므로 export 로 충분.)
export APP_IMAGE="${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"

# ── 2. NAS 에 미리 준비해둔 compose / env 위치 ───────────────────────────────
DEPLOY_DIR="/volume1/docker/stella"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
DEPLOY_ENV="$DEPLOY_DIR/.env"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: NAS compose 파일이 없습니다: $COMPOSE_FILE"
  echo "  서버에 docker-compose.yml 을 먼저 준비하세요."
  exit 1
fi

echo "▶ 배포 이미지: $APP_IMAGE"
echo "▶ compose 파일: $COMPOSE_FILE"

# ── 3. 레지스트리 로그인 ─────────────────────────────────────────────────────
if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_PASS:-}" ]; then
  echo "$REGISTRY_PASS" | docker login "$REGISTRY_URL" -u "$REGISTRY_USER" --password-stdin
fi

# ── 4. compose 명령 감지 (docker compose v2 plugin / docker-compose v1) ──────
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "ERROR: docker compose (v2 plugin) 또는 docker-compose (v1) 가 설치되어 있지 않습니다."
  echo "  설치 예) apt-get install -y docker-compose-plugin"
  exit 1
fi

# ── 5. 이미지 pull 후 갱신 ───────────────────────────────────────────────────
# app 이미지 태그가 바뀌었으므로 up -d 가 app 컨테이너만 재생성한다.
echo "▶ ${COMPOSE_CMD[*]} pull"
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" --env-file "$DEPLOY_ENV" pull

echo "▶ ${COMPOSE_CMD[*]} up -d"
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" --env-file "$DEPLOY_ENV" up -d --no-build

echo ""
echo "✓ 배포 완료: $APP_IMAGE"
